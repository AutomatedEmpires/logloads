import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    readonly headers?: HeadersInit
    readonly status: number

    constructor(message: string, status: number, headers?: HeadersInit) {
      super(message)
      this.headers = headers
      this.status = status
    }
  }

  return {
    ApiError,
    enforceApiRateLimit: vi.fn(),
    hostCardOnFile: vi.fn(),
    hostCardSetupEligibility: vi.fn(),
    operatingStateAccess: vi.fn(),
    percentageEnrollmentAllowed: vi.fn(),
    readState: vi.fn(),
    requireApiActor: vi.fn(),
    resolveStripeBilling: vi.fn(),
    resolveSubscriptionStripe: vi.fn(),
    startHostCardSetup: vi.fn(),
    stripePublishableKey: vi.fn(),
    verifyExpectedStripeAccount: vi.fn()
  }
})

vi.mock("server-only", () => ({}))
vi.mock("@/lib/api-actor", () => ({
  ApiError: mocks.ApiError,
  apiErrorResponse(error: unknown) {
    if (error instanceof mocks.ApiError) {
      return Response.json(
        { error: error.message },
        { headers: error.headers, status: error.status }
      )
    }

    return Response.json({ error: "Unexpected failure" }, { status: 500 })
  },
  enforceApiRateLimit: mocks.enforceApiRateLimit,
  requireApiActor: mocks.requireApiActor
}))
vi.mock("@/lib/billing", () => ({
  hostCardOnFile: mocks.hostCardOnFile,
  operatingStateAccess: mocks.operatingStateAccess,
  resolveStripeBilling: mocks.resolveStripeBilling,
  startHostCardSetup: mocks.startHostCardSetup,
  stripePublishableKey: mocks.stripePublishableKey
}))
vi.mock("@/lib/host-card-eligibility", () => ({
  hostCardSetupEligibility: mocks.hostCardSetupEligibility
}))
vi.mock("@/lib/percentage-enrollment", () => ({
  percentageEnrollmentAllowed: mocks.percentageEnrollmentAllowed
}))
vi.mock("@/lib/services", () => ({
  readState: mocks.readState
}))
vi.mock("@/lib/subscription-stripe", () => ({
  resolveSubscriptionStripe: mocks.resolveSubscriptionStripe,
  verifyExpectedStripeAccount: mocks.verifyExpectedStripeAccount
}))

import { GET, POST } from "@/app/api/billing/payment-method/route"

const ACTOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ORGANIZATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const CANONICAL_STATE = { marker: "canonical-state" }
const ORGANIZATION = {
  id: ORGANIZATION_ID,
  name: "Pilot Landing",
  type: "landing_source"
}

describe("host payment method setup route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireApiActor.mockResolvedValue({
      actor: {
        memberships: [
          {
            membership: { role: "owner" },
            organization: ORGANIZATION
          }
        ]
      },
      actorUserId: ACTOR_ID,
      organizationId: ORGANIZATION_ID
    })
    mocks.enforceApiRateLimit.mockResolvedValue(undefined)
    mocks.readState.mockImplementation(
      async (read: (current: { state: typeof CANONICAL_STATE }) => unknown) =>
        read({ state: CANONICAL_STATE })
    )
    mocks.percentageEnrollmentAllowed.mockReturnValue(false)
    mocks.resolveStripeBilling.mockReturnValue({
      ok: true,
      value: { name: "stripe-billing-port" }
    })
    mocks.resolveSubscriptionStripe.mockReturnValue({
      ok: true,
      port: { name: "stripe-account-port" }
    })
    mocks.verifyExpectedStripeAccount.mockResolvedValue(undefined)
    mocks.stripePublishableKey.mockReturnValue({
      ok: true,
      value: "pk_test_logloads"
    })
    mocks.operatingStateAccess.mockReturnValue({ name: "operating-state" })
    mocks.hostCardOnFile.mockReturnValue({
      brand: "visa",
      last4: "4242"
    })
    mocks.startHostCardSetup.mockResolvedValue({
      ok: true,
      value: {
        clientSecret: "seti_secret",
        publishableKey: "pk_test_logloads"
      }
    })
  })

  it("does not cache the private card summary", async () => {
    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({
      card: { brand: "visa", last4: "4242" }
    })
  })

  it("refuses an ineligible host before resolving or calling Stripe setup", async () => {
    mocks.hostCardSetupEligibility.mockReturnValue({
      allowed: false,
      basis: "agreement_required",
      message: "Accept the current billing agreement before adding a card."
    })

    const response = await POST()

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "Accept the current billing agreement before adding a card."
    })
    expect(mocks.percentageEnrollmentAllowed).toHaveBeenCalledWith(
      ORGANIZATION_ID
    )
    expect(mocks.hostCardSetupEligibility).toHaveBeenCalledWith(
      CANONICAL_STATE,
      ORGANIZATION_ID,
      false
    )
    expect(mocks.resolveStripeBilling).not.toHaveBeenCalled()
    expect(mocks.resolveSubscriptionStripe).not.toHaveBeenCalled()
    expect(mocks.verifyExpectedStripeAccount).not.toHaveBeenCalled()
    expect(mocks.stripePublishableKey).not.toHaveBeenCalled()
    expect(mocks.operatingStateAccess).not.toHaveBeenCalled()
    expect(mocks.startHostCardSetup).not.toHaveBeenCalled()
  })

  it("passes the server-derived enrollment flag into eligible card setup", async () => {
    mocks.percentageEnrollmentAllowed.mockReturnValue(true)
    mocks.hostCardSetupEligibility.mockReturnValue({
      allowed: true,
      basis: "accepted_percentage_v1",
      existingCustomerId: null,
      message: null,
      profileCustomerId: null
    })

    const response = await POST()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({
      setup: {
        clientSecret: "seti_secret",
        publishableKey: "pk_test_logloads"
      }
    })
    expect(mocks.percentageEnrollmentAllowed).toHaveBeenCalledWith(
      ORGANIZATION_ID
    )
    expect(mocks.hostCardSetupEligibility).toHaveBeenCalledWith(
      CANONICAL_STATE,
      ORGANIZATION_ID,
      true
    )
    expect(mocks.verifyExpectedStripeAccount).toHaveBeenCalledWith(
      { name: "stripe-account-port" },
      process.env
    )
    expect(mocks.startHostCardSetup).toHaveBeenCalledWith({
      organization: ORGANIZATION,
      percentageEnrollmentAllowed: true,
      port: { name: "stripe-billing-port" },
      publishableKey: "pk_test_logloads",
      state: { name: "operating-state" }
    })
  })
})
