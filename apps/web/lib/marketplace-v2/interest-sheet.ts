import {
  marketplaceEquipmentFit,
  marketplaceEquipmentLabel,
  MARKETPLACE_EQUIPMENT_TYPES,
  type MarketplaceContactPreference,
  type MarketplaceHaulerEquipmentOption,
  type MarketplaceInterestView,
  type MarketplaceJobCardView
} from "@logloads/contracts"
import { NOT_RECENTLY_CONFIRMED, type CapacityRow, type CapacityState } from "@logloads/services"
import { formatDay, inquiryStatus } from "@logloads/ui/marketplace"

import { TRUCKS_PATH } from "./fleet-page"
import { capacityContradictions, type CapacityContradiction, type ReportedAvailability } from "./interest-capacity"

/**
 * The interest sheet (UX 02 §A8; UX-08 #131): what it offers and what it fills in, decided on the server from the
 * hauling business's own records. Pure. The page reads the port; this only decides.
 *
 * - Trucks by configuration come from the business's listed equipment (`haulerEquipment`), and their counts from
 *   its latest self-reported availability per truck type (`haulerFleet`, #126). Configurations the job asks for come
 *   first; the rest sit behind "Show my other trucks" at 0.
 * - "Available from" comes from the same availability reports.
 * - "Reach me by" comes from the business's last inquiry, or LogLoads messages. The business profile has no default
 *   contact route yet (no column; see `marketplace-hauler.ts`).
 *   TODO(#131 follow-up, normalized-v2 schema batch): prefill from the profile's default contact route once
 *   `hauler_profiles` has one; until then the route stays editable on each inquiry and nothing new is stored.
 *
 * Nothing here is a limit: the server re-checks every count against the units listed, and offering more than was
 * reported available is allowed (it is flagged, `interest-capacity.ts`).
 */

const TRUCK_CODES = new Set<string>(MARKETPLACE_EQUIPMENT_TYPES.filter((type) => type.category === "truck").map((type) => type.code))

export interface InterestRowCapacity {
  state: CapacityState
  /**
   * Units of this configuration available, from a fresh report of its truck type; `null` when not known, and when the
   * type's report covers several configurations, because a report is per truck type and never says which (#126).
   */
  available: number | null
  /** The start date of a report that starts after today. */
  from: string | null
  /** "Updated today by the hauler", or "Not recently confirmed". */
  stamp: string
  /**
   * "Available from Nov 12, 2026 · Updated today by the hauler", or for a type shared by several configurations
   * "Available now: 3 of 4 across your Log truck setups · …"; `null` when unknown (EquipmentCapacity says so).
   */
  line: string | null
}

export interface InterestSheetRow {
  configurationKey: string
  label: string
  unitsListed: number
  /** The truck type this configuration's availability is reported under; `null` when it names no known truck. */
  truckCode: string | null
  capacity: InterestRowCapacity
  /** The prefilled count. */
  count: number
}

export type InterestFieldSource = "availability" | "last_inquiry" | "default" | null

export interface InterestSheetModel {
  /** "As Granite Creek Hauling": the business the inquiry is sent for (the session's active business). */
  businessName: string
  /** The configurations the job asks for (every configuration when the job states no equipment), prefilled. */
  requested: InterestSheetRow[]
  /** The business's other configurations, at 0, behind "Show my other trucks". */
  others: InterestSheetRow[]
  /** "Pole trailer" when the job lists equipment that none of the business's configurations has; then nothing is prefilled. */
  unmatchedEquipment: string | null
  /** The plain count's default when the business lists no equipment. */
  trucksOffered: number
  /** YYYY-MM-DD, or "" when no fresh report says when the trucks are free. */
  availableFrom: string
  availableFromSource: InterestFieldSource
  contactPreference: MarketplaceContactPreference
  contactSource: InterestFieldSource
  /** Fresh, known reports per truck type, for "Update availability?". */
  reports: ReportedAvailability[]
  /** My trucks. */
  trucksHref: string
}

/** The truck type of a configuration (its first code that is a truck), or `null`. */
export function configurationTruckCode(option: Pick<MarketplaceHaulerEquipmentOption, "equipmentCodes">): string | null {
  return (option.equipmentCodes ?? []).find((code) => TRUCK_CODES.has(code)) ?? null
}

export function availabilityHref(truckCode: string): string {
  return `${TRUCKS_PATH}#availability-${truckCode}`
}

/** The fresh, known reports: "available" with a count, or "not available" as 0. Unknown or stale types are left out. */
export function reportedAvailability(capacity: readonly CapacityRow[]): ReportedAvailability[] {
  return capacity.flatMap((row) => {
    if (row.state === "unknown") return []
    const reported = row.state === "not_available" ? 0 : row.available ?? 0
    return [{ href: availabilityHref(row.equipmentCode), label: row.label, reported, truckCode: row.equipmentCode }]
  })
}

function rowCapacity(units: number, row: CapacityRow | undefined): InterestRowCapacity {
  if (!row || row.state === "unknown") {
    return { available: null, from: null, line: null, stamp: row?.stamp.label ?? NOT_RECENTLY_CONFIRMED, state: "unknown" }
  }

  const state = row.state === "available_from" && row.from ? `Available from ${formatDay(row.from)}` : row.state === "not_available" ? "Not available" : "Available now"
  // "Not available" holds for every configuration of the type; an available count is the type's, not this one's.
  const shared = row.state !== "not_available" && row.configurations.length > 1

  return {
    available: row.state === "not_available" ? 0 : shared ? null : Math.min(units, row.available ?? 0),
    from: row.from,
    line: shared ? `${state}: ${row.available} of ${row.have} across your ${row.label} setups · ${row.stamp.label}` : `${state} · ${row.stamp.label}`,
    stamp: row.stamp.label,
    state: row.state
  }
}

/** Every listed configuration fits a job that states no equipment: nothing says it needs other trucks. */
function asksFor(job: Pick<MarketplaceJobCardView, "equipment">, option: MarketplaceHaulerEquipmentOption): boolean {
  return job.equipment.length === 0 || marketplaceEquipmentFit(job.equipment, [option.equipmentCodes ?? []]) === "fits"
}

/**
 * Counts for the configurations the job asks for: each truck type's fresh available count, spread over its
 * configurations in order, never above the units listed, and in all never above the trucks the job asks for (a
 * day's trucks when stated, else the job's). A type reported not available gets 0. When that fills in nothing, the
 * first configuration with no recent report gets one truck, so the default path is still one tap and claims the least.
 */
function prefill(rows: InterestSheetRow[], reports: readonly ReportedAvailability[], demand: number | null): void {
  // Each truck type's own reported count, shared by its configurations.
  const budget = new Map(reports.map((report) => [report.truckCode, report.reported]))
  let remaining = demand ?? Number.POSITIVE_INFINITY

  for (const row of rows) {
    const left = row.truckCode ? budget.get(row.truckCode) : undefined
    if (!row.truckCode || left === undefined) continue
    const count = Math.max(0, Math.min(row.unitsListed, left, remaining))
    row.count = count
    budget.set(row.truckCode, left - count)
    remaining -= count
  }

  if (rows.every((row) => row.count === 0) && remaining >= 1) {
    const first = rows.find((row) => row.capacity.state === "unknown" && row.unitsListed >= 1)
    if (first) first.count = 1
  }
}

/** The latest date among the offered trucks' reports: today for "available now", the report's date otherwise. */
function prefilledFrom(rows: readonly InterestSheetRow[], today: string): string {
  const dates = rows.flatMap((row) => {
    if (row.count === 0) return []
    if (row.capacity.state === "available_from" && row.capacity.from) return [row.capacity.from]
    if (row.capacity.state === "available_now") return [today]
    return []
  })

  return dates.sort().at(-1) ?? ""
}

export function interestSheetModel(input: {
  job: Pick<MarketplaceJobCardView, "equipment" | "trucks">
  businessName: string
  options: readonly MarketplaceHaulerEquipmentOption[]
  /** `fleetCapacity(haulerFleet, now)`; empty when the business's availability could not be read. */
  capacity: readonly CapacityRow[]
  /** The business's inquiries (any job), for the contact route it used last. */
  interests: ReadonlyArray<Pick<MarketplaceInterestView, "contactPreference" | "updatedAt">>
  /** The server's UTC day, YYYY-MM-DD. */
  today: string
}): InterestSheetModel {
  const { capacity, job, options, today } = input
  const byTruck = new Map(capacity.map((row) => [row.equipmentCode, row]))
  const rowFor = (option: MarketplaceHaulerEquipmentOption): InterestSheetRow => {
    const truckCode = configurationTruckCode(option)

    return {
      capacity: rowCapacity(option.unitsListed, truckCode ? byTruck.get(truckCode) : undefined),
      configurationKey: option.configurationKey,
      count: 0,
      label: option.label,
      truckCode,
      unitsListed: option.unitsListed
    }
  }

  const fitting = options.filter((option) => asksFor(job, option))
  const unmatched = options.length > 0 && fitting.length === 0
  const requested = (unmatched ? options : fitting).map(rowFor)
  const others = unmatched ? [] : options.filter((option) => !fitting.includes(option)).map(rowFor)

  const reports = reportedAvailability(capacity)

  if (!unmatched) prefill(requested, reports, job.trucks.perDay ?? job.trucks.total)

  const availableFrom = prefilledFrom(requested, today)
  const last = [...input.interests].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]

  return {
    availableFrom,
    availableFromSource: availableFrom ? "availability" : null,
    businessName: input.businessName,
    contactPreference: last?.contactPreference ?? "in_app",
    contactSource: last ? "last_inquiry" : "default",
    others,
    reports,
    requested,
    trucksHref: TRUCKS_PATH,
    trucksOffered: 1,
    unmatchedEquipment: unmatched ? job.equipment.map(marketplaceEquipmentLabel).join(", ") : null
  }
}

// ---------------------------------------------------------------------------
// After sending: the confirmation (criterion 4) and the standing summary
// ---------------------------------------------------------------------------

type SentInterest = Pick<MarketplaceInterestView, "trucksOffered" | "equipment" | "availableFrom" | "landingOrganization" | "updatedAt">

/** "2 trucks (2 × Log truck + Pole trailer)". Self-reported by the hauler. */
export function offeredTrucksText(interest: Pick<MarketplaceInterestView, "trucksOffered" | "equipment">): string {
  const trucks = `${interest.trucksOffered} truck${interest.trucksOffered === 1 ? "" : "s"}`
  const lines = interest.equipment.map((line) => `${line.count} × ${line.label}`).join(", ")

  return lines ? `${trucks} (${lines})` : trucks
}

/** "available from Nov 10, 2026", or the day it was sent when the hauler gave no start date. */
function dateText(interest: Pick<MarketplaceInterestView, "availableFrom" | "updatedAt">): string {
  return interest.availableFrom
    ? `available from ${formatDay(interest.availableFrom)}`
    : `sent ${formatDay(interest.updatedAt)}, with no start date given`
}

/**
 * "Sent to North Pine Logging: 2 trucks (2 × Log truck + Pole trailer), available from Nov 10, 2026." It names the
 * landing business, the trucks and the date, and nothing reads as hired, booked or assigned (#205).
 */
export function interestConfirmation(interest: SentInterest): string {
  return `Sent to ${interest.landingOrganization.name}: ${offeredTrucksText(interest)}, ${dateText(interest)}.`
}

/** "You offered North Pine Logging 2 trucks (…), available from Nov 10, 2026. Sent · waiting for the landing." */
export function standingInterestSummary(interest: SentInterest & Pick<MarketplaceInterestView, "status" | "replies">): string {
  return `You offered ${interest.landingOrganization.name} ${offeredTrucksText(interest)}, ${dateText(interest)}. ${inquiryStatus(interest, "hauler").label}.`
}

/**
 * The sent offer against the business's reports, so a page without JavaScript (which shows no live prompt) still
 * flags an offer above what was reported available. Lines are matched to truck types through the business's own
 * configurations.
 */
export function sentContradictions(
  interest: Pick<MarketplaceInterestView, "equipment">,
  options: readonly MarketplaceHaulerEquipmentOption[],
  capacity: readonly CapacityRow[]
): CapacityContradiction[] {
  const truckOf = new Map(options.map((option) => [option.configurationKey, configurationTruckCode(option)]))

  return capacityContradictions(
    interest.equipment.map((line) => ({ count: line.count, truckCode: truckOf.get(line.configurationKey) ?? null })),
    reportedAvailability(capacity)
  )
}
