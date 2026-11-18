import { readFileSync } from "node:fs"

import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { MarketplaceJobDetailView } from "@logloads/contracts"
import { toPublicJobView } from "@logloads/contracts"

import { shareFacts } from "./facts"

/**
 * The signed-out share page (#287): public facts, the sign-up return, the preview card, and nothing a signed-out
 * visitor must not see. The beacon is a marker; what it sends is tested with the beacon itself.
 */

const mocks = vi.hoisted(() => ({
  areaNotice: vi.fn(async (_jobId: string): Promise<string | null> => null),
  enabled: true,
  getActor: vi.fn(async (): Promise<{
    activeOrganization: { id: string } | null
    profile: { email: string; id: string }
    workspaceSelectionInvalid: boolean
  } | null> => null),
  getJob: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  }
}))
vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(public element: React.ReactElement) {}
  }
}))
vi.mock("@/lib/marketplace-v2/flag", () => ({ marketplaceV2Enabled: () => mocks.enabled }))
vi.mock("@/lib/app-url", () => ({ resolvePublicAppUrl: () => "https://logloads.example" }))
vi.mock("@/lib/marketplace-v2/pilot-adapter", () => ({
  pilotMarketplaceV2: { getJob: (jobId: string) => mocks.getJob(jobId) }
}))
vi.mock("@/lib/marketplace-v2/basins/notice", () => ({
  shareJobAreaNotice: (jobId: string) => mocks.areaNotice(jobId)
}))
vi.mock("@/lib/marketplace-v2/v2-session", () => ({ getV2SessionActor: () => mocks.getActor() }))
vi.mock("@/lib/analytics/beacons", async () => {
  const { createElement } = await import("react")

  return {
    ShareLinkOpenedBeacon: (props: { channel?: string | null; jobId: string; signedIn: boolean }) =>
      createElement("i", {
        "data-beacon": "share",
        "data-channel": props.channel ?? "",
        "data-job": props.jobId,
        "data-signed": String(props.signedIn)
      })
  }
})

import ShareCard, { alt, contentType, size } from "./[jobId]/opengraph-image"
import SharePage, { generateMetadata } from "./[jobId]/page"

const JOB_ID = "11111111-1111-4111-8111-111111111111"
const LANDING_ORG = "22222222-aaaa-4aaa-8aaa-222222222222"
const HAULER_ORG = "33333333-bbbb-4bbb-8bbb-333333333333"
const PLANTED_EMAIL = "planted-share@example.com"
const PLANTED_PHONE = "541-555-0199"

function job(overrides: Partial<MarketplaceJobDetailView> = {}): MarketplaceJobDetailView {
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
    origin: { approximatePoint: { lat: 44.15432, lng: -122.48765 }, label: "Sweet Home, OR", stateCode: "OR" },
    pay: { amountCents: 47_500, note: `call ${PLANTED_PHONE}`, unit: "per_load" },
    posterName: "Oak Landing",
    posterOrganizationId: LANDING_ORG,
    posterVerification: { reviewedOn: "2026-10-01", scope: "business_identity" },
    product: "Saw logs",
    publicAccessRequirements: ["Green gate 4417"],
    publicRoadNotes: `Call ${PLANTED_PHONE} or ${PLANTED_EMAIL}`,
    scheduleNote: "Text the foreman",
    slug: JOB_ID,
    sponsored: true,
    startsOn: "2026-11-10",
    status: "active",
    title: "Oak saw logs to Cascade Mill",
    trucks: { perDay: 2, total: 4 },
    ...overrides
  }
}

function signedInAs(organizationId: string | null) {
  mocks.getActor.mockResolvedValue({
    activeOrganization: organizationId ? { id: organizationId } : null,
    profile: { email: PLANTED_EMAIL, id: "55555555-dddd-4ddd-8ddd-555555555555" },
    workspaceSelectionInvalid: false
  })
}

async function pageHtml(query: Record<string, string> = {}) {
  return renderToStaticMarkup(
    await SharePage({ params: Promise.resolve({ jobId: JOB_ID }), searchParams: Promise.resolve(query) })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("React", React)
  mocks.enabled = true
  mocks.areaNotice.mockResolvedValue(null)
  mocks.getActor.mockResolvedValue(null)
  mocks.getJob.mockResolvedValue(job())
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("the share page", () => {
  it("shows the public facts and a sign-up that returns to the job", async () => {
    const html = await pageHtml({ channel: "facebook", sent: "1" })
    const back = encodeURIComponent(`/v2/work/${JOB_ID}#interest`)

    expect(html).toContain("Oak saw logs to Cascade Mill")
    expect(html).toContain("Confirmed by Oak Landing")
    expect(html).toContain("$475.00")
    expect(html).toContain("per load")
    expect(html).toContain("Pole trailer")
    expect(html).toContain("54 mi one way · poster&#x27;s route estimate")
    expect(html).toContain("About 22 days")
    expect(html).toContain("4 trucks for the job")
    expect(html).toContain("Sponsored")
    expect(html).toContain(`href="/sign-up?next=${back}"`)
    expect(html).toContain(`href="/sign-in?next=${back}"`)
    expect(html).toContain(`value="https://logloads.example/v2/share/${JOB_ID}"`)
    expect(html).not.toContain("channel=facebook")
    expect(html).not.toContain("sent=1")
  })

  it("keeps contact details, coordinates, the organization id and quality claims off the page", async () => {
    mocks.getJob.mockResolvedValue(
      job({ title: `verified job ${PLANTED_PHONE} ${PLANTED_EMAIL}`, posterName: "every job is real" })
    )

    const html = await pageHtml({ channel: PLANTED_EMAIL })

    expect(html).not.toContain(PLANTED_EMAIL)
    expect(html).not.toContain(PLANTED_PHONE)
    expect(html).not.toContain("44.15432")
    expect(html).not.toContain("-122.48765")
    expect(html).not.toContain(LANDING_ORG)
    expect(html).not.toContain("Green gate")
    expect(html).not.toMatch(/verified job|every job is real|real jobs only|application\/ld\+json/i)
    expect(mocks.getJob).toHaveBeenCalledWith(JOB_ID)
  })

  it("sends a signed-in hauler to the interest form and the poster to inquiries", async () => {
    signedInAs(HAULER_ORG)
    expect(await pageHtml()).toContain(`href="/v2/work/${JOB_ID}#interest"`)
    expect(await pageHtml()).not.toContain("/sign-up")

    signedInAs(LANDING_ORG)
    const own = await pageHtml()
    expect(own).toContain('href="/v2/landing/inquiries"')
    expect(own).not.toContain("Send interest")
    expect(own).not.toContain(PLANTED_EMAIL)
  })

  it("offers open jobs when the listing is not accepting interest", async () => {
    mocks.getJob.mockResolvedValue(job({ acceptingInterest: false, expiresAt: "2020-01-01T00:00:00.000Z" }))

    const html = await pageHtml()

    expect(html).toContain("Listing expired")
    expect(html).toContain('href="/v2/work"')
    expect(html).not.toContain("/sign-up")
    expect(html).not.toContain("today")
  })

  it("records a share open only when a PostHog key is set, and only with a named channel", async () => {
    expect(await pageHtml({ channel: "facebook" })).not.toContain("data-beacon")

    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_share")
    const html = await pageHtml({ channel: "facebook" })

    expect(html).toContain(`data-beacon="share"`)
    expect(html).toContain(`data-channel="facebook"`)
    expect(html).toContain(`data-job="${JOB_ID}"`)
    expect(html).toContain(`data-signed="false"`)

    signedInAs(HAULER_ORG)
    expect(await pageHtml({ channel: PLANTED_PHONE })).toContain(`data-channel="other"`)
    expect(await pageHtml({ channel: PLANTED_PHONE })).toContain(`data-signed="true"`)
    expect(await pageHtml({ channel: PLANTED_PHONE })).not.toContain(PLANTED_PHONE)
  })

  it("is a not-found page when the job is missing or Marketplace V2 is off", async () => {
    mocks.getJob.mockResolvedValue(null)
    await expect(pageHtml()).rejects.toThrow("NEXT_NOT_FOUND")
    expect(mocks.areaNotice).toHaveBeenCalledWith(JOB_ID)

    mocks.enabled = false
    mocks.getJob.mockResolvedValue(job())
    await expect(pageHtml()).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("shows a closed basin with no job facts", async () => {
    mocks.getJob.mockResolvedValue(null)
    mocks.areaNotice.mockResolvedValue("not in your area yet")

    const html = await pageHtml({ channel: "facebook" })

    expect(html).toContain("Not in your area yet")
    expect(html).toContain("This area is not open yet.")
    expect(html).not.toContain("Oak saw logs")
    expect(html).not.toContain("$475.00")
    expect(html).not.toContain("Pole trailer")
    expect(html).not.toContain("54 mi")
    expect(html).not.toContain("Send interest")
    expect(html).not.toContain("/sign-up")
    expect(html).not.toContain(PLANTED_EMAIL)
    expect(html).not.toContain(PLANTED_PHONE)
    expect(html).not.toContain("Green gate")
    expect(html).not.toContain("44.15432")
  })
})

describe("preview metadata", () => {
  it("describes the job for Open Graph and Twitter without contact details", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ jobId: JOB_ID }) })
    const facts = shareFacts(toPublicJobView(job()), new Date().toISOString())
    const serialized = JSON.stringify(metadata)

    expect(metadata.title).toBe("Oak saw logs to Cascade Mill")
    expect(metadata.description).toBe(facts.description)
    expect(metadata.openGraph).toMatchObject({
      description: facts.description,
      images: [{ alt: facts.cardFreshness, height: 630, url: `/v2/share/${JOB_ID}/opengraph-image`, width: 1200 }],
      title: facts.title
    })
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image", images: [`/v2/share/${JOB_ID}/opengraph-image`] })
    expect(serialized).not.toContain(PLANTED_EMAIL)
    expect(serialized).not.toContain(PLANTED_PHONE)
    expect(serialized).not.toMatch(/verified job|every job is real/i)
  })

  it("paints the card with pay, trailer, distance and a dated confirmation", async () => {
    const facts = shareFacts(toPublicJobView(job()), new Date().toISOString())
    const image = (await ShareCard({ params: Promise.resolve({ jobId: JOB_ID }) })) as unknown as { element: React.ReactElement }
    const html = renderToStaticMarkup(image.element)

    expect(size).toEqual({ height: 630, width: 1200 })
    expect(contentType).toBe("image/png")
    expect(alt).not.toMatch(/verified|real jobs/i)
    expect(html).toContain(facts.payAmount)
    expect(html).toContain(facts.payBasis)
    expect(html).toContain(facts.equipment)
    expect(html).toContain(facts.distance)
    expect(html).toContain(facts.cardFreshness)
    expect(html).toContain("Sponsored")
    expect(facts.cardFreshness).not.toMatch(/today/i)
    expect(html).not.toContain(PLANTED_PHONE)
    expect(html).not.toContain("44.15432")
  })

  it("describes a closed basin without the listing", async () => {
    mocks.getJob.mockResolvedValue(null)
    mocks.areaNotice.mockResolvedValue("not in your area yet")

    const metadata = await generateMetadata({ params: Promise.resolve({ jobId: JOB_ID }) })
    const serialized = JSON.stringify(metadata)

    expect(metadata.title).toBe("Not in your area yet")
    expect(metadata.description).toContain("This area is not open yet.")
    expect(serialized).not.toContain("Oak saw")
    expect(serialized).not.toContain("475")
    expect(serialized).not.toContain(PLANTED_PHONE)
    expect(serialized).not.toContain("opengraph-image")

    const image = (await ShareCard({ params: Promise.resolve({ jobId: JOB_ID }) })) as unknown as { element: React.ReactElement }
    const html = renderToStaticMarkup(image.element)

    expect(html).toContain("Not in your area yet")
    expect(html).not.toContain("$475")
    expect(html).not.toContain("Pole")
    expect(html).not.toContain("54")
    expect(html).not.toContain(PLANTED_PHONE)
  })

  it("is not listed in the sitemap", () => {
    const sitemap = readFileSync(new URL("../../sitemap.ts", import.meta.url), "utf8")

    expect(sitemap).not.toContain("/v2/share")
  })
})
