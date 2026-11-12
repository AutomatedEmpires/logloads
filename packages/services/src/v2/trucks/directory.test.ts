import { describe, expect, it } from "vitest"

import {
  MARKETPLACE_TRUCK_CARD_KEYS,
  TRUCK_DIRECTORY_DAILY_PAGE_LIMIT,
  TRUCK_DIRECTORY_DAILY_VIEW_LIMIT,
  TRUCK_DIRECTORY_PAGE_SIZE,
  TRUCK_DIRECTORY_REFUSALS,
  marketplaceTruckFiltersSchema,
  type MarketplaceTruckCardView,
  type MarketplaceTruckDirectoryQuery
} from "@logloads/contracts"

import {
  compareTruckCards,
  truckAvailabilitySummary,
  truckCard,
  truckDirectoryAccess,
  truckDirectoryGrant,
  truckDirectoryPage,
  truckEntryMatches,
  truckSavedSearchAccess,
  type TruckDirectoryEntry,
  type TruckDirectoryReport
} from "./index"

const NOW = new Date("2026-11-10T12:00:00.000Z")
const ORG_A = "11111111-aaaa-4aaa-8aaa-111111111111"
const ORG_B = "22222222-bbbb-4bbb-8bbb-222222222222"
const ORG_C = "33333333-cccc-4ccc-8ccc-333333333333"
const ORG_D = "44444444-dddd-4ddd-8ddd-444444444444"

const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()

function report(overrides: Partial<TruckDirectoryReport> = {}): TruckDirectoryReport {
  return {
    availableCount: 2,
    availableFrom: "2026-11-10",
    availableUntil: "2026-11-17",
    equipmentCode: "log_truck",
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    reportedAt: daysAgo(1),
    ...overrides
  }
}

function entry(overrides: Partial<TruckDirectoryEntry> = {}): TruckDirectoryEntry {
  return {
    acceptsInvitations: true,
    availability: [report()],
    businessName: "Sweet Home Hauling",
    equipment: [{ equipmentCode: "log_truck", trailerCode: "pole_trailer", units: 3 }],
    homeBase: "Sweet Home, OR",
    listed: true,
    operatingStates: ["OR"],
    organizationId: ORG_A,
    serviceRadiusMiles: 80,
    servicePoint: { lat: 44.4, lng: -122.7 },
    verification: null,
    ...overrides
  }
}

const query = (filters: Record<string, unknown> = {}): MarketplaceTruckDirectoryQuery => marketplaceTruckFiltersSchema.parse(filters)

describe("availability freshness (never stale as current)", () => {
  it("names who confirmed and how long ago", () => {
    const summary = truckAvailabilitySummary("Sweet Home Hauling", [report({ reportedAt: daysAgo(3) })], NOW)

    expect(summary.view).toEqual({
      availableFrom: "2026-11-10",
      confirmedDaysAgo: 3,
      equipmentCodes: ["log_truck"],
      label: "Confirmed by Sweet Home Hauling 3 days ago",
      status: "available_now"
    })
    expect(summary.availableTrucks).toBe(2)
    expect(summary.reportedAt).toBe(daysAgo(3))
    expect(truckAvailabilitySummary("Sweet Home Hauling", [report({ reportedAt: NOW.toISOString() })], NOW).view.label)
      .toBe("Confirmed by Sweet Home Hauling today")
    expect(truckAvailabilitySummary("Sweet Home Hauling", [report({ reportedAt: daysAgo(1) })], NOW).view.label)
      .toBe("Confirmed by Sweet Home Hauling 1 day ago")
  })

  it("says a later start as available from, and adds up current counts across types", () => {
    const summary = truckAvailabilitySummary("Sweet Home Hauling", [
      report({ availableFrom: "2026-11-14", availableUntil: "2026-11-21" }),
      report({ availableCount: 1, availableFrom: "2026-11-12", equipmentCode: "self_loader", id: "aaaaaaaa-0000-4000-8000-000000000002" })
    ], NOW)

    expect(summary.view.status).toBe("available_from")
    expect(summary.view.availableFrom).toBe("2026-11-12")
    expect(summary.view.equipmentCodes).toEqual(["log_truck", "self_loader"])
    expect(summary.availableTrucks).toBe(3)
  })

  it("shows a report 7 days old as not recently confirmed, with its date and no count", () => {
    const summary = truckAvailabilitySummary("Sweet Home Hauling", [report({ reportedAt: daysAgo(7) })], NOW)

    expect(summary.view).toEqual({
      availableFrom: null,
      confirmedDaysAgo: 7,
      equipmentCodes: [],
      label: "Not recently confirmed. Sweet Home Hauling last confirmed 7 days ago",
      status: "not_recently_confirmed"
    })
    expect(summary.availableTrucks).toBeNull()
    expect(summary.reportedAt).toBe(daysAgo(7))
    expect(truckAvailabilitySummary("Sweet Home Hauling", [report({ reportedAt: daysAgo(6.9) })], NOW).view.status).toBe("available_now")
  })

  it("never counts a report past its last day, however recent", () => {
    const summary = truckAvailabilitySummary("Sweet Home Hauling", [report({ availableFrom: "2026-11-01", availableUntil: "2026-11-09" })], NOW)

    expect(summary.view.status).toBe("not_reported")
    expect(summary.view.label).toBe("No current availability reported")
    expect(summary.availableTrucks).toBeNull()
    expect(summary.reportedAt).toBeNull()
  })

  it("with no report says so, never zero trucks", () => {
    expect(truckAvailabilitySummary("Sweet Home Hauling", [], NOW)).toEqual({
      availableTrucks: null,
      reportedAt: null,
      view: { availableFrom: null, confirmedDaysAgo: null, equipmentCodes: [], label: "No current availability reported", status: "not_reported" }
    })
  })
})

describe("the card projection", () => {
  it("copies exactly the card keys, rounds the point to the 0.1° grid and summarizes equipment", () => {
    const card = truckCard(entry({ servicePoint: { lat: 44.3961234, lng: -122.7354321 } }), query({ near: { lat: 44.6, lng: -123.1 } }), NOW)

    expect(Object.keys(card).sort()).toEqual([...MARKETPLACE_TRUCK_CARD_KEYS].sort())
    expect(card.approximatePoint).toEqual({ lat: 44.4, lng: -122.7 })
    expect(card.equipment).toEqual([{ label: "Log truck + Pole trailer", units: 3 }])
    expect(card.distanceMiles).toEqual(expect.any(Number))
    expect(Number.isInteger(card.distanceMiles)).toBe(true)
    expect(truckCard(entry(), query(), NOW).distanceMiles).toBeNull()
  })

  it("never carries a field the row happens to have", () => {
    const leaky = { ...entry(), email: "owner@example.com", exactPoint: { lat: 44.39612, lng: -122.73551 }, phone: "541-555-0100" } as TruckDirectoryEntry
    const card = truckCard(leaky, query(), NOW)
    const text = JSON.stringify(card)

    expect(text).not.toMatch(/@example\.com|555-0100|44\.39612/)
  })

  it("groups the same configuration into one line", () => {
    const card = truckCard(entry({
      equipment: [
        { equipmentCode: "log_truck", trailerCode: "pole_trailer", units: 2 },
        { equipmentCode: "log_truck", trailerCode: "pole_trailer", units: 1 },
        { equipmentCode: "self_loader", trailerCode: null, units: 1 },
        { equipmentCode: "onboard_scales", trailerCode: null, units: 1 }
      ]
    }), query(), NOW)

    expect(card.equipment).toEqual([
      { label: "Log truck + Pole trailer", units: 3 },
      { label: "Self-loader log truck", units: 1 },
      { label: "On-board scales", units: 1 }
    ])
  })
})

describe("directory filters", () => {
  it("never lists a hidden business", () => {
    expect(truckEntryMatches(entry({ listed: false }), query(), NOW)).toBe(false)
    expect(truckDirectoryPage([entry({ listed: false }), entry({ organizationId: ORG_B })], query(), NOW).map((card) => card.organizationId)).toEqual([ORG_B])
  })

  it("filters by text on the business name and home base", () => {
    expect(truckEntryMatches(entry(), query({ query: "sweet" }), NOW)).toBe(true)
    expect(truckEntryMatches(entry(), query({ query: "sweet home, or" }), NOW)).toBe(true)
    expect(truckEntryMatches(entry(), query({ query: "Roseburg" }), NOW)).toBe(false)
  })

  it("filters by a truck, a trailer or an extra the business lists", () => {
    expect(truckEntryMatches(entry(), query({ equipment: "log_truck" }), NOW)).toBe(true)
    expect(truckEntryMatches(entry(), query({ equipment: "pole_trailer" }), NOW)).toBe(true)
    expect(truckEntryMatches(entry(), query({ equipment: "chip_truck" }), NOW)).toBe(false)
  })

  it("with available only, keeps current availability of that truck type and drops stale or none", () => {
    expect(truckEntryMatches(entry(), query({ availableOnly: true }), NOW)).toBe(true)
    expect(truckEntryMatches(entry({ availability: [report({ reportedAt: daysAgo(10) })] }), query({ availableOnly: true }), NOW)).toBe(false)
    expect(truckEntryMatches(entry({ availability: [] }), query({ availableOnly: true }), NOW)).toBe(false)
    expect(truckEntryMatches(entry(), query({ availableOnly: true, equipment: "log_truck" }), NOW)).toBe(true)
    expect(truckEntryMatches(entry({
      equipment: [{ equipmentCode: "self_loader", trailerCode: null, units: 1 }, { equipmentCode: "log_truck", trailerCode: null, units: 1 }]
    }), query({ availableOnly: true, equipment: "self_loader" }), NOW)).toBe(false)
  })

  it("filters by distance from the typed place on the 0.1° grid", () => {
    const near = { lat: 44.4, lng: -122.7 }

    expect(truckEntryMatches(entry(), query({ near, radiusMiles: 5 }), NOW)).toBe(true)
    expect(truckEntryMatches(entry({ servicePoint: { lat: 45.5, lng: -122.7 } }), query({ near, radiusMiles: 50 }), NOW)).toBe(false)
    expect(truckEntryMatches(entry({ servicePoint: null }), query({ near, radiusMiles: 50 }), NOW)).toBe(false)
    expect(truckEntryMatches(entry({ servicePoint: null }), query({ near }), NOW)).toBe(true)
  })

  it("filters by identity review only when asked", () => {
    const reviewed = entry({ verification: { reviewedOn: "2026-10-14", scope: "business_identity" } })

    expect(truckEntryMatches(entry(), query({ identityReviewedOnly: true }), NOW)).toBe(false)
    expect(truckEntryMatches(reviewed, query({ identityReviewedOnly: true }), NOW)).toBe(true)
    expect(truckEntryMatches(entry(), query(), NOW)).toBe(true)
  })
})

describe("named sort keys (legal review §3.3 item 1)", () => {
  const fresh = entry({ availability: [report({ reportedAt: daysAgo(1) })], businessName: "Cedar Haul", organizationId: ORG_A, servicePoint: { lat: 45.0, lng: -122.7 } })
  const older = entry({ availability: [report({ reportedAt: daysAgo(4) })], businessName: "Alder Trucking", organizationId: ORG_B, servicePoint: { lat: 44.4, lng: -122.7 } })
  const stale = entry({ availability: [report({ reportedAt: daysAgo(20) })], businessName: "Birch Logging", organizationId: ORG_C, servicePoint: { lat: 44.5, lng: -122.7 } })
  const none = entry({ availability: [], businessName: "Aspen Freight", organizationId: ORG_D, servicePoint: null })
  const all = [none, stale, older, fresh]
  const ids = (cards: MarketplaceTruckCardView[]) => cards.map((card) => card.organizationId)

  it("last confirmed: fresher availability first, stale after current, never reported last", () => {
    expect(ids(truckDirectoryPage(all, query(), NOW))).toEqual([ORG_A, ORG_B, ORG_C, ORG_D])
  })

  it("distance: nearest public point first, no point last", () => {
    expect(ids(truckDirectoryPage(all, query({ near: { lat: 44.4, lng: -122.7 }, sort: "distance" }), NOW))).toEqual([ORG_B, ORG_C, ORG_A, ORG_D])
  })

  it("name: business name A to Z", () => {
    expect(ids(truckDirectoryPage(all, query({ sort: "name" }), NOW))).toEqual([ORG_B, ORG_D, ORG_C, ORG_A])
  })

  it("breaks ties by name and then id, so the order is total", () => {
    const twin = { ...older, organizationId: ORG_A }
    const cards = [truckCard(older, query(), NOW), truckCard(twin, query(), NOW)]

    expect(ids([...cards].sort(compareTruckCards("last_confirmed")))).toEqual([ORG_A, ORG_B])
    expect(ids([...cards].reverse().sort(compareTruckCards("last_confirmed")))).toEqual([ORG_A, ORG_B])
  })

  it("ignores the identity mark in every key (legal review §7.3 item 5)", () => {
    const marked = all.map((item) => ({ ...item, verification: { reviewedOn: "2026-10-14", scope: "business_identity" as const } }))
    const mixed = all.map((item, index) => (index % 2 === 0 ? { ...item, verification: { reviewedOn: "2026-10-14", scope: "business_identity" as const } } : item))

    for (const sort of ["last_confirmed", "distance", "name"] as const) {
      const filters = query({ near: { lat: 44.4, lng: -122.7 }, sort })
      const plain = ids(truckDirectoryPage(all, filters, NOW))

      expect(ids(truckDirectoryPage(marked, filters, NOW))).toEqual(plain)
      expect(ids(truckDirectoryPage(mixed, filters, NOW))).toEqual(plain)
    }
  })
})

describe("one page", () => {
  it("never holds more than the page size", () => {
    const many = Array.from({ length: 60 }, (_, index) => entry({
      businessName: `Hauler ${String(index).padStart(2, "0")}`,
      organizationId: `aaaaaaaa-0000-4000-8000-${String(index).padStart(12, "0")}`
    }))

    expect(truckDirectoryPage(many, query(), NOW)).toHaveLength(TRUCK_DIRECTORY_PAGE_SIZE)
  })
})

describe("who may see the directory (legal review §9.3 item 4)", () => {
  const desk = ["boost.estimate", "truck.search", "alert.manage", "plan.view"] as const

  it("needs a Landing Operator seat, then a reviewed business identity, then a landing plan", () => {
    expect(truckDirectoryAccess({ capabilities: ["alert.manage", "plan.view"], planCode: "pro", verificationStatus: "verified" }))
      .toEqual({ message: TRUCK_DIRECTORY_REFUSALS.no_landing_seat, ok: false, reason: "no_landing_seat" })

    for (const status of ["unverified", "pending", "rejected", null]) {
      expect(truckDirectoryAccess({ capabilities: desk, planCode: "pro", verificationStatus: status }))
        .toEqual({ message: TRUCK_DIRECTORY_REFUSALS.identity_not_reviewed, ok: false, reason: "identity_not_reviewed" })
    }

    expect(truckDirectoryAccess({ capabilities: desk, planCode: null, verificationStatus: "verified" }))
      .toEqual({ message: TRUCK_DIRECTORY_REFUSALS.no_plan, ok: false, reason: "no_plan" })
    expect(truckDirectoryAccess({ capabilities: desk, planCode: "basic", verificationStatus: "verified" })).toEqual({ ok: true, planCode: "basic" })
  })

  it("keeps saved searches and alerts to plans with availability alerts (Pro and Regional)", () => {
    expect(truckSavedSearchAccess("basic")).toEqual({ message: TRUCK_DIRECTORY_REFUSALS.alerts_not_in_plan, ok: false, reason: "alerts_not_in_plan" })
    expect(truckSavedSearchAccess("pro")).toEqual({ ok: true })
    expect(truckSavedSearchAccess("regional")).toEqual({ ok: true })
  })
})

describe("daily seat limits", () => {
  it("grants a page and its cards inside the limits", () => {
    expect(truckDirectoryGrant({ pagesUsed: 0, viewsUsed: 0 }, 25)).toEqual({ allowed: true, views: 25 })
    expect(truckDirectoryGrant({ pagesUsed: 3, viewsUsed: 390 }, 25)).toEqual({ allowed: true, views: TRUCK_DIRECTORY_DAILY_VIEW_LIMIT - 390 })
    expect(truckDirectoryGrant({ pagesUsed: 0, viewsUsed: 0 }, 0)).toEqual({ allowed: true, views: 0 })
    expect(truckDirectoryGrant({ pagesUsed: 0, viewsUsed: 0 }, 99)).toEqual({ allowed: true, views: TRUCK_DIRECTORY_PAGE_SIZE })
  })

  it("trips at the page limit and at the card limit", () => {
    expect(truckDirectoryGrant({ pagesUsed: TRUCK_DIRECTORY_DAILY_PAGE_LIMIT, viewsUsed: 0 }, 1))
      .toEqual({ allowed: false, message: TRUCK_DIRECTORY_REFUSALS.daily_page_limit, reason: "daily_page_limit" })
    expect(truckDirectoryGrant({ pagesUsed: 1, viewsUsed: TRUCK_DIRECTORY_DAILY_VIEW_LIMIT }, 1))
      .toEqual({ allowed: false, message: TRUCK_DIRECTORY_REFUSALS.daily_view_limit, reason: "daily_view_limit" })
  })
})
