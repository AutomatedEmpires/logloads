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
 * settlements or billing events. Unknown values stay `null` and are shown as unknown.
 */

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime()

/** Pay bases match `marketplace.job_postings.pay_unit` in the normalized-v2 prototype. */
export const marketplacePayUnitSchema = z.enum([
  "per_load",
  "per_ton",
  "per_mbf",
  "per_cord",
  "per_mile",
  "per_hour",
  "per_day",
  "flat_rate",
  "negotiable",
  "other"
])
export type MarketplacePayUnit = z.infer<typeof marketplacePayUnitSchema>

export const MARKETPLACE_PAY_UNIT_LABELS: Readonly<Record<MarketplacePayUnit, string>> = Object.freeze({
  flat_rate: "flat rate",
  negotiable: "negotiable",
  other: "other basis",
  per_cord: "per cord",
  per_day: "per day",
  per_hour: "per hour",
  per_load: "per load",
  per_mbf: "per MBF",
  per_mile: "per mile",
  per_ton: "per ton"
})

/**
 * Equipment reference codes — the rows seeded into `marketplace.equipment_types` by the normalized-v2
 * prototype (03_entitlements.sql). Reference data shared with that schema, not a second taxonomy.
 */
export const MARKETPLACE_EQUIPMENT_TYPES = [
  { category: "truck", code: "log_truck", label: "Log truck" },
  { category: "truck", code: "self_loader", label: "Self-loader log truck" },
  { category: "truck", code: "chip_truck", label: "Chip truck" },
  { category: "truck", code: "lowboy_tractor", label: "Lowboy / heavy haul" },
  { category: "trailer", code: "pole_trailer", label: "Pole trailer" },
  { category: "trailer", code: "bunk_trailer", label: "Bunk / short-log" },
  { category: "trailer", code: "mule_train", label: "Mule train" },
  { category: "trailer", code: "chip_van", label: "Chip van" },
  { category: "trailer", code: "lowboy_trailer", label: "Lowboy trailer" },
  { category: "attachment", code: "onboard_scales", label: "On-board scales" },
  { category: "attachment", code: "central_tire", label: "Central tire inflation" }
] as const satisfies ReadonlyArray<{ category: "truck" | "trailer" | "attachment"; code: string; label: string }>

export type MarketplaceEquipmentCode = (typeof MARKETPLACE_EQUIPMENT_TYPES)[number]["code"]
export const marketplaceEquipmentCodeSchema = z.enum(
  MARKETPLACE_EQUIPMENT_TYPES.map((type) => type.code) as [MarketplaceEquipmentCode, ...MarketplaceEquipmentCode[]]
)

export function marketplaceEquipmentLabel(code: string): string {
  return MARKETPLACE_EQUIPMENT_TYPES.find((type) => type.code === code)?.label ?? code.replace(/[_-]+/g, " ")
}

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

/**
 * One equipment configuration the hauler offers, as SELF-REPORTED by the hauling business from its own
 * profile at the time of the inquiry. `label` is a snapshot so later profile edits do not rewrite what
 * the landing was told. It is not validated live inventory or availability.
 */
export const marketplaceInterestEquipmentSchema = z.object({
  configurationKey: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(160),
  count: z.number().int().min(1).max(500)
})
export type MarketplaceInterestEquipment = z.infer<typeof marketplaceInterestEquipmentSchema>

/** One live expression of interest per (job, hauler organization); resubmission updates it. */
export const marketplaceInterestSchema = z.object({
  id: uuidSchema,
  loadPostingId: uuidSchema,
  jobOrganizationId: uuidSchema,
  haulerOrganizationId: uuidSchema,
  submittedByUserId: uuidSchema,
  /** Self-reported number of trucks offered (not verified inventory). */
  trucksOffered: z.number().int().min(1).max(500),
  /** Equipment configurations from the hauler's own profile; empty when none were selected. */
  equipment: z.array(marketplaceInterestEquipmentSchema).max(20).default([]),
  availableFrom: z.string().date().nullable(),
  availableUntil: z.string().date().nullable().default(null),
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
}).refine((row) => row.equipment.length === 0 || row.equipment.reduce((sum, line) => sum + line.count, 0) === row.trucksOffered, {
  message: "Trucks offered must equal the trucks listed per equipment configuration",
  path: ["trucksOffered"]
}).refine((row) => !row.availableFrom || !row.availableUntil || row.availableUntil >= row.availableFrom, {
  message: "Available until must not be before available from",
  path: ["availableUntil"]
})
export type MarketplaceInterest = z.infer<typeof marketplaceInterestSchema>

// ---------------------------------------------------------------------------
// Inputs (actor identity always comes from the server session, never the form)
// ---------------------------------------------------------------------------

const optionalDateInput = z.preprocess((value) => (value === "" ? null : value), z.string().date().nullable().optional())

/**
 * The hauler's short, nonbinding inquiry. Either state a truck count, or pick counts per equipment
 * configuration from the business profile (the total is then their sum). `equipment` carries only
 * configuration keys and counts — labels and limits are resolved server-side from the profile.
 */
export const expressInterestInputSchema = z.object({
  loadPostingId: uuidSchema,
  trucksOffered: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.coerce.number().int().min(1).max(500).optional()
  ),
  equipment: z.array(z.object({
    configurationKey: z.string().trim().min(1).max(200),
    count: z.coerce.number().int().min(0).max(500)
  })).max(20).default([]),
  availableFrom: optionalDateInput,
  availableUntil: optionalDateInput,
  message: z.string().trim().max(2000).optional().transform((value) => (value ? value : null)),
  contactPreference: marketplaceContactPreferenceSchema.default("in_app")
})
  .transform((input) => ({ ...input, equipment: input.equipment.filter((line) => line.count > 0) }))
  .refine((input) => input.equipment.length > 0 || input.trucksOffered !== undefined, {
    message: "Enter how many trucks you can offer",
    path: ["trucksOffered"]
  })
  .refine((input) => input.equipment.reduce((sum, line) => sum + line.count, 0) <= 500, {
    message: "Offer at most 500 trucks",
    path: ["equipment"]
  })
  .refine((input) => new Set(input.equipment.map((line) => line.configurationKey)).size === input.equipment.length, {
    message: "List each equipment configuration once",
    path: ["equipment"]
  })
  .refine((input) => !input.availableFrom || !input.availableUntil || input.availableUntil >= input.availableFrom, {
    message: "Available until must not be before available from",
    path: ["availableUntil"]
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
  /** Poster-stated amount in whole cents; `null` when not stated or negotiable — never estimated or derived. */
  amountCents: number | null
  unit: MarketplacePayUnit | null
  /** Poster's own words on pay (required for negotiable pay); `null` when absent. */
  note: string | null
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
  /**
   * Truck demand as the poster stated it. `total` is trucks wanted for the whole job
   * (`job_postings.trucks_requested`); `perDay` is trucks needed on a working day. Either may be
   * unknown (`null`); one is never derived from the other.
   */
  trucks: { total: number | null; perDay: number | null }
  /** Poster estimates only; `null` when not provided. Never platform-tracked actuals or derived values. */
  estimatedLoadsPerTruckPerDay: number | null
  /** Whole-job loads per working day (`job_postings.est_daily_loads`). */
  estimatedDailyLoads: number | null
  estimatedTonsPerLoad: number | null
  status: MarketplaceJobStatus
  acceptingInterest: boolean
  /** Any edit to the listing. Never evidence that the work is still available. */
  lastModifiedAt: string
  /** The poster's explicit "still available" confirmation; `null` when never confirmed. */
  lastConfirmedAt: string | null
  /** When the listing stops accepting interest by itself; `null` when no expiry is set. */
  expiresAt: string | null
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
  /** Self-reported by the hauling business; not verified inventory. */
  trucksOffered: number
  equipment: MarketplaceInterestEquipment[]
  availableFrom: string | null
  availableUntil: string | null
  message: string | null
  contactPreference: MarketplaceContactPreference
  status: MarketplaceInterestStatus
  replies: Array<MarketplaceInterestReply & { authorName: string }>
  createdAt: string
  updatedAt: string
}

/** One equipment configuration from the hauler's own business profile, offered in the inquiry form. */
export interface MarketplaceHaulerEquipmentOption {
  configurationKey: string
  label: string
  /** Units of this configuration listed in the business profile (self-reported). */
  unitsListed: number
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

/**
 * "$525.00 per load", "Negotiable — depends on haul length", or an honest "Pay not stated" — never a
 * guessed figure (UX spec §8.4). Amounts on different bases are never converted into one another.
 */
export function formatMarketplacePay(pay: MarketplacePay): string {
  if (pay.unit === "negotiable") {
    return pay.note ? `Negotiable — ${pay.note}` : "Negotiable"
  }

  if (pay.amountCents === null || pay.unit === null) {
    return "Pay not stated"
  }

  const amount = usd.format(pay.amountCents / 100)
  return pay.unit === "flat_rate" ? `${amount} flat rate` : `${amount} ${MARKETPLACE_PAY_UNIT_LABELS[pay.unit]}`
}

export type PostingFreshness = "confirmed_recently" | "confirmed_aging" | "unconfirmed" | "expired"

/** Days after which an explicit confirmation is shown as aging rather than recent. A display band only. */
export const RECENT_CONFIRMATION_DAYS = 7

function wholeDaysBetween(from: string, to: string): number {
  const ms = Date.parse(to) - Date.parse(from)

  if (Number.isNaN(ms)) {
    throw new RangeError("Both instants must be ISO 8601 timestamps")
  }

  return Math.floor(Math.max(0, ms) / 86_400_000)
}

function agoLabel(days: number): string {
  return days < 1 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`
}

/**
 * What a listing can honestly say about its own currency. Only an explicit poster confirmation can
 * produce a "confirmed" label; an edit is reported as an edit. Display bands, not an expiry policy
 * (Blueprint §16.2).
 */
export function postingFreshness(
  job: Pick<MarketplaceJobCardView, "lastModifiedAt" | "lastConfirmedAt" | "expiresAt">,
  now: string
): { band: PostingFreshness; label: string } {
  if (job.expiresAt && Date.parse(job.expiresAt) <= Date.parse(now)) {
    return { band: "expired", label: "Listing expired" }
  }

  if (job.lastConfirmedAt) {
    const days = wholeDaysBetween(job.lastConfirmedAt, now)
    return days < RECENT_CONFIRMATION_DAYS
      ? { band: "confirmed_recently", label: `Poster confirmed available ${agoLabel(days)}` }
      : { band: "confirmed_aging", label: `Last confirmed ${agoLabel(days)} — check with the poster` }
  }

  return { band: "unconfirmed", label: `Not confirmed by poster · edited ${agoLabel(wholeDaysBetween(job.lastModifiedAt, now))}` }
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

/**
 * Explicitly confirmed listings first (most recent confirmation first), then unconfirmed ones by
 * last edit. An edit never outranks a confirmation. Sponsored placement is not applied (no boosts).
 */
export function sortMarketplaceJobs<T extends MarketplaceJobCardView>(jobs: readonly T[]): T[] {
  return [...jobs].sort((a, b) => {
    if (a.lastConfirmedAt && !b.lastConfirmedAt) return -1
    if (!a.lastConfirmedAt && b.lastConfirmedAt) return 1
    const aKey = a.lastConfirmedAt ?? a.lastModifiedAt
    const bKey = b.lastConfirmedAt ?? b.lastModifiedAt
    return Date.parse(bKey) - Date.parse(aKey) || a.title.localeCompare(b.title)
  })
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
