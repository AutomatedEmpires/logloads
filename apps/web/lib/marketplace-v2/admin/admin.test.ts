import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { MARKETPLACE_ADMIN_ACTION_ROLES, MARKETPLACE_ADMIN_ROLES, type MarketplaceAdminAction, type MarketplaceAdminRole } from "@logloads/contracts"
import { MARKETPLACE_ADMIN_NOT_STAFF } from "@logloads/services"

import {
  ADMIN_METHOD_ACTIONS,
  ADMIN_METHOD_NEEDS,
  adminCatalogueReady,
  missingAdminCatalogueEntries,
  normalizedAdmin
} from "./index"
import { runVerificationLapse, type VerificationLapseStore } from "./lapse-worker"
import { adminMethods } from "./methods"
import { ADMIN_FUNCTIONS, ADMIN_SERVICE_ROLE_FUNCTIONS, ADMIN_STATEMENT_NAMES, ADMIN_STATEMENTS, adminStatement } from "./statements"
import { createNormalizedMarketplaceV2, type NormalizedFeatureContext } from "../normalized-adapter"
import { MARKETPLACE_FUNCTIONS, type MarketplaceCalls, type MarketplaceDb, type MarketplacePrincipal } from "../normalized-db"
import { MARKETPLACE_QUERIES } from "../normalized-queries"
import {
  MarketplaceFeatureUnavailableError,
  MarketplaceRefusalError,
  MarketplaceStoreError,
  marketplaceV2FeatureMethods,
  type MarketplaceAdminPort,
  type MarketplaceV2Account
} from "../port"

const USER = "user_clerk_staff"
const ORG = "33333333-bbbb-4bbb-8bbb-333333333333"
const OTHER_ORG = "44444444-cccc-4ccc-8ccc-444444444444"
const JOB = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const REPORT = "22222222-aaaa-4aaa-8aaa-222222222222"
const LANDING = "55555555-dddd-4ddd-8ddd-555555555555"
const OTHER_LANDING = "56565656-dddd-4ddd-8ddd-565656565656"
const INQUIRY = "66666666-eeee-4eee-8eee-666666666666"
const REDEMPTION = "77777777-ffff-4fff-8fff-777777777777"
const REPORTER = "88888888-aaaa-4aaa-8aaa-888888888888"
const NOW = new Date("2026-11-12T05:03:00.000Z")
const PRINCIPAL: MarketplacePrincipal = { audience: "logloads-test-audience", issuer: "https://clerk.logloads.test", subject: USER }

const account: MarketplaceV2Account = { userId: USER }

interface Recorded { kind: "call" | "query"; name: string; args: unknown; readOnly?: boolean; transaction: number }

let recorded: Recorded[]
let transactions: number
let calls: Record<string, unknown[]>
let queries: Record<string, unknown[]>
let failures: Record<string, Error[]>
let principal: ReturnType<typeof vi.fn>

function postgresError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code, severity: "ERROR" })
}

function fakeDb(): MarketplaceDb {
  const api = (readOnly?: boolean): MarketplaceCalls => {
    const transaction = ++transactions

    return {
      async call(fn, args) {
        recorded.push({ args, kind: "call", name: fn, readOnly, transaction })
        const failure = failures[fn]?.shift()
        if (failure) throw failure
        return calls[fn] ?? []
      },
      fileListingReport: async () => { throw new Error("not used") },
      inquiryJobs: async () => [],
      inquiryParties: async () => null,
      landingStatement: async () => [],
      async query(name, values) {
        recorded.push({ args: values, kind: "query", name, readOnly, transaction })
        const failure = failures[name]?.shift()
        if (failure) throw failure
        return queries[name] ?? []
      },
      standingListingReport: async () => null,
      viewerSession: async () => ({ memberships: [], person: null })
    }
  }

  return {
    asAnon: async (work) => work(api()),
    asUser: async (_principal, work, options) => work(api(options?.readOnly)),
    close: async () => undefined
  }
}

/** The adapter with this group's live methods, whatever the catalogues hold today. */
function adapter(): MarketplaceAdminPort {
  return createNormalizedMarketplaceV2({
    db: fakeDb(),
    features: { admin: { methods: adminMethods, supported: false } },
    now: () => NOW,
    principal: principal as never
  })
}

const roles = (...names: string[]) => names.map((admin_role) => ({ admin_role }))

/** A geography point as PostgreSQL's text output gives it: hex EWKB, little-endian, with SRID 4326. */
function ewkbPoint(lng: number, lat: number): string {
  const bytes = new DataView(new ArrayBuffer(25))
  bytes.setUint8(0, 1)
  bytes.setUint32(1, 0x20000001, true)
  bytes.setUint32(5, 4326, true)
  bytes.setFloat64(9, lng, true)
  bytes.setFloat64(17, lat, true)
  return Buffer.from(bytes.buffer).toString("hex").toUpperCase()
}

function verificationRow(overrides: Record<string, unknown> = {}) {
  return {
    created_at: "2026-10-01T16:00:00+00:00",
    display_name: "Ridge Logging",
    id: ORG,
    legal_name: "Ridge Logging LLC",
    verification_status: "pending",
    verified_at: null,
    ...overrides
  }
}

function reportRow(overrides: Record<string, unknown> = {}) {
  return {
    created_at: "2026-11-10T09:00:00+00:00",
    details: "The phone number goes to another company.",
    id: REPORT,
    reason: "impersonation",
    reporter_user_id: REPORTER,
    resolution_note: null,
    reviewed_at: null,
    status: "open",
    target_id: JOB,
    target_kind: "job_posting",
    ...overrides
  }
}

function privateRow(overrides: Record<string, unknown> = {}) {
  return {
    directions: "Second gate past the mill",
    exact_point: ewkbPoint(-123.0868, 44.0521),
    gate_instructions: "Code at the scale house",
    landing_id: LANDING,
    org_id: ORG,
    site_contact_name: "Dana",
    site_contact_phone: "+15415550100",
    updated_at: "2026-11-01T12:00:00+00:00",
    updated_by: REPORTER,
    ...overrides
  }
}

interface MethodCase {
  method: Exclude<keyof MarketplaceAdminPort, "adminAccess">
  input?: unknown
}

/** One valid call of every method that needs a staff role. */
const CASES: MethodCase[] = [
  { method: "adminQueue" },
  { method: "adminVerificationQueue" },
  { input: { documentTypes: ["business_registration"], organizationId: OTHER_ORG, reason: "Matched the registry", status: "verified" }, method: "adminSetVerification" },
  { method: "adminReports" },
  { input: { reportId: REPORT, resolutionNote: "Not a real problem", status: "dismissed" }, method: "adminResolveReport" },
  { input: { jobId: JOB, reason: "Scam listing", status: "paused" }, method: "adminModerateJob" },
  { input: { jobId: JOB, reason: "Owner fixed the pay" }, method: "adminReleaseJobHold" },
  { input: { organizationId: OTHER_ORG, promotionCode: "founding_or", reason: "First ten in OR" }, method: "adminGrantFoundingPromotion" },
  { input: { organizationId: OTHER_ORG, reason: "Early hauler" }, method: "adminGrantFoundingHaulerBadge" },
  { input: { reason: "Ticket 4821: gate dispute", targetId: LANDING }, method: "adminReadLandingPrivate" },
  { input: { reason: "Ticket 4822: harassment report", targetId: INQUIRY }, method: "adminReadInquiryThread" }
]

function invoke(port: MarketplaceAdminPort, { input, method }: MethodCase, who: MarketplaceV2Account = account): Promise<unknown> {
  const fn = port[method] as (account: MarketplaceV2Account, input?: unknown) => Promise<unknown>
  return input === undefined ? fn(who) : fn(who, input)
}

const adminCalls = () => recorded.filter((entry) => entry.kind === "call")

beforeEach(() => {
  recorded = []
  transactions = 0
  principal = vi.fn(async () => PRINCIPAL)
  calls = {
    admin_grant_founding_hauler_badge: [7],
    admin_grant_founding_promotion: [REDEMPTION],
    admin_queue_counts: [{ jobs_on_hold: 1, open_reports: 3, pending_verifications: 2 }],
    admin_read_interest_thread: [
      { message_author_side: "hauler", message_body: "Two trucks Monday?", message_created_at: "2026-11-10T08:00:00+00:00", message_id: REPORT },
      { message_author_side: "landing", message_body: "Yes, 6am.", message_created_at: "2026-11-10T09:00:00+00:00", message_id: JOB }
    ],
    admin_read_landing_private: [privateRow()]
  }
  queries = { admin_reports: [reportRow()], admin_roles: roles("moderator", "support", "billing"), admin_verification_queue: [verificationRow()] }
  failures = {}
})

describe("admin entry module (#255)", () => {
  it("states what every port method runs, and which staff action each one is", () => {
    expect(Object.keys(ADMIN_METHOD_NEEDS).sort()).toEqual(marketplaceV2FeatureMethods("admin").sort())
    expect(ADMIN_METHOD_NEEDS.adminAccess).toEqual({ functions: [], statements: ["admin_roles"] })
    expect(ADMIN_METHOD_NEEDS.adminQueue).toEqual({ functions: ["admin_queue_counts"], statements: ["admin_roles"] })
    expect(ADMIN_METHOD_NEEDS.adminSetVerification).toEqual({ functions: ["admin_set_org_verification"], statements: ["admin_roles"] })
    expect(ADMIN_METHOD_NEEDS.adminReports).toEqual({ functions: [], statements: ["admin_roles", "admin_reports"] })

    for (const { method } of CASES) {
      // Every staff method reads the person's roles first, in the same transaction.
      expect(ADMIN_METHOD_NEEDS[method].statements[0], method).toBe("admin_roles")
      expect(MARKETPLACE_ADMIN_ACTION_ROLES).toHaveProperty(ADMIN_METHOD_ACTIONS[method])
    }
  })

  it("withholds the whole group, reaching no store, until the catalogues hold everything it runs", async () => {
    // Today the three statements and `admin_queue_counts` (a new SQL function, posted on #255) are not catalogued.
    expect(missingAdminCatalogueEntries()).toEqual({ functions: ["admin_queue_counts"], statements: ["admin_reports", "admin_roles", "admin_verification_queue"] })
    expect(adminCatalogueReady()).toBe(false)
    expect(normalizedAdmin.supported).toBe(false)

    const context: NormalizedFeatureContext = {
      asAccount: vi.fn(async () => { throw new Error("reached the store") }),
      asViewer: vi.fn(async () => { throw new Error("reached the store") }),
      now: () => NOW
    }
    const port = normalizedAdmin.methods(context)

    for (const method of marketplaceV2FeatureMethods("admin")) {
      const outcome = await (port[method] as (...values: unknown[]) => Promise<unknown>)(account, {}).then(() => null, (error: unknown) => error)

      expect(outcome, method).toBeInstanceOf(MarketplaceFeatureUnavailableError)
    }

    expect(context.asAccount).not.toHaveBeenCalled()
  })

  it("turns itself on once the catalogues hold every function and statement, and not before", () => {
    const functions = new Set([...Object.keys(MARKETPLACE_FUNCTIONS), ...ADMIN_FUNCTIONS])
    const statements = new Set<string>([...Object.keys(MARKETPLACE_QUERIES), ...ADMIN_STATEMENT_NAMES])

    expect(adminCatalogueReady({ functions, statements })).toBe(true)
    expect(adminCatalogueReady({ functions: new Set(Object.keys(MARKETPLACE_FUNCTIONS)), statements })).toBe(false)
    expect(adminCatalogueReady({ functions, statements: new Set(["admin_roles", "admin_reports"]) })).toBe(false)
  })

  it("keeps the service-role lapse function out of every method and the catalogue", () => {
    expect(ADMIN_SERVICE_ROLE_FUNCTIONS).toEqual(["lapse_expired_org_verifications"])
    expect(Object.prototype.hasOwnProperty.call(MARKETPLACE_FUNCTIONS, "lapse_expired_org_verifications")).toBe(false)

    for (const needs of Object.values(ADMIN_METHOD_NEEDS)) {
      expect(needs.functions).not.toContain("lapse_expired_org_verifications")
    }
  })
})

describe("admin statements (#255)", () => {
  it("checks the same staff roles in SQL as the rules do, and reads only the person's own staff row", () => {
    const sqlRoles = (action: MarketplaceAdminAction) =>
      `marketplace.is_platform_admin(array[${(MARKETPLACE_ADMIN_ACTION_ROLES[action] ?? []).map((role) => `'${role}'`).join(", ")}]::text[])`

    expect(ADMIN_STATEMENTS.admin_verification_queue.text).toContain(sqlRoles("verificationQueue"))
    expect(ADMIN_STATEMENTS.admin_reports.text).toContain(sqlRoles("reports"))
    expect(ADMIN_STATEMENTS.admin_roles.text).toContain("a.user_id = marketplace.current_user_id()")
    expect(ADMIN_STATEMENTS.admin_roles.text).toContain("a.revoked_at is null")
  })

  it("binds every value, and selects no reviewer identity or private business field", () => {
    expect(adminStatement("admin_reports", ["actioned", null])).toEqual({ text: ADMIN_STATEMENTS.admin_reports.text, values: ["actioned", null] })
    expect(() => adminStatement("admin_reports", [null])).toThrow(TypeError)
    expect(() => adminStatement("admin_roles", [USER])).toThrow(TypeError)
    expect(ADMIN_STATEMENTS.admin_reports.text).not.toContain("reviewed_by")
    expect(ADMIN_STATEMENTS.admin_verification_queue.text).not.toMatch(/created_by|verified_by|home_state/)

    // The two lists are bounded; the roles read is one row by its primary key.
    expect(ADMIN_STATEMENTS.admin_reports.text).toContain("limit 100")
    expect(ADMIN_STATEMENTS.admin_verification_queue.text).toContain("limit 100")
  })
})

describe("admin methods: role refusals (#255)", () => {
  it.each(CASES)("$method refuses a person who is not LogLoads staff before any admin function runs", async (entry) => {
    queries.admin_roles = []

    const outcome = await invoke(adapter(), entry).then(() => null, (error: unknown) => error)

    expect(outcome).toBeInstanceOf(MarketplaceRefusalError)
    expect(outcome).toMatchObject({ code: "42501", message: MARKETPLACE_ADMIN_NOT_STAFF })
    expect(adminCalls()).toEqual([])
    expect(recorded.map((entry) => entry.name)).toEqual(["admin_roles"])
  })

  // Every method whose roles leave out at least one staff role (the queue and the badge grant take every role).
  it.each(
    CASES.filter(({ method }) => {
      const needed = MARKETPLACE_ADMIN_ACTION_ROLES[ADMIN_METHOD_ACTIONS[method]]
      return needed !== null && MARKETPLACE_ADMIN_ROLES.some((role) => role !== "superadmin" && !needed.includes(role))
    })
  )(
    "$method refuses a staff role it does not need, naming the role, before any admin function runs",
    async (entry) => {
      const needed = MARKETPLACE_ADMIN_ACTION_ROLES[ADMIN_METHOD_ACTIONS[entry.method]] ?? []
      const others = MARKETPLACE_ADMIN_ROLES.filter((role) => role !== "superadmin" && !needed.includes(role))
      queries.admin_roles = roles(...others)

      const outcome = await invoke(adapter(), entry).then(() => null, (error: unknown) => error)

      expect(outcome).toBeInstanceOf(MarketplaceRefusalError)
      expect((outcome as MarketplaceRefusalError).code).toBe("42501")
      expect((outcome as Error).message).toMatch(/^This needs the LogLoads .+ role\.$/)
      expect(adminCalls()).toEqual([])
    }
  )

  it.each(CASES)("$method lets superadmin through", async (entry) => {
    queries.admin_roles = roles("superadmin")

    await expect(invoke(adapter(), entry)).resolves.not.toBeInstanceOf(Error)
  })

  it.each<[MarketplaceAdminRole, MethodCase["method"]]>([
    ["moderator", "adminModerateJob"],
    ["moderator", "adminReleaseJobHold"],
    ["moderator", "adminResolveReport"],
    ["support", "adminReadLandingPrivate"],
    ["support", "adminReadInquiryThread"],
    ["billing", "adminGrantFoundingPromotion"],
    ["support", "adminSetVerification"],
    ["billing", "adminGrantFoundingHaulerBadge"]
  ])("lets a %s through %s", async (role, method) => {
    queries.admin_roles = roles(role)

    await expect(invoke(adapter(), CASES.find((entry) => entry.method === method) as MethodCase)).resolves.not.toBeInstanceOf(Error)
  })

  it("surfaces the store's own refusal when a role was revoked between the check and the write", async () => {
    failures.admin_moderate_job_posting = [postgresError("platform moderator required", "42501")]

    await expect(adapter().adminModerateJob(account, { jobId: JOB, reason: "Scam listing", status: "paused" }))
      .rejects.toMatchObject({ code: "42501", message: "platform moderator required", name: "MarketplaceRefusalError" })
  })

  it("reads the person's staff roles, none for everyone else, and never a role the contracts do not know", async () => {
    queries.admin_roles = roles("support")
    await expect(adapter().adminAccess(account)).resolves.toEqual({ roles: ["support"] })

    queries.admin_roles = []
    await expect(adapter().adminAccess(account)).resolves.toEqual({ roles: [] })

    queries.admin_roles = roles("auditor")
    await expect(adapter().adminAccess(account)).resolves.toEqual({ roles: [] })

    queries.admin_roles = [{}]
    await expect(adapter().adminAccess(account)).rejects.toBeInstanceOf(MarketplaceStoreError)
    expect(recorded.every((entry) => entry.readOnly === true)).toBe(true)
  })
})

describe("admin methods: no business, no cross-tenant reach (#255, §8.7)", () => {
  it("acts as the person for no business, even when the account carries one", async () => {
    await adapter().adminSetVerification({ organizationId: ORG, userId: USER } as MarketplaceV2Account, CASES[2]?.input)

    expect(principal).toHaveBeenCalledTimes(1)
    expect(principal).toHaveBeenCalledWith({ organizationId: "", userId: USER })
    // The business acted on is the input's, checked by the store; never the session's.
    expect(adminCalls()).toEqual([
      expect.objectContaining({ args: expect.objectContaining({ p_org_id: OTHER_ORG }), name: "admin_set_org_verification" })
    ])
  })

  it("gives an owner of one business no staff power over another", async () => {
    // An organization owner who is not LogLoads staff: the roles read is empty, whatever their business roles are.
    queries.admin_roles = []

    for (const entry of CASES.filter(({ input }) => JSON.stringify(input ?? {}).includes(OTHER_ORG))) {
      await expect(invoke(adapter(), entry)).rejects.toMatchObject({ code: "42501" })
    }

    expect(adminCalls()).toEqual([])
  })

  it("refuses a malformed account before reaching the store", async () => {
    await expect(adapter().adminQueue({ userId: "" })).rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect(principal).not.toHaveBeenCalled()
    expect(recorded).toEqual([])
  })

  it("returns only the private fields the view shows, and refuses a row for any other landing", async () => {
    await expect(adapter().adminReadLandingPrivate(account, { reason: "Ticket 4821: gate dispute", targetId: LANDING })).resolves.toEqual({
      exactPoint: { lat: 44.0521, lng: -123.0868 },
      gateInstructions: "Code at the scale house",
      landingId: LANDING,
      siteContactName: "Dana",
      siteContactPhone: "+15415550100"
    })

    calls.admin_read_landing_private = [privateRow({ landing_id: OTHER_LANDING })]
    await expect(adapter().adminReadLandingPrivate(account, { reason: "Ticket 4821: gate dispute", targetId: LANDING }))
      .rejects.toBeInstanceOf(MarketplaceStoreError)
  })

  it("reads the exact point as GeoJSON too, and a landing with no private details as nothing", async () => {
    calls.admin_read_landing_private = [privateRow({ exact_point: { coordinates: [-122.5, 45.25], type: "Point" } })]
    await expect(adapter().adminReadLandingPrivate(account, { reason: "Ticket 4821: gate dispute", targetId: LANDING }))
      .resolves.toMatchObject({ exactPoint: { lat: 45.25, lng: -122.5 } })

    calls.admin_read_landing_private = [privateRow({ exact_point: null })]
    await expect(adapter().adminReadLandingPrivate(account, { reason: "Ticket 4821: gate dispute", targetId: LANDING }))
      .resolves.toMatchObject({ exactPoint: null })

    calls.admin_read_landing_private = [privateRow({ exact_point: "01020000" })]
    await expect(adapter().adminReadLandingPrivate(account, { reason: "Ticket 4821: gate dispute", targetId: LANDING }))
      .rejects.toBeInstanceOf(MarketplaceStoreError)

    calls.admin_read_landing_private = []
    await expect(adapter().adminReadLandingPrivate(account, { reason: "Ticket 4821: gate dispute", targetId: LANDING })).resolves.toBeNull()
  })
})

describe("admin methods: every write is audited (#255)", () => {
  it("records a verified review with its document types in the audit reason, in one read-write transaction", async () => {
    await adapter().adminSetVerification(account, {
      documentTypes: ["business_registration", "assumed_name_filing"],
      organizationId: OTHER_ORG,
      reason: "Matched the Oregon registry",
      status: "verified"
    })

    expect(recorded).toEqual([
      { args: [], kind: "query", name: "admin_roles", readOnly: false, transaction: 1 },
      {
        args: {
          p_org_id: OTHER_ORG,
          p_reason: "verified; documents: business_registration, assumed_name_filing; note: Matched the Oregon registry",
          p_status: "verified"
        },
        kind: "call",
        name: "admin_set_org_verification",
        readOnly: false,
        transaction: 1
      }
    ])
  })

  it("records a rejection by its code, and refuses an incomplete review before reaching the store", async () => {
    await adapter().adminSetVerification(account, {
      organizationId: OTHER_ORG,
      reason: "SSN visible on page 2",
      rejectionCode: "sensitive_identifier",
      status: "rejected"
    })

    expect(adminCalls()[0]?.args).toEqual({
      p_org_id: OTHER_ORG,
      p_reason: "rejected; code: sensitive_identifier; note: SSN visible on page 2",
      p_status: "rejected"
    })

    recorded = []
    await expect(adapter().adminSetVerification(account, { organizationId: OTHER_ORG, reason: "Looks right", status: "verified" }))
      .rejects.toMatchObject({ code: "22023", message: "Choose the documents you reviewed." })
    expect(recorded).toEqual([])
  })

  it("passes the store's refusal of an unknown business through, unaudited by the store", async () => {
    failures.admin_set_org_verification = [postgresError("Organization not found", "P0002")]

    await expect(adapter().adminSetVerification(account, CASES[2]?.input)).rejects.toMatchObject({ code: "P0002", message: "Organization not found" })
  })

  it("moderates, releases and resolves with the stated reason, each through its audited function", async () => {
    const port = adapter()

    await port.adminModerateJob(account, { jobId: JOB, reason: "Impersonates Ridge Logging", status: "closed" })
    await port.adminReleaseJobHold(account, { jobId: JOB, reason: "Identity confirmed by phone" })
    await port.adminResolveReport(account, { reportId: REPORT, resolutionNote: null, status: "reviewing" })
    await port.adminResolveReport(account, { reportId: REPORT, resolutionNote: "Listing closed", status: "actioned" })

    expect(adminCalls().map(({ args, name, readOnly }) => ({ args, name, readOnly }))).toEqual([
      { args: { p_job_id: JOB, p_reason: "Impersonates Ridge Logging", p_status: "closed" }, name: "admin_moderate_job_posting", readOnly: false },
      { args: { p_job_id: JOB, p_reason: "Identity confirmed by phone" }, name: "admin_release_job_moderation_hold", readOnly: false },
      { args: { p_reason: null, p_report_id: REPORT, p_status: "reviewing" }, name: "admin_resolve_report", readOnly: false },
      { args: { p_reason: "Listing closed", p_report_id: REPORT, p_status: "actioned" }, name: "admin_resolve_report", readOnly: false }
    ])
  })

  it("refuses a release without a reason, and says plainly when there is no hold", async () => {
    await expect(adapter().adminReleaseJobHold(account, { jobId: JOB, reason: "ok" })).rejects.toMatchObject({ code: "22023" })

    failures.admin_release_job_moderation_hold = [postgresError("No moderation hold on this posting", "P0002")]
    await expect(adapter().adminReleaseJobHold(account, { jobId: JOB, reason: "Identity confirmed by phone" }))
      .rejects.toMatchObject({ code: "P0002", message: "No moderation hold on this posting" })
  })

  it("returns the founding offer's redemption, and says a business already has one instead of a conflict", async () => {
    await expect(adapter().adminGrantFoundingPromotion(account, CASES[7]?.input)).resolves.toEqual({ redemptionId: REDEMPTION })
    expect(adminCalls()[0]?.args).toEqual({ p_org_id: OTHER_ORG, p_promotion_code: "founding_or", p_reason: "First ten in OR" })

    failures.admin_grant_founding_promotion = [postgresError("duplicate key value violates unique constraint", "23505")]
    await expect(adapter().adminGrantFoundingPromotion(account, CASES[7]?.input))
      .rejects.toMatchObject({ code: "23505", message: "This business already has a founding offer." })
  })

  it("grants a founding hauler badge once: a repeat answers the same number", async () => {
    const port = adapter()

    await expect(port.adminGrantFoundingHaulerBadge(account, CASES[8]?.input)).resolves.toEqual({ badgeNumber: 7 })
    await expect(port.adminGrantFoundingHaulerBadge(account, CASES[8]?.input)).resolves.toEqual({ badgeNumber: 7 })

    calls.admin_grant_founding_hauler_badge = [1001]
    await expect(port.adminGrantFoundingHaulerBadge(account, CASES[8]?.input)).rejects.toBeInstanceOf(MarketplaceStoreError)

    failures.admin_grant_founding_hauler_badge = [postgresError("organization does not have a hauler profile", "P0002")]
    await expect(port.adminGrantFoundingHaulerBadge(account, CASES[8]?.input))
      .rejects.toMatchObject({ code: "P0002", message: "This business has no hauler profile, so it can't get a founding hauler badge." })
  })

  it("reads private details and threads only in a read-write transaction, so the store's audit row is written first", async () => {
    const port = adapter()

    await port.adminReadLandingPrivate(account, { reason: "Ticket 4821: gate dispute", targetId: LANDING })
    await expect(port.adminReadInquiryThread(account, { reason: "Ticket 4822: harassment report", targetId: INQUIRY })).resolves.toEqual([
      { authorSide: "hauler", body: "Two trucks Monday?", createdAt: "2026-11-10T08:00:00.000Z", id: REPORT },
      { authorSide: "landing", body: "Yes, 6am.", createdAt: "2026-11-10T09:00:00.000Z", id: JOB }
    ])

    expect(adminCalls().map(({ args, name, readOnly }) => ({ args, name, readOnly }))).toEqual([
      { args: { p_landing_id: LANDING, p_reason: "Ticket 4821: gate dispute" }, name: "admin_read_landing_private", readOnly: false },
      { args: { p_interest_id: INQUIRY, p_reason: "Ticket 4822: harassment report" }, name: "admin_read_interest_thread", readOnly: false }
    ])

    await expect(port.adminReadInquiryThread(account, { reason: "short", targetId: INQUIRY })).rejects.toMatchObject({ code: "22023" })
  })
})

describe("admin reads (#255, §7.1–§7.3)", () => {
  it("reads the queue's real counts read-only, and fails closed on a count that drifted", async () => {
    await expect(adapter().adminQueue(account)).resolves.toEqual({ jobsOnHold: 1, openReports: 3, pendingVerifications: 2 })
    expect(adminCalls()).toEqual([{ args: {}, kind: "call", name: "admin_queue_counts", readOnly: true, transaction: 1 }])

    calls.admin_queue_counts = [{ jobs_on_hold: -1, open_reports: 3, pending_verifications: 2 }]
    await expect(adapter().adminQueue(account)).rejects.toBeInstanceOf(MarketplaceStoreError)

    calls.admin_queue_counts = []
    await expect(adapter().adminQueue(account)).rejects.toBeInstanceOf(MarketplaceStoreError)
  })

  it("lists businesses awaiting review with their claimed names, and refuses a column the view does not show", async () => {
    await expect(adapter().adminVerificationQueue(account)).resolves.toEqual([
      { createdAt: "2026-10-01T16:00:00.000Z", displayName: "Ridge Logging", legalName: "Ridge Logging LLC", organizationId: ORG, status: "pending", verifiedAt: null }
    ])

    queries.admin_verification_queue = [verificationRow({ created_by: REPORTER })]
    await expect(adapter().adminVerificationQueue(account)).rejects.toBeInstanceOf(MarketplaceStoreError)
  })

  it("lists open and reviewing reports by default, filters by status and target, and refuses an unknown filter", async () => {
    const port = adapter()

    await expect(port.adminReports(account)).resolves.toEqual([
      {
        createdAt: "2026-11-10T09:00:00.000Z",
        details: "The phone number goes to another company.",
        id: REPORT,
        reason: "impersonation",
        reporterUserId: REPORTER,
        resolutionNote: null,
        reviewedAt: null,
        status: "open",
        target: { id: JOB, kind: "job_posting" }
      }
    ])
    await port.adminReports(account, { status: "actioned", target: "organization" })

    expect(recorded.filter((entry) => entry.name === "admin_reports").map((entry) => entry.args)).toEqual([[null, null], ["actioned", "organization"]])
    await expect(port.adminReports(account, { status: "closed" } as never)).rejects.toMatchObject({ code: "22023" })
    expect(recorded.filter((entry) => entry.name === "admin_reports")).toHaveLength(2)
  })
})

describe("the 12-month verification lapse job (#255; lead decision on #251)", () => {
  const lapsedRow = (overrides: Record<string, unknown> = {}) => ({
    lapsed_at: "2026-11-12T05:03:00+00:00",
    notices_queued: 0,
    org_id: ORG,
    previous_verified_at: "2025-11-12T05:03:00+00:00",
    ...overrides
  })

  function batches(...pages: unknown[][]): VerificationLapseStore & { limits: number[] } {
    const queue = [...pages]
    const limits: number[] = []

    return {
      async lapseExpiredVerifications(limit) {
        limits.push(limit)
        return queue.shift() ?? []
      },
      limits
    }
  }

  /** The proposed SQL's behaviour, in memory: every verified review at or before the cutoff lapses once, and is audited once. */
  function simulatedStore(orgs: Array<{ id: string; verifiedAt: string | null; status: string }>, cutoff: string, lapsedAt: string) {
    const audit: Array<{ action: string; orgId: string; previousVerifiedAt: string }> = []
    const store: VerificationLapseStore = {
      async lapseExpiredVerifications(limit) {
        const due = orgs
          .filter((org) => org.status === "verified" && org.verifiedAt !== null && org.verifiedAt <= cutoff)
          .sort((a, b) => (a.verifiedAt as string).localeCompare(b.verifiedAt as string) || a.id.localeCompare(b.id))
          .slice(0, limit)

        return due.map((org) => {
          const previousVerifiedAt = org.verifiedAt as string
          org.status = "pending"
          org.verifiedAt = null
          audit.push({ action: "organization.verification_lapsed", orgId: org.id, previousVerifiedAt })
          return lapsedRow({ lapsed_at: lapsedAt, org_id: org.id, previous_verified_at: previousVerifiedAt })
        })
      }
    }

    return { audit, orgs, store }
  }

  it("lapses every due review in batches until a short batch, and counts the notices still waiting on #253", async () => {
    const store = batches(
      [lapsedRow(), lapsedRow({ org_id: OTHER_ORG })],
      [lapsedRow({ notices_queued: 2, org_id: LANDING })]
    )

    await expect(runVerificationLapse(store, { batchSize: 2 })).resolves.toEqual({
      batches: 2,
      complete: true,
      lapsed: 3,
      noticesQueued: 2,
      noticesWaiting: 2
    })
    expect(store.limits).toEqual([2, 2])
  })

  it("lapses a review at exactly 12 months, keeps one a millisecond younger, and an immediate re-run changes nothing", async () => {
    const { audit, orgs, store } = simulatedStore(
      [
        { id: ORG, status: "verified", verifiedAt: "2025-11-12T05:03:00.000Z" },
        { id: OTHER_ORG, status: "verified", verifiedAt: "2025-11-12T05:03:00.001Z" },
        { id: LANDING, status: "pending", verifiedAt: null }
      ],
      "2025-11-12T05:03:00.000Z",
      NOW.toISOString()
    )

    await expect(runVerificationLapse(store)).resolves.toMatchObject({ complete: true, lapsed: 1 })
    await expect(runVerificationLapse(store)).resolves.toEqual({ batches: 1, complete: true, lapsed: 0, noticesQueued: 0, noticesWaiting: 0 })

    expect(orgs.map(({ id, status }) => [id, status])).toEqual([[ORG, "pending"], [OTHER_ORG, "verified"], [LANDING, "pending"]])
    expect(audit).toEqual([{ action: "organization.verification_lapsed", orgId: ORG, previousVerifiedAt: "2025-11-12T05:03:00.000Z" }])
  })

  it("fails loudly on a review the store lapsed early, by the store's own clock", async () => {
    await expect(runVerificationLapse(batches([lapsedRow({ lapsed_at: "2026-11-12T05:02:59.999+00:00" })])))
      .rejects.toBeInstanceOf(MarketplaceStoreError)
  })

  it("stops after its batch limit and says more remain, so the next run continues", async () => {
    const full = [lapsedRow(), lapsedRow({ org_id: OTHER_ORG })]

    await expect(runVerificationLapse(batches(full, full, full), { batchSize: 2, maxBatches: 2 })).resolves.toMatchObject({
      batches: 2,
      complete: false,
      lapsed: 4
    })
  })

  it("refuses a batch size or limit outside its bounds, and a row that drifted from the SQL", async () => {
    await expect(runVerificationLapse(batches(), { batchSize: 0 })).rejects.toBeInstanceOf(RangeError)
    await expect(runVerificationLapse(batches(), { batchSize: 501 })).rejects.toBeInstanceOf(RangeError)
    await expect(runVerificationLapse(batches(), { maxBatches: 0 })).rejects.toBeInstanceOf(RangeError)
    await expect(runVerificationLapse(batches([lapsedRow({ legal_name: "Ridge Logging LLC" })]))).rejects.toBeInstanceOf(MarketplaceStoreError)
    await expect(runVerificationLapse(batches([lapsedRow({ notices_queued: -1 })]))).rejects.toBeInstanceOf(MarketplaceStoreError)
  })
})
