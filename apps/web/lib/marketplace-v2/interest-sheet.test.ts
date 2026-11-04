import type { HaulerAvailabilityReportView, HaulerEquipmentUnitView, HaulerFleetView, MarketplaceHaulerEquipmentOption, MarketplaceInterestView } from "@logloads/contracts"
import { fleetCapacity } from "@logloads/services"
import { describe, expect, it } from "vitest"

import { capacityContradictions, contradictionText } from "./interest-capacity"
import {
  availabilityHref,
  configurationTruckCode,
  interestConfirmation,
  interestSheetModel,
  offeredTrucksText,
  reportedAvailability,
  sentContradictions,
  standingInterestSummary
} from "./interest-sheet"

/**
 * The interest sheet's rules (UX 02 §A8; UX-08 #131): which configurations come first, what is filled in from My trucks
 * and the business's last inquiry, when "Update availability?" is shown, and what the confirmation says.
 */

const NOW = new Date("2026-11-04T18:00:00.000Z")
const TODAY = "2026-11-04"
const ORG = "33333333-bbbb-4bbb-8bbb-333333333333"

const POLE: MarketplaceHaulerEquipmentOption = { configurationKey: "log_truck|pole_trailer", equipmentCodes: ["log_truck", "pole_trailer"], label: "Log truck + Pole trailer", unitsListed: 3 }
const BUNK: MarketplaceHaulerEquipmentOption = { configurationKey: "log_truck|bunk_trailer", equipmentCodes: ["log_truck", "bunk_trailer"], label: "Log truck + Bunk / short-log", unitsListed: 4 }
const CHIP: MarketplaceHaulerEquipmentOption = { configurationKey: "chip_truck|chip_van", equipmentCodes: ["chip_truck", "chip_van"], label: "Chip truck + Chip van", unitsListed: 2 }

function unit(option: MarketplaceHaulerEquipmentOption): HaulerEquipmentUnitView {
  const [truck = "", trailer = null] = option.equipmentCodes
  return { category: "truck", equipmentCode: truck, id: option.configurationKey, label: option.label, otherTrailer: null, trailerCode: trailer, units: option.unitsListed }
}

function report(overrides: Partial<HaulerAvailabilityReportView>): HaulerAvailabilityReportView {
  return { availableCount: 2, availableFrom: TODAY, availableUntil: "2026-11-11", equipmentCode: "log_truck", reportedAt: "2026-11-04T08:00:00.000Z", state: "available", ...overrides }
}

function capacity(options: MarketplaceHaulerEquipmentOption[], availability: HaulerAvailabilityReportView[] = []) {
  const fleet: HaulerFleetView = { availability, canEdit: true, organizationId: ORG, placed: true, units: options.map(unit) }
  return fleetCapacity(fleet, NOW)
}

const JOB = { equipment: ["log_truck", "pole_trailer"], trucks: { perDay: 3, total: 6 } }

function model(overrides: Partial<Parameters<typeof interestSheetModel>[0]> = {}) {
  const options = overrides.options ?? [BUNK, POLE, CHIP]
  return interestSheetModel({
    businessName: "Ridgeline Hauling",
    capacity: capacity([...options]),
    interests: [],
    job: JOB,
    options,
    today: TODAY,
    ...overrides
  })
}

const counts = (rows: Array<{ label: string; count: number }>) => rows.map((row) => [row.label, row.count])

describe("which trucks come first (criterion 1)", () => {
  it("lists the configurations the job asks for first, and the rest behind 'Show my other trucks' at 0", () => {
    const sheet = model()

    expect(sheet.requested.map((row) => row.label)).toEqual(["Log truck + Pole trailer"])
    expect(counts(sheet.others)).toEqual([["Log truck + Bunk / short-log", 0], ["Chip truck + Chip van", 0]])
    expect(sheet.unmatchedEquipment).toBeNull()
    expect(sheet.businessName).toBe("Ridgeline Hauling")
  })

  it("offers every configuration first when the job states no equipment", () => {
    const sheet = model({ job: { equipment: [], trucks: { perDay: null, total: null } } })

    expect(sheet.requested.map((row) => row.label)).toEqual(["Log truck + Bunk / short-log", "Log truck + Pole trailer", "Chip truck + Chip van"])
    expect(sheet.others).toEqual([])
  })

  it("says so, and fills nothing in, when none of the business's configurations has what the job asks for", () => {
    const sheet = model({ job: { equipment: ["self_loader"], trucks: { perDay: 2, total: null } } })

    expect(sheet.unmatchedEquipment).toBe("Self-loader log truck")
    expect(counts(sheet.requested)).toEqual([["Log truck + Bunk / short-log", 0], ["Log truck + Pole trailer", 0], ["Chip truck + Chip van", 0]])
    expect(sheet.others).toEqual([])
  })

  it("keeps a plain count of one for a business with no equipment listed", () => {
    const sheet = model({ capacity: [], options: [] })

    expect(sheet.requested).toEqual([])
    expect(sheet.trucksOffered).toBe(1)
    expect(sheet.unmatchedEquipment).toBeNull()
    expect(sheet.trucksHref).toBe("/v2/hauler/trucks")
  })
})

describe("what is filled in from My trucks (criterion 1)", () => {
  it("offers the fresh available count of each truck type, spread over its requested configurations and capped at the units listed", () => {
    const options = [POLE, { ...POLE, configurationKey: "log_truck|pole_trailer|b", label: "Log truck + Pole trailer (short)", unitsListed: 2 }]
    const sheet = model({ capacity: capacity(options, [report({ availableCount: 4 })]), job: { ...JOB, trucks: { perDay: null, total: null } }, options })

    // 4 Log trucks available across the two pole configurations: 3, then the 1 left.
    expect(counts(sheet.requested)).toEqual([["Log truck + Pole trailer", 3], ["Log truck + Pole trailer (short)", 1]])
    // A report is per truck type, so with two setups of the type no row claims a count of its own.
    expect(sheet.requested[0]?.capacity).toMatchObject({
      available: null, line: "Available now: 4 of 5 across your Log truck setups · Updated today by the hauler", state: "available_now"
    })
  })

  it("gives a setup that is its truck type's only one the type's count, never above its units", () => {
    const sheet = model({ capacity: capacity([POLE], [report({ availableCount: 3 })]), options: [POLE] })

    expect(sheet.requested[0]?.capacity).toMatchObject({ available: 3, line: "Available now · Updated today by the hauler", state: "available_now" })
  })

  it("never fills in more than the trucks the job asks for: a day's trucks when stated, else the job's", () => {
    const withReport = capacity([POLE], [report({ availableCount: 3 })])

    expect(counts(model({ capacity: withReport, job: { ...JOB, trucks: { perDay: 2, total: 6 } }, options: [POLE] }).requested)).toEqual([["Log truck + Pole trailer", 2]])
    expect(counts(model({ capacity: withReport, job: { ...JOB, trucks: { perDay: null, total: 1 } }, options: [POLE] }).requested)).toEqual([["Log truck + Pole trailer", 1]])
  })

  it("dates the offer from a shared window: today, a future start, or the later start only when every offered window includes it", () => {
    const now = model({ capacity: capacity([POLE], [report({})]), options: [POLE] })
    expect([now.availableFrom, now.availableFromSource]).toEqual([TODAY, "availability"])

    const later = model({ capacity: capacity([POLE], [report({ availableFrom: "2026-11-12", availableUntil: "2026-11-19" })]), options: [POLE] })
    expect(later.availableFrom).toBe("2026-11-12")
    expect(later.requested[0]?.capacity.line).toBe("Available from Nov 12, 2026 · Updated today by the hauler")

    const both = [POLE, { ...CHIP, equipmentCodes: ["chip_truck"] }]
    const overlapping = model({
      capacity: capacity(both, [
        report({ availableUntil: "2026-11-25" }),
        report({ availableFrom: "2026-11-12", availableUntil: "2026-11-19", equipmentCode: "chip_truck" })
      ]),
      job: { equipment: [], trucks: { perDay: null, total: null } },
      options: both
    })
    expect(overlapping.availableFrom).toBe("2026-11-12")

    // Log truck is free through Nov 11. Chip truck starts Nov 20. Nov 20 is not a day both reports support.
    const separate = model({
      capacity: capacity(both, [report({}), report({ availableFrom: "2026-11-20", availableUntil: "2026-11-27", equipmentCode: "chip_truck" })]),
      job: { equipment: [], trucks: { perDay: null, total: null } },
      options: both
    })
    expect([separate.availableFrom, separate.availableFromSource]).toEqual(["", null])
    expect(counts(separate.requested)).toEqual([["Log truck + Pole trailer", 2], ["Chip truck + Chip van", 2]])
  })

  it("offers none of a type reported not available, and no date for it", () => {
    const sheet = model({ capacity: capacity([POLE], [report({ availableCount: null, state: "not_available" })]), options: [POLE] })

    expect(counts(sheet.requested)).toEqual([["Log truck + Pole trailer", 0]])
    expect(sheet.requested[0]?.capacity).toMatchObject({ available: 0, state: "not_available" })
    expect(sheet.availableFrom).toBe("")
  })

  it("with no recent report, offers one truck of the first requested configuration and leaves the date empty", () => {
    const stale = model({ capacity: capacity([BUNK, POLE], [report({ reportedAt: "2026-10-20T08:00:00.000Z" })]), job: { equipment: [], trucks: { perDay: 3, total: null } }, options: [BUNK, POLE] })

    expect(counts(stale.requested)).toEqual([["Log truck + Bunk / short-log", 1], ["Log truck + Pole trailer", 0]])
    expect(stale.requested[0]?.capacity).toEqual({ available: null, from: null, line: null, stamp: "Not recently confirmed", state: "unknown", until: null })
    expect([stale.availableFrom, stale.availableFromSource]).toEqual(["", null])
    expect(stale.reports).toEqual([])

    // The pilot store holds no availability report at all (#126): the same.
    expect(counts(model({ capacity: [], options: [POLE] }).requested)).toEqual([["Log truck + Pole trailer", 1]])
  })
})

describe("what is filled in from the business (criterion 1)", () => {
  const sent = (contactPreference: MarketplaceInterestView["contactPreference"], updatedAt: string) => ({ contactPreference, updatedAt })

  it("reaches the business the way its last inquiry did", () => {
    const sheet = model({ interests: [sent("email", "2026-10-01T10:00:00.000Z"), sent("phone", "2026-11-01T10:00:00.000Z")] })

    expect([sheet.contactPreference, sheet.contactSource]).toEqual(["phone", "last_inquiry"])
  })

  it("uses LogLoads messages when the business has sent none (the profile has no contact route yet)", () => {
    expect([model().contactPreference, model().contactSource]).toEqual(["in_app", "default"])
  })
})

describe("offering more than was reported available (criterion 2)", () => {
  const reports = reportedAvailability(capacity([POLE, BUNK, CHIP], [report({ availableCount: 3 }), report({ availableCount: null, equipmentCode: "chip_truck", state: "not_available" })]))

  it("keeps only fresh, known reports, 'not available' as 0, each linking to its form in My trucks", () => {
    expect(reports).toEqual([
      { href: "/v2/hauler/trucks#availability-log_truck", label: "Log truck", reported: 3, truckCode: "log_truck" },
      { href: "/v2/hauler/trucks#availability-chip_truck", label: "Chip truck", reported: 0, truckCode: "chip_truck" }
    ])
    expect(availabilityHref("self_loader")).toBe("/v2/hauler/trucks#availability-self_loader")
  })

  it("adds up a truck type across its configurations and flags it only above the report", () => {
    expect(capacityContradictions([{ count: 2, truckCode: "log_truck" }, { count: 1, truckCode: "log_truck" }], reports)).toEqual([])

    const over = capacityContradictions([{ count: 2, truckCode: "log_truck" }, { count: 2, truckCode: "log_truck" }, { count: 1, truckCode: "chip_truck" }], reports)
    expect(over.map((entry) => [entry.truckCode, entry.offered, entry.reported])).toEqual([["log_truck", 4, 3], ["chip_truck", 1, 0]])
    expect(over.map((entry) => contradictionText(entry, "offering"))).toEqual([
      "Log truck: you reported 3 available, and this offers 4.",
      "Chip truck: you reported none available, and this offers 1."
    ])
  })

  it("never flags a truck type with no recent report, whatever is offered", () => {
    expect(capacityContradictions([{ count: 50, truckCode: "self_loader" }, { count: 9, truckCode: null }], reports)).toEqual([])
  })

  it("flags a sent offer the same way, matched to truck types through the business's own configurations", () => {
    const over = sentContradictions({ equipment: [{ configurationKey: POLE.configurationKey, count: 3, label: POLE.label }, { configurationKey: BUNK.configurationKey, count: 1, label: BUNK.label }] }, [POLE, BUNK], capacity([POLE, BUNK], [report({ availableCount: 3 })]))

    expect(over.map((entry) => contradictionText(entry, "sent"))).toEqual(["Log truck: you reported 3 available, and you offered 4."])
  })

  it("reads each configuration's truck type from its codes", () => {
    expect(configurationTruckCode(POLE)).toBe("log_truck")
    expect(configurationTruckCode({ equipmentCodes: ["pole_trailer"] })).toBeNull()
  })
})

describe("the confirmation (criterion 4)", () => {
  const interest = {
    availableFrom: "2026-11-10",
    equipment: [{ configurationKey: POLE.configurationKey, count: 2, label: POLE.label }],
    landingOrganization: { id: ORG, name: "North Pine Logging" },
    replies: [],
    status: "submitted" as const,
    trucksOffered: 2,
    updatedAt: "2026-11-04T18:00:00.000Z"
  }

  it("names the landing business, the trucks and the date", () => {
    expect(interestConfirmation(interest)).toBe("Sent to North Pine Logging: 2 trucks (2 × Log truck + Pole trailer), available from Nov 10, 2026.")
    expect(interestConfirmation({ ...interest, availableFrom: null, equipment: [], trucksOffered: 1 }))
      .toBe("Sent to North Pine Logging: 1 truck, sent Nov 4, 2026, with no start date given.")
    expect(offeredTrucksText({ equipment: [], trucksOffered: 3 })).toBe("3 trucks")
  })

  it("summarises a standing interest with the status vocabulary (#205)", () => {
    expect(standingInterestSummary(interest)).toBe(
      "You offered North Pine Logging 2 trucks (2 × Log truck + Pole trailer), available from Nov 10, 2026. Sent · waiting for the landing."
    )
  })

  it("never reads as hired, booked or assigned", () => {
    for (const text of [interestConfirmation(interest), standingInterestSummary({ ...interest, status: "replied" })]) {
      expect(text).not.toMatch(/\b(hired|booked|assigned|dispatched|confirmed)\b/i)
    }
  })
})
