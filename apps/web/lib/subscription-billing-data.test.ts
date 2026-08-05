import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  PERCENTAGE_V1_TERMS_VERSION,
  PLATFORM_FEE_BPS,
  SUBSCRIPTION_PLAN_CATALOG,
  billingAdjustmentSchema,
  billingPeriodSummaryId,
  billingPeriodSummarySchema,
  networkOverageInvoiceId,
  networkOverageInvoiceSchema,
  networkUsageEventId,
  networkUsageEventSchema,
  organizationBillingAccountId,
  organizationBillingAccountSchema,
  organizationSubscriptionSchema,
  subscriptionBaseInvoiceId,
  subscriptionBaseInvoiceSchema,
  subscriptionPlanDefinition,
  type BillingAdjustment,
  type BillingPeriodSummary,
  type NetworkOverageInvoice,
  type NetworkUsageEvent,
  type OrganizationBillingAccount,
  type OrganizationSubscription
} from "@logloads/contracts"

import {
  buildHostSubscriptionBillingView,
  type SubscriptionBillingSource
} from "./subscription-billing-data"

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111"
const SUBSCRIPTION_ID = "20202020-2020-4020-8020-202020202020"
const CONVERSION_SUBSCRIPTION_ID =
  "20202020-2020-4020-8020-202020202021"
const ACCEPTED_BY = "33333333-3333-4333-8333-333333333333"
const LANDING_ID = "44444444-4444-4444-8444-444444444444"
const PERIOD_START = "2026-07-28T12:00:00.000Z"
const PERIOD_END = "2026-10-26T12:00:00.000Z"

function billingAccount(
  overrides: Partial<OrganizationBillingAccount> = {}
): OrganizationBillingAccount {
  return organizationBillingAccountSchema.parse({
    activationState: "active",
    billingModel: "subscription_v1",
    createdAt: PERIOD_START,
    effectiveAt: PERIOD_START,
    id: organizationBillingAccountId(ORGANIZATION_ID),
    organizationId: ORGANIZATION_ID,
    subscriptionId: SUBSCRIPTION_ID,
    updatedAt: PERIOD_START,
    ...overrides
  })
}

function pilotSubscription(
  overrides: Partial<OrganizationSubscription> = {}
): OrganizationSubscription {
  const plan = subscriptionPlanDefinition("network_pilot")

  return organizationSubscriptionSchema.parse({
    acceptedAt: PERIOD_START,
    acceptedByUserId: ACCEPTED_BY,
    acceptedTermsVersion: "network-v1-2026-07-28",
    baseMonthlyPriceSnapshotCents: plan.baseMonthlyPriceCents,
    billingModel: plan.billingModel,
    cancelAtPeriodEnd: true,
    commitmentEnd: PERIOD_END,
    commitmentStart: PERIOD_START,
    createdAt: PERIOD_START,
    currentPeriodEnd: "2026-08-28T12:00:00.000Z",
    currentPeriodStart: PERIOD_START,
    customTerms: {},
    graceState: "none",
    id: SUBSCRIPTION_ID,
    includedAllowanceSnapshot: plan.includedNetworkLoadUnits,
    includesDispatchProCapabilitiesSnapshot:
      plan.includesDispatchProCapabilities,
    internalBillingTest: false,
    organizationId: ORGANIZATION_ID,
    operatingMarketIds: [LANDING_ID],
    overageRateSnapshotCents: plan.overageUnitPriceCents,
    paymentState: "current",
    pendingPlanCode: null,
    pendingPlanEffectiveAt: null,
    planCode: plan.code,
    planSnapshot: plan,
    renewalBehavior: "non_renewing",
    status: "active",
    stripeCustomerId: "cus_test_logloads",
    stripeSubscriptionId: "sub_test_logloads",
    updatedAt: PERIOD_START,
    ...overrides
  })
}

function dispatchSubscription(
  overrides: Partial<OrganizationSubscription> = {}
): OrganizationSubscription {
  const plan = subscriptionPlanDefinition("dispatch_pro")

  return organizationSubscriptionSchema.parse({
    acceptedAt: PERIOD_START,
    acceptedByUserId: ACCEPTED_BY,
    acceptedTermsVersion: "dispatch-v1-2026-07-28",
    baseMonthlyPriceSnapshotCents: plan.baseMonthlyPriceCents,
    billingModel: plan.billingModel,
    cancelAtPeriodEnd: false,
    commitmentEnd: "2026-08-28T12:00:00.000Z",
    commitmentStart: PERIOD_START,
    createdAt: PERIOD_START,
    currentPeriodEnd: "2026-08-28T12:00:00.000Z",
    currentPeriodStart: PERIOD_START,
    customTerms: {},
    graceState: "none",
    id: SUBSCRIPTION_ID,
    includedAllowanceSnapshot: plan.includedNetworkLoadUnits,
    includesDispatchProCapabilitiesSnapshot:
      plan.includesDispatchProCapabilities,
    internalBillingTest: false,
    organizationId: ORGANIZATION_ID,
    operatingMarketIds: [],
    overageRateSnapshotCents: plan.overageUnitPriceCents,
    paymentState: "current",
    pendingPlanCode: null,
    pendingPlanEffectiveAt: null,
    planCode: plan.code,
    planSnapshot: plan,
    renewalBehavior: "automatic",
    status: "active",
    stripeCustomerId: "cus_test_dispatch",
    stripeSubscriptionId: "sub_test_dispatch",
    updatedAt: PERIOD_START,
    ...overrides
  })
}

function conversionSubscription(
  overrides: Partial<OrganizationSubscription> = {}
): OrganizationSubscription {
  const plan = subscriptionPlanDefinition("network_25")

  return organizationSubscriptionSchema.parse({
    acceptedAt: "2026-10-27T12:00:00.000Z",
    acceptedByUserId: ACCEPTED_BY,
    acceptedTermsVersion: "network-v1-2026-07-28",
    activationAuthorizedAt: "2026-10-27T12:00:00.000Z",
    activationAuthorizedByUserId: ACCEPTED_BY,
    baseMonthlyPriceSnapshotCents: plan.baseMonthlyPriceCents,
    billingModel: plan.billingModel,
    cancelAtPeriodEnd: false,
    commitmentEnd: null,
    commitmentStart: null,
    convertedFromPlanCode: "network_pilot",
    convertedFromSubscriptionId: SUBSCRIPTION_ID,
    createdAt: "2026-10-27T12:00:00.000Z",
    currentPeriodEnd: null,
    currentPeriodStart: null,
    customTerms: {},
    graceState: "none",
    id: CONVERSION_SUBSCRIPTION_ID,
    includedAllowanceSnapshot: plan.includedNetworkLoadUnits,
    includesDispatchProCapabilitiesSnapshot:
      plan.includesDispatchProCapabilities,
    internalBillingTest: false,
    operationalActivatedAt: null,
    organizationId: ORGANIZATION_ID,
    operatingMarketIds: [LANDING_ID],
    overageRateSnapshotCents: plan.overageUnitPriceCents,
    paymentState: "none",
    pendingPlanCode: null,
    pendingPlanEffectiveAt: null,
    planCode: plan.code,
    planSnapshot: plan,
    renewalBehavior: "automatic",
    status: "pending",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    updatedAt: "2026-10-27T12:00:00.000Z",
    ...overrides
  })
}

function movementUuid(sequence: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${sequence.toString().padStart(12, "0")}`
}

function assignmentUuid(sequence: number): string {
  return `bbbbbbbb-bbbb-4bbb-8bbb-${sequence.toString().padStart(12, "0")}`
}

function usageEvent(
  sequence: number,
  summaryId: string,
  overrides: Partial<NetworkUsageEvent> = {}
): NetworkUsageEvent {
  const movementId = movementUuid(sequence)

  return networkUsageEventSchema.parse({
    assignmentId: assignmentUuid(sequence),
    auditMetadata: {},
    billingModel: "subscription_v1",
    billingPeriodSummaryId: summaryId,
    capacitySource: "logloads_network",
    completionAt: `2026-08-${String(10 + sequence).padStart(2, "0")}T12:00:00.000Z`,
    createdAt: `2026-08-${String(10 + sequence).padStart(2, "0")}T12:00:00.000Z`,
    id: networkUsageEventId(movementId),
    invoiceId: null,
    loadMovementId: movementId,
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    organizationId: ORGANIZATION_ID,
    planCode: "network_pilot",
    reversalAdjustmentId: null,
    status: "recorded",
    unitCount: 1,
    updatedAt: `2026-08-${String(10 + sequence).padStart(2, "0")}T12:00:00.000Z`,
    ...overrides
  })
}

function periodSummary(
  usedUnits = 3,
  overrides: Partial<BillingPeriodSummary> = {}
): { events: NetworkUsageEvent[]; summary: BillingPeriodSummary } {
  const summaryId = billingPeriodSummaryId(SUBSCRIPTION_ID, PERIOD_START)
  const events = Array.from({ length: usedUnits }, (_, index) =>
    usageEvent(index + 1, summaryId)
  )
  const plan = subscriptionPlanDefinition("network_pilot")

  return {
    events,
    summary: billingPeriodSummarySchema.parse({
      allowancePeriod: "commitment",
      billingModel: "subscription_v1",
      closedAt: null,
      createdAt: PERIOD_START,
      id: summaryId,
      includedUnits: 30,
      invoiceIds: [],
      notificationThresholdsEmitted: [],
      organizationId: ORGANIZATION_ID,
      overageAmountCents: Math.max(0, usedUnits - 30) * 15_000,
      overageUnitPriceCents: 15_000,
      overageUnits: Math.max(0, usedUnits - 30),
      periodEnd: PERIOD_END,
      periodStart: PERIOD_START,
      planCode: "network_pilot",
      planSnapshot: plan,
      reconciledAt: null,
      status: "open",
      subscriptionId: SUBSCRIPTION_ID,
      updatedAt: PERIOD_START,
      usageEventIds: events.map((event) => event.id),
      usedUnits,
      ...overrides
    })
  }
}

function overageInvoice(
  summaryId: string,
  overrides: Partial<NetworkOverageInvoice> = {}
): NetworkOverageInvoice {
  return networkOverageInvoiceSchema.parse({
    amountDueCents: 15_000,
    billingPeriodSummaryId: summaryId,
    createdAt: "2026-08-28T12:00:00.000Z",
    id: networkOverageInvoiceId(summaryId),
    internalBillingTest: false,
    issuedAt: "2026-08-28T12:00:00.000Z",
    organizationId: ORGANIZATION_ID,
    paidAt: null,
    periodEnd: PERIOD_END,
    periodStart: PERIOD_START,
    planCode: "network_pilot",
    quantity: 1,
    sequence: 1,
    status: "open",
    stripeInvoiceId: "in_test_overage",
    subtotalCents: 15_000,
    unitAmountCents: 15_000,
    usageEventIds: [networkUsageEventId(movementUuid(99))],
    usageSubtotalCents: 15_000,
    updatedAt: "2026-08-28T12:00:00.000Z",
    voidedAt: null,
    ...overrides
  })
}

function providerAdjustment(
  summaryId: string,
  invoiceId: string,
  overrides: Partial<BillingAdjustment> = {}
): BillingAdjustment {
  return billingAdjustmentSchema.parse({
    actorUserId: ACCEPTED_BY,
    amountDeltaCents: -3_000,
    billingPeriodSummaryId: summaryId,
    createdAt: "2026-08-29T12:00:00.000Z",
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    invoiceId,
    organizationId: ORGANIZATION_ID,
    providerReference: "cn_adjustment001",
    providerRevenueDeltaCents: 0,
    providerSettlementAmountCents: 3_000,
    providerSettlementAttemptCount: 1,
    providerSettlementFailure: null,
    providerSettlementLastAttemptAt: "2026-08-29T12:01:00.000Z",
    providerSettlementRemainingCents: 0,
    providerSettlementSettledAt: "2026-08-29T12:01:00.000Z",
    providerSettlementState: "settled",
    reason: "Provider-confirmed billing correction",
    settlementIntent: "credit_note",
    type: "service_credit",
    unitDelta: 0,
    usageEventId: null,
    ...overrides
  })
}

function source(
  overrides: Partial<SubscriptionBillingSource> = {}
): SubscriptionBillingSource {
  const period = periodSummary()

  return {
    billingAdjustments: [],
    billingPeriodSummaries: [period.summary],
    billingPlanDefinitions: [...SUBSCRIPTION_PLAN_CATALOG],
    networkOverageInvoices: [],
    networkUsageEvents: period.events,
    organizationBillingAccounts: [billingAccount()],
    organizationSubscriptions: [pilotSubscription()],
    subscriptionBaseInvoices: [],
    ...overrides
  }
}

describe("historical subscription billing read model", () => {
  it("preserves actual Pilot terms and usage without presenting a current enrollment path", () => {
    const view = buildHostSubscriptionBillingView(
      source(),
      ORGANIZATION_ID,
      new Date("2026-08-27T12:00:00.000Z")
    )

    expect(view).toMatchObject({
      basePriceLabel: "$1,500.00/month",
      billingModel: "subscription_v1",
      commitmentLabel:
        "Jul 28, 2026 – Oct 26, 2026 · $4,500.00 minimum base",
      includesDispatchProCapabilities: true,
      overageRateLabel: "$150.00 per completed movement",
      planName: "Network Pilot — historical",
      recordMode: "historical",
      canOpenPortal: true,
      statusLabel: "Recorded active"
    })
    expect(view?.allowance).toMatchObject({
      includedUnits: 30,
      overageUnits: 0,
      remainingUnits: 27,
      usedUnits: 3
    })
    expect(view).not.toHaveProperty("canStartCheckout")
    expect(view).not.toHaveProperty("pilotConversion")
    expect(view).not.toHaveProperty("recommendation")
    expect(view?.allowance).not.toHaveProperty("forecastUnits")
    expect(view?.allowance).not.toHaveProperty("forecastOverageUnits")
  })

  it("describes Dispatch Pro as private-fleet software with no Network allowance or overage", () => {
    const dispatch = dispatchSubscription()
    const view = buildHostSubscriptionBillingView(
      source({
        billingPeriodSummaries: [],
        networkUsageEvents: [],
        organizationBillingAccounts: [
          billingAccount({ billingModel: "dispatch_pro" })
        ],
        organizationSubscriptions: [dispatch]
      }),
      ORGANIZATION_ID,
      new Date("2026-08-10T12:00:00.000Z")
    )

    expect(view).toMatchObject({
      allowance: null,
      billingModel: "dispatch_pro",
      networkAllowanceLabel:
        "0 completed Network movements — Dispatch Pro includes no Network allowance",
      overageRateLabel: "No Network overage",
      planName: "Dispatch Pro — historical",
      recordMode: "historical",
      sectionLabel: "Historical Dispatch Pro record"
    })
    expect(view?.statusDetail).toContain(
      "does not authorize new work"
    )
  })

  it("returns null for a configured account without a real subscription", () => {
    const view = buildHostSubscriptionBillingView(
      source({
        billingPeriodSummaries: [],
        networkUsageEvents: [],
        organizationBillingAccounts: [
          billingAccount({
            activationState: "configured_dark"
          })
        ],
        organizationSubscriptions: []
      }),
      ORGANIZATION_ID,
      new Date("2026-08-01T12:00:00.000Z")
    )

    expect(view).toBeNull()
  })

  it("returns null for legacy and percentage accounts without real subscription history", () => {
    const legacy = buildHostSubscriptionBillingView(
      source({
        billingPeriodSummaries: [],
        networkUsageEvents: [],
        organizationBillingAccounts: [
          billingAccount({
            activationState: "legacy",
            billingModel: "legacy_percentage",
            subscriptionId: null
          })
        ],
        organizationSubscriptions: []
      }),
      ORGANIZATION_ID
    )
    const percentage = buildHostSubscriptionBillingView(
      source({
        billingPeriodSummaries: [],
        networkUsageEvents: [],
        organizationBillingAccounts: [
          billingAccount({
            activationState: "percentage_active",
            billingModel: "percentage_v1",
            percentageTermsSnapshot: {
              acceptedAt: "2026-08-03T00:00:00.000Z",
              acceptedByUserId: ACCEPTED_BY,
              acceptedTermsVersion: PERCENTAGE_V1_TERMS_VERSION,
              billingCadence: "monthly_in_arrears",
              currency: "USD",
              feeBps: PLATFORM_FEE_BPS
            },
            subscriptionId: null
          })
        ],
        organizationSubscriptions: []
      }),
      ORGANIZATION_ID
    )

    expect(legacy).toBeNull()
    expect(percentage).toBeNull()
  })

  it("keeps terminal subscription history visible after percentage_v1 drops the live pointer", () => {
    const preservedSubscription = pilotSubscription({
      status: "cancelled",
      updatedAt: "2026-08-03T00:00:00.000Z"
    })
    const view = buildHostSubscriptionBillingView(
      source({
        organizationBillingAccounts: [
          billingAccount({
            activationState: "percentage_active",
            billingModel: "percentage_v1",
            effectiveAt: "2026-08-03T00:00:00.000Z",
            percentageTermsSnapshot: {
              acceptedAt: "2026-08-03T00:00:00.000Z",
              acceptedByUserId: ACCEPTED_BY,
              acceptedTermsVersion: PERCENTAGE_V1_TERMS_VERSION,
              billingCadence: "monthly_in_arrears",
              currency: "USD",
              feeBps: PLATFORM_FEE_BPS
            },
            subscriptionId: null,
            updatedAt: "2026-08-03T00:00:00.000Z"
          })
        ],
        organizationSubscriptions: [preservedSubscription]
      }),
      ORGANIZATION_ID,
      new Date("2026-08-04T12:00:00.000Z")
    )

    expect(view).toMatchObject({
      activationLabel: "Historical record preserved",
      billingModel: "subscription_v1",
      canOpenPortal: true,
      paymentLabel: "Recorded current",
      planName: "Network Pilot — historical",
      recordMode: "historical",
      statusLabel: "Recorded cancelled",
      subscriptionId: SUBSCRIPTION_ID
    })
    expect(view).not.toHaveProperty("canStartCheckout")
  })

  it("prefers the provider-bound obligation over a newer pointerless conversion record", () => {
    const view = buildHostSubscriptionBillingView(
      source({
        organizationBillingAccounts: [
          billingAccount({
            activationState: "percentage_active",
            billingModel: "percentage_v1",
            percentageTermsSnapshot: {
              acceptedAt: "2026-11-01T00:00:00.000Z",
              acceptedByUserId: ACCEPTED_BY,
              acceptedTermsVersion: PERCENTAGE_V1_TERMS_VERSION,
              billingCadence: "monthly_in_arrears",
              currency: "USD",
              feeBps: PLATFORM_FEE_BPS
            },
            subscriptionId: null,
            updatedAt: "2026-11-01T00:00:00.000Z"
          })
        ],
        organizationSubscriptions: [
          pilotSubscription({
            status: "cancelled",
            updatedAt: "2026-10-26T12:00:00.000Z"
          }),
          conversionSubscription({
            updatedAt: "2026-11-02T12:00:00.000Z"
          })
        ]
      }),
      ORGANIZATION_ID,
      new Date("2026-11-03T12:00:00.000Z")
    )

    expect(view).toMatchObject({
      activationLabel: "Historical record preserved",
      canOpenPortal: true,
      paymentLabel: "Recorded current",
      planCode: "network_pilot",
      subscriptionId: SUBSCRIPTION_ID
    })
    expect(view?.planCode).not.toBe("network_25")
  })

  it("does not offer checkout for an incomplete preserved subscription", () => {
    const pending = pilotSubscription({
      activationAuthorizedAt: "2026-07-31T12:00:00.000Z",
      activationAuthorizedByUserId: ACCEPTED_BY,
      paymentState: "requires_payment_method",
      status: "incomplete",
      stripeCustomerId: "cus_test_logloads",
      stripeSubscriptionId: null
    })
    const view = buildHostSubscriptionBillingView(
      source({
        billingPeriodSummaries: [],
        networkUsageEvents: [],
        organizationBillingAccounts: [
          billingAccount({ activationState: "configured_dark" })
        ],
        organizationSubscriptions: [pending]
      }),
      ORGANIZATION_ID,
      new Date("2026-08-01T12:00:00.000Z"),
      true
    )

    expect(view).toMatchObject({
      canOpenPortal: false,
      planCode: "network_pilot",
      recordMode: "historical",
      subscriptionId: SUBSCRIPTION_ID
    })
    expect(view).not.toHaveProperty("canStartCheckout")
    expect(JSON.stringify(view)).not.toContain("Enrollment and collection are enabled")
  })

  it("does not project conversion offers from a preserved Pilot grace window", () => {
    const pilot = pilotSubscription({
      activationAuthorizedAt: PERIOD_START,
      activationAuthorizedByUserId: ACCEPTED_BY,
      conversionGraceEndsAt: "2026-11-09T12:00:00.000Z",
      operationalActivatedAt: PERIOD_START,
      status: "non_renewing"
    })
    const data = source({
      organizationSubscriptions: [pilot]
    })
    const view = buildHostSubscriptionBillingView(
      data,
      ORGANIZATION_ID,
      new Date("2026-10-27T12:00:00.000Z"),
      true
    )
    expect(view).toMatchObject({
      planCode: "network_pilot",
      recordMode: "historical"
    })
    expect(view).not.toHaveProperty("pilotConversion")
    expect(view).not.toHaveProperty("recommendation")
  })

  it("keeps the linked preserved record and does not expose a conversion retry", () => {
    const pilot = pilotSubscription({
      activationAuthorizedAt: PERIOD_START,
      activationAuthorizedByUserId: ACCEPTED_BY,
      conversionGraceEndsAt: "2026-11-09T12:00:00.000Z",
      operationalActivatedAt: PERIOD_START,
      status: "non_renewing"
    })
    const target = conversionSubscription()
    const view = buildHostSubscriptionBillingView(
      source({
        organizationSubscriptions: [pilot, target]
      }),
      ORGANIZATION_ID,
      new Date("2026-10-28T12:00:00.000Z"),
      true
    )

    expect(view).toMatchObject({
      canOpenPortal: true,
      planCode: "network_pilot",
      planName: "Network Pilot — historical",
      recordMode: "historical",
      subscriptionId: SUBSCRIPTION_ID
    })
    expect(view).not.toHaveProperty("canStartCheckout")
  })

  it("surfaces ledger-to-summary divergence instead of hiding it", () => {
    const data = source()
    const summary = data.billingPeriodSummaries[0]!

    const view = buildHostSubscriptionBillingView(
      {
        ...data,
        networkUsageEvents: data.networkUsageEvents.slice(0, 1),
        billingPeriodSummaries: [
          billingPeriodSummarySchema.parse({
            ...summary,
            updatedAt: "2026-08-27T12:00:00.000Z"
          })
        ]
      },
      ORGANIZATION_ID,
      new Date("2026-08-27T12:00:00.000Z")
    )

    expect(view?.integrityNotices).toEqual([
      "The allowance summary records 3 active units while its usage ledger contains 1. Reconcile before invoicing."
    ])
  })

  it("shows the provider-confirmed base amount and exact remaining balance", () => {
    const providerInvoiceId = "in_pilotinstallment001"
    const view = buildHostSubscriptionBillingView(
      source({
        subscriptionBaseInvoices: [
          subscriptionBaseInvoiceSchema.parse({
            amountDueCents: 150_000,
            amountRemainingCents: 75_000,
            attemptCount: 2,
            attemptedAt: "2026-08-28T12:00:00.000Z",
            createdAt: "2026-08-28T12:00:00.000Z",
            currency: "usd",
            dueAt: "2026-09-04T12:00:00.000Z",
            hostedInvoiceUrl: "https://invoice.stripe.com/i/test",
            id: subscriptionBaseInvoiceId(
              SUBSCRIPTION_ID,
              providerInvoiceId
            ),
            internalBillingTest: false,
            lastPaymentFailure: "Card declined",
            organizationId: ORGANIZATION_ID,
            planCode: "network_pilot",
            providerInvoiceId,
            status: "open",
            subscriptionId: SUBSCRIPTION_ID,
            updatedAt: "2026-08-28T12:05:00.000Z"
          })
        ]
      }),
      ORGANIZATION_ID,
      new Date("2026-08-28T12:05:00.000Z")
    )

    expect(view?.latestBaseInvoice).toEqual({
      amountDueLabel: "$1,500.00",
      amountRemainingLabel: "$750.00",
      dueOnLabel: "Sep 4, 2026",
      hostedInvoiceUrl: "https://invoice.stripe.com/i/test",
      status: "open",
      statusLabel: "Outstanding"
    })
    expect(view).toMatchObject({
      outstandingAmountLabel: "$750.00",
      outstandingInvoiceCount: 1
    })
  })

  it("nets issued credits from usage receivables and adds only unpaid supplemental balances", () => {
    const period = periodSummary(1)
    const invoice = overageInvoice(period.summary.id, {
      amountDueCents: 10_000,
      subtotalCents: 10_000,
      unitAmountCents: 10_000,
      usageSubtotalCents: 10_000
    })
    const credit = providerAdjustment(period.summary.id, invoice.id)
    const outstandingSupplemental = providerAdjustment(
      period.summary.id,
      invoice.id,
      {
        amountDeltaCents: 2_000,
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        providerReference: "in_supplemental001",
        providerRevenueDeltaCents: 0,
        providerSettlementAmountCents: 2_000,
        providerSettlementRemainingCents: 2_000,
        providerSettlementSettledAt: null,
        providerSettlementState: "outstanding",
        settlementIntent: "supplemental_debit",
        type: "manual_debit"
      }
    )
    const paidSupplemental = providerAdjustment(
      period.summary.id,
      invoice.id,
      {
        amountDeltaCents: 4_000,
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        providerReference: "in_supplemental002",
        providerRevenueDeltaCents: 4_000,
        providerSettlementAmountCents: 4_000,
        providerSettlementRemainingCents: 0,
        settlementIntent: "supplemental_debit",
        type: "manual_debit"
      }
    )
    const view = buildHostSubscriptionBillingView(
      source({
        billingAdjustments: [
          credit,
          outstandingSupplemental,
          paidSupplemental
        ],
        billingPeriodSummaries: [period.summary],
        networkOverageInvoices: [invoice],
        networkUsageEvents: period.events
      }),
      ORGANIZATION_ID,
      new Date("2026-08-29T12:05:00.000Z")
    )

    expect(view).toMatchObject({
      outstandingAmountLabel: "$90.00",
      outstandingInvoiceCount: 2
    })
  })

  it("does not expose an internal subscription carrying a commercial plan code", () => {
    const view = buildHostSubscriptionBillingView(
      source({
        organizationSubscriptions: [
          pilotSubscription({ internalBillingTest: true })
        ]
      }),
      ORGANIZATION_ID,
      new Date("2026-08-10T12:00:00.000Z")
    )

    expect(view).toBeNull()
  })

  it("isolates independently flagged summaries, usage, and overage invoices", () => {
    const internalPeriod = periodSummary(3, {
      internalBillingTest: true
    })
    const summaryFilteredView = buildHostSubscriptionBillingView(
      source({
        billingPeriodSummaries: [internalPeriod.summary],
        networkUsageEvents: internalPeriod.events
      }),
      ORGANIZATION_ID,
      new Date("2026-08-10T12:00:00.000Z")
    )

    expect(summaryFilteredView?.allowance).toBeNull()

    const commercialPeriod = periodSummary(0)
    const internalUsage = usageEvent(20, commercialPeriod.summary.id, {
      internalBillingTest: true
    })
    const usageFilteredView = buildHostSubscriptionBillingView(
      source({
        billingPeriodSummaries: [commercialPeriod.summary],
        networkUsageEvents: [internalUsage]
      }),
      ORGANIZATION_ID,
      new Date("2026-08-10T12:00:00.000Z")
    )

    expect(usageFilteredView?.allowance).toBeNull()
    expect(usageFilteredView?.integrityNotices).toEqual([])

    const invoiceFilteredView = buildHostSubscriptionBillingView(
      source({
        billingPeriodSummaries: [commercialPeriod.summary],
        networkOverageInvoices: [
          overageInvoice(commercialPeriod.summary.id, {
            internalBillingTest: true
          })
        ],
        networkUsageEvents: []
      }),
      ORGANIZATION_ID,
      new Date("2026-08-10T12:00:00.000Z")
    )

    expect(invoiceFilteredView).toMatchObject({
      latestOverageInvoice: null,
      outstandingAmountLabel: "$0.00",
      outstandingInvoiceCount: 0
    })
  })
})
