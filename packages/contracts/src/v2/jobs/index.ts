/**
 * jobs (#247): the poster's own jobs — edit, pause, resume, close, duplicate (UX spec §4.4, §4.6, §8.3, §10.11).
 * Views and inputs for `MarketplaceJobsPort` (apps/web/lib/marketplace-v2/port.ts). #247 adds its schemas and rules
 * here and in `packages/services/src/v2/jobs/`.
 */

import type { MarketplaceJobDraft } from "../../marketplace-job-draft"
import type { MarketplaceId, MarketplaceLandingRef } from "../../marketplace-port-v3"
import type { MarketplaceJobDetailView, MarketplaceJobStatus } from "../../marketplace-v2"

/** The statuses a poster may stop a job with. Expiry is the store's own (`expires_at`); a poster never sets it. */
export const MARKETPLACE_JOB_STOP_STATUSES = ["paused", "filled", "closed"] as const
export type MarketplaceJobStopStatus = (typeof MARKETPLACE_JOB_STOP_STATUSES)[number]

/** Advertised terms whose change interested haulers are told about (§4.6). */
export const MARKETPLACE_JOB_MATERIAL_FIELDS = ["pay", "dates", "equipment", "trucks"] as const
export type MarketplaceJobMaterialField = (typeof MARKETPLACE_JOB_MATERIAL_FIELDS)[number]

export interface MarketplaceOwnJobFilters {
  /** Omitted: every status. */
  status?: MarketplaceJobStatus | null
  /** One of the business's own landings. */
  landingId?: MarketplaceId | null
  /** Matched against the title, without case. */
  query?: string | null
}

/** One of the active business's own jobs as its landing desk manages it. Never private landing details. */
export interface MarketplaceOwnJobView {
  /** The public listing exactly as haulers see it (the "Public preview"). */
  job: MarketplaceJobDetailView
  landing: MarketplaceLandingRef
  inquiries: {
    total: number
    /** Inquiries whose last word is the hauler's, so the desk owes a reply. */
    awaitingReply: number
  }
  /** Targeted invitations delivered for this job, all cycles; `null` where the store keeps none. */
  invitationsDelivered: number | null
  /** The active or most recent boost window; `null` when the job was never boosted. */
  boost: { startsAt: string; endsAt: string; active: boolean } | null
  /** LogLoads staff hold the job (§7.3): it cannot be resumed until they release it. */
  moderationHold: boolean
}

/** One own job with the draft the editor opens to change it (public fields only, as published). */
export interface MarketplaceOwnJobDetailView extends MarketplaceOwnJobView {
  draft: MarketplaceJobDraft
}

/** What an edit changed. `lastConfirmedAt` never moves on an edit: only publishing, reconfirming and resuming set it. */
export interface MarketplaceJobEditReceipt {
  jobId: MarketplaceId
  /** The advertised terms that changed, so interested haulers can be told; empty when nothing material changed. */
  materialChanges: MarketplaceJobMaterialField[]
  lastModifiedAt: string
}
