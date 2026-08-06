import type { OpportunityVisibilityMode } from "@logloads/contracts"

import type { HostPublishingOptions } from "./host-data"

type CurrentPercentagePublicationState = Pick<
  HostPublishingOptions,
  | "billingActivationState"
  | "billingModel"
  | "billingProfileStatus"
  | "currentPercentageAgreementActive"
>

/**
 * Current percentage work needs two independent recorded facts: the exact
 * agreement and one usable attached payment method. Agreement acceptance alone
 * deliberately cannot become a "ready to publish" claim.
 */
export function hostPercentagePublicationIsReady(
  options: CurrentPercentagePublicationState
): boolean {
  return (
    options.billingActivationState === "percentage_active" &&
    options.billingModel === "percentage_v1" &&
    options.currentPercentageAgreementActive &&
    options.billingProfileStatus === "attached"
  )
}

/**
 * Mirrors the publication portion of `assertHostCanPublish`.
 *
 * Drafts remain available in every activation state. After the percentage-v1
 * cutover, only an exact current percentage agreement plus an attached card may
 * advertise live publication. Historical subscriptions stay visible in Billing
 * for reconciliation and collection, but no longer authorize new activity.
 */
export function hostLiveVisibilityModes(
  options: Pick<
    HostPublishingOptions,
    | "billingActivationState"
    | "billingModel"
    | "billingProfileStatus"
    | "currentPercentageAgreementActive"
    | "subscriptionPlanCode"
  >
): OpportunityVisibilityMode[] {
  if (hostPercentagePublicationIsReady(options)) {
    return ["open_network", "private_network", "verified_network"]
  }

  if (options.billingActivationState === "legacy") {
    return []
  }

  return []
}
