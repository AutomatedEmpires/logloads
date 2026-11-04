import {
  HAULER_AVAILABILITY_FRESH_DAYS,
  HAULER_AVAILABILITY_LEAD_DAYS,
  HAULER_AVAILABILITY_WINDOW_DAYS,
  HAULER_UNITS_MAX,
  haulerConfigurationLabel,
  marketplaceEquipmentLabel,
  MARKETPLACE_EQUIPMENT_GROUPS,
  NO_TRAILER,
  OTHER_TRAILER,
  type HaulerAvailabilityInput,
  type HaulerAvailabilityReportView,
  type HaulerEquipmentAddInput,
  type HaulerEquipmentUnitView,
  type HaulerFleetView,
  type MarketplaceHaulerEquipmentOption
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { actorCan, haulerEquipmentOptions, resolveMarketplaceActor } from "./marketplace-access"
import type { MarketplaceActor } from "./marketplace-interest"
import { DomainRefusalError } from "./utils"

/**
 * Marketplace V2 "My trucks" rules (UX 02 §A4, §A5, A-fleet; #126), shared by both V2 adapters: the count cap, how
 * availability is labelled, what "Confirm all as shown" confirms, and how an added configuration is recorded.
 * Self-reported only: nothing here reads a location, a driver, a trip or a schedule.
 */

export const FLEET_NOT_HAULING = "This business has no hauling profile."
export const FLEET_EDIT_REFUSED = "Only an owner, manager or staff member of this business can change its trucks."
export const FLEET_NOT_PLACED =
  "Availability is reported for the area around your home base. Add your home base and how far you travel on your business profile first."
export const NOT_RECENTLY_CONFIRMED = "Not recently confirmed"

const TRUCK_CODES = new Set<string>(MARKETPLACE_EQUIPMENT_GROUPS.truck.map((type) => type.code))
const DAY_MS = 86_400_000

function utcDay(instant: Date): string {
  return instant.toISOString().slice(0, 10)
}

function addDays(day: string, days: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS))
}

/** Units of one truck type registered across its configurations: the most that can be reported available. */
export function registeredUnits(fleet: Pick<HaulerFleetView, "units">, equipmentCode: string): number {
  return fleet.units.filter((unit) => unit.category === "truck" && unit.equipmentCode === equipmentCode).reduce((total, unit) => total + unit.units, 0)
}

export function registeredTrucks(fleet: Pick<HaulerFleetView, "units">): number {
  return fleet.units.filter((unit) => unit.category === "truck").reduce((total, unit) => total + unit.units, 0)
}

export function availabilityCapMessage(equipmentCode: string, registered: number): string {
  const label = marketplaceEquipmentLabel(equipmentCode)

  return registered === 0
    ? `No ${label} is listed. Add it to your trucks before reporting it available.`
    : `You have ${registered} ${label}${registered === 1 ? "" : "s"} listed, so at most ${registered} can be available.`
}

// ---------------------------------------------------------------------------
// Adding equipment
// ---------------------------------------------------------------------------

export interface HaulerEquipmentRecord {
  equipmentCode: string
  pairedTrailerCode: string | null
  /** "Other (describe)" text, kept in `capacity_note` so the label can be rebuilt from the row. */
  otherTrailer: string | null
  label: string
  count: number
}

/**
 * What an "Add equipment" post records: the configuration (truck + trailer) and one extra row per attachment, each
 * with the same count. A configuration or extra already listed is refused with its name, so a second add never
 * silently doubles a count; its own row changes the count.
 */
export function planEquipmentAdd(fleet: Pick<HaulerFleetView, "units" | "canEdit">, input: HaulerEquipmentAddInput): HaulerEquipmentRecord[] {
  if (!fleet.canEdit) {
    throw new DomainRefusalError(FLEET_EDIT_REFUSED)
  }

  const trailerCode = input.trailer === NO_TRAILER || input.trailer === OTHER_TRAILER ? null : input.trailer
  const otherTrailer = input.trailer === OTHER_TRAILER ? input.otherTrailer : null
  const records: HaulerEquipmentRecord[] = [
    {
      count: input.count,
      equipmentCode: input.truckCode,
      label: haulerConfigurationLabel(input.truckCode, trailerCode, otherTrailer),
      otherTrailer,
      pairedTrailerCode: trailerCode
    },
    ...input.attachments.map((code) => ({ count: input.count, equipmentCode: code, label: marketplaceEquipmentLabel(code), otherTrailer: null, pairedTrailerCode: null }))
  ]
  const configuration = records[0] as HaulerEquipmentRecord
  const listed = fleet.units.find((unit) => unit.label.toLowerCase() === configuration.label.toLowerCase())

  if (listed) {
    throw new DomainRefusalError(`${listed.label} is already in your list. Change its count there.`)
  }

  // An extra already listed keeps its own count: adding trucks that carry it adds to that count, up to the limit.
  return records.map((record, index) => {
    if (index === 0) return record
    const existing = fleet.units.find((unit) => unit.category === "attachment" && unit.equipmentCode === record.equipmentCode)
    return existing ? { ...record, count: Math.min(HAULER_UNITS_MAX, existing.units + record.count) } : record
  })
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export type HaulerAvailabilityPlan =
  | { kind: "report"; equipmentCode: string; count: number; availableFrom: string; availableUntil: string }
  | { kind: "withdraw"; equipmentCode: string }

/**
 * Checks one availability report against the business's own list, on the server clock. The count can never exceed
 * the units of that truck type registered; a start date is today or later, at most 90 days ahead.
 */
export function planAvailabilityReport(
  fleet: Pick<HaulerFleetView, "units" | "canEdit" | "placed">,
  input: HaulerAvailabilityInput,
  now: Date
): HaulerAvailabilityPlan {
  if (!fleet.canEdit) {
    throw new DomainRefusalError(FLEET_EDIT_REFUSED)
  }

  if (!TRUCK_CODES.has(input.equipmentCode)) {
    throw new DomainRefusalError("Choose one of your truck types")
  }

  if (input.state === "none") {
    return { equipmentCode: input.equipmentCode, kind: "withdraw" }
  }

  const registered = registeredUnits(fleet, input.equipmentCode)
  const count = input.count ?? 0

  if (count < 1 || count > registered) {
    throw new DomainRefusalError(availabilityCapMessage(input.equipmentCode, registered))
  }

  if (!fleet.placed) {
    throw new DomainRefusalError(FLEET_NOT_PLACED)
  }

  const today = utcDay(now)
  const availableFrom = input.state === "now" ? today : (input.fromDate as string)

  if (availableFrom < today || availableFrom > addDays(today, HAULER_AVAILABILITY_LEAD_DAYS)) {
    throw new DomainRefusalError(`Choose a start date from today to ${HAULER_AVAILABILITY_LEAD_DAYS} days ahead`)
  }

  return { availableFrom, availableUntil: addDays(availableFrom, HAULER_AVAILABILITY_WINDOW_DAYS), count, equipmentCode: input.equipmentCode, kind: "report" }
}

export interface AvailabilityStamp {
  /** "Updated today by the hauler", "Updated 3 days ago by the hauler", or "Not recently confirmed". */
  label: string
  fresh: boolean
}

/**
 * The source and date every availability display carries (UX 02 §6.4 `AvailabilityStamp`). Unknown, stale or
 * expired reads "Not recently confirmed", never a number and never zero. Never "Live" or "Online" (§12.4).
 */
export function availabilityStamp(report: HaulerAvailabilityReportView | null, now: Date): AvailabilityStamp {
  if (!report) {
    return { fresh: false, label: NOT_RECENTLY_CONFIRMED }
  }

  const days = Math.floor(Math.max(0, now.getTime() - Date.parse(report.reportedAt)) / DAY_MS)
  const expired = report.state === "available" && report.availableUntil !== null && report.availableUntil < utcDay(now)

  if (Number.isNaN(days) || days >= HAULER_AVAILABILITY_FRESH_DAYS || expired) {
    return { fresh: false, label: NOT_RECENTLY_CONFIRMED }
  }

  return { fresh: true, label: `Updated ${days < 1 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`} by the hauler` }
}

export type CapacityState = "available_now" | "available_from" | "not_available" | "unknown"

export interface CapacityRow {
  equipmentCode: string
  label: string
  /** The configurations of this truck type ("Log truck + Pole trailer", …). */
  configurations: Array<{ label: string; units: number }>
  have: number
  /** `null` unless a fresh "available" report says so: unknown is never shown as 0. */
  available: number | null
  state: CapacityState
  /** The start date of a fresh report that starts after today. */
  from: string | null
  stamp: AvailabilityStamp
}

/** One row per truck type the business lists (A-fleet): have, available, from, and when it was last said. */
export function fleetCapacity(fleet: Pick<HaulerFleetView, "units" | "availability">, now: Date): CapacityRow[] {
  const today = utcDay(now)
  const codes = Array.from(new Set(fleet.units.filter((unit) => unit.category === "truck").map((unit) => unit.equipmentCode)))

  return codes.map((code) => {
    const configurations = fleet.units.filter((unit) => unit.category === "truck" && unit.equipmentCode === code).map((unit) => ({ label: unit.label, units: unit.units }))
    const have = configurations.reduce((total, unit) => total + unit.units, 0)
    const report = fleet.availability.find((candidate) => candidate.equipmentCode === code) ?? null
    const stamp = availabilityStamp(report, now)

    if (!report || !stamp.fresh) {
      return { available: null, configurations, equipmentCode: code, from: null, have, label: marketplaceEquipmentLabel(code), stamp, state: "unknown" }
    }

    if (report.state === "not_available") {
      return { available: null, configurations, equipmentCode: code, from: null, have, label: marketplaceEquipmentLabel(code), stamp, state: "not_available" }
    }

    const later = report.availableFrom !== null && report.availableFrom > today

    return {
      // A list lowered below an older report never shows more available than registered.
      available: Math.min(have, report.availableCount ?? 0),
      configurations,
      equipmentCode: code,
      from: later ? report.availableFrom : null,
      have,
      label: marketplaceEquipmentLabel(code),
      stamp,
      state: later ? "available_from" : "available_now"
    }
  })
}

/** What "Confirm all as shown" re-states: every row with a fresh, known state. Unknown rows are left as they are. */
export function confirmableCodes(fleet: Pick<HaulerFleetView, "units" | "availability">, now: Date): string[] {
  return fleetCapacity(fleet, now).filter((row) => row.state !== "unknown").map((row) => row.equipmentCode)
}

/** The capacity board appears at two or more trucks (UX 02 A-fleet). */
export function showsCapacityBoard(fleet: Pick<HaulerFleetView, "units">): boolean {
  return registeredTrucks(fleet) >= 2
}

// ---------------------------------------------------------------------------
// Pilot store (operating_state): read-only. The pilot's equipment records are per-unit dispatch records (unit
// numbers, payload, assigned drivers) and its availability is per driver, so V2 presets and self-reported counts
// are not written there.
// ---------------------------------------------------------------------------

function unitFromOption(option: MarketplaceHaulerEquipmentOption): HaulerEquipmentUnitView {
  const [trucks = "", trailers = ""] = option.configurationKey.split("|")
  const truck = trucks.split("+").filter(Boolean)[0] ?? option.configurationKey
  const trailer = trailers.split("+").filter(Boolean)[0] ?? null

  return { category: "truck", equipmentCode: truck, id: option.configurationKey, label: option.label, otherTrailer: null, trailerCode: trailer, units: option.unitsListed }
}

export function pilotHaulerFleet(state: LogLoadsDatabaseState, actor: MarketplaceActor): HaulerFleetView {
  const context = resolveMarketplaceActor(state, actor)

  if (!actorCan(context, "interest.express")) {
    throw new DomainRefusalError(FLEET_NOT_HAULING)
  }

  return {
    // The pilot holds no V2 availability report: every type reads "Not recently confirmed".
    availability: [],
    canEdit: actorCan(context, "equipment.manage"),
    organizationId: context.organization.id,
    placed: false,
    units: haulerEquipmentOptions(state, context.organization.id).map(unitFromOption)
  }
}
