import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { DEFAULT_FUEL_ECONOMY_MPG, estimateLoadEconomics } from "./economics"

describe("load economics", () => {
  it("uses transparent defaults when the driver has not saved fuel assumptions", () => {
    const state = createInMemoryDatabase()
    const load = state.loadPostings[0]!
    const rate = state.rates.find((item) => item.id === load.rateId)!
    const route = state.haulRoutes.find((item) => item.id === load.routeId)!
    const landing = state.landings.find((item) => item.id === load.pickupLandingId)!
    const estimate = estimateLoadEconomics({ driver: null, landing, load, rate, route, truck: null })

    expect(estimate.fuelEconomyMpg).toBe(DEFAULT_FUEL_ECONOMY_MPG)
    expect(estimate.fuelEconomySource).toBe("estimate")
    expect(estimate.deadheadMiles).toBeNull()
    expect(estimate.fuelCostCents).toBeGreaterThan(0)
  })

  it("uses saved MPG, fuel price, and home coordinates when available", () => {
    const state = createInMemoryDatabase()
    const load = state.loadPostings[0]!
    const rate = state.rates.find((item) => item.id === load.rateId)!
    const route = state.haulRoutes.find((item) => item.id === load.routeId)!
    const landing = state.landings.find((item) => item.id === load.pickupLandingId)!
    const driver = {
      ...state.driverProfiles[0]!,
      homeBaseCoordinates: { lat: 44, lng: -123 },
      preferredFuelPriceCentsPerGallon: 390,
    }
    const truck = { ...state.truckProfiles[0]!, fuelEconomyMpg: 7.2 }
    const estimate = estimateLoadEconomics({ driver, landing, load, rate, route, truck })

    expect(estimate.fuelEconomySource).toBe("profile")
    expect(estimate.fuelPriceSource).toBe("profile")
    expect(estimate.deadheadMiles).toBeGreaterThan(0)
    expect(estimate.totalMiles).toBeGreaterThan(estimate.tripMiles)
  })

  it.each([
    { amountCents: 20_000, expectedBaseCents: 20_000, rateType: "flat_rate" as const },
    { amountCents: 18_000, expectedBaseCents: 18_000, rateType: "per_load" as const },
    { amountCents: 250, expectedBaseCents: 25_000, rateType: "per_mile" as const },
    { amountCents: 5_000, expectedBaseCents: 100_000, rateType: "per_ton" as const },
    { amountCents: 3_000, expectedBaseCents: 6_000, rateType: "per_hour" as const }
  ])("calculates $rateType gross, surcharge, fuel cost, and after-fuel amount", ({ amountCents, expectedBaseCents, rateType }) => {
    // These cases exercise the RATE-CARD FALLBACK, which applies only to postings
    // created before a host could state a flat driver pay. `driverPayCents` is
    // explicitly cleared: the seed's first posting now carries one, and leaving it
    // set made every case here assert the stated figure instead of the arithmetic
    // it was written to cover.
    const state = createInMemoryDatabase()
    const sourceLoad = state.loadPostings[0]!
    const sourceRate = state.rates.find((item) => item.id === sourceLoad.rateId)!
    const sourceRoute = state.haulRoutes.find((item) => item.id === sourceLoad.routeId)!
    const landing = state.landings.find((item) => item.id === sourceLoad.pickupLandingId)!
    const driver = {
      ...state.driverProfiles[0]!,
      homeBaseCoordinates: null,
      preferredFuelPriceCentsPerGallon: 500
    }
    const truck = { ...state.truckProfiles[0]!, fuelEconomyMpg: 5 }
    const load = { ...sourceLoad, driverPayCents: null, estimatedTonsPerLoad: 20 }
    const route = { ...sourceRoute, estimatedDistanceMiles: 100, estimatedRunTimeMinutes: 120 }
    const rate = {
      ...sourceRate,
      baseRate: { ...sourceRate.baseRate, amountCents },
      fuelSurchargeCents: 500,
      rateType
    }
    const estimate = estimateLoadEconomics({ driver, landing, load, rate, route, truck })

    expect(estimate.payBasis).toBe("rate_card")
    expect(estimate.grossCents).toBe(expectedBaseCents + 500)
    expect(estimate.fuelCostCents).toBe(10_000)
    expect(estimate.afterFuelCents).toBe(expectedBaseCents - 9_500)
  })

  it.each([
    { rateType: "flat_rate" as const },
    { rateType: "per_load" as const },
    { rateType: "per_mile" as const },
    { rateType: "per_ton" as const },
    { rateType: "per_hour" as const }
  ])("lets a host-stated driver pay override the $rateType rate card entirely", ({ rateType }) => {
    // The host's commitment outranks every rate basis, and nothing is added to
    // it — not the fuel surcharge, not a per-ton multiplication. This is the
    // control for the defect where the rate card headlined $1,970 against a
    // committed $525 on the public homepage.
    const state = createInMemoryDatabase()
    const sourceLoad = state.loadPostings[0]!
    const sourceRate = state.rates.find((item) => item.id === sourceLoad.rateId)!
    const sourceRoute = state.haulRoutes.find((item) => item.id === sourceLoad.routeId)!
    const landing = state.landings.find((item) => item.id === sourceLoad.pickupLandingId)!
    const load = { ...sourceLoad, driverPayCents: 52_500, estimatedTonsPerLoad: 20 }
    const route = { ...sourceRoute, estimatedDistanceMiles: 100, estimatedRunTimeMinutes: 120 }
    const rate = {
      ...sourceRate,
      baseRate: { ...sourceRate.baseRate, amountCents: 9_999 },
      fuelSurchargeCents: 500,
      rateType
    }
    const estimate = estimateLoadEconomics({ driver: null, landing, load, rate, route, truck: null })

    expect(estimate.payBasis).toBe("host_stated")
    expect(estimate.grossCents).toBe(52_500)
  })
})
