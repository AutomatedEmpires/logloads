import { haversineMiles, SCHEDULING_BUFFER_DEFAULTS } from "@logloads/contracts"
import type { DriverProfile, HaulRoute, Landing, LoadPosting, TruckProfile } from "@logloads/contracts"

export const DEFAULT_FUEL_ECONOMY_MPG = 6.5
export const DEFAULT_FUEL_PRICE_CENTS_PER_GALLON = 425

export interface LoadEconomicsEstimate {
  afterFuelCents: number | null
  afterFuelLabel: string | null
  deadheadMiles: number | null
  fuelCostCents: number
  fuelCostLabel: string
  fuelEconomyMpg: number
  fuelEconomySource: "profile" | "estimate"
  fuelPriceCentsPerGallon: number
  fuelPriceSource: "profile" | "estimate"
  gallons: number
  /** The host-stated driver pay; null only on a draft that states none. */
  grossCents: number | null
  totalMiles: number
  tripMiles: number
}

function dollars(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(cents / 100)
}

/**
 * One haversine for the whole product. This was implemented here, out of reach
 * of the domain layer, which meant scheduling could not measure the same road
 * that pay maths measures. Re-exported rather than re-implemented: two copies
 * would drift until deadhead pay and deadhead time disagreed about one haul.
 */
const distanceMiles = haversineMiles

export function estimateLoadEconomics(input: {
  driver: DriverProfile | null
  landing: Landing
  load: LoadPosting
  route: HaulRoute
  truck: TruckProfile | null
}): LoadEconomicsEstimate {
  const profileMpg = input.truck?.fuelEconomyMpg ?? null
  const profileFuelPrice = input.driver?.preferredFuelPriceCentsPerGallon ?? null
  // Road miles, not straight-line. A great-circle deadhead understates a logging
  // road badly — measured 1.15x to 1.56x on this product's own seeded lanes — and
  // this number becomes gallons, then dollars, then a driver's accept/decline.
  // roadCircuityFactor is the platform's own correction; using it here is what
  // makes the fuel figure and the scheduling deadhead measure the same road.
  const deadheadMiles = input.driver?.homeBaseCoordinates
    ? distanceMiles(input.driver.homeBaseCoordinates, input.landing.coordinates) *
      SCHEDULING_BUFFER_DEFAULTS.roadCircuityFactor
    : null
  const tripMiles = input.route.estimatedDistanceMiles
  const totalMiles = tripMiles + (deadheadMiles ?? 0)
  const fuelEconomyMpg = profileMpg ?? DEFAULT_FUEL_ECONOMY_MPG
  const fuelPriceCentsPerGallon = profileFuelPrice ?? DEFAULT_FUEL_PRICE_CENTS_PER_GALLON
  const gallons = totalMiles / fuelEconomyMpg
  const fuelCostCents = Math.round(gallons * fuelPriceCentsPerGallon)
  // The host's stated figure, used as-is: it is a commitment to a person, so
  // nothing is added to it — no fuel surcharge, no per-ton multiplication.
  const grossCents = input.load.driverPayCents ?? null
  const afterFuelCents = grossCents === null ? null : grossCents - fuelCostCents

  return {
    afterFuelCents,
    afterFuelLabel: afterFuelCents === null ? null : dollars(afterFuelCents),
    deadheadMiles,
    fuelCostCents,
    fuelCostLabel: dollars(fuelCostCents),
    fuelEconomyMpg,
    fuelEconomySource: profileMpg ? "profile" : "estimate",
    fuelPriceCentsPerGallon,
    fuelPriceSource: profileFuelPrice ? "profile" : "estimate",
    gallons,
    grossCents,
    totalMiles,
    tripMiles
  }
}
