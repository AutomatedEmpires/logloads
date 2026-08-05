import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      message: string,
      readonly status: number
    ) {
      super(message)
    }
  }

  return {
    ApiError,
    listDriverAvailability: vi.fn(),
    mutateState: vi.fn(),
    requireApiActor: vi.fn(),
    setDriverAvailability: vi.fn()
  }
})

vi.mock("server-only", () => ({}))
vi.mock("@/lib/api-actor", () => ({
  ApiError: mocks.ApiError,
  apiErrorResponse(error: unknown) {
    const status = error instanceof mocks.ApiError ? error.status : 500
    const message = error instanceof mocks.ApiError ? error.message : "We could not complete that request."

    return NextResponse.json(
      { error: message },
      { headers: { "Cache-Control": "private, no-store" }, status }
    )
  },
  requireApiActor: mocks.requireApiActor
}))
vi.mock("@/lib/services", () => ({
  mutateState: mocks.mutateState,
  services: {
    listDriverAvailability: mocks.listDriverAvailability
  }
}))

import { POST } from "../app/api/availability/route"

const ACTOR_USER_ID = "11111111-1111-4111-8111-111111111111"
const DRIVER_PROFILE_ID = "44444444-4444-4444-8444-444444444441"
const ORGANIZATION_ID = "33333333-3333-4333-8333-333333333331"
const SPOOFED_ACTOR_USER_ID = "11111111-1111-4111-8111-111111111199"
const SPOOFED_DRIVER_PROFILE_ID = "44444444-4444-4444-8444-444444444499"
const SPOOFED_ORGANIZATION_ID = "33333333-3333-4333-8333-333333333399"
const WINDOW_ID = "19191919-1919-4919-8919-191919191199"
const WINDOW = {
  createdAt: "2026-08-05T16:00:00.000Z",
  driverProfileId: DRIVER_PROFILE_ID,
  endAt: "2026-08-08T00:00:00.000Z",
  id: WINDOW_ID,
  notes: "Ready for day work",
  preferredRouteIds: [],
  recurringSchedule: null,
  startAt: "2026-08-06T00:00:00.000Z",
  status: "available",
  truckProfileId: null,
  updatedAt: "2026-08-05T16:00:00.000Z"
}

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("https://logloads.test/api/availability", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  })
}

describe("availability API route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireApiActor.mockResolvedValue({
      actor: { driverProfileId: DRIVER_PROFILE_ID },
      actorUserId: ACTOR_USER_ID,
      organizationId: ORGANIZATION_ID
    })
    mocks.setDriverAvailability.mockReturnValue({
      driverProfile: { id: DRIVER_PROFILE_ID },
      window: WINDOW
    })
    mocks.mutateState.mockImplementation(
      async (mutate: (draft: { setDriverAvailability: typeof mocks.setDriverAvailability }) => unknown) =>
        mutate({ setDriverAvailability: mocks.setDriverAvailability })
    )
  })

  it("publishes readiness with authenticated identity and ignores spoofed identity fields", async () => {
    const response = await POST(
      request({
        actorUserId: SPOOFED_ACTOR_USER_ID,
        driverProfileId: SPOOFED_DRIVER_PROFILE_ID,
        endAt: WINDOW.endAt,
        id: WINDOW_ID,
        notes: WINDOW.notes,
        organizationId: SPOOFED_ORGANIZATION_ID,
        preferredRouteIds: [],
        recurringSchedule: null,
        startAt: WINDOW.startAt,
        status: "available",
        truckProfileId: null
      })
    )

    expect(response.status).toBe(201)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(await response.json()).toEqual({ window: WINDOW })
    expect(mocks.requireApiActor).toHaveBeenCalledOnce()
    expect(mocks.setDriverAvailability).toHaveBeenCalledOnce()
    expect(mocks.setDriverAvailability).toHaveBeenCalledWith({
      actorUserId: ACTOR_USER_ID,
      driverProfileId: DRIVER_PROFILE_ID,
      endAt: WINDOW.endAt,
      id: WINDOW_ID,
      notes: WINDOW.notes,
      organizationId: ORGANIZATION_ID,
      preferredRouteIds: [],
      recurringSchedule: null,
      startAt: WINDOW.startAt,
      status: "available",
      truckProfileId: null
    })
  })

  it("refuses an authenticated actor without a driver profile", async () => {
    mocks.requireApiActor.mockResolvedValue({
      actor: { driverProfileId: null },
      actorUserId: ACTOR_USER_ID,
      organizationId: ORGANIZATION_ID
    })

    const response = await POST(
      request({
        driverProfileId: SPOOFED_DRIVER_PROFILE_ID,
        endAt: WINDOW.endAt,
        organizationId: SPOOFED_ORGANIZATION_ID,
        startAt: WINDOW.startAt,
        status: "available"
      })
    )

    expect(response.status).toBe(403)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(await response.json()).toEqual({
      error: "Add a driver profile before setting availability"
    })
    expect(mocks.mutateState).not.toHaveBeenCalled()
    expect(mocks.setDriverAvailability).not.toHaveBeenCalled()
  })
})
