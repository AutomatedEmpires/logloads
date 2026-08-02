import { describe, expect, it } from "vitest"

import { hostLiveVisibilityModes } from "./host-publishing-options"

describe("host live publishing options", () => {
  it.each([null, "unenrolled", "configured_dark"] as const)(
    "keeps %s work draft-only",
    (activationState) => {
      expect(
        hostLiveVisibilityModes({
          billingActivationState: activationState,
          subscriptionPlanCode: null
        })
      ).toEqual([])
    }
  )

  it("offers the established reach choices to a legacy account", () => {
    expect(
      hostLiveVisibilityModes({
        billingActivationState: "legacy",
        subscriptionPlanCode: null
      })
    ).toEqual(["open_network", "private_network", "verified_network"])
  })

  it("offers Network reach to an active Network subscription", () => {
    expect(
      hostLiveVisibilityModes({
        billingActivationState: "active",
        subscriptionPlanCode: "network_25"
      })
    ).toEqual(["open_network", "private_network", "verified_network"])
  })

  it("keeps an active Dispatch Pro subscription private-partner-only", () => {
    expect(
      hostLiveVisibilityModes({
        billingActivationState: "active",
        subscriptionPlanCode: "dispatch_pro"
      })
    ).toEqual(["private_network"])
  })

  it("keeps only private-partner publication available while suspended", () => {
    expect(
      hostLiveVisibilityModes({
        billingActivationState: "suspended",
        subscriptionPlanCode: "network_50"
      })
    ).toEqual(["private_network"])
  })

  it.each(["active", "suspended"] as const)(
    "fails closed when a %s subscription account cannot be resolved",
    (billingActivationState) => {
      expect(
        hostLiveVisibilityModes({
          billingActivationState,
          subscriptionPlanCode: null
        })
      ).toEqual([])
    }
  )
})
