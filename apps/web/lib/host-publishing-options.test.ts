import { describe, expect, it } from "vitest"

import {
  hostLiveVisibilityModes,
  hostPercentagePublicationIsReady
} from "./host-publishing-options"

describe("host live publishing options", () => {
  it.each([null, "unenrolled", "configured_dark"] as const)(
    "keeps %s work draft-only",
    (activationState) => {
      expect(
        hostLiveVisibilityModes({
          billingActivationState: activationState,
          billingModel: null,
          billingProfileStatus: "none",
          currentPercentageAgreementActive: false,
          subscriptionPlanCode: null
        })
      ).toEqual([])
    }
  )

  it("keeps a legacy account draft-only until it accepts current terms", () => {
    expect(
      hostLiveVisibilityModes({
        billingActivationState: "legacy",
        billingModel: "legacy_percentage",
        billingProfileStatus: "attached",
        currentPercentageAgreementActive: false,
        subscriptionPlanCode: null
      })
    ).toEqual([])
  })

  it("offers every live reach choice to an active percentage-v1 host", () => {
    expect(
      hostLiveVisibilityModes({
        billingActivationState: "percentage_active",
        billingModel: "percentage_v1",
        billingProfileStatus: "attached",
        currentPercentageAgreementActive: true,
        subscriptionPlanCode: null
      })
    ).toEqual(["open_network", "private_network", "verified_network"])
  })

  it.each(["none", "failed", null] as const)(
    "keeps an accepted percentage agreement draft-only while card status is %s",
    (billingProfileStatus) => {
      const options = {
        billingActivationState: "percentage_active" as const,
        billingModel: "percentage_v1" as const,
        billingProfileStatus,
        currentPercentageAgreementActive: true,
        subscriptionPlanCode: null
      }

      expect(hostPercentagePublicationIsReady(options)).toBe(false)
      expect(hostLiveVisibilityModes(options)).toEqual([])
    }
  )

  it("fails closed when a card is attached to an incomplete percentage agreement", () => {
    const options = {
      billingActivationState: "percentage_active" as const,
      billingModel: "percentage_v1" as const,
      billingProfileStatus: "attached" as const,
      currentPercentageAgreementActive: false,
      subscriptionPlanCode: null
    }

    expect(hostPercentagePublicationIsReady(options)).toBe(false)
    expect(hostLiveVisibilityModes(options)).toEqual([])
  })

  it("keeps a historical active Network subscription draft-only after cutover", () => {
    expect(
      hostLiveVisibilityModes({
        billingActivationState: "active",
        billingModel: "subscription_v1",
        billingProfileStatus: "none",
        currentPercentageAgreementActive: false,
        subscriptionPlanCode: "network_25"
      })
    ).toEqual([])
  })

  it("keeps a historical Dispatch Pro subscription draft-only after cutover", () => {
    expect(
      hostLiveVisibilityModes({
        billingActivationState: "active",
        billingModel: "dispatch_pro",
        billingProfileStatus: "none",
        currentPercentageAgreementActive: false,
        subscriptionPlanCode: "dispatch_pro"
      })
    ).toEqual([])
  })

  it("keeps a suspended historical subscription draft-only after cutover", () => {
    expect(
      hostLiveVisibilityModes({
        billingActivationState: "suspended",
        billingModel: "subscription_v1",
        billingProfileStatus: "none",
        currentPercentageAgreementActive: false,
        subscriptionPlanCode: "network_50"
      })
    ).toEqual([])
  })

  it.each(["active", "suspended"] as const)(
    "fails closed when a %s subscription account cannot be resolved",
    (billingActivationState) => {
      expect(
        hostLiveVisibilityModes({
          billingActivationState,
          billingModel: null,
          billingProfileStatus: "none",
          currentPercentageAgreementActive: false,
          subscriptionPlanCode: null
        })
      ).toEqual([])
    }
  )
})
