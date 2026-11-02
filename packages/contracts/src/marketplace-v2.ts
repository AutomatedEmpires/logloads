import { z } from "zod"

/**
 * Marketplace V2 — the load-board domain from the Product Blueprint v1.0 and the UX & Functional
 * Specification v1.0 (docs/product/). This module is the boundary the V2 screens depend on:
 *
 * - `Marketplace*View` types are the read model the UI renders. They are produced by a persistence
 *   adapter (today: the pilot `operating_state` document; later: the normalized-v2 `marketplace`
 *   schema) and never expose private landing access data.
 * - `marketplaceInterestSchema` is the persisted expression of interest. Its fields deliberately
 *   mirror `marketplace.expressions_of_interest` (+ `interest_messages` as `replies`) in
 *   architecture/normalized-v2 so a later adapter maps it 1:1.
 *
 * A job is an advertisement, not a dispatch order; an interest is marketplace communication, not
 * an assignment, contract or fee (UX spec §8.3, §8.11). Nothing here creates trips, assignments,
 * settlements or billing events.
 */

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime()

/** Pay bases match `marketplace.job_postings.pay_unit` in the normalized-v2 prototype. */
export const marketplacePayUnitSchema = z.enum(["per_load", "per_ton", "per_mbf", "per_hour", "per_day", "per_mile", "other"])
export type MarketplacePayUnit = z.infer<typeof marketplacePayUnitSchema>

export const MARKETPLACE_PAY_UNIT_LABELS: Readonly<Record<MarketplacePayUnit, string>> = Object.freeze({
  other: "other basis",
  per_day: "per day",
  per_hour: "per hour",
  per_load: "per load",
  per_mbf: "per MBF",
  per_mile: "per mile",
  per_ton: "per ton"
})

export const marketplaceJobStatusSchema = z.enum(["active", "paused", "filled", "closed", "expired"])
export type MarketplaceJobStatus = z.infer<typeof marketplaceJobStatusSchema>

export const marketplaceInterestStatusSchema = z.enum(["submitted", "viewed", "replied", "declined", "withdrawn"])
export type MarketplaceInterestStatus = z.infer<typeof marketplaceInterestStatusSchema>

export const marketplaceContactPreferenceSchema = z.enum(["in_app", "phone", "email"])
export type MarketplaceContactPreference = z.infer<typeof marketplaceContactPreferenceSchema>

export const marketplaceInterestReplySchema = z.object({
  id: uuidSchema,
  authorUserId: uuidSchema,
  authorSide: z.enum(["hauler", "landing"]),
  body: z.string().trim().min(1).max(2000),
  createdAt: timestampSchema
})
export type MarketplaceInterestReply = z.infer<typeof marketplaceInterestReplySchema>

/** One live expression of interest per (job, hauler organization); resubmission updates it. */
export const marketplaceInterestSchema = z.object({
  id: uuidSchema,
  loadPostingId: uuidSchema,
  jobOrganizationId: uuidSchema,
  haulerOrganizationId: uuidSchema,
  submittedByUserId: uuidSchema,
  trucksOffered: z.number().int().min(1).max(500),
  availableFrom: z.string().date().nullable(),
  message: z.string().max(2000).nullable(),
  contactPreference: marketplaceContactPreferenceSchema,
  status: marketplaceInterestStatusSchema,
  replies: z.array(marketplaceInterestReplySchema).max(200).default([]),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  respondedAt: timestampSchema.nullable(),
  withdrawnAt: timestampSchema.nullable()
}).refine((row) => row.haulerOrganizationId !== row.jobOrganizationId, {
  message: "A landing organization cannot express interest in its own job",
  path: ["haulerOrganizationId"]
})
export type MarketplaceInterest = z.infer<typeof marketplaceInterestSchema>

// ---------------------------------------------------------------------------
// Inputs (actor identity always comes from the server session, never the form)
// ---------------------------------------------------------------------------

export const expressInterestInputSchema = z.object({
  loadPostingId: uuidSchema,
  trucksOffered: z.coerce.number().int().min(1).max(500),
  availableFrom: z.string().date().nullable().optional(),
  message: z.string().trim().max(2000).optional().transform((value) => (value ? value : null)),
  contactPreference: marketplaceContactPreferenceSchema.default("in_app")
})
export type ExpressInterestInput = z.infer<typeof expressInterestInputSchema>

export const respondToInterestInputSchema = z.object({
  interestId: uuidSchema,
  decision: z.enum(["viewed", "replied", "declined"]),
  replyId: uuidSchema.optional(),
  body: z.string().trim().max(2000).optional().transform((value) => (value ? value : null))
}).refine((input) => input.decision !== "replied" || (input.body && input.replyId), {
  message: "A reply needs a message",
  path: ["body"]
})
export type RespondToInterestInput = z.infer<typeof respondToInterestInputSchema>

export const haulerInterestReplyInputSchema = z.object({
  interestId: uuidSchema,
  replyId: uuidSchema,
  body: z.string().trim().min(1).max(2000)
})
export type HaulerInterestReplyInput = z.infer<typeof haulerInterestReplyInputSchema>

// ---------------------------------------------------------------------------
// Read model rendered by the V2 screens
// ---------------------------------------------------------------------------

export interface MarketplacePay {
  /** Poster-stated amount in whole cents; `null` when not stated — never estimated or derived. */
  amountCents: number | null
  unit: MarketplacePayUnit | null
}

export interface MarketplaceJobCardView {
  id: string
  slug: string
  title: string
  posterOrganizationId: string
  posterName: string
  posterVerified: boolean
  product: string | null
  pay: MarketplacePay
  equipment: string[]
  /** Public, approximate origin. Exact coordinates and access details are never part of this view. */
  origin: { label: string; stateCode: string | null; approximatePoint: { lat: number; lng: number } | null }
  destinationLabel: string | null
  haulDistance: { miles: number; basis: "poster_route_estimate" | "straight_line_estimate" } | null
  startsOn: string | null
  endsOn: string | null
  scheduleNote: string | null
  trucksRequested: { count: number; per: "day" | "job" } | null
  /** Poster estimates only; `null` when the poster did not provide them. Not platform-tracked actuals. */
  estimatedDailyLoads: number | null
  estimatedTonsPerLoad: number | null
  status: MarketplaceJobStatus
  acceptingInterest: boolean
  /** When the poster last changed or reconfirmed the listing. */
  lastConfirmedAt: string
  sponsored: boolean
}

export interface MarketplaceJobDetailView extends MarketplaceJobCardView {
  /** Public-safe road/access summary (UX spec §8.21: "Public safe summary"). */
  publicRoadNotes: string | null
  publicAccessRequirements: string[]
}

export interface MarketplaceInterestView {
  id: string
  job: { id: string; slug: string; title: string; status: MarketplaceJobStatus; acceptingInterest: boolean }
  landingOrganization: { id: string; name: string }
  haulerOrganization: { id: string; name: string; type: string }
  submittedBy: { userId: string; name: string }
  trucksOffered: number
  availableFrom: string | null
  message: string | null
  contactPreference: MarketplaceContactPreference
  status: MarketplaceInterestStatus
  replies: Array<MarketplaceInterestReply & { authorName: string }>
  createdAt: string
  updatedAt: string
}

export interface MarketplaceJobFilters {
  query?: string | null
  equipment?: string | null
  payUnit?: MarketplacePayUnit | null
  /** Default true: closed, paused, filled and expired jobs are hidden from discovery. */
  acceptingOnly?: boolean
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const usd = new Intl.NumberFormat("en-US", { currency: "USD", style: "currency" })

/** "$525.00 per load", or an honest "Pay not stated" — never a guessed figure (UX spec §8.4). */
export function formatMarketplacePay(pay: MarketplacePay): string {
  if (pay.amountCents === null || pay.unit === null) {
    return "Pay not stated"
  }

  return `${usd.format(pay.amountCents / 100)} ${MARKETPLACE_PAY_UNIT_LABELS[pay.unit]}`
}

export type PostingFreshness = "today" | "this_week" | "aging" | "stale"

/** Freshness of the poster's last confirmation. Thresholds are display bands, not an expiry policy (§16.2). */
export function postingFreshness(lastConfirmedAt: string, now: string): { band: PostingFreshness; label: string } {
  const ageMs = Date.parse(now) - Date.parse(lastConfirmedAt)

  if (Number.isNaN(ageMs)) {
    throw new RangeError("Both instants must be ISO 8601 timestamps")
  }

  const days = Math.floor(Math.max(0, ageMs) / 86_400_000)

  if (days < 1) return { band: "today", label: "Updated today" }
  if (days < 7) return { band: "this_week", label: `Updated ${days} day${days === 1 ? "" : "s"} ago` }
  if (days < 30) return { band: "aging", label: `Updated ${days} days ago` }
  return { band: "stale", label: `Not updated in ${days} days — confirm with the poster` }
}

export function marketplaceJobAcceptsInterest(status: MarketplaceJobStatus): boolean {
  return status === "active"
}

function normalized(value: string): string {
  return value.trim().toLowerCase()
}

/** Text, equipment and pay-basis filtering. Pay amounts on different bases are never compared. */
export function filterMarketplaceJobs<T extends MarketplaceJobCardView>(jobs: readonly T[], filters: MarketplaceJobFilters = {}): T[] {
  const query = filters.query ? normalized(filters.query) : ""
  const equipment = filters.equipment ? normalized(filters.equipment) : ""
  const acceptingOnly = filters.acceptingOnly ?? true

  return jobs.filter((job) => {
    if (acceptingOnly && !job.acceptingInterest) return false
    if (filters.payUnit && job.pay.unit !== filters.payUnit) return false
    if (equipment && !job.equipment.some((item) => normalized(item) === equipment)) return false
    if (!query) return true

    return [job.title, job.posterName, job.product ?? "", job.origin.label, job.destinationLabel ?? "", ...job.equipment]
      .some((field) => normalized(field).includes(query))
  })
}

/** Most recently confirmed first; sponsored placement is not applied here (no boosts are active). */
export function sortMarketplaceJobs<T extends MarketplaceJobCardView>(jobs: readonly T[]): T[] {
  return [...jobs].sort((a, b) => Date.parse(b.lastConfirmedAt) - Date.parse(a.lastConfirmedAt) || a.title.localeCompare(b.title))
}

export type LandingInterestQueue = "new" | "responded" | "closed"

/** Landing inbox queues (UX spec §4.7): New, Responded, Closed. */
export function landingInterestQueue(status: MarketplaceInterestStatus): LandingInterestQueue {
  if (status === "submitted") return "new"
  if (status === "viewed" || status === "replied") return "responded"
  return "closed"
}

export const MARKETPLACE_INTEREST_STATUS_LABELS: Readonly<Record<MarketplaceInterestStatus, string>> = Object.freeze({
  declined: "Declined by landing",
  replied: "Landing replied",
  submitted: "Sent — awaiting review",
  viewed: "Viewed by landing",
  withdrawn: "Withdrawn"
})
