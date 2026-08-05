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
  provider: "supabase",
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
    vi.stubGlobal("fetch", fetchMock)

    routeMocks.requireApiActor.mockResolvedValue({
      organizationId: "test-organization-id"
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

  it("preserves a storage-configuration 503 and never starts provider delivery", async () => {
    const response = await GET(new NextRequest("https://logloads.example.test/api/media/asset?kind=profile"))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "File uploads are not activated for this environment"
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("never browser-caches a private asset after authorization", async () => {
    routeMocks.signedDeliveryUrl.mockResolvedValue(
      "https://storage.example.test/signed-photo"
    )
    fetchMock.mockResolvedValue(
      new Response("private-photo", {
        headers: { "Content-Type": "image/jpeg" },
        status: 200
      })
    )

    const response = await GET(
      new NextRequest(
        "https://logloads.example.test/api/media/asset?kind=profile"
      )
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.text()).resolves.toBe("private-photo")
  })
})
