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
  applyCredentialReview,
  driverCredentialGate,
  hostCredentialSummary,
  listDriverCredentials,
  submitCredential
} from "./driver-credentials"
import {
  getDriverMediaTarget,
  getFeaturedTruckPhotoReference,
  saveDriverMediaReference,
  setFeaturedTruckPhoto,
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
import {
  acceptInvitationAsNewAccount,
  acceptInvitationForExistingUser,
  createOrganizationInvitation,
  declineOrganizationInvitation,
  listPendingInvitationsForEmail,
  listPendingInvitationsForOrganization,
  revokeOrganizationInvitation
} from "./invitations"
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
  confirmDriverPaymentReceived,
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
  latestTripInspection,
  markDriverPaymentSent,
  progressTripStatus,
  publishFutureAvailability,
  recordPreTripInspection,
  refreshRoutePackForAssignment,
  requestCapacityWithPolicy,
  revokeDirectOffer,
  settleHaulCompletion,
  submitHaulCompletion
} from "./operating-network"
import { listTripDocuments, requiredCompletionEvidence } from "./haul-completion"
import {
  accruePlatformFee,
  hostFeeSummary,
  markInvoicePaid,
  markInvoiceUncollectible,
  openAllClosedPeriodInvoices,
  openClosedPeriodInvoices,
  openInvoiceForPeriod,
  voidPlatformFee
} from "./platform-fees"
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
import {
  createSupportRequest,
  listSupportRequestsForAdmin,
  listSupportRequestsForReporter,
  reviewSupportRequest
} from "./support-requests"

export function createLogLoadsServices(seed?: LogLoadsDatabaseState) {
  const state = createServiceState(seed)

  return {
    state,
    DEFAULT_ACTOR_USER_ID,
    DEFAULT_ORGANIZATION_ID,
    addEquipmentCombination: (input: unknown) => addEquipmentCombination(state, input),
    applyBillingUpdate: (input: unknown) => applyBillingUpdate(state, input),
    // The platform fee ledger. Separate from applyBillingUpdate above, which is the
    // Dispatch Pro software subscription: a plan webhook must never be able to
    // touch a per-load charge.
    accruePlatformFee: (
      input: Parameters<typeof accruePlatformFee>[1],
      at?: Parameters<typeof accruePlatformFee>[2]
    ) => accruePlatformFee(state, input, at),
    voidPlatformFee: (
      input: Parameters<typeof voidPlatformFee>[1],
      at?: Parameters<typeof voidPlatformFee>[2]
    ) => voidPlatformFee(state, input, at),
    openInvoiceForPeriod: (
      input: Parameters<typeof openInvoiceForPeriod>[1],
      at?: Parameters<typeof openInvoiceForPeriod>[2]
    ) => openInvoiceForPeriod(state, input, at),
    openClosedPeriodInvoices: (
      input: Parameters<typeof openClosedPeriodInvoices>[1],
      at?: Parameters<typeof openClosedPeriodInvoices>[2]
    ) => openClosedPeriodInvoices(state, input, at),
    openAllClosedPeriodInvoices: (
      at?: Parameters<typeof openAllClosedPeriodInvoices>[1]
    ) => openAllClosedPeriodInvoices(state, at),
    markInvoicePaid: (
      input: Parameters<typeof markInvoicePaid>[1],
      at?: Parameters<typeof markInvoicePaid>[2]
    ) => markInvoicePaid(state, input, at),
    markInvoiceUncollectible: (
      input: Parameters<typeof markInvoiceUncollectible>[1],
      at?: Parameters<typeof markInvoiceUncollectible>[2]
    ) => markInvoiceUncollectible(state, input, at),
    hostFeeSummary: (
      input: Parameters<typeof hostFeeSummary>[1],
      at?: Parameters<typeof hostFeeSummary>[2]
    ) => hostFeeSummary(state, input, at),
    findEntitlementByStripeSubscription: (stripeSubscriptionId: string) => findEntitlementByStripeSubscription(state, stripeSubscriptionId),
    // The credential vault. `driverCredentialGate` is the one answer to "may this
    // driver accept work", and it is also exported as a free function below —
    // an acceptance guard has to run it INSIDE the compare-and-swap mutation that
    // writes the acceptance, where it holds a draft state rather than this
    // singleton, or the check is not a block at all.
    submitCredential: (
      input: Parameters<typeof submitCredential>[1],
      at?: Parameters<typeof submitCredential>[2]
    ) => submitCredential(state, input, at),
    applyCredentialReview: (
      input: Parameters<typeof applyCredentialReview>[1],
      at?: Parameters<typeof applyCredentialReview>[2]
    ) => applyCredentialReview(state, input, at),
    driverCredentialGate: (driverProfileId: string, at?: string) =>
      driverCredentialGate(state, driverProfileId, at),
    hostCredentialSummary: (driverProfileId: string, at?: string) =>
      hostCredentialSummary(state, driverProfileId, at),
    listDriverCredentials: (
      driverProfileId: string,
      viewer: Parameters<typeof listDriverCredentials>[2],
      at?: Parameters<typeof listDriverCredentials>[3]
    ) => listDriverCredentials(state, driverProfileId, viewer, at),
    assignDriverToEquipment: (input: unknown) => assignDriverToEquipment(state, input),
    acceptInvitationAsNewAccount: (input: Parameters<typeof acceptInvitationAsNewAccount>[1]) =>
      acceptInvitationAsNewAccount(state, input),
    acceptInvitationForExistingUser: (input: Parameters<typeof acceptInvitationForExistingUser>[1]) =>
      acceptInvitationForExistingUser(state, input),
    createAccount: (input: unknown) => createAccount(state, input),
    createOrganizationInvitation: (input: Parameters<typeof createOrganizationInvitation>[1]) =>
      createOrganizationInvitation(state, input),
    declineOrganizationInvitation: (input: Parameters<typeof declineOrganizationInvitation>[1]) =>
      declineOrganizationInvitation(state, input),
    listPendingInvitationsForEmail: (email: string) => listPendingInvitationsForEmail(state, email),
    listPendingInvitationsForOrganization: (organizationId: string) =>
      listPendingInvitationsForOrganization(state, organizationId),
    revokeOrganizationInvitation: (input: Parameters<typeof revokeOrganizationInvitation>[1]) =>
      revokeOrganizationInvitation(state, input),
    createThread: (input: unknown) => createThread(state, input),
    createSupportRequest: (
      input: Parameters<typeof createSupportRequest>[1],
      now?: Parameters<typeof createSupportRequest>[2]
    ) => createSupportRequest(state, input, now),
    findProfileByClerkId: (clerkUserId: string) => findProfileByClerkId(state, clerkUserId),
    findProfileByEmail: (email: string) => findProfileByEmail(state, email),
    getAccountContext: (userId: string) => getAccountContext(state, userId),
    getDriverMediaTarget: (input: Parameters<typeof getDriverMediaTarget>[1]) => getDriverMediaTarget(state, input),
    linkProfileToClerkUser: (userId: string, clerkUserId: string) => linkProfileToClerkUser(state, userId, clerkUserId),
    listThreadMessages: (threadId: string, viewerUserId: string) => listThreadMessages(state, threadId, viewerUserId),
    listSupportRequestsForAdmin: (reviewerUserId: string) => listSupportRequestsForAdmin(state, reviewerUserId),
    listSupportRequestsForReporter: (reporterUserId: string) => listSupportRequestsForReporter(state, reporterUserId),
    listThreadsForUser: (userId: string) => listThreadsForUser(state, userId),
    markThreadRead: (input: { threadId: string; userId: string }) => markThreadRead(state, input),
    unreadThreadCounts: (userId: string) => unreadThreadCounts(state, userId),
    listVerificationQueue: () => listVerificationQueue(state),
    postMessage: (input: unknown) => postMessage(state, input),
    resolveOperationalNotice: (input: { noticeId: string; reviewerUserId: string }) => resolveOperationalNotice(state, input),
    reviewOrganization: (input: unknown) => reviewOrganization(state, input),
    reviewSupportRequest: (
      input: Parameters<typeof reviewSupportRequest>[1],
      now?: Parameters<typeof reviewSupportRequest>[2]
    ) => reviewSupportRequest(state, input, now),
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
    createTruckSlot: (input: unknown, context: Parameters<typeof createTruckSlot>[2]) =>
      createTruckSlot(state, input, context),
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
    markDriverPaymentSent: (input: Parameters<typeof markDriverPaymentSent>[1]) =>
      markDriverPaymentSent(state, input),
    confirmDriverPaymentReceived: (input: Parameters<typeof confirmDriverPaymentReceived>[1]) =>
      confirmDriverPaymentReceived(state, input),
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
    latestTripInspection: (tripId: string) => latestTripInspection(state, tripId),
    progressTripStatus: (input: Parameters<typeof progressTripStatus>[1]) => progressTripStatus(state, input),
    recordPreTripInspection: (input: Parameters<typeof recordPreTripInspection>[1]) =>
      recordPreTripInspection(state, input),
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
    getFeaturedTruckPhotoReference: (input: Parameters<typeof getFeaturedTruckPhotoReference>[1]) =>
      getFeaturedTruckPhotoReference(state, input),
    setFeaturedTruckPhoto: (input: Parameters<typeof setFeaturedTruckPhoto>[1]) => setFeaturedTruckPhoto(state, input),
    updateDriverEconomics: (input: Parameters<typeof updateDriverEconomics>[1]) => updateDriverEconomics(state, input),
    updateLoadPosting: (input: unknown) => updateLoadPosting(state, input),
    upsertAvailabilityWindow: (input: unknown) => upsertAvailabilityWindow(state, input)
  }
}

export type LogLoadsServices = ReturnType<typeof createLogLoadsServices>

export { getDriverMediaTarget, getTripDocumentTarget, tripDocumentPublicIdPrefix }
/**
 * The credential vault, as free functions as well as bound methods.
 *
 * `driverCredentialGate` has to be callable from INSIDE the compare-and-swap
 * mutation that writes a load acceptance, where the caller holds a draft state
 * rather than a services singleton — a check made outside that mutation is
 * defeated by a replay. `hostCredentialSummary` is exported for the same reason:
 * the summary the host receives is built in the mutation that records the
 * acceptance, from the same draft the gate was evaluated against, so the two can
 * never describe different vaults.
 *
 * `credentialDocumentPublicIdPrefix` is the namespace an upload target must sign
 * against. `submitCredential` refuses a document stored anywhere else, so both
 * sides have to derive the path from this one function.
 */
export {
  applyCredentialReview,
  credentialDocumentPublicIdPrefix,
  credentialReviewId,
  driverCredentialGate,
  driverCredentialId,
  hostCredentialSummary,
  listDriverCredentials,
  submitCredential
} from "./driver-credentials"
export type {
  ApplyCredentialReviewInput,
  ApplyCredentialReviewResult,
  CredentialViewer,
  DriverCredentialVaultView,
  DriverCredentialView,
  HostCredentialSummary,
  HostCredentialView,
  SubmitCredentialInput,
  SubmitCredentialResult
} from "./driver-credentials"
export { listActiveLoadsUsingCombination } from "./equipment"
export {
  SupportRequestAuthorizationError,
  SupportRequestConflictError,
  SupportRequestNotFoundError
} from "./support-requests"
export { loadPostingHasOwnedCoherentSources, routePackIsSafeToRead } from "./route-packs"
export { directOfferClaimCount, directOfferIsClaimable, effectiveDirectOfferStatus } from "./operating-network"
/**
 * Exported as free functions as well as bound methods: the accrual has to be
 * callable from INSIDE the compare-and-swap mutation that settles a completion,
 * where the caller holds a draft state rather than a services singleton. The
 * at-most-one check only defends anything if it runs in that same mutation.
 */
export {
  accruePlatformFee,
  hostFeeSummary,
  hostInvoiceId,
  markInvoicePaid,
  markInvoiceUncollectible,
  openAllClosedPeriodInvoices,
  openClosedPeriodInvoices,
  openInvoiceForPeriod,
  voidPlatformFee
} from "./platform-fees"
export type {
  AccruePlatformFeeInput,
  AccruePlatformFeeResult,
  HostFeeSummary,
  HostFeeSummaryInput,
  InvoiceSettlementInput,
  InvoiceSettlementResult,
  OpenInvoiceForPeriodInput,
  OpenInvoiceForPeriodResult,
  VoidPlatformFeeInput,
  VoidPlatformFeeResult
} from "./platform-fees"
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
