/**
 * billing (#248): the plan and allowance read model — no Stripe, billing gates stay off (UX spec §2.3, §2.5, §4.12).
 * Views for `MarketplaceBillingPort` (apps/web/lib/marketplace-v2/port.ts), and the read model its rules build in
 * `packages/services/src/v2/billing/` (`marketplaceBillingOverview`, `marketplaceFoundingOfferSummary`).
 *
 * Everything here describes what a plan allows and what the store records. Nothing starts a charge, makes a plan
 * purchasable or gates an action: the store enforces every cap itself, at the point of action (§2.5). Limits come
 * from `LANDING_PLANS` (membership.ts) by plan code, never from the store or the page.
 */

import type { MarketplaceLandingAllowanceView } from "../../marketplace-landings"
import type { LandingPlan, LandingPlanCode } from "../../membership"

/**
 * `organization_subscriptions.status` as the billing provider last reported it. Read only; nothing here starts a
 * charge. `get_org_entitlement_state` never reports a cancelled subscription (it reads only one that is not). Stripe's
 * `paused` and `unpaid` are stored as such since stage 12 (LE-04) and never entitle a plan.
 */
export const MARKETPLACE_SUBSCRIPTION_STATUSES = ["incomplete", "trialing", "active", "past_due", "paused", "unpaid", "canceled"] as const
export type MarketplaceSubscriptionStatus = (typeof MARKETPLACE_SUBSCRIPTION_STATUSES)[number]

/** `get_org_entitlement_state`, whole. Extends the landing allowance, so `summarizeLandingAllowance` reads it too. */
export interface MarketplacePlanAllowanceView extends MarketplaceLandingAllowanceView {
  /** `null` when the business has no current subscription. */
  subscriptionStatus: MarketplaceSubscriptionStatus | null
  /** Members without a Landing Operator seat (fleet staff, drivers). Never paid seats (§6.6). */
  fleetOnlyMembers: number
  /** More recruiting landings than the plan allows (after a downgrade): nothing new may recruit until resolved. */
  landingsOverCap: boolean
  /** More seated members than the plan allows: no seat may be added and no invitation sent until resolved. */
  seatsOverCap: boolean
  /** End of the payment grace period after a failed charge; `null` when there is none. */
  graceEndsAt: string | null
}

// ---------------------------------------------------------------------------
// Founding offer (§2.5, §7.7, §9.12)
// ---------------------------------------------------------------------------

/** `promotion_redemptions.status`. */
export const MARKETPLACE_FOUNDING_OFFER_STATUSES = ["granted", "applied", "exhausted", "revoked"] as const
export type MarketplaceFoundingOfferStatus = (typeof MARKETPLACE_FOUNDING_OFFER_STATUSES)[number]

/** `promotions.program` of the founding-operator offer: one redemption per business (`UNIQUE (program, org_id)`). */
export const MARKETPLACE_FOUNDING_OFFER_PROGRAM = "founding_landing"

/** The promotion's own terms. They come from the promotion record, never from `FOUNDING_OPERATOR_OFFER`. */
export interface MarketplaceFoundingOfferTerms {
  /** The launched state the offer belongs to; `null` for an offer without one. */
  stateCode: string | null
  /** More than 0 and at most 100, to two decimals (`promotions.percent_off`). */
  percentOff: number
  /** Discounted billing cycles, 1 to 36. */
  billingCycles: number
}

/** The business's founding-operator offer, as recorded (§2.5, §7.7). Only the business's owner may read it. */
export interface MarketplaceFoundingOfferView {
  status: MarketplaceFoundingOfferStatus
  /** Discounted cycles already billed. */
  cyclesApplied: number
  grantedAt: string
  /**
   * `null` when the store no longer shows the promotion to the business: `promotions_read` shows only open
   * promotions, so a closed promotion's terms are unknown here, and are never guessed.
   */
  terms: MarketplaceFoundingOfferTerms | null
}

// ---------------------------------------------------------------------------
// Read model: what a plan allows, what is in use, and what is blocked
// ---------------------------------------------------------------------------

/** The caps a landing plan sets (§2.3). Postings, inquiries, replies and trucks per job are never capped (§3.2). */
export const MARKETPLACE_PLAN_CAPS = ["landings", "seats", "invitations"] as const
export type MarketplacePlanCap = (typeof MARKETPLACE_PLAN_CAPS)[number]

/** One plan's caps, from `LANDING_PLANS`. */
export interface MarketplacePlanCaps {
  planCode: LandingPlanCode
  /** Recruiting landings; `null` means unlimited, subject to fair use (§3.3). */
  landings: number | null
  /** People with a Landing Operator seat, the owner included. */
  seats: number
  /** Targeted invitations per billing cycle, with no rollover. */
  invitationsPerCycle: number
}

/** A counted cap (recruiting landings or seats) against the entitling plan. */
export interface MarketplaceCountedCapView {
  /** As the store counts them now. */
  used: number
  /** From `LANDING_PLANS`; `null` when the plan sets no limit or no plan entitles the business. */
  limit: number | null
  unlimited: boolean
  /** Room left before the cap, never negative; `null` when unlimited or without a plan. */
  remaining: number | null
  /** No room for one more. */
  atCap: boolean
  /** More in use than the plan allows, as the store records it (after a downgrade). */
  overCap: boolean
}

/**
 * - `no_plan`: no plan entitles the business, so there is no allowance.
 * - `exhausted`: none left this cycle. No automatic charge, rollover or negative balance follows (§2.5, §9.8).
 * - `blocked`: some are left, but the store refuses every send until the business is back within its plan.
 * - `available`: some are left.
 */
export const MARKETPLACE_INVITATION_BALANCE_STATES = ["no_plan", "exhausted", "blocked", "available"] as const
export type MarketplaceInvitationBalanceState = (typeof MARKETPLACE_INVITATION_BALANCE_STATES)[number]

/** Targeted invitations in the current billing cycle (§6.2). */
export interface MarketplaceInvitationBalanceView {
  state: MarketplaceInvitationBalanceState
  /** Left this cycle, never more than the plan's allowance; `null` without a plan. */
  remaining: number | null
  /** From `LANDING_PLANS`; `null` without a plan. */
  perCycle: number | null
  /** When the allowance resets (the cycle's exclusive end); `null` without a plan. */
  resetsAt: string | null
}

/** What the store refuses while the business holds more than its plan allows. */
export const MARKETPLACE_OVER_CAP_BLOCKS = ["start_landing", "publish_job", "send_invitation", "add_seat"] as const
export type MarketplaceOverCapBlock = (typeof MARKETPLACE_OVER_CAP_BLOCKS)[number]

/**
 * A downgrade never suspends people or deletes landings (§9.15): the store records the conflict and blocks only new
 * use. Either conflict stops a landing starting to recruit (`tg_landing_guard`), a job publishing or coming back
 * (`tg_job_posting_guard`) and invitations sending (`reserve_targeted_invitation`). A seat conflict also stops seat
 * invitations (`invite_team_member`).
 */
export interface MarketplaceOverCapStateView {
  overCap: boolean
  landings: boolean
  seats: boolean
  /** In `MARKETPLACE_OVER_CAP_BLOCKS` order; empty within the plan. */
  blocked: MarketplaceOverCapBlock[]
  /** One sentence per conflict saying how to resolve it, landings first; empty within the plan. */
  resolutions: string[]
}

/**
 * - `no_subscription`: billing isn't active yet. There is no plan and no subscription.
 * - `entitled`: a trialing or active subscription entitles the plan.
 * - `grace`: a charge failed, and the plan stays entitled until `graceEndsAt`.
 * - `not_entitled`: a subscription exists but grants nothing now (incomplete, lapsed, or its grace ended).
 */
export const MARKETPLACE_BILLING_STANDINGS = ["no_subscription", "entitled", "grace", "not_entitled"] as const
export type MarketplaceBillingStanding = (typeof MARKETPLACE_BILLING_STANDINGS)[number]

/**
 * Shown wherever a plan, invitation pack or boost would be bought. No purchase is built (Blueprint §14). The same
 * words as the coded plan cards (`LandingPlanCards`) and the 04 Settings design.
 */
export const MARKETPLACE_PLAN_NOT_PURCHASABLE = "Billing isn't active yet. No plan can be bought here, and nothing on this page charges you."

/** One plan as the business can compare it: what it allows, and how today's use fits it. Never purchasable yet. */
export interface MarketplacePlanOptionView {
  plan: LandingPlan
  caps: MarketplacePlanCaps
  /** The plan that entitles the business now. */
  current: boolean
  /** No purchase flow exists. A literal, so a page cannot offer a checkout by mistake. */
  purchasable: false
  /** Recruiting landings and seats held today beyond this plan's caps (the downgrade preview, §9.15); 0 when they fit. */
  overBy: { landings: number; seats: number }
}

/** The billing page's read model (§4.12): the plan, its caps and their use, the invitation balance and any conflict. */
export interface MarketplaceBillingOverviewView {
  standing: MarketplaceBillingStanding
  /** The entitling plan, from `LANDING_PLANS`; `null` when none entitles the business. */
  plan: LandingPlan | null
  subscriptionStatus: MarketplaceSubscriptionStatus | null
  /** As the store records it: the end of the grace window, passed or not; `null` when there is none. */
  graceEndsAt: string | null
  landings: MarketplaceCountedCapView
  seats: MarketplaceCountedCapView
  /** Members without a seat. Never paid, and never counted against a cap (§6.6). */
  fleetOnlyMembers: number
  invitations: MarketplaceInvitationBalanceView
  overCap: MarketplaceOverCapStateView
  /** Basic, Pro and Regional, in `LANDING_PLANS` order. */
  plans: MarketplacePlanOptionView[]
  /** A literal: nothing here can be bought yet. */
  purchasable: false
  purchaseNote: string
}

/** The founding offer as the billing page states it (§9.12): the cycles left and the prices around them. */
export interface MarketplaceFoundingOfferSummaryView {
  status: MarketplaceFoundingOfferStatus
  /** The discount still applies to the business's next paid cycles. */
  active: boolean
  /** The terms, when the store shows them (see `MarketplaceFoundingOfferView.terms`). */
  terms: MarketplaceFoundingOfferTerms | null
  cyclesApplied: number
  /** Discounted cycles still to come: 0 once exhausted or revoked; `null` when the terms are unknown. */
  cyclesRemaining: number | null
  /**
   * The entitling plan's price for a discounted cycle, in integer cents rounded half up; `null` once no discounted
   * cycle is left, and without a plan or terms.
   */
  discountedPriceCents: number | null
  /** The entitling plan's own price, which applies once the offer ends; `null` without a plan. */
  renewalPriceCents: number | null
  grantedAt: string
}
