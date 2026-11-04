import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  createPostgresIdentitySync,
  credentialProblems,
  identitySyncCredentialProblems,
  FILE_LISTING_REPORT,
  MARKETPLACE_FUNCTIONS,
  marketplaceCallStatement,
  principalClaims,
  STANDING_LISTING_REPORT,
  translateStoreError,
  type CredentialFacts,
  type IdentitySyncCredentialFacts
} from "./normalized-db"
import { MarketplaceAdapterConfigurationError, MarketplaceRefusalError, MarketplaceStoreError } from "./port"

const PRINCIPAL = { audience: "logloads-test-audience", issuer: "https://clerk.logloads.test", subject: "user_test_subject" }

function postgresError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code, name: "PostgresError" })
}

describe("marketplaceCallStatement", () => {
  it("calls only schema-qualified catalogue functions with named, typed, bound arguments", () => {
    const statement = marketplaceCallStatement("list_marketplace_jobs", {
      p_accepting_only: true,
      p_equipment: null,
      p_limit: 200,
      p_query: "saw'; drop table x; --"
    })

    expect(statement.text).toBe(
      "select to_jsonb(r) as row from marketplace.list_marketplace_jobs(p_accepting_only => $1::text::boolean, p_equipment => null::text, p_limit => $2::text::integer, p_query => $3::text) as r"
    )
    expect(statement.values).toEqual(["true", "200", "saw'; drop table x; --"])
  })

  it("leaves undefined arguments to the function's own default", () => {
    expect(marketplaceCallStatement("list_marketplace_interests", { p_job_id: undefined, p_org_id: "org", p_side: "hauler" }).text)
      .toBe("select to_jsonb(r) as row from marketplace.list_marketplace_interests(p_org_id => $1::text::uuid, p_side => $2::text) as r")
  })

  it("sends every value as text for the server to convert, so the driver never re-serializes it", () => {
    const statement = marketplaceCallStatement("submit_expression_of_interest", {
      p_available_from: "2026-12-01",
      p_equipment: [{ configurationKey: "log_truck", count: 2 }],
      p_trucks_offered: 2
    })

    expect(statement.text).toContain("p_available_from => $1::text::date")
    expect(statement.text).toContain("p_equipment => $2::text::jsonb")
    expect(statement.text).toContain("p_trucks_offered => $3::text::integer")
    expect(statement.values.every((value) => typeof value === "string")).toBe(true)
    expect(statement.text).not.toMatch(/\$\d+::(?!text)/)
  })

  it("passes arrays and JSON as JSON text, scalars and void calls in their own shape", () => {
    const publish = marketplaceCallStatement("publish_job_posting", { p_equipment_codes: ["log_truck", "self_loader"], p_landing_id: "landing" })
    expect(publish.text).toBe(
      "select to_jsonb(marketplace.publish_job_posting(p_equipment_codes => array(select jsonb_array_elements_text($1::text::jsonb)), p_landing_id => $2::text::uuid)) as value"
    )
    expect(publish.values).toEqual(['["log_truck","self_loader"]', "landing"])

    const interest = marketplaceCallStatement("submit_expression_of_interest", { p_equipment: [{ configurationKey: "log_truck", count: 2 }] })
    expect(interest.values).toEqual(['[{"configurationKey":"log_truck","count":2}]'])

    expect(marketplaceCallStatement("withdraw_interest", { p_interest_id: "interest" }).text)
      .toBe("select 1 as done from marketplace.withdraw_interest(p_interest_id => $1::text::uuid) as r")
  })

  it("refuses an uncatalogued function, an unknown argument or a wrongly typed value", () => {
    expect(() => marketplaceCallStatement("admin_import_legacy_job_posting" as never, {})).toThrow(TypeError)
    expect(() => marketplaceCallStatement("withdraw_interest", { p_reason: "x" } as never)).toThrow(TypeError)
    expect(() => marketplaceCallStatement("publish_job_posting", { p_trucks_requested: 2.5 })).toThrow(TypeError)
    expect(() => marketplaceCallStatement("publish_job_posting", { p_attest_available: "true" as never })).toThrow(TypeError)
    expect(() => marketplaceCallStatement("publish_job_posting", { p_equipment_codes: [1] as never })).toThrow(TypeError)
  })

  it("catalogues only marketplace V2 functions: no worker, admin, billing, legacy or table-write path", () => {
    const names = Object.keys(MARKETPLACE_FUNCTIONS)

    expect(names.some((name) => /admin|billing|subscription|invitation|legacy|import|cycle|audit|boost|sync/.test(name))).toBe(false)
    expect(names.filter((name) => MARKETPLACE_FUNCTIONS[name as keyof typeof MARKETPLACE_FUNCTIONS].anonymous).sort())
      .toEqual(["get_marketplace_job", "list_marketplace_jobs"])
  })
})

describe("listing report statements (#130)", () => {
  it("reads only the person's own open reports, by the columns HF-16 grants the reporter", () => {
    expect(STANDING_LISTING_REPORT).toContain("reporter_user_id = marketplace.current_user_id()")
    expect(STANDING_LISTING_REPORT).toContain("target_kind = 'job_posting' and target_id = $1::text::uuid")
    expect(STANDING_LISTING_REPORT).toMatch(/select id, created_at from marketplace\.abuse_reports/)
    expect(STANDING_LISTING_REPORT).not.toMatch(/reviewed_by|resolution_note/)
  })

  it("inserts only the columns the authenticated role may write, as bound values, and returns no reviewer", () => {
    expect(FILE_LISTING_REPORT).toMatch(/insert into marketplace\.abuse_reports \(target_kind, target_id, reason, details\)/)
    expect(FILE_LISTING_REPORT).toContain("values ('job_posting', $1::text::uuid, $2::text, $3::text) returning id, created_at")
    expect(FILE_LISTING_REPORT).not.toMatch(/reporter_user_id|status|reviewed/)
  })
})

describe("principalClaims", () => {
  it("states the issuer, subject, audience and authenticated role with a short expiry", () => {
    const claims = JSON.parse(principalClaims(PRINCIPAL, Date.UTC(2026, 10, 3, 12, 0, 0)))

    expect(claims).toEqual({
      aud: PRINCIPAL.audience,
      exp: Date.UTC(2026, 10, 3, 12, 1, 0) / 1000,
      iat: Date.UTC(2026, 10, 3, 12, 0, 0) / 1000,
      iss: PRINCIPAL.issuer,
      role: "authenticated",
      sub: PRINCIPAL.subject
    })
  })

  it("refuses an incomplete identity rather than asserting a blank one", () => {
    expect(() => principalClaims({ ...PRINCIPAL, subject: " " })).toThrow(MarketplaceAdapterConfigurationError)
    expect(() => principalClaims({ ...PRINCIPAL, issuer: "short" })).toThrow(MarketplaceAdapterConfigurationError)
    expect(() => principalClaims({ ...PRINCIPAL, audience: "" })).toThrow(MarketplaceAdapterConfigurationError)
  })
})

describe("credentialProblems", () => {
  const safe: CredentialFacts = {
    bypass_rls: false,
    can_become_anon: true,
    can_become_authenticated: true,
    create_role: false,
    inherits: false,
    other_memberships: [],
    owns_marketplace: false,
    owns_marketplace_objects: false,
    privileged_memberships: [],
    replication: false,
    service_role_member: false,
    superuser: false
  }

  it("accepts a NOINHERIT login role that can only become anon and authenticated", () => {
    expect(credentialProblems(safe)).toEqual([])
  })

  it.each([
    ["superuser", { superuser: true }, "superuser"],
    ["BYPASSRLS (Supabase postgres or service_role)", { bypass_rls: true }, "bypasses row-level security"],
    ["an inheriting role", { inherits: true }, "NOINHERIT"],
    ["a service_role member (Supabase authenticator)", { service_role_member: true }, "service_role"],
    ["a role that cannot become authenticated", { can_become_authenticated: false }, "authenticated"],
    ["the schema owner", { owns_marketplace: true }, "owns the marketplace schema"],
    ["a role creator", { create_role: true }, "create roles"],
    ["a member of a privileged role, even through another role (HF-22)", { privileged_memberships: ["postgres"] }, "privileged role (postgres)"],
    ["a role whose memberships could not be read", { privileged_memberships: null as never }, "privileged role (unknown)"],
    ["an owner of a table or function in the schema (HF-22)", { owns_marketplace_objects: true }, "owns objects in the marketplace schema"],
    ["a role whose object ownership could not be read", { owns_marketplace_objects: undefined as never }, "owns objects in the marketplace schema"],
    ["a member of any role beyond anon and authenticated (HF-22)", { other_memberships: ["pg_write_all_data"] }, "other than anon and authenticated (pg_write_all_data)"],
    ["a role whose other memberships could not be read", { other_memberships: undefined as never }, "other than anon and authenticated (unknown)"]
  ])("refuses %s", (_label, change, reason) => {
    expect(credentialProblems({ ...safe, ...change }).join("; ")).toContain(reason)
  })

  it("refuses when the role cannot be inspected", () => {
    expect(credentialProblems(undefined)).not.toEqual([])
  })
})

describe("identitySyncCredentialProblems (#213)", () => {
  const safe: IdentitySyncCredentialFacts = {
    bypass_rls: false,
    can_become_service_role: true,
    create_role: false,
    inherits: false,
    other_memberships: [],
    owns_marketplace: false,
    owns_marketplace_objects: false,
    privileged_memberships: [],
    replication: false,
    superuser: false
  }

  it("accepts a NOINHERIT login role that can only become service_role", () => {
    expect(identitySyncCredentialProblems(safe)).toEqual([])
  })

  it.each([
    ["superuser", { superuser: true }, "superuser"],
    ["BYPASSRLS", { bypass_rls: true }, "bypasses row-level security"],
    ["an inheriting role", { inherits: true }, "NOINHERIT"],
    ["a role creator", { create_role: true }, "create roles"],
    ["a replication role", { replication: true }, "replication"],
    ["the marketplace connection's role, which cannot become service_role", { can_become_service_role: false }, "cannot switch to the service_role role"],
    ["a role that can also act as a person (anon or authenticated)", { other_memberships: ["anon", "authenticated"] }, "other than service_role (anon, authenticated)"],
    ["a role whose other memberships could not be read", { other_memberships: undefined as never }, "other than service_role (unknown)"],
    ["a member of a privileged role", { privileged_memberships: ["postgres"] }, "privileged role (postgres)"],
    ["the schema owner", { owns_marketplace: true }, "owns the marketplace schema"],
    ["an owner of objects in the schema", { owns_marketplace_objects: true }, "owns objects in the marketplace schema"]
  ])("refuses %s", (_label, change, reason) => {
    expect(identitySyncCredentialProblems({ ...safe, ...change }).join("; ")).toContain(reason)
  })

  it("refuses when the role cannot be inspected", () => {
    expect(identitySyncCredentialProblems(null)).not.toEqual([])
  })
})

describe("createPostgresIdentitySync (#213)", () => {
  function fakeSql(facts: Partial<IdentitySyncCredentialFacts>, linkedUserId: unknown = "abababab-abab-4bab-8bab-abababababab") {
    const statements: Array<{ text: string; values: unknown[] }> = []
    const safe = { bypass_rls: false, can_become_service_role: true, create_role: false, inherits: false, other_memberships: [], owns_marketplace: false,
      owns_marketplace_objects: false, privileged_memberships: [], replication: false, superuser: false }
    const unsafe = async (text: string, values: unknown[] = []) => {
      statements.push({ text, values })
      if (text.includes("from pg_roles r")) return [{ row: { ...safe, ...facts } }]
      if (text.includes("sync_verified_identity")) return [{ value: linkedUserId }]
      return [{}]
    }
    const sql = { begin: async (_mode: string, work: (tx: unknown) => Promise<unknown>) => work({ unsafe }), unsafe }

    return { sql: sql as never, statements }
  }

  const identity = { displayName: " Rae Ridge ", email: "rae@example.test", emailVerified: true, issuer: PRINCIPAL.issuer, subject: PRINCIPAL.subject }

  it("calls only sync_verified_identity, as service_role, with the session's subject and a verified email", async () => {
    const { sql, statements } = fakeSql({})

    await expect(createPostgresIdentitySync({ sql }).link(identity)).resolves.toBe("abababab-abab-4bab-8bab-abababababab")

    const [, setup, call] = statements
    expect(setup?.values).toEqual(["service_role", JSON.stringify({ role: "service_role" })])
    expect(call?.text).toMatch(/^select to_jsonb\(marketplace\.sync_verified_identity\(p_issuer => \$1::text, p_subject => \$2::text/)
    expect(call?.values).toEqual([PRINCIPAL.issuer, PRINCIPAL.subject, "Rae Ridge", "rae@example.test", "true"])
    expect(statements).toHaveLength(3)
  })

  it("never sends an email the provider did not verify", async () => {
    const { sql, statements } = fakeSql({})

    await createPostgresIdentitySync({ sql }).link({ ...identity, emailVerified: false })
    expect(statements[2]?.values.slice(3)).toEqual([null, "false"])
  })

  it("refuses an unsafe login role before linking anyone", async () => {
    const { sql, statements } = fakeSql({ other_memberships: ["authenticated"] })

    await expect(createPostgresIdentitySync({ sql }).link(identity)).rejects.toThrow(MarketplaceAdapterConfigurationError)
    expect(statements.some((statement) => statement.text.includes("sync_verified_identity"))).toBe(false)
  })

  it("treats an unexpected result as a store failure", async () => {
    const { sql } = fakeSql({}, null)

    await expect(createPostgresIdentitySync({ sql }).link(identity)).rejects.toBeInstanceOf(MarketplaceStoreError)
  })
})

describe("translateStoreError", () => {
  it("keeps the database's words for business-rule, access and not-found refusals", () => {
    const refusal = translateStoreError(postgresError("23514", "A reply needs a message"))

    expect(refusal).toBeInstanceOf(MarketplaceRefusalError)
    expect(refusal.message).toBe("A reply needs a message")
    expect((refusal as MarketplaceRefusalError).code).toBe("23514")
    expect(translateStoreError(postgresError("P0002", "Job not found")).message).toBe("Job not found")
    expect(translateStoreError(postgresError("42501", "Inquiry not found")).message).toBe("Inquiry not found")
  })

  it("turns a bare grant failure into a plain refusal", () => {
    const refusal = translateStoreError(postgresError("42501", "permission denied for function publish_job_posting"))

    expect(refusal).toBeInstanceOf(MarketplaceRefusalError)
    expect(refusal.message).not.toContain("publish_job_posting")
  })

  it("never shows a connection, driver or malformed-input error's text", () => {
    for (const error of [
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" }),
      Object.assign(new Error("write EPIPE"), { code: "EPIPE" }),
      postgresError("22P02", 'invalid input syntax for type uuid: "x"'),
      postgresError("22023", "p_side must be hauler or landing"),
      new Error("anything else")
    ]) {
      const translated = translateStoreError(error)

      expect(translated).toBeInstanceOf(MarketplaceStoreError)
      expect(translated.message).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|EPIPE|uuid|p_side|anything/)
    }
  })

  it("asks the person to retry on a conflict", () => {
    expect(translateStoreError(postgresError("40001", "could not serialize access")).message).toMatch(/Reload the page/)
  })

  it("passes the adapter's own errors through unchanged", () => {
    const own = new MarketplaceRefusalError("Inquiry not found", "42501")

    expect(translateStoreError(own)).toBe(own)
  })
})
