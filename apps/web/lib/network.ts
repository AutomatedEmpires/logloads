import {
  evaluateLoadCompatibility,
  explainCompatibility,
  formatRateLabel,
  type AssignmentStatus,
  type LoadStatus,
  type MatchEligibility,
  type OpportunityVisibilityMode,
  type RoadCondition,
  type TripStatusV2
} from "@logloads/contracts"
import { createInMemoryDatabase, type LogLoadsDatabaseState } from "@logloads/db"
import { createLogLoadsServices } from "@logloads/services"

export interface NetworkPoint {
  id: string
  name: string
  city: string
  state: string
  lat: number
  lng: number
  accessNotes: string
  roadCondition: RoadCondition
  freshness: "verified" | "recent" | "stale"
}

export interface NetworkLoadView {
  id: string
  reference: string
  title: string
  sourceName: string
  sourceOrganizationId: string
  status: LoadStatus
  visibilityMode: OpportunityVisibilityMode
  allocationMode: string
  loadType: string
  scheduleLabel: string
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
    score: number
    summary: string
    positives: string[]
    cautions: string[]
    failures: string[]
  }
  warnings: string[]
  criticalInstructions: string[]
  assignments: Array<{
    id: string
    status: AssignmentStatus
    driverName: string
    truckUnit: string
  }>
}

export interface TruckView {
  id: string
  unitNumber: string
  driverName: string
  configuration: string
  status: string
  payload: string
  region: string
  matchCount: number
  verification: string
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
    verificationStatus: string
  }
  currentDriver: {
    id: string
    name: string
    truckId: string
    trailerId: string | null
  }
  loads: NetworkLoadView[]
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
    loadTitle: string
    status: TripStatusV2
    locationVisibility: string
    routePackId: string | null
    lastSyncedAt: string | null
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
    lastMessage: string
  }>
  auditEvents: Array<{
    id: string
    action: string
    entityType: string
    createdAt: string
  }>
}

function requireRecord<T>(value: T | undefined, label: string): T {
  if (!value) {
    throw new Error(`Seed data integrity error: ${label}`)
  }

  return value
}

function publicReference(id: string): string {
  return `LL-${id.slice(-4).toUpperCase()}`
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

function pointFromLanding(landing: LogLoadsDatabaseState["landings"][number]): NetworkPoint {
  return {
    accessNotes: landing.accessNotes ?? "Operational entrance notes not yet verified.",
    city: landing.city,
    freshness: landing.roadCondition === "good" ? "verified" : "recent",
    id: landing.id,
    lat: landing.coordinates.lat,
    lng: landing.coordinates.lng,
    name: landing.name,
    roadCondition: landing.roadCondition ?? "good",
    state: landing.state
  }
}

function pointFromDestination(destination: LogLoadsDatabaseState["mills"][number]): NetworkPoint {
  return {
    accessNotes: destination.accessNotes ?? "Receiving entrance notes not yet verified.",
    city: destination.city,
    freshness: "recent",
    id: destination.id,
    lat: destination.coordinates.lat,
    lng: destination.coordinates.lng,
    name: destination.name,
    roadCondition: destination.roadCondition ?? "good",
    state: destination.state
  }
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

export function buildNetworkView(
  state = createInMemoryDatabase(),
  options: { actorUserId?: string; organizationId?: string } = {}
): NetworkView {
  const services = createLogLoadsServices(state)
  const actorUserId = options.actorUserId ?? services.DEFAULT_ACTOR_USER_ID
  const activeContext = services.getActiveOrganizationContext(actorUserId, options.organizationId ?? services.DEFAULT_ORGANIZATION_ID)
  const currentUser = requireRecord(
    state.profiles.find((profile) => profile.id === actorUserId),
    "current user"
  )
  const currentDriver = state.driverProfiles.find((driver) => driver.userId === currentUser.id) ?? requireRecord(
    state.driverProfiles.find((driver) => driver.id === "44444444-4444-4444-8444-444444444441"),
    "current driver"
  )
  const activeOrganization = requireRecord(
    state.organizations.find((organization) => organization.id === activeContext.organizationId),
    "active organization"
  )
  const currentTruck = requireRecord(
    state.truckProfiles.find((truck) => truck.id === "77777777-7777-4777-8777-777777777771"),
    "current truck"
  )
  const currentTrailer = state.trailerProfiles.find((trailer) => trailer.truckId === currentTruck.id) ?? null
  const availabilityWindows = state.availabilityWindows.filter((window) => window.driverProfileId === currentDriver.id)
  const visibleLoadRecords = services.listVisibleLoadsForOrganization(activeOrganization.id)

  const loads = visibleLoadRecords
    .map((load): NetworkLoadView => {
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
      const currentDriverHasActiveAssignment = state.assignments.some((assignment) =>
        assignment.loadPostingId === load.id &&
        assignment.driverProfileId === currentDriver.id &&
        ["requested", "offered", "accepted", "checked_in", "loading", "hauled"].includes(assignment.status)
      )
      const requestableSlot = currentDriverHasActiveAssignment
        ? null
        : slots.find((slot) => ["open", "requested"].includes(slot.status) && slot.reservedCount < slot.capacity) ?? null
      const compatibility = evaluateLoadCompatibility({
        availabilityWindows,
        load,
        route,
        trailer: currentTrailer,
        truck: currentTruck
      })
      const assigned = state.assignments
        .filter((assignment) => assignment.loadPostingId === load.id)
        .map((assignment) => {
          const driver = requireRecord(state.driverProfiles.find((profile) => profile.id === assignment.driverProfileId), `driver ${assignment.driverProfileId}`)
          const user = requireRecord(state.profiles.find((profile) => profile.id === driver.userId), `user ${driver.userId}`)
          const truck = requireRecord(state.truckProfiles.find((item) => item.id === assignment.truckProfileId), `truck ${assignment.truckProfileId}`)

          return {
            driverName: user.fullName,
            id: assignment.id,
            status: assignment.status,
            truckUnit: truck.unitNumber
          }
        })
      const roadWarning = warningForRoad(load.roadCondition)
      const routeWarning = warningForRoad(route.roadCondition)
      const weatherWarning = load.weatherNotes ? `Weather: ${load.weatherNotes}` : null
      const facilityWarning = destinationFacility?.currentNotice ? `Receiving: ${destinationFacility.currentNotice}` : null

      return {
        accessRequirements: load.accessRequirements,
        allocationMode: capacity?.allocationMode ?? "request_approval",
        assignments: assigned,
        capacity: {
          committed: capacity?.committedTruckloads ?? slots.reduce((sum, slot) => sum + slot.reservedCount, 0),
          completed: capacity?.completedTruckloads ?? 0,
          remaining: capacity?.remainingTruckloads ?? slots.reduce((sum, slot) => sum + Math.max(0, slot.capacity - slot.reservedCount), 0),
          total: capacity?.totalTruckloads ?? slots.reduce((sum, slot) => sum + slot.capacity, 0)
        },
        compatibility: {
          cautions: compatibility.cautions,
          eligibility: compatibility.eligibility,
          failures: compatibility.hardFailures,
          positives: compatibility.positiveSignals,
          score: compatibility.score,
          summary: explainCompatibility(compatibility)
        },
        criticalInstructions: [
          landingDetails?.gateInstructions ? `Gate: ${landingDetails.gateInstructions}` : null,
          landingDetails?.privateRoadNotes ? `Landing access: ${landingDetails.privateRoadNotes}` : landing.accessNotes ? `Landing: ${landing.accessNotes}` : null,
          destinationFacility?.checkInProcess ? `Destination check-in: ${destinationFacility.checkInProcess}` : destination.accessNotes ? `Destination: ${destination.accessNotes}` : null,
          routePack?.calculatedRouteSummary ? `Route pack: ${routePack.calculatedRouteSummary}` : route.roadNotes ? `Local route: ${route.roadNotes}` : null
        ].filter((value): value is string => Boolean(value)),
        destination: pointFromDestination(destination),
        destinationFacility: destinationFacility ? {
          checkInProcess: destinationFacility.checkInProcess,
          currentNotice: destinationFacility.currentNotice ?? null,
          currentStatus: destinationFacility.currentStatus,
          lastVerifiedAt: destinationFacility.lastVerifiedAt,
          receivingHours: destinationFacility.receivingHours,
          scaleProcess: destinationFacility.scaleProcess,
          unloadingInstructions: destinationFacility.unloadingInstructions
        } : null,
        equipment: load.equipmentRequirements,
        fuelSurchargeLabel: rate.fuelSurchargeCents > 0
          ? `+ ${formatRateLabel({ amountCents: rate.fuelSurchargeCents, currency: "USD" }, "flat_rate")} fuel`
          : "Fuel included in terms",
        id: load.id,
        landing: pointFromLanding(landing),
        landingDetails: landingDetails ? {
          exactLocationVisibility: landingDetails.exactLocationVisibility,
          gateInstructions: landingDetails.gateInstructions ?? null,
          lastVerifiedAt: landingDetails.lastVerifiedAt,
          loadingEquipment: landingDetails.loadingEquipment,
          privateRoadNotes: landingDetails.privateRoadNotes ?? null,
          publicApproximateArea: landingDetails.publicApproximateArea,
          turnaroundConstraints: landingDetails.turnaroundConstraints
        } : null,
        loadType: load.loadType.replaceAll("_", " "),
        payLabel: formatRateLabel(rate.baseRate, rate.rateType),
        reference: publicReference(load.id),
        route: {
          condition: route.roadCondition,
          distanceMiles: route.estimatedDistanceMiles,
          id: route.id,
          localNotes: route.roadNotes ?? "No operator route note has been added.",
          name: route.routeName,
          runTimeMinutes: route.estimatedRunTimeMinutes,
          weatherNotes: route.weatherNotes ?? null
        },
        routePack: routePack ? {
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
        } : null,
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
        status: load.status,
        title: load.title,
        tonsLabel: load.estimatedTonsPerLoad ? `${load.estimatedTonsPerLoad} tons expected` : "Weight pending",
        visibilityMode: capacity?.visibilityMode ?? "open_network",
        warnings: [roadWarning, routeWarning, weatherWarning, facilityWarning].filter((value): value is string => Boolean(value))
      }
    })
    .sort((left, right) => {
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

      return statusWeight[left.status] - statusWeight[right.status] || right.compatibility.score - left.compatibility.score
    })

  const trucks = state.equipmentCombinations.map((combination): TruckView => {
    const truck = requireRecord(state.truckProfiles.find((item) => item.id === combination.truckProfileId), `truck ${combination.truckProfileId}`)
    const driver = combination.assignedDriverProfileId ? state.driverProfiles.find((profile) => profile.id === combination.assignedDriverProfileId) : undefined
    const user = state.profiles.find((profile) => profile.id === driver?.userId)
    const availability = state.futureAvailability.find((window) => window.equipmentCombinationId === combination.id)
    const matchCount = loads.filter((load) => {
      const original = state.loadPostings.find((item) => item.id === load.id)
      const route = original ? state.haulRoutes.find((item) => item.id === original.routeId) : undefined
      const trailer = combination.trailerProfileId ? state.trailerProfiles.find((item) => item.id === combination.trailerProfileId) : null

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
      id: combination.id,
      matchCount,
      payload: `${combination.maxPayloadTons} tons`,
      region: combination.homeRegion,
      status: availability?.status ?? combination.status,
      unitNumber: combination.label,
      verification
    }
  })

  const notices: NoticeView[] = services.listAttentionItems(activeOrganization.id)

  const messages = state.messageThreads.map((thread) => {
    const lastMessage = state.messageEvents
      .filter((event) => event.threadId === thread.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]

    return {
      id: thread.id,
      lastMessage: lastMessage?.body ?? "No messages yet.",
      subject: thread.subject ?? "Operational thread"
    }
  })

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

  const trips = state.tripsV2.map((trip) => {
    const load = requireRecord(state.loadPostings.find((item) => item.id === trip.loadPostingId), `trip load ${trip.loadPostingId}`)
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

    return {
      documents,
      events,
      id: trip.id,
      lastSyncedAt: trip.lastSyncedAt ?? null,
      loadTitle: load.title,
      locationVisibility: trip.locationVisibility.replaceAll("_", " "),
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

  return {
    activeOrganization: {
      id: activeOrganization.id,
      name: activeOrganization.displayName,
      role: activeContext.membership.role,
      verificationStatus: activeOrganization.verificationStatus
    },
    auditEvents: state.auditEvents
      .slice()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((event) => ({
        action: event.action,
        createdAt: event.createdAt,
        entityType: event.entityType,
        id: event.id
      })),
    currentDriver: {
      id: currentDriver.id,
      name: currentUser.fullName,
      trailerId: currentTrailer?.id ?? null,
      truckId: currentTruck.id
    },
    entitlements,
    futureAvailability,
    loads,
    messages,
    metrics: {
      activeAssignments: state.assignments.filter((assignment) => ["accepted", "checked_in", "loading", "hauled", "requested"].includes(assignment.status)).length,
      criticalNotices: notices.filter((notice) => notice.severity === "critical").length,
      openLoads: loads.filter((load) => load.status === "open").length,
      trucksAvailable: trucks.filter((truck) => truck.status !== "unavailable" && truck.status !== "inactive").length
    },
    notices,
    privateNetwork,
    trips,
    trucks
  }
}
