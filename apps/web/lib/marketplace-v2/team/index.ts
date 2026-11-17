import "server-only"

import type { NormalizedFeature } from "../normalized-adapter"
import { MARKETPLACE_FUNCTIONS } from "../normalized-db"
import { MARKETPLACE_QUERIES } from "../normalized-queries"
import { unavailableMarketplaceV2Feature, type MarketplaceTeamPort } from "../port"
import { teamMethods } from "./methods"

/**
 * team (#249): seats and seat invitations, over the normalized store.
 *
 * Members are `team_members` (normalized-queries.ts): owners only, no email addresses. Invitations, invites, resends,
 * revokes, acceptance, decline, landing scope and removal are the catalogued functions, including stage 33
 * `remove_team_member`. `supported` is true once those names are in the catalogues.
 */

/** What each port method runs. The store checks the same rules again. */
export const TEAM_METHOD_NEEDS: Readonly<Record<keyof MarketplaceTeamPort, { functions: readonly string[]; statements: readonly string[] }>> = {
  acceptTeamInvitation: { functions: ["accept_team_invitation", "list_my_team_invitations"], statements: [] },
  declineTeamInvitation: { functions: ["decline_team_invitation"], statements: [] },
  inviteTeamMember: { functions: ["get_org_entitlement_state", "get_viewer_marketplace_access", "invite_team_member", "list_team_invitations"], statements: ["team_members"] },
  receivedTeamInvitations: { functions: ["list_my_team_invitations"], statements: [] },
  removeTeamMember: { functions: ["get_viewer_marketplace_access", "remove_team_member"], statements: ["team_members"] },
  resendTeamInvitation: { functions: ["get_viewer_marketplace_access", "list_team_invitations", "resend_team_invitation"], statements: [] },
  revokeTeamInvitation: { functions: ["get_viewer_marketplace_access", "revoke_team_invitation"], statements: [] },
  setMemberLandingScope: { functions: ["get_viewer_marketplace_access", "set_membership_landing_scope"], statements: ["team_members"] },
  team: { functions: ["get_viewer_marketplace_access", "list_team_invitations"], statements: ["team_members"] }
}

/** True once every function and statement the team methods call is catalogued. */
export function teamCatalogueReady(
  functions: ReadonlySet<string> = new Set(Object.keys(MARKETPLACE_FUNCTIONS)),
  statements: ReadonlySet<string> = new Set(Object.keys(MARKETPLACE_QUERIES))
): boolean {
  return Object.values(TEAM_METHOD_NEEDS).every((needs) =>
    needs.functions.every((name) => functions.has(name)) && needs.statements.every((name) => statements.has(name))
  )
}

const ready = teamCatalogueReady()

export const normalizedTeam: NormalizedFeature<"team"> = {
  methods: (context) => (ready ? teamMethods(context) : unavailableMarketplaceV2Feature("team")),
  supported: ready
}

export { teamMethods } from "./methods"
