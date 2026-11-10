import "server-only"

import type { NormalizedFeature } from "../normalized-adapter"
import { unavailableMarketplaceV2Feature } from "../port"

/**
 * alerts (#252): saved jobs, job searches and notification consent, over the normalized store.
 *
 * To map: `list_saved_jobs`, `saved_jobs` (26-C), `saved_searches` (kind `jobs`) and `notification_preferences`
 * (01).
 *
 * Port v3 (#244) entry module, already wired into `normalized-adapter.ts`. Until #252 lands, every method refuses
 * with `MarketplaceFeatureUnavailableError` and reaches no store. The task replaces `methods` with its mapping
 * (built in this folder), adds its functions to `MARKETPLACE_FUNCTIONS` with the security review that catalogue's
 * test asks for, and sets `supported` once every method works.
 */
export const normalizedAlerts: NormalizedFeature<"alerts"> = {
  methods: () => unavailableMarketplaceV2Feature("alerts"),
  supported: false
}
