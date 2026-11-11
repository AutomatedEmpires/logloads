/**
 * jobs (#247): the poster's own jobs — edit, pause, resume, close, duplicate (UX spec §4.4, §4.6, §8.3, §10.11).
 * Views and inputs for `MarketplaceJobsPort` (apps/web/lib/marketplace-v2/port.ts). The lifecycle rules over them are
 * in `packages/services/src/v2/jobs/`.
 */

import { z } from "zod"

import type { MarketplaceJobDraft } from "../../marketplace-job-draft"
import type { MarketplaceId, MarketplaceLandingRef } from "../../marketplace-port-v3"
import {
  marketplaceJobStatusSchema,
  RECENT_CONFIRMATION_DAYS,
  type MarketplaceJobDetailView,
  type MarketplaceJobStatus
} from "../../marketplace-v2"

/** The statuses a poster may stop a job with. Expiry is the store's own (`expires_at`); a poster never sets it. */
export const MARKETPLACE_JOB_STOP_STATUSES = ["paused", "filled", "closed"] as const
export type MarketplaceJobStopStatus = (typeof MARKETPLACE_JOB_STOP_STATUSES)[number]
export const marketplaceJobStopStatusSchema = z.enum(MARKETPLACE_JOB_STOP_STATUSES)

/** Advertised terms whose change interested haulers are told about (§4.6). */
export const MARKETPLACE_JOB_MATERIAL_FIELDS = ["pay", "dates", "equipment", "trucks"] as const
export type MarketplaceJobMaterialField = (typeof MARKETPLACE_JOB_MATERIAL_FIELDS)[number]

/**
 * Days after the poster's last explicit "still available" confirmation when a job on the marketplace is due to be
 * reconfirmed (§10.11: "prompt posters to confirm a still-open job after a policy interval"). The exact cadence is an
 * open decision (spec §14 "Posting reconfirmation cadence", Blueprint §16.2), so this is the one interval the contracts
 * already define, `RECENT_CONFIRMATION_DAYS`: past it, haulers see the listing as aging. It only prompts the poster.
 * It never pauses, closes or expires a job, so a long-running job is reconfirmed rather than replaced (§10.11, §13.2).
 */
export const MARKETPLACE_JOB_RECONFIRM_AFTER_DAYS = RECENT_CONFIRMATION_DAYS

/** What a poster can do with one of their jobs. Each is refused server-side in a state that does not allow it. */
export const MARKETPLACE_OWN_JOB_ACTIONS = ["edit", "reconfirm", "pause", "mark_filled", "close", "resume", "duplicate"] as const
export type MarketplaceOwnJobAction = (typeof MARKETPLACE_OWN_JOB_ACTIONS)[number]

export interface MarketplaceOwnJobFilters {
  /** Omitted: every status. */
  status?: MarketplaceJobStatus | null
  /** One of the business's own landings. */
  landingId?: MarketplaceId | null
  /** Matched against the title, without case. */
  query?: string | null
}

/** The longest title search accepted; titles are at most 140 characters. */
export const MARKETPLACE_OWN_JOB_QUERY_MAX = 140

/** `listOwnJobs` filters as the adapter re-parses them. Unknown keys are refused, and a blank search is no search. */
export const marketplaceOwnJobFiltersSchema: z.ZodType<MarketplaceOwnJobFilters, z.ZodTypeDef, unknown> = z
  .object({
    landingId: z.string().uuid("Choose one of your landings").nullish(),
    query: z
      .string()
      .trim()
      .max(MARKETPLACE_OWN_JOB_QUERY_MAX, `Search with at most ${MARKETPLACE_OWN_JOB_QUERY_MAX} characters`)
      .nullish()
      .transform((value) => (value ? value : null)),
    status: marketplaceJobStatusSchema.nullish()
  })
  .strict()

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
  /**
   * LogLoads staff hold the job (§7.3): it cannot be resumed until they release it. `null` where the business cannot
   * read the hold: the normalized store keeps holds in a table only moderators reach (stage 11), and its
   * `reactivate_job_posting` refuses a held job itself.
   */
  moderationHold: boolean | null
}

/** One own job with the draft the editor opens to change it (public fields only, as published). */
export interface MarketplaceOwnJobDetailView extends MarketplaceOwnJobView {
  /**
   * `null` when the stored terms no longer pass today's draft rules (a legacy posting without stated pay, for one).
   * Nothing is guessed to fill them, and an edit saves a complete draft.
   */
  draft: MarketplaceJobDraft | null
}

/** What an edit changed. `lastConfirmedAt` never moves on an edit: only publishing, reconfirming and resuming set it. */
export interface MarketplaceJobEditReceipt {
  jobId: MarketplaceId
  /** The advertised terms that changed, so interested haulers can be told; empty when nothing material changed. */
  materialChanges: MarketplaceJobMaterialField[]
  lastModifiedAt: string
}
