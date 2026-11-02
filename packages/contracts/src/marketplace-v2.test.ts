import { describe, expect, it } from "vitest"

import {
  expressInterestInputSchema,
  filterMarketplaceJobs,
  formatMarketplacePay,
  landingInterestQueue,
  marketplaceInterestSchema,
  marketplaceJobAcceptsInterest,
  postingFreshness,
  respondToInterestInputSchema,
  sortMarketplaceJobs,
  type MarketplaceJobCardView
} from "./marketplace-v2"

const job = (overrides: Partial<MarketplaceJobCardView>): MarketplaceJobCardView => ({
  acceptingInterest: true,
  destinationLabel: "Cascade Mill",
  endsOn: null,
  equipment: ["Log trailer"],
  estimatedDailyLoads: null,
  estimatedTonsPerLoad: 28,
  haulDistance: { basis: "poster_route_estimate", miles: 54 },
  id: "job-1",
  lastConfirmedAt: "2026-11-01T12:00:00.000Z",
  origin: { approximatePoint: null, label: "Oakridge, OR", stateCode: "OR" },
  pay: { amountCents: 52_500, unit: "per_load" },
  posterName: "Summit Ridge Timber",
  posterOrganizationId: "11111111-1111-4111-8111-111111111111",
  posterVerified: true,
  product: "Saw logs",
  scheduleNote: null,
  slug: "oak-run",
  sponsored: false,
  startsOn: "2026-11-03",
  status: "active",
  title: "Oakridge to Cascade Mill",
  trucksRequested: { count: 3, per: "day" },
  ...overrides
})

describe("pay transparency (UX §8.4)", () => {
  it("shows the poster's amount with its basis", () => {
    expect(formatMarketplacePay({ amountCents: 52_500, unit: "per_load" })).toBe("$525.00 per load")
    expect(formatMarketplacePay({ amountCents: 1_250, unit: "per_ton" })).toBe("$12.50 per ton")
  })

  it("never invents a figure when pay or its basis is missing", () => {
    expect(formatMarketplacePay({ amountCents: null, unit: null })).toBe("Pay not stated")
    expect(formatMarketplacePay({ amountCents: 52_500, unit: null })).toBe("Pay not stated")
  })
})

describe("posting freshness", () => {
  const now = "2026-11-20T12:00:00.000Z"

  it("labels the age of the poster's last confirmation", () => {
    expect(postingFreshness("2026-11-20T08:00:00.000Z", now)).toEqual({ band: "today", label: "Updated today" })
    expect(postingFreshness("2026-11-19T08:00:00.000Z", now)).toEqual({ band: "this_week", label: "Updated 1 day ago" })
    expect(postingFreshness("2026-11-05T08:00:00.000Z", now).band).toBe("aging")
    expect(postingFreshness("2026-09-01T08:00:00.000Z", now)).toMatchObject({ band: "stale" })
    expect(() => postingFreshness("yesterday", now)).toThrow(RangeError)
  })
})

describe("discovery filters", () => {
  const jobs = [
    job({ id: "a", lastConfirmedAt: "2026-11-01T00:00:00.000Z", title: "Oakridge saw logs" }),
    job({ acceptingInterest: false, id: "b", lastConfirmedAt: "2026-10-20T00:00:00.000Z", status: "filled", title: "Filled pulp" }),
    job({ equipment: ["Chip van"], id: "c", lastConfirmedAt: "2026-11-02T00:00:00.000Z", pay: { amountCents: 900, unit: "per_ton" }, title: "Chip shuttle" })
  ]

  it("hides jobs that no longer accept interest unless asked", () => {
    expect(filterMarketplaceJobs(jobs).map((j) => j.id)).toEqual(["a", "c"])
    expect(filterMarketplaceJobs(jobs, { acceptingOnly: false }).map((j) => j.id)).toEqual(["a", "b", "c"])
  })

  it("filters by text, exact equipment and pay basis without comparing unlike rates", () => {
    expect(filterMarketplaceJobs(jobs, { query: "chip" }).map((j) => j.id)).toEqual(["c"])
    expect(filterMarketplaceJobs(jobs, { equipment: "log trailer" }).map((j) => j.id)).toEqual(["a"])
    expect(filterMarketplaceJobs(jobs, { payUnit: "per_ton" }).map((j) => j.id)).toEqual(["c"])
  })

  it("sorts by most recent confirmation", () => {
    expect(sortMarketplaceJobs(jobs).map((j) => j.id)).toEqual(["c", "a", "b"])
  })
})

describe("interest rules", () => {
  it("only active jobs accept interest", () => {
    expect(marketplaceJobAcceptsInterest("active")).toBe(true)
    for (const status of ["paused", "filled", "closed", "expired"] as const) {
      expect(marketplaceJobAcceptsInterest(status)).toBe(false)
    }
  })

  it("maps statuses onto the landing inbox queues", () => {
    expect(landingInterestQueue("submitted")).toBe("new")
    expect(landingInterestQueue("viewed")).toBe("responded")
    expect(landingInterestQueue("replied")).toBe("responded")
    expect(landingInterestQueue("declined")).toBe("closed")
    expect(landingInterestQueue("withdrawn")).toBe("closed")
  })

  it("rejects a landing organization expressing interest in its own job", () => {
    const org = "11111111-1111-4111-8111-111111111111"
    expect(() => marketplaceInterestSchema.parse({
      availableFrom: null, contactPreference: "in_app", createdAt: "2026-11-01T00:00:00.000Z",
      haulerOrganizationId: org, id: "22222222-2222-4222-8222-222222222222", jobOrganizationId: org,
      loadPostingId: "33333333-3333-4333-8333-333333333333", message: null, replies: [], respondedAt: null,
      status: "submitted", submittedByUserId: "44444444-4444-4444-8444-444444444444", trucksOffered: 1,
      updatedAt: "2026-11-01T00:00:00.000Z", withdrawnAt: null
    })).toThrow(/own job/)
  })

  it("coerces the short form and requires a message to reply", () => {
    expect(expressInterestInputSchema.parse({ loadPostingId: "33333333-3333-4333-8333-333333333333", message: "  ", trucksOffered: "2" }))
      .toMatchObject({ contactPreference: "in_app", message: null, trucksOffered: 2 })
    expect(() => respondToInterestInputSchema.parse({ decision: "replied", interestId: "33333333-3333-4333-8333-333333333333" })).toThrow()
    expect(respondToInterestInputSchema.parse({ decision: "declined", interestId: "33333333-3333-4333-8333-333333333333" }))
      .toMatchObject({ body: null, decision: "declined" })
  })
})
