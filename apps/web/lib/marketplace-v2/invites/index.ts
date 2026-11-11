import "server-only"

import type { NormalizedFeature } from "../normalized-adapter"
import { MARKETPLACE_FUNCTIONS } from "../normalized-db"
import { MARKETPLACE_QUERIES } from "../normalized-queries"
import { unavailableMarketplaceV2Feature, type MarketplaceInvitesPort } from "../port"
import { inviteMethods } from "./methods"
import type { InviteStatementName } from "./statements"

/**
 * invites (#250): targeted invitations, over the normalized store.
 *
 * The functions are catalogue entries in `MARKETPLACE_FUNCTIONS` (normalized-db.ts) and the table reads are catalogue
 * statements in `MARKETPLACE_QUERIES` (normalized-queries.ts), with this group's SQL in `statements.ts`. Both
 * catalogues are shared files this task does not edit. Each method runs once both catalogues hold everything it
 * needs, and until then refuses with `MarketplaceFeatureUnavailableError` and reaches no store:
 *
 * - `list_invitation_recipients` is not in stage 01–29: the recipients list waits on #294 (stage 30);
 * - `invite_sent`, `invite_received` and `invite_received_one` wait on their catalogue entries.
 *
 * `supported` stays false until every method is live.
 */

/** What each port method runs through the adapter: catalogue functions it calls and this group's statements. */
export const INVITE_METHOD_NEEDS: Readonly<Record<keyof MarketplaceInvitesPort, { functions: readonly string[]; statements: readonly InviteStatementName[] }>> = {
  invitationAudience: { functions: ["get_marketplace_job", "count_eligible_invitation_recipients"], statements: [] },
  invitationRecipients: { functions: ["get_marketplace_job", "list_invitation_recipients"], statements: [] },
  receivedInvitations: { functions: [], statements: ["invite_received"] },
  respondToInvitation: { functions: ["respond_to_invitation"], statements: ["invite_received_one"] },
  sendTargetedInvitations: {
    functions: ["get_marketplace_job", "get_org_entitlement_state", "reserve_targeted_invitation"],
    statements: ["invite_sent"]
  },
  sentInvitations: { functions: [], statements: ["invite_sent"] }
}

export interface InviteCatalogue {
  functions: ReadonlySet<string>
  statements: ReadonlySet<string>
}

const CATALOGUE: InviteCatalogue = {
  functions: new Set(Object.keys(MARKETPLACE_FUNCTIONS)),
  statements: new Set(Object.keys(MARKETPLACE_QUERIES))
}

/** True once the catalogues hold every function and statement `method` runs. */
export function inviteMethodReady(method: keyof MarketplaceInvitesPort, catalogue: InviteCatalogue = CATALOGUE): boolean {
  const needs = INVITE_METHOD_NEEDS[method]

  return needs.functions.every((name) => catalogue.functions.has(name)) && needs.statements.every((name) => catalogue.statements.has(name))
}

export const normalizedInvites: NormalizedFeature<"invites"> = {
  methods: (context) => {
    const live = inviteMethods(context)
    const unavailable = unavailableMarketplaceV2Feature("invites")
    const methods = Object.keys(INVITE_METHOD_NEEDS) as Array<keyof MarketplaceInvitesPort>

    return Object.fromEntries(methods.map((method) => [method, inviteMethodReady(method) ? live[method] : unavailable[method]])) as unknown as MarketplaceInvitesPort
  },
  supported: false
}

export { inviteMethods } from "./methods"
