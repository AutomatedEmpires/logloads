/**
 * billing (#248): plan and allowance rules (caps, invitation balance, founding offer, over-cap state; no Stripe).
 *
 * Port v3 (#244) entry module, re-exported by `packages/services/src/index.ts`. Pure rules over the views in
 * `packages/contracts/src/v2/billing/`: they read what the store recorded (`MarketplaceBillingPort`) and take every
 * limit and price from `LANDING_PLANS`. They state what a plan allows and what is blocked; they enforce nothing
 * themselves (billing gates stay off, and the store refuses at the point of action, §2.5). Nothing here is
 * purchasable.
 */

import {
  LANDING_PLANS,
  landingPlan,
  MARKETPLACE_OVER_CAP_BLOCKS,
  MARKETPLACE_PLAN_NOT_PURCHASABLE,
  summarizeLandingAllowance,
  type LandingAllowanceFigure,
  type LandingPlan,
  type LandingPlanCode,
  type MarketplaceBillingOverviewView,
  type MarketplaceBillingStanding,
  type MarketplaceCountedCapView,
  type MarketplaceFoundingOfferSummaryView,
  type MarketplaceFoundingOfferView,
  type MarketplaceInvitationBalanceView,
  type MarketplaceOverCapBlock,
  type MarketplaceOverCapStateView,
  type MarketplacePlanAllowanceView,
  type MarketplacePlanCaps,
  type MarketplacePlanOptionView
} from "@logloads/contracts"

/** One plan's caps, from `LANDING_PLANS`. Refuses a code the contracts do not define. */
export function marketplacePlanCaps(planCode: LandingPlanCode): MarketplacePlanCaps {
  const plan = landingPlan(planCode)

  return {
    invitationsPerCycle: plan.targetedInvitationsPerCycle,
    landings: plan.activeLandingLimit,
    planCode: plan.code,
    seats: plan.teamSeatLimit
  }
}

/** A figure from `summarizeLandingAllowance`, with the room left and the store's own conflict flag. */
function countedCap(figure: LandingAllowanceFigure, overCap: boolean): MarketplaceCountedCapView {
  const remaining = figure.limit === null ? null : Math.max(0, figure.limit - figure.used)

  return {
    atCap: overCap || remaining === 0,
    limit: figure.limit,
    overCap,
    remaining,
    unlimited: figure.unlimited,
    used: figure.used
  }
}

function standingOf(allowance: MarketplacePlanAllowanceView): MarketplaceBillingStanding {
  if (allowance.planCode !== null) {
    return allowance.subscriptionStatus === "past_due" ? "grace" : "entitled"
  }

  return allowance.subscriptionStatus === null ? "no_subscription" : "not_entitled"
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** Resume publishing and invitations once the business is back within its landing cap. */
function landingResolution(plan: LandingPlan | null, used: number): string {
  const limit = plan?.activeLandingLimit ?? null

  if (plan === null || limit === null) {
    return "More landings are recruiting than your plan allows. Pause some to publish jobs and send invitations again."
  }

  const excess = used - limit

  return excess > 0
    ? `${plural(used, "landing is", "landings are")} recruiting and your ${plan.name} plan allows ${limit}. Pause ${excess} of them to publish jobs and send invitations again.`
    : `Your ${plan.name} plan allows ${plural(limit, "recruiting landing", "recruiting landings")}. Pause landings until no more than ${limit} recruit to publish jobs and send invitations again.`
}

function seatResolution(plan: LandingPlan | null, used: number): string {
  const action = "to publish jobs, start landings and send invitations again."

  if (plan === null) {
    return `More people hold a Landing Operator seat than your plan allows. Move some to fleet-only access or remove them ${action}`
  }

  const limit = plan.teamSeatLimit
  const excess = used - limit

  return excess > 0
    ? `${plural(used, "person holds", "people hold")} a Landing Operator seat and your ${plan.name} plan allows ${limit}. Move ${excess} of them to fleet-only access or remove them ${action}`
    : `Your ${plan.name} plan allows ${plural(limit, "Landing Operator seat", "Landing Operator seats")}. Move people to fleet-only access or remove them until no more than ${limit} hold one, ${action}`
}

/** What the store refuses while over a cap, as `MarketplaceOverCapStateView` documents it, and how to resolve it. */
function overCapState(allowance: MarketplacePlanAllowanceView, plan: LandingPlan | null): MarketplaceOverCapStateView {
  const landings = allowance.landingsOverCap
  const seats = allowance.seatsOverCap
  const blocks = new Set<MarketplaceOverCapBlock>()

  if (landings || seats) {
    blocks.add("start_landing").add("publish_job").add("send_invitation")
  }

  if (seats) {
    blocks.add("add_seat")
  }

  const resolutions: string[] = []

  if (landings) {
    resolutions.push(landingResolution(plan, allowance.activeLandings))
  }

  if (seats) {
    resolutions.push(seatResolution(plan, allowance.teamMembers))
  }

  return {
    blocked: MARKETPLACE_OVER_CAP_BLOCKS.filter((block) => blocks.has(block)),
    landings,
    overCap: landings || seats,
    resolutions,
    seats
  }
}

function invitationBalance(
  summary: ReturnType<typeof summarizeLandingAllowance>,
  overCap: boolean
): MarketplaceInvitationBalanceView {
  const { perCycle, remaining, resetsAt } = summary.invitations

  if (summary.plan === null || remaining === null) {
    return { perCycle: null, remaining: null, resetsAt: null, state: "no_plan" }
  }

  // Exhausted wins over blocked: resolving a conflict would not make any invitation sendable this cycle.
  const state = remaining === 0 ? "exhausted" : overCap ? "blocked" : "available"

  return { perCycle, remaining, resetsAt, state }
}

/** Every plan, in `LANDING_PLANS` order, with how the business's current landings and seats would fit it. */
function planOptions(allowance: MarketplacePlanAllowanceView): MarketplacePlanOptionView[] {
  return Object.values(LANDING_PLANS).map((plan) => {
    const caps = marketplacePlanCaps(plan.code)

    return {
      caps,
      current: allowance.planCode === plan.code,
      overBy: {
        landings: caps.landings === null ? 0 : Math.max(0, allowance.activeLandings - caps.landings),
        seats: Math.max(0, allowance.teamMembers - caps.seats)
      },
      plan,
      purchasable: false
    }
  })
}

/**
 * The billing page's read model (§4.12) from `planAllowance`: the plan and its caps, their use, the invitation
 * balance, any over-cap conflict and what it blocks, and every plan for comparison. Conflicts are the store's own
 * flags; limits come from `LANDING_PLANS`.
 */
export function marketplaceBillingOverview(allowance: MarketplacePlanAllowanceView): MarketplaceBillingOverviewView {
  const summary = summarizeLandingAllowance(allowance)
  const overCap = overCapState(allowance, summary.plan)

  return {
    fleetOnlyMembers: allowance.fleetOnlyMembers,
    graceEndsAt: allowance.graceEndsAt,
    invitations: invitationBalance(summary, overCap.overCap),
    landings: countedCap(summary.landings, allowance.landingsOverCap),
    overCap,
    plan: summary.plan,
    plans: planOptions(allowance),
    purchasable: false,
    purchaseNote: MARKETPLACE_PLAN_NOT_PURCHASABLE,
    seats: countedCap(summary.team, allowance.seatsOverCap),
    standing: standingOf(allowance),
    subscriptionStatus: allowance.subscriptionStatus
  }
}

/** `price × (100 − percentOff) / 100` in integer cents, rounded half up, with the percentage exact to two decimals. */
function discountedCents(priceCents: number, percentOff: number): number {
  const keptBasisPoints = 10_000 - Math.round(percentOff * 100)

  return Math.floor((priceCents * keptBasisPoints + 5_000) / 10_000)
}

/**
 * The founding offer as the billing page states it (§9.12): whether it still applies, the discounted cycles left,
 * and, for the entitling plan, the discounted and renewal prices. Every term comes from the offer's own record.
 * Returns `null` when the business has no offer.
 */
export function marketplaceFoundingOfferSummary(
  offer: MarketplaceFoundingOfferView | null,
  planCode: LandingPlanCode | null
): MarketplaceFoundingOfferSummaryView | null {
  if (offer === null) {
    return null
  }

  const { terms } = offer
  const active = (offer.status === "granted" || offer.status === "applied") && (terms === null || offer.cyclesApplied < terms.billingCycles)
  const cyclesRemaining = !active ? 0 : terms === null ? null : terms.billingCycles - offer.cyclesApplied
  const renewalPriceCents = planCode === null ? null : landingPlan(planCode).monthlyPriceCents

  return {
    active,
    cyclesApplied: offer.cyclesApplied,
    cyclesRemaining,
    discountedPriceCents: active && terms !== null && renewalPriceCents !== null ? discountedCents(renewalPriceCents, terms.percentOff) : null,
    grantedAt: offer.grantedAt,
    renewalPriceCents,
    status: offer.status,
    terms
  }
}
