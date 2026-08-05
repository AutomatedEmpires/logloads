import { SupportRequestConflictError } from "@logloads/services"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    readonly headers?: HeadersInit
    readonly status: number

    constructor(message: string, status: number, headers?: HeadersInit) {
      super(message)
      this.headers = headers
      this.status = status
    }
  },
  captureServerEvent: vi.fn(),
  enforceApiRateLimit: vi.fn(),
  mutateState: vi.fn(),
  requireAdminApiActor: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/api-actor", () => ({
  ApiError: mocks.ApiError,
  enforceApiRateLimit: mocks.enforceApiRateLimit,
  requireAdminApiActor: mocks.requireAdminApiActor
}))
vi.mock("@/lib/analytics", () => ({ captureServerEvent: mocks.captureServerEvent }))
vi.mock("@/lib/services", () => ({ mutateState: mocks.mutateState }))

import { PATCH } from "../app/api/admin/support-requests/[requestId]/route"

const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const REQUEST_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

const supportRequest = {
  appCommitSha: "a09aee359e32d16546323c0f391b7ec2d89e8a51",
  closedAt: "2026-07-21T14:00:00.000Z",
  closedByUserId: ADMIN_ID,
  contentFingerprint: "a".repeat(64),
  createdAt: "2026-07-21T12:00:00.000Z",
  details: "The save action stays disabled after reconnecting.",
  id: REQUEST_ID,
  impact: "degraded" as const,
  kind: "problem" as const,
  organizationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  pagePath: "/driver/loads",
  reporterUserId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  resolutionCode: "answered" as const,
  resolutionNote: "The expected behavior was explained.",
  status: "resolved" as const,
  submissionIds: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"],
  title: "Reconnect does not restore save",
  triagedAt: "2026-07-21T14:00:00.000Z",
  triagedByUserId: ADMIN_ID,
  updatedAt: "2026-07-21T14:00:00.000Z"
}

function patchRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(`https://logloads.test/api/admin/support-requests/${REQUEST_ID}`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "PATCH"
  })
}

async function patch(body: Record<string, unknown>) {
  return PATCH(patchRequest(body), { params: Promise.resolve({ requestId: REQUEST_ID }) })
}

describe("support review API", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireAdminApiActor.mockResolvedValue({
      isPlatformAdmin: true,
      profile: { id: ADMIN_ID }
    })
    mocks.enforceApiRateLimit.mockResolvedValue(undefined)
  })

  it("returns 409 without analytics when an ABA version precondition conflicts", async () => {
    mocks.mutateState.mockRejectedValue(
      new SupportRequestConflictError("This request changed since the page loaded. Refresh before trying again.")
    )

    const response = await patch({
      expectedStatus: "resolved",
      expectedUpdatedAt: "2026-07-21T13:00:00.000Z",
      status: "in_review"
    })

    expect(response.status).toBe(409)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({
      error: "This request changed since the page loaded. Refresh before trying again."
    })
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
  })

  it("keeps an identical lost-response retry side-effect free", async () => {
    mocks.mutateState.mockResolvedValue({ changed: false, request: supportRequest })

    const response = await patch({
      expectedStatus: "in_review",
      expectedUpdatedAt: "2026-07-21T13:00:00.000Z",
      resolutionCode: "answered",
      resolutionNote: supportRequest.resolutionNote,
      status: "resolved"
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()

    const reviewSupportRequest = vi.fn()
    const mutate = mocks.mutateState.mock.calls[0]?.[0] as
      | ((draft: { reviewSupportRequest: typeof reviewSupportRequest }) => unknown)
      | undefined

    expect(mutate).toBeTypeOf("function")
    mutate?.({ reviewSupportRequest })
    expect(reviewSupportRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        platformAdminAuthorized: true,
        requestId: REQUEST_ID,
        reviewerUserId: ADMIN_ID
      })
    )
  })

  it("rejects review bodies without the current-version precondition", async () => {
    const response = await patch({ expectedStatus: "open", status: "in_review" })

    expect(response.status).toBe(422)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(mocks.mutateState).not.toHaveBeenCalled()
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
  })
})
