import "server-only"

import { requireAuthenticatedActor } from "../session"
import { pilotMarketplaceV2 } from "./pilot-adapter"
import type { MarketplaceV2Viewer, MarketplaceV2ViewerAccess } from "./port"

/**
 * Session-derived viewer plus V2 capabilities for signed-in V2 pages. Redirects to sign-in when there is
 * no session; returns a refusal message (never a capability) when no usable workspace is selected.
 */
export async function resolveV2Viewer(nextPath: string): Promise<
  | { ok: true; viewer: MarketplaceV2Viewer; access: MarketplaceV2ViewerAccess }
  | { ok: false; refusal: string }
> {
  const actor = await requireAuthenticatedActor(nextPath)
  const workspace = actor.activeOrganization

  if (!workspace || actor.workspaceSelectionInvalid) {
    return { ok: false, refusal: "Choose a workspace to continue." }
  }

  const viewer = { organizationId: workspace.id, userId: actor.profile.id }

  try {
    return { access: await pilotMarketplaceV2.viewerAccess(viewer), ok: true, viewer }
  } catch {
    return { ok: false, refusal: "This workspace is not available." }
  }
}
