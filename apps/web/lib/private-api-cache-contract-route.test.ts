import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly headers?: HeadersInit
    ) {
      super(message)
    }
  }

  class RateLimitError extends Error {}
  class RateLimitUnavailableError extends Error {}
  class LiveWeatherUnavailableError extends Error {}
  const state = {
    landings: [
      {
        coordinates: { lat: 44.5, lng: -122.7 },
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      }
    ],
    loadPostings: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        pickupLandingId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      }
    ]
  }

  return {
    ApiError,
    LiveWeatherUnavailableError,
    RateLimitError,
    RateLimitUnavailableError,
    buildNetworkView: vi.fn(),
    checkRateLimit: vi.fn(),
    fetchLiveWeather: vi.fn(),
    getSessionActor: vi.fn(),
    hasSessionIdentity: vi.fn(),
    isFounderDemoMode: vi.fn(),
    listDriverAvailability: vi.fn(),
    listTruckSlotsForDate: vi.fn(),
    mutateState: vi.fn(),
    readState: vi.fn(),
    requestClientKey: vi.fn(),
    requireApiActor: vi.fn(),
    state
  }
})

const LOAD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ORGANIZATION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/api-actor", () => ({
  ApiError: mocks.ApiError,
  apiErrorResponse(error: unknown) {
    const status = error instanceof mocks.ApiError ? error.status : 500

    return Response.json(
      { error: error instanceof Error ? error.message : "Unexpected failure" },
      {
        headers: { "Cache-Control": "private, no-store" },
        status
      }
    )
  },
  requireApiActor: mocks.requireApiActor
}))
vi.mock("@/lib/network", () => ({
  buildNetworkView: mocks.buildNetworkView
}))
vi.mock("@/lib/rate-limit", () => ({
  RateLimitError: mocks.RateLimitError,
  RateLimitUnavailableError: mocks.RateLimitUnavailableError,
  checkRateLimit: mocks.checkRateLimit,
  requestClientKey: mocks.requestClientKey
}))
vi.mock("@/lib/services", () => ({
  mutateState: mocks.mutateState,
  readState: mocks.readState,
  services: {
    listDriverAvailability: mocks.listDriverAvailability,
    state: mocks.state
  }
}))
vi.mock("@/lib/session", () => ({
  getSessionActor: mocks.getSessionActor,
  hasSessionIdentity: mocks.hasSessionIdentity,
  isFounderDemoMode: mocks.isFounderDemoMode
}))
vi.mock("@/lib/weather-provider", () => ({
  LiveWeatherUnavailableError: mocks.LiveWeatherUnavailableError,
  fetchLiveWeather: mocks.fetchLiveWeather
}))
vi.mock("@logloads/services", () => ({
  listTruckSlotsForDate: mocks.listTruckSlotsForDate
}))

import { GET as getSession } from "@/app/api/auth/session/route"
import { GET as getAvailability } from "@/app/api/availability/route"
import { GET as getLoads } from "@/app/api/loads/route"
import { GET as getTruckSlots } from "@/app/api/truck-slots/route"
import { GET as getWeather } from "@/app/api/weather/route"

describe("private API GET cache contract", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.buildNetworkView.mockReturnValue({ loads: [{ id: LOAD_ID }] })
    mocks.checkRateLimit.mockResolvedValue(undefined)
    mocks.fetchLiveWeather.mockResolvedValue({ condition: "clear" })
    mocks.getSessionActor.mockResolvedValue({
      activeOrganization: { id: ORGANIZATION_ID },
      profile: { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }
    })
    mocks.hasSessionIdentity.mockResolvedValue(true)
    mocks.isFounderDemoMode.mockResolvedValue(false)
    mocks.listDriverAvailability.mockReturnValue([{ status: "available" }])
    mocks.listTruckSlotsForDate.mockReturnValue([{ id: "slot-1" }])
    mocks.readState.mockImplementation(
      async (read: (current: { state: typeof mocks.state }) => unknown) =>
        read({ state: mocks.state })
    )
    mocks.requireApiActor.mockResolvedValue({
      actor: { driverProfileId: "driver-1" },
      actorUserId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      organizationId: ORGANIZATION_ID
    })
  })

  it("marks session, availability, truck-slot, and weather reads private and non-cacheable", async () => {
    const responses = await Promise.all([
      getSession(),
      getAvailability(),
      getTruckSlots(
        new NextRequest("https://logloads.test/api/truck-slots?date=2026-08-05")
      ),
      getWeather(
        new NextRequest(`https://logloads.test/api/weather?loadId=${LOAD_ID}`)
      )
    ])

    for (const response of responses) {
      expect(response.status).toBe(200)
      expect(response.headers.get("cache-control")).toBe("private, no-store")
    }
  })

  it("keeps the redacted public load board explicitly public", async () => {
    const response = await getLoads()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("public, no-store")
  })
})
