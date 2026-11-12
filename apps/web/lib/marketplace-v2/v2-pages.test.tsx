import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * DS-04 (#147): the job page, both inquiry pages, /v2/switch, /v2/start and the V2 not-found page, built from the
 * design system. Rendered on the server exactly as a first visit (or a visit without JavaScript) receives them, with
 * the port, the session and the actions stubbed. Identity is the session's; the pages pass only ids to the forms.
 */

const mocks = vi.hoisted(() => ({
  getJob: vi.fn(),
  getSessionActor: vi.fn(),
  haulerEquipment: vi.fn(),
  haulerFleet: vi.fn(),
  interestForJob: vi.fn(),
  landingInquiryJobs: vi.fn(),
  listHaulerInterests: vi.fn(),
  listJobs: vi.fn(),
  listLandingInterests: vi.fn(),
  resolveV2Actor: vi.fn(),
  viewerAccess: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`)
  }
}))
vi.mock("@/lib/marketplace-v2/flag", () => ({ marketplaceV2Enabled: () => true }))
vi.mock("@/lib/session", () => ({ getSessionActor: mocks.getSessionActor }))
vi.mock("@/lib/marketplace-v2/viewer", () => ({
  NO_BUSINESS_PROFILE_REFUSAL: "Your sign-in is not linked to a LogLoads business yet.",
  resolveV2Actor: mocks.resolveV2Actor,
  withBusinessSwitchNote: (refusal: string) => refusal
}))
vi.mock("@/lib/marketplace-v2/actions", () => ({
  expressInterestAction: async () => undefined,
  haulerReplyAction: async () => undefined,
  respondToInterestAction: async () => undefined,
  withdrawInterestAction: async () => undefined
}))
vi.mock("@/lib/marketplace-v2/switch-actions", () => ({ switchV2BusinessAction: async () => undefined }))
vi.mock("@/lib/marketplace-v2/pilot-adapter", () => ({
  pilotMarketplaceV2: {
    getJob: mocks.getJob,
    haulerEquipment: mocks.haulerEquipment,
    haulerFleet: mocks.haulerFleet,
    interestForJob: mocks.interestForJob,
    landingInquiryJobs: mocks.landingInquiryJobs,
    listHaulerInterests: mocks.listHaulerInterests,
    listJobs: mocks.listJobs,
    listLandingInterests: mocks.listLandingInterests,
    viewerAccess: mocks.viewerAccess
  }
}))

import type { MarketplaceInterestView, MarketplaceJobDetailView } from "@logloads/contracts"

import MyInquiriesPage from "@/app/v2/inquiries/page"
import LandingInboxPage from "@/app/v2/landing/inquiries/page"
import MarketplaceV2NotFound from "@/app/v2/not-found"
import StartPage from "@/app/v2/start/page"
import SwitchBusinessPage from "@/app/v2/switch/page"
import JobDetailPage from "@/app/v2/work/[jobId]/page"

const HAULER_ORG = "33333333-bbbb-4bbb-8bbb-333333333333"
const LANDING_ORG = "22222222-aaaa-4aaa-8aaa-222222222222"
const USER_ID = "55555555-dddd-4ddd-8ddd-555555555555"
const JOB_ID = "11111111-1111-4111-8111-111111111111"
const FIRST = "44444444-cccc-4ccc-8ccc-444444444444"
const SECOND = "66666666-eeee-4eee-8eee-666666666666"
const ATTACK = `<img src=x onerror="alert(1)"><script>alert("x")</script>`

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

function interest(overrides: Partial<MarketplaceInterestView> = {}): MarketplaceInterestView {
  return {
    availableFrom: "2026-11-10",
    availableUntil: null,
    contactPreference: "in_app",
    createdAt: "2026-11-01T12:00:00.000Z",
    equipment: [{ configurationKey: "log-pole", count: 2, label: "Log truck + Pole trailer" }],
    haulerOrganization: { id: HAULER_ORG, name: "Example Hauling LLC", type: "hauler" },
    id: FIRST,
    job: { acceptingInterest: true, id: JOB_ID, slug: JOB_ID, status: "active", title: "Saw logs to the river mill" },
    landingOrganization: { id: LANDING_ORG, name: "Example Timber Co" },
    message: ATTACK,
    replies: [],
    status: "submitted",
    submittedBy: { name: "Sam Hauler", userId: USER_ID },
    trucksOffered: 2,
    updatedAt: "2026-11-01T12:00:00.000Z",
    ...overrides
  }
}

function actorFor(organizationId: string) {
  return { activeOrganization: { id: organizationId }, memberships: [], profile: { id: USER_ID }, workspaceSelectionInvalid: false }
}

type Query = Record<string, string>

async function renderJob(query: Query = {}) {
  return renderToStaticMarkup(await JobDetailPage({ params: Promise.resolve({ jobId: JOB_ID }), searchParams: Promise.resolve(query) }))
}

async function renderPage(page: (props: { searchParams: Promise<Query> }) => Promise<React.ReactElement>, query: Query = {}) {
  return renderToStaticMarkup(await page({ searchParams: Promise.resolve(query) }))
}

/** The `<form>…</form>` that contains `marker`. */
function formAround(html: string, marker: string): string {
  return [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map((match) => match[0]).find((form) => form.includes(marker)) ?? ""
}

function hidden(html: string, name: string, value: string): boolean {
  return new RegExp(`<input[^>]*name="${name}"[^>]*type="hidden"[^>]*value="${value}"|<input[^>]*type="hidden"[^>]*name="${name}"[^>]*value="${value}"`).test(html) ||
    (html.match(/<input[^>]*>/g) ?? []).some((tag) => tag.includes(`name="${name}"`) && tag.includes('type="hidden"') && tag.includes(`value="${value}"`))
}

const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()

/** The first tag matching `pattern`, or "". */
const openingTagOf = (html: string, pattern: RegExp) => html.match(pattern)?.[0] ?? ""

/** A link Tabs set: [href, text, current] per tab. */
function tabs(html: string, label: string): Array<[string, string, boolean]> {
  const start = html.indexOf(`aria-label="${label}"`)
  const nav = start < 0 ? "" : html.slice(start, html.indexOf("</nav>", start))
  return [...nav.matchAll(/<a([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => [
    (match[1]?.match(/href="([^"]*)"/)?.[1] ?? "").replace(/&amp;/g, "&"),
    textOf(match[2] ?? ""),
    /aria-current="page"/.test(match[1] ?? "")
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
  // The app compiles JSX with the classic runtime under Vitest (tsconfig "jsx": "preserve"), as in job-authoring-pages.test.tsx.
  vi.stubGlobal("React", React)
  mocks.getJob.mockResolvedValue(job())
  mocks.getSessionActor.mockResolvedValue(actorFor(HAULER_ORG))
  mocks.viewerAccess.mockResolvedValue({ capabilities: ["interest.express", "interest.withdraw", "interest.reply"], organizationName: "Example Hauling LLC" })
  mocks.interestForJob.mockResolvedValue(null)
  mocks.listJobs.mockResolvedValue([])
  mocks.haulerEquipment.mockResolvedValue([
    { configurationKey: "log_truck|pole_trailer", equipmentCodes: ["log_truck", "pole_trailer"], label: "Log truck + Pole trailer", unitsListed: 2 },
    { configurationKey: "chip_truck|chip_van", equipmentCodes: ["chip_truck", "chip_van"], label: "Chip truck + Chip van", unitsListed: 1 }
  ])
  // As on the pilot store: equipment listed, and no availability report (#126).
  mocks.haulerFleet.mockResolvedValue({ availability: [], canEdit: true, organizationId: HAULER_ORG, placed: false, units: [] })
  mocks.listHaulerInterests.mockResolvedValue([])
  mocks.resolveV2Actor.mockResolvedValue({ actor: actorFor(HAULER_ORG), ok: true })
  mocks.landingInquiryJobs.mockResolvedValue([])
})

describe("the job page (/v2/work/[jobId])", () => {
  it("renders the shared JobDetail under a 'Job details' header with the interest form beside it", async () => {
    const html = await renderJob()

    expect(html).toContain('data-ds-page="job-detail"')
    expect(html).toMatch(/<h1[^>]*>Job details<\/h1>/)
    expect(html).toMatch(/<article aria-labelledby="job-detail-[^"]+"/)
    expect(html).toMatch(/<h2[^>]*id="job-detail-[^"]+"[^>]*>Saw logs to the river mill<\/h2>/)
    // JobDetail's "I'm interested" is a link to the form on the same page, so it works without JavaScript.
    expect(html).toMatch(/<a[^>]*href="#interest"[^>]*>(?:(?!<\/a>).)*I&#x27;m interested/)
    expect(html).toContain('id="interest"')
    expect(textOf(html)).toContain("Expires Dec 1, 2026")
    expect(textOf(html)).toContain("Availability confirmed Not confirmed by the poster")
  })

  it("offers one count per equipment configuration, capped at the units listed, with unknown availability never shown as 0", async () => {
    const form = formAround(await renderJob(), 'name="loadPostingId"')

    expect(hidden(form, "loadPostingId", JOB_ID)).toBe(true)
    expect(hidden(form, "equipmentKey", "log_truck|pole_trailer")).toBe(true)
    expect(hidden(form, "equipmentKey", "chip_truck|chip_van")).toBe(true)

    // Before hydration (and without JavaScript) each count is a native number input; parallel to the keys. The job
    // asks for a pole trailer, so that configuration comes first with one truck (no availability report, #131); the
    // chip truck waits behind "Show my other trucks" at 0.
    const counts = form.match(/<input[^>]*name="equipmentCount"[^>]*>/g) ?? []
    expect(counts).toHaveLength(2)
    expect(counts[0]).toContain('max="2"')
    expect(counts[1]).toContain('max="1"')
    expect(counts.every((tag) => tag.includes('min="0"'))).toBe(true)
    expect(counts.map((tag) => /value="(\d+)"/.exec(tag)?.[1])).toEqual(["1", "0"])
    expect(counts[0]).toContain('aria-label="Trucks offered: Log truck + Pole trailer"')
    expect(textOf(form)).toContain("Show my other trucks (1)")

    expect(textOf(form)).toContain("Log truck + Pole trailer 2 units · availability not recently confirmed")
    expect(textOf(form)).toContain("Chip truck + Chip van 1 unit · availability not recently confirmed")
    expect(textOf(form)).not.toMatch(/\b0 (of \d+ )?available\b/)
    expect(form).toMatch(/<button[^>]*type="submit"[^>]*>(?:(?!<\/button>).)*Send interest/)
  })

  it("defaults a single configuration to one truck, and a business without equipment to a plain count", async () => {
    mocks.haulerEquipment.mockResolvedValueOnce([{ configurationKey: "log_truck|pole_trailer", equipmentCodes: ["log_truck", "pole_trailer"], label: "Log truck + Pole trailer", unitsListed: 3 }])
    expect(formAround(await renderJob(), 'name="loadPostingId"').match(/<input[^>]*name="equipmentCount"[^>]*>/)?.[0]).toContain('value="1"')

    mocks.haulerEquipment.mockResolvedValueOnce([])
    const form = formAround(await renderJob(), 'name="loadPostingId"')
    const count = form.match(/<input[^>]*name="trucksOffered"[^>]*>/)?.[0] ?? ""

    expect(count).toMatch(/min="1"/)
    expect(count).toMatch(/max="500"/)
    expect(count).toMatch(/required=""/)
    expect(form).toMatch(/<label[^>]*for="interest-trucks"[^>]*>Trucks you can offer/)
    expect(form).not.toContain('name="equipmentCount"')
    expect(textOf(form)).toContain("Your business lists no trucks or trailers yet")
    // #126: "Add your equipment" leads to My trucks in V2, never the legacy fleet page.
    expect(form).toMatch(/<a[^>]*href="\/v2\/hauler\/trucks"[^>]*>Add your equipment<\/a>/)
  })

  it("keeps the refusal notes: visitor, poster, non-hauler, closed listing and interest already sent", async () => {
    mocks.getSessionActor.mockResolvedValueOnce(null)
    expect(await renderJob()).toMatch(/href="\/sign-in\?next=%2Fv2%2Fwork%2F11111111[^"]*"[^>]*>(?:(?!<\/a>).)*Sign in to express interest/)

    mocks.getSessionActor.mockResolvedValueOnce(actorFor(LANDING_ORG))
    const poster = await renderJob()
    expect(textOf(poster)).toContain("This is your organization’s job.")
    expect(poster).not.toContain('name="loadPostingId"')

    mocks.viewerAccess.mockResolvedValueOnce({ capabilities: ["job.publish"], organizationName: "Example Timber Co" })
    expect(textOf(await renderJob())).toContain("Only a hauling business can express interest.")

    mocks.getJob.mockResolvedValueOnce(job({ acceptingInterest: false, status: "paused" }))
    const paused = await renderJob()
    expect(textOf(paused)).toContain("The poster paused this listing. Listing last changed on Nov 1, 2026. It is not accepting new interest.")
    expect(paused).not.toContain('name="loadPostingId"')

    mocks.interestForJob.mockResolvedValueOnce(interest({ status: "replied" }))
    const sent = await renderJob({ sent: "1" })
    expect(textOf(sent)).toContain("Sent to Example Timber Co: 2 trucks (2 × Log truck + Pole trailer), available from Nov 10, 2026.")
    expect(textOf(sent)).toContain("Your turn. Free and nonbinding")
    expect(textOf(sent)).toContain("Interest sent · the poster reviews interest and replies")
    expect(sent).toContain(`href="/v2/inquiries?inquiry=${FIRST}"`)
    expect(sent).not.toContain('name="loadPostingId"')
  })

  it("announces a server refusal by its code's fixed copy", async () => {
    expect(await renderJob({ error: "trucks_required" })).toMatch(/role="alert"[^>]*>Enter how many trucks you can offer\./)
  })

  it("never shows the words of ?error= (#279, C2)", async () => {
    const html = await renderJob({ error: "Enter how many trucks you can offer" })

    expect(html).toMatch(/role="alert"[^>]*>Something went wrong on our side\./)
    expect(html).not.toContain("Enter how many trucks you can offer")
  })
})

describe("My inquiries (/v2/inquiries)", () => {
  beforeEach(() => {
    mocks.listHaulerInterests.mockResolvedValue([
      interest(),
      interest({ id: SECOND, landingOrganization: { id: "77777777-ffff-4fff-8fff-777777777777", name: "Other Landing Co" }, message: null, status: "declined" })
    ])
  })

  it("lists InquiryRows beside the selected conversation in a split ContentGrid", async () => {
    const html = await renderPage(MyInquiriesPage)

    expect(html).toContain('data-ds-page="my-inquiries"')
    expect(html).toContain('data-layout="split"')
    expect(html).toMatch(/<ul aria-label="Your inquiries"/)
    expect(html.match(/<a[^>]*aria-current="true"[^>]*>/g)).toEqual([expect.stringContaining(`href="/v2/inquiries?inquiry=${FIRST}#conversation"`)])
    expect(html).toMatch(/<section aria-labelledby="conversation-[^"]+"[^>]*id="conversation"/)
    expect(html).toContain('aria-label="Messages with Example Timber Co"')
  })

  it("selects the inquiry named in the query, and only the viewer's own", async () => {
    expect(await renderPage(MyInquiriesPage, { inquiry: SECOND })).toContain('aria-label="Messages with Other Landing Co"')
    expect(await renderPage(MyInquiriesPage, { inquiry: "99999999-9999-4999-8999-999999999999" })).toContain('aria-label="Messages with Example Timber Co"')
  })

  it("renders messages as escaped text", async () => {
    const html = await renderPage(MyInquiriesPage)

    // (React adds its own form-replay <script> for server-action forms; the message never becomes markup.)
    expect(html).not.toMatch(/<script>alert|<img/)
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;")
  })

  it("posts a reply with the inquiry id and a server-generated reply id, and blocks an empty one", async () => {
    const html = await renderPage(MyInquiriesPage)
    const composer = formAround(html, "Reply to Example Timber Co")
    const replyId = composer.match(/<input[^>]*name="replyId"[^>]*value="([^"]+)"/)?.[1] ?? composer.match(/<input[^>]*value="([^"]+)"[^>]*name="replyId"/)?.[1]

    expect(hidden(composer, "interestId", FIRST)).toBe(true)
    expect(replyId).toMatch(/^[0-9a-f-]{36}$/)
    expect(composer).toMatch(/<textarea[^>]*name="body"[^>]*required=""/)
    expect(composer).toMatch(/<button[^>]*aria-disabled="true"[^>]*type="button"[^>]*>(?:(?!<\/button>).)*Send/)
    expect(composer).toMatch(/<noscript><button[^>]*type="submit"/)
    expect(composer).not.toMatch(/name="(organizationId|userId|actorUserId)"/)
    // Each render issues a fresh reply id, so a sent reply never reuses the previous form's id.
    expect(await renderPage(MyInquiriesPage)).not.toContain(replyId)
  })

  it("asks before withdrawing: a Dialog with scripts, the same confirmation in the page without", async () => {
    const html = await renderPage(MyInquiriesPage)
    const trigger = html.match(/<a[^>]*aria-haspopup="dialog"[^>]*>/)?.[0] ?? ""

    expect(trigger).toContain(`href="/v2/inquiries?inquiry=${FIRST}&amp;confirm=withdraw#confirm-action"`)
    expect(html).not.toContain('id="confirm-action"')

    const confirming = await renderPage(MyInquiriesPage, { confirm: "withdraw", inquiry: FIRST })
    const form = formAround(confirming, "Withdraw interest</span></button>")

    expect(confirming).toMatch(/<section aria-labelledby="confirm-action-title"[^>]*id="confirm-action"/)
    expect(textOf(confirming)).toContain("Withdraw your interest? Example Timber Co will see that you withdrew")
    expect(hidden(form, "interestId", FIRST)).toBe(true)
    expect(confirming).toContain(`href="/v2/inquiries?inquiry=${FIRST}#conversation"`)
  })

  it("closes the composer on a declined inquiry and says plainly that the landing closed it (#194 HF-03)", async () => {
    const html = await renderPage(MyInquiriesPage, { inquiry: SECOND })

    expect(html).not.toContain("Reply to Other Landing Co")
    expect(textOf(html)).toContain("The landing has closed this inquiry. It can’t be withdrawn or sent again")
    expect(textOf(html)).toContain("The landing declined this inquiry.")
    // Not even the no-JavaScript confirmation link brings a withdrawal back.
    const confirming = await renderPage(MyInquiriesPage, { confirm: "withdraw", inquiry: SECOND })
    expect(confirming).not.toContain('id="confirm-action"')
    expect(confirming).not.toContain("Withdraw interest")
  })

  it("explains an empty list and a refusal", async () => {
    mocks.listHaulerInterests.mockResolvedValueOnce([])
    const empty = await renderPage(MyInquiriesPage)
    expect(textOf(empty)).toContain("No inquiries yet")
    expect(empty).toContain('href="/v2/work"')

    mocks.listHaulerInterests.mockRejectedValueOnce(new Error("Your role cannot act on inquiries for this business"))
    expect(textOf(await renderPage(MyInquiriesPage))).toContain("Your role cannot act on inquiries for this business")
  })
})

describe("the landing inbox (/v2/landing/inquiries)", () => {
  beforeEach(() => {
    mocks.resolveV2Actor.mockResolvedValue({ actor: actorFor(LANDING_ORG), ok: true })
    mocks.listLandingInterests.mockResolvedValue([
      interest({ id: SECOND, status: "replied", haulerOrganization: { id: HAULER_ORG, name: "Second Hauling", type: "hauler" } }),
      interest()
    ])
  })

  it("shows the New, Replied and Closed queues as tabs beside the selected conversation", async () => {
    const html = await renderPage(LandingInboxPage)

    expect(html).toContain('data-ds-page="landing-inbox"')
    expect(html).toContain('data-layout="split"')
    expect(html).toMatch(/<ul aria-label="New inquiries"/)
    expect(html).not.toMatch(/<ul aria-label="Replied inquiries"/)
    expect(textOf(html)).toContain("New 1 inquiry")
    expect(tabs(html, "Inquiries by queue")).toEqual([
      ["/v2/landing/inquiries", "New 1", true],
      ["/v2/landing/inquiries?tab=responded", "Replied 1", false],
      ["/v2/landing/inquiries?tab=closed", "Closed 0", false]
    ])
    // The first row of the first non-empty queue is selected by default.
    expect(html.match(/<a[^>]*aria-current="true"[^>]*>[^<]*/g)).toEqual([expect.stringContaining("Example Hauling LLC")])
    expect(html).not.toMatch(/<script>alert|<img/)

    const replied = await renderPage(LandingInboxPage, { tab: "responded" })
    expect(replied).toMatch(/<ul aria-label="Replied inquiries"/)
    expect(textOf(replied)).toContain("Waiting for the hauler")
  })

  it("posts replies as decision=replied with a server reply id, and offers Mark reviewed while new", async () => {
    const html = await renderPage(LandingInboxPage)
    const composer = formAround(html, "Reply to Example Hauling LLC")
    const reviewed = formAround(html, "Mark reviewed")

    expect(hidden(composer, "decision", "replied")).toBe(true)
    expect(hidden(composer, "interestId", FIRST)).toBe(true)
    expect(composer).toMatch(/name="replyId"/)
    expect(hidden(reviewed, "decision", "viewed")).toBe(true)
    expect(textOf(html)).toContain("Offers 2 trucks Self-reported by the hauler; not verified")
    expect(textOf(html)).toContain("Contact LogLoads messages")
    expect(await renderPage(LandingInboxPage, { inquiry: SECOND })).not.toContain("Mark reviewed")
  })

  it("confirms Decline: a Dialog with scripts, the same confirmation in the page without", async () => {
    const html = await renderPage(LandingInboxPage)

    expect(html.match(/<a[^>]*aria-haspopup="dialog"[^>]*>/)?.[0]).toContain(`href="/v2/landing/inquiries?inquiry=${FIRST}&amp;confirm=decline#confirm-action"`)
    // Declining never happens straight from the trigger: no form posts decision=declined until it is confirmed.
    expect(formAround(html, 'value="declined"')).toBe("")

    const confirming = await renderPage(LandingInboxPage, { confirm: "decline", inquiry: FIRST })
    const form = formAround(confirming, 'value="declined"')

    expect(textOf(confirming)).toContain("Decline this inquiry? Example Hauling LLC will see that you declined")
    expect(hidden(form, "interestId", FIRST)).toBe(true)
    expect(form).toMatch(/<button[^>]*data-variant="danger"[^>]*type="submit"/)
  })

  it("offers an optional reason with a decline, posted with the form and a server reply id (UX-09 criterion 5)", async () => {
    const confirming = await renderPage(LandingInboxPage, { confirm: "decline", inquiry: FIRST })
    const form = formAround(confirming, 'value="declined"')
    const formId = form.match(/<form[^>]*id="([^"]+)"/)?.[1]
    const reason = openingTagOf(confirming, /<textarea[^>]*name="body"[^>]*>/)

    expect(formId).toBe("confirm-action-form")
    expect(reason).toContain('form="confirm-action-form"')
    expect(reason).toContain('maxLength="2000"')
    expect(reason).not.toContain("required")
    expect(textOf(confirming)).toContain("Reason (optional) The hauler sees this as your last message")
    expect(form).toMatch(/name="replyId"[^>]*value="[0-9a-f-]{36}"|value="[0-9a-f-]{36}"[^>]*name="replyId"/)
    expect(form).not.toMatch(/name="(organizationId|userId|actorUserId)"/)
  })

  it("says when nothing has arrived, with nothing to switch or filter, and never shares private landing details", async () => {
    mocks.listLandingInterests.mockResolvedValueOnce([])
    const empty = await renderPage(LandingInboxPage)

    expect(empty).toContain('data-layout="single"')
    expect(textOf(empty)).toContain("New 0 inquiries No new interest.")
    expect(empty).not.toContain('aria-label="Inquiries by queue"')
    expect(empty).not.toContain('role="search"')
    expect(mocks.landingInquiryJobs).not.toHaveBeenCalled()

    // The composer only carries what the landing writes; nothing in the page offers to share access details.
    expect(await renderPage(LandingInboxPage)).not.toMatch(/gate|access instructions|exact location/i)
  })
})

describe("inquiry conversations (UX-09, #132)", () => {
  const LANDING_ID = "77777777-ffff-4fff-8fff-777777777777"
  const OTHER_JOB = "88888888-8888-4888-8888-888888888888"
  const THIRD = "99999999-aaaa-4aaa-8aaa-999999999999"
  const landingReply = (minute: number) => ({
    authorName: "Dana Dispatch",
    authorSide: "landing" as const,
    authorUserId: "77777777-7777-4777-8777-777777777777",
    body: `Landing message ${minute}`,
    createdAt: new Date(Date.UTC(2026, 10, 2, 18, minute)).toISOString(),
    id: `00000000-0000-4000-8000-${String(minute).padStart(12, "0")}`
  })
  const haulerReply = (minute: number) => ({
    ...landingReply(minute),
    authorName: "Sam Hauler",
    authorSide: "hauler" as const,
    authorUserId: USER_ID,
    body: `Hauler message ${minute}`
  })
  const newRows = (html: string) => html.match(/<ul aria-label="New inquiries"[\s\S]*?<\/ul>/)?.[0] ?? ""

  describe("My inquiries", () => {
    beforeEach(() => {
      mocks.listHaulerInterests.mockResolvedValue([
        interest(),
        interest({ id: SECOND, replies: [landingReply(1)], status: "replied" }),
        interest({ id: THIRD, replies: [landingReply(1), haulerReply(2)], status: "replied" })
      ])
    })

    it("has Active, Replied and Closed tabs with counts, as links that work without JavaScript", async () => {
      const html = await renderPage(MyInquiriesPage)

      expect(tabs(html, "Inquiries by status")).toEqual([
        ["/v2/inquiries", "Active 1", true],
        ["/v2/inquiries?tab=replied", "Replied 2", false],
        ["/v2/inquiries?tab=closed", "Closed 0", false]
      ])
      expect(textOf(html)).toContain("1 active inquiry")

      const closed = await renderPage(MyInquiriesPage, { tab: "closed" })
      expect(textOf(closed)).toContain("Closed No closed inquiries.")
      expect(closed).toContain('data-layout="single"')
    })

    it("says on each row whose turn it is", async () => {
      const replied = textOf(await renderPage(MyInquiriesPage, { tab: "replied" }))

      expect(replied).toContain("Your turn")
      expect(replied).toContain("Waiting for the landing")
      expect(textOf(await renderPage(MyInquiriesPage))).toContain("Sent · waiting for the landing")
    })

    it("opens a selected inquiry on its own tab, so a reply or a withdrawal comes back to it", async () => {
      const html = await renderPage(MyInquiriesPage, { inquiry: SECOND, updated: "reply" })

      expect(tabs(html, "Inquiries by status").find(([, , current]) => current)?.[1]).toBe("Replied 2")
      expect(html.match(/<a[^>]*aria-current="true"[^>]*>/g)).toEqual([expect.stringContaining(`inquiry=${SECOND}`)])
    })

    it("aligns messages by side, names the sender and gives each a time; the reply field is multi-line", async () => {
      const html = await renderPage(MyInquiriesPage, { inquiry: THIRD })

      expect([...html.matchAll(/data-side="(me|them)"/g)].map((match) => match[1])).toEqual(["me", "them", "me"])
      expect(textOf(html)).toContain("Landing message 1 Dana Dispatch · Nov 2, 2026, 6:01 PM UTC")
      expect(textOf(html)).toContain("Hauler message 2 You · Nov 2, 2026, 6:02 PM UTC")
      expect(html).toContain('dateTime="2026-11-02T18:01:00.000Z"')
      expect(openingTagOf(html, /<textarea[^>]*aria-label="Reply to Example Timber Co"[^>]*>/)).toMatch(/rows="3"/)
    })

    it("offers an optional reason with a withdrawal, in the Dialog and in the page (UX-09 criterion 5)", async () => {
      const confirming = await renderPage(MyInquiriesPage, { confirm: "withdraw", inquiry: FIRST })
      const form = formAround(confirming, "Withdraw interest</span></button>")
      const reason = openingTagOf(confirming, /<textarea[^>]*name="reason"[^>]*>/)

      expect(form).toMatch(/<form[^>]*id="confirm-action-form"/)
      expect(reason).toContain('form="confirm-action-form"')
      expect(reason).not.toContain("required")
      expect(textOf(confirming)).toContain("Reason (optional) The landing sees this as your last message")
      expect(form).toMatch(/name="replyId"/)
      expect(hidden(form, "interestId", FIRST)).toBe(true)
    })
  })

  describe("the landing inbox", () => {
    beforeEach(() => {
      mocks.resolveV2Actor.mockResolvedValue({ actor: actorFor(LANDING_ORG), ok: true })
      mocks.listLandingInterests.mockResolvedValue([
        interest({ equipment: [{ configurationKey: "log_truck|pole_trailer", count: 2, label: "Log truck + Pole trailer" }] }),
        interest({ haulerOrganization: { id: HAULER_ORG, name: "Second Hauling", type: "hauler" }, id: SECOND, status: "viewed" }),
        interest({
          equipment: [{ configurationKey: "chip_truck|chip_van", count: 1, label: "Chip truck + Chip van" }],
          haulerOrganization: { id: HAULER_ORG, name: "Third Hauling", type: "hauler" },
          id: THIRD,
          job: { acceptingInterest: true, id: OTHER_JOB, slug: OTHER_JOB, status: "active", title: "Pulp to the board plant" },
          replies: [landingReply(1), haulerReply(2)],
          status: "replied",
          trucksOffered: 1
        })
      ])
      mocks.landingInquiryJobs.mockResolvedValue([
        { equipmentCodes: ["log_truck", "pole_trailer"], jobId: JOB_ID, landing: { id: LANDING_ID, name: "Upper Spur Landing" } },
        { equipmentCodes: ["log_truck"], jobId: OTHER_JOB, landing: { id: LANDING_ID, name: "Upper Spur Landing" } }
      ])
    })

    it("keeps a reviewed inquiry in New with a Seen marker, and a hauler's answer back in New (UX-DEC-01)", async () => {
      const html = await renderPage(LandingInboxPage)

      expect(tabs(html, "Inquiries by queue").map(([, label]) => label)).toEqual(["New 3", "Replied 0", "Closed 0"])
      expect(textOf(newRows(html))).toContain("Seen · not answered")
      expect(textOf(newRows(html))).toContain("Hauler replied")
      expect(newRows(html).match(/data-seen=""/g)).toHaveLength(1)

      // "Mark reviewed" is offered only while the inquiry is unreviewed.
      expect(await renderPage(LandingInboxPage, { inquiry: FIRST })).toContain("Mark reviewed")
      expect(await renderPage(LandingInboxPage, { inquiry: SECOND })).not.toContain("Mark reviewed")
    })

    it("compares each offered configuration with the job's equipment, labelled self-reported (UX-09 criterion 4)", async () => {
      const matches = textOf(await renderPage(LandingInboxPage, { inquiry: FIRST }))
      const other = textOf(await renderPage(LandingInboxPage, { inquiry: THIRD }))

      expect(matches).toContain("Equipment 2 × Log truck + Pole trailer ✓ matches Self-reported by the hauler; compared with this job’s equipment")
      expect(other).toContain("Equipment 1 × Chip truck + Chip van not requested Self-reported by the hauler")

      // Without a comparable equipment list (the pilot store) the lines are shown without a verdict.
      mocks.landingInquiryJobs.mockResolvedValue([{ equipmentCodes: null, jobId: JOB_ID, landing: null }])
      const unknown = textOf(await renderPage(LandingInboxPage, { inquiry: FIRST }))
      expect(unknown).toContain("Equipment 2 × Log truck + Pole trailer Self-reported by the hauler")
      expect(unknown).not.toMatch(/✓ matches|not requested/)
    })

    it("filters by job and landing with a GET form, and the tabs and rows keep the filter", async () => {
      const html = await renderPage(LandingInboxPage)
      const form = html.match(/<form[^>]*role="search"[\s\S]*?<\/form>/)?.[0] ?? ""

      expect(openingTagOf(form, /<form[^>]*>/)).toMatch(/action="\/v2\/landing\/inquiries"[^>]*method="get"/)
      expect(textOf(form)).toContain("Job All jobs Pulp to the board plant · Upper Spur Landing Saw logs to the river mill · Upper Spur Landing")
      expect(textOf(form)).toContain("Landing All landings Upper Spur Landing")

      const filtered = await renderPage(LandingInboxPage, { job: OTHER_JOB })
      expect(tabs(filtered, "Inquiries by queue")[1]?.[0]).toBe(`/v2/landing/inquiries?tab=responded&job=${OTHER_JOB}`)
      expect(newRows(filtered)).toContain(`?inquiry=${THIRD}&amp;job=${OTHER_JOB}#conversation`)
      expect(textOf(filtered)).toContain("New 1 inquiry")
      expect(filtered).toContain('href="/v2/landing/inquiries"')

      // Without landings from the store there is no landing filter; the inbox still works.
      mocks.landingInquiryJobs.mockRejectedValue(new Error("unavailable"))
      const plain = await renderPage(LandingInboxPage)
      expect(plain).not.toContain('name="landing"')
      expect(plain).toContain('name="job"')
    })

    it("refuses another business's inbox: nothing of it is listed", async () => {
      mocks.listLandingInterests.mockRejectedValueOnce(new Error("Inquiry not found"))
      const html = await renderPage(LandingInboxPage)

      expect(textOf(html)).toContain("Your role in this business cannot review hauler inquiries.")
      expect(html).not.toContain("Example Hauling LLC")
      expect(html).not.toContain('role="search"')
      expect(mocks.landingInquiryJobs).not.toHaveBeenCalled()
    })
  })
})

describe("/v2/switch, /v2/start and the V2 not-found page", () => {
  it("builds /v2/switch from the design system", async () => {
    mocks.resolveV2Actor.mockResolvedValueOnce({
      actor: {
        activeOrganization: { id: HAULER_ORG },
        memberships: [
          { membership: { role: "owner" }, organization: { displayName: "Example Hauling LLC", id: HAULER_ORG, type: "carrier" } },
          { membership: { role: "dispatcher" }, organization: { displayName: "Example Timber Co", id: LANDING_ORG, type: "logging_company" } }
        ],
        profile: { id: USER_ID },
        workspaceSelectionInvalid: false
      },
      ok: true
    })
    const html = await renderPage(SwitchBusinessPage)

    expect(html).toContain('data-ds-page="switch-business"')
    expect(html).toMatch(/<h1[^>]*>Switch business<\/h1>/)
    expect(textOf(html)).toContain("Acting as this business")
    expect(hidden(formAround(html, "Act as Example Timber Co"), "organizationId", LANDING_ORG)).toBe(true)
  })

  it("builds /v2/start and the not-found page from the design system", async () => {
    const start = renderToStaticMarkup(await StartPage({}))
    const missing = renderToStaticMarkup(<MarketplaceV2NotFound />)

    expect(start).toContain('data-ds-page="start"')
    expect(start).toContain('href="/v2/work"')
    expect(missing).toContain('data-ds-page="not-found"')
    expect(missing).toMatch(/<h1[^>]*>This page is not available<\/h1>/)
  })
})

describe("v2.css is retired", () => {
  const webRoot = fileURLToPath(new URL("../../", import.meta.url))
  const files = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? files(path) : /\.(tsx?|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
    })

  it("has no stylesheet, and no V2 source uses its class names", () => {
    const sources = ["app/v2", "components/v2"].flatMap((root) => files(join(webRoot, root)))

    expect(sources.some((path) => path.endsWith("v2.css"))).toBe(false)
    for (const path of sources) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(/className="v2-|className={`v2-|import "\.\/v2\.css"/)
    }
  })
})

describe("both inquiry pages show fixed copy for ?error=, never its words (#279, C2)", () => {
  const PHISHING = "Your account is locked. Call 541-555-0100 to keep your listings."

  it.each([
    ["My inquiries", MyInquiriesPage, "hauler"],
    ["the landing inbox", LandingInboxPage, "landing"]
  ] as const)("%s", async (_label, page, side) => {
    mocks.resolveV2Actor.mockResolvedValue({ actor: actorFor(side === "hauler" ? HAULER_ORG : LANDING_ORG), ok: true })
    mocks.listHaulerInterests.mockResolvedValue([interest()])
    mocks.listLandingInterests.mockResolvedValue([interest()])

    const injected = await renderPage(page, { error: PHISHING, inquiry: FIRST })
    expect(injected).not.toContain("541-555-0100")
    expect(injected).toMatch(/role="alert"[^>]*>Something went wrong on our side\. Try again in a moment\.</)

    expect(await renderPage(page, { error: "inquiry_closed", inquiry: FIRST })).toMatch(/role="alert"[^>]*>This inquiry is closed\. Nothing more can be sent on it\.</)
  })

  it("names a failed list read by fixed copy and a reference, never by the error's words (#279, C3)", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
    mocks.listHaulerInterests.mockRejectedValueOnce(new TypeError("Cannot read properties of undefined (reading 'maya@northpine.example')"))

    const text = textOf(await renderPage(MyInquiriesPage))

    expect(text).toMatch(/Something went wrong on our side\. Try again in a moment\. Reference: [0-9a-f]{12}\./)
    expect(text).not.toContain("maya@northpine.example")
    expect(logged).toHaveBeenCalledOnce()
    logged.mockRestore()
  })
})
