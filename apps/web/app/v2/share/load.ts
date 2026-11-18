import "server-only"

import { cache } from "react"

import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"

/** The public job for this request. Metadata and the page share one read. No viewer is passed, so private fields stay out. */
export const loadShareJob = cache((jobId: string) => pilotMarketplaceV2.getJob(jobId))
