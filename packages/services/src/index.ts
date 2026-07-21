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
  getDriverMediaTarget,
  saveDriverMediaReference,
  updateDriverEconomics
} from "./driver-profile"
import {
  createThread,
  listThreadMessages,
  listThreadsForUser,
  markThreadRead,
  postMessage,
  unreadThreadCounts
} from "./messaging"
import {
  activeLandingLimitFor,
  countActiveLandings,
  createHaulRoute,
  createLanding,
  createRate,
  setLandingActive,
  updateLanding,
  upsertLandingDetails
} from "./host-workspace"
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
  cancelAssignmentWithPolicy,
  claimDirectOffer,
  closeLoadPosting,
  createDirectOffer,
  createLoadPostingWithPolicy,
  createOperationalNotice,
  declineCapacityRequest,
  declineDirectOffer,
  openDraftLoadPosting,
  getActiveOrganizationContext,
  getOrganizationMemberships,
  getRoutePackForAssignment,
  getTripDocumentTarget,
  tripDocumentPublicIdPrefix,
  listAttentionItems,
  listEntitlements,
  listFutureAvailabilityForOrganization,
  listPrivateNetworkRelationships,
  listRequestableLoadsForOrganization,
  listRoutePackVersionsForAssignment,
  listVisibleLoadsForOrganization,
  isLoadRequestableAt,
  progressTripStatus,
  publishFutureAvailability,
  refreshRoutePackForAssignment,
  requestCapacityWithPolicy,
  revokeDirectOffer,
  settleHaulCompletion,
  submitHaulCompletion
} from "./operating-network"
import { listTripDocuments, requiredCompletionEvidence } from "./haul-completion"
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
    getDriverMediaTarget: (input: Parameters<typeof getDriverMediaTarget>[1]) => getDriverMediaTarget(state, input),
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
    cancelAssignmentWithPolicy: (input: Parameters<typeof cancelAssignmentWithPolicy>[1]) =>
      cancelAssignmentWithPolicy(state, input),
    closeLoadPosting: (input: Parameters<typeof closeLoadPosting>[1]) => closeLoadPosting(state, input),
    createLoadPostingWithPolicy: (input: Parameters<typeof createLoadPostingWithPolicy>[1]) =>
      createLoadPostingWithPolicy(state, input),
    openDraftLoadPosting: (input: Parameters<typeof openDraftLoadPosting>[1]) => openDraftLoadPosting(state, input),
    createDirectOffer: (
      input: Parameters<typeof createDirectOffer>[1],
      options?: Parameters<typeof createDirectOffer>[2]
    ) => createDirectOffer(state, input, options),
    claimDirectOffer: (
      input: Parameters<typeof claimDirectOffer>[1],
      options?: Parameters<typeof claimDirectOffer>[2]
    ) => claimDirectOffer(state, input, options),
    createLoadPosting: (input: unknown) => createLoadPosting(state, input),
    createHaulRoute: (input: Parameters<typeof createHaulRoute>[1]) => createHaulRoute(state, input),
    createLanding: (input: Parameters<typeof createLanding>[1]) => createLanding(state, input),
    createRate: (input: Parameters<typeof createRate>[1]) => createRate(state, input),
    updateLanding: (input: Parameters<typeof updateLanding>[1]) => updateLanding(state, input),
    upsertLandingDetails: (input: Parameters<typeof upsertLandingDetails>[1]) => upsertLandingDetails(state, input),
    setLandingActive: (input: Parameters<typeof setLandingActive>[1]) => setLandingActive(state, input),
    activeLandingLimitFor: (organizationId: string) => activeLandingLimitFor(state, organizationId),
    countActiveLandings: (organizationId: string) => countActiveLandings(state, organizationId),
    createNotification: (input: unknown) => createNotification(state, input),
    createOperationalNotice: (input: Parameters<typeof createOperationalNotice>[1]) => createOperationalNotice(state, input),
    declineCapacityRequest: (input: Parameters<typeof declineCapacityRequest>[1]) => declineCapacityRequest(state, input),
    declineDirectOffer: (
      input: Parameters<typeof declineDirectOffer>[1],
      options?: Parameters<typeof declineDirectOffer>[2]
    ) => declineDirectOffer(state, input, options),
    createTruckSlot: (input: unknown) => createTruckSlot(state, input),
    getActiveOrganizationContext: (actorUserId?: string, organizationId?: string) => getActiveOrganizationContext(state, actorUserId, organizationId),
    getLoadById: (loadId: string) => getLoadById(state, loadId),
    getOrganizationMemberships: (actorUserId: string) => getOrganizationMemberships(state, actorUserId),
    getRouteById: (routeId: string) => getRouteById(state, routeId),
    getRoutePackForAssignment: (input: Parameters<typeof getRoutePackForAssignment>[1]) => getRoutePackForAssignment(state, input),
    getTripDocumentTarget: (
      input: Parameters<typeof getTripDocumentTarget>[1],
      access: Parameters<typeof getTripDocumentTarget>[2]
    ) => getTripDocumentTarget(state, input, access),
    listRoutePackVersionsForAssignment: (input: Parameters<typeof listRoutePackVersionsForAssignment>[1]) =>
      listRoutePackVersionsForAssignment(state, input),
    refreshRoutePackForAssignment: (input: Parameters<typeof refreshRoutePackForAssignment>[1]) =>
      refreshRoutePackForAssignment(state, input),
    submitHaulCompletion: (input: Parameters<typeof submitHaulCompletion>[1]) => submitHaulCompletion(state, input),
    settleHaulCompletion: (input: Parameters<typeof settleHaulCompletion>[1]) => settleHaulCompletion(state, input),
    listTripDocuments: (tripId: string) => listTripDocuments(state, tripId),
    requiredCompletionEvidence: (trip: Parameters<typeof requiredCompletionEvidence>[1]) =>
      requiredCompletionEvidence(state, trip),
    listAttentionItems: (organizationId?: string) => listAttentionItems(state, organizationId),
    listDriverAvailability: (driverProfileId?: string) => listDriverAvailability(state, driverProfileId),
    listEntitlements: (organizationId?: string) => listEntitlements(state, organizationId),
    listFutureAvailabilityForOrganization: (organizationId?: string) => listFutureAvailabilityForOrganization(state, organizationId),
    listNotificationsForUser: (userId: string) => listNotificationsForUser(state, userId),
    markNotificationRead: (input: { userId: string; notificationId: string }) => markNotificationRead(state, input.userId, input.notificationId),
    markAllNotificationsRead: (userId: string) => markAllNotificationsRead(state, userId),
    listPrivateNetworkRelationships: (organizationId?: string) => listPrivateNetworkRelationships(state, organizationId),
    isLoadRequestableAt: (load: Parameters<typeof isLoadRequestableAt>[1], at?: string) => isLoadRequestableAt(state, load, at),
    listRequestableLoadsForOrganization: (organizationId?: string, at?: string) => listRequestableLoadsForOrganization(state, organizationId, at),
    listOpenLoads: () => listOpenLoads(state),
    listVisibleLoadsForOrganization: (organizationId?: string, at?: string) =>
      listVisibleLoadsForOrganization(state, organizationId, at),
    listRoutes: () => listRoutes(state),
    listTruckSlotsForDate: (date: string) => listTruckSlotsForDate(state, date),
    progressTripStatus: (input: Parameters<typeof progressTripStatus>[1]) => progressTripStatus(state, input),
    publishFutureAvailability: (input: Parameters<typeof publishFutureAvailability>[1]) => publishFutureAvailability(state, input),
    requestAssignment: (input: unknown) => requestAssignment(state, input),
    requestCapacityWithPolicy: (
      input: Parameters<typeof requestCapacityWithPolicy>[1],
      options?: Parameters<typeof requestCapacityWithPolicy>[2]
    ) => requestCapacityWithPolicy(state, input, options),
    revokeDirectOffer: (
      input: Parameters<typeof revokeDirectOffer>[1],
      options?: Parameters<typeof revokeDirectOffer>[2]
    ) => revokeDirectOffer(state, input, options),
    saveDriverMediaReference: (input: Parameters<typeof saveDriverMediaReference>[1]) => saveDriverMediaReference(state, input),
    updateDriverEconomics: (input: Parameters<typeof updateDriverEconomics>[1]) => updateDriverEconomics(state, input),
    updateLoadPosting: (input: unknown) => updateLoadPosting(state, input),
    upsertAvailabilityWindow: (input: unknown) => upsertAvailabilityWindow(state, input)
  }
}

export type LogLoadsServices = ReturnType<typeof createLogLoadsServices>

export { getDriverMediaTarget, getTripDocumentTarget, tripDocumentPublicIdPrefix }
export { loadPostingHasOwnedCoherentSources, routePackIsSafeToRead } from "./route-packs"
export { directOfferClaimCount, directOfferIsClaimable, effectiveDirectOfferStatus } from "./operating-network"
export type {
  CreateHaulRouteInput,
  CreateLandingInput,
  CreateRateInput,
  SetLandingActiveInput,
  UpdateLandingInput,
  UpsertLandingDetailsInput
} from "./host-workspace"
export type { DriverMediaKind, DriverMediaTarget } from "./driver-profile"
export type { TripDocumentAccess, TripDocumentTarget } from "./operating-network"
