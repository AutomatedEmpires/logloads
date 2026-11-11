import "server-only"

import type { NormalizedFeature } from "../normalized-adapter"
import { unavailableMarketplaceV2Feature } from "../port"

/**
 * jobs (#247): the poster's own jobs, over the normalized store.
 *
 * Port v3 (#244) entry module, already wired into `normalized-adapter.ts`. The group's methods are built in this
 * folder: `normalizedJobsMethods` (./methods.ts) over the `NormalizedJobsStore` it needs (./store.ts), built over the
 * catalogued functions by `jobsStoreFromCalls` (./calls.ts), with the row mapping in ./mapping.ts and the lifecycle
 * rules in packages/services/src/v2/jobs. Until the whole store can be built, every method here still refuses with
 * `MarketplaceFeatureUnavailableError` and reaches no store. Two store methods need catalogued table statements that
 * no SQL function replaces: the business's own jobs with their landing (`ownJobs`), and the edit of a posted job's
 * public columns (`editTerms`). Once they exist: pass them to `jobsStoreFromCalls`, turn `supported` on, and update
 * `normalized-adapter-port-v3.test.ts`, which expects this group to refuse.
 */
export const normalizedJobs: NormalizedFeature<"jobs"> = {
  methods: () => unavailableMarketplaceV2Feature("jobs"),
  supported: false
}
