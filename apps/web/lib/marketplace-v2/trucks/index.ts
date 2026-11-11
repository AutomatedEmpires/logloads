import "server-only"

import type { NormalizedFeature } from "../normalized-adapter"
import { unavailableMarketplaceV2Feature } from "../port"

/**
 * trucks (#251): Find Trucks and saved truck searches, over the normalized store.
 *
 * To map: `hauler_profiles` and availability reports under row-level security, and `saved_searches` (kind `trucks`).
 *
 * Port v3 (#244) entry module, already wired into `normalized-adapter.ts`. Until #251 lands, every method refuses
 * with `MarketplaceFeatureUnavailableError` and reaches no store. The task replaces `methods` with its mapping
 * (built in this folder), adds its functions to `MARKETPLACE_FUNCTIONS` with the security review that catalogue's
 * test asks for, and sets `supported` once every method works.
 */
export const normalizedTrucks: NormalizedFeature<"trucks"> = {
  methods: () => unavailableMarketplaceV2Feature("trucks"),
  supported: false
}
