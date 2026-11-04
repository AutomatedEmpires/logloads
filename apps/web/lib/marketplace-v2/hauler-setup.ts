import "server-only"

import { haulerSetupChecklist, type HaulerSetupItem } from "@logloads/services"

import { pilotMarketplaceV2 } from "./pilot-adapter"
import type { MarketplaceV2Viewer } from "./port"

/**
 * The setup checklist for Find work (#125), for a viewer acting for a hauling business (`interest.express`). Anyone
 * else, and a read that fails, gets no checklist: it is an aid, and search never depends on it.
 */
export async function haulerChecklistFor(viewer: MarketplaceV2Viewer | null, canExpress: boolean): Promise<HaulerSetupItem[]> {
  if (!viewer || !canExpress) {
    return []
  }

  try {
    const [profile, fleet] = await Promise.all([
      pilotMarketplaceV2.haulerProfile(viewer),
      // Trucks are optional on the checklist: a failed read leaves those items out.
      Promise.resolve().then(() => pilotMarketplaceV2.haulerFleet(viewer)).catch(() => null)
    ])
    return haulerSetupChecklist({ fleet, profile })
  } catch {
    return []
  }
}
