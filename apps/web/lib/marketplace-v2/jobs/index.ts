import "server-only"

import type { NormalizedFeature } from "../normalized-adapter"
import { unavailableMarketplaceV2Feature } from "../port"

/**
 * jobs (#247): the poster's own jobs, over the normalized store.
 *
 * Port v3 (#244) entry module, already wired into `normalized-adapter.ts`. The group's methods are built in this
 * folder: `normalizedJobsMethods` (./methods.ts) over the `NormalizedJobsStore` it needs (./store.ts), with the row
 * mapping in ./mapping.ts and the lifecycle rules in packages/services/src/v2/jobs. Until the store can be built over
 * catalogued calls, every method here still refuses with `MarketplaceFeatureUnavailableError` and reaches no store.
 * Wiring it needs `set_job_posting_status` and `reactivate_job_posting` in `MARKETPLACE_FUNCTIONS` (#269), and two
 * catalogued statements no SQL function replaces: the business's own jobs with their landing (`ownJobs`), and the
 * edit of a posted job's public columns (`editTerms`). `supported` turns on when every method works.
 */
export const normalizedJobs: NormalizedFeature<"jobs"> = {
  methods: () => unavailableMarketplaceV2Feature("jobs"),
  supported: false
}
