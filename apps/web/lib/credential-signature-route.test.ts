import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public readonly status: number
    ) {
      super(message)
    }
  },
  enforceApiRateLimit: vi.fn(),
  listDriverCredentials: vi.fn(),
  requireApiActor: vi.fn(),
  signedUpload: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/api-actor", () => ({
  ApiError: mocks.ApiError,
  apiErrorResponse: (error: unknown) =>
    error instanceof mocks.ApiError
      ? NextResponse.json({ error: error.message }, { status: error.status })
      : NextResponse.json({ error: "Unexpected error" }, { status: 500 }),
  enforceApiRateLimit: mocks.enforceApiRateLimit,
  requireApiActor: mocks.requireApiActor
}))
vi.mock("@/lib/media", () => ({
  parseJsonObject: (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new mocks.ApiError("Expected a JSON object", 422)
    }

    return value as Record<string, unknown>
  },
  signedUpload: mocks.signedUpload
}))
vi.mock("@/lib/services", () => ({
  services: {
    listDriverCredentials: mocks.listDriverCredentials
  }
}))

import { POST } from "../app/api/credentials/signature/route"

const ACTOR = "11111111-1111-4111-8111-111111111111"
const DRIVER = "44444444-4444-4444-8444-444444444441"
const TRUCK = "77777777-7777-4777-8777-777777777771"
const OTHER_TRUCK = "77777777-7777-4777-8777-777777777772"

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("https://logloads.test/api/credentials/signature", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  })
}

describe("credential upload signature route", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireApiActor.mockResolvedValue({
      actor: { driverProfileId: DRIVER },
      actorUserId: ACTOR
    })
    mocks.listDriverCredentials.mockReturnValue({
      audience: "driver",
      credentials: [],
      driverProfileId: DRIVER,
      equipmentOptions: [
        { kind: "truck", label: "NP-101", profileId: TRUCK }
      ],
      equipmentSelections: [],
      gate: { expiring: [], missing: [], satisfied: true },
      reviews: []
    })
    mocks.signedUpload.mockResolvedValue({ signature: "signed" })
  })

  it.each([
    ["missing", undefined],
    ["malformed", "not-a-uuid"]
  ])("refuses a truck signature with a %s equipment id", async (_label, equipmentProfileId) => {
    const response = await POST(
      request({
        equipmentProfileId,
        kind: "truck"
      })
    )

    expect(response.status).toBe(422)
    expect(mocks.signedUpload).not.toHaveBeenCalled()
  })

  it("refuses a well-formed truck id that is not assigned to this driver", async () => {
    const response = await POST(
      request({
        equipmentProfileId: OTHER_TRUCK,
        kind: "truck"
      })
    )

    expect(response.status).toBe(409)
    expect(mocks.signedUpload).not.toHaveBeenCalled()
  })

  it("signs only the exact assigned truck namespace", async () => {
    const response = await POST(
      request({
        equipmentProfileId: TRUCK,
        kind: "truck"
      })
    )

    expect(response.status).toBe(200)
    expect(mocks.signedUpload).toHaveBeenCalledWith({
      publicIdPrefix: `logloads/driver-credentials/${DRIVER}/truck/${TRUCK}`
    })
  })

  it("refuses attaching identity evidence to equipment", async () => {
    const response = await POST(
      request({
        equipmentProfileId: TRUCK,
        kind: "cdl"
      })
    )

    expect(response.status).toBe(422)
    expect(mocks.signedUpload).not.toHaveBeenCalled()
  })

  it("keeps identity evidence in the driver's credential namespace", async () => {
    const response = await POST(request({ kind: "cdl" }))

    expect(response.status).toBe(200)
    expect(mocks.signedUpload).toHaveBeenCalledWith({
      publicIdPrefix: `logloads/driver-credentials/${DRIVER}/cdl`
    })
  })
})
