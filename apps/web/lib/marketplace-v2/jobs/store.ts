import type {
  MarketplaceCapability,
  MarketplaceInterestView,
  MarketplaceJobDraft,
  MarketplaceJobStopStatus,
  MarketplaceOwnJobView
} from "@logloads/contracts"

import type { MarketplaceCalls } from "../normalized-db"

/** One of the business's own jobs as the store holds it, mapped by `storedOwnJob` (./mapping.ts). */
export interface StoredOwnJob extends Omit<MarketplaceOwnJobView, "inquiries"> {
  /**
   * The editable terms as stored, read back as a draft. `null` when they no longer pass today's draft rules (a legacy
   * posting without stated pay, for one); nothing is guessed to fill them.
   */
  draft: MarketplaceJobDraft | null
  /** When the job was first saved. The desk's list is newest first. */
  createdAt: string
}

/**
 * What the jobs group (#247) needs from the normalized store, inside one transaction as the viewer (`asViewer`). Each
 * method names the SQL it maps to. The schema functions check the person's role and business again, and the
 * `tg_landing_scope_guard` trigger (26-B) refuses any write to a job on a landing outside the person's scope.
 */
export interface NormalizedJobsStore {
  /** `get_viewer_marketplace_access(p_org_id)`: the person's capabilities in the business; none when not a member. */
  capabilities(organizationId: string): Promise<readonly MarketplaceCapability[]>
  /**
   * The business's own non-draft jobs on landings in the person's landing scope (`landing_scope_allows`), newest
   * first; only `jobId` when it is given. With `lock`, the job's row is locked (`FOR UPDATE`), so the lifecycle rules
   * are checked on the row the write then changes and a concurrent change waits for this one. Maps to a catalogued
   * own-jobs statement (landing, created_at, delivered invitations, latest boost window) joined with
   * `list_marketplace_jobs(p_org_id, p_accepting_only => false)` for the public view.
   */
  ownJobs(organizationId: string, options: { jobId: string | null; lock: boolean }): Promise<StoredOwnJob[]>
  /** `list_marketplace_interests(p_org_id, p_job_id, p_side => 'landing')`: the desk's inquiries, for one job or all. */
  landingInquiries(organizationId: string, jobId: string | null): Promise<MarketplaceInterestView[]>
  /** `set_job_posting_status(p_job_id, p_status)` (stage 11): pause, mark filled or close. */
  setStatus(jobId: string, status: MarketplaceJobStopStatus): Promise<void>
  /**
   * `reactivate_job_posting(p_job_id, p_attest_available => true)` (stage 11): back on the marketplace, with the
   * availability attestation written in the same transaction; it becomes the job's `last_confirmed_at`.
   */
  reactivate(jobId: string): Promise<void>
  /**
   * A catalogued own-job edit statement: the public columns of one of the business's own non-draft jobs and its
   * `job_posting_equipment`, never `landing_id`, `status` or `last_confirmed_at` (`tg_job_guard` keeps the
   * confirmation from the attestation ledger). Returns the new `updated_at`, or `null` when no row changed.
   */
  editTerms(organizationId: string, jobId: string, draft: MarketplaceJobDraft): Promise<{ lastModifiedAt: string } | null>
}

/** Builds the store over one transaction's catalogued calls. */
export type NormalizedJobsStoreFor = (calls: MarketplaceCalls) => NormalizedJobsStore
