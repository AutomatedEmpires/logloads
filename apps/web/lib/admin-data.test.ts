import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() })
}))

import {
  SUBSCRIPTION_PLAN_CATALOG,
  assignmentSchema,
  billingAdjustmentSchema,
  billingPeriodSummaryId,
  billingPeriodSummarySchema,
  billingUsageReversalAdjustmentId,
  computePlatformFeeCents,
  entitlementSchema,
  hostInvoiceSchema,
  networkOverageInvoiceId,
  networkOverageInvoiceSchema,
  networkUsageEventId,
  networkUsageEventSchema,
  organizationBillingAccountId,
  organizationBillingAccountSchema,
  organizationSchema,
  organizationSubscriptionSchema,
  percentageFeeEventId,
  PLATFORM_FEE_BPS,
  platformFeeEventId,
  platformFeeEventSchema,
  subscriptionBaseInvoiceId,
  subscriptionBaseInvoiceSchema,
  subscriptionPlanDefinition,
  type Assignment,
  type BillingAdjustment,
  type BillingPeriodSummary,
  type Entitlement,
  type EnterpriseAgreementTerms,
  type HostInvoice,
  type NetworkOverageInvoice,
  type NetworkUsageEvent,
  type OrganizationBillingAccount,
  type OrganizationSubscription,
  type PlatformFeeEvent,
  type SubscriptionBaseInvoice,
  type SubscriptionPlanCode
} from "@logloads/contracts"

import {
  buildAdminBillingSnapshot,
  type AdminBillingSource
} from "./admin-data"
import { AdminSubscriptionRecord } from "../components/v3/AdminPages"

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111"
const CURRENT_PERCENTAGE_ORGANIZATION_ID = "12121212-1212-4212-8212-121212121212"
const ACCEPTED_BY = "20202020-2020-4020-8020-202020202020"
const LANDING_ID = "23000000-0000-4000-8000-000000000001"
const PERIOD_START = "2026-07-28T00:00:00.000Z"
const PERIOD_END = "2026-08-28T00:00:00.000Z"
const NOW = Date.parse("2026-08-10T12:00:00.000Z")
const ENTERPRISE_AGREEMENT = {
  commitmentMonths: 24,
  definedIntegrations: ["Dispatch ERP feed", "Scale ticket export"],
  negotiated: true,
  serviceSupportObligations:
    "Named launch manager and weekday priority support with a four-hour response target."
} satisfies EnterpriseAgreementTerms

const SUBSCRIPTION_IDS: Record<SubscriptionPlanCode, string> = {
  dispatch_pro: "30000000-0000-4000-8000-000000000001",
  enterprise_250_plus: "30000000-0000-4000-8000-000000000006",
  internal_billing_test: "30000000-0000-4000-8000-000000000007",
  network_100: "30000000-0000-4000-8000-000000000005",
  network_25: "30000000-0000-4000-8000-000000000003",
  network_50: "30000000-0000-4000-8000-000000000004",
  network_pilot: "30000000-0000-4000-8000-000000000002"
}

function organization() {
  return organizationSchema.parse({
    archivedAt: null,
    createdAt: PERIOD_START,
    displayName: "Timberline Hauling",
    id: ORGANIZATION_ID,
    legalName: "Timberline Hauling LLC",
    primaryRegion: "Pacific Northwest",
    slug: "timberline-hauling",
    type: "carrier",
    updatedAt: PERIOD_START,
    verificationStatus: "verified"
  })
}

function subscription(
  planCode: SubscriptionPlanCode,
  overrides: Partial<OrganizationSubscription> = {}
): OrganizationSubscription {
  const plan = subscriptionPlanDefinition(planCode)
  let commitmentEnd: string | null = null

  if (plan.allowanceWindowDays) {
    commitmentEnd = new Date(
      Date.parse(PERIOD_START) +
        plan.allowanceWindowDays * 24 * 60 * 60 * 1000
    ).toISOString()
  } else if (plan.commitmentMonths) {
    const end = new Date(PERIOD_START)

    end.setUTCMonth(end.getUTCMonth() + plan.commitmentMonths)
    commitmentEnd = end.toISOString()
  }
  const pendingPlanCode = overrides.pendingPlanCode ?? null

  return organizationSubscriptionSchema.parse({
    acceptedAt: PERIOD_START,
    acceptedByUserId: ACCEPTED_BY,
    acceptedTermsVersion: "subscription-v1-2026-07-28",
    baseMonthlyPriceSnapshotCents: plan.baseMonthlyPriceCents,
    billingModel: plan.billingModel,
    cancelAtPeriodEnd: plan.pilot,
    commitmentEnd,
    commitmentStart: commitmentEnd ? PERIOD_START : null,
    createdAt: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    currentPeriodStart: PERIOD_START,
    customTerms: plan.customContract ? ENTERPRISE_AGREEMENT : {},
    graceState: "none",
    id: SUBSCRIPTION_IDS[planCode],
    includedAllowanceSnapshot: plan.includedNetworkLoadUnits,
    includesDispatchProCapabilitiesSnapshot:
      plan.includesDispatchProCapabilities,
    internalBillingTest: plan.internalBillingTest,
    organizationId: ORGANIZATION_ID,
    operatingMarketIds:
      plan.allowancePeriod !== "none" ||
      plan.billingModel === "enterprise_custom"
        ? [LANDING_ID]
        : [],
    overageRateSnapshotCents: plan.overageUnitPriceCents,
    paymentState: "current",
    paymentGraceEndsAt:
      overrides.graceState && overrides.graceState !== "none"
        ? PERIOD_END
        : null,
    pendingOperatingMarketIds: pendingPlanCode
      ? [LANDING_ID]
      : null,
    pendingPlanCode,
    pendingPlanEffectiveAt: pendingPlanCode ? PERIOD_END : null,
    pendingPlanSnapshot: pendingPlanCode
      ? subscriptionPlanDefinition(pendingPlanCode)
      : null,
    planCode: plan.code,
    planSnapshot: plan,
    renewalBehavior: plan.pilot ? "non_renewing" : "automatic",
    status: "active",
    stripeCustomerId: "cus_test_logloads",
    stripeSubscriptionId: "sub_test_logloads",
    updatedAt: PERIOD_START,
    ...overrides
  })
}

function usageSummary(
  acceptedSubscription: OrganizationSubscription,
  usedUnits: number,
  overrides: Partial<BillingPeriodSummary> = {}
): BillingPeriodSummary {
  const includedUnits = acceptedSubscription.includedAllowanceSnapshot ?? 0
  const overageUnitPriceCents =
    acceptedSubscription.overageRateSnapshotCents ?? 0
  const overageUnits = Math.max(0, usedUnits - includedUnits)

  return billingPeriodSummarySchema.parse({
    allowancePeriod: acceptedSubscription.planSnapshot.allowancePeriod,
    billingModel: acceptedSubscription.billingModel,
    closedAt: null,
    createdAt: PERIOD_START,
    id: billingPeriodSummaryId(acceptedSubscription.id, PERIOD_START),
    includedUnits,
    invoiceIds: [],
    notificationThresholdsEmitted: [],
    organizationId: acceptedSubscription.organizationId,
    overageAmountCents: overageUnits * overageUnitPriceCents,
    overageUnitPriceCents,
    overageUnits,
    periodEnd: PERIOD_END,
    periodStart: PERIOD_START,
    planCode: acceptedSubscription.planCode,
    planSnapshot: acceptedSubscription.planSnapshot,
    reconciledAt: null,
    status: "open",
    subscriptionId: acceptedSubscription.id,
    updatedAt: PERIOD_START,
    usageEventIds: [],
    usedUnits,
    ...overrides
  })
}

function activeBillingAccount(
  acceptedSubscription: OrganizationSubscription,
  overrides: Partial<OrganizationBillingAccount> = {}
): OrganizationBillingAccount {
  return organizationBillingAccountSchema.parse({
    activationState: "active",
    billingModel: acceptedSubscription.billingModel,
    createdAt: PERIOD_START,
    effectiveAt: PERIOD_START,
    id: organizationBillingAccountId(ORGANIZATION_ID),
    organizationId: ORGANIZATION_ID,
    subscriptionId: acceptedSubscription.id,
    updatedAt: PERIOD_START,
    ...overrides
  })
}

function legacyBillingAccount(): OrganizationBillingAccount {
  return organizationBillingAccountSchema.parse({
    activationState: "legacy",
    billingModel: "legacy_percentage",
    createdAt: PERIOD_START,
    effectiveAt: PERIOD_START,
    id: organizationBillingAccountId(ORGANIZATION_ID),
    organizationId: ORGANIZATION_ID,
    subscriptionId: null,
    updatedAt: PERIOD_START
  })
}

function percentageBillingAccount(): OrganizationBillingAccount {
  return organizationBillingAccountSchema.parse({
    activationState: "percentage_active",
    billingModel: "percentage_v1",
    createdAt: PERIOD_START,
    effectiveAt: PERIOD_START,
    id: organizationBillingAccountId(CURRENT_PERCENTAGE_ORGANIZATION_ID),
    organizationId: CURRENT_PERCENTAGE_ORGANIZATION_ID,
    percentageTermsSnapshot: {
      acceptedAt: PERIOD_START,
      acceptedByUserId: ACCEPTED_BY,
      acceptedTermsVersion: "percentage-v1-2026-08-03",
      billingCadence: "monthly_in_arrears",
      currency: "USD",
      feeBps: PLATFORM_FEE_BPS
    },
    subscriptionId: null,
    updatedAt: PERIOD_START
  })
}

function legacyAssignment(): Assignment {
  return assignmentSchema.parse({
    assignedAt: PERIOD_START,
    billingCommittedAt: PERIOD_START,
    billingModel: "legacy_percentage",
    billingPlanCodeAtCommitment: null,
    billingSubscriptionIdAtCommitment: null,
    cancellationReason: null,
    cancelledAt: null,
    capacitySource: "private_fleet",
    completedAt: null,
    createdAt: PERIOD_START,
    directOfferId: null,
    dispatcherNotes: null,
    driverPaymentReceivedAmountCents: null,
    driverPaymentReceivedAt: null,
    driverPaymentReceivedByUserId: null,
    driverPaymentReceivedCurrency: null,
    driverPaymentSentAt: null,
    driverPaymentSentByUserId: null,
    driverProfileId: "40000000-0000-4000-8000-000000000001",
    id: "40000000-0000-4000-8000-000000000002",
    loadMovementId: "40000000-0000-4000-8000-000000000002",
    loadPostingId: "40000000-0000-4000-8000-000000000003",
    requestedAt: PERIOD_START,
    status: "accepted",
    termsSnapshot: {},
    trailerProfileId: null,
    truckProfileId: "40000000-0000-4000-8000-000000000004",
    truckSlotId: "40000000-0000-4000-8000-000000000005",
    updatedAt: PERIOD_START
  })
}

function percentageAssignment(): Assignment {
  return assignmentSchema.parse({
    ...legacyAssignment(),
    billingModel: "percentage_v1",
    id: "41000000-0000-4000-8000-000000000002",
    loadMovementId: "41000000-0000-4000-8000-000000000002"
  })
}

function legacyEntitlement(): Entitlement {
  return entitlementSchema.parse({
    activeLandingLimit: null,
    activeTruckLimit: 10,
    createdAt: PERIOD_START,
    currentPeriodEndsAt: PERIOD_END,
    features: [],
    id: "50000000-0000-4000-8000-000000000001",
    organizationId: ORGANIZATION_ID,
    product: "fleet_operations",
    status: "past_due",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    updatedAt: PERIOD_START
  })
}

function legacyFeeEvent(): PlatformFeeEvent {
  const assignmentId = "60000000-0000-4000-8000-000000000001"
  const driverPayCents = 50_000

  return platformFeeEventSchema.parse({
    assignmentId,
    billingModel: "legacy_percentage",
    createdAt: PERIOD_START,
    driverPayCents,
    feeBps: PLATFORM_FEE_BPS,
    feeCents: computePlatformFeeCents(driverPayCents, PLATFORM_FEE_BPS),
    id: platformFeeEventId(assignmentId),
    invoiceId: null,
    loadMovementId: assignmentId,
    loadPostingId: "60000000-0000-4000-8000-000000000002",
    occurredAt: PERIOD_START,
    organizationId: ORGANIZATION_ID,
    status: "accrued",
    truckSlotId: "60000000-0000-4000-8000-000000000003",
    updatedAt: PERIOD_START,
    voidReason: null
  })
}

function legacyInvoice(): HostInvoice {
  return hostInvoiceSchema.parse({
    createdAt: "2026-08-01T00:00:00.000Z",
    feeEventIds: [],
    id: "70000000-0000-4000-8000-000000000001",
    issuedAt: "2026-08-01T00:00:00.000Z",
    organizationId: ORGANIZATION_ID,
    paidAt: null,
    periodEnd: "2026-08-01T00:00:00.000Z",
    periodStart: "2026-07-01T00:00:00.000Z",
    status: "open",
    stripeInvoiceId: null,
    subtotalCents: 2_500,
    updatedAt: "2026-08-01T00:00:00.000Z",
    voidedAt: null
  })
}

function currentPercentageFeeEvent(
  invoiceId: string | null = null
): PlatformFeeEvent {
  const movementId = "61000000-0000-4000-8000-000000000001"

  return platformFeeEventSchema.parse({
    ...legacyFeeEvent(),
    assignmentId: movementId,
    billingModel: "percentage_v1",
    id: percentageFeeEventId(movementId),
    invoiceId,
    loadMovementId: movementId,
    organizationId: CURRENT_PERCENTAGE_ORGANIZATION_ID,
    status: invoiceId ? "invoiced" : "accrued"
  })
}

function usageEvent(
  acceptedSubscription: OrganizationSubscription,
  summaryId: string,
  sequence: number,
  overrides: Partial<NetworkUsageEvent> = {}
): NetworkUsageEvent {
  const suffix = sequence.toString().padStart(12, "0")
  const movementId = `80000000-0000-4000-8000-${suffix}`

  return networkUsageEventSchema.parse({
    assignmentId: `81000000-0000-4000-8000-${suffix}`,
    auditMetadata: {},
    billingModel: acceptedSubscription.billingModel,
    billingPeriodSummaryId: summaryId,
    capacitySource: "logloads_network",
    completionAt: `2026-08-${String((sequence % 20) + 1).padStart(
      2,
      "0"
    )}T12:00:00.000Z`,
    createdAt: PERIOD_START,
    id: networkUsageEventId(movementId),
    invoiceId: null,
    loadMovementId: movementId,
    loadPostingId: "82000000-0000-4000-8000-000000000001",
    organizationId: ORGANIZATION_ID,
    planCode: acceptedSubscription.planCode,
    reversalAdjustmentId: null,
    status: "recorded",
    unitCount: 1,
    updatedAt: PERIOD_START,
    ...overrides
  })
}

function overageInvoice(
  acceptedSubscription: OrganizationSubscription,
  summaryId: string,
  usageEventIds: string[],
  overrides: Partial<NetworkOverageInvoice> = {}
): NetworkOverageInvoice {
  const unitAmountCents =
    acceptedSubscription.overageRateSnapshotCents ?? 0

  return networkOverageInvoiceSchema.parse({
    amountDueCents: usageEventIds.length * unitAmountCents,
    billingPeriodSummaryId: summaryId,
    createdAt: "2026-08-28T01:00:00.000Z",
    id: networkOverageInvoiceId(summaryId),
    internalBillingTest: acceptedSubscription.internalBillingTest,
    issuedAt: "2026-08-28T01:00:00.000Z",
    organizationId: ORGANIZATION_ID,
    paidAt: "2026-08-29T01:00:00.000Z",
    periodEnd: PERIOD_END,
    periodStart: PERIOD_START,
    planCode: acceptedSubscription.planCode,
    quantity: usageEventIds.length,
    sequence: 1,
    status: "paid",
    stripeInvoiceId: "in_test_network_overage",
    subtotalCents: usageEventIds.length * unitAmountCents,
    unitAmountCents,
    usageSubtotalCents: usageEventIds.length * unitAmountCents,
    updatedAt: "2026-08-29T01:00:00.000Z",
    usageEventIds,
    voidedAt: null,
    ...overrides
  })
}

function baseInvoice(
  acceptedSubscription: OrganizationSubscription,
  overrides: Partial<SubscriptionBaseInvoice> = {}
): SubscriptionBaseInvoice {
  const providerInvoiceId = "in_TestBase123"

  return subscriptionBaseInvoiceSchema.parse({
    amountDueCents:
      acceptedSubscription.baseMonthlyPriceSnapshotCents ?? 0,
    amountRemainingCents: 0,
    attemptedAt: "2026-08-01T01:00:00.000Z",
    attemptCount: 1,
    createdAt: "2026-08-01T01:00:00.000Z",
    currency: "USD",
    dueAt: null,
    hostedInvoiceUrl: "https://invoice.stripe.test/base",
    id: subscriptionBaseInvoiceId(
      acceptedSubscription.id,
      providerInvoiceId
    ),
    internalBillingTest: acceptedSubscription.internalBillingTest,
    lastPaymentFailure: null,
    nextPaymentAttemptAt: null,
    organizationId: acceptedSubscription.organizationId,
    paidAt: "2026-08-01T01:05:00.000Z",
    planCode: acceptedSubscription.planCode,
    providerInvoiceId,
    status: "paid",
    subscriptionId: acceptedSubscription.id,
    updatedAt: "2026-08-01T01:05:00.000Z",
    ...overrides
  })
}

function reversalAdjustment(
  reversedUsage: NetworkUsageEvent,
  amountDeltaCents: number
): BillingAdjustment {
  return billingAdjustmentSchema.parse({
    actorUserId: ACCEPTED_BY,
    amountDeltaCents,
    billingPeriodSummaryId: reversedUsage.billingPeriodSummaryId,
    createdAt: "2026-08-20T12:00:00.000Z",
    id: billingUsageReversalAdjustmentId(reversedUsage.id),
    invoiceId: reversedUsage.invoiceId,
    organizationId: ORGANIZATION_ID,
    reason: "Duplicate completion was reversed after dispatch review",
    type: "usage_reversal",
    unitDelta: -1,
    usageEventId: reversedUsage.id
  })
}

function settledProviderAdjustment(
  summaryId: string,
  invoiceId: string,
  overrides: Partial<BillingAdjustment> = {}
): BillingAdjustment {
  return billingAdjustmentSchema.parse({
    actorUserId: ACCEPTED_BY,
    amountDeltaCents: -25_000,
    billingPeriodSummaryId: summaryId,
    createdAt: "2026-08-29T00:00:00.000Z",
    id: "84000000-0000-4000-8000-000000000001",
    invoiceId,
    organizationId: ORGANIZATION_ID,
    providerReference: "cn_admin001",
    providerRevenueDeltaCents: -10_000,
    providerSettlementAmountCents: 25_000,
    providerSettlementAttemptCount: 1,
    providerSettlementFailure: null,
    providerSettlementLastAttemptAt: "2026-08-29T00:01:00.000Z",
    providerSettlementRemainingCents: 0,
    providerSettlementSettledAt: "2026-08-29T00:01:00.000Z",
    providerSettlementState: "settled",
    reason: "Provider-confirmed post-final correction",
    settlementIntent: "credit_note",
    type: "service_credit",
    unitDelta: 0,
    usageEventId: null,
    ...overrides
  })
}

function networkAssignment(
  acceptedSubscription: OrganizationSubscription
): Assignment {
  return assignmentSchema.parse({
    ...legacyAssignment(),
    billingModel: acceptedSubscription.billingModel,
    billingPlanCodeAtCommitment: acceptedSubscription.planCode,
    billingSubscriptionIdAtCommitment: acceptedSubscription.id,
    capacitySource: "logloads_network",
    id: "83000000-0000-4000-8000-000000000001",
    loadMovementId: "83000000-0000-4000-8000-000000000001"
  })
}

function source(
  overrides: Partial<AdminBillingSource> = {}
): AdminBillingSource {
  return {
    assignments: [],
    billingAdjustments: [],
    billingPeriodSummaries: [],
    billingPlanDefinitions: [...SUBSCRIPTION_PLAN_CATALOG],
    entitlements: [],
    hostInvoices: [],
    networkOverageInvoices: [],
    networkUsageEvents: [],
    organizationBillingAccounts: [],
    organizationSubscriptions: [],
    organizations: [organization()],
    platformFeeEvents: [],
    profiles: [],
    subscriptionBaseInvoices: [],
    ...overrides
  }
}

describe("admin subscription billing read model", () => {
  it("separates current percentage accounts and assignments from legacy history", () => {
    const snapshot = buildAdminBillingSnapshot(
      source({
        assignments: [legacyAssignment(), percentageAssignment()],
        organizationBillingAccounts: [
          legacyBillingAccount(),
          percentageBillingAccount()
        ]
      }),
      NOW
    )

    expect(snapshot.platformFeeLedger).toMatchObject({
      currentAssignmentCount: 1,
      currentOrganizationCount: 1,
      legacyAssignmentCount: 1,
      legacyOrganizationCount: 1
    })
  })

  it("attributes fee events, invoices, and outstanding cents to their frozen model", () => {
    const legacyHostInvoice = legacyInvoice()
    const currentHostInvoice = hostInvoiceSchema.parse({
      ...legacyInvoice(),
      id: "70000000-0000-4000-8000-000000000002",
      organizationId: CURRENT_PERCENTAGE_ORGANIZATION_ID
    })
    const legacyFee = platformFeeEventSchema.parse({
      ...legacyFeeEvent(),
      invoiceId: legacyHostInvoice.id,
      status: "invoiced"
    })
    const currentFee = currentPercentageFeeEvent(currentHostInvoice.id)
    legacyHostInvoice.feeEventIds = [legacyFee.id]
    currentHostInvoice.feeEventIds = [currentFee.id]

    const snapshot = buildAdminBillingSnapshot(
      source({
        hostInvoices: [legacyHostInvoice, currentHostInvoice],
        platformFeeEvents: [legacyFee, currentFee]
      }),
      NOW
    )

    expect(snapshot.platformFeeLedger).toMatchObject({
      currentFeeEventCount: 1,
      currentInvoiceCount: 1,
      currentOutstandingInvoiceLabel: "$25.00",
      legacyFeeEventCount: 1,
      legacyInvoiceCount: 1,
      legacyOutstandingInvoiceLabel: "$25.00"
    })
  })

  it("does not turn the plan catalog into subscriptions or revenue", () => {
    const snapshot = buildAdminBillingSnapshot(source(), NOW)

    expect(snapshot).toMatchObject({
      attention: [],
      commercialSubscriptionCount: 0,
      internalTestCount: 0,
      metrics: {
        activeArrLabel: "$0.00",
        activeMrrLabel: "$0.00",
        activeSubscriptionCount: 0,
        billingFailureCount: 0
      },
      planMix: [],
      subscriptions: [],
      unquantifiedMrrCount: 0
    })
  })

  it("reports frozen active revenue and the stored allowance and overage", () => {
    const acceptedSubscription = subscription("network_25")
    const snapshot = buildAdminBillingSnapshot(
      source({
        billingPeriodSummaries: [usageSummary(acceptedSubscription, 30)],
        organizationSubscriptions: [acceptedSubscription]
      }),
      NOW
    )

    expect(snapshot.metrics).toEqual({
      activeArrLabel: "$36,000.00",
      activeMrrLabel: "$3,000.00",
      activeSubscriptionCount: 1,
      billingFailureCount: 0
    })
    expect(snapshot.planMix).toEqual([
      {
        activeCount: 1,
        code: "network_25",
        label: "Network 25",
        salesAssisted: true,
        totalCount: 1,
        visibilityLabel: "Sales assisted"
      }
    ])
    expect(snapshot.subscriptions[0]).toMatchObject({
      baseMonthlyLabel: "$3,000.00 monthly",
      organizationName: "Timberline Hauling",
      providerReferenceLabel: "Provider references recorded",
      requiresAttention: false,
      salesAssisted: true,
      usage: {
        includedUnits: 25,
        overageAmountLabel: "$625.00",
        overageRateLabel: "$125.00 per completed Network load",
        overageUnits: 5,
        remainingUnits: 0,
        stateLabel: "Open",
        usedUnits: 30
      }
    })
  })

  it("reconciles the full local operating ledger without calling the provider", () => {
    const acceptedSubscription = subscription("network_25")
    const summaryId = billingPeriodSummaryId(
      acceptedSubscription.id,
      PERIOD_START
    )
    const invoiceId = networkOverageInvoiceId(summaryId)
    const activeUsage = Array.from({ length: 30 }, (_, index) =>
      usageEvent(
        acceptedSubscription,
        summaryId,
        index + 1,
        index >= 25
          ? {
              invoiceId,
              status: "invoiced"
            }
          : {}
      )
    )
    const reversedSeed = usageEvent(
      acceptedSubscription,
      summaryId,
      31
    )
    const reversedUsage = usageEvent(
      acceptedSubscription,
      summaryId,
      31,
      {
        reversalAdjustmentId: billingUsageReversalAdjustmentId(
          reversedSeed.id
        ),
        status: "reversed"
      }
    )
    const invoice = overageInvoice(
      acceptedSubscription,
      summaryId,
      activeUsage.slice(25).map((event) => event.id)
    )
    const summary = usageSummary(acceptedSubscription, 30, {
      closedAt: PERIOD_END,
      invoiceIds: [invoice.id],
      reconciledAt: "2026-08-29T01:00:00.000Z",
      status: "reconciled",
      usageEventIds: activeUsage.map((event) => event.id)
    })
    const adjustment = reversalAdjustment(reversedUsage, -12_500)
    const snapshot = buildAdminBillingSnapshot(
      source({
        assignments: [
          legacyAssignment(),
          networkAssignment(acceptedSubscription)
        ],
        billingAdjustments: [adjustment],
        billingPeriodSummaries: [summary],
        networkOverageInvoices: [invoice],
        networkUsageEvents: [...activeUsage, reversedUsage],
        organizationBillingAccounts: [
          activeBillingAccount(acceptedSubscription)
        ],
        organizationSubscriptions: [acceptedSubscription],
        subscriptionBaseInvoices: [baseInvoice(acceptedSubscription)]
      }),
      NOW
    )

    expect(snapshot.accounts).toEqual([
      expect.objectContaining({
        activationState: "active",
        billingModelLabel: "Subscription v1",
        organizationName: "Timberline Hauling",
        subscriptionLabel: "Network 25 · Active"
      })
    ])
    expect(snapshot.subscriptions[0]?.planSnapshot).toMatchObject({
      acceptedTermsVersion: "subscription-v1-2026-07-28",
      allowanceLabel: "25 completed Network loads per billing period",
      catalogReferenceLabel: "No provider catalog references frozen",
      commitmentTermsLabel: "12-month minimum commitment",
      definitionVersion: 1,
      dispatchCapabilitiesLabel: "Dispatch Pro capabilities included",
      overageRateLabel: "$125.00 per completed Network load"
    })
    expect(snapshot.operations).toEqual({
      allowanceUtilizationLabel: "30 of 25 included units (120.0%)",
      billingFailureRateLabel: "0 of 1 subscriptions (0.0%)",
      completedNetworkUnitCount: 30,
      networkMovementCount: 1,
      overageFrequencyLabel: "1 of 1 allowance periods (100.0%)",
      paidBaseRevenueLabel: "$3,000.00",
      paidOverageRevenueLabel: "$625.00",
      privateMovementCount: 1,
      revenuePerCompletedNetworkLoadLabel: "$120.83",
      totalSubscriptionRevenueLabel: "$3,625.00"
    })
    expect(snapshot.usageLedger).toHaveLength(31)
    expect(
      snapshot.usageLedger.find((row) => row.status === "reversed")
    ).toMatchObject({
      organizationName: "Timberline Hauling",
      reversalLabel: "Usage reversal recorded"
    })
    expect(snapshot.periodSummaries).toEqual([
      expect.objectContaining({
        adjustmentAmountLabel: "-$125.00",
        adjustmentCount: 1,
        adjustmentUnitLabel: "-1",
        calculationLabel: "30 used − 25 included = 5 overage",
        invoiceCount: 1,
        overageAmountLabel: "$625.00",
        usageEventCount: 30
      })
    ])
    expect(snapshot.invoices).toEqual([
      expect.objectContaining({
        calculationLabel: "5 × $125.00 = $625.00",
        providerReferenceLabel: "Provider invoice reference recorded",
        status: "paid",
        subtotalLabel: "$625.00",
        usageEventCount: 5
      })
    ])
    expect(snapshot.adjustments).toEqual([
      expect.objectContaining({
        amountDeltaLabel: "-$125.00",
        reason: "Duplicate completion was reversed after dispatch review",
        type: "usage_reversal",
        unitDeltaLabel: "-1"
      })
    ])
    expect(
      snapshot.reconciliationWarnings.filter(
        (warning) => warning.severity === "critical"
      )
    ).toEqual([])
    expect(snapshot.reconciliationWarnings.length).toBeGreaterThan(0)
    expect(
      snapshot.reconciliationWarnings.every(
        (warning) => warning.organizationName === "Plan catalog"
      )
    ).toBe(true)
  })

  it("keeps a non-renewing term in MRR without calling it an active subscription", () => {
    const endingTerm = subscription("network_25", {
      cancelAtPeriodEnd: true,
      renewalBehavior: "non_renewing",
      status: "non_renewing"
    })
    const snapshot = buildAdminBillingSnapshot(
      source({ organizationSubscriptions: [endingTerm] }),
      NOW
    )

    expect(snapshot.metrics).toEqual({
      activeArrLabel: "$36,000.00",
      activeMrrLabel: "$3,000.00",
      activeSubscriptionCount: 0,
      billingFailureCount: 0
    })
    expect(snapshot.planMix[0]).toMatchObject({
      activeCount: 0,
      totalCount: 1
    })
    expect(snapshot.subscriptions[0]).toMatchObject({
      renewalLabel: "Ends after the current term",
      status: "non_renewing"
    })
  })

  it("counts only provider-confirmed paid and refunded adjustment cash in revenue", () => {
    const acceptedSubscription = subscription("network_25")
    const summary = usageSummary(acceptedSubscription, 30)
    const usageIds = Array.from({ length: 5 }, (_, index) =>
      usageEvent(
        acceptedSubscription,
        summary.id,
        index + 1
      ).id
    )
    const invoice = overageInvoice(
      acceptedSubscription,
      summary.id,
      usageIds
    )
    const credit = settledProviderAdjustment(summary.id, invoice.id)
    const partiallyPaidSupplemental = settledProviderAdjustment(
      summary.id,
      invoice.id,
      {
        amountDeltaCents: 20_000,
        id: "84000000-0000-4000-8000-000000000002",
        providerReference: "in_admin_supplemental001",
        providerRevenueDeltaCents: 15_000,
        providerSettlementAmountCents: 20_000,
        providerSettlementRemainingCents: 5_000,
        providerSettlementSettledAt: null,
        providerSettlementState: "outstanding",
        settlementIntent: "supplemental_debit",
        type: "manual_debit"
      }
    )
    const snapshot = buildAdminBillingSnapshot(
      source({
        billingAdjustments: [credit, partiallyPaidSupplemental],
        billingPeriodSummaries: [summary],
        networkOverageInvoices: [invoice],
        organizationSubscriptions: [acceptedSubscription],
        subscriptionBaseInvoices: [
          baseInvoice(acceptedSubscription)
        ]
      }),
      NOW
    )

    expect(snapshot.operations).toMatchObject({
      paidBaseRevenueLabel: "$3,000.00",
      paidOverageRevenueLabel: "$625.00",
      totalSubscriptionRevenueLabel: "$3,675.00"
    })
    expect(
      snapshot.adjustments.find(
        (adjustment) => adjustment.id === credit.id
      )
    ).toMatchObject({
      providerReferenceLabel: "Provider reference recorded",
      providerRevenueDeltaLabel: "-$100.00",
      providerSettlementLabel:
        "Settled · $250.00 issued · $0.00 remaining"
    })
  })

  it("counts only applied Pilot conversions against the canonical Pilot cohort", () => {
    const currentPilot = subscription("network_pilot", {
      pendingPlanCode: "network_25",
      pendingPlanEffectiveAt: PERIOD_END,
      pendingPlanSnapshot: subscriptionPlanDefinition("network_25"),
      pendingOperatingMarketIds: [LANDING_ID]
    })
    const convertedPilot = subscription("network_25", {
      convertedFromPlanCode: "network_pilot"
    })
    const snapshot = buildAdminBillingSnapshot(
      source({
        organizationSubscriptions: [currentPilot, convertedPilot]
      }),
      NOW
    )

    expect(snapshot.pilotConversions).toEqual({
      cohortCount: 2,
      convertedCount: 1,
      rateLabel: "1 of 2 Pilot agreements (50.0%)"
    })
  })

  it("keeps a scheduled Enterprise agreement visible only in the admin billing row", () => {
    const current = subscription("network_100", {
      pendingCustomTerms: ENTERPRISE_AGREEMENT,
      pendingOperatingMarketIds: [LANDING_ID],
      pendingPlanCode: "enterprise_250_plus",
      pendingPlanEffectiveAt: PERIOD_END,
      pendingPlanSnapshot: subscriptionPlanDefinition(
        "enterprise_250_plus"
      )
    })
    const snapshot = buildAdminBillingSnapshot(
      source({ organizationSubscriptions: [current] }),
      NOW
    )

    expect(snapshot.subscriptions[0]).toMatchObject({
      enterpriseAgreement: null,
      pendingEnterpriseAgreement: {
        commitmentMonths: 24,
        definedIntegrations: [
          "Dispatch ERP feed",
          "Scale ticket export"
        ],
        serviceSupportObligations:
          "Named launch manager and weekday priority support with a four-hour response target."
      },
      pendingPlanLabel: expect.stringContaining("Enterprise 250+")
    })
  })

  it("separates dunning from revenue and flags custom revenue that cannot be quantified", () => {
    const pastDue = subscription("network_50", {
      graceState: "active",
      paymentState: "failed",
      pendingPlanCode: "network_100",
      pendingPlanEffectiveAt: PERIOD_END,
      status: "past_due",
      stripeSubscriptionId: null
    })
    const custom = subscription("enterprise_250_plus", {
      id: "30000000-0000-4000-8000-000000000008",
      stripeCustomerId: null,
      stripeSubscriptionId: null
    })
    const snapshot = buildAdminBillingSnapshot(
      source({ organizationSubscriptions: [pastDue, custom] }),
      NOW
    )

    expect(snapshot.metrics).toEqual({
      activeArrLabel: "$0.00",
      activeMrrLabel: "$0.00",
      activeSubscriptionCount: 1,
      billingFailureCount: 1
    })
    expect(snapshot.unquantifiedMrrCount).toBe(1)
    expect(snapshot.operations.billingFailureRateLabel).toBe(
      "1 of 2 subscriptions (50.0%)"
    )
    expect(snapshot.attention).toHaveLength(1)
    expect(snapshot.attention[0]).toMatchObject({
      graceLabel: "Dunning grace active",
      paymentState: "failed",
      pendingPlanLabel: expect.stringContaining("Network 100"),
      providerReferenceLabel: "Provider reference incomplete",
      status: "past_due"
    })
    const enterpriseRow = snapshot.subscriptions.find(
      (row) => row.planCode === "enterprise_250_plus"
    )

    expect(enterpriseRow).toMatchObject({
      baseMonthlyLabel: "Custom amount not recorded",
      enterpriseAgreement: {
        commitmentMonths: 24,
        definedIntegrations: [
          "Dispatch ERP feed",
          "Scale ticket export"
        ],
        serviceSupportObligations:
          "Named launch manager and weekday priority support with a four-hour response target."
      },
      planSnapshot: {
        commitmentTermsLabel: "24-month minimum commitment"
      },
      providerReferenceLabel: "No provider reference recorded"
    })
    vi.stubGlobal("React", React)
    const enterpriseMarkup = renderToStaticMarkup(
      React.createElement(AdminSubscriptionRecord, {
        subscription: enterpriseRow!
      })
    )

    expect(enterpriseMarkup).toContain("24-month minimum commitment")
    expect(enterpriseMarkup).toContain("Dispatch ERP feed")
    expect(enterpriseMarkup).toContain("Scale ticket export")
    expect(enterpriseMarkup).toContain(
      "Named launch manager and weekday priority support"
    )
    expect(
      snapshot.reconciliationWarnings.map((warning) => warning.title)
    ).toEqual(
      expect.arrayContaining([
        "Operating subscription is not the account authority",
        "Subscription provider evidence incomplete"
      ])
    )
  })

  it("propagates a commercial-coded subscription fixture flag through every dependent ledger", () => {
    const internalSubscription = subscription("network_25", {
      internalBillingTest: true
    })
    const internalSummary = usageSummary(internalSubscription, 26, {
      internalBillingTest: false
    })
    const internalUsage = usageEvent(
      internalSubscription,
      internalSummary.id,
      41,
      { internalBillingTest: false }
    )
    const internalInvoice = overageInvoice(
      internalSubscription,
      internalSummary.id,
      [internalUsage.id],
      { internalBillingTest: false }
    )
    const snapshot = buildAdminBillingSnapshot(
      source({
        billingPeriodSummaries: [
          billingPeriodSummarySchema.parse({
            ...internalSummary,
            invoiceIds: [internalInvoice.id],
            usageEventIds: [internalUsage.id]
          })
        ],
        networkOverageInvoices: [internalInvoice],
        networkUsageEvents: [internalUsage],
        organizationBillingAccounts: [
          activeBillingAccount(internalSubscription)
        ],
        organizationSubscriptions: [internalSubscription],
        subscriptionBaseInvoices: [
          baseInvoice(internalSubscription, { internalBillingTest: false })
        ]
      }),
      NOW
    )

    expect(snapshot).toMatchObject({
      commercialSubscriptionCount: 0,
      internalTestCount: 1,
      metrics: {
        activeArrLabel: "$0.00",
        activeMrrLabel: "$0.00",
        activeSubscriptionCount: 0
      },
      operations: {
        completedNetworkUnitCount: 0,
        paidBaseRevenueLabel: "$0.00",
        paidOverageRevenueLabel: "$0.00",
        totalSubscriptionRevenueLabel: "$0.00"
      }
    })
    expect(snapshot.accounts).toEqual([])
    expect(snapshot.invoices).toEqual([])
    expect(snapshot.periodSummaries).toEqual([])
    expect(snapshot.subscriptions).toEqual([])
    expect(snapshot.usageLedger).toEqual([])
  })

  it("excludes independently flagged commercial-coded child fixtures from rows and metrics", () => {
    const commercialSubscription = subscription("network_25")
    const internalSummary = usageSummary(commercialSubscription, 26, {
      internalBillingTest: true
    })
    const internalUsage = usageEvent(
      commercialSubscription,
      internalSummary.id,
      42,
      { internalBillingTest: true }
    )
    const internalInvoice = overageInvoice(
      commercialSubscription,
      internalSummary.id,
      [internalUsage.id],
      { internalBillingTest: true }
    )
    const snapshot = buildAdminBillingSnapshot(
      source({
        billingPeriodSummaries: [
          billingPeriodSummarySchema.parse({
            ...internalSummary,
            invoiceIds: [internalInvoice.id],
            usageEventIds: [internalUsage.id]
          })
        ],
        networkOverageInvoices: [internalInvoice],
        networkUsageEvents: [internalUsage],
        organizationBillingAccounts: [
          activeBillingAccount(commercialSubscription)
        ],
        organizationSubscriptions: [commercialSubscription],
        subscriptionBaseInvoices: [
          baseInvoice(commercialSubscription, {
            internalBillingTest: true
          })
        ]
      }),
      NOW
    )

    expect(snapshot).toMatchObject({
      commercialSubscriptionCount: 1,
      internalTestCount: 0,
      metrics: {
        activeMrrLabel: "$3,000.00",
        activeSubscriptionCount: 1
      },
      operations: {
        completedNetworkUnitCount: 0,
        paidBaseRevenueLabel: "$0.00",
        paidOverageRevenueLabel: "$0.00",
        totalSubscriptionRevenueLabel: "$0.00"
      }
    })
    expect(snapshot.invoices).toEqual([])
    expect(snapshot.periodSummaries).toEqual([])
    expect(snapshot.usageLedger).toEqual([])
    expect(snapshot.subscriptions[0]?.usage).toMatchObject({
      stateLabel: "Usage period not initialized",
      usedUnits: null
    })
  })

  it("excludes the internal smoke subscription and keeps legacy obligations isolated", () => {
    const feeEvent = legacyFeeEvent()
    const legacyHostInvoice = legacyInvoice()
    feeEvent.invoiceId = legacyHostInvoice.id
    feeEvent.status = "invoiced"
    legacyHostInvoice.feeEventIds = [feeEvent.id]
    const internalSubscription = subscription("internal_billing_test")
    const internalSummaryId = billingPeriodSummaryId(
      internalSubscription.id,
      PERIOD_START
    )
    const internalUsage = usageEvent(
      internalSubscription,
      internalSummaryId,
      40,
      {
        invoiceId: networkOverageInvoiceId(internalSummaryId),
        status: "invoiced"
      }
    )
    const internalInvoice = overageInvoice(
      internalSubscription,
      internalSummaryId,
      [internalUsage.id]
    )
    const internalSummary = usageSummary(internalSubscription, 1, {
      invoiceIds: [internalInvoice.id],
      status: "invoicing",
      usageEventIds: [internalUsage.id]
    })
    const internalAdjustment = billingAdjustmentSchema.parse({
      actorUserId: ACCEPTED_BY,
      amountDeltaCents: -100,
      billingPeriodSummaryId: internalSummary.id,
      createdAt: PERIOD_START,
      id: "84000000-0000-4000-8000-000000000001",
      invoiceId: internalInvoice.id,
      organizationId: ORGANIZATION_ID,
      reason: "Internal smoke credit",
      type: "service_credit",
      unitDelta: 0,
      usageEventId: null
    })
    const snapshot = buildAdminBillingSnapshot(
      source({
        assignments: [
          legacyAssignment(),
          networkAssignment(internalSubscription)
        ],
        billingAdjustments: [internalAdjustment],
        billingPeriodSummaries: [internalSummary],
        entitlements: [legacyEntitlement()],
        hostInvoices: [legacyHostInvoice],
        networkOverageInvoices: [internalInvoice],
        networkUsageEvents: [internalUsage],
        organizationBillingAccounts: [
          legacyBillingAccount(),
          activeBillingAccount(internalSubscription, {
            id: "85000000-0000-4000-8000-000000000001"
          })
        ],
        organizationSubscriptions: [internalSubscription],
        platformFeeEvents: [feeEvent],
        subscriptionBaseInvoices: [baseInvoice(internalSubscription)]
      }),
      NOW
    )

    expect(snapshot).toMatchObject({
      commercialSubscriptionCount: 0,
      internalTestCount: 1,
      metrics: {
        activeArrLabel: "$0.00",
        activeMrrLabel: "$0.00",
        activeSubscriptionCount: 0,
        billingFailureCount: 0
      },
      planMix: [],
      subscriptions: []
    })
    expect(snapshot.accounts).toHaveLength(1)
    expect(snapshot.accounts[0]?.billingModelLabel).toBe("Legacy percentage")
    expect(snapshot.adjustments).toEqual([])
    expect(snapshot.invoices).toEqual([])
    expect(snapshot.periodSummaries).toEqual([])
    expect(snapshot.usageLedger).toEqual([])
    expect(snapshot.operations).toMatchObject({
      allowanceUtilizationLabel: "0 of 0 included units (not enough data)",
      completedNetworkUnitCount: 0,
      networkMovementCount: 0,
      overageFrequencyLabel: "0 of 0 allowance periods (not enough data)",
      paidBaseRevenueLabel: "$0.00",
      paidOverageRevenueLabel: "$0.00",
      privateMovementCount: 1,
      revenuePerCompletedNetworkLoadLabel: "Not enough data",
      totalSubscriptionRevenueLabel: "$0.00"
    })
    expect(snapshot.platformFeeLedger).toMatchObject({
      currentAccruedFeeLabel: "$0.00",
      currentAssignmentCount: 0,
      currentFeeEventCount: 0,
      currentInvoiceCount: 0,
      currentOrganizationCount: 0,
      currentOutstandingInvoiceLabel: "$0.00",
      entitlementCount: 1,
      legacyAccruedFeeLabel: "$0.00",
      legacyAssignmentCount: 1,
      legacyFeeEventCount: 1,
      legacyInvoiceCount: 1,
      legacyOrganizationCount: 1,
      legacyOutstandingInvoiceLabel: "$25.00"
    })
    expect(snapshot.platformFeeLedger.entitlementExceptions).toHaveLength(1)
    expect(snapshot.platformFeeLedger.entitlementExceptions[0]).toMatchObject({
      organizationName: "Timberline Hauling",
      planLabel: "Fleet Operations",
      status: "past_due"
    })
  })
})
