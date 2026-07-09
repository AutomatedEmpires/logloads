import { type LogLoadsDatabaseState } from "@logloads/db"

import {
  createAccount,
  findProfileByClerkId,
  findProfileByEmail,
  getAccountContext,
  linkProfileToClerkUser
} from "./accounts"
import {
  listVerificationQueue,
  resolveOperationalNotice,
  reviewOrganization,
  reviewVerificationRecord
} from "./admin"
import { assignDriverToSlot, cancelAssignment, requestAssignment } from "./assignments"
import { applyBillingUpdate, findEntitlementByStripeSubscription } from "./billing"
import {
  addEquipmentCombination,
  assignDriverToEquipment,
  updateEquipmentStatus
} from "./equipment"
import {
  createThread,
  listThreadMessages,
  listThreadsForUser,
  markThreadRead,
  postMessage,
  unreadThreadCounts
} from "./messaging"
import { listDriverAvailability, upsertAvailabilityWindow } from "./availability"
import { createLoadPosting, getLoadById, listOpenLoads, updateLoadPosting } from "./loads"
import {
  createNotification,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead
} from "./notifications"
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
import {
  getReliabilityForOrganization,
  getReputationForDriver,
  getReputationForOrganization,
  hasTripReview,
  listReviewsForOrganization,
  submitTripReview
} from "./trip-reviews"
import { createServiceState } from "./utils"
import { submitVerificationRecord } from "./verification"

export function createLogLoadsServices(seed?: LogLoadsDatabaseState) {
  const state = createServiceState(seed)

  return {
    state,
    DEFAULT_ACTOR_USER_ID,
    DEFAULT_ORGANIZATION_ID,
    addEquipmentCombination: (input: unknown) => addEquipmentCombination(state, input),
    applyBillingUpdate: (input: unknown) => applyBillingUpdate(state, input),
    findEntitlementByStripeSubscription: (stripeSubscriptionId: string) => findEntitlementByStripeSubscription(state, stripeSubscriptionId),
    assignDriverToEquipment: (input: unknown) => assignDriverToEquipment(state, input),
    createAccount: (input: unknown) => createAccount(state, input),
    createThread: (input: unknown) => createThread(state, input),
    findProfileByClerkId: (clerkUserId: string) => findProfileByClerkId(state, clerkUserId),
    findProfileByEmail: (email: string) => findProfileByEmail(state, email),
    getAccountContext: (userId: string) => getAccountContext(state, userId),
    linkProfileToClerkUser: (userId: string, clerkUserId: string) => linkProfileToClerkUser(state, userId, clerkUserId),
    listThreadMessages: (threadId: string, viewerUserId: string) => listThreadMessages(state, threadId, viewerUserId),
    listThreadsForUser: (userId: string) => listThreadsForUser(state, userId),
    markThreadRead: (input: { threadId: string; userId: string }) => markThreadRead(state, input),
    unreadThreadCounts: (userId: string) => unreadThreadCounts(state, userId),
    listVerificationQueue: () => listVerificationQueue(state),
    postMessage: (input: unknown) => postMessage(state, input),
    resolveOperationalNotice: (input: { noticeId: string; reviewerUserId: string }) => resolveOperationalNotice(state, input),
    reviewOrganization: (input: unknown) => reviewOrganization(state, input),
    reviewVerificationRecord: (input: unknown) => reviewVerificationRecord(state, input),
    submitVerificationRecord: (input: unknown) => submitVerificationRecord(state, input),
    submitTripReview: (input: unknown) => submitTripReview(state, input),
    getReputationForOrganization: (organizationId: string) => getReputationForOrganization(state, organizationId),
    getReputationForDriver: (driverProfileId: string) => getReputationForDriver(state, driverProfileId),
    getReliabilityForOrganization: (organizationId: string) => getReliabilityForOrganization(state, organizationId),
    listReviewsForOrganization: (organizationId: string) => listReviewsForOrganization(state, organizationId),
    hasTripReview: (input: { tripId: string; direction: "host_rates_hauler" | "hauler_rates_host" }) => hasTripReview(state, input.tripId, input.direction),
    updateEquipmentStatus: (input: unknown) => updateEquipmentStatus(state, input),
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
    markNotificationRead: (input: { userId: string; notificationId: string }) => markNotificationRead(state, input.userId, input.notificationId),
    markAllNotificationsRead: (userId: string) => markAllNotificationsRead(state, userId),
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