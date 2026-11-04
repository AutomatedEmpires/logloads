import "server-only"

import { haulerSetupChecklist, type HaulerSetupItem } from "@logloads/services"
import { unstable_rethrow } from "next/navigation"

import { getSessionActor } from "../session"
import { pilotMarketplaceV2 } from "./pilot-adapter"

/**
 * The setup checklist for Find work (#125), for the session's selected hauling business. Anything else (a visitor,
 * a landing-only business, a read that fails) gets no checklist: it is an aid, and search never depends on it.
 */
export async function sessionHaulerChecklist(): Promise<HaulerSetupItem[]> {
  try {
    const actor = await getSessionActor()
    const organization = actor?.activeOrganization

    if (!actor || !organization || actor.workspaceSelectionInvalid) {
      return []
    }

    const viewer = { organizationId: organization.id, userId: actor.profile.id }

    if (!(await pilotMarketplaceV2.viewerAccess(viewer)).capabilities.includes("interest.express")) {
      return []
    }

    return haulerSetupChecklist({ profile: await pilotMarketplaceV2.haulerProfile(viewer) })
  } catch (error) {
    unstable_rethrow(error)
    return []
  }
}
