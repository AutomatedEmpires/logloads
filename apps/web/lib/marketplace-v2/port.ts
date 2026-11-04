import type {
  MarketplaceAvailabilityAttestation,
  MarketplaceCapability,
  MarketplaceDraftLandingContext,
  MarketplaceHaulerEquipmentOption,
  MarketplaceInterestView,
  MarketplaceJobCardView,
  MarketplaceJobDetailView,
  MarketplaceJobDraft,
  MarketplaceJobFilters,
  MarketplaceListingReportReceipt
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

export interface MarketplaceV2Port {
  /** Whether native V2 job publishing and reconfirmation persist through this adapter. */
  readonly supportsPublishing: boolean

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
}
