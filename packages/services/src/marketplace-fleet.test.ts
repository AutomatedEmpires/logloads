import type { HaulerAvailabilityReportView, HaulerEquipmentUnitView, HaulerFleetView } from "@logloads/contracts"
import { haulerAvailabilityInputSchema, haulerEquipmentAddInputSchema } from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import {
  availabilityStamp,
  confirmableCodes,
  FLEET_EDIT_REFUSED,
  FLEET_NOT_HAULING,
  FLEET_NOT_PLACED,
  fleetCapacity,
  pilotHaulerFleet,
  planAvailabilityReport,
  planEquipmentAdd,
  registeredUnits,
  showsCapacityBoard
} from "./marketplace-fleet"

const NOW = new Date("2026-11-03T18:00:00.000Z")
const ORG = "33333333-bbbb-4bbb-8bbb-333333333333"

function unit(overrides: Partial<HaulerEquipmentUnitView>): HaulerEquipmentUnitView {
  return { category: "truck", equipmentCode: "log_truck", id: "u1", label: "Log truck + Pole trailer", otherTrailer: null, trailerCode: "pole_trailer", units: 2, ...overrides }
}

function report(overrides: Partial<HaulerAvailabilityReportView>): HaulerAvailabilityReportView {
  return { availableCount: 2, availableFrom: "2026-11-03", availableUntil: "2026-11-10", equipmentCode: "log_truck", reportedAt: "2026-11-03T08:00:00.000Z", state: "available", ...overrides }
}

function fleet(overrides: Partial<HaulerFleetView> = {}): HaulerFleetView {
  return {
    availability: [],
    canEdit: true,
    organizationId: ORG,
    placed: true,
    units: [unit({}), unit({ id: "u2", label: "Log truck + Bunk / short-log", trailerCode: "bunk_trailer", units: 4 }), unit({ equipmentCode: "chip_truck", id: "u3", label: "Chip truck", trailerCode: null, units: 1 }), unit({ category: "attachment", equipmentCode: "onboard_scales", id: "u4", label: "On-board scales", trailerCode: null, units: 3 })],
    ...overrides
  }
}

const availability = (input: Record<string, unknown>) => haulerAvailabilityInputSchema.parse(input)

describe("the count cap", () => {
  it("counts a truck type across its configurations, never its extras", () => {
    expect(registeredUnits(fleet(), "log_truck")).toBe(6)
    expect(registeredUnits(fleet(), "chip_truck")).toBe(1)
    expect(registeredUnits(fleet(), "onboard_scales")).toBe(0)
  })

  it("refuses more available than listed, and explains the limit", () => {
    expect(() => planAvailabilityReport(fleet(), availability({ count: 7, equipmentCode: "log_truck", state: "now" }), NOW)).toThrow(
      "You have 6 Log trucks listed, so at most 6 can be available."
    )
    expect(() => planAvailabilityReport(fleet(), availability({ count: 1, equipmentCode: "self_loader", state: "now" }), NOW)).toThrow("No Self-loader log truck is listed")
    expect(planAvailabilityReport(fleet(), availability({ count: 6, equipmentCode: "log_truck", state: "now" }), NOW)).toEqual({
      availableFrom: "2026-11-03",
      availableUntil: "2026-11-10",
      count: 6,
      equipmentCode: "log_truck",
      kind: "report"
    })
  })

  it("keeps a start date within today and 90 days, and needs a service area to report", () => {
    expect(() => planAvailabilityReport(fleet(), availability({ count: 1, equipmentCode: "log_truck", fromDate: "2026-11-02", state: "from" }), NOW)).toThrow(/from today/)
    expect(() => planAvailabilityReport(fleet(), availability({ count: 1, equipmentCode: "log_truck", fromDate: "2027-03-01", state: "from" }), NOW)).toThrow(/90 days/)
    expect(planAvailabilityReport(fleet(), availability({ count: 1, equipmentCode: "log_truck", fromDate: "2026-11-20", state: "from" }), NOW)).toMatchObject({ availableFrom: "2026-11-20", availableUntil: "2026-11-27" })
    expect(() => planAvailabilityReport(fleet({ placed: false }), availability({ count: 1, equipmentCode: "log_truck", state: "now" }), NOW)).toThrow(FLEET_NOT_PLACED)
    expect(planAvailabilityReport(fleet({ placed: false }), availability({ equipmentCode: "log_truck", state: "none" }), NOW)).toEqual({ equipmentCode: "log_truck", kind: "withdraw" })
  })

  it("refuses a driver's report and requires a count unless not available", () => {
    expect(() => planAvailabilityReport(fleet({ canEdit: false }), availability({ count: 1, equipmentCode: "log_truck", state: "now" }), NOW)).toThrow(FLEET_EDIT_REFUSED)
    expect(haulerAvailabilityInputSchema.safeParse({ equipmentCode: "log_truck", state: "now" }).success).toBe(false)
    expect(haulerAvailabilityInputSchema.safeParse({ count: 1, equipmentCode: "log_truck", state: "from" }).success).toBe(false)
    expect(haulerAvailabilityInputSchema.safeParse({ count: 1, equipmentCode: "pole_trailer", state: "now" }).success).toBe(false)
  })
})

describe("stale labelling", () => {
  it("says who and when for a fresh report, and Not recently confirmed for stale, expired or unknown", () => {
    expect(availabilityStamp(report({}), NOW)).toEqual({ fresh: true, label: "Updated today by the hauler" })
    expect(availabilityStamp(report({ reportedAt: "2026-10-31T08:00:00.000Z" }), NOW)).toEqual({ fresh: true, label: "Updated 3 days ago by the hauler" })
    expect(availabilityStamp(report({ reportedAt: "2026-10-27T08:00:00.000Z" }), NOW)).toEqual({ fresh: false, label: "Not recently confirmed" })
    expect(availabilityStamp(report({ availableUntil: "2026-11-02" }), NOW)).toEqual({ fresh: false, label: "Not recently confirmed" })
    expect(availabilityStamp(null, NOW)).toEqual({ fresh: false, label: "Not recently confirmed" })
  })

  it("never shows a stale or unknown row as zero, and never more available than listed", () => {
    const rows = fleetCapacity(fleet({
      availability: [
        report({ availableCount: 9 }),
        report({ availableCount: 1, equipmentCode: "chip_truck", reportedAt: "2026-10-01T08:00:00.000Z" })
      ]
    }), NOW)

    expect(rows.map((row) => [row.equipmentCode, row.have, row.available, row.state, row.stamp.label])).toEqual([
      ["log_truck", 6, 6, "available_now", "Updated today by the hauler"],
      ["chip_truck", 1, null, "unknown", "Not recently confirmed"]
    ])
  })

  it("shows a future start, and Not available with its date", () => {
    const rows = fleetCapacity(fleet({
      availability: [report({ availableFrom: "2026-11-12", availableUntil: "2026-11-19" }), report({ availableCount: null, availableFrom: null, availableUntil: null, equipmentCode: "chip_truck", state: "not_available" })]
    }), NOW)

    expect(rows[0]).toMatchObject({ from: "2026-11-12", state: "available_from", until: "2026-11-19" })
    expect(rows[1]).toMatchObject({ available: null, stamp: { fresh: true }, state: "not_available" })
  })

  it("confirms only rows with a fresh answer, and shows the board from two trucks", () => {
    expect(confirmableCodes(fleet({ availability: [report({}), report({ equipmentCode: "chip_truck", reportedAt: "2026-10-01T08:00:00.000Z" })] }), NOW)).toEqual(["log_truck"])
    expect(showsCapacityBoard(fleet())).toBe(true)
    expect(showsCapacityBoard(fleet({ units: [unit({ units: 1 })] }))).toBe(false)
    expect(showsCapacityBoard(fleet({ units: [unit({ units: 1 }), unit({ category: "attachment", equipmentCode: "onboard_scales", id: "a", units: 4 })] }))).toBe(false)
  })
})

describe("planEquipmentAdd", () => {
  const add = (input: Record<string, unknown>) => haulerEquipmentAddInputSchema.parse(input)

  it("records presets only, with Other (describe) for a trailer that is not listed", () => {
    expect(planEquipmentAdd(fleet({ units: [] }), add({ count: 2, trailer: "chip_van", truckCode: "chip_truck" }))).toEqual([
      { count: 2, equipmentCode: "chip_truck", label: "Chip truck + Chip van", otherTrailer: null, pairedTrailerCode: "chip_van" }
    ])
    expect(planEquipmentAdd(fleet({ units: [] }), add({ count: 1, otherTrailer: " Tri-axle  jeep ", trailer: "other", truckCode: "log_truck" }))[0]).toMatchObject({
      label: "Log truck + Tri-axle jeep",
      otherTrailer: "Tri-axle jeep",
      pairedTrailerCode: null
    })
    expect(haulerEquipmentAddInputSchema.safeParse({ count: 1, trailer: "other", truckCode: "log_truck" }).success).toBe(false)
    expect(haulerEquipmentAddInputSchema.safeParse({ count: 1, truckCode: "flatbed" }).success).toBe(false)
    expect(haulerEquipmentAddInputSchema.safeParse({ count: 1, trailer: "flatbed", truckCode: "log_truck" }).success).toBe(false)
  })

  it("adds extras to their own count and refuses a configuration already listed", () => {
    expect(planEquipmentAdd(fleet(), add({ attachments: ["onboard_scales", "central_tire"], count: 2, truckCode: "self_loader" }))).toEqual([
      expect.objectContaining({ count: 2, equipmentCode: "self_loader", label: "Self-loader log truck" }),
      expect.objectContaining({ count: 5, equipmentCode: "onboard_scales" }),
      expect.objectContaining({ count: 2, equipmentCode: "central_tire" })
    ])
    expect(() => planEquipmentAdd(fleet(), add({ count: 1, trailer: "pole_trailer", truckCode: "log_truck" }))).toThrow("Log truck + Pole trailer is already in your list")
    expect(() => planEquipmentAdd(fleet({ canEdit: false }), add({ count: 1, truckCode: "self_loader" }))).toThrow(FLEET_EDIT_REFUSED)
  })
})

describe("pilotHaulerFleet", () => {
  it("reads the pilot's listed equipment with every availability unknown", () => {
    const state = createInMemoryDatabase()
    const membership = state.organizationMemberships.find((candidate) => {
      const organization = state.organizations.find((org) => org.id === candidate.organizationId)
      return candidate.status === "active" && candidate.role === "owner" && (organization?.type === "carrier" || organization?.type === "fleet")
    })!
    const view = pilotHaulerFleet(state, { actorUserId: membership.userId, organizationId: membership.organizationId })

    expect(view).toMatchObject({ availability: [], organizationId: membership.organizationId, placed: false })
    expect(fleetCapacity(view, NOW).every((row) => row.state === "unknown" && row.available === null)).toBe(true)
  })

  it("refuses a landing-only business and a non-member", () => {
    const state = createInMemoryDatabase()
    const landing = state.organizationMemberships.find((candidate) =>
      candidate.status === "active" && state.organizations.find((org) => org.id === candidate.organizationId)?.type === "landing_source")!
    const hauling = state.organizations.find((org) => org.type === "carrier" || org.type === "fleet")!

    expect(() => pilotHaulerFleet(state, { actorUserId: landing.userId, organizationId: landing.organizationId })).toThrow(FLEET_NOT_HAULING)
    expect(() => pilotHaulerFleet(state, { actorUserId: landing.userId, organizationId: hauling.id })).toThrow()
  })
})
