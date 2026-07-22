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
  mediaReferenceSchema,
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
  type DeliveredQuantity,
  type DirectOffer,
  type HaulException,
  type FutureAvailability,
  type LoadPosting,
  type LoadStatus,
  type MediaReference,
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
import { upsertAvailabilityWindow } from "./availability"
import {
  applyHaulCompletionConfirmation,
  applyHaulCompletionDispute,
  applyHaulCompletionSubmission,
  exceptionWaivesEvidence,
  getTripById,
  hasCompletionEvidence,
  requiredCompletionEvidence
} from "./haul-completion"
import { createLoadPosting, parsePublishModes, provisionLoadCapacity } from "./loads"
import {
  buildAssignmentRoutePack,
  findAssignmentRoutePack,
  loadPostingHasOwnedCoherentSources,
  listAssignmentRoutePackVersions,
  regenerateAssignmentRoutePack,
  routePackIsSafeToRead
} from "./route-packs"
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

interface InternalCapacityRequestOptions extends CapacityRequestOptions {
  directOfferId?: string
  suppressRequestNotification?: boolean
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
  /**
   * The asset as the caller's provider read it back — never as a client
   * described it. Storage provider, key, and content type are derived from
   * this, so a caller cannot name a file it did not upload.
   */
  media: MediaReference
  filename: string
}

export interface TripDocumentTarget {
  tripId: string
  publicIdPrefix: string
}

/**
 * Reading a haul's paperwork and adding to it are different rights.
 *
 * Filing proof is operating the haul (`progress_trip`). Reading it is not: the
 * role that settles a delivery is `assign_capacity`, and `landing_manager` holds
 * that without ever holding `progress_trip`. Gating the read on the write action
 * would hand the settling role a document it is forbidden to open — asking it to
 * confirm a figure it cannot check, which is the exact failure this feature
 * exists to end. A scale ticket is the commercial record of the haul, not the
 * private location detail `view_private_location` guards on a Route Pack, so
 * anyone who can see the trip can see what it delivered.
 */
export type TripDocumentAccess = "read" | "write"

const TRIP_DOCUMENT_ACTIONS: Record<TripDocumentAccess, OrganizationAction> = {
  read: "view_network",
  write: "progress_trip"
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
}

/** Trusted clock override for deterministic service tests; never client input. */
export interface DirectOfferMutationOptions {
  at?: string
}

export interface DirectOfferResponseInput {
  actorUserId?: string
  organizationId?: string
  directOfferId: string
}

export interface ClaimDirectOfferInput extends DirectOfferResponseInput {
  equipmentCombinationId: string
  truckSlotId: string
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

export function directOfferClaimCount(state: LogLoadsDatabaseState, directOfferId: string): number {
  // A claim is historical once accepted. Cancellation releases operating
  // capacity, but it must not silently reopen an invitation the host already
  // acted on; the host sends a new offer when replacement work is wanted.
  return state.assignments.filter((assignment) => assignment.directOfferId === directOfferId).length
}

export function effectiveDirectOfferStatus(offer: DirectOffer, at = nowIso()): DirectOffer["status"] {
  return offer.status === "sent" && Date.parse(offer.expiresAt) <= Date.parse(at) ? "expired" : offer.status
}

export function directOfferIsClaimable(
  state: LogLoadsDatabaseState,
  offer: DirectOffer,
  at = nowIso()
): boolean {
  return (
    effectiveDirectOfferStatus(offer, at) === "sent" &&
    directOfferClaimCount(state, offer.id) < offer.offeredTruckloads
  )
}

function hasDirectOffer(
  state: LogLoadsDatabaseState,
  loadPostingId: string,
  organizationId: string,
  at = nowIso()
): boolean {
  return state.directOffers.some((offer) => {
    if (offer.loadPostingId !== loadPostingId || offer.offeredToOrganizationId !== organizationId) {
      return false
    }

    // Once a truck was accepted, the receiving organization keeps access to
    // that operating record even after the unused invitation window closes.
    return directOfferClaimCount(state, offer.id) > 0 || ["sent", "accepted"].includes(effectiveDirectOfferStatus(offer, at))
  })
}

export function isLoadVisibleToOrganization(
  state: LogLoadsDatabaseState,
  load: LoadPosting,
  organizationId: string,
  at = nowIso()
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
    return hasDirectOffer(state, load.id, organizationId, at)
  }

  return activeRelationshipExists(state, load.companyId, organizationId) || hasDirectOffer(state, load.id, organizationId, at)
}

export function listVisibleLoadsForOrganization(
  state: LogLoadsDatabaseState,
  organizationId = DEFAULT_ORGANIZATION_ID,
  at = nowIso()
): LoadPosting[] {
  return state.loadPostings.filter((load) =>
    load.status !== "archived" &&
    loadPostingHasOwnedCoherentSources(state, load) &&
    isLoadVisibleToOrganization(state, load, organizationId, at)
  )
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

  if (!loadPostingHasOwnedCoherentSources(state, load)) {
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
  return listVisibleLoadsForOrganization(state, organizationId, at).filter((load) =>
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

/**
 * Stored postings predate source ownership enforcement. Fail closed when an
 * old posting points at another organization's dispatcher so later workflow
 * events cannot route notifications across the organization boundary.
 */
function findPostingDispatcher(state: LogLoadsDatabaseState, load: LoadPosting) {
  return state.dispatcherProfiles.find(
    (profile) => profile.id === load.dispatcherProfileId && profile.companyId === load.companyId
  )
}

function requestCapacityWithPolicyInternal(
  state: LogLoadsDatabaseState,
  input: CapacityRequestInput,
  options: InternalCapacityRequestOptions = {}
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

  // Open postings may predate the publication guard. Re-check the immutable
  // ownership/lane boundary before a request creates an assignment or consumes
  // capacity. A landing retired after publication is a separate operating-state
  // concern; do not misreport it as a legacy ownership defect here.
  const postingSources = assertPostingSourcesAreUsable(state, load.companyId, {
    dispatcherProfileId: load.dispatcherProfileId,
    dropoffMillId: load.dropoffMillId,
    loaderProfileId: load.loaderProfileId,
    pickupLandingId: load.pickupLandingId,
    rateId: load.rateId,
    routeId: load.routeId
  }, { requireActiveLanding: false })

  const duplicate = state.assignments.find((assignment) =>
    assignment.loadPostingId === parsed.loadPostingId &&
    assignment.driverProfileId === parsed.driverProfileId &&
    activeAssignmentStatuses.has(assignment.status)
  )
  assertCondition(!duplicate, "Driver already has an active assignment request for this load")

  const capacity = getOpportunityCapacity(state, parsed.loadPostingId)
  assertCondition(!capacity || capacity.remainingTruckloads > 0, "No opportunity capacity remains for this load")
  assertCondition(
    !capacity ||
      capacity.allocationMode === "request_approval" ||
      (Boolean(options.directOfferId) && capacity.allocationMode === "direct_offer"),
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
  const route = postingSources.route
  const availabilityWindows = state.availabilityWindows.filter((window) => window.driverProfileId === parsed.driverProfileId)
  const compatibility = evaluateLoadCompatibility({ availabilityWindows, load, route, trailer, truck })

  assertCondition(
    compatibility.eligibility !== "ineligible",
    `Equipment is not eligible for this load: ${compatibility.hardFailures[0] ?? "compatibility failed"}`
  )

  const assignment = requestAssignment(state, {
    ...parsed,
    directOfferId: options.directOfferId ?? null,
    termsSnapshot: {}
  })

  if (capacity) {
    updateOpportunityCapacityAfterRequest(state, capacity)
    syncLoadStatusWithCapacity(state, parsed.loadPostingId)
  }

  insertAuditEvent(state, context.actorUserId, "assignment", assignment.id, "capacity_requested", {
    loadPostingId: parsed.loadPostingId,
    organizationId: context.organizationId
  })

  const dispatcher = findPostingDispatcher(state, load)
  if (dispatcher && !options.suppressRequestNotification) {
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

export function requestCapacityWithPolicy(
  state: LogLoadsDatabaseState,
  input: CapacityRequestInput,
  options: CapacityRequestOptions = {}
): Assignment {
  return requestCapacityWithPolicyInternal(state, input, options)
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

  return finalizeCapacityAssignment(state, assignment, {
    actorUserId: context.actorUserId,
    source: "host_approval"
  })
}

interface FinalizeCapacityAssignmentOptions {
  actorUserId: string
  directOfferId?: string
  source: "host_approval" | "direct_offer"
}

function finalizeCapacityAssignment(
  state: LogLoadsDatabaseState,
  assignment: Assignment,
  options: FinalizeCapacityAssignmentOptions
): { assignment: Assignment; trip: TripV2 } {
  const load = assertFound(
    state.loadPostings.find((current) => current.id === assignment.loadPostingId),
    `Load posting ${assignment.loadPostingId} was not found`
  )

  assertCondition(
    ["requested", "offered"].includes(assignment.status),
    "Only a requested or offered assignment can be approved"
  )

  // A request may itself predate this guard, or its stored posting may have
  // been corrupted after request time. Re-check before terms, Route Pack, trip,
  // slot, assignment, or audit state is minted.
  const postingSources = assertPostingSourcesAreUsable(state, load.companyId, {
    dispatcherProfileId: load.dispatcherProfileId,
    dropoffMillId: load.dropoffMillId,
    loaderProfileId: load.loaderProfileId,
    pickupLandingId: load.pickupLandingId,
    rateId: load.rateId,
    routeId: load.routeId
  }, { requireActiveLanding: false })

  const existingTrip = state.tripsV2.find((trip) => trip.assignmentId === assignment.id)
  const equipmentCombination = assertFound(
    findEquipmentCombinationForAssignment(state, assignment),
    "The requested equipment combination was not found"
  )
  const { rate, route } = postingSources
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
    directOfferId: options.directOfferId ?? assignment.directOfferId ?? null,
    status: acceptedStatus,
    termsSnapshot: {
      acceptanceSource: options.source,
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
  // The pack is minted in the approval itself: any gap would leave an accepted
  // haul whose promised route pack does not exist yet. Built purely here and
  // pushed with the other mutations below, and idempotent by assignment so a
  // retry or a compare-and-swap replay cannot mint a second, conflicting pack.
  const existingPack = findAssignmentRoutePack(state, assignment.id)
  const routePack = existingPack ?? buildAssignmentRoutePack(
    state,
    { assignment: acceptedAssignment, load, rate, route, slot: confirmedSlot },
    1,
    timestamp
  )
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
    actorUserId: options.actorUserId,
    createdAt: timestamp,
    id: createUuid(),
    metadata: {
      assignmentId: acceptedAssignment.id,
      directOfferId: options.directOfferId ?? null,
      routePackId: routePack?.id ?? null
    },
    note: options.source === "direct_offer"
      ? "Direct offer claimed and trip created."
      : "Assignment approved and trip created.",
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

  if (!existingPack) {
    state.routePacks.push(routePack)
  }

  if (existingTrip) {
    return { assignment: acceptedAssignment, trip: existingTrip }
  }

  state.tripsV2.push(trip)
  if (tripEvent) state.tripEvents.push(tripEvent)
  insertAuditEvent(
    state,
    options.actorUserId,
    "trip",
    trip.id,
    options.source === "direct_offer" ? "created_from_direct_offer" : "created_from_assignment",
    {
      assignmentId: acceptedAssignment.id,
      directOfferId: options.directOfferId ?? null
    }
  )

  const driver = state.driverProfiles.find((profile) => profile.id === acceptedAssignment.driverProfileId)
  if (driver) {
    insertNotification(
      state,
      driver.userId,
      options.source === "direct_offer" ? "Direct offer truck confirmed" : "Assignment confirmed",
      options.source === "direct_offer"
        ? `${load.title} was accepted for your truck. The route pack is available.`
        : `${load.title} is confirmed and the route pack is available.`,
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
  const dispatcher = findPostingDispatcher(state, load)
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

  // Delivered work that both sides already settled is not cancellable — that
  // would roll back a confirmed record and the capacity it consumed.
  const settledTrip = state.tripsV2.find((current) => current.assignmentId === assignment.id)
  assertCondition(
    settledTrip?.completionStatus !== "confirmed",
    "This delivery is confirmed and cannot be cancelled"
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

export interface PostingSources {
  dispatcherProfileId: unknown
  dropoffMillId: unknown
  loaderProfileId: unknown
  pickupLandingId: unknown
  rateId: unknown
  routeId: unknown
}

interface PostingSourceOptions {
  requireActiveLanding?: boolean
}

/**
 * A posting may only name records the posting organization owns, and a retired
 * landing is not a place work happens.
 *
 * Publishing stamps the posting with the actor's own organization, so source
 * references were the one remaining way a payload could reach across organizations —
 * and the reach was not theoretical. `buildAssignmentRoutePack` resolves the
 * landing and its rich detail straight from `load.pickupLandingId`, so a posting
 * naming another organization's landing handed that organization's entrance pin,
 * gate instructions, and private-road notes to drivers it never approved. Route
 * Pack access was tightened precisely because packs carry that. Dispatcher and
 * loader profiles are organization-owned too: later transitions dereference
 * the dispatcher to route operational notifications, Route Packs carry its
 * contact, and loading slots carry the optional loader profile id.
 *
 * Retirement is checked for the same reason the allowance counts only active
 * landings: otherwise the control is decorative, and the picker would hide the
 * landing while the REST route happily posted work from it anyway.
 *
 * A foreign id is refused as not-found rather than as forbidden. Distinguishing
 * the two would answer "does this id exist?" for records the caller cannot see,
 * which is exactly the enumeration a caller probing other organizations wants.
 *
 * Mills are not ownership-checked: they are platform records with a null
 * companyId, shared by every host. The lane check below still pins the
 * destination, because a route only reaches the mill it was drawn to.
 *
 * Checked before `createLoadPosting`, which pushes: refusing afterwards would
 * leave the posting it was meant to prevent.
 */
function assertPostingSourcesAreUsable(
  state: LogLoadsDatabaseState,
  organizationId: string,
  sources: PostingSources,
  options: PostingSourceOptions = {}
) {
  const landing = assertFound(
    state.landings.find((current) => current.id === sources.pickupLandingId && current.companyId === organizationId),
    "That landing was not found"
  )

  const dispatcher = assertFound(
    state.dispatcherProfiles.find(
      (current) => current.id === sources.dispatcherProfileId && current.companyId === organizationId
    ),
    "That dispatcher profile was not found"
  )

  const loader = sources.loaderProfileId === null || sources.loaderProfileId === undefined
    ? null
    : assertFound(
      state.loaderProfiles.find(
        (current) => current.id === sources.loaderProfileId && current.companyId === organizationId
      ),
      "That loader profile was not found"
    )

  if (options.requireActiveLanding !== false) {
    assertCondition(
      landing.isActive,
      `${landing.name} is retired. Restore it before publishing work from it.`
    )
  }

  const route = assertFound(
    state.haulRoutes.find((current) => current.id === sources.routeId && current.companyId === organizationId),
    "That haul route was not found"
  )

  const rate = assertFound(
    state.rates.find((current) => current.id === sources.rateId && current.companyId === organizationId),
    "That rate was not found"
  )

  // A lane that does not connect the posting's own endpoints is incoherent: the
  // driver would be handed a distance, a run time, and road notes measured
  // between two other places.
  assertCondition(
    route.landingId === sources.pickupLandingId,
    `${route.routeName} does not start at ${landing.name}`
  )
  assertCondition(
    route.millId === sources.dropoffMillId,
    `${route.routeName} does not run to the destination this work names`
  )

  return { dispatcher, landing, loader, rate, route }
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
  const sources = assertPostingSourcesAreUsable(state, context.organizationId, {
    dispatcherProfileId: input.dispatcherProfileId,
    dropoffMillId: input.dropoffMillId,
    loaderProfileId: input.loaderProfileId,
    pickupLandingId: input.pickupLandingId,
    rateId: input.rateId,
    routeId: input.routeId
  })

  const entity = createLoadPosting(state, {
    ...input,
    companyId: context.organizationId,
    dispatcherContact: sources.dispatcher.contact,
    loaderContact: sources.loader?.contact ?? null,
    loaderProfileId: sources.loader?.id ?? null
  })

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
  // Publishing a draft is publishing. A draft can outlive the landing it names
  // — that is the whole point of a draft — so the retirement is checked here and
  // not only where the draft was written, or the second publishing path quietly
  // undoes what the first refuses.
  const sources = assertPostingSourcesAreUsable(state, context.organizationId, {
    dispatcherProfileId: load.dispatcherProfileId,
    dropoffMillId: load.dropoffMillId,
    loaderProfileId: load.loaderProfileId,
    pickupLandingId: load.pickupLandingId,
    rateId: load.rateId,
    routeId: load.routeId
  })

  // Validate the reach before touching the load: a refused mode must not leave
  // the work flipped to open with no capacity behind it.
  const modes = parsePublishModes(
    input.visibilityMode ?? "open_network",
    input.allocationMode ?? "request_approval"
  )

  const timestamp = nowIso()
  const updated = loadPostingSchema.parse({
    ...load,
    dispatcherContact: sources.dispatcher.contact,
    loaderContact: sources.loader?.contact ?? null,
    loaderProfileId: sources.loader?.id ?? null,
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
): { changed: boolean; trip: TripV2; event: TripEvent | null } {
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

  // A lost response may cause a field device to retry the final action. Once
  // authorization and participation have been proven, an exact completed
  // retry is a no-op: never double-count capacity or duplicate history.
  if (trip.status === "completed" && input.nextStatus === "completed") {
    return { changed: false, event: null, trip }
  }

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

  // Validate the state-machine edge before applying completion-specific
  // requirements so impossible jumps still report the actual invalid edge.
  const nextStatus = transitionTripStatus(trip.status, input.nextStatus)

  // A haul does not become delivered because a button was pressed. When the
  // Route Pack the driver accepted named the proof required, that proof has to
  // exist before the trip can close. A haul with a reported exception closes
  // without it — "rejected at the scale" has no scale ticket to give.
  if (input.nextStatus === "completed") {
    const required = requiredCompletionEvidence(state, trip)

    assertCondition(
      trip.completionStatus !== "pending",
      "Record the delivery before finishing this trip"
    )

    assertCondition(
      required.length === 0 ||
        hasCompletionEvidence(state, trip.id) ||
        exceptionWaivesEvidence(trip.haulException),
      `Attach the proof this haul needs before closing it: ${required.join("; ")}`
    )
  }

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

  return { changed: true, event, trip: updatedTrip }
}

/**
 * A pack carries the exact entrance pin, gate codes, and private-road detail,
 * so organization membership is not enough: it opens for the driver actually
 * assigned to the haul and for the host staff who published the work. A
 * teammate of the assigned driver has no operational need for it.
 */
export interface SubmitCompletionInput {
  actorUserId?: string
  organizationId?: string
  tripId: string
  deliveredQuantity?: DeliveredQuantity | null
  exception?: { type: HaulException["type"]; note: string } | null
}

/**
 * The driver's account of what came off the truck. Only the assigned driver —
 * or the fleet staff coordinating them — may give it: this is the figure the
 * host settles against, so it must come from the side that did the haul.
 */
export function submitHaulCompletion(
  state: LogLoadsDatabaseState,
  input: SubmitCompletionInput
): { changed: boolean; trip: TripV2 } {
  const context = getContextForInput(state, input)
  assertOrganizationAction(context, "progress_trip")

  const trip = getTripById(state, requireText(input.tripId, "tripId"))
  const assignment = assertFound(
    state.assignments.find((current) => current.id === trip.assignmentId),
    `Assignment ${trip.assignmentId} was not found`
  )
  const load = assertFound(
    state.loadPostings.find((current) => current.id === trip.loadPostingId),
    `Load posting ${trip.loadPostingId} was not found`
  )
  assertTripParticipant(state, context, assignment)

  // The account comes from the hauling side. A host confirms it; it must not
  // also author it.
  assertCondition(
    load.companyId !== context.organizationId,
    "The hauling organization records what was delivered; the host confirms it"
  )
  const driver = state.driverProfiles.find((current) => current.id === assignment.driverProfileId)
  assertCondition(
    context.membership.role !== "driver" || driver?.userId === context.actorUserId,
    "Drivers can only record their own hauls"
  )
  assertCondition(
    ["at_destination", "unloading", "completed"].includes(trip.status),
    `Record the delivery once the load is at the destination, and this haul is ${trip.status.replaceAll("_", " ")}`
  )

  // A closed haul that only passed the evidence gate because an exception
  // excused the missing proof must not have that excuse quietly deleted. The
  // record would then read as a clean ticketed delivery with neither the proof
  // nor the reason it was absent.
  if (trip.status === "completed" && exceptionWaivesEvidence(trip.haulException)) {
    const stillWaived = exceptionWaivesEvidence(
      input.exception ? { ...input.exception, reportedAt: trip.haulException?.reportedAt ?? nowIso() } : null
    )

    assertCondition(
      stillWaived ||
        requiredCompletionEvidence(state, trip).length === 0 ||
        hasCompletionEvidence(state, trip.id),
      "This haul closed on an exception. Attach the proof before removing it from the record"
    )
  }

  const timestamp = nowIso()
  const { changed, trip: updated, previousStatus } = applyHaulCompletionSubmission(
    state,
    {
      actorUserId: context.actorUserId,
      deliveredQuantity: input.deliveredQuantity ?? null,
      exception: input.exception ?? null,
      trip
    },
    timestamp
  )

  if (!changed) {
    return { changed: false, trip: updated }
  }

  state.tripEvents.push(tripEventSchema.parse({
    actorUserId: context.actorUserId,
    createdAt: timestamp,
    id: createUuid(),
    metadata: {
      deliveredQuantity: updated.deliveredQuantity,
      exception: updated.haulException?.type ?? null,
      previousStatus
    },
    note: updated.haulException
      ? `Delivery recorded with an exception: ${updated.haulException.note}`
      : "Delivery recorded.",
    occurredAt: timestamp,
    source: "driver",
    tripId: trip.id,
    type: "delivery_recorded"
  }))
  insertAuditEvent(state, context.actorUserId, "trip", trip.id, "haul_completion_submitted", {
    assignmentId: assignment.id,
    exception: updated.haulException?.type ?? null,
    previousStatus
  })

  const dispatcher = findPostingDispatcher(state, load)
  if (dispatcher) {
    insertNotification(
      state,
      dispatcher.userId,
      updated.haulException ? "Delivery recorded with an exception" : "Delivery recorded",
      `${load.title}: confirm the delivered record when you have checked it.`,
      "assignment",
      assignment.id,
      "system_alert"
    )
  }

  return { changed: true, trip: updated }
}

export interface SettleCompletionInput {
  actorUserId?: string
  organizationId?: string
  tripId: string
  reason?: string | null
}

/**
 * The host settling the driver's account: confirming it, or disputing it with
 * a reason. Disputing leaves the driver's figures on the record and lets them
 * resubmit — it is a disagreement, not an erasure.
 */
export function settleHaulCompletion(
  state: LogLoadsDatabaseState,
  input: SettleCompletionInput & { decision: "confirm" | "dispute" }
): { trip: TripV2 } {
  const context = getContextForInput(state, input)
  assertOrganizationAction(context, "assign_capacity")

  const trip = getTripById(state, requireText(input.tripId, "tripId"))
  const assignment = assertFound(
    state.assignments.find((current) => current.id === trip.assignmentId),
    `Assignment ${trip.assignmentId} was not found`
  )
  const load = assertFound(
    state.loadPostings.find((current) => current.id === trip.loadPostingId),
    `Load posting ${trip.loadPostingId} was not found`
  )

  assertCondition(
    load.companyId === context.organizationId,
    "Only the posting organization can settle this delivery"
  )
  // Separation of duties is between people, not organizations. A dispatcher
  // holding memberships on both sides of a haul could otherwise record a figure
  // as the hauler, switch organization, and rubber-stamp their own number into
  // a terminal record with no second party involved.
  assertCondition(
    context.actorUserId !== trip.completionSubmittedByUserId,
    "Whoever recorded this delivery cannot also settle it"
  )
  assertCondition(
    trip.status !== "cancelled",
    "This haul was cancelled; there is no delivery to settle"
  )

  const timestamp = nowIso()
  const result = input.decision === "confirm"
    ? applyHaulCompletionConfirmation(state, { actorUserId: context.actorUserId, trip }, timestamp)
    : applyHaulCompletionDispute(
        state,
        { actorUserId: context.actorUserId, reason: input.reason ?? "", trip },
        timestamp
      )

  insertAuditEvent(
    state,
    context.actorUserId,
    "trip",
    trip.id,
    input.decision === "confirm" ? "haul_completion_confirmed" : "haul_completion_disputed",
    { assignmentId: assignment.id, previousStatus: result.previousStatus, reason: input.reason ?? null }
  )

  const driver = state.driverProfiles.find((profile) => profile.id === assignment.driverProfileId)
  if (driver) {
    insertNotification(
      state,
      driver.userId,
      input.decision === "confirm" ? "Delivery confirmed" : "Delivery record disputed",
      input.decision === "confirm"
        ? `${load.title} is settled. The delivered record is on your haul history.`
        : `${load.title}: the host contests the record. ${result.trip.completionDisputeReason ?? ""}`,
      "assignment",
      assignment.id,
      "system_alert"
    )
  }

  return { trip: result.trip }
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
  const driver = state.driverProfiles.find((current) => current.id === assignment.driverProfileId)
  const hostAccess = load.companyId === context.organizationId
  const assignedDriverAccess = driver?.userId === context.actorUserId
  // Everyone other than the assigned driver needs an operational reason to see
  // an entrance pin or a gate code, on either side of the haul —
  // view_private_location is exactly that action, and it excludes viewer and
  // billing. The role check excludes a driver who is not on this haul, who
  // holds the action but has no need for someone else's briefing.
  const staffAccess =
    context.membership.role !== "driver" &&
    organizationRoleCan(context.membership.role, "view_private_location")

  assertCondition(
    assignedDriverAccess || staffAccess,
    "Only the assigned driver and the staff running this haul can open the Route Pack"
  )
  assertCondition(
    hostAccess || ["accepted", "checked_in", "loading", "hauled", "completed"].includes(assignment.status),
    "The Route Pack unlocks after the host accepts the haul"
  )

  // Prefer the assignment's own snapshot; fall back to the host's load-level
  // source for hauls booked before packs were minted per assignment.
  const routePack = assertFound(
    findAssignmentRoutePack(state, assignment.id) ??
      state.routePacks.find((pack) => pack.loadPostingId === assignment.loadPostingId && !pack.assignmentId),
    `Route pack for assignment ${assignment.id} was not found`
  )
  assertCondition(
    routePackIsSafeToRead(state, load, routePack),
    "Route Pack sources are unavailable"
  )

  const notices = state.operationalNotices.filter((notice) =>
    notice.relatedLoadId === assignment.loadPostingId ||
    notice.relatedLandingId === routePack.landingId ||
    notice.relatedDestinationId === routePack.destinationId
  )

  return { notices, routePack }
}

export type RoutePackHistoryInput = RoutePackAccessInput

/** Every version minted for an assignment, oldest first. Same access rules. */
export function listRoutePackVersionsForAssignment(
  state: LogLoadsDatabaseState,
  input: RoutePackHistoryInput
): RoutePack[] {
  // Reuse the access check; it throws unless this actor may see the pack.
  getRoutePackForAssignment(state, input)

  const assignmentId = requireText(input.assignmentId, "assignmentId")
  const assignment = assertFound(
    state.assignments.find((current) => current.id === assignmentId),
    `Assignment ${assignmentId} was not found`
  )
  const load = assertFound(
    state.loadPostings.find((current) => current.id === assignment.loadPostingId),
    `Load posting ${assignment.loadPostingId} was not found`
  )
  const versions = listAssignmentRoutePackVersions(state, assignmentId)

  assertCondition(
    versions.every((pack) => routePackIsSafeToRead(state, load, pack)),
    "Route Pack sources are unavailable"
  )

  return versions
}

export interface RefreshRoutePackInput {
  actorUserId?: string
  organizationId?: string
  assignmentId: string
}

/**
 * Re-resolves an assignment's pack from current source data. Used when a host
 * changes operational instructions after a haul was booked: the driver keeps
 * the version they were given until a material change mints a new one, and is
 * told when that happens.
 */
export function refreshRoutePackForAssignment(
  state: LogLoadsDatabaseState,
  input: RefreshRoutePackInput
): { routePack: RoutePack; changed: boolean } {
  const context = getContextForInput(state, input)
  assertOrganizationAction(context, "publish_load")

  const assignment = assertFound(
    state.assignments.find((current) => current.id === requireText(input.assignmentId, "assignmentId")),
    `Assignment ${input.assignmentId} was not found`
  )
  const load = assertFound(
    state.loadPostings.find((current) => current.id === assignment.loadPostingId),
    `Load posting ${assignment.loadPostingId} was not found`
  )
  assertCondition(
    load.companyId === context.organizationId,
    "Only the posting organization can update this Route Pack"
  )
  assertCondition(
    activeAssignmentStatuses.has(assignment.status),
    `Route Pack updates apply to an active haul, and this one is ${assignment.status}`
  )

  const route = assertFound(
    state.haulRoutes.find((candidate) => candidate.id === load.routeId),
    `Route ${load.routeId} was not found`
  )
  const slot = state.truckSlots.find((candidate) => candidate.id === assignment.truckSlotId) ?? null
  const rate = state.rates.find((candidate) => candidate.id === load.rateId) ?? null
  const timestamp = nowIso()

  const result = regenerateAssignmentRoutePack(state, { assignment, load, rate, route, slot }, timestamp)

  if (!result) {
    return {
      changed: false,
      routePack: assertFound(
        findAssignmentRoutePack(state, assignment.id),
        `Route pack for assignment ${assignment.id} was not found`
      )
    }
  }

  // A first snapshot for a haul booked before packs were per-assignment pins
  // what the driver was already reading. Recorded, but not announced as a
  // change — nothing changed for them.
  if (!result.previous) {
    insertAuditEvent(state, context.actorUserId, "route_pack", result.pack.id, "route_pack_issued", {
      assignmentId: assignment.id,
      version: result.pack.version
    })

    return { changed: false, routePack: result.pack }
  }

  insertAuditEvent(state, context.actorUserId, "route_pack", result.pack.id, "route_pack_updated", {
    assignmentId: assignment.id,
    previousVersion: result.previous.version,
    version: result.pack.version
  })

  const driver = state.driverProfiles.find((profile) => profile.id === assignment.driverProfileId)
  if (driver) {
    insertNotification(
      state,
      driver.userId,
      "Route Pack updated",
      `${load.title} instructions changed. Open the Route Pack and read version ${result.pack.version} before you roll.`,
      "assignment",
      assignment.id,
      "system_alert"
    )
  }

  return { changed: true, routePack: result.pack }
}

/**
 * Where this trip's documents live in the media provider's namespace.
 *
 * Keyed by trip, not by organization: two organizations haul one trip, and the
 * thing a document belongs to is the trip. An org-keyed prefix would scatter one
 * trip's proof across two namespaces depending on who happened to upload it, and
 * every reader would then have to accept both — a wider door than the rule it
 * was meant to enforce. Authorization is participation in the trip, so the path
 * says the same thing the check does.
 *
 * The id is not a secret and is not doing security work: assets are stored
 * `authenticated`, so delivery needs a URL only this server signs, and only
 * after `getTripDocumentTarget` has agreed.
 */
export function tripDocumentPublicIdPrefix(tripId: string): string {
  return `logloads/trip-documents/${tripId}`
}

/**
 * Resolves — and authorizes — the upload namespace for a trip's documents.
 * Shared by the signing endpoint, the attach transaction, and the read path, so
 * all three answer "may this actor touch this trip's paperwork" with one rule
 * rather than three that drift.
 */
export function getTripDocumentTarget(
  state: LogLoadsDatabaseState,
  input: { actorUserId?: string; organizationId?: string; tripId: string },
  access: TripDocumentAccess
): TripDocumentTarget {
  const context = getContextForInput(state, input)
  assertOrganizationAction(context, TRIP_DOCUMENT_ACTIONS[access])

  const trip = assertFound(
    state.tripsV2.find((current) => current.id === input.tripId),
    `Trip ${input.tripId} was not found`
  )
  const assignment = assertFound(
    state.assignments.find((current) => current.id === trip.assignmentId),
    `Assignment ${trip.assignmentId} was not found`
  )
  assertTripParticipant(state, context, assignment)

  return { publicIdPrefix: tripDocumentPublicIdPrefix(trip.id), tripId: trip.id }
}

/**
 * Who filed this paperwork, in the timeline's own vocabulary.
 *
 * Only two answers are true. The haul's own driver photographs the ticket at the
 * scale; anyone else is office staff on one side or the other, which the seed's
 * own timelines already call `dispatcher`. Notably NOT `destination`: a
 * destination is a mill, and mills are not organizations here — `mills.companyId`
 * and `destinationFacilities.managedByOrganizationId` are both null, so no
 * destination has members and none can file anything. The organization that
 * posted the load is the *host* (`loadPostings.companyId`, the same field the
 * network view reads as `hostOrgId`), and it sits at the landing end. Calling it
 * the destination would tell a dispatcher that a mill with no login uploaded the
 * ticket.
 */
function tripDocumentEventSource(
  state: LogLoadsDatabaseState,
  context: ActiveOrganizationContext,
  trip: TripV2
): TripEvent["source"] {
  const driver = state.driverProfiles.find((candidate) => candidate.id === trip.driverProfileId)

  return driver?.userId === context.actorUserId ? "driver" : "dispatcher"
}

/**
 * `ticket_uploaded` means a ticket. A photo of the load or a delivery record is
 * proof, but it is not a scale ticket, and the timeline renders the event type
 * verbatim — so reusing it would print "ticket uploaded" above a note reading
 * "photo uploaded." and tell a reader a ticket arrived when none did.
 */
function tripDocumentEventType(type: TripDocument["type"]): TripEvent["type"] {
  return type === "scale_ticket" ? "ticket_uploaded" : "document_uploaded"
}

export function attachTripDocument(state: LogLoadsDatabaseState, input: AttachTripDocumentInput): TripDocument {
  const context = getContextForInput(state, input)
  const target = getTripDocumentTarget(state, input, "write")
  const trip = getTripById(state, target.tripId)
  // Validated before the namespace check, so the check runs on a known shape
  // rather than on whatever the caller's types claimed at compile time.
  const media = mediaReferenceSchema.parse(input.media)

  // The signature this asset was uploaded under is scoped to one trip, so an
  // asset outside this trip's prefix was signed for something else. Re-checked
  // here and not only at the edge: this is the last point before the record is
  // written, and the record is what the evidence gate trusts.
  assertCondition(
    media.publicId.startsWith(`${target.publicIdPrefix}/uploads/`),
    "The uploaded document does not belong to this trip"
  )

  // Idempotent by asset. A compare-and-swap replay, or a retry of a call whose
  // response was lost, must not file one physical ticket as two records and two
  // timeline events. Public ids are minted server-side per signature, so the
  // same id genuinely means the same upload.
  const existing = state.tripDocuments.find(
    (candidate) => candidate.tripId === target.tripId && candidate.storageKey === media.publicId
  )

  if (existing) {
    return existing
  }

  const document = tripDocumentSchema.parse({
    // Deliberately not caller-supplied. The asset's own facts live on `media`;
    // an open metadata bag on the input would be a way back in for exactly the
    // client-described evidence this path exists to stop.
    auditMetadata: {},
    contentType: `image/${media.format === "jpg" ? "jpeg" : media.format}`,
    filename: requireText(input.filename, "filename"),
    id: createUuid(),
    media,
    // The asset was read back from the provider before we got here, so it is
    // stored and readable now — not queued for someone to confirm later.
    processingStatus: "ready",
    storageKey: media.publicId,
    storageProvider: "cloudinary",
    tripId: target.tripId,
    type: input.type,
    uploadedAt: media.uploadedAt,
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
    source: tripDocumentEventSource(state, context, trip),
    tripId: document.tripId,
    type: tripDocumentEventType(document.type)
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

function directOfferOperatingMemberships(state: LogLoadsDatabaseState, organizationId: string) {
  return state.organizationMemberships.filter((membership) =>
    membership.organizationId === organizationId &&
    membership.status === "active" &&
    ["owner", "admin", "dispatcher", "fleet_manager"].includes(membership.role)
  )
}

function transactState<T>(state: LogLoadsDatabaseState, mutation: (draft: LogLoadsDatabaseState) => T): T {
  const draft = structuredClone(state)
  const result = mutation(draft)

  Object.assign(state, draft)

  return result
}

function directOfferTermsSnapshot(
  load: LoadPosting,
  postingSources: ReturnType<typeof assertPostingSourcesAreUsable>
) {
  const { rate, route } = postingSources

  return {
    baseRateCents: rate.baseRate.amountCents,
    capacityReservation: "none_until_truck_claimed",
    currency: rate.baseRate.currency,
    estimatedDistanceMiles: route.estimatedDistanceMiles,
    estimatedTonsPerLoad: load.estimatedTonsPerLoad ?? null,
    fuelSurchargeCents: rate.fuelSurchargeCents,
    hostOrganizationId: load.companyId,
    loadPostingId: load.id,
    loadVersion: load.updatedAt,
    paymentMode: "off_platform",
    rateBasis: rate.rateType,
    rateId: rate.id
  }
}

function directOfferTermsAreCurrent(
  offer: DirectOffer,
  load: LoadPosting,
  postingSources: ReturnType<typeof assertPostingSourcesAreUsable>
): boolean {
  return Object.entries(directOfferTermsSnapshot(load, postingSources)).every(
    ([key, value]) => offer.termsSnapshot[key] === value
  )
}

function createDirectOfferMutation(
  state: LogLoadsDatabaseState,
  input: CreateDirectOfferInput,
  options: DirectOfferMutationOptions = {}
): DirectOffer {
  const context = getContextForInput(state, input)
  assertOrganizationAction(context, "assign_capacity")
  const timestamp = options.at ?? nowIso()
  const load = assertFound(
    state.loadPostings.find((current) => current.id === input.loadPostingId),
    `Load posting ${input.loadPostingId} was not found`
  )
  const targetOrganizationId = requireText(input.offeredToOrganizationId, "offeredToOrganizationId")
  const target = assertFound(
    state.organizations.find((organization) => organization.id === targetOrganizationId && !organization.archivedAt),
    `Organization ${targetOrganizationId} was not found`
  )

  assertCondition(load.companyId === context.organizationId, "Only the source organization can send a direct offer")
  assertCondition(!load.archivedAt && ["open", "scheduled"].includes(load.status), "Direct offers require open work")
  assertCondition(target.id !== context.organizationId, "Direct offers must be sent to another organization")
  assertCondition(["carrier", "fleet"].includes(target.type), "Direct offers must be sent to a hauling organization")
  assertCondition(
    activeRelationshipExists(state, context.organizationId, target.id),
    "Direct offers require an active private-network relationship"
  )
  assertCondition(
    Number.isInteger(input.offeredTruckloads) && input.offeredTruckloads > 0,
    "offeredTruckloads must be a positive whole number"
  )
  assertCondition(
    Number.isFinite(Date.parse(input.expiresAt)) && Date.parse(input.expiresAt) > Date.parse(timestamp),
    "Direct offers require a future expiration"
  )

  const postingSources = assertPostingSourcesAreUsable(state, load.companyId, {
    dispatcherProfileId: load.dispatcherProfileId,
    dropoffMillId: load.dropoffMillId,
    loaderProfileId: load.loaderProfileId,
    pickupLandingId: load.pickupLandingId,
    rateId: load.rateId,
    routeId: load.routeId
  }, { requireActiveLanding: false })
  const capacity = assertFound(
    getOpportunityCapacity(state, load.id),
    `Opportunity capacity for load posting ${load.id} was not found`
  )

  assertCondition(
    ["request_approval", "direct_offer"].includes(capacity.allocationMode),
    "This load does not accept direct offers"
  )
  assertCondition(capacity.remainingTruckloads > 0, "No opportunity capacity remains for this load")
  assertCondition(
    input.offeredTruckloads <= capacity.remainingTruckloads,
    `Only ${capacity.remainingTruckloads} truckload${capacity.remainingTruckloads === 1 ? "" : "s"} remain`
  )

  const duplicate = state.directOffers.find((offer) =>
    offer.loadPostingId === load.id &&
    offer.offeredToOrganizationId === target.id &&
    directOfferIsClaimable(state, offer, timestamp)
  )
  assertCondition(!duplicate, "An active direct offer already exists for this partner and load")

  const offer = directOfferSchema.parse({
    createdAt: timestamp,
    expiresAt: input.expiresAt,
    id: createUuid(),
    loadPostingId: load.id,
    offeredByOrganizationId: context.organizationId,
    offeredToOrganizationId: target.id,
    offeredTruckloads: input.offeredTruckloads,
    respondedAt: null,
    status: "sent",
    termsSnapshot: directOfferTermsSnapshot(load, postingSources),
    updatedAt: timestamp
  })

  state.directOffers.push(offer)
  insertAuditEvent(state, context.actorUserId, "direct_offer", offer.id, "sent", {
    loadPostingId: load.id,
    offeredToOrganizationId: offer.offeredToOrganizationId,
    offeredTruckloads: offer.offeredTruckloads
  })

  for (const membership of directOfferOperatingMemberships(state, offer.offeredToOrganizationId)) {
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

export function createDirectOffer(
  state: LogLoadsDatabaseState,
  input: CreateDirectOfferInput,
  options: DirectOfferMutationOptions = {}
): DirectOffer {
  return transactState(state, (draft) => createDirectOfferMutation(draft, input, options))
}

function claimDirectOfferMutation(
  state: LogLoadsDatabaseState,
  input: ClaimDirectOfferInput,
  options: DirectOfferMutationOptions
): { assignment: Assignment; directOffer: DirectOffer; trip: TripV2 } {
  const context = getContextForInput(state, input)
  // Accepting company work is a fleet operating decision. Requiring both
  // capabilities admits owner/admin/dispatcher/fleet_manager while keeping a
  // driver, landing manager, billing user, or viewer from committing a truck.
  assertOrganizationAction(context, "assign_capacity")
  assertOrganizationAction(context, "request_assignment")
  const timestamp = options.at ?? nowIso()
  const directOfferId = requireText(input.directOfferId, "directOfferId")
  const offer = assertFound(
    state.directOffers.find((candidate) => candidate.id === directOfferId),
    `Direct offer ${directOfferId} was not found`
  )

  assertCondition(
    offer.offeredToOrganizationId === context.organizationId,
    `Direct offer ${offer.id} was not found`
  )

  const equipmentCombinationId = requireText(input.equipmentCombinationId, "equipmentCombinationId")
  const truckSlotId = requireText(input.truckSlotId, "truckSlotId")
  const existingTrip = state.tripsV2.find((trip) =>
    trip.equipmentCombinationId === equipmentCombinationId &&
    state.assignments.some((assignment) =>
      assignment.id === trip.assignmentId &&
      assignment.directOfferId === offer.id &&
      assignment.truckSlotId === truckSlotId
    )
  )

  if (existingTrip) {
    const existingAssignment = assertFound(
      state.assignments.find((assignment) => assignment.id === existingTrip.assignmentId),
      `Assignment ${existingTrip.assignmentId} was not found`
    )

    assertCondition(
      !["cancelled", "declined"].includes(existingAssignment.status),
      "This truck's earlier claim was cancelled; a new direct offer is required"
    )

    return { assignment: existingAssignment, directOffer: offer, trip: existingTrip }
  }

  assertCondition(directOfferIsClaimable(state, offer, timestamp), "This direct offer is no longer actionable")
  assertCondition(
    activeRelationshipExists(state, offer.offeredByOrganizationId, offer.offeredToOrganizationId),
    "The private-network relationship is no longer active"
  )

  const load = assertFound(
    state.loadPostings.find((candidate) => candidate.id === offer.loadPostingId),
    `Load posting ${offer.loadPostingId} was not found`
  )
  assertCondition(load.companyId === offer.offeredByOrganizationId, "Direct offer source no longer owns this load")
  assertCondition(!load.archivedAt && ["open", "scheduled"].includes(load.status), "This load is no longer accepting trucks")
  const postingSources = assertPostingSourcesAreUsable(state, load.companyId, {
    dispatcherProfileId: load.dispatcherProfileId,
    dropoffMillId: load.dropoffMillId,
    loaderProfileId: load.loaderProfileId,
    pickupLandingId: load.pickupLandingId,
    rateId: load.rateId,
    routeId: load.routeId
  }, { requireActiveLanding: false })
  assertCondition(
    directOfferTermsAreCurrent(offer, load, postingSources),
    "Direct offer terms changed after it was sent; ask the host to send a new offer"
  )

  const combination = assertFound(
    state.equipmentCombinations.find((candidate) => candidate.id === equipmentCombinationId),
    `Equipment combination ${equipmentCombinationId} was not found`
  )
  assertCondition(combination.organizationId === context.organizationId, `Equipment combination ${equipmentCombinationId} was not found`)
  assertCondition(combination.status === "available", "Only available equipment can claim a direct offer")
  const driverProfileId = assertFound(combination.assignedDriverProfileId, "Assign a driver before accepting this offer")
  const driver = assertFound(
    state.driverProfiles.find((candidate) => candidate.id === driverProfileId),
    `Driver profile ${driverProfileId} was not found`
  )
  const driverIsActive = state.profiles.some((profile) =>
    profile.id === driver.userId && profile.isActive
  )
  const driverMembership = state.organizationMemberships.find((membership) =>
    membership.organizationId === context.organizationId &&
    membership.status === "active" &&
    membership.userId === driver.userId
  )

  assertCondition(
    driverIsActive && Boolean(driverMembership && organizationRoleCan(driverMembership.role, "progress_trip")),
    "The assigned driver is not active in this organization"
  )
  const truck = assertFound(
    state.truckProfiles.find((candidate) => candidate.id === combination.truckProfileId),
    `Truck profile ${combination.truckProfileId} was not found`
  )
  const trailer = combination.trailerProfileId
    ? assertFound(
        state.trailerProfiles.find((candidate) => candidate.id === combination.trailerProfileId),
        `Trailer profile ${combination.trailerProfileId} was not found`
      )
    : null

  assertCondition(driver.companyId === context.organizationId, "The assigned driver does not belong to this organization")
  assertCondition(truck.companyId === context.organizationId, "The selected truck does not belong to this organization")
  assertCondition(!truck.archivedAt, "The selected truck is archived")
  assertCondition(!trailer || trailer.truckId === truck.id, "The selected trailer is not attached to this truck")

  const slot = assertFound(
    state.truckSlots.find((candidate) => candidate.id === truckSlotId),
    `Truck slot ${truckSlotId} was not found`
  )
  assertCondition(slot.loadPostingId === load.id, "The selected truck slot does not belong to this load")
  assertCondition(slot.landingId === load.pickupLandingId, "The selected truck slot does not belong to this landing")
  assertCondition(["open", "requested", "reserved"].includes(slot.status), "This haul window is no longer open")
  assertCondition(slot.reservedCount < slot.capacity, "This haul window is already full")
  assertCondition(slot.endAt > timestamp, "This haul window has already passed")

  const driverWindows = state.availabilityWindows.filter((window) => window.driverProfileId === driver.id)
  const coversSlot = driverWindows.some(
    (window) => window.status !== "unavailable" && window.startAt <= slot.startAt && window.endAt >= slot.endAt
  )

  if (!coversSlot) {
    const overlapsSlot = driverWindows.some(
      (window) => window.startAt < slot.endAt && window.endAt > slot.startAt
    )
    assertCondition(
      !overlapsSlot,
      "The driver's posted availability does not cover this full haul window; update availability before accepting"
    )
    upsertAvailabilityWindow(state, {
      driverProfileId: driver.id,
      endAt: slot.endAt,
      notes: "Confirmed while accepting a direct offer.",
      startAt: slot.startAt,
      status: "available",
      truckProfileId: truck.id
    })
  }

  const overlappingAssignment = state.assignments.find((assignment) => {
    if (!activeAssignmentStatuses.has(assignment.status)) {
      return false
    }

    const sameEquipment =
      assignment.driverProfileId === driver.id ||
      assignment.truckProfileId === truck.id ||
      Boolean(trailer && assignment.trailerProfileId === trailer.id)

    if (!sameEquipment) {
      return false
    }

    const otherSlot = state.truckSlots.find((candidate) => candidate.id === assignment.truckSlotId)

    return Boolean(otherSlot && otherSlot.startAt < slot.endAt && otherSlot.endAt > slot.startAt)
  })
  assertCondition(!overlappingAssignment, "This driver or equipment is already committed during that haul window")

  const capacity = assertFound(
    getOpportunityCapacity(state, load.id),
    `Opportunity capacity for load posting ${load.id} was not found`
  )
  assertCondition(capacity.remainingTruckloads > 0, "No opportunity capacity remains for this load")

  const assignment = requestCapacityWithPolicyInternal(state, {
    actorUserId: context.actorUserId,
    dispatcherNotes: "Accepted through a direct offer.",
    driverProfileId: driver.id,
    loadPostingId: load.id,
    organizationId: context.organizationId,
    trailerProfileId: trailer?.id ?? null,
    truckProfileId: truck.id,
    truckSlotId: slot.id
  }, {
    at: timestamp,
    directOfferId: offer.id,
    suppressRequestNotification: true
  })
  const accepted = finalizeCapacityAssignment(state, assignment, {
    actorUserId: context.actorUserId,
    directOfferId: offer.id,
    source: "direct_offer"
  })
  const acceptedTruckloads = directOfferClaimCount(state, offer.id)
  const updatedOffer = directOfferSchema.parse({
    ...offer,
    respondedAt: offer.respondedAt ?? timestamp,
    status: acceptedTruckloads >= offer.offeredTruckloads ? "accepted" : "sent",
    updatedAt: timestamp
  })

  state.directOffers = state.directOffers.map((candidate) => candidate.id === offer.id ? updatedOffer : candidate)
  insertAuditEvent(state, context.actorUserId, "direct_offer", offer.id, "truckload_claimed", {
    acceptedTruckloads,
    assignmentId: accepted.assignment.id,
    offeredTruckloads: offer.offeredTruckloads
  })

  const dispatcher = findPostingDispatcher(state, load)
  if (dispatcher) {
    insertNotification(
      state,
      dispatcher.userId,
      "Direct offer truck accepted",
      `${targetDisplayName(state, context.organizationId)} accepted ${acceptedTruckloads} of ${offer.offeredTruckloads} truckloads on ${load.title}.`,
      "direct_offer",
      offer.id,
      "assignment_confirmed"
    )
  }

  return { ...accepted, directOffer: updatedOffer }
}

function targetDisplayName(state: LogLoadsDatabaseState, organizationId: string): string {
  return state.organizations.find((organization) => organization.id === organizationId)?.displayName ?? "The partner"
}

export function claimDirectOffer(
  state: LogLoadsDatabaseState,
  input: ClaimDirectOfferInput,
  options: DirectOfferMutationOptions = {}
): { assignment: Assignment; directOffer: DirectOffer; trip: TripV2 } {
  return transactState(state, (draft) => claimDirectOfferMutation(draft, input, options))
}

function declineDirectOfferMutation(
  state: LogLoadsDatabaseState,
  input: DirectOfferResponseInput,
  options: DirectOfferMutationOptions = {}
): DirectOffer {
  const context = getContextForInput(state, input)
  assertOrganizationAction(context, "assign_capacity")
  assertOrganizationAction(context, "request_assignment")
  const timestamp = options.at ?? nowIso()
  const offer = assertFound(
    state.directOffers.find((candidate) => candidate.id === input.directOfferId),
    `Direct offer ${input.directOfferId} was not found`
  )

  assertCondition(offer.offeredToOrganizationId === context.organizationId, `Direct offer ${offer.id} was not found`)
  assertCondition(directOfferIsClaimable(state, offer, timestamp), "This direct offer is no longer actionable")
  const declined = directOfferSchema.parse({
    ...offer,
    respondedAt: offer.respondedAt ?? timestamp,
    status: "declined",
    updatedAt: timestamp
  })

  state.directOffers = state.directOffers.map((candidate) => candidate.id === offer.id ? declined : candidate)
  const acceptedTruckloads = directOfferClaimCount(state, offer.id)
  insertAuditEvent(state, context.actorUserId, "direct_offer", offer.id, "declined", { acceptedTruckloads })

  const load = state.loadPostings.find((candidate) => candidate.id === offer.loadPostingId)
  const dispatcher = load ? findPostingDispatcher(state, load) : null
  if (dispatcher) {
    insertNotification(
      state,
      dispatcher.userId,
      "Direct offer declined",
      `${targetDisplayName(state, context.organizationId)} declined the remaining direct offer${load ? ` on ${load.title}` : ""}.`,
      "direct_offer",
      offer.id,
      "system_alert"
    )
  }

  return declined
}

export function declineDirectOffer(
  state: LogLoadsDatabaseState,
  input: DirectOfferResponseInput,
  options: DirectOfferMutationOptions = {}
): DirectOffer {
  return transactState(state, (draft) => declineDirectOfferMutation(draft, input, options))
}

function revokeDirectOfferMutation(
  state: LogLoadsDatabaseState,
  input: DirectOfferResponseInput,
  options: DirectOfferMutationOptions = {}
): DirectOffer {
  const context = getContextForInput(state, input)
  assertOrganizationAction(context, "assign_capacity")
  const timestamp = options.at ?? nowIso()
  const offer = assertFound(
    state.directOffers.find((candidate) => candidate.id === input.directOfferId),
    `Direct offer ${input.directOfferId} was not found`
  )

  assertCondition(offer.offeredByOrganizationId === context.organizationId, `Direct offer ${offer.id} was not found`)
  assertCondition(directOfferIsClaimable(state, offer, timestamp), "This direct offer is no longer actionable")
  const revoked = directOfferSchema.parse({ ...offer, status: "revoked", updatedAt: timestamp })

  state.directOffers = state.directOffers.map((candidate) => candidate.id === offer.id ? revoked : candidate)
  const acceptedTruckloads = directOfferClaimCount(state, offer.id)
  insertAuditEvent(state, context.actorUserId, "direct_offer", offer.id, "revoked", { acceptedTruckloads })

  for (const membership of directOfferOperatingMemberships(state, offer.offeredToOrganizationId)) {
    insertNotification(
      state,
      membership.userId,
      "Direct offer closed",
      "The host closed the remaining invitation. Any already confirmed trucks stay assigned.",
      "direct_offer",
      offer.id,
      "system_alert"
    )
  }

  return revoked
}

export function revokeDirectOffer(
  state: LogLoadsDatabaseState,
  input: DirectOfferResponseInput,
  options: DirectOfferMutationOptions = {}
): DirectOffer {
  return transactState(state, (draft) => revokeDirectOfferMutation(draft, input, options))
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
