import "server-only"

import type { NormalizedFeature } from "../normalized-adapter"
import { unavailableMarketplaceV2Feature } from "../port"

/**
 * invites (#250): targeted invitations, over the normalized store.
 *
 * To map: `count_eligible_invitation_recipients`, `reserve_targeted_invitation` and `respond_to_invitation` (03).
 *
 * Port v3 (#244) entry module, already wired into `normalized-adapter.ts`. Until #250 lands, every method refuses
 * with `MarketplaceFeatureUnavailableError` and reaches no store. The task replaces `methods` with its mapping
 * (built in this folder), adds its functions to `MARKETPLACE_FUNCTIONS` with the security review that catalogue's
 * test asks for, and sets `supported` once every method works.
 */
export const normalizedInvites: NormalizedFeature<"invites"> = {
  methods: () => unavailableMarketplaceV2Feature("invites"),
  supported: false
}
