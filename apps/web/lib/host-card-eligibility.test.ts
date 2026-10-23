import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { HOST_FEE_TERMS_VERSION, PLATFORM_FEE_BPS } from "@logloads/contracts"

import {
  hostCardSetupEligibility,
  type HostCardEligibilitySource
} from "./host-card-eligibility"

const HOST = "33333333-3333-4333-8333-333333333331"
const OTHER_HOST = "33333333-3333-4333-8333-333333333339"
const INVOICE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

function source(
  overrides: Partial<HostCardEligibilitySource> = {}
): HostCardEligibilitySource {
  return {
    hostBillingProfiles: [],
    hostFeeAgreements: [],
    hostInvoices: [],
    platformFeeEvents: [],
    ...overrides
  }
}

function agreement(
  overrides: Partial<HostCardEligibilitySource["hostFeeAgreements"][number]> = {}
) {
  return {
    feeBps: PLATFORM_FEE_BPS,
    organizationId: HOST,
    termsVersion: HOST_FEE_TERMS_VERSION,
    ...overrides
  }
}

describe("host card setup eligibility", () => {
  it("allows a host that accepted the current fee terms, and names its existing customer", () => {
    const state = source({
      hostBillingProfiles: [{ organizationId: HOST, stripeCustomerId: "cus_host" }],
      hostFeeAgreements: [agreement()]
    })

    expect(hostCardSetupEligibility(state, HOST)).toEqual({
      allowed: true,
      basis: "accepted_fee_agreement",
      existingCustomerId: "cus_host",
      message: null,
      profileCustomerId: "cus_host"
    })
  })

  it("refuses a host with no agreement, and does not borrow another host's", () => {
    const refusal = {
      allowed: false,
      basis: "agreement_required",
      message: expect.stringContaining("Accept the LogLoads fee terms")
    }

    expect(hostCardSetupEligibility(source(), HOST)).toEqual(refusal)
    expect(
      hostCardSetupEligibility(
        source({ hostFeeAgreements: [agreement({ organizationId: OTHER_HOST })] }),
        HOST
      )
    ).toEqual(refusal)
  })

  it("refuses an agreement on earlier terms or at a different rate", () => {
    const stale = source({ hostFeeAgreements: [agreement({ termsVersion: "2026-01-01" })] })
    const altered = source({ hostFeeAgreements: [agreement({ feeBps: PLATFORM_FEE_BPS - 1 })] })

    expect(hostCardSetupEligibility(stale, HOST).allowed).toBe(false)
    expect(hostCardSetupEligibility(altered, HOST).allowed).toBe(false)
  })

  it("allows a concrete accrued fee or unsettled invoice without an agreement on file", () => {
    const accrued = source({
      platformFeeEvents: [
        { invoiceId: null, organizationId: HOST, status: "accrued" }
      ]
    })
    const invoiced = source({
      hostInvoices: [
        { id: INVOICE, organizationId: HOST, status: "uncollectible" }
      ],
      platformFeeEvents: [
        { invoiceId: INVOICE, organizationId: HOST, status: "invoiced" }
      ]
    })

    expect(hostCardSetupEligibility(accrued, HOST)).toMatchObject({
      allowed: true,
      basis: "unsettled_obligation"
    })
    expect(hostCardSetupEligibility(invoiced, HOST)).toMatchObject({
      allowed: true,
      basis: "unsettled_obligation"
    })
  })

  it("does not treat paid and void history as permission for new provider setup", () => {
    const state = source({
      hostInvoices: [
        { id: INVOICE, organizationId: HOST, status: "paid" }
      ],
      platformFeeEvents: [
        { invoiceId: INVOICE, organizationId: HOST, status: "invoiced" },
        { invoiceId: null, organizationId: HOST, status: "voided" }
      ]
    })

    expect(hostCardSetupEligibility(state, HOST)).toMatchObject({
      allowed: false,
      basis: "agreement_required"
    })
  })

  it("fails closed when the document holds two agreements or two profiles for one host", () => {
    const twoAgreements = source({
      hostFeeAgreements: [agreement(), agreement()],
      hostInvoices: [
        { id: INVOICE, organizationId: HOST, status: "open" }
      ]
    })
    const twoProfiles = source({
      hostBillingProfiles: [
        { organizationId: HOST, stripeCustomerId: "cus_one" },
        { organizationId: HOST, stripeCustomerId: "cus_two" }
      ],
      hostFeeAgreements: [agreement()]
    })

    expect(hostCardSetupEligibility(twoAgreements, HOST)).toMatchObject({
      allowed: false,
      basis: "conflicting_billing_records"
    })
    expect(hostCardSetupEligibility(twoProfiles, HOST)).toMatchObject({
      allowed: false,
      basis: "conflicting_billing_records"
    })
  })
})
