import type {
  MarketplaceCapability,
  MarketplaceDraftLandingContext,
  MarketplaceHaulerEquipmentOption,
  MarketplaceInterestView,
  MarketplaceJobCardView,
  MarketplaceJobDetailView,
  MarketplaceJobDraft,
  MarketplaceJobFilters
} from "@logloads/contracts"

/**
 * The only data boundary the V2 screens use. Today it is implemented by `pilot-adapter.ts` over the
 * versioned `operating_state` document and the existing service layer; once the normalized-v2 schema
 * is validated, a second adapter implements the same port over its tables and RPCs
 * (`search_job_postings`, `respond_to_interest`, `job_postings` insert/update, ...) without changing the UI.
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

export interface MarketplaceV2Port {
  /** Whether native V2 job publishing and reconfirmation persist through this adapter. */
  readonly supportsPublishing: boolean

  /** Public discovery. Returns only public-safe fields; never exact coordinates or access details. */
  listJobs(filters: MarketplaceJobFilters): Promise<MarketplaceJobCardView[]>
  getJob(jobId: string): Promise<MarketplaceJobDetailView | null>

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

  /** Publish a validated draft as an active job. Throws `MarketplaceOperationUnavailableError` when unsupported. */
  publishJob(viewer: MarketplaceV2Viewer, draft: MarketplaceJobDraft): Promise<{ jobId: string }>
  /** Record the poster's explicit "still available" confirmation. Throws when unsupported. */
  reconfirmJob(viewer: MarketplaceV2Viewer, jobId: string): Promise<void>
}
