import "server-only"

import type { NormalizedFeature } from "../normalized-adapter"
import { unavailableMarketplaceV2Feature } from "../port"

/**
 * team (#249): seats and seat invitations, over the normalized store.
 *
 * To map: `invite_team_member`, `resend_team_invitation`, `revoke_team_invitation`, `accept_team_invitation`,
 * `decline_team_invitation`, `list_team_invitations`, `list_my_team_invitations` and `set_membership_landing_scope`
 * (26-A, 26-B). No stage 01–26 function removes a membership.
 *
 * Port v3 (#244) entry module, already wired into `normalized-adapter.ts`. Until #249 lands, every method refuses
 * with `MarketplaceFeatureUnavailableError` and reaches no store. The task replaces `methods` with its mapping
 * (built in this folder), adds its functions to `MARKETPLACE_FUNCTIONS` with the security review that catalogue's
 * test asks for, and sets `supported` once every method works.
 */
export const normalizedTeam: NormalizedFeature<"team"> = {
  methods: () => unavailableMarketplaceV2Feature("team"),
  supported: false
}
