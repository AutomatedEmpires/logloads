import { z } from "zod"

import { haversineMiles, type Coordinates } from "./geo"

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

/**
 * Product types (UX-DEC-03): a controlled list, stored as its label in the existing `job_postings.product`
 * text column. "Other" is described by the poster (up to 120 characters) and that description is stored.
 * The list lives here, next to the equipment types, so the editor and the filters share one source.
 */
export const MARKETPLACE_PRODUCTS = [
  "Saw logs",
  "Pulpwood",
  "Poles and pilings",
  "Chips",
  "Hog fuel and biomass",
  "Hardwood logs",
  "Other"
] as const

export type MarketplaceProduct = (typeof MARKETPLACE_PRODUCTS)[number]
export const MARKETPLACE_OTHER_PRODUCT: MarketplaceProduct = "Other"
export const marketplaceProductSchema = z.enum(MARKETPLACE_PRODUCTS)

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

/**
 * The checks LogLoads actually performs. A verification mark names exactly one of these. It never implies
 * operating authority, insurance, equipment, safety or employment (Blueprint §10.2; UX spec §7.2, §8.17).
 */
export const MARKETPLACE_VERIFICATION_SCOPES = ["business_identity"] as const
export type MarketplaceVerificationScope = (typeof MARKETPLACE_VERIFICATION_SCOPES)[number]

export const MARKETPLACE_VERIFICATION_SCOPE_LABELS: Record<MarketplaceVerificationScope, string> = {
  business_identity: "Business identity"
}

/** What LogLoads checked about a business, and when. `null` on a view means nothing is claimed. */
export interface MarketplaceVerification {
  scope: MarketplaceVerificationScope
  /** UTC calendar date (YYYY-MM-DD) of the review that confirmed the scope; `null` when no review date is on record. */
  reviewedOn: string | null
}

const REVIEWED_ON_FORMAT = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC", year: "numeric" })

/** Mark text that says what was checked, and the longer statement for its tooltip or detail line. */
export function describeMarketplaceVerification(verification: MarketplaceVerification): { label: string; statement: string } {
  const scope = MARKETPLACE_VERIFICATION_SCOPE_LABELS[verification.scope]
  const reviewed = verification.reviewedOn
    ? REVIEWED_ON_FORMAT.format(new Date(`${verification.reviewedOn.slice(0, 10)}T00:00:00.000Z`))
    : null

  return {
    label: `${scope} verified`,
    statement: reviewed ? `${scope} reviewed by LogLoads on ${reviewed}.` : `${scope} reviewed by LogLoads.`
  }
}

export interface MarketplaceJobCardView {
  id: string
  slug: string
  title: string
  posterOrganizationId: string
  posterName: string
  /** Scope-specific verification of the posting business; `null` when nothing was verified or it cannot be confirmed. */
  posterVerification: MarketplaceVerification | null
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
  /**
   * The configuration's truck, trailer and attachment codes from `MARKETPLACE_EQUIPMENT_TYPES`, for advisory fit
   * against a job's equipment. Parts outside that taxonomy are left out, never guessed.
   */
  equipmentCodes: string[]
}

/** Discovery orders (UX 02 §A6): newest confirmed, nearest, and pay compared within one basis only. */
export const MARKETPLACE_JOB_SORTS = ["newest", "nearest", "pay"] as const
export type MarketplaceJobSort = (typeof MARKETPLACE_JOB_SORTS)[number]

export interface MarketplaceJobFilters {
  query?: string | null
  /** One equipment code: jobs that list it. */
  equipment?: string | null
  /**
   * The viewer's own equipment setups, each a list of equipment codes ("My trucks"). Hides jobs that ask for
   * equipment no single setup has. Jobs that state no equipment stay in: nothing says they need other trucks.
   */
  equipmentSetups?: ReadonlyArray<readonly string[]> | null
  payUnit?: MarketplacePayUnit | null
  /** One of `MARKETPLACE_PRODUCTS`, matched without case; "Other" matches any stated product outside the named list. */
  product?: string | null
  /**
   * UTC calendar date (YYYY-MM-DD): jobs whose stated start is on or before it, including work already under way.
   * Jobs that state no start are hidden while it is set, because nothing says they start in time.
   */
  startsBy?: string | null
  /**
   * The search origin: a place the user typed (town or ZIP), never a device location. It is snapped to the public
   * 0.1° grid before any distance is measured, as `search_job_postings` does with `p_point`.
   */
  near?: Coordinates | null
  /**
   * With `near`: keep jobs whose public point is within this many miles, plus `MARKETPLACE_RADIUS_BUFFER_MILES`.
   * Null or absent: any distance (the normalized adapter passes its 500-mile maximum). Ignored without `near`.
   */
  radiusMiles?: number | null
  /** Default true: closed, paused, filled and expired jobs are hidden from discovery. */
  acceptingOnly?: boolean
  /** Default "newest". "nearest" without `near` falls back to "newest". */
  sort?: MarketplaceJobSort | null
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

// ---------------------------------------------------------------------------
// Approximate distance (V2-DEC-01): public points only, on the 0.1° grid
// ---------------------------------------------------------------------------

/** The public location grid: every public point is rounded to the nearest 0.1° (about 7 mi east–west here). */
export const MARKETPLACE_PUBLIC_GRID_DEGREES = 0.1

/**
 * The 8,000 m (about 5 mi) that `search_job_postings` adds to every radius check, so snapping both ends to the
 * 0.1° grid never silently drops a job near the edge of the radius.
 */
export const MARKETPLACE_RADIUS_BUFFER_MILES = 8_000 / 1_609.344

function snapCoordinate(value: number): number {
  // Halves round away from zero, as SQL `round(coord, 1)` (`quantize_public_coordinate`) and the pilot's
  // `approximateCoordinate` do, so a search origin lands in the same cell in every layer.
  const magnitude = Math.round(Math.abs(value) * 10) / 10
  return value < 0 && magnitude !== 0 ? -magnitude : magnitude
}

/** A point snapped to the public 0.1° grid. A search origin is snapped before any distance is measured. */
export function snapToPublicGrid(point: Coordinates): Coordinates {
  return { lat: snapCoordinate(point.lat), lng: snapCoordinate(point.lng) }
}

function exactMilesToPublicPoint(from: Coordinates, job: Pick<MarketplaceJobCardView, "origin">): number | null {
  const point = job.origin.approximatePoint
  return point ? haversineMiles(snapToPublicGrid(from), point) : null
}

/**
 * Whole miles from a search origin to a job's approximate public point, both on the 0.1° grid; null when the job
 * has no public point. It measures grid cells, never a site, so callers label it as approximate ("about 18 mi").
 */
export function marketplaceDistanceMiles(from: Coordinates, job: Pick<MarketplaceJobCardView, "origin">): number | null {
  const miles = exactMilesToPublicPoint(from, job)
  return miles === null ? null : Math.round(miles)
}

// ---------------------------------------------------------------------------
// Equipment fit: advisory, from the viewer's own self-reported setups
// ---------------------------------------------------------------------------

export type MarketplaceEquipmentFit = "fits" | "not_in_setups"

/**
 * Whether one of the viewer's setups has every piece of equipment a job lists. Advisory only: it compares
 * self-reported codes and never claims the hauler is qualified (UX 02 §A6, spec §10.4). Null when the job states no
 * equipment or the viewer has listed none, because there is nothing to compare.
 */
export function marketplaceEquipmentFit(
  jobEquipment: readonly string[],
  setups: ReadonlyArray<readonly string[]>
): MarketplaceEquipmentFit | null {
  const needed = Array.from(new Set(jobEquipment.map(normalized)))
  const listed = setups.map((setup) => new Set(setup.map(normalized))).filter((setup) => setup.size > 0)

  if (needed.length === 0 || listed.length === 0) return null
  return listed.some((setup) => needed.every((code) => setup.has(code))) ? "fits" : "not_in_setups"
}

const NAMED_PRODUCTS = new Set(MARKETPLACE_PRODUCTS.filter((product) => product !== MARKETPLACE_OTHER_PRODUCT).map(normalized))

function matchesProduct(product: string | null, wanted: string): boolean {
  const stated = product ? normalized(product) : ""
  if (normalized(wanted) === normalized(MARKETPLACE_OTHER_PRODUCT)) return stated !== "" && !NAMED_PRODUCTS.has(stated)
  return stated === normalized(wanted)
}

/**
 * Discovery filtering: text, equipment (one code, or fit against the viewer's setups), product, pay basis, start
 * and distance from a typed place. Pay amounts on different bases are never compared, and distance only ever uses
 * the job's approximate public point.
 */
export function filterMarketplaceJobs<T extends MarketplaceJobCardView>(jobs: readonly T[], filters: MarketplaceJobFilters = {}): T[] {
  const query = filters.query ? normalized(filters.query) : ""
  const equipment = filters.equipment ? normalized(filters.equipment) : ""
  const setups = filters.equipmentSetups ?? null
  const acceptingOnly = filters.acceptingOnly ?? true
  const startsBy = filters.startsBy ? filters.startsBy.slice(0, 10) : null
  const near = filters.near ?? null
  const radius = near && filters.radiusMiles !== null && filters.radiusMiles !== undefined ? filters.radiusMiles : null

  return jobs.filter((job) => {
    if (acceptingOnly && !job.acceptingInterest) return false
    if (filters.payUnit && job.pay.unit !== filters.payUnit) return false
    if (equipment && !job.equipment.some((item) => normalized(item) === equipment)) return false
    if (setups && marketplaceEquipmentFit(job.equipment, setups) === "not_in_setups") return false
    if (filters.product && !matchesProduct(job.product, filters.product)) return false
    if (startsBy && (!job.startsOn || job.startsOn.slice(0, 10) > startsBy)) return false
    if (near && radius !== null) {
      const miles = exactMilesToPublicPoint(near, job)
      if (miles === null || miles > radius + MARKETPLACE_RADIUS_BUFFER_MILES) return false
    }
    if (!query) return true

    return [
      job.title,
      job.posterName,
      job.product ?? "",
      job.origin.label,
      job.destinationLabel ?? "",
      ...job.equipment,
      ...job.equipment.map(marketplaceEquipmentLabel)
    ].some((field) => normalized(field).includes(query))
  })
}

function newestFirst(a: MarketplaceJobCardView, b: MarketplaceJobCardView): number {
  if (a.lastConfirmedAt && !b.lastConfirmedAt) return -1
  if (!a.lastConfirmedAt && b.lastConfirmedAt) return 1
  const aKey = a.lastConfirmedAt ?? a.lastModifiedAt
  const bKey = b.lastConfirmedAt ?? b.lastModifiedAt
  return Date.parse(bKey) - Date.parse(aKey) || a.title.localeCompare(b.title)
}

/** A stated amount on a comparable basis; negotiable, "other" and unstated pay have none. */
function comparablePay(job: MarketplaceJobCardView): { unit: MarketplacePayUnit; cents: number } | null {
  const { amountCents, unit } = job.pay
  return amountCents !== null && unit !== null && unit !== "negotiable" && unit !== "other" ? { cents: amountCents, unit } : null
}

const PAY_UNIT_ORDER = marketplacePayUnitSchema.options

/**
 * The distinct pay bases that have a stated, comparable amount, in a fixed order. More than one means the list
 * mixes bases and pay can only be compared within each ("Rates use different bases", spec §10.5).
 */
export function marketplaceComparablePayUnits(jobs: readonly MarketplaceJobCardView[]): MarketplacePayUnit[] {
  const units = new Set(jobs.flatMap((job) => comparablePay(job)?.unit ?? []))
  return PAY_UNIT_ORDER.filter((unit) => units.has(unit))
}

/**
 * Discovery order.
 * - "newest" (default): explicitly confirmed listings first (most recent confirmation first), then unconfirmed ones
 *   by last edit. An edit never outranks a confirmation.
 * - "nearest": by approximate distance from `near` (jobs without a public point last), then newest. Without `near`
 *   it is "newest".
 * - "pay": grouped by basis in a fixed order, highest stated amount first within each basis; jobs without a
 *   comparable amount (negotiable, other, not stated) last. Amounts on different bases are never compared.
 * Sponsored placement is not applied (no boosts).
 */
export function sortMarketplaceJobs<T extends MarketplaceJobCardView>(
  jobs: readonly T[],
  options: Pick<MarketplaceJobFilters, "near" | "sort"> = {}
): T[] {
  const sort = options.sort ?? "newest"
  const near = options.near ?? null

  if (sort === "nearest" && near) {
    const miles = new Map(jobs.map((job) => [job.id, exactMilesToPublicPoint(near, job)]))
    return [...jobs].sort((a, b) => {
      const aMiles = miles.get(a.id) ?? null
      const bMiles = miles.get(b.id) ?? null
      if (aMiles !== null && bMiles === null) return -1
      if (aMiles === null && bMiles !== null) return 1
      return (aMiles ?? 0) - (bMiles ?? 0) || newestFirst(a, b)
    })
  }

  if (sort === "pay") {
    return [...jobs].sort((a, b) => {
      const aPay = comparablePay(a)
      const bPay = comparablePay(b)
      if (aPay && !bPay) return -1
      if (!aPay && bPay) return 1
      if (!aPay || !bPay) return newestFirst(a, b)
      return PAY_UNIT_ORDER.indexOf(aPay.unit) - PAY_UNIT_ORDER.indexOf(bPay.unit) || bPay.cents - aPay.cents || newestFirst(a, b)
    })
  }

  return [...jobs].sort(newestFirst)
}

// ---------------------------------------------------------------------------
// Status vocabulary (UX-DEC-01, #135): one set of words for interests and jobs
// ---------------------------------------------------------------------------
//
// Every V2 screen takes its status wording from here, so the hauler, the landing, the spec and the code use the
// same words for the same states (docs/DECISIONS.md, 2026-11-03). The stored statuses are unchanged. Two rules
// shape the wording: an inquiry is marketplace communication, so nothing reads as hired, booked or assigned; and
// `filled` is the poster's claim, never a verified fact (UX spec §4.6).

/** Which side of an inquiry the viewer is on, or which side wrote a reply. */
export type MarketplaceInterestSide = MarketplaceInterestReply["authorSide"]

/** "attention": the viewer's move. "waiting": the other side's move. "closed": nothing more to do. */
export type MarketplaceInterestTone = "attention" | "waiting" | "closed"

export interface MarketplaceInterestStatusDescription {
  label: string
  tone: MarketplaceInterestTone
}

/** What the status vocabulary reads from an inquiry: the stored status and who wrote each reply, when. */
export interface MarketplaceInterestTurnFields {
  status: MarketplaceInterestStatus
  replies: ReadonlyArray<Pick<MarketplaceInterestReply, "authorSide" | "createdAt">>
}

/** The side that wrote the latest reply, or null when nobody has replied. On equal times the later entry wins. */
export function lastMarketplaceInterestReplySide(interest: Pick<MarketplaceInterestTurnFields, "replies">): MarketplaceInterestSide | null {
  let latest: MarketplaceInterestTurnFields["replies"][number] | null = null

  for (const reply of interest.replies) {
    if (!latest || Date.parse(reply.createdAt) >= Date.parse(latest.createdAt)) latest = reply
  }

  return latest ? latest.authorSide : null
}

/**
 * An inquiry's status for one side (UX-DEC-01). A `replied` inquiry is the hauler's turn when the landing spoke
 * last and the landing's turn when the hauler did; `replied` is stored when the landing replies, so with no
 * replies at hand it reads as the landing having spoken last. A decline is final (HF-03), so it is `closed`
 * whoever spoke last.
 */
export function describeMarketplaceInterestStatus(
  interest: MarketplaceInterestTurnFields,
  side: MarketplaceInterestSide
): MarketplaceInterestStatusDescription {
  const hauler = side === "hauler"

  switch (interest.status) {
    case "submitted":
      return hauler ? { label: "Sent · waiting for the landing", tone: "waiting" } : { label: "New", tone: "attention" }
    case "viewed":
      return hauler ? { label: "Seen by the landing", tone: "waiting" } : { label: "Seen · not answered", tone: "attention" }
    case "replied": {
      const landingSpokeLast = lastMarketplaceInterestReplySide(interest) !== "hauler"
      if (hauler) return landingSpokeLast ? { label: "Your turn", tone: "attention" } : { label: "Waiting for the landing", tone: "waiting" }
      return landingSpokeLast ? { label: "Waiting for the hauler", tone: "waiting" } : { label: "Hauler replied", tone: "attention" }
    }
    case "declined":
      return { label: hauler ? "Declined by the landing" : "Declined", tone: "closed" }
    case "withdrawn":
      return { label: hauler ? "Withdrawn by you" : "Withdrawn by the hauler", tone: "closed" }
  }
}

/** Submitted, viewed and replied inquiries are open: both sides can still write, and the hauler can withdraw. */
export function marketplaceInterestIsOpen(status: MarketplaceInterestStatus): boolean {
  return status === "submitted" || status === "viewed" || status === "replied"
}

/**
 * A decline is final for that job (HF-03, #194): the hauler can't withdraw it or send interest again, and nobody
 * can reply. A withdrawal is closed but not final, because the hauler can send interest again, which reopens it.
 */
export function marketplaceInterestIsFinal(status: MarketplaceInterestStatus): boolean {
  return status === "declined"
}

/**
 * Landing inbox queues (UX-DEC-01). The `responded` key predates the decision and is kept for callers; its
 * heading is "Replied" (`LANDING_INTEREST_QUEUE_LABELS`).
 */
export type LandingInterestQueue = "new" | "responded" | "closed"

export const LANDING_INTEREST_QUEUE_LABELS: Readonly<Record<LandingInterestQueue, string>> = Object.freeze({
  closed: "Closed",
  new: "New",
  responded: "Replied"
})

/**
 * The landing inbox queue from the stored status alone (UX-DEC-01): submitted and viewed are New (a viewed
 * inquiry is seen, not answered), replied is Replied, declined and withdrawn are Closed. A replied inquiry whose
 * last message is the hauler's belongs back in New, which the status can't show: use `landingInterestQueueFor`
 * when the replies are at hand.
 */
export function landingInterestQueue(status: MarketplaceInterestStatus): LandingInterestQueue {
  if (status === "submitted" || status === "viewed") return "new"
  if (status === "replied") return "responded"
  return "closed"
}

/** The landing inbox queue with the turn (UX-DEC-01): a replied inquiry goes back to New when the hauler spoke last. */
export function landingInterestQueueFor(interest: MarketplaceInterestTurnFields): LandingInterestQueue {
  const queue = landingInterestQueue(interest.status)
  return queue === "responded" && lastMarketplaceInterestReplySide(interest) === "hauler" ? "new" : queue
}

/**
 * @deprecated Status-only hauler wording, kept for existing callers. It can't tell whose turn a replied inquiry is
 * (it reads as the landing having spoken last); use `describeMarketplaceInterestStatus`.
 */
export const MARKETPLACE_INTEREST_STATUS_LABELS: Readonly<Record<MarketplaceInterestStatus, string>> = Object.freeze(
  Object.fromEntries(
    marketplaceInterestStatusSchema.options.map((status) => [status, describeMarketplaceInterestStatus({ replies: [], status }, "hauler").label])
  ) as Record<MarketplaceInterestStatus, string>
)

/**
 * A listing's status as haulers, the public and the poster's own job list read it (UX-DEC-01). Each state the
 * poster sets is attributed to the poster. "filled" is the poster's claim; LogLoads does not check it.
 */
export const MARKETPLACE_JOB_STATUS_LABELS: Readonly<Record<MarketplaceJobStatus, string>> = Object.freeze({
  active: "Accepting interest",
  closed: "Closed by the poster",
  expired: "Listing expired",
  filled: "Marked filled by the poster",
  paused: "Paused by the poster"
})

const MARKETPLACE_JOB_CLOSED_REASONS: Readonly<Record<MarketplaceJobStatus, string | null>> = Object.freeze({
  active: null,
  closed: "The poster closed this listing.",
  expired: "This listing expired.",
  filled: "The poster marked this job filled.",
  paused: "The poster paused this listing."
})

/**
 * Why a listing takes no new interest, as a sentence (UX spec §5.3: block new interest and show the reason); null
 * while it accepts interest.
 */
export function marketplaceJobClosedReason(status: MarketplaceJobStatus): string | null {
  return MARKETPLACE_JOB_CLOSED_REASONS[status]
}

// ---------------------------------------------------------------------------
// Inquiry conversations (UX-09, #132): queues, turn, unread, equipment fit and closing with a reason
// ---------------------------------------------------------------------------

export type HaulerInterestQueue = "active" | "replied" | "closed"

/**
 * The hauler's tabs (UX 02 §A9): Active until the landing replies, Replied once it has (each row then says whose
 * turn it is), Closed when the landing declined or the hauler withdrew.
 */
export function haulerInterestQueue(status: MarketplaceInterestStatus): HaulerInterestQueue {
  switch (status) {
    case "submitted":
    case "viewed":
      return "active"
    case "replied":
      return "replied"
    case "declined":
    case "withdrawn":
      return "closed"
  }
}

/**
 * Whether an inquiry is unread for one side, which is what the navigation counts. LogLoads keeps no per-person read
 * receipts, so "unread" is what the stored status and the thread can prove:
 * - landing: in New and not marked reviewed — a new inquiry, or a hauler message after the landing's last reply;
 * - hauler: the landing spoke last on an open inquiry ("Your turn").
 */
export function marketplaceInquiryUnread(interest: Pick<MarketplaceInterestView, "status" | "replies">, side: "hauler" | "landing"): boolean {
  if (side === "landing") {
    return landingInterestQueueFor(interest) === "new" && interest.status !== "viewed"
  }

  return interest.status === "replied" && lastMarketplaceInterestReplySide(interest) === "landing"
}

/**
 * The hauler withdraws, optionally saying why. The reason is posted to the thread as the hauler's last message, in
 * the same change as the withdrawal, so the landing sees it; `replyId` (server-generated per render) makes a
 * repeated submit idempotent.
 */
export const withdrawInterestInputSchema = z.object({
  interestId: uuidSchema,
  replyId: uuidSchema.optional(),
  reason: z.string().trim().max(2000).optional().transform((value) => (value ? value : null))
}).refine((input) => !input.reason || input.replyId, {
  message: "A reason needs a reply id",
  path: ["replyId"]
})
export type WithdrawInterestInput = z.infer<typeof withdrawInterestInputSchema>

/**
 * One of the landing organization's jobs as its inbox needs it: the landing (site) it is posted at, for the landing
 * filter, and the equipment codes it asks for, to compare with what haulers offer. `equipmentCodes` is `null` when
 * the store holds no comparable equipment list for the job (the pilot store's free-text requirements).
 */
export interface MarketplaceInquiryJobContext {
  jobId: string
  landing: { id: string; name: string } | null
  equipmentCodes: string[] | null
}

export type MarketplaceOfferedEquipmentFit = "matches" | "not_requested"

/** The equipment codes in an offered configuration's key: codes joined by `|` and `+`, e.g. `log_truck|pole_trailer`. */
export function configurationEquipmentCodes(configurationKey: string): string[] {
  return configurationKey.split(/[|+]/).map((code) => code.trim()).filter(Boolean)
}

/**
 * One offered configuration against the codes a job asks for (UX 02 §B9): "matches" when it has every piece of
 * equipment the job lists, the same rule as the hauler's own fit (`marketplaceEquipmentFit`), otherwise "not
 * requested". `null` when there is nothing to compare. Advisory only: the offer is self-reported by the hauler.
 */
export function offeredEquipmentFit(configurationKey: string, jobEquipmentCodes: readonly string[]): MarketplaceOfferedEquipmentFit | null {
  const codes = configurationEquipmentCodes(configurationKey)

  if (jobEquipmentCodes.length === 0) return null
  return codes.length > 0 && marketplaceEquipmentFit(jobEquipmentCodes, [codes]) === "fits" ? "matches" : "not_requested"
}
