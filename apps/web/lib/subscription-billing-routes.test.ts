import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  SUBSCRIPTION_PLAN_CATALOG,
  subscriptionPlanDefinition,
  subscriptionPlanQuoteFingerprint
} from "@logloads/contracts"

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    readonly status: number

    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  }

  class DomainRefusalError extends Error {}

  return {
    ApiError,
    DomainRefusalError,
    acceptDispatchProSubscription: vi.fn(),
    activateOrganizationSubscription: vi.fn(),
    authorizePilotConversionSubscription: vi.fn(),
    captureServerEvent: vi.fn(),
    enforceApiRateLimit: vi.fn(),
    ensureInternalSmokeInvoice: vi.fn(),
    expectedStripeLivemode: vi.fn(),
    findHostBillingProfile: vi.fn(),
    internalBillingSmokeAuthorization: vi.fn(),
    internalBillingSmokeTargetAuthorization: vi.fn(),
    operatingStateAccess: vi.fn(),
    refundInternalSmokeInvoice: vi.fn(),
    requireAdminApiActor: vi.fn(),
    requireApiActor: vi.fn(),
    resolveStripeBilling: vi.fn(),
    resolveSubscriptionStripe: vi.fn(),
    subscriptionCollectionEnabled: vi.fn(),
    subscriptionNewMoneyAllowed: vi.fn(),
    verifyAcceptedPrice: vi.fn(),
    verifyExpectedStripeAccount: vi.fn(),
    verifyZeroStripeCustomerBalance: vi.fn()
  }
})

vi.mock("@/lib/api-actor", () => ({
  ApiError: mocks.ApiError,
  apiErrorResponse(error: unknown) {
    const status =
      error instanceof mocks.ApiError
        ? error.status
        : error instanceof mocks.DomainRefusalError
          ? 409
        : error instanceof Error && error.name === "ZodError"
          ? 422
          : 500
    const message =
      error instanceof mocks.ApiError
        ? error.message
        : error instanceof mocks.DomainRefusalError
        ? "This request conflicts with current records or policy. Refresh and correct the request before retrying."
        : error instanceof Error && error.name === "ZodError"
          ? "Invalid request fields"
          : "We could not complete that request."

    return Response.json({ error: message }, { status })
  },
  enforceApiRateLimit: mocks.enforceApiRateLimit,
  requireAdminApiActor: mocks.requireAdminApiActor,
  requireApiActor: mocks.requireApiActor
}))
vi.mock("@/lib/analytics", () => ({
  captureServerEvent: mocks.captureServerEvent
}))
vi.mock("@logloads/services", () => ({
  acceptDispatchProSubscription: mocks.acceptDispatchProSubscription,
  activateOrganizationSubscription: mocks.activateOrganizationSubscription,
  authorizePilotConversionSubscription:
    mocks.authorizePilotConversionSubscription,
  DomainRefusalError: mocks.DomainRefusalError
}))
vi.mock("@/lib/billing", () => ({
  findHostBillingProfile: mocks.findHostBillingProfile,
  operatingStateAccess: mocks.operatingStateAccess,
  resolveStripeBilling: mocks.resolveStripeBilling
}))
vi.mock("@/lib/subscription-stripe", () => ({
  ensureInternalSmokeInvoice: mocks.ensureInternalSmokeInvoice,
  expectedStripeLivemode: mocks.expectedStripeLivemode,
  internalBillingSmokeAuthorization: mocks.internalBillingSmokeAuthorization,
  internalBillingSmokeTargetAuthorization:
    mocks.internalBillingSmokeTargetAuthorization,
  internalSmokeRunId: () => "eeeeeeee-eeee-5eee-8eee-eeeeeeeeeeee",
  refundInternalSmokeInvoice: mocks.refundInternalSmokeInvoice,
  resolveSubscriptionStripe: mocks.resolveSubscriptionStripe,
  subscriptionCollectionEnabled: mocks.subscriptionCollectionEnabled,
  subscriptionNewMoneyAllowed: mocks.subscriptionNewMoneyAllowed,
  verifyAcceptedPrice: mocks.verifyAcceptedPrice,
  verifyExpectedStripeAccount: mocks.verifyExpectedStripeAccount,
  verifyZeroStripeCustomerBalance:
    mocks.verifyZeroStripeCustomerBalance
}))

import { POST as startCheckout } from "@/app/api/billing/subscription-checkout/route"
import { POST as startPortal } from "@/app/api/billing/subscription-portal/route"
import { POST as runInternalSmoke } from "@/app/api/billing/internal-smoke/route"
import {
  DISPATCH_PRO_TERMS_VERSION,
  NETWORK_CONVERSION_TERMS_VERSION
} from "@/lib/subscription-billing-terms"

const ACTOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const OTHER_ACTOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab"
const ORGANIZATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const OTHER_ORGANIZATION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const SUBSCRIPTION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const CONVERSION_SUBSCRIPTION_ID =
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeed"
const NETWORK_25_QUOTE_FINGERPRINT =
  subscriptionPlanQuoteFingerprint(
    subscriptionPlanDefinition("network_25")
  )

function actor(
  organizationId = ORGANIZATION_ID,
  role = "owner",
  organizationType = "landing_source"
) {
  return {
    actor: {
      memberships: [
        {
          membership: { role },
          organization: { id: organizationId, type: organizationType }
        }
      ]
    },
    actorUserId: ACTOR_ID,
    organizationId
  }
}

function request(body: Record<string, unknown>): Request {
  return new Request("https://logloads.test/api/billing", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  })
}

function stateAccess(state: Record<string, unknown>) {
  return {
    mutate: vi.fn(
      async <T>(mutate: (draft: { state: typeof state }) => T | Promise<T>) =>
        mutate({ state })
    ),
    read: vi.fn(
      async <T>(read: (current: typeof state) => T | Promise<T>) => read(state)
    )
  }
}

function canonicalSubscription(overrides: Record<string, unknown> = {}) {
  return {
    acceptedAt: "2026-07-28T00:00:00.000Z",
    acceptedByUserId: ACTOR_ID,
    acceptedTermsVersion: "network-v1-2026-07-28",
    billingModel: "subscription_v1",
    activationAuthorizedAt: "2026-07-28T00:00:00.000Z",
    activationAuthorizedByUserId: ACTOR_ID as string | null,
    id: SUBSCRIPTION_ID,
    internalBillingTest: false,
    organizationId: ORGANIZATION_ID,
    planCode: "network_pilot",
    planSnapshot: { stripePriceId: null },
    status: "pending",
    stripeCustomerId: "cus_host",
    stripeSubscriptionId: null,
    ...overrides
  }
}

function canonicalDispatchSubscription(
  overrides: Record<string, unknown> = {}
) {
  return canonicalSubscription({
    acceptedTermsVersion: DISPATCH_PRO_TERMS_VERSION,
    billingModel: "dispatch_pro",
    planCode: "dispatch_pro",
    planSnapshot: {
      billingModel: "dispatch_pro",
      code: "dispatch_pro",
      stripePriceId: null
    },
    stripeCustomerId: null,
    ...overrides
  })
}

function pilotConversionSource(overrides: Record<string, unknown> = {}) {
  return canonicalSubscription({
    commitmentEnd: "2026-10-26T00:00:00.000Z",
    commitmentStart: "2026-07-28T00:00:00.000Z",
    conversionGraceEndsAt: "2026-11-09T00:00:00.000Z",
    operationalActivatedAt: "2026-07-28T00:00:00.000Z",
    status: "non_renewing",
    stripeSubscriptionId: "sub_pilot_source",
    ...overrides
  })
}

function pilotConversionTarget(overrides: Record<string, unknown> = {}) {
  return canonicalSubscription({
    acceptedAt: "2026-10-27T00:00:00.000Z",
    acceptedQuoteFingerprint:
      NETWORK_25_QUOTE_FINGERPRINT,
    convertedFromPlanCode: "network_pilot",
    convertedFromSubscriptionId: SUBSCRIPTION_ID,
    id: CONVERSION_SUBSCRIPTION_ID,
    planCode: "network_25",
    planSnapshot:
      subscriptionPlanDefinition("network_25"),
    stripeCustomerId: null,
    ...overrides
  })
}

afterEach(() => {
  vi.useRealTimers()
})

function retiredCheckoutDescribe(
  name: string,
  legacySuite: () => void
): void {
  void name
  void legacySuite
  describe("retired subscription checkout route", () => {
    beforeEach(() => {
      vi.resetAllMocks()
      mocks.enforceApiRateLimit.mockResolvedValue(undefined)
      mocks.requireApiActor.mockResolvedValue(actor())
    })

    it("requires an authenticated organization actor", async () => {
      mocks.requireApiActor.mockRejectedValue(
        new mocks.ApiError("Sign in required", 401)
      )

      const response = await startCheckout(
        request({ organizationSubscriptionId: SUBSCRIPTION_ID })
      )

      expect(response.status).toBe(401)
    })

    it("returns 410 without reading state or calling Stripe", async () => {
      const response = await startCheckout(
        request({ organizationSubscriptionId: SUBSCRIPTION_ID })
      )

      expect(response.status).toBe(410)
      await expect(response.json()).resolves.toEqual({
        error:
          "New subscription enrollment is closed. Hosts use the current 5% completed-load agreement."
      })
      expect(mocks.operatingStateAccess).not.toHaveBeenCalled()
      expect(mocks.resolveSubscriptionStripe).not.toHaveBeenCalled()
      expect(mocks.acceptDispatchProSubscription).not.toHaveBeenCalled()
      expect(mocks.authorizePilotConversionSubscription).not.toHaveBeenCalled()
    })
  })
}

retiredCheckoutDescribe("Network subscription checkout route", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://logloads.test")
    vi.stubEnv("STRIPE_PRICE_NETWORK_PILOT", "price_pilot")
    mocks.enforceApiRateLimit.mockResolvedValue(undefined)
    mocks.requireApiActor.mockResolvedValue(actor())
    mocks.resolveSubscriptionStripe.mockReturnValue({
      ok: true,
      port: { marker: "stripe" }
    })
    mocks.verifyExpectedStripeAccount.mockResolvedValue(undefined)
    mocks.subscriptionCollectionEnabled.mockReturnValue(true)
    mocks.subscriptionNewMoneyAllowed.mockReturnValue(true)
    mocks.expectedStripeLivemode.mockReturnValue(false)
    mocks.verifyZeroStripeCustomerBalance.mockResolvedValue(undefined)
    mocks.verifyAcceptedPrice.mockResolvedValue({ id: "price_pilot" })
    mocks.verifyExpectedStripeAccount.mockResolvedValue(undefined)
    mocks.resolveSubscriptionStripe.mockReturnValue({
      ok: true,
      port: {
        createCheckoutSession: vi.fn().mockResolvedValue({
          id: "cs_network",
          url: "https://checkout.stripe.test/network"
        })
      }
    })
  })

  it("requires an authenticated organization actor", async () => {
    mocks.requireApiActor.mockRejectedValue(new mocks.ApiError("Sign in required", 401))

    const response = await startCheckout(
      request({ organizationSubscriptionId: SUBSCRIPTION_ID })
    )

    expect(response.status).toBe(401)
    expect(mocks.operatingStateAccess).not.toHaveBeenCalled()
    expect(mocks.resolveSubscriptionStripe).not.toHaveBeenCalled()
  })

  it("makes the collection switch a no-provider-call boundary", async () => {
    mocks.subscriptionCollectionEnabled.mockReturnValue(false)

    const response = await startCheckout(
      request({ organizationSubscriptionId: SUBSCRIPTION_ID })
    )

    expect(response.status).toBe(503)
    expect(mocks.operatingStateAccess).not.toHaveBeenCalled()
    expect(mocks.resolveSubscriptionStripe).not.toHaveBeenCalled()
  })

  it("requires explicit administrator authorization before opening Checkout", async () => {
    mocks.operatingStateAccess.mockReturnValue(
      stateAccess({
        hostBillingProfiles: [],
        organizationSubscriptions: [
          canonicalSubscription({ activationAuthorizedAt: null })
        ]
      })
    )

    const response = await startCheckout(
      request({ organizationSubscriptionId: SUBSCRIPTION_ID })
    )

    expect(response.status).toBe(409)
    expect(mocks.resolveSubscriptionStripe).not.toHaveBeenCalled()
  })

  it("fails closed without exposing either Stripe account identity", async () => {
    mocks.operatingStateAccess.mockReturnValue(
      stateAccess({
        hostBillingProfiles: [],
        organizationSubscriptions: [canonicalSubscription()]
      })
    )
    mocks.findHostBillingProfile.mockReturnValue({
      stripeCustomerId: "cus_host"
    })
    mocks.verifyExpectedStripeAccount.mockRejectedValue(
      new Error(
        "actual acct_other expected acct_logloads"
      )
    )

    const response = await startCheckout(
      request({ organizationSubscriptionId: SUBSCRIPTION_ID })
    )
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(JSON.stringify(body)).not.toContain("acct_other")
    expect(JSON.stringify(body)).not.toContain("acct_logloads")
  })

  it("does not reveal or open another organization's accepted subscription", async () => {
    mocks.operatingStateAccess.mockReturnValue(
      stateAccess({
        organizationSubscriptions: [
          canonicalSubscription({ organizationId: OTHER_ORGANIZATION_ID })
        ]
      })
    )

    const response = await startCheckout(
      request({ organizationSubscriptionId: SUBSCRIPTION_ID })
    )

    expect(response.status).toBe(404)
    expect(mocks.resolveSubscriptionStripe).not.toHaveBeenCalled()
  })

  it.each([
    {
      acceptedTermsVersion: "attacker-selected",
      organizationSubscriptionId: SUBSCRIPTION_ID
    },
    {
      organizationId: OTHER_ORGANIZATION_ID,
      organizationSubscriptionId: SUBSCRIPTION_ID
    },
    {
      acceptDispatchProTerms: true,
      acceptedTermsVersion: "attacker-selected"
    },
    {
      acceptDispatchProTerms: true,
      organizationId: OTHER_ORGANIZATION_ID
    },
    {
      acceptDispatchProTerms: true,
      organizationSubscriptionId: SUBSCRIPTION_ID
    }
  ])("rejects extra browser-controlled billing identity fields", async (body) => {
    const response = await startCheckout(request(body))

    expect(response.status).toBe(422)
    expect(mocks.requireApiActor).not.toHaveBeenCalled()
    expect(mocks.operatingStateAccess).not.toHaveBeenCalled()
    expect(mocks.resolveSubscriptionStripe).not.toHaveBeenCalled()
  })

  it("uses the store-once negotiated Enterprise Price for an authorized post-Pilot target", async () => {
    const createCheckoutSession = vi.fn().mockResolvedValue({
      id: "cs_enterprise",
      url: "https://checkout.stripe.test/enterprise"
    })
    mocks.operatingStateAccess.mockReturnValue(
      stateAccess({
        organizationSubscriptions: [
          canonicalSubscription({
            billingModel: "enterprise_custom",
            convertedFromPlanCode: "network_pilot",
            convertedFromSubscriptionId:
              "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeec",
            planCode: "enterprise_250_plus",
            planSnapshot: { stripePriceId: "price_negotiated_enterprise" }
          })
        ]
      })
    )
    mocks.resolveSubscriptionStripe.mockReturnValue({
      ok: true,
      port: { createCheckoutSession }
    })

    const response = await startCheckout(
      request({ organizationSubscriptionId: SUBSCRIPTION_ID })
    )

    expect(response.status).toBe(200)
    expect(mocks.verifyAcceptedPrice).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        priceId: "price_negotiated_enterprise",
        role: "base",
        subscriptionId: SUBSCRIPTION_ID
      })
    )
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ priceId: "price_negotiated_enterprise" })
    )
  })

  it("returns 409 before acceptance or Stripe when the displayed conversion quote is stale", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-27T00:00:00.000Z"))
    const state = {
      billingPlanDefinitions: [...SUBSCRIPTION_PLAN_CATALOG],
      hostBillingProfiles: [],
      organizationSubscriptions: [pilotConversionSource()]
    }
    const before = structuredClone(state)
    mocks.operatingStateAccess.mockReturnValue(stateAccess(state))

    const response = await startCheckout(
      request({
        acceptNetworkTerms: true,
        convertPilotSubscriptionId: SUBSCRIPTION_ID,
        quoteFingerprint: `${NETWORK_25_QUOTE_FINGERPRINT}:stale`,
        targetPlanCode: "network_25"
      })
    )

    expect(response.status).toBe(409)
    expect(state).toEqual(before)
    expect(
      mocks.authorizePilotConversionSubscription
    ).not.toHaveBeenCalled()
    expect(mocks.resolveSubscriptionStripe).not.toHaveBeenCalled()
  })

  it("returns a sanitized 409 for a caller-correctable Pilot conversion refusal", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-27T00:00:00.000Z"))
    const state = {
      billingPlanDefinitions: [...SUBSCRIPTION_PLAN_CATALOG],
      hostBillingProfiles: [],
      organizationSubscriptions: [pilotConversionSource()]
    }
    mocks.operatingStateAccess.mockReturnValue(stateAccess(state))
    mocks.authorizePilotConversionSubscription.mockImplementation(() => {
      throw new mocks.DomainRefusalError(
        `Subscription ${SUBSCRIPTION_ID} cannot convert into ${CONVERSION_SUBSCRIPTION_ID}`
      )
    })

    const response = await startCheckout(
      request({
        acceptNetworkTerms: true,
        convertPilotSubscriptionId: SUBSCRIPTION_ID,
        quoteFingerprint: NETWORK_25_QUOTE_FINGERPRINT,
        targetPlanCode: "network_25"
      })
    )
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(409)
    expect(body.error).toBe(
      "This request conflicts with current records or policy. Refresh and correct the request before retrying."
    )
    expect(body.error).not.toContain(SUBSCRIPTION_ID)
    expect(body.error).not.toContain(CONVERSION_SUBSCRIPTION_ID)
    expect(mocks.resolveSubscriptionStripe).not.toHaveBeenCalled()
  })

  it("keeps an unexpected Pilot conversion invariant failure on the 500 path", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-27T00:00:00.000Z"))
    const state = {
      billingPlanDefinitions: [...SUBSCRIPTION_PLAN_CATALOG],
      hostBillingProfiles: [],
      organizationSubscriptions: [pilotConversionSource()]
    }
    mocks.operatingStateAccess.mockReturnValue(stateAccess(state))
    mocks.authorizePilotConversionSubscription.mockImplementation(() => {
      throw new Error(
        `Subscription ${SUBSCRIPTION_ID} has conflicting canonical billing accounts`
      )
    })

    const response = await startCheckout(
      request({
        acceptNetworkTerms: true,
        convertPilotSubscriptionId: SUBSCRIPTION_ID,
        quoteFingerprint: NETWORK_25_QUOTE_FINGERPRINT,
        targetPlanCode: "network_25"
      })
    )
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(500)
    expect(body.error).toBe("We could not complete that request.")
    expect(body.error).not.toContain(SUBSCRIPTION_ID)
    expect(mocks.resolveSubscriptionStripe).not.toHaveBeenCalled()
  })

  it("authorizes a fresh fixed-tier subscription and opens Checkout during Pilot grace", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-27T00:00:00.000Z"))
    vi.stubEnv("STRIPE_PRICE_NETWORK_25", "price_network_25")
    const source = pilotConversionSource()
    const target = pilotConversionTarget()
    const state = {
      billingPlanDefinitions: [...SUBSCRIPTION_PLAN_CATALOG],
      hostBillingProfiles: [],
      organizationSubscriptions: [source]
    }
    const createCheckoutSession = vi.fn().mockResolvedValue({
      id: "cs_conversion",
      url: "https://checkout.stripe.test/conversion"
    })
    mocks.operatingStateAccess.mockReturnValue(stateAccess(state))
    mocks.findHostBillingProfile.mockReturnValue({
      stripeCustomerId: "cus_host"
    })
    mocks.authorizePilotConversionSubscription.mockReturnValue({
      account: {},
      changed: true,
      sourceSubscription: source,
      targetSubscription: target
    })
    mocks.resolveSubscriptionStripe.mockReturnValue({
      ok: true,
      port: { createCheckoutSession }
    })

    const response = await startCheckout(
      request({
        acceptNetworkTerms: true,
        convertPilotSubscriptionId: SUBSCRIPTION_ID,
        quoteFingerprint: NETWORK_25_QUOTE_FINGERPRINT,
        targetPlanCode: "network_25"
      })
    )

    expect(response.status).toBe(200)
    expect(mocks.authorizePilotConversionSubscription).toHaveBeenCalledWith(
      state,
      expect.objectContaining({
        acceptedAt: "2026-10-27T00:00:00.000Z",
        acceptedByUserId: ACTOR_ID,
        acceptedQuoteFingerprint:
          NETWORK_25_QUOTE_FINGERPRINT,
        acceptedTermsVersion: NETWORK_CONVERSION_TERMS_VERSION,
        actorUserId: ACTOR_ID,
        sourceSubscriptionId: SUBSCRIPTION_ID,
        targetPlanCode: "network_25"
      }),
      "2026-10-27T00:00:00.000Z"
    )
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "cus_host",
        expiresAtSeconds:
          Date.parse("2026-10-28T00:00:00.000Z") / 1000,
        idempotencyKey:
          `logloads:subscription:${CONVERSION_SUBSCRIPTION_ID}:checkout`,
        metadata: expect.objectContaining({
          organizationSubscriptionId: CONVERSION_SUBSCRIPTION_ID,
          planCode: "network_25"
        }),
        priceId: "price_network_25"
      })
    )
  })

  it("reuses the authorized conversion target but refuses Checkout after grace", async () => {
    vi.useFakeTimers()
    vi.stubEnv("STRIPE_PRICE_NETWORK_25", "price_network_25")
    const source = pilotConversionSource()
    const target = pilotConversionTarget()
    const state = {
      billingPlanDefinitions: [...SUBSCRIPTION_PLAN_CATALOG],
      hostBillingProfiles: [],
      organizationSubscriptions: [source, target]
    }
    const createCheckoutSession = vi.fn().mockResolvedValue({
      id: "cs_conversion",
      url: "https://checkout.stripe.test/conversion"
    })
    mocks.operatingStateAccess.mockReturnValue(stateAccess(state))
    mocks.findHostBillingProfile.mockReturnValue({
      stripeCustomerId: "cus_host"
    })
    mocks.resolveSubscriptionStripe.mockReturnValue({
      ok: true,
      port: { createCheckoutSession }
    })

    vi.setSystemTime(new Date("2026-10-28T00:00:00.000Z"))
    expect(
      (
        await startCheckout(
          request({
            acceptNetworkTerms: true,
            convertPilotSubscriptionId: SUBSCRIPTION_ID,
            quoteFingerprint:
              NETWORK_25_QUOTE_FINGERPRINT,
            targetPlanCode: "network_25"
          })
        )
      ).status
    ).toBe(200)
    expect(mocks.authorizePilotConversionSubscription).not.toHaveBeenCalled()
    expect(createCheckoutSession).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date("2026-11-09T00:00:00.000Z"))
    const expired = await startCheckout(
      request({
        acceptNetworkTerms: true,
        convertPilotSubscriptionId: SUBSCRIPTION_ID,
        quoteFingerprint: NETWORK_25_QUOTE_FINGERPRINT,
        targetPlanCode: "network_25"
      })
    )

    expect(expired.status).toBe(409)
    expect(createCheckoutSession).toHaveBeenCalledTimes(1)
  })

  it("retries an accepted v1 target from its frozen quote after a v2 catalog becomes active", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-28T00:00:00.000Z"))
    vi.stubEnv("STRIPE_PRICE_NETWORK_25", "price_network_25")
    const source = pilotConversionSource()
    const target = pilotConversionTarget()
    const activeV2 = {
      ...subscriptionPlanDefinition("network_25"),
      baseMonthlyPriceCents: 325_000,
      effectiveAt: "2026-10-27T12:00:00.000Z",
      version: 2
    }
    const state = {
      billingPlanDefinitions: [
        ...SUBSCRIPTION_PLAN_CATALOG,
        activeV2
      ],
      hostBillingProfiles: [],
      organizationSubscriptions: [source, target]
    }
    const createCheckoutSession = vi.fn().mockResolvedValue({
      id: "cs_conversion_v1_retry",
      url: "https://checkout.stripe.test/conversion-v1-retry"
    })
    mocks.operatingStateAccess.mockReturnValue(stateAccess(state))
    mocks.findHostBillingProfile.mockReturnValue({
      stripeCustomerId: "cus_host"
    })
    mocks.resolveSubscriptionStripe.mockReturnValue({
      ok: true,
      port: { createCheckoutSession }
    })

    const response = await startCheckout(
      request({
        acceptNetworkTerms: true,
        convertPilotSubscriptionId: SUBSCRIPTION_ID,
        quoteFingerprint: NETWORK_25_QUOTE_FINGERPRINT,
        targetPlanCode: "network_25"
      })
    )

    expect(response.status).toBe(200)
    expect(
      mocks.authorizePilotConversionSubscription
    ).not.toHaveBeenCalled()
    expect(mocks.verifyAcceptedPrice).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        plan: target.planSnapshot,
        priceId: "price_network_25"
      })
    )
    expect(createCheckoutSession).toHaveBeenCalledTimes(1)
  })

  it("refuses a conversion Checkout when less than Stripe's 30-minute minimum remains", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-08T23:31:00.000Z"))
    vi.stubEnv("STRIPE_PRICE_NETWORK_25", "price_network_25")
    const state = {
      billingPlanDefinitions: [...SUBSCRIPTION_PLAN_CATALOG],
      hostBillingProfiles: [],
      organizationSubscriptions: [
        pilotConversionSource(),
        pilotConversionTarget()
      ]
    }
    const createCheckoutSession = vi.fn()
    mocks.operatingStateAccess.mockReturnValue(stateAccess(state))
    mocks.resolveSubscriptionStripe.mockReturnValue({
      ok: true,
      port: { createCheckoutSession }
    })

    const response = await startCheckout(
      request({
        acceptNetworkTerms: true,
        convertPilotSubscriptionId: SUBSCRIPTION_ID,
        quoteFingerprint: NETWORK_25_QUOTE_FINGERPRINT,
        targetPlanCode: "network_25"
      })
    )

    expect(response.status).toBe(409)
    expect(createCheckoutSession).not.toHaveBeenCalled()
    expect(mocks.verifyAcceptedPrice).not.toHaveBeenCalled()
  })

  it("caps conversion Checkout expiry at the exact grace boundary", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-08T23:15:00.000Z"))
    vi.stubEnv("STRIPE_PRICE_NETWORK_25", "price_network_25")
    const createCheckoutSession = vi.fn().mockResolvedValue({
      id: "cs_conversion_grace_cap",
      url: "https://checkout.stripe.test/conversion-grace-cap"
    })
    const state = {
      billingPlanDefinitions: [...SUBSCRIPTION_PLAN_CATALOG],
      hostBillingProfiles: [],
      organizationSubscriptions: [
        pilotConversionSource(),
        pilotConversionTarget()
      ]
    }
    mocks.operatingStateAccess.mockReturnValue(stateAccess(state))
    mocks.findHostBillingProfile.mockReturnValue({
      stripeCustomerId: "cus_host"
    })
    mocks.resolveSubscriptionStripe.mockReturnValue({
      ok: true,
      port: { createCheckoutSession }
    })

    const response = await startCheckout(
      request({
        acceptNetworkTerms: true,
        convertPilotSubscriptionId: SUBSCRIPTION_ID,
        quoteFingerprint: NETWORK_25_QUOTE_FINGERPRINT,
        targetPlanCode: "network_25"
      })
    )

    expect(response.status).toBe(200)
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAtSeconds:
          Date.parse("2026-11-09T00:00:00.000Z") / 1000
      })
    )
  })

  it.each(["carrier", "fleet"])(
    "accepts and authorizes canonical Dispatch Pro for a %s before opening Checkout",
    async (organizationType) => {
      vi.stubEnv("STRIPE_PRICE_DISPATCH", "price_dispatch")
      const createCheckoutSession = vi.fn().mockResolvedValue({
        id: "cs_dispatch",
        url: "https://checkout.stripe.test/dispatch"
      })
      const state = {
        hostBillingProfiles: [],
        organizationSubscriptions: [] as ReturnType<
          typeof canonicalSubscription
        >[]
      }
      const access = stateAccess(state)
      const acceptedSubscription = canonicalDispatchSubscription({
        activationAuthorizedAt: null
      })
      const activatedSubscription = {
        ...acceptedSubscription,
        activationAuthorizedAt: "2026-07-28T01:00:00.000Z",
        activationAuthorizedByUserId: ACTOR_ID
      }
      mocks.requireApiActor.mockResolvedValue(
        actor(ORGANIZATION_ID, "owner", organizationType)
      )
      mocks.operatingStateAccess.mockReturnValue(access)
      mocks.acceptDispatchProSubscription.mockReturnValue({
        account: {},
        changed: true,
        subscription: acceptedSubscription
      })
      mocks.activateOrganizationSubscription.mockReturnValue({
        account: {},
        changed: true,
        subscription: activatedSubscription
      })
      mocks.resolveSubscriptionStripe.mockReturnValue({
        ok: true,
        port: { createCheckoutSession }
      })

      const response = await startCheckout(
        request({ acceptDispatchProTerms: true })
      )

      expect(response.status).toBe(200)
      expect(access.mutate).toHaveBeenCalledTimes(1)
      expect(access.read).not.toHaveBeenCalled()
      expect(mocks.acceptDispatchProSubscription).toHaveBeenCalledWith(
        state,
        {
          acceptedAt: expect.any(String),
          acceptedByUserId: ACTOR_ID,
          acceptedTermsVersion: DISPATCH_PRO_TERMS_VERSION,
          organizationId: ORGANIZATION_ID
        },
        expect.any(String)
      )
      expect(mocks.activateOrganizationSubscription).toHaveBeenCalledWith(
        state,
        {
          actorUserId: ACTOR_ID,
          organizationId: ORGANIZATION_ID,
          subscriptionId: SUBSCRIPTION_ID
        },
        expect.any(String)
      )
      expect(
        mocks.acceptDispatchProSubscription.mock.invocationCallOrder[0]
      ).toBeLessThan(
        mocks.activateOrganizationSubscription.mock.invocationCallOrder[0] ??
          Number.POSITIVE_INFINITY
      )
      expect(createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          cancelUrl:
            "https://logloads.test/fleet/billing?checkout=cancelled",
          customerId: null,
          idempotencyKey:
            `logloads:subscription:${SUBSCRIPTION_ID}:checkout`,
          organizationId: ORGANIZATION_ID,
          priceId: "price_dispatch",
          successUrl:
            "https://logloads.test/fleet/billing?checkout=success"
        })
      )
    }
  )

  it("preserves another active billing manager's current Dispatch acceptance while authorizing the current attempt", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-29T01:00:00.000Z"))
    vi.stubEnv("STRIPE_PRICE_DISPATCH", "price_dispatch")
    const existing = canonicalDispatchSubscription({
      acceptedAt: "2026-07-28T01:00:00.000Z",
      acceptedByUserId: OTHER_ACTOR_ID,
      activationAuthorizedAt: null,
      activationAuthorizedByUserId: null
    })
    const state = {
      hostBillingProfiles: [],
      organizationSubscriptions: [existing]
    }
    const activated = {
      ...existing,
      activationAuthorizedAt: "2026-07-29T01:00:00.000Z",
      activationAuthorizedByUserId: ACTOR_ID
    }
    const createCheckoutSession = vi.fn().mockResolvedValue({
      id: "cs_dispatch",
      url: "https://checkout.stripe.test/dispatch"
    })

    mocks.requireApiActor.mockResolvedValue(
      actor(ORGANIZATION_ID, "billing", "fleet")
    )
    mocks.operatingStateAccess.mockReturnValue(stateAccess(state))
    mocks.acceptDispatchProSubscription.mockReturnValue({
      account: {},
      changed: false,
      subscription: existing
    })
    mocks.activateOrganizationSubscription.mockReturnValue({
      account: {},
      changed: true,
      subscription: activated
    })
    mocks.resolveSubscriptionStripe.mockReturnValue({
      ok: true,
      port: { createCheckoutSession }
    })

    const response = await startCheckout(
      request({ acceptDispatchProTerms: true })
    )

    expect(response.status).toBe(200)
    expect(mocks.acceptDispatchProSubscription).toHaveBeenCalledWith(
      state,
      expect.objectContaining({
        acceptedAt: "2026-07-28T01:00:00.000Z",
        acceptedByUserId: OTHER_ACTOR_ID,
        acceptedTermsVersion: DISPATCH_PRO_TERMS_VERSION,
        organizationId: ORGANIZATION_ID
      }),
      "2026-07-28T01:00:00.000Z"
    )
    expect(mocks.activateOrganizationSubscription).toHaveBeenCalledWith(
      state,
      {
        actorUserId: ACTOR_ID,
        organizationId: ORGANIZATION_ID,
        subscriptionId: SUBSCRIPTION_ID
      },
      "2026-07-29T01:00:00.000Z"
    )
  })

  it("converges a provider failure retry on one accepted Dispatch agreement and Checkout key", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-28T02:00:00.000Z"))
    vi.stubEnv("STRIPE_PRICE_DISPATCH", "price_dispatch")
    const state = {
      hostBillingProfiles: [],
      organizationSubscriptions: [] as ReturnType<
        typeof canonicalSubscription
      >[]
    }
    const access = stateAccess(state)
    const createCheckoutSession = vi
      .fn()
      .mockRejectedValueOnce(new Error("synthetic provider timeout"))
      .mockResolvedValueOnce({
        id: "cs_dispatch",
        url: "https://checkout.stripe.test/dispatch"
      })

    mocks.requireApiActor
      .mockResolvedValueOnce(actor(ORGANIZATION_ID, "owner", "fleet"))
      .mockResolvedValueOnce({
        ...actor(ORGANIZATION_ID, "billing", "fleet"),
        actorUserId: OTHER_ACTOR_ID
      })
    mocks.operatingStateAccess.mockReturnValue(access)
    mocks.acceptDispatchProSubscription.mockImplementation(
      (
        current: typeof state,
        input: {
          acceptedAt: string
          acceptedByUserId: string
          acceptedTermsVersion: string
          organizationId: string
        }
      ) => {
        let subscription = current.organizationSubscriptions.find(
          (candidate) =>
            candidate.organizationId === input.organizationId &&
            candidate.planCode === "dispatch_pro"
        )
        const changed = !subscription

        if (!subscription) {
          subscription = canonicalDispatchSubscription({
            acceptedAt: input.acceptedAt,
            acceptedByUserId: input.acceptedByUserId,
            acceptedTermsVersion: input.acceptedTermsVersion,
            activationAuthorizedAt: null
          })
          current.organizationSubscriptions.push(subscription)
        }

        return { account: {}, changed, subscription }
      }
    )
    mocks.activateOrganizationSubscription.mockImplementation(
      (
        current: typeof state,
        input: { actorUserId: string; subscriptionId: string },
        at: string
      ) => {
        const index = current.organizationSubscriptions.findIndex(
          (candidate) => candidate.id === input.subscriptionId
        )
        const previous = current.organizationSubscriptions[index]

        if (!previous) {
          throw new Error("Synthetic subscription is missing")
        }

        const subscription = {
          ...previous,
          activationAuthorizedAt: previous.activationAuthorizedAt ?? at,
          activationAuthorizedByUserId:
            previous.activationAuthorizedByUserId ?? input.actorUserId
        }
        current.organizationSubscriptions[index] = subscription

        return {
          account: {},
          changed: !previous.activationAuthorizedAt,
          subscription
        }
      }
    )
    mocks.resolveSubscriptionStripe.mockReturnValue({
      ok: true,
      port: { createCheckoutSession }
    })

    const first = await startCheckout(
      request({ acceptDispatchProTerms: true })
    )

    vi.setSystemTime(new Date("2026-07-29T02:00:00.000Z"))
    const retry = await startCheckout(
      request({ acceptDispatchProTerms: true })
    )

    expect(first.status).toBe(500)
    expect(retry.status).toBe(200)
    expect(state.organizationSubscriptions).toHaveLength(1)
    expect(access.mutate).toHaveBeenCalledTimes(2)
    expect(access.read).not.toHaveBeenCalled()
    expect(mocks.acceptDispatchProSubscription).toHaveBeenCalledTimes(2)
    expect(
      mocks.acceptDispatchProSubscription.mock.calls.map(
        ([, input]) => [input.acceptedAt, input.acceptedByUserId]
      )
    ).toEqual([
      ["2026-07-28T02:00:00.000Z", ACTOR_ID],
      ["2026-07-28T02:00:00.000Z", ACTOR_ID]
    ])
    expect(
      mocks.activateOrganizationSubscription.mock.calls.map(
        ([, input, at]) => [input.actorUserId, at]
      )
    ).toEqual([
      [ACTOR_ID, "2026-07-28T02:00:00.000Z"],
      [OTHER_ACTOR_ID, "2026-07-29T02:00:00.000Z"]
    ])
    expect(createCheckoutSession).toHaveBeenCalledTimes(2)
    expect(
      createCheckoutSession.mock.calls.map(([input]) => input.idempotencyKey)
    ).toEqual([
      `logloads:subscription:${SUBSCRIPTION_ID}:checkout`,
      `logloads:subscription:${SUBSCRIPTION_ID}:checkout`
    ])
  })

  it.each(["landing_source", "destination"])(
    "does not let a %s organization self-accept Dispatch Pro",
    async (organizationType) => {
      const access = stateAccess({
        hostBillingProfiles: [],
        organizationSubscriptions: []
      })
      mocks.requireApiActor.mockResolvedValue(
        actor(ORGANIZATION_ID, "owner", organizationType)
      )
      mocks.operatingStateAccess.mockReturnValue(access)

      const response = await startCheckout(
        request({ acceptDispatchProTerms: true })
      )

      expect(response.status).toBe(403)
      expect(access.mutate).not.toHaveBeenCalled()
      expect(mocks.acceptDispatchProSubscription).not.toHaveBeenCalled()
      expect(mocks.resolveSubscriptionStripe).not.toHaveBeenCalled()
    }
  )

  it("does not let the id-based Network path bypass Dispatch acceptance", async () => {
    mocks.requireApiActor.mockResolvedValue(
      actor(ORGANIZATION_ID, "owner", "carrier")
    )
    mocks.operatingStateAccess.mockReturnValue(
      stateAccess({
        hostBillingProfiles: [],
        organizationSubscriptions: [canonicalDispatchSubscription()]
      })
    )

    const response = await startCheckout(
      request({ organizationSubscriptionId: SUBSCRIPTION_ID })
    )

    expect(response.status).toBe(403)
    expect(mocks.acceptDispatchProSubscription).not.toHaveBeenCalled()
    expect(mocks.resolveSubscriptionStripe).not.toHaveBeenCalled()
  })

  it.each([
    ["carrier", "network_pilot"],
    ["fleet", "network_pilot"]
  ])(
    "rejects %s enrollment into the incompatible %s product family",
    async (organizationType, planCode) => {
      mocks.requireApiActor.mockResolvedValue(
        actor(ORGANIZATION_ID, "owner", organizationType)
      )
      mocks.operatingStateAccess.mockReturnValue(
        stateAccess({
          hostBillingProfiles: [],
          organizationSubscriptions: [
            canonicalSubscription({
              planCode
            })
          ]
        })
      )

      const response = await startCheckout(
        request({ organizationSubscriptionId: SUBSCRIPTION_ID })
      )

      expect(response.status).toBe(403)
      expect(mocks.resolveSubscriptionStripe).not.toHaveBeenCalled()
    }
  )
})

describe("Network subscription portal route", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://logloads.test")
    vi.stubEnv("STRIPE_PORTAL_CONFIGURATION_NETWORK", "bpc_network")
    mocks.enforceApiRateLimit.mockResolvedValue(undefined)
    mocks.requireApiActor.mockResolvedValue(actor())
    mocks.resolveSubscriptionStripe.mockReturnValue({
      ok: true,
      port: { marker: "stripe" }
    })
    mocks.verifyExpectedStripeAccount.mockResolvedValue(undefined)
  })

  it("remains usable while new collection is dark", async () => {
    const createBillingPortalSession = vi.fn().mockResolvedValue({
      id: "bps_network",
      url: "https://billing.stripe.test/network"
    })
    mocks.operatingStateAccess.mockReturnValue(
      stateAccess({
        organizationSubscriptions: [
          canonicalSubscription({
            status: "active",
            stripeSubscriptionId: "sub_network"
          })
        ]
      })
    )
    mocks.resolveStripeBilling.mockReturnValue({
      ok: true,
      value: { createBillingPortalSession }
    })

    const response = await startPortal(
      request({ organizationSubscriptionId: SUBSCRIPTION_ID })
    )

    expect(response.status).toBe(200)
    expect(mocks.subscriptionCollectionEnabled).not.toHaveBeenCalled()
    expect(createBillingPortalSession).toHaveBeenCalledWith({
      configurationId: "bpc_network",
      customerId: "cus_host",
      returnUrl: "https://logloads.test/host/billing"
    })
  })

  it("does not open the portal for another organization's subscription", async () => {
    mocks.operatingStateAccess.mockReturnValue(
      stateAccess({
        organizationSubscriptions: [
          canonicalSubscription({
            organizationId: OTHER_ORGANIZATION_ID,
            stripeSubscriptionId: "sub_other"
          })
        ]
      })
    )

    const response = await startPortal(
      request({ organizationSubscriptionId: SUBSCRIPTION_ID })
    )

    expect(response.status).toBe(404)
    expect(mocks.resolveStripeBilling).not.toHaveBeenCalled()
  })

  it("returns a canonical fleet Dispatch subscription to fleet billing", async () => {
    const createBillingPortalSession = vi.fn().mockResolvedValue({
      id: "bps_dispatch",
      url: "https://billing.stripe.test/dispatch"
    })
    mocks.requireApiActor.mockResolvedValue(
      actor(ORGANIZATION_ID, "owner", "fleet")
    )
    mocks.operatingStateAccess.mockReturnValue(
      stateAccess({
        organizationSubscriptions: [
          canonicalSubscription({
            billingModel: "dispatch_pro",
            planCode: "dispatch_pro",
            status: "active",
            stripeSubscriptionId: "sub_dispatch"
          })
        ]
      })
    )
    mocks.resolveStripeBilling.mockReturnValue({
      ok: true,
      value: { createBillingPortalSession }
    })

    const response = await startPortal(
      request({ organizationSubscriptionId: SUBSCRIPTION_ID })
    )

    expect(response.status).toBe(200)
    expect(createBillingPortalSession).toHaveBeenCalledWith({
      configurationId: "bpc_network",
      customerId: "cus_host",
      returnUrl: "https://logloads.test/fleet/billing"
    })
  })

  it.each([
    ["landing_source", "dispatch_pro"],
    ["fleet", "network_pilot"]
  ])(
    "refuses an incompatible %s portal for %s",
    async (organizationType, planCode) => {
      mocks.requireApiActor.mockResolvedValue(
        actor(ORGANIZATION_ID, "owner", organizationType)
      )
      mocks.operatingStateAccess.mockReturnValue(
        stateAccess({
          organizationSubscriptions: [
            canonicalSubscription({
              billingModel:
                planCode === "dispatch_pro"
                  ? "dispatch_pro"
                  : "subscription_v1",
              planCode,
              status: "active",
              stripeSubscriptionId: "sub_incompatible"
            })
          ]
        })
      )

      const response = await startPortal(
        request({ organizationSubscriptionId: SUBSCRIPTION_ID })
      )

      expect(response.status).toBe(403)
      expect(mocks.resolveStripeBilling).not.toHaveBeenCalled()
    }
  )
})

describe("internal nominal billing route", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv("STRIPE_PRICE_INTERNAL_BILLING_TEST", "price_internal_only")
    mocks.enforceApiRateLimit.mockResolvedValue(undefined)
    mocks.requireAdminApiActor.mockResolvedValue({ profile: { id: ACTOR_ID } })
    mocks.internalBillingSmokeAuthorization.mockReturnValue({ allowed: true })
    mocks.internalBillingSmokeTargetAuthorization.mockReturnValue({
      allowed: true
    })
    mocks.resolveSubscriptionStripe.mockReturnValue({ ok: true, port: { marker: "stripe" } })
  })

  it("requires platform-admin authentication before checking its separate gate", async () => {
    mocks.requireAdminApiActor.mockRejectedValue(
      new mocks.ApiError("Administrator access is required", 403)
    )

    const response = await runInternalSmoke(
      request({
        action: "charge",
        confirm: "CHARGE_ONE_DOLLAR",
        organizationId: ORGANIZATION_ID
      })
    )

    expect(response.status).toBe(403)
    expect(mocks.internalBillingSmokeAuthorization).not.toHaveBeenCalled()
    expect(mocks.resolveSubscriptionStripe).not.toHaveBeenCalled()
  })

  it("does not touch Stripe when the founder allowlist gate refuses the actor", async () => {
    mocks.internalBillingSmokeAuthorization.mockReturnValue({
      allowed: false,
      reason: "not_allowlisted"
    })

    const response = await runInternalSmoke(
      request({
        action: "charge",
        confirm: "CHARGE_ONE_DOLLAR",
        organizationId: ORGANIZATION_ID
      })
    )

    expect(response.status).toBe(403)
    expect(mocks.resolveSubscriptionStripe).not.toHaveBeenCalled()
  })

  it("does not touch Stripe when the target organization is not separately allowlisted", async () => {
    mocks.internalBillingSmokeTargetAuthorization.mockReturnValue({
      allowed: false,
      reason: "organization_not_allowlisted"
    })
    mocks.operatingStateAccess.mockReturnValue(
      stateAccess({
        auditEvents: [],
        hostBillingProfiles: [],
        organizationBillingAccounts: []
      })
    )

    const response = await runInternalSmoke(
      request({
        action: "charge",
        confirm: "CHARGE_ONE_DOLLAR",
        organizationId: ORGANIZATION_ID
      })
    )

    expect(response.status).toBe(403)
    expect(mocks.resolveSubscriptionStripe).not.toHaveBeenCalled()
  })

  it("uses only the hidden environment Price for an approved manual charge", async () => {
    const state = {
      auditEvents: [],
      hostBillingProfiles: [
        { organizationId: ORGANIZATION_ID, stripeCustomerId: "cus_internal" }
      ],
      organizationBillingAccounts: []
    }
    mocks.operatingStateAccess.mockReturnValue(stateAccess(state))
    mocks.findHostBillingProfile.mockReturnValue({
      organizationId: ORGANIZATION_ID,
      stripeCustomerId: "cus_internal"
    })
    mocks.ensureInternalSmokeInvoice.mockResolvedValue({
      id: "in_internal",
      paid: true,
      status: "paid"
    })

    const response = await runInternalSmoke(
      request({
        action: "charge",
        confirm: "CHARGE_ONE_DOLLAR",
        organizationId: ORGANIZATION_ID,
        priceId: "price_public_or_attacker_controlled"
      })
    )

    expect(response.status).toBe(200)
    expect(mocks.ensureInternalSmokeInvoice).toHaveBeenCalledWith(
      { marker: "stripe" },
      {
        actorUserId: ACTOR_ID,
        collect: true,
        customerId: "cus_internal",
        priceId: "price_internal_only"
      }
    )
  })

  it("refunds the exact audited charge after the master and organization creation gates are removed", async () => {
    mocks.internalBillingSmokeAuthorization.mockReturnValue({
      allowed: false,
      reason: "disabled"
    })
    mocks.internalBillingSmokeTargetAuthorization.mockReturnValue({
      allowed: false,
      reason: "organization_not_allowlisted"
    })
    const state = {
      auditEvents: [
        {
          action: "internal_billing_smoke_charged",
          metadata: {
            internalBillingTest: true,
            organizationId: ORGANIZATION_ID,
            ownerUserId: ACTOR_ID,
            stripeInvoiceId: "in_internal"
          }
        }
      ],
      hostBillingProfiles: [],
      organizationBillingAccounts: []
    }
    mocks.operatingStateAccess.mockReturnValue(stateAccess(state))
    mocks.refundInternalSmokeInvoice.mockResolvedValue({
      amountCents: 100,
      chargeId: "ch_internal",
      id: "re_internal",
      metadata: {
        billingSmokeRunId:
          "eeeeeeee-eeee-5eee-8eee-eeeeeeeeeeee",
        internal_billing_test: "true",
        ownerUserId: ACTOR_ID
      },
      status: "succeeded"
    })

    const response = await runInternalSmoke(
      request({
        action: "refund",
        confirm: "REFUND_ONE_DOLLAR"
      })
    )

    expect(response.status).toBe(200)
    expect(mocks.internalBillingSmokeAuthorization).not.toHaveBeenCalled()
    expect(
      mocks.internalBillingSmokeTargetAuthorization
    ).not.toHaveBeenCalled()
    expect(mocks.refundInternalSmokeInvoice).toHaveBeenCalledWith(
      { marker: "stripe" },
      {
        actorUserId: ACTOR_ID,
        stripeInvoiceId: "in_internal"
      }
    )
    expect(
      state.auditEvents.filter(
        (event) =>
          event.action === "internal_billing_smoke_refunded"
      )
    ).toHaveLength(1)
  })
})
