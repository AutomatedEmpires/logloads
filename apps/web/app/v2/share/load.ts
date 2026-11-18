import "server-only"

import { cache } from "react"

import type { MarketplaceJobDetailView } from "@logloads/contracts"

import { shareJobAreaNotice } from "@/lib/marketplace-v2/basins/notice"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"

/** The public job for this request. Metadata and the page share one read. No viewer is passed, so private fields stay out. */
export const loadShareJob = cache((jobId: string) => pilotMarketplaceV2.getJob(jobId))

export type ShareResolution =
  | { kind: "job"; job: MarketplaceJobDetailView }
  | { kind: "closed" }
  | { kind: "missing" }

/**
 * A public job, the closed-basin notice, or nothing (#287, #324). A closed basin is a real job whose area is not
 * open: the page says so and shows no listing facts. An unknown id is missing.
 */
export const resolveShare = cache(async (jobId: string): Promise<ShareResolution> => {
  const job = await loadShareJob(jobId)

  if (job) return { kind: "job", job }
  if (await shareJobAreaNotice(jobId)) return { kind: "closed" }

  return { kind: "missing" }
})
