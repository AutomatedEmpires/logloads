import "server-only"

import { cache } from "react"

import { shareJobAreaNotice } from "@/lib/marketplace-v2/basins/notice"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"

import { resolveShareWith, type ShareResolution } from "./resolve"

export type { ShareResolution } from "./resolve"

/** The public job for this request. Metadata and the page share one read. No viewer is passed, so private fields stay out. */
export const loadShareJob = cache((jobId: string) => pilotMarketplaceV2.getJob(jobId))

/** This request's share link, from the selected store (`resolve.ts` has the rule). Metadata and the page share it. */
export const resolveShare = cache((jobId: string): Promise<ShareResolution> =>
  resolveShareWith({ areaNotice: shareJobAreaNotice, getJob: loadShareJob }, jobId))
