import { describe, expect, it } from "vitest"

import {
  MARKETPLACE_TRUCK_ALERT_PAYLOAD_KEYS,
  TRUCK_ALERT_BATCH_LIMIT,
  marketplaceTruckAlertCriteriaSchema,
  type MarketplaceTruckAlertCriteria
} from "@logloads/contracts"

import {
  planTruckAlerts,
  planTruckSearchWrite,
  truckAlertChannels,
  truckAlertDedupeKey,
  truckAlertMatches,
  type TruckAlertCandidate,
  type TruckAlertSearch
} from "./index"

const NOW = new Date("2026-11-10T12:00:00.000Z")
const LANDING = "33333333-bbbb-4bbb-8bbb-333333333333"
const HAULER = "44444444-cccc-4ccc-8ccc-444444444444"
const SEARCH = "55555555-dddd-4ddd-8ddd-555555555555"
const REPORT = "66666666-eeee-4eee-8eee-666666666666"
const ON = [{ channel: "in_app", enabled: true }, { channel: "email", enabled: true }]

const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString()

function criteria(overrides: Record<string, unknown> = {}): MarketplaceTruckAlertCriteria {
  return marketplaceTruckAlertCriteriaSchema.parse(overrides)
}

function search(overrides: Partial<TruckAlertSearch> = {}): TruckAlertSearch {
  return {
    alertsEnabled: true,
    criteria: criteria(),
    id: SEARCH,
    name: "Log trucks near the landing",
    organizationId: LANDING,
    since: hoursAgo(48),
    ...overrides
  }
}

function candidate(overrides: Partial<TruckAlertCandidate> = {}): TruckAlertCandidate {
  return {
    areaLabel: "Sweet Home, OR",
    areaPoint: { lat: 44.4, lng: -122.7 },
    availableCount: 2,
    availableFrom: "2026-11-10",
    availableUntil: "2026-11-17",
    businessName: "Sweet Home Hauling",
    equipmentCode: "log_truck",
    identityReviewed: false,
    listed: true,
    listedEquipment: ["log_truck", "pole_trailer"],
    organizationId: HAULER,
    reportId: REPORT,
    reportedAt: hoursAgo(2),
    ...overrides
  }
}

describe("saved truck search writes", () => {
  it("are always kind trucks, for the caller's business", () => {
    expect(planTruckSearchWrite(LANDING, { alertsEnabled: true, criteria: criteria(), name: "Near the landing" })).toEqual({
      alertsEnabled: true,
      criteria: criteria(),
      kind: "trucks",
      name: "Near the landing",
      organizationId: LANDING,
      searchId: null
    })
    expect(planTruckSearchWrite(LANDING, { alertsEnabled: false, criteria: criteria(), name: "x", searchId: SEARCH }).searchId).toBe(SEARCH)
  })
})

describe("alert matching", () => {
  it("matches a fresh report made after the search was saved", () => {
    expect(truckAlertMatches(search(), candidate(), NOW)).toBe(true)
  })

  it("never alerts a hidden business, the landing's own business, or a paused search", () => {
    expect(truckAlertMatches(search(), candidate({ listed: false }), NOW)).toBe(false)
    expect(truckAlertMatches(search(), candidate({ organizationId: LANDING }), NOW)).toBe(false)
    expect(truckAlertMatches(search({ alertsEnabled: false }), candidate(), NOW)).toBe(false)
  })

  it("never alerts availability reported before the search, stale availability or a window that ended", () => {
    expect(truckAlertMatches(search(), candidate({ reportedAt: hoursAgo(72) }), NOW)).toBe(false)
    expect(truckAlertMatches(search({ since: hoursAgo(24 * 30) }), candidate({ reportedAt: hoursAgo(24 * 7) }), NOW)).toBe(false)
    expect(truckAlertMatches(search(), candidate({ availableFrom: "2026-11-01", availableUntil: "2026-11-09" }), NOW)).toBe(false)
  })

  it("matches equipment by the truck type reported or any equipment the business lists", () => {
    expect(truckAlertMatches(search({ criteria: criteria({ equipment: ["log_truck"] }) }), candidate(), NOW)).toBe(true)
    expect(truckAlertMatches(search({ criteria: criteria({ equipment: ["pole_trailer"] }) }), candidate(), NOW)).toBe(true)
    expect(truckAlertMatches(search({ criteria: criteria({ equipment: ["chip_truck", "self_loader"] }) }), candidate(), NOW)).toBe(false)
  })

  it("matches distance on the public grid and the review filter only when asked", () => {
    const near = { lat: 44.4, lng: -122.7 }

    expect(truckAlertMatches(search({ criteria: criteria({ near, radiusMiles: 20 }) }), candidate(), NOW)).toBe(true)
    expect(truckAlertMatches(search({ criteria: criteria({ near, radiusMiles: 20 }) }), candidate({ areaPoint: { lat: 45.6, lng: -122.7 } }), NOW)).toBe(false)
    expect(truckAlertMatches(search({ criteria: criteria({ near, radiusMiles: 20 }) }), candidate({ areaPoint: null }), NOW)).toBe(false)
    expect(truckAlertMatches(search({ criteria: criteria({ identityReviewedOnly: true }) }), candidate(), NOW)).toBe(false)
    expect(truckAlertMatches(search({ criteria: criteria({ identityReviewedOnly: true }) }), candidate({ identityReviewed: true }), NOW)).toBe(true)
  })
})

describe("alert channels", () => {
  it("are in the app and email, each only with the person's consent", () => {
    expect(truckAlertChannels(search(), ON)).toEqual(["in_app", "email"])
    expect(truckAlertChannels(search(), [{ channel: "email", enabled: true }, { channel: "in_app", enabled: false }])).toEqual(["email"])
    expect(truckAlertChannels(search(), [])).toEqual([])
    expect(truckAlertChannels(search({ alertsEnabled: false }), ON)).toEqual([])
  })

  it("never include SMS, even when a consent row says so", () => {
    expect(truckAlertChannels(search(), [...ON, { channel: "sms", enabled: true }])).toEqual(["in_app", "email"])
  })
})

describe("planning alerts", () => {
  it("plans one notice per matching report and channel, with a stable dedupe key", () => {
    const plan = planTruckAlerts(search(), [candidate()], ON, NOW)

    expect(plan.reportIds).toEqual([REPORT])
    expect(plan.notices.map((notice) => notice.dedupeKey)).toEqual([
      `truck_alert:${SEARCH}:${REPORT}:in_app`,
      `truck_alert:${SEARCH}:${REPORT}:email`
    ])
    expect(truckAlertDedupeKey(SEARCH, REPORT, "email")).toBe(`truck_alert:${SEARCH}:${REPORT}:email`)
    expect(plan.notices[0]?.payload).toEqual({
      areaLabel: "Sweet Home, OR",
      availableCount: 2,
      availableFrom: "2026-11-10",
      availableUntil: "2026-11-17",
      businessName: "Sweet Home Hauling",
      equipmentCode: "log_truck",
      haulerOrganizationId: HAULER,
      reportId: REPORT,
      reportedAt: hoursAgo(2),
      savedSearchId: SEARCH,
      savedSearchName: "Log trucks near the landing"
    })
  })

  it("is idempotent: the same input plans the same notices, and keys already sent are not planned again", () => {
    const first = planTruckAlerts(search(), [candidate()], ON, NOW)
    const again = planTruckAlerts(search(), [candidate()], ON, NOW)
    const sent = new Set(first.notices.map((notice) => notice.dedupeKey))

    expect(again).toEqual(first)
    expect(planTruckAlerts(search(), [candidate()], ON, NOW, sent)).toEqual({ notices: [], reportIds: [] })
  })

  it("carries public card facts only, never a contact field the candidate happens to have", () => {
    const leaky = { ...candidate(), email: "owner@example.com", phone: "541-555-0100" } as TruckAlertCandidate
    const [notice] = planTruckAlerts(search(), [leaky], ON, NOW).notices

    expect(Object.keys(notice?.payload ?? {}).sort()).toEqual([...MARKETPLACE_TRUCK_ALERT_PAYLOAD_KEYS].sort())
    expect(JSON.stringify(notice)).not.toMatch(/@example\.com|555-0100/)
  })

  it("plans nothing without consent, skips reports that do not match, and caps one hand-over", () => {
    expect(planTruckAlerts(search(), [candidate()], [], NOW)).toEqual({ notices: [], reportIds: [] })
    expect(planTruckAlerts(search(), [candidate({ listed: false })], ON, NOW)).toEqual({ notices: [], reportIds: [] })

    const many = Array.from({ length: TRUCK_ALERT_BATCH_LIMIT + 10 }, (_, index) =>
      candidate({ reportId: `66666666-eeee-4eee-8eee-${String(index).padStart(12, "0")}`, reportedAt: hoursAgo(1 + index / 100) }))
    const plan = planTruckAlerts(search(), many, ON, NOW)

    expect(plan.reportIds).toHaveLength(TRUCK_ALERT_BATCH_LIMIT)
    expect(new Set(plan.reportIds).size).toBe(TRUCK_ALERT_BATCH_LIMIT)
  })

  it("orders the oldest report first, so a capped hand-over leaves the newest for the next run", () => {
    const older = candidate({ reportId: "66666666-eeee-4eee-8eee-000000000001", reportedAt: hoursAgo(5) })
    const newer = candidate({ reportId: "66666666-eeee-4eee-8eee-000000000002", reportedAt: hoursAgo(1) })

    expect(planTruckAlerts(search(), [newer, older], ON, NOW).reportIds).toEqual([older.reportId, newer.reportId])
  })
})
