import { createInMemoryDatabase, seedDatabaseState } from "@logloads/db"
import { createLogLoadsServices } from "@logloads/services"
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
  getFeaturedTruckPhotoReference: vi.fn(),
  requireApiActor: vi.fn(),
  signedDeliveryUrl: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/api-actor", async () => {
  const { NextResponse } = await import("next/server")

  return {
    ApiError: routeMocks.ApiError,
    apiErrorResponse: (error: unknown) => {
      if (error instanceof routeMocks.ApiError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }

      if (error instanceof Error && error.name === "DomainRefusalError") {
        return NextResponse.json(
          {
            error:
              "This request conflicts with current records or policy. Refresh and correct the request before retrying."
          },
          { status: 409 }
        )
      }

      return NextResponse.json(
        { error: "We could not complete that request." },
        { status: 500 }
      )
    },
    requireApiActor: routeMocks.requireApiActor
  }
})
vi.mock("@/lib/media", () => ({
  signedDeliveryUrl: routeMocks.signedDeliveryUrl
}))
vi.mock("@/lib/services", () => ({
  services: {
    getFeaturedTruckPhotoReference: routeMocks.getFeaturedTruckPhotoReference
  }
}))

import { GET } from "../app/api/media/featured-truck/route"

const DRIVER_PROFILE = "44444444-4444-4444-8444-444444444441"
const FLEET_VIEWER_PROFILE = "44444444-4444-4444-8444-444444444442"
const HOST_OWNER_PROFILE = "44444444-4444-4444-8444-444444444443"
const FLEET_ORG = "33333333-3333-4333-8333-333333333331"
const HOST_ORG = "33333333-3333-4333-8333-333333333332"
const MISSING_DRIVER = "44444444-4444-4444-8444-444444444499"

function seededDriverUserId(driverProfileId: string): string {
  const driver = seedDatabaseState.driverProfiles.find(
    (candidate) => candidate.id === driverProfileId
  )

  if (!driver) {
    throw new Error(`Seeded driver ${driverProfileId} is missing`)
  }

  return driver.userId
}

const DRIVER_USER = seededDriverUserId(DRIVER_PROFILE)
const FLEET_VIEWER = seededDriverUserId(FLEET_VIEWER_PROFILE)
const HOST_OWNER = seededDriverUserId(HOST_OWNER_PROFILE)

function request(driverProfileId?: string): NextRequest {
  const url = new URL("https://logloads.test/api/media/featured-truck")

  if (driverProfileId !== undefined) {
    url.searchParams.set("driverProfileId", driverProfileId)
  }

  return new NextRequest(url)
}

describe("featured truck photo route", () => {
  const fetchMock = vi.fn()
  let services: ReturnType<typeof createLogLoadsServices>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal("fetch", fetchMock)
    services = createLogLoadsServices(createInMemoryDatabase())
    routeMocks.requireApiActor.mockResolvedValue({
      actorUserId: FLEET_VIEWER,
      organizationId: FLEET_ORG
    })
    routeMocks.getFeaturedTruckPhotoReference.mockImplementation((input) =>
      services.getFeaturedTruckPhotoReference(input)
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns one sanitized 409 for omitted, malformed, nonexistent, and hidden targets", async () => {
    const responses = await Promise.all([
      GET(request()),
      GET(request("not-a-uuid")),
      GET(request(MISSING_DRIVER)),
      GET(request(DRIVER_PROFILE))
    ])
    const bodies = await Promise.all(responses.map((response) => response.json()))

    expect(responses.map((response) => response.status)).toEqual([409, 409, 409, 409])
    expect(bodies).toEqual(
      Array.from({ length: 4 }, () => ({
        error:
          "This request conflicts with current records or policy. Refresh and correct the request before retrying."
      }))
    )
    expect(JSON.stringify(bodies)).not.toContain(DRIVER_PROFILE)
    expect(JSON.stringify(bodies)).not.toContain(MISSING_DRIVER)
    expect(routeMocks.signedDeliveryUrl).not.toHaveBeenCalled()
  })

  it("makes an inaccessible existing target indistinguishable from a missing target", async () => {
    const target = services.getDriverMediaTarget({
      actorUserId: DRIVER_USER,
      driverProfileId: DRIVER_PROFILE,
      kind: "truck",
      organizationId: FLEET_ORG
    })
    const uploadedAt = new Date().toISOString()

    services.saveDriverMediaReference({
      actorUserId: DRIVER_USER,
      driverProfileId: DRIVER_PROFILE,
      kind: "truck",
      organizationId: FLEET_ORG,
      photo: {
        bytes: 125_000,
        format: "jpg",
        height: 900,
        provider: "supabase",
        publicId: `${target.publicIdPrefix}/uploads/99999999-9999-4999-8999-999999999998`,
        uploadedAt,
        version: 1,
        width: 1200
      }
    })
    services.setFeaturedTruckPhoto({
      actorUserId: DRIVER_USER,
      driverProfileId: DRIVER_PROFILE,
      featured: true,
      organizationId: FLEET_ORG
    })
    services.state.assignments = services.state.assignments.filter(
      (assignment) => assignment.driverProfileId !== DRIVER_PROFILE
    )
    routeMocks.requireApiActor.mockResolvedValue({
      actorUserId: HOST_OWNER,
      organizationId: HOST_ORG
    })

    const [missingResponse, inaccessibleResponse] = await Promise.all([
      GET(request(MISSING_DRIVER)),
      GET(request(DRIVER_PROFILE))
    ])
    const [missingBody, inaccessibleBody] = await Promise.all([
      missingResponse.json(),
      inaccessibleResponse.json()
    ])

    expect(missingResponse.status).toBe(409)
    expect(inaccessibleResponse.status).toBe(409)
    expect(inaccessibleBody).toEqual(missingBody)
    expect(JSON.stringify(inaccessibleBody)).not.toContain(DRIVER_PROFILE)
    expect(JSON.stringify(missingBody)).not.toContain(MISSING_DRIVER)
    expect(routeMocks.signedDeliveryUrl).not.toHaveBeenCalled()
  })

  it("keeps unexpected service invariants on a sanitized 500 path", async () => {
    routeMocks.getFeaturedTruckPhotoReference.mockImplementationOnce(() => {
      throw new Error(`Internal featured-photo invariant ${DRIVER_PROFILE}`)
    })

    const response = await GET(request(DRIVER_PROFILE))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: "We could not complete that request."
    })
    expect(routeMocks.signedDeliveryUrl).not.toHaveBeenCalled()
  })

  it("re-authorizes private featured media on every browser request", async () => {
    routeMocks.getFeaturedTruckPhotoReference.mockReturnValue({
      bytes: 125_000,
      format: "jpg",
      height: 900,
      provider: "supabase",
      publicId: "logloads/test/truck/uploads/featured",
      uploadedAt: "2026-08-05T00:00:00.000Z",
      version: 1,
      width: 1200
    })
    routeMocks.signedDeliveryUrl.mockResolvedValue(
      "https://storage.example.test/signed-featured"
    )
    fetchMock.mockResolvedValue(
      new Response("featured-photo", {
        headers: { "Content-Type": "image/jpeg" },
        status: 200
      })
    )

    const response = await GET(request(DRIVER_PROFILE))

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.text()).resolves.toBe("featured-photo")
  })
})
