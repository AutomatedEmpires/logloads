import { describe, expect, it } from "vitest"

import {
  hostLiveVisibilityModes,
  hostPublicationIsReady
} from "./host-publishing-options"

describe("host live publishing options", () => {
  it("offers every live reach choice to a host with accepted fee terms and an attached card", () => {
    const options = { billingProfileStatus: "attached" as const, feeAgreementAccepted: true }

    expect(hostPublicationIsReady(options)).toBe(true)
    expect(hostLiveVisibilityModes(options)).toEqual([
      "open_network",
      "private_network",
      "verified_network"
    ])
  })

  it("keeps a host that has not accepted the fee terms draft-only, even with a card", () => {
    const options = { billingProfileStatus: "attached" as const, feeAgreementAccepted: false }

    expect(hostPublicationIsReady(options)).toBe(false)
    expect(hostLiveVisibilityModes(options)).toEqual([])
  })

  it.each(["none", "failed", null] as const)(
    "keeps accepted fee terms draft-only while card status is %s",
    (billingProfileStatus) => {
      const options = { billingProfileStatus, feeAgreementAccepted: true }

      expect(hostPublicationIsReady(options)).toBe(false)
      expect(hostLiveVisibilityModes(options)).toEqual([])
    }
  )
})
