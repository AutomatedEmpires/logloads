import "server-only"

import type { MarketplaceAvailabilityAttestation, MarketplaceJobStatus } from "@logloads/contracts"

import { withoutJobLifecycleEvents } from "@/lib/marketplace-v2/jobs/methods"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import type { MarketplaceV2Viewer } from "@/lib/marketplace-v2/port"

/**
 * What a press is allowed to change. The viewer is the person and business bound into the signed token,
 * never an id from the form. The form has no job, inquiry or action field.
 */
export interface OneTapJobSnapshot {
  expiresAt: string | null
  id: string
  lastConfirmedAt: string | null
  lastModifiedAt: string
  status: MarketplaceJobStatus | null
}

export interface OneTapReply {
  body?: string
  decision: "replied" | "declined"
  interestId: string
  replyId?: string
}

export interface OneTapEffects {
  /**
   * Re-states the business's availability. On the normalized store, `availability_renew` updates the open
   * report and `tg_availability_guard` sets `reported_at` to now. That is the timestamp Find Trucks shows.
   */
  confirmAvailability(viewer: MarketplaceV2Viewer): Promise<{ confirmed: number }>
  jobBefore(viewer: MarketplaceV2Viewer, jobId: string): Promise<OneTapJobSnapshot | null>
  reconfirmJob(viewer: MarketplaceV2Viewer, jobId: string, attestation: MarketplaceAvailabilityAttestation): Promise<void>
  reply(viewer: MarketplaceV2Viewer, input: OneTapReply): Promise<void>
  stopJob(viewer: MarketplaceV2Viewer, jobId: string, status: "filled" | "paused"): Promise<void>
}

function snapshot(job: { expiresAt?: string | null; id: string; lastConfirmedAt?: string | null; lastModifiedAt: string; status?: MarketplaceJobStatus | null } | null): OneTapJobSnapshot | null {
  if (!job) return null

  return {
    expiresAt: job.expiresAt ?? null,
    id: job.id,
    lastConfirmedAt: job.lastConfirmedAt ?? null,
    lastModifiedAt: job.lastModifiedAt,
    status: job.status ?? null
  }
}

export function productionEffects(): OneTapEffects {
  return {
    confirmAvailability: (viewer) => pilotMarketplaceV2.confirmHaulerAvailability(viewer),
    async jobBefore(viewer, jobId) {
      return snapshot(await pilotMarketplaceV2.getJob(jobId, viewer))
    },
    reconfirmJob: (viewer, jobId, attestation) => pilotMarketplaceV2.reconfirmJob(viewer, jobId, attestation),
    reply: (viewer, input) => pilotMarketplaceV2.respondToInterest(viewer, input),
    // The jobs group would also record this stop as an in-app desk action. The press records it once, as a one-tap link.
    stopJob: (viewer, jobId, status) => withoutJobLifecycleEvents(() => pilotMarketplaceV2.setJobStatus(viewer, jobId, status))
  }
}
