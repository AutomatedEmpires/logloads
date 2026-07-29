import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { estimateLoadEconomics } from "./economics"
import { payHeadline, presentPay } from "./pay-display"

/**
 * These numbers are the defect this module exists to prevent, measured from the
 * real seed before the fix: the public homepage headlined "$1,970 est. gross" for
 * a haul whose host had committed $525.00 — 3.75x — and "$2,250" for a committed
 * $625.00. The rate card was winning over the host's own commitment on every
 * driver-facing surface.
 */
function seedFixture(loadTitle: string) {
  const state = createInMemoryDatabase()
  const load = state.loadPostings.find((posting) => posting.title === loadTitle)

  if (!load) throw new Error(`seed is missing the load "${loadTitle}"`)

  const rate = state.rates.find((candidate) => candidate.id === load.rateId)
  const route = state.haulRoutes.find((candidate) => candidate.id === load.routeId)
  const landing = state.landings.find((candidate) => candidate.id === load.pickupLandingId)

  if (!rate || !route || !landing) throw new Error("seed lane is incomplete")

  return { landing, load, rate, route }
}

function economicsFor(loadTitle: string) {
  const { landing, load, rate, route } = seedFixture(loadTitle)

  return {
    economics: estimateLoadEconomics({ driver: null, landing, load, rate, route, truck: null }),
    load
  }
}

describe("what a load pays, as the driver reads it", () => {
  it("uses the host's stated figure verbatim, not a rate-card derivation", () => {
    const { economics, load } = economicsFor("Oak saw-log morning run")

    expect(load.driverPayCents).toBe(52_500)
    expect(economics.payBasis).toBe("host_stated")
    // The committed number, and nothing added to it. Not $1,970.
    expect(economics.grossCents).toBe(52_500)
    expect(economics.grossLabel).toBe("$525")
  })

  it("adds no fuel surcharge on top of a stated figure", () => {
    // The rate card for this lane carries a $120 fuel surcharge. A stated driver
    // pay is all-in: adding the surcharge would re-invent the model the host
    // decision replaced, and the driver would be quoted money nobody committed.
    const { economics } = economicsFor("Oak saw-log morning run")
    const { rate } = seedFixture("Oak saw-log morning run")

    expect(rate.fuelSurchargeCents).toBeGreaterThan(0)
    expect(economics.grossCents).toBe(52_500)
  })

  it("presents a stated figure as pay, with no estimate qualifier", () => {
    const { economics, load } = economicsFor("Oak saw-log morning run")
    const presented = presentPay({ economics, payLabel: "$525.00" })

    expect(presented.headline).toBe("$525.00")
    expect(presented.estimateNote).toBeNull()
    expect(payHeadline({ economics, payLabel: "$525.00" })).toBe("$525.00")
    expect(load.driverPayCents).toBe(52_500)
  })

  it("falls back to the rate card ONLY when no pay was stated, and says it is an estimate", () => {
    // A posting from before hosts could state pay. The figure is still shown —
    // hiding it would be worse — but it may never read as a commitment.
    const { economics } = economicsFor("Oak chip shuttle")
    const presented = presentPay({ economics, payLabel: "$18.50 per ton" })

    expect(economics.payBasis).toBe("rate_card")
    expect(presented.estimateNote).toContain("has not stated a flat driver pay")
    expect(presented.headline).toContain("est.")
  })

  it("never prints a bare derived figure without its qualifier", () => {
    // The guard against the original defect returning: if a surface renders
    // `headline` it must also render `estimateNote`, so an estimate cannot
    // masquerade as a promise. Any derived presentation must carry one.
    const state = createInMemoryDatabase()

    for (const load of state.loadPostings) {
      const rate = state.rates.find((candidate) => candidate.id === load.rateId)
      const route = state.haulRoutes.find((candidate) => candidate.id === load.routeId)
      const landing = state.landings.find((candidate) => candidate.id === load.pickupLandingId)

      if (!rate || !route || !landing) continue

      const economics = estimateLoadEconomics({ driver: null, landing, load, rate, route, truck: null })
      const presented = presentPay({ economics, payLabel: "unused" })

      if (economics.payBasis === "rate_card") {
        expect(presented.estimateNote, load.title).not.toBeNull()
      } else {
        expect(presented.estimateNote, load.title).toBeNull()
        expect(economics.grossCents, load.title).toBe(load.driverPayCents)
      }
    }
  })
})

describe("deadhead is road miles", () => {
  it("corrects straight-line distance before it becomes fuel cost", () => {
    // Great-circle miles understate a logging road by 1.15x-1.56x on this
    // product's own seeded lanes, and this number becomes gallons, then dollars,
    // then a driver's accept/decline.
    //
    // The home base is constructed rather than taken from the seed: no seeded
    // driver carries homeBaseCoordinates, so a seed-derived test here would only
    // ever exercise the null branch and would pass with the correction deleted.
    const { landing, load, rate, route } = seedFixture("Oak saw-log morning run")
    const state = createInMemoryDatabase()
    const seedDriver = state.driverProfiles[0]

    if (!seedDriver) throw new Error("seed has no driver profiles")

    // Exactly one degree of latitude south of the landing: 69.09409 great-circle
    // miles, hand-computed, so the expected road figure is 69.09409 * 1.3 = 89.82.
    const driver = {
      ...seedDriver,
      homeBaseCoordinates: { lat: landing.coordinates.lat - 1, lng: landing.coordinates.lng }
    }
    const withHome = estimateLoadEconomics({ driver, landing, load, rate, route, truck: null })
    const withoutHome = estimateLoadEconomics({
      driver: { ...seedDriver, homeBaseCoordinates: null },
      landing,
      load,
      rate,
      route,
      truck: null
    })

    expect(withHome.deadheadMiles).toBeCloseTo(89.82, 1)
    // The control: 69.09 would mean the road-circuity correction was skipped.
    expect(withHome.deadheadMiles!).toBeGreaterThan(70)
    expect(withHome.totalMiles).toBeGreaterThan(route.estimatedDistanceMiles)
    // No home base means no deadhead is claimed at all, rather than a zero.
    expect(withoutHome.deadheadMiles).toBeNull()
    expect(withoutHome.totalMiles).toBe(route.estimatedDistanceMiles)
    // More miles must cost more diesel, or the correction is cosmetic.
    expect(withHome.fuelCostCents).toBeGreaterThan(withoutHome.fuelCostCents)
  })
})
