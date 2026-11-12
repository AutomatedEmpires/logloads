/**
 * trucks (#251): Find Trucks — the directory of listed hauling businesses, and availability alerts (UX spec §4.8,
 * §4.13). Views for `MarketplaceTrucksPort` (apps/web/lib/marketplace-v2/port.ts); saved truck searches use the
 * shared `MarketplaceSavedSearchView`. The rules are in `packages/services/src/v2/trucks/`.
 *
 * The legal review (docs/legal/2026-11-legal-review.md §3.3 items 1 and 7, §6.5, §7.3 items 5–6, §9.3 item 4) makes
 * these hard rules:
 *
 * - LogLoads never chooses. Results are a filter over facts the hauler entered, in one of a few named sort keys the
 *   landing sees and changes. There is no best match and no score, and the identity mark never moves a card: an
 *   "Identity reviewed" filter is the only way it changes a result.
 * - Only businesses that chose to be listed appear, and only to a landing seat whose business passed identity review.
 * - A card carries no phone, email, exact location or third-party safety record. Points are on the public 0.1° grid
 *   (V2-DEC-01). A page holds at most `TRUCK_DIRECTORY_PAGE_SIZE` cards and a seat has daily page and card limits, so
 *   the directory cannot be harvested as a list.
 * - Availability is self-reported and dated, names who said so, and is never shown as current once stale.
 */

import { z } from "zod"

import type { Coordinates } from "../../geo"
import type { HaulerEquipmentSummaryLine } from "../../marketplace-hauler"
import type { MarketplaceId, MarketplaceNotificationChannel, MarketplaceSavedSearchInput } from "../../marketplace-port-v3"
import { MARKETPLACE_EQUIPMENT_TYPES, snapToPublicGrid, type MarketplaceVerification } from "../../marketplace-v2"

// ---------------------------------------------------------------------------
// Sort keys (legal review §3.3 item 1, §7.3 item 5)
// ---------------------------------------------------------------------------

/** The only orders the directory has. Each is a fact the card shows; none reads the identity mark. */
export const MARKETPLACE_TRUCK_SORT_KEYS = ["last_confirmed", "distance", "name"] as const
export type MarketplaceTruckSortKey = (typeof MARKETPLACE_TRUCK_SORT_KEYS)[number]

/** What the sort control says. */
export const MARKETPLACE_TRUCK_SORT_LABELS: Readonly<Record<MarketplaceTruckSortKey, string>> = Object.freeze({
  distance: "Distance",
  last_confirmed: "Last confirmed",
  name: "Business name"
})

/** Freshest availability first. */
export const MARKETPLACE_TRUCK_DEFAULT_SORT: MarketplaceTruckSortKey = "last_confirmed"

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface MarketplaceTruckFilters {
  /** Business name or home base. */
  query?: string | null
  /** One equipment code the business lists: a truck, a trailer or an extra. */
  equipment?: string | null
  /** A place the user typed, snapped to the public 0.1° grid; never a device location. */
  near?: Coordinates | null
  /** Miles around `near`, 5–500. Ignored without a place. */
  radiusMiles?: number | null
  /** Only businesses with a current (fresh, unexpired) availability report. */
  availableOnly?: boolean
  /** Only businesses whose identity LogLoads reviewed. A filter only: the mark never changes the order. */
  identityReviewedOnly?: boolean
  /** One of `MARKETPLACE_TRUCK_SORT_KEYS`; `distance` needs `near`. */
  sort?: MarketplaceTruckSortKey | null
}

/** The filters as the directory applies them: every field set, the place on the public grid. */
export interface MarketplaceTruckDirectoryQuery {
  query: string | null
  equipment: string | null
  near: Coordinates | null
  radiusMiles: number | null
  availableOnly: boolean
  identityReviewedOnly: boolean
  sort: MarketplaceTruckSortKey
}

const EQUIPMENT_CODES = MARKETPLACE_EQUIPMENT_TYPES.map((type) => type.code) as [string, ...string[]]

const equipmentCode = z.enum(EQUIPMENT_CODES, { errorMap: () => ({ message: "Choose equipment from the list." }) })

const notAnEmail = (value: string) => !value.includes("@")

const point = z
  .object(
    {
      lat: z.number().finite().min(-90).max(90),
      lng: z.number().finite().min(-180).max(180)
    },
    { invalid_type_error: "Choose a place from the list." }
  )
  // A place from the server's list may carry its label too; only the point is kept, on the public grid.
  .transform((value) => snapToPublicGrid({ lat: value.lat, lng: value.lng }))

const radius = z
  .number({ invalid_type_error: "Choose a distance from 5 to 500 miles." })
  .int("Use a whole number of miles.")
  .min(5, "Choose a distance from 5 to 500 miles.")
  .max(500, "Choose a distance from 5 to 500 miles.")

const searchText = z
  .string()
  .max(80, "Use 80 characters or fewer.")
  .transform((value) => value.trim())
  .refine(notAnEmail, { message: "Search by business name or place, not an email address." })
  .transform((value) => (value.length > 0 ? value : null))

/**
 * The directory filters at the port boundary. Defaults are "any", sorted by `last_confirmed`. A distance without a
 * place is ignored; a distance sort without one is refused. An unknown field is refused, so a page cannot ask for an
 * export, another business or a sort the landing cannot see.
 */
export const marketplaceTruckFiltersSchema: z.ZodType<MarketplaceTruckDirectoryQuery, z.ZodTypeDef, unknown> = z
  .object({
    availableOnly: z.boolean().optional(),
    equipment: equipmentCode.nullable().optional(),
    identityReviewedOnly: z.boolean().optional(),
    near: point.nullable().optional(),
    query: searchText.nullable().optional(),
    radiusMiles: radius.nullable().optional(),
    sort: z.enum(MARKETPLACE_TRUCK_SORT_KEYS, { errorMap: () => ({ message: "Choose how to sort the list." }) }).nullable().optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.sort === "distance" && !value.near) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose a place to sort by distance.", path: ["sort"] })
    }
  })
  .transform((value) => ({
    availableOnly: value.availableOnly ?? false,
    equipment: value.equipment ?? null,
    identityReviewedOnly: value.identityReviewedOnly ?? false,
    near: value.near ?? null,
    query: value.query ?? null,
    radiusMiles: value.near ? value.radiusMiles ?? null : null,
    sort: value.sort ?? MARKETPLACE_TRUCK_DEFAULT_SORT
  }))

// ---------------------------------------------------------------------------
// The directory card
// ---------------------------------------------------------------------------

/**
 * - `available_now` / `available_from`: a current report (fresh and not past its last day) says trucks are free
 *   today, or from a later day.
 * - `not_recently_confirmed`: the latest report is older than the freshness band. Shown with its date, never as
 *   available.
 * - `not_reported`: no open report. Never shown as zero trucks.
 */
export const MARKETPLACE_TRUCK_AVAILABILITY_STATUSES = ["available_now", "available_from", "not_recently_confirmed", "not_reported"] as const
export type MarketplaceTruckAvailabilityStatus = (typeof MARKETPLACE_TRUCK_AVAILABILITY_STATUSES)[number]

/** What the business last said about its trucks, and how fresh that is. Self-reported; never "can haul today". */
export interface MarketplaceTruckAvailabilityView {
  status: MarketplaceTruckAvailabilityStatus
  /** Truck types a current report covers; empty unless the status is `available_now` or `available_from`. */
  equipmentCodes: string[]
  /** The earliest UTC day a current report starts; `null` without one. */
  availableFrom: string | null
  /** Whole days since the business last confirmed; `null` when it never reported. */
  confirmedDaysAgo: number | null
  /** Names who said so (legal review §7.3 item 10): "Confirmed by Sweet Home Hauling 3 days ago". */
  label: string
}

/** One listed business in the directory. Self-reported; "available" never means it can haul today. */
export interface MarketplaceTruckCardView {
  organizationId: MarketplaceId
  businessName: string
  homeBase: string | null
  /** The service area's public point on the 0.1° grid (V2-DEC-01); never a yard or a site. */
  approximatePoint: Coordinates | null
  serviceRadiusMiles: number | null
  /** States the business says it works in. */
  operatingStates: string[]
  /** About how far from the typed place: whole miles between 0.1° points; `null` without a place or a point. */
  distanceMiles: number | null
  equipment: HaulerEquipmentSummaryLine[]
  /** Trucks a current report says are available, across types; `null` when none is current. Never a stale count. */
  availableTrucks: number | null
  /** The latest availability report time; `null` when it never reported. Stale dates stay visible. */
  availabilityReportedAt: string | null
  availability: MarketplaceTruckAvailabilityView
  acceptsInvitations: boolean
  /** The business-identity mark as recorded; the wording is `describeMarketplaceVerification` (#337). */
  verification: MarketplaceVerification | null
}

/**
 * Every key a card has. The card is built by one projection that copies exactly these, so a contact or private field
 * can never reach the list by being added to a row.
 */
export const MARKETPLACE_TRUCK_CARD_KEYS = Object.freeze([
  "acceptsInvitations",
  "approximatePoint",
  "availability",
  "availabilityReportedAt",
  "availableTrucks",
  "businessName",
  "distanceMiles",
  "equipment",
  "homeBase",
  "operatingStates",
  "organizationId",
  "serviceRadiusMiles",
  "verification"
] as const satisfies ReadonlyArray<keyof MarketplaceTruckCardView>)

// ---------------------------------------------------------------------------
// Who may see the directory, and how much (legal review §9.3 item 4)
// ---------------------------------------------------------------------------

/** Cards on one directory page. A page never holds more, and there is no export. */
export const TRUCK_DIRECTORY_PAGE_SIZE = 25

/** Directory pages one Landing Operator seat may read per UTC day (initial value, #251). */
export const TRUCK_DIRECTORY_DAILY_PAGE_LIMIT = 40

/** Business cards one seat may be shown per UTC day (initial value, #251). */
export const TRUCK_DIRECTORY_DAILY_VIEW_LIMIT = 400

/** Why the directory or a saved truck search was refused. */
export const TRUCK_DIRECTORY_REFUSAL_REASONS = [
  "no_landing_seat",
  "identity_not_reviewed",
  "no_plan",
  "daily_page_limit",
  "daily_view_limit",
  "alerts_not_in_plan"
] as const
export type TruckDirectoryRefusalReason = (typeof TRUCK_DIRECTORY_REFUSAL_REASONS)[number]

export const TRUCK_DIRECTORY_REFUSALS: Readonly<Record<TruckDirectoryRefusalReason, string>> = Object.freeze({
  alerts_not_in_plan: "Saved truck searches and availability alerts come with the Pro and Regional plans.",
  daily_page_limit: "You have read today's Find Trucks pages for your seat. They reset at midnight UTC.",
  daily_view_limit: "You have seen today's Find Trucks listings for your seat. They reset at midnight UTC.",
  identity_not_reviewed: "Find Trucks opens once LogLoads has reviewed your business identity.",
  no_landing_seat: "Find Trucks is for landing team members with a Landing Operator seat.",
  no_plan: "Find Trucks needs an active landing plan."
})

// ---------------------------------------------------------------------------
// Saved truck searches and availability alerts (§4.13, Pro and Regional)
// ---------------------------------------------------------------------------

/** What a landing saves to be told when a matching business reports trucks available. */
export interface MarketplaceTruckAlertCriteria {
  /** Any of these codes; empty is any equipment. */
  equipment: string[]
  /** The name the landing typed for the place. */
  place: string | null
  /** That place on the public 0.1° grid. */
  near: Coordinates | null
  radiusMiles: number | null
  identityReviewedOnly: boolean
}

const placeName = z
  .string()
  .trim()
  .min(1, "Name a place.")
  .max(120, "Use a shorter place name.")
  .refine(notAnEmail, { message: "Name a place, not an email address." })

export const marketplaceTruckAlertCriteriaSchema: z.ZodType<MarketplaceTruckAlertCriteria, z.ZodTypeDef, unknown> = z
  .object({
    equipment: z
      .array(equipmentCode)
      .max(EQUIPMENT_CODES.length, "Choose fewer kinds of equipment.")
      .refine((codes) => new Set(codes).size === codes.length, { message: "Choose each kind of equipment once." })
      .default([]),
    identityReviewedOnly: z.boolean().default(false),
    near: point.nullable().default(null),
    place: placeName.nullable().default(null),
    radiusMiles: radius.nullable().default(null)
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.radiusMiles !== null && value.near === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose a place for that distance.", path: ["radiusMiles"] })
    }
  })

/** A new or edited truck search. `searchId` only when editing one of the person's own. Extra fields are refused. */
export const marketplaceSavedTruckSearchInputSchema: z.ZodType<
  MarketplaceSavedSearchInput<MarketplaceTruckAlertCriteria>,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    alertsEnabled: z.boolean({ required_error: "Choose whether this search sends alerts." }),
    criteria: marketplaceTruckAlertCriteriaSchema,
    name: z.string().trim().min(1, "Name the search.").max(80, "Use a name of 80 characters or fewer."),
    searchId: z.string().uuid("That saved search was not found.").optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(value.criteria)).length > 4096) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "That search is too large.", path: ["criteria"] })
    }
  })

/** A saved truck search's id. */
export const marketplaceTruckSearchIdSchema: z.ZodType<string, z.ZodTypeDef, unknown> = z.string().uuid("That saved search was not found.")

/**
 * The notice category availability alerts need in `notification_outbox` and `notification_preferences`. The schema
 * does not have it yet (26-D knows `job_alert` only); #251 asked for it with its catalogue request.
 */
export const MARKETPLACE_TRUCK_ALERT_CATEGORY = "truck_alert"

/** In the app and by email, each with the person's own consent. Never SMS: the SMS budget is 0. */
export const MARKETPLACE_TRUCK_ALERT_CHANNELS = ["in_app", "email"] as const satisfies readonly MarketplaceNotificationChannel[]
export type MarketplaceTruckAlertChannel = (typeof MARKETPLACE_TRUCK_ALERT_CHANNELS)[number]

/** At most this many reports go to the store in one alert hand-over, as for job alerts (`enqueue_job_alerts`). */
export const TRUCK_ALERT_BATCH_LIMIT = 50

/** What one availability alert says. Public card facts only: no phone, email or exact location. */
export interface MarketplaceTruckAlertPayload {
  savedSearchId: MarketplaceId
  savedSearchName: string
  haulerOrganizationId: MarketplaceId
  businessName: string
  equipmentCode: string
  availableCount: number
  availableFrom: string
  availableUntil: string
  areaLabel: string | null
  /** The availability report the alert is about; the store re-checks it is still open before an email goes. */
  reportId: MarketplaceId
  reportedAt: string
}

export const MARKETPLACE_TRUCK_ALERT_PAYLOAD_KEYS = Object.freeze([
  "areaLabel",
  "availableCount",
  "availableFrom",
  "availableUntil",
  "businessName",
  "equipmentCode",
  "haulerOrganizationId",
  "reportId",
  "reportedAt",
  "savedSearchId",
  "savedSearchName"
] as const satisfies ReadonlyArray<keyof MarketplaceTruckAlertPayload>)
