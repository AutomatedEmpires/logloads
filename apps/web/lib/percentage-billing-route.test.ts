import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PERCENTAGE_V1_TERMS_VERSION } from "@logloads/contracts"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      message: string,
      readonly status: number
    ) {
      super(message)
    }
  }

  return {
    ApiError,
    acceptPercentageBillingAgreement: vi.fn(),
    enforceApiRateLimit: vi.fn(),
    requireApiActor: vi.fn()
  }
})

vi.mock("@/lib/api-actor", () => ({
  ApiError: mocks.ApiError,
  apiErrorResponse(error: unknown) {
    const status =
      error instanceof mocks.ApiError
        ? error.status
        : error instanceof Error && error.name === "ZodError"
          ? 422
          : 500
    const message =
      error instanceof mocks.ApiError
        ? error.message
        : status === 422
          ? "The request had missing or invalid fields."
          : "We could not complete that request."

    return Response.json({ error: message }, { status })
  },
  enforceApiRateLimit: mocks.enforceApiRateLimit,
  requireApiActor: mocks.requireApiActor
}))

vi.mock("@/lib/services", () => ({
  mutateState<T>(mutate: (draft: unknown) => T): Promise<T> {
    return Promise.resolve(
      mutate({
        acceptPercentageBillingAgreement:
          mocks.acceptPercentageBillingAgreement
      })
    )
  }
}))

import { POST } from "@/app/api/billing/percentage-agreement/route"

const ACTOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ORGANIZATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const ORGANIZATION_SCOPE_SHA256 =
  "00f765af1c54eb24e437746c4f64b5841490757b647bf3a392b042f872ad7090"

function actor(role = "owner", type = "landing_source") {
  return {
    actor: {
      memberships: [
        {
          membership: { role },
          organization: { id: ORGANIZATION_ID, type }
        }
      ]
    },
    actorUserId: ACTOR_ID,
    organizationId: ORGANIZATION_ID
  }
}

function request(body: Record<string, unknown>) {
  return new Request(
    "https://logloads.test/api/billing/percentage-agreement",
    {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    }
  )
}

function rawRequest(body: string) {
  return new Request(
    "https://logloads.test/api/billing/percentage-agreement",
    {
      body,
      headers: { "Content-Type": "application/json" },
      method: "POST"
    }
  )
}

describe("percentage billing agreement route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("LOGLOADS_PERCENTAGE_ENROLLMENT", "enabled")
    vi.stubEnv(
      "LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS",
      ORGANIZATION_ID
    )
    vi.stubEnv(
      "LOGLOADS_PERCENTAGE_EXPECTED_ORGANIZATION_SCOPE_SHA256",
      ORGANIZATION_SCOPE_SHA256
    )
    mocks.requireApiActor.mockResolvedValue(actor())
    mocks.acceptPercentageBillingAgreement.mockReturnValue({
      account: {
        activationState: "percentage_active",
        billingModel: "percentage_v1",
        percentageTermsSnapshot: {
          acceptedTermsVersion: PERCENTAGE_V1_TERMS_VERSION
        }
      },
      changed: true
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("binds the authenticated host to the server-owned agreement", async () => {
    const response = await POST(request({ acceptPercentageTerms: true }))

    expect(response.status).toBe(200)
    expect(mocks.acceptPercentageBillingAgreement).toHaveBeenCalledWith({
      acceptedTermsVersion: PERCENTAGE_V1_TERMS_VERSION,
      actorUserId: ACTOR_ID,
      organizationId: ORGANIZATION_ID
    })
    await expect(response.json()).resolves.toEqual({
      agreement: {
        activationState: "percentage_active",
        billingModel: "percentage_v1",
        termsVersion: PERCENTAGE_V1_TERMS_VERSION
      },
      changed: true
    })
  })

  it("refuses a carrier workspace", async () => {
    mocks.requireApiActor.mockResolvedValue(actor("owner", "carrier"))

    const response = await POST(request({ acceptPercentageTerms: true }))

    expect(response.status).toBe(403)
    expect(mocks.acceptPercentageBillingAgreement).not.toHaveBeenCalled()
  })

  it("refuses a host member without billing authority", async () => {
    mocks.requireApiActor.mockResolvedValue(actor("viewer"))

    const response = await POST(request({ acceptPercentageTerms: true }))

    expect(response.status).toBe(403)
    expect(mocks.acceptPercentageBillingAgreement).not.toHaveBeenCalled()
  })

  it("keeps commercial enrollment dark until the exact host is activated", async () => {
    vi.stubEnv("LOGLOADS_PERCENTAGE_ENROLLMENT", "disabled")

    const disabled = await POST(
      request({ acceptPercentageTerms: true })
    )

    expect(disabled.status).toBe(403)
    expect(mocks.acceptPercentageBillingAgreement).not.toHaveBeenCalled()

    vi.stubEnv("LOGLOADS_PERCENTAGE_ENROLLMENT", "enabled")
    vi.stubEnv(
      "LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    )

    const unlisted = await POST(
      request({ acceptPercentageTerms: true })
    )

    expect(unlisted.status).toBe(403)
    expect(mocks.acceptPercentageBillingAgreement).not.toHaveBeenCalled()
  })

  it("rejects client-selected commercial terms", async () => {
    const response = await POST(
      request({
        acceptPercentageTerms: true,
        acceptedTermsVersion: "attacker-selected",
        feeBps: 1
      })
    )

    expect(response.status).toBe(422)
    expect(mocks.requireApiActor).toHaveBeenCalledOnce()
    expect(mocks.enforceApiRateLimit).toHaveBeenCalledOnce()
    expect(mocks.acceptPercentageBillingAgreement).not.toHaveBeenCalled()
  })

  it("authenticates and rate limits before rejecting malformed JSON", async () => {
    const response = await POST(rawRequest("{"))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: "The request must contain a valid JSON object"
    })
    expect(mocks.requireApiActor).toHaveBeenCalledOnce()
    expect(mocks.enforceApiRateLimit).toHaveBeenCalledOnce()
    expect(mocks.acceptPercentageBillingAgreement).not.toHaveBeenCalled()
  })

  it("stops an undeclared oversized body while streaming it", async () => {
    const response = await POST(
      rawRequest(JSON.stringify({ padding: "x".repeat(2_048) }))
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      error: "The percentage agreement request is too large"
    })
    expect(mocks.requireApiActor).toHaveBeenCalledOnce()
    expect(mocks.enforceApiRateLimit).toHaveBeenCalledOnce()
    expect(mocks.acceptPercentageBillingAgreement).not.toHaveBeenCalled()
  })
})
