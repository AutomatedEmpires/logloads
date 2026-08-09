import {
  evaluateLoadCompatibility,
  explainCompatibility,
  driverPayLabel,
  formatMoney,
  formatRateLabel,
  organizationRoleCan,
  readFrozenDriverPay,
  recommendLoad,
  reputationLabel,
  summarizeReviews,
  type AssignmentStatus,
  type LoadStatus,
  type MatchEligibility,
  type OpportunityVisibilityMode,
  type RecommendationBand,
  type DeliveredQuantity,
  type HaulCompletionStatus,
  type HaulException,
  type RecommendationVisibility,
  type ReputationBand,
  type RoadCondition,
  type RoutePackSnapshot,
  type TripStatusV2
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import {
  activeDriverProfileForOrganization,
  createLogLoadsServices,
  directOfferClaimCount,
  destinationFacilityVerificationAt,
  directOfferIsClaimable,
  effectiveDirectOfferStatus,
  organizationOperationallyAccessible,
  routePackIsSafeToRead
} from "@logloads/services"

import { estimateLoadEconomics, type LoadEconomicsEstimate } from "./economics"
import { isViewableMediaReference } from "./media-reference"

export type OrgReputationView = {
  label: string
  band: ReputationBand
  avgRating: number | null
  ratingCount: number
} | null

/** Public capacity may only represent equipment from an operational workspace. */
export function publicAvailableEquipmentCount(
  state: LogLoadsDatabaseState
): number {
  const operationalOrganizationIds = new Set(
    state.organizations
      .filter(organizationOperationallyAccessible)
      .map((organization) => organization.id)
  )

  return state.equipmentCombinations.filter(
    (combination) =>
      combination.status === "available" &&
      operationalOrganizationIds.has(combination.organizationId)
  ).length
}

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
  roadCondition: RoadCondition | null
  freshness: "verified" | "recent" | "stale" | "unknown"
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
  cadenceLabel: string
  economics: LoadEconomicsEstimate
  discovery: {
    available: boolean
    reason: "available" | "expired" | "filled" | "assigned" | "not_requestable"
  }
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
    version: number
    visibility: string
    cacheableOffline: boolean
    calculatedRouteSummary: string
    currentRoadCondition: RoadCondition
    lastVerifiedAt: string
    snapshot: RoutePackSnapshot | null
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
    claimableSlotId: string | null
    requestableSlotId: string | null
    /** Every slot still takeable by this viewer, earliest first. */
    selectable: Array<{
      id: string
      startAt: string
      endAt: string
      window: string
      remaining: number
    }>
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
  viewerDecision: {
    id: string
    status: "declined"
    reason: string | null
    decidedAt: string
  } | null
}

export interface TruckView {
  id: string
  unitNumber: string
  driverName: string
  driverProfileId: string | null
  configuration: string
  status: string
  /** The stored combination status — what the status controls act on. */
  combinationStatus: string
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

export interface DirectOfferView {
  id: string
  loadPostingId: string
  loadTitle: string
  counterpartName: string
  direction: "received" | "sent"
  status: "draft" | "sent" | "accepted" | "declined" | "expired" | "revoked"
  offeredTruckloads: number
  acceptedTruckloads: number
  remainingTruckloads: number
  expiresAt: string
  respondedAt: string | null
  actionable: boolean
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
    preferredFuelPriceCentsPerGallon: number | null
    hasProfilePhoto: boolean
    featureTruckPhoto: boolean
  } | null
  currentEquipment: {
    combinationId: string
    label: string
    truckId: string
    trailerId: string | null
    fuelEconomyMpg: number | null
    hasTruckPhoto: boolean
    hasTrailerPhoto: boolean
  } | null
  directOffers: DirectOfferView[]
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
    completion: {
      status: HaulCompletionStatus
      deliveredQuantity: DeliveredQuantity | null
      exception: HaulException | null
      disputeReason: string | null
      submittedAt: string | null
      confirmedAt: string | null
      requiredEvidence: string[]
      hasEvidence: boolean
    }
    driverPayment: {
      expectedPayAmountCents: number | null
      expectedPayCurrency: string | null
      expectedPayLabel: string | null
      matchesExpected: boolean | null
      receivedPayLabel: string | null
      receivedAt: string | null
      sentAt: string | null
      status: "not_sent" | "sent" | "received"
    }
    reviewable: {
      direction: "host_rates_hauler" | "hauler_rates_host"
      counterpartyName: string
      alreadyReviewed: boolean
    } | null
    /** The live pre-trip walk-around record, if the driver has given one. */
    inspection: {
      outcome: "pass" | "fail"
      occurredAt: string
      failedItems: string[]
    } | null
    events: Array<{ id: string; type: string; note: string | null; occurredAt: string; source: string }>
    documents: Array<{
      id: string
      type: string
      filename: string
      processingStatus: string
      /** Whether a stored file backs this record and can be delivered. */
      viewable: boolean
    }>
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

const VIEWER_ASSIGNMENT_STATUSES = ["requested", "offered", "accepted", "checked_in", "loading", "hauled"]
const ACCESS_UNLOCKED_ASSIGNMENT_STATUSES = ["accepted", "checked_in", "loading", "hauled", "completed"]

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

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** A glanceable cadence marker: "Weekly · Mon, Wed, Fri", "Campaign", or "One-off". */
function cadenceLabel(load: {
  scheduleType: string
  recurringSchedule?: { frequency: string; daysOfWeek: number[] } | null
}): string {
  if (load.scheduleType === "recurring" && load.recurringSchedule) {
    if (load.recurringSchedule.frequency === "daily") {
      return "Recurring · daily"
    }

    const names = load.recurringSchedule.daysOfWeek
      .map((day) => WEEKDAY_LABELS[day])
      .filter((value): value is string => Boolean(value))
      .join(", ")

    return names ? `Weekly · ${names}` : "Recurring"
  }

  if (load.scheduleType === "campaign") {
    return "Campaign"
  }

  return "One-off"
}

/**
 * A slot window, carrying the day it falls on.
 *
 * The date is not decoration here. A posting is a series, so the same lane
 * runs at the same hour on consecutive days — without the day, three runs
 * render as three identical "3:00 PM - 3:20 PM" labels and a driver choosing
 * between them is picking blind. That is exactly what the slot picker showed
 * the first time it was driven.
 *
 * Still UTC: this is server-rendered and the server cannot know the reader's
 * timezone. `LocalTime` is the client-side answer and should replace this
 * once slot surfaces are converted.
 */
function formatSlotWindow(startAt: string, endAt: string): string {
  const day = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    weekday: "short"
  })
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC"
  })
  const start = new Date(startAt)

  return `${day.format(start)} · ${time.format(start)} - ${time.format(new Date(endAt))} UTC`
}

function formatWindow(startAt: string, endAt: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC"
  })

  return `${formatter.format(new Date(startAt))} - ${formatter.format(new Date(endAt))} UTC`
}

function approximateCoordinate(value: number): number {
  return Math.round(value * 50) / 50
}

const SITE_REPORT_FRESHNESS_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000

function currentVerificationAt(
  updatedAt: string,
  verifiedAt: string | null | undefined,
  at: Date
): string | null {
  if (!verifiedAt) return null

  const updated = Date.parse(updatedAt)
  const verified = Date.parse(verifiedAt)
  const evaluated = at.getTime()

  return Number.isFinite(updated) &&
    Number.isFinite(verified) &&
    Number.isFinite(evaluated) &&
    verified >= updated &&
    verified <= evaluated
    ? verifiedAt
    : null
}

function siteFreshness(
  site: { roadCondition?: RoadCondition | null; updatedAt: string },
  at: Date,
  verifiedAt?: string | null
): NetworkPoint["freshness"] {
  if (!site.roadCondition) return "unknown"
  if (currentVerificationAt(site.updatedAt, verifiedAt, at)) return "verified"

  const reportedAt = Date.parse(site.updatedAt)
  const age = at.getTime() - reportedAt

  if (!Number.isFinite(reportedAt) || age < 0) return "unknown"
  return age <= SITE_REPORT_FRESHNESS_WINDOW_MS ? "recent" : "stale"
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
    updatedAt: string
  },
  exact: boolean,
  at: Date,
  exactCoordinates?: { lat: number; lng: number } | null,
  lastVerifiedAt?: string | null
): NetworkPoint {
  return {
    accessNotes: exact ? site.accessNotes ?? null : null,
    approximate: !exact,
    city: site.city,
    freshness: siteFreshness(site, at, lastVerifiedAt),
    id: site.id,
    lat: exact ? (exactCoordinates?.lat ?? site.coordinates.lat) : approximateCoordinate(site.coordinates.lat),
    lng: exact ? (exactCoordinates?.lng ?? site.coordinates.lng) : approximateCoordinate(site.coordinates.lng),
    name: site.name,
    roadCondition: site.roadCondition ?? null,
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

export function buildNetworkView(
  state: LogLoadsDatabaseState,
  viewer: NetworkViewer,
  at = new Date()
): NetworkView {
  const services = createLogLoadsServices(state)
  const atIso = at.toISOString()

  // --- Resolve the viewer -------------------------------------------------
  const actorUserId = viewer.kind === "actor" ? viewer.actorUserId : null
  const actorProfile = actorUserId
    ? state.profiles.find((profile) => profile.id === actorUserId) ?? null
    : null
  const currentUser = actorProfile?.isActive ? actorProfile : null

  const memberships = currentUser
    ? state.organizationMemberships.filter(
        (membership) => membership.userId === currentUser.id && membership.status === "active"
      )
    : []
  const requestedOrganizationId = viewer.kind === "actor" ? viewer.organizationId ?? null : null
  const eligibleMemberships = memberships.filter((membership) =>
    state.organizations.some(
      (organization) =>
        organization.id === membership.organizationId &&
        organizationOperationallyAccessible(organization)
    )
  )
  const selectedOrganizationId = requestedOrganizationId
  const selectedMemberships = selectedOrganizationId
    ? eligibleMemberships.filter((membership) => membership.organizationId === selectedOrganizationId)
    : []
  // A requested organization is exact authority. Never fall through to some
  // other membership when it is suspended, removed, archived, or ambiguous.
  const activeMembership = selectedMemberships.length === 1 ? selectedMemberships[0]! : null
  const activeOrganization = activeMembership
    ? state.organizations.find(
        (organization) =>
          organization.id === activeMembership.organizationId &&
          organizationOperationallyAccessible(organization)
      ) ?? null
    : null

  const currentDriverProfile = actorUserId && activeOrganization
    ? activeDriverProfileForOrganization(state, actorUserId, activeOrganization.id)
    : null

  const organizationCombinations = activeOrganization
    ? state.equipmentCombinations.filter((combination) => combination.organizationId === activeOrganization.id)
    : []
  const currentCombination = currentDriverProfile
    ? organizationCombinations.find(
        (combination) =>
          combination.assignedDriverProfileId === currentDriverProfile.id &&
          combination.status !== "inactive"
      ) ?? null
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

  const activeOrganizationDriverProfileIds = new Set(
    activeOrganization
      ? state.driverProfiles
          .filter(
            (driver) =>
              activeDriverProfileForOrganization(state, driver.userId, activeOrganization.id)?.id === driver.id
          )
          .map((driver) => driver.id)
      : []
  )
  // Membership revocation removes live authority, not historical ownership.
  // Authorized fleet staff still need the exact organization's preserved
  // assignment and trip records for reconciliation and audit.
  const organizationOwnedDriverProfileIds = new Set(
    activeOrganization
      ? state.driverProfiles
          .filter((driver) => driver.companyId === activeOrganization.id)
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

        // Anonymous browsing shows open-network work only — verified-network
        // work is gated to verified member organizations, so it never leaks
        // onto the public board.
        return visibilityMode === "open_network" && services.isLoadRequestableAt(load, atIso)
      })
    : services.listVisibleLoadsForOrganization(activeOrganization.id, atIso)

  const loadsWithScore = visibleLoadRecords.map((load) => {
    const source = requireRecord(state.companies.find((company) => company.id === load.companyId), `company ${load.companyId}`)
    const landing = requireRecord(state.landings.find((item) => item.id === load.pickupLandingId), `landing ${load.pickupLandingId}`)
    const matchingLandingDetails = state.richLandingDetails.filter(
      (item) =>
        item.landingId === landing.id &&
        item.controlledByOrganizationId === load.companyId
    )
    const landingDetails = matchingLandingDetails.length === 1 ? matchingLandingDetails[0]! : null
    const destination = requireRecord(state.mills.find((item) => item.id === load.dropoffMillId), `destination ${load.dropoffMillId}`)
    const matchingDestinationFacilities = state.destinationFacilities.filter(
      (item) => item.millId === destination.id
    )
    const destinationFacilityCandidate = matchingDestinationFacilities.length === 1
      ? matchingDestinationFacilities[0]!
      : null
    const destinationFacilityVerifiedAt = destinationFacilityVerificationAt(
      destinationFacilityCandidate,
      destination,
      at
    )
    const destinationFacility = destinationFacilityVerifiedAt
      ? destinationFacilityCandidate
      : null
    const route = requireRecord(state.haulRoutes.find((item) => item.id === load.routeId), `route ${load.routeId}`)
    // Route packs are per-assignment snapshots now, so "a pack for this load"
    // could belong to a different driver. Resolved below against the viewer's
    // own assignment; the host falls back to its load-level source pack.
    const sourceRoutePack = state.routePacks.find(
      (item) =>
        item.loadPostingId === load.id &&
        !item.assignmentId &&
        routePackIsSafeToRead(state, load, item)
    ) ?? null
    const rate = requireRecord(state.rates.find((item) => item.id === load.rateId), `rate ${load.rateId}`)
    const capacity = state.opportunityCapacities.find((item) => item.loadPostingId === load.id) ?? null
    const slots = state.truckSlots.filter((slot) => slot.loadPostingId === load.id)
    const loadAssignments = state.assignments.filter((assignment) => assignment.loadPostingId === load.id)

    // --- Access: sensitive operational detail unlocks for the publishing
    // organization and for actively assigned haulers only. -----------------
    const ownsLoad = Boolean(activeOrganization && load.companyId === activeOrganization.id)
    const staffCanViewPrivateLocation = Boolean(
      activeMembership &&
      activeMembership.role !== "driver" &&
      organizationRoleCan(activeMembership.role, "view_private_location")
    )
    const orderedAssignments = loadAssignments
      .map((assignment, attemptIndex) => ({ assignment, attemptIndex }))
      .sort((left, right) =>
        right.assignment.updatedAt.localeCompare(left.assignment.updatedAt) ||
        right.attemptIndex - left.attemptIndex
      )
      .map(({ assignment }) => assignment)
    // The viewer's own decision state must never be borrowed from a coworker:
    // driver/fleet cards use it for "You're booked", request suppression, and
    // cancellation links. Staff access to a coworker's private pack is tracked
    // separately below.
    const viewerAssignments = currentDriverProfile
      ? orderedAssignments.filter((assignment) => assignment.driverProfileId === currentDriverProfile.id)
      : []
    const viewerActiveAssignment = viewerAssignments.find((assignment) =>
      VIEWER_ASSIGNMENT_STATUSES.includes(assignment.status)
    ) ?? null
    const viewerAccessAssignment = viewerAssignments.find((assignment) =>
      ACCESS_UNLOCKED_ASSIGNMENT_STATUSES.includes(assignment.status)
    ) ?? null
    const staffAccessAssignment = staffCanViewPrivateLocation
      ? orderedAssignments.find(
          (assignment) =>
            organizationOwnedDriverProfileIds.has(assignment.driverProfileId) &&
            ACCESS_UNLOCKED_ASSIGNMENT_STATUSES.includes(assignment.status)
        ) ?? null
      : null
    // A decline is a current decision only when it is the viewer's latest
    // attempt. A newer request or booking supersedes the historical outcome.
    const viewerDeclinedAssignment = viewerAssignments[0]?.status === "declined"
      ? viewerAssignments[0]
      : null
    const assignedDriverAccess = Boolean(
      currentDriverProfile &&
      viewerAccessAssignment?.driverProfileId === currentDriverProfile.id
    )
    const assignedStaffAccess = Boolean(
      staffCanViewPrivateLocation &&
      staffAccessAssignment
    )
    const ownerStaffAccess = ownsLoad && staffCanViewPrivateLocation
    const canOpenViewerAssignmentPack = assignedDriverAccess || assignedStaffAccess
    const privateAccessAssignment = viewerAccessAssignment ?? staffAccessAssignment
    const unlocked = ownerStaffAccess || canOpenViewerAssignmentPack
    const access: LoadAccess = {
      reason: ownerStaffAccess ? "owner" : canOpenViewerAssignmentPack ? "assigned" : "locked",
      unlocked
    }
    // The viewer's own snapshot, newest live version.
    const viewerRoutePack = canOpenViewerAssignmentPack && privateAccessAssignment
      ? state.routePacks
          .filter(
            (pack) =>
              pack.assignmentId === privateAccessAssignment.id &&
              !pack.supersededAt &&
              routePackIsSafeToRead(state, load, pack)
          )
          .sort((left, right) => right.version - left.version)[0] ?? null
      : null
    // Mirrors getRoutePackForAssignment: whoever may open the pack falls back to
    // the host's load-level source when no assignment snapshot exists — every
    // haul booked before packs were minted per assignment is in that state, and
    // showing them nothing would claim the host published no briefing when it
    // did. A viewer without access still gets null, so a driver never sees a
    // pack belonging to someone else's assignment.
    const routePack = viewerRoutePack ?? (unlocked ? sourceRoutePack : null)
    const issuedInstruction = (title: string) =>
      viewerRoutePack?.localInstructions.find((instruction) => instruction.title === title)?.detail ?? null
    const effectiveGateInstructions = viewerRoutePack
      ? issuedInstruction("Gate access")
      : landingDetails?.gateInstructions ?? null
    const effectivePrivateRoadNotes = viewerRoutePack
      ? issuedInstruction("Private road")
      : landingDetails?.privateRoadNotes ?? null
    const effectiveLandingAccess = viewerRoutePack
      ? effectivePrivateRoadNotes ?? issuedInstruction("Landing access")
      : effectivePrivateRoadNotes ?? landing.accessNotes ?? null
    const issuedEntrance =
      viewerRoutePack?.snapshot?.originEntranceLat != null &&
      viewerRoutePack.snapshot.originEntranceLng != null
        ? {
            lat: viewerRoutePack.snapshot.originEntranceLat,
            lng: viewerRoutePack.snapshot.originEntranceLng
          }
        : null
    const effectiveEntrance = issuedEntrance ?? (
      landingDetails ? { lat: landingDetails.entranceLat, lng: landingDetails.entranceLng } : null
    )

    const viewerHasActiveAssignment = Boolean(
      currentDriverProfile &&
      loadAssignments.some((assignment) =>
        assignment.driverProfileId === currentDriverProfile.id &&
        VIEWER_ASSIGNMENT_STATUSES.includes(assignment.status)
      )
    )
    const capacityRemaining = capacity?.remainingTruckloads ??
      slots.reduce((sum, slot) => sum + Math.max(0, slot.capacity - slot.reservedCount), 0)
    // Matches services.isLoadRequestableAt: a "reserved" multi-truck day keeps
    // accepting requests until reservedCount reaches capacity.
    const futureOpenSlots = slots.filter((slot) =>
      ["open", "requested", "reserved"].includes(slot.status) &&
      slot.reservedCount < slot.capacity &&
      slot.endAt > atIso
    )
    const discoveryAvailable = services.isLoadRequestableAt(load, atIso)
    const discoveryReason: NetworkLoadView["discovery"]["reason"] = viewerHasActiveAssignment
      ? "assigned"
      : capacityRemaining <= 0
        ? "filled"
        : futureOpenSlots.length === 0
          ? "expired"
          : (capacity?.allocationMode ?? "request_approval") !== "request_approval"
            ? "not_requestable"
            : !discoveryAvailable
              ? "not_requestable"
              : "available"
    const viewerCanRequest = Boolean(
      currentUser &&
      activeOrganization &&
      activeMembership &&
      currentDriverProfile &&
      !viewerHasActiveAssignment &&
      discoveryAvailable
    )
    // Slot-level availability is not viewer eligibility. A public visitor, or a
    // driver who already holds this load, can have open slots in front of them
    // and still be unable to take one — offering them a picker would be a
    // control that cannot work.
    //
    // Sorted because "earliest first" is the promised contract and
    // state.truckSlots carries no ordering guarantee. This also corrects
    // claimableSlotId and nextWindow, which took whatever slot happened to be
    // first in storage while calling it "next".
    const openSlotsByTime = [...futureOpenSlots].sort((left, right) =>
      left.startAt.localeCompare(right.startAt)
    )
    // Not viewer-gated: claimableSlotId serves direct-offer claims, which
    // answer to their own eligibility. Ordering alone is the fix there.
    const selectableSlots = viewerCanRequest ? openSlotsByTime : []
    const requestableSlot = selectableSlots[0] ?? null

    const compatibility = currentTruck
      ? evaluateLoadCompatibility({
          availabilityWindows,
          load,
          route,
          trailer: currentTrailer,
          truck: currentTruck
        })
      : null

    const recommendation = compatibility && !ownsLoad
      ? recommendLoad({
          compatibility,
          counterpartReliability: counterpartReliabilitySignal(state, load.companyId),
          daysUntilSchedule: daysUntil(load.loadDate ?? load.campaignStartDate),
          distanceMiles: route.estimatedDistanceMiles,
          freshness: siteFreshness(landing, at, landingDetails?.lastVerifiedAt),
          isRequestable: Boolean(requestableSlot),
          remainingCapacity: capacityRemaining,
          visibility: (capacity?.visibilityMode ?? "open_network") as RecommendationVisibility
        })
      : null

    const staffCanViewOrganizationAssignments = Boolean(
      activeMembership && activeMembership.role !== "driver"
    )
    const assignmentViews = (ownsLoad && staffCanViewOrganizationAssignments
      ? loadAssignments
      : loadAssignments.filter((assignment) =>
          (currentDriverProfile && assignment.driverProfileId === currentDriverProfile.id) ||
          (staffCanViewOrganizationAssignments && organizationOwnedDriverProfileIds.has(assignment.driverProfileId))
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
    const economics = estimateLoadEconomics({
      driver: currentDriverProfile,
      landing,
      load,
      rate,
      route,
      truck: currentTruck
    })

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
            effectiveGateInstructions ? `Gate: ${effectiveGateInstructions}` : null,
            effectiveLandingAccess ? `Landing access: ${effectiveLandingAccess}` : null,
            destinationFacility?.checkInProcess ? `Destination check-in: ${destinationFacility.checkInProcess}` : destination.accessNotes ? `Destination: ${destination.accessNotes}` : null,
            routePack?.calculatedRouteSummary ? `Route pack: ${routePack.calculatedRouteSummary}` : route.roadNotes ? `Local route: ${route.roadNotes}` : null
          ].filter((value): value is string => Boolean(value))
        : [],
      destination: pointFromSite(
        destination,
        unlocked,
        at,
        null,
        destinationFacilityVerifiedAt
      ),
      discovery: { available: discoveryAvailable, reason: discoveryReason },
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
      economics,
      fuelSurchargeLabel: rate.fuelSurchargeCents > 0
        ? `+ ${formatRateLabel({ amountCents: rate.fuelSurchargeCents, currency: "USD" }, "flat_rate")} fuel`
        : "Fuel included in terms",
      id: load.id,
      landing: pointFromSite(
        landing,
        unlocked,
        at,
        effectiveEntrance,
        landingDetails?.lastVerifiedAt
      ),
      landingDetails: landingDetails
        ? {
            exactLocationVisibility: "assigned_only",
            gateInstructions: unlocked ? effectiveGateInstructions : null,
            lastVerifiedAt: landingDetails.lastVerifiedAt,
            loadingEquipment: landingDetails.loadingEquipment,
            privateRoadNotes: unlocked ? effectivePrivateRoadNotes : null,
            publicApproximateArea: landingDetails.publicApproximateArea,
            turnaroundConstraints: landingDetails.turnaroundConstraints
          }
        : null,
      loadType: load.loadType.replaceAll("_", " "),
      // A host-stated figure outranks the rate card: it is what this load pays
      // this driver, not what the company charges per ton. Loads posted before
      // driverPayCents existed keep their derived label rather than having a
      // commitment invented for them.
      payLabel: driverPayLabel(load.driverPayCents, rate),
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
            snapshot: routePack.snapshot ?? null,
            version: routePack.version,
            visibility: routePack.visibility
          }
        : null,
      scheduleLabel: formatDateRange(load),
      cadenceLabel: cadenceLabel(load),
      slots: {
        claimableSlotId: openSlotsByTime[0]?.id ?? null,
        nextWindow: openSlotsByTime[0]
          ? formatSlotWindow(openSlotsByTime[0].startAt, openSlotsByTime[0].endAt)
          : "No open slot",
        open: slots.reduce((sum, slot) => sum + Math.max(0, slot.capacity - slot.reservedCount), 0),
        requestableSlotId: requestableSlot?.id ?? null,
        reserved: slots.reduce((sum, slot) => sum + slot.reservedCount, 0),
        /**
         * Every slot this viewer could still take, earliest first — not just
         * the one the surfaces default to.
         *
         * A posting is a series, so "six loads over two days" is one posting
         * with six slots. Until now every surface booked `futureOpenSlots[0]`,
         * which silently decided *which day a driver works*. Assignment
         * uniqueness became per-slot in #65; this is the data a picker needs
         * for that to be reachable.
         *
         * Empty when the viewer cannot request — a public visitor, or a driver
         * already holding this load, would otherwise be offered a picker that
         * cannot work. `requestableSlotId` is this list's first entry, so the
         * control and its default can never disagree.
         */
        selectable: selectableSlots.map((slot) => ({
          endAt: slot.endAt,
          id: slot.id,
          remaining: Math.max(0, slot.capacity - slot.reservedCount),
          startAt: slot.startAt,
          window: formatSlotWindow(slot.startAt, slot.endAt)
        })),
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
      viewerDecision: viewerDeclinedAssignment
        ? {
            decidedAt: viewerDeclinedAssignment.cancelledAt ?? viewerDeclinedAssignment.updatedAt,
            id: viewerDeclinedAssignment.id,
            reason: viewerDeclinedAssignment.cancellationReason ?? null,
            status: "declined"
          }
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
        !entry.view.discovery.available ||
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
      directOffers: [],
      entitlements: [],
      futureAvailability: [],
      loads,
      messages: [],
      metrics: {
        activeAssignments: 0,
        criticalNotices: 0,
        openLoads: loads.filter((load) => load.status === "open").length,
        trucksAvailable: publicAvailableEquipmentCount(state)
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
    const assignedDriver = combination.assignedDriverProfileId
      ? state.driverProfiles.find((profile) => profile.id === combination.assignedDriverProfileId)
      : undefined
    const driver = assignedDriver && activeOrganizationDriverProfileIds.has(assignedDriver.id)
      ? assignedDriver
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
      // What the status controls read and write. The display status below may
      // substitute a published availability window; a toggle acting on that
      // substituted value would claim a stored fact the store does not hold.
      combinationStatus: combination.status,
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

  const notices: NoticeView[] = services.listAttentionItems({
    actorUserId: currentUser.id,
    organizationId: activeOrganization.id
  })

  const messages = services.listThreadsForUser(currentUser.id, activeOrganization.id).map((thread) => ({
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
      // A driver account is a personal cockpit, not a fleet board. Keeping the
      // organization-wide branch below for dispatch/host staff is intentional;
      // a driver must only receive the haul assigned to their own profile.
      if (activeMembership.role === "driver") {
        return Boolean(currentDriverProfile && trip.driverProfileId === currentDriverProfile.id)
      }

      if (currentDriverProfile && trip.driverProfileId === currentDriverProfile.id) {
        return true
      }

      if (organizationLoadIds.has(trip.loadPostingId)) {
        return true
      }

      return organizationOwnedDriverProfileIds.has(trip.driverProfileId)
    })
    // Corrupt rows are withheld by the store, so one orphaned trip can survive
    // while its assignment or load is quarantined. Omit that trip from the board
    // instead of turning every participant's trips page into a 500.
    .filter(
      (trip) =>
        state.loadPostings.some((item) => item.id === trip.loadPostingId) &&
        state.assignments.some((item) => item.id === trip.assignmentId)
    )
    .map((trip) => {
      const load = requireRecord(state.loadPostings.find((item) => item.id === trip.loadPostingId), `trip load ${trip.loadPostingId}`)
      const assignment = requireRecord(
        state.assignments.find((item) => item.id === trip.assignmentId),
        `trip assignment ${trip.assignmentId}`
      )
      const driver = state.driverProfiles.find((profile) => profile.id === trip.driverProfileId)
      const frozenDriverPay = readFrozenDriverPay(assignment.termsSnapshot)
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
      // A document is viewable only when current Supabase-backed bytes exist.
      // Historical provider names and keys remain metadata, never broken links.
      const documents = state.tripDocuments
        .filter((document) => document.tripId === trip.id)
        .map((document) => ({
          filename: document.filename,
          id: document.id,
          processingStatus: document.processingStatus,
          type: document.type.replaceAll("_", " "),
          viewable: isViewableMediaReference(document.media)
        }))

      // The live pre-trip record, if one exists. Superseded records are kept
      // for later review, but the boards show only the current answer.
      const inspectionRecord = state.tripInspections
        .filter((inspection) => inspection.tripId === trip.id && !inspection.supersededAt)
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0] ?? null

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

      // The proof this haul owes comes from the Route Pack the driver accepted,
      // not from the destination record as it reads today. Mirrors the service:
      // fall back to the host's load-level source, so the page shows the same
      // requirement the gate enforces.
      const assignmentPack = state.routePacks
        .filter(
          (pack) =>
            pack.assignmentId === trip.assignmentId &&
            !pack.supersededAt &&
            routePackIsSafeToRead(state, load, pack)
        )
        .sort((left, right) => right.version - left.version)[0]
      const evidencePack = assignmentPack ??
        state.routePacks.find(
          (pack) =>
            pack.loadPostingId === trip.loadPostingId &&
            !pack.assignmentId &&
            routePackIsSafeToRead(state, load, pack)
        )
      const requiredEvidence = evidencePack?.snapshot?.completionEvidence ?? []
      const hasEvidence = state.tripDocuments.some(
        (document) =>
          document.tripId === trip.id &&
          ["scale_ticket", "load_slip", "delivery_record", "photo"].includes(document.type)
      )
      const receivedPay =
        assignment.driverPaymentReceivedAmountCents !== null &&
        assignment.driverPaymentReceivedCurrency
          ? {
              amountCents: assignment.driverPaymentReceivedAmountCents,
              currency: assignment.driverPaymentReceivedCurrency
            }
          : null

      return {
        assignmentId: trip.assignmentId,
        completedAt: trip.completedAt ?? null,
        completion: {
          confirmedAt: trip.completionConfirmedAt ?? null,
          deliveredQuantity: trip.deliveredQuantity ?? null,
          disputeReason: trip.completionDisputeReason ?? null,
          exception: trip.haulException ?? null,
          hasEvidence,
          requiredEvidence,
          status: trip.completionStatus,
          submittedAt: trip.completionSubmittedAt ?? null
        },
        documents,
        driverPayment: {
          expectedPayAmountCents: frozenDriverPay?.amountCents ?? null,
          expectedPayCurrency: frozenDriverPay?.currency ?? null,
          expectedPayLabel: frozenDriverPay ? formatMoney(frozenDriverPay) : null,
          matchesExpected:
            frozenDriverPay && receivedPay
              ? frozenDriverPay.amountCents === receivedPay.amountCents &&
                frozenDriverPay.currency === receivedPay.currency
              : null,
          receivedPayLabel: receivedPay ? formatMoney(receivedPay) : null,
          receivedAt: assignment.driverPaymentReceivedAt ?? null,
          sentAt: assignment.driverPaymentSentAt ?? null,
          status: (
            assignment.driverPaymentReceivedAt
              ? "received"
              : assignment.driverPaymentSentAt
                ? "sent"
                : "not_sent"
          ) as NetworkView["trips"][number]["driverPayment"]["status"]
        },
        driverName: driverUser?.fullName ?? "Driver",
        driverProfileId: trip.driverProfileId,
        events,
        id: trip.id,
        inspection: inspectionRecord
          ? {
              failedItems: inspectionRecord.items
                .filter((item) => item.status === "fail")
                .map((item) => item.label),
              occurredAt: inspectionRecord.occurredAt,
              outcome: inspectionRecord.outcome
            }
          : null,
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

  const directOffers: DirectOfferView[] = state.directOffers
    .filter((offer) =>
      offer.offeredByOrganizationId === activeOrganization.id ||
      offer.offeredToOrganizationId === activeOrganization.id
    )
    .map((offer) => {
      const direction: DirectOfferView["direction"] = offer.offeredByOrganizationId === activeOrganization.id
        ? "sent"
        : "received"
      const counterpartOrganizationId = direction === "sent"
        ? offer.offeredToOrganizationId
        : offer.offeredByOrganizationId
      const counterpart = state.organizations.find((organization) => organization.id === counterpartOrganizationId)
      const load = state.loadPostings.find((candidate) => candidate.id === offer.loadPostingId)
      const capacity = state.opportunityCapacities.find((candidate) => candidate.loadPostingId === offer.loadPostingId)
      const acceptedTruckloads = directOfferClaimCount(state, offer.id)
      const relationshipActive = state.privateNetworkRelationships.some((relationship) =>
        relationship.status === "active" &&
        (
          (relationship.ownerOrganizationId === offer.offeredByOrganizationId &&
            relationship.partnerOrganizationId === offer.offeredToOrganizationId) ||
          (relationship.ownerOrganizationId === offer.offeredToOrganizationId &&
            relationship.partnerOrganizationId === offer.offeredByOrganizationId)
        )
      )

      return {
        acceptedTruckloads,
        actionable: directOfferIsClaimable(state, offer, atIso) &&
          Boolean(load && !load.archivedAt && ["open", "scheduled"].includes(load.status)) &&
          Boolean(capacity && capacity.remainingTruckloads > 0) &&
          relationshipActive,
        counterpartName: counterpart?.displayName ?? "Partner organization",
        direction,
        expiresAt: offer.expiresAt,
        id: offer.id,
        loadPostingId: offer.loadPostingId,
        loadTitle: load?.title ?? "Load no longer available",
        offeredTruckloads: offer.offeredTruckloads,
        remainingTruckloads: Math.max(0, offer.offeredTruckloads - acceptedTruckloads),
        respondedAt: offer.respondedAt ?? null,
        status: effectiveDirectOfferStatus(offer, atIso)
      }
    })
    .sort((left, right) => right.expiresAt.localeCompare(left.expiresAt))

  const organizationMemberIds = new Set(
    state.organizationMemberships
      .filter((membership) => membership.organizationId === activeOrganization.id && membership.status === "active")
      .map((membership) => membership.userId)
  )
  // Organization activity is workspace authority, not a global profile-role
  // shortcut. Platform administration has its own allowlisted read model; a
  // stale or corrupted `profiles.role = admin` must never widen a member's
  // tenant visibility here.
  const canSeeActivity = ["owner", "admin"].includes(activeMembership.role)

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
          featureTruckPhoto: currentDriverProfile.featureTruckPhoto ?? false,
          hasProfilePhoto: isViewableMediaReference(
            currentDriverProfile.profilePhoto
          ),
          name: currentUser.fullName,
          preferredFuelPriceCentsPerGallon: currentDriverProfile.preferredFuelPriceCentsPerGallon ?? null,
          trailerId: currentTrailer?.id ?? null,
          truckId: currentTruck?.id ?? null
        }
      : null,
    currentEquipment: currentCombination && currentTruck
      ? {
          combinationId: currentCombination.id,
          fuelEconomyMpg: currentTruck.fuelEconomyMpg ?? null,
          hasTrailerPhoto: isViewableMediaReference(currentTrailer?.photo),
          hasTruckPhoto: isViewableMediaReference(currentTruck.photo),
          label: currentCombination.label,
          trailerId: currentTrailer?.id ?? null,
          truckId: currentTruck.id
      }
      : null,
    directOffers,
    entitlements,
    futureAvailability,
    loads,
    messages,
    metrics: {
      activeAssignments: state.assignments.filter((assignment) =>
        VIEWER_ASSIGNMENT_STATUSES.includes(assignment.status) &&
        (activeMembership.role === "driver"
          ? assignment.driverProfileId === currentDriverProfile?.id
          : organizationOwnedDriverProfileIds.has(assignment.driverProfileId) ||
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
