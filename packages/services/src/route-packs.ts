import {
  routePackSchema,
  type Assignment,
  type HaulRoute,
  type LoadPosting,
  type Rate,
  type RoutePack,
  type RoutePackInstruction,
  type RoutePackSnapshot,
  type TruckSlot
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { createUuid, nowIso } from "./utils"

export interface RoutePackSources {
  assignment: Assignment
  load: LoadPosting
  route: HaulRoute
  slot: TruckSlot | null
  rate: Rate | null
}

function resolveOwnedDispatcher(state: LogLoadsDatabaseState, load: LoadPosting) {
  return state.dispatcherProfiles.find(
    (profile) => profile.id === load.dispatcherProfileId && profile.companyId === load.companyId
  )
}

/**
 * A non-throwing boundary for read paths. Legacy documents can predate the
 * publication guard, so callers that list or serve work must be able to omit
 * malformed records without turning discovery into an exception surface.
 */
export function loadPostingHasOwnedCoherentSources(
  state: LogLoadsDatabaseState,
  load: LoadPosting
): boolean {
  const dispatcher = resolveOwnedDispatcher(state, load)
  const loader = load.loaderProfileId
    ? state.loaderProfiles.find(
      (profile) => profile.id === load.loaderProfileId && profile.companyId === load.companyId
    )
    : null
  const landing = state.landings.find(
    (candidate) => candidate.id === load.pickupLandingId && candidate.companyId === load.companyId
  )
  const rate = state.rates.find(
    (candidate) => candidate.id === load.rateId && candidate.companyId === load.companyId
  )
  const route = state.haulRoutes.find(
    (candidate) => candidate.id === load.routeId && candidate.companyId === load.companyId
  )

  return Boolean(
    dispatcher &&
    (!load.loaderProfileId || loader) &&
    landing &&
    rate &&
    route &&
    route.landingId === load.pickupLandingId &&
    route.millId === load.dropoffMillId
  )
}

/**
 * A stored Route Pack is safe to serve only while both the current posting and
 * the pack's own source identifiers remain inside the posting organization.
 * This blocks pre-guard snapshots without rewriting or deleting history.
 */
export function routePackIsSafeToRead(
  state: LogLoadsDatabaseState,
  load: LoadPosting,
  pack: RoutePack
): boolean {
  return (
    loadPostingHasOwnedCoherentSources(state, load) &&
    pack.loadPostingId === load.id &&
    pack.landingId === load.pickupLandingId &&
    pack.haulRouteId === load.routeId &&
    pack.destinationId === load.dropoffMillId
  )
}

function instruction(
  source: RoutePackInstruction["source"],
  severity: RoutePackInstruction["severity"],
  title: string,
  detail: string | null | undefined,
  verifiedAt: string | null = null
): RoutePackInstruction | null {
  const text = detail?.trim()

  // An empty source field means the host never said — say nothing rather than
  // manufacture an instruction the driver would treat as operational fact.
  if (!text) {
    return null
  }

  return { detail: text, severity, source, title, verifiedAt }
}

const HAZARD_ROAD_CONDITIONS = new Set(["icy", "snow", "muddy", "restricted", "closed"])

/**
 * Resolves everything a driver needs for an accepted haul into one pack, from
 * the load, route, landing, destination, and the host's own source pack. This
 * runs once, at approval, and the result is stored — a later edit to the load
 * cannot rewrite instructions the driver already committed to.
 *
 * Missing optional details degrade honestly: an absent rich landing-detail or
 * destination-facility record contributes no instructions rather than
 * inventing them. Required organization-owned sources fail closed.
 */
export function buildAssignmentRoutePack(
  state: LogLoadsDatabaseState,
  sources: RoutePackSources,
  version = 1,
  timestamp = nowIso()
): RoutePack {
  const { assignment, load, route, slot, rate } = sources

  // Approval normally validates these before calling the builder, but accepted
  // legacy assignments and direct regeneration calls can predate that boundary.
  // Never snapshot another organization's route/rate facts or an incoherent
  // lane even when the stored posting itself is malformed.
  if (
    rate === null ||
    route.id !== load.routeId ||
    route.companyId !== load.companyId ||
    route.landingId !== load.pickupLandingId ||
    route.millId !== load.dropoffMillId ||
    rate.id !== load.rateId ||
    rate.companyId !== load.companyId
  ) {
    throw new Error("Route Pack sources are unavailable")
  }

  const landing = state.landings.find(
    (current) => current.id === load.pickupLandingId && current.companyId === load.companyId
  ) ?? null
  const matchingLandingDetails = landing
    ? state.richLandingDetails.filter(
        (current) =>
          current.landingId === landing.id &&
          current.controlledByOrganizationId === load.companyId
      )
    : []
  // The SQL mirror has a unique landing_id constraint, but legacy/corrupt
  // operating-state documents can still contain duplicates. Ambiguity is not
  // authority: omit the private briefing rather than pick whichever came first.
  const landingDetails = matchingLandingDetails.length === 1 ? matchingLandingDetails[0]! : null
  const destination = state.mills.find((current) => current.id === load.dropoffMillId) ?? null
  const facility = destination
    ? state.destinationFacilities.find((current) => current.millId === destination.id) ?? null
    : null
  const driver = state.driverProfiles.find((current) => current.id === assignment.driverProfileId) ?? null
  const driverUser = driver ? state.profiles.find((current) => current.id === driver.userId) ?? null : null
  const truck = state.truckProfiles.find((current) => current.id === assignment.truckProfileId) ?? null
  const combination = state.equipmentCombinations.find(
    (current) =>
      current.truckProfileId === assignment.truckProfileId &&
      current.assignedDriverProfileId === assignment.driverProfileId
  ) ?? null
  const host = state.organizations.find((current) => current.id === load.companyId) ?? null
  const hostCompany = state.companies.find((current) => current.id === load.companyId) ?? null
  // The host's load-level pack is the source a host maintains; its operator
  // instructions carry into every assignment snapshot taken from this load.
  const sourcePack = state.routePacks.find(
    (pack) =>
      pack.loadPostingId === load.id &&
      !pack.assignmentId &&
      routePackIsSafeToRead(state, load, pack)
  ) ?? null

  const instructions = [
    ...(sourcePack?.localInstructions ?? []),
    instruction("operator_provided", "critical", "Gate access", landingDetails?.gateInstructions, landingDetails?.lastVerifiedAt),
    instruction("operator_provided", "critical", "Private road", landingDetails?.privateRoadNotes, landingDetails?.lastVerifiedAt),
    instruction("operator_provided", "standard", "Staging", landingDetails?.stagingInstructions, landingDetails?.lastVerifiedAt),
    instruction("operator_provided", "standard", "Landing access", landing?.accessNotes),
    ...(landingDetails?.turnaroundConstraints ?? []).map((constraint) =>
      instruction("operator_provided", "standard", "Turnaround", constraint, landingDetails?.lastVerifiedAt)
    ),
    ...(landingDetails?.safetyRequirements ?? []).map((requirement) =>
      instruction("operator_provided", "critical", "Safety and PPE", requirement, landingDetails?.lastVerifiedAt)
    ),
    instruction("operator_provided", "standard", "Communication", landingDetails?.communicationInstructions, landingDetails?.lastVerifiedAt),
    instruction("facility_verified", "critical", "Check in", facility?.checkInProcess, facility?.lastVerifiedAt),
    instruction("facility_verified", "critical", "Scale and ticket", facility?.scaleProcess, facility?.lastVerifiedAt),
    instruction("facility_verified", "standard", "Unloading", facility?.unloadingInstructions, facility?.lastVerifiedAt),
    facility && facility.currentStatus !== "open"
      ? instruction("facility_verified", "critical", `Destination ${facility.currentStatus}`, facility.currentNotice ?? `The destination is ${facility.currentStatus}.`, facility.lastVerifiedAt)
      : null,
    // Completion evidence is deliberately NOT an instruction: it has its own
    // section in the pack, and listing it twice makes a driver scanning at the
    // landing read the same requirement over again. It still travels in the
    // snapshot, so a change to it is still a material change.
    HAZARD_ROAD_CONDITIONS.has(route.roadCondition)
      ? instruction("calculated_route", "critical", "Road condition", `The route is reported ${route.roadCondition.replaceAll("_", " ")}.`)
      : null,
    instruction("calculated_route", "standard", "Route notes", route.roadNotes),
    instruction("operator_provided", "standard", "Weather", load.weatherNotes ?? route.weatherNotes)
  ].filter((entry): entry is RoutePackInstruction => entry !== null)

  // Legacy stored postings may carry a dispatcher id from another organization.
  // Never copy that profile's contact into an assignment-gated Route Pack.
  const dispatcher = resolveOwnedDispatcher(state, load)

  const snapshot: RoutePackSnapshot = {
    capturedAt: timestamp,
    completionEvidence: facility?.completionEvidence ?? [],
    contactEmail: dispatcher?.contact.email ?? null,
    contactName: dispatcher?.contact.name ?? null,
    contactPhone: dispatcher?.contact.phone ?? null,
    destinationName: destination?.name ?? "Destination on file",
    destinationReceivingHours: facility?.receivingHours ?? null,
    driverName: driverUser?.fullName ?? "Assigned driver",
    driverPhone: driverUser?.phone ?? null,
    equipmentLabel: combination?.label ?? null,
    equipmentRequirements: load.equipmentRequirements ?? [],
    equipmentUnitNumber: truck?.unitNumber ?? null,
    estimatedTonsPerLoad: load.estimatedTonsPerLoad ?? null,
    haulWindowEndAt: slot?.endAt ?? null,
    haulWindowStartAt: slot?.startAt ?? null,
    hostOrganizationName: host?.displayName ?? hostCompany?.displayName ?? "Host organization",
    hostVerificationStatus: host?.verificationStatus ?? hostCompany?.verificationStatus ?? null,
    materialType: load.loadType ?? null,
    originArea: landingDetails?.publicApproximateArea ?? (landing ? `${landing.city}, ${landing.state}` : null),
    // The exact entrance is the operational pin, not the public area. It rides
    // in the pack because the pack itself only unlocks for the assigned driver.
    originEntranceLat: landingDetails?.entranceLat ?? landing?.coordinates?.lat ?? null,
    originEntranceLng: landingDetails?.entranceLng ?? landing?.coordinates?.lng ?? null,
    originName: landing?.name ?? "Landing on file",
    rateSummary: `${(rate.baseRate.amountCents / 100).toFixed(2)} ${rate.baseRate.currency} ${rate.rateType.replaceAll("_", " ")}`,
    routeDistanceMiles: route.estimatedDistanceMiles,
    routeRunTimeMinutes: route.estimatedRunTimeMinutes
  }

  return routePackSchema.parse({
    assignmentId: assignment.id,
    // Nothing serves these packs offline yet; claiming otherwise would strand a
    // driver who trusted it in a dead zone.
    cacheableOffline: false,
    calculatedRouteSummary: sourcePack?.calculatedRouteSummary ??
      `${landing?.name ?? "Landing"} to ${destination?.name ?? "destination"} — ${route.routeName}, ${route.estimatedDistanceMiles.toFixed(0)} mi, about ${route.estimatedRunTimeMinutes} min.`,
    createdAt: timestamp,
    currentRoadCondition: route.roadCondition,
    destinationId: load.dropoffMillId,
    haulRouteId: route.id,
    id: createUuid(),
    landingId: load.pickupLandingId,
    lastVerifiedAt: timestamp,
    loadPostingId: load.id,
    localInstructions: instructions,
    snapshot,
    supersededAt: null,
    updatedAt: timestamp,
    version,
    visibility: "assigned_only"
  })
}

/**
 * The live (non-superseded) pack for an assignment, newest version first.
 * Returns undefined rather than null so it composes with assertFound, which
 * only guards undefined — a null would sail straight through it.
 */
export function findAssignmentRoutePack(
  state: LogLoadsDatabaseState,
  assignmentId: string
): RoutePack | undefined {
  return state.routePacks
    .filter((pack) => pack.assignmentId === assignmentId && !pack.supersededAt)
    .sort((left, right) => right.version - left.version)[0]
}

export function listAssignmentRoutePackVersions(
  state: LogLoadsDatabaseState,
  assignmentId: string
): RoutePack[] {
  return state.routePacks
    .filter((pack) => pack.assignmentId === assignmentId)
    .sort((left, right) => left.version - right.version)
}

/**
 * Re-resolves the pack from current sources and, when the operational content
 * actually changed, supersedes the old version with a new one. The prior
 * version is kept: it is the record of what governed the haul until now.
 *
 * Returns null when nothing material changed, so a host saving an unrelated
 * edit does not bump the version or alarm the driver over noise.
 *
 * `previous` is null when the assignment had no snapshot at all — a haul booked
 * before packs were minted per assignment. That is a backfill, not a change:
 * the driver was already reading these instructions from the load-level source,
 * so v1 pins them rather than announcing news.
 */
export function regenerateAssignmentRoutePack(
  state: LogLoadsDatabaseState,
  sources: RoutePackSources,
  timestamp = nowIso()
): { pack: RoutePack; previous: RoutePack | null } | null {
  const current = findAssignmentRoutePack(state, sources.assignment.id)

  if (!current) {
    const first = buildAssignmentRoutePack(state, sources, 1, timestamp)

    state.routePacks.push(first)

    return { pack: first, previous: null }
  }

  const candidate = buildAssignmentRoutePack(state, sources, current.version + 1, timestamp)

  if (!isMaterialChange(current, candidate)) {
    return null
  }

  state.routePacks = state.routePacks.map((pack) =>
    pack.id === current.id ? { ...pack, supersededAt: timestamp, updatedAt: timestamp } : pack
  )
  state.routePacks.push(candidate)

  return { pack: candidate, previous: current }
}

/**
 * Material means operationally material: the instructions, the route summary,
 * the road condition, or the snapshot facts a driver acts on. Timestamps and
 * ids move on every regeneration and must not count.
 */
export function isMaterialChange(current: RoutePack, candidate: RoutePack): boolean {
  const comparable = (pack: RoutePack) =>
    JSON.stringify({
      calculatedRouteSummary: pack.calculatedRouteSummary,
      currentRoadCondition: pack.currentRoadCondition,
      instructions: pack.localInstructions.map((entry) => ({
        detail: entry.detail,
        severity: entry.severity,
        source: entry.source,
        title: entry.title
      })),
      snapshot: pack.snapshot ? { ...pack.snapshot, capturedAt: null } : null
    })

  return comparable(current) !== comparable(candidate)
}
