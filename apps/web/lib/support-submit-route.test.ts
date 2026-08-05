import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  captureServerEvent: vi.fn(),
  enforceApiRateLimit: vi.fn(),
  mutateState: vi.fn(),
  requireSupportApiActor: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/api-actor", () => ({
  enforceApiRateLimit: mocks.enforceApiRateLimit,
  requireSupportApiActor: mocks.requireSupportApiActor
}))
vi.mock("@/lib/analytics", () => ({ captureServerEvent: mocks.captureServerEvent }))
vi.mock("@/lib/services", () => ({ mutateState: mocks.mutateState }))

import { POST } from "../app/api/support-requests/route"

const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ORGANIZATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const REQUEST_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const SUBMISSION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"

const submission = {
  details: "Saving stays disabled after the truck reconnects.",
  impact: "degraded" as const,
  kind: "problem" as const,
  pagePath: "/driver/loads",
  submissionId: SUBMISSION_ID,
  title: "Reconnect does not restore save"
}

const supportRequest = {
  appCommitSha: null,
  closedAt: null,
  closedByUserId: null,
  contentFingerprint: "a".repeat(64),
  createdAt: "2026-08-05T17:00:00.000Z",
  details: submission.details,
  id: REQUEST_ID,
  impact: submission.impact,
  kind: submission.kind,
  organizationId: null,
  pagePath: submission.pagePath,
  reporterUserId: ADMIN_ID,
  resolutionCode: null,
  resolutionNote: null,
  status: "open" as const,
  submissionIds: [SUBMISSION_ID],
  title: submission.title,
  triagedAt: null,
  triagedByUserId: null,
  updatedAt: "2026-08-05T17:00:00.000Z"
}

function postRequest(): NextRequest {
  return new NextRequest("https://logloads.test/api/support-requests", {
    body: JSON.stringify(submission),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  })
}

describe("support submission API", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.enforceApiRateLimit.mockResolvedValue(undefined)
    mocks.mutateState.mockResolvedValue({
      created: true,
      deduplicated: false,
      request: supportRequest
    })
  })

  it.each([
    { isPlatformAdmin: true, organizationId: null },
    { isPlatformAdmin: false, organizationId: ORGANIZATION_ID }
  ])(
    "passes server-derived platform authority for an organization context of $organizationId",
    async ({ isPlatformAdmin, organizationId }) => {
      mocks.requireSupportApiActor.mockResolvedValue({
        actor: { isPlatformAdmin },
        actorUserId: ADMIN_ID,
        organizationId
      })

      const response = await POST(postRequest())
      const createSupportRequest = vi.fn()
      const mutate = mocks.mutateState.mock.calls[0]?.[0] as
        | ((draft: { createSupportRequest: typeof createSupportRequest }) => unknown)
        | undefined

      expect(response.status).toBe(201)
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      expect(mutate).toBeTypeOf("function")
      mutate?.({ createSupportRequest })
      expect(createSupportRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId,
          platformAdminAuthorized: isPlatformAdmin,
          reporterUserId: ADMIN_ID,
          submission
        })
      )
    }
  )
})
