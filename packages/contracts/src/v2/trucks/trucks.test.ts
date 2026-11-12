import { describe, expect, it } from "vitest"

import type { MarketplaceSavedSearchInput } from "../../marketplace-port-v3"
import {
  MARKETPLACE_TRUCK_ALERT_CHANNELS,
  MARKETPLACE_TRUCK_ALERT_PAYLOAD_KEYS,
  MARKETPLACE_TRUCK_CARD_KEYS,
  MARKETPLACE_TRUCK_DEFAULT_SORT,
  MARKETPLACE_TRUCK_SORT_KEYS,
  MARKETPLACE_TRUCK_SORT_LABELS,
  TRUCK_DIRECTORY_DAILY_PAGE_LIMIT,
  TRUCK_DIRECTORY_DAILY_VIEW_LIMIT,
  TRUCK_DIRECTORY_PAGE_SIZE,
  TRUCK_DIRECTORY_REFUSALS,
  marketplaceSavedTruckSearchInputSchema,
  marketplaceTruckAlertCriteriaSchema,
  marketplaceTruckFiltersSchema,
  marketplaceTruckSearchIdSchema,
  type MarketplaceTruckAlertCriteria
} from "./index"

const EMAIL = "landing@example.com"
/** Words that would make a card a contact list, or show a site instead of an area. */
const CONTACT_OR_SITE = /phone|email|mail|contact|address|exact|gate|street|lat$|lng$|score|rank|match/i

describe("Find Trucks sort keys (legal review §3.3 item 1)", () => {
  it("are a few named keys the landing can see and change, defaulting to freshness", () => {
    expect([...MARKETPLACE_TRUCK_SORT_KEYS]).toEqual(["last_confirmed", "distance", "name"])
    expect(MARKETPLACE_TRUCK_DEFAULT_SORT).toBe("last_confirmed")
    expect(MARKETPLACE_TRUCK_SORT_LABELS).toEqual({ distance: "Distance", last_confirmed: "Last confirmed", name: "Business name" })
  })

  it("have no best match, score or verification key", () => {
    for (const key of MARKETPLACE_TRUCK_SORT_KEYS) {
      expect(key).not.toMatch(/best|match|score|rank|relevan|verif|review|trust/i)
    }
  })
})

describe("directory filters", () => {
  it("fills in every default and snaps a typed place to the public 0.1° grid", () => {
    expect(marketplaceTruckFiltersSchema.parse({})).toEqual({
      availableOnly: false,
      equipment: null,
      identityReviewedOnly: false,
      near: null,
      query: null,
      radiusMiles: null,
      sort: "last_confirmed"
    })

    expect(marketplaceTruckFiltersSchema.parse({
      availableOnly: true,
      equipment: "pole_trailer",
      identityReviewedOnly: true,
      near: { lat: 44.39612, lng: -122.73551 },
      query: "  Sweet Home  ",
      radiusMiles: 60,
      sort: "distance"
    })).toEqual({
      availableOnly: true,
      equipment: "pole_trailer",
      identityReviewedOnly: true,
      near: { lat: 44.4, lng: -122.7 },
      query: "Sweet Home",
      radiusMiles: 60,
      sort: "distance"
    })
  })

  it("ignores a distance without a place, and refuses a distance sort without one", () => {
    expect(marketplaceTruckFiltersSchema.parse({ radiusMiles: 50 }).radiusMiles).toBeNull()
    expect(marketplaceTruckFiltersSchema.safeParse({ sort: "distance" }).success).toBe(false)
  })

  it("refuses an email address, an unknown sort, an unlisted code, a bad point and any extra field", () => {
    expect(marketplaceTruckFiltersSchema.safeParse({ query: EMAIL }).success).toBe(false)
    expect(marketplaceTruckFiltersSchema.safeParse({ sort: "best_match" }).success).toBe(false)
    expect(marketplaceTruckFiltersSchema.safeParse({ sort: "verified_first" }).success).toBe(false)
    expect(marketplaceTruckFiltersSchema.safeParse({ equipment: "Log Truck" }).success).toBe(false)
    expect(marketplaceTruckFiltersSchema.safeParse({ near: { lat: 91, lng: 0 } }).success).toBe(false)
    expect(marketplaceTruckFiltersSchema.safeParse({ near: { lat: Number.NaN, lng: 0 } }).success).toBe(false)
    expect(marketplaceTruckFiltersSchema.safeParse({ near: { lat: 44.4, lng: -122.7 }, radiusMiles: 4 }).success).toBe(false)
    expect(marketplaceTruckFiltersSchema.safeParse({ near: { lat: 44.4, lng: -122.7 }, radiusMiles: 501 }).success).toBe(false)
    expect(marketplaceTruckFiltersSchema.safeParse({ query: "x".repeat(81) }).success).toBe(false)
    expect(marketplaceTruckFiltersSchema.safeParse({ organizationId: "33333333-bbbb-4bbb-8bbb-333333333333" }).success).toBe(false)
    expect(marketplaceTruckFiltersSchema.safeParse({ export: true }).success).toBe(false)
  })

  it("reads an empty query as no query", () => {
    expect(marketplaceTruckFiltersSchema.parse({ query: "   " }).query).toBeNull()
    expect(marketplaceTruckFiltersSchema.parse({ query: null }).query).toBeNull()
  })
})

describe("the directory card (legal review §6.5, §9.3 item 4)", () => {
  it("has no contact, exact-site or ranking field", () => {
    for (const key of MARKETPLACE_TRUCK_CARD_KEYS) {
      expect(key).not.toMatch(CONTACT_OR_SITE)
    }
    expect([...MARKETPLACE_TRUCK_CARD_KEYS].sort()).toEqual([
      "acceptsInvitations",
      "approximatePoint",
      "availability",
      "availabilityReportedAt",
      "availableTrucks",
      "businessName",
      "distanceMiles",
      "equipment",
      "homeBase",
      "operatingStates",
      "organizationId",
      "serviceRadiusMiles",
      "verification"
    ])
  })
})

describe("directory limits (legal review §9.3 item 4)", () => {
  it("cap one page, a seat's pages per day and the cards a seat sees per day", () => {
    expect(TRUCK_DIRECTORY_PAGE_SIZE).toBe(25)
    expect(TRUCK_DIRECTORY_DAILY_PAGE_LIMIT).toBe(40)
    expect(TRUCK_DIRECTORY_DAILY_VIEW_LIMIT).toBe(400)
    expect(TRUCK_DIRECTORY_DAILY_VIEW_LIMIT).toBeLessThan(TRUCK_DIRECTORY_DAILY_PAGE_LIMIT * TRUCK_DIRECTORY_PAGE_SIZE)
  })

  it("say why in plain words, without a bare verification word", () => {
    for (const message of Object.values(TRUCK_DIRECTORY_REFUSALS)) {
      expect(message).toMatch(/\.$/)
      expect(message).not.toMatch(/\b(verified|trusted|approved|vetted|safe|certified)\b/i)
    }
    expect(TRUCK_DIRECTORY_REFUSALS.identity_not_reviewed).toMatch(/reviewed your business identity/)
  })
})

describe("truck alert criteria", () => {
  it("keeps equipment, a named place on the public grid, a distance and the review filter", () => {
    const criteria: MarketplaceTruckAlertCriteria = marketplaceTruckAlertCriteriaSchema.parse({
      equipment: ["log_truck", "pole_trailer"],
      identityReviewedOnly: true,
      near: { lat: 44.3961, lng: -122.7355 },
      place: "Sweet Home",
      radiusMiles: 80
    })

    expect(criteria).toEqual({
      equipment: ["log_truck", "pole_trailer"],
      identityReviewedOnly: true,
      near: { lat: 44.4, lng: -122.7 },
      place: "Sweet Home",
      radiusMiles: 80
    })
    expect(marketplaceTruckAlertCriteriaSchema.parse({})).toEqual({
      equipment: [],
      identityReviewedOnly: false,
      near: null,
      place: null,
      radiusMiles: null
    })
  })

  it("refuses a distance without a place, an email, a repeated code and any extra field", () => {
    expect(marketplaceTruckAlertCriteriaSchema.safeParse({ radiusMiles: 50 }).success).toBe(false)
    expect(marketplaceTruckAlertCriteriaSchema.safeParse({ place: EMAIL }).success).toBe(false)
    expect(marketplaceTruckAlertCriteriaSchema.safeParse({ equipment: ["log_truck", "log_truck"] }).success).toBe(false)
    expect(marketplaceTruckAlertCriteriaSchema.safeParse({ equipment: ["dump_truck"] }).success).toBe(false)
    expect(marketplaceTruckAlertCriteriaSchema.safeParse({ phone: "541-555-0100" }).success).toBe(false)
    expect(marketplaceTruckAlertCriteriaSchema.safeParse({ sort: "best_match" }).success).toBe(false)
  })
})

describe("saved truck search input", () => {
  it("parses a new search and an edit, with no owner or business in the input", () => {
    const created: MarketplaceSavedSearchInput<MarketplaceTruckAlertCriteria> = marketplaceSavedTruckSearchInputSchema.parse({
      alertsEnabled: true,
      criteria: { equipment: ["self_loader"] },
      name: "  Self-loaders near the landing "
    })

    expect(created).toEqual({
      alertsEnabled: true,
      criteria: { equipment: ["self_loader"], identityReviewedOnly: false, near: null, place: null, radiusMiles: null },
      name: "Self-loaders near the landing"
    })

    const edited = marketplaceSavedTruckSearchInputSchema.parse({
      alertsEnabled: false,
      criteria: {},
      name: "Paused",
      searchId: "22222222-bbbb-4bbb-8bbb-222222222222"
    })

    expect(edited.searchId).toBe("22222222-bbbb-4bbb-8bbb-222222222222")
    expect(marketplaceSavedTruckSearchInputSchema.safeParse({ alertsEnabled: true, criteria: {}, name: "x", ownerUserId: "u" }).success).toBe(false)
    expect(marketplaceSavedTruckSearchInputSchema.safeParse({ alertsEnabled: true, criteria: {}, name: "" }).success).toBe(false)
    expect(marketplaceSavedTruckSearchInputSchema.safeParse({ alertsEnabled: true, criteria: {}, name: "x".repeat(81) }).success).toBe(false)
    expect(marketplaceSavedTruckSearchInputSchema.safeParse({ criteria: {}, name: "x" }).success).toBe(false)
    expect(marketplaceSavedTruckSearchInputSchema.safeParse({ alertsEnabled: true, criteria: {}, kind: "jobs", name: "x" }).success).toBe(false)
  })

  it("takes a search id only as a UUID", () => {
    expect(marketplaceTruckSearchIdSchema.safeParse("22222222-bbbb-4bbb-8bbb-222222222222").success).toBe(true)
    expect(marketplaceTruckSearchIdSchema.safeParse("search-1").success).toBe(false)
  })
})

describe("availability alerts", () => {
  it("go in the app and by email only: SMS is capped at 0", () => {
    expect([...MARKETPLACE_TRUCK_ALERT_CHANNELS]).toEqual(["in_app", "email"])
  })

  it("carry no contact or exact-site field", () => {
    for (const key of MARKETPLACE_TRUCK_ALERT_PAYLOAD_KEYS) {
      expect(key).not.toMatch(CONTACT_OR_SITE)
    }
  })
})
