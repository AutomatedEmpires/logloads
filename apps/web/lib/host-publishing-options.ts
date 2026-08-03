import type { OpportunityVisibilityMode } from "@logloads/contracts"

import type { HostPublishingOptions } from "./host-data"

/**
 * Mirrors the publication portion of `assertHostCanPublish`.
 *
 * Drafts remain available in every activation state. Live publication is only
 * advertised when the billing account can support it, and a suspended account
 * retains the private-partner lane that the service deliberately leaves open.
 * Direct offers use their own action surface and remain available there.
 */
export function hostLiveVisibilityModes(
  options: Pick<
    HostPublishingOptions,
    "billingActivationState" | "subscriptionPlanCode"
  >
): OpportunityVisibilityMode[] {
  if (options.billingActivationState === "percentage_active") {
    return ["open_network", "private_network", "verified_network"]
  }

  if (options.billingActivationState === "legacy") {
    return []
  }

  if (
    (options.billingActivationState === "active" ||
      options.billingActivationState === "suspended") &&
    options.subscriptionPlanCode
  ) {
    if (
      options.billingActivationState === "suspended" ||
      options.subscriptionPlanCode === "dispatch_pro"
    ) {
      return ["private_network"]
    }

    return ["open_network", "private_network", "verified_network"]
  }

  return []
}
