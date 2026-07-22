import {
  OperatingStateConflictError,
  OperatingStateUnavailableError
} from "@logloads/db"
import {
  SupportRequestAuthorizationError,
  SupportRequestConflictError,
  SupportRequestNotFoundError
} from "@logloads/services"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { ApiError, rateLimitApiError } from "./api-actor"
import { RateLimitError, RateLimitUnavailableError } from "./rate-limit-core"
import {
  deploymentCommitSha,
  readBoundedJsonObject,
  SUPPORT_REQUEST_BODY_LIMIT_BYTES,
  supportApiErrorResponse,
  supportRequestView,
  supportStatusAnalytics,
  supportSubmissionAnalytics
} from "./support-api"

const request = {
  appCommitSha: "a09aee359e32d16546323c0f391b7ec2d89e8a51",
  closedAt: null,
  closedByUserId: null,
  contentFingerprint: "a".repeat(64),
  createdAt: "2026-07-21T12:00:00.000Z",
  details: "private-details-marker",
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  impact: "degraded" as const,
  kind: "problem" as const,
  organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  pagePath: "/driver/loads/private-path",
  reporterUserId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  resolutionCode: null,
  resolutionNote: null,
  status: "open" as const,
  submissionIds: ["dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
  title: "private-title-marker",
  triagedAt: null,
  triagedByUserId: null,
  updatedAt: "2026-07-21T12:00:00.000Z"
}

describe("support API boundary", () => {
  it("accepts only a bounded JSON object", async () => {
    await expect(
      readBoundedJsonObject(
        new Request("https://logloads.test/api/support-requests", {
          body: JSON.stringify({ title: "Problem" }),
          method: "POST"
        })
      )
    ).resolves.toEqual({ title: "Problem" })

    await expect(
      readBoundedJsonObject(
        new Request("https://logloads.test/api/support-requests", {
          body: "not-json",
          method: "POST"
        })
      )
    ).rejects.toMatchObject({ status: 422 })
    await expect(
      readBoundedJsonObject(
        new Request("https://logloads.test/api/support-requests", {
          body: "[]",
          method: "POST"
        })
      )
    ).rejects.toMatchObject({ status: 422 })
    await expect(
      readBoundedJsonObject(
        new Request("https://logloads.test/api/support-requests", {
          body: JSON.stringify({ details: "x".repeat(SUPPORT_REQUEST_BODY_LIMIT_BYTES) }),
          method: "POST"
        })
      )
    ).rejects.toMatchObject({ status: 413 })
  })

  it("refuses an oversized chunked body without buffering it whole", async () => {
    // No Content-Length header: the body streams in chunks and the limit must
    // trip during the read, not after the whole payload has been allocated.
    const chunk = new TextEncoder().encode("y".repeat(1024))
    const chunkCount = Math.ceil((SUPPORT_REQUEST_BODY_LIMIT_BYTES * 4) / chunk.byteLength)
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= chunkCount) {
          controller.close()

          return
        }

        pulled += 1
        controller.enqueue(chunk)
      }
    })

    await expect(
      readBoundedJsonObject(
        new Request("https://logloads.test/api/support-requests", {
          // @ts-expect-error -- duplex is required for streaming bodies in Node's fetch types
          duplex: "half",
          body,
          method: "POST"
        })
      )
    ).rejects.toMatchObject({ status: 413 })
    // The reader cancelled early: nowhere near the whole stream was pulled.
    expect(pulled).toBeLessThan(chunkCount)
  })

  it("maps support, storage, and validation failures to stable HTTP responses", async () => {
    const cases: Array<[unknown, number]> = [
      [new ApiError("Authentication required", 401), 401],
      [new SupportRequestAuthorizationError(), 403],
      [new SupportRequestNotFoundError(), 404],
      [new SupportRequestConflictError("Conflict"), 409],
      [new OperatingStateUnavailableError("private provider detail"), 503],
      [new OperatingStateConflictError(4), 503],
      [Object.assign(new Error("private zod detail"), { name: "ZodError" }), 422],
      [new Error("private internal detail"), 500]
    ]

    for (const [error, status] of cases) {
      const response = supportApiErrorResponse(error)
      const body = await response.json() as { error: string }

      expect(response.status).toBe(status)
      if (status >= 500) {
        expect(body.error).not.toContain("private")
      }
    }

    expect(supportApiErrorResponse(new OperatingStateUnavailableError("nope")).headers.get("Retry-After")).toBe("5")
  })

  it("preserves limiter status and Retry-After", () => {
    const exhausted = rateLimitApiError(new RateLimitError(17))
    const unavailable = rateLimitApiError(new RateLimitUnavailableError(6))

    expect(exhausted).toMatchObject({ status: 429 })
    expect(new Headers(exhausted?.headers).get("Retry-After")).toBe("17")
    expect(unavailable).toMatchObject({ status: 503 })
    expect(new Headers(unavailable?.headers).get("Retry-After")).toBe("6")
    expect(rateLimitApiError(new Error("other"))).toBeNull()
  })

  it("omits internal identifiers and private text from analytics", () => {
    const viewText = JSON.stringify(supportRequestView(request))
    const submissionText = JSON.stringify(supportSubmissionAnalytics(request))
    const statusText = JSON.stringify(supportStatusAnalytics(request))

    expect(viewText).not.toContain(request.contentFingerprint)
    expect(viewText).not.toContain(request.submissionIds[0])
    for (const privateValue of [request.title, request.details, request.pagePath, request.reporterUserId]) {
      expect(submissionText).not.toContain(privateValue)
      expect(statusText).not.toContain(privateValue)
    }
  })

  it("accepts only a deployment-like SHA from server environment", () => {
    expect(deploymentCommitSha({ VERCEL_GIT_COMMIT_SHA: "abc1234" })).toBe("abc1234")
    expect(deploymentCommitSha({ GITHUB_SHA: "f".repeat(40) })).toBe("f".repeat(40))
    expect(deploymentCommitSha({ VERCEL_GIT_COMMIT_SHA: "not a sha" })).toBeNull()
  })
})
