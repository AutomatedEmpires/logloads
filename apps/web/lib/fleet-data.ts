import { evaluateLoadCompatibility, type EquipmentCombination } from "@logloads/contracts"

import type { NetworkLoadView, NetworkView } from "./network"
import { services } from "./services"
import { getCockpitContext, shellAccountFor, type ShellAccount } from "./v3"
import { formatDateTime, formatHuman, shortLane, tripStatusLabel } from "./v3-shared"

const ACTIVE_ASSIGNMENT_STATUSES = new Set(["requested", "offered", "accepted", "checked_in", "loading", "hauled"])
const ACTIVE_TRIP_STATUSES = new Set([
  "assigned",
  "en_route_to_landing",
  "checked_in",
  "loading",
  "loaded",
  "en_route_to_destination",
  "at_destination",
  "unloading"
])

export interface DriverOption {
  id: string
  name: string
}

export interface FleetDriverRow {
  id: string
  name: string
  phone: string
  homeBase: string
  yearsExperience: number
  availabilityStatus: string
  availabilityLabel: string
  equipmentLabel: string | null
  activeTrip: { id: string; loadTitle: string; statusLabel: string } | null
}

export interface FleetTruckRow {
  combinationId: string
  label: string
  configuration: string
  payload: string
  region: string
  matchCount: number
  verification: string
  combinationStatus: string
  driverProfileId: string | null
  driverName: string | null
}

export interface DispatchSuggestion {
  loadPostingId: string
  title: string
  lane: string
  payLabel: string
  scheduleLabel: string
  partnerLoad: boolean
  fit: string
  reason: string | null
  requestableSlotId: string | null
  remaining: number
}

export interface DispatchTruckPlan {
  combinationId: string
  label: string
  payload: string
  region: string
  driverProfileId: string | null
  driverName: string | null
  blocked: "no_driver" | "driver_on_trip" | null
  suggestion: DispatchSuggestion | null
}

export interface LoadDispatchOption {
  combinationId: string
  label: string
  payload: string
  driverProfileId: string
  driverName: string
  eligible: boolean
  fit: string
  reasons: string[]
}

export interface FleetCockpitData {
  account: ShellAccount
  network: NetworkView
  drivers: FleetDriverRow[]
  driverOptions: DriverOption[]
  trucks: FleetTruckRow[]
  combinations: Array<{ id: string; label: string }>
  dispatchPlan: DispatchTruckPlan[]
}

function eligibilityFitLabel(eligibility: string): string {
  if (eligibility === "strong_match") {
    return "Strong fit"
  }

  if (eligibility === "eligible_with_review") {
    return "Review needed"
  }

  if (eligibility === "ineligible") {
    return "Not compatible"
  }

  return "Potential fit"
}

function eligibilityRank(eligibility: string): number {
  if (eligibility === "strong_match") {
    return 0
  }

  if (eligibility === "eligible") {
    return 1
  }

  return 2
}

function organizationDriverProfiles(organizationId: string, combinations: EquipmentCombination[]) {
  const state = services.state

  return state.driverProfiles.filter((driver) =>
    driver.companyId === organizationId ||
    combinations.some((combination) => combination.assignedDriverProfileId === driver.id) ||
    state.organizationMemberships.some((membership) =>
      membership.organizationId === organizationId &&
      membership.status === "active" &&
      membership.userId === driver.userId
    )
  )
}

function availabilitySummary(driverProfileId: string, fallbackStatus: string): { status: string; label: string } {
  const state = services.state
  const now = Date.now()
  const windows = state.availabilityWindows
    .filter((window) => window.driverProfileId === driverProfileId)
    .sort((left, right) => left.startAt.localeCompare(right.startAt))

  const current = windows.find((window) => Date.parse(window.startAt) <= now && Date.parse(window.endAt) >= now)

  if (current) {
    return {
      label: `${formatHuman(current.status)} until ${formatDateTime(current.endAt)}`,
      status: current.status
    }
  }

  const upcoming = windows.find((window) => Date.parse(window.startAt) > now)

  if (upcoming) {
    return {
      label: `${formatHuman(upcoming.status)} from ${formatDateTime(upcoming.startAt)}`,
      status: fallbackStatus
    }
  }

  return { label: "No availability window set", status: fallbackStatus }
}

function suggestionForCombination(
  combination: EquipmentCombination,
  driverProfileId: string,
  openLoads: NetworkLoadView[]
): DispatchSuggestion | null {
  const state = services.state
  const truck = state.truckProfiles.find((candidate) => candidate.id === combination.truckProfileId)

  if (!truck) {
    return null
  }

  const trailer = combination.trailerProfileId
    ? state.trailerProfiles.find((candidate) => candidate.id === combination.trailerProfileId) ?? null
    : null
  const availabilityWindows = state.availabilityWindows.filter((window) => window.driverProfileId === driverProfileId)

  const candidates = openLoads
    .filter((view) => !view.assignments.some((assignment) =>
      assignment.driverProfileId === driverProfileId && ACTIVE_ASSIGNMENT_STATUSES.has(assignment.status)
    ))
    .flatMap((view) => {
      const load = state.loadPostings.find((candidate) => candidate.id === view.id)

      if (!load) {
        return []
      }

      const route = state.haulRoutes.find((candidate) => candidate.id === load.routeId) ?? null
      const result = evaluateLoadCompatibility({ availabilityWindows, load, route, trailer, truck })

      if (result.eligibility === "ineligible") {
        return []
      }

      return [{ result, view }]
    })
    .sort((left, right) =>
      eligibilityRank(left.result.eligibility) - eligibilityRank(right.result.eligibility) ||
      right.result.score - left.result.score
    )

  const top = candidates.at(0)

  if (!top) {
    return null
  }

  return {
    fit: eligibilityFitLabel(top.result.eligibility),
    lane: shortLane(top.view),
    loadPostingId: top.view.id,
    partnerLoad: top.view.visibilityMode === "private_network",
    payLabel: top.view.payLabel,
    reason: top.result.cautions.at(0) ?? top.result.positiveSignals.at(0) ?? null,
    remaining: top.view.capacity.remaining,
    requestableSlotId: top.view.slots.requestableSlotId,
    scheduleLabel: top.view.scheduleLabel,
    title: top.view.title
  }
}

export async function getFleetCockpitData(): Promise<FleetCockpitData> {
  const context = await getCockpitContext("fleet")
  const network = context.network
  const state = services.state
  const organizationId = network.activeOrganization.id

  const combinations = state.equipmentCombinations.filter((combination) => combination.organizationId === organizationId)
  const orgDrivers = organizationDriverProfiles(organizationId, combinations)
  const activeTripsByDriver = new Map(
    state.tripsV2
      .filter((trip) => ACTIVE_TRIP_STATUSES.has(trip.status))
      .map((trip) => [trip.driverProfileId, trip] as const)
  )

  const drivers: FleetDriverRow[] = orgDrivers.map((driver) => {
    const user = state.profiles.find((profile) => profile.id === driver.userId)
    const equipment = combinations.find((combination) => combination.assignedDriverProfileId === driver.id) ?? null
    const activeTrip = activeTripsByDriver.get(driver.id) ?? null
    const activeLoad = activeTrip
      ? state.loadPostings.find((load) => load.id === activeTrip.loadPostingId) ?? null
      : null
    const availability = availabilitySummary(driver.id, driver.availabilityStatus)

    return {
      activeTrip: activeTrip
        ? {
            id: activeTrip.id,
            loadTitle: activeLoad?.title ?? "Assigned load",
            statusLabel: tripStatusLabel(activeTrip.status)
          }
        : null,
      availabilityLabel: availability.label,
      availabilityStatus: availability.status,
      equipmentLabel: equipment?.label ?? null,
      homeBase: driver.homeBase,
      id: driver.id,
      name: user?.fullName ?? "Driver",
      phone: user?.phone ?? "",
      yearsExperience: driver.yearsExperience
    }
  })

  const driverOptions: DriverOption[] = drivers.map((driver) => ({ id: driver.id, name: driver.name }))

  const trucks: FleetTruckRow[] = combinations.map((combination) => {
    const networkTruck = network.trucks.find((truck) => truck.id === combination.id)
    const driver = combination.assignedDriverProfileId
      ? drivers.find((candidate) => candidate.id === combination.assignedDriverProfileId) ?? null
      : null

    return {
      combinationId: combination.id,
      combinationStatus: combination.status,
      configuration: networkTruck?.configuration ?? formatHuman(combination.truckTypes.join(", ")),
      driverName: driver?.name ?? null,
      driverProfileId: combination.assignedDriverProfileId ?? null,
      label: combination.label,
      matchCount: networkTruck?.matchCount ?? 0,
      payload: `${combination.maxPayloadTons} tons`,
      region: combination.homeRegion,
      verification: networkTruck?.verification ?? "pending"
    }
  })

  const openLoads = network.loads.filter((load) => load.status === "open" && load.capacity.remaining > 0)

  const dispatchPlan: DispatchTruckPlan[] = combinations
    .filter((combination) => combination.status === "available")
    .map((combination) => {
      const driverProfileId = combination.assignedDriverProfileId ?? null
      const driver = driverProfileId ? drivers.find((candidate) => candidate.id === driverProfileId) ?? null : null
      const blocked: DispatchTruckPlan["blocked"] = !driverProfileId
        ? "no_driver"
        : activeTripsByDriver.has(driverProfileId)
          ? "driver_on_trip"
          : null

      return {
        blocked,
        combinationId: combination.id,
        driverName: driver?.name ?? null,
        driverProfileId,
        label: combination.label,
        payload: `${combination.maxPayloadTons} tons`,
        region: combination.homeRegion,
        suggestion: blocked === null && driverProfileId
          ? suggestionForCombination(combination, driverProfileId, openLoads)
          : null
      }
    })

  return {
    account: shellAccountFor(context),
    combinations: combinations.map((combination) => ({ id: combination.id, label: combination.label })),
    dispatchPlan,
    driverOptions,
    drivers,
    network,
    trucks
  }
}

export interface FleetOpportunityData {
  account: ShellAccount
  network: NetworkView
  load: NetworkLoadView | null
  options: LoadDispatchOption[]
}

export async function getFleetOpportunityData(loadId: string): Promise<FleetOpportunityData> {
  const context = await getCockpitContext("fleet")
  const network = context.network
  const state = services.state
  const organizationId = network.activeOrganization.id

  const load = network.loads.find((candidate) => candidate.id === loadId) ?? null
  const posting = load ? state.loadPostings.find((candidate) => candidate.id === load.id) ?? null : null

  if (!load || !posting) {
    return { account: shellAccountFor(context), load: null, network, options: [] }
  }

  const route = state.haulRoutes.find((candidate) => candidate.id === posting.routeId) ?? null
  const activeTripDriverIds = new Set(
    state.tripsV2.filter((trip) => ACTIVE_TRIP_STATUSES.has(trip.status)).map((trip) => trip.driverProfileId)
  )

  const options: LoadDispatchOption[] = state.equipmentCombinations
    .filter((combination) => combination.organizationId === organizationId && combination.status === "available")
    .flatMap((combination) => {
      const driverProfileId = combination.assignedDriverProfileId

      if (!driverProfileId || activeTripDriverIds.has(driverProfileId)) {
        return []
      }

      const driver = state.driverProfiles.find((candidate) => candidate.id === driverProfileId)
      const user = driver ? state.profiles.find((profile) => profile.id === driver.userId) : undefined
      const truck = state.truckProfiles.find((candidate) => candidate.id === combination.truckProfileId)

      if (!driver || !truck) {
        return []
      }

      const alreadyRequested = load.assignments.some((assignment) =>
        assignment.driverProfileId === driverProfileId && ACTIVE_ASSIGNMENT_STATUSES.has(assignment.status)
      )

      if (alreadyRequested) {
        return []
      }

      const trailer = combination.trailerProfileId
        ? state.trailerProfiles.find((candidate) => candidate.id === combination.trailerProfileId) ?? null
        : null
      const availabilityWindows = state.availabilityWindows.filter((window) => window.driverProfileId === driverProfileId)
      const result = evaluateLoadCompatibility({ availabilityWindows, load: posting, route, trailer, truck })

      return [{
        combinationId: combination.id,
        driverName: user?.fullName ?? "Driver",
        driverProfileId,
        eligible: result.eligibility !== "ineligible",
        fit: eligibilityFitLabel(result.eligibility),
        label: combination.label,
        payload: `${combination.maxPayloadTons} tons`,
        rank: eligibilityRank(result.eligibility),
        reasons: result.eligibility === "ineligible"
          ? result.hardFailures.slice(0, 2)
          : [...result.cautions, ...result.positiveSignals].slice(0, 2)
      }]
    })
    .sort((left, right) => Number(right.eligible) - Number(left.eligible) || left.rank - right.rank)
    .map((option) => {
      const { rank, ...rest } = option
      void rank

      return rest
    })

  return { account: shellAccountFor(context), load, network, options }
}
