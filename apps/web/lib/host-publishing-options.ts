import type { OpportunityVisibilityMode } from "@logloads/contracts"

import type { HostPublishingOptions } from "./host-data"

type LivePublicationState = Pick<
  HostPublishingOptions,
  "billingActivationState" | "billingModel"
>

/**
 * Mirrors the publication portion of `assertHostCanPublish`.
 *
 * Publishing never requires a percentage agreement or a card: the
 * completed-load percentage fee is retired. Every live reach choice is offered,
 * and drafts remain available in every state. The one exception mirrors the
 * service's integrity check: a subscription-state account whose billing model
 * cannot be resolved is corrupted history, so live publication fails closed
 * until LogLoads support repairs it.
 */
export function hostLiveVisibilityModes(
  options: LivePublicationState
): OpportunityVisibilityMode[] {
  const subscriptionState =
    options.billingActivationState === "active" ||
    options.billingActivationState === "suspended"

  if (subscriptionState && !options.billingModel) {
    return []
  }

  return ["open_network", "private_network", "verified_network"]
}

/** Whether this host may put work live now. */
export function hostLivePublicationIsAvailable(
  options: LivePublicationState
): boolean {
  return hostLiveVisibilityModes(options).length > 0
}
