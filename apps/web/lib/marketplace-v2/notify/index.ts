import "server-only"

import type { NormalizedFeature } from "../normalized-adapter"
import { unavailableMarketplaceV2Feature } from "../port"

/**
 * notify (#253): the person's in-app notices, over the normalized store.
 *
 * To map: `notification_outbox` (the recipient's granted columns) and `mark_notifications_read` (26-D).
 *
 * Port v3 (#244) entry module, already wired into `normalized-adapter.ts`. Until #253 lands, every method refuses
 * with `MarketplaceFeatureUnavailableError` and reaches no store. The task replaces `methods` with its mapping
 * (built in this folder), adds its functions to `MARKETPLACE_FUNCTIONS` with the security review that catalogue's
 * test asks for, and sets `supported` once every method works.
 */
export const normalizedNotify: NormalizedFeature<"notify"> = {
  methods: () => unavailableMarketplaceV2Feature("notify"),
  supported: false
}
