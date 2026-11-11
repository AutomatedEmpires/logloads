import "server-only"

import type { NormalizedFeature } from "../normalized-adapter"
import { unavailableMarketplaceV2Feature } from "../port"

/**
 * jobs (#247): the poster's own jobs, over the normalized store.
 *
 * To map: `set_job_posting_status`, `reactivate_job_posting` and `save_job_posting_draft` (06, 11).
 *
 * Port v3 (#244) entry module, already wired into `normalized-adapter.ts`. Until #247 lands, every method refuses
 * with `MarketplaceFeatureUnavailableError` and reaches no store. The task replaces `methods` with its mapping
 * (built in this folder), adds its functions to `MARKETPLACE_FUNCTIONS` with the security review that catalogue's
 * test asks for, and sets `supported` once every method works.
 */
export const normalizedJobs: NormalizedFeature<"jobs"> = {
  methods: () => unavailableMarketplaceV2Feature("jobs"),
  supported: false
}
