import {
  evaluateLoadCompatibility,
  explainCompatibility,
  formatRateLabel,
  recommendLoad,
  reputationLabel,
  summarizeReviews,
  type AssignmentStatus,
  type LoadStatus,
  type MatchEligibility,
  type OpportunityVisibilityMode,
  type RecommendationBand,
  type RecommendationVisibility,
  type ReputationBand,
  type RoadCondition,
  type TripStatusV2
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { createLogLoadsServices } from "@logloads/services"

export type OrgReputationView = {
  label: string
  band: ReputationBand
  avgRating: number | null
  ratingCount: number
} | null

/** An organization's public reputation aggregate, or null when it has none yet. */
function organizationReputation(state: LogLoadsDatabaseState, organizationId: string): OrgReputationView {
  const reviews = state.tripReviews.filter((review) => review.subjectOrganizationId === organizationId)

  if (reviews.length === 0) {
    return null
  }

  const summary = summarizeReviews(reviews)
  return { avgRating: summary.avgRating, band: summary.band, label: reputationLabel(summary), ratingCount: summary.ratedCount }
}

/** Reliability signal for the recommendation engine: a host org's on-time/rating. */
function counterpartReliabilitySignal(
  state: LogLoadsDatabaseState,
  organizationId: string
): { onTimeRate: number | null; avgRating: number | null; ratedTrips: number } | null {
  const reviews = state.tripReviews.filter((review) => review.subjectOrganizationId === organizationId)

  if (reviews.length === 0) {
    return null
  }

  const summary = summarizeReviews(reviews)
  const onTime = reviews.filter((review) => review.tags.includes("on_time")).length
  const late = reviews.filter((review) => review.tags.includes("late")).length
  const timed = onTime + late

  return { avgRating: summary.avgRating, onTimeRate: timed === 0 ? null : onTime / timed, ratedTrips: summary.ratedCount }
}

/** A driver's reputation aggregate (reviews naming this driver profile as subject). */
function driverReputation(state: LogLoadsDatabaseState, driverProfileId: string): OrgReputationView {
  const reviews = state.tripReviews.filter((review) => review.subjectDriverProfileId === driverProfileId)

  if (reviews.length === 0) {
    return null
  }

  const summary = summarizeReviews(reviews)
  return { avgRating: summary.avgRating, band: summary.band, label: reputationLabel(summary), ratingCount: summary.ratedCount }
}

export type NetworkViewer =
  | { kind: "actor"; actorUserId: string; organizationId?: string | null }
  | { kind: "public" }

export interface NetworkPoint {
  id: string
  name: string
  city: string
  state: string
  lat: number
  lng: number
  approximate: boolean
  accessNotes: string | null
  roadCondition: RoadCondition
  freshness: "verified" | "recent" | "stale"
}

export interface LoadAccess {
  unlocked: boolean
  reason: "owner" | "assigned" | "locked"
}

export interface NetworkLoadView {
  id: string
  reference: string
  title: string
  sourceName: string
  sourceOrganizationId: string
  sourceReputation: OrgReputationView
  status: LoadStatus
  visibilityMode: OpportunityVisibilityMode
  allocationMode: string
  loadType: string
  scheduleLabel: string
  access: LoadAccess
  landing: NetworkPoint
  destination: NetworkPoint
  landingDetails: {
    publicApproximateArea: string
    exactLocationVisibility: string
    privateRoadNotes: string | null
    gateInstructions: string | null
    loadingEquipment: string[]
    turnaroundConstraints: string[]
    lastVerifiedAt: string
  } | null
  destinationFacility: {
    receivingHours: string
    checkInProcess: string
    scaleProcess: string
    unloadingInstructions: string
    currentStatus: string
    currentNotice: string | null
    lastVerifiedAt: string
  } | null
  route: {
    id: string
    name: string
    distanceMiles: number
    runTimeMinutes: number
    condition: RoadCondition
    localNotes: string
    weatherNotes: string | null
  }
  routePack: {
    id: string
    visibility: string
    cacheableOffline: boolean
    calculatedRouteSummary: string
    currentRoadCondition: RoadCondition
    lastVerifiedAt: string
    instructions: Array<{
      title: string
      detail: string
      severity: string
      source: string
      verifiedAt: string | null
    }>
  } | null
  payLabel: string
  fuelSurchargeLabel: string
  tonsLabel: string
  equipment: string[]
  accessRequirements: string[]
  capacity: {
    total: number
    committed: number
    completed: number
    remaining: number
  }
  slots: {
    total: number
    reserved: number
    open: number
    nextWindow: string
    requestableSlotId: string | null
  }
  compatibility: {
    eligibility: MatchEligibility
    summary: string
    positives: string[]
    cautions: string[]
    failures: string[]
  } | null
  recommendation: {
    band: RecommendationBand
    label: string
    reasons: string[]
  } | null
  warnings: string[]
  criticalInstructions: string[]
  assignments: Array<{
    id: string
    status: AssignmentStatus
    driverName: string
    truckUnit: string
    driverProfileId: string
    requestedByOrganizationId: string | null
  }>
  viewerAssignment: {
    id: string
    status: AssignmentStatus
  } | null
}

export interface TruckView {
  id: string
  unitNumber: string
  driverName: string
  driverProfileId: string | null
  configuration: string
  status: string
  payload: string
  region: string
  matchCount: number
  verification: string
  reputation: OrgReputationView
}

export interface NoticeView {
  id: string
  severity: "info" | "watch" | "critical"
  title: string
  body: string
  relatedLoadId?: string | null
}

export interface NetworkView {
  activeOrganization: {
    id: string
    name: string
    role: string
    type: string
    verificationStatus: string
    reputation: OrgReputationView
  }
  currentDriver: {
    id: string
    name: string
    truckId: string | null
    trailerId: string | null
  } | null
  currentEquipment: {
    combinationId: string
    label: string
    truckId: string
    trailerId: string | null
  } | null
  loads: NetworkLoadView[]
  topRecommendations: Array<{
    loadId: string
    title: string
    lane: string
    band: RecommendationBand
    label: string
    reasons: string[]
    payLabel: string
    scheduleLabel: string
    requestable: boolean
  }>
  trucks: TruckView[]
  privateNetwork: Array<{
    id: string
    partnerName: string
    partnerOrganizationId: string
    status: string
    scope: string
    preferred: boolean
    notes: string | null
  }>
  trips: Array<{
    id: string
    loadPostingId: string
    assignmentId: string
    loadTitle: string
    driverName: string
    driverProfileId: string
    status: TripStatusV2
    locationVisibility: string
    routePackId: string | null
    lastSyncedAt: string | null
    completedAt: string | null
    reviewable: {
      direction: "host_rates_hauler" | "hauler_rates_host"
      counterpartyName: string
      alreadyReviewed: boolean
    } | null
    events: Array<{ id: string; type: string; note: string | null; occurredAt: string; source: string }>
    documents: Array<{ id: string; type: string; filename: string; processingStatus: string }>
  }>
  entitlements: Array<{
    id: string
    product: string
    status: string
    features: string[]
    limitLabel: string
    currentPeriodEndsAt: string | null
  }>
  futureAvailability: Array<{
    id: string
    equipmentLabel: string
    status: string
    windowLabel: string
    notes: string | null
  }>
  notices: NoticeView[]
  metrics: {
    openLoads: number
    trucksAvailable: number
    activeAssignments: number
    criticalNotices: number
  }
  messages: Array<{
    id: string
    subject: string
    contextLabel: string
    lastMessage: string
    lastMessageAt: string | null
  }>
  auditEvents: Array<{
    id: string
    action: string
    entityType: string
    createdAt: string
  }>
}

const ACTIVE_ASSIGNMENT_STATUSES = ["requested", "offered", "accepted", "checked_in", "loading", "hauled"]

function requireRecord<T>(value: T | undefined | null, label: string): T {
  if (!value) {
    throw new Error(`Data integrity error: ${label}`)
  }

  return value
}

function publicReference(id: string): string {
  return `LL-${id.slice(0, 4).toUpperCase()}${id.slice(-4).toUpperCase()}`
}

function formatDateRange(load: { loadDate?: string | null; campaignStartDate?: string | null; campaignEndDate?: string | null }): string {
  if (load.loadDate) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${load.loadDate}T12:00:00.000Z`))
  }

  if (load.campaignStartDate && load.campaignEndDate) {
    const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })
    return `${formatter.format(new Date(`${load.campaignStartDate}T12:00:00.000Z`))} - ${formatter.format(new Date(`${load.campaignEndDate}T12:00:00.000Z`))}`
  }

  return "Window pending"
}

function formatSlotWindow(startAt: string, endAt: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC"
  })

  return `${formatter.format(new Date(startAt))} - ${formatter.format(new Date(endAt))}`
}

function formatWindow(startAt: string, endAt: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC"
  })

  return `${formatter.format(new Date(startAt))} - ${formatter.format(new Date(endAt))}`
}

function approximateCoordinate(value: number): number {
  return Math.round(value * 50) / 50
}

function pointFromSite(
  site: {
    id: string
    name: string
    city: string
    state: string
    coordinates: { lat: number; lng: number }
    accessNotes?: string | null
    roadCondition?: RoadCondition | null
  },
  exact: boolean
): NetworkPoint {
  return {
    accessNotes: exact ? site.accessNotes ?? null : null,
    approximate: !exact,
    city: site.city,
    freshness: (site.roadCondition ?? "good") === "good" ? "verified" : "recent",
    id: site.id,
    lat: exact ? site.coordinates.lat : approximateCoordinate(site.coordinates.lat),
    lng: exact ? site.coordinates.lng : approximateCoordinate(site.coordinates.lng),
    name: site.name,
    roadCondition: site.roadCondition ?? "good",
    state: site.state
  }
}

function daysUntil(dateOnly: string | null | undefined): number | null {
  if (!dateOnly) {
    return null
  }

  const target = new Date(`${dateOnly}T12:00:00.000Z`).getTime()

  if (Number.isNaN(target)) {
    return null
  }

  return Math.round((target - Date.now()) / (24 * 60 * 60 * 1000))
}

function warningForRoad(condition: RoadCondition): string | null {
  if (condition === "good") {
    return null
  }

  if (condition === "closed") {
    return "Closed road: do not dispatch until the operator updates access."
  }

  return `Road condition ${condition}: verify local access instructions before moving.`
}

export function buildNetworkView(state: LogLoadsDatabaseState, viewer: NetworkViewer): NetworkView {
  const services = createLogLoadsServices(state)

  // --- Resolve the viewer -------------------------------------------------
  const actorUserId = viewer.kind === "actor" ? viewer.actorUserId : null
  const currentUser = actorUserId
    ? requireRecord(state.profiles.find((profile) => profile.id === actorUserId), "current user")
    : null

  const memberships = actorUserId
    ? state.organizationMemberships.filter((membership) => membership.userId === actorUserId && membership.status === "active")
    : []
  const requestedOrganizationId = viewer.kind === "actor" ? viewer.organizationId ?? null : null
  const activeMembership = (requestedOrganizationId
    ? memberships.find((membership) => membership.organizationId === requestedOrganizationId)
    : undefined) ?? memberships[0] ?? null
  const activeOrganization = activeMembership
    ? requireRecord(
        state.organizations.find((organization) => organization.id === activeMembership.organizationId),
        "active organization"
      )
    : null

  const currentDriverProfile = actorUserId
    ? state.driverProfiles.find((driver) => driver.userId === actorUserId) ?? null
    : null

  const organizationCombinations = activeOrganization
    ? state.equipmentCombinations.filter((combination) => combination.organizationId === activeOrganization.id)
    : []
  const currentCombination = currentDriverProfile
    ? organizationCombinations.find((combination) => combination.assignedDriverProfileId === currentDriverProfile.id) ??
      state.equipmentCombinations.find((combination) => combination.assignedDriverProfileId === currentDriverProfile.id) ??
      null
    : null
  const currentTruck = currentCombination
    ? state.truckProfiles.find((truck) => truck.id === currentCombination.truckProfileId) ?? null
    : null
  const currentTrailer = currentCombination?.trailerProfileId
    ? state.trailerProfiles.find((trailer) => trailer.id === currentCombination.trailerProfileId) ?? null
    : null
  const availabilityWindows = currentDriverProfile
    ? state.availabilityWindows.filter((window) => window.driverProfileId === currentDriverProfile.id)
    : []

  const organizationDriverProfileIds = new Set(
    activeOrganization
      ? state.driverProfiles
          .filter((driver) => driver.companyId === activeOrganization.id ||
            organizationCombinations.some((combination) => combination.assignedDriverProfileId === driver.id) ||
            state.organizationMemberships.some((membership) =>
              membership.organizationId === activeOrganization.id &&
              membership.status === "active" &&
              membership.userId === driver.userId
            ))
          .map((driver) => driver.id)
      : []
  )

  // --- Which loads can this viewer see ------------------------------------
  // A signed-in actor without an active organization (e.g. a platform admin, or a
  // user mid-onboarding) sees the public network rather than crashing.
  const visibleLoadRecords = viewer.kind === "public" || !activeOrganization
    ? state.loadPostings.filter((load) => {
        const capacity = state.opportunityCapacities.find((item) => item.loadPostingId === load.id)
        const visibilityMode = capacity?.visibilityMode ?? "open_network"

        return ["open_network", "verified_network"].includes(visibilityMode) && ["open", "scheduled"].includes(load.status)
      })
    : services.listVisibleLoadsForOrganization(activeOrganization.id)

  const loadsWithScore = visibleLoadRecords.map((load) => {
    const source = requireRecord(state.companies.find((company) => company.id === load.companyId), `company ${load.companyId}`)
    const landing = requireRecord(state.landings.find((item) => item.id === load.pickupLandingId), `landing ${load.pickupLandingId}`)
    const landingDetails = state.richLandingDetails.find((item) => item.landingId === landing.id) ?? null
    const destination = requireRecord(state.mills.find((item) => item.id === load.dropoffMillId), `destination ${load.dropoffMillId}`)
    const destinationFacility = state.destinationFacilities.find((item) => item.millId === destination.id) ?? null
    const route = requireRecord(state.haulRoutes.find((item) => item.id === load.routeId), `route ${load.routeId}`)
    const routePack = state.routePacks.find((item) => item.loadPostingId === load.id) ?? null
    const rate = requireRecord(state.rates.find((item) => item.id === load.rateId), `rate ${load.rateId}`)
    const capacity = state.opportunityCapacities.find((item) => item.loadPostingId === load.id) ?? null
    const slots = state.truckSlots.filter((slot) => slot.loadPostingId === load.id)
    const loadAssignments = state.assignments.filter((assignment) => assignment.loadPostingId === load.id)

    // --- Access: sensitive operational detail unlocks for the publishing
    // organization and for actively assigned haulers only. -----------------
    const ownsLoad = Boolean(activeOrganization && load.companyId === activeOrganization.id)
    const viewerActiveAssignment = loadAssignments.find((assignment) =>
      ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status) &&
      (
        (currentDriverProfile && assignment.driverProfileId === currentDriverProfile.id) ||
        (!currentDriverProfile && organizationDriverProfileIds.has(assignment.driverProfileId))
      )
    ) ?? null
    const unlocked = ownsLoad || Boolean(viewerActiveAssignment)
    const access: LoadAccess = {
      reason: ownsLoad ? "owner" : viewerActiveAssignment ? "assigned" : "locked",
      unlocked
    }

    const viewerHasActiveAssignment = Boolean(
      currentDriverProfile &&
      loadAssignments.some((assignment) =>
        assignment.driverProfileId === currentDriverProfile.id &&
        ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)
      )
    )
    const requestableSlot = viewerHasActiveAssignment || viewer.kind === "public"
      ? null
      : slots.find((slot) => ["open", "requested"].includes(slot.status) && slot.reservedCount < slot.capacity) ?? null

    const compatibility = currentTruck
      ? evaluateLoadCompatibility({
          availabilityWindows,
          load,
          route,
          trailer: currentTrailer,
          truck: currentTruck
        })
      : null

    const capacityRemaining = capacity?.remainingTruckloads ??
      slots.reduce((sum, slot) => sum + Math.max(0, slot.capacity - slot.reservedCount), 0)
    const recommendation = compatibility && !ownsLoad
      ? recommendLoad({
          compatibility,
          counterpartReliability: counterpartReliabilitySignal(state, load.companyId),
          daysUntilSchedule: daysUntil(load.loadDate ?? load.campaignStartDate),
          distanceMiles: route.estimatedDistanceMiles,
          freshness: (landing.roadCondition ?? "good") === "good" ? "verified" : "recent",
          isRequestable: Boolean(requestableSlot),
          remainingCapacity: capacityRemaining,
          visibility: (capacity?.visibilityMode ?? "open_network") as RecommendationVisibility
        })
      : null

    const assignmentViews = (ownsLoad
      ? loadAssignments
      : loadAssignments.filter((assignment) =>
          (currentDriverProfile && assignment.driverProfileId === currentDriverProfile.id) ||
          organizationDriverProfileIds.has(assignment.driverProfileId)
        )
    ).map((assignment) => {
      const driver = requireRecord(
        state.driverProfiles.find((profile) => profile.id === assignment.driverProfileId),
        `driver ${assignment.driverProfileId}`
      )
      const user = requireRecord(state.profiles.find((profile) => profile.id === driver.userId), `user ${driver.userId}`)
      const truck = state.truckProfiles.find((item) => item.id === assignment.truckProfileId)

      return {
        driverName: user.fullName,
        driverProfileId: driver.id,
        id: assignment.id,
        requestedByOrganizationId: driver.companyId ?? null,
        status: assignment.status,
        truckUnit: truck?.unitNumber ?? "Unassigned"
      }
    })

    const roadWarning = warningForRoad(load.roadCondition)
    const routeWarning = warningForRoad(route.roadCondition)
    const weatherWarning = load.weatherNotes ? `Weather: ${load.weatherNotes}` : null
    const facilityWarning = destinationFacility?.currentNotice ? `Receiving: ${destinationFacility.currentNotice}` : null

    const view: NetworkLoadView = {
      access,
      accessRequirements: load.accessRequirements,
      allocationMode: capacity?.allocationMode ?? "request_approval",
      assignments: assignmentViews,
      capacity: {
        committed: capacity?.committedTruckloads ?? slots.reduce((sum, slot) => sum + slot.reservedCount, 0),
        completed: capacity?.completedTruckloads ?? 0,
        remaining: capacity?.remainingTruckloads ?? slots.reduce((sum, slot) => sum + Math.max(0, slot.capacity - slot.reservedCount), 0),
        total: capacity?.totalTruckloads ?? slots.reduce((sum, slot) => sum + slot.capacity, 0)
      },
      compatibility: compatibility
        ? {
            cautions: compatibility.cautions,
            eligibility: compatibility.eligibility,
            failures: compatibility.hardFailures,
            positives: compatibility.positiveSignals,
            summary: explainCompatibility(compatibility)
          }
        : null,
      recommendation: recommendation
        ? { band: recommendation.band, label: recommendation.label, reasons: recommendation.reasons }
        : null,
      criticalInstructions: unlocked
        ? [
            landingDetails?.gateInstructions ? `Gate: ${landingDetails.gateInstructions}` : null,
            landingDetails?.privateRoadNotes ? `Landing access: ${landingDetails.privateRoadNotes}` : landing.accessNotes ? `Landing: ${landing.accessNotes}` : null,
            destinationFacility?.checkInProcess ? `Destination check-in: ${destinationFacility.checkInProcess}` : destination.accessNotes ? `Destination: ${destination.accessNotes}` : null,
            routePack?.calculatedRouteSummary ? `Route pack: ${routePack.calculatedRouteSummary}` : route.roadNotes ? `Local route: ${route.roadNotes}` : null
          ].filter((value): value is string => Boolean(value))
        : [],
      destination: pointFromSite(destination, unlocked),
      destinationFacility: destinationFacility && unlocked
        ? {
            checkInProcess: destinationFacility.checkInProcess,
            currentNotice: destinationFacility.currentNotice ?? null,
            currentStatus: destinationFacility.currentStatus,
            lastVerifiedAt: destinationFacility.lastVerifiedAt,
            receivingHours: destinationFacility.receivingHours,
            scaleProcess: destinationFacility.scaleProcess,
            unloadingInstructions: destinationFacility.unloadingInstructions
          }
        : null,
      equipment: load.equipmentRequirements,
      fuelSurchargeLabel: rate.fuelSurchargeCents > 0
        ? `+ ${formatRateLabel({ amountCents: rate.fuelSurchargeCents, currency: "USD" }, "flat_rate")} fuel`
        : "Fuel included in terms",
      id: load.id,
      landing: pointFromSite(landing, unlocked),
      landingDetails: landingDetails
        ? {
            exactLocationVisibility: landingDetails.exactLocationVisibility,
            gateInstructions: unlocked ? landingDetails.gateInstructions ?? null : null,
            lastVerifiedAt: landingDetails.lastVerifiedAt,
            loadingEquipment: landingDetails.loadingEquipment,
            privateRoadNotes: unlocked ? landingDetails.privateRoadNotes ?? null : null,
            publicApproximateArea: landingDetails.publicApproximateArea,
            turnaroundConstraints: landingDetails.turnaroundConstraints
          }
        : null,
      loadType: load.loadType.replaceAll("_", " "),
      payLabel: formatRateLabel(rate.baseRate, rate.rateType),
      reference: publicReference(load.id),
      route: {
        condition: route.roadCondition,
        distanceMiles: route.estimatedDistanceMiles,
        id: route.id,
        localNotes: unlocked ? route.roadNotes ?? "No operator route note has been added." : "Route notes unlock after assignment.",
        name: route.routeName,
        runTimeMinutes: route.estimatedRunTimeMinutes,
        weatherNotes: route.weatherNotes ?? null
      },
      routePack: routePack && unlocked
        ? {
            cacheableOffline: routePack.cacheableOffline,
            calculatedRouteSummary: routePack.calculatedRouteSummary,
            currentRoadCondition: routePack.currentRoadCondition,
            id: routePack.id,
            instructions: routePack.localInstructions.map((instruction) => ({
              detail: instruction.detail,
              severity: instruction.severity,
              source: instruction.source,
              title: instruction.title,
              verifiedAt: instruction.verifiedAt ?? null
            })),
            lastVerifiedAt: routePack.lastVerifiedAt,
            visibility: routePack.visibility
          }
        : null,
      scheduleLabel: formatDateRange(load),
      slots: {
        nextWindow: requestableSlot ? formatSlotWindow(requestableSlot.startAt, requestableSlot.endAt) : "No open slot",
        open: slots.reduce((sum, slot) => sum + Math.max(0, slot.capacity - slot.reservedCount), 0),
        requestableSlotId: requestableSlot?.id ?? null,
        reserved: slots.reduce((sum, slot) => sum + slot.reservedCount, 0),
        total: slots.reduce((sum, slot) => sum + slot.capacity, 0)
      },
      sourceName: source.displayName,
      sourceOrganizationId: source.id,
      sourceReputation: organizationReputation(state, source.id),
      status: load.status,
      title: load.title,
      tonsLabel: load.estimatedTonsPerLoad ? `${load.estimatedTonsPerLoad} tons expected` : "Weight pending",
      // The viewer's own commitment is reported even on own-org loads so the
      // driver request panel shows "Assigned to you" instead of a request CTA
      // the service would reject.
      viewerAssignment: viewerActiveAssignment
        ? { id: viewerActiveAssignment.id, status: viewerActiveAssignment.status }
        : null,
      visibilityMode: capacity?.visibilityMode ?? "open_network",
      warnings: [roadWarning, routeWarning, weatherWarning, facilityWarning].filter((value): value is string => Boolean(value))
    }

    return { recommendationSortKey: recommendation?.sortKey ?? -1000, score: compatibility?.score ?? 0, view }
  })

  const statusWeight: Record<LoadStatus, number> = {
    archived: 6,
    cancelled: 5,
    completed: 4,
    draft: 3,
    filled: 2,
    in_transit: 1,
    open: 0,
    scheduled: 1
  }

  const loads = loadsWithScore
    .sort((left, right) =>
      statusWeight[left.view.status] - statusWeight[right.view.status] || right.score - left.score
    )
    .map((entry) => entry.view)

  // Ranked "Recommended for you": genuinely requestable, well-fitting live loads,
  // best first. Ineligible/filled/locked loads are excluded.
  const topRecommendations = loadsWithScore
    .flatMap((entry) => {
      const recommendation = entry.view.recommendation

      if (
        !recommendation ||
        recommendation.band === "not_recommended" ||
        !["open", "scheduled"].includes(entry.view.status) ||
        entry.view.slots.requestableSlotId === null ||
        entry.view.viewerAssignment
      ) {
        return []
      }

      return [{ entry, recommendation }]
    })
    .sort((left, right) => right.entry.recommendationSortKey - left.entry.recommendationSortKey)
    .slice(0, 5)
    .map(({ entry, recommendation }) => ({
      band: recommendation.band,
      label: recommendation.label,
      lane: `${entry.view.landing.city} to ${entry.view.destination.name}`,
      loadId: entry.view.id,
      payLabel: entry.view.payLabel,
      reasons: recommendation.reasons,
      requestable: entry.view.slots.requestableSlotId !== null,
      scheduleLabel: entry.view.scheduleLabel,
      title: entry.view.title
    }))

  // --- Public viewers stop here with a redacted, aggregate-only view -------
  if (viewer.kind === "public" || !activeOrganization || !activeMembership || !currentUser) {
    return {
      activeOrganization: { id: "public", name: "LogLoads", reputation: null, role: "visitor", type: "public", verificationStatus: "pending" },
      auditEvents: [],
      currentDriver: null,
      currentEquipment: null,
      entitlements: [],
      futureAvailability: [],
      loads,
      messages: [],
      metrics: {
        activeAssignments: 0,
        criticalNotices: 0,
        openLoads: loads.filter((load) => load.status === "open").length,
        trucksAvailable: state.equipmentCombinations.filter((combination) => combination.status === "available").length
      },
      notices: [],
      privateNetwork: [],
      topRecommendations: [],
      trips: [],
      trucks: []
    }
  }

  // --- Organization-scoped operational data --------------------------------
  const trucks = organizationCombinations.map((combination): TruckView => {
    const truck = requireRecord(state.truckProfiles.find((item) => item.id === combination.truckProfileId), `truck ${combination.truckProfileId}`)
    const driver = combination.assignedDriverProfileId
      ? state.driverProfiles.find((profile) => profile.id === combination.assignedDriverProfileId)
      : undefined
    const user = state.profiles.find((profile) => profile.id === driver?.userId)
    const availability = state.futureAvailability.find((window) => window.equipmentCombinationId === combination.id)
    const trailer = combination.trailerProfileId
      ? state.trailerProfiles.find((item) => item.id === combination.trailerProfileId) ?? null
      : null
    const matchCount = loads.filter((load) => {
      const original = state.loadPostings.find((item) => item.id === load.id)
      const route = original ? state.haulRoutes.find((item) => item.id === original.routeId) : undefined

      if (!original) {
        return false
      }

      return evaluateLoadCompatibility({
        availabilityWindows: driver ? state.availabilityWindows.filter((window) => window.driverProfileId === driver.id) : [],
        load: original,
        route,
        trailer,
        truck
      }).eligibility !== "ineligible"
    }).length
    const verification = state.verificationRecords.find((record) => record.subjectId === combination.id)?.status ?? "pending"

    return {
      configuration: `${combination.truckTypes.join(", ").replaceAll("_", " ")} / ${combination.trailerTypes.join(", ").replaceAll("_", " ") || "standard"}`,
      driverName: user?.fullName ?? "Unassigned",
      driverProfileId: driver?.id ?? null,
      id: combination.id,
      matchCount,
      payload: `${combination.maxPayloadTons} tons`,
      region: combination.homeRegion,
      reputation: driver ? driverReputation(state, driver.id) : null,
      status: availability?.status ?? combination.status,
      unitNumber: combination.label,
      verification
    }
  })

  const notices: NoticeView[] = services.listAttentionItems(activeOrganization.id)

  const messages = services.listThreadsForUser(currentUser.id).map((thread) => ({
    contextLabel: thread.contextLabel,
    id: thread.id,
    lastMessage: thread.lastMessage?.body ?? "No messages yet.",
    lastMessageAt: thread.lastMessage?.at ?? null,
    subject: thread.subject
  }))

  const privateNetwork = services.listPrivateNetworkRelationships(activeOrganization.id).map((relationship) => {
    const partnerId = relationship.ownerOrganizationId === activeOrganization.id
      ? relationship.partnerOrganizationId
      : relationship.ownerOrganizationId
    const partner = requireRecord(state.organizations.find((organization) => organization.id === partnerId), `partner ${partnerId}`)

    return {
      id: relationship.id,
      notes: relationship.notes ?? null,
      partnerName: partner.displayName,
      partnerOrganizationId: partner.id,
      preferred: relationship.preferred,
      scope: relationship.visibilityScope.replaceAll("_", " "),
      status: relationship.status
    }
  })

  const organizationLoadIds = new Set(
    state.loadPostings.filter((load) => load.companyId === activeOrganization.id).map((load) => load.id)
  )

  const trips = state.tripsV2
    .filter((trip) => {
      if (currentDriverProfile && trip.driverProfileId === currentDriverProfile.id) {
        return true
      }

      if (organizationLoadIds.has(trip.loadPostingId)) {
        return true
      }

      return organizationDriverProfileIds.has(trip.driverProfileId)
    })
    .map((trip) => {
      const load = requireRecord(state.loadPostings.find((item) => item.id === trip.loadPostingId), `trip load ${trip.loadPostingId}`)
      const driver = state.driverProfiles.find((profile) => profile.id === trip.driverProfileId)
      const driverUser = driver ? state.profiles.find((profile) => profile.id === driver.userId) : undefined
      const events = state.tripEvents
        .filter((event) => event.tripId === trip.id)
        .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
        .map((event) => ({
          id: event.id,
          note: event.note ?? null,
          occurredAt: event.occurredAt,
          source: event.source,
          type: event.type.replaceAll("_", " ")
        }))
      const documents = state.tripDocuments
        .filter((document) => document.tripId === trip.id)
        .map((document) => ({
          filename: document.filename,
          id: document.id,
          processingStatus: document.processingStatus,
          type: document.type.replaceAll("_", " ")
        }))

      // A completed cross-org haul opens a review prompt for the viewer's side.
      // The counterparty (who they'd rate) and whether they've already rated come
      // straight from state so the UI shows the right prompt or a "Reviewed" mark.
      const hostOrgId = load.companyId
      const haulerOrgId = driver?.companyId ?? null
      let reviewable: {
        direction: "host_rates_hauler" | "hauler_rates_host"
        counterpartyName: string
        alreadyReviewed: boolean
      } | null = null

      if (trip.status === "completed" && haulerOrgId && hostOrgId !== haulerOrgId) {
        if (activeOrganization.id === hostOrgId) {
          reviewable = {
            alreadyReviewed: state.tripReviews.some((r) => r.tripId === trip.id && r.direction === "host_rates_hauler"),
            counterpartyName: state.organizations.find((o) => o.id === haulerOrgId)?.displayName ?? "the hauler",
            direction: "host_rates_hauler"
          }
        } else if (activeOrganization.id === haulerOrgId) {
          reviewable = {
            alreadyReviewed: state.tripReviews.some((r) => r.tripId === trip.id && r.direction === "hauler_rates_host"),
            counterpartyName: state.organizations.find((o) => o.id === hostOrgId)?.displayName ?? "the host",
            direction: "hauler_rates_host"
          }
        }
      }

      return {
        assignmentId: trip.assignmentId,
        completedAt: trip.completedAt ?? null,
        documents,
        driverName: driverUser?.fullName ?? "Driver",
        driverProfileId: trip.driverProfileId,
        events,
        id: trip.id,
        lastSyncedAt: trip.lastSyncedAt ?? null,
        loadPostingId: trip.loadPostingId,
        loadTitle: load.title,
        locationVisibility: trip.locationVisibility.replaceAll("_", " "),
        reviewable,
        routePackId: trip.routePackId ?? null,
        status: trip.status
      }
    })

  const entitlements = services.listEntitlements(activeOrganization.id).map((entitlement) => ({
    currentPeriodEndsAt: entitlement.currentPeriodEndsAt ?? null,
    features: entitlement.features,
    id: entitlement.id,
    limitLabel: entitlement.activeTruckLimit
      ? `${entitlement.activeTruckLimit} active trucks`
      : entitlement.activeLandingLimit
        ? `${entitlement.activeLandingLimit} active landings`
        : "custom limit",
    product: entitlement.product,
    status: entitlement.status
  }))

  const futureAvailability = services.listFutureAvailabilityForOrganization(activeOrganization.id).map((availability) => {
    const combination = requireRecord(
      state.equipmentCombinations.find((item) => item.id === availability.equipmentCombinationId),
      `equipment ${availability.equipmentCombinationId}`
    )

    return {
      equipmentLabel: combination.label,
      id: availability.id,
      notes: availability.notes ?? null,
      status: availability.status,
      windowLabel: formatWindow(availability.startsAt, availability.endsAt)
    }
  })

  const organizationMemberIds = new Set(
    state.organizationMemberships
      .filter((membership) => membership.organizationId === activeOrganization.id && membership.status === "active")
      .map((membership) => membership.userId)
  )
  const canSeeActivity = ["owner", "admin"].includes(activeMembership.role) || currentUser.role === "admin"

  const relevantTripIds = new Set(trips.map((trip) => trip.id))
  const auditEvents = canSeeActivity
    ? state.auditEvents
        .filter((event) =>
          (event.actorUserId && organizationMemberIds.has(event.actorUserId)) ||
          organizationLoadIds.has(event.entityId) ||
          relevantTripIds.has(event.entityId) ||
          event.entityId === activeOrganization.id
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((event) => ({
          action: event.action,
          createdAt: event.createdAt,
          entityType: event.entityType,
          id: event.id
        }))
    : []

  return {
    activeOrganization: {
      id: activeOrganization.id,
      name: activeOrganization.displayName,
      reputation: organizationReputation(state, activeOrganization.id),
      role: activeMembership.role,
      type: activeOrganization.type,
      verificationStatus: activeOrganization.verificationStatus
    },
    auditEvents,
    currentDriver: currentDriverProfile
      ? {
          id: currentDriverProfile.id,
          name: currentUser.fullName,
          trailerId: currentTrailer?.id ?? null,
          truckId: currentTruck?.id ?? null
        }
      : null,
    currentEquipment: currentCombination && currentTruck
      ? {
          combinationId: currentCombination.id,
          label: currentCombination.label,
          trailerId: currentTrailer?.id ?? null,
          truckId: currentTruck.id
        }
      : null,
    entitlements,
    futureAvailability,
    loads,
    messages,
    metrics: {
      activeAssignments: state.assignments.filter((assignment) =>
        ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status) &&
        (organizationDriverProfileIds.has(assignment.driverProfileId) ||
          organizationLoadIds.has(assignment.loadPostingId))
      ).length,
      criticalNotices: notices.filter((notice) => notice.severity === "critical").length,
      openLoads: loads.filter((load) => load.status === "open").length,
      trucksAvailable: trucks.filter((truck) => truck.status !== "unavailable" && truck.status !== "inactive").length
    },
    notices,
    privateNetwork,
    topRecommendations,
    trips,
    trucks
  }
}
