import { z } from "zod"

/**
 * Product rules from the LogLoads Product, Membership & Monetization Blueprint v1.0
 * (docs/product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md, decided 2026-11-01).
 *
 * Pure, provider-free rules only: no persistence, no Stripe, no UI. Nothing here makes a
 * plan, invitation or boost purchasable; activation is gated separately (Blueprint §14).
 * Settings the blueprint leaves open (§16.2) are required parameters, never invented defaults.
 *
 * Relationship to the normalized-v2 schema prototype (architecture/normalized-v2): the prototype
 * stores plan prices and limits as versioned rows (`subscription_plans`, `boost_products`,
 * `promotions`). These constants are the Blueprint v1.0 baseline used to seed and verify those
 * rows; runtime enforcement should read the active rows. Invitation semantics follow the
 * prototype: reserved and delivered invitations count against the allowance, failed or
 * suppressed ones are released.
 */
export const MEMBERSHIP_BLUEPRINT_VERSION = "blueprint-v1.0-2026-11-01"

export const landingPlanCodeSchema = z.enum(["basic", "pro", "regional"])
export type LandingPlanCode = z.infer<typeof landingPlanCodeSchema>

export const LANDING_PLAN_FEATURES = [
  "advanced_hauler_search",
  "availability_alerts",
  "posting_templates",
  "multi_landing_inbox",
  "regional_capacity_overview",
  "advanced_team_workflows",
  "priority_support"
] as const
export type LandingPlanFeature = (typeof LANDING_PLAN_FEATURES)[number]

export interface LandingPlan {
  code: LandingPlanCode
  name: string
  positioning: string
  monthlyPriceCents: number
  /** `null` means unlimited authentic active landings, subject to fair-use controls (§3.3). */
  activeLandingLimit: number | null
  teamSeatLimit: number
  targetedInvitationsPerCycle: number
  features: readonly LandingPlanFeature[]
}

/** Blueprint §3.1. Postings, inquiries, replies and trucks requested per job are unlimited on every plan (§3.2). */
export const LANDING_PLANS: Readonly<Record<LandingPlanCode, LandingPlan>> = Object.freeze({
  basic: Object.freeze({
    activeLandingLimit: 1,
    code: "basic",
    features: Object.freeze([]),
    monthlyPriceCents: 14_900,
    name: "Basic",
    positioning: "Advertise your work.",
    targetedInvitationsPerCycle: 3,
    teamSeatLimit: 2
  }),
  pro: Object.freeze({
    activeLandingLimit: 3,
    code: "pro",
    features: Object.freeze(["advanced_hauler_search", "availability_alerts", "posting_templates", "multi_landing_inbox"] as const),
    monthlyPriceCents: 29_900,
    name: "Pro",
    positioning: "Find trucks faster.",
    targetedInvitationsPerCycle: 10,
    teamSeatLimit: 5
  }),
  regional: Object.freeze({
    activeLandingLimit: null,
    code: "regional",
    features: Object.freeze([...LANDING_PLAN_FEATURES]),
    monthlyPriceCents: 49_900,
    name: "Regional",
    positioning: "Recruit across your operation.",
    targetedInvitationsPerCycle: 30,
    teamSeatLimit: 10
  })
})

/** Haulers and hauling businesses use core marketplace features free forever (§2.1). There is no paid hauler tier. */
export const HAULER_MEMBERSHIP = Object.freeze({ monthlyPriceCents: 0, paidTiers: Object.freeze([] as const) })

export function landingPlan(code: LandingPlanCode): LandingPlan {
  return LANDING_PLANS[landingPlanCodeSchema.parse(code)]
}

export function planIncludesFeature(code: LandingPlanCode, feature: LandingPlanFeature): boolean {
  return landingPlan(code).features.includes(feature)
}

function assertCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer`)
  }
}

/** Whether one more landing may be made active. Saved but inactive landings never count (§3.3). */
export function canActivateLanding(code: LandingPlanCode, currentActiveLandings: number): boolean {
  assertCount(currentActiveLandings, "currentActiveLandings")
  const limit = landingPlan(code).activeLandingLimit

  return limit === null || currentActiveLandings < limit
}

/** Whether one more named human team member may be added (§2.3). Haulers recruited are never seats. */
export function canAddTeamMember(code: LandingPlanCode, currentTeamMembers: number): boolean {
  assertCount(currentTeamMembers, "currentTeamMembers")

  return currentTeamMembers < landingPlan(code).teamSeatLimit
}

// ---------------------------------------------------------------------------
// Targeted invitations (§6)
// ---------------------------------------------------------------------------

export interface BillingCycleWindow {
  /** Inclusive start of the current billing cycle (ISO 8601). */
  startsAt: string
  /** Exclusive end of the current billing cycle (ISO 8601). */
  endsAt: string
}

/**
 * An invitation that currently counts against the allowance: `reserved` (delivery in progress)
 * or `delivered`. Failed or suppressed invitations are released and must not be passed in (§6.3).
 */
export interface CommittedTargetedInvitation {
  recipientOrganizationId: string
  jobPostingId: string
  /** When the invitation was reserved against the cycle's allowance. */
  committedAt: string
}

export interface TargetedInvitationRecipient {
  organizationId: string
  /** The hauler business opted in to targeted invitations and has not muted or unsubscribed (§6.3, §10.5). */
  optedIn: boolean
  /** Meets the job's equipment and geography criteria from self-reported profile data. */
  matchesCriteria: boolean
}

export type TargetedInvitationDecision =
  | { allowed: true; remainingAfterSend: number }
  | {
      allowed: false
      reason: "outside_billing_cycle" | "recipient_not_opted_in" | "recipient_not_eligible" | "duplicate_recipient_and_job" | "allowance_exhausted"
      remaining: number
    }

function instant(value: string, label: string): number {
  const parsed = Date.parse(value)

  if (Number.isNaN(parsed)) {
    throw new RangeError(`${label} must be an ISO 8601 instant`)
  }

  return parsed
}

/** Invitations committed inside the current cycle. Earlier cycles never roll over or carry balances (§6.2). */
export function invitationsUsedInCycle(deliveries: readonly CommittedTargetedInvitation[], cycle: BillingCycleWindow): number {
  const start = instant(cycle.startsAt, "cycle.startsAt")
  const end = instant(cycle.endsAt, "cycle.endsAt")

  return deliveries.filter((delivery) => {
    const at = instant(delivery.committedAt, "committedAt")
    return at >= start && at < end
  }).length
}

export function remainingTargetedInvitations(
  code: LandingPlanCode,
  deliveries: readonly CommittedTargetedInvitation[],
  cycle: BillingCycleWindow
): number {
  return Math.max(0, landingPlan(code).targetedInvitationsPerCycle - invitationsUsedInCycle(deliveries, cycle))
}

/**
 * How many invitations can actually be sent right now: never more than the eligible opted-in audience,
 * so a sparse region is shown honestly instead of implying ten recipients exist (§6.4).
 */
export function sendableTargetedInvitations(remaining: number, eligibleOptedInAudience: number): number {
  assertCount(remaining, "remaining")
  assertCount(eligibleOptedInAudience, "eligibleOptedInAudience")

  return Math.min(remaining, eligibleOptedInAudience)
}

/**
 * Decides whether one invitation may be sent. The dedupe window is required because the blueprint
 * leaves it to be decided (§16.2); repeat sends of the same job to the same recipient inside it are
 * refused rather than debited (§6.3). `Number.POSITIVE_INFINITY` reproduces the prototype's rule of
 * one live invitation per job and recipient for the life of the job.
 */
export function evaluateTargetedInvitation(input: {
  planCode: LandingPlanCode
  cycle: BillingCycleWindow
  now: string
  deliveries: readonly CommittedTargetedInvitation[]
  recipient: TargetedInvitationRecipient
  jobPostingId: string
  dedupeWindowMs: number
}): TargetedInvitationDecision {
  if (input.dedupeWindowMs !== Number.POSITIVE_INFINITY) {
    assertCount(input.dedupeWindowMs, "dedupeWindowMs")
  }
  const now = instant(input.now, "now")
  const remaining = remainingTargetedInvitations(input.planCode, input.deliveries, input.cycle)

  if (now < instant(input.cycle.startsAt, "cycle.startsAt") || now >= instant(input.cycle.endsAt, "cycle.endsAt")) {
    return { allowed: false, reason: "outside_billing_cycle", remaining }
  }

  if (!input.recipient.optedIn) {
    return { allowed: false, reason: "recipient_not_opted_in", remaining }
  }

  if (!input.recipient.matchesCriteria) {
    return { allowed: false, reason: "recipient_not_eligible", remaining }
  }

  const duplicate = input.deliveries.some((delivery) =>
    delivery.recipientOrganizationId === input.recipient.organizationId &&
    delivery.jobPostingId === input.jobPostingId &&
    now - instant(delivery.committedAt, "committedAt") < input.dedupeWindowMs
  )

  if (duplicate) {
    return { allowed: false, reason: "duplicate_recipient_and_job", remaining }
  }

  if (remaining === 0) {
    return { allowed: false, reason: "allowance_exhausted", remaining }
  }

  return { allowed: true, remainingAfterSend: remaining - 1 }
}

// ---------------------------------------------------------------------------
// Job boosts (§7)
// ---------------------------------------------------------------------------

export const boostPackageCodeSchema = z.enum(["quick", "extended", "campaign"])
export type BoostPackageCode = z.infer<typeof boostPackageCodeSchema>

export interface BoostPackage {
  code: BoostPackageCode
  name: string
  durationDays: number
  priceCents: number
}

/** One authentic job posting, consecutive days once activated, never auto-renewed (§7.1, §7.5). */
export const BOOST_PACKAGES: Readonly<Record<BoostPackageCode, BoostPackage>> = Object.freeze({
  campaign: Object.freeze({ code: "campaign", durationDays: 28, name: "Campaign Boost", priceCents: 19_900 }),
  extended: Object.freeze({ code: "extended", durationDays: 14, name: "Extended Boost", priceCents: 14_900 }),
  quick: Object.freeze({ code: "quick", durationDays: 7, name: "Quick Boost", priceCents: 9_900 })
})

/** Approximate straight-line radius from the public landing area, not a road-distance promise (§7.3). */
export const BOOST_RADIUS_MILES = 100
export const BOOST_AUTO_RENEWS = false

const DAY_MS = 24 * 60 * 60 * 1000

export function boostWindow(code: BoostPackageCode, activatedAt: string): { startsAt: string; endsAt: string } {
  const start = instant(activatedAt, "activatedAt")
  const { durationDays } = BOOST_PACKAGES[boostPackageCodeSchema.parse(code)]

  return { endsAt: new Date(start + durationDays * DAY_MS).toISOString(), startsAt: new Date(start).toISOString() }
}

// ---------------------------------------------------------------------------
// Founding programme (§8)
// ---------------------------------------------------------------------------

export const FOUNDING_OPERATOR_OFFER = Object.freeze({
  discountedBillingCycles: 6,
  discountPercent: 50,
  /** Boosts and future invitation packs are not discounted (§8.1). */
  discountsBoosts: false,
  organizationsPerLaunchedState: 10
})

/** Recognition only: a badge never grants a paid plan or implies licence, insurance or safety verification (§8.2). */
export const FOUNDING_HAULER_BADGE_LIMIT = 1000

/** Subscription price for a founding operator's paid billing cycle (1-based). Integer cents, half-up. */
export function foundingOperatorCyclePriceCents(code: LandingPlanCode, paidCycleNumber: number): number {
  if (!Number.isSafeInteger(paidCycleNumber) || paidCycleNumber < 1) {
    throw new RangeError("paidCycleNumber must be a positive integer")
  }

  const full = landingPlan(code).monthlyPriceCents

  if (paidCycleNumber > FOUNDING_OPERATOR_OFFER.discountedBillingCycles) {
    return full
  }

  return Math.round((full * (100 - FOUNDING_OPERATOR_OFFER.discountPercent)) / 100)
}
