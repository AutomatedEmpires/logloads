/**
 * trucks (#251): saved truck searches and availability alerts (UX spec §4.13; Pro and Regional).
 *
 * A landing saves a directory filter and is told, in the app or by email with its own consent, when a listed business
 * reports matching trucks available. Never SMS (the SMS budget is 0). LogLoads sends because the landing saved the
 * search, never on its own initiative (legal review §3.3 item 2). Every notice has a dedupe key, so a retried hand-over
 * queues nothing twice; the store's unique key is the authority (`notification_outbox.dedupe_key`).
 */

import {
  MARKETPLACE_TRUCK_ALERT_CATEGORY,
  MARKETPLACE_TRUCK_ALERT_CHANNELS,
  MARKETPLACE_RADIUS_BUFFER_MILES,
  TRUCK_ALERT_BATCH_LIMIT,
  haversineMiles,
  snapToPublicGrid,
  type Coordinates,
  type MarketplaceSavedSearchInput,
  type MarketplaceTruckAlertChannel,
  type MarketplaceTruckAlertCriteria,
  type MarketplaceTruckAlertPayload
} from "@logloads/contracts"

import { isTruckEquipmentCode, truckReportIsCurrent } from "./directory"

export interface TruckSearchWrite {
  alertsEnabled: boolean
  criteria: MarketplaceTruckAlertCriteria
  kind: "trucks"
  name: string
  organizationId: string
  searchId: string | null
}

/** A truck-search write is always kind `trucks`, for the caller's business, never a business named in the input. */
export function planTruckSearchWrite(organizationId: string, input: MarketplaceSavedSearchInput<MarketplaceTruckAlertCriteria>): TruckSearchWrite {
  return {
    alertsEnabled: input.alertsEnabled,
    criteria: input.criteria,
    kind: "trucks",
    name: input.name,
    organizationId,
    searchId: input.searchId ?? null
  }
}

/** A saved truck search as the alert matcher reads it. */
export interface TruckAlertSearch {
  id: string
  /** The landing business that saved it. */
  organizationId: string
  name: string
  criteria: MarketplaceTruckAlertCriteria
  alertsEnabled: boolean
  /** Reports made at or before this instant never alert: a search tells about availability from then on. */
  since: string
}

/** One open availability report of a hauling business, as the matcher reads it. */
export interface TruckAlertCandidate {
  reportId: string
  organizationId: string
  businessName: string
  /** The business chose to be listed and is active. A hidden business never alerts anyone. */
  listed: boolean
  identityReviewed: boolean
  /** The truck type the report is for. */
  equipmentCode: string
  /** Every code the business lists (trucks, trailers, extras). Only a trailer or an extra is matched against it. */
  listedEquipment: string[]
  availableCount: number
  availableFrom: string
  availableUntil: string
  areaPoint: Coordinates | null
  areaLabel: string | null
  reportedAt: string
}

function after(at: string, since: string): boolean {
  const reported = Date.parse(at)
  const from = Date.parse(since)

  return !Number.isNaN(reported) && !Number.isNaN(from) && reported > from
}

/**
 * Whether one report should alert one search: the search is on, the business is listed and is not the landing's own,
 * the report is new since the search, current (fresh, not ended), and fits the saved filters.
 */
export function truckAlertMatches(search: TruckAlertSearch, candidate: TruckAlertCandidate, now: Date): boolean {
  if (!search.alertsEnabled || !candidate.listed || candidate.organizationId === search.organizationId) return false
  if (!after(candidate.reportedAt, search.since)) return false
  if (!truckReportIsCurrent(candidate, now)) return false

  const { criteria } = search

  if (criteria.equipment.length > 0) {
    // A truck type matches only the type this report says is available; a trailer or an extra, what the business lists.
    const fits = (code: string) => (isTruckEquipmentCode(code) ? code === candidate.equipmentCode : candidate.listedEquipment.includes(code))

    if (!criteria.equipment.some(fits)) return false
  }

  if (criteria.identityReviewedOnly && !candidate.identityReviewed) return false

  if (criteria.near && criteria.radiusMiles !== null) {
    if (!candidate.areaPoint) return false

    const miles = haversineMiles(snapToPublicGrid(criteria.near), snapToPublicGrid(candidate.areaPoint))

    if (miles > criteria.radiusMiles + MARKETPLACE_RADIUS_BUFFER_MILES) return false
  }

  return true
}

/** One notice per search, report and channel, ever. */
export function truckAlertDedupeKey(searchId: string, reportId: string, channel: MarketplaceTruckAlertChannel): string {
  return `${MARKETPLACE_TRUCK_ALERT_CATEGORY}:${searchId}:${reportId}:${channel}`
}

/**
 * The channels a search may use: on, and the person's own `truck_alert` consent for that channel. Only the app and
 * email exist here; any other channel in a consent row (an SMS row, say) is ignored.
 */
export function truckAlertChannels(
  search: Pick<TruckAlertSearch, "alertsEnabled">,
  consents: ReadonlyArray<{ channel: string; enabled: boolean }>
): MarketplaceTruckAlertChannel[] {
  if (!search.alertsEnabled) return []

  return MARKETPLACE_TRUCK_ALERT_CHANNELS.filter((channel) => consents.some((consent) => consent.channel === channel && consent.enabled))
}

export interface PlannedTruckAlert {
  dedupeKey: string
  channel: MarketplaceTruckAlertChannel
  reportId: string
  payload: MarketplaceTruckAlertPayload
}

/** The notice body: public card facts only, copied field by field. */
function payloadOf(search: TruckAlertSearch, candidate: TruckAlertCandidate): MarketplaceTruckAlertPayload {
  return {
    areaLabel: candidate.areaLabel,
    availableCount: candidate.availableCount,
    availableFrom: candidate.availableFrom,
    availableUntil: candidate.availableUntil,
    businessName: candidate.businessName,
    equipmentCode: candidate.equipmentCode,
    haulerOrganizationId: candidate.organizationId,
    reportId: candidate.reportId,
    reportedAt: candidate.reportedAt,
    savedSearchId: search.id,
    savedSearchName: search.name
  }
}

/**
 * The alerts one search should queue now: matching reports, oldest first, at most `TRUCK_ALERT_BATCH_LIMIT`, on each
 * consented channel. Pure and deterministic, so a retry plans the same keys; keys in `sent` (already in the outbox)
 * are left out, and a report with no notice left to queue is not handed over.
 */
export function planTruckAlerts(
  search: TruckAlertSearch,
  candidates: readonly TruckAlertCandidate[],
  consents: ReadonlyArray<{ channel: string; enabled: boolean }>,
  now: Date,
  sent: ReadonlySet<string> = new Set()
): { reportIds: string[]; notices: PlannedTruckAlert[] } {
  const channels = truckAlertChannels(search, consents)

  if (channels.length === 0) return { notices: [], reportIds: [] }

  const seen = new Set<string>()
  const matching = candidates
    .filter((candidate) => truckAlertMatches(search, candidate, now))
    .sort((a, b) => Date.parse(a.reportedAt) - Date.parse(b.reportedAt) || (a.reportId < b.reportId ? -1 : a.reportId > b.reportId ? 1 : 0))
    .filter((candidate) => (seen.has(candidate.reportId) ? false : (seen.add(candidate.reportId), true)))

  const reportIds: string[] = []
  const notices: PlannedTruckAlert[] = []

  for (const candidate of matching) {
    if (reportIds.length >= TRUCK_ALERT_BATCH_LIMIT) break

    const due = channels
      .map((channel) => ({ channel, dedupeKey: truckAlertDedupeKey(search.id, candidate.reportId, channel) }))
      .filter((notice) => !sent.has(notice.dedupeKey))

    if (due.length === 0) continue

    reportIds.push(candidate.reportId)

    for (const notice of due) {
      notices.push({ ...notice, payload: payloadOf(search, candidate), reportId: candidate.reportId })
    }
  }

  return { notices, reportIds }
}
