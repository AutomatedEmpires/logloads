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
    chargeHostInvoice: vi.fn(),
    operatingStateAccess: vi.fn(),
    platformFeeCollectionEnabled: vi.fn(),
    requireAdminApiActor: vi.fn(),
    resolveStripeBilling: vi.fn(),
    resolveSubscriptionStripe: vi.fn(),
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
  requireAdminApiActor: mocks.requireAdminApiActor
}))
vi.mock("@/lib/billing", () => ({
  chargeHostInvoice: mocks.chargeHostInvoice,
  operatingStateAccess: mocks.operatingStateAccess,
  platformFeeCollectionEnabled: mocks.platformFeeCollectionEnabled,
  resolveStripeBilling: mocks.resolveStripeBilling
}))
vi.mock("@/lib/subscription-stripe", () => ({
  resolveSubscriptionStripe: mocks.resolveSubscriptionStripe,
  verifyExpectedStripeAccount: mocks.verifyExpectedStripeAccount
}))

import { POST } from "@/app/api/billing/invoices/[invoiceId]/charge/route"

describe("manual host invoice collection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.platformFeeCollectionEnabled.mockReturnValue(true)
    mocks.resolveSubscriptionStripe.mockReturnValue({ ok: true, port: {} })
    mocks.resolveStripeBilling.mockReturnValue({ ok: true, value: {} })
  })

  it("fails closed before any charge when the Stripe account assertion fails", async () => {
    mocks.verifyExpectedStripeAccount.mockRejectedValue(
      new Error("wrong Stripe account")
    )

    const response = await POST(
      new Request("https://logloads.test/api/billing/invoices/invoice-1/charge", {
        method: "POST"
      }),
      { params: Promise.resolve({ invoiceId: "invoice-1" }) }
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "Stripe billing account verification failed"
    })
    expect(mocks.resolveStripeBilling).not.toHaveBeenCalled()
    expect(mocks.chargeHostInvoice).not.toHaveBeenCalled()
  })
})
