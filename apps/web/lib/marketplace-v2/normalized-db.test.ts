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

/**
 * The reviewed allow-list (#269): every function the adapter may call, by who the database lets call it. A function
 * added to `MARKETPLACE_FUNCTIONS` fails the catalogue test until it is listed here, which is done only after reading
 * its SQL (architecture/normalized-v2) and recording its access rule beside its catalogue entry.
 *
 * - `anonymous`: granted to `anon`; public discovery, public-safe fields only.
 * - `person`: granted to `authenticated`; the function checks the caller's own membership, role, seat or verified email.
 * - `staff`: granted to `authenticated`; the function checks `is_platform_admin` and writes the audit log.
 */
const REVIEWED_FUNCTIONS = {
  anonymous: ["get_marketplace_job", "list_marketplace_jobs"],
  person: [
    "accept_team_invitation",
    "count_eligible_invitation_recipients",
    "create_organization",
    "decline_team_invitation",
    "estimate_boost_audience",
    "get_org_entitlement_state",
    "get_viewer_marketplace_access",
    "invite_team_member",
    "list_authoring_landings",
    "list_hauler_equipment_options",
    "list_marketplace_interests",
    "list_my_team_invitations",
    "list_saved_jobs",
    "list_team_invitations",
    "mark_notifications_read",
    "post_hauler_interest_reply",
    "publish_job_posting",
    "reactivate_job_posting",
    "reconfirm_job_posting",
    "resend_team_invitation",
    "reserve_targeted_invitation",
    "respond_to_interest",
    "respond_to_invitation",
    "revoke_team_invitation",
    "save_job_posting_draft",
    "set_job_posting_status",
    "set_membership_landing_scope",
    "submit_expression_of_interest",
    "withdraw_interest"
  ],
  staff: [
    "admin_grant_founding_hauler_badge",
    "admin_grant_founding_promotion",
    "admin_moderate_job_posting",
    "admin_read_interest_thread",
    "admin_read_landing_private",
    "admin_release_job_moderation_hold",
    "admin_set_org_verification"
  ]
} as const

/**
 * Functions of the schema that must never be reachable through this connection: worker, billing, identity-sync and
 * import paths (granted to `service_role` only, or to no one) and internal helpers.
 */
const NEVER_CATALOGUED = [
  "activate_job_boost",
  "admin_import_legacy_job_posting",
  "admin_list_billing_provider_events",
  "apply_billing_provider_event",
  "apply_subscription_cycle",
  "claim_email_notifications",
  "complete_email_notification",
  "eligible_invitation_recipients",
  "enqueue_job_alerts",
  "enqueue_notification",
  "enqueue_team_invitation_email",
  "expire_stale_invitation_reservations",
  "open_subscription_cycle",
  "record_email_provider_event",
  "replay_deferred_billing_event",
  "resolve_invitation_delivery",
  "supersede_deferred_billing_events",
  "sync_verified_identity",
  "write_audit"
]

const UUID_A = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const UUID_B = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

const PRINCIPAL = { audience: "logloads-test-audience", issuer: "https://clerk.logloads.test", subject: "user_test_subject" }

/** The shape postgres.js throws for a server error: the server's fields copied onto it, severity included. */
function postgresError(code: string, message: string, name = "PostgresError"): Error {
  return Object.assign(new Error(message), { code, name, severity: "ERROR", severity_local: "ERROR" })
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

  it("sends discovery's poster as a bound uuid, so the function scopes before its row limit (#209)", () => {
    const poster = "33333333-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    const scoped = marketplaceCallStatement("list_marketplace_jobs", { p_accepting_only: false, p_limit: 200, p_org_id: poster })

    expect(scoped.text).toBe(
      "select to_jsonb(r) as row from marketplace.list_marketplace_jobs(p_accepting_only => $1::text::boolean, p_limit => $2::text::integer, p_org_id => $3::text::uuid) as r"
    )
    expect(scoped.values).toEqual(["false", "200", poster])
    expect(marketplaceCallStatement("list_marketplace_jobs", { p_org_id: null }).text).toContain("p_org_id => null::uuid")
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

  it("sends an interval as a whole number of seconds, minutes, hours or days, and nothing else (#269)", () => {
    const invite = marketplaceCallStatement("invite_team_member", { p_email: "rae@example.test", p_valid_for: "7 days" })

    expect(invite.text).toBe(
      "select to_jsonb(marketplace.invite_team_member(p_email => $1::text, p_valid_for => $2::text::interval)) as value"
    )
    expect(invite.values).toEqual(["rae@example.test", "7 days"])

    for (const accepted of ["1 hour", "30 days", "90 seconds", "45 minutes", "0 days", "1 day"]) {
      expect(marketplaceCallStatement("resend_team_invitation", { p_valid_for: accepted }).values).toEqual([accepted])
    }

    expect(marketplaceCallStatement("resend_team_invitation", { p_invitation_id: UUID_A, p_valid_for: null }).text)
      .toBe("select to_jsonb(marketplace.resend_team_invitation(p_invitation_id => $1::text::uuid, p_valid_for => null::interval)) as value")
    // Left out, the function's own default applies (the plan's dedupe window, the invitation's current expiry).
    expect(marketplaceCallStatement("reserve_targeted_invitation", { p_dedupe_window: undefined, p_job_id: UUID_A }).text)
      .not.toContain("p_dedupe_window")

    for (const refused of [
      "1 month", "1 year", "1 week", "-1 days", "1.5 hours", "1 day 2 hours", "7days", "7  days", " 7 days", "7 days ", "07 days",
      "1234567 days", "P7D", "infinity", "7 days'; drop table x; --", "", 7, 604800, true, ["7 days"], { days: 7 }
    ]) {
      expect(() => marketplaceCallStatement("resend_team_invitation", { p_valid_for: refused as never })).toThrow(TypeError)
    }
  })

  it("sends a uuid[] as JSON text the server casts element by element, and refuses anything that is not a UUID (#269)", () => {
    const scope = marketplaceCallStatement("set_membership_landing_scope", { p_landing_ids: [UUID_A, UUID_B], p_membership_id: UUID_B })

    expect(scope.text).toBe(
      "select to_jsonb(marketplace.set_membership_landing_scope(p_landing_ids => array(select e.item::uuid from jsonb_array_elements_text($1::text::jsonb) as e(item)), p_membership_id => $2::text::uuid)) as value"
    )
    expect(scope.values).toEqual([`["${UUID_A}","${UUID_B}"]`, UUID_B])
    expect(scope.text).not.toMatch(/\$\d+::(?!text)/)

    // An empty array is an empty uuid[] (it clears a landing scope); null is a typed null.
    expect(marketplaceCallStatement("mark_notifications_read", { p_notification_ids: [] }).values).toEqual(["[]"])
    expect(marketplaceCallStatement("mark_notifications_read", { p_notification_ids: null }).text)
      .toBe("select to_jsonb(marketplace.mark_notifications_read(p_notification_ids => null::uuid[])) as value")

    for (const refused of [
      UUID_A, [UUID_A, "not-a-uuid"], [`${UUID_A}'::uuid]); drop table x; --`], [UUID_A.replaceAll("-", "")], [`{${UUID_A}}`],
      [UUID_A, null], [1], [[UUID_A]], `{${UUID_A}}`, 7, { 0: UUID_A, length: 1 }
    ]) {
      expect(() => marketplaceCallStatement("mark_notifications_read", { p_notification_ids: refused as never })).toThrow(TypeError)
    }
  })

  it("calls a function that takes no arguments, a rows function and a void function in the catalogued shape (#269)", () => {
    expect(marketplaceCallStatement("list_my_team_invitations", {}))
      .toEqual({ text: "select to_jsonb(r) as row from marketplace.list_my_team_invitations() as r", values: [] })
    expect(marketplaceCallStatement("admin_read_landing_private", { p_landing_id: UUID_A, p_reason: "Ticket 4821: gate dispute" }).text)
      .toBe("select to_jsonb(r) as row from marketplace.admin_read_landing_private(p_landing_id => $1::text::uuid, p_reason => $2::text) as r")
    expect(marketplaceCallStatement("set_job_posting_status", { p_job_id: UUID_A, p_status: "paused" }).text)
      .toBe("select 1 as done from marketplace.set_job_posting_status(p_job_id => $1::text::uuid, p_status => $2::text) as r")
  })

  it("catalogues exactly the reviewed functions: an unreviewed name fails here (#269)", () => {
    const names = Object.keys(MARKETPLACE_FUNCTIONS).sort()
    const reviewed = [...REVIEWED_FUNCTIONS.anonymous, ...REVIEWED_FUNCTIONS.person, ...REVIEWED_FUNCTIONS.staff]

    expect(new Set(reviewed).size).toBe(reviewed.length)
    expect(names).toEqual([...reviewed].sort())
  })

  it("opens only public discovery to an anonymous session", () => {
    const anonymous = Object.entries(MARKETPLACE_FUNCTIONS).filter(([, spec]) => spec.anonymous).map(([name]) => name).sort()

    expect(anonymous).toEqual([...REVIEWED_FUNCTIONS.anonymous].sort())
  })

  it("keeps staff functions apart: every admin_ function is reviewed as staff-only, takes a reason and is never anonymous", () => {
    const admin = Object.keys(MARKETPLACE_FUNCTIONS).filter((name) => name.startsWith("admin_")).sort()

    expect(admin).toEqual([...REVIEWED_FUNCTIONS.staff].sort())

    for (const name of REVIEWED_FUNCTIONS.staff) {
      expect({ name, ...MARKETPLACE_FUNCTIONS[name] }).toMatchObject({ anonymous: false, args: { p_reason: "text" }, name })
    }
  })

  it("never catalogues a worker, billing, identity-sync, import or internal function", () => {
    for (const name of NEVER_CATALOGUED) {
      expect(Object.prototype.hasOwnProperty.call(MARKETPLACE_FUNCTIONS, name), name).toBe(false)
      expect(() => marketplaceCallStatement(name as never, {})).toThrow(TypeError)
    }

    // Nothing inherited from Object.prototype is a function name either.
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(() => marketplaceCallStatement(name as never, {})).toThrow(TypeError)
    }
  })

  it("declares only known argument types under SQL parameter names", () => {
    const types = ["uuid", "text", "bpchar", "integer", "bigint", "numeric", "boolean", "date", "interval", "jsonb", "text[]", "uuid[]"]

    for (const [name, spec] of Object.entries(MARKETPLACE_FUNCTIONS)) {
      expect(name).toMatch(/^[a-z][a-z_]*$/)
      expect(["rows", "value", "void"]).toContain(spec.returns)

      for (const [argument, type] of Object.entries(spec.args)) {
        expect(argument, name).toMatch(/^p_[a-z_]+$/)
        expect(types, `${name}.${argument}`).toContain(type)
      }
    }
  })

  it("catalogues each port v3 function with its exact SQL argument names and types (stages 01-26, #269)", () => {
    const signatures = Object.fromEntries(
      Object.entries(MARKETPLACE_FUNCTIONS).map(([name, spec]) => [
        name,
        Object.entries(spec.args).map(([argument, type]) => `${argument} ${type}`).sort().join(", ")
      ])
    )

    expect(signatures).toMatchObject({
      accept_team_invitation: "p_invitation_id uuid",
      admin_grant_founding_hauler_badge: "p_org_id uuid, p_reason text",
      admin_grant_founding_promotion: "p_org_id uuid, p_promotion_code text, p_reason text",
      admin_moderate_job_posting: "p_job_id uuid, p_reason text, p_status text",
      admin_read_interest_thread: "p_interest_id uuid, p_reason text",
      admin_read_landing_private: "p_landing_id uuid, p_reason text",
      admin_release_job_moderation_hold: "p_job_id uuid, p_reason text",
      admin_set_org_verification: "p_org_id uuid, p_reason text, p_status text",
      count_eligible_invitation_recipients: "p_dedupe_window interval, p_job_id uuid, p_radius_miles integer",
      decline_team_invitation: "p_invitation_id uuid",
      estimate_boost_audience: "p_job_id uuid, p_product_code text",
      invite_team_member:
        "p_email text, p_landing_ids uuid[], p_landing_workspace_seat boolean, p_org_id uuid, p_role text, p_valid_for interval",
      list_my_team_invitations: "",
      list_saved_jobs: "p_org_id uuid",
      list_team_invitations: "p_org_id uuid",
      mark_notifications_read: "p_notification_ids uuid[]",
      reactivate_job_posting: "p_attest_available boolean, p_job_id uuid",
      resend_team_invitation: "p_invitation_id uuid, p_valid_for interval",
      reserve_targeted_invitation: "p_dedupe_window interval, p_job_id uuid, p_note text, p_recipient_org_id uuid",
      respond_to_invitation: "p_invitation_id uuid, p_response text",
      revoke_team_invitation: "p_invitation_id uuid",
      set_job_posting_status: "p_job_id uuid, p_status text",
      set_membership_landing_scope: "p_landing_ids uuid[], p_membership_id uuid"
    })
    expect(signatures.save_job_posting_draft).toBe(
      "p_description text, p_destination_label text, p_draft_job_id uuid, p_duration_days integer, p_equipment_codes text[], " +
        "p_est_daily_loads integer, p_est_loads_per_truck_per_day numeric, p_est_one_way_miles integer, p_est_tons_per_load numeric, " +
        "p_landing_id uuid, p_pay_amount_cents bigint, p_pay_note text, p_pay_unit text, p_product text, " +
        "p_public_access_requirements text[], p_public_road_notes text, p_schedule_note text, p_title text, " +
        "p_trucks_per_day integer, p_trucks_requested integer, p_work_starts_on date"
    )
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

  it("recognises a server error by its fields, not its class name, which a minified build renames (#140)", () => {
    const refusal = translateStoreError(postgresError("23514", "This job is no longer accepting interest", "e"))

    expect(refusal).toBeInstanceOf(MarketplaceRefusalError)
    expect(refusal.message).toBe("This job is no longer accepting interest")
    // A SQLSTATE-shaped code without the server's severity is not a server error.
    expect(translateStoreError(Object.assign(new Error("not from the server"), { code: "23514", name: "PostgresError" })))
      .toBeInstanceOf(MarketplaceStoreError)
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
