import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    readonly status: number

    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  }

  return {
    ApiError,
    buildBillingCsv: vi.fn(),
    enforceApiRateLimit: vi.fn(),
    readState: vi.fn(),
    requireAdminApiActor: vi.fn()
  }
})

vi.mock("@/lib/api-actor", () => ({
  ApiError: mocks.ApiError,
  apiErrorResponse(error: unknown) {
    const status = error instanceof mocks.ApiError ? error.status : 500
    const message = error instanceof Error ? error.message : "Unexpected error"

    return Response.json({ error: message }, { status })
  },
  enforceApiRateLimit: mocks.enforceApiRateLimit,
  requireAdminApiActor: mocks.requireAdminApiActor
}))
vi.mock("@/lib/billing-export", () => ({
  buildBillingCsv: mocks.buildBillingCsv
}))
vi.mock("@/lib/services", () => ({
  readState: mocks.readState
}))

import { GET } from "../app/api/admin/billing/export/route"

const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ORGANIZATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

describe("admin billing CSV export route", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireAdminApiActor.mockResolvedValue({ profile: { id: ADMIN_ID } })
    mocks.enforceApiRateLimit.mockResolvedValue(undefined)
    mocks.readState.mockImplementation(
      async (read: (current: { state: { marker: string } }) => unknown) =>
        read({ state: { marker: "canonical" } })
    )
    mocks.buildBillingCsv.mockReturnValue("record_type,organization_id\r\n")
  })

  it("requires an admin and rate-limits the export", async () => {
    mocks.requireAdminApiActor.mockRejectedValue(
      new mocks.ApiError("Administrator access is required", 403)
    )

    const response = await GET(
      new Request("https://logloads.test/api/admin/billing/export")
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "Administrator access is required"
    })
    expect(mocks.enforceApiRateLimit).not.toHaveBeenCalled()
    expect(mocks.readState).not.toHaveBeenCalled()
  })

  it("rejects a malformed organization filter before reading billing state", async () => {
    const response = await GET(
      new Request(
        "https://logloads.test/api/admin/billing/export?organizationId=not-an-id"
      )
    )

    expect(response.status).toBe(400)
    expect(mocks.enforceApiRateLimit).toHaveBeenCalledWith(
      "admin-billing-export",
      ADMIN_ID,
      10,
      60_000
    )
    expect(mocks.readState).not.toHaveBeenCalled()
  })

  it("exports the canonical state with an optional organization boundary", async () => {
    const response = await GET(
      new Request(
        `https://logloads.test/api/admin/billing/export?organizationId=${ORGANIZATION_ID}`
      )
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8")
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="logloads-billing-\d{4}-\d{2}-\d{2}\.csv"$/
    )
    await expect(response.text()).resolves.toBe(
      "record_type,organization_id\r\n"
    )
    expect(mocks.buildBillingCsv).toHaveBeenCalledWith(
      { marker: "canonical" },
      ORGANIZATION_ID
    )
  })
})
