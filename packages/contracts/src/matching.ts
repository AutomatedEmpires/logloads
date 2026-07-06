import type {
  AvailabilityWindow,
  HaulRoute,
  LoadPosting,
  TrailerProfile,
  TruckProfile
} from "./schemas"
import type { LoadType, RoadCondition, TrailerType, TruckType } from "./enums"

export type MatchEligibility =
  | "strong_match"
  | "eligible"
  | "eligible_with_review"
  | "ineligible"

export interface CompatibilityInput {
  load: LoadPosting
  truck: TruckProfile
  trailer?: TrailerProfile | null
  route?: HaulRoute | null
  availabilityWindows?: readonly AvailabilityWindow[]
}

export interface CompatibilityResult {
  eligibility: MatchEligibility
  score: number
  hardFailures: string[]
  positiveSignals: string[]
  cautions: string[]
}

const loadTypeRequirements: Record<
  LoadType,
  {
    truckTypes: readonly TruckType[]
    trailerTypes: readonly TrailerType[]
    tags: readonly string[]
    label: string
  }
> = {
  biomass: {
    truckTypes: ["chip_truck", "log_truck"],
    trailerTypes: ["chip_van", "bunk_trailer", "self_loader"],
    tags: [],
    label: "biomass-capable trailer"
  },
  chips: {
    truckTypes: ["chip_truck"],
    trailerTypes: ["chip_van"],
    tags: ["chip-box"],
    label: "chip truck and chip van"
  },
  mixed: {
    truckTypes: ["log_truck", "chip_truck"],
    trailerTypes: ["pole_trailer", "bunk_trailer", "self_loader", "chip_van"],
    tags: [],
    label: "mixed timber-capable equipment"
  },
  other: {
    truckTypes: ["log_truck", "chip_truck", "lowboy", "other"],
    trailerTypes: ["pole_trailer", "bunk_trailer", "self_loader", "flatbed", "chip_van", "other"],
    tags: [],
    label: "listed equipment"
  },
  pulpwood: {
    truckTypes: ["log_truck"],
    trailerTypes: ["pole_trailer", "bunk_trailer", "self_loader"],
    tags: [],
    label: "log truck and timber trailer"
  },
  saw_logs: {
    truckTypes: ["log_truck"],
    trailerTypes: ["pole_trailer", "bunk_trailer", "self_loader"],
    tags: [],
    label: "log truck and log trailer"
  }
}

const hardRoadConditions: readonly RoadCondition[] = ["closed"]
const cautionRoadConditions: readonly RoadCondition[] = ["restricted", "icy", "snow", "muddy", "wet"]

function normalized(value: string): string {
  return value.toLowerCase().replaceAll("_", "-").replaceAll(" ", "-")
}

function hasAny<T extends string>(values: readonly T[], candidate: T | undefined): boolean {
  return Boolean(candidate && values.includes(candidate))
}

function collectCapabilities(truck: TruckProfile, trailer?: TrailerProfile | null): Set<string> {
  const values = [
    truck.truckType,
    ...truck.equipmentTags,
    ...truck.roadAccessCapabilities,
    ...(trailer ? [trailer.trailerType, ...trailer.equipmentTags] : [])
  ]

  return new Set(values.map(normalized))
}

function availabilityMatchesLoad(
  load: LoadPosting,
  windows: readonly AvailabilityWindow[] | undefined
): "available" | "limited" | "unavailable" | "unknown" {
  if (!windows || windows.length === 0) {
    return "unknown"
  }

  const routeMatches = windows.filter((window) =>
    window.preferredRouteIds.length === 0 || window.preferredRouteIds.includes(load.routeId)
  )
  const relevantWindows = routeMatches.length > 0 ? routeMatches : windows

  if (relevantWindows.some((window) => window.status === "available")) {
    return "available"
  }

  if (relevantWindows.some((window) => window.status === "limited")) {
    return "limited"
  }

  return "unavailable"
}

export function evaluateLoadCompatibility(input: CompatibilityInput): CompatibilityResult {
  const { availabilityWindows, load, route, trailer, truck } = input
  const hardFailures: string[] = []
  const positiveSignals: string[] = []
  const cautions: string[] = []
  const required = loadTypeRequirements[load.loadType]
  const capabilities = collectCapabilities(truck, trailer)
  let score = 52

  if (load.status !== "open") {
    cautions.push(`Load is currently ${load.status.replaceAll("_", " ")}.`)
    score -= 12
  } else {
    positiveSignals.push("Load is open for capacity requests.")
    score += 8
  }

  if (truck.archivedAt) {
    hardFailures.push("Truck profile is archived.")
  }

  if (!hasAny(required.truckTypes, truck.truckType)) {
    hardFailures.push(`Requires ${required.label}; truck is listed as ${truck.truckType.replaceAll("_", " ")}.`)
  } else {
    positiveSignals.push(`Truck type fits ${load.loadType.replaceAll("_", " ")} work.`)
    score += 14
  }

  if (required.trailerTypes.length > 0) {
    if (!trailer) {
      hardFailures.push(`Requires ${required.label}; no trailer is attached to this evaluation.`)
    } else if (!hasAny(required.trailerTypes, trailer.trailerType)) {
      hardFailures.push(`Trailer ${trailer.unitNumber} does not fit ${required.label}.`)
    } else {
      positiveSignals.push(`Trailer ${trailer.unitNumber} fits the required configuration.`)
      score += 14
    }
  }

  if (load.estimatedTonsPerLoad && load.estimatedTonsPerLoad > truck.maxPayloadTons) {
    hardFailures.push(`Estimated ${load.estimatedTonsPerLoad} tons exceeds truck payload ${truck.maxPayloadTons} tons.`)
  } else if (load.estimatedTonsPerLoad) {
    positiveSignals.push(`Payload covers estimated ${load.estimatedTonsPerLoad} tons.`)
    score += 8
  }

  if (trailer && load.estimatedTonsPerLoad && load.estimatedTonsPerLoad > trailer.capacityTons) {
    hardFailures.push(`Estimated ${load.estimatedTonsPerLoad} tons exceeds trailer capacity ${trailer.capacityTons} tons.`)
  }

  for (const tag of [...required.tags, ...load.equipmentRequirements]) {
    if (!capabilities.has(normalized(tag))) {
      hardFailures.push(`Missing required equipment: ${tag}.`)
    } else {
      positiveSignals.push(`Equipment includes ${tag}.`)
      score += 3
    }
  }

  for (const accessRequirement of load.accessRequirements) {
    if (!capabilities.has(normalized(accessRequirement))) {
      cautions.push(`Access requirement needs review: ${accessRequirement}.`)
      score -= 3
    } else {
      positiveSignals.push(`Access capability includes ${accessRequirement}.`)
      score += 3
    }
  }

  if (hardRoadConditions.includes(load.roadCondition)) {
    hardFailures.push("Landing road is closed.")
  } else if (cautionRoadConditions.includes(load.roadCondition)) {
    cautions.push(`Landing road condition is ${load.roadCondition}; verify local instructions before departure.`)
    score -= 4
  } else {
    positiveSignals.push("Landing road condition is clear enough for normal dispatch.")
    score += 5
  }

  if (route) {
    if (hardRoadConditions.includes(route.roadCondition)) {
      hardFailures.push("The listed haul route is closed.")
    } else if (cautionRoadConditions.includes(route.roadCondition)) {
      cautions.push(`Route is marked ${route.roadCondition}; use operator directions over consumer routing.`)
      score -= 4
    } else {
      positiveSignals.push(`${Math.round(route.estimatedDistanceMiles)} mile route has no active restriction.`)
      score += 5
    }
  }

  const availability = availabilityMatchesLoad(load, availabilityWindows)
  if (availability === "available") {
    positiveSignals.push("Driver availability overlaps this route.")
    score += 10
  } else if (availability === "limited") {
    cautions.push("Driver availability is limited for this operating window.")
    score -= 4
  } else if (availability === "unavailable") {
    hardFailures.push("Driver is marked unavailable for this work.")
  } else {
    cautions.push("Availability has not been confirmed for this window.")
  }

  const boundedScore = Math.max(0, Math.min(100, score - hardFailures.length * 18))
  const eligibility: MatchEligibility = hardFailures.length > 0
    ? "ineligible"
    : boundedScore >= 86 && cautions.length <= 1
      ? "strong_match"
      : cautions.length > 0
        ? "eligible_with_review"
        : "eligible"

  return {
    cautions,
    eligibility,
    hardFailures,
    positiveSignals,
    score: boundedScore
  }
}

export function explainCompatibility(result: CompatibilityResult): string {
  if (result.eligibility === "ineligible") {
    return `Not eligible: ${result.hardFailures[0] ?? "required load rules are not satisfied."}`
  }

  if (result.eligibility === "strong_match") {
    return `Strong match: ${result.positiveSignals.slice(0, 3).join(" ")}`
  }

  if (result.eligibility === "eligible_with_review") {
    return `Eligible with review: ${result.cautions[0] ?? "confirm operating details before accepting."}`
  }

  return `Eligible: ${result.positiveSignals.slice(0, 2).join(" ")}`
}

