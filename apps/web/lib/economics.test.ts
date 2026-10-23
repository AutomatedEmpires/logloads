import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { DEFAULT_FUEL_ECONOMY_MPG, estimateLoadEconomics } from "./economics"

function seedLane() {
  const state = createInMemoryDatabase()
  const load = state.loadPostings[0]!
  const route = state.haulRoutes.find((item) => item.id === load.routeId)!
  const landing = state.landings.find((item) => item.id === load.pickupLandingId)!

  return { landing, load, route, state }
}

describe("load economics", () => {
  it("uses transparent defaults when the driver has not saved fuel assumptions", () => {
    const { landing, load, route } = seedLane()
    const estimate = estimateLoadEconomics({ driver: null, landing, load, route, truck: null })

    expect(estimate.fuelEconomyMpg).toBe(DEFAULT_FUEL_ECONOMY_MPG)
    expect(estimate.fuelEconomySource).toBe("estimate")
    expect(estimate.deadheadMiles).toBeNull()
    expect(estimate.fuelCostCents).toBeGreaterThan(0)
  })

  it("uses saved MPG, fuel price, and home coordinates when available", () => {
    const { landing, load, route, state } = seedLane()
    const driver = {
      ...state.driverProfiles[0]!,
      homeBaseCoordinates: { lat: 44, lng: -123 },
      preferredFuelPriceCentsPerGallon: 390,
    }
    const truck = { ...state.truckProfiles[0]!, fuelEconomyMpg: 7.2 }
    const estimate = estimateLoadEconomics({ driver, landing, load, route, truck })

    expect(estimate.fuelEconomySource).toBe("profile")
    expect(estimate.fuelPriceSource).toBe("profile")
    expect(estimate.deadheadMiles).toBeGreaterThan(0)
    expect(estimate.totalMiles).toBeGreaterThan(estimate.tripMiles)
  })

  it("takes the host's stated pay as-is and subtracts only estimated fuel", () => {
    // The stated figure is a commitment to a person: no fuel surcharge and no
    // per-ton multiplication is added to it. A $525 load pays $525.
    const { landing, load, route, state } = seedLane()
    const driver = {
      ...state.driverProfiles[0]!,
      homeBaseCoordinates: null,
      preferredFuelPriceCentsPerGallon: 500
    }
    const truck = { ...state.truckProfiles[0]!, fuelEconomyMpg: 5 }
    const estimate = estimateLoadEconomics({
      driver,
      landing,
      load: { ...load, driverPayCents: 52_500 },
      route: { ...route, estimatedDistanceMiles: 100 },
      truck
    })

    expect(estimate.grossCents).toBe(52_500)
    expect(estimate.fuelCostCents).toBe(10_000)
    expect(estimate.afterFuelCents).toBe(42_500)
    expect(estimate.afterFuelLabel).toBe("$425")
  })

  it("states no gross for a draft that has no stated pay", () => {
    const { landing, load, route } = seedLane()
    const estimate = estimateLoadEconomics({
      driver: null,
      landing,
      load: { ...load, driverPayCents: null },
      route,
      truck: null
    })

    expect(estimate.grossCents).toBeNull()
    expect(estimate.afterFuelCents).toBeNull()
    expect(estimate.afterFuelLabel).toBeNull()
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
    const { landing, load, route, state } = seedLane()
    const seedDriver = state.driverProfiles[0]

    if (!seedDriver) throw new Error("seed has no driver profiles")

    // Exactly one degree of latitude south of the landing: 69.09409 great-circle
    // miles, hand-computed, so the expected road figure is 69.09409 * 1.3 = 89.82.
    const driver = {
      ...seedDriver,
      homeBaseCoordinates: { lat: landing.coordinates.lat - 1, lng: landing.coordinates.lng }
    }
    const withHome = estimateLoadEconomics({ driver, landing, load, route, truck: null })
    const withoutHome = estimateLoadEconomics({
      driver: { ...seedDriver, homeBaseCoordinates: null },
      landing,
      load,
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
