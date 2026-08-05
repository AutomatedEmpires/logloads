import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  PERCENTAGE_V1_TERMS_VERSION,
  PLATFORM_FEE_BPS
} from "@logloads/contracts"

import {
  hostCardSetupEligibility,
  type HostCardEligibilitySource
} from "./host-card-eligibility"

const HOST = "33333333-3333-4333-8333-333333333331"
const INVOICE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

function source(
  overrides: Partial<HostCardEligibilitySource> = {}
): HostCardEligibilitySource {
  return {
    hostBillingProfiles: [],
    hostInvoices: [],
    organizationBillingAccounts: [],
    organizationSubscriptions: [],
    platformFeeEvents: [],
    ...overrides
  }
}

function currentAgreement(termsVersion = PERCENTAGE_V1_TERMS_VERSION) {
  return {
    activationState: "percentage_active",
    billingModel: "percentage_v1",
    organizationId: HOST,
    percentageTermsSnapshot: {
      acceptedTermsVersion: termsVersion,
      billingCadence: "monthly_in_arrears",
      currency: "USD",
      feeBps: PLATFORM_FEE_BPS
    },
    subscriptionId: null
  }
}

describe("host card setup eligibility", () => {
  it("requires the exact current agreement and this host's rollout admission", () => {
    const state = source({
      organizationBillingAccounts: [currentAgreement()]
    })

    expect(hostCardSetupEligibility(state, HOST, true)).toMatchObject({
      allowed: true,
      basis: "accepted_percentage_v1"
    })
    expect(hostCardSetupEligibility(state, HOST, false)).toMatchObject({
      allowed: false,
      basis: "agreement_required"
    })
  })

  it("refuses a stale or altered percentage agreement", () => {
    const stale = source({
      organizationBillingAccounts: [currentAgreement("percentage-v1-retired")]
    })
    const altered = source({
      organizationBillingAccounts: [
        {
          ...currentAgreement(),
          percentageTermsSnapshot: {
            ...currentAgreement().percentageTermsSnapshot,
            feeBps: PLATFORM_FEE_BPS - 1
          }
        }
      ]
    })

    expect(hostCardSetupEligibility(stale, HOST, true).allowed).toBe(false)
    expect(hostCardSetupEligibility(altered, HOST, true).allowed).toBe(false)
  })

  it("keeps an explicit frozen legacy percentage agreement serviceable", () => {
    const state = source({
      organizationBillingAccounts: [
        {
          activationState: "legacy",
          billingModel: "legacy_percentage",
          organizationId: HOST,
          percentageTermsSnapshot: null,
          subscriptionId: null
        }
      ]
    })

    expect(hostCardSetupEligibility(state, HOST, false)).toMatchObject({
      allowed: true,
      basis: "preserved_legacy_agreement"
    })
  })

  it("keeps an already provider-bound subscription obligation serviceable", () => {
    const state = source({
      organizationBillingAccounts: [
        {
          activationState: "suspended",
          billingModel: "subscription_v1",
          organizationId: HOST,
          percentageTermsSnapshot: null,
          subscriptionId: "20202020-2020-4020-8020-202020202020"
        }
      ],
      organizationSubscriptions: [
        {
          billingModel: "subscription_v1",
          id: "20202020-2020-4020-8020-202020202020",
          internalBillingTest: false,
          organizationId: HOST,
          stripeCustomerId: "cus_preserved",
          stripeSubscriptionId: "sub_preserved"
        }
      ]
    })

    expect(hostCardSetupEligibility(state, HOST, false)).toMatchObject({
      allowed: true,
      basis: "preserved_subscription_agreement"
    })
  })

  it("allows a concrete accrued fee or unsettled invoice without reopening enrollment", () => {
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

    expect(hostCardSetupEligibility(accrued, HOST, false)).toMatchObject({
      allowed: true,
      basis: "unsettled_obligation"
    })
    expect(hostCardSetupEligibility(invoiced, HOST, false)).toMatchObject({
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

    expect(hostCardSetupEligibility(state, HOST, false)).toMatchObject({
      allowed: false,
      basis: "agreement_required"
    })
  })

  it("fails closed when the canonical document contains conflicting accounts", () => {
    const state = source({
      hostInvoices: [
        { id: INVOICE, organizationId: HOST, status: "open" }
      ],
      organizationBillingAccounts: [currentAgreement(), currentAgreement()]
    })

    expect(hostCardSetupEligibility(state, HOST, true)).toMatchObject({
      allowed: false,
      basis: "conflicting_billing_records"
    })
  })

  it("refuses a cross-wired preserved subscription customer", () => {
    const state = source({
      hostBillingProfiles: [
        { organizationId: HOST, stripeCustomerId: "cus_profile" }
      ],
      organizationBillingAccounts: [
        {
          activationState: "active",
          billingModel: "subscription_v1",
          organizationId: HOST,
          percentageTermsSnapshot: null,
          subscriptionId: "20202020-2020-4020-8020-202020202020"
        }
      ],
      organizationSubscriptions: [
        {
          billingModel: "subscription_v1",
          id: "20202020-2020-4020-8020-202020202020",
          organizationId: HOST,
          stripeCustomerId: "cus_subscription",
          stripeSubscriptionId: "sub_preserved"
        }
      ]
    })

    expect(hostCardSetupEligibility(state, HOST, false)).toMatchObject({
      allowed: false,
      basis: "conflicting_billing_records"
    })
  })
})
