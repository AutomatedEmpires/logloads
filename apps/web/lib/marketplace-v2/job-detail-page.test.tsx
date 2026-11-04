import React, { isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The job page (UX-07, #130), rendered on the server as a first visit or a visit without JavaScript receives it, with
 * the port, the session and the actions stubbed: the decision summary, the collapsible sections, Share and Report, a
 * listing that stopped accepting interest, the sticky bar's offer, and what reaches client components.
 */

const mocks = vi.hoisted(() => ({
  getJob: vi.fn(),
  getSessionActor: vi.fn(),
  haulerEquipment: vi.fn(),
  interestForJob: vi.fn(),
  listJobs: vi.fn(),
  viewerAccess: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  }
}))
vi.mock("@/lib/marketplace-v2/flag", () => ({ marketplaceV2Enabled: () => true }))
vi.mock("@/lib/session", () => ({ getSessionActor: mocks.getSessionActor }))
vi.mock("@/lib/marketplace-v2/viewer", () => ({ withBusinessSwitchNote: (refusal: string) => refusal }))
vi.mock("@/lib/marketplace-v2/actions", () => ({ expressInterestAction: async () => undefined }))
vi.mock("@/lib/marketplace-v2/report-actions", () => ({ reportListingAction: async () => ({ status: "idle" }) }))
vi.mock("@/lib/app-url", () => ({ resolvePublicAppUrl: () => "https://logloads.example" }))
vi.mock("@/lib/marketplace-v2/pilot-adapter", () => ({
  pilotMarketplaceV2: {
    getJob: mocks.getJob,
    haulerEquipment: mocks.haulerEquipment,
    interestForJob: mocks.interestForJob,
    listJobs: mocks.listJobs,
    viewerAccess: mocks.viewerAccess
  }
}))

import type { MarketplaceJobDetailView } from "@logloads/contracts"
import { JobDetail } from "@logloads/ui/marketplace"

import JobDetailPage from "@/app/v2/work/[jobId]/page"
import { JobInterestBar } from "@/components/v2/JobInterestBar"
import { ReportListing } from "@/components/v2/ReportListing"
import { ShareListing } from "@/components/v2/ShareListing"

const HAULER_ORG = "33333333-bbbb-4bbb-8bbb-333333333333"
const LANDING_ORG = "22222222-aaaa-4aaa-8aaa-222222222222"
const USER_ID = "55555555-dddd-4ddd-8ddd-555555555555"
const JOB_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_ID = "66666666-6666-4666-8666-666666666666"

function job(overrides: Partial<MarketplaceJobDetailView> = {}): MarketplaceJobDetailView {
  return {
    acceptingInterest: true,
    destinationLabel: "Example mill · Riverton, OR",
    endsOn: "2026-11-30",
    equipment: ["log_truck", "pole_trailer"],
    estimatedDailyLoads: null,
    estimatedLoadsPerTruckPerDay: null,
    estimatedTonsPerLoad: 28,
    expiresAt: "2026-12-01T00:00:00.000Z",
    haulDistance: { basis: "poster_route_estimate", miles: 54 },
    id: JOB_ID,
    lastConfirmedAt: null,
    lastModifiedAt: "2026-11-01T09:00:00.000Z",
    origin: { approximatePoint: { lat: 44.1, lng: -122.4 }, label: "Riverton, OR", stateCode: "OR" },
    pay: { amountCents: 52_500, note: null, unit: "per_load" },
    posterName: "Example Timber Co",
    posterOrganizationId: LANDING_ORG,
    posterVerification: null,
    product: "Saw logs",
    publicAccessRequirements: [],
    publicRoadNotes: "Gravel for the last 6 miles",
    scheduleNote: null,
    slug: JOB_ID,
    sponsored: false,
    startsOn: "2026-11-10",
    status: "active",
    title: "Saw logs to the river mill",
    trucks: { perDay: 3, total: 6 },
    ...overrides
  }
}

function actorFor(organizationId: string) {
  return { activeOrganization: { id: organizationId }, memberships: [], profile: { id: USER_ID }, workspaceSelectionInvalid: false }
}

async function tree(query: Record<string, string> = {}) {
  return JobDetailPage({ params: Promise.resolve({ jobId: JOB_ID }), searchParams: Promise.resolve(query) })
}

async function renderJob(query: Record<string, string> = {}) {
  return renderToStaticMarkup(await tree(query))
}

const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()

/** Every element in a server tree, including those passed in props such as ContentGrid's `main` and `aside`. */
function elements(node: unknown, found: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, found)
  } else if (isValidElement(node)) {
    found.push(node)
    for (const value of Object.values(node.props as Record<string, unknown>)) elements(value, found)
  }
  return found
}

function propsOf<P>(root: ReactNode, type: unknown): P | undefined {
  return elements(root).find((element) => element.type === type)?.props as P | undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  // The app compiles JSX with the classic runtime under Vitest, as in v2-pages.test.tsx.
  vi.stubGlobal("React", React)
  mocks.getJob.mockResolvedValue(job())
  mocks.getSessionActor.mockResolvedValue(actorFor(HAULER_ORG))
  mocks.viewerAccess.mockResolvedValue({ capabilities: ["interest.express"], organizationName: "Example Hauling LLC" })
  mocks.interestForJob.mockResolvedValue(null)
  mocks.haulerEquipment.mockResolvedValue([
    { configurationKey: "log_truck|pole_trailer", equipmentCodes: ["log_truck", "pole_trailer"], label: "Log truck + Pole trailer", unitsListed: 2 }
  ])
  mocks.listJobs.mockResolvedValue([])
})

describe("the decision summary (criteria 1, 2, 7)", () => {
  it("leads the page with the shared JobSummary: pay, equipment with fit, area, destination, start, trucks and freshness", async () => {
    const html = await renderJob()
    const summary = /<div[^>]*id="job-summary-[^"]+"[^>]*>([\s\S]*?)<div[^>]*class="[^"]*sections/.exec(html)?.[1] ?? ""

    expect(textOf(summary)).toContain("$525.00 per load Stated by the poster. Not a LogLoads guarantee.")
    expect(textOf(summary)).toContain("Equipment Log truck, Pole trailer Fits your trucks")
    expect(textOf(summary)).toContain("Area Near Riverton, OR · approximate")
    expect(textOf(summary)).toContain("To Example mill · Riverton, OR 54 mi one way · poster's route estimate")
    expect(textOf(summary)).toContain("Schedule Nov 10, 2026 – Nov 30, 2026 · About 21 days")
    expect(textOf(summary)).toContain("Trucks 6 trucks for the job · 3 trucks a day")
    expect(textOf(summary)).toMatch(/Listing Not confirmed by poster/)
    expect(textOf(summary)).toContain("Not stated by the poster: loads a day, loads per truck a day.")
    expect(summary).toMatch(/<a[^>]*href="#interest"[^>]*>(?:(?!<\/a>).)*I'm interested|<a[^>]*href="#interest"[^>]*>[\s\S]*?I&#x27;m interested/)
  })

  it("puts haul details, road and access, weather and the poster in collapsed <details> sections (criterion 3)", async () => {
    const html = await renderJob()
    const titles = [...html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((match) => textOf(match[1] as string))

    expect(titles).toEqual(expect.arrayContaining(["Haul details", "Road and access", "Weather near the landing", "About Example Timber Co"]))
  })

  it("asks for no fit on the poster's own listing", async () => {
    mocks.getSessionActor.mockResolvedValue(actorFor(LANDING_ORG))
    mocks.viewerAccess.mockResolvedValue({ capabilities: ["job.publish"], organizationName: "Example Timber Co" })

    expect(textOf(await renderJob())).not.toContain("Fits your trucks")
  })
})

describe("what reaches the browser (#185 review)", () => {
  it("gives the shared JobDetail and every client component the public view, never the poster's organization id", async () => {
    const root = await tree()
    const detail = propsOf<{ job: Record<string, unknown> }>(root, JobDetail)

    expect(detail?.job).toBeDefined()
    expect(Object.keys(detail?.job ?? {})).not.toContain("posterOrganizationId")
    for (const component of [JobDetail, ShareListing, ReportListing, JobInterestBar]) {
      expect(JSON.stringify(propsOf(root, component) ?? {}), String(component.name)).not.toContain(LANDING_ORG)
    }
    expect(await renderJob()).not.toContain(LANDING_ORG)
  })

  it("never prints exact coordinates, gate details or contact details", async () => {
    mocks.getJob.mockResolvedValue({ ...job(), contactPhone: "541-555-0100", exactPoint: "44.15432,-122.48765", gateInstructions: "Green gate 4417" })

    expect(await renderJob()).not.toMatch(/555-0100|44\.15432|Green gate/)
  })
})

describe("share and report (criterion 5)", () => {
  it("shares the public link only: the public origin and the job's path, never this request's query", async () => {
    const root = await tree({ error: "Something", sent: "1" })

    expect(propsOf<{ url: string }>(root, ShareListing)?.url).toBe(`https://logloads.example/v2/work/${JOB_ID}`)
    const html = renderToStaticMarkup(root)
    expect(html).toMatch(/<summary[^>]*>Share this job<\/summary>/)
    expect(html).toMatch(new RegExp(`<input[^>]*readOnly=""[^>]*value="https://logloads.example/v2/work/${JOB_ID}"|<input[^>]*value="https://logloads.example/v2/work/${JOB_ID}"[^>]*readOnly`, "i"))
  })

  it("offers the spec's report reasons to a signed-in person, with optional details, posting only the listing id", async () => {
    const html = await renderJob()
    const report = /<details[^>]*id="report"[^>]*>([\s\S]*?)<\/details>/.exec(html)?.[1] ?? ""

    expect(textOf(report)).toContain("Report this listing")
    expect((report.match(/<input[^>]*type="radio"[^>]*name="reason"|<input[^>]*name="reason"[^>]*type="radio"/g) ?? []).length).toBe(8)
    expect(textOf(report)).toContain(
      "No longer available Pay looks inaccurate The work doesn't seem real Wrong equipment listed Suspicious contact request Abusive language It shows private or access details Something else"
    )
    expect(report).toMatch(/<textarea[^>]*name="details"/)
    expect(report).toMatch(/<input[^>]*name="jobId"[^>]*value="11111111-1111-4111-8111-111111111111"/)
    expect(report).not.toMatch(/name="(organizationId|userId|reporter)/)
  })

  it("asks a visitor to sign in before reporting, and comes back to the report", async () => {
    mocks.getSessionActor.mockResolvedValue(null)
    const report = /<details[^>]*id="report"[^>]*>([\s\S]*?)<\/details>/.exec(await renderJob())?.[1] ?? ""

    expect(report).not.toContain("<form")
    expect(report).toContain(`href="/sign-in?next=${encodeURIComponent(`/v2/work/${JOB_ID}#report`)}"`)
  })
})

describe("a listing that stopped accepting interest (criterion 6)", () => {
  beforeEach(() => {
    mocks.listJobs.mockResolvedValue([
      job({ id: OTHER_ID, posterName: "Other Landing Co", slug: OTHER_ID, title: "Saw logs, next valley" }),
      job({ acceptingInterest: false, id: "77777777-7777-4777-8777-777777777777", status: "closed", title: "Also closed" })
    ])
  })

  it.each([
    ["paused", { lastModifiedAt: "2026-11-04T18:00:00.000Z" }, "The poster paused this listing. Listing last changed on Nov 4, 2026."],
    ["closed", { lastModifiedAt: "2026-11-04T18:00:00.000Z" }, "The poster closed this listing. Listing last changed on Nov 4, 2026."],
    ["expired", { expiresAt: "2026-11-02T00:00:00.000Z" }, "This listing expired. Expired on Nov 2, 2026."]
  ] as const)("renders a %s job in the page with why and when, and similar open jobs", async (status, overrides, why) => {
    mocks.getJob.mockResolvedValue(job({ acceptingInterest: false, status, ...overrides }))
    const html = await renderJob()

    expect(textOf(html)).toContain(`Not accepting interest ${why}`)
    expect(html).not.toContain('name="loadPostingId"')
    expect(textOf(html)).toContain("Similar open jobs")
    expect(html).toMatch(new RegExp(`<a[^>]*href="/v2/work/${OTHER_ID}"[^>]*>Saw logs, next valley</a>`))
    expect(html).not.toContain(">Also closed<")
    expect(html).toMatch(/<a[^>]*href="\/v2\/work"[^>]*>See all open jobs<\/a>/)
    // No sticky interest bar on a job that takes no interest.
    expect(propsOf(await tree(), JobInterestBar)).toBeUndefined()
  })

  it("asks the store for the job as the session's person, so their own or inquired job can still say why", async () => {
    await renderJob()

    expect(mocks.getJob).toHaveBeenCalledWith(JOB_ID, { organizationId: HAULER_ORG, userId: USER_ID })
  })

  it("is a 404 only when the store returns no job", async () => {
    mocks.getJob.mockResolvedValue(null)

    await expect(renderJob()).rejects.toThrow("NEXT_NOT_FOUND")
  })
})

describe("the sticky interest bar (criterion 4)", () => {
  it("is rendered hidden, observing the summary, and leads to the interest form", async () => {
    const root = await tree()

    expect(propsOf(root, JobInterestBar)).toEqual({
      offer: { href: "#interest", kind: "interest", label: "I'm interested", note: "Free · nonbinding" },
      summaryId: `job-summary-${JOB_ID}`,
      targetId: "interest"
    })
    // Before scripts run (and without them) it stays hidden; the summary's own link is the route.
    expect(renderToStaticMarkup(root)).toMatch(/<div[^>]*data-interest-bar=""[^>]*hidden=""/)
  })

  it("leads a visitor to sign in, and offers nothing once interest is sent or to the poster", async () => {
    mocks.getSessionActor.mockResolvedValueOnce(null)
    expect(propsOf<{ offer: { href: string } }>(await tree(), JobInterestBar)?.offer.href).toBe(`/sign-in?next=${encodeURIComponent(`/v2/work/${JOB_ID}`)}`)

    mocks.interestForJob.mockResolvedValueOnce({ equipment: [], id: OTHER_ID, replies: [], status: "submitted", trucksOffered: 2 })
    expect(propsOf(await tree(), JobInterestBar)).toBeUndefined()

    mocks.getSessionActor.mockResolvedValueOnce(actorFor(LANDING_ORG))
    expect(propsOf(await tree(), JobInterestBar)).toBeUndefined()
  })
})
