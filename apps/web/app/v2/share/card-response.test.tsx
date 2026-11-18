import React from "react"
import { ImageResponse } from "next/og"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { MarketplaceJobDetailView } from "@logloads/contracts"

/**
 * The preview card's real response (#404). `next/og` is not replaced here, so the header is the one a browser, a
 * link-preview fetcher or a shared cache receives, and the body is the picture `ImageResponse` renders.
 */

const mocks = vi.hoisted(() => ({
  areaNotice: vi.fn<(jobId: string) => Promise<string | null>>(async () => null),
  getJob: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/marketplace-v2/flag", () => ({ marketplaceV2Enabled: () => true }))
vi.mock("@/lib/marketplace-v2/pilot-adapter", () => ({
  pilotMarketplaceV2: { getJob: (jobId: string) => mocks.getJob(jobId) }
}))
vi.mock("@/lib/marketplace-v2/basins/notice", () => ({
  shareJobAreaNotice: (jobId: string) => mocks.areaNotice(jobId)
}))
vi.mock("@/lib/rate-limit", async () => {
  const core = await vi.importActual<typeof import("@/lib/rate-limit-core")>("@/lib/rate-limit-core")

  return {
    RateLimitError: core.RateLimitError,
    RateLimitUnavailableError: core.RateLimitUnavailableError,
    checkRateLimit: async () => undefined,
    requestClientKey: async () => "verified:card-response-test"
  }
})

import ShareCard from "./[jobId]/opengraph-image"

const JOB_ID = "11111111-1111-4111-8111-111111111111"
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function job(): MarketplaceJobDetailView {
  return {
    acceptingInterest: true,
    destinationLabel: "Cascade Mill",
    endsOn: "2026-12-01",
    equipment: ["log_truck", "pole_trailer"],
    estimatedDailyLoads: null,
    estimatedLoadsPerTruckPerDay: null,
    estimatedTonsPerLoad: null,
    expiresAt: null,
    haulDistance: { basis: "poster_route_estimate", miles: 54 },
    id: JOB_ID,
    lastConfirmedAt: "2020-06-15T12:00:00.000Z",
    lastModifiedAt: "2020-06-01T09:00:00.000Z",
    origin: { approximatePoint: { lat: 44.2, lng: -122.5 }, label: "Sweet Home, OR", stateCode: "OR" },
    pay: { amountCents: 47_500, note: null, unit: "per_load" },
    posterName: "Oak Landing",
    posterOrganizationId: "22222222-aaaa-4aaa-8aaa-222222222222",
    posterVerification: null,
    product: "Saw logs",
    publicAccessRequirements: [],
    publicRoadNotes: null,
    scheduleNote: null,
    slug: JOB_ID,
    sponsored: true,
    startsOn: "2026-11-10",
    status: "active",
    title: "Oak saw logs to Cascade Mill",
    trucks: { perDay: 2, total: 4 }
  }
}

async function card(): Promise<Response> {
  return (await ShareCard({ params: Promise.resolve({ jobId: JOB_ID }) })) as Response
}

async function signature(response: Response): Promise<number[]> {
  return [...new Uint8Array(await response.arrayBuffer()).slice(0, PNG_SIGNATURE.length)]
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("React", React)
  mocks.areaNotice.mockResolvedValue(null)
  mocks.getJob.mockResolvedValue(job())
})

describe("the preview card response", () => {
  it("would be kept for a year if the card did not set its own header", async () => {
    // What `ImageResponse` answers by default outside development. This is the review finding the card overrides.
    const untouched = new ImageResponse(<div style={{ display: "flex" }}>LogLoads</div>, { height: 630, width: 1200 })

    expect(untouched.headers.get("cache-control")).toBe("public, immutable, no-transform, max-age=31536000")
    await untouched.body?.cancel()
  })

  it("answers an open job with a PNG that may be kept for five minutes", async () => {
    const response = await card()

    expect(response).toBeInstanceOf(ImageResponse)
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("public, max-age=300")
    expect(response.headers.get("cache-control")).not.toMatch(/immutable|31536000/)
    expect(response.headers.get("content-type")).toBe("image/png")
    expect(await signature(response)).toEqual(PNG_SIGNATURE)
  }, 60_000)

  it("answers a closed basin with the same short lifetime", async () => {
    mocks.getJob.mockResolvedValue(null)
    mocks.areaNotice.mockResolvedValue("not in your area yet")

    const response = await card()

    expect(response).toBeInstanceOf(ImageResponse)
    expect(response.headers.get("cache-control")).toBe("public, max-age=300")
    expect(response.headers.get("content-type")).toBe("image/png")
    expect(await signature(response)).toEqual(PNG_SIGNATURE)
  }, 60_000)
})
