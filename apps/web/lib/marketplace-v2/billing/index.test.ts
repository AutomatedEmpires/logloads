import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { MARKETPLACE_FOUNDING_OFFER_PROGRAM, MARKETPLACE_FOUNDING_OFFER_STATUSES } from "@logloads/contracts"

import type { NormalizedFeatureContext } from "../normalized-adapter"
import type { MarketplaceCalls } from "../normalized-db"
import { MARKETPLACE_QUERIES, marketplaceQueryStatement } from "../normalized-queries"
import { MarketplaceRefusalError, MarketplaceStoreError, type MarketplaceV2Viewer } from "../port"
import { FOUNDING_OFFER_OWNER_ONLY, foundingOfferFromRow, normalizedBilling } from "./index"

/**
 * The founding-offer read (#248, #306): one `promotion_redemptions` row of the founding program, left-joined to its
 * promotion, as the `founding_offer` statement returns it (`to_jsonb`), and the method that reads it as the viewer.
 * The plan read (`planAllowanceFromRow`) is covered in normalized-adapter-port-v3.test.ts.
 */

const ORG = "33333333-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const viewer: MarketplaceV2Viewer = { organizationId: ORG, userId: "user_test" }

interface Recorded { kind: "call" | "query" | "transaction"; name?: string; values?: unknown; readOnly?: boolean }

/** The group's methods over a recording fake: `access` is the viewer's access row, `offers` the statement's rows. */
function billing(access: unknown[], offers: unknown[]) {
  const recorded: Recorded[] = []
  const calls = {
    async call(fn: string, args: unknown) {
      recorded.push({ kind: "call", name: fn, values: args })
      return fn === "get_viewer_marketplace_access" ? access : []
    },
    async query(name: string, values: unknown) {
      recorded.push({ kind: "query", name, values })
      return offers
    }
  } as unknown as MarketplaceCalls
  const context = {
    asAccount: async () => {
      throw new Error("not used")
    },
    asViewer: async (_viewer: MarketplaceV2Viewer, work: (given: MarketplaceCalls) => Promise<unknown>, options: { readOnly: boolean }) => {
      recorded.push({ kind: "transaction", readOnly: options.readOnly })
      return work(calls)
    },
    now: () => new Date("2026-11-11T12:00:00.000Z")
  } as unknown as NormalizedFeatureContext

  return { port: normalizedBilling.methods(context), recorded }
}

const accessRow = (role: string) => ({
  capabilities: [],
  hauler_profile: false,
  landing_workspace_seat: role !== "driver",
  organization_id: ORG,
  organization_name: "Adapter Timber",
  role
})

function redemptionRow(overrides: Record<string, unknown> = {}) {
  return {
    billing_cycles: 6,
    cycles_applied: 2,
    granted_at: "2026-11-02T15:00:00.25+00:00",
    percent_off: 50.0,
    state_code: "OR",
    status: "applied",
    ...overrides
  }
}

describe("founding offer read model (billing #248)", () => {
  it("maps the redemption and the promotion's own terms", () => {
    expect(foundingOfferFromRow(redemptionRow())).toEqual({
      cyclesApplied: 2,
      grantedAt: "2026-11-02T15:00:00.250Z",
      status: "applied",
      terms: { billingCycles: 6, percentOff: 50, stateCode: "OR" }
    })
  })

  it("keeps every recorded status, revoked included, instead of hiding the offer", () => {
    for (const status of MARKETPLACE_FOUNDING_OFFER_STATUSES) {
      expect(foundingOfferFromRow(redemptionRow({ status })).status).toBe(status)
    }
  })

  it("reads a percentage to two decimals, as a JSON number or a numeric string", () => {
    expect(foundingOfferFromRow(redemptionRow({ percent_off: 33.33 })).terms?.percentOff).toBe(33.33)
    expect(foundingOfferFromRow(redemptionRow({ percent_off: "12.50" })).terms?.percentOff).toBe(12.5)
    expect(foundingOfferFromRow(redemptionRow({ percent_off: 100 })).terms?.percentOff).toBe(100)
  })

  it("keeps an offer without a launched state", () => {
    expect(foundingOfferFromRow(redemptionRow({ state_code: null })).terms).toEqual({ billingCycles: 6, percentOff: 50, stateCode: null })
  })

  it("says the terms are unknown when row-level security hides a closed promotion, and guesses none", () => {
    const view = foundingOfferFromRow(redemptionRow({ billing_cycles: null, percent_off: null, state_code: null }))

    expect(view).toEqual({ cyclesApplied: 2, grantedAt: "2026-11-02T15:00:00.250Z", status: "applied", terms: null })
  })

  it.each([
    ["an unknown status", { status: "pending" }],
    ["negative cycles", { cycles_applied: -1 }],
    ["fractional cycles", { cycles_applied: 1.5 }],
    ["no grant time", { granted_at: null }],
    ["an unreadable grant time", { granted_at: "soon" }],
    ["a zero percentage", { percent_off: 0 }],
    ["a percentage over 100", { percent_off: 100.01 }],
    ["a non-numeric percentage", { percent_off: "half" }],
    ["too many billing cycles", { billing_cycles: 37 }],
    ["a malformed state", { state_code: "Oregon" }],
    ["half of the promotion's terms", { billing_cycles: null }],
    ["a state without terms", { billing_cycles: null, percent_off: null }]
  ])("fails loudly on %s (a drift between the SQL and this adapter)", (_label, overrides) => {
    expect(() => foundingOfferFromRow(redemptionRow(overrides))).toThrow(MarketplaceStoreError)
  })

  it("keeps the drift's detail out of the message shown to people", () => {
    const error = (() => {
      try {
        foundingOfferFromRow(redemptionRow({ status: "pending" }))
      } catch (caught) {
        return caught as MarketplaceStoreError
      }
      return null
    })()

    expect(error?.message).toBe(new MarketplaceStoreError().message)
    expect(error?.code).toBe("22000")
  })

})

describe("foundingOffer through the founding_offer statement (billing #306)", () => {
  it("reads the active business's offer as its owner, in one read-only transaction", async () => {
    const { port, recorded } = billing([accessRow("owner")], [redemptionRow()])

    await expect(port.foundingOffer(viewer)).resolves.toEqual({
      cyclesApplied: 2,
      grantedAt: "2026-11-02T15:00:00.250Z",
      status: "applied",
      terms: { billingCycles: 6, percentOff: 50, stateCode: "OR" }
    })
    expect(recorded).toEqual([
      { kind: "transaction", readOnly: true },
      { kind: "call", name: "get_viewer_marketplace_access", values: { p_org_id: ORG } },
      { kind: "query", name: "founding_offer", values: [ORG] }
    ])
  })

  it("is null for an owner whose business has no founding offer", async () => {
    await expect(billing([accessRow("owner")], []).port.foundingOffer(viewer)).resolves.toBeNull()
  })

  it.each(["manager", "staff", "driver"])("refuses a %s instead of saying there is no offer, and never reads it", async (role) => {
    const { port, recorded } = billing([accessRow(role)], [redemptionRow()])
    const outcome = await port.foundingOffer(viewer).catch((error: unknown) => error)

    expect(outcome).toBeInstanceOf(MarketplaceRefusalError)
    expect(outcome).toMatchObject({ code: "42501", message: FOUNDING_OFFER_OWNER_ONLY })
    expect(recorded.some((entry) => entry.kind === "query")).toBe(false)
  })

  it("refuses a person who is not a member of the active business, and never reads it", async () => {
    const { port, recorded } = billing([], [redemptionRow()])

    await expect(port.foundingOffer(viewer)).rejects.toMatchObject({ code: "42501" })
    expect(recorded.some((entry) => entry.kind === "query")).toBe(false)
  })

  it("fails loudly on a row that drifted from the SQL", async () => {
    await expect(billing([accessRow("owner")], [redemptionRow({ status: "pending" })]).port.foundingOffer(viewer))
      .rejects.toBeInstanceOf(MarketplaceStoreError)
  })

  it("is a catalogued owner-only statement of the founding program, bound to the active business", () => {
    const { text } = MARKETPLACE_QUERIES.founding_offer

    expect(marketplaceQueryStatement("founding_offer", [ORG])).toEqual({ text, values: [ORG] })
    expect(() => marketplaceQueryStatement("founding_offer", ["not-a-uuid"])).toThrow(TypeError)
    expect(text).toContain(`pr.program = '${MARKETPLACE_FOUNDING_OFFER_PROGRAM}'`)
    expect(text).toContain("pr.org_id = $1::text::uuid")
    expect(text).toContain("marketplace.has_org_role(pr.org_id, array['owner']::text[])")
    // Only columns the M2 grant (16) lets `authenticated` read; never who granted it.
    expect(text).not.toMatch(/granted_by|provider_coupon_ref/)
  })

  it("turns the group on: every method works", () => {
    expect(normalizedBilling.supported).toBe(true)
  })
})
