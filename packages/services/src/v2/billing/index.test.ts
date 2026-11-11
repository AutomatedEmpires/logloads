import { describe, expect, it } from "vitest"

import {
  LANDING_PLANS,
  MARKETPLACE_OVER_CAP_BLOCKS,
  MARKETPLACE_PLAN_NOT_PURCHASABLE,
  type LandingPlanCode,
  type MarketplaceFoundingOfferView,
  type MarketplacePlanAllowanceView
} from "@logloads/contracts"

import { marketplaceBillingOverview, marketplaceFoundingOfferSummary, marketplacePlanCaps } from "./index"

/** A Pro business within every cap: 2 of 3 landings, 4 of 5 seats, 7 of 10 invitations left. */
function allowance(overrides: Partial<MarketplacePlanAllowanceView> = {}): MarketplacePlanAllowanceView {
  return {
    activeLandings: 2,
    cycleEndsAt: "2026-12-01T00:00:00.000Z",
    fleetOnlyMembers: 3,
    graceEndsAt: null,
    invitationsRemaining: 7,
    landingsOverCap: false,
    planCode: "pro",
    seatsOverCap: false,
    subscriptionStatus: "active",
    teamMembers: 4,
    ...overrides
  }
}

/** No plan and no subscription: billing isn't active yet. */
const NO_BILLING = allowance({ cycleEndsAt: null, invitationsRemaining: null, planCode: null, subscriptionStatus: null })

function offer(overrides: Partial<MarketplaceFoundingOfferView> = {}): MarketplaceFoundingOfferView {
  return {
    cyclesApplied: 2,
    grantedAt: "2026-11-02T15:00:00.000Z",
    status: "applied",
    terms: { billingCycles: 6, percentOff: 50, stateCode: "OR" },
    ...overrides
  }
}

describe("caps by plan (§2.3, LANDING_PLANS)", () => {
  it.each<[LandingPlanCode, number | null, number, number]>([
    ["basic", 1, 2, 3],
    ["pro", 3, 5, 10],
    ["regional", null, 10, 30]
  ])("%s: %s recruiting landings, %s seats, %s invitations per cycle", (planCode, landings, seats, invitationsPerCycle) => {
    expect(marketplacePlanCaps(planCode)).toEqual({ invitationsPerCycle, landings, planCode, seats })
  })

  it("reads every cap from LANDING_PLANS, never a copy", () => {
    for (const plan of Object.values(LANDING_PLANS)) {
      expect(marketplacePlanCaps(plan.code)).toEqual({
        invitationsPerCycle: plan.targetedInvitationsPerCycle,
        landings: plan.activeLandingLimit,
        planCode: plan.code,
        seats: plan.teamSeatLimit
      })
    }
  })

  it("refuses a plan code the contracts do not define", () => {
    expect(() => marketplacePlanCaps("enterprise" as LandingPlanCode)).toThrow()
  })
})

describe("billing overview: counted caps", () => {
  it("states use against the entitling plan's caps, with the room left", () => {
    const view = marketplaceBillingOverview(allowance())

    expect(view.standing).toBe("entitled")
    expect(view.plan).toBe(LANDING_PLANS.pro)
    expect(view.landings).toEqual({ atCap: false, limit: 3, overCap: false, remaining: 1, unlimited: false, used: 2 })
    expect(view.seats).toEqual({ atCap: false, limit: 5, overCap: false, remaining: 1, unlimited: false, used: 4 })
    expect(view.fleetOnlyMembers).toBe(3)
  })

  it("is at the cap exactly when no room is left (Basic: one landing, two seats)", () => {
    const view = marketplaceBillingOverview(allowance({ activeLandings: 1, invitationsRemaining: 3, planCode: "basic", teamMembers: 2 }))

    expect(view.landings).toEqual({ atCap: true, limit: 1, overCap: false, remaining: 0, unlimited: false, used: 1 })
    expect(view.seats).toEqual({ atCap: true, limit: 2, overCap: false, remaining: 0, unlimited: false, used: 2 })
    expect(view.overCap.overCap).toBe(false)
  })

  it("never caps Regional landings, but still caps its ten seats", () => {
    const view = marketplaceBillingOverview(allowance({ activeLandings: 40, planCode: "regional", teamMembers: 10 }))

    expect(view.landings).toEqual({ atCap: false, limit: null, overCap: false, remaining: null, unlimited: true, used: 40 })
    expect(view.seats).toEqual({ atCap: true, limit: 10, overCap: false, remaining: 0, unlimited: false, used: 10 })
  })

  it("has no limits, room or allowance without a plan, and says so instead of guessing", () => {
    const view = marketplaceBillingOverview(NO_BILLING)

    expect(view.standing).toBe("no_subscription")
    expect(view.plan).toBeNull()
    expect(view.landings).toEqual({ atCap: false, limit: null, overCap: false, remaining: null, unlimited: false, used: 2 })
    expect(view.seats).toEqual({ atCap: false, limit: null, overCap: false, remaining: null, unlimited: false, used: 4 })
    expect(view.invitations).toEqual({ perCycle: null, remaining: null, resetsAt: null, state: "no_plan" })
  })
})

describe("billing overview: invitation balance (§6.2, §9.8)", () => {
  it("shows what is left this cycle, the plan's allowance and when it resets", () => {
    expect(marketplaceBillingOverview(allowance()).invitations).toEqual({
      perCycle: 10,
      remaining: 7,
      resetsAt: "2026-12-01T00:00:00.000Z",
      state: "available"
    })
  })

  it("is exhausted at zero, with the reset date and no negative balance or rollover", () => {
    expect(marketplaceBillingOverview(allowance({ invitationsRemaining: 0, planCode: "basic", activeLandings: 1, teamMembers: 1 })).invitations)
      .toEqual({ perCycle: 3, remaining: 0, resetsAt: "2026-12-01T00:00:00.000Z", state: "exhausted" })
  })

  it("never shows more than the plan's allowance, whatever the store reports", () => {
    expect(marketplaceBillingOverview(allowance({ invitationsRemaining: 99 })).invitations.remaining).toBe(10)
  })

  it("is blocked while the business is over a cap, because the store refuses every send", () => {
    expect(marketplaceBillingOverview(allowance({ seatsOverCap: true, teamMembers: 6 })).invitations.state).toBe("blocked")
    expect(marketplaceBillingOverview(allowance({ activeLandings: 4, landingsOverCap: true })).invitations.state).toBe("blocked")
  })

  it("says exhausted rather than blocked when nothing is left either way", () => {
    expect(marketplaceBillingOverview(allowance({ invitationsRemaining: 0, seatsOverCap: true, teamMembers: 6 })).invitations.state).toBe("exhausted")
  })
})

describe("billing overview: over-cap state (§2.5, §9.15)", () => {
  it("is clear within the plan", () => {
    expect(marketplaceBillingOverview(allowance()).overCap).toEqual({ blocked: [], landings: false, overCap: false, resolutions: [], seats: false })
  })

  it("after a downgrade with too many landings: blocks new landings, publishing and invitations, and says how to resolve it", () => {
    // Regional to Basic with three landings still recruiting.
    const view = marketplaceBillingOverview(allowance({ activeLandings: 3, invitationsRemaining: 3, landingsOverCap: true, planCode: "basic", teamMembers: 2 }))

    expect(view.landings).toEqual({ atCap: true, limit: 1, overCap: true, remaining: 0, unlimited: false, used: 3 })
    expect(view.overCap).toEqual({
      blocked: ["start_landing", "publish_job", "send_invitation"],
      landings: true,
      overCap: true,
      resolutions: ["3 landings are recruiting and your Basic plan allows 1. Pause 2 of them to publish jobs and send invitations again."],
      seats: false
    })
  })

  it("with too many seats: also blocks new seats", () => {
    const view = marketplaceBillingOverview(allowance({ seatsOverCap: true, teamMembers: 7 }))

    expect(view.seats).toEqual({ atCap: true, limit: 5, overCap: true, remaining: 0, unlimited: false, used: 7 })
    expect(view.overCap).toEqual({
      blocked: ["start_landing", "publish_job", "send_invitation", "add_seat"],
      landings: false,
      overCap: true,
      resolutions: [
        "7 people hold a Landing Operator seat and your Pro plan allows 5. Move 2 of them to fleet-only access or remove them to publish jobs, start landings and send invitations again."
      ],
      seats: true
    })
  })

  it("with both: every block once, in order, and a resolution for each, landings first", () => {
    const view = marketplaceBillingOverview(allowance({ activeLandings: 2, landingsOverCap: true, planCode: "basic", seatsOverCap: true, teamMembers: 3 }))

    expect(view.overCap.blocked).toEqual([...MARKETPLACE_OVER_CAP_BLOCKS])
    expect(view.overCap.resolutions).toEqual([
      "2 landings are recruiting and your Basic plan allows 1. Pause 1 of them to publish jobs and send invitations again.",
      "3 people hold a Landing Operator seat and your Basic plan allows 2. Move 1 of them to fleet-only access or remove them to publish jobs, start landings and send invitations again."
    ])
  })

  it("follows the store's conflict flags, never recounting against its own copy of the limits", () => {
    // The store says there is no conflict: room is gone, but nothing is reported blocked.
    const view = marketplaceBillingOverview(allowance({ activeLandings: 4 }))

    expect(view.landings).toMatchObject({ atCap: true, overCap: false, remaining: 0 })
    expect(view.overCap.overCap).toBe(false)
  })

  it("still names a conflict honestly when the counts do not show the excess", () => {
    const view = marketplaceBillingOverview(allowance({ activeLandings: 3, landingsOverCap: true, seatsOverCap: true, teamMembers: 5 }))

    expect(view.overCap.resolutions).toEqual([
      "Your Pro plan allows 3 recruiting landings. Pause landings until no more than 3 recruit to publish jobs and send invitations again.",
      "Your Pro plan allows 5 Landing Operator seats. Move people to fleet-only access or remove them until no more than 5 hold one, to publish jobs, start landings and send invitations again."
    ])
  })
})

describe("billing overview: standing", () => {
  it.each<[Partial<MarketplacePlanAllowanceView>, string]>([
    [{ subscriptionStatus: "trialing" }, "entitled"],
    [{ subscriptionStatus: "active" }, "entitled"],
    [{ graceEndsAt: "2026-11-17T00:00:00.000Z", subscriptionStatus: "past_due" }, "grace"],
    [{ cycleEndsAt: null, graceEndsAt: "2026-11-03T00:00:00.000Z", invitationsRemaining: null, planCode: null, subscriptionStatus: "past_due" }, "not_entitled"],
    [{ cycleEndsAt: null, invitationsRemaining: null, planCode: null, subscriptionStatus: "incomplete" }, "not_entitled"],
    [{ cycleEndsAt: null, invitationsRemaining: null, planCode: null, subscriptionStatus: null }, "no_subscription"]
  ])("%o is %s", (overrides, standing) => {
    expect(marketplaceBillingOverview(allowance(overrides)).standing).toBe(standing)
  })

  it("keeps the grace end the store records, passed or not", () => {
    const lapsed = allowance({ cycleEndsAt: null, graceEndsAt: "2026-11-03T00:00:00.000Z", invitationsRemaining: null, planCode: null, subscriptionStatus: "past_due" })

    expect(marketplaceBillingOverview(lapsed)).toMatchObject({ graceEndsAt: "2026-11-03T00:00:00.000Z", subscriptionStatus: "past_due" })
  })
})

describe("billing overview: what each plan allows, never purchasable", () => {
  it("lists Basic, Pro and Regional with their caps, marks the current one, and offers no purchase", () => {
    const view = marketplaceBillingOverview(allowance())

    expect(view.purchasable).toBe(false)
    expect(view.purchaseNote).toBe(MARKETPLACE_PLAN_NOT_PURCHASABLE)
    expect(view.plans.map(({ caps, current, plan, purchasable }) => ({ caps, current, plan: plan.code, purchasable }))).toEqual([
      { caps: marketplacePlanCaps("basic"), current: false, plan: "basic", purchasable: false },
      { caps: marketplacePlanCaps("pro"), current: true, plan: "pro", purchasable: false },
      { caps: marketplacePlanCaps("regional"), current: false, plan: "regional", purchasable: false }
    ])
  })

  it("previews how today's landings and seats would fit each plan (§9.15)", () => {
    const overBy = marketplaceBillingOverview(allowance({ activeLandings: 4, planCode: "regional", teamMembers: 6 })).plans.map((option) => option.overBy)

    expect(overBy).toEqual([
      { landings: 3, seats: 4 },
      { landings: 1, seats: 1 },
      { landings: 0, seats: 0 }
    ])
  })

  it("marks no plan current and none purchasable while billing isn't active", () => {
    const view = marketplaceBillingOverview(NO_BILLING)

    expect(view.plans.every((option) => !option.current && option.purchasable === false)).toBe(true)
    expect(view.purchasable).toBe(false)
  })
})

describe("founding offer summary (§9.12)", () => {
  it("is null when the business has no offer", () => {
    expect(marketplaceFoundingOfferSummary(null, "pro")).toBeNull()
  })

  it("states the cycles left, the discounted price and the renewal price from the offer's own terms", () => {
    expect(marketplaceFoundingOfferSummary(offer(), "pro")).toEqual({
      active: true,
      cyclesApplied: 2,
      cyclesRemaining: 4,
      discountedPriceCents: 14_950,
      grantedAt: "2026-11-02T15:00:00.000Z",
      renewalPriceCents: 29_900,
      status: "applied",
      terms: { billingCycles: 6, percentOff: 50, stateCode: "OR" }
    })
  })

  it.each<[LandingPlanCode, number, number]>([
    ["basic", 7_450, 14_900],
    ["pro", 14_950, 29_900],
    ["regional", 24_950, 49_900]
  ])("prices a granted %s offer at %s cents for each discounted cycle, then %s", (planCode, discounted, renewal) => {
    expect(marketplaceFoundingOfferSummary(offer({ cyclesApplied: 0, status: "granted" }), planCode)).toMatchObject({
      active: true,
      cyclesRemaining: 6,
      discountedPriceCents: discounted,
      renewalPriceCents: renewal
    })
  })

  it("uses the promotion's percentage, not the blueprint constant, rounding half up to whole cents", () => {
    const terms = { billingCycles: 3, percentOff: 33.33, stateCode: null }

    // 14 900 × 66.67 % = 9 933.83 cents → 9 934.
    expect(marketplaceFoundingOfferSummary(offer({ cyclesApplied: 1, terms }), "basic")).toMatchObject({ cyclesRemaining: 2, discountedPriceCents: 9_934 })
    expect(marketplaceFoundingOfferSummary(offer({ terms: { ...terms, percentOff: 100 } }), "pro")).toMatchObject({ discountedPriceCents: 0 })
  })

  it.each(["exhausted", "revoked"] as const)("has no discounted cycles left once %s", (status) => {
    expect(marketplaceFoundingOfferSummary(offer({ cyclesApplied: 6, status }), "pro")).toMatchObject({
      active: false,
      cyclesRemaining: 0,
      discountedPriceCents: null,
      renewalPriceCents: 29_900
    })
  })

  it("never counts below zero cycles", () => {
    expect(marketplaceFoundingOfferSummary(offer({ cyclesApplied: 9 }), "pro")).toMatchObject({ active: false, cyclesRemaining: 0, discountedPriceCents: null })
  })

  it("leaves prices it cannot know unknown: no plan yet, or terms the store no longer shows", () => {
    expect(marketplaceFoundingOfferSummary(offer({ cyclesApplied: 0, status: "granted" }), null)).toMatchObject({
      active: true,
      cyclesRemaining: 6,
      discountedPriceCents: null,
      renewalPriceCents: null
    })
    expect(marketplaceFoundingOfferSummary(offer({ terms: null }), "pro")).toMatchObject({
      active: true,
      cyclesRemaining: null,
      discountedPriceCents: null,
      renewalPriceCents: 29_900,
      terms: null
    })
    expect(marketplaceFoundingOfferSummary(offer({ status: "exhausted", terms: null }), "pro")).toMatchObject({ active: false, cyclesRemaining: 0 })
  })
})
