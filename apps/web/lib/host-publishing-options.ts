import type { OpportunityVisibilityMode } from "@logloads/contracts"

import type { HostPublishingOptions } from "./host-data"

type HostPublicationState = Pick<
  HostPublishingOptions,
  "billingProfileStatus" | "feeAgreementAccepted"
>

/**
 * Mirrors the organization-level part of `assertHostCanPublish`: the host has
 * accepted the current LogLoads fee terms AND has one attached card the fee can
 * be charged to. Accepting the terms alone is deliberately not "ready".
 */
export function hostPublicationIsReady(options: HostPublicationState): boolean {
  return options.feeAgreementAccepted && options.billingProfileStatus === "attached"
}

/**
 * The reach a host may publish live work to. Drafts are always available; live
 * publication is offered only once the host is ready to be billed for it.
 */
export function hostLiveVisibilityModes(
  options: HostPublicationState
): OpportunityVisibilityMode[] {
  return hostPublicationIsReady(options)
    ? ["open_network", "private_network", "verified_network"]
    : []
}
