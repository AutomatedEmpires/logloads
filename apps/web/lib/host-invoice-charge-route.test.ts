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
vi.mock("@/lib/stripe-account", () => ({
  verifyExpectedStripeAccount: mocks.verifyExpectedStripeAccount
}))

import { POST } from "@/app/api/billing/invoices/[invoiceId]/charge/route"

function charge() {
  return POST(
    new Request("https://logloads.test/api/billing/invoices/invoice-1/charge", {
      method: "POST"
    }),
    { params: Promise.resolve({ invoiceId: "invoice-1" }) }
  )
}

describe("manual host invoice collection", () => {
  const port = { marker: "stripe-billing-port" }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.platformFeeCollectionEnabled.mockReturnValue(true)
    mocks.resolveStripeBilling.mockReturnValue({ ok: true, value: port })
    mocks.verifyExpectedStripeAccount.mockResolvedValue(undefined)
    mocks.operatingStateAccess.mockReturnValue({ marker: "operating-state" })
  })

  it("refuses while fee collection is switched off, before resolving Stripe", async () => {
    mocks.platformFeeCollectionEnabled.mockReturnValue(false)

    const response = await charge()

    expect(response.status).toBe(409)
    expect(mocks.resolveStripeBilling).not.toHaveBeenCalled()
    expect(mocks.chargeHostInvoice).not.toHaveBeenCalled()
  })

  it("fails closed before any charge when the Stripe account assertion fails", async () => {
    mocks.verifyExpectedStripeAccount.mockRejectedValue(
      new Error("wrong Stripe account")
    )

    const response = await charge()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "Stripe billing account verification failed"
    })
    expect(mocks.verifyExpectedStripeAccount).toHaveBeenCalledWith(port, process.env)
    expect(mocks.chargeHostInvoice).not.toHaveBeenCalled()
  })

  it("answers a bill below the card minimum as held open, not as an error", async () => {
    const held = {
      invoiceId: "invoice-1",
      minimumChargeCents: 50,
      outcome: "below_card_minimum",
      status: "open",
      subtotalCents: 40
    }

    mocks.chargeHostInvoice.mockResolvedValue({ ok: true, outcome: "ok", value: held })

    const response = await charge()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ charge: held })
    expect(mocks.chargeHostInvoice).toHaveBeenCalledWith({
      invoiceId: "invoice-1",
      port,
      state: { marker: "operating-state" }
    })
  })
})
