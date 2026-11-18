import type { MarketplaceJobDetailView } from "@logloads/contracts"

/**
 * What a share link resolves to (#287, #324, #404). It has no store of its own: `load.ts` hands it this request's
 * reads, and `share-store.contract.test.ts` hands it the normalized store's.
 */

export type ShareResolution =
  | { kind: "job"; job: MarketplaceJobDetailView }
  | { kind: "closed" }
  | { kind: "missing" }

export interface ShareReads {
  /** The job as a signed-out visitor may see it, or null. */
  getJob(jobId: string): Promise<MarketplaceJobDetailView | null>
  /** The store's closed-area sentence for this job id, or null. */
  areaNotice(jobId: string): Promise<string | null>
}

/**
 * A public job, the closed-basin notice, or nothing. A closed basin is a job the store hides only because its area
 * is not open: the page says so and shows no listing facts. Anything else the public cannot see is missing.
 *
 * The store decides which is which. Until `public_area_notice` also checks that the job is otherwise public, the
 * normalized store answers "closed" for a draft or a removed job in a closed basin; the pilot store never does.
 */
export async function resolveShareWith(reads: ShareReads, jobId: string): Promise<ShareResolution> {
  const job = await reads.getJob(jobId)

  if (job) return { kind: "job", job }
  if (await reads.areaNotice(jobId)) return { kind: "closed" }

  return { kind: "missing" }
}
