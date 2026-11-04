import "server-only"

import {
  haulerAvailabilityInputSchema,
  haulerConfigurationLabel,
  haulerEquipmentAddInputSchema,
  haulerEquipmentCountInputSchema,
  type HaulerAvailabilityReportView,
  type HaulerEquipmentUnitView,
  type HaulerFleetView
} from "@logloads/contracts"
import {
  confirmableCodes,
  DomainRefusalError,
  FLEET_EDIT_REFUSED,
  FLEET_NOT_HAULING,
  FLEET_NOTHING_TO_WITHDRAW,
  planAvailabilityReport,
  planEquipmentAdd,
  registeredUnits
} from "@logloads/services"
import { z } from "zod"

import type { MarketplaceCalls } from "./normalized-db"
import { MarketplaceRefusalError, MarketplaceStoreError, type MarketplaceV2Port, type MarketplaceV2Viewer } from "./port"

/**
 * "My trucks" over the normalized `marketplace` schema (#126): equipment_units and availability_reports through the
 * catalogued statements in `normalized-queries.ts`. The shared rules (`planEquipmentAdd`, `planAvailabilityReport`,
 * the count cap) run inside the same transaction as the writes, on rows read in it; the schema's row-level security,
 * grants and triggers then decide again (availability_guard stamps `reported_at` on every write).
 */

const FIX_FIELDS = "Fix the highlighted fields before saving"

function toIso(value: string): string {
  const instant = new Date(value)

  if (Number.isNaN(instant.getTime())) {
    throw new MarketplaceStoreError(undefined, "22007")
  }

  return instant.toISOString()
}

function parsed<T>(schema: z.ZodType<T>, row: unknown): T {
  const result = schema.safeParse(row)

  if (!result.success) {
    throw new MarketplaceStoreError(undefined, "22P02")
  }

  return result.data
}

const accessRow = z.object({ can_edit: z.boolean(), org_id: z.string().uuid(), placed: z.boolean() })

const unitRow = z.object({
  capacity_note: z.string().nullable(),
  category: z.enum(["truck", "attachment"]),
  equipment_code: z.string(),
  id: z.string().uuid(),
  paired_trailer_code: z.string().nullable(),
  unit_count: z.number().int(),
  unit_label: z.string()
})

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const reportRow = z.object({
  available_count: z.number().int(),
  available_from: day,
  available_until: day,
  equipment_code: z.string(),
  reported_at: z.string(),
  withdrawn_at: z.string().nullable()
})

/** "Other (describe)" text is kept in `capacity_note` as `Other trailer: …`, so the label is rebuilt from the row. */
export const OTHER_TRAILER_NOTE = "Other trailer: "

export function unitFromRow(row: unknown): HaulerEquipmentUnitView {
  const value = parsed(unitRow, row)
  const otherTrailer = value.capacity_note?.startsWith(OTHER_TRAILER_NOTE) ? value.capacity_note.slice(OTHER_TRAILER_NOTE.length) || null : null

  return {
    category: value.category,
    equipmentCode: value.equipment_code,
    id: value.id,
    // Rows written elsewhere keep their own label; rows V2 wrote have exactly this one.
    label: value.unit_label || haulerConfigurationLabel(value.equipment_code, value.paired_trailer_code, otherTrailer),
    otherTrailer,
    trailerCode: value.paired_trailer_code,
    units: value.unit_count
  }
}

export function reportFromRow(row: unknown): HaulerAvailabilityReportView {
  const value = parsed(reportRow, row)
  const withdrawn = value.withdrawn_at !== null

  return {
    availableCount: withdrawn ? null : value.available_count,
    availableFrom: withdrawn ? null : value.available_from,
    availableUntil: withdrawn ? null : value.available_until,
    equipmentCode: value.equipment_code,
    reportedAt: toIso(value.withdrawn_at ?? value.reported_at),
    state: withdrawn ? "not_available" : "available"
  }
}

async function readFleet(calls: MarketplaceCalls, viewer: MarketplaceV2Viewer): Promise<HaulerFleetView> {
  const [access] = await calls.query("hauler_fleet_access", [viewer.organizationId])

  if (!access) {
    throw new MarketplaceRefusalError(FLEET_NOT_HAULING, "42501")
  }

  const { can_edit: canEdit, placed } = parsed(accessRow, access)
  const [units, reports] = await Promise.all([
    calls.query("hauler_equipment_units", [viewer.organizationId]),
    calls.query("hauler_availability_latest", [viewer.organizationId])
  ])

  return { availability: reports.map(reportFromRow), canEdit, organizationId: viewer.organizationId, placed, units: units.map(unitFromRow) }
}

function asRefusal(error: unknown): never {
  if (error instanceof DomainRefusalError) {
    throw new MarketplaceRefusalError(error.message, "23514")
  }

  throw error
}

function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input)

  if (!result.success) {
    throw new MarketplaceRefusalError(FIX_FIELDS, "23514")
  }

  return result.data
}

/** After a count change: an open report never claims more of a type than is listed; none listed withdraws it. */
async function fitAvailabilityToList(calls: MarketplaceCalls, viewer: MarketplaceV2Viewer, equipmentCode: string) {
  const fleet = await readFleet(calls, viewer)
  const registered = registeredUnits(fleet, equipmentCode)

  if (registered === 0) {
    await calls.query("availability_withdraw", [viewer.organizationId, equipmentCode])
  } else {
    await calls.query("availability_clamp", [viewer.organizationId, equipmentCode, registered])
  }
}

type AsViewer = <T>(viewer: MarketplaceV2Viewer, work: (calls: MarketplaceCalls) => Promise<T>, options: { readOnly: boolean }) => Promise<T>

type FleetMethods = "supportsHaulerFleet" | "haulerFleet" | "addHaulerEquipment" | "setHaulerEquipmentCount" | "reportHaulerAvailability" | "confirmHaulerAvailability"

export function normalizedHaulerFleetMethods(asViewer: AsViewer, now: () => Date): Pick<MarketplaceV2Port, FleetMethods> {
  const write = { readOnly: false }

  return {
    supportsHaulerFleet: true,

    async haulerFleet(viewer) {
      return asViewer(viewer, (calls) => readFleet(calls, viewer), { readOnly: true })
    },

    async addHaulerEquipment(viewer, rawInput) {
      const input = parse(haulerEquipmentAddInputSchema, rawInput)

      await asViewer(viewer, async (calls) => {
        let records: ReturnType<typeof planEquipmentAdd>

        try {
          records = planEquipmentAdd(await readFleet(calls, viewer), input)
        } catch (error) {
          asRefusal(error)
        }

        for (const record of records) {
          const added = await calls.query("equipment_unit_upsert", [
            viewer.organizationId,
            record.equipmentCode,
            record.pairedTrailerCode,
            record.label,
            record.count,
            record.otherTrailer ? `${OTHER_TRAILER_NOTE}${record.otherTrailer}` : null
          ])

          if (added.length !== 1) throw new MarketplaceRefusalError(FLEET_EDIT_REFUSED, "42501")
        }
      }, write)
    },

    async setHaulerEquipmentCount(viewer, rawInput) {
      const input = parse(haulerEquipmentCountInputSchema, rawInput)

      await asViewer(viewer, async (calls) => {
        const [changed] = await calls.query("equipment_unit_set_count", [viewer.organizationId, input.unitId, input.count])

        if (!changed) {
          throw new MarketplaceRefusalError(FLEET_EDIT_REFUSED, "42501")
        }

        const code = parsed(z.object({ equipment_code: z.string() }), changed).equipment_code
        await fitAvailabilityToList(calls, viewer, code)
      }, write)
    },

    async reportHaulerAvailability(viewer, rawInput) {
      const input = parse(haulerAvailabilityInputSchema, rawInput)

      await asViewer(viewer, async (calls) => {
        let plan: ReturnType<typeof planAvailabilityReport>

        try {
          plan = planAvailabilityReport(await readFleet(calls, viewer), input, now())
        } catch (error) {
          asRefusal(error)
        }

        const withdrawn = await calls.query("availability_withdraw", [viewer.organizationId, plan.equipmentCode])

        if (plan.kind === "withdraw") {
          if (withdrawn.length > 0) return
          // Saying "not available" again re-states the latest withdrawal, so the date shown is today's. With no
          // report of this type at all there is nothing to record, and that is said rather than claimed as saved.
          const restated = await calls.query("availability_restate_withdrawn", [viewer.organizationId, plan.equipmentCode])
          if (restated.length === 0) throw new MarketplaceRefusalError(FLEET_NOTHING_TO_WITHDRAW, "23514")
          return
        }

        const added = await calls.query("availability_insert", [viewer.organizationId, plan.equipmentCode, plan.count, plan.availableFrom, plan.availableUntil])

        if (added.length !== 1) throw new MarketplaceRefusalError(FLEET_EDIT_REFUSED, "42501")
      }, write)
    },

    async confirmHaulerAvailability(viewer) {
      return asViewer(viewer, async (calls) => {
        const fleet = await readFleet(calls, viewer)

        if (!fleet.canEdit) {
          throw new MarketplaceRefusalError(FLEET_EDIT_REFUSED, "42501")
        }

        const codes = confirmableCodes(fleet, now())

        for (const code of codes) {
          const report = fleet.availability.find((candidate) => candidate.equipmentCode === code)
          await calls.query(report?.state === "available" ? "availability_renew" : "availability_restate_withdrawn", [viewer.organizationId, code])
        }

        return { confirmed: codes.length }
      }, write)
    }
  }
}
