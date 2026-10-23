import { beforeEach, describe, expect, it, vi } from "vitest"
import { HOST_FEE_TERMS_VERSION, PLATFORM_FEE_BPS } from "@logloads/contracts"

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
    acceptHostFeeAgreement: vi.fn(),
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
      mutate({ acceptHostFeeAgreement: mocks.acceptHostFeeAgreement })
    )
  }
}))

import { POST } from "@/app/api/billing/fee-agreement/route"

const ACTOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ORGANIZATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

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
  return rawRequest(JSON.stringify(body))
}

function rawRequest(body: string) {
  return new Request("https://logloads.test/api/billing/fee-agreement", {
    body,
    headers: { "Content-Type": "application/json" },
    method: "POST"
  })
}

const ACCEPTANCE = { acceptFeeTerms: true, termsVersion: HOST_FEE_TERMS_VERSION }

describe("host fee agreement route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireApiActor.mockResolvedValue(actor())
    mocks.acceptHostFeeAgreement.mockReturnValue({
      agreement: {
        acceptedAt: "2026-10-14T12:00:00.000Z",
        feeBps: PLATFORM_FEE_BPS,
        termsVersion: HOST_FEE_TERMS_VERSION
      },
      changed: true
    })
  })

  it("records acceptance for the authenticated organization only", async () => {
    const response = await POST(request(ACCEPTANCE))

    expect(response.status).toBe(200)
    expect(mocks.acceptHostFeeAgreement).toHaveBeenCalledWith({
      actorUserId: ACTOR_ID,
      organizationId: ORGANIZATION_ID,
      termsVersion: HOST_FEE_TERMS_VERSION
    })
    await expect(response.json()).resolves.toEqual({
      agreement: {
        acceptedAt: "2026-10-14T12:00:00.000Z",
        feeBps: PLATFORM_FEE_BPS,
        termsVersion: HOST_FEE_TERMS_VERSION
      },
      changed: true
    })
  })

  it.each(["owner", "admin", "billing"])("lets a %s accept", async (role) => {
    mocks.requireApiActor.mockResolvedValue(actor(role))

    expect((await POST(request(ACCEPTANCE))).status).toBe(200)
    expect(mocks.acceptHostFeeAgreement).toHaveBeenCalledOnce()
  })

  it.each(["dispatcher", "landing_manager", "viewer"])(
    "refuses a %s, who cannot manage billing",
    async (role) => {
      mocks.requireApiActor.mockResolvedValue(actor(role))

      expect((await POST(request(ACCEPTANCE))).status).toBe(403)
      expect(mocks.acceptHostFeeAgreement).not.toHaveBeenCalled()
    }
  )

  it.each(["landing_source", "destination", "fleet", "carrier"])(
    "lets a %s organization, which can publish loads, accept",
    async (type) => {
      mocks.requireApiActor.mockResolvedValue(actor("owner", type))

      expect((await POST(request(ACCEPTANCE))).status).toBe(200)
    }
  )

  it("refuses an organization type that cannot publish loads", async () => {
    mocks.requireApiActor.mockResolvedValue(actor("owner", "platform"))

    expect((await POST(request(ACCEPTANCE))).status).toBe(403)
    expect(mocks.acceptHostFeeAgreement).not.toHaveBeenCalled()
  })

  it("rejects client-selected commercial terms", async () => {
    const response = await POST(request({ ...ACCEPTANCE, feeBps: 1 }))

    expect(response.status).toBe(422)
    expect(mocks.requireApiActor).toHaveBeenCalledOnce()
    expect(mocks.enforceApiRateLimit).toHaveBeenCalledOnce()
    expect(mocks.acceptHostFeeAgreement).not.toHaveBeenCalled()
  })

  it("requires explicit acceptance and the terms version that was shown", async () => {
    expect((await POST(request({ termsVersion: HOST_FEE_TERMS_VERSION }))).status).toBe(422)
    expect((await POST(request({ acceptFeeTerms: true }))).status).toBe(422)
    expect(mocks.acceptHostFeeAgreement).not.toHaveBeenCalled()
  })

  it("authenticates and rate limits before rejecting malformed JSON", async () => {
    const response = await POST(rawRequest("{"))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: "The request must contain a valid JSON object"
    })
    expect(mocks.requireApiActor).toHaveBeenCalledOnce()
    expect(mocks.enforceApiRateLimit).toHaveBeenCalledOnce()
    expect(mocks.acceptHostFeeAgreement).not.toHaveBeenCalled()
  })

  it("stops an undeclared oversized body while streaming it", async () => {
    const response = await POST(rawRequest(JSON.stringify({ padding: "x".repeat(2_048) })))

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      error: "The fee agreement request is too large"
    })
    expect(mocks.acceptHostFeeAgreement).not.toHaveBeenCalled()
  })
})
