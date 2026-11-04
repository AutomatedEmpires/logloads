"use server"

import { redirect } from "next/navigation"

import { switchOrganizationAction } from "../session-actions"
import { v2HomePathFor } from "./navigation"
import { pilotMarketplaceV2 } from "./pilot-adapter"
import { getV2SessionActor, selectNormalizedSessionBusiness } from "./v2-session"

const SWITCH_PATH = "/v2/switch"

/**
 * Switches the acting business from `/v2/switch` (#124). The target must be one of the session's real
 * memberships in the selected store (#213), read again in this request: a business whose membership was removed
 * after the page rendered is refused here, server-side. On the pilot store `switchOrganizationAction` re-checks
 * that and re-signs the session cookie; on the normalized store `selectNormalizedSessionBusiness` re-signs it.
 * Every later request re-verifies the selection against the persisted memberships. On success the account lands
 * on the chosen business's V2 home; a membership that is gone or cannot be operated returns to the switch page.
 */
export async function switchV2BusinessAction(formData: FormData): Promise<void> {
  const organizationId = String(formData.get("organizationId") ?? "")
  const actor = await getV2SessionActor()

  if (!actor) {
    redirect(`/sign-in?next=${encodeURIComponent(SWITCH_PATH)}`)
  }

  const isMember = actor.memberships.some((entry) => entry.organization.id === organizationId)
  const switched = isMember &&
    (actor.store === "normalized" ? await selectNormalizedSessionBusiness(organizationId) : await switchOrganizationAction(organizationId))

  if (!switched) {
    redirect(`${SWITCH_PATH}?unavailable=1`)
  }

  let home = `${SWITCH_PATH}?unavailable=1`

  try {
    home = v2HomePathFor((await pilotMarketplaceV2.viewerAccess({ organizationId, userId: actor.profile.id })).capabilities)
  } catch {
    // The business exists in the session but cannot be operated (for example, suspended): stay on the switch page.
  }

  redirect(home)
}
