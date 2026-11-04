import "server-only"

import { redirect } from "next/navigation"

import { getClerkUserId, getSessionActor, type SessionActor } from "../session"
import { pilotMarketplaceV2 } from "./pilot-adapter"
import type { MarketplaceV2Viewer, MarketplaceV2ViewerAccess } from "./port"

/**
 * Points a refused viewer at the V2 business switcher (`/v2/switch`, #124). The account menu's "Switch business"
 * is on every signed-in page, including when the selected business is no longer available and the shell shows no
 * business name. V2 never sends anyone to the legacy workspace chooser.
 */
export const BUSINESS_SWITCH_NOTE = "To act for another business, open the account menu and choose Switch business."

/** A refusal followed by the switcher note, as full sentences. */
export function withBusinessSwitchNote(refusal: string): string {
  const sentence = refusal.trim()

  return `${/[.!?]$/.test(sentence) ? sentence : `${sentence}.`} ${BUSINESS_SWITCH_NOTE}`
}

export const NO_BUSINESS_PROFILE_REFUSAL =
  "Your sign-in is not linked to a LogLoads business yet. Setting up a business is not available in this preview yet."

/**
 * The signed-in actor for a V2 page. No session at all goes to sign-in and comes back to `nextPath`.
 * A sign-in that has no LogLoads profile yet gets a refusal instead of the shared guard's redirect to
 * the legacy onboarding flow, which ends in a legacy cockpit.
 */
export async function resolveV2Actor(nextPath: string): Promise<
  | { ok: true; actor: SessionActor }
  | { ok: false; refusal: string }
> {
  const actor = await getSessionActor()

  if (actor) {
    return { actor, ok: true }
  }

  if (await getClerkUserId()) {
    return { ok: false, refusal: NO_BUSINESS_PROFILE_REFUSAL }
  }

  redirect(`/sign-in?next=${encodeURIComponent(nextPath)}`)
}

/**
 * Session-derived viewer plus V2 capabilities for signed-in V2 pages. Redirects to sign-in when there is
 * no session; returns a refusal message (never a capability) when no usable business is selected.
 */
export async function resolveV2Viewer(nextPath: string): Promise<
  | { ok: true; viewer: MarketplaceV2Viewer; access: MarketplaceV2ViewerAccess }
  | { ok: false; refusal: string }
> {
  const resolved = await resolveV2Actor(nextPath)

  if (!resolved.ok) {
    return resolved
  }

  const { actor } = resolved
  const workspace = actor.activeOrganization

  if (!workspace || actor.workspaceSelectionInvalid) {
    return { ok: false, refusal: withBusinessSwitchNote("No business is selected for your account.") }
  }

  const viewer = { organizationId: workspace.id, userId: actor.profile.id }

  try {
    return { access: await pilotMarketplaceV2.viewerAccess(viewer), ok: true, viewer }
  } catch {
    return { ok: false, refusal: withBusinessSwitchNote("This business is not available to your account.") }
  }
}
