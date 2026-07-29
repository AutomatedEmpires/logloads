import { describe, expect, it } from "vitest"

import {
  billingAdjustmentSchema,
  billingPeriodSummaryId,
  billingPeriodSummarySchema,
  enterpriseAgreementTermsSchema,
  networkUsageEventId,
  networkUsageEventSchema,
  SUBSCRIPTION_PLAN_CATALOG,
  subscriptionPlanDefinition,
  subscriptionPlanQuoteFingerprint
} from "./subscription-billing"

const ORGANIZATION = "11111111-1111-4111-8111-111111111111"
const ASSIGNMENT = "22222222-2222-4222-8222-222222222222"
const LOAD = "33333333-3333-4333-8333-333333333333"
const MOVEMENT = "44444444-4444-4444-8444-444444444444"
const SUBSCRIPTION = "55555555-5555-4555-8555-555555555555"
const PERIOD_START = "2026-07-28T16:00:00.000Z"
const PERIOD_END = "2026-08-28T16:00:00.000Z"

describe("subscription-v1 plan catalog", () => {
  it("pins every founder-approved tier and keeps the internal smoke hidden", () => {
    expect(SUBSCRIPTION_PLAN_CATALOG.map((plan) => plan.code)).toEqual([
      "dispatch_pro",
      "network_pilot",
      "network_25",
      "network_50",
      "network_100",
      "enterprise_250_plus",
      "internal_billing_test"
    ])

    expect(subscriptionPlanDefinition("dispatch_pro")).toMatchObject({
      baseMonthlyPriceCents: 49_900,
      includedNetworkLoadUnits: 0
    })
    expect(subscriptionPlanDefinition("network_pilot")).toMatchObject({
      allowancePeriod: "commitment",
      baseMonthlyPriceCents: 150_000,
      commitmentMonths: 3,
      includedNetworkLoadUnits: 30,
      overageUnitPriceCents: 15_000,
      visibility: "invitation_only"
    })
    expect(subscriptionPlanDefinition("network_25")).toMatchObject({
      baseMonthlyPriceCents: 300_000,
      includedNetworkLoadUnits: 25,
      overageUnitPriceCents: 12_500
    })
    expect(subscriptionPlanDefinition("network_50")).toMatchObject({
      baseMonthlyPriceCents: 550_000,
      includedNetworkLoadUnits: 50,
      overageUnitPriceCents: 11_000
    })
    expect(subscriptionPlanDefinition("network_100")).toMatchObject({
      baseMonthlyPriceCents: 1_000_000,
      includedNetworkLoadUnits: 100,
      overageUnitPriceCents: 9_000
    })
    expect(subscriptionPlanDefinition("enterprise_250_plus")).toMatchObject({
      baseMonthlyPriceCents: null,
      customContract: true,
      visibility: "sales_assisted"
    })
    expect(subscriptionPlanDefinition("internal_billing_test")).toMatchObject({
      baseMonthlyPriceCents: 100,
      internalBillingTest: true,
      visibility: "internal"
    })
  })

  it("fingerprints every exact fixed conversion quote fact", () => {
    expect(
      subscriptionPlanQuoteFingerprint(
        subscriptionPlanDefinition("network_25")
      )
    ).toBe(
      'logloads-quote-v1:{"allowanceUnits":25,"baseMonthlyPriceCents":300000,"commitmentMonths":12,"effectiveAt":"2026-07-28T00:00:00.000Z","overageUnitPriceCents":12500,"planCode":"network_25","planVersion":1}'
    )
  })

  it("bounds the complete Enterprise agreement snapshot without rewriting text", () => {
    const agreement = {
      commitmentMonths: 24,
      definedIntegrations: ["SFTP load manifest", "ERP completion webhook"],
      negotiated: true,
      serviceSupportObligations:
        "Named weekday operations contact and quarterly workflow review."
    }

    expect(enterpriseAgreementTermsSchema.parse(agreement)).toEqual(agreement)
    expect(
      enterpriseAgreementTermsSchema.safeParse({
        ...agreement,
        commitmentMonths: 11
      }).success
    ).toBe(false)
    expect(
      enterpriseAgreementTermsSchema.safeParse({
        ...agreement,
        definedIntegrations: ["SFTP load manifest", "sftp load manifest"]
      }).success
    ).toBe(false)
    expect(
      enterpriseAgreementTermsSchema.safeParse({
        ...agreement,
        serviceSupportObligations: ` ${agreement.serviceSupportObligations}`
      }).success
    ).toBe(false)
  })
})

describe("completed Network usage identity", () => {
  it("derives one event from the physical movement rather than the assignment", () => {
    const id = networkUsageEventId(MOVEMENT)

    expect(id).toBe(networkUsageEventId(MOVEMENT.toUpperCase()))
    expect(id).not.toBe(networkUsageEventId(ASSIGNMENT))
  })

  it("rejects private capacity and a forged event id", () => {
    const event = {
      assignmentId: ASSIGNMENT,
      auditMetadata: {},
      billingModel: "subscription_v1",
      billingPeriodSummaryId: billingPeriodSummaryId(SUBSCRIPTION, PERIOD_START),
      capacitySource: "logloads_network",
      completionAt: PERIOD_START,
      createdAt: PERIOD_START,
      id: networkUsageEventId(MOVEMENT),
      invoiceId: null,
      loadMovementId: MOVEMENT,
      loadPostingId: LOAD,
      organizationId: ORGANIZATION,
      planCode: "network_25",
      reversalAdjustmentId: null,
      status: "recorded",
      unitCount: 1,
      updatedAt: PERIOD_START
    }

    expect(networkUsageEventSchema.safeParse(event).success).toBe(true)
    expect(networkUsageEventSchema.safeParse({ ...event, capacitySource: "private_fleet" }).success).toBe(false)
    expect(networkUsageEventSchema.safeParse({ ...event, id: ASSIGNMENT }).success).toBe(false)
  })
})

describe("anniversary period summaries", () => {
  it("pins overage arithmetic and deterministic period identity", () => {
    const plan = subscriptionPlanDefinition("network_25")
    const summary = {
      allowancePeriod: "monthly",
      billingModel: "subscription_v1",
      closedAt: null,
      createdAt: PERIOD_START,
      id: billingPeriodSummaryId(SUBSCRIPTION, PERIOD_START),
      includedUnits: 25,
      invoiceIds: [],
      notificationThresholdsEmitted: [],
      organizationId: ORGANIZATION,
      overageAmountCents: 62_500,
      overageUnitPriceCents: 12_500,
      overageUnits: 5,
      periodEnd: PERIOD_END,
      periodStart: PERIOD_START,
      planCode: "network_25",
      planSnapshot: plan,
      reconciledAt: null,
      status: "open",
      subscriptionId: SUBSCRIPTION,
      updatedAt: PERIOD_START,
      usageEventIds: [],
      usedUnits: 30
    }

    expect(billingPeriodSummarySchema.safeParse(summary).success).toBe(true)
    expect(
      billingPeriodSummarySchema.safeParse({ ...summary, overageAmountCents: 62_499 }).success
    ).toBe(false)
  })
})

describe("post-final adjustment settlement facts", () => {
  const credit = {
    actorUserId: ASSIGNMENT,
    amountDeltaCents: -1_000,
    billingPeriodSummaryId: billingPeriodSummaryId(
      SUBSCRIPTION,
      PERIOD_START
    ),
    createdAt: PERIOD_END,
    id: "66666666-6666-4666-8666-666666666666",
    invoiceId: "77777777-7777-4777-8777-777777777777",
    organizationId: ORGANIZATION,
    providerReference: "cn_exact001",
    providerRevenueDeltaCents: -400,
    providerSettlementAmountCents: 1_000,
    providerSettlementAttemptCount: 1,
    providerSettlementFailure: null,
    providerSettlementLastAttemptAt: PERIOD_END,
    providerSettlementRemainingCents: 0,
    providerSettlementSettledAt: PERIOD_END,
    providerSettlementState: "settled",
    reason: "Provider-confirmed correction",
    settlementIntent: "credit_note",
    type: "service_credit",
    unitDelta: 0,
    usageEventId: null
  }

  it("separates the issued credit from the amount that reversed paid revenue", () => {
    expect(billingAdjustmentSchema.parse(credit)).toMatchObject({
      providerRevenueDeltaCents: -400,
      providerSettlementAmountCents: 1_000,
      providerSettlementState: "settled"
    })
  })

  it("rejects mismatched frozen amounts and impossible settlement states", () => {
    expect(
      billingAdjustmentSchema.safeParse({
        ...credit,
        providerSettlementAmountCents: 999
      }).success
    ).toBe(false)
    expect(
      billingAdjustmentSchema.safeParse({
        ...credit,
        providerSettlementRemainingCents: 1
      }).success
    ).toBe(false)
    expect(
      billingAdjustmentSchema.safeParse({
        ...credit,
        providerRevenueDeltaCents: -1_001
      }).success
    ).toBe(false)
  })

  it("permits only a sub-50-cent writeoff on an invoiced usage reversal", () => {
    const usageReversal = {
      ...credit,
      amountDeltaCents: -50,
      minimumChargeWriteoffCents: 20,
      providerRevenueDeltaCents: -50,
      providerSettlementAmountCents: 50,
      reason: "Reverse duplicate usage and waive a tiny residual",
      type: "usage_reversal",
      unitDelta: -1,
      usageEventId: networkUsageEventId(MOVEMENT)
    }

    expect(billingAdjustmentSchema.safeParse(usageReversal).success).toBe(true)
    expect(
      billingAdjustmentSchema.safeParse({
        ...usageReversal,
        minimumChargeWriteoffCents: 50
      }).success
    ).toBe(false)
    expect(
      billingAdjustmentSchema.safeParse({
        ...usageReversal,
        minimumChargeWriteoffCents: 20,
        type: "service_credit",
        unitDelta: 0,
        usageEventId: null
      }).success
    ).toBe(false)
  })
})
