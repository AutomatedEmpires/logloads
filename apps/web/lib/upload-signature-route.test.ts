import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * HF-08 (#187): every upload signature mints a storage slot, so the photo and
 * trip-document signature routes carry the same per-user limit as the
 * credential vault's route (10 a minute), checked before a slot is signed.
 */

const mocks = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly headers?: HeadersInit
    ) {
      super(message)
    }
  },
  enforceApiRateLimit: vi.fn(),
  mediaTarget: vi.fn(),
  requireApiActor: vi.fn(),
  signedUpload: vi.fn(),
  tripDocumentTarget: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/api-actor", () => ({
  ApiError: mocks.ApiError,
  apiErrorResponse: (error: unknown) =>
    error instanceof mocks.ApiError
      ? NextResponse.json({ error: error.message }, { headers: error.headers, status: error.status })
      : NextResponse.json({ error: "Unexpected error" }, { status: 500 }),
  enforceApiRateLimit: mocks.enforceApiRateLimit,
  requireApiActor: mocks.requireApiActor
}))
vi.mock("@/lib/media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./media")>()),
  mediaTarget: mocks.mediaTarget,
  signedUpload: mocks.signedUpload,
  tripDocumentTarget: mocks.tripDocumentTarget
}))
vi.mock("@/lib/services", () => ({ services: { state: {} } }))

import { POST as signMediaUpload } from "../app/api/media/signature/route"
import { POST as signTripDocumentUpload } from "../app/api/trip-documents/signature/route"

const ACTOR = "11111111-1111-4111-8111-111111111111"
const ORGANIZATION = "33333333-3333-4333-8333-333333333331"
const TRIP = "55555555-5555-4555-8555-555555555551"

function request(path: string, body: unknown): NextRequest {
  return new NextRequest(`https://logloads.test${path}`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  })
}

const routes = [
  {
    bucket: "media-upload-signature",
    call: () => signMediaUpload(request("/api/media/signature", { kind: "truck" })),
    name: "photo signature",
    target: () => mocks.mediaTarget
  },
  {
    bucket: "trip-document-upload-signature",
    call: () => signTripDocumentUpload(request("/api/trip-documents/signature", { tripId: TRIP })),
    name: "trip-document signature",
    target: () => mocks.tripDocumentTarget
  }
]

describe("upload signature rate limits (HF-08)", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireApiActor.mockResolvedValue({
      actor: { driverProfileId: "driver-1", profile: { id: ACTOR } },
      actorUserId: ACTOR,
      organizationId: ORGANIZATION
    })
    mocks.enforceApiRateLimit.mockResolvedValue(undefined)
    mocks.mediaTarget.mockReturnValue({ publicIdPrefix: `logloads/${ORGANIZATION}/truck/truck-1` })
    mocks.tripDocumentTarget.mockReturnValue({ publicIdPrefix: `logloads/trip-documents/${TRIP}`, tripId: TRIP })
    mocks.signedUpload.mockResolvedValue({ publicId: "signed" })
  })

  it.each(routes)("limits the $name route per user, 10 a minute", async ({ bucket, call }) => {
    const response = await call()

    expect(response.status).toBe(200)
    expect(mocks.enforceApiRateLimit).toHaveBeenCalledWith(bucket, ACTOR, 10, 60_000)
    expect(mocks.enforceApiRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signedUpload.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    )
  })

  it.each(routes)("signs nothing once the $name limit is spent", async ({ call, target }) => {
    mocks.enforceApiRateLimit.mockRejectedValue(
      new mocks.ApiError("Too many requests. Try again shortly.", 429, { "Retry-After": "42" })
    )

    const response = await call()

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("42")
    expect(target()).not.toHaveBeenCalled()
    expect(mocks.signedUpload).not.toHaveBeenCalled()
  })

  it("refuses a photo signature body that is not a JSON object", async () => {
    const response = await signMediaUpload(request("/api/media/signature", null))

    expect(response.status).toBe(422)
    expect(mocks.signedUpload).not.toHaveBeenCalled()
  })
})
