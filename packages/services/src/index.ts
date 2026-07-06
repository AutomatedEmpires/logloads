import { type LogLoadsDatabaseState } from "@logloads/db"

import { assignDriverToSlot, cancelAssignment, requestAssignment } from "./assignments"
import { listDriverAvailability, upsertAvailabilityWindow } from "./availability"
import { createLoadPosting, getLoadById, listOpenLoads, updateLoadPosting } from "./loads"
import { createNotification, listNotificationsForUser } from "./notifications"
import {
  DEFAULT_ACTOR_USER_ID,
  DEFAULT_ORGANIZATION_ID,
  approveCapacityRequest,
  attachTripDocument,
  createDirectOffer,
  createOperationalNotice,
  getActiveOrganizationContext,
  getOrganizationMemberships,
  getRoutePackForAssignment,
  listAttentionItems,
  listEntitlements,
  listFutureAvailabilityForOrganization,
  listPrivateNetworkRelationships,
  listVisibleLoadsForOrganization,
  progressTripStatus,
  publishFutureAvailability,
  requestCapacityWithPolicy
} from "./operating-network"
import { getRouteById, listRoutes } from "./routes"
import { createTruckSlot, listTruckSlotsForDate } from "./truck-slots"
import { createServiceState } from "./utils"

export function createLogLoadsServices(seed?: LogLoadsDatabaseState) {
  const state = createServiceState(seed)

  return {
    state,
    DEFAULT_ACTOR_USER_ID,
    DEFAULT_ORGANIZATION_ID,
    approveCapacityRequest: (input: Parameters<typeof approveCapacityRequest>[1]) => approveCapacityRequest(state, input),
    assignDriverToSlot: (assignmentId: string) => assignDriverToSlot(state, assignmentId),
    attachTripDocument: (input: Parameters<typeof attachTripDocument>[1]) => attachTripDocument(state, input),
    cancelAssignment: (assignmentId: string, cancellationReason: string) =>
      cancelAssignment(state, assignmentId, cancellationReason),
    createDirectOffer: (input: Parameters<typeof createDirectOffer>[1]) => createDirectOffer(state, input),
    createLoadPosting: (input: unknown) => createLoadPosting(state, input),
    createNotification: (input: unknown) => createNotification(state, input),
    createOperationalNotice: (input: Parameters<typeof createOperationalNotice>[1]) => createOperationalNotice(state, input),
    createTruckSlot: (input: unknown) => createTruckSlot(state, input),
    getActiveOrganizationContext: (actorUserId?: string, organizationId?: string) => getActiveOrganizationContext(state, actorUserId, organizationId),
    getLoadById: (loadId: string) => getLoadById(state, loadId),
    getOrganizationMemberships: (actorUserId: string) => getOrganizationMemberships(state, actorUserId),
    getRouteById: (routeId: string) => getRouteById(state, routeId),
    getRoutePackForAssignment: (input: Parameters<typeof getRoutePackForAssignment>[1]) => getRoutePackForAssignment(state, input),
    listAttentionItems: (organizationId?: string) => listAttentionItems(state, organizationId),
    listDriverAvailability: (driverProfileId?: string) => listDriverAvailability(state, driverProfileId),
    listEntitlements: (organizationId?: string) => listEntitlements(state, organizationId),
    listFutureAvailabilityForOrganization: (organizationId?: string) => listFutureAvailabilityForOrganization(state, organizationId),
    listNotificationsForUser: (userId: string) => listNotificationsForUser(state, userId),
    listPrivateNetworkRelationships: (organizationId?: string) => listPrivateNetworkRelationships(state, organizationId),
    listOpenLoads: () => listOpenLoads(state),
    listVisibleLoadsForOrganization: (organizationId?: string) => listVisibleLoadsForOrganization(state, organizationId),
    listRoutes: () => listRoutes(state),
    listTruckSlotsForDate: (date: string) => listTruckSlotsForDate(state, date),
    progressTripStatus: (input: Parameters<typeof progressTripStatus>[1]) => progressTripStatus(state, input),
    publishFutureAvailability: (input: Parameters<typeof publishFutureAvailability>[1]) => publishFutureAvailability(state, input),
    requestAssignment: (input: unknown) => requestAssignment(state, input),
    requestCapacityWithPolicy: (input: Parameters<typeof requestCapacityWithPolicy>[1]) => requestCapacityWithPolicy(state, input),
    updateLoadPosting: (input: unknown) => updateLoadPosting(state, input),
    upsertAvailabilityWindow: (input: unknown) => upsertAvailabilityWindow(state, input)
  }
}

export type LogLoadsServices = ReturnType<typeof createLogLoadsServices>