import "server-only"

import type { NormalizedFeature } from "../normalized-adapter"
import { unavailableMarketplaceV2Feature } from "../port"

/**
 * boosts (#254): audience estimate and the business's boosts, over the normalized store.
 *
 * To map: `estimate_boost_audience` (18) and `job_boosts`.
 *
 * Port v3 (#244) entry module, already wired into `normalized-adapter.ts`. Until #254 lands, every method refuses
 * with `MarketplaceFeatureUnavailableError` and reaches no store. The task replaces `methods` with its mapping
 * (built in this folder), adds its functions to `MARKETPLACE_FUNCTIONS` with the security review that catalogue's
 * test asks for, and sets `supported` once every method works.
 */
export const normalizedBoosts: NormalizedFeature<"boosts"> = {
  methods: () => unavailableMarketplaceV2Feature("boosts"),
  supported: false
}
