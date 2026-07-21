import type { MediaReference } from "@logloads/contracts"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const routeMocks = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public readonly status: number
    ) {
      super(message)
    }
  },
  mediaTarget: vi.fn(),
  requireApiActor: vi.fn(),
  signedDeliveryUrl: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/api-actor", async () => {
  const { NextResponse } = await import("next/server")

  return {
    ApiError: routeMocks.ApiError,
    apiErrorResponse: (error: unknown) =>
      error instanceof routeMocks.ApiError
        ? NextResponse.json({ error: error.message }, { status: error.status })
        : NextResponse.json({ error: "Unexpected error" }, { status: 400 }),
    requireApiActor: routeMocks.requireApiActor
  }
})
vi.mock("@/lib/media", () => {
  return {
    mediaTarget: routeMocks.mediaTarget,
    parseMediaKind: (value: unknown) => value,
    signedDeliveryUrl: routeMocks.signedDeliveryUrl
  }
})
vi.mock("@/lib/services", () => ({ services: { state: {} } }))

import { GET } from "../app/api/media/asset/route"

const storedMedia: MediaReference = {
  provider: "cloudinary",
  publicId: "logloads/test/profile/uploads/photo-1",
  version: 1,
  format: "jpg",
  width: 1200,
  height: 900,
  bytes: 500_000,
  uploadedAt: "2026-07-21T12:00:00.000Z"
}

describe("driver media asset route", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubEnv("LOGLOADS_CLOUDINARY_TENANCY", undefined)
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "dedicated-cloud")
    vi.stubEnv("CLOUDINARY_API_KEY", "dedicated-key")
    vi.stubEnv("CLOUDINARY_API_SECRET", "dedicated-secret")
    vi.stubGlobal("fetch", fetchMock)

    routeMocks.requireApiActor.mockResolvedValue({
      actor: {},
      actorUserId: "11111111-1111-4111-8111-111111111111",
      organizationId: "22222222-2222-4222-8222-222222222222"
    })
    routeMocks.mediaTarget.mockReturnValue({ photo: storedMedia })
    routeMocks.signedDeliveryUrl.mockRejectedValue(
      new routeMocks.ApiError("File uploads are not activated for this environment", 503)
    )
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("preserves the dedicated-tenancy 503 and never starts provider delivery", async () => {
    const response = await GET(new NextRequest("https://logloads.example.test/api/media/asset?kind=profile"))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "File uploads are not activated for this environment"
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
