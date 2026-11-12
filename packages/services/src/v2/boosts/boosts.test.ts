import { describe, expect, it } from "vitest"

import {
  BOOST_PACKAGES,
  BOOST_RADIUS_MILES,
  MARKETPLACE_PLAN_NOT_PURCHASABLE,
  MARKETPLACE_SPONSORED_SLOTS,
  type MarketplaceBoostAudienceView,
  type MarketplaceBoostView
} from "@logloads/contracts"

import {
  marketplaceBoostAudienceHeadline,
  marketplaceBoostAudienceSummary,
  marketplaceBoostPackageOption,
  marketplaceBoostPackageOptions,
  marketplaceBoostPhase,
  marketplaceBoostPurchase,
  marketplaceBoostRunning,
  rankSponsoredJobs
} from "./index"

const JOB = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

function audience(overrides: Partial<MarketplaceBoostAudienceView> = {}): MarketplaceBoostAudienceView {
  return {
    activeAvailabilityReports: 9,
    availableTrucks: 14,
    jobId: JOB,
    optedInHaulers: 6,
    packageCode: "quick",
    radiusMiles: 100,
    ...overrides
  }
}

const START = "2026-11-10T15:00:00.000Z"
const END = "2026-11-17T15:00:00.000Z"

function boost(overrides: Partial<Pick<MarketplaceBoostView, "status" | "startsAt" | "endsAt">> = {}) {
  return { endsAt: END, startsAt: START, status: "active" as const, ...overrides }
}

describe("boost packages: never for sale", () => {
  it("shows each package's locked terms from BOOST_PACKAGES, shortest first, never purchasable and never renewing", () => {
    const options = marketplaceBoostPackageOptions()

    expect(options.map((option) => option.package)).toEqual([BOOST_PACKAGES.quick, BOOST_PACKAGES.extended, BOOST_PACKAGES.campaign])

    for (const option of options) {
      expect(option).toEqual({ autoRenews: false, package: BOOST_PACKAGES[option.package.code], purchasable: false, radiusMiles: BOOST_RADIUS_MILES })
    }
  })

  it("takes prices from the constants only, so a package's price is the locked one", () => {
    expect(marketplaceBoostPackageOption("campaign").package.priceCents).toBe(BOOST_PACKAGES.campaign.priceCents)
    expect(() => marketplaceBoostPackageOption("premium" as never)).toThrow()
  })

  it("refuses every purchase with the billing read model's sentence, whatever is asked for", () => {
    const requests: unknown[] = [undefined, "quick", { jobId: JOB, packageCode: "campaign" }, { checkout: true, priceCents: 0 }]

    for (const request of requests) {
      expect(marketplaceBoostPurchase(request)).toEqual({ purchasable: false, reason: MARKETPLACE_PLAN_NOT_PURCHASABLE })
    }
  })
})

describe("audience estimate before any boost", () => {
  it("says how many trucks are available within the radius the store counted", () => {
    expect(marketplaceBoostAudienceHeadline(14, 100)).toBe("14 trucks available within 100 miles")
    expect(marketplaceBoostAudienceHeadline(1, 100)).toBe("1 truck available within 100 miles")
    expect(marketplaceBoostAudienceHeadline(1250, 100)).toBe("1,250 trucks available within 100 miles")
  })

  it("states zero plainly, never as a forecast or a padded number", () => {
    expect(marketplaceBoostAudienceHeadline(0, 100)).toBe("No trucks available within 100 miles right now")
  })

  it("refuses a count that is not a real count", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => marketplaceBoostAudienceHeadline(bad, 100), String(bad)).toThrow(RangeError)
    }
  })

  it("builds the landing's view from the store's own counts and the package's locked terms, with nothing to buy", () => {
    expect(marketplaceBoostAudienceSummary(audience({ availableTrucks: 14, packageCode: "extended", radiusMiles: 100 }))).toEqual({
      availableTrucks: 14,
      headline: "14 trucks available within 100 miles",
      jobId: JOB,
      option: marketplaceBoostPackageOption("extended"),
      purchasable: false,
      purchaseNote: MARKETPLACE_PLAN_NOT_PURCHASABLE,
      radiusMiles: 100
    })
  })

  it("counts trucks, not businesses or reports: haulers with only stale availability add nothing", () => {
    // Six listed businesses and nine open reports, but none of those reports is fresh: the store counts 0 trucks.
    const summary = marketplaceBoostAudienceSummary(audience({ activeAvailabilityReports: 9, availableTrucks: 0, optedInHaulers: 6 }))

    expect(summary.availableTrucks).toBe(0)
    expect(summary.headline).toBe("No trucks available within 100 miles right now")
  })
})

describe("expiry", () => {
  it("runs from its start up to, not including, its end", () => {
    expect(marketplaceBoostPhase(boost(), new Date("2026-11-10T14:59:59.999Z"))).toBe("scheduled")
    expect(marketplaceBoostPhase(boost(), new Date(START))).toBe("running")
    expect(marketplaceBoostPhase(boost(), new Date("2026-11-17T14:59:59.999Z"))).toBe("running")
    expect(marketplaceBoostPhase(boost(), new Date(END))).toBe("ended")
    expect(marketplaceBoostRunning(boost(), new Date("2026-11-17T14:59:59.999Z"))).toBe(true)
    expect(marketplaceBoostRunning(boost(), new Date(END))).toBe(false)
  })

  it("is ended once the store ends it early, and never runs while awaiting payment or canceled", () => {
    const during = new Date("2026-11-12T12:00:00.000Z")

    expect(marketplaceBoostPhase(boost({ status: "ended" }), during)).toBe("ended")
    expect(marketplaceBoostPhase(boost({ endsAt: null, startsAt: null, status: "pending_payment" }), during)).toBe("awaiting_payment")
    expect(marketplaceBoostPhase(boost({ status: "canceled" }), during)).toBe("canceled")

    for (const status of ["ended", "pending_payment", "canceled"] as const) {
      expect(marketplaceBoostRunning(boost({ status }), during), status).toBe(false)
    }
  })

  it("never runs an active boost without a readable window", () => {
    const during = new Date("2026-11-12T12:00:00.000Z")

    expect(marketplaceBoostRunning(boost({ endsAt: null, startsAt: null }), during)).toBe(false)
    expect(marketplaceBoostRunning(boost({ endsAt: "not a time" }), during)).toBe(false)
  })
})

describe("Sponsored ranking", () => {
  interface Job { id: string; sponsored: boolean; rank: number; equipment: string }

  const job = (id: string, rank: number, sponsored = false, equipment = "log_truck"): Job => ({ equipment, id, rank, sponsored })
  const organic = (a: Job, b: Job) => a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const everyJob = () => true
  const ids = (jobs: readonly Job[]) => jobs.map((entry) => `${entry.id}${entry.sponsored ? "*" : ""}`)

  it("lifts a boosted job above unboosted jobs that match the same filters, and labels it", () => {
    const ranked = rankSponsoredJobs([job("a", 1), job("b", 2), job("c", 3, true)], { compare: organic, matches: everyJob })

    expect(ids(ranked)).toEqual(["c*", "a", "b"])
  })

  it("keeps the organic order everywhere else, and among boosted jobs", () => {
    const ranked = rankSponsoredJobs([job("d", 4), job("c", 3, true), job("b", 2, true), job("a", 1)], { compare: organic, matches: everyJob })

    expect(ids(ranked)).toEqual(["b*", "c*", "a", "d"])
  })

  it("never shows a boosted job that fails the hauler's filters, so it can outrank nothing", () => {
    const lowboyOnly = (entry: Job) => entry.equipment === "lowboy"
    const ranked = rankSponsoredJobs([job("a", 1, false, "lowboy"), job("b", 2, true, "log_truck"), job("c", 3, false, "lowboy")], {
      compare: organic,
      matches: lowboyOnly
    })

    expect(ids(ranked)).toEqual(["a", "c"])
  })

  it(`places at most ${MARKETPLACE_SPONSORED_SLOTS} sponsored jobs; the rest keep their organic place and no label`, () => {
    const ranked = rankSponsoredJobs([job("a", 1), job("b", 2, true), job("c", 3, true), job("d", 4, true), job("e", 5)], {
      compare: organic,
      matches: everyJob
    })

    expect(ids(ranked)).toEqual(["b*", "c*", "a", "d", "e"])
    expect(rankSponsoredJobs([job("a", 1), job("b", 2, true)], { compare: organic, matches: everyJob, slots: 0 }).map((entry) => entry.sponsored))
      .toEqual([false, false])
  })

  it("labels only what it lifts: a Sponsored label without a running boost is removed", () => {
    const ended = new Set(["c"])
    const ranked = rankSponsoredJobs([job("a", 1), job("c", 3, true)], {
      compare: organic,
      matches: everyJob,
      running: (entry) => entry.sponsored && !ended.has(entry.id)
    })

    expect(ids(ranked)).toEqual(["a", "c"])
  })

  it("stops ranking a boost at its end, at once", () => {
    const windows: Record<string, ReturnType<typeof boost>> = { c: boost() }
    const rankAt = (now: Date) => ids(rankSponsoredJobs([job("a", 1), job("b", 2), job("c", 3)], {
      compare: organic,
      matches: everyJob,
      running: (entry) => windows[entry.id] !== undefined && marketplaceBoostRunning(windows[entry.id] as ReturnType<typeof boost>, now)
    }))

    expect(rankAt(new Date("2026-11-17T14:59:59.999Z"))).toEqual(["c*", "a", "b"])
    expect(rankAt(new Date(END))).toEqual(["a", "b", "c"])
  })

  it("does not change the jobs it was given", () => {
    const given = [job("a", 1), job("c", 3, true)]
    const copy = structuredClone(given)

    rankSponsoredJobs(given, { compare: organic, matches: everyJob, running: () => false })

    expect(given).toEqual(copy)
  })

  it("refuses a slot count that is not a whole number of slots", () => {
    for (const slots of [-1, 1.5, Number.NaN]) {
      expect(() => rankSponsoredJobs([job("a", 1)], { compare: organic, matches: everyJob, slots }), String(slots)).toThrow(RangeError)
    }
  })
})
