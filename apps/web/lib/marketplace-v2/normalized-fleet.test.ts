import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { FLEET_EDIT_REFUSED, FLEET_NOT_HAULING, FLEET_NOTHING_TO_WITHDRAW } from "@logloads/services"

import { createNormalizedMarketplaceV2 } from "./normalized-adapter"
import type { MarketplaceCalls, MarketplaceDb } from "./normalized-db"
import { reportFromRow, unitFromRow } from "./normalized-fleet"
import { MarketplaceRefusalError, type MarketplaceV2Viewer } from "./port"

/**
 * My trucks (#126) over a recording fake of the store: the shared rules run on rows read in the same transaction
 * before anything is written, and the statements' order. The SQL itself runs against PostgreSQL 17 in
 * `normalized-hauler.contract.test.ts` (CI).
 */

const HAUL = "44444444-cccc-4ccc-8ccc-cccccccccccc"
const USER = "55555555-dddd-4ddd-8ddd-dddddddddddd"
const UNIT = "66666666-eeee-4eee-8eee-eeeeeeeeeeee"
const viewer: MarketplaceV2Viewer = { organizationId: HAUL, userId: USER }
const NOW = new Date("2026-11-03T12:00:00.000Z")

let statements: Array<{ name: string; values: readonly unknown[] }>
let rows: Record<string, unknown[]>

const unitRow = { capacity_note: null, category: "truck", equipment_code: "log_truck", id: UNIT, paired_trailer_code: "pole_trailer", unit_count: 2, unit_label: "Log truck + Pole trailer" }

function fakeDb(): MarketplaceDb {
  const calls: MarketplaceCalls = {
    call: async () => [],
    inquiryJobs: async () => [],
    inquiryParties: async () => null,
    async query(name, values) {
      statements.push({ name, values })
      return rows[name] ?? []
    }
  }

  return { asAnon: (work) => work(calls), asUser: (_principal, work) => work(calls), close: async () => undefined }
}

const port = () =>
  createNormalizedMarketplaceV2({ db: fakeDb(), now: () => NOW, principal: async () => ({ audience: "aud", issuer: "https://issuer.test", subject: "user_x" }) })

beforeEach(() => {
  statements = []
  rows = {
    availability_insert: [{ id: "r" }],
    availability_withdraw: [],
    equipment_unit_set_count: [{ equipment_code: "log_truck", id: UNIT }],
    equipment_unit_upsert: [{ id: "u" }],
    hauler_availability_latest: [],
    hauler_equipment_units: [unitRow],
    hauler_fleet_access: [{ can_edit: true, org_id: HAUL, placed: true }]
  }
})

describe("haulerFleet", () => {
  it("reads access, units and the latest reports for the active business", async () => {
    await expect(port().haulerFleet(viewer)).resolves.toMatchObject({ canEdit: true, placed: true, units: [{ label: "Log truck + Pole trailer", units: 2 }] })
    expect(statements.map((statement) => [statement.name, statement.values])).toEqual([
      ["hauler_fleet_access", [HAUL]],
      ["hauler_equipment_units", [HAUL]],
      ["hauler_availability_latest", [HAUL]]
    ])
  })

  it("refuses when the person is not a member or the business is not hauling (no access row)", async () => {
    rows.hauler_fleet_access = []
    await expect(port().haulerFleet(viewer)).rejects.toThrow(FLEET_NOT_HAULING)
  })
})

describe("reportHaulerAvailability", () => {
  it("refuses more than the units listed before any write", async () => {
    await expect(port().reportHaulerAvailability(viewer, { count: 3, equipmentCode: "log_truck", state: "now" })).rejects.toThrow("at most 2 can be available")
    expect(statements.some((statement) => statement.name.startsWith("availability_"))).toBe(false)
  })

  it("replaces the open report with one dated by the server clock", async () => {
    await port().reportHaulerAvailability(viewer, { count: 2, equipmentCode: "log_truck", state: "now" })
    expect(statements.slice(-2)).toEqual([
      { name: "availability_withdraw", values: [HAUL, "log_truck"] },
      { name: "availability_insert", values: [HAUL, "log_truck", 2, "2026-11-03", "2026-11-10"] }
    ])
  })

  it("re-dates the latest withdrawal when Not available is said again", async () => {
    rows.availability_restate_withdrawn = [{ id: "r" }]
    await port().reportHaulerAvailability(viewer, { count: null, equipmentCode: "log_truck", state: "none" })
    expect(statements.slice(-2).map((statement) => statement.name)).toEqual(["availability_withdraw", "availability_restate_withdrawn"])
  })

  it("says nothing was saved when Not available has no report to withdraw or re-date", async () => {
    await expect(port().reportHaulerAvailability(viewer, { count: null, equipmentCode: "log_truck", state: "none" })).rejects.toThrow(FLEET_NOTHING_TO_WITHDRAW)
    expect(statements.some((statement) => statement.name === "availability_insert")).toBe(false)
  })

  it("refuses a driver (no edit right) with the shared rule's message", async () => {
    rows.hauler_fleet_access = [{ can_edit: false, org_id: HAUL, placed: true }]
    await expect(port().reportHaulerAvailability(viewer, { count: 1, equipmentCode: "log_truck", state: "now" })).rejects.toThrow(FLEET_EDIT_REFUSED)
  })
})

describe("equipment", () => {
  it("records a configuration and its extras, and fits availability to a lowered list", async () => {
    await port().addHaulerEquipment(viewer, { attachments: ["onboard_scales"], count: 1, trailer: "none", truckCode: "chip_truck" })
    expect(statements.filter((statement) => statement.name === "equipment_unit_upsert").map((statement) => statement.values)).toEqual([
      [HAUL, "chip_truck", null, "Chip truck", 1, null],
      [HAUL, "onboard_scales", null, "On-board scales", 1, null]
    ])

    statements = []
    await port().setHaulerEquipmentCount(viewer, { count: 1, unitId: UNIT })
    expect(statements.map((statement) => statement.name)).toEqual([
      "equipment_unit_set_count", "hauler_fleet_access", "hauler_equipment_units", "hauler_availability_latest", "availability_clamp"
    ])
  })

  it("refuses an update that row-level security filtered out", async () => {
    rows.equipment_unit_set_count = []
    await expect(port().setHaulerEquipmentCount(viewer, { count: 1, unitId: UNIT })).rejects.toBeInstanceOf(MarketplaceRefusalError)
  })
})

describe("row mapping", () => {
  it("rebuilds an Other (describe) trailer from its note, and maps a withdrawal as not available", () => {
    expect(unitFromRow({ ...unitRow, capacity_note: "Other trailer: Tri-axle jeep", paired_trailer_code: null, unit_label: "Log truck + Tri-axle jeep" })).toMatchObject({
      otherTrailer: "Tri-axle jeep",
      trailerCode: null
    })
    expect(reportFromRow({ available_count: 2, available_from: "2026-11-01", available_until: "2026-11-08", equipment_code: "log_truck", reported_at: "2026-11-01T08:00:00+00:00", withdrawn_at: "2026-11-02T09:00:00+00:00" })).toEqual({
      availableCount: null,
      availableFrom: null,
      availableUntil: null,
      equipmentCode: "log_truck",
      reportedAt: "2026-11-02T09:00:00.000Z",
      state: "not_available"
    })
  })
})
