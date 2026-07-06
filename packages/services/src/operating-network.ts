import {
  assignmentSchema,
  auditEventSchema,
  directOfferSchema,
  futureAvailabilitySchema,
  operationalNoticeSchema,
  canTransitionAssignmentStatusV2,
  evaluateLoadCompatibility,
  notificationSchema,
  organizationRoleCan,
  transitionTripStatus,
  tripDocumentSchema,
  tripEventSchema,
  tripSchemaV2,
  type Assignment,
  type AssignmentStatus,
  type DirectOffer,
  type FutureAvailability,
  type LoadPosting,
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

import { assignDriverToSlot, requestAssignment } from "./assignments"
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

export interface ApproveCapacityRequestInput {
  actorUserId?: string
  organizationId?: string
  assignmentId: string
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

  if (["open_network", "verified_network"].includes(capacity.visibilityMode)) {
    return true
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
  relatedEntityId: string
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
    type: relatedEntityType === "assignment" ? "assignment_requested" : "system_alert",
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

export function requestCapacityWithPolicy(state: LogLoadsDatabaseState, input: CapacityRequestInput): Assignment {
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
  assertEquipmentBelongsToOrganization(state, context.organizationId, parsed)

  const load = assertFound(
    state.loadPostings.find((current) => current.id === parsed.loadPostingId),
    `Load posting ${parsed.loadPostingId} was not found`
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
      assignment.id
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

  const acceptedAssignment = assignDriverToSlot(state, assignment.id)
  const existingTrip = state.tripsV2.find((trip) => trip.assignmentId === assignment.id)
  const routePack = state.routePacks.find((pack) => pack.loadPostingId === load.id) ?? null
  const equipmentCombination = findEquipmentCombinationForAssignment(state, acceptedAssignment) ?? null

  if (existingTrip) {
    return { assignment: acceptedAssignment, trip: existingTrip }
  }

  const timestamp = nowIso()
  const trip = tripSchemaV2.parse({
    assignmentId: acceptedAssignment.id,
    completedAt: null,
    createdAt: timestamp,
    driverProfileId: acceptedAssignment.driverProfileId,
    equipmentCombinationId: equipmentCombination?.id ?? null,
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

  state.tripsV2.push(trip)
  state.tripEvents.push(tripEventSchema.parse({
    actorUserId: context.actorUserId,
    createdAt: timestamp,
    id: createUuid(),
    metadata: { assignmentId: acceptedAssignment.id, routePackId: routePack?.id ?? null },
    note: "Assignment approved and trip created.",
    occurredAt: timestamp,
    source: "dispatcher",
    tripId: trip.id,
    type: "assignment_created"
  }))
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
      acceptedAssignment.id
    )
  }

  return { assignment: acceptedAssignment, trip }
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
          notice.id
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
    insertNotification(state, membership.userId, "Direct offer received", `${load.title} was offered directly to your organization.`, "direct_offer", offer.id)
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
    .filter((notice) => !notice.expiresAt || notice.expiresAt >= "2026-06-05T00:00:00.000Z")
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
