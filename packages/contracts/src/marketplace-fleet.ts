import { z } from "zod"

import { MARKETPLACE_EQUIPMENT_TYPES, marketplaceEquipmentLabel } from "./marketplace-v2"

/**
 * Marketplace V2: a hauling business's own trucks and self-reported availability (UX 02 §A4, §A5, A-fleet; #126).
 * Free forever. Self-reported, never tracked: no GPS, driver names, trips, maintenance or schedules (§6.2,
 * Blueprint §109).
 *
 * The normalized-v2 prototype models both, and nothing is invented beyond its columns:
 *
 *   equipment_units       one row per configuration: equipment_code (a truck or an attachment), paired_trailer_code,
 *                         unit_count (1–500), unit_label (unique per business), capacity_note, is_active
 *   availability_reports  "N trucks of type X around here between dates": equipment_code, available_count (1–500),
 *                         area_center (the business's service point), radius_miles, available_from/until
 *                         (at most 90 days apart), reported_at (stamped on every edit), withdrawn_at
 *
 * Availability is per truck type (the schema's `equipment_code`), so the count cap is the units of that type
 * registered across its configurations. "Not available" is a withdrawn report; with no report at all the state is
 * unknown, which is shown as "Not recently confirmed", never as zero.
 */

export type MarketplaceEquipmentCategory = (typeof MARKETPLACE_EQUIPMENT_TYPES)[number]["category"]

function codesOf(category: MarketplaceEquipmentCategory) {
  return MARKETPLACE_EQUIPMENT_TYPES.filter((type) => type.category === category)
}

/** The presets, grouped as the form shows them. Only these codes exist (`marketplace.equipment_types`). */
export const MARKETPLACE_EQUIPMENT_GROUPS = Object.freeze({
  attachment: codesOf("attachment"),
  trailer: codesOf("trailer"),
  truck: codesOf("truck")
})

const TRUCK_CODES = MARKETPLACE_EQUIPMENT_GROUPS.truck.map((type) => type.code) as [string, ...string[]]
const TRAILER_CODES = MARKETPLACE_EQUIPMENT_GROUPS.trailer.map((type) => type.code) as [string, ...string[]]
const ATTACHMENT_CODES = MARKETPLACE_EQUIPMENT_GROUPS.attachment.map((type) => type.code) as [string, ...string[]]

export const HAULER_UNITS_MAX = 500
/** "Other (describe)": the business's own words for a trailer or body that is not on the list. */
export const HAULER_OTHER_TRAILER_MAX_LENGTH = 40
/**
 * Days after which a self-report is shown as "Not recently confirmed". A display band, and a placeholder: the
 * freshness threshold is an open founder decision (spec §14; UX 02 §A5 note).
 */
export const HAULER_AVAILABILITY_FRESH_DAYS = 7
/** How far ahead "Available from" may be (the store keeps a report's window within 90 days). */
export const HAULER_AVAILABILITY_LEAD_DAYS = 90
/** A report covers the week from its start; "Confirm all as shown" renews it from today. */
export const HAULER_AVAILABILITY_WINDOW_DAYS = 7

export const OTHER_TRAILER = "other"
export const NO_TRAILER = "none"

const count = (min: number, message: string) =>
  z.coerce
    .number({ invalid_type_error: message })
    .int(message)
    .min(min, message)
    .max(HAULER_UNITS_MAX, `Enter a number up to ${HAULER_UNITS_MAX}`)

/** Add a truck configuration (truck + optional trailer or "Other (describe)", optional extras) or an extra alone. */
export const haulerEquipmentAddInputSchema = z
  .object({
    attachments: z.array(z.enum(ATTACHMENT_CODES)).max(ATTACHMENT_CODES.length).default([]),
    count: count(1, "Enter how many, from 1"),
    otherTrailer: z
      .string()
      .max(HAULER_OTHER_TRAILER_MAX_LENGTH * 2)
      .transform((value) => value.replace(/\s+/g, " ").trim())
      .default(""),
    trailer: z.union([z.enum(TRAILER_CODES), z.literal(NO_TRAILER), z.literal(OTHER_TRAILER)]).default(NO_TRAILER),
    truckCode: z.enum(TRUCK_CODES, { errorMap: () => ({ message: "Choose the truck" }) })
  })
  .superRefine((value, context) => {
    if (value.trailer === OTHER_TRAILER && (value.otherTrailer.length < 2 || value.otherTrailer.length > HAULER_OTHER_TRAILER_MAX_LENGTH)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Describe the trailer in 2 to ${HAULER_OTHER_TRAILER_MAX_LENGTH} characters`, path: ["otherTrailer"] })
    }
  })

export type HaulerEquipmentAddInput = z.output<typeof haulerEquipmentAddInputSchema>

/** Change how many of one listed configuration or extra the business has; 0 removes it from the list. */
export const haulerEquipmentCountInputSchema = z.object({
  count: count(0, "Enter how many, from 0"),
  unitId: z.string().uuid()
})

export type HaulerEquipmentCountInput = z.output<typeof haulerEquipmentCountInputSchema>

export const HAULER_AVAILABILITY_STATES = ["now", "from", "none"] as const
export type HaulerAvailabilityState = (typeof HAULER_AVAILABILITY_STATES)[number]

const calendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date trucks are free")

/** Report availability for one truck type: available now, from a date, or not available. */
export const haulerAvailabilityInputSchema = z
  .object({
    count: z.union([count(1, "Enter how many are available, from 1"), z.null()]).default(null),
    equipmentCode: z.enum(TRUCK_CODES, { errorMap: () => ({ message: "Choose the truck type" }) }),
    fromDate: z.union([calendarDay, z.null()]).default(null),
    state: z.enum(HAULER_AVAILABILITY_STATES, { errorMap: () => ({ message: "Choose whether trucks are available" }) })
  })
  .superRefine((value, context) => {
    if (value.state !== "none" && value.count === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Enter how many are available, from 1", path: ["count"] })
    }
    if (value.state === "from" && value.fromDate === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Choose the date trucks are free", path: ["fromDate"] })
    }
  })

export type HaulerAvailabilityInput = z.output<typeof haulerAvailabilityInputSchema>

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** One listed configuration (a truck, with its trailer) or one extra, as the business reported it. */
export interface HaulerEquipmentUnitView {
  id: string
  category: "truck" | "attachment"
  /** The truck or attachment code (`equipment_units.equipment_code`). */
  equipmentCode: string
  /** A listed trailer code, or `null` with no trailer or an "Other (describe)" trailer. */
  trailerCode: string | null
  /** "Other (describe)" text, when the trailer is not on the list. */
  otherTrailer: string | null
  label: string
  units: number
}

/** The latest self-report for one truck type. `available` is open; `not_available` is a withdrawn report. */
export interface HaulerAvailabilityReportView {
  equipmentCode: string
  state: "available" | "not_available"
  availableCount: number | null
  /** UTC calendar date the trucks are free from (`available` only). */
  availableFrom: string | null
  availableUntil: string | null
  /** When the business last said so: the report time, or the withdrawal time for "not available". */
  reportedAt: string
}

export interface HaulerFleetView {
  organizationId: string
  units: HaulerEquipmentUnitView[]
  availability: HaulerAvailabilityReportView[]
  /** Owner, manager or staff (`equipment.manage`): drivers read the list. */
  canEdit: boolean
  /** The business has a service point (a placed home base), which an availability report needs. */
  placed: boolean
}

/** "Log truck + Pole trailer", "Log truck + Tri-axle jeep", "Chip truck", "On-board scales". */
export function haulerConfigurationLabel(equipmentCode: string, trailerCode: string | null, otherTrailer: string | null): string {
  const truck = marketplaceEquipmentLabel(equipmentCode)
  const trailer = trailerCode ? marketplaceEquipmentLabel(trailerCode) : otherTrailer

  return trailer ? `${truck} + ${trailer}` : truck
}
