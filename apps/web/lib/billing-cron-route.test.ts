import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  chargeHostInvoice: vi.fn(),
  listOpenHostInvoices: vi.fn(),
  openAllClosedPeriodInvoices: vi.fn(),
  operatingStateAccess: vi.fn(),
  platformFeeCollectionEnabled: vi.fn(),
  reconcileMissingPlatformFees: vi.fn(),
  resolveStripeBilling: vi.fn()
}))

vi.mock("@logloads/services", () => ({
  openAllClosedPeriodInvoices: mocks.openAllClosedPeriodInvoices,
  reconcileMissingPlatformFees: mocks.reconcileMissingPlatformFees
}))

vi.mock("@/lib/billing", () => ({
  chargeHostInvoice: mocks.chargeHostInvoice,
  listOpenHostInvoices: mocks.listOpenHostInvoices,
  operatingStateAccess: mocks.operatingStateAccess,
  platformFeeCollectionEnabled: mocks.platformFeeCollectionEnabled,
  resolveStripeBilling: mocks.resolveStripeBilling
}))

import { GET } from "@/app/api/billing/cron/route"

describe("billing cron fee reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("CRON_SECRET", "cron-test-secret")
  })

  it("repairs missing fees before opening closed invoices in dark launch", async () => {
    const state = { marker: "state" }
    const reconciliation = [
      {
        assignmentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee91",
        eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa91",
        outcome: "accrued",
        reason: null
      }
    ]
    const opened = [{ outcome: "opened" }]

    mocks.reconcileMissingPlatformFees.mockReturnValue(reconciliation)
    mocks.openAllClosedPeriodInvoices.mockReturnValue(opened)
    mocks.listOpenHostInvoices.mockReturnValue([])
    mocks.platformFeeCollectionEnabled.mockReturnValue(false)
    mocks.operatingStateAccess.mockReturnValue({
      async mutate(
        mutate: (draft: { state: typeof state }) => {
          invoices: typeof opened
          reconciliation: typeof reconciliation
        }
      ) {
        return mutate({ state })
      },
      async read(read: (current: typeof state) => unknown) {
        return read(state)
      }
    })

    const response = await GET(
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer cron-test-secret" }
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.reconcileMissingPlatformFees).toHaveBeenCalledWith(
      state,
      expect.any(String)
    )
    expect(mocks.openAllClosedPeriodInvoices).toHaveBeenCalledWith(
      state,
      expect.any(String)
    )
    expect(
      mocks.reconcileMissingPlatformFees.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.openAllClosedPeriodInvoices.mock.invocationCallOrder[0]!)
    expect(body).toMatchObject({
      collection: "disabled",
      feeReconciliation: {
        accrued: 1,
        errors: [],
        requiresReview: []
      },
      invoicesOpened: 1
    })
    expect(mocks.chargeHostInvoice).not.toHaveBeenCalled()
  })
})
