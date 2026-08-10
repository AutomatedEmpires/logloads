import "server-only"

import type { HostPublishingOptions } from "@/lib/host-data"

/**
 * Keeps billing-state truth while removing operating contacts and option
 * collections from client props when the active member cannot publish work.
 * Redacted collections mean "not disclosed", never "not configured"; callers
 * must not derive workspace-readiness claims for those members.
 */
export function hostPublishingOptionsForSurface(
  options: HostPublishingOptions,
  canPublish: boolean
): HostPublishingOptions {
  if (canPublish) return options

  return {
    ...options,
    accessVocabulary: [],
    dispatcher: null,
    equipmentVocabulary: [],
    landings: [],
    rates: [],
    routes: [],
    subscriptionPlanCode: null
  }
}
