import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    readonly headers?: HeadersInit
    readonly status: number

    constructor(message: string, status: number, headers?: HeadersInit) {
      super(message)
      this.name = "ApiError"
      this.headers = headers
      this.status = status
    }
  }

  return {
    ApiError,
    activateOrganizationSubscription: vi.fn(),
    authorizePilotConversionSubscription: vi.fn(),
    captureServerEvent: vi.fn(),
    configureOrganizationSubscription: vi.fn(),
    enforceApiRateLimit: vi.fn(),
    mutateState: vi.fn(),
    reconcileMissingNetworkUsageAsPlatformAdmin: vi.fn(),
    recordBillingAdjustment: vi.fn(),
    refresh: vi.fn(),
    requireAdminApiActor: vi.fn(),
    retirePaidDispatchEntitlementForSubscription: vi.fn(),
    reverseNetworkUsage: vi.fn(),
    scheduleOrganizationSubscriptionNonRenewal: vi.fn(),
    scheduleOrganizationSubscriptionPlanChange: vi.fn()
  }
})

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh })
}))
vi.mock("@/components/v3/Shells", () => ({
  SectionHeader: () => null
}))
vi.mock("@/lib/api-actor", () => ({
  ApiError: mocks.ApiError,
  apiErrorResponse(error: unknown) {
    if (error instanceof mocks.ApiError) {
      return Response.json(
        { error: error.message },
        { headers: error.headers, status: error.status }
      )
    }

    if (error instanceof Error && error.name === "ZodError") {
      return Response.json(
        { error: "The request had missing or invalid fields." },
        { status: 422 }
      )
    }

    return Response.json(
      { error: "We could not complete that request." },
      { status: 500 }
    )
  },
  enforceApiRateLimit: mocks.enforceApiRateLimit,
  requireAdminApiActor: mocks.requireAdminApiActor
}))
vi.mock("@/lib/analytics", () => ({
  captureServerEvent: mocks.captureServerEvent
}))
vi.mock("@/lib/services", () => ({ mutateState: mocks.mutateState }))

import { POST } from "@/app/api/admin/billing/actions/route"
import {
  AdminBillingActions,
  buildAdminBillingActionPayload,
  buildInternalBillingSmokePayload
} from "@/components/v3/AdminBillingActions"

const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ACCEPTOR_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const ORGANIZATION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const SUBSCRIPTION_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
const LANDING_ID = "55555555-5555-4555-8555-555555555555"
const SUMMARY_ID = "11111111-1111-4111-8111-111111111111"
const USAGE_ID = "20202020-2020-4020-8020-202020202020"
const ENTITLEMENT_ID = "33333333-3333-4333-8333-333333333333"
const IDEMPOTENCY_KEY = "44444444-4444-4444-8444-444444444444"
const ACCEPTED_AT = "2026-07-28T18:00:00.000Z"
const EFFECTIVE_AT = "2027-07-28T18:00:00.000Z"
const ENTERPRISE_TERMS = {
  baseMonthlyPriceCents: 2_500_000,
  commitmentMonths: 24,
  definedIntegrations: ["Dispatch ERP feed", "Scale ticket export"],
  includedNetworkLoadUnits: 300,
  includesDispatchProCapabilities: true,
  overageUnitPriceCents: 9_500,
  serviceSupportObligations:
    "Named launch manager and weekday priority support with a four-hour response target.",
  stripeOveragePriceId: "price_EnterpriseOverage1",
  stripePriceId: "price_EnterpriseBase1",
  stripeProductId: "prod_Enterprise1"
} as const

const summary = {
  id: SUMMARY_ID,
  internalBillingTest: false,
  organizationId: ORGANIZATION_ID,
  planCode: "network_pilot"
}
const usageEvent = {
  id: USAGE_ID,
  internalBillingTest: false,
  organizationId: ORGANIZATION_ID,
  planCode: "network_pilot"
}
const facade = {
  activateOrganizationSubscription: mocks.activateOrganizationSubscription,
  authorizePilotConversionSubscription:
    mocks.authorizePilotConversionSubscription,
  configureOrganizationSubscription: mocks.configureOrganizationSubscription,
  reconcileMissingNetworkUsageAsPlatformAdmin:
    mocks.reconcileMissingNetworkUsageAsPlatformAdmin,
  recordBillingAdjustment: mocks.recordBillingAdjustment,
  retirePaidDispatchEntitlementForSubscription:
    mocks.retirePaidDispatchEntitlementForSubscription,
  reverseNetworkUsage: mocks.reverseNetworkUsage,
  scheduleOrganizationSubscriptionNonRenewal:
    mocks.scheduleOrganizationSubscriptionNonRenewal,
  scheduleOrganizationSubscriptionPlanChange:
    mocks.scheduleOrganizationSubscriptionPlanChange
}

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request("https://logloads.test/api/admin/billing/actions", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  })
}

function configuredSubscriptionBody(): Record<string, unknown> {
  return {
    acceptedAt: ACCEPTED_AT,
    acceptedByUserId: ACCEPTOR_ID,
    acceptedTermsVersion: "network-v1-2026-07-28",
    action: "configure_subscription",
    confirm: "CONFIGURE_ACCEPTED_SUBSCRIPTION",
    operatingMarketIds: [LANDING_ID],
    organizationId: ORGANIZATION_ID,
    overageMilestoneIntervalUnits: 10,
    paymentGraceDays: 7,
    planCode: "network_pilot"
  }
}

function retiredWriteBodies(): Array<{
  body: Record<string, unknown>
  name: string
}> {
  return [
    { body: configuredSubscriptionBody(), name: "configuration" },
    {
      body: {
        action: "activate_subscription",
        confirm: "AUTHORIZE_PAID_ACTIVATION",
        organizationId: ORGANIZATION_ID,
        subscriptionId: SUBSCRIPTION_ID
      },
      name: "activation"
    },
    {
      body: {
        acceptedAt: ACCEPTED_AT,
        acceptedByUserId: ACCEPTOR_ID,
        acceptedTermsVersion: "enterprise-v1-2026-07-28",
        action: "authorize_pilot_enterprise_conversion",
        confirm: "AUTHORIZE_PILOT_ENTERPRISE_CONVERSION",
        negotiatedTerms: ENTERPRISE_TERMS,
        operatingMarketIds: [LANDING_ID],
        sourceSubscriptionId: SUBSCRIPTION_ID
      },
      name: "conversion"
    },
    {
      body: {
        action: "schedule_plan_change",
        confirm: "SCHEDULE_PLAN_CHANGE",
        effectiveAt: EFFECTIVE_AT,
        nextOperatingMarketIds: [LANDING_ID],
        nextPlanCode: "network_25",
        subscriptionId: SUBSCRIPTION_ID
      },
      name: "plan change"
    }
  ]
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAdminApiActor.mockResolvedValue({
    isPlatformAdmin: true,
    profile: { id: ADMIN_ID }
  })
  mocks.enforceApiRateLimit.mockResolvedValue(undefined)
  mocks.mutateState.mockImplementation(
    async (mutate: (draft: typeof facade) => unknown) => mutate(facade)
  )
  mocks.scheduleOrganizationSubscriptionNonRenewal.mockReturnValue({
    changed: true
  })
  mocks.recordBillingAdjustment.mockReturnValue({
    adjustment: { organizationId: ORGANIZATION_ID },
    changed: true,
    summary
  })
  mocks.reverseNetworkUsage.mockReturnValue({
    event: usageEvent,
    outcome: "reversed",
    summary
  })
  mocks.retirePaidDispatchEntitlementForSubscription.mockReturnValue({
    changed: true
  })
  mocks.reconcileMissingNetworkUsageAsPlatformAdmin.mockReturnValue([
    {
      eventId: USAGE_ID,
      internalBillingTest: false,
      newlyEmittedThresholds: [],
      organizationId: ORGANIZATION_ID,
      outcome: "recorded",
      planCode: "network_pilot"
    }
  ])
})

describe("retired admin subscription writes", () => {
  it("requires platform-admin authentication before parsing or mutation", async () => {
    mocks.requireAdminApiActor.mockRejectedValue(
      new mocks.ApiError("Platform access required", 403)
    )

    const response = await POST(jsonRequest(configuredSubscriptionBody()))

    expect(response.status).toBe(403)
    expect(mocks.mutateState).not.toHaveBeenCalled()
  })

  it.each(retiredWriteBodies())(
    "returns 410 without mutating for retired $name",
    async ({ body }) => {
      const response = await POST(jsonRequest(body))

      expect(response.status).toBe(410)
      await expect(response.json()).resolves.toEqual({
        error:
          "Subscription billing writes are closed. Existing records remain available for historical reconciliation."
      })
      expect(mocks.mutateState).not.toHaveBeenCalled()
      expect(mocks.captureServerEvent).not.toHaveBeenCalled()
    }
  )
})

describe("historical subscription reconciliation API", () => {
  it("schedules non-renewal without creating a replacement plan", async () => {
    const response = await POST(
      jsonRequest({
        action: "schedule_non_renewal",
        confirm: "SCHEDULE_NON_RENEWAL",
        effectiveAt: EFFECTIVE_AT,
        subscriptionId: SUBSCRIPTION_ID
      })
    )

    expect(response.status).toBe(200)
    expect(
      mocks.scheduleOrganizationSubscriptionNonRenewal
    ).toHaveBeenCalledWith({
      actorUserId: ADMIN_ID,
      effectiveAt: EFFECTIVE_AT,
      platformAdminAuthorized: true,
      subscriptionId: SUBSCRIPTION_ID
    })
  })

  it("records an adjustment against an existing frozen summary", async () => {
    const response = await POST(
      jsonRequest({
        action: "record_adjustment",
        adjustmentType: "manual_debit",
        amountCents: 1_250,
        billingPeriodSummaryId: SUMMARY_ID,
        confirm: "RECORD_BILLING_ADJUSTMENT",
        idempotencyKey: IDEMPOTENCY_KEY,
        invoiceId: null,
        reason: "Historical contract correction"
      })
    )

    expect(response.status).toBe(200)
    expect(mocks.recordBillingAdjustment).toHaveBeenCalledWith({
      actorUserId: ADMIN_ID,
      amountCents: 1_250,
      billingPeriodSummaryId: SUMMARY_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      invoiceId: null,
      platformAdminAuthorized: true,
      reason: "Historical contract correction",
      type: "manual_debit"
    })
  })

  it("reverses one existing frozen usage record", async () => {
    const response = await POST(
      jsonRequest({
        action: "reverse_usage",
        confirm: "REVERSE_NETWORK_USAGE",
        reason: "Duplicate historical completion",
        usageEventId: USAGE_ID
      })
    )

    expect(response.status).toBe(200)
    expect(mocks.reverseNetworkUsage).toHaveBeenCalledWith({
      actorUserId: ADMIN_ID,
      platformAdminAuthorized: true,
      reason: "Duplicate historical completion",
      usageEventId: USAGE_ID
    })
  })

  it("retires a paid Dispatch entitlement only with provider evidence", async () => {
    const response = await POST(
      jsonRequest({
        action: "retire_dispatch_entitlement",
        confirm: "RETIRE_PAID_DISPATCH_ENTITLEMENT",
        entitlementId: ENTITLEMENT_ID,
        organizationId: ORGANIZATION_ID,
        providerCancellationReference: "provider-cancelled-2026-08-03"
      })
    )

    expect(response.status).toBe(200)
    expect(
      mocks.retirePaidDispatchEntitlementForSubscription
    ).toHaveBeenCalledWith({
      actorUserId: ADMIN_ID,
      entitlementId: ENTITLEMENT_ID,
      organizationId: ORGANIZATION_ID,
      platformAdminAuthorized: true,
      providerCancellationReference: "provider-cancelled-2026-08-03"
    })
  })

  it("runs bounded missing-usage reconciliation for historical records", async () => {
    const response = await POST(
      jsonRequest({
        action: "reconcile_missing_usage",
        confirm: "RUN_MISSING_USAGE_RECONCILIATION"
      })
    )

    expect(response.status).toBe(200)
    expect(
      mocks.reconcileMissingNetworkUsageAsPlatformAdmin
    ).toHaveBeenCalledWith({
      actorUserId: ADMIN_ID,
      platformAdminAuthorized: true
    })
    expect(mocks.enforceApiRateLimit).toHaveBeenNthCalledWith(
      2,
      "admin-billing-usage-reconciliation",
      ADMIN_ID,
      2,
      600_000
    )
  })

  it("returns a safe conflict without analytics when canonical state rejects a repair", async () => {
    mocks.reverseNetworkUsage.mockImplementation(() => {
      throw new Error("Cross-wired organization reference")
    })

    const response = await POST(
      jsonRequest({
        action: "reverse_usage",
        confirm: "REVERSE_NETWORK_USAGE",
        reason: "Duplicate historical completion",
        usageEventId: USAGE_ID
      })
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error:
        "This billing action conflicts with current canonical state. Refresh and try again."
    })
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
  })
})

describe("admin billing form contracts", () => {
  it("builds exact payloads for preserved historical controls", () => {
    const nonRenewal = new FormData()
    nonRenewal.set("effectiveAt", EFFECTIVE_AT)
    nonRenewal.set("subscriptionId", SUBSCRIPTION_ID)
    const adjustment = new FormData()
    adjustment.set("adjustmentType", "service_credit")
    adjustment.set("amountCents", "1250")
    adjustment.set("billingPeriodSummaryId", SUMMARY_ID)
    adjustment.set("invoiceId", "")
    adjustment.set("reason", "Historical service correction")
    const reversal = new FormData()
    reversal.set("reason", "Duplicate historical completion")
    reversal.set("usageEventId", USAGE_ID)
    const retirement = new FormData()
    retirement.set("entitlementId", ENTITLEMENT_ID)
    retirement.set("organizationId", ORGANIZATION_ID)
    retirement.set(
      "providerCancellationReference",
      "provider-cancelled-2026-08-03"
    )

    expect(
      buildAdminBillingActionPayload("schedule_non_renewal", nonRenewal)
    ).toEqual({
      action: "schedule_non_renewal",
      confirm: "SCHEDULE_NON_RENEWAL",
      effectiveAt: EFFECTIVE_AT,
      subscriptionId: SUBSCRIPTION_ID
    })
    expect(
      buildAdminBillingActionPayload(
        "record_adjustment",
        adjustment,
        IDEMPOTENCY_KEY
      )
    ).toEqual({
      action: "record_adjustment",
      adjustmentType: "service_credit",
      amountCents: 1_250,
      billingPeriodSummaryId: SUMMARY_ID,
      confirm: "RECORD_BILLING_ADJUSTMENT",
      idempotencyKey: IDEMPOTENCY_KEY,
      invoiceId: null,
      reason: "Historical service correction"
    })
    expect(buildAdminBillingActionPayload("reverse_usage", reversal)).toEqual({
      action: "reverse_usage",
      confirm: "REVERSE_NETWORK_USAGE",
      reason: "Duplicate historical completion",
      usageEventId: USAGE_ID
    })
    expect(
      buildAdminBillingActionPayload(
        "retire_dispatch_entitlement",
        retirement
      )
    ).toEqual({
      action: "retire_dispatch_entitlement",
      confirm: "RETIRE_PAID_DISPATCH_ENTITLEMENT",
      entitlementId: ENTITLEMENT_ID,
      organizationId: ORGANIZATION_ID,
      providerCancellationReference: "provider-cancelled-2026-08-03"
    })
    expect(
      buildAdminBillingActionPayload(
        "reconcile_missing_usage",
        new FormData()
      )
    ).toEqual({
      action: "reconcile_missing_usage",
      confirm: "RUN_MISSING_USAGE_RECONCILIATION"
    })
  })

  it("uses exact server confirmations for manual live-provider smoke actions", () => {
    const charge = new FormData()
    const refund = new FormData()
    charge.set("confirm", "CHARGE_ONE_DOLLAR")
    charge.set("organizationId", ORGANIZATION_ID)
    refund.set("confirm", "REFUND_ONE_DOLLAR")

    expect(buildInternalBillingSmokePayload("charge", charge)).toEqual({
      action: "charge",
      confirm: "CHARGE_ONE_DOLLAR",
      organizationId: ORGANIZATION_ID
    })
    expect(buildInternalBillingSmokePayload("refund", refund)).toEqual({
      action: "refund",
      confirm: "REFUND_ONE_DOLLAR"
    })
  })

  it("renders only preserved historical controls and isolates live money", () => {
    vi.stubGlobal("React", React)
    const markup = renderToStaticMarkup(
      React.createElement(AdminBillingActions, {
        periodSummaryOptions: [],
        subscriptionOptions: [],
        usageOptions: []
      })
    )

    expect(markup).toContain("reconcile or terminate obligations already accepted")
    expect(markup).toContain("Schedule non-renewal")
    expect(markup).toContain("Record credit or debit")
    expect(markup).toContain("Reverse one usage unit")
    expect(markup).toContain("Retire overlapping Dispatch entitlement")
    expect(markup).toContain("Reconcile missing Network usage")
    expect(markup).not.toContain("Record accepted subscription plan")
    expect(markup).not.toContain("Authorize paid activation")
    expect(markup).not.toContain("Authorize Pilot conversion to Enterprise")
    expect(markup).not.toContain("Schedule end-of-commitment plan change")
    expect(markup).toContain("the only actions on this page that call Stripe")
    expect(markup).toContain("CHARGE_ONE_DOLLAR")
    expect(markup).toContain("REFUND_ONE_DOLLAR")
  })
})
