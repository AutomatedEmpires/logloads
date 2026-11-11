import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { LANDING_PLANS, MARKETPLACE_INVITATION_RADIUS_MILES } from "@logloads/contracts"

import { INVITE_METHOD_NEEDS, inviteMethodReady, invitesCatalogueReady, normalizedInvites } from "./index"
import { receivedInvitationFromRow, recipientFromRow, sentInvitationFromRow } from "./mapping"
import { inviteMethods } from "./methods"
import { INVITE_STATEMENT_NAMES, INVITE_STATEMENTS, inviteStatement } from "./statements"
import { createNormalizedMarketplaceV2 } from "../normalized-adapter"
import { MARKETPLACE_FUNCTIONS, type MarketplaceCalls, type MarketplaceDb, type MarketplacePrincipal } from "../normalized-db"
import { MARKETPLACE_QUERIES } from "../normalized-queries"
import {
  MARKETPLACE_V2_FEATURE_OPERATIONS,
  MarketplaceFeatureUnavailableError,
  MarketplaceRefusalError,
  MarketplaceStoreError,
  type MarketplaceInvitesPort,
  type MarketplaceV2Viewer
} from "../port"

const CLERK = "user_clerk_landing"
const ORG = "33333333-bbbb-4bbb-8bbb-333333333333"
const OTHER_ORG = "44444444-cccc-4ccc-8ccc-cccccccccccc"
const HAULER_A = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const HAULER_B = "66666666-cccc-4ccc-8ccc-cccccccccccc"
const HAULER_C = "77777777-eeee-4eee-8eee-eeeeeeeeeeee"
const JOB = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const INV_1 = "88888888-dddd-4ddd-8ddd-000000000001"
const INV_2 = "88888888-dddd-4ddd-8ddd-000000000002"
const INV_3 = "88888888-dddd-4ddd-8ddd-000000000003"
const SENDER_USER = "55555555-dddd-4ddd-8ddd-dddddddddddd"
const NOW = new Date("2026-11-11T18:00:00.000Z")
const PRINCIPAL: MarketplacePrincipal = { audience: "logloads-test-audience", issuer: "https://clerk.logloads.test", subject: CLERK }

const landing: MarketplaceV2Viewer = { organizationId: ORG, userId: CLERK }
const hauler: MarketplaceV2Viewer = { organizationId: HAULER_A, userId: CLERK }

interface Recorded { kind: "call" | "query"; name: string; args: unknown; readOnly?: boolean }

let recorded: Recorded[]
let calls: Record<string, unknown[] | ((args: Record<string, unknown>) => unknown[])>
let queries: Record<string, unknown[]>
let failures: Record<string, Error[]>

function postgresError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code, severity: "ERROR" })
}

function fakeDb(): MarketplaceDb {
  const api = (readOnly?: boolean): MarketplaceCalls => ({
    async call(fn, args) {
      recorded.push({ args, kind: "call", name: fn, readOnly })
      const failure = failures[fn]?.shift()
      if (failure) throw failure
      const result = calls[fn]
      return typeof result === "function" ? result(args as Record<string, unknown>) : result ?? []
    },
    fileListingReport: async () => { throw new Error("not used") },
    inquiryJobs: async () => [],
    inquiryParties: async () => null,
    landingStatement: async () => [],
    async query(name, values) {
      recorded.push({ args: values, kind: "query", name, readOnly })
      const failure = failures[name]?.shift()
      if (failure) throw failure
      return queries[name] ?? []
    },
    standingListingReport: async () => null,
    viewerSession: async () => ({ memberships: [], person: null })
  })

  return {
    asAnon: async (work) => work(api()),
    asUser: async (_principal, work, options) => work(api(options?.readOnly)),
    close: async () => undefined
  }
}

/** The adapter with this group's live methods, whatever the catalogues hold today. */
function adapter(): MarketplaceInvitesPort {
  return createNormalizedMarketplaceV2({
    db: fakeDb(),
    features: { invites: { methods: inviteMethods, supported: false } },
    now: () => NOW,
    principal: async () => PRINCIPAL
  })
}

/** A `get_marketplace_job` row: the public job as the viewer may see it. */
function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    accepting_interest: true,
    destination_label: "Mill A",
    distance_miles: null,
    duration_days: 30,
    ends_on: "2026-12-20",
    equipment_codes: ["log_truck"],
    equipment_labels: ["Log truck"],
    est_one_way_miles: 40,
    estimated_daily_loads: 8,
    estimated_loads_per_truck_per_day: 2,
    estimated_tons_per_load: 27,
    expires_at: "2026-12-20T00:00:00+00:00",
    job_id: JOB,
    last_confirmed_at: "2026-11-10T15:00:00+00:00",
    last_modified_at: "2026-11-09T15:00:00+00:00",
    origin_label: "Sweet Home",
    origin_lat: 44.4,
    origin_lng: -122.7,
    origin_state_code: "OR",
    pay_amount_cents: 52500,
    pay_note: null,
    pay_unit: "per_load",
    poster_name: "Cedar Landing",
    poster_organization_id: ORG,
    poster_verified: true,
    product: "Fir",
    public_access_requirements: [],
    public_road_notes: null,
    schedule_note: null,
    slug: "fir-haul",
    sponsored: false,
    starts_on: "2026-11-20",
    status: "active",
    title: "Fir haul",
    trucks_per_day: 4,
    trucks_total: 4,
    ...overrides
  }
}

/** A `get_org_entitlement_state` row: Basic, within every cap, `remaining` of 3 invitations left. */
function entitlementRow(remaining: number | null, overrides: Record<string, unknown> = {}) {
  return {
    active_landings: 1,
    fleet_only_members: 0,
    grace_ends_at: null,
    invitations_remaining: remaining,
    landing_conflict: false,
    max_active_landings: 1,
    max_team_members: 2,
    paid_landing_seats: 2,
    period_end: "2026-12-01T00:00:00+00:00",
    plan_code: "basic",
    seat_conflict: false,
    subscription_status: "active",
    ...overrides
  }
}

function sentRow(overrides: Record<string, unknown> = {}) {
  return {
    created_at: "2026-11-11T17:59:00+00:00",
    delivered_at: null,
    id: INV_1,
    job_id: JOB,
    note: "Two trucks Monday",
    recipient_name: "Ridge Haulers",
    recipient_org_id: HAULER_A,
    recipient_response: "none",
    responded_at: null,
    sent_by: SENDER_USER,
    sent_by_name: "Dana Foreman",
    sent_by_viewer: true,
    status: "reserved",
    ...overrides
  }
}

function receivedRow(overrides: Record<string, unknown> = {}) {
  return {
    delivered_at: "2026-11-11T17:00:00+00:00",
    id: INV_1,
    job: jobRow(),
    note: "Two trucks Monday",
    recipient_response: "none",
    sender_name: "Cedar Landing",
    sender_org_id: ORG,
    sender_verified: true,
    sender_verified_at: "2026-10-02T10:00:00+00:00",
    ...overrides
  }
}

function recipientRow(overrides: Record<string, unknown> = {}) {
  return {
    availability_reported_at: "2026-11-10T06:00:00+00:00",
    business_name: "Ridge Haulers",
    equipment: [{ label: "Log truck", units: 3 }],
    home_base: "Lebanon, OR",
    org_id: HAULER_A,
    verified: false,
    verified_at: null,
    ...overrides
  }
}

function send(recipients: string[], overrides: Record<string, unknown> = {}) {
  return { jobId: JOB, note: "Two trucks Monday", recipientOrganizationIds: recipients, requestId: "compose-0001", ...overrides }
}

function storeCalls(name: string): Recorded[] {
  return recorded.filter((entry) => entry.name === name)
}

/** Each reservation returns the next invitation id, in order. */
function reservations(...ids: string[]) {
  const queue = [...ids]
  return () => [queue.shift()]
}

beforeEach(() => {
  recorded = []
  calls = {
    get_marketplace_job: [jobRow()],
    get_org_entitlement_state: [entitlementRow(3)]
  }
  queries = {}
  failures = {}
})

describe("invite statements", () => {
  it("bind every value and never select a phone, an email or private landing details (the reveal rule)", () => {
    const texts = INVITE_STATEMENT_NAMES.map((name) => INVITE_STATEMENTS[name].text).join("\n")

    expect(texts).not.toMatch(/phone|email|user_contacts|delivery_address|landing_private|site_contact|gate_instructions|exact_point/i)

    for (const name of INVITE_STATEMENT_NAMES) {
      const values = INVITE_STATEMENTS[name].args.map(() => ORG)
      const bound = inviteStatement(name, values)

      expect(bound.text).not.toContain(ORG)
      expect(bound.values).toEqual(values)
    }

    expect(() => inviteStatement("invite_sent", [ORG])).toThrow(TypeError)
  })

  it("scope every row to the active business: senders by sender_org_id, recipients by recipient_org_id", () => {
    expect(INVITE_STATEMENTS.invite_sent.text).toMatch(/ti\.sender_org_id = \$1::text::uuid/)
    expect(INVITE_STATEMENTS.invite_received.text).toMatch(/ti\.recipient_org_id = \$1::text::uuid/)
    expect(INVITE_STATEMENTS.invite_received_one.text).toMatch(/ti\.recipient_org_id = \$1::text::uuid/)
    // The hauler's inbox and its answers see delivered invitations only (#269 finding on respond_to_invitation).
    expect(INVITE_STATEMENTS.invite_received.text).toMatch(/ti\.status = 'delivered'/)
    expect(INVITE_STATEMENTS.invite_received_one.text).toMatch(/ti\.status = 'delivered'/)
  })

  it("match the shared catalogue word for word once it holds them", () => {
    const squash = (text: string) => text.replace(/\s+/g, " ").trim()

    for (const name of INVITE_STATEMENT_NAMES) {
      const catalogued = (MARKETPLACE_QUERIES as Record<string, { args: readonly string[]; text: string }>)[name]

      if (catalogued) {
        expect(squash(catalogued.text)).toBe(squash(INVITE_STATEMENTS[name].text))
        expect(catalogued.args).toEqual(INVITE_STATEMENTS[name].args)
      }
    }
  })
})

describe("catalogue gate", () => {
  it("names every port method's functions and statements", () => {
    expect(Object.keys(INVITE_METHOD_NEEDS).sort()).toEqual(Object.keys(MARKETPLACE_V2_FEATURE_OPERATIONS.invites).sort())
  })

  it("is ready only when both catalogues hold everything every method runs", () => {
    const everything = {
      functions: new Set(Object.values(INVITE_METHOD_NEEDS).flatMap((needs) => needs.functions)),
      statements: new Set<string>(INVITE_STATEMENT_NAMES)
    }

    expect(invitesCatalogueReady(everything)).toBe(true)
    expect(inviteMethodReady("invitationAudience", { functions: new Set(["get_marketplace_job", "count_eligible_invitation_recipients"]), statements: new Set<string>() }))
      .toBe(true)

    for (const name of [...everything.functions, ...everything.statements]) {
      const without = {
        functions: new Set([...everything.functions].filter((entry) => entry !== name)),
        statements: new Set([...everything.statements].filter((entry) => entry !== name))
      }

      expect(invitesCatalogueReady(without), name).toBe(false)
    }
  })

  it("refuses every method without reaching the store until the shared catalogues hold all of them, and stays unsupported", async () => {
    const port = createNormalizedMarketplaceV2({ db: fakeDb(), now: () => NOW, principal: async () => PRINCIPAL })
    const catalogue = { functions: new Set(Object.keys(MARKETPLACE_FUNCTIONS)), statements: new Set(Object.keys(MARKETPLACE_QUERIES)) }

    expect(normalizedInvites.supported).toBe(false)
    expect(port.supports.invites).toBe(false)
    expect(invitesCatalogueReady()).toBe(invitesCatalogueReady(catalogue))

    if (invitesCatalogueReady(catalogue)) return

    for (const method of Object.keys(INVITE_METHOD_NEEDS) as Array<keyof MarketplaceInvitesPort>) {
      recorded = []
      const invoke = port[method] as unknown as (viewer: MarketplaceV2Viewer, input: unknown) => Promise<unknown>

      await expect(invoke(landing, JOB), method).rejects.toBeInstanceOf(MarketplaceFeatureUnavailableError)
      expect(recorded).toEqual([])
    }
  })
})

describe("invitationAudience", () => {
  it("returns the store's exact count for the business's own job, leaving the plan's dedupe window alone", async () => {
    calls.count_eligible_invitation_recipients = ["3"]

    expect(await adapter().invitationAudience(landing, JOB.toUpperCase())).toEqual({ eligibleRecipients: 3, jobId: JOB, radiusMiles: 100 })
    expect(storeCalls("count_eligible_invitation_recipients")).toEqual([
      { args: { p_job_id: JOB, p_radius_miles: MARKETPLACE_INVITATION_RADIUS_MILES }, kind: "call", name: "count_eligible_invitation_recipients", readOnly: true }
    ])
  })

  it("refuses another business's job without counting (cross-tenant)", async () => {
    calls.get_marketplace_job = [jobRow({ poster_organization_id: OTHER_ORG })]

    await expect(adapter().invitationAudience(landing, JOB)).rejects.toMatchObject({ code: "P0002", message: "Choose one of your business's jobs." })
    expect(storeCalls("count_eligible_invitation_recipients")).toEqual([])
  })

  it("refuses a job it cannot see, and a malformed id before any store call", async () => {
    calls.get_marketplace_job = []

    await expect(adapter().invitationAudience(landing, JOB)).rejects.toBeInstanceOf(MarketplaceRefusalError)

    recorded = []
    await expect(adapter().invitationAudience(landing, "job-1")).rejects.toMatchObject({ code: "22023" })
    expect(recorded).toEqual([])
  })

  it("says plainly when the person's role or landing scope does not reach the job", async () => {
    failures.count_eligible_invitation_recipients = [postgresError("not authorized for this job", "42501")]

    await expect(adapter().invitationAudience(landing, JOB)).rejects.toMatchObject({ code: "42501", message: "Your role can't invite haulers for this job." })
  })

  it("fails closed on a count that is not a whole number", async () => {
    calls.count_eligible_invitation_recipients = [-1]

    await expect(adapter().invitationAudience(landing, JOB)).rejects.toBeInstanceOf(MarketplaceStoreError)
  })
})

describe("invitationRecipients", () => {
  it("lists eligible businesses with public fields only", async () => {
    calls.list_invitation_recipients = [recipientRow(), recipientRow({ org_id: HAULER_B, verified: true, verified_at: "2026-10-02T10:00:00+00:00" })]

    expect(await adapter().invitationRecipients(landing, JOB)).toEqual([
      { availabilityReportedAt: "2026-11-10T06:00:00.000Z", businessName: "Ridge Haulers", equipment: [{ label: "Log truck", units: 3 }], homeBase: "Lebanon, OR", organizationId: HAULER_A, verification: null },
      { availabilityReportedAt: "2026-11-10T06:00:00.000Z", businessName: "Ridge Haulers", equipment: [{ label: "Log truck", units: 3 }], homeBase: "Lebanon, OR", organizationId: HAULER_B, verification: { reviewedOn: "2026-10-02", scope: "business_identity" } }
    ])
    expect(storeCalls("list_invitation_recipients")[0]?.args).toEqual({ p_job_id: JOB, p_radius_miles: MARKETPLACE_INVITATION_RADIUS_MILES })
  })

  it("refuses another business's job without listing anyone", async () => {
    calls.get_marketplace_job = [jobRow({ poster_organization_id: OTHER_ORG })]

    await expect(adapter().invitationRecipients(landing, JOB)).rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect(storeCalls("list_invitation_recipients")).toEqual([])
  })

  it("never shows a hauler's phone or contact before the landing replies: a row carrying one fails closed", () => {
    for (const extra of [{ phone: "+15415550100" }, { contact_phone: "5415550100" }, { email: "ridge@example.com" }]) {
      expect(() => recipientFromRow(recipientRow(extra))).toThrow(MarketplaceStoreError)
    }
  })
})

describe("sendTargetedInvitations: balance edges", () => {
  it("refuses at 0 left (the allowance used to its cap) with the reset date, and reserves nothing", async () => {
    calls.get_org_entitlement_state = [entitlementRow(0)]

    await expect(adapter().sendTargetedInvitations(landing, send([HAULER_A]))).rejects.toMatchObject({
      code: "23514",
      message: "You've used all 3 targeted invitations this cycle. They reset on Dec 1, 2026. Replies and job posts stay unlimited."
    })
    expect(storeCalls("reserve_targeted_invitation")).toEqual([])
  })

  it("refuses without a plan", async () => {
    calls.get_org_entitlement_state = [entitlementRow(null, { period_end: null, plan_code: null, subscription_status: null })]

    await expect(adapter().sendTargetedInvitations(landing, send([HAULER_A]))).rejects.toMatchObject({ code: "23514" })
    expect(storeCalls("reserve_targeted_invitation")).toEqual([])
  })

  it("refuses while over a cap with the read model's resolution sentence", async () => {
    calls.get_org_entitlement_state = [entitlementRow(2, { active_landings: 2, landing_conflict: true })]

    await expect(adapter().sendTargetedInvitations(landing, send([HAULER_A]))).rejects.toMatchObject({
      message: "2 landings are recruiting and your Basic plan allows 1. Pause 1 of them to publish jobs and send invitations again."
    })
    expect(storeCalls("reserve_targeted_invitation")).toEqual([])
  })

  it("sends 1 of 1 left, and refuses 2 before reserving either", async () => {
    calls.get_org_entitlement_state = [entitlementRow(1)]
    calls.reserve_targeted_invitation = reservations(INV_1)

    await expect(adapter().sendTargetedInvitations(landing, send([HAULER_A, HAULER_B]))).rejects.toMatchObject({
      message: "You have 1 targeted invitation left this cycle. Choose 1 business or fewer."
    })
    expect(storeCalls("reserve_targeted_invitation")).toEqual([])

    let read = 0
    calls.get_org_entitlement_state = () => [entitlementRow(read++ === 0 ? 1 : 0)]

    expect(await adapter().sendTargetedInvitations(landing, send([HAULER_A]))).toEqual({
      invitationsRemaining: 0,
      refused: [],
      reserved: [{ invitationId: INV_1, recipientOrganizationId: HAULER_A }]
    })
  })

  it("sends the whole allowance at once, each reservation in its own transaction, with the note and no dedupe override", async () => {
    const perCycle = LANDING_PLANS.basic.targetedInvitationsPerCycle
    let read = 0
    calls.get_org_entitlement_state = () => [entitlementRow(read++ === 0 ? perCycle : 0)]
    calls.reserve_targeted_invitation = reservations(INV_1, INV_2, INV_3)

    const receipt = await adapter().sendTargetedInvitations(landing, send([HAULER_A, HAULER_B, HAULER_C]))

    expect(receipt).toEqual({
      invitationsRemaining: 0,
      refused: [],
      reserved: [
        { invitationId: INV_1, recipientOrganizationId: HAULER_A },
        { invitationId: INV_2, recipientOrganizationId: HAULER_B },
        { invitationId: INV_3, recipientOrganizationId: HAULER_C }
      ]
    })
    expect(storeCalls("reserve_targeted_invitation")).toEqual([HAULER_A, HAULER_B, HAULER_C].map((recipient) => ({
      args: { p_job_id: JOB, p_note: "Two trucks Monday", p_recipient_org_id: recipient },
      kind: "call",
      name: "reserve_targeted_invitation",
      readOnly: false
    })))
  })
})

describe("sendTargetedInvitations: dedupe and retries", () => {
  it("invites a business chosen twice only once", async () => {
    calls.reserve_targeted_invitation = reservations(INV_1)

    const receipt = await adapter().sendTargetedInvitations(landing, send([HAULER_A, HAULER_A.toUpperCase()]))

    expect(receipt.reserved).toEqual([{ invitationId: INV_1, recipientOrganizationId: HAULER_A }])
    expect(storeCalls("reserve_targeted_invitation")).toHaveLength(1)
  })

  it("gives a retried request the same receipt and reserves nothing twice, even once the balance is spent", async () => {
    calls.get_org_entitlement_state = [entitlementRow(0)]
    queries.invite_sent = [sentRow(), sentRow({ id: INV_2, recipient_org_id: HAULER_B, status: "delivered", delivered_at: "2026-11-11T17:59:30+00:00" })]

    expect(await adapter().sendTargetedInvitations(landing, send([HAULER_A, HAULER_B]))).toEqual({
      invitationsRemaining: 0,
      refused: [],
      reserved: [
        { invitationId: INV_1, recipientOrganizationId: HAULER_A },
        { invitationId: INV_2, recipientOrganizationId: HAULER_B }
      ]
    })
    expect(storeCalls("reserve_targeted_invitation")).toEqual([])
    expect(storeCalls("invite_sent")).toEqual([{ args: [ORG, JOB], kind: "query", name: "invite_sent", readOnly: true }])
  })

  it("refuses a business a colleague's reservation still holds for this job", async () => {
    queries.invite_sent = [sentRow({ sent_by_viewer: false })]
    calls.reserve_targeted_invitation = reservations(INV_2)
    let read = 0
    calls.get_org_entitlement_state = () => [entitlementRow(read++ === 0 ? 3 : 2)]

    expect(await adapter().sendTargetedInvitations(landing, send([HAULER_A, HAULER_B]))).toEqual({
      invitationsRemaining: 2,
      refused: [{ reason: "Already invited for this job.", recipientOrganizationId: HAULER_A }],
      reserved: [{ invitationId: INV_2, recipientOrganizationId: HAULER_B }]
    })
  })

  it("reports each store refusal against its own recipient and keeps going", async () => {
    calls.reserve_targeted_invitation = reservations(INV_3)
    failures.reserve_targeted_invitation = [
      postgresError("recipient organization is not currently eligible or opted in for this job", "23514"),
      postgresError("duplicate key value violates unique constraint \"targeted_invitations_reserved_uq\"", "23505")
    ]

    const receipt = await adapter().sendTargetedInvitations(landing, send([HAULER_A, HAULER_B, HAULER_C]))

    expect(receipt.refused).toEqual([
      { reason: "Not eligible right now: already invited recently, opted out, or at their weekly limit.", recipientOrganizationId: HAULER_A },
      { reason: "Already invited for this job.", recipientOrganizationId: HAULER_B }
    ])
    expect(receipt.reserved).toEqual([{ invitationId: INV_3, recipientOrganizationId: HAULER_C }])
  })

  it("stops when a concurrent sender spends the last invitation, refusing the rest without asking the store", async () => {
    let reserveCount = 0
    calls.reserve_targeted_invitation = () => {
      reserveCount += 1
      if (reserveCount === 2) throw postgresError("monthly targeted invitation allowance exhausted (no overage or rollover)", "23514")
      return [INV_1]
    }

    const receipt = await adapter().sendTargetedInvitations(landing, send([HAULER_A, HAULER_B, HAULER_C]))

    expect(receipt.reserved).toEqual([{ invitationId: INV_1, recipientOrganizationId: HAULER_A }])
    expect(receipt.refused).toEqual([
      { reason: "No invitations left this cycle.", recipientOrganizationId: HAULER_B },
      { reason: "No invitations left this cycle.", recipientOrganizationId: HAULER_C }
    ])
    expect(storeCalls("reserve_targeted_invitation")).toHaveLength(2)
  })

  it("refuses the whole send for a refusal about the job or the sender before anything is reserved", async () => {
    failures.reserve_targeted_invitation = [postgresError("job posting must be active to send invitations", "23514")]

    await expect(adapter().sendTargetedInvitations(landing, send([HAULER_A, HAULER_B]))).rejects.toMatchObject({
      message: "This job isn't open, so invitations can't be sent for it. Put it back on the marketplace first."
    })
    expect(storeCalls("reserve_targeted_invitation")).toHaveLength(1)
  })

  it("never invites the sending business itself", async () => {
    calls.reserve_targeted_invitation = reservations(INV_1)

    const receipt = await adapter().sendTargetedInvitations(landing, send([ORG, HAULER_A]))

    expect(receipt.refused).toEqual([{ reason: "You can't invite your own business.", recipientOrganizationId: ORG }])
    expect(storeCalls("reserve_targeted_invitation").map((entry) => (entry.args as Record<string, unknown>).p_recipient_org_id)).toEqual([HAULER_A])
  })

  it("falls back to the balance it read when the re-read fails after reserving", async () => {
    let read = 0
    calls.get_org_entitlement_state = () => {
      if (read++ === 0) return [entitlementRow(3)]
      throw postgresError("connection reset", "08006")
    }
    calls.reserve_targeted_invitation = reservations(INV_1)

    expect((await adapter().sendTargetedInvitations(landing, send([HAULER_A]))).invitationsRemaining).toBe(2)
  })
})

describe("sendTargetedInvitations: scope", () => {
  it("refuses another business's job and reserves nothing from either allowance (cross-tenant)", async () => {
    calls.get_marketplace_job = [jobRow({ poster_organization_id: OTHER_ORG })]

    await expect(adapter().sendTargetedInvitations(landing, send([HAULER_A]))).rejects.toMatchObject({ code: "P0002" })
    expect(storeCalls("reserve_targeted_invitation")).toEqual([])
    expect(storeCalls("get_org_entitlement_state")).toEqual([])
  })

  it("reads the balance of the active business only", async () => {
    calls.reserve_targeted_invitation = reservations(INV_1)

    await adapter().sendTargetedInvitations(landing, send([HAULER_A]))

    expect(storeCalls("get_org_entitlement_state").map((entry) => entry.args)).toEqual([{ p_org_id: ORG }, { p_org_id: ORG }])
  })

  it("refuses a malformed send before any store call", async () => {
    for (const input of [send([]), send(["not-a-uuid"]), send([HAULER_A], { requestId: undefined }), send([HAULER_A], { asOrganization: OTHER_ORG })]) {
      recorded = []
      await expect(adapter().sendTargetedInvitations(landing, input)).rejects.toMatchObject({ code: "22023" })
      expect(recorded).toEqual([])
    }
  })
})

describe("sentInvitations", () => {
  it("lists the business's invitations, for one job or all, with what each did to the allowance", async () => {
    queries.invite_sent = [
      sentRow({ delivered_at: "2026-11-11T17:59:30+00:00", recipient_response: "interested", responded_at: "2026-11-11T18:30:00+00:00", status: "delivered" }),
      sentRow({ id: INV_2, recipient_name: null, recipient_org_id: HAULER_B, sent_by_name: null, status: "failed" })
    ]

    const sent = await adapter().sentInvitations(landing, null)

    expect(sent).toEqual([
      {
        allowance: "used",
        createdAt: "2026-11-11T17:59:00.000Z",
        deliveredAt: "2026-11-11T17:59:30.000Z",
        id: INV_1,
        jobId: JOB,
        note: "Two trucks Monday",
        recipient: { name: "Ridge Haulers", organizationId: HAULER_A },
        respondedAt: "2026-11-11T18:30:00.000Z",
        response: "interested",
        sentBy: { name: "Dana Foreman", userId: SENDER_USER },
        status: "delivered"
      },
      expect.objectContaining({
        allowance: "returned",
        recipient: { name: "A hauling business", organizationId: HAULER_B },
        sentBy: { name: "A former team member", userId: SENDER_USER }
      })
    ])
    expect(storeCalls("invite_sent")).toEqual([{ args: [ORG, null], kind: "query", name: "invite_sent", readOnly: true }])

    await adapter().sentInvitations(landing, JOB)
    expect(storeCalls("invite_sent")[1]?.args).toEqual([ORG, JOB])
  })

  it("refuses a malformed job id, and fails closed on a row carrying contact details", async () => {
    await expect(adapter().sentInvitations(landing, "job-1")).rejects.toMatchObject({ code: "22023" })
    expect(() => sentInvitationFromRow(sentRow({ recipient_phone: "5415550100" }))).toThrow(MarketplaceStoreError)
  })
})

describe("receivedInvitations", () => {
  it("shows the hauling business its delivered invitations, with the public job and the sender", async () => {
    queries.invite_received = [receivedRow()]

    const [invitation] = await adapter().receivedInvitations(hauler)

    expect(invitation).toMatchObject({
      deliveredAt: "2026-11-11T17:00:00.000Z",
      id: INV_1,
      note: "Two trucks Monday",
      response: "none",
      sender: { name: "Cedar Landing", organizationId: ORG, verification: { reviewedOn: "2026-10-02", scope: "business_identity" } }
    })
    expect(invitation?.job).toMatchObject({ acceptingInterest: true, id: JOB, posterOrganizationId: ORG, title: "Fir haul" })
    expect(storeCalls("invite_received")).toEqual([{ args: [HAULER_A], kind: "query", name: "invite_received", readOnly: true }])
  })

  it("keeps a stopped job in the inbox as no longer accepting interest", async () => {
    queries.invite_received = [receivedRow({ job: jobRow({ accepting_interest: false, status: "closed" }) })]

    expect((await adapter().receivedInvitations(hauler))[0]?.job).toMatchObject({ acceptingInterest: false, status: "closed" })
  })

  it("fails closed when the job is not the sender's, or a row carries private landing details", () => {
    expect(() => receivedInvitationFromRow(receivedRow({ sender_org_id: OTHER_ORG }))).toThrow(MarketplaceStoreError)
    expect(() => receivedInvitationFromRow(receivedRow({ site_contact_phone: "5415550100" }))).toThrow(MarketplaceStoreError)
    expect(() => receivedInvitationFromRow(receivedRow({ job: { ...jobRow(), site_contact_phone: "5415550100" } }))).not.toThrow()
    expect(Object.keys(receivedInvitationFromRow(receivedRow({ job: { ...jobRow(), site_contact_phone: "5415550100" } })).job)).not.toContain("siteContactPhone")
  })
})

describe("respondToInvitation", () => {
  it("records Interested once for a delivered invitation addressed to the business", async () => {
    queries.invite_received_one = [{ id: INV_1, recipient_response: "viewed" }]

    await adapter().respondToInvitation(hauler, { invitationId: INV_1, response: "interested" })

    expect(storeCalls("invite_received_one")).toEqual([{ args: [HAULER_A, INV_1], kind: "query", name: "invite_received_one", readOnly: false }])
    expect(storeCalls("respond_to_invitation")).toEqual([
      { args: { p_invitation_id: INV_1, p_response: "interested" }, kind: "call", name: "respond_to_invitation", readOnly: false }
    ])
  })

  it("records Not now as declined", async () => {
    queries.invite_received_one = [{ id: INV_1, recipient_response: "none" }]

    await adapter().respondToInvitation(hauler, { invitationId: INV_1, response: "declined" })

    expect(storeCalls("respond_to_invitation")[0]?.args).toEqual({ p_invitation_id: INV_1, p_response: "declined" })
  })

  it("treats a retried answer as done without writing again", async () => {
    queries.invite_received_one = [{ id: INV_1, recipient_response: "interested" }]

    await adapter().respondToInvitation(hauler, { invitationId: INV_1, response: "interested" })

    expect(storeCalls("respond_to_invitation")).toEqual([])
  })

  it("refuses to change an answer", async () => {
    queries.invite_received_one = [{ id: INV_1, recipient_response: "declined" }]

    await expect(adapter().respondToInvitation(hauler, { invitationId: INV_1, response: "interested" })).rejects.toMatchObject({ code: "23514" })
    expect(storeCalls("respond_to_invitation")).toEqual([])
  })

  it("refuses an invitation it did not list as delivered to this business (cross-tenant, or still reserved)", async () => {
    queries.invite_received_one = []

    await expect(adapter().respondToInvitation(landing, { invitationId: INV_1, response: "interested" })).rejects.toMatchObject({
      code: "P0002",
      message: "That invitation was not found."
    })
    expect(storeCalls("invite_received_one")[0]?.args).toEqual([ORG, INV_1])
    expect(storeCalls("respond_to_invitation")).toEqual([])
  })

  it("never touches the allowance: an answer runs no reservation, delivery or balance function", async () => {
    queries.invite_received_one = [{ id: INV_1, recipient_response: "none" }]

    await adapter().respondToInvitation(hauler, { invitationId: INV_1, response: "declined" })

    expect(recorded.map((entry) => entry.name)).toEqual(["invite_received_one", "respond_to_invitation"])
  })

  it("refuses a malformed answer before any store call", async () => {
    for (const input of [{ invitationId: INV_1, response: "hired" }, { invitationId: "inv", response: "interested" }, null]) {
      recorded = []
      await expect(adapter().respondToInvitation(hauler, input)).rejects.toMatchObject({ code: "22023" })
      expect(recorded).toEqual([])
    }
  })
})
