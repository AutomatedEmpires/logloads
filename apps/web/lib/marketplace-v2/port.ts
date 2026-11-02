import type {
  MarketplaceInterestView,
  MarketplaceJobCardView,
  MarketplaceJobDetailView,
  MarketplaceJobFilters
} from "@logloads/contracts"

/**
 * The only data boundary the V2 screens use. Today it is implemented by `pilot-adapter.ts` over the
 * versioned `operating_state` document and the existing service layer; once the normalized-v2 schema
 * is validated, a second adapter implements the same port over its RPCs (`search_job_postings`,
 * `respond_to_interest`, ...) without changing the UI.
 *
 * `viewer` is always resolved from the server session by the caller, never from request input.
 */
export interface MarketplaceV2Viewer {
  userId: string
  organizationId: string
}

export interface MarketplaceV2Port {
  /** Public discovery. Returns only public-safe fields; never exact coordinates or access details. */
  listJobs(filters: MarketplaceJobFilters): Promise<MarketplaceJobCardView[]>
  getJob(jobId: string): Promise<MarketplaceJobDetailView | null>
  /** The viewer's own hauling business's interest in a job, if any. */
  interestForJob(viewer: MarketplaceV2Viewer, jobId: string): Promise<MarketplaceInterestView | null>
  listHaulerInterests(viewer: MarketplaceV2Viewer): Promise<MarketplaceInterestView[]>
  listLandingInterests(viewer: MarketplaceV2Viewer): Promise<MarketplaceInterestView[]>
  expressInterest(viewer: MarketplaceV2Viewer, input: unknown): Promise<MarketplaceInterestView>
  withdrawInterest(viewer: MarketplaceV2Viewer, interestId: string): Promise<void>
  respondToInterest(viewer: MarketplaceV2Viewer, input: unknown): Promise<void>
  postHaulerReply(viewer: MarketplaceV2Viewer, input: unknown): Promise<void>
}
