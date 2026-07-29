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
import { ADMIN_BILLING_ACTION_BODY_LIMIT_BYTES } from "@/lib/admin-billing-action-request"
import {
  AdminBillingActions,
  buildAdminBillingActionPayload,
  buildInternalBillingSmokePayload
} from "@/components/v3/AdminBillingActions"

const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ACCEPTOR_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const ORGANIZATION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const OTHER_ORGANIZATION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const SUBSCRIPTION_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
const PRIMARY_LANDING_ID = "55555555-5555-4555-8555-555555555555"
const SECONDARY_LANDING_ID = "66666666-6666-4666-8666-666666666666"
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

const subscription = {
  id: SUBSCRIPTION_ID,
  internalBillingTest: false,
  organizationId: ORGANIZATION_ID,
  pendingPlanCode: null,
  planCode: "network_pilot"
}
const summary = {
  id: SUMMARY_ID,
  internalBillingTest: false,
  organizationId: ORGANIZATION_ID,
  planCode: "network_pilot"
}
const event = {
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

function jsonRequest(
  body: Record<string, unknown>,
  headers: HeadersInit = {}
): Request {
  return new Request("https://logloads.test/api/admin/billing/actions", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
    method: "POST"
  })
}

function configureBody(overrides: Record<string, unknown> = {}) {
  return {
    acceptedAt: ACCEPTED_AT,
    acceptedByUserId: ACCEPTOR_ID,
    acceptedTermsVersion: "network-v1-2026-07-28",
    action: "configure_subscription",
    confirm: "CONFIGURE_ACCEPTED_SUBSCRIPTION",
    operatingMarketIds: [PRIMARY_LANDING_ID],
    organizationId: ORGANIZATION_ID,
    overageMilestoneIntervalUnits: 10,
    paymentGraceDays: 7,
    planCode: "network_pilot",
    ...overrides
  }
}

function dispatchConfigureBody(overrides: Record<string, unknown> = {}) {
  const {
    operatingMarketIds: _operatingMarketIds,
    ...base
  } = configureBody()
  void _operatingMarketIds

  return {
    ...base,
    planCode: "dispatch_pro",
    ...overrides
  }
}

function enterpriseConfigureBody(overrides: Record<string, unknown> = {}) {
  return configureBody({
    negotiatedTerms: ENTERPRISE_TERMS,
    operatingMarketIds: [PRIMARY_LANDING_ID, SECONDARY_LANDING_ID],
    planCode: "enterprise_250_plus",
    ...overrides
  })
}

function fixedPlanChangeBody(overrides: Record<string, unknown> = {}) {
  return {
    action: "schedule_plan_change",
    confirm: "SCHEDULE_PLAN_CHANGE",
    effectiveAt: EFFECTIVE_AT,
    nextOperatingMarketIds: [PRIMARY_LANDING_ID],
    nextPlanCode: "network_25",
    subscriptionId: SUBSCRIPTION_ID,
    ...overrides
  }
}

function enterprisePlanChangeBody(
  overrides: Record<string, unknown> = {}
) {
  return fixedPlanChangeBody({
    negotiatedTerms: ENTERPRISE_TERMS,
    nextOperatingMarketIds: [PRIMARY_LANDING_ID, SECONDARY_LANDING_ID],
    nextPlanCode: "enterprise_250_plus",
    ...overrides
  })
}

function enterprisePilotConversionBody(
  overrides: Record<string, unknown> = {}
) {
  return {
    acceptedAt: ACCEPTED_AT,
    acceptedByUserId: ACCEPTOR_ID,
    acceptedTermsVersion: "enterprise-v1-2026-07-28",
    action: "authorize_pilot_enterprise_conversion",
    confirm: "AUTHORIZE_PILOT_ENTERPRISE_CONVERSION",
    negotiatedTerms: ENTERPRISE_TERMS,
    operatingMarketIds: [
      PRIMARY_LANDING_ID,
      SECONDARY_LANDING_ID
    ],
    sourceSubscriptionId: SUBSCRIPTION_ID,
    ...overrides
  }
}

describe("admin billing action API", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireAdminApiActor.mockResolvedValue({
      profile: { id: ADMIN_ID }
    })
    mocks.enforceApiRateLimit.mockResolvedValue(undefined)
    mocks.mutateState.mockImplementation(
      async (mutate: (draft: typeof facade) => unknown) => mutate(facade)
    )
    mocks.configureOrganizationSubscription.mockReturnValue({
      changed: true,
      subscription
    })
    mocks.activateOrganizationSubscription.mockReturnValue({
      changed: true,
      subscription
    })
    mocks.authorizePilotConversionSubscription.mockReturnValue({
      account: {},
      changed: true,
      sourceSubscription: subscription,
      targetSubscription: {
        ...subscription,
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef",
        planCode: "enterprise_250_plus"
      }
    })
    mocks.scheduleOrganizationSubscriptionPlanChange.mockReturnValue({
      changed: true,
      subscription: { ...subscription, pendingPlanCode: "network_25" }
    })
    mocks.scheduleOrganizationSubscriptionNonRenewal.mockReturnValue({
      changed: true,
      subscription
    })
    mocks.recordBillingAdjustment.mockReturnValue({
      adjustment: { organizationId: ORGANIZATION_ID },
      changed: true,
      summary
    })
    mocks.reverseNetworkUsage.mockReturnValue({
      event,
      outcome: "reversed",
      summary
    })
    mocks.retirePaidDispatchEntitlementForSubscription.mockReturnValue({
      changed: true,
      entitlement: { id: ENTITLEMENT_ID }
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

  it("requires a platform admin before parsing or mutating billing state", async () => {
    mocks.requireAdminApiActor.mockRejectedValue(
      new mocks.ApiError("Platform access required", 403)
    )

    const response = await POST(jsonRequest(configureBody()))

    expect(response.status).toBe(403)
    expect(mocks.enforceApiRateLimit).not.toHaveBeenCalled()
    expect(mocks.mutateState).not.toHaveBeenCalled()
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
  })

  it("enforces the action rate limit before reading or mutating the body", async () => {
    mocks.enforceApiRateLimit.mockRejectedValue(
      new mocks.ApiError("Try again later", 429, { "Retry-After": "60" })
    )

    const response = await POST(jsonRequest(configureBody()))

    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("60")
    expect(mocks.mutateState).not.toHaveBeenCalled()
  })

  it("rejects oversized bodies, the internal plan, and money fields on fixed plans", async () => {
    const oversized = await POST(
      jsonRequest(configureBody(), {
        "Content-Length": String(ADMIN_BILLING_ACTION_BODY_LIMIT_BYTES + 1)
      })
    )
    const internal = await POST(
      jsonRequest(configureBody({ planCode: "internal_billing_test" }))
    )
    const browserPrice = await POST(
      jsonRequest(configureBody({ baseMonthlyPriceCents: 1 }))
    )
    const multiMarketPilot = await POST(
      jsonRequest(
        configureBody({
          operatingMarketIds: [PRIMARY_LANDING_ID, SECONDARY_LANDING_ID]
        })
      )
    )

    expect(oversized.status).toBe(413)
    expect(internal.status).toBe(422)
    expect(browserPrice.status).toBe(422)
    expect(multiMarketPilot.status).toBe(422)
    expect(mocks.mutateState).not.toHaveBeenCalled()
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
  })

  it("strictly rejects scope on Dispatch and incomplete or unsafe Enterprise terms", async () => {
    const dispatchWithScope = await POST(
      jsonRequest(
        dispatchConfigureBody({
          operatingMarketIds: [PRIMARY_LANDING_ID]
        })
      )
    )
    const noMarkets = await POST(
      jsonRequest(enterpriseConfigureBody({ operatingMarketIds: [] }))
    )
    const invalidLandingId = await POST(
      jsonRequest(
        configureBody({
          operatingMarketIds: ["not-a-landing-uuid"],
          planCode: "network_25"
        })
      )
    )
    const tooSmall = await POST(
      jsonRequest(
        enterpriseConfigureBody({
          negotiatedTerms: {
            ...ENTERPRISE_TERMS,
            includedNetworkLoadUnits: 249
          }
        })
      )
    )
    const noDispatch = await POST(
      jsonRequest(
        enterpriseConfigureBody({
          negotiatedTerms: {
            ...ENTERPRISE_TERMS,
            includesDispatchProCapabilities: false
          }
        })
      )
    )
    const sharedPrice = await POST(
      jsonRequest(
        enterpriseConfigureBody({
          negotiatedTerms: {
            ...ENTERPRISE_TERMS,
            stripeOveragePriceId: ENTERPRISE_TERMS.stripePriceId
          }
        })
      )
    )
    const inlinePrice = await POST(
      jsonRequest(
        configureBody({
          negotiatedTerms: ENTERPRISE_TERMS,
          planCode: "network_100"
        })
      )
    )

    expect(dispatchWithScope.status).toBe(422)
    expect(noMarkets.status).toBe(422)
    expect(invalidLandingId.status).toBe(422)
    expect(tooSmall.status).toBe(422)
    expect(noDispatch.status).toBe(422)
    expect(sharedPrice.status).toBe(422)
    expect(inlinePrice.status).toBe(422)
    expect(mocks.mutateState).not.toHaveBeenCalled()
  })

  it("enforces bounded payment settings and the complete negotiated Enterprise agreement", async () => {
    const missingCommitmentTerms: Record<string, unknown> = {
      ...ENTERPRISE_TERMS
    }
    delete missingCommitmentTerms.commitmentMonths
    const negativeGrace = await POST(
      jsonRequest(configureBody({ paymentGraceDays: -1 }))
    )
    const oversizedGrace = await POST(
      jsonRequest(configureBody({ paymentGraceDays: 31 }))
    )
    const zeroMilestone = await POST(
      jsonRequest(configureBody({ overageMilestoneIntervalUnits: 0 }))
    )
    const oversizedMilestone = await POST(
      jsonRequest(configureBody({ overageMilestoneIntervalUnits: 1_001 }))
    )
    const zeroBase = await POST(
      jsonRequest(
        enterpriseConfigureBody({
          negotiatedTerms: {
            ...ENTERPRISE_TERMS,
            baseMonthlyPriceCents: 0
          }
        })
      )
    )
    const zeroOverage = await POST(
      jsonRequest(
        enterpriseConfigureBody({
          negotiatedTerms: {
            ...ENTERPRISE_TERMS,
            overageUnitPriceCents: 0
          }
        })
      )
    )
    const invalidProduct = await POST(
      jsonRequest(
        enterpriseConfigureBody({
          negotiatedTerms: {
            ...ENTERPRISE_TERMS,
            stripeProductId: "price_NotAProduct"
          }
        })
      )
    )
    const missingCommitment = await POST(
      jsonRequest(
        enterpriseConfigureBody({
          negotiatedTerms: missingCommitmentTerms
        })
      )
    )
    const shortCommitment = await POST(
      jsonRequest(
        enterpriseConfigureBody({
          negotiatedTerms: {
            ...ENTERPRISE_TERMS,
            commitmentMonths: 11
          }
        })
      )
    )
    const longCommitment = await POST(
      jsonRequest(
        enterpriseConfigureBody({
          negotiatedTerms: {
            ...ENTERPRISE_TERMS,
            commitmentMonths: 61
          }
        })
      )
    )
    const duplicateIntegrations = await POST(
      jsonRequest(
        enterpriseConfigureBody({
          negotiatedTerms: {
            ...ENTERPRISE_TERMS,
            definedIntegrations: ["Scale feed", "scale feed"]
          }
        })
      )
    )
    const missingSupportObligations = await POST(
      jsonRequest(
        enterpriseConfigureBody({
          negotiatedTerms: {
            ...ENTERPRISE_TERMS,
            serviceSupportObligations: ""
          }
        })
      )
    )

    expect(negativeGrace.status).toBe(422)
    expect(oversizedGrace.status).toBe(422)
    expect(zeroMilestone.status).toBe(422)
    expect(oversizedMilestone.status).toBe(422)
    expect(zeroBase.status).toBe(422)
    expect(zeroOverage.status).toBe(422)
    expect(invalidProduct.status).toBe(422)
    expect(missingCommitment.status).toBe(422)
    expect(shortCommitment.status).toBe(422)
    expect(longCommitment.status).toBe(422)
    expect(duplicateIntegrations.status).toBe(422)
    expect(missingSupportObligations.status).toBe(422)
    expect(mocks.mutateState).not.toHaveBeenCalled()
  })

  it("records customer acceptance with the admin as audit actor and emits configured-dark analytics", async () => {
    const response = await POST(jsonRequest(configureBody()))

    expect(response.status).toBe(200)
    expect(mocks.configureOrganizationSubscription).toHaveBeenCalledWith({
      acceptedAt: ACCEPTED_AT,
      acceptedByUserId: ACCEPTOR_ID,
      acceptedTermsVersion: "network-v1-2026-07-28",
      configuredByUserId: ADMIN_ID,
      negotiatedTerms: undefined,
      operatingMarketIds: [PRIMARY_LANDING_ID],
      organizationId: ORGANIZATION_ID,
      overageMilestoneIntervalUnits: 10,
      paymentGraceDays: 7,
      planCode: "network_pilot"
    })
    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      "subscription_plan_selected",
      ADMIN_ID,
      {
        activationState: "configured_dark",
        internalBillingTest: false,
        organizationId: ORGANIZATION_ID,
        planCode: "network_pilot",
        source: "admin_sales_assisted"
      }
    )
  })

  it("configures Dispatch Pro from fixed catalog terms with no operating scope", async () => {
    mocks.configureOrganizationSubscription.mockReturnValue({
      changed: true,
      subscription: {
        ...subscription,
        planCode: "dispatch_pro"
      }
    })

    const response = await POST(
      jsonRequest(
        dispatchConfigureBody({
          overageMilestoneIntervalUnits: 25,
          paymentGraceDays: 3
        })
      )
    )

    expect(response.status).toBe(200)
    expect(mocks.configureOrganizationSubscription).toHaveBeenCalledWith({
      acceptedAt: ACCEPTED_AT,
      acceptedByUserId: ACCEPTOR_ID,
      acceptedTermsVersion: "network-v1-2026-07-28",
      configuredByUserId: ADMIN_ID,
      negotiatedTerms: undefined,
      operatingMarketIds: [],
      organizationId: ORGANIZATION_ID,
      overageMilestoneIntervalUnits: 25,
      paymentGraceDays: 3,
      planCode: "dispatch_pro"
    })
    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      "subscription_plan_selected",
      ADMIN_ID,
      expect.objectContaining({
        internalBillingTest: false,
        organizationId: ORGANIZATION_ID,
        planCode: "dispatch_pro"
      })
    )
  })

  it("freezes bounded negotiated Enterprise terms and pre-created provider ids", async () => {
    mocks.configureOrganizationSubscription.mockReturnValue({
      changed: true,
      subscription: {
        ...subscription,
        planCode: "enterprise_250_plus"
      }
    })

    const response = await POST(
      jsonRequest(
        enterpriseConfigureBody({
          overageMilestoneIntervalUnits: 50,
          paymentGraceDays: 14
        })
      )
    )

    expect(response.status).toBe(200)
    expect(mocks.configureOrganizationSubscription).toHaveBeenCalledWith({
      acceptedAt: ACCEPTED_AT,
      acceptedByUserId: ACCEPTOR_ID,
      acceptedTermsVersion: "network-v1-2026-07-28",
      configuredByUserId: ADMIN_ID,
      negotiatedTerms: ENTERPRISE_TERMS,
      operatingMarketIds: [PRIMARY_LANDING_ID, SECONDARY_LANDING_ID],
      organizationId: ORGANIZATION_ID,
      overageMilestoneIntervalUnits: 50,
      paymentGraceDays: 14,
      planCode: "enterprise_250_plus"
    })
    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      "subscription_plan_selected",
      ADMIN_ID,
      expect.objectContaining({
        internalBillingTest: false,
        organizationId: ORGANIZATION_ID,
        planCode: "enterprise_250_plus"
      })
    )
    const analyticsProperties = mocks.captureServerEvent.mock.calls.at(-1)?.[2]

    expect(analyticsProperties).not.toHaveProperty("commitmentMonths")
    expect(analyticsProperties).not.toHaveProperty("definedIntegrations")
    expect(analyticsProperties).not.toHaveProperty(
      "serviceSupportObligations"
    )
  })

  it("authorizes a fresh negotiated Enterprise target from Pilot grace without provider mutation", async () => {
    const response = await POST(
      jsonRequest(enterprisePilotConversionBody())
    )

    expect(response.status).toBe(200)
    expect(
      mocks.authorizePilotConversionSubscription
    ).toHaveBeenCalledWith({
      acceptedAt: ACCEPTED_AT,
      acceptedByUserId: ACCEPTOR_ID,
      acceptedTermsVersion: "enterprise-v1-2026-07-28",
      actorUserId: ADMIN_ID,
      negotiatedTerms: ENTERPRISE_TERMS,
      operatingMarketIds: [
        PRIMARY_LANDING_ID,
        SECONDARY_LANDING_ID
      ],
      sourceSubscriptionId: SUBSCRIPTION_ID,
      targetPlanCode: "enterprise_250_plus"
    })
    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      "network_pilot_enterprise_conversion_authorized",
      ADMIN_ID,
      {
        internalBillingTest: false,
        organizationId: ORGANIZATION_ID,
        planCode: "enterprise_250_plus"
      }
    )
    const analyticsProperties =
      mocks.captureServerEvent.mock.calls.at(-1)?.[2]
    expect(analyticsProperties).not.toHaveProperty(
      "negotiatedTerms"
    )
  })

  it("requires platform authority and rejects cross-organization Enterprise acceptance", async () => {
    mocks.requireAdminApiActor.mockRejectedValueOnce(
      new mocks.ApiError("Platform access required", 403)
    )
    const unauthorized = await POST(
      jsonRequest(enterprisePilotConversionBody())
    )

    expect(unauthorized.status).toBe(403)
    expect(mocks.mutateState).not.toHaveBeenCalled()

    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    mocks.requireAdminApiActor.mockResolvedValue({
      profile: { id: ADMIN_ID }
    })
    mocks.authorizePilotConversionSubscription.mockImplementation(
      () => {
        throw new Error(
          "The accepted user is not an active billing manager for the Pilot organization"
        )
      }
    )
    const crossOrganization = await POST(
      jsonRequest(enterprisePilotConversionBody())
    )

    expect(crossOrganization.status).toBe(409)
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
  })

  it("does not let the browser add a second organization identity to Enterprise conversion", async () => {
    const response = await POST(
      jsonRequest(
        enterprisePilotConversionBody({
          organizationId: OTHER_ORGANIZATION_ID
        })
      )
    )

    expect(response.status).toBe(422)
    expect(
      mocks.authorizePilotConversionSubscription
    ).not.toHaveBeenCalled()
  })

  it("does not emit commercial analytics for an internal fixture result", async () => {
    mocks.configureOrganizationSubscription.mockReturnValue({
      changed: true,
      subscription: {
        ...subscription,
        internalBillingTest: true
      }
    })

    const response = await POST(jsonRequest(configureBody()))

    expect(response.status).toBe(200)
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
  })

  it("returns a safe conflict and no analytics when a cross-organization invariant rejects activation", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    mocks.activateOrganizationSubscription.mockImplementation(() => {
      throw new Error(
        `Subscription ${SUBSCRIPTION_ID} belongs to ${OTHER_ORGANIZATION_ID}`
      )
    })

    const response = await POST(
      jsonRequest({
        action: "activate_subscription",
        confirm: "AUTHORIZE_PAID_ACTIVATION",
        organizationId: ORGANIZATION_ID,
        subscriptionId: SUBSCRIPTION_ID
      })
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error:
        "This billing action conflicts with current canonical state. Refresh and try again."
    })
    expect(mocks.activateOrganizationSubscription).toHaveBeenCalledWith({
      actorUserId: ADMIN_ID,
      organizationId: ORGANIZATION_ID,
      subscriptionId: SUBSCRIPTION_ID
    })
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
  })

  it("keeps an identical adjustment retry side-effect and analytics free", async () => {
    mocks.recordBillingAdjustment.mockReturnValue({
      adjustment: { organizationId: ORGANIZATION_ID },
      changed: false,
      summary
    })

    const body = {
      action: "record_adjustment",
      adjustmentType: "service_credit",
      amountCents: 2500,
      billingPeriodSummaryId: SUMMARY_ID,
      confirm: "RECORD_BILLING_ADJUSTMENT",
      idempotencyKey: IDEMPOTENCY_KEY,
      invoiceId: null,
      reason: "Service recovery credit"
    }
    const first = await POST(jsonRequest(body))
    const second = await POST(jsonRequest(body))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(mocks.recordBillingAdjustment).toHaveBeenNthCalledWith(1, {
      actorUserId: ADMIN_ID,
      amountCents: 2500,
      billingPeriodSummaryId: SUMMARY_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      invoiceId: null,
      reason: "Service recovery credit",
      type: "service_credit"
    })
    expect(mocks.recordBillingAdjustment).toHaveBeenNthCalledWith(2, {
      actorUserId: ADMIN_ID,
      amountCents: 2500,
      billingPeriodSummaryId: SUMMARY_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      invoiceId: null,
      reason: "Service recovery credit",
      type: "service_credit"
    })
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
  })

  it("emits the bounded lifecycle analytics only after changed commercial mutations", async () => {
    await POST(
      jsonRequest({
        action: "activate_subscription",
        confirm: "AUTHORIZE_PAID_ACTIVATION",
        organizationId: ORGANIZATION_ID,
        subscriptionId: SUBSCRIPTION_ID
      })
    )
    await POST(
      jsonRequest(fixedPlanChangeBody())
    )
    await POST(
      jsonRequest({
        action: "record_adjustment",
        adjustmentType: "manual_debit",
        amountCents: 1250,
        billingPeriodSummaryId: SUMMARY_ID,
        confirm: "RECORD_BILLING_ADJUSTMENT",
        idempotencyKey: IDEMPOTENCY_KEY,
        invoiceId: null,
        reason: "Contract correction debit"
      })
    )
    await POST(
      jsonRequest({
        action: "reverse_usage",
        confirm: "REVERSE_NETWORK_USAGE",
        reason: "Duplicate completion record",
        usageEventId: USAGE_ID
      })
    )

    expect(mocks.captureServerEvent).toHaveBeenNthCalledWith(
      1,
      "network_pilot_activation_authorized",
      ADMIN_ID,
      {
        internalBillingTest: false,
        organizationId: ORGANIZATION_ID,
        planCode: "network_pilot"
      }
    )
    expect(mocks.captureServerEvent).toHaveBeenNthCalledWith(
      2,
      "network_pilot_conversion_scheduled",
      ADMIN_ID,
      {
        internalBillingTest: false,
        nextPlanCode: "network_25",
        organizationId: ORGANIZATION_ID,
        planCode: "network_pilot"
      }
    )
    expect(mocks.captureServerEvent).toHaveBeenNthCalledWith(
      3,
      "billing_adjustment_recorded",
      ADMIN_ID,
      {
        internalBillingTest: false,
        organizationId: ORGANIZATION_ID,
        planCode: "network_pilot"
      }
    )
    expect(mocks.captureServerEvent).toHaveBeenNthCalledWith(
      4,
      "network_usage_reversed",
      ADMIN_ID,
      {
        internalBillingTest: false,
        organizationId: ORGANIZATION_ID,
        planCode: "network_pilot"
      }
    )
  })

  it("uses the general plan-change event outside the Pilot funnel", async () => {
    mocks.scheduleOrganizationSubscriptionPlanChange.mockReturnValue({
      changed: true,
      subscription: {
        ...subscription,
        pendingPlanCode: "network_50",
        planCode: "network_25"
      }
    })

    const response = await POST(
      jsonRequest(
        fixedPlanChangeBody({
          nextPlanCode: "network_50"
        })
      )
    )

    expect(response.status).toBe(200)
    expect(
      mocks.scheduleOrganizationSubscriptionPlanChange
    ).toHaveBeenCalledWith({
      actorUserId: ADMIN_ID,
      effectiveAt: EFFECTIVE_AT,
      negotiatedTerms: undefined,
      nextOperatingMarketIds: [PRIMARY_LANDING_ID],
      nextPlanCode: "network_50",
      subscriptionId: SUBSCRIPTION_ID
    })
    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      "subscription_plan_change_scheduled",
      ADMIN_ID,
      {
        internalBillingTest: false,
        nextPlanCode: "network_50",
        organizationId: ORGANIZATION_ID,
        planCode: "network_25"
      }
    )
  })

  it("schedules Dispatch Pro with an explicitly cleared operating scope", async () => {
    mocks.scheduleOrganizationSubscriptionPlanChange.mockReturnValue({
      changed: true,
      subscription: {
        ...subscription,
        pendingPlanCode: "dispatch_pro"
      }
    })

    const response = await POST(
      jsonRequest({
        action: "schedule_plan_change",
        confirm: "SCHEDULE_PLAN_CHANGE",
        effectiveAt: EFFECTIVE_AT,
        nextPlanCode: "dispatch_pro",
        subscriptionId: SUBSCRIPTION_ID
      })
    )

    expect(response.status).toBe(200)
    expect(
      mocks.scheduleOrganizationSubscriptionPlanChange
    ).toHaveBeenCalledWith({
      actorUserId: ADMIN_ID,
      effectiveAt: EFFECTIVE_AT,
      negotiatedTerms: undefined,
      nextOperatingMarketIds: [],
      nextPlanCode: "dispatch_pro",
      subscriptionId: SUBSCRIPTION_ID
    })
  })

  it("schedules Enterprise with accepted scope and bounded negotiated terms", async () => {
    mocks.scheduleOrganizationSubscriptionPlanChange.mockReturnValue({
      changed: true,
      subscription: {
        ...subscription,
        pendingPlanCode: "enterprise_250_plus"
      }
    })

    const response = await POST(
      jsonRequest(enterprisePlanChangeBody())
    )

    expect(response.status).toBe(200)
    expect(
      mocks.scheduleOrganizationSubscriptionPlanChange
    ).toHaveBeenCalledWith({
      actorUserId: ADMIN_ID,
      effectiveAt: EFFECTIVE_AT,
      negotiatedTerms: ENTERPRISE_TERMS,
      nextOperatingMarketIds: [PRIMARY_LANDING_ID, SECONDARY_LANDING_ID],
      nextPlanCode: "enterprise_250_plus",
      subscriptionId: SUBSCRIPTION_ID
    })
  })

  it("rejects invalid or cross-wired plan-change target terms before mutation", async () => {
    const dispatchWithScope = await POST(
      jsonRequest({
        action: "schedule_plan_change",
        confirm: "SCHEDULE_PLAN_CHANGE",
        effectiveAt: EFFECTIVE_AT,
        nextOperatingMarketIds: [PRIMARY_LANDING_ID],
        nextPlanCode: "dispatch_pro",
        subscriptionId: SUBSCRIPTION_ID
      })
    )
    const fixedWithoutScope = await POST(
      jsonRequest({
        action: "schedule_plan_change",
        confirm: "SCHEDULE_PLAN_CHANGE",
        effectiveAt: EFFECTIVE_AT,
        nextPlanCode: "network_25",
        subscriptionId: SUBSCRIPTION_ID
      })
    )
    const enterpriseWithoutTerms = await POST(
      jsonRequest(
        fixedPlanChangeBody({
          nextPlanCode: "enterprise_250_plus"
        })
      )
    )
    const internal = await POST(
      jsonRequest(
        fixedPlanChangeBody({
          nextPlanCode: "internal_billing_test"
        })
      )
    )

    expect(dispatchWithScope.status).toBe(422)
    expect(fixedWithoutScope.status).toBe(422)
    expect(enterpriseWithoutTerms.status).toBe(422)
    expect(internal.status).toBe(422)
    expect(mocks.mutateState).not.toHaveBeenCalled()
  })

  it.each([
    {
      body: {
        action: "activate_subscription",
        confirm: "AUTHORIZE_PAID_ACTIVATION",
        organizationId: ORGANIZATION_ID,
        subscriptionId: SUBSCRIPTION_ID
      },
      method: mocks.activateOrganizationSubscription
    },
    {
      body: fixedPlanChangeBody(),
      method: mocks.scheduleOrganizationSubscriptionPlanChange
    },
    {
      body: {
        action: "schedule_non_renewal",
        confirm: "SCHEDULE_NON_RENEWAL",
        effectiveAt: EFFECTIVE_AT,
        subscriptionId: SUBSCRIPTION_ID
      },
      method: mocks.scheduleOrganizationSubscriptionNonRenewal
    },
    {
      body: {
        action: "reverse_usage",
        confirm: "REVERSE_NETWORK_USAGE",
        reason: "Duplicate completion record",
        usageEventId: USAGE_ID
      },
      method: mocks.reverseNetworkUsage
    },
    {
      body: {
        action: "retire_dispatch_entitlement",
        confirm: "RETIRE_PAID_DISPATCH_ENTITLEMENT",
        entitlementId: ENTITLEMENT_ID,
        organizationId: ORGANIZATION_ID,
        providerCancellationReference: "evt_dispatch_cancelled"
      },
      method: mocks.retirePaidDispatchEntitlementForSubscription
    },
    {
      body: {
        action: "reconcile_missing_usage",
        confirm: "RUN_MISSING_USAGE_RECONCILIATION"
      },
      method: mocks.reconcileMissingNetworkUsageAsPlatformAdmin
    }
  ])("dispatches $body.action through its service facade", async ({ body, method }) => {
    const response = await POST(jsonRequest(body))

    expect(response.status).toBe(200)
    expect(method).toHaveBeenCalledOnce()
  })

  it("emits only changed, commercial usage reconciliation events", async () => {
    mocks.reconcileMissingNetworkUsageAsPlatformAdmin.mockReturnValue([
      {
        eventId: USAGE_ID,
        internalBillingTest: false,
        newlyEmittedThresholds: ["70", "90"],
        organizationId: ORGANIZATION_ID,
        outcome: "recorded",
        planCode: "network_25"
      },
      {
        eventId: "55555555-5555-4555-8555-555555555555",
        internalBillingTest: true,
        newlyEmittedThresholds: ["100"],
        organizationId: OTHER_ORGANIZATION_ID,
        outcome: "recorded",
        planCode: "network_25"
      },
      {
        eventId: USAGE_ID,
        internalBillingTest: false,
        newlyEmittedThresholds: [],
        organizationId: ORGANIZATION_ID,
        outcome: "already_recorded",
        planCode: "network_25"
      }
    ])

    const response = await POST(
      jsonRequest({
        action: "reconcile_missing_usage",
        confirm: "RUN_MISSING_USAGE_RECONCILIATION"
      })
    )

    expect(response.status).toBe(200)
    expect(mocks.enforceApiRateLimit).toHaveBeenNthCalledWith(
      2,
      "admin-billing-usage-reconciliation",
      ADMIN_ID,
      2,
      600_000
    )
    expect(mocks.captureServerEvent).toHaveBeenCalledTimes(3)
    expect(mocks.captureServerEvent).toHaveBeenNthCalledWith(
      1,
      "network_usage_reconciled",
      ADMIN_ID,
      {
        internalBillingTest: false,
        organizationId: ORGANIZATION_ID,
        planCode: "network_25"
      }
    )
    expect(mocks.captureServerEvent).toHaveBeenNthCalledWith(
      2,
      "network_allowance_threshold_reached",
      ADMIN_ID,
      {
        internalBillingTest: false,
        networkUsageEventId: USAGE_ID,
        organizationId: ORGANIZATION_ID,
        planCode: "network_25",
        threshold: "70"
      }
    )
    expect(mocks.captureServerEvent).toHaveBeenNthCalledWith(
      3,
      "network_allowance_threshold_reached",
      ADMIN_ID,
      {
        internalBillingTest: false,
        networkUsageEventId: USAGE_ID,
        organizationId: ORGANIZATION_ID,
        planCode: "network_25",
        threshold: "90"
      }
    )
  })
})

describe("admin billing action controls", () => {
  it("builds a fixed-plan acceptance payload without browser-selected money", () => {
    const data = new FormData()

    data.set("acceptedAt", ACCEPTED_AT)
    data.set("acceptedByUserId", ACCEPTOR_ID)
    data.set("acceptedTermsVersion", "network-v1-2026-07-28")
    data.set("organizationId", ORGANIZATION_ID)
    data.set(
      "operatingMarketIds",
      `${PRIMARY_LANDING_ID}, ${SECONDARY_LANDING_ID}`
    )
    data.set("overageMilestoneIntervalUnits", "25")
    data.set("paymentGraceDays", "3")
    data.set("planCode", "network_50")
    data.set("baseMonthlyPriceCents", "1")

    expect(buildAdminBillingActionPayload("configure_subscription", data)).toEqual({
      acceptedAt: ACCEPTED_AT,
      acceptedByUserId: ACCEPTOR_ID,
      acceptedTermsVersion: "network-v1-2026-07-28",
      action: "configure_subscription",
      confirm: "CONFIGURE_ACCEPTED_SUBSCRIPTION",
      operatingMarketIds: [PRIMARY_LANDING_ID, SECONDARY_LANDING_ID],
      organizationId: ORGANIZATION_ID,
      overageMilestoneIntervalUnits: 25,
      paymentGraceDays: 3,
      planCode: "network_50"
    })
  })

  it("builds Dispatch acceptance without scope or negotiated browser money", () => {
    const data = new FormData()

    data.set("acceptedAt", ACCEPTED_AT)
    data.set("acceptedByUserId", ACCEPTOR_ID)
    data.set("acceptedTermsVersion", "dispatch-v1-2026-07-28")
    data.set("organizationId", ORGANIZATION_ID)
    data.set("operatingMarketIds", "must-not-cross-wire")
    data.set("overageMilestoneIntervalUnits", "10")
    data.set("paymentGraceDays", "7")
    data.set("planCode", "dispatch_pro")
    data.set("enterpriseBaseMonthlyPriceCents", "999999")

    expect(
      buildAdminBillingActionPayload("configure_subscription", data)
    ).toEqual({
      acceptedAt: ACCEPTED_AT,
      acceptedByUserId: ACCEPTOR_ID,
      acceptedTermsVersion: "dispatch-v1-2026-07-28",
      action: "configure_subscription",
      confirm: "CONFIGURE_ACCEPTED_SUBSCRIPTION",
      organizationId: ORGANIZATION_ID,
      overageMilestoneIntervalUnits: 10,
      paymentGraceDays: 7,
      planCode: "dispatch_pro"
    })
  })

  it("builds negotiated Enterprise acceptance with explicit scope and provider ids", () => {
    const data = new FormData()

    data.set("acceptedAt", ACCEPTED_AT)
    data.set("acceptedByUserId", ACCEPTOR_ID)
    data.set("acceptedTermsVersion", "enterprise-v1-2026-07-28")
    data.set("organizationId", ORGANIZATION_ID)
    data.set(
      "operatingMarketIds",
      `${PRIMARY_LANDING_ID}\n${SECONDARY_LANDING_ID}`
    )
    data.set("overageMilestoneIntervalUnits", "50")
    data.set("paymentGraceDays", "14")
    data.set(
      "enterpriseBaseMonthlyPriceCents",
      String(ENTERPRISE_TERMS.baseMonthlyPriceCents)
    )
    data.set(
      "enterpriseCommitmentMonths",
      String(ENTERPRISE_TERMS.commitmentMonths)
    )
    data.set(
      "enterpriseDefinedIntegrations",
      ENTERPRISE_TERMS.definedIntegrations.join("\n")
    )
    data.set(
      "enterpriseIncludedNetworkLoadUnits",
      String(ENTERPRISE_TERMS.includedNetworkLoadUnits)
    )
    data.set(
      "enterpriseOverageUnitPriceCents",
      String(ENTERPRISE_TERMS.overageUnitPriceCents)
    )
    data.set(
      "enterpriseStripeOveragePriceId",
      ENTERPRISE_TERMS.stripeOveragePriceId
    )
    data.set(
      "enterpriseStripePriceId",
      ENTERPRISE_TERMS.stripePriceId
    )
    data.set(
      "enterpriseStripeProductId",
      ENTERPRISE_TERMS.stripeProductId
    )
    data.set(
      "enterpriseServiceSupportObligations",
      ENTERPRISE_TERMS.serviceSupportObligations
    )
    data.set("planCode", "enterprise_250_plus")

    expect(
      buildAdminBillingActionPayload("configure_subscription", data)
    ).toEqual({
      acceptedAt: ACCEPTED_AT,
      acceptedByUserId: ACCEPTOR_ID,
      acceptedTermsVersion: "enterprise-v1-2026-07-28",
      action: "configure_subscription",
      confirm: "CONFIGURE_ACCEPTED_SUBSCRIPTION",
      negotiatedTerms: ENTERPRISE_TERMS,
      operatingMarketIds: [PRIMARY_LANDING_ID, SECONDARY_LANDING_ID],
      organizationId: ORGANIZATION_ID,
      overageMilestoneIntervalUnits: 50,
      paymentGraceDays: 14,
      planCode: "enterprise_250_plus"
    })
  })

  it("builds the post-Pilot Enterprise authorization from exact accepted terms", () => {
    const data = new FormData()

    data.set("acceptedAt", ACCEPTED_AT)
    data.set("acceptedByUserId", ACCEPTOR_ID)
    data.set("acceptedTermsVersion", "enterprise-v1-2026-07-28")
    data.set(
      "operatingMarketIds",
      `${PRIMARY_LANDING_ID}\n${SECONDARY_LANDING_ID}`
    )
    data.set("sourceSubscriptionId", SUBSCRIPTION_ID)
    data.set(
      "enterpriseBaseMonthlyPriceCents",
      String(ENTERPRISE_TERMS.baseMonthlyPriceCents)
    )
    data.set(
      "enterpriseCommitmentMonths",
      String(ENTERPRISE_TERMS.commitmentMonths)
    )
    data.set(
      "enterpriseDefinedIntegrations",
      ENTERPRISE_TERMS.definedIntegrations.join("\n")
    )
    data.set(
      "enterpriseIncludedNetworkLoadUnits",
      String(ENTERPRISE_TERMS.includedNetworkLoadUnits)
    )
    data.set(
      "enterpriseOverageUnitPriceCents",
      String(ENTERPRISE_TERMS.overageUnitPriceCents)
    )
    data.set(
      "enterpriseStripeOveragePriceId",
      ENTERPRISE_TERMS.stripeOveragePriceId
    )
    data.set(
      "enterpriseStripePriceId",
      ENTERPRISE_TERMS.stripePriceId
    )
    data.set(
      "enterpriseStripeProductId",
      ENTERPRISE_TERMS.stripeProductId
    )
    data.set(
      "enterpriseServiceSupportObligations",
      ENTERPRISE_TERMS.serviceSupportObligations
    )

    expect(
      buildAdminBillingActionPayload(
        "authorize_pilot_enterprise_conversion",
        data
      )
    ).toEqual({
      acceptedAt: ACCEPTED_AT,
      acceptedByUserId: ACCEPTOR_ID,
      acceptedTermsVersion: "enterprise-v1-2026-07-28",
      action: "authorize_pilot_enterprise_conversion",
      confirm: "AUTHORIZE_PILOT_ENTERPRISE_CONVERSION",
      negotiatedTerms: ENTERPRISE_TERMS,
      operatingMarketIds: [
        PRIMARY_LANDING_ID,
        SECONDARY_LANDING_ID
      ],
      sourceSubscriptionId: SUBSCRIPTION_ID
    })
  })

  it("builds Dispatch and Enterprise plan changes without cross-wiring target terms", () => {
    const dispatch = new FormData()
    const enterprise = new FormData()

    dispatch.set("effectiveAt", EFFECTIVE_AT)
    dispatch.set("nextOperatingMarketIds", "must-not-cross-wire")
    dispatch.set("nextPlanCode", "dispatch_pro")
    dispatch.set("subscriptionId", SUBSCRIPTION_ID)
    dispatch.set("enterpriseBaseMonthlyPriceCents", "999999")

    enterprise.set("effectiveAt", EFFECTIVE_AT)
    enterprise.set(
      "nextOperatingMarketIds",
      `${PRIMARY_LANDING_ID}, ${SECONDARY_LANDING_ID}`
    )
    enterprise.set("nextPlanCode", "enterprise_250_plus")
    enterprise.set("subscriptionId", SUBSCRIPTION_ID)
    enterprise.set(
      "enterpriseBaseMonthlyPriceCents",
      String(ENTERPRISE_TERMS.baseMonthlyPriceCents)
    )
    enterprise.set(
      "enterpriseCommitmentMonths",
      String(ENTERPRISE_TERMS.commitmentMonths)
    )
    enterprise.set(
      "enterpriseDefinedIntegrations",
      ENTERPRISE_TERMS.definedIntegrations.join(", ")
    )
    enterprise.set(
      "enterpriseIncludedNetworkLoadUnits",
      String(ENTERPRISE_TERMS.includedNetworkLoadUnits)
    )
    enterprise.set(
      "enterpriseOverageUnitPriceCents",
      String(ENTERPRISE_TERMS.overageUnitPriceCents)
    )
    enterprise.set(
      "enterpriseStripeOveragePriceId",
      ENTERPRISE_TERMS.stripeOveragePriceId
    )
    enterprise.set(
      "enterpriseStripePriceId",
      ENTERPRISE_TERMS.stripePriceId
    )
    enterprise.set(
      "enterpriseStripeProductId",
      ENTERPRISE_TERMS.stripeProductId
    )
    enterprise.set(
      "enterpriseServiceSupportObligations",
      ENTERPRISE_TERMS.serviceSupportObligations
    )

    expect(
      buildAdminBillingActionPayload("schedule_plan_change", dispatch)
    ).toEqual({
      action: "schedule_plan_change",
      confirm: "SCHEDULE_PLAN_CHANGE",
      effectiveAt: EFFECTIVE_AT,
      nextPlanCode: "dispatch_pro",
      subscriptionId: SUBSCRIPTION_ID
    })
    expect(
      buildAdminBillingActionPayload("schedule_plan_change", enterprise)
    ).toEqual({
      action: "schedule_plan_change",
      confirm: "SCHEDULE_PLAN_CHANGE",
      effectiveAt: EFFECTIVE_AT,
      negotiatedTerms: ENTERPRISE_TERMS,
      nextOperatingMarketIds: [PRIMARY_LANDING_ID, SECONDARY_LANDING_ID],
      nextPlanCode: "enterprise_250_plus",
      subscriptionId: SUBSCRIPTION_ID
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

  it("renders all audited controls and visibly isolates live-provider money", () => {
    vi.stubGlobal("React", React)
    const markup = renderToStaticMarkup(
      React.createElement(AdminBillingActions, {
        periodSummaryOptions: [],
        subscriptionOptions: [],
        usageOptions: []
      })
    )

    expect(markup).toContain("Record accepted subscription plan")
    expect(markup).toContain("Dispatch Pro")
    expect(markup).toContain("Enterprise 250+")
    expect(markup).toContain(
      "Authorize Pilot conversion to Enterprise"
    )
    expect(markup).toContain("Payment grace in days")
    expect(markup).toContain(
      "Network overage notification milestone (units)"
    )
    expect(markup).toContain("Authorize paid activation")
    expect(markup).toContain("Schedule end-of-commitment plan change")
    expect(markup).toContain("Schedule non-renewal")
    expect(markup).toContain("Record credit or debit")
    expect(markup).toContain("Reverse one usage unit")
    expect(markup).toContain("Retire overlapping Dispatch entitlement")
    expect(markup).toContain("Reconcile missing Network usage")
    expect(markup).toContain("the only actions on this page that call Stripe")
    expect(markup).toContain("CHARGE_ONE_DOLLAR")
    expect(markup).toContain("REFUND_ONE_DOLLAR")
    expect(markup).toContain('pattern="CHARGE_ONE_DOLLAR"')
    expect(markup).toContain('pattern="REFUND_ONE_DOLLAR"')
  })
})
