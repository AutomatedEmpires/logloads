import { readFileSync } from "node:fs"

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { MARKETPLACE_V2_FEATURES, marketplaceV2FeatureSupport } from "@logloads/contracts"

import { planAllowanceFromRow } from "./billing"
import { createNormalizedMarketplaceV2, type NormalizedFeature, type NormalizedFeatureContext } from "./normalized-adapter"
import type { MarketplaceCalls, MarketplaceDb, MarketplaceFunctionName, MarketplacePrincipal } from "./normalized-db"
import {
  MARKETPLACE_V2_FEATURE_OPERATIONS,
  MarketplaceFeatureUnavailableError,
  MarketplaceOperationUnavailableError,
  MarketplaceRefusalError,
  MarketplaceStoreError,
  marketplaceV2FeatureMethods,
  unavailableMarketplaceV2Feature,
  type MarketplaceV2Viewer
} from "./port"

/**
 * The normalized adapter's port v3 surface (#244) over a recording fake of the store. Every group comes from its own
 * folder (`./<group>/index.ts`) and refuses until its task lands, without reaching the store; the plan read model is
 * already mapped through `get_org_entitlement_state`; feature capabilities come from the access row's membership.
 * The database's own behaviour is proven against PostgreSQL in CI by `normalized-adapter.contract.test.ts`.
 */

const ORG = "33333333-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const USER = "55555555-dddd-4ddd-8ddd-dddddddddddd"
const PRINCIPAL: MarketplacePrincipal = { audience: "logloads-test-audience", issuer: "https://clerk.logloads.test", subject: "user_test_subject" }
const viewer: MarketplaceV2Viewer = { organizationId: ORG, userId: USER }

interface Recorded { session: "anon" | "user"; readOnly?: boolean; fn: string; args: Record<string, unknown> }

let recorded: Recorded[]
let responses: Partial<Record<MarketplaceFunctionName, unknown[]>>
let principal: ReturnType<typeof vi.fn>

function fakeDb(): MarketplaceDb {
  const calls = (session: Recorded["session"], readOnly?: boolean): MarketplaceCalls => ({
    async call(fn, args) {
      recorded.push({ args: args as Record<string, unknown>, fn, readOnly, session })
      return responses[fn] ?? []
    },
    fileListingReport: async () => {
      throw new Error("not used")
    },
    inquiryJobs: async () => [],
    inquiryParties: async () => null,
    landingStatement: async () => [],
    query: async () => [],
    standingListingReport: async () => null,
    viewerSession: async () => ({ memberships: [], person: null })
  })

  return {
    asAnon: async (work) => work(calls("anon")),
    asUser: async (_principal, work, options) => work(calls("user", options?.readOnly)),
    close: async () => undefined
  }
}

function adapter(features?: Parameters<typeof createNormalizedMarketplaceV2>[0]["features"]) {
  return createNormalizedMarketplaceV2({ db: fakeDb(), features, now: () => new Date("2026-11-10T12:00:00.000Z"), principal: principal as never })
}

function entitlementRow(overrides: Record<string, unknown> = {}) {
  return {
    active_landings: 2,
    fleet_only_members: 1,
    grace_ends_at: null,
    invitations_remaining: 7,
    landing_conflict: false,
    max_active_landings: 3,
    max_team_members: 5,
    paid_landing_seats: 4,
    period_end: "2026-12-01T00:00:00+00:00",
    plan_code: "pro",
    seat_conflict: false,
    subscription_status: "active",
    ...overrides
  }
}

function accessRow(overrides: Record<string, unknown> = {}) {
  return {
    capabilities: ["job.publish", "landing.manage", "inquiry.respond", "not.a.capability"],
    hauler_profile: false,
    landing_workspace_seat: true,
    organization_id: ORG,
    organization_name: "Adapter Timber",
    role: "owner",
    ...overrides
  }
}

beforeEach(() => {
  recorded = []
  responses = {}
  principal = vi.fn(async () => PRINCIPAL)
})

describe("normalized adapter: port v3 groups (#244)", () => {
  it("supports only the groups whose every method works (alerts #316, billing #306, jobs #247), and every group has methods", () => {
    expect(adapter().supports).toEqual(marketplaceV2FeatureSupport(["alerts", "billing", "jobs"]))

    for (const feature of MARKETPLACE_V2_FEATURES) {
      expect(marketplaceV2FeatureMethods(feature).length, feature).toBeGreaterThan(0)
    }
  })

  it("refuses every not-yet-built method as unavailable, naming the operation and its group, without reaching the store", async () => {
    const port = adapter()
    const unbuilt = MARKETPLACE_V2_FEATURES.filter((feature) => !port.supports[feature])
    let refused = 0

    for (const feature of unbuilt) {
      const operations: Readonly<Record<string, string>> = MARKETPLACE_V2_FEATURE_OPERATIONS[feature]

      for (const method of marketplaceV2FeatureMethods(feature)) {
        const call = port[method] as (...values: unknown[]) => Promise<unknown>
        const outcome = await call(viewer, "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {}).then(() => null, (error: unknown) => error)

        expect(outcome, method).toBeInstanceOf(MarketplaceFeatureUnavailableError)
        // Every page that handles an unavailable operation handles these too.
        expect(outcome, method).toBeInstanceOf(MarketplaceOperationUnavailableError)
        expect((outcome as MarketplaceFeatureUnavailableError).feature).toBe(feature)
        expect((outcome as Error).message).toBe(`${operations[method]} is not available yet`)
        refused += 1
      }
    }

    // 51 methods in nine groups; alerts' eight, billing's two and jobs' six work.
    expect(unbuilt).not.toContain("alerts")
    expect(refused).toBe(unbuilt.reduce((count, feature) => count + marketplaceV2FeatureMethods(feature).length, 0))
    expect(refused).toBe(35)
    expect(recorded).toEqual([])
    expect(principal).not.toHaveBeenCalled()
  })

  it("turns a group on only when its entry module says every method works", () => {
    const team: NormalizedFeature<"team"> = { methods: () => unavailableMarketplaceV2Feature("team"), supported: true }

    expect(adapter({ team }).supports).toEqual({ ...adapter().supports, team: true })
    expect(adapter().supports.team).toBe(false)
  })

  it("never lets a group replace a method the adapter already defines", async () => {
    const hijack = {
      methods: () => ({ ...unavailableMarketplaceV2Feature("boosts"), viewerAccess: async () => ({ capabilities: ["landing.manage"] }) }),
      supported: false
    } as unknown as NormalizedFeature<"boosts">
    responses.get_viewer_marketplace_access = [accessRow({ capabilities: [], role: "staff" })]

    expect((await adapter({ boosts: hijack }).viewerAccess(viewer)).capabilities).toEqual([])
  })

  it("gives a group the adapter's own identity-bound transactions, for a business or for the person alone", async () => {
    let context: NormalizedFeatureContext | null = null
    const admin: NormalizedFeature<"admin"> = {
      methods: (given) => {
        context = given
        return unavailableMarketplaceV2Feature("admin")
      },
      supported: false
    }

    adapter({ admin })
    const bound = context as unknown as NormalizedFeatureContext

    await bound.asAccount({ userId: USER }, (calls) => calls.call("get_marketplace_job", { p_job_id: "job" }), { readOnly: true })
    expect(principal).toHaveBeenLastCalledWith({ organizationId: "", userId: USER })
    expect(recorded.at(-1)).toMatchObject({ readOnly: true, session: "user" })

    await expect(bound.asAccount({ userId: "" }, async () => "ran", { readOnly: true })).rejects.toBeInstanceOf(MarketplaceRefusalError)
    await expect(bound.asViewer({ organizationId: "not-a-uuid", userId: USER }, async () => "ran", { readOnly: true }))
      .rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect(bound.now().toISOString()).toBe("2026-11-10T12:00:00.000Z")
  })

  it("wires every group from its own folder, so a group's task changes nothing shared", () => {
    const source = readFileSync(new URL("./normalized-adapter.ts", import.meta.url), "utf8")

    for (const feature of MARKETPLACE_V2_FEATURES) {
      expect(source, feature).toContain(`from "./${feature}"`)
      expect(source, feature).toContain(`...groups.${feature}.methods(context)`)
    }

    expect(source).not.toContain("unavailableMarketplaceV2Feature")
  })
})

describe("normalized adapter: plan and allowance read model (billing #248)", () => {
  it("reads get_org_entitlement_state as the viewer, read-only, for the active business", async () => {
    responses.get_org_entitlement_state = [entitlementRow({ grace_ends_at: "2026-11-20T08:30:00.5+00:00" })]

    await expect(adapter().planAllowance(viewer)).resolves.toEqual({
      activeLandings: 2,
      cycleEndsAt: "2026-12-01T00:00:00.000Z",
      fleetOnlyMembers: 1,
      graceEndsAt: "2026-11-20T08:30:00.500Z",
      invitationsRemaining: 7,
      landingsOverCap: false,
      planCode: "pro",
      seatsOverCap: false,
      subscriptionStatus: "active",
      teamMembers: 4
    })
    expect(recorded).toEqual([{ args: { p_org_id: ORG }, fn: "get_org_entitlement_state", readOnly: true, session: "user" }])
  })

  it("states over-cap conflicts and the lack of a plan as the store records them, never the store's limits", () => {
    const view = planAllowanceFromRow(entitlementRow({ landing_conflict: true, plan_code: null, seat_conflict: true, subscription_status: null }))

    expect(view).toMatchObject({ cycleEndsAt: null, invitationsRemaining: null, landingsOverCap: true, planCode: null, seatsOverCap: true, subscriptionStatus: null })
    expect(view).not.toHaveProperty("max_active_landings")
    expect(view).not.toHaveProperty("maxTeamMembers")
  })

  it.each(["paused", "unpaid"])("reads a %s subscription (stored since stage 12, LE-04), which entitles no plan", (status) => {
    const view = planAllowanceFromRow(entitlementRow({ period_end: null, plan_code: null, subscription_status: status }))

    expect(view).toMatchObject({ cycleEndsAt: null, invitationsRemaining: null, planCode: null, subscriptionStatus: status })
  })

  it("fails loudly on a row that drifted from the SQL, and on a missing row", async () => {
    // 12 stores `incomplete_expired` as `canceled`, and `get_org_entitlement_state` never returns a cancelled one.
    expect(() => planAllowanceFromRow(entitlementRow({ subscription_status: "incomplete_expired" }))).toThrow(MarketplaceStoreError)
    expect(() => planAllowanceFromRow(entitlementRow({ seat_conflict: null }))).toThrow(MarketplaceStoreError)
    expect(() => planAllowanceFromRow(entitlementRow({ grace_ends_at: "soon" }))).toThrow(MarketplaceStoreError)

    await expect(adapter().planAllowance(viewer)).rejects.toBeInstanceOf(MarketplaceStoreError)
  })

  it("refuses a malformed viewer before reaching the store", async () => {
    await expect(adapter().planAllowance({ organizationId: "nope", userId: USER })).rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect(recorded).toEqual([])
  })
})

describe("normalized adapter: feature capabilities (#244)", () => {
  it("derives them from the access row's role, seat and hauler profile, read-only as the viewer", async () => {
    responses.get_viewer_marketplace_access = [accessRow()]

    await expect(adapter().viewerFeatureCapabilities(viewer)).resolves
      .toEqual(["team.manage", "invitation.send", "boost.estimate", "truck.search", "alert.manage", "plan.view"])
    expect(recorded).toEqual([{ args: { p_org_id: ORG }, fn: "get_viewer_marketplace_access", readOnly: true, session: "user" }])
    // viewerAccess keeps its shape: the store-reported capabilities only.
    await expect(adapter().viewerAccess(viewer)).resolves
      .toEqual({ capabilities: ["job.publish", "landing.manage", "inquiry.respond"], organizationName: "Adapter Timber" })
  })

  it("gives a hauling business's driver only the hauler-side ones", async () => {
    responses.get_viewer_marketplace_access = [accessRow({ capabilities: ["interest.express"], hauler_profile: true, landing_workspace_seat: false, role: "driver" })]

    expect(await adapter().viewerFeatureCapabilities(viewer)).toEqual(["invitation.respond", "saved_job.manage", "alert.manage", "plan.view"])
  })

  it("grants none for a role the contracts do not know, and refuses a person the store does not know", async () => {
    responses.get_viewer_marketplace_access = [accessRow({ role: "contractor" })]
    expect(await adapter().viewerFeatureCapabilities(viewer)).toEqual([])

    responses.get_viewer_marketplace_access = []
    await expect(adapter().viewerFeatureCapabilities(viewer)).rejects.toBeInstanceOf(MarketplaceRefusalError)
  })
})
