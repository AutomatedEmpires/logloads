import {
  assignmentSchema,
  auditEventSchema,
  directOfferSchema,
  futureAvailabilitySchema,
  loadPostingSchema,
  operationalNoticeSchema,
  canTransitionAssignmentStatus,
  canTransitionAssignmentStatusV2,
  canTransitionLoadPostingStatus,
  evaluateLoadCompatibility,
  notificationSchema,
  organizationRoleCan,
  transitionAssignmentStatus,
  transitionLoadPostingStatus,
  transitionTruckSlotStatus,
  transitionTripStatus,
  tripDocumentSchema,
  tripEventSchema,
  tripSchemaV2,
  truckSlotSchema,
  type Assignment,
  type AssignmentStatus,
  type DirectOffer,
  type FutureAvailability,
  type LoadPosting,
  type LoadStatus,
  type NotificationType,
  type OperationalNotice,
  type OrganizationAction,
  type OrganizationMembership,
  type OpportunityCapacity,
  type RoutePack,
  type TripDocument,
  type TripEvent,
  type TripStatusV2,
  type TripV2
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { declineAssignment, requestAssignment } from "./assignments"
import { createLoadPosting, parsePublishModes, provisionLoadCapacity } from "./loads"
import { releaseTruckSlotReservation } from "./truck-slots"
import { assertCondition, assertFound, createUuid, nowIso } from "./utils"

export const DEFAULT_ACTOR_USER_ID = "22222222-2222-4222-8222-222222222221"
export const DEFAULT_ORGANIZATION_ID = "33333333-3333-4333-8333-333333333331"

const activeAssignmentStatuses = new Set<AssignmentStatus>([
  "requested",
  "offered",
  "accepted",
  "checked_in",
  "loading",
  "hauled"
])

const assignmentStatusByTripStatus: Partial<Record<TripStatusV2, AssignmentStatus>> = {
  at_destination: "hauled",
  checked_in: "checked_in",
  completed: "completed",
  en_route_to_destination: "hauled",
  loading: "loading",
  unloading: "hauled"
}

const tripEventByStatus: Record<TripStatusV2, TripEvent["type"]> = {
  assigned: "assignment_created",
  at_destination: "destination_arrival",
  cancelled: "cancelled",
  checked_in: "landing_check_in",
  completed: "completed",
  en_route_to_destination: "departed_landing",
  en_route_to_landing: "driver_status",
  loaded: "loaded",
  loading: "loading_started",
  unloading: "unloading_started"
}

export interface ActiveOrganizationContext {
  actorUserId: string
  membership: OrganizationMembership
  organizationId: string
}

export interface CapacityRequestInput {
  actorUserId?: string
  organizationId?: string
  loadPostingId: string
  truckSlotId: string
  driverProfileId: string
  truckProfileId: string
  trailerProfileId?: string | null
  cancellationReason?: string | null
  dispatcherNotes?: string | null
}

/**
 * Deliberately NOT part of CapacityRequestInput: web boundaries forward client
 * JSON into the input, and the validation clock must never be client-supplied.
 * Only trusted callers (tests pinning the fixture window) pass this.
 */
export interface CapacityRequestOptions {
  at?: string
}

export interface ApproveCapacityRequestInput {
  actorUserId?: string
  organizationId?: string
  assignmentId: string
}

export interface DeclineCapacityRequestInput extends ApproveCapacityRequestInput {
  reason?: string | null
}

export interface CancelAssignmentWithPolicyInput extends ApproveCapacityRequestInput {
  reason?: string | null
}

export interface ProgressTripStatusInput {
  actorUserId?: string
  organizationId?: string
  tripId: string
  nextStatus: TripStatusV2
  source: TripEvent["source"]
  note?: string | null
  metadata?: Record<string, unknown>
}

export interface RoutePackAccessInput {
  actorUserId?: string
  organizationId?: string
  assignmentId: string
}

export interface AttachTripDocumentInput {
  actorUserId?: string
  organizationId?: string
  tripId: string
  type: TripDocument["type"]
  storageProvider: TripDocument["storageProvider"]
  storageKey: string
  filename: string
  contentType: string
  auditMetadata?: Record<string, unknown>
}

export interface CreateOperationalNoticeInput {
  actorUserId?: string
  organizationId?: string
  relatedLoadId?: string | null
  relatedLandingId?: string | null
  relatedDestinationId?: string | null
  severity: OperationalNotice["severity"]
  title: string
  body: string
  effectiveAt?: string
  expiresAt?: string | null
}

export interface CreateDirectOfferInput {
  actorUserId?: string
  organizationId?: string
  loadPostingId: string
  offeredToOrganizationId: string
  offeredTruckloads: number
  expiresAt: string
  termsSnapshot?: Record<string, unknown>
}

export interface PublishFutureAvailabilityInput {
  actorUserId?: string
  organizationId?: string
  equipmentCombinationId: string
  startsAt: string
  endsAt: string
  status: FutureAvailability["status"]
  visibleToRelationshipIds?: string[]
  notes?: string | null
}

export interface AttentionItem {
  id: string
  severity: "info" | "watch" | "critical"
  title: string
  body: string
  relatedLoadId?: string | null
}

function requireText(value: unknown, label: string): string {
  assertCondition(typeof value === "string" && value.length > 0, `${label} is required`)
  return value as string
}

function getActorUserId(actorUserId?: string): string {
  return actorUserId ?? DEFAULT_ACTOR_USER_ID
}

function getOrganizationId(state: LogLoadsDatabaseState, actorUserId: string, organizationId?: string): string {
  if (organizationId) {
    return organizationId
  }

  const membership = getOrganizationMemberships(state, actorUserId)[0]

  return membership?.organizationId ?? DEFAULT_ORGANIZATION_ID
}

export function getOrganizationMemberships(
  state: LogLoadsDatabaseState,
  actorUserId: string
): OrganizationMembership[] {
  return state.organizationMemberships.filter(
    (membership) => membership.userId === actorUserId && membership.status === "active"
  )
}

export function getActiveOrganizationContext(
  state: LogLoadsDatabaseState,
  actorUserId = DEFAULT_ACTOR_USER_ID,
  organizationId = DEFAULT_ORGANIZATION_ID
): ActiveOrganizationContext {
  const membership = assertFound(
    state.organizationMemberships.find(
      (current) => current.userId === actorUserId && current.organizationId === organizationId && current.status === "active"
    ),
    `User ${actorUserId} is not an active member of organization ${organizationId}`
  )

  return {
    actorUserId,
    membership,
    organizationId
  }
}

export function assertOrganizationAction(
  context: ActiveOrganizationContext,
  action: OrganizationAction
): void {
  assertCondition(
    organizationRoleCan(context.membership.role, action),
    `${context.membership.role} cannot ${action.replaceAll("_", " ")}`
  )
}

function getContextForInput(
  state: LogLoadsDatabaseState,
  input: { actorUserId?: string; organizationId?: string }
): ActiveOrganizationContext {
  const actorUserId = getActorUserId(input.actorUserId)
  const organizationId = getOrganizationId(state, actorUserId, input.organizationId)

  return getActiveOrganizationContext(state, actorUserId, organizationId)
}

function activeRelationshipExists(state: LogLoadsDatabaseState, firstOrganizationId: string, secondOrganizationId: string): boolean {
  return state.privateNetworkRelationships.some((relationship) =>
    relationship.status === "active" &&
    (
      (relationship.ownerOrganizationId === firstOrganizationId && relationship.partnerOrganizationId === secondOrganizationId) ||
      (relationship.ownerOrganizationId === secondOrganizationId && relationship.partnerOrganizationId === firstOrganizationId)
    )
  )
}

function getOpportunityCapacity(state: LogLoadsDatabaseState, loadPostingId: string): OpportunityCapacity | undefined {
  return state.opportunityCapacities.find((capacity) => capacity.loadPostingId === loadPostingId)
}

function hasDirectOffer(state: LogLoadsDatabaseState, loadPostingId: string, organizationId: string): boolean {
  return state.directOffers.some(
    (offer) =>
      offer.loadPostingId === loadPostingId &&
      offer.offeredToOrganizationId === organizationId &&
      ["sent", "accepted"].includes(offer.status)
  )
}

export function isLoadVisibleToOrganization(
  state: LogLoadsDatabaseState,
  load: LoadPosting,
  organizationId: string
): boolean {
  if (load.companyId === organizationId) {
    return true
  }

  const capacity = getOpportunityCapacity(state, load.id)

  if (!capacity) {
    return load.status === "open"
  }

  if (capacity.visibilityMode === "open_network") {
    return true
  }

  // "verified_network" is a real gate, not a label: only organizations that
  // passed platform verification see the work.
  if (capacity.visibilityMode === "verified_network") {
    const organization = state.organizations.find((current) => current.id === organizationId)

    return organization?.verificationStatus === "verified"
  }

  if (capacity.visibilityMode === "direct_offer") {
    return hasDirectOffer(state, load.id, organizationId)
  }

  return activeRelationshipExists(state, load.companyId, organizationId) || hasDirectOffer(state, load.id, organizationId)
}

export function listVisibleLoadsForOrganization(
  state: LogLoadsDatabaseState,
  organizationId = DEFAULT_ORGANIZATION_ID
): LoadPosting[] {
  return state.loadPostings.filter((load) => load.status !== "archived" && isLoadVisibleToOrganization(state, load, organizationId))
}

/**
 * A load belongs on a live discovery surface only while a driver can still
 * acquire a future slot. Historical, filled, invite-only, and dispatch-assigned
 * work stays in the operating record but never masquerades as available work.
 */
export function isLoadRequestableAt(
  state: LogLoadsDatabaseState,
  load: LoadPosting,
  at = nowIso()
): boolean {
  if (load.archivedAt || !["open", "scheduled"].includes(load.status)) {
    return false
  }

  const capacity = getOpportunityCapacity(state, load.id)

  if (capacity && (capacity.remainingTruckloads <= 0 || capacity.allocationMode !== "request_approval")) {
    return false
  }

  // "reserved" stays requestable: a multi-truck loading day keeps accepting
  // requests until every position is taken (reservedCount reaches capacity).
  return state.truckSlots.some((slot) =>
    slot.loadPostingId === load.id &&
    ["open", "requested", "reserved"].includes(slot.status) &&
    slot.reservedCount < slot.capacity &&
    slot.endAt > at
  )
}

export function listRequestableLoadsForOrganization(
  state: LogLoadsDatabaseState,
  organizationId = DEFAULT_ORGANIZATION_ID,
  at = nowIso()
): LoadPosting[] {
  return listVisibleLoadsForOrganization(state, organizationId).filter((load) =>
    isLoadRequestableAt(state, load, at)
  )
}

function findEquipmentCombinationForAssignment(state: LogLoadsDatabaseState, assignment: Assignment) {
  return state.equipmentCombinations.find((combination) =>
    combination.truckProfileId === assignment.truckProfileId &&
    combination.trailerProfileId === (assignment.trailerProfileId ?? null) &&
    combination.assignedDriverProfileId === assignment.driverProfileId
  )
}

function assertEquipmentBelongsToOrganization(
  state: LogLoadsDatabaseState,
  organizationId: string,
  input: CapacityRequestInput
): void {
  const combination = state.equipmentCombinations.find((current) =>
    current.organizationId === organizationId &&
    current.truckProfileId === input.truckProfileId &&
    current.trailerProfileId === (input.trailerProfileId ?? null) &&
    current.assignedDriverProfileId === input.driverProfileId &&
    current.status !== "inactive"
  )

  assertCondition(
    Boolean(combination),
    "Requested driver, truck, and trailer must be an active equipment combination for the organization"
  )
}

function insertAuditEvent(
  state: LogLoadsDatabaseState,
  actorUserId: string | null,
  entityType: string,
  entityId: string,
  action: string,
  metadata: Record<string, unknown> = {}
): void {
  state.auditEvents.push(auditEventSchema.parse({
    action,
    actorUserId,
    createdAt: nowIso(),
    entityId,
    entityType,
    id: createUuid(),
    metadata
  }))
}

function insertNotification(
  state: LogLoadsDatabaseState,
  userId: string,
  title: string,
  body: string,
  relatedEntityType: string,
  relatedEntityId: string,
  type: NotificationType
): void {
  const timestamp = nowIso()

  state.notifications.push(notificationSchema.parse({
    body,
    createdAt: timestamp,
    id: createUuid(),
    readAt: null,
    relatedEntityId,
    relatedEntityType,
    title,
    type,
    updatedAt: timestamp,
    userId
  }))
}

function updateOpportunityCapacityAfterRequest(state: LogLoadsDatabaseState, capacity: OpportunityCapacity): void {
  const updated = {
    ...capacity,
    committedTruckloads: capacity.committedTruckloads + 1,
    remainingTruckloads: Math.max(0, capacity.remainingTruckloads - 1),
    updatedAt: nowIso()
  }

  state.opportunityCapacities = state.opportunityCapacities.map((current) =>
    current.id === capacity.id ? updated : current
  )
}

function updateOpportunityCapacityAfterDecline(state: LogLoadsDatabaseState, capacity: OpportunityCapacity): void {
  const committedTruckloads = Math.max(capacity.completedTruckloads, capacity.committedTruckloads - 1)
  const remainingTruckloads = Math.min(
    capacity.totalTruckloads - committedTruckloads,
    capacity.remainingTruckloads + 1
  )

  state.opportunityCapacities = state.opportunityCapacities.map((current) =>
    current.id === capacity.id
      ? { ...current, committedTruckloads, remainingTruckloads, updatedAt: nowIso() }
      : current
  )
}

function updateOpportunityCapacityAfterCompletion(state: LogLoadsDatabaseState, loadPostingId: string): void {
  const capacity = getOpportunityCapacity(state, loadPostingId)

  if (!capacity || capacity.completedTruckloads >= capacity.committedTruckloads) {
    return
  }

  state.opportunityCapacities = state.opportunityCapacities.map((current) =>
    current.id === capacity.id
      ? { ...current, completedTruckloads: current.completedTruckloads + 1, updatedAt: nowIso() }
      : current
  )
}

/**
 * The opportunity-capacity ledger is the source of truth for how full a load
 * is; the load's own status follows it. Runs after every capacity movement so
 * a load reads "filled" while fully committed, returns to "open" when a
 * cancellation or decline frees a truckload, and closes as "completed" once
 * every truckload is delivered. Loads a host cancelled (or that cannot legally
 * transition) are left untouched.
 */
function syncLoadStatusWithCapacity(state: LogLoadsDatabaseState, loadPostingId: string): void {
  const load = state.loadPostings.find((current) => current.id === loadPostingId)
  const capacity = getOpportunityCapacity(state, loadPostingId)

  if (!load || !capacity) {
    return
  }

  let next: LoadStatus | null = null

  if (capacity.remainingTruckloads <= 0) {
    next = capacity.completedTruckloads >= capacity.totalTruckloads ? "completed" : "filled"
  } else if (load.status === "filled") {
    next = "open"
  }

  if (!next || next === load.status || !canTransitionLoadPostingStatus(load.status, next)) {
    return
  }

  const previousStatus = load.status
  const updated = loadPostingSchema.parse({ ...load, status: next, updatedAt: nowIso() })

  state.loadPostings = state.loadPostings.map((current) => (current.id === load.id ? updated : current))
  insertAuditEvent(state, null, "load_posting", load.id, `status_${next}`, {
    nextStatus: next,
    previousStatus,
    source: "capacity_sync"
  })
}

function assignmentParticipantOrganizationIds(state: LogLoadsDatabaseState, assignment: Assignment): string[] {
  const load = assertFound(
    state.loadPostings.find((current) => current.id === assignment.loadPostingId),
    `Load posting ${assignment.loadPostingId} was not found`
  )
  const driver = assertFound(
    state.driverProfiles.find((current) => current.id === assignment.driverProfileId),
    `Driver profile ${assignment.driverProfileId} was not found`
  )
  const truck = assertFound(
    state.truckProfiles.find((current) => current.id === assignment.truckProfileId),
    `Truck profile ${assignment.truckProfileId} was not found`
  )

  return [load.companyId, driver.companyId, truck.companyId].filter((value): value is string => Boolean(value))
}

function assertTripParticipant(
  state: LogLoadsDatabaseState,
  context: ActiveOrganizationContext,
  assignment: Assignment
): void {
  const participantOrganizationIds = assignmentParticipantOrganizationIds(state, assignment)

  assertCondition(
    participantOrganizationIds.includes(context.organizationId),
    `Organization ${context.organizationId} is not a participant in assignment ${assignment.id}`
  )
}

export function requestCapacityWithPolicy(
  state: LogLoadsDatabaseState,
  input: CapacityRequestInput,
  options: CapacityRequestOptions = {}
): Assignment {
  const parsed: CapacityRequestInput = {
    actorUserId: input.actorUserId,
    cancellationReason: input.cancellationReason ?? null,
    dispatcherNotes: input.dispatcherNotes ?? null,
    driverProfileId: requireText(input.driverProfileId, "driverProfileId"),
    loadPostingId: requireText(input.loadPostingId, "loadPostingId"),
    organizationId: input.organizationId,
    trailerProfileId: input.trailerProfileId ?? null,
    truckProfileId: requireText(input.truckProfileId, "truckProfileId"),
    truckSlotId: requireText(input.truckSlotId, "truckSlotId")
  }
  const context = getContextForInput(state, parsed)
  assertOrganizationAction(context, "request_assignment")
  const selectedDriver = assertFound(
    state.driverProfiles.find((driver) => driver.id === parsed.driverProfileId),
    `Driver profile ${parsed.driverProfileId} was not found`
  )
  assertCondition(
    context.membership.role !== "driver" || selectedDriver.userId === context.actorUserId,
    "Drivers can only request assignments for their own driver profile"
  )
  assertEquipmentBelongsToOrganization(state, context.organizationId, parsed)

  const load = assertFound(
    state.loadPostings.find((current) => current.id === parsed.loadPostingId),
    `Load posting ${parsed.loadPostingId} was not found`
  )
  assertCondition(
    ["open", "scheduled"].includes(load.status),
    `Load posting ${load.id} is not accepting requests while ${load.status}`
  )
  assertCondition(
    isLoadVisibleToOrganization(state, load, context.organizationId),
    `Load posting ${load.id} is not visible to organization ${context.organizationId}`
  )

  const duplicate = state.assignments.find((assignment) =>
    assignment.loadPostingId === parsed.loadPostingId &&
    assignment.driverProfileId === parsed.driverProfileId &&
    activeAssignmentStatuses.has(assignment.status)
  )
  assertCondition(!duplicate, "Driver already has an active assignment request for this load")

  const capacity = getOpportunityCapacity(state, parsed.loadPostingId)
  assertCondition(!capacity || capacity.remainingTruckloads > 0, "No opportunity capacity remains for this load")
  assertCondition(
    !capacity || capacity.allocationMode === "request_approval",
    "This load is not accepting driver requests"
  )

  // The write path re-checks what discovery checks: a slot whose loading
  // window has passed must reject the request even when called directly.
  const slot = assertFound(
    state.truckSlots.find((current) => current.id === parsed.truckSlotId),
    `Truck slot ${parsed.truckSlotId} was not found`
  )
  const requestedAt = options.at ?? nowIso()
  assertCondition(slot.endAt > requestedAt, "This haul window has already passed")

  const truck = assertFound(
    state.truckProfiles.find((current) => current.id === parsed.truckProfileId),
    `Truck profile ${parsed.truckProfileId} was not found`
  )
  const trailer = parsed.trailerProfileId
    ? assertFound(state.trailerProfiles.find((current) => current.id === parsed.trailerProfileId), `Trailer profile ${parsed.trailerProfileId} was not found`)
    : null
  const route = state.haulRoutes.find((current) => current.id === load.routeId) ?? null
  const availabilityWindows = state.availabilityWindows.filter((window) => window.driverProfileId === parsed.driverProfileId)
  const compatibility = evaluateLoadCompatibility({ availabilityWindows, load, route, trailer, truck })

  assertCondition(
    compatibility.eligibility !== "ineligible",
    `Equipment is not eligible for this load: ${compatibility.hardFailures[0] ?? "compatibility failed"}`
  )

  const assignment = requestAssignment(state, parsed)

  if (capacity) {
    updateOpportunityCapacityAfterRequest(state, capacity)
    syncLoadStatusWithCapacity(state, parsed.loadPostingId)
  }

  insertAuditEvent(state, context.actorUserId, "assignment", assignment.id, "capacity_requested", {
    loadPostingId: parsed.loadPostingId,
    organizationId: context.organizationId
  })

  const dispatcher = state.dispatcherProfiles.find((profile) => profile.id === load.dispatcherProfileId)
  if (dispatcher) {
    insertNotification(
      state,
      dispatcher.userId,
      "Capacity request received",
      `${context.organizationId} requested ${load.title}.`,
      "assignment",
      assignment.id,
      "assignment_requested"
    )
  }

  return assignment
}

export function approveCapacityRequest(
  state: LogLoadsDatabaseState,
  input: ApproveCapacityRequestInput
): { assignment: Assignment; trip: TripV2 } {
  const assignmentId = requireText(input.assignmentId, "assignmentId")
  const context = getContextForInput(state, input)
  assertOrganizationAction(context, "assign_capacity")

  const assignment = assertFound(
    state.assignments.find((current) => current.id === assignmentId),
    `Assignment ${assignmentId} was not found`
  )
  const load = assertFound(
    state.loadPostings.find((current) => current.id === assignment.loadPostingId),
    `Load posting ${assignment.loadPostingId} was not found`
  )

  assertCondition(load.companyId === context.organizationId, "Only the source organization can approve capacity requests")
  assertCondition(
    ["requested", "offered"].includes(assignment.status),
    "Only a requested or offered assignment can be approved"
  )

  const existingTrip = state.tripsV2.find((trip) => trip.assignmentId === assignment.id)
  const routePack = state.routePacks.find((pack) => pack.loadPostingId === load.id) ?? null
  const equipmentCombination = assertFound(
    findEquipmentCombinationForAssignment(state, assignment),
    "The requested equipment combination was not found"
  )
  const rate = assertFound(state.rates.find((candidate) => candidate.id === load.rateId), `Rate ${load.rateId} was not found`)
  const route = assertFound(state.haulRoutes.find((candidate) => candidate.id === load.routeId), `Route ${load.routeId} was not found`)
  const slot = assertFound(
    state.truckSlots.find((candidate) => candidate.id === assignment.truckSlotId),
    `Truck slot ${assignment.truckSlotId} was not found`
  )
  const timestamp = nowIso()
  const offeredStatus = assignment.status === "requested"
    ? transitionAssignmentStatus("requested", "offered")
    : assignment.status
  const acceptedStatus = transitionAssignmentStatus(offeredStatus, "accepted")
  const acceptedAssignment = assignmentSchema.parse({
    ...assignment,
    assignedAt: timestamp,
    status: acceptedStatus,
    termsSnapshot: {
      acceptedAt: timestamp,
      baseRateCents: rate.baseRate.amountCents,
      currency: rate.baseRate.currency,
      estimatedDistanceMiles: route.estimatedDistanceMiles,
      estimatedTonsPerLoad: load.estimatedTonsPerLoad ?? null,
      fuelSurchargeCents: rate.fuelSurchargeCents,
      haulerOrganizationId: equipmentCombination?.organizationId ?? null,
      hostFee: {
        collectionState: "disabled_pending_legal_and_payment_approval",
        feeCents: null,
        proposedRateBps: 500
      },
      hostOrganizationId: load.companyId,
      loadPostingId: load.id,
      loadVersion: load.updatedAt,
      paymentMode: "off_platform",
      rateBasis: rate.rateType,
      rateId: rate.id
    },
    updatedAt: timestamp
  })
  const confirmedSlot = truckSlotSchema.parse({
    ...slot,
    status: slot.status === "requested" ? transitionTruckSlotStatus("requested", "reserved") : slot.status,
    updatedAt: timestamp
  })
  const trip = existingTrip ?? tripSchemaV2.parse({
    assignmentId: acceptedAssignment.id,
    completedAt: null,
    createdAt: timestamp,
    driverProfileId: acceptedAssignment.driverProfileId,
    equipmentCombinationId: equipmentCombination.id,
    id: createUuid(),
    lastSyncedAt: timestamp,
    loadPostingId: acceptedAssignment.loadPostingId,
    locationSharingEndsAt: null,
    locationSharingStartedAt: null,
    locationVisibility: "active_trip_participants",
    routePackId: routePack?.id ?? null,
    status: "assigned",
    updatedAt: timestamp
  })
  const tripEvent = existingTrip ? null : tripEventSchema.parse({
    actorUserId: context.actorUserId,
    createdAt: timestamp,
    id: createUuid(),
    metadata: { assignmentId: acceptedAssignment.id, routePackId: routePack?.id ?? null },
    note: "Assignment approved and trip created.",
    occurredAt: timestamp,
    source: "dispatcher",
    tripId: trip.id,
    type: "assignment_created"
  })

  state.assignments = state.assignments.map((current) =>
    current.id === acceptedAssignment.id ? acceptedAssignment : current
  )
  state.truckSlots = state.truckSlots.map((current) =>
    current.id === confirmedSlot.id ? confirmedSlot : current
  )

  if (existingTrip) {
    return { assignment: acceptedAssignment, trip: existingTrip }
  }

  state.tripsV2.push(trip)
  if (tripEvent) state.tripEvents.push(tripEvent)
  insertAuditEvent(state, context.actorUserId, "trip", trip.id, "created_from_assignment", {
    assignmentId: acceptedAssignment.id
  })

  const driver = state.driverProfiles.find((profile) => profile.id === acceptedAssignment.driverProfileId)
  if (driver) {
    insertNotification(
      state,
      driver.userId,
      "Assignment confirmed",
      `${load.title} is confirmed and the route pack is available.`,
      "assignment",
      acceptedAssignment.id,
      "assignment_confirmed"
    )
  }

  return { assignment: acceptedAssignment, trip }
}

export function declineCapacityRequest(
  state: LogLoadsDatabaseState,
  input: DeclineCapacityRequestInput
): Assignment {
  const assignmentId = requireText(input.assignmentId, "assignmentId")
  const context = getContextForInput(state, input)
  assertOrganizationAction(context, "assign_capacity")

  const assignment = assertFound(
    state.assignments.find((current) => current.id === assignmentId),
    `Assignment ${assignmentId} was not found`
  )
  const load = assertFound(
    state.loadPostings.find((current) => current.id === assignment.loadPostingId),
    `Load posting ${assignment.loadPostingId} was not found`
  )

  assertCondition(load.companyId === context.organizationId, "Only the source organization can decline capacity requests")
  assertCondition(
    ["requested", "offered"].includes(assignment.status),
    "Only a requested or offered assignment can be declined"
  )

  const declined = declineAssignment(
    state,
    assignment.id,
    input.reason?.trim() || "Another truck was selected for this haul."
  )
  const capacity = getOpportunityCapacity(state, load.id)

  if (capacity) {
    updateOpportunityCapacityAfterDecline(state, capacity)
    syncLoadStatusWithCapacity(state, load.id)
  }

  insertAuditEvent(state, context.actorUserId, "assignment", declined.id, "capacity_declined", {
    loadPostingId: load.id,
    organizationId: context.organizationId,
    reason: declined.cancellationReason
  })

  const driver = state.driverProfiles.find((profile) => profile.id === declined.driverProfileId)
  if (driver) {
    insertNotification(
      state,
      driver.userId,
      "Not selected for this haul",
      `${load.title} went to another truck. The capacity is available again if the host reopens the decision.`,
      "assignment",
      declined.id,
      "assignment_declined"
    )
  }

  return declined
}

/**
 * Cancelling an assignment must return everything the booking consumed:
 * the assignment row goes terminal, the truck-slot reservation is released,
 * committed opportunity capacity is restored, and the load's status follows
 * the ledger (a "filled" load reopens). Completed truckloads are never rolled
 * back — the clamp in the capacity math protects delivered work.
 */
function applyAssignmentCancellationEffects(
  state: LogLoadsDatabaseState,
  assignment: Assignment,
  reason: string,
  timestamp: string,
  actor: { actorUserId: string; cancelledBy: "host" | "hauler"; organizationId: string }
): Assignment | null {
  if (!canTransitionAssignmentStatus(assignment.status, "cancelled")) {
    return null
  }

  const cancelled = assignmentSchema.parse({
    ...assignment,
    cancellationReason: reason,
    cancelledAt: timestamp,
    status: transitionAssignmentStatus(assignment.status, "cancelled"),
    updatedAt: timestamp
  })

  state.assignments = state.assignments.map((current) => (current.id === cancelled.id ? cancelled : current))
  releaseTruckSlotReservation(state, assignment.truckSlotId)

  const capacity = getOpportunityCapacity(state, assignment.loadPostingId)
  if (capacity) {
    updateOpportunityCapacityAfterDecline(state, capacity)
    syncLoadStatusWithCapacity(state, assignment.loadPostingId)
  }

  // Every cancellation surface writes the same audit record, so the audit log
  // reads identically whether the booking or the trip was cancelled first.
  insertAuditEvent(state, actor.actorUserId, "assignment", cancelled.id, "assignment_cancelled", {
    cancelledBy: actor.cancelledBy,
    loadPostingId: assignment.loadPostingId,
    organizationId: actor.organizationId,
    reason
  })

  return cancelled
}

function notifyAssignmentCancelled(
  state: LogLoadsDatabaseState,
  load: LoadPosting,
  assignment: Assignment,
  reason: string,
  excludeUserId: string,
  wasBooked: boolean
): void {
  const driver = state.driverProfiles.find((profile) => profile.id === assignment.driverProfileId)
  const dispatcher = state.dispatcherProfiles.find((profile) => profile.id === load.dispatcherProfileId)
  const recipients = new Set(
    [driver?.userId, dispatcher?.userId].filter((userId): userId is string => Boolean(userId) && userId !== excludeUserId)
  )

  // A withdrawn pending request never was a booked haul — say so honestly.
  const title = wasBooked ? "Haul cancelled" : "Request withdrawn"
  const body = wasBooked
    ? `A booked haul on ${load.title} was cancelled. ${reason}`
    : `The request for ${load.title} was withdrawn. ${reason}`

  for (const userId of recipients) {
    insertNotification(
      state,
      userId,
      title,
      body,
      "assignment",
      assignment.id,
      "assignment_cancelled"
    )
  }
}

const MAX_CANCELLATION_REASON_LENGTH = 140

/**
 * One authorization rule for every cancellation surface (the policy entry
 * point AND the trip-cancel mirror): the assigned driver may always cancel
 * their own haul; any other driver-role member may not; host-organization
 * staff need assign_capacity; hauler-organization staff need
 * request_assignment. Callers must already have proven trip participation.
 */
function assertCancellationAuthority(
  state: LogLoadsDatabaseState,
  context: ActiveOrganizationContext,
  assignment: Assignment,
  load: LoadPosting
): { side: "host" | "hauler" } {
  const driver = assertFound(
    state.driverProfiles.find((current) => current.id === assignment.driverProfileId),
    `Driver profile ${assignment.driverProfileId} was not found`
  )

  if (driver.userId === context.actorUserId) {
    assertOrganizationAction(context, "request_assignment")
    return { side: "hauler" }
  }

  assertCondition(context.membership.role !== "driver", "Drivers can only cancel their own hauls")

  if (load.companyId === context.organizationId) {
    assertOrganizationAction(context, "assign_capacity")
    return { side: "host" }
  }

  assertOrganizationAction(context, "request_assignment")
  return { side: "hauler" }
}

export function cancelAssignmentWithPolicy(
  state: LogLoadsDatabaseState,
  input: CancelAssignmentWithPolicyInput
): { assignment: Assignment; trip: TripV2 | null } {
  const assignmentId = requireText(input.assignmentId, "assignmentId")
  const context = getContextForInput(state, input)

  const assignment = assertFound(
    state.assignments.find((current) => current.id === assignmentId),
    `Assignment ${assignmentId} was not found`
  )
  const load = assertFound(
    state.loadPostings.find((current) => current.id === assignment.loadPostingId),
    `Load posting ${assignment.loadPostingId} was not found`
  )

  assertTripParticipant(state, context, assignment)

  const { side } = assertCancellationAuthority(state, context, assignment, load)

  assertCondition(
    activeAssignmentStatuses.has(assignment.status),
    `Only an active assignment can be cancelled, and this one is ${assignment.status}`
  )

  const providedReason = input.reason?.trim() ?? ""
  assertCondition(
    providedReason.length <= MAX_CANCELLATION_REASON_LENGTH,
    `Keep the cancellation reason under ${MAX_CANCELLATION_REASON_LENGTH} characters`
  )

  const reason = providedReason || (side === "host" ? "Cancelled by the host." : "Cancelled by the hauler.")
  const wasBooked = !["requested", "offered"].includes(assignment.status)
  const timestamp = nowIso()

  const trip = state.tripsV2.find((current) => current.assignmentId === assignment.id) ?? null
  let cancelledTrip: TripV2 | null = null

  if (trip && !["cancelled", "completed"].includes(trip.status)) {
    cancelledTrip = tripSchemaV2.parse({
      ...trip,
      lastSyncedAt: timestamp,
      locationSharingEndsAt: timestamp,
      status: transitionTripStatus(trip.status, "cancelled"),
      updatedAt: timestamp
    })
    state.tripsV2 = state.tripsV2.map((current) => (current.id === trip.id ? cancelledTrip! : current))
    state.tripEvents.push(tripEventSchema.parse({
      actorUserId: context.actorUserId,
      createdAt: timestamp,
      id: createUuid(),
      metadata: { assignmentId: assignment.id, reason },
      note: reason,
      occurredAt: timestamp,
      source: side === "host" ? "dispatcher" : "driver",
      tripId: trip.id,
      type: "cancelled"
    }))
    insertAuditEvent(state, context.actorUserId, "trip", trip.id, "status_cancelled", {
      nextStatus: "cancelled",
      previousStatus: trip.status,
      reason
    })
  }

  const cancelled = applyAssignmentCancellationEffects(state, assignment, reason, timestamp, {
    actorUserId: context.actorUserId,
    cancelledBy: side,
    organizationId: context.organizationId
  })

  if (!cancelled) {
    throw new Error(`Assignment ${assignment.id} cannot be cancelled while ${assignment.status}`)
  }

  notifyAssignmentCancelled(state, load, cancelled, reason, context.actorUserId, wasBooked)

  return { assignment: cancelled, trip: cancelledTrip ?? trip }
}

export interface CreateLoadPostingWithPolicyInput {
  actorUserId?: string
  organizationId?: string
  [key: string]: unknown
}

/**
 * The authorized publishing entry point: only members whose role carries
 * publish_load may post work, and the posting is always stamped with the
 * actor's own organization — client payloads can never publish as another org.
 */
export function createLoadPostingWithPolicy(
  state: LogLoadsDatabaseState,
  input: CreateLoadPostingWithPolicyInput
): LoadPosting {
  const context = getContextForInput(state, input)
  assertOrganizationAction(context, "publish_load")

  const entity = createLoadPosting(state, { ...input, companyId: context.organizationId })

  insertAuditEvent(
    state,
    context.actorUserId,
    "load_posting",
    entity.id,
    entity.status === "draft" ? "load_drafted" : "load_published",
    { organizationId: context.organizationId, status: entity.status }
  )

  return entity
}

export interface OpenDraftLoadPostingInput {
  actorUserId?: string
  organizationId?: string
  loadPostingId: string
  visibilityMode?: string
  allocationMode?: string
}

/**
 * Publishes a draft: the status transitions draft -> open and the capacity
 * ledger plus loading slots are minted, exactly as if the load had been
 * published live — closing the dead end where a draft could never become
 * requestable work.
 */
export function openDraftLoadPosting(state: LogLoadsDatabaseState, input: OpenDraftLoadPostingInput): LoadPosting {
  const context = getContextForInput(state, input)
  assertOrganizationAction(context, "publish_load")

  const load = assertFound(
    state.loadPostings.find((current) => current.id === input.loadPostingId),
    `Load posting ${input.loadPostingId} was not found`
  )
  assertCondition(load.companyId === context.organizationId, "Only the posting organization can publish this draft")
  assertCondition(load.status === "draft", `Only a draft can be published this way, and this work is ${load.status}`)
  assertCondition(
    !state.opportunityCapacities.some((capacity) => capacity.loadPostingId === load.id),
    "This work already has provisioned capacity"
  )

  // Validate the reach before touching the load: a refused mode must not leave
  // the work flipped to open with no capacity behind it.
  const modes = parsePublishModes(
    input.visibilityMode ?? "open_network",
    input.allocationMode ?? "request_approval"
  )

  const timestamp = nowIso()
  const updated = loadPostingSchema.parse({
    ...load,
    status: canTransitionLoadPostingStatus(load.status, "open") ? "open" : load.status,
    updatedAt: timestamp
  })

  state.loadPostings = state.loadPostings.map((current) => (current.id === load.id ? updated : current))
  provisionLoadCapacity(state, updated, modes.visibilityMode, modes.allocationMode, timestamp)

  insertAuditEvent(state, context.actorUserId, "load_posting", load.id, "load_published", {
    organizationId: context.organizationId,
    previousStatus: "draft",
    status: updated.status
  })

  return updated
}

export interface CloseLoadPostingInput {
  actorUserId?: string
  organizationId?: string
  loadPostingId: string
  reason?: string | null
}

/**
 * Closes availability: pending requests are declined (with capacity returned
 * and drivers notified), remaining loading slots are cancelled, and the load
 * goes terminal. Booked hauls block the close — cancel them individually
 * first, so committed work is never silently destroyed.
 */
export function closeLoadPosting(state: LogLoadsDatabaseState, input: CloseLoadPostingInput): LoadPosting {
  const context = getContextForInput(state, input)
  assertOrganizationAction(context, "publish_load")

  const load = assertFound(
    state.loadPostings.find((current) => current.id === input.loadPostingId),
    `Load posting ${input.loadPostingId} was not found`
  )
  assertCondition(load.companyId === context.organizationId, "Only the posting organization can close this work")
  assertCondition(
    canTransitionLoadPostingStatus(load.status, "cancelled"),
    `This work is already ${load.status} and cannot be closed`
  )

  const providedReason = input.reason?.trim() ?? ""
  assertCondition(
    providedReason.length <= MAX_CANCELLATION_REASON_LENGTH,
    `Keep the cancellation reason under ${MAX_CANCELLATION_REASON_LENGTH} characters`
  )
  const reason = providedReason || "The host closed this work."

  const bookedStatuses: AssignmentStatus[] = ["accepted", "checked_in", "loading", "hauled"]
  const booked = state.assignments.filter(
    (assignment) => assignment.loadPostingId === load.id && bookedStatuses.includes(assignment.status)
  )
  assertCondition(booked.length === 0, "Cancel the booked hauls first, then close this work")

  const pending = state.assignments.filter(
    (assignment) => assignment.loadPostingId === load.id && ["requested", "offered"].includes(assignment.status)
  )

  for (const assignment of pending) {
    const declined = declineAssignment(state, assignment.id, reason)
    const capacity = getOpportunityCapacity(state, load.id)

    if (capacity) {
      updateOpportunityCapacityAfterDecline(state, capacity)
    }

    const driver = state.driverProfiles.find((profile) => profile.id === declined.driverProfileId)
    if (driver) {
      insertNotification(
        state,
        driver.userId,
        "Work closed by the host",
        `${load.title} is no longer available. ${reason}`,
        "assignment",
        declined.id,
        "assignment_declined"
      )
    }
  }

  const timestamp = nowIso()

  state.truckSlots = state.truckSlots.map((slot) => {
    if (slot.loadPostingId !== load.id || ["cancelled", "completed"].includes(slot.status)) {
      return slot
    }

    return truckSlotSchema.parse({
      ...slot,
      status: transitionTruckSlotStatus(slot.status, "cancelled"),
      updatedAt: timestamp
    })
  })

  const current = assertFound(
    state.loadPostings.find((candidate) => candidate.id === load.id),
    `Load posting ${load.id} was not found`
  )
  const closed = loadPostingSchema.parse({
    ...current,
    cancellationReason: reason,
    status: transitionLoadPostingStatus(current.status, "cancelled"),
    updatedAt: timestamp
  })

  state.loadPostings = state.loadPostings.map((candidate) => (candidate.id === closed.id ? closed : candidate))

  insertAuditEvent(state, context.actorUserId, "load_posting", closed.id, "load_closed", {
    declinedRequests: pending.length,
    organizationId: context.organizationId,
    reason
  })

  return closed
}

export function progressTripStatus(
  state: LogLoadsDatabaseState,
  input: ProgressTripStatusInput
): { trip: TripV2; event: TripEvent } {
  const context = getContextForInput(state, input)
  assertOrganizationAction(context, "progress_trip")

  const trip = assertFound(
    state.tripsV2.find((current) => current.id === input.tripId),
    `Trip ${input.tripId} was not found`
  )
  const assignment = assertFound(
    state.assignments.find((current) => current.id === trip.assignmentId),
    `Assignment ${trip.assignmentId} was not found`
  )
  assertTripParticipant(state, context, assignment)

  // Cancelling a trip cancels the booking, so it demands the same authority
  // as cancelAssignmentWithPolicy — trip-progression rights are not enough.
  let cancellationSide: "host" | "hauler" | null = null
  if (input.nextStatus === "cancelled") {
    const load = assertFound(
      state.loadPostings.find((current) => current.id === trip.loadPostingId),
      `Load posting ${trip.loadPostingId} was not found`
    )
    cancellationSide = assertCancellationAuthority(state, context, assignment, load).side
  }

  const nextStatus = transitionTripStatus(trip.status, input.nextStatus)
  const timestamp = nowIso()
  const updatedTrip = tripSchemaV2.parse({
    ...trip,
    completedAt: nextStatus === "completed" ? timestamp : trip.completedAt,
    lastSyncedAt: timestamp,
    locationSharingEndsAt: nextStatus === "completed" || nextStatus === "cancelled" ? timestamp : trip.locationSharingEndsAt,
    status: nextStatus,
    updatedAt: timestamp
  })

  state.tripsV2 = state.tripsV2.map((current) => current.id === trip.id ? updatedTrip : current)

  const nextAssignmentStatus = assignmentStatusByTripStatus[nextStatus]
  if (nextAssignmentStatus && assignment.status !== nextAssignmentStatus && canTransitionAssignmentStatusV2(assignment.status, nextAssignmentStatus)) {
    const updatedAssignment = assignmentSchema.parse({
      ...assignment,
      completedAt: nextAssignmentStatus === "completed" ? timestamp : assignment.completedAt,
      status: nextAssignmentStatus,
      updatedAt: timestamp
    })

    state.assignments = state.assignments.map((current) => current.id === assignment.id ? updatedAssignment : current)
  }

  if (nextStatus === "completed") {
    updateOpportunityCapacityAfterCompletion(state, trip.loadPostingId)
    syncLoadStatusWithCapacity(state, trip.loadPostingId)
  }

  // A cancelled trip cancels its booking: the assignment goes terminal, the
  // slot reservation is released, and committed capacity returns to the load.
  if (nextStatus === "cancelled") {
    const reason = (input.note?.trim() || "Trip cancelled.").slice(0, MAX_CANCELLATION_REASON_LENGTH)
    const wasBooked = !["requested", "offered"].includes(assignment.status)
    const cancelledAssignment = applyAssignmentCancellationEffects(state, assignment, reason, timestamp, {
      actorUserId: context.actorUserId,
      cancelledBy: cancellationSide ?? "hauler",
      organizationId: context.organizationId
    })

    if (cancelledAssignment) {
      const load = state.loadPostings.find((current) => current.id === trip.loadPostingId)
      if (load) {
        notifyAssignmentCancelled(state, load, cancelledAssignment, reason, context.actorUserId, wasBooked)
      }
    }
  }

  const event = tripEventSchema.parse({
    actorUserId: context.actorUserId,
    createdAt: timestamp,
    id: createUuid(),
    metadata: input.metadata ?? {},
    note: input.note ?? null,
    occurredAt: timestamp,
    source: input.source,
    tripId: trip.id,
    type: tripEventByStatus[nextStatus]
  })

  state.tripEvents.push(event)
  insertAuditEvent(state, context.actorUserId, "trip", trip.id, `status_${nextStatus}`, {
    previousStatus: trip.status,
    nextStatus
  })

  return { event, trip: updatedTrip }
}

export function getRoutePackForAssignment(
  state: LogLoadsDatabaseState,
  input: RoutePackAccessInput
): { routePack: RoutePack; notices: OperationalNotice[] } {
  const context = getContextForInput(state, input)
  assertOrganizationAction(context, "view_network")

  const assignment = assertFound(
    state.assignments.find((current) => current.id === input.assignmentId),
    `Assignment ${input.assignmentId} was not found`
  )
  assertTripParticipant(state, context, assignment)

  const load = assertFound(
    state.loadPostings.find((current) => current.id === assignment.loadPostingId),
    `Load posting ${assignment.loadPostingId} was not found`
  )
  const ownerAccess = load.companyId === context.organizationId
  const acceptedAccess = ["accepted", "checked_in", "loading", "hauled", "completed"].includes(assignment.status)

  assertCondition(
    ownerAccess || acceptedAccess,
    "The Route Pack unlocks after the host accepts the haul"
  )

  const routePack = assertFound(
    state.routePacks.find((pack) => pack.loadPostingId === assignment.loadPostingId),
    `Route pack for assignment ${assignment.id} was not found`
  )

  const notices = state.operationalNotices.filter((notice) =>
    notice.relatedLoadId === assignment.loadPostingId ||
    notice.relatedLandingId === routePack.landingId ||
    notice.relatedDestinationId === routePack.destinationId
  )

  return { notices, routePack }
}

export function attachTripDocument(state: LogLoadsDatabaseState, input: AttachTripDocumentInput): TripDocument {
  const context = getContextForInput(state, input)
  assertOrganizationAction(context, "progress_trip")

  const trip = assertFound(
    state.tripsV2.find((current) => current.id === input.tripId),
    `Trip ${input.tripId} was not found`
  )
  const assignment = assertFound(
    state.assignments.find((current) => current.id === trip.assignmentId),
    `Assignment ${trip.assignmentId} was not found`
  )
  assertTripParticipant(state, context, assignment)

  const document = tripDocumentSchema.parse({
    auditMetadata: input.auditMetadata ?? {},
    contentType: requireText(input.contentType, "contentType"),
    filename: requireText(input.filename, "filename"),
    id: createUuid(),
    processingStatus: "uploaded",
    storageKey: requireText(input.storageKey, "storageKey"),
    storageProvider: input.storageProvider,
    tripId: trip.id,
    type: input.type,
    uploadedAt: nowIso(),
    uploadedByUserId: context.actorUserId
  })

  state.tripDocuments.push(document)
  state.tripEvents.push(tripEventSchema.parse({
    actorUserId: context.actorUserId,
    createdAt: document.uploadedAt,
    id: createUuid(),
    metadata: { documentId: document.id },
    note: `${document.type.replaceAll("_", " ")} uploaded.`,
    occurredAt: document.uploadedAt,
    source: "driver",
    tripId: trip.id,
    type: "ticket_uploaded"
  }))

  return document
}


export function createOperationalNotice(state: LogLoadsDatabaseState, input: CreateOperationalNoticeInput): OperationalNotice {
  const context = getContextForInput(state, input)
  assertOrganizationAction(context, "send_operational_notice")

  if (input.relatedLoadId) {
    const load = assertFound(
      state.loadPostings.find((current) => current.id === input.relatedLoadId),
      `Load posting ${input.relatedLoadId} was not found`
    )
    assertCondition(
      load.companyId === context.organizationId || isLoadVisibleToOrganization(state, load, context.organizationId),
      `Load posting ${load.id} is not visible to organization ${context.organizationId}`
    )
  }

  const notice = operationalNoticeSchema.parse({
    body: requireText(input.body, "body"),
    createdAt: nowIso(),
    effectiveAt: input.effectiveAt ?? nowIso(),
    expiresAt: input.expiresAt ?? null,
    id: createUuid(),
    organizationId: context.organizationId,
    relatedDestinationId: input.relatedDestinationId ?? null,
    relatedLandingId: input.relatedLandingId ?? null,
    relatedLoadId: input.relatedLoadId ?? null,
    severity: input.severity,
    title: requireText(input.title, "title")
  })

  state.operationalNotices.push(notice)
  insertAuditEvent(state, context.actorUserId, "operational_notice", notice.id, "created", {
    relatedLoadId: notice.relatedLoadId,
    severity: notice.severity
  })

  if (notice.relatedLoadId) {
    const affectedAssignments = state.assignments.filter((assignment) =>
      assignment.loadPostingId === notice.relatedLoadId && activeAssignmentStatuses.has(assignment.status)
    )

    for (const assignment of affectedAssignments) {
      const driver = state.driverProfiles.find((profile) => profile.id === assignment.driverProfileId)
      if (driver) {
        insertNotification(
          state,
          driver.userId,
          notice.title,
          notice.body,
          "operational_notice",
          notice.id,
          "system_alert"
        )
      }
    }
  }

  return notice
}

export function createDirectOffer(state: LogLoadsDatabaseState, input: CreateDirectOfferInput): DirectOffer {
  const context = getContextForInput(state, input)
  assertOrganizationAction(context, "assign_capacity")
  const load = assertFound(
    state.loadPostings.find((current) => current.id === input.loadPostingId),
    `Load posting ${input.loadPostingId} was not found`
  )
  assertCondition(load.companyId === context.organizationId, "Only the source organization can send a direct offer")
  assertCondition(
    activeRelationshipExists(state, context.organizationId, input.offeredToOrganizationId),
    "Direct offers require an active private-network relationship"
  )

  const offer = directOfferSchema.parse({
    createdAt: nowIso(),
    expiresAt: input.expiresAt,
    id: createUuid(),
    loadPostingId: load.id,
    offeredByOrganizationId: context.organizationId,
    offeredToOrganizationId: requireText(input.offeredToOrganizationId, "offeredToOrganizationId"),
    offeredTruckloads: input.offeredTruckloads,
    respondedAt: null,
    status: "sent",
    termsSnapshot: input.termsSnapshot ?? {},
    updatedAt: nowIso()
  })

  state.directOffers.push(offer)
  insertAuditEvent(state, context.actorUserId, "direct_offer", offer.id, "sent", {
    loadPostingId: load.id,
    offeredToOrganizationId: offer.offeredToOrganizationId,
    offeredTruckloads: offer.offeredTruckloads
  })

  for (const membership of state.organizationMemberships.filter((membership) =>
    membership.organizationId === offer.offeredToOrganizationId &&
    membership.status === "active" &&
    ["owner", "admin", "dispatcher", "fleet_manager"].includes(membership.role)
  )) {
    insertNotification(
      state,
      membership.userId,
      "Direct offer received",
      `${load.title} was offered directly to your organization.`,
      "direct_offer",
      offer.id,
      "system_alert"
    )
  }

  return offer
}

export function publishFutureAvailability(
  state: LogLoadsDatabaseState,
  input: PublishFutureAvailabilityInput
): FutureAvailability {
  const context = getContextForInput(state, input)
  assertOrganizationAction(context, "manage_trucks")
  const combination = assertFound(
    state.equipmentCombinations.find((current) => current.id === input.equipmentCombinationId),
    `Equipment combination ${input.equipmentCombinationId} was not found`
  )
  assertCondition(combination.organizationId === context.organizationId, "Equipment availability must belong to the active organization")

  const availability = futureAvailabilitySchema.parse({
    createdAt: nowIso(),
    endsAt: input.endsAt,
    equipmentCombinationId: combination.id,
    id: createUuid(),
    notes: input.notes ?? null,
    organizationId: context.organizationId,
    startsAt: input.startsAt,
    status: input.status,
    updatedAt: nowIso(),
    visibleToRelationshipIds: input.visibleToRelationshipIds ?? []
  })

  state.futureAvailability.push(availability)
  insertAuditEvent(state, context.actorUserId, "future_availability", availability.id, "published", {
    equipmentCombinationId: combination.id,
    status: availability.status
  })

  return availability
}

export function listAttentionItems(state: LogLoadsDatabaseState, organizationId = DEFAULT_ORGANIZATION_ID): AttentionItem[] {
  const notices = state.operationalNotices
    .filter((notice) => !notice.expiresAt || notice.expiresAt >= nowIso())
    .filter((notice) => notice.organizationId === organizationId || !notice.relatedLoadId || listVisibleLoadsForOrganization(state, organizationId).some((load) => load.id === notice.relatedLoadId))
    .map((notice): AttentionItem => ({
      body: notice.body,
      id: notice.id,
      relatedLoadId: notice.relatedLoadId,
      severity: notice.severity,
      title: notice.title
    }))

  const lowCapacity = state.opportunityCapacities
    .filter((capacity) => capacity.remainingTruckloads === 0 && capacity.completedTruckloads < capacity.totalTruckloads)
    .map((capacity): AttentionItem => ({
      body: "Opportunity has no remaining requestable capacity but is not fully completed.",
      id: `capacity-${capacity.id}`,
      relatedLoadId: capacity.loadPostingId,
      severity: "watch",
      title: "Capacity fully committed"
    }))

  return [...notices, ...lowCapacity]
}

export function listEntitlements(state: LogLoadsDatabaseState, organizationId = DEFAULT_ORGANIZATION_ID) {
  return state.entitlements.filter((entitlement) => entitlement.organizationId === organizationId)
}

export function listPrivateNetworkRelationships(state: LogLoadsDatabaseState, organizationId = DEFAULT_ORGANIZATION_ID) {
  return state.privateNetworkRelationships.filter((relationship) =>
    relationship.ownerOrganizationId === organizationId || relationship.partnerOrganizationId === organizationId
  )
}

export function listFutureAvailabilityForOrganization(state: LogLoadsDatabaseState, organizationId = DEFAULT_ORGANIZATION_ID) {
  const visibleRelationshipIds = listPrivateNetworkRelationships(state, organizationId).map((relationship) => relationship.id)

  return state.futureAvailability.filter((availability) =>
    availability.organizationId === organizationId ||
    availability.visibleToRelationshipIds.some((relationshipId) => visibleRelationshipIds.includes(relationshipId))
  )
}
