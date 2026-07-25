import { haversineMiles } from "@logloads/contracts"
import type { DriverProfile, HaulRoute, Landing, LoadPosting, Rate, TruckProfile } from "@logloads/contracts"

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
  grossCents: number | null
  grossLabel: string | null
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

function grossEstimateCents(load: LoadPosting, rate: Rate, route: HaulRoute): number | null {
  const amount = rate.baseRate.amountCents
  let base: number | null = null

  if (rate.rateType === "flat_rate" || rate.rateType === "per_load") {
    base = amount
  } else if (rate.rateType === "per_mile") {
    base = Math.round(amount * route.estimatedDistanceMiles)
  } else if (rate.rateType === "per_ton" && load.estimatedTonsPerLoad) {
    base = Math.round(amount * load.estimatedTonsPerLoad)
  } else if (rate.rateType === "per_hour") {
    base = Math.round(amount * route.estimatedRunTimeMinutes / 60)
  }

  return base === null ? null : base + rate.fuelSurchargeCents
}

export function estimateLoadEconomics(input: {
  driver: DriverProfile | null
  landing: Landing
  load: LoadPosting
  rate: Rate
  route: HaulRoute
  truck: TruckProfile | null
}): LoadEconomicsEstimate {
  const profileMpg = input.truck?.fuelEconomyMpg ?? null
  const profileFuelPrice = input.driver?.preferredFuelPriceCentsPerGallon ?? null
  const deadheadMiles = input.driver?.homeBaseCoordinates
    ? distanceMiles(input.driver.homeBaseCoordinates, input.landing.coordinates)
    : null
  const tripMiles = input.route.estimatedDistanceMiles
  const totalMiles = tripMiles + (deadheadMiles ?? 0)
  const fuelEconomyMpg = profileMpg ?? DEFAULT_FUEL_ECONOMY_MPG
  const fuelPriceCentsPerGallon = profileFuelPrice ?? DEFAULT_FUEL_PRICE_CENTS_PER_GALLON
  const gallons = totalMiles / fuelEconomyMpg
  const fuelCostCents = Math.round(gallons * fuelPriceCentsPerGallon)
  const grossCents = grossEstimateCents(input.load, input.rate, input.route)
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
    grossLabel: grossCents === null ? null : dollars(grossCents),
    totalMiles,
    tripMiles
  }
}
