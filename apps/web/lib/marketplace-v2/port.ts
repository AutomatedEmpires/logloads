import type {
  BoostPackageCode,
  HaulerFleetView,
  HaulerProfileView,
  MarketplaceAdminAccess,
  MarketplaceAdminLandingPrivateView,
  MarketplaceAdminQueueView,
  MarketplaceAdminReportFilters,
  MarketplaceAdminReportView,
  MarketplaceAdminThreadMessageView,
  MarketplaceAdminVerificationView,
  MarketplaceAvailabilityAttestation,
  MarketplaceBoostAudienceView,
  MarketplaceBoostView,
  MarketplaceCapability,
  MarketplaceDraftLandingContext,
  MarketplaceEmailNoticeClaim,
  MarketplaceEmailNoticeOutcome,
  MarketplaceEmailProviderEvent,
  MarketplaceFeatureCapability,
  MarketplaceFoundingOfferView,
  MarketplaceHaulerEquipmentOption,
  MarketplaceInquiryJobContext,
  MarketplaceInterestView,
  MarketplaceInvitationAudienceView,
  MarketplaceInvitationRecipientView,
  MarketplaceInvitationSendReceipt,
  MarketplaceJobCardView,
  MarketplaceJobDetailView,
  MarketplaceJobDraft,
  MarketplaceJobEditReceipt,
  MarketplaceJobFilters,
  MarketplaceJobStopStatus,
  MarketplaceLandingAllowanceView,
  MarketplaceLandingStatus,
  MarketplaceLandingView,
  MarketplaceListingReportReceipt,
  MarketplaceNoticeStatus,
  MarketplaceNotificationListOptions,
  MarketplaceNotificationPreferenceView,
  MarketplaceNotificationView,
  MarketplaceOwnJobDetailView,
  MarketplaceOwnJobFilters,
  MarketplaceOwnJobView,
  MarketplacePlanAllowanceView,
  MarketplaceReceivedInvitationView,
  MarketplaceReceivedTeamInvitationView,
  MarketplaceSavedJobView,
  MarketplaceSavedSearchView,
  MarketplaceSentInvitationView,
  MarketplaceTeamView,
  MarketplaceTruckCardView,
  MarketplaceTruckFilters,
  MarketplaceV2Feature,
  MarketplaceV2FeatureSupport
} from "@logloads/contracts"

/**
 * The only data boundary the V2 screens use. Two adapters implement it:
 *
 * - `pilot-adapter.ts` over the versioned `operating_state` document and the existing service layer (the default);
 * - `normalized-adapter.ts` over the `marketplace` schema's functions (architecture/normalized-v2), selected only
 *   by `LOGLOADS_MARKETPLACE_V2_ADAPTER=normalized` outside production (`adapter.ts`).
 *
 * `viewer` is always resolved from the server session by the caller, never from request input.
 */
export interface MarketplaceV2Viewer {
  userId: string
  organizationId: string
}

/** The signed-in person acting for no business: before setting one up, answering a seat invitation, or as LogLoads staff. */
export type MarketplaceV2Account = Pick<MarketplaceV2Viewer, "userId">

export interface MarketplaceV2ViewerAccess {
  organizationName: string
  capabilities: MarketplaceCapability[]
}

/** Thrown by adapters that cannot persist an operation (e.g. publishing on the pilot store). */
export class MarketplaceOperationUnavailableError extends Error {
  constructor(operation: string) {
    super(`${operation} is not available until the normalized marketplace store is connected`)
    this.name = "MarketplaceOperationUnavailableError"
  }
}

/**
 * Thrown by the normalized adapter for a port v3 group (#244) whose task has not landed yet. It is an
 * `MarketplaceOperationUnavailableError`, so every page that handles an unavailable operation handles this one too.
 */
export class MarketplaceFeatureUnavailableError extends MarketplaceOperationUnavailableError {
  readonly feature: MarketplaceV2Feature

  constructor(feature: MarketplaceV2Feature, operation: string) {
    super(operation)
    this.message = `${operation} is not available yet`
    this.name = "MarketplaceFeatureUnavailableError"
    this.feature = feature
  }
}

/**
 * A business rule or access refusal from the marketplace store. Its message is written for the person using the
 * page and may be shown; it never carries another organization's data. `code` is the store's reason code
 * (a SQLSTATE such as `23514`, `42501` or `P0002`) when there is one.
 */
export class MarketplaceRefusalError extends Error {
  readonly code: string | null

  constructor(message: string, code: string | null = null) {
    super(message)
    this.name = "MarketplaceRefusalError"
    this.code = code
  }
}

/** The marketplace store failed for a reason the person cannot fix (unavailable, timed out, unexpected data). */
export class MarketplaceStoreError extends Error {
  readonly code: string | null

  constructor(message = "The marketplace could not complete this request. Try again in a moment.", code: string | null = null, cause?: unknown) {
    // `cause` is for server logs only; the message shown to people never includes it.
    super(message, cause === undefined ? undefined : { cause })
    this.name = "MarketplaceStoreError"
    this.code = code
  }
}

/** The selected adapter is missing or has unsafe configuration. Fails closed; never falls back to another store. */
export class MarketplaceAdapterConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MarketplaceAdapterConfigurationError"
  }
}

export interface MarketplaceV2Port
  extends MarketplaceJobsPort,
    MarketplaceBillingPort,
    MarketplaceTeamPort,
    MarketplaceInvitesPort,
    MarketplaceTrucksPort,
    MarketplaceAlertsPort,
    MarketplaceNotifyPort,
    MarketplaceBoostsPort,
    MarketplaceAdminPort {
  /** Whether native V2 job publishing and reconfirmation persist through this adapter. */
  readonly supportsPublishing: boolean
  /** Which port v3 groups (#244) work through this adapter. A group that is `false` refuses every one of its methods. */
  readonly supports: MarketplaceV2FeatureSupport

  /** Public discovery. Returns only public-safe fields; never exact coordinates or access details. */
  listJobs(filters: MarketplaceJobFilters): Promise<MarketplaceJobCardView[]>
  /**
   * One listing's public view. With the session's `viewer`, a store that hides paused, filled, closed or expired jobs
   * from the public may still return one the viewer is allowed to see (their own business's job, or one they sent
   * interest on), so the job page can say why it stopped and when (UX-07, #130). The fields are the same either way.
   */
  getJob(jobId: string, viewer?: MarketplaceV2Viewer | null): Promise<MarketplaceJobDetailView | null>

  // --- Listing reports (UX-07, #130) ---
  /**
   * Report a listing to LogLoads staff (spec §8.18). `input` is checked against `reportListingInputSchema`. One
   * standing report per person and listing: a repeat returns that report (`alreadyReported`) and files nothing. The
   * listing stays up until staff review it. Throws `MarketplaceOperationUnavailableError` when the store keeps no reports.
   */
  reportListing(viewer: MarketplaceV2Viewer, input: unknown): Promise<MarketplaceListingReportReceipt>

  /** The viewer's V2 capabilities in the active workspace (empty when the role has none). */
  viewerAccess(viewer: MarketplaceV2Viewer): Promise<MarketplaceV2ViewerAccess>
  /**
   * Port v3 (#244): the viewer's feature capabilities in the active workspace, derived by
   * `marketplaceFeatureCapabilities` from the same membership as `viewerAccess` (empty when the role has none). A
   * capability says what the person's role allows, not what the adapter can do: a page offers an action only when
   * both the capability and `supports[group]` say so. Refuses a person who is not a member, as `viewerAccess` does.
   */
  viewerFeatureCapabilities(viewer: MarketplaceV2Viewer): Promise<MarketplaceFeatureCapability[]>
  /** Equipment configurations from the viewer's own hauling-business profile (self-reported). */
  haulerEquipment(viewer: MarketplaceV2Viewer): Promise<MarketplaceHaulerEquipmentOption[]>
  /** The viewer organization's own landings, public labels only. Requires `job.publish`. */
  authoringLandings(viewer: MarketplaceV2Viewer): Promise<MarketplaceDraftLandingContext[]>

  /** The viewer's own hauling business's interest in a job, if any. */
  interestForJob(viewer: MarketplaceV2Viewer, jobId: string): Promise<MarketplaceInterestView | null>
  listHaulerInterests(viewer: MarketplaceV2Viewer): Promise<MarketplaceInterestView[]>
  listLandingInterests(viewer: MarketplaceV2Viewer): Promise<MarketplaceInterestView[]>
  expressInterest(viewer: MarketplaceV2Viewer, input: unknown): Promise<MarketplaceInterestView>
  withdrawInterest(viewer: MarketplaceV2Viewer, interestId: string): Promise<void>
  respondToInterest(viewer: MarketplaceV2Viewer, input: unknown): Promise<void>
  postHaulerReply(viewer: MarketplaceV2Viewer, input: unknown): Promise<void>

  /**
   * Publish a validated draft as an active job. The caller has already checked `job.publish`, landing
   * ownership, the draft and publishing rules, and the explicit attestation. `attestation.confirmedAt`
   * (server clock) becomes the job's initial `lastConfirmedAt` (ATT-1, #114). Throws
   * `MarketplaceOperationUnavailableError` when unsupported.
   */
  publishJob(viewer: MarketplaceV2Viewer, draft: MarketplaceJobDraft, attestation: MarketplaceAvailabilityAttestation): Promise<{ jobId: string }>
  /**
   * Record the poster's explicit "still available" confirmation: `attestation.confirmedAt` becomes the
   * job's `lastConfirmedAt`. Only this method and `publishJob` may set it; editing a job never does.
   * Throws when unsupported.
   */
  reconfirmJob(viewer: MarketplaceV2Viewer, jobId: string, attestation: MarketplaceAvailabilityAttestation): Promise<void>

  // ---------------------------------------------------------------------------------------------------------------
  // Landing workspace: setup, landings and allowances (#127 UX-04, #133 UX-10). Business rules in
  // packages/services/src/marketplace-landings.ts; inputs and views in packages/contracts/src/marketplace-landings.ts.
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * The active business's own landings, recruiting first, each with its private half for the business's own landing
   * desk (`job.publish`). Never another business's landings.
   */
  listOwnLandings(viewer: MarketplaceV2Viewer): Promise<MarketplaceLandingView[]>
  /** One of the active business's own landings, or `null` when it is not one of them. */
  getOwnLanding(viewer: MarketplaceV2Viewer, landingId: string): Promise<MarketplaceLandingView | null>
  /**
   * Create a landing (no `landingId`) or edit one's details (`marketplaceLandingInputSchema`). Needs `landing.manage`.
   * A new landing recruits only when asked and when the plan allows it; an edit never changes the status. A missing
   * exact location never blocks saving.
   */
  saveLanding(viewer: MarketplaceV2Viewer, input: unknown): Promise<{ landingId: string }>
  /**
   * Pause, archive, restore or start recruiting at a landing. Starting needs a plan with room (server-enforced);
   * pausing or archiving unlists the landing's jobs. Needs `landing.manage`.
   */
  setLandingStatus(viewer: MarketplaceV2Viewer, landingId: string, status: MarketplaceLandingStatus): Promise<void>
  /** The active business's plan and counts. Limits come from contracts (`LANDING_PLANS`), never from the store. */
  landingAllowance(viewer: MarketplaceV2Viewer): Promise<MarketplaceLandingAllowanceView>
  /**
   * Set up a landing business owned by the signed-in person (`landingOrganizationInputSchema`). `account` is the
   * session's own user; there is no business yet. Throws `MarketplaceOperationUnavailableError` when unsupported.
   */
  createLandingOrganization(account: Pick<MarketplaceV2Viewer, "userId">, input: unknown): Promise<{ organizationId: string }>

  /** Whether saving the hauling-business profile persists through this adapter (#125). */
  readonly supportsHaulerProfile: boolean
  /**
   * The viewer's own hauling business profile, private fields included, for the business's members only. Refuses a
   * person who is not a member of the active business, and a business with no hauler profile.
   */
  haulerProfile(viewer: MarketplaceV2Viewer): Promise<HaulerProfileView>
  /**
   * Save the profile form (`haulerProfileInputSchema`, re-parsed here). Owners and managers may change the profile;
   * only the owner may change the business name or legal name (`planHaulerProfileSave`). Returns the saved profile.
   * Throws `MarketplaceOperationUnavailableError` when this adapter cannot persist it.
   */
  saveHaulerProfile(viewer: MarketplaceV2Viewer, input: unknown): Promise<HaulerProfileView>
  /**
   * Set up a hauling business owned by the signed-in person (UX 02 §A3; #213): the business, its hauler profile and
   * the profile's public basics (`haulerProfileInputSchema`, re-parsed here), in one change. `account` is the V2
   * session's own person; there is no active business yet. Throws `MarketplaceOperationUnavailableError` where the
   * store cannot add a business to an existing account (the pilot store).
   */
  createHaulingBusiness(account: Pick<MarketplaceV2Viewer, "userId">, input: unknown): Promise<{ organizationId: string }>

  /** Whether "My trucks" (equipment and availability) persists through this adapter (#126). */
  readonly supportsHaulerFleet: boolean
  /**
   * The active hauling business's listed equipment and latest self-reported availability per truck type. Refuses a
   * person who is not a member of that business, and a business with no hauler profile.
   */
  haulerFleet(viewer: MarketplaceV2Viewer): Promise<HaulerFleetView>
  /** Add a configuration (or extra) from the presets (`haulerEquipmentAddInputSchema`). Owner, manager or staff. */
  addHaulerEquipment(viewer: MarketplaceV2Viewer, input: unknown): Promise<void>
  /** Change one listed row's count (`haulerEquipmentCountInputSchema`); 0 takes it off the list. */
  setHaulerEquipmentCount(viewer: MarketplaceV2Viewer, input: unknown): Promise<void>
  /**
   * Report one truck type available now, from a date, or not available (`haulerAvailabilityInputSchema`). The count
   * can never exceed the units of that type listed (`planAvailabilityReport`).
   */
  reportHaulerAvailability(viewer: MarketplaceV2Viewer, input: unknown): Promise<void>
  /** "Confirm all as shown": re-states every truck type with a fresh answer, dated now. */
  confirmHaulerAvailability(viewer: MarketplaceV2Viewer): Promise<{ confirmed: number }>

  // --- Inquiry conversations (UX-09, #132) ---------------------------------------------------------------------
  /**
   * Withdraw the viewer's own inquiry with an optional reason (`withdrawInterestInputSchema`), posted as the
   * hauler's last message in the same change. A declined inquiry is refused ("The landing has closed this
   * inquiry") and nothing is written.
   */
  withdrawInterestWithReason(viewer: MarketplaceV2Viewer, input: unknown): Promise<void>
  /**
   * The viewer landing organization's jobs that have inquiries: the landing each is posted at and the equipment
   * codes it asks for, for the inbox's landing filter and equipment comparison. Requires `inquiry.respond`; never
   * another organization's jobs, and never private landing details.
   */
  landingInquiryJobs(viewer: MarketplaceV2Viewer): Promise<MarketplaceInquiryJobContext[]>
}

// =================================================================================================================
// Port v3 (#244): the feature groups the UX spec v1.0 work still needs (logloads#235, N1–N9). Views and inputs are in
// packages/contracts/src/marketplace-port-v3.ts and packages/contracts/src/v2/<group>/. Each group is built by its
// task in `./<group>/` (already wired into normalized-adapter.ts), mapped to the SQL function each method names
// (architecture/normalized-v2, stages 01–26). Until it lands, the group refuses with `MarketplaceFeatureUnavailableError`
// and `supports[group]` is `false`. The pilot store keeps none of these records, so the pilot adapter refuses every
// one with `MarketplaceOperationUnavailableError`.
//
// `input: unknown` is parsed by the adapter against the group's schema, whose output is the named `…Input` type.
// Every viewer method acts for the viewer's ACTIVE business only, as the methods above do.
// =================================================================================================================

/** jobs (#247): the poster's own jobs (UX spec §4.4, §4.6, §8.3, §10.11). Each method needs `job.publish`. */
export interface MarketplaceJobsPort {
  /** The active business's own jobs in every status, newest first. */
  listOwnJobs(viewer: MarketplaceV2Viewer, filters?: MarketplaceOwnJobFilters): Promise<MarketplaceOwnJobView[]>
  /** One of the business's own jobs with its editable draft; `null` when it is not one of them. */
  getOwnJob(viewer: MarketplaceV2Viewer, jobId: string): Promise<MarketplaceOwnJobDetailView | null>
  /**
   * Save changed terms of one of the business's own published jobs (the caller validated `draft` as for publishing).
   * Never sets `lastConfirmedAt`, never changes the status, never moves the job to another business's landing.
   */
  editJob(viewer: MarketplaceV2Viewer, jobId: string, draft: MarketplaceJobDraft): Promise<MarketplaceJobEditReceipt>
  /** Pause, mark filled or close (`set_job_posting_status`). Stopping a boosted job never leaves it sponsored (§4.6). */
  setJobStatus(viewer: MarketplaceV2Viewer, jobId: string, status: MarketplaceJobStopStatus): Promise<void>
  /**
   * Put a stopped job back on the marketplace with a fresh "still available" attestation (`reactivate_job_posting`,
   * action `reconfirm`): it sets `lastConfirmedAt`. Refused on a moderation hold or once the job's expiry passed.
   */
  resumeJob(viewer: MarketplaceV2Viewer, jobId: string, attestation: MarketplaceAvailabilityAttestation): Promise<void>
  /** A new draft copied from one of the business's own jobs, dates cleared. Nothing is saved until it is published. */
  duplicateJob(viewer: MarketplaceV2Viewer, jobId: string): Promise<MarketplaceJobDraft>
}

/** billing (#248): the plan and allowance read model; no Stripe and no billing gates (§2.3, §2.5, §4.12). `plan.view`. */
export interface MarketplaceBillingPort {
  /** `get_org_entitlement_state`, whole. Limits come from `LANDING_PLANS` by `planCode`, never from the store. */
  planAllowance(viewer: MarketplaceV2Viewer): Promise<MarketplacePlanAllowanceView>
  /** The business's founding-operator offer (`promotion_redemptions`); `null` when it has none. */
  foundingOffer(viewer: MarketplaceV2Viewer): Promise<MarketplaceFoundingOfferView | null>
}

/** team (#249): seats and seat invitations (§2.4, §4.11, §8.7, §8.15). Owner methods need `team.manage`. */
export interface MarketplaceTeamPort {
  /** Members and the invitations the owner sent (`list_team_invitations`). */
  team(viewer: MarketplaceV2Viewer): Promise<MarketplaceTeamView>
  /**
   * Invite an email address (`MarketplaceTeamInviteInput`; `invite_team_member`). A pending invitation with a seat holds
   * that seat, so the plan's cap can never be passed. Never invites an owner.
   */
  inviteTeamMember(viewer: MarketplaceV2Viewer, input: unknown): Promise<{ invitationId: string }>
  /** Send a pending invitation again, at most five sends (`resend_team_invitation`). Returns the new expiry. */
  resendTeamInvitation(viewer: MarketplaceV2Viewer, invitationId: string): Promise<{ expiresAt: string }>
  /** `revoke_team_invitation`: the held seat is released. */
  revokeTeamInvitation(viewer: MarketplaceV2Viewer, invitationId: string): Promise<void>
  /** Limit a seated manager or staff member to some landings, or none (`MarketplaceTeamScopeInput`; `set_membership_landing_scope`). */
  setMemberLandingScope(viewer: MarketplaceV2Viewer, input: unknown): Promise<void>
  /**
   * End a member's access at once (§4.11). Never the sole owner. No stage 01–26 function removes a membership, so this
   * needs a schema change before any adapter supports it.
   */
  removeTeamMember(viewer: MarketplaceV2Viewer, membershipId: string): Promise<void>
  /** Seat invitations sent to the person's verified email (`list_my_team_invitations`). */
  receivedTeamInvitations(account: MarketplaceV2Account): Promise<MarketplaceReceivedTeamInvitationView[]>
  /** `accept_team_invitation`: the membership starts active. Returns the business to switch to. */
  acceptTeamInvitation(account: MarketplaceV2Account, invitationId: string): Promise<{ organizationId: string }>
  /** `decline_team_invitation`. */
  declineTeamInvitation(account: MarketplaceV2Account, invitationId: string): Promise<void>
}

/**
 * invites (#250): targeted invitations (§4.9, §5.6, §8.12). Allowance 3/10/30 per cycle, no rollover, no overage; a
 * failed delivery never consumes it. Sending needs `invitation.send`; answering needs `invitation.respond`.
 */
export interface MarketplaceInvitesPort {
  /** Exact eligible count for one of the business's active jobs (`count_eligible_invitation_recipients`). `job.publish`. */
  invitationAudience(viewer: MarketplaceV2Viewer, jobId: string): Promise<MarketplaceInvitationAudienceView>
  /** The opted-in businesses the composer can select for that job (§4.9 step 2). `job.publish`. */
  invitationRecipients(viewer: MarketplaceV2Viewer, jobId: string): Promise<MarketplaceInvitationRecipientView[]>
  /**
   * Reserve one invitation per selected business (`MarketplaceInvitationSendInput`; `reserve_targeted_invitation`).
   * Idempotent per `requestId`. Each recipient is reserved or refused on its own; the receipt states which.
   */
  sendTargetedInvitations(viewer: MarketplaceV2Viewer, input: unknown): Promise<MarketplaceInvitationSendReceipt>
  /** Invitations the business sent, newest first; for one job, or all when `jobId` is `null`. `job.publish`. */
  sentInvitations(viewer: MarketplaceV2Viewer, jobId: string | null): Promise<MarketplaceSentInvitationView[]>
  /** The hauling business's invitation inbox, delivered invitations only (§5.6). `invitation.respond`. */
  receivedInvitations(viewer: MarketplaceV2Viewer): Promise<MarketplaceReceivedInvitationView[]>
  /** Viewed, interested or declined (`MarketplaceInvitationReplyInput`; `respond_to_invitation`). Never a hire. */
  respondToInvitation(viewer: MarketplaceV2Viewer, input: unknown): Promise<void>
}

/** trucks (#251): Find Trucks and saved truck searches (§4.8, §4.13). `truck.search`; saved searches and alerts are Pro+. */
export interface MarketplaceTrucksPort {
  /** Listed hauling businesses only (`hauler_profiles.listed`), public profile fields and self-reported availability. */
  searchTrucks(viewer: MarketplaceV2Viewer, filters: MarketplaceTruckFilters): Promise<MarketplaceTruckCardView[]>
  /** The person's own saved truck searches in the active business (`saved_searches`, kind `trucks`). */
  listTruckSearches(viewer: MarketplaceV2Viewer): Promise<MarketplaceSavedSearchView[]>
  /** Create or edit one (`MarketplaceSavedSearchInput`). Refused below a plan with `availability_alerts`. */
  saveTruckSearch(viewer: MarketplaceV2Viewer, input: unknown): Promise<{ searchId: string }>
  deleteTruckSearch(viewer: MarketplaceV2Viewer, searchId: string): Promise<void>
}

/** alerts (#252): saved jobs, job searches and notification consent, free for haulers (§5.9, §8.19). */
export interface MarketplaceAlertsPort {
  /** `list_saved_jobs`: closure shown, never private details. `saved_job.manage`. */
  listSavedJobs(viewer: MarketplaceV2Viewer): Promise<MarketplaceSavedJobView[]>
  /** Save an open job of another business (`saved_jobs`, `tg_saved_job_guard`). Saving again changes nothing. */
  saveJob(viewer: MarketplaceV2Viewer, jobId: string): Promise<void>
  unsaveJob(viewer: MarketplaceV2Viewer, jobId: string): Promise<void>
  /** The person's own saved job searches (`saved_searches`, kind `jobs`). `alert.manage`. */
  listJobSearches(viewer: MarketplaceV2Viewer): Promise<MarketplaceSavedSearchView[]>
  /** Create or edit one (`MarketplaceSavedSearchInput`); alerts are sent only with consent. */
  saveJobSearch(viewer: MarketplaceV2Viewer, input: unknown): Promise<{ searchId: string }>
  deleteJobSearch(viewer: MarketplaceV2Viewer, searchId: string): Promise<void>
  /** Every category and channel for the person in the active business, unset ones as off (`notification_preferences`). */
  notificationPreferences(viewer: MarketplaceV2Viewer): Promise<MarketplaceNotificationPreferenceView[]>
  /** Turn one consent on or off (`MarketplaceNotificationPreferenceInput`). Takes effect for the next notice queued. */
  setNotificationPreference(viewer: MarketplaceV2Viewer, input: unknown): Promise<void>
}

/** notify (#253): the person's in-app notices (26-D). Email delivery is `MarketplaceV2NotificationWorker`, below. */
export interface MarketplaceNotifyPort {
  /** The person's own notices in the active business, newest first; email ones show their true delivery state. */
  listNotifications(viewer: MarketplaceV2Viewer, options?: MarketplaceNotificationListOptions): Promise<MarketplaceNotificationView[]>
  /** `mark_notifications_read`, at most 200 at a time; only the person's own in-app notices change. */
  markNotificationsRead(viewer: MarketplaceV2Viewer, notificationIds: readonly string[]): Promise<{ marked: number }>
}

/** boosts (#254): audience estimate and the business's boosts; no purchase (§4.10, §8.13, §8.14). `boost.estimate`. */
export interface MarketplaceBoostsPort {
  /** Real opted-in counts in the package's radius around one of the business's jobs (`estimate_boost_audience`). */
  boostAudience(viewer: MarketplaceV2Viewer, jobId: string, packageCode: BoostPackageCode): Promise<MarketplaceBoostAudienceView>
  /** The business's boosts, newest first; for one job, or all when `jobId` is `null`. */
  listJobBoosts(viewer: MarketplaceV2Viewer, jobId: string | null): Promise<MarketplaceBoostView[]>
}

/**
 * admin (#255): LogLoads staff only (`platform_admins`), never an organization role (§7, §8.7). Each method acts as
 * the person, the store checks their admin role, and every write records the stated reason in the audit log.
 */
export interface MarketplaceAdminPort {
  /** The person's admin roles; empty for everyone else. */
  adminAccess(account: MarketplaceV2Account): Promise<MarketplaceAdminAccess>
  /** Aggregate queue counts (§7.1). */
  adminQueue(account: MarketplaceV2Account): Promise<MarketplaceAdminQueueView>
  /** Businesses awaiting verification review, oldest first (§7.2). */
  adminVerificationQueue(account: MarketplaceV2Account): Promise<MarketplaceAdminVerificationView[]>
  /** `admin_set_org_verification` (`MarketplaceAdminVerificationInput`). */
  adminSetVerification(account: MarketplaceV2Account, input: unknown): Promise<void>
  /** Reports, oldest open first (§7.3). */
  adminReports(account: MarketplaceV2Account, filters?: MarketplaceAdminReportFilters): Promise<MarketplaceAdminReportView[]>
  /** Mark a report reviewing, actioned or dismissed (`MarketplaceAdminReportResolutionInput`). */
  adminResolveReport(account: MarketplaceV2Account, input: unknown): Promise<void>
  /** Pause, close or expire a job and hold it (`MarketplaceAdminModerationInput`; `admin_moderate_job_posting`). */
  adminModerateJob(account: MarketplaceV2Account, input: unknown): Promise<void>
  /** `admin_release_job_moderation_hold` (`MarketplaceAdminReleaseInput`). The job stays stopped until its poster resumes it. */
  adminReleaseJobHold(account: MarketplaceV2Account, input: unknown): Promise<void>
  /** `admin_grant_founding_promotion` (`MarketplaceAdminFoundingPromotionInput`): billing admins, verified businesses only. */
  adminGrantFoundingPromotion(account: MarketplaceV2Account, input: unknown): Promise<{ redemptionId: string }>
  /** `admin_grant_founding_hauler_badge` (`MarketplaceAdminFoundingBadgeInput`). Recognition only. Returns the badge number. */
  adminGrantFoundingHaulerBadge(account: MarketplaceV2Account, input: unknown): Promise<{ badgeNumber: number }>
  /** `admin_read_landing_private` (`MarketplaceAdminPrivateReadInput`, the landing id): audited, for an investigation. */
  adminReadLandingPrivate(account: MarketplaceV2Account, input: unknown): Promise<MarketplaceAdminLandingPrivateView | null>
  /** `admin_read_interest_thread` (`MarketplaceAdminPrivateReadInput`, the inquiry id): audited, for an investigation. */
  adminReadInquiryThread(account: MarketplaceV2Account, input: unknown): Promise<MarketplaceAdminThreadMessageView[]>
}

/** Each port v3 group's methods, by group. */
export interface MarketplaceV2FeaturePorts {
  jobs: MarketplaceJobsPort
  billing: MarketplaceBillingPort
  team: MarketplaceTeamPort
  invites: MarketplaceInvitesPort
  trucks: MarketplaceTrucksPort
  alerts: MarketplaceAlertsPort
  notify: MarketplaceNotifyPort
  boosts: MarketplaceBoostsPort
  admin: MarketplaceAdminPort
}

/** One label per method of every group: a group missing a method, or naming one it lacks, fails to compile. */
export type MarketplaceV2FeatureOperations = {
  readonly [F in MarketplaceV2Feature]: { readonly [M in keyof MarketplaceV2FeaturePorts[F]]-?: string }
}

/** What each method does, as its refusal names it ("Editing a job is not available yet"). Also each group's method list. */
export const MARKETPLACE_V2_FEATURE_OPERATIONS = {
  jobs: {
    duplicateJob: "Duplicating a job",
    editJob: "Editing a job",
    getOwnJob: "Managing a job",
    listOwnJobs: "Managing your jobs",
    resumeJob: "Putting a job back on the marketplace",
    setJobStatus: "Pausing or closing a job"
  },
  billing: {
    foundingOffer: "Reading the founding offer",
    planAllowance: "Reading the plan and allowances"
  },
  team: {
    acceptTeamInvitation: "Accepting a team invitation",
    declineTeamInvitation: "Declining a team invitation",
    inviteTeamMember: "Inviting a team member",
    receivedTeamInvitations: "Reading your team invitations",
    removeTeamMember: "Removing a team member",
    resendTeamInvitation: "Resending a team invitation",
    revokeTeamInvitation: "Revoking a team invitation",
    setMemberLandingScope: "Changing a team member's landings",
    team: "Managing the team"
  },
  invites: {
    invitationAudience: "Counting haulers to invite",
    invitationRecipients: "Choosing haulers to invite",
    receivedInvitations: "Reading invitations",
    respondToInvitation: "Answering an invitation",
    sendTargetedInvitations: "Sending targeted invitations",
    sentInvitations: "Reading sent invitations"
  },
  trucks: {
    deleteTruckSearch: "Deleting a truck search",
    listTruckSearches: "Reading saved truck searches",
    saveTruckSearch: "Saving a truck search",
    searchTrucks: "Finding trucks"
  },
  alerts: {
    deleteJobSearch: "Deleting a job search",
    listJobSearches: "Reading saved job searches",
    listSavedJobs: "Reading saved jobs",
    notificationPreferences: "Reading notification settings",
    saveJob: "Saving a job",
    saveJobSearch: "Saving a job search",
    setNotificationPreference: "Changing notification settings",
    unsaveJob: "Removing a saved job"
  },
  notify: {
    listNotifications: "Reading notifications",
    markNotificationsRead: "Marking notifications read"
  },
  boosts: {
    boostAudience: "Estimating a boost audience",
    listJobBoosts: "Reading boosts"
  },
  admin: {
    adminAccess: "Checking LogLoads staff access",
    adminGrantFoundingHaulerBadge: "Granting a founding hauler badge",
    adminGrantFoundingPromotion: "Granting a founding offer",
    adminModerateJob: "Moderating a job",
    adminQueue: "Reading the admin queue",
    adminReadInquiryThread: "Reading an inquiry for an investigation",
    adminReadLandingPrivate: "Reading a landing's private details for an investigation",
    adminReleaseJobHold: "Releasing a moderation hold",
    adminReports: "Reading reports",
    adminResolveReport: "Resolving a report",
    adminSetVerification: "Changing a business's verification",
    adminVerificationQueue: "Reading the verification queue"
  }
} as const satisfies MarketplaceV2FeatureOperations

/** The method names of one group. */
export function marketplaceV2FeatureMethods<F extends MarketplaceV2Feature>(feature: F): Array<keyof MarketplaceV2FeaturePorts[F] & string> {
  return Object.keys(MARKETPLACE_V2_FEATURE_OPERATIONS[feature]) as Array<keyof MarketplaceV2FeaturePorts[F] & string>
}

/**
 * A group whose every method rejects with `refusal(operation)` and reaches no store. Each group's normalized entry
 * module (`./<group>/index.ts`) returns it until the group's task replaces it with the real methods.
 */
export function unavailableMarketplaceV2Feature<F extends MarketplaceV2Feature>(
  feature: F,
  refusal: (operation: string) => Error = (operation) => new MarketplaceFeatureUnavailableError(feature, operation)
): MarketplaceV2FeaturePorts[F] {
  const operations: Readonly<Record<string, string>> = MARKETPLACE_V2_FEATURE_OPERATIONS[feature]

  return Object.fromEntries(
    Object.entries(operations).map(([method, operation]) => [method, async () => Promise.reject(refusal(operation))])
  ) as unknown as MarketplaceV2FeaturePorts[F]
}

/**
 * The email worker's side of the notification outbox (26-D), for #253. It is NOT part of `MarketplaceV2Port`: it acts
 * for no person, runs with its own service-role connection (`claim_email_notifications`, `complete_email_notification`,
 * `record_email_provider_event` and `enqueue_job_alerts` are granted to `service_role` only), and no page reaches it.
 * It sends only to test recipients until delivery is approved (#253).
 */
export interface MarketplaceV2NotificationWorker {
  /** Lease up to `limit` (1–100) due emails for `leaseSeconds` (30–900). Consent and eligibility are checked again. */
  claimEmailNotices(limit: number, leaseSeconds: number): Promise<MarketplaceEmailNoticeClaim[]>
  /** Finish one claimed email with its claim token. `retry` comes back `pending` until the fifth attempt, then `failed`. */
  completeEmailNotice(
    notificationId: string,
    claimToken: string,
    outcome: MarketplaceEmailNoticeOutcome
  ): Promise<Extract<MarketplaceNoticeStatus, "sent" | "pending" | "failed" | "suppressed">>
  /** The provider's delivered or bounced event. Returns how many notices changed (0 for an unknown message id). */
  recordEmailProviderEvent(event: MarketplaceEmailProviderEvent): Promise<{ updated: number }>
  /** Queue job alerts for one saved job search's new matches (1–50 jobs), consent checked. Returns how many were queued. */
  enqueueJobAlerts(savedSearchId: string, jobIds: readonly string[]): Promise<{ queued: number }>
}
