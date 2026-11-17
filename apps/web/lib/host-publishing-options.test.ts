import { describe, expect, it } from "vitest"

import {
  hostLivePublicationIsAvailable,
  hostLiveVisibilityModes
} from "./host-publishing-options"

const EVERY_REACH = ["open_network", "private_network", "verified_network"]

/**
 * The completed-load percentage fee is retired, so the builder offers live
 * publication without an agreement or a card, exactly as the service allows.
 */
describe("host live publishing options", () => {
  it.each([
    { billingActivationState: null, billingModel: null, label: "no billing account" },
    { billingActivationState: "unenrolled", billingModel: null, label: "an unenrolled account" },
    { billingActivationState: "configured_dark", billingModel: null, label: "a dark configured account" },
    { billingActivationState: "legacy", billingModel: "legacy_percentage", label: "a legacy account" },
    {
      billingActivationState: "percentage_active",
      billingModel: "percentage_v1",
      label: "a historical percentage agreement"
    },
    {
      billingActivationState: "active",
      billingModel: "subscription_v1",
      label: "a historical Network subscription"
    },
    {
      billingActivationState: "active",
      billingModel: "dispatch_pro",
      label: "a historical Dispatch Pro subscription"
    },
    {
      billingActivationState: "suspended",
      billingModel: "subscription_v1",
      label: "a suspended historical subscription"
    }
  ] as const)("offers every live reach to $label", ({ billingActivationState, billingModel }) => {
    const options = { billingActivationState, billingModel }

    expect(hostLiveVisibilityModes(options)).toEqual(EVERY_REACH)
    expect(hostLivePublicationIsAvailable(options)).toBe(true)
  })

  it("ignores the card and agreement fields a caller still passes", () => {
    expect(
      hostLiveVisibilityModes({
        billingActivationState: "percentage_active",
        billingModel: "percentage_v1",
        billingProfileStatus: "failed",
        currentPercentageAgreementActive: false,
        subscriptionPlanCode: null
      } as Parameters<typeof hostLiveVisibilityModes>[0])
    ).toEqual(EVERY_REACH)
  })

  it.each(["active", "suspended"] as const)(
    "fails closed when a %s subscription account cannot be resolved",
    (billingActivationState) => {
      const options = { billingActivationState, billingModel: null }

      expect(hostLiveVisibilityModes(options)).toEqual([])
      expect(hostLivePublicationIsAvailable(options)).toBe(false)
    }
  )
})
