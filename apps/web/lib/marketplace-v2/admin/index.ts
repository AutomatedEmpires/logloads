import "server-only"

import type { NormalizedFeature } from "../normalized-adapter"
import { unavailableMarketplaceV2Feature } from "../port"

/**
 * admin (#255): LogLoads staff tools, over the normalized store.
 *
 * To map: `admin_set_org_verification`, `admin_moderate_job_posting`, `admin_release_job_moderation_hold`,
 * `admin_grant_founding_promotion`, `admin_grant_founding_hauler_badge`, `admin_read_landing_private`,
 * `admin_read_interest_thread` (03, 11, 16) and `abuse_reports`.
 *
 * Port v3 (#244) entry module, already wired into `normalized-adapter.ts`. Until #255 lands, every method refuses
 * with `MarketplaceFeatureUnavailableError` and reaches no store. The task replaces `methods` with its mapping
 * (built in this folder), adds its functions to `MARKETPLACE_FUNCTIONS` with the security review that catalogue's
 * test asks for, and sets `supported` once every method works.
 */
export const normalizedAdmin: NormalizedFeature<"admin"> = {
  methods: () => unavailableMarketplaceV2Feature("admin"),
  supported: false
}
