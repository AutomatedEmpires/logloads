import { describe, expect, it } from "vitest"

import {
  hostInvoiceSchema,
  organizationSubscriptionSchema,
  subscriptionPlanDefinition
} from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"

import { shiftSeedDates } from "./seed-dates"

describe("shiftSeedDates", () => {
  it("moves operational demo dates without rewriting percentage agreement timestamps", () => {
    const state = createInMemoryDatabase()
    const historicalAt = "2026-07-28T00:00:00.000Z"
    const historicalPeriodEnd = "2026-08-28T00:00:00.000Z"
    const historicalCommitmentEnd = "2027-07-28T00:00:00.000Z"
    const historicalInvoicePeriodStart = "2026-07-01T00:00:00.000Z"
    const historicalInvoicePeriodEnd = "2026-08-01T00:00:00.000Z"
    const plan = subscriptionPlanDefinition("network_25")
    const historicalAcceptingUserId =
      state.organizationMemberships.find(
        (membership) =>
          membership.organizationId ===
          "33333333-3333-4333-8333-333333333332"
      )?.userId
    if (!historicalAcceptingUserId) {
      throw new Error("Seed host billing member missing")
    }
    const historicalSubscription = organizationSubscriptionSchema.parse({
      acceptedAt: historicalAt,
      acceptedByUserId: historicalAcceptingUserId,
      acceptedTermsVersion: "subscription-v1-2026-07-28",
      baseMonthlyPriceSnapshotCents: plan.baseMonthlyPriceCents,
      billingModel: plan.billingModel,
      cancelAtPeriodEnd: false,
      commitmentEnd: historicalCommitmentEnd,
      commitmentStart: historicalAt,
      createdAt: historicalAt,
      currentPeriodEnd: historicalPeriodEnd,
      currentPeriodStart: historicalAt,
      customTerms: {},
      graceState: "none",
      id: "30303030-3030-4030-8030-303030303030",
      includedAllowanceSnapshot: plan.includedNetworkLoadUnits,
      includesDispatchProCapabilitiesSnapshot:
        plan.includesDispatchProCapabilities,
      internalBillingTest: false,
      operatingMarketIds: ["66666666-6666-4666-8666-666666666662"],
      organizationId: "33333333-3333-4333-8333-333333333332",
      overageRateSnapshotCents: plan.overageUnitPriceCents,
      paymentGraceEndsAt: null,
      paymentState: "current",
      pendingOperatingMarketIds: null,
      pendingPlanCode: null,
      pendingPlanEffectiveAt: null,
      pendingPlanSnapshot: null,
      planCode: plan.code,
      planSnapshot: plan,
      renewalBehavior: "automatic",
      status: "cancelled",
      stripeCustomerId: "cus_test_historical",
      stripeSubscriptionId: "sub_test_historical",
      updatedAt: historicalAt
    })
    const historicalInvoice = hostInvoiceSchema.parse({
      createdAt: historicalInvoicePeriodEnd,
      feeEventIds: [],
      id: "70707070-7070-4070-8070-707070707070",
      issuedAt: historicalInvoicePeriodEnd,
      organizationId: "33333333-3333-4333-8333-333333333332",
      paidAt: null,
      periodEnd: historicalInvoicePeriodEnd,
      periodStart: historicalInvoicePeriodStart,
      status: "open",
      stripeInvoiceId: null,
      subtotalCents: 2_500,
      updatedAt: historicalInvoicePeriodEnd,
      voidedAt: null
    })

    state.organizationSubscriptions.push(historicalSubscription)
    state.hostInvoices.push(historicalInvoice)
    const originalAuditCreatedAt = state.auditEvents[0]?.createdAt
    expect(originalAuditCreatedAt).toBeDefined()

    const summitAgreement = state.organizationBillingAccounts.find(
      (account) => account.organizationId === "33333333-3333-4333-8333-333333333332"
    )
    const originalLoadCreatedAt = state.loadPostings[0]?.createdAt

    expect(summitAgreement?.effectiveAt).toBe("2026-08-03T00:00:00.000Z")
    expect(summitAgreement?.percentageTermsSnapshot?.acceptedAt).toBe(
      "2026-08-03T00:00:00.000Z"
    )

    const shifted = shiftSeedDates(state, Date.parse("2026-08-03T12:00:00.000Z"))
    const shiftedAgreement = shifted.organizationBillingAccounts.find(
      (account) => account.organizationId === "33333333-3333-4333-8333-333333333332"
    )

    expect(shifted.loadPostings[0]?.createdAt).not.toBe(originalLoadCreatedAt)
    expect(shiftedAgreement?.effectiveAt).toBe("2026-08-03T00:00:00.000Z")
    expect(shiftedAgreement?.percentageTermsSnapshot?.acceptedAt).toBe(
      "2026-08-03T00:00:00.000Z"
    )
    expect(shifted.organizationSubscriptions[0]?.acceptedAt).toBe(historicalAt)
    expect(shifted.organizationSubscriptions[0]?.currentPeriodEnd).toBe(
      historicalPeriodEnd
    )
    expect(shifted.hostInvoices[0]?.issuedAt).toBe(historicalInvoicePeriodEnd)
    expect(shifted.hostInvoices[0]?.periodStart).toBe(
      historicalInvoicePeriodStart
    )
    expect(shifted.auditEvents[0]?.createdAt).toBe(originalAuditCreatedAt)
  })
})
