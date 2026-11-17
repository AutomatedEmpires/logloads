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
  haulerFleet: vi.fn(),
  interestForJob: vi.fn(),
  listHaulerInterests: vi.fn(),
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
    haulerFleet: mocks.haulerFleet,
    interestForJob: mocks.interestForJob,
    listHaulerInterests: mocks.listHaulerInterests,
    listJobs: mocks.listJobs,
    viewerAccess: mocks.viewerAccess
  }
}))

import type { HaulerFleetView, MarketplaceInterestView, MarketplaceJobDetailView } from "@logloads/contracts"
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

/** The business's own trucks (My trucks, #126): two pole-trailer trucks, with an optional availability report. */
function fleet(availability: HaulerFleetView["availability"] = []): HaulerFleetView {
  return {
    availability,
    canEdit: true,
    organizationId: HAULER_ORG,
    placed: true,
    units: [{ category: "truck", equipmentCode: "log_truck", id: "log_truck|pole_trailer", label: "Log truck + Pole trailer", otherTrailer: null, trailerCode: "pole_trailer", units: 2 }]
  }
}

function sentInterest(overrides: Partial<MarketplaceInterestView> = {}): MarketplaceInterestView {
  return {
    availableFrom: "2026-11-12",
    availableUntil: null,
    contactPreference: "in_app",
    createdAt: "2026-11-04T18:00:00.000Z",
    equipment: [{ configurationKey: "log_truck|pole_trailer", count: 2, label: "Log truck + Pole trailer" }],
    haulerOrganization: { id: HAULER_ORG, name: "Example Hauling LLC", type: "hauler" },
    id: OTHER_ID,
    job: { acceptingInterest: true, id: JOB_ID, slug: JOB_ID, status: "active", title: "Saw logs to the river mill" },
    landingOrganization: { id: LANDING_ORG, name: "Example Timber Co" },
    message: null,
    replies: [],
    status: "submitted",
    submittedBy: { name: "Sam Hauler", userId: USER_ID },
    trucksOffered: 2,
    updatedAt: "2026-11-04T18:00:00.000Z",
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
  mocks.haulerFleet.mockResolvedValue(fleet())
  mocks.listHaulerInterests.mockResolvedValue([])
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

    mocks.interestForJob.mockResolvedValueOnce(sentInterest({ equipment: [], id: OTHER_ID }))
    expect(propsOf(await tree(), JobInterestBar)).toBeUndefined()

    mocks.getSessionActor.mockResolvedValueOnce(actorFor(LANDING_ORG))
    expect(propsOf(await tree(), JobInterestBar)).toBeUndefined()
  })
})

describe("the interest sheet (UX-08, #131)", () => {
  const today = new Date().toISOString().slice(0, 10)
  const fresh = (overrides: Partial<HaulerFleetView["availability"][number]> = {}) => ({
    availableCount: 1, availableFrom: today, availableUntil: "2099-01-01", equipmentCode: "log_truck", reportedAt: new Date().toISOString(), state: "available" as const, ...overrides
  })
  const sheetOf = (html: string) => [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map((match) => match[0]).find((tag) => tag.includes('name="loadPostingId"')) ?? ""

  it("fills in the trucks and the date from My trucks and the contact route from the last inquiry, as the session's business (criterion 1)", async () => {
    mocks.haulerFleet.mockResolvedValue(fleet([fresh()]))
    mocks.listHaulerInterests.mockResolvedValue([sentInterest({ contactPreference: "email" })])
    const sheet = sheetOf(await renderJob())

    expect(textOf(sheet)).toContain("As Example Hauling LLC")
    expect(sheet.match(/<input[^>]*name="equipmentCount"[^>]*>/)?.[0]).toContain('value="1"')
    expect(textOf(sheet)).toContain("Log truck + Pole trailer 1 of 2 available Available now · Updated today by the hauler")
    expect(sheet.match(/<input[^>]*name="availableFrom"[^>]*>/)?.[0]).toContain(`value="${today}"`)
    expect(sheet).toMatch(/<option value="email" selected="">Email<\/option>/)
  })

  it("reads each record as the session's business, and still offers the form when one cannot be read", async () => {
    await renderJob()
    for (const read of [mocks.haulerEquipment, mocks.haulerFleet, mocks.listHaulerInterests]) {
      expect(read).toHaveBeenCalledWith({ organizationId: HAULER_ORG, userId: USER_ID })
    }

    mocks.haulerFleet.mockRejectedValue(new Error("store down"))
    mocks.listHaulerInterests.mockRejectedValue(new Error("store down"))
    const sheet = sheetOf(await renderJob())
    expect(sheet).toContain('name="equipmentCount"')
    expect(textOf(sheet)).toContain("availability not recently confirmed")
    expect(sheet).toMatch(/<option value="in_app" selected="">LogLoads messages<\/option>/)
  })

  it("is not offered to a visitor or to a business that already sent interest", async () => {
    mocks.getSessionActor.mockResolvedValueOnce(null)
    expect(sheetOf(await renderJob())).toBe("")
    expect(mocks.haulerFleet).not.toHaveBeenCalled()

    mocks.interestForJob.mockResolvedValueOnce(sentInterest())
    expect(sheetOf(await renderJob())).toBe("")
  })

  it("confirms what was sent: the landing business, the trucks and the date, with links to inquiries and similar jobs (criterion 4)", async () => {
    mocks.interestForJob.mockResolvedValue(sentInterest())
    mocks.listJobs.mockResolvedValue([job({ id: "77777777-7777-4777-8777-777777777777", posterName: "Other Landing Co", slug: "77777777-7777-4777-8777-777777777777", title: "Saw logs, next valley" })])
    const html = await renderJob({ sent: "1" })
    const notice = /<div[^>]*role="status"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ""

    expect(textOf(notice)).toBe("Sent to Example Timber Co: 2 trucks (2 × Log truck + Pole trailer), available from Nov 12, 2026.")
    expect(textOf(html)).toContain("Sent · waiting for the landing. Free and nonbinding: the landing reviews it and replies in your inquiries.")
    expect(html).toContain(`href="/v2/inquiries?inquiry=${OTHER_ID}"`)
    expect(html).toMatch(/<a[^>]*href="#similar"[^>]*>See similar jobs<\/a>/)
    expect(html).toContain('id="similar"')
    expect(html).toMatch(/<a[^>]*href="\/v2\/work\/77777777-7777-4777-8777-777777777777"[^>]*>Saw logs, next valley<\/a>/)
    expect(textOf(html)).not.toMatch(/\b(hired|booked|assigned)\b/i)

    // A later visit summarises the standing interest instead, and suggests nothing.
    const later = await renderJob()
    expect(textOf(later)).toContain("You offered Example Timber Co 2 trucks (2 × Log truck + Pole trailer), available from Nov 12, 2026. Sent · waiting for the landing.")
    expect(later).not.toContain('id="similar"')
  })

  it("flags a sent offer above the latest availability report, so a page without JavaScript says so too (criterion 2)", async () => {
    mocks.interestForJob.mockResolvedValue(sentInterest())
    mocks.haulerFleet.mockResolvedValue(fleet([fresh()]))
    const html = await renderJob({ sent: "1" })

    expect(textOf(html)).toContain("Log truck: you reported 1 available, and you offered 2. Update availability?")
    expect(html).toMatch(/<a[^>]*href="\/v2\/hauler\/trucks#availability-log_truck"[^>]*>Update availability\?<\/a>/)

    mocks.haulerFleet.mockResolvedValue(fleet([fresh({ availableCount: 2 })]))
    expect(textOf(await renderJob({ sent: "1" }))).not.toContain("Update availability?")
  })
})

describe("a link cannot write into the page (#279, C2)", () => {
  const PHISHING = "Your account is locked. Call 541-555-0100 to keep your listings."

  it.each([
    ["free text", PHISHING],
    ["markup", `<img src=x onerror="alert(1)">`],
    ["an unknown code", "account_locked"]
  ])("shows the generic copy for %s in ?error=, and none of its text", async (_label, value) => {
    const html = await renderJob({ error: value })

    expect(html).toMatch(/role="alert"[^>]*>Something went wrong on our side\. Try again in a moment\.</)
    expect(html).not.toContain("541-555-0100")
    expect(html).not.toContain("onerror")
    expect(html).not.toContain("account_locked")
  })

  it("shows a known code's fixed copy, and the reference it was logged under", async () => {
    expect(await renderJob({ error: "job_closed" })).toMatch(/role="alert"[^>]*>This job is no longer accepting interest\. Nothing was sent\.</)
    expect(textOf(await renderJob({ error: "unexpected", ref: "0123456789ab" }))).toContain("Try again in a moment. Reference: 0123456789ab.")
    expect(textOf(await renderJob({ error: "unexpected", ref: PHISHING }))).not.toContain("Reference")
  })
})
