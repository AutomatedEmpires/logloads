import "server-only"

import type { MarketplaceCapability } from "@logloads/contracts"

import type { SessionActor } from "../session-policy"
import { v2HomePathFor } from "./navigation"
import { pilotMarketplaceV2 } from "./pilot-adapter"

/**
 * The V2 capabilities of the session's selected business, or `null` when no usable business is selected
 * (no session, no selection, an invalid selection, or a business the account can no longer operate).
 */
export async function v2SessionCapabilities(actor: SessionActor | null): Promise<MarketplaceCapability[] | null> {
  const organization = actor?.activeOrganization

  if (!actor || !organization || actor.workspaceSelectionInvalid) {
    return null
  }

  try {
    return (await pilotMarketplaceV2.viewerAccess({ organizationId: organization.id, userId: actor.profile.id })).capabilities
  } catch {
    return null
  }
}

/**
 * Where a signed-in account lands when Marketplace V2 is enabled (#124): a hauling context on /v2/work, a
 * landing context on /v2/landing, and an account with no business on /v2/start.
 *
 * `null` means V2 has no home for this account: platform administrators, and accounts whose selected
 * business cannot be operated (suspended, rejected or no longer a member). The caller, outside V2, keeps
 * the existing home, which explains the restriction instead of opening a V2 page that would refuse them.
 */
export async function v2HomePathForActor(actor: SessionActor): Promise<string | null> {
  if (actor.isPlatformAdmin) {
    return null
  }

  if (actor.memberships.length === 0) {
    return "/v2/start"
  }

  const capabilities = await v2SessionCapabilities(actor)

  return capabilities ? v2HomePathFor(capabilities) : null
}
