/**
 * trucks (#251): the Find Trucks directory rules. Pure, over the views in `packages/contracts/src/v2/trucks/`.
 *
 * Results are a filter over facts the hauling business entered, in one of the named sort keys
 * (`MARKETPLACE_TRUCK_SORT_KEYS`). No comparator reads the identity mark, so it never moves a card; the "Identity
 * reviewed" filter is the only way it changes a result (legal review §3.3 item 1, §7.3 item 5). Availability is
 * current only while fresh and inside its window, and always names the business that said so (§7.3 item 10).
 */

import {
  HAULER_AVAILABILITY_FRESH_DAYS,
  MARKETPLACE_EQUIPMENT_TYPES,
  MARKETPLACE_RADIUS_BUFFER_MILES,
  MARKETPLACE_TRUCK_CARD_KEYS,
  TRUCK_DIRECTORY_DAILY_PAGE_LIMIT,
  TRUCK_DIRECTORY_DAILY_VIEW_LIMIT,
  TRUCK_DIRECTORY_PAGE_SIZE,
  TRUCK_DIRECTORY_REFUSALS,
  haulerConfigurationLabel,
  haversineMiles,
  planIncludesFeature,
  snapToPublicGrid,
  type Coordinates,
  type HaulerEquipmentSummaryLine,
  type LandingPlanCode,
  type MarketplaceFeatureCapability,
  type MarketplaceTruckAvailabilityView,
  type MarketplaceTruckCardView,
  type MarketplaceTruckDirectoryQuery,
  type MarketplaceTruckSortKey,
  type MarketplaceVerification,
  type TruckDirectoryRefusalReason
} from "@logloads/contracts"

const DAY_MS = 86_400_000

const TRUCK_CODES: ReadonlySet<string> = new Set(MARKETPLACE_EQUIPMENT_TYPES.filter((type) => type.category === "truck").map((type) => type.code))

/** A truck type. Availability is reported per truck type, so a truck code is matched against reports, not inventory. */
export function isTruckEquipmentCode(code: string): boolean {
  return TRUCK_CODES.has(code)
}

/** One open self-report, as the directory reads it. The store shows only open reports that have not ended. */
export interface TruckDirectoryReport {
  id: string
  equipmentCode: string
  availableCount: number
  /** UTC calendar days. */
  availableFrom: string
  availableUntil: string
  reportedAt: string
}

/** One listed configuration or extra: a truck (with its trailer) or an attachment. */
export interface TruckDirectoryEquipment {
  equipmentCode: string
  trailerCode: string | null
  units: number
}

/** A hauling business as the store returns it, before the card projection. */
export interface TruckDirectoryEntry {
  organizationId: string
  businessName: string
  homeBase: string | null
  /** The service point. Snapped to the public grid again by the projection, whatever the row says. */
  servicePoint: Coordinates | null
  serviceRadiusMiles: number | null
  operatingStates: string[]
  acceptsInvitations: boolean
  verification: MarketplaceVerification | null
  /** The business chose to be listed (`hauler_profiles.is_public`, with consent) and is active. */
  listed: boolean
  equipment: TruckDirectoryEquipment[]
  availability: TruckDirectoryReport[]
}

export interface TruckAvailabilitySummary {
  view: MarketplaceTruckAvailabilityView
  /** Trucks the current reports say are free, across types; `null` without a current report. */
  availableTrucks: number | null
  /** The latest report time of any open report; `null` with none. */
  reportedAt: string | null
}

function utcDay(instant: Date): string {
  return instant.toISOString().slice(0, 10)
}

function daysSince(at: string, now: Date): number {
  return Math.floor(Math.max(0, now.getTime() - Date.parse(at)) / DAY_MS)
}

function ago(days: number): string {
  return days < 1 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`
}

/** Open, not past its last day, and confirmed inside the freshness band. Anything else is never current. */
export function truckReportIsCurrent(report: Pick<TruckDirectoryReport, "availableUntil" | "reportedAt">, now: Date): boolean {
  const age = now.getTime() - Date.parse(report.reportedAt)

  return !Number.isNaN(age) && age < HAULER_AVAILABILITY_FRESH_DAYS * DAY_MS && report.availableUntil >= utcDay(now)
}

function latest(reports: readonly TruckDirectoryReport[]): TruckDirectoryReport | null {
  return reports.reduce<TruckDirectoryReport | null>((found, report) => (!found || report.reportedAt > found.reportedAt ? report : found), null)
}

/**
 * What a business last said about its trucks. A current report is "available now" (or "from" a later day), with the
 * count and the business named. A stale one keeps its date and loses its count. No open report is never zero trucks.
 */
export function truckAvailabilitySummary(businessName: string, reports: readonly TruckDirectoryReport[], now: Date): TruckAvailabilitySummary {
  const today = utcDay(now)
  // A report whose last day has passed says nothing about now, however recently it was made.
  const open = reports.filter((report) => report.availableUntil >= today)
  const newest = latest(open)

  if (!newest) {
    return {
      availableTrucks: null,
      reportedAt: null,
      view: { availableFrom: null, confirmedDaysAgo: null, equipmentCodes: [], label: "No current availability reported", status: "not_reported" }
    }
  }

  const current = open.filter((report) => truckReportIsCurrent(report, now))
  const freshest = latest(current)

  if (!freshest) {
    const days = daysSince(newest.reportedAt, now)

    return {
      availableTrucks: null,
      reportedAt: newest.reportedAt,
      view: {
        availableFrom: null,
        confirmedDaysAgo: days,
        equipmentCodes: [],
        label: `Not recently confirmed. ${businessName} last confirmed ${ago(days)}`,
        status: "not_recently_confirmed"
      }
    }
  }

  const availableFrom = current.map((report) => report.availableFrom).sort()[0] ?? null
  const days = daysSince(freshest.reportedAt, now)

  return {
    availableTrucks: current.reduce((total, report) => total + report.availableCount, 0),
    reportedAt: newest.reportedAt,
    view: {
      availableFrom,
      confirmedDaysAgo: days,
      equipmentCodes: Array.from(new Set(current.map((report) => report.equipmentCode))).sort(),
      label: `Confirmed by ${businessName} ${ago(days)}`,
      status: availableFrom !== null && availableFrom <= today ? "available_now" : "available_from"
    }
  }
}

function equipmentLines(equipment: readonly TruckDirectoryEquipment[]): HaulerEquipmentSummaryLine[] {
  const lines = new Map<string, HaulerEquipmentSummaryLine>()

  for (const unit of equipment) {
    const label = haulerConfigurationLabel(unit.equipmentCode, unit.trailerCode, null)
    const line = lines.get(label)

    if (line) {
      line.units += unit.units
    } else {
      lines.set(label, { label, units: unit.units })
    }
  }

  return [...lines.values()]
}

function publicPoint(point: Coordinates | null): Coordinates | null {
  return point && Number.isFinite(point.lat) && Number.isFinite(point.lng) ? snapToPublicGrid(point) : null
}

/** Miles between two public grid points, unrounded; `null` without both. */
function gridMiles(from: Coordinates | null, to: Coordinates | null): number | null {
  const origin = publicPoint(from)
  const target = publicPoint(to)

  return origin && target ? haversineMiles(origin, target) : null
}

/**
 * The card: exactly `MARKETPLACE_TRUCK_CARD_KEYS`, copied field by field, so nothing else on a row (a contact, an
 * exact point) can reach the list. The point is snapped to the 0.1° grid here, whatever the store sent.
 */
export function truckCard(entry: TruckDirectoryEntry, query: MarketplaceTruckDirectoryQuery, now: Date): MarketplaceTruckCardView {
  const summary = truckAvailabilitySummary(entry.businessName, entry.availability, now)
  const point = publicPoint(entry.servicePoint)
  const miles = gridMiles(query.near, point)
  const card: MarketplaceTruckCardView = {
    acceptsInvitations: entry.acceptsInvitations,
    approximatePoint: point,
    availability: summary.view,
    availabilityReportedAt: summary.reportedAt,
    availableTrucks: summary.availableTrucks,
    businessName: entry.businessName,
    distanceMiles: miles === null ? null : Math.round(miles),
    equipment: equipmentLines(entry.equipment),
    homeBase: entry.homeBase,
    operatingStates: [...entry.operatingStates],
    organizationId: entry.organizationId,
    serviceRadiusMiles: entry.serviceRadiusMiles,
    verification: entry.verification ? { reviewedOn: entry.verification.reviewedOn, scope: entry.verification.scope } : null
  }

  if (Object.keys(card).sort().join(",") !== [...MARKETPLACE_TRUCK_CARD_KEYS].sort().join(",")) {
    throw new Error("The truck card projection does not match MARKETPLACE_TRUCK_CARD_KEYS")
  }

  return card
}

function lists(entry: TruckDirectoryEntry, code: string): boolean {
  return entry.equipment.some((unit) => unit.equipmentCode === code || unit.trailerCode === code)
}

/**
 * Whether a business passes the filters. Hidden businesses never do. "Available only" needs a current report; with
 * a truck type chosen, a current report of that type. A distance needs the business's public point.
 */
export function truckEntryMatches(entry: TruckDirectoryEntry, query: MarketplaceTruckDirectoryQuery, now: Date): boolean {
  if (!entry.listed) return false

  if (query.query) {
    const needle = query.query.toLowerCase()
    const haystack = [entry.businessName, entry.homeBase ?? ""].map((value) => value.toLowerCase())

    if (!haystack.some((value) => value.includes(needle))) return false
  }

  if (query.equipment && !lists(entry, query.equipment)) return false

  if (query.availableOnly) {
    // Reports are per truck type: a truck type chosen needs a current report of that type; a trailer or an extra,
    // any current report.
    const current = entry.availability.filter((report) => truckReportIsCurrent(report, now))
    const relevant = query.equipment && TRUCK_CODES.has(query.equipment)
      ? current.filter((report) => report.equipmentCode === query.equipment)
      : current

    if (relevant.length === 0) return false
  }

  if (query.identityReviewedOnly && entry.verification === null) return false

  if (query.near && query.radiusMiles !== null) {
    const miles = gridMiles(query.near, entry.servicePoint)

    if (miles === null || miles > query.radiusMiles + MARKETPLACE_RADIUS_BUFFER_MILES) return false
  }

  return true
}

/** 0 current, 1 stale, 2 never reported: the freshness band a card is in. */
function freshnessRank(card: MarketplaceTruckCardView): number {
  switch (card.availability.status) {
    case "available_now":
    case "available_from":
      return 0
    case "not_recently_confirmed":
      return 1
    default:
      return 2
  }
}

function byName(a: MarketplaceTruckCardView, b: MarketplaceTruckCardView): number {
  return a.businessName.localeCompare(b.businessName, "en", { sensitivity: "base" }) || (a.organizationId < b.organizationId ? -1 : a.organizationId > b.organizationId ? 1 : 0)
}

function byFreshness(a: MarketplaceTruckCardView, b: MarketplaceTruckCardView): number {
  const band = freshnessRank(a) - freshnessRank(b)

  if (band !== 0) return band

  const aAt = a.availabilityReportedAt ? Date.parse(a.availabilityReportedAt) : null
  const bAt = b.availabilityReportedAt ? Date.parse(b.availabilityReportedAt) : null

  if (aAt === bAt) return 0
  if (aAt === null) return 1
  if (bAt === null) return -1

  return bAt - aAt
}

function byDistance(a: MarketplaceTruckCardView, b: MarketplaceTruckCardView): number {
  if (a.distanceMiles === b.distanceMiles) return 0
  if (a.distanceMiles === null) return 1
  if (b.distanceMiles === null) return -1

  return a.distanceMiles - b.distanceMiles
}

/**
 * The comparator for one named key. Every key ends in business name and then id, so the order is total. None reads
 * `verification`: the mark never moves a card.
 */
export function compareTruckCards(sort: MarketplaceTruckSortKey): (a: MarketplaceTruckCardView, b: MarketplaceTruckCardView) => number {
  switch (sort) {
    case "distance":
      return (a, b) => byDistance(a, b) || byFreshness(a, b) || byName(a, b)
    case "name":
      return byName
    case "last_confirmed":
    default:
      return (a, b) => byFreshness(a, b) || byName(a, b)
  }
}

/** One directory page: filter, project, sort by the named key, and keep at most `TRUCK_DIRECTORY_PAGE_SIZE`. */
export function truckDirectoryPage(
  entries: readonly TruckDirectoryEntry[],
  query: MarketplaceTruckDirectoryQuery,
  now: Date
): MarketplaceTruckCardView[] {
  return entries
    .filter((entry) => truckEntryMatches(entry, query, now))
    .map((entry) => truckCard(entry, query, now))
    .sort(compareTruckCards(query.sort))
    .slice(0, TRUCK_DIRECTORY_PAGE_SIZE)
}

// ---------------------------------------------------------------------------
// Access and limits (legal review §9.3 item 4)
// ---------------------------------------------------------------------------

export type TruckRefusal<R extends TruckDirectoryRefusalReason = TruckDirectoryRefusalReason> = { ok: false; reason: R; message: string }

function refusal<R extends TruckDirectoryRefusalReason>(reason: R): TruckRefusal<R> {
  return { message: TRUCK_DIRECTORY_REFUSALS[reason], ok: false, reason }
}

export interface TruckDirectoryAccessInput {
  /** The person's port v3 capabilities in the active business (`marketplaceFeatureCapabilities`). */
  capabilities: readonly MarketplaceFeatureCapability[]
  /** The active business's `organizations.verification_status`. */
  verificationStatus: string | null
  /** The plan that entitles the active business now; `null` with none. */
  planCode: LandingPlanCode | null
}

export type TruckDirectoryAccess = { ok: true; planCode: LandingPlanCode } | TruckRefusal<"no_landing_seat" | "identity_not_reviewed" | "no_plan">

/**
 * Who may read the directory: a Landing Operator seat (`truck.search`), at a business whose identity LogLoads
 * reviewed, with a landing plan. Checked in that order. The store checks again (row-level security admits only an
 * entitled landing seat to listed businesses).
 */
export function truckDirectoryAccess(input: TruckDirectoryAccessInput): TruckDirectoryAccess {
  if (!input.capabilities.includes("truck.search")) return refusal("no_landing_seat")
  if (input.verificationStatus !== "verified") return refusal("identity_not_reviewed")
  if (input.planCode === null) return refusal("no_plan")

  return { ok: true, planCode: input.planCode }
}

/** Saved truck searches and availability alerts need a plan with `availability_alerts` (from `LANDING_PLANS`). */
export function truckSavedSearchAccess(planCode: LandingPlanCode): { ok: true } | TruckRefusal<"alerts_not_in_plan"> {
  return planIncludesFeature(planCode, "availability_alerts") ? { ok: true } : refusal("alerts_not_in_plan")
}

/** What a seat has used of today's directory allowance (UTC day). */
export interface TruckDirectoryUsage {
  pagesUsed: number
  viewsUsed: number
}

export type TruckDirectoryGrant = { allowed: true; views: number } | { allowed: false; reason: "daily_page_limit" | "daily_view_limit"; message: string }

/**
 * Whether one more page may be read, and how many of its cards may be shown: at most a page, and at most what is
 * left of the day's cards. The store keeps the count and applies the same rule atomically; this states it.
 */
export function truckDirectoryGrant(usage: TruckDirectoryUsage, cards: number): TruckDirectoryGrant {
  if (usage.pagesUsed >= TRUCK_DIRECTORY_DAILY_PAGE_LIMIT) {
    return { allowed: false, message: TRUCK_DIRECTORY_REFUSALS.daily_page_limit, reason: "daily_page_limit" }
  }

  if (usage.viewsUsed >= TRUCK_DIRECTORY_DAILY_VIEW_LIMIT) {
    return { allowed: false, message: TRUCK_DIRECTORY_REFUSALS.daily_view_limit, reason: "daily_view_limit" }
  }

  const wanted = Math.max(0, Math.min(Math.floor(cards), TRUCK_DIRECTORY_PAGE_SIZE))

  return { allowed: true, views: Math.min(wanted, TRUCK_DIRECTORY_DAILY_VIEW_LIMIT - usage.viewsUsed) }
}
