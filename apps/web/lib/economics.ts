import { haversineMiles, SCHEDULING_BUFFER_DEFAULTS } from "@logloads/contracts"
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
  /**
   * Whether `grossCents` is the host's commitment or a rate-card derivation.
   * Surfaces MUST consult this before wording the figure: a host-stated number
   * may be presented as what the load pays, a derived one may only ever be
   * presented as an estimate.
   */
  payBasis: PayBasis
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

/**
 * What this load pays the driver, and where that number came from.
 *
 * The host's stated figure OUTRANKS the rate card and is used as-is: it is a
 * commitment to a person, not an entry in a price list, so nothing is added to
 * it — no fuel surcharge, no per-ton multiplication. A $500 load pays $500.
 *
 * Before this, every surface headlined the rate-card derivation and demoted the
 * host's commitment to a line labelled "Base", which meant the public homepage
 * advertised $1,970 for a haul the host had committed $525 to — 3.75x. The rate
 * card survives only as a fallback for postings created before hosts could state
 * pay, and `basis` exists so no surface can print an estimate while implying it
 * is a promise.
 */
export type PayBasis = "host_stated" | "rate_card"

function driverPayEstimate(
  load: LoadPosting,
  rate: Rate,
  route: HaulRoute
): { basis: PayBasis; cents: number | null } {
  if (typeof load.driverPayCents === "number") {
    return { basis: "host_stated", cents: load.driverPayCents }
  }

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

  return { basis: "rate_card", cents: base === null ? null : base + rate.fuelSurchargeCents }
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
  const pay = driverPayEstimate(input.load, input.rate, input.route)
  const grossCents = pay.cents
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
    payBasis: pay.basis,
    totalMiles,
    tripMiles
  }
}
