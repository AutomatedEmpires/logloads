import {
  billingAdjustmentSchema,
  billingPeriodSummaryId,
  billingPeriodSummarySchema,
  LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY,
  networkOverageInvoiceId,
  networkOverageInvoiceSchema,
  networkUsageEventId,
  networkUsageEventSchema,
  subscriptionPlanQuoteFingerprint
} from "@logloads/contracts"
import { seedDatabaseState, type LogLoadsDatabaseState } from "@logloads/db"
import { describe, expect, it } from "vitest"

import {
  acceptDispatchProSubscription,
  activateAuthorizedOrganizationSubscriptionFromProvider,
  activateOrganizationSubscription,
  applyOrganizationSubscriptionPaymentState,
  applyScheduledOrganizationSubscriptionPlanChange,
  authorizePilotConversionSubscription,
  bindBillingAdjustmentProviderReference,
  bindOrganizationSubscriptionProvider,
  claimBillingNotificationEmail,
  configureOrganizationSubscription,
  ensureBillingPeriodSummary,
  markNetworkOverageInvoiceFailed,
  markNetworkOverageInvoicePaid,
  markBillingNotificationEmailDelivered,
  markBillingNotificationEmailFailed,
  openNetworkOverageInvoice,
  planSubscriptionBillingRun,
  reconcileMissingNetworkUsageAsPlatformAdmin,
  recordBillingAdjustment,
  recordBillingAdjustmentProviderSettlement,
  recordBillingAdjustmentProviderSettlementFailure,
  recordCompletedNetworkUsage,
  recordSubscriptionBaseInvoiceProviderState,
  retirePaidDispatchEntitlementForSubscription,
  reverseNetworkUsage,
  resolveAssignmentBillingCommitment,
  scheduleOrganizationSubscriptionNonRenewal,
  scheduleOrganizationSubscriptionPlanChange,
  usageNotificationThresholdsFor
} from "./subscription-billing"
import { provisionLoadCapacity } from "./loads"
import { createLogLoadsServices } from "./index"
import { DomainRefusalError } from "./utils"

const ADMIN = "11111111-1111-4111-8111-111111111111"
const DRIVER = "22222222-2222-4222-8222-222222222221"
const FLEET = "33333333-3333-4333-8333-333333333334"
const FLEET_OWNER = "22222222-2222-4222-8222-222222222227"
const HOST = "33333333-3333-4333-8333-333333333332"
const HOST_LANDING = "66666666-6666-4666-8666-666666666662"
const OTHER_LANDING = "66666666-6666-4666-8666-666666666661"
const OWNER = "22222222-2222-4222-8222-222222222223"
const PRIVATE_PARTNER = "33333333-3333-4333-8333-333333333331"
const UNRELATED_HAULER = "33333333-3333-4333-8333-333333333334"
const ACCEPTED_AT = "2026-07-30T16:00:00.000Z"
const AUTHORIZED_AT = "2026-08-02T16:00:00.000Z"
const PERIOD_START = "2026-08-03T16:00:00.000Z"
const PERIOD_END = "2026-09-03T16:00:00.000Z"
const ENTERPRISE_TERMS = {
  baseMonthlyPriceCents: 2_500_000,
  commitmentMonths: 24,
  definedIntegrations: ["SFTP load manifest", "ERP completion webhook"],
  includedNetworkLoadUnits: 300,
  includesDispatchProCapabilities: true,
  overageUnitPriceCents: 7_500,
  serviceSupportObligations:
    "Named operations contact with weekday response and quarterly workflow review.",
  stripeOveragePriceId: "price_enterpriseoverage001",
  stripePriceId: "price_enterprisebase001",
  stripeProductId: "prod_enterprise001"
}

function freshState(): LogLoadsDatabaseState {
  return structuredClone(seedDatabaseState)
}

function settledOverageProviderFacts(
  invoice: { amountDueCents: number },
  stripeInvoiceId: string
) {
  return {
    providerAmountDueCents: invoice.amountDueCents,
    providerAmountPaidCents: invoice.amountDueCents,
    providerAmountRemainingCents: 0,
    stripeInvoiceId
  }
}

function baseProviderBalanceFacts(
  amountDueCents: number,
  amountRemainingCents = amountDueCents
) {
  return {
    amountPaidCents: amountDueCents - amountRemainingCents
  }
}

function configured(
  state: LogLoadsDatabaseState,
  planCode: "network_pilot" | "network_25" = "network_25"
) {
  const result = configureOrganizationSubscription(
    state,
    {
      acceptedAt: ACCEPTED_AT,
      acceptedByUserId: OWNER,
      acceptedTermsVersion: "subscription-v1-2026-07-28",
      configuredByUserId: ADMIN,
      operatingMarketIds: [HOST_LANDING],
      organizationId: HOST,
      platformAdminAuthorized: true,
      planCode
    },
    ACCEPTED_AT
  )

  return result.subscription
}

function paidAndOperating(
  state: LogLoadsDatabaseState,
  planCode: "network_pilot" | "network_25" = "network_25"
) {
  const subscription = configured(state, planCode)

  activateOrganizationSubscription(
    state,
    {
      actorUserId: ADMIN,
      organizationId: HOST,
      platformAdminAuthorized: true,
      subscriptionId: subscription.id
    },
    AUTHORIZED_AT
  )

  return activateAuthorizedOrganizationSubscriptionFromProvider(
    state,
    {
      currentPeriodEnd: PERIOD_END,
      currentPeriodStart: PERIOD_START,
      providerInvoiceId: "in_firstpaid001",
      stripeCustomerId: "cus_host001",
      stripeSubscriptionId: "sub_host001",
      subscriptionId: subscription.id
    },
    "2026-08-03T16:01:00.000Z"
  ).subscription
}

function paidDispatchAndOperating(state: LogLoadsDatabaseState) {
  const subscription = acceptDispatchProSubscription(
    state,
    {
      acceptedAt: ACCEPTED_AT,
      acceptedByUserId: FLEET_OWNER,
      acceptedTermsVersion: "subscription-v1-2026-07-28",
      organizationId: FLEET
    },
    ACCEPTED_AT
  ).subscription

  activateOrganizationSubscription(
    state,
    {
      actorUserId: FLEET_OWNER,
      organizationId: FLEET,
      subscriptionId: subscription.id
    },
    AUTHORIZED_AT
  )

  return activateAuthorizedOrganizationSubscriptionFromProvider(
    state,
    {
      currentPeriodEnd: PERIOD_END,
      currentPeriodStart: PERIOD_START,
      providerInvoiceId: "in_dispatchfirstpaidself001",
      stripeCustomerId: "cus_dispatchself001",
      stripeSubscriptionId: "sub_dispatchself001",
      subscriptionId: subscription.id
    },
    "2026-08-03T16:01:00.000Z"
  ).subscription
}

function addBlankAssignment(
  state: LogLoadsDatabaseState,
  id: string
): void {
  const template = state.assignments[0]
  const load = state.loadPostings.find(
    (candidate) =>
      candidate.companyId === HOST &&
      candidate.pickupLandingId === HOST_LANDING
  )

  if (!template || !load) throw new Error("Seed assignment or host load missing")
  state.assignments.push({
    ...structuredClone(template),
    assignedAt: null,
    billingCommittedAt: null,
    billingModel: null,
    billingPlanCodeAtCommitment: null,
    billingSubscriptionIdAtCommitment: null,
    capacitySource: null,
    id,
    loadMovementId: id,
    loadPostingId: load.id,
    status: "requested"
  })
}

describe("subscription activation and commercial scope", () => {
  it("requires explicit platform proof while preserving organization billing-manager authority", () => {
    const missingProofState = freshState()
    const missingProofBefore = structuredClone(missingProofState)
    expect(() =>
      configureOrganizationSubscription(
        missingProofState,
        {
          acceptedAt: ACCEPTED_AT,
          acceptedByUserId: OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          configuredByUserId: ADMIN,
          operatingMarketIds: [HOST_LANDING],
          organizationId: HOST,
          planCode: "network_25"
        },
        ACCEPTED_AT
      )
    ).toThrow(/active organization billing managers or active platform admins/)
    expect(missingProofState).toEqual(missingProofBefore)

    const falseProofState = freshState()
    expect(() =>
      configureOrganizationSubscription(
        falseProofState,
        {
          acceptedAt: ACCEPTED_AT,
          acceptedByUserId: OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          configuredByUserId: ADMIN,
          operatingMarketIds: [HOST_LANDING],
          organizationId: HOST,
          platformAdminAuthorized: false,
          planCode: "network_25"
        },
        ACCEPTED_AT
      )
    ).toThrow(/active organization billing managers or active platform admins/)

    const nonAdminState = freshState()
    expect(() =>
      configureOrganizationSubscription(
        nonAdminState,
        {
          acceptedAt: ACCEPTED_AT,
          acceptedByUserId: OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          configuredByUserId: DRIVER,
          operatingMarketIds: [HOST_LANDING],
          organizationId: HOST,
          platformAdminAuthorized: true,
          planCode: "network_25"
        },
        ACCEPTED_AT
      )
    ).toThrow(/active organization billing managers or active platform admins/)

    const managerState = freshState()
    expect(
      configureOrganizationSubscription(
        managerState,
        {
          acceptedAt: ACCEPTED_AT,
          acceptedByUserId: OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          configuredByUserId: OWNER,
          operatingMarketIds: [HOST_LANDING],
          organizationId: HOST,
          planCode: "network_25"
        },
        ACCEPTED_AT
      ).changed
    ).toBe(true)
  })

  it("requires explicit platform proof for global usage reconciliation", () => {
    const state = freshState()
    const before = structuredClone(state)

    expect(() =>
      reconcileMissingNetworkUsageAsPlatformAdmin(
        state,
        { actorUserId: ADMIN, platformAdminAuthorized: false },
        ACCEPTED_AT
      )
    ).toThrow(/Only an active platform admin/)
    expect(state).toEqual(before)
    expect(() =>
      reconcileMissingNetworkUsageAsPlatformAdmin(
        state,
        { actorUserId: OWNER, platformAdminAuthorized: true },
        ACCEPTED_AT
      )
    ).toThrow(/Only an active platform admin/)
    expect(
      reconcileMissingNetworkUsageAsPlatformAdmin(
        state,
        { actorUserId: ADMIN, platformAdminAuthorized: true },
        ACCEPTED_AT
      )
    ).toEqual(expect.any(Array))
  })

  it("accepts offline agreement timestamps but rejects future-dated acceptance", () => {
    const futureState = freshState()
    const before = structuredClone(futureState)
    expect(() =>
      configureOrganizationSubscription(
        futureState,
        {
          acceptedAt: ACCEPTED_AT,
          acceptedByUserId: OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          configuredByUserId: ADMIN,
          operatingMarketIds: [HOST_LANDING],
          organizationId: HOST,
          planCode: "network_25"
        },
        "2026-07-30T15:59:59.999Z"
      )
    ).toThrow(/acceptance cannot be recorded in the future/)
    expect(futureState).toEqual(before)

    const offlineState = freshState()
    const recorded = configureOrganizationSubscription(
      offlineState,
      {
        acceptedAt: ACCEPTED_AT,
        acceptedByUserId: OWNER,
        acceptedTermsVersion: "subscription-v1-2026-07-28",
        configuredByUserId: ADMIN,
        operatingMarketIds: [HOST_LANDING],
        organizationId: HOST,
        platformAdminAuthorized: true,
        planCode: "network_25"
      },
      "2026-07-31T16:00:00.000Z"
    )
    expect(recorded.subscription.acceptedAt).toBe(ACCEPTED_AT)
  })

  it("closes new subscription configuration at cutover but permits an exact historical retry", () => {
    const blockedState = freshState()
    const before = structuredClone(blockedState)

    expect(() =>
      configureOrganizationSubscription(
        blockedState,
        {
          acceptedAt: ACCEPTED_AT,
          acceptedByUserId: OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          configuredByUserId: ADMIN,
          operatingMarketIds: [HOST_LANDING],
          organizationId: HOST,
          platformAdminAuthorized: true,
          planCode: "network_25"
        },
        "2026-08-01T00:00:00.000Z"
      )
    ).toThrow(/closed when percentage_v1 became the current host agreement/)
    expect(blockedState).toEqual(before)

    const historicalState = freshState()
    const existing = configured(historicalState)
    const retry = configureOrganizationSubscription(
      historicalState,
      {
        acceptedAt: ACCEPTED_AT,
        acceptedByUserId: OWNER,
        acceptedTermsVersion: "subscription-v1-2026-07-28",
        configuredByUserId: ADMIN,
        operatingMarketIds: [HOST_LANDING],
        organizationId: HOST,
        platformAdminAuthorized: true,
        planCode: "network_25"
      },
      "2026-08-03T16:00:00.000Z"
    )

    expect(retry.changed).toBe(false)
    expect(retry.subscription.id).toBe(existing.id)
    expect(historicalState.organizationSubscriptions).toHaveLength(1)
  })

  it("requires Pilot scope and anchors its exact 90-day clock to first paid provider period", () => {
    const state = freshState()

    expect(() =>
      configureOrganizationSubscription(
        state,
        {
          acceptedAt: ACCEPTED_AT,
          acceptedByUserId: OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          configuredByUserId: ADMIN,
          organizationId: HOST,
          planCode: "network_pilot"
        },
        ACCEPTED_AT
      )
    ).toThrow(/exactly one accepted operating location|operating location/)

    const subscription = configured(state, "network_pilot")
    const authorized = activateOrganizationSubscription(
      state,
      {
        actorUserId: ADMIN,
        organizationId: HOST,
        platformAdminAuthorized: true,
        subscriptionId: subscription.id
      },
      AUTHORIZED_AT
    )

    expect(authorized.subscription.operationalActivatedAt).toBeNull()
    expect(authorized.account.activationState).toBe("configured_dark")
    expect(() =>
      activateAuthorizedOrganizationSubscriptionFromProvider(
        state,
        {
          currentPeriodEnd: "2026-08-30T16:00:00.000Z",
          currentPeriodStart: "2026-07-30T16:00:00.000Z",
          providerInvoiceId: "in_predatesauth",
          stripeCustomerId: "cus_host001",
          stripeSubscriptionId: "sub_host001",
          subscriptionId: subscription.id
        },
        AUTHORIZED_AT
      )
    ).toThrow(/after explicit activation authorization/)

    const activated = activateAuthorizedOrganizationSubscriptionFromProvider(
      state,
      {
        currentPeriodEnd: PERIOD_END,
        currentPeriodStart: PERIOD_START,
        providerInvoiceId: "in_firstpaid001",
        stripeCustomerId: "cus_host001",
        stripeSubscriptionId: "sub_host001",
        subscriptionId: subscription.id
      },
      "2026-08-03T16:01:00.000Z"
    )

    expect(activated.subscription.operationalActivatedAt).toBe(PERIOD_START)
    expect(activated.subscription.commitmentStart).toBe(PERIOD_START)
    expect(
      Date.parse(activated.subscription.commitmentEnd as string) -
        Date.parse(PERIOD_START)
    ).toBe(90 * 24 * 60 * 60 * 1000)
    expect(activated.account.activationState).toBe("active")
    expect(
      state.entitlements.some(
        (entitlement) =>
          entitlement.organizationId === HOST &&
          entitlement.product === "landing_operations" &&
          !entitlement.stripeSubscriptionId &&
          entitlement.features.includes("dispatch_pro_capabilities")
      )
    ).toBe(true)
    expect(
      state.entitlements.some(
        (entitlement) =>
          entitlement.organizationId === HOST &&
          entitlement.product === "fleet_operations" &&
          !entitlement.stripeSubscriptionId
      )
    ).toBe(false)
    const activationNotice = state.notifications.find(
      (notification) =>
        notification.relatedEntityId === activated.subscription.id &&
        notification.title === "Network Pilot activated"
    )
    expect(activationNotice?.body).toContain(
      "Blue River Landing in Blue River, OR"
    )
    expect(activationNotice?.body).not.toContain(HOST_LANDING)
  })

  it("accepts only active organization-owned landing ids as Network operating locations", () => {
    const wrongOwnerState = freshState()
    expect(() =>
      configureOrganizationSubscription(
        wrongOwnerState,
        {
          acceptedAt: ACCEPTED_AT,
          acceptedByUserId: OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          configuredByUserId: ADMIN,
          operatingMarketIds: [OTHER_LANDING],
          organizationId: HOST,
          planCode: "network_25"
        },
        ACCEPTED_AT
      )
    ).toThrow(/active landing owned by organization/)
    expect(wrongOwnerState.organizationSubscriptions).toHaveLength(0)

    const inactiveState = freshState()
    inactiveState.landings = inactiveState.landings.map((landing) =>
      landing.id === HOST_LANDING ? { ...landing, isActive: false } : landing
    )
    expect(() =>
      configureOrganizationSubscription(
        inactiveState,
        {
          acceptedAt: ACCEPTED_AT,
          acceptedByUserId: OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          configuredByUserId: ADMIN,
          operatingMarketIds: [HOST_LANDING],
          organizationId: HOST,
          planCode: "network_25"
        },
        ACCEPTED_AT
      )
    ).toThrow(/active landing owned by organization/)
    expect(inactiveState.organizationSubscriptions).toHaveLength(0)
  })

  it("cuts a legacy account over at the accepted instant without rewriting frozen work", () => {
    const state = freshState()
    const legacyAssignment = state.assignments.find((assignment) => {
      const load = state.loadPostings.find(
        (candidate) => candidate.id === assignment.loadPostingId
      )

      return load?.companyId === HOST && assignment.billingModel === "legacy_percentage"
    })
    if (!legacyAssignment) throw new Error("Seed legacy assignment missing")
    const legacyBefore = structuredClone(legacyAssignment)
    const configuredSubscription = configured(state)
    const account = state.organizationBillingAccounts.find(
      (candidate) => candidate.organizationId === HOST
    )

    expect(account?.effectiveAt).toBe(ACCEPTED_AT)
    expect(
      resolveAssignmentBillingCommitment(
        state,
        {
          acceptanceSource: "host_approval",
          assignmentId: legacyAssignment.id,
          haulerOrganizationId: UNRELATED_HAULER,
          hostOrganizationId: HOST
        },
        "2026-08-02T12:00:00.000Z"
      ).billingModel
    ).toBe("legacy_percentage")
    expect(
      state.assignments.find(
        (candidate) => candidate.id === legacyAssignment.id
      )
    ).toEqual(legacyBefore)

    const newAssignmentId = "69696969-6969-4969-8969-696969696961"
    addBlankAssignment(state, newAssignmentId)
    expect(() =>
      resolveAssignmentBillingCommitment(
        state,
        {
          acceptanceSource: "host_approval",
          assignmentId: newAssignmentId,
          haulerOrganizationId: UNRELATED_HAULER,
          hostOrganizationId: HOST
        },
        AUTHORIZED_AT
      )
    ).toThrow(/billing agreement is not active/)

    activateOrganizationSubscription(
      state,
      {
        actorUserId: ADMIN,
        organizationId: HOST,
        platformAdminAuthorized: true,
        subscriptionId: configuredSubscription.id
      },
      AUTHORIZED_AT
    )
    activateAuthorizedOrganizationSubscriptionFromProvider(
      state,
      {
        currentPeriodEnd: PERIOD_END,
        currentPeriodStart: PERIOD_START,
        providerInvoiceId: "in_legacycutover001",
        stripeCustomerId: "cus_legacycutover001",
        stripeSubscriptionId: "sub_legacycutover001",
        subscriptionId: configuredSubscription.id
      },
      "2026-08-03T16:01:00.000Z"
    )
    expect(() =>
      resolveAssignmentBillingCommitment(
        state,
        {
          acceptanceSource: "host_approval",
          assignmentId: newAssignmentId,
          haulerOrganizationId: UNRELATED_HAULER,
          hostOrganizationId: HOST
        },
        "2026-08-04T16:00:00.000Z"
      )
    ).toThrow(/Historical subscriptions no longer authorize new work/)
  })

  it("rejects non-USD legacy acceptance without blocking subscription work", () => {
    const state = freshState()
    const account = state.organizationBillingAccounts.find(
      (candidate) => candidate.organizationId === HOST
    )
    if (!account) throw new Error("Seed billing account missing")
    account.activationState = "legacy"
    account.billingModel = "legacy_percentage"
    account.effectiveAt = "2026-07-30T00:00:00.000Z"
    account.percentageTermsSnapshot = null
    const assignmentId = "69696969-6969-4969-8969-696969696962"
    addBlankAssignment(state, assignmentId)
    const assignment = state.assignments.find(
      (candidate) => candidate.id === assignmentId
    )

    if (!assignment) throw new Error("Blank assignment missing")

    assignment.termsSnapshot = {
      ...assignment.termsSnapshot,
      currency: "CAD",
      driverPayCents: 52_500
    }
    const input = {
      acceptanceSource: "host_approval" as const,
      assignmentId,
      haulerOrganizationId: UNRELATED_HAULER,
      hostOrganizationId: HOST
    }

    expect(() =>
      resolveAssignmentBillingCommitment(state, input, "2026-07-31T16:00:00.000Z")
    ).toThrow(DomainRefusalError)
    expect(() =>
      resolveAssignmentBillingCommitment(state, input, "2026-07-31T16:00:00.000Z")
    ).toThrow(
      new RegExp(
        `${LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY}-denominated`
      )
    )

    paidAndOperating(state)

    expect(() =>
      resolveAssignmentBillingCommitment(
        state,
        input,
        "2026-08-04T16:00:00.000Z"
      )
    ).toThrow(/Historical subscriptions no longer authorize new work/)
  })

  it("keeps a missing legacy frozen-pay snapshot as an invariant failure", () => {
    const state = freshState()
    const account = state.organizationBillingAccounts.find(
      (candidate) => candidate.organizationId === HOST
    )
    if (!account) throw new Error("Seed billing account missing")
    account.activationState = "legacy"
    account.billingModel = "legacy_percentage"
    account.effectiveAt = "2026-07-30T00:00:00.000Z"
    account.percentageTermsSnapshot = null
    const assignmentId = "69696969-6969-4969-8969-696969696963"
    addBlankAssignment(state, assignmentId)
    const assignment = state.assignments.find(
      (candidate) => candidate.id === assignmentId
    )

    if (!assignment) throw new Error("Blank assignment missing")

    assignment.termsSnapshot = {
      ...assignment.termsSnapshot,
      currency: LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY
    }
    delete assignment.termsSnapshot.driverPayCents
    const before = structuredClone(state)
    let refusal: unknown

    try {
      resolveAssignmentBillingCommitment(
        state,
        {
          acceptanceSource: "host_approval",
          assignmentId,
          haulerOrganizationId: UNRELATED_HAULER,
          hostOrganizationId: HOST
        },
        "2026-07-31T16:00:00.000Z"
      )
    } catch (error) {
      refusal = error
    }

    expect(refusal).toBeInstanceOf(Error)
    expect(refusal).not.toBeInstanceOf(DomainRefusalError)
    expect((refusal as Error).message).toMatch(/frozen driver pay/)
    expect(state).toEqual(before)
  })

  it("keeps Dispatch Pro fleet-scoped and projects only fleet capabilities", () => {
    const state = freshState()

    expect(() =>
      configureOrganizationSubscription(
        state,
        {
          acceptedAt: ACCEPTED_AT,
          acceptedByUserId: OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          configuredByUserId: ADMIN,
          organizationId: HOST,
          planCode: "dispatch_pro"
        },
        ACCEPTED_AT
      )
    ).toThrow(/carrier and fleet organizations/)
    expect(() =>
      configureOrganizationSubscription(
        state,
        {
          acceptedAt: ACCEPTED_AT,
          acceptedByUserId: FLEET_OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          configuredByUserId: ADMIN,
          operatingMarketIds: [HOST_LANDING],
          organizationId: FLEET,
          planCode: "network_25"
        },
        ACCEPTED_AT
      )
    ).toThrow(/landing-source and destination organizations/)

    const configuredDispatch = configureOrganizationSubscription(
      state,
      {
        acceptedAt: ACCEPTED_AT,
        acceptedByUserId: FLEET_OWNER,
        acceptedTermsVersion: "subscription-v1-2026-07-28",
        configuredByUserId: ADMIN,
        organizationId: FLEET,
        platformAdminAuthorized: true,
        planCode: "dispatch_pro"
      },
      ACCEPTED_AT
    ).subscription
    activateOrganizationSubscription(
      state,
      {
        actorUserId: ADMIN,
        organizationId: FLEET,
        platformAdminAuthorized: true,
        subscriptionId: configuredDispatch.id
      },
      AUTHORIZED_AT
    )
    const activatedDispatch =
      activateAuthorizedOrganizationSubscriptionFromProvider(
        state,
        {
          currentPeriodEnd: PERIOD_END,
          currentPeriodStart: PERIOD_START,
          providerInvoiceId: "in_dispatchfirstpaid001",
          stripeCustomerId: "cus_fleet001",
          stripeSubscriptionId: "sub_fleet001",
          subscriptionId: configuredDispatch.id
        },
        "2026-08-03T16:01:00.000Z"
      ).subscription

    expect(
      state.entitlements.some(
        (entitlement) =>
          entitlement.organizationId === FLEET &&
          entitlement.product === "fleet_operations" &&
          !entitlement.stripeSubscriptionId &&
          entitlement.features.includes("dispatch_pro_capabilities")
      )
    ).toBe(true)
    expect(
      state.entitlements.some(
        (entitlement) =>
          entitlement.organizationId === FLEET &&
          entitlement.product === "landing_operations"
      )
    ).toBe(false)
    expect(() =>
      scheduleOrganizationSubscriptionPlanChange(
        state,
        {
          actorUserId: ADMIN,
          effectiveAt: activatedDispatch.commitmentEnd as string,
          nextOperatingMarketIds: [HOST_LANDING],
          nextPlanCode: "network_25",
          platformAdminAuthorized: true,
          subscriptionId: activatedDispatch.id
        },
        "2026-08-04T16:00:00.000Z"
      )
    ).toThrow(/landing-source and destination organizations/)
  })

  it("lets only an active fleet billing manager self-accept Dispatch Pro", () => {
    const acceptedState = freshState()
    const accepted = acceptDispatchProSubscription(
      acceptedState,
      {
        acceptedAt: ACCEPTED_AT,
        acceptedByUserId: FLEET_OWNER,
        acceptedTermsVersion: "subscription-v1-2026-07-28",
        organizationId: FLEET
      },
      ACCEPTED_AT
    )

    expect(accepted.subscription.planCode).toBe("dispatch_pro")
    expect(accepted.account.activationState).toBe("configured_dark")
    expect(accepted.subscription.operationalActivatedAt).toBeNull()

    const crossOrganizationState = freshState()
    expect(() =>
      acceptDispatchProSubscription(
        crossOrganizationState,
        {
          acceptedAt: ACCEPTED_AT,
          acceptedByUserId: OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          organizationId: FLEET
        },
        ACCEPTED_AT
      )
    ).toThrow(/active billing manager/)
    expect(crossOrganizationState.organizationSubscriptions).toHaveLength(0)

    const driverState = freshState()
    const membershipTemplate = driverState.organizationMemberships.find(
      (membership) => membership.userId === DRIVER
    )
    if (!membershipTemplate) throw new Error("Seed driver membership missing")
    driverState.organizationMemberships.push({
      ...structuredClone(membershipTemplate),
      id: "16161616-1616-4616-8616-161616161699",
      organizationId: FLEET,
      role: "driver"
    })
    expect(() =>
      acceptDispatchProSubscription(
        driverState,
        {
          acceptedAt: ACCEPTED_AT,
          acceptedByUserId: DRIVER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          organizationId: FLEET
        },
        ACCEPTED_AT
      )
    ).toThrow(/active billing manager/)
    expect(driverState.organizationSubscriptions).toHaveLength(0)

    const services = createLogLoadsServices(freshState())
    expect(
      services.acceptDispatchProSubscription(
        {
          acceptedAt: ACCEPTED_AT,
          acceptedByUserId: FLEET_OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          organizationId: FLEET
        },
        ACCEPTED_AT
      ).subscription.planCode
    ).toBe("dispatch_pro")
  })

  it("does not let a historical Dispatch subscription publish after percentage cutover", () => {
    const state = freshState()
    paidDispatchAndOperating(state)
    const template = state.loadPostings.find(
      (candidate) => candidate.companyId === HOST
    )
    if (!template) throw new Error("Seed host load missing")
    const load = {
      ...structuredClone(template),
      companyId: FLEET,
      id: "68686868-6868-4868-8868-686868686861"
    }
    state.loadPostings.push(load)
    const capacityCount = state.opportunityCapacities.length
    const slotCount = state.truckSlots.length

    expect(() =>
      provisionLoadCapacity(
        state,
        load,
        "open_network",
        "request_approval",
        "2026-08-04T16:00:00.000Z"
      )
    ).toThrow(/current LogLoads fee agreement/)
    expect(state.opportunityCapacities).toHaveLength(capacityCount)
    expect(state.truckSlots).toHaveLength(slotCount)

    expect(() =>
      provisionLoadCapacity(
        state,
        load,
        "private_network",
        "request_approval",
        "2026-08-04T16:00:00.000Z"
      )
    ).toThrow(/current LogLoads fee agreement/)
    expect(state.opportunityCapacities).toHaveLength(capacityCount)
    expect(state.truckSlots).toHaveLength(slotCount)
  })

  it("blocks every included-Dispatch plan until a paid fleet entitlement is retired", () => {
    const state = freshState()
    const template = state.entitlements[0]

    if (!template) throw new Error("Seed entitlement missing")
    state.entitlements.push({
      ...structuredClone(template),
      id: "28282828-2828-4828-8828-282828282899",
      organizationId: FLEET,
      product: "fleet_operations",
      status: "active",
      stripeCustomerId: "cus_legacyfleet001",
      stripeSubscriptionId: "sub_legacyfleet001"
    })

    expect(() =>
      configureOrganizationSubscription(
        state,
        {
          acceptedAt: ACCEPTED_AT,
          acceptedByUserId: FLEET_OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          configuredByUserId: ADMIN,
          organizationId: FLEET,
          planCode: "dispatch_pro"
        },
        ACCEPTED_AT
      )
    ).toThrow(/independently billed Dispatch Pro entitlement/)

    const retired = retirePaidDispatchEntitlementForSubscription(
      state,
      {
        actorUserId: ADMIN,
        entitlementId: "28282828-2828-4828-8828-282828282899",
        organizationId: FLEET,
        platformAdminAuthorized: true,
        providerCancellationReference: "sub_legacyfleet001:cancelled"
      },
      ACCEPTED_AT
    )
    const configuredDispatch = configureOrganizationSubscription(
      state,
      {
        acceptedAt: ACCEPTED_AT,
        acceptedByUserId: FLEET_OWNER,
        acceptedTermsVersion: "subscription-v1-2026-07-28",
        configuredByUserId: ADMIN,
        organizationId: FLEET,
        platformAdminAuthorized: true,
        planCode: "dispatch_pro"
      },
      ACCEPTED_AT
    )

    expect(retired.entitlement.status).toBe("cancelled")
    expect(configuredDispatch.subscription.planCode).toBe("dispatch_pro")
  })

  it("refuses new subscription capacity commitments after percentage cutover", () => {
    const state = freshState()
    paidAndOperating(state)
    const assignmentId = "79797979-7979-4979-8979-797979797971"

    addBlankAssignment(state, assignmentId)
    expect(() =>
      resolveAssignmentBillingCommitment(
        state,
        {
          acceptanceSource: "direct_offer",
          assignmentId,
          haulerOrganizationId: PRIVATE_PARTNER,
          hostOrganizationId: HOST
        },
        "2026-08-04T16:00:00.000Z"
      )
    ).toThrow(/Historical subscriptions no longer authorize new work/)
  })

  it("persists the exact accepted non-renewal boundary and makes exact retries idempotent", () => {
    const state = freshState()
    const subscription = paidAndOperating(state)
    const commitmentEnd = subscription.commitmentEnd as string
    const effectiveAt = new Date(
      Date.parse(commitmentEnd) + 31 * 24 * 60 * 60 * 1000
    ).toISOString()

    expect(() =>
      scheduleOrganizationSubscriptionNonRenewal(
        state,
        {
          actorUserId: ADMIN,
          effectiveAt: new Date(
            Date.parse(commitmentEnd) - 1
          ).toISOString(),
          platformAdminAuthorized: true,
          subscriptionId: subscription.id
        },
        "2026-08-04T16:00:00.000Z"
      )
    ).toThrow(/cannot take effect before the frozen commitment ends/)
    expect(() =>
      scheduleOrganizationSubscriptionNonRenewal(
        state,
        {
          actorUserId: ADMIN,
          effectiveAt: new Date(
            Date.parse(commitmentEnd) + 15 * 24 * 60 * 60 * 1000
          ).toISOString(),
          platformAdminAuthorized: true,
          subscriptionId: subscription.id
        },
        "2026-08-04T16:00:00.000Z"
      )
    ).toThrow(/actual subscription renewal boundary/)

    const scheduled = scheduleOrganizationSubscriptionNonRenewal(
      state,
      {
        actorUserId: ADMIN,
        effectiveAt,
        platformAdminAuthorized: true,
        subscriptionId: subscription.id
      },
      "2026-08-04T16:00:00.000Z"
    )
    const retried = scheduleOrganizationSubscriptionNonRenewal(
      state,
      {
        actorUserId: ADMIN,
        effectiveAt,
        platformAdminAuthorized: true,
        subscriptionId: subscription.id
      },
      "2026-08-04T16:01:00.000Z"
    )

    expect(scheduled.changed).toBe(true)
    expect(scheduled.subscription.nonRenewalEffectiveAt).toBe(effectiveAt)
    expect(retried.changed).toBe(false)
    expect(retried.subscription.nonRenewalEffectiveAt).toBe(effectiveAt)
  })

  it("freezes complete Enterprise terms and accepts plan changes only on renewal boundaries", () => {
    const invalidState = freshState()
    expect(() =>
      configureOrganizationSubscription(
        invalidState,
        {
          acceptedAt: ACCEPTED_AT,
          acceptedByUserId: OWNER,
          acceptedTermsVersion: "enterprise-2026-07-28",
          configuredByUserId: ADMIN,
          negotiatedTerms: {
            ...ENTERPRISE_TERMS,
            commitmentMonths: 11
          },
          operatingMarketIds: [HOST_LANDING],
          organizationId: HOST,
          planCode: "enterprise_250_plus"
        },
        ACCEPTED_AT
      )
    ).toThrow(/greater than or equal to 12/)
    expect(invalidState.organizationSubscriptions).toHaveLength(0)

    const enterpriseState = freshState()
    const first = configureOrganizationSubscription(
      enterpriseState,
      {
        acceptedAt: ACCEPTED_AT,
        acceptedByUserId: OWNER,
        acceptedTermsVersion: "enterprise-2026-07-28",
        configuredByUserId: ADMIN,
        negotiatedTerms: ENTERPRISE_TERMS,
        operatingMarketIds: [HOST_LANDING],
        organizationId: HOST,
        platformAdminAuthorized: true,
        planCode: "enterprise_250_plus"
      },
      ACCEPTED_AT
    )
    const retry = configureOrganizationSubscription(
      enterpriseState,
      {
        acceptedAt: ACCEPTED_AT,
        acceptedByUserId: OWNER,
        acceptedTermsVersion: "enterprise-2026-07-28",
        configuredByUserId: ADMIN,
        negotiatedTerms: ENTERPRISE_TERMS,
        operatingMarketIds: [HOST_LANDING],
        organizationId: HOST,
        platformAdminAuthorized: true,
        planCode: "enterprise_250_plus"
      },
      "2026-08-01T16:01:00.000Z"
    )

    expect(first.subscription.planSnapshot.commitmentMonths).toBe(24)
    expect(first.subscription.customTerms).toEqual({
      commitmentMonths: 24,
      definedIntegrations: ENTERPRISE_TERMS.definedIntegrations,
      negotiated: true,
      serviceSupportObligations:
        ENTERPRISE_TERMS.serviceSupportObligations
    })
    expect(retry.changed).toBe(false)
    expect(
      JSON.stringify(
        enterpriseState.auditEvents.find(
          (event) =>
            event.action === "organization_subscription_configured_dark" &&
            event.entityId === first.subscription.id
        )?.metadata
      )
    ).not.toContain(ENTERPRISE_TERMS.serviceSupportObligations)
    activateOrganizationSubscription(
      enterpriseState,
      {
        actorUserId: ADMIN,
        organizationId: HOST,
        platformAdminAuthorized: true,
        subscriptionId: first.subscription.id
      },
      AUTHORIZED_AT
    )
    const activatedEnterprise =
      activateAuthorizedOrganizationSubscriptionFromProvider(
        enterpriseState,
        {
          currentPeriodEnd: PERIOD_END,
          currentPeriodStart: PERIOD_START,
          providerInvoiceId: "in_enterprisefirstpaid001",
          stripeCustomerId: "cus_enterprise001",
          stripeSubscriptionId: "sub_enterprise001",
          subscriptionId: first.subscription.id
        },
        "2026-08-03T16:01:00.000Z"
      ).subscription
    expect(activatedEnterprise.commitmentEnd).toBe(
      "2028-08-03T16:00:00.000Z"
    )
    const renewedEnterprise = bindOrganizationSubscriptionProvider(
      enterpriseState,
      {
        currentPeriodEnd: "2028-09-03T16:00:00.000Z",
        currentPeriodStart: activatedEnterprise.commitmentEnd as string,
        paymentState: "current",
        status: "active",
        stripeCustomerId: "cus_enterprise001",
        stripeSubscriptionId: "sub_enterprise001",
        subscriptionId: activatedEnterprise.id
      },
      activatedEnterprise.commitmentEnd as string
    ).subscription
    expect(renewedEnterprise.commitmentEnd).toBe(
      "2030-08-03T16:00:00.000Z"
    )

    const scheduleState = freshState()
    const subscription = paidAndOperating(scheduleState)
    const commitmentEnd = subscription.commitmentEnd as string
    expect(() =>
      scheduleOrganizationSubscriptionPlanChange(
        scheduleState,
        {
          actorUserId: ADMIN,
          effectiveAt: new Date(
            Date.parse(commitmentEnd) + 15 * 24 * 60 * 60 * 1000
          ).toISOString(),
          negotiatedTerms: ENTERPRISE_TERMS,
          nextOperatingMarketIds: [HOST_LANDING],
          nextPlanCode: "enterprise_250_plus",
          platformAdminAuthorized: true,
          subscriptionId: subscription.id
        },
        "2026-08-04T16:00:00.000Z"
      )
    ).toThrow(/actual subscription renewal boundary/)

    const boundary = "2027-09-03T16:00:00.000Z"
    const scheduled = scheduleOrganizationSubscriptionPlanChange(
      scheduleState,
      {
        actorUserId: ADMIN,
        effectiveAt: boundary,
        negotiatedTerms: ENTERPRISE_TERMS,
        nextOperatingMarketIds: [HOST_LANDING],
        nextPlanCode: "enterprise_250_plus",
        platformAdminAuthorized: true,
        subscriptionId: subscription.id
      },
      "2026-08-04T16:00:00.000Z"
    )
    expect(scheduled.subscription.pendingPlanSnapshot?.commitmentMonths).toBe(24)
    expect(scheduled.subscription.pendingCustomTerms).toEqual(
      first.subscription.customTerms
    )
    const applied = applyScheduledOrganizationSubscriptionPlanChange(
      scheduleState,
      {
        currentPeriodEnd: "2027-10-03T16:00:00.000Z",
        currentPeriodStart: boundary,
        expectedPlanCode: "enterprise_250_plus",
        subscriptionId: subscription.id
      },
      boundary
    )
    expect(applied.subscription.customTerms).toEqual(
      first.subscription.customTerms
    )
    expect(applied.subscription.commitmentEnd).toBe(
      "2029-09-03T16:00:00.000Z"
    )
  })

  it("records one usage unit when a released assignment is replaced on the same movement", () => {
    const state = freshState()
    const subscription = paidAndOperating(state)
    const template = state.assignments[0]
    const tripTemplate = state.tripsV2[0]
    const load = state.loadPostings.find(
      (candidate) => candidate.companyId === HOST
    )
    if (!template || !tripTemplate || !load) {
      throw new Error("Seed operating fixture missing")
    }
    const movementId = "74747474-7474-4474-8474-747474747471"
    const cancelledId = "74747474-7474-4474-8474-747474747472"
    const replacementId = "74747474-7474-4474-8474-747474747473"
    const frozen = {
      billingCommittedAt: "2026-08-04T15:00:00.000Z",
      billingModel: "subscription_v1" as const,
      billingPlanCodeAtCommitment: "network_25" as const,
      billingSubscriptionIdAtCommitment: subscription.id,
      capacitySource: "logloads_network" as const,
      loadMovementId: movementId,
      loadPostingId: load.id
    }

    state.assignments.push(
      {
        ...structuredClone(template),
        ...frozen,
        cancelledAt: "2026-08-04T15:30:00.000Z",
        id: cancelledId,
        status: "cancelled"
      },
      {
        ...structuredClone(template),
        ...frozen,
        assignedAt: "2026-08-04T16:00:00.000Z",
        cancelledAt: null,
        completedAt: "2026-08-04T20:00:00.000Z",
        id: replacementId,
        status: "completed"
      }
    )
    state.tripsV2.push({
      ...structuredClone(tripTemplate),
      assignmentId: replacementId,
      completedAt: "2026-08-04T20:00:00.000Z",
      completionConfirmedAt: "2026-08-04T20:05:00.000Z",
      completionConfirmedByUserId: OWNER,
      completionStatus: "confirmed",
      id: "74747474-7474-4474-8474-747474747474",
      loadPostingId: load.id,
      status: "completed"
    })

    const first = recordCompletedNetworkUsage(
      state,
      { assignmentId: replacementId },
      "2026-08-04T20:06:00.000Z"
    )
    const retry = recordCompletedNetworkUsage(
      state,
      { assignmentId: replacementId },
      "2026-08-04T20:07:00.000Z"
    )

    expect(first.outcome).toBe("recorded")
    expect(retry.outcome).toBe("already_recorded")
    expect(
      state.networkUsageEvents.filter(
        (event) => event.loadMovementId === movementId
      )
    ).toHaveLength(1)
    expect(
      state.platformFeeEvents.filter(
        (event) =>
          event.assignmentId === cancelledId ||
          event.assignmentId === replacementId
      )
    ).toHaveLength(0)

    const corruptions: Array<
      [string, (draft: LogLoadsDatabaseState) => void]
    > = [
      [
        "organization",
        (draft) => {
          const event = draft.networkUsageEvents[0]
          if (!event) throw new Error("Usage event missing")
          event.organizationId = FLEET
        }
      ],
      [
        "assignment",
        (draft) => {
          const event = draft.networkUsageEvents[0]
          if (!event) throw new Error("Usage event missing")
          event.assignmentId = cancelledId
        }
      ],
      [
        "load movement",
        (draft) => {
          const event = draft.networkUsageEvents[0]
          if (!event) throw new Error("Usage event missing")
          event.loadMovementId = cancelledId
        }
      ],
      [
        "subscription",
        (draft) => {
          const summary = draft.billingPeriodSummaries[0]
          if (!summary) throw new Error("Billing summary missing")
          summary.subscriptionId = "74747474-7474-4474-8474-747474747499"
        }
      ],
      [
        "plan",
        (draft) => {
          const event = draft.networkUsageEvents[0]
          if (!event) throw new Error("Usage event missing")
          event.planCode = "network_50"
        }
      ],
      [
        "billing model",
        (draft) => {
          const event = draft.networkUsageEvents[0]
          if (!event) throw new Error("Usage event missing")
          event.billingModel = "enterprise_custom"
        }
      ],
      [
        "internal fixture",
        (draft) => {
          const event = draft.networkUsageEvents[0]
          if (!event) throw new Error("Usage event missing")
          event.internalBillingTest = true
        }
      ],
      [
        "summary ownership",
        (draft) => {
          const summary = draft.billingPeriodSummaries[0]
          if (!summary) throw new Error("Billing summary missing")
          summary.organizationId = FLEET
        }
      ]
    ]

    for (const [label, corrupt] of corruptions) {
      const corrupted = structuredClone(state)
      corrupt(corrupted)
      const beforeRetry = structuredClone(corrupted)

      expect(
        () =>
          recordCompletedNetworkUsage(
            corrupted,
            { assignmentId: replacementId },
            "2026-08-04T20:08:00.000Z"
          ),
        label
      ).toThrow(/Usage event cross-wire/)
      expect(corrupted, label).toEqual(beforeRetry)
    }
  })

  it("does not create a new subscription allowance commitment after cutover", () => {
    const state = freshState()
    const subscription = paidAndOperating(state)
    const boundary = subscription.commitmentEnd as string
    const acceptedAt = new Date(Date.parse(boundary) - 1).toISOString()
    const priorPeriodStart = new Date(
      Date.parse(boundary) - 30 * 24 * 60 * 60 * 1000
    ).toISOString()
    bindOrganizationSubscriptionProvider(
      state,
      {
        currentPeriodEnd: boundary,
        currentPeriodStart: priorPeriodStart,
        paymentState: "current",
        status: "active",
        stripeCustomerId: subscription.stripeCustomerId as string,
        stripeSubscriptionId: subscription.stripeSubscriptionId as string,
        subscriptionId: subscription.id
      },
      priorPeriodStart
    )
    const historicalSummary = state.billingPeriodSummaries.find(
      (summary) =>
        summary.subscriptionId === subscription.id &&
        summary.planCode === "network_25" &&
        summary.periodStart === priorPeriodStart
    )
    if (!historicalSummary) {
      throw new Error("Historical Network 25 summary missing")
    }

    const assignmentId = "95959595-9595-4595-8595-959595959501"
    addBlankAssignment(state, assignmentId)
    expect(() =>
      resolveAssignmentBillingCommitment(
        state,
        {
          acceptanceSource: "host_approval",
          assignmentId,
          haulerOrganizationId: UNRELATED_HAULER,
          hostOrganizationId: HOST
        },
        acceptedAt
      )
    ).toThrow(/Historical subscriptions no longer authorize new work/)
  })
})

describe("dunning and Pilot conversion boundaries", () => {
  it("emits every crossed overage milestone deterministically across a jump", () => {
    const thresholds = usageNotificationThresholdsFor(
      48,
      25,
      10,
      ["70"]
    )

    expect(thresholds).toEqual([
      "70",
      "90",
      "100",
      "overage",
      "overage_10",
      "overage_20"
    ])
    expect(
      usageNotificationThresholdsFor(48, 25, 10, thresholds)
    ).toEqual(thresholds)
  })

  it("renews an automatic commitment exactly once before failed-payment grace is applied", () => {
    const state = freshState()
    const subscription = paidAndOperating(state)
    const boundary = subscription.commitmentEnd as string
    const providerFacts = {
      currentPeriodEnd: "2027-09-03T16:00:00.000Z",
      currentPeriodStart: boundary,
      paymentState: "failed" as const,
      status: "past_due" as const,
      stripeCustomerId: "cus_host001",
      stripeSubscriptionId: "sub_host001",
      subscriptionId: subscription.id
    }
    const first = bindOrganizationSubscriptionProvider(
      state,
      providerFacts,
      boundary
    )
    const retry = bindOrganizationSubscriptionProvider(
      state,
      providerFacts,
      "2027-08-03T16:01:00.000Z"
    )

    expect(first.subscription.commitmentStart).toBe(boundary)
    expect(first.subscription.commitmentEnd).toBe(
      "2028-08-03T16:00:00.000Z"
    )
    expect(retry.changed).toBe(false)
    expect(
      state.auditEvents.filter(
        (event) =>
          event.action ===
          "organization_subscription_commitment_renewed_from_provider_period"
      )
    ).toHaveLength(1)

    const grace = applyOrganizationSubscriptionPaymentState(
      state,
      {
        paymentState: "past_due",
        status: "past_due",
        subscriptionId: subscription.id
      },
      boundary
    ).subscription
    expect(grace.graceState).toBe("active")
    expect(grace.paymentGraceEndsAt).toBe(
      "2027-08-10T16:00:00.000Z"
    )

    const assignmentId = "71717171-7171-4171-8171-717171717171"
    addBlankAssignment(state, assignmentId)
    expect(() =>
      resolveAssignmentBillingCommitment(
        state,
        {
          acceptanceSource: "host_approval",
          assignmentId,
          haulerOrganizationId: UNRELATED_HAULER,
          hostOrganizationId: HOST
        },
        "2027-08-03T16:00:01.000Z"
      )
    ).toThrow(/Historical subscriptions no longer authorize new work/)
  })

  it("rejects a late automatic renewal boundary and does not roll pending or non-renewing terms", () => {
    const lateState = freshState()
    const lateSubscription = paidAndOperating(lateState)
    const boundary = lateSubscription.commitmentEnd as string
    const lateStart = new Date(Date.parse(boundary) + 1).toISOString()

    expect(() =>
      bindOrganizationSubscriptionProvider(
        lateState,
        {
          currentPeriodEnd: "2027-09-03T16:00:00.001Z",
          currentPeriodStart: lateStart,
          paymentState: "current",
          status: "active",
          stripeCustomerId: "cus_host001",
          stripeSubscriptionId: "sub_host001",
          subscriptionId: lateSubscription.id
        },
        lateStart
      )
    ).toThrow(/begin exactly at the canonical commitment boundary/)
    expect(
      lateState.organizationSubscriptions.find(
        (candidate) => candidate.id === lateSubscription.id
      )?.commitmentEnd
    ).toBe(boundary)

    const pendingState = freshState()
    const pendingSubscription = paidAndOperating(pendingState)
    scheduleOrganizationSubscriptionPlanChange(
      pendingState,
      {
        actorUserId: ADMIN,
        effectiveAt: pendingSubscription.commitmentEnd as string,
        nextOperatingMarketIds: [HOST_LANDING],
        nextPlanCode: "network_50",
        platformAdminAuthorized: true,
        subscriptionId: pendingSubscription.id
      },
      "2026-08-04T16:00:00.000Z"
    )
    const pendingBound = bindOrganizationSubscriptionProvider(
      pendingState,
      {
        currentPeriodEnd: "2027-09-03T16:00:00.000Z",
        currentPeriodStart: pendingSubscription.commitmentEnd as string,
        paymentState: "current",
        status: "active",
        stripeCustomerId: "cus_host001",
        stripeSubscriptionId: "sub_host001",
        subscriptionId: pendingSubscription.id
      },
      pendingSubscription.commitmentEnd as string
    )
    expect(pendingBound.subscription.commitmentEnd).toBe(
      pendingSubscription.commitmentEnd
    )

    const nonRenewingState = freshState()
    const nonRenewingSubscription = paidAndOperating(nonRenewingState)
    scheduleOrganizationSubscriptionNonRenewal(
      nonRenewingState,
      {
        actorUserId: ADMIN,
        effectiveAt: nonRenewingSubscription.commitmentEnd as string,
        platformAdminAuthorized: true,
        subscriptionId: nonRenewingSubscription.id
      },
      "2026-08-04T16:00:00.000Z"
    )
    const nonRenewingBound = bindOrganizationSubscriptionProvider(
      nonRenewingState,
      {
        currentPeriodEnd: "2027-09-03T16:00:00.000Z",
        currentPeriodStart: nonRenewingSubscription.commitmentEnd as string,
        paymentState: "current",
        status: "non_renewing",
        stripeCustomerId: "cus_host001",
        stripeSubscriptionId: "sub_host001",
        subscriptionId: nonRenewingSubscription.id
      },
      nonRenewingSubscription.commitmentEnd as string
    )
    expect(nonRenewingBound.subscription.commitmentEnd).toBe(
      nonRenewingSubscription.commitmentEnd
    )
  })

  it("does not extend payment grace, expires at the exact boundary, and recovers", () => {
    const state = freshState()
    const subscription = paidAndOperating(state)
    const failedAt = "2026-08-10T16:00:00.000Z"
    const first = applyOrganizationSubscriptionPaymentState(
      state,
      {
        paymentState: "past_due",
        status: "past_due",
        subscriptionId: subscription.id
      },
      failedAt
    ).subscription

    expect(first.paymentGraceEndsAt).toBe("2026-08-17T16:00:00.000Z")
    expect(first.graceState).toBe("active")
    const retried = applyOrganizationSubscriptionPaymentState(
      state,
      {
        paymentState: "failed",
        status: "past_due",
        subscriptionId: subscription.id
      },
      "2026-08-12T16:00:00.000Z"
    ).subscription
    expect(retried.paymentGraceEndsAt).toBe(first.paymentGraceEndsAt)

    const run = planSubscriptionBillingRun(
      state,
      "2026-08-17T16:00:00.000Z"
    )
    expect(run.paymentGraceExpiredSubscriptionIds).toEqual([subscription.id])
    expect(
      state.organizationSubscriptions.find(
        (candidate) => candidate.id === subscription.id
      )?.graceState
    ).toBe("expired")
    expect(
      state.organizationBillingAccounts.find(
        (candidate) => candidate.subscriptionId === subscription.id
      )?.activationState
    ).toBe("suspended")

    const recovered = applyOrganizationSubscriptionPaymentState(
      state,
      {
        paymentState: "current",
        status: "active",
        subscriptionId: subscription.id
      },
      "2026-08-18T16:00:00.000Z"
    ).subscription
    expect(recovered.graceState).toBe("none")
    expect(recovered.paymentGraceEndsAt).toBeNull()
  })

  it("does not revive historical Dispatch publishing through payment recovery", () => {
    const state = freshState()
    const subscription = paidDispatchAndOperating(state)
    const loadTemplate = state.loadPostings.find(
      (candidate) => candidate.companyId === HOST
    )
    const assignmentTemplate = state.assignments[0]
    if (!loadTemplate || !assignmentTemplate) {
      throw new Error("Seed Dispatch dunning fixtures missing")
    }
    const load = {
      ...structuredClone(loadTemplate),
      companyId: FLEET,
      id: "94949494-9494-4494-8494-949494949401"
    }
    state.loadPostings.push(load)
    expect(() =>
      provisionLoadCapacity(
        state,
        load,
        "private_network",
        "request_approval",
        "2026-08-04T16:00:00.000Z"
      )
    ).toThrow(/current LogLoads fee agreement/)
    expect(subscription.status).toBe("active")
  })

  it("fails closed before Pilot-expiry or payment-state mutation on account cross-wires", () => {
    const paymentState = freshState()
    const subscription = paidAndOperating(paymentState)
    const paymentAccount = paymentState.organizationBillingAccounts.find(
      (account) => account.subscriptionId === subscription.id
    )
    if (!paymentAccount) throw new Error("Subscription account missing")
    paymentAccount.organizationId = FLEET
    const paymentSubscriptionBefore = structuredClone(
      paymentState.organizationSubscriptions.find(
        (candidate) => candidate.id === subscription.id
      )
    )
    const paymentAuditCount = paymentState.auditEvents.length

    expect(() =>
      applyOrganizationSubscriptionPaymentState(
        paymentState,
        {
          paymentState: "past_due",
          status: "past_due",
          subscriptionId: subscription.id
        },
        "2026-08-10T16:00:00.000Z"
      )
    ).toThrow(/Billing account cross-wire/)
    expect(
      paymentState.organizationSubscriptions.find(
        (candidate) => candidate.id === subscription.id
      )
    ).toEqual(paymentSubscriptionBefore)
    expect(paymentState.auditEvents).toHaveLength(paymentAuditCount)

    const pilotState = freshState()
    const pilot = paidAndOperating(pilotState, "network_pilot")
    const commitmentEnd = pilot.commitmentEnd as string
    planSubscriptionBillingRun(pilotState, commitmentEnd)
    const inGrace = pilotState.organizationSubscriptions.find(
      (candidate) => candidate.id === pilot.id
    )
    const pilotAccount = pilotState.organizationBillingAccounts.find(
      (account) => account.subscriptionId === pilot.id
    )
    if (!inGrace || !pilotAccount || !inGrace.conversionGraceEndsAt) {
      throw new Error("Pilot grace fixture missing")
    }
    pilotAccount.subscriptionId = "78787878-7878-4878-8878-787878787899"
    const pilotSubscriptionBefore = structuredClone(inGrace)
    const pilotAuditCount = pilotState.auditEvents.length

    expect(() =>
      planSubscriptionBillingRun(
        pilotState,
        inGrace.conversionGraceEndsAt as string
      )
    ).toThrow(/Billing account cross-wire/)
    expect(
      pilotState.organizationSubscriptions.find(
        (candidate) => candidate.id === pilot.id
      )
    ).toEqual(pilotSubscriptionBefore)
    expect(pilotState.auditEvents).toHaveLength(pilotAuditCount)
  })

  it("keeps Pilot Network open through grace and creates a zero-included grace summary", () => {
    const state = freshState()
    const pilot = paidAndOperating(state, "network_pilot")
    const commitmentEnd = pilot.commitmentEnd as string
    const graceEndsAt = new Date(
      Date.parse(commitmentEnd) + 14 * 24 * 60 * 60 * 1000
    ).toISOString()

    planSubscriptionBillingRun(
      state,
      new Date(Date.parse(commitmentEnd) - 30 * 24 * 60 * 60 * 1000).toISOString()
    )
    const noticeCount = state.notifications.length
    planSubscriptionBillingRun(
      state,
      new Date(Date.parse(commitmentEnd) - 30 * 24 * 60 * 60 * 1000).toISOString()
    )
    expect(state.notifications.length).toBe(noticeCount)

    planSubscriptionBillingRun(state, commitmentEnd)
    const inGrace = state.organizationSubscriptions.find(
      (candidate) => candidate.id === pilot.id
    )
    expect(inGrace?.operationalExpiredAt).toBeNull()
    expect(inGrace?.conversionGraceEndsAt).toBe(graceEndsAt)
    expect(
      state.organizationBillingAccounts.find(
        (candidate) => candidate.subscriptionId === pilot.id
      )?.activationState
    ).toBe("active")

    const graceSummary = ensureBillingPeriodSummary(
      state,
      {
        subscriptionId: pilot.id,
        usageAt: new Date(Date.parse(commitmentEnd) + 1).toISOString()
      },
      commitmentEnd
    )
    expect(graceSummary.includedUnits).toBe(0)
    expect(graceSummary.overageUnitPriceCents).toBe(15_000)
    expect(graceSummary.periodEnd).toBe(graceEndsAt)

    planSubscriptionBillingRun(state, graceEndsAt)
    expect(
      state.organizationSubscriptions.find(
        (candidate) => candidate.id === pilot.id
      )?.operationalExpiredAt
    ).toBe(graceEndsAt)
  })

  it("converges scheduled Pilot deletion and cron in either order", () => {
    const runOrdering = (deletionFirst: boolean) => {
      const state = freshState()
      const pilot = paidAndOperating(state, "network_pilot")
      const commitmentEnd = pilot.commitmentEnd as string
      const graceEndsAt = new Date(
        Date.parse(commitmentEnd) + 14 * 24 * 60 * 60 * 1000
      ).toISOString()
      const deletionAt = new Date(
        Date.parse(commitmentEnd) + 1
      ).toISOString()
      const providerDeletion = () =>
        bindOrganizationSubscriptionProvider(
          state,
          {
            currentPeriodEnd: pilot.currentPeriodEnd as string,
            currentPeriodStart: pilot.currentPeriodStart as string,
            paymentState: "none",
            providerEffectiveAt: commitmentEnd,
            status: "cancelled",
            stripeCustomerId: pilot.stripeCustomerId as string,
            stripeSubscriptionId: pilot.stripeSubscriptionId as string,
            subscriptionId: pilot.id
          },
          deletionAt
        )

      if (deletionFirst) {
        providerDeletion()
        planSubscriptionBillingRun(state, deletionAt)
      } else {
        planSubscriptionBillingRun(state, commitmentEnd)
        providerDeletion()
      }

      const canonical = state.organizationSubscriptions.find(
        (candidate) => candidate.id === pilot.id
      )
      expect(canonical).toMatchObject({
        conversionGraceEndsAt: graceEndsAt,
        operationalExpiredAt: null,
        paymentState: "current",
        status: "non_renewing"
      })
      expect(
        state.auditEvents.filter(
          (event) =>
            event.action === "network_pilot_allowance_term_closed" &&
            event.entityId === pilot.id
        )
      ).toHaveLength(1)

      return { graceEndsAt, pilot, state }
    }

    const deletionFirst = runOrdering(true)
    const cronFirst = runOrdering(false)
    for (const fixture of [deletionFirst, cronFirst]) {
      const networkAssignmentId =
        fixture === deletionFirst
          ? "93939393-9393-4393-8393-939393939301"
          : "93939393-9393-4393-8393-939393939302"
      const privateAssignmentId =
        fixture === deletionFirst
          ? "93939393-9393-4393-8393-939393939303"
          : "93939393-9393-4393-8393-939393939304"
      const withinGrace = new Date(
        Date.parse(fixture.graceEndsAt) - 1
      ).toISOString()
      addBlankAssignment(fixture.state, networkAssignmentId)
      addBlankAssignment(fixture.state, privateAssignmentId)
      expect(() =>
        resolveAssignmentBillingCommitment(
          fixture.state,
          {
            acceptanceSource: "host_approval",
            assignmentId: networkAssignmentId,
            haulerOrganizationId: UNRELATED_HAULER,
            hostOrganizationId: HOST
          },
          withinGrace
        )
      ).toThrow(/Historical subscriptions no longer authorize new work/)
      expect(() =>
        resolveAssignmentBillingCommitment(
          fixture.state,
          {
            acceptanceSource: "direct_offer",
            assignmentId: privateAssignmentId,
            haulerOrganizationId: PRIVATE_PARTNER,
            hostOrganizationId: HOST
          },
          withinGrace
        )
      ).toThrow(/Historical subscriptions no longer authorize new work/)

      planSubscriptionBillingRun(fixture.state, fixture.graceEndsAt)
      const blockedNetworkId =
        fixture === deletionFirst
          ? "93939393-9393-4393-8393-939393939305"
          : "93939393-9393-4393-8393-939393939306"
      const blockedPrivateId =
        fixture === deletionFirst
          ? "93939393-9393-4393-8393-939393939307"
          : "93939393-9393-4393-8393-939393939308"
      addBlankAssignment(fixture.state, blockedNetworkId)
      addBlankAssignment(fixture.state, blockedPrivateId)
      expect(() =>
        resolveAssignmentBillingCommitment(
          fixture.state,
          {
            acceptanceSource: "host_approval",
            assignmentId: blockedNetworkId,
            haulerOrganizationId: UNRELATED_HAULER,
            hostOrganizationId: HOST
          },
          fixture.graceEndsAt
        )
      ).toThrow(/Historical subscriptions no longer authorize new work/)
      expect(() =>
        resolveAssignmentBillingCommitment(
          fixture.state,
          {
            acceptanceSource: "direct_offer",
            assignmentId: blockedPrivateId,
            haulerOrganizationId: PRIVATE_PARTNER,
            hostOrganizationId: HOST
          },
          fixture.graceEndsAt
        )
      ).toThrow(/Historical subscriptions no longer authorize new work/)
    }
  })

  it("uses signed provider time for an early Pilot deletion despite late delivery", () => {
    for (const cronFirst of [false, true]) {
      const state = freshState()
      const pilot = paidAndOperating(state, "network_pilot")
      const commitmentEnd = pilot.commitmentEnd as string
      const providerEffectiveAt = new Date(
        Date.parse(commitmentEnd) - 1
      ).toISOString()
      const deliveredAt = new Date(
        Date.parse(commitmentEnd) + 1
      ).toISOString()
      if (cronFirst) {
        planSubscriptionBillingRun(state, commitmentEnd)
        expect(
          state.organizationSubscriptions.find(
            (candidate) => candidate.id === pilot.id
          )?.status
        ).toBe("non_renewing")
      }
      const input = {
        currentPeriodEnd: pilot.currentPeriodEnd as string,
        currentPeriodStart: pilot.currentPeriodStart as string,
        paymentState: "none" as const,
        providerEffectiveAt,
        status: "cancelled" as const,
        stripeCustomerId: pilot.stripeCustomerId as string,
        stripeSubscriptionId: pilot.stripeSubscriptionId as string,
        subscriptionId: pilot.id
      }
      const deleted = bindOrganizationSubscriptionProvider(
        state,
        input,
        deliveredAt
      )
      expect(deleted).toMatchObject({
        outcome: "applied",
        subscription: {
          conversionGraceEndsAt: null,
          paymentState: "none",
          status: "cancelled"
        }
      })
      const redelivery = bindOrganizationSubscriptionProvider(
        state,
        input,
        new Date(Date.parse(deliveredAt) + 1).toISOString()
      )
      expect(redelivery).toMatchObject({
        changed: false,
        outcome: "applied",
        subscription: {
          conversionGraceEndsAt: null,
          status: "cancelled"
        }
      })
      planSubscriptionBillingRun(state, deliveredAt)
      expect(
        state.organizationSubscriptions.find(
          (candidate) => candidate.id === pilot.id
        )
      ).toMatchObject({
        conversionGraceEndsAt: null,
        status: "cancelled"
      })
    }
  })

  it("activates a fresh paid target during Pilot grace and preserves provider history", () => {
    const state = freshState()
    const pilot = paidAndOperating(state, "network_pilot")
    const commitmentEnd = pilot.commitmentEnd as string
    const pilotSummary = state.billingPeriodSummaries.find(
      (summary) => summary.subscriptionId === pilot.id
    )
    if (!pilotSummary) throw new Error("Pilot allowance summary missing")
    recordBillingAdjustment(
      state,
      {
        actorUserId: ADMIN,
        amountCents: 1_000,
        billingPeriodSummaryId: pilotSummary.id,
        idempotencyKey: "old-pilot-overage-invoice",
        platformAdminAuthorized: true,
        reason: "Create historical Pilot invoice",
        type: "manual_debit"
      },
      new Date(Date.parse(commitmentEnd) - 1).toISOString()
    )
    const historicalOverage = openNetworkOverageInvoice(
      state,
      { billingPeriodSummaryId: pilotSummary.id },
      commitmentEnd
    )
    if (!("invoice" in historicalOverage)) {
      throw new Error("Historical Pilot overage invoice missing")
    }
    const acceptedAt = new Date(
      Date.parse(commitmentEnd) + 24 * 60 * 60 * 1000
    ).toISOString()
    const authorization = authorizePilotConversionSubscription(
      state,
      {
        acceptedAt,
        acceptedByUserId: OWNER,
        acceptedTermsVersion: "subscription-v1-2026-07-28",
        actorUserId: ADMIN,
        operatingMarketIds: [HOST_LANDING],
        platformAdminAuthorized: true,
        sourceSubscriptionId: pilot.id,
        targetPlanCode: "network_25"
      },
      acceptedAt
    )
    const acceptedQuoteFingerprint =
      subscriptionPlanQuoteFingerprint(
        authorization.targetSubscription.planSnapshot
      )
    expect(authorization).toMatchObject({
      account: { subscriptionId: pilot.id },
      changed: true,
      sourceSubscription: {
        conversionGraceEndsAt: expect.any(String),
        status: "non_renewing"
      },
      targetSubscription: {
        acceptedQuoteFingerprint,
        activationAuthorizedAt: acceptedAt,
        convertedFromPlanCode: "network_pilot",
        convertedFromSubscriptionId: pilot.id,
        operationalActivatedAt: null,
        planCode: "network_25",
        stripeSubscriptionId: null
      }
    })
    expect(
      state.auditEvents.find(
        (event) =>
          event.action ===
            "network_pilot_conversion_subscription_authorized" &&
          event.entityId ===
            authorization.targetSubscription.id
      )?.metadata
    ).toMatchObject({
      acceptedQuoteFingerprint,
      allowanceUnits: 25,
      baseMonthlyPriceCents: 300_000,
      commitmentMonths: 12,
      effectiveAt: "2026-07-28T00:00:00.000Z",
      overageUnitPriceCents: 12_500,
      planVersion: 1
    })
    expect(
      authorizePilotConversionSubscription(
        state,
        {
          acceptedAt,
          acceptedByUserId: OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          actorUserId: ADMIN,
          operatingMarketIds: [HOST_LANDING],
          platformAdminAuthorized: true,
          sourceSubscriptionId: pilot.id,
          targetPlanCode: "network_25"
        },
        new Date(Date.parse(acceptedAt) + 1).toISOString()
      )
    ).toMatchObject({
      changed: false,
      targetSubscription: { id: authorization.targetSubscription.id }
    })
    const target = authorization.targetSubscription
    const paidPeriodStart = new Date(
      Date.parse(acceptedAt) + 2
    ).toISOString()
    const paidPeriodEnd = new Date(
      Date.parse(paidPeriodStart) + 31 * 24 * 60 * 60 * 1000
    ).toISOString()
    const activated =
      activateAuthorizedOrganizationSubscriptionFromProvider(
        state,
        {
          currentPeriodEnd: paidPeriodEnd,
          currentPeriodStart: paidPeriodStart,
          providerInvoiceId: "in_pilotconversion001",
          stripeCustomerId: pilot.stripeCustomerId as string,
          stripeSubscriptionId: "sub_pilotconversion001",
          subscriptionId: target.id
        },
        new Date(Date.parse(paidPeriodStart) + 1).toISOString()
      )
    expect(activated).toMatchObject({
      account: {
        activationState: "active",
        subscriptionId: target.id
      },
      subscription: {
        commitmentStart: paidPeriodStart,
        convertedFromSubscriptionId: pilot.id,
        operationalActivatedAt: paidPeriodStart,
        planCode: "network_25",
        stripeSubscriptionId: "sub_pilotconversion001"
      }
    })
    const historicalPilot = state.organizationSubscriptions.find(
      (candidate) => candidate.id === pilot.id
    )
    expect(historicalPilot).toMatchObject({
      operationalExpiredAt: paidPeriodStart,
      status: "expired",
      stripeSubscriptionId: pilot.stripeSubscriptionId
    })
    expect(
      state.billingPeriodSummaries.some(
        (summary) => summary.subscriptionId === pilot.id
      )
    ).toBe(true)

    const beforeDelayedDeletion = structuredClone(historicalPilot)
    const delayedDeletion = bindOrganizationSubscriptionProvider(
      state,
      {
        currentPeriodEnd: pilot.currentPeriodEnd as string,
        currentPeriodStart: pilot.currentPeriodStart as string,
        paymentState: "none",
        providerEffectiveAt: commitmentEnd,
        status: "cancelled",
        stripeCustomerId: pilot.stripeCustomerId as string,
        stripeSubscriptionId: pilot.stripeSubscriptionId as string,
        subscriptionId: pilot.id
      },
      new Date(Date.parse(paidPeriodStart) + 2).toISOString()
    )
    expect(delayedDeletion.changed).toBe(false)
    expect(delayedDeletion.outcome).toBe("historical_ignored")
    expect(delayedDeletion.subscription).toEqual(beforeDelayedDeletion)
    const redelivery = bindOrganizationSubscriptionProvider(
      state,
      {
        currentPeriodEnd: pilot.currentPeriodEnd as string,
        currentPeriodStart: pilot.currentPeriodStart as string,
        paymentState: "none",
        providerEffectiveAt: commitmentEnd,
        status: "cancelled",
        stripeCustomerId: pilot.stripeCustomerId as string,
        stripeSubscriptionId: pilot.stripeSubscriptionId as string,
        subscriptionId: pilot.id
      },
      new Date(Date.parse(paidPeriodStart) + 3).toISOString()
    )
    expect(redelivery.changed).toBe(false)
    expect(redelivery.outcome).toBe("historical_ignored")
    expect(
      state.auditEvents.filter(
        (event) =>
          event.action ===
            "historical_subscription_provider_lifecycle_ignored" &&
          event.entityId === pilot.id
      )
    ).toHaveLength(1)
    expect(
      state.organizationBillingAccounts.find(
        (account) => account.organizationId === HOST
      )?.subscriptionId
    ).toBe(target.id)

    const activeTargetBeforeHistoricalInvoices = structuredClone(
      state.organizationSubscriptions.find(
        (candidate) => candidate.id === target.id
      )
    )
    const activeAccountBeforeHistoricalInvoices = structuredClone(
      state.organizationBillingAccounts.find(
        (account) => account.organizationId === HOST
      )
    )
    const oldBaseFailure = recordSubscriptionBaseInvoiceProviderState(
      state,
      {
        amountDueCents: 150_000,
        amountPaidCents: 0,
        amountRemainingCents: 150_000,
        attemptCount: 1,
        attemptedAt: new Date(
          Date.parse(paidPeriodStart) + 4
        ).toISOString(),
        currency: "usd",
        lastPaymentFailure: "Historical card failure",
        providerInvoiceId: "in_oldpilotbase001",
        status: "open",
        subscriptionId: pilot.id
      },
      new Date(Date.parse(paidPeriodStart) + 4).toISOString()
    )
    expect(oldBaseFailure.changed).toBe(true)
    expect(
      recordSubscriptionBaseInvoiceProviderState(
        state,
        {
          amountDueCents: 150_000,
          amountPaidCents: 0,
          amountRemainingCents: 150_000,
          attemptCount: 1,
          attemptedAt: new Date(
            Date.parse(paidPeriodStart) + 4
          ).toISOString(),
          currency: "usd",
          lastPaymentFailure: "Historical card failure",
          providerInvoiceId: "in_oldpilotbase001",
          status: "open",
          subscriptionId: pilot.id
        },
        new Date(Date.parse(paidPeriodStart) + 5).toISOString()
      ).changed
    ).toBe(false)
    expect(
      recordSubscriptionBaseInvoiceProviderState(
        state,
        {
          amountDueCents: 150_000,
          amountPaidCents: 150_000,
          amountRemainingCents: 0,
          attemptCount: 1,
          attemptedAt: new Date(
            Date.parse(paidPeriodStart) + 4
          ).toISOString(),
          currency: "usd",
          lastPaymentFailure: null,
          paidAt: new Date(
            Date.parse(paidPeriodStart) + 6
          ).toISOString(),
          providerInvoiceId: "in_oldpilotbase001",
          status: "paid",
          subscriptionId: pilot.id
        },
        new Date(Date.parse(paidPeriodStart) + 6).toISOString()
      ).invoice
    ).toMatchObject({
      amountPaidCents: 150_000,
      amountRemainingCents: 0,
      status: "paid",
      subscriptionId: pilot.id
    })
    expect(
      recordSubscriptionBaseInvoiceProviderState(
        state,
        {
          amountDueCents: 150_000,
          amountPaidCents: 150_000,
          amountRemainingCents: 0,
          attemptCount: 1,
          attemptedAt: new Date(
            Date.parse(paidPeriodStart) + 4
          ).toISOString(),
          currency: "usd",
          lastPaymentFailure: null,
          paidAt: new Date(
            Date.parse(paidPeriodStart) + 6
          ).toISOString(),
          providerInvoiceId: "in_oldpilotbase001",
          status: "paid",
          subscriptionId: pilot.id
        },
        new Date(Date.parse(paidPeriodStart) + 7).toISOString()
      ).changed
    ).toBe(false)

    const historicalFailure = markNetworkOverageInvoiceFailed(
      state,
      {
        invoiceId: historicalOverage.invoice.id,
        reason: "Historical overage failure"
      },
      new Date(Date.parse(paidPeriodStart) + 7).toISOString()
    )
    expect(historicalFailure).toMatchObject({
      changed: true,
      invoice: {
        collectionAttemptCount: 1,
        status: "open"
      }
    })
    const historicalPaid = markNetworkOverageInvoicePaid(
      state,
      {
        invoiceId: historicalOverage.invoice.id,
        providerFacts: settledOverageProviderFacts(
          historicalOverage.invoice,
          "in_oldpilotoverage001"
        )
      },
      new Date(Date.parse(paidPeriodStart) + 8).toISOString()
    )
    expect(historicalPaid.invoice.status).toBe("paid")
    expect(
      markNetworkOverageInvoicePaid(
        state,
        {
          invoiceId: historicalOverage.invoice.id,
          providerFacts: settledOverageProviderFacts(
            historicalOverage.invoice,
            "in_oldpilotoverage001"
          )
        },
        new Date(Date.parse(paidPeriodStart) + 9).toISOString()
      ).changed
    ).toBe(false)
    expect(
      markNetworkOverageInvoiceFailed(
        state,
        {
          invoiceId: historicalOverage.invoice.id,
          providerFacts: settledOverageProviderFacts(
            historicalOverage.invoice,
            "in_oldpilotoverage001"
          ),
          reason: "Delayed historical failure"
        },
        new Date(Date.parse(paidPeriodStart) + 10).toISOString()
      ).changed
    ).toBe(false)
    expect(
      state.organizationSubscriptions.find(
        (candidate) => candidate.id === target.id
      )
    ).toEqual(activeTargetBeforeHistoricalInvoices)
    expect(
      state.organizationBillingAccounts.find(
        (account) => account.organizationId === HOST
      )
    ).toEqual(activeAccountBeforeHistoricalInvoices)
  })

  it("refuses a fresh Pilot conversion target after the grace deadline", () => {
    const state = freshState()
    const pilot = paidAndOperating(state, "network_pilot")
    const graceEndsAt = new Date(
      Date.parse(pilot.commitmentEnd as string) +
        14 * 24 * 60 * 60 * 1000
    ).toISOString()
    const before = structuredClone(state)
    expect(() =>
      authorizePilotConversionSubscription(
        state,
        {
          acceptedAt: graceEndsAt,
          acceptedByUserId: OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          actorUserId: ADMIN,
          operatingMarketIds: [HOST_LANDING],
          platformAdminAuthorized: true,
          sourceSubscriptionId: pilot.id,
          targetPlanCode: "network_25"
        },
        graceEndsAt
      )
    ).toThrow(DomainRefusalError)
    expect(() =>
      authorizePilotConversionSubscription(
        state,
        {
          acceptedAt: graceEndsAt,
          acceptedByUserId: OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          actorUserId: ADMIN,
          operatingMarketIds: [HOST_LANDING],
          platformAdminAuthorized: true,
          sourceSubscriptionId: pilot.id,
          targetPlanCode: "network_25"
        },
        graceEndsAt
      )
    ).toThrow(/Pilot conversion is available only through/)
    expect(state).toEqual(before)
  })

  it("types caller-correctable Pilot conversion scope and entitlement conflicts", () => {
    const scopeState = freshState()
    const scopePilot = paidAndOperating(
      scopeState,
      "network_pilot"
    )
    const scopeAcceptedAt = new Date(
      Date.parse(scopePilot.commitmentEnd as string) +
        24 * 60 * 60 * 1000
    ).toISOString()

    expect(() =>
      authorizePilotConversionSubscription(
        scopeState,
        {
          acceptedAt: scopeAcceptedAt,
          acceptedByUserId: OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          actorUserId: ADMIN,
          operatingMarketIds: [],
          platformAdminAuthorized: true,
          sourceSubscriptionId: scopePilot.id,
          targetPlanCode: "network_25"
        },
        scopeAcceptedAt
      )
    ).toThrow(DomainRefusalError)
    expect(() =>
      authorizePilotConversionSubscription(
        scopeState,
        {
          acceptedAt: scopeAcceptedAt,
          acceptedByUserId: OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          actorUserId: ADMIN,
          operatingMarketIds: [],
          platformAdminAuthorized: true,
          sourceSubscriptionId: scopePilot.id,
          targetPlanCode: "network_25"
        },
        scopeAcceptedAt
      )
    ).toThrow(/accepted operating location/)

    const entitlementState = freshState()
    const entitlementPilot = paidAndOperating(
      entitlementState,
      "network_pilot"
    )
    const entitlementAcceptedAt = new Date(
      Date.parse(entitlementPilot.commitmentEnd as string) +
        24 * 60 * 60 * 1000
    ).toISOString()
    const entitlementTemplate = entitlementState.entitlements[0]

    if (!entitlementTemplate) {
      throw new Error("Seed entitlement missing")
    }

    entitlementState.entitlements.push({
      ...structuredClone(entitlementTemplate),
      id: "28282828-2828-4828-8828-282828282898",
      organizationId: HOST,
      product: "landing_operations",
      status: "active",
      stripeCustomerId: "cus_legacyhost001",
      stripeSubscriptionId: "sub_legacyhost001"
    })

    expect(() =>
      authorizePilotConversionSubscription(
        entitlementState,
        {
          acceptedAt: entitlementAcceptedAt,
          acceptedByUserId: OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          actorUserId: ADMIN,
          operatingMarketIds: [HOST_LANDING],
          platformAdminAuthorized: true,
          sourceSubscriptionId: entitlementPilot.id,
          targetPlanCode: "network_25"
        },
        entitlementAcceptedAt
      )
    ).toThrow(DomainRefusalError)
    expect(() =>
      authorizePilotConversionSubscription(
        entitlementState,
        {
          acceptedAt: entitlementAcceptedAt,
          acceptedByUserId: OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          actorUserId: ADMIN,
          operatingMarketIds: [HOST_LANDING],
          platformAdminAuthorized: true,
          sourceSubscriptionId: entitlementPilot.id,
          targetPlanCode: "network_25"
        },
        entitlementAcceptedAt
      )
    ).toThrow(/independently billed Dispatch Pro entitlement/)
  })

  it("keeps malformed Pilot conversion account state as an invariant failure", () => {
    const state = freshState()
    const pilot = paidAndOperating(state, "network_pilot")
    const acceptedAt = new Date(
      Date.parse(pilot.commitmentEnd as string) +
        24 * 60 * 60 * 1000
    ).toISOString()
    state.organizationBillingAccounts =
      state.organizationBillingAccounts.filter(
        (candidate) => candidate.organizationId !== HOST
      )
    let refusal: unknown

    try {
      authorizePilotConversionSubscription(
        state,
        {
          acceptedAt,
          acceptedByUserId: OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          actorUserId: ADMIN,
          operatingMarketIds: [HOST_LANDING],
          platformAdminAuthorized: true,
          sourceSubscriptionId: pilot.id,
          targetPlanCode: "network_25"
        },
        acceptedAt
      )
    } catch (error) {
      refusal = error
    }

    expect(refusal).toBeInstanceOf(Error)
    expect(refusal).not.toBeInstanceOf(DomainRefusalError)
    expect((refusal as Error).message).toMatch(
      /exactly one organization billing account/
    )
  })

  it("authorizes every paid Pilot target and freezes negotiated Enterprise terms", () => {
    const cases = [
      { planCode: "network_50" as const, negotiatedTerms: undefined },
      { planCode: "network_100" as const, negotiatedTerms: undefined },
      {
        planCode: "enterprise_250_plus" as const,
        negotiatedTerms: ENTERPRISE_TERMS
      }
    ]

    for (const entry of cases) {
      const state = freshState()
      const pilot = paidAndOperating(state, "network_pilot")
      const acceptedAt = new Date(
        Date.parse(pilot.commitmentEnd as string) +
          24 * 60 * 60 * 1000
      ).toISOString()
      const authorized = authorizePilotConversionSubscription(
        state,
        {
          acceptedAt,
          acceptedByUserId: OWNER,
          acceptedTermsVersion: "subscription-v1-2026-07-28",
          actorUserId: ADMIN,
          negotiatedTerms: entry.negotiatedTerms,
          operatingMarketIds: [HOST_LANDING],
          platformAdminAuthorized: true,
          sourceSubscriptionId: pilot.id,
          targetPlanCode: entry.planCode
        },
        acceptedAt
      )

      expect(authorized).toMatchObject({
        account: { subscriptionId: pilot.id },
        sourceSubscription: {
          conversionGraceEndsAt: expect.any(String),
          status: "non_renewing"
        },
        targetSubscription: {
          convertedFromSubscriptionId: pilot.id,
          operatingMarketIds: [HOST_LANDING],
          planCode: entry.planCode,
          status: "pending"
        }
      })
      if (entry.planCode === "enterprise_250_plus") {
        expect(authorized.targetSubscription).toMatchObject({
          baseMonthlyPriceSnapshotCents:
            ENTERPRISE_TERMS.baseMonthlyPriceCents,
          billingModel: "enterprise_custom",
          customTerms: {
            commitmentMonths: ENTERPRISE_TERMS.commitmentMonths,
            definedIntegrations: ENTERPRISE_TERMS.definedIntegrations,
            negotiated: true,
            serviceSupportObligations:
              ENTERPRISE_TERMS.serviceSupportObligations
          },
          includedAllowanceSnapshot:
            ENTERPRISE_TERMS.includedNetworkLoadUnits,
          overageRateSnapshotCents:
            ENTERPRISE_TERMS.overageUnitPriceCents,
          planSnapshot: {
            stripeOveragePriceId:
              ENTERPRISE_TERMS.stripeOveragePriceId,
            stripePriceId: ENTERPRISE_TERMS.stripePriceId,
            stripeProductId: ENTERPRISE_TERMS.stripeProductId
          }
        })
      }
    }
  })
})

describe("provider ledgers, invoice composition, and billing email", () => {
  it("freezes pre-invoice adjustments and emits post-final provider intents", () => {
    const state = freshState()
    const subscription = paidAndOperating(state)
    const summary = ensureBillingPeriodSummary(
      state,
      { subscriptionId: subscription.id, usageAt: PERIOD_START },
      PERIOD_START
    )

    recordBillingAdjustment(
      state,
      {
        actorUserId: ADMIN,
        amountCents: 5_000,
        billingPeriodSummaryId: summary.id,
        idempotencyKey: "manual-debit-1",
        platformAdminAuthorized: true,
        reason: "Contract true-up",
        type: "manual_debit"
      },
      "2026-08-20T16:00:00.000Z"
    )
    const opened = openNetworkOverageInvoice(
      state,
      { billingPeriodSummaryId: summary.id },
      PERIOD_END
    )
    expect(opened.outcome).toBe("opened")
    if (!("invoice" in opened)) throw new Error("Expected invoice")
    expect(opened.invoice).toMatchObject({
      adjustmentAmountCents: 5_000,
      amountDueCents: 5_000,
      creditCarryforwardCents: 0,
      quantity: 0,
      subtotalCents: 5_000,
      usageSubtotalCents: 0
    })
    expect(opened.invoice.adjustmentIds).toHaveLength(1)

    const postFinalCredit = recordBillingAdjustment(
      state,
      {
        actorUserId: ADMIN,
        amountCents: 1_000,
        billingPeriodSummaryId: summary.id,
        idempotencyKey: "service-credit-post-final",
        invoiceId: opened.invoice.id,
        platformAdminAuthorized: true,
        reason: "Post-final correction",
        type: "service_credit"
      },
      "2026-09-03T16:01:00.000Z"
    )
    expect(postFinalCredit.adjustment.settlementIntent).toBe("credit_note")
    expect(postFinalCredit.adjustment.invoiceId).toBe(opened.invoice.id)
    const bound = bindBillingAdjustmentProviderReference(
      state,
      {
        adjustmentId: postFinalCredit.adjustment.id,
        providerReference: "cn_123"
      },
      "2026-09-03T16:02:00.000Z"
    )
    expect(bound.adjustment.providerReference).toBe("cn_123")
    expect(
      state.networkOverageInvoices.find(
        (candidate) => candidate.id === opened.invoice.id
      )?.amountDueCents
    ).toBe(5_000)
  })

  it("requires an issued invoice and preserves Stripe's 50-cent minimum receivable", () => {
    const unissuedState = freshState()
    const unissuedSubscription = paidAndOperating(unissuedState)
    const unissuedSummary = ensureBillingPeriodSummary(
      unissuedState,
      {
        subscriptionId: unissuedSubscription.id,
        usageAt: PERIOD_START
      },
      PERIOD_START
    )
    expect(() =>
      recordBillingAdjustment(
        unissuedState,
        {
          actorUserId: ADMIN,
          amountCents: 100,
          billingPeriodSummaryId: unissuedSummary.id,
          idempotencyKey: "unissued-service-credit",
          platformAdminAuthorized: true,
          reason: "Open-period service recovery",
          type: "service_credit"
        } as Parameters<typeof recordBillingAdjustment>[1],
        "2026-08-20T16:00:00.000Z"
      )
    ).toThrow(/requires an issued canonical Network overage invoice/)
    expect(unissuedState.billingAdjustments).toHaveLength(0)

    const oneDollarInvoice = () => {
      const state = freshState()
      const subscription = paidAndOperating(state)
      const summary = ensureBillingPeriodSummary(
        state,
        { subscriptionId: subscription.id, usageAt: PERIOD_START },
        PERIOD_START
      )
      recordBillingAdjustment(
        state,
        {
          actorUserId: ADMIN,
          amountCents: 100,
          billingPeriodSummaryId: summary.id,
          idempotencyKey: "one-dollar-invoice",
          platformAdminAuthorized: true,
          reason: "Create a one-dollar invoice",
          type: "manual_debit"
        },
        "2026-08-20T16:00:00.000Z"
      )
      const opened = openNetworkOverageInvoice(
        state,
        { billingPeriodSummaryId: summary.id },
        PERIOD_END
      )
      if (!("invoice" in opened)) {
        throw new Error("Expected one-dollar invoice")
      }

      return { invoice: opened.invoice, state, summary }
    }

    for (const amountCents of [1, 49, 50, 100]) {
      const { invoice, state, summary } = oneDollarInvoice()
      const credit = recordBillingAdjustment(
        state,
        {
          actorUserId: ADMIN,
          amountCents,
          billingPeriodSummaryId: summary.id,
          idempotencyKey: `bounded-credit-${amountCents}`,
          invoiceId: invoice.id,
          platformAdminAuthorized: true,
          reason: "Bounded service recovery",
          type: "service_credit"
        },
        "2026-09-03T16:01:00.000Z"
      )
      expect(credit.adjustment).toMatchObject({
        amountDeltaCents: -amountCents,
        invoiceId: invoice.id,
        minimumChargeWriteoffCents: 0,
        settlementIntent: "credit_note"
      })
    }

    for (const amountCents of [99, 101]) {
      const { invoice, state, summary } = oneDollarInvoice()
      const adjustmentCount = state.billingAdjustments.length
      expect(() =>
        recordBillingAdjustment(
          state,
          {
            actorUserId: ADMIN,
            amountCents,
            billingPeriodSummaryId: summary.id,
            idempotencyKey: `bounded-credit-${amountCents}`,
            invoiceId: invoice.id,
            platformAdminAuthorized: true,
            reason: "Bounded service recovery",
            type: "service_credit"
          },
          "2026-09-03T16:01:00.000Z"
        )
      ).toThrow(
        amountCents > 100
          ? /remaining credit capacity/
          : /leave either zero or at least 50 cents due/
      )
      expect(state.billingAdjustments).toHaveLength(adjustmentCount)
    }
  })

  it("settles multiple billed reversals without leaving a sub-minimum receivable", () => {
    const state = freshState()
    const subscription = paidAndOperating(state)
    const initialSummary = ensureBillingPeriodSummary(
      state,
      { subscriptionId: subscription.id, usageAt: PERIOD_START },
      PERIOD_START
    )
    const invoiceId = networkOverageInvoiceId(initialSummary.id, 1)
    const movementIds = [
      "91919191-9191-4191-8191-919191919101",
      "91919191-9191-4191-8191-919191919102"
    ]
    const usageEventIds = movementIds.map((movementId) =>
      networkUsageEventId(movementId)
    )
    const summary = billingPeriodSummarySchema.parse({
      ...initialSummary,
      includedUnits: 0,
      invoiceIds: [invoiceId],
      overageAmountCents: 60,
      overageUnitPriceCents: 30,
      overageUnits: 2,
      planSnapshot: {
        ...initialSummary.planSnapshot,
        includedNetworkLoadUnits: 0,
        overageUnitPriceCents: 30
      },
      status: "invoicing",
      updatedAt: PERIOD_END,
      usageEventIds,
      usedUnits: 2
    })
    state.billingPeriodSummaries = state.billingPeriodSummaries.map(
      (candidate) => candidate.id === summary.id ? summary : candidate
    )
    const usageEvents = movementIds.map((movementId, index) =>
      networkUsageEventSchema.parse({
        assignmentId: `91919191-9191-4191-8191-91919191920${index + 1}`,
        auditMetadata: {},
        billingModel: summary.billingModel,
        billingPeriodSummaryId: summary.id,
        capacitySource: "logloads_network",
        completionAt: "2026-08-20T15:00:00.000Z",
        createdAt: "2026-08-20T15:01:00.000Z",
        id: usageEventIds[index],
        invoiceId,
        internalBillingTest: summary.internalBillingTest,
        loadMovementId: movementId,
        loadPostingId: "91919191-9191-4191-8191-919191919301",
        organizationId: summary.organizationId,
        planCode: summary.planCode,
        reversalAdjustmentId: null,
        status: "invoiced",
        unitCount: 1,
        updatedAt: "2026-08-20T15:01:00.000Z"
      })
    )
    state.networkUsageEvents.push(...usageEvents)
    const lineItemAdjustment = billingAdjustmentSchema.parse({
      actorUserId: ADMIN,
      amountDeltaCents: 40,
      billingPeriodSummaryId: summary.id,
      createdAt: "2026-08-20T15:02:00.000Z",
      id: "91919191-9191-4191-8191-919191919401",
      invoiceId,
      organizationId: summary.organizationId,
      providerReference: null,
      reason: "Fixture debit",
      settlementIntent: "invoice_line_item",
      type: "manual_debit",
      unitDelta: 0,
      usageEventId: null
    })
    state.billingAdjustments.push(lineItemAdjustment)
    const invoice = networkOverageInvoiceSchema.parse({
      adjustmentAmountCents: 40,
      adjustmentIds: [lineItemAdjustment.id],
      amountDueCents: 100,
      billingPeriodSummaryId: summary.id,
      collectionAttemptCount: 0,
      createdAt: PERIOD_END,
      creditCarryforwardCents: 0,
      id: invoiceId,
      internalBillingTest: summary.internalBillingTest,
      issuedAt: PERIOD_END,
      lastCollectionAttemptAt: null,
      lastCollectionFailure: null,
      organizationId: summary.organizationId,
      paidAt: null,
      periodEnd: summary.periodEnd,
      periodStart: summary.periodStart,
      planCode: summary.planCode,
      providerAmountDueCents: null,
      providerAmountPaidCents: null,
      providerAmountRemainingCents: null,
      quantity: 2,
      sequence: 1,
      status: "open",
      stripeInvoiceId: null,
      subtotalCents: 100,
      unitAmountCents: 30,
      updatedAt: PERIOD_END,
      usageEventIds,
      usageSubtotalCents: 60,
      voidedAt: null
    })
    state.networkOverageInvoices.push(invoice)
    recordBillingAdjustment(
      state,
      {
        actorUserId: ADMIN,
        amountCents: 20,
        billingPeriodSummaryId: summary.id,
        idempotencyKey: "credit-before-reversals",
        invoiceId,
        platformAdminAuthorized: true,
        reason: "Service recovery before reversal",
        type: "service_credit"
      },
      "2026-09-03T16:01:00.000Z"
    )

    const first = reverseNetworkUsage(
      state,
      {
        actorUserId: ADMIN,
        platformAdminAuthorized: true,
        reason: "First duplicate movement",
        usageEventId: usageEventIds[0] as string
      },
      "2026-09-03T16:02:00.000Z"
    )
    expect(first.adjustment).toMatchObject({
      amountDeltaCents: -30,
      minimumChargeWriteoffCents: 0,
      settlementIntent: "credit_note"
    })
    const second = reverseNetworkUsage(
      state,
      {
        actorUserId: ADMIN,
        platformAdminAuthorized: true,
        reason: "Second duplicate movement",
        usageEventId: usageEventIds[1] as string
      },
      "2026-09-03T16:03:00.000Z"
    )
    expect(second.adjustment).toMatchObject({
      amountDeltaCents: -50,
      minimumChargeWriteoffCents: 20,
      settlementIntent: "credit_note"
    })
    expect(
      state.billingAdjustments
        .filter(
          (adjustment) =>
            adjustment.invoiceId === invoiceId &&
            adjustment.settlementIntent === "credit_note"
        )
        .reduce(
          (total, adjustment) =>
            total + Math.abs(adjustment.amountDeltaCents),
          0
        )
    ).toBe(100)

    const beforeRetry = structuredClone(state)
    const retry = reverseNetworkUsage(
      state,
      {
        actorUserId: ADMIN,
        platformAdminAuthorized: true,
        reason: "Second duplicate movement",
        usageEventId: usageEventIds[1] as string
      },
      "2026-09-03T16:04:00.000Z"
    )
    expect(retry).toMatchObject({
      adjustment: second.adjustment,
      outcome: "already_reversed"
    })
    expect(state).toEqual(beforeRetry)
  })

  it("credits the exact invoice displaced by an included usage reversal and bills its replacement once", () => {
    const state = freshState()
    const subscription = paidAndOperating(state)
    const initialSummary = ensureBillingPeriodSummary(
      state,
      { subscriptionId: subscription.id, usageAt: PERIOD_START },
      PERIOD_START
    )
    const movementIds = [
      "92929292-9292-4292-8292-929292929101",
      "92929292-9292-4292-8292-929292929102",
      "92929292-9292-4292-8292-929292929103"
    ]
    const usageEventIds = movementIds.map((movementId) =>
      networkUsageEventId(movementId)
    )
    const usageEvents = movementIds.map((movementId, index) =>
      networkUsageEventSchema.parse({
        assignmentId: `92929292-9292-4292-8292-92929292920${index + 1}`,
        auditMetadata: {},
        billingModel: initialSummary.billingModel,
        billingPeriodSummaryId: initialSummary.id,
        capacitySource: "logloads_network",
        completionAt: `2026-08-20T15:0${index}:00.000Z`,
        createdAt: `2026-08-20T15:0${index}:01.000Z`,
        id: usageEventIds[index],
        invoiceId: null,
        internalBillingTest: initialSummary.internalBillingTest,
        loadMovementId: movementId,
        loadPostingId: "92929292-9292-4292-8292-929292929301",
        organizationId: initialSummary.organizationId,
        planCode: initialSummary.planCode,
        reversalAdjustmentId: null,
        status: "recorded",
        unitCount: 1,
        updatedAt: `2026-08-20T15:0${index}:01.000Z`
      })
    )
    const firstAllocation = billingPeriodSummarySchema.parse({
      ...initialSummary,
      includedUnits: 1,
      overageAmountCents: initialSummary.overageUnitPriceCents,
      overageUnits: 1,
      planSnapshot: {
        ...initialSummary.planSnapshot,
        includedNetworkLoadUnits: 1
      },
      usageEventIds: usageEventIds.slice(0, 2),
      usedUnits: 2
    })
    state.billingPeriodSummaries = state.billingPeriodSummaries.map(
      (candidate) =>
        candidate.id === firstAllocation.id ? firstAllocation : candidate
    )
    state.networkUsageEvents.push(...usageEvents.slice(0, 2))

    const firstOpened = openNetworkOverageInvoice(
      state,
      { billingPeriodSummaryId: firstAllocation.id },
      PERIOD_END
    )
    if (!("invoice" in firstOpened)) {
      throw new Error("Expected the displaced usage invoice")
    }
    expect(firstOpened.invoice.usageEventIds).toEqual([usageEventIds[1]])

    state.networkUsageEvents.push(usageEvents[2]!)
    const invoicingSummary = state.billingPeriodSummaries.find(
      (candidate) => candidate.id === firstAllocation.id
    )
    if (!invoicingSummary) throw new Error("Expected the invoicing summary")
    const replacementAllocation = billingPeriodSummarySchema.parse({
      ...invoicingSummary,
      overageAmountCents: 2 * initialSummary.overageUnitPriceCents,
      overageUnits: 2,
      updatedAt: "2026-09-03T16:00:30.000Z",
      usageEventIds,
      usedUnits: 3
    })
    state.billingPeriodSummaries = state.billingPeriodSummaries.map(
      (candidate) =>
        candidate.id === replacementAllocation.id
          ? replacementAllocation
          : candidate
    )

    const reversed = reverseNetworkUsage(
      state,
      {
        actorUserId: ADMIN,
        platformAdminAuthorized: true,
        reason: "The first included movement was duplicated",
        usageEventId: usageEventIds[0]!
      },
      "2026-09-03T16:01:00.000Z"
    )
    expect(reversed.summary).toMatchObject({
      overageAmountCents: initialSummary.overageUnitPriceCents,
      overageUnits: 1,
      usedUnits: 2
    })
    expect(reversed.adjustment).toMatchObject({
      amountDeltaCents: -initialSummary.overageUnitPriceCents,
      invoiceId: firstOpened.invoice.id,
      settlementIntent: "credit_note",
      usageEventId: usageEventIds[0]
    })

    const beforeRetry = structuredClone(state)
    const retry = reverseNetworkUsage(
      state,
      {
        actorUserId: ADMIN,
        platformAdminAuthorized: true,
        reason: "The first included movement was duplicated",
        usageEventId: usageEventIds[0]!
      },
      "2026-09-03T16:02:00.000Z"
    )
    expect(retry).toMatchObject({
      adjustment: reversed.adjustment,
      outcome: "already_reversed"
    })
    expect(state).toEqual(beforeRetry)

    const replacementOpened = openNetworkOverageInvoice(
      state,
      { billingPeriodSummaryId: firstAllocation.id },
      "2026-09-03T16:03:00.000Z"
    )
    if (!("invoice" in replacementOpened)) {
      throw new Error("Expected a replacement overage invoice")
    }
    expect(replacementOpened.invoice).toMatchObject({
      amountDueCents: initialSummary.overageUnitPriceCents,
      sequence: 2,
      usageEventIds: [usageEventIds[2]]
    })
    expect(
      firstOpened.invoice.amountDueCents +
        replacementOpened.invoice.amountDueCents +
        reversed.adjustment.amountDeltaCents
    ).toBe(initialSummary.overageUnitPriceCents)
  })

  it("keeps an uninvoiced displaced usage reversal in the recomputed ledger", () => {
    const state = freshState()
    const subscription = paidAndOperating(state)
    const initialSummary = ensureBillingPeriodSummary(
      state,
      { subscriptionId: subscription.id, usageAt: PERIOD_START },
      PERIOD_START
    )
    const movementIds = [
      "93939393-9393-4393-8393-939393939101",
      "93939393-9393-4393-8393-939393939102"
    ]
    const usageEventIds = movementIds.map((movementId) =>
      networkUsageEventId(movementId)
    )
    const usageEvents = movementIds.map((movementId, index) =>
      networkUsageEventSchema.parse({
        assignmentId: `93939393-9393-4393-8393-93939393920${index + 1}`,
        auditMetadata: {},
        billingModel: initialSummary.billingModel,
        billingPeriodSummaryId: initialSummary.id,
        capacitySource: "logloads_network",
        completionAt: `2026-08-20T15:0${index}:00.000Z`,
        createdAt: `2026-08-20T15:0${index}:01.000Z`,
        id: usageEventIds[index],
        invoiceId: null,
        internalBillingTest: initialSummary.internalBillingTest,
        loadMovementId: movementId,
        loadPostingId: "93939393-9393-4393-8393-939393939301",
        organizationId: initialSummary.organizationId,
        planCode: initialSummary.planCode,
        reversalAdjustmentId: null,
        status: "recorded",
        unitCount: 1,
        updatedAt: `2026-08-20T15:0${index}:01.000Z`
      })
    )
    const allocated = billingPeriodSummarySchema.parse({
      ...initialSummary,
      includedUnits: 1,
      overageAmountCents: initialSummary.overageUnitPriceCents,
      overageUnits: 1,
      planSnapshot: {
        ...initialSummary.planSnapshot,
        includedNetworkLoadUnits: 1
      },
      usageEventIds,
      usedUnits: 2
    })
    state.billingPeriodSummaries = state.billingPeriodSummaries.map(
      (candidate) => candidate.id === allocated.id ? allocated : candidate
    )
    state.networkUsageEvents.push(...usageEvents)

    const reversed = reverseNetworkUsage(
      state,
      {
        actorUserId: ADMIN,
        platformAdminAuthorized: true,
        reason: "The included movement was never completed",
        usageEventId: usageEventIds[0]!
      },
      "2026-08-20T16:00:00.000Z"
    )

    expect(reversed.adjustment).toMatchObject({
      amountDeltaCents: -initialSummary.overageUnitPriceCents,
      invoiceId: null,
      settlementIntent: "usage_recomputed"
    })
    expect(state.networkOverageInvoices).toHaveLength(0)
  })

  it("scopes adjustment idempotency to one actor action and preserves its frozen invoice target", () => {
    const state = freshState()
    const subscription = paidAndOperating(state)
    const summary = ensureBillingPeriodSummary(
      state,
      { subscriptionId: subscription.id, usageAt: PERIOD_START },
      PERIOD_START
    )
    recordBillingAdjustment(
      state,
      {
        actorUserId: ADMIN,
        amountCents: 1_000,
        billingPeriodSummaryId: summary.id,
        idempotencyKey: "seed-first-invoice",
        platformAdminAuthorized: true,
        reason: "Seed first invoice",
        type: "manual_debit"
      },
      "2026-08-20T16:00:00.000Z"
    )
    const firstInvoice = openNetworkOverageInvoice(
      state,
      { billingPeriodSummaryId: summary.id },
      PERIOD_END
    )
    if (!("invoice" in firstInvoice)) throw new Error("Expected first invoice")
    const first = recordBillingAdjustment(
      state,
      {
        actorUserId: ADMIN,
        amountCents: 200,
        billingPeriodSummaryId: summary.id,
        idempotencyKey: "lost-response-action",
        platformAdminAuthorized: true,
        reason: "Supplemental correction",
        type: "manual_debit"
      },
      "2026-09-03T16:01:00.000Z"
    )
    expect(first.adjustment.invoiceId).toBe(firstInvoice.invoice.id)

    const secondInvoice = networkOverageInvoiceSchema.parse({
      ...firstInvoice.invoice,
      adjustmentAmountCents: 0,
      adjustmentIds: [],
      amountDueCents: 0,
      collectionAttemptCount: 0,
      createdAt: "2026-09-03T16:02:00.000Z",
      id: networkOverageInvoiceId(summary.id, 2),
      paidAt: null,
      providerAmountDueCents: null,
      providerAmountPaidCents: null,
      providerAmountRemainingCents: null,
      sequence: 2,
      status: "open",
      stripeInvoiceId: null,
      subtotalCents: 0,
      updatedAt: "2026-09-03T16:02:00.000Z",
      usageSubtotalCents: 0,
      usageEventIds: [],
      quantity: 0
    })
    state.networkOverageInvoices.push(secondInvoice)

    const retry = recordBillingAdjustment(
      state,
      {
        actorUserId: ADMIN,
        amountCents: 200,
        billingPeriodSummaryId: summary.id,
        idempotencyKey: "lost-response-action",
        platformAdminAuthorized: true,
        reason: "Supplemental correction",
        type: "manual_debit"
      },
      "2026-09-03T16:03:00.000Z"
    )
    expect(retry).toMatchObject({
      adjustment: { invoiceId: firstInvoice.invoice.id },
      changed: false
    })
    expect(() =>
      recordBillingAdjustment(
        state,
        {
          actorUserId: ADMIN,
          amountCents: 200,
          billingPeriodSummaryId: summary.id,
          idempotencyKey: "lost-response-action",
          invoiceId: secondInvoice.id,
          platformAdminAuthorized: true,
          reason: "Supplemental correction",
          type: "manual_debit"
        },
        "2026-09-03T16:04:00.000Z"
      )
    ).toThrow(/idempotency key was already used for different terms/)

    const firstScoped = recordBillingAdjustment(
      state,
      {
        actorUserId: ADMIN,
        amountCents: 200,
        billingPeriodSummaryId: summary.id,
        idempotencyKey: "one-admin-action",
        platformAdminAuthorized: true,
        reason: "One immutable action",
        type: "manual_debit"
      },
      "2026-09-03T16:05:00.000Z"
    )
    const adjustmentCount = state.billingAdjustments.length
    expect(() =>
      recordBillingAdjustment(
        state,
        {
          actorUserId: ADMIN,
          amountCents: 200,
          billingPeriodSummaryId: summary.id,
          idempotencyKey: "one-admin-action",
          invoiceId: firstInvoice.invoice.id,
          platformAdminAuthorized: true,
          reason: "One immutable action",
          type: "service_credit"
        },
        "2026-09-03T16:06:00.000Z"
      )
    ).toThrow(/idempotency key was already used for different terms/)

    const secondPeriodStart = "2026-09-03T16:00:00.000Z"
    const secondSummary = billingPeriodSummarySchema.parse({
      ...summary,
      closedAt: null,
      createdAt: secondPeriodStart,
      id: billingPeriodSummaryId(subscription.id, secondPeriodStart),
      invoiceIds: [],
      periodEnd: "2026-10-03T16:00:00.000Z",
      periodStart: secondPeriodStart,
      status: "open",
      updatedAt: secondPeriodStart,
      usageEventIds: [],
      usedUnits: 0
    })
    state.billingPeriodSummaries.push(secondSummary)
    expect(() =>
      recordBillingAdjustment(
        state,
        {
          actorUserId: ADMIN,
          amountCents: 200,
          billingPeriodSummaryId: secondSummary.id,
          idempotencyKey: "one-admin-action",
          platformAdminAuthorized: true,
          reason: "One immutable action",
          type: "manual_debit"
        },
        "2026-09-03T16:07:00.000Z"
      )
    ).toThrow(/idempotency key was already used for different terms/)
    expect(state.billingAdjustments).toHaveLength(adjustmentCount)
    expect(firstScoped.adjustment.billingPeriodSummaryId).toBe(summary.id)
  })

  it("keeps payment grace until the last attempted base or overage debt clears", () => {
    const overageFirstState = freshState()
    const overageFirstSubscription = paidAndOperating(overageFirstState)
    const overageFirstSummary = ensureBillingPeriodSummary(
      overageFirstState,
      {
        subscriptionId: overageFirstSubscription.id,
        usageAt: PERIOD_START
      },
      PERIOD_START
    )
    recordBillingAdjustment(
      overageFirstState,
      {
        actorUserId: ADMIN,
        amountCents: 1_000,
        billingPeriodSummaryId: overageFirstSummary.id,
        idempotencyKey: "overage-first-debit",
        platformAdminAuthorized: true,
        reason: "Create an overage collection target",
        type: "manual_debit"
      },
      "2026-08-20T16:00:00.000Z"
    )
    const overageFirstInvoice = openNetworkOverageInvoice(
      overageFirstState,
      { billingPeriodSummaryId: overageFirstSummary.id },
      PERIOD_END
    )
    if (!("invoice" in overageFirstInvoice)) {
      throw new Error("Expected overage invoice")
    }

    markNetworkOverageInvoiceFailed(
      overageFirstState,
      { invoiceId: overageFirstInvoice.invoice.id, reason: "Card declined" },
      "2026-09-03T16:00:00.000Z"
    )
    recordSubscriptionBaseInvoiceProviderState(
      overageFirstState,
      {
        ...baseProviderBalanceFacts(300_000, 0),
        amountDueCents: 300_000,
        amountRemainingCents: 0,
        attemptCount: 1,
        currency: "usd",
        paidAt: "2026-09-03T16:01:00.000Z",
        providerInvoiceId: "in_paidwhileoverage001",
        status: "paid",
        subscriptionId: overageFirstSubscription.id
      },
      "2026-09-03T16:01:00.000Z"
    )
    expect(
      overageFirstState.organizationSubscriptions.find(
        (candidate) => candidate.id === overageFirstSubscription.id
      )
    ).toMatchObject({
      graceState: "active",
      paymentState: "past_due",
      status: "past_due"
    })

    markNetworkOverageInvoicePaid(
      overageFirstState,
      {
        invoiceId: overageFirstInvoice.invoice.id,
        providerFacts: settledOverageProviderFacts(
          overageFirstInvoice.invoice,
          "in_overagefirst001"
        )
      },
      "2026-09-03T16:02:00.000Z"
    )
    expect(
      overageFirstState.organizationSubscriptions.find(
        (candidate) => candidate.id === overageFirstSubscription.id
      )
    ).toMatchObject({
      graceState: "none",
      paymentGraceEndsAt: null,
      paymentState: "current",
      status: "active"
    })

    const baseFirstState = freshState()
    const baseFirstSubscription = paidAndOperating(baseFirstState)
    recordSubscriptionBaseInvoiceProviderState(
      baseFirstState,
      {
        ...baseProviderBalanceFacts(300_000),
        amountDueCents: 300_000,
        amountRemainingCents: 300_000,
        attemptCount: 1,
        attemptedAt: "2026-09-03T17:00:00.000Z",
        currency: "usd",
        lastPaymentFailure: "Card declined",
        providerInvoiceId: "in_basefirst001",
        status: "open",
        subscriptionId: baseFirstSubscription.id
      },
      "2026-09-03T17:00:00.000Z"
    )
    const baseFirstSummary = ensureBillingPeriodSummary(
      baseFirstState,
      {
        subscriptionId: baseFirstSubscription.id,
        usageAt: PERIOD_START
      },
      PERIOD_START
    )
    recordBillingAdjustment(
      baseFirstState,
      {
        actorUserId: ADMIN,
        amountCents: 1_000,
        billingPeriodSummaryId: baseFirstSummary.id,
        idempotencyKey: "base-first-overage-debit",
        platformAdminAuthorized: true,
        reason: "Create a paid overage target",
        type: "manual_debit"
      },
      "2026-08-20T16:00:00.000Z"
    )
    const baseFirstOverage = openNetworkOverageInvoice(
      baseFirstState,
      { billingPeriodSummaryId: baseFirstSummary.id },
      PERIOD_END
    )
    if (!("invoice" in baseFirstOverage)) {
      throw new Error("Expected overage invoice")
    }
    markNetworkOverageInvoicePaid(
      baseFirstState,
      {
        invoiceId: baseFirstOverage.invoice.id,
        providerFacts: settledOverageProviderFacts(
          baseFirstOverage.invoice,
          "in_basefirstoverage001"
        )
      },
      "2026-09-03T17:01:00.000Z"
    )
    expect(
      baseFirstState.organizationSubscriptions.find(
        (candidate) => candidate.id === baseFirstSubscription.id
      )
    ).toMatchObject({
      graceState: "active",
      paymentState: "past_due",
      status: "past_due"
    })

    recordSubscriptionBaseInvoiceProviderState(
      baseFirstState,
      {
        ...baseProviderBalanceFacts(300_000, 0),
        amountDueCents: 300_000,
        amountRemainingCents: 0,
        attemptCount: 1,
        attemptedAt: "2026-09-03T17:00:00.000Z",
        currency: "usd",
        paidAt: "2026-09-03T17:02:00.000Z",
        providerInvoiceId: "in_basefirst001",
        status: "paid",
        subscriptionId: baseFirstSubscription.id
      },
      "2026-09-03T17:02:00.000Z"
    )
    expect(
      baseFirstState.organizationSubscriptions.find(
        (candidate) => candidate.id === baseFirstSubscription.id
      )
    ).toMatchObject({
      graceState: "none",
      paymentGraceEndsAt: null,
      paymentState: "current",
      status: "active"
    })
  })

  it("does not let an unrelated paid invoice erase provider lifecycle delinquency", () => {
    const state = freshState()
    const subscription = paidAndOperating(state)
    const summary = ensureBillingPeriodSummary(
      state,
      { subscriptionId: subscription.id, usageAt: PERIOD_START },
      PERIOD_START
    )
    recordBillingAdjustment(
      state,
      {
        actorUserId: ADMIN,
        amountCents: 1_000,
        billingPeriodSummaryId: summary.id,
        idempotencyKey: "provider-delinquency-overage-debit",
        platformAdminAuthorized: true,
        reason: "Create an unrelated overage invoice",
        type: "manual_debit"
      },
      "2026-08-20T16:00:00.000Z"
    )
    const opened = openNetworkOverageInvoice(
      state,
      { billingPeriodSummaryId: summary.id },
      PERIOD_END
    )
    if (!("invoice" in opened)) throw new Error("Expected overage invoice")

    applyOrganizationSubscriptionPaymentState(
      state,
      {
        paymentState: "past_due",
        source: "provider_subscription",
        status: "past_due",
        subscriptionId: subscription.id
      },
      "2026-09-03T18:00:00.000Z"
    )
    markNetworkOverageInvoicePaid(
      state,
      {
        invoiceId: opened.invoice.id,
        providerFacts: settledOverageProviderFacts(
          opened.invoice,
          "in_providerdelinquency001"
        )
      },
      "2026-09-03T18:01:00.000Z"
    )
    expect(
      state.organizationSubscriptions.find(
        (candidate) => candidate.id === subscription.id
      )
    ).toMatchObject({
      graceState: "active",
      paymentState: "past_due",
      providerPaymentState: "past_due",
      status: "past_due"
    })

    applyOrganizationSubscriptionPaymentState(
      state,
      {
        paymentState: "current",
        source: "provider_subscription",
        status: "active",
        subscriptionId: subscription.id
      },
      "2026-09-03T18:02:00.000Z"
    )
    expect(
      state.organizationSubscriptions.find(
        (candidate) => candidate.id === subscription.id
      )
    ).toMatchObject({
      graceState: "none",
      paymentGraceEndsAt: null,
      paymentState: "current",
      providerPaymentState: "current",
      status: "active"
    })
  })

  it("treats delayed failures after terminal provider invoice states as audited no-ops", () => {
    const state = freshState()
    const subscription = paidAndOperating(state)
    const summary = ensureBillingPeriodSummary(
      state,
      { subscriptionId: subscription.id, usageAt: PERIOD_START },
      PERIOD_START
    )
    recordBillingAdjustment(
      state,
      {
        actorUserId: ADMIN,
        amountCents: 1_000,
        billingPeriodSummaryId: summary.id,
        idempotencyKey: "terminal-overage-debit",
        platformAdminAuthorized: true,
        reason: "Create a terminal overage invoice",
        type: "manual_debit"
      },
      "2026-08-20T16:00:00.000Z"
    )
    const opened = openNetworkOverageInvoice(
      state,
      { billingPeriodSummaryId: summary.id },
      PERIOD_END
    )
    if (!("invoice" in opened)) throw new Error("Expected overage invoice")
    const settledFacts = settledOverageProviderFacts(
      opened.invoice,
      "in_terminaloverage001"
    )
    markNetworkOverageInvoicePaid(
      state,
      {
        invoiceId: opened.invoice.id,
        providerFacts: settledFacts
      },
      "2026-09-03T19:00:00.000Z"
    )
    const delayedFailure = markNetworkOverageInvoiceFailed(
      state,
      {
        invoiceId: opened.invoice.id,
        providerFacts: {
          ...settledFacts,
          providerAmountPaidCents: 0,
          providerAmountRemainingCents:
            settledFacts.providerAmountDueCents
        },
        reason: "Delayed payment_failed delivery"
      },
      "2026-09-03T19:01:00.000Z"
    )
    expect(delayedFailure).toMatchObject({
      changed: false,
      invoice: { status: "paid" }
    })
    expect(
      state.auditEvents.filter(
        (event) =>
          event.action ===
            "network_overage_invoice_stale_failure_ignored" &&
          event.entityId === opened.invoice.id
      )
    ).toHaveLength(1)

    recordSubscriptionBaseInvoiceProviderState(
      state,
      {
        ...baseProviderBalanceFacts(300_000, 0),
        amountDueCents: 300_000,
        amountRemainingCents: 0,
        attemptCount: 2,
        currency: "usd",
        paidAt: "2026-09-03T19:02:00.000Z",
        providerInvoiceId: "in_terminalbase001",
        status: "paid",
        subscriptionId: subscription.id
      },
      "2026-09-03T19:02:00.000Z"
    )
    const delayedBaseFailure =
      recordSubscriptionBaseInvoiceProviderState(
        state,
        {
          ...baseProviderBalanceFacts(300_000),
          amountDueCents: 300_000,
          amountRemainingCents: 300_000,
          attemptCount: 1,
          currency: "usd",
          lastPaymentFailure: "Delayed payment_failed delivery",
          providerInvoiceId: "in_terminalbase001",
          status: "open",
          subscriptionId: subscription.id
        },
        "2026-09-03T19:03:00.000Z"
      )
    expect(delayedBaseFailure).toMatchObject({
      changed: false,
      invoice: { status: "paid" }
    })

    recordSubscriptionBaseInvoiceProviderState(
      state,
      {
        ...baseProviderBalanceFacts(300_000),
        amountDueCents: 300_000,
        amountRemainingCents: 300_000,
        attemptCount: 2,
        currency: "usd",
        lastPaymentFailure: "Collection exhausted",
        providerInvoiceId: "in_terminaluncollectible001",
        status: "uncollectible",
        subscriptionId: subscription.id
      },
      "2026-09-03T19:04:00.000Z"
    )
    const delayedOpen = recordSubscriptionBaseInvoiceProviderState(
      state,
      {
        ...baseProviderBalanceFacts(300_000),
        amountDueCents: 300_000,
        amountRemainingCents: 300_000,
        attemptCount: 1,
        currency: "usd",
        lastPaymentFailure: "Older open state",
        providerInvoiceId: "in_terminaluncollectible001",
        status: "open",
        subscriptionId: subscription.id
      },
      "2026-09-03T19:05:00.000Z"
    )
    expect(delayedOpen).toMatchObject({
      changed: false,
      invoice: { status: "uncollectible" }
    })
    expect(
      state.auditEvents.filter(
        (event) =>
          event.action ===
            "subscription_base_invoice_stale_failure_ignored"
      )
    ).toHaveLength(2)
  })

  it("reconciles exact credit and supplemental facts idempotently", () => {
    const state = freshState()
    const subscription = paidAndOperating(state)
    const summary = ensureBillingPeriodSummary(
      state,
      { subscriptionId: subscription.id, usageAt: PERIOD_START },
      PERIOD_START
    )
    const opened = openNetworkOverageInvoice(
      state,
      { billingPeriodSummaryId: summary.id },
      PERIOD_END
    )
    expect(opened.outcome).toBe("nothing_to_bill")

    recordBillingAdjustment(
      state,
      {
        actorUserId: ADMIN,
        amountCents: 1_000,
        billingPeriodSummaryId: summary.id,
        idempotencyKey: "invoice-seed-debit",
        platformAdminAuthorized: true,
        reason: "Seed finalized adjustment invoice",
        type: "manual_debit"
      },
      "2026-08-20T16:01:00.000Z"
    )
    const finalInvoice = openNetworkOverageInvoice(
      state,
      { billingPeriodSummaryId: summary.id },
      PERIOD_END
    )
    expect(finalInvoice.outcome).toBe("opened")
    if (!("invoice" in finalInvoice)) throw new Error("Expected invoice")

    const credit = recordBillingAdjustment(
      state,
      {
        actorUserId: ADMIN,
        amountCents: 600,
        billingPeriodSummaryId: summary.id,
        idempotencyKey: "post-final-credit",
        invoiceId: finalInvoice.invoice.id,
        platformAdminAuthorized: true,
        reason: "Unpaid receivable correction",
        type: "service_credit"
      },
      "2026-09-03T16:01:00.000Z"
    ).adjustment
    const creditSettlement =
      recordBillingAdjustmentProviderSettlement(
        state,
        {
          adjustmentId: credit.id,
          postPaymentAmountCents: 0,
          prePaymentAmountCents: 600,
          providerReference: "cn_unpaid001",
          refundedAmountCents: 0,
          settlementIntent: "credit_note",
          totalAmountCents: 600
        },
        "2026-09-03T16:02:00.000Z"
      )

    expect(creditSettlement.adjustment).toMatchObject({
      providerRevenueDeltaCents: 0,
      providerSettlementAmountCents: 600,
      providerSettlementAttemptCount: 1,
      providerSettlementRemainingCents: 0,
      providerSettlementState: "settled"
    })
    expect(
      recordBillingAdjustmentProviderSettlement(
        state,
        {
          adjustmentId: credit.id,
          postPaymentAmountCents: 0,
          prePaymentAmountCents: 600,
          providerReference: "cn_unpaid001",
          refundedAmountCents: 0,
          settlementIntent: "credit_note",
          totalAmountCents: 600
        },
        "2026-09-03T16:03:00.000Z"
      )
    ).toMatchObject({ changed: false })
    expect(() =>
      recordBillingAdjustmentProviderSettlement(
        state,
        {
          adjustmentId: credit.id,
          postPaymentAmountCents: 1,
          prePaymentAmountCents: 599,
          providerReference: "cn_unpaid001",
          refundedAmountCents: 1,
          settlementIntent: "credit_note",
          totalAmountCents: 600
        },
        "2026-09-03T16:04:00.000Z"
      )
    ).toThrow(/already settled with different provider facts/)

    const supplemental = recordBillingAdjustment(
      state,
      {
        actorUserId: ADMIN,
        amountCents: 800,
        billingPeriodSummaryId: summary.id,
        idempotencyKey: "post-final-debit",
        invoiceId: finalInvoice.invoice.id,
        platformAdminAuthorized: true,
        reason: "Post-final debit",
        type: "manual_debit"
      },
      "2026-09-03T16:05:00.000Z"
    ).adjustment
    const partial = recordBillingAdjustmentProviderSettlement(
      state,
      {
        adjustmentId: supplemental.id,
        amountDueCents: 800,
        amountPaidCents: 300,
        amountRemainingCents: 500,
        providerReference: "in_supplemental001",
        settlementIntent: "supplemental_debit"
      },
      "2026-09-03T16:06:00.000Z"
    )
    expect(partial.adjustment).toMatchObject({
      providerRevenueDeltaCents: 300,
      providerSettlementRemainingCents: 500,
      providerSettlementState: "outstanding"
    })
    expect(
      recordBillingAdjustmentProviderSettlementFailure(
        state,
        {
          adjustmentId: supplemental.id,
          reason: "Provider read temporarily unavailable"
        },
        "2026-09-03T16:07:00.000Z"
      ).adjustment
    ).toMatchObject({
      providerRevenueDeltaCents: 300,
      providerSettlementAttemptCount: 2,
      providerSettlementRemainingCents: 500,
      providerSettlementState: "failed"
    })
    const paid = recordBillingAdjustmentProviderSettlement(
      state,
      {
        adjustmentId: supplemental.id,
        amountDueCents: 800,
        amountPaidCents: 800,
        amountRemainingCents: 0,
        providerReference: "in_supplemental001",
        settlementIntent: "supplemental_debit"
      },
      "2026-09-03T16:08:00.000Z"
    )
    expect(paid.adjustment).toMatchObject({
      providerRevenueDeltaCents: 800,
      providerSettlementAttemptCount: 3,
      providerSettlementRemainingCents: 0,
      providerSettlementState: "settled"
    })
  })

  it("stores exact recurring invoice state and retries the billing email outbox", () => {
    const state = freshState()
    const subscription = paidAndOperating(state)
    const open = recordSubscriptionBaseInvoiceProviderState(
      state,
      {
        ...baseProviderBalanceFacts(300_000),
        amountDueCents: 300_000,
        amountRemainingCents: 300_000,
        attemptCount: 1,
        currency: "usd",
        lastPaymentFailure: "Card declined",
        providerInvoiceId: "in_monthly001",
        status: "open",
        subscriptionId: subscription.id
      },
      "2026-09-03T16:00:00.000Z"
    )

    expect(open.invoice.currency).toBe("USD")
    expect(open.invoice.amountRemainingCents).toBe(300_000)
    const notification = state.notifications.find(
      (candidate) =>
        candidate.relatedEntityId === open.invoice.id &&
        candidate.emailDeliveryState === "pending"
    )
    expect(notification).toBeDefined()
    const firstClaim = claimBillingNotificationEmail(
      state,
      {
        claimToken: "worker-attempt-1",
        notificationId: notification?.id as string
      },
      "2026-09-03T16:01:00.000Z"
    )
    expect(firstClaim.notification.emailAttemptCount).toBe(1)
    expect(firstClaim.recipient).toMatchObject({
      organizationId: HOST
    })
    markBillingNotificationEmailFailed(
      state,
      {
        claimToken: "worker-attempt-1",
        notificationId: notification?.id as string,
        reason: "Transient provider failure"
      },
      "2026-09-03T16:02:00.000Z"
    )
    const secondClaim = claimBillingNotificationEmail(
      state,
      {
        claimToken: "worker-attempt-2",
        notificationId: notification?.id as string
      },
      "2026-09-03T16:03:00.000Z"
    )
    expect(secondClaim.notification.emailAttemptCount).toBe(2)
    const delivered = markBillingNotificationEmailDelivered(
      state,
      {
        claimToken: "worker-attempt-2",
        notificationId: notification?.id as string,
        providerMessageId: "email_123"
      },
      "2026-09-03T16:04:00.000Z"
    )
    expect(delivered.notification.emailDeliveryState).toBe("delivered")
  })

  it("denies cross-organization notification relations and caps delivery claims at five", () => {
    const crossState = freshState()
    const crossSubscription = paidAndOperating(crossState)
    const crossSummary = ensureBillingPeriodSummary(
      crossState,
      {
        subscriptionId: crossSubscription.id,
        usageAt: PERIOD_START
      },
      PERIOD_START
    )
    const adjustment = recordBillingAdjustment(
      crossState,
      {
        actorUserId: ADMIN,
        amountCents: 1_000,
        billingPeriodSummaryId: crossSummary.id,
        idempotencyKey: "cross-org-email",
        platformAdminAuthorized: true,
        reason: "Test recipient relationship",
        type: "manual_debit"
      },
      "2026-08-20T16:00:00.000Z"
    ).adjustment
    const adjustmentNotification = crossState.notifications.find(
      (candidate) =>
        candidate.relatedEntityId === adjustment.id &&
        candidate.emailDeliveryState === "pending"
    )
    const storedAdjustment = crossState.billingAdjustments.find(
      (candidate) => candidate.id === adjustment.id
    )
    if (!adjustmentNotification || !storedAdjustment) {
      throw new Error("Billing adjustment notification fixture missing")
    }
    storedAdjustment.organizationId = FLEET

    expect(
      claimBillingNotificationEmail(
        crossState,
        {
          claimToken: "cross-org-claim",
          notificationId: adjustmentNotification.id
        },
        "2026-08-20T16:01:00.000Z"
      )
    ).toMatchObject({
      recipient: null,
      recipientBlockReason:
        "The billing notification recipient is no longer authorized."
    })

    const retryState = freshState()
    const retrySubscription = paidAndOperating(retryState)
    const open = recordSubscriptionBaseInvoiceProviderState(
      retryState,
      {
        ...baseProviderBalanceFacts(300_000),
        amountDueCents: 300_000,
        amountRemainingCents: 300_000,
        attemptCount: 1,
        currency: "usd",
        lastPaymentFailure: "Card declined",
        providerInvoiceId: "in_retrylimit001",
        status: "open",
        subscriptionId: retrySubscription.id
      },
      "2026-09-03T16:00:00.000Z"
    )
    const retryNotification = retryState.notifications.find(
      (candidate) =>
        candidate.relatedEntityId === open.invoice.id &&
        candidate.emailDeliveryState === "pending"
    )
    if (!retryNotification) {
      throw new Error("Billing email retry fixture missing")
    }

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const claimToken = `retry-limit-${attempt}`
      const claimed = claimBillingNotificationEmail(
        retryState,
        {
          claimToken,
          notificationId: retryNotification.id
        },
        `2026-09-03T16:${String(attempt).padStart(2, "0")}:00.000Z`
      )

      expect(claimed.notification.emailAttemptCount).toBe(attempt)
      markBillingNotificationEmailFailed(
        retryState,
        {
          claimToken,
          notificationId: retryNotification.id,
          reason: "Transient provider failure"
        },
        `2026-09-03T16:${String(attempt).padStart(2, "0")}:30.000Z`
      )
    }

    expect(() =>
      claimBillingNotificationEmail(
        retryState,
        {
          claimToken: "retry-limit-6",
          notificationId: retryNotification.id
        },
        "2026-09-03T16:06:00.000Z"
      )
    ).toThrow(/exhausted its delivery attempts/)
  })
})
