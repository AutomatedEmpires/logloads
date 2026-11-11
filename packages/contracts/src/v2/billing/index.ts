/**
 * billing (#248): the plan and allowance read model — no Stripe, billing gates stay off (UX spec §2.3, §2.5, §4.12).
 * Views for `MarketplaceBillingPort` (apps/web/lib/marketplace-v2/port.ts). #248 adds its rules (caps, invitation
 * balance, founding offer, over-cap state) here and in `packages/services/src/v2/billing/`.
 */

import type { MarketplaceLandingAllowanceView } from "../../marketplace-landings"

/**
 * `organization_subscriptions.status` as the billing provider last reported it. Read only; nothing here starts a
 * charge. `get_org_entitlement_state` never reports a cancelled subscription (it reads only one that is not).
 */
export const MARKETPLACE_SUBSCRIPTION_STATUSES = ["incomplete", "trialing", "active", "past_due", "canceled"] as const
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

/** `promotion_redemptions.status`. */
export const MARKETPLACE_FOUNDING_OFFER_STATUSES = ["granted", "applied", "exhausted", "revoked"] as const
export type MarketplaceFoundingOfferStatus = (typeof MARKETPLACE_FOUNDING_OFFER_STATUSES)[number]

/** The business's founding-operator offer, as recorded (§2.5, §7.7). Its terms come from the promotion record. */
export interface MarketplaceFoundingOfferView {
  status: MarketplaceFoundingOfferStatus
  /** The launched state the offer belongs to; `null` for an offer without one. */
  stateCode: string | null
  percentOff: number
  billingCycles: number
  cyclesApplied: number
  grantedAt: string
}
