import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Find work (UX-06, #129), rendered on the server exactly as a first visit, or a visit without JavaScript, receives
 * it. The port and the session are stubbed; the page's own search, fit and distance rules run for real, and so does
 * the keyset paging both adapters use (`keyset-pages.ts`, #280) over the stubbed board.
 */

const mocks = vi.hoisted(() => ({
  getJob: vi.fn(),
  getSessionActor: vi.fn(),
  haulerEquipment: vi.fn(),
  listHaulerInterests: vi.fn(),
  listJobPage: vi.fn(),
  listJobs: vi.fn(),
  mapPoints: vi.fn(),
  viewerAccess: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  }
}))
vi.mock("@/components/v2/JobMapLoader", () => ({
  JobMapLoader: ({ points }: { points: unknown[] }) => {
    mocks.mapPoints(points)
    return React.createElement("div", { "data-map": "" })
  }
}))
vi.mock("@/lib/marketplace-v2/flag", () => ({ marketplaceV2Enabled: () => true }))
vi.mock("@/lib/session", () => ({ getSessionActor: mocks.getSessionActor }))
vi.mock("@/lib/marketplace-v2/pilot-adapter", () => ({
  pilotMarketplaceV2: {
    getJob: mocks.getJob,
    haulerEquipment: mocks.haulerEquipment,
    listHaulerInterests: mocks.listHaulerInterests,
    listJobPage: mocks.listJobPage,
    listJobs: mocks.listJobs,
    viewerAccess: mocks.viewerAccess
  }
}))

import { sortMarketplaceJobs, type MarketplaceJobDetailView, type MarketplaceJobFilters } from "@logloads/contracts"

import FindWorkPage from "@/app/v2/work/page"
import { FindWorkResults } from "@/components/v2/discovery/FindWorkResults"
import { marketplaceJobPage } from "@/lib/marketplace-v2/keyset-pages"
import type { MarketplacePageRequest } from "@/lib/marketplace-v2/port"

const HAULER_ORG = "33333333-bbbb-4bbb-8bbb-333333333333"
const LANDING_ORG = "22222222-aaaa-4aaa-8aaa-222222222222"
const USER_ID = "55555555-dddd-4ddd-8ddd-555555555555"
const SAW = "11111111-1111-4111-8111-111111111111"
const CHIPS = "66666666-6666-4666-8666-666666666666"
const OWN = "77777777-7777-4777-8777-777777777777"

function job(overrides: Partial<MarketplaceJobDetailView> = {}): MarketplaceJobDetailView {
  return {
    acceptingInterest: true,
    destinationLabel: "Example mill · Springfield, OR",
    endsOn: null,
    equipment: ["log_truck", "pole_trailer"],
    estimatedDailyLoads: null,
    estimatedLoadsPerTruckPerDay: null,
    estimatedTonsPerLoad: null,
    expiresAt: null,
    haulDistance: null,
    id: SAW,
    lastConfirmedAt: null,
    lastModifiedAt: "2026-11-01T09:00:00.000Z",
    origin: { approximatePoint: { lat: 43.7, lng: -122.5 }, label: "Oakridge, OR", stateCode: "OR" },
    pay: { amountCents: 52_500, note: null, unit: "per_load" },
    posterName: "Example Timber Co",
    posterOrganizationId: LANDING_ORG,
    posterVerification: null,
    product: "Saw logs",
    publicAccessRequirements: [],
    publicRoadNotes: null,
    scheduleNote: null,
    slug: SAW,
    sponsored: false,
    startsOn: "2026-11-10",
    status: "active",
    title: "Saw logs to the river mill",
    trucks: { perDay: 3, total: null },
    ...overrides
  }
}

const saw = job()
const chips = job({ equipment: ["chip_truck", "chip_van"], id: CHIPS, pay: { amountCents: 900, note: null, unit: "per_ton" }, slug: CHIPS, title: "Chip shuttle" })
const own = job({ id: OWN, posterOrganizationId: HAULER_ORG, slug: OWN, title: "Our own landing's job" })

/**
 * The board the stubbed store holds: `jobs` already in the adapter's discovery order, and whether its one read held
 * every match. The store pages it exactly as both adapters do.
 */
let board: { jobs: MarketplaceJobDetailView[]; exact: boolean } = { exact: true, jobs: [] }

function showJobs(jobs: MarketplaceJobDetailView[], exact = true) {
  board = { exact, jobs }
}

/** The page request a first visit sends. */
const PAGE_ONE = { after: null, limit: 25 }

type Query = Record<string, string>

async function render(query: Query = {}) {
  return renderToStaticMarkup(await FindWorkPage({ searchParams: Promise.resolve(query) }))
}

const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, `"`).replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim()

/** The `<li>` of the job row whose title is `title`. */
function rowOf(html: string, title: string): string {
  return [...html.matchAll(/<li\b[\s\S]*?<\/li>/g)].map((match) => match[0]).find((row) => row.includes(`>${title}</a>`)) ?? ""
}

function signInAsHauler() {
  mocks.getSessionActor.mockResolvedValue({ activeOrganization: { id: HAULER_ORG }, memberships: [], profile: { id: USER_ID }, workspaceSelectionInvalid: false })
  mocks.viewerAccess.mockResolvedValue({ capabilities: ["interest.express", "interest.withdraw", "interest.reply"], organizationName: "Example Hauling LLC" })
  mocks.haulerEquipment.mockResolvedValue([
    { configurationKey: "log_truck|pole_trailer", equipmentCodes: ["log_truck", "pole_trailer"], label: "Log truck + Pole trailer", unitsListed: 2 }
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
  // The app compiles JSX with the classic runtime under Vitest (tsconfig "jsx": "preserve"), as in v2-pages.test.tsx.
  vi.stubGlobal("React", React)
  mocks.getSessionActor.mockResolvedValue(null)
  showJobs([saw, chips])
  mocks.listJobPage.mockImplementation(async (filters: MarketplaceJobFilters, page?: MarketplacePageRequest) =>
    marketplaceJobPage(board.jobs, filters, page, { exact: board.exact }))
  mocks.listHaulerInterests.mockResolvedValue([])
})

describe("the summary bar and its filter form (criterion 1)", () => {
  it("states the search as text and, before scripts run, opens the same fields as a plain GET form", async () => {
    const html = await render()

    const summary = /<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>/.exec(html)?.[1] ?? ""
    // The bar's accessible name is its visible text (WCAG 2.5.3).
    expect(textOf(summary)).toBe("Anywhere Any equipment · Any pay basis Change")
    expect(summary).not.toContain("aria-label")
    const form = /<form\b[^>]*action="\/v2\/work"[^>]*>[\s\S]*?<\/form>/.exec(html)?.[0] ?? ""
    expect(form).not.toContain('method="post"')
    for (const name of ["near", "radius", "equipment", "product", "pay", "start", "q", "all"]) {
      expect(form, name).toMatch(new RegExp(`name="${name}"`))
    }
    expect(textOf(form)).toContain("Apply")
    expect(form).toMatch(/<a[^>]*href="\/v2\/work"[^>]*>[\s\S]*?Reset/)
  })

  it("offers 50, 100, 150 and 250+ miles, the controlled products and the equipment taxonomy in groups", async () => {
    const form = textOf(await render())

    expect(form).toContain("50 mi 100 mi 150 mi 250+ mi")
    expect(form).toContain("Saw logs Pulpwood Poles and pilings Chips Hog fuel and biomass Hardwood logs Other")
    const html = await render()
    expect(html).toMatch(/<optgroup label="Trucks">[\s\S]*Log truck[\s\S]*<optgroup label="Trailers">[\s\S]*Pole trailer[\s\S]*<optgroup label="Attachments">/)
    // A visitor has no trucks to match.
    expect(html).not.toContain('value="mine"')
  })

  it("names the place, radius and filters in the summary, and keeps the order and map view through the form", async () => {
    const html = await render({ near: "97386", pay: "per_ton", radius: "150", sort: "pay", start: "14", view: "map" })

    expect(textOf(html)).toContain("Near Sweet Home, OR · 150 mi")
    expect(textOf(html)).toContain("Any equipment · Per ton · Starting within 14 days")
    expect(html).toMatch(/<input[^>]*name="near"[^>]*value="Sweet Home, OR"/)
    expect(html).toMatch(/<input[^>]*name="sort"[^>]*value="pay"/)
    expect(html).toMatch(/<input[^>]*name="view"[^>]*value="map"/)
  })

  it("explains a place it doesn't know on the Location field instead of guessing one", async () => {
    const html = await render({ near: "Atlantis" })

    expect(html).toMatch(/aria-invalid="true"[^>]*name="near"|name="near"[^>]*aria-invalid="true"/)
    expect(textOf(html)).toContain(`We don't know "Atlantis" yet.`)
    expect(mocks.listJobPage).toHaveBeenCalledWith(expect.objectContaining({ near: null, radiusMiles: null }), PAGE_ONE)
  })
})

describe("rows, distance and fit", () => {
  it("lists every job as a plain link to its page, with equipment labels and never raw codes (criterion 3)", async () => {
    const html = await render()

    expect(rowOf(html, saw.title)).toContain(`href="/v2/work/${SAW}"`)
    expect(textOf(rowOf(html, saw.title))).toContain("Log truck, Pole trailer")
    expect(textOf(rowOf(html, chips.title))).toContain("Chip truck, Chip van")
    expect(textOf(html)).not.toMatch(/\b(log_truck|pole_trailer|chip_van)\b/)
  })

  it("measures distance from the typed place to the approximate public point only, labelled 'about' (criterion 5)", async () => {
    const html = await render({ near: "Sweet Home, OR" })

    expect(mocks.listJobPage).toHaveBeenCalledWith(expect.objectContaining({ near: { lat: 44.4, lng: -122.7 }, radiusMiles: 100 }), PAGE_ONE)
    expect(textOf(rowOf(html, saw.title))).toContain("About 49 mi from your search")
    expect(textOf(html)).toContain("Within 100 mi of Sweet Home, OR")
    // No coordinate is printed: not the search point, not a job's point (icons' SVG paths aside).
    const page = html.replace(/<svg\b[\s\S]*?<\/svg>/g, "")
    expect(page).not.toMatch(/\b4[2-6]\.\d|-1(1[6-9]|2[0-4])\.\d/)
  })

  it("shows a signed-in hauler 'My trucks' by default and an advisory fit chip, never on its own listing (criterion 7)", async () => {
    signInAsHauler()
    showJobs([saw, chips, own])
    const html = await render()

    expect(mocks.listJobPage).toHaveBeenCalledWith(expect.objectContaining({ equipment: null, equipmentSetups: [["log_truck", "pole_trailer"]] }), PAGE_ONE)
    expect(html).toMatch(/<option value="mine" selected="">My trucks \(1 setup\)<\/option>/)
    expect(textOf(html)).toContain("My trucks · Any pay basis")
    expect(textOf(rowOf(html, saw.title))).toContain("Fits your trucks")
    expect(textOf(rowOf(html, chips.title))).toContain("Not in your setups")
    expect(textOf(rowOf(html, own.title))).not.toMatch(/Fits your|Not in your setups/)
    expect(textOf(html)).not.toMatch(/qualified/i)
  })

  it("lets the hauler choose any equipment instead", async () => {
    signInAsHauler()
    await render({ equipment: "any" })
    expect(mocks.listJobPage).toHaveBeenCalledWith(expect.objectContaining({ equipment: null, equipmentSetups: null }), PAGE_ONE)
  })
})

describe("order (criterion 4)", () => {
  it("sorts in its own GET form, keeps the search, and offers nearest only with a place", async () => {
    const anywhere = await render({ pay: "per_load" })
    expect(anywhere).toMatch(/<option disabled="" value="nearest">Nearest \(add a location\)<\/option>/)

    const html = await render({ near: "Eugene", sort: "nearest" })
    const sortForm = /<form\b[^>]*aria-label="Sort jobs"[^>]*>[\s\S]*?<\/form>/.exec(html)?.[0] ?? ""
    expect(sortForm).toMatch(/<input[^>]*name="near"[^>]*value="Eugene, OR"/)
    expect(sortForm).toMatch(/<option value="nearest" selected="">Nearest<\/option>/)
    expect(textOf(sortForm)).toContain("Sort")
    expect(mocks.listJobPage).toHaveBeenCalledWith(expect.objectContaining({ sort: "nearest" }), PAGE_ONE)
  })

  it("says when pay sorting meets different bases, and compares within each basis only", async () => {
    const html = await render({ sort: "pay" })
    expect(textOf(html)).toContain("Rates use different bases (per load, per ton). Pay is sorted within each basis, never across them.")
    expect(mocks.listJobPage).toHaveBeenCalledWith(expect.objectContaining({ sort: "pay" }), PAGE_ONE)

    showJobs([saw])
    expect(textOf(await render({ sort: "pay" }))).not.toContain("Rates use different bases")
  })
})

describe("the empty state (criterion 6)", () => {
  it("names the active constraints and offers one-tap changes as plain links", async () => {
    showJobs([])
    const html = await render({ near: "Sweet Home", product: "Pulpwood" })
    const text = textOf(html)

    expect(text).toContain("No jobs within 100 mi of Sweet Home, OR match your search")
    expect(text).toContain("Your search: Any equipment · Pulpwood · Any pay basis · Accepting interest only.")
    expect(html).toMatch(/href="\/v2\/work\?near=Sweet\+Home%2C\+OR&amp;radius=150&amp;product=Pulpwood"[^>]*>[\s\S]*?Widen to 150 mi/)
    expect(html).toMatch(/href="\/v2\/work\?near=Sweet\+Home%2C\+OR"[^>]*>[\s\S]*?Any product/)
    expect(html).not.toContain('aria-label="Jobs"')
  })
})

describe("list and detail (06_DESIGN_SYSTEM.md §4–5)", () => {
  it("renders the selected job beside the list, marks its row current and links the row to the panel", async () => {
    const html = await render({ job: SAW })

    expect(html).toMatch(/data-layout="list-detail"[^>]*data-detail="open"|data-detail="open"[^>]*data-layout="list-detail"/)
    expect(html).toMatch(/<aside[^>]*aria-label="Job details"[^>]*id="find-work-detail"|<aside[^>]*id="find-work-detail"[^>]*aria-label="Job details"/)
    expect(rowOf(html, saw.title)).toMatch(/aria-controls="find-work-detail"[^>]*aria-current="true"/)
    expect(rowOf(html, chips.title)).not.toContain("aria-current")
    // The page's one read carries every listed job's public detail, so selecting another row needs no request (#280).
    expect(mocks.listJobPage).toHaveBeenCalledTimes(1)
    expect(mocks.getJob).not.toHaveBeenCalled()
  })

  it("ignores a selection that isn't in the results", async () => {
    const html = await render({ job: OWN })
    expect(html).toContain('data-detail="closed"')
    expect(html).not.toContain("<aside")
    expect(html).not.toContain('aria-current="true"')
  })

  it("offers interest from the panel only to a hauler who may express it, and not on its own job", async () => {
    signInAsHauler()
    showJobs([saw, own])

    expect(await render({ equipment: "any", job: SAW })).toContain(`href="/v2/work/${SAW}#interest"`)
    expect(await render({ equipment: "any", job: OWN })).not.toContain("#interest")
    expect(mocks.listHaulerInterests).toHaveBeenCalledWith({ organizationId: HAULER_ORG, userId: USER_ID })
  })

  it("says interest was sent instead of offering it again, until it is withdrawn", async () => {
    signInAsHauler()
    showJobs([saw])
    mocks.listHaulerInterests.mockResolvedValue([{ job: { id: SAW }, status: "submitted" }])
    const sent = await render({ equipment: "any", job: SAW })
    expect(textOf(sent)).toContain("Interest sent")
    expect(sent).not.toContain("#interest")

    mocks.listHaulerInterests.mockResolvedValue([{ job: { id: SAW }, status: "withdrawn" }])
    expect(await render({ equipment: "any", job: SAW })).toContain(`href="/v2/work/${SAW}#interest"`)
  })
})

/** `count` jobs in discovery order (newest first), each with its own title. */
function boardOf(count: number): MarketplaceJobDetailView[] {
  return sortMarketplaceJobs(Array.from({ length: count }, (_, index) => {
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
    return job({ id, lastModifiedAt: new Date(Date.UTC(2026, 10, 1, 0, count - index)).toISOString(), slug: id, title: `Job ${String(index + 1).padStart(2, "0")}` })
  }))
}

/** The titles of the listed rows, in order. */
function titlesOf(html: string): string[] {
  const list = /<ul aria-label="Jobs"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? ""
  return [...list.matchAll(/<h3\b[^>]*>\s*<a\b[^>]*>([^<]*)<\/a>/g)].map((match) => match[1] ?? "")
}

/** The href of the link that names `label`, or null. */
function linkHref(html: string, label: string): string | null {
  const match = new RegExp(`<a\\b[^>]*href="([^"]*)"[^>]*>(?:(?!</a>)[\\s\\S])*?${label}`).exec(html)
  return match?.[1] ? match[1].replace(/&amp;/g, "&") : null
}

const queryOf = (href: string): Query => Object.fromEntries(new URL(href, "https://logloads.test").searchParams)

describe("pages of results (#280)", () => {
  it("makes one store read per view, the same for one job or sixty, and never reads a job on its own", async () => {
    async function callsFor(count: number) {
      vi.clearAllMocks()
      signInAsHauler()
      showJobs(boardOf(count))
      await render({ equipment: "any" })
      return Object.fromEntries((["getJob", "haulerEquipment", "listHaulerInterests", "listJobPage", "listJobs", "viewerAccess"] as const)
        .map((name) => [name, mocks[name].mock.calls.length]))
    }

    const one = await callsFor(1)
    expect(one).toEqual({ getJob: 0, haulerEquipment: 1, listHaulerInterests: 1, listJobPage: 1, listJobs: 0, viewerAccess: 1 })
    expect(await callsFor(60)).toEqual(one)
  })

  it("shows 25 jobs at a time, and 'Show more jobs' opens the next ones of the same search, never repeating or skipping one", async () => {
    const all = boardOf(60)
    showJobs(all)

    const first = await render()
    expect(titlesOf(first)).toEqual(all.slice(0, 25).map((item) => item.title))
    expect(textOf(first)).toContain("60 jobs")
    expect(textOf(first)).toContain("Jobs 1 to 25 of 60")
    expect(linkHref(first, "Back to the first jobs")).toBeNull()
    const more = linkHref(first, "Show more jobs")
    expect(more).toMatch(/^\/v2\/work\?after=[A-Za-z0-9_-]+$/)

    const second = await render(queryOf(more!))
    expect(titlesOf(second)).toEqual(all.slice(25, 50).map((item) => item.title))
    expect(textOf(second)).toContain("Jobs 26 to 50 of 60")
    expect(linkHref(second, "Back to the first jobs")).toBe("/v2/work")

    const third = await render(queryOf(linkHref(second, "Show more jobs")!))
    expect(titlesOf(third)).toEqual(all.slice(50).map((item) => item.title))
    expect(textOf(third)).toContain("Jobs 51 to 60 of 60")
    expect(linkHref(third, "Show more jobs")).toBeNull()
  })

  it("keeps its place when a job is posted or the page's last job closes between pages", async () => {
    const all = boardOf(60)
    showJobs(all)
    const more = linkHref(await render(), "Show more jobs")!

    const fresh = job({ id: "00000000-0000-4000-8000-000000000999", lastConfirmedAt: "2026-12-01T00:00:00.000Z", slug: "fresh", title: "Brand new job" })
    showJobs([fresh, ...all.filter((item) => item.id !== all[24]?.id)])
    const second = await render(queryOf(more))

    expect(titlesOf(second)).toEqual(all.slice(25, 50).map((item) => item.title))
    expect(titlesOf(second)).not.toContain("Brand new job")
  })

  it("keeps the page through selecting a job, closing it and the map, and starts any new search from its first jobs", async () => {
    showJobs(boardOf(60))
    const { after } = queryOf(linkHref(await render(), "Show more jobs")!)

    const tree = await FindWorkPage({ searchParams: Promise.resolve({ after: after! }) })
    const results = findProps<{ closeHref: string; rows: Array<{ selectHref: string }> }>(tree, FindWorkResults)
    expect(results?.rows[0]?.selectHref).toMatch(new RegExp(`^/v2/work\\?after=${after}&job=`))
    expect(results?.closeHref).toBe(`/v2/work?after=${after}`)

    const html = renderToStaticMarkup(tree)
    expect(linkHref(html, "Show map")).toBe(`/v2/work?view=map&after=${after}`)
    // The filter form and the sort form start a new search, so neither carries the page.
    const forms = html.match(/<form\b[\s\S]*?<\/form>/g) ?? []
    expect(forms.length).toBeGreaterThanOrEqual(2)
    for (const form of forms) expect(form).not.toContain('name="after"')
  })

  it("says 30+ when the store stopped reading at its limit, and never shows the cut list as the total", async () => {
    showJobs(boardOf(30), false)

    const first = await render()
    expect(textOf(first)).toContain("30+ jobs")
    expect(textOf(first)).not.toMatch(/\b30 jobs\b/)
    expect(textOf(first)).toContain("Jobs 1 to 25 of 30+")

    const last = await render(queryOf(linkHref(first, "Show more jobs")!))
    expect(linkHref(last, "Show more jobs")).toBeNull()
    expect(textOf(last)).toContain("These are the matches among the most recent listings.")

    showJobs([], false)
    const none = textOf(await render())
    expect(none).toContain("No recent jobs match your search")
    expect(none).toContain("older ones might")
    expect(none).not.toContain("No jobs match your search")
  })

  it("starts again from the first jobs, and says why, when a link's page was made for another search", async () => {
    showJobs(boardOf(60))
    const { after } = queryOf(linkHref(await render({ sort: "pay" }), "Show more jobs")!)

    const html = await render({ after: after! })
    expect(titlesOf(html)).toEqual(boardOf(60).slice(0, 25).map((item) => item.title))
    expect(textOf(html)).toContain("The list changed since that link was made, so it starts again from the first jobs.")

    // A cursor that isn't one is never sent to the store.
    await render({ after: "not a cursor!" })
    expect(mocks.listJobPage).toHaveBeenLastCalledWith(expect.anything(), PAGE_ONE)
  })

  it("says so, with a way back, when every job after a link's page has closed", async () => {
    const all = boardOf(30)
    showJobs(all)
    const more = linkHref(await render(), "Show more jobs")!

    showJobs(all.slice(0, 25))
    const html = await render(queryOf(more))
    expect(textOf(html)).toContain("No more jobs in this list")
    expect(textOf(html)).toContain("25 jobs")
    expect(linkHref(html, "Back to the first jobs")).toBe("/v2/work")
  })

  it("puts this page's jobs on the map, the same ones as the list", async () => {
    showJobs(boardOf(60))
    await render({ view: "map" })

    expect(mocks.mapPoints).toHaveBeenCalledTimes(1)
    expect(mocks.mapPoints.mock.calls[0]?.[0]).toHaveLength(25)
  })
})

describe("what reaches the browser (#130, from the #185 review)", () => {
  it("hands the client list the public view of each job, without the poster's organization id", async () => {
    signInAsHauler()
    showJobs([saw, own])

    const page = await FindWorkPage({ searchParams: Promise.resolve({ equipment: "any", job: SAW }) })
    const results = findProps<{ rows: Array<{ job: Record<string, unknown> }> }>(page, FindWorkResults)

    expect(results?.rows.map((row) => row.job.id)).toEqual([SAW, OWN])
    for (const row of results?.rows ?? []) expect(Object.keys(row.job)).not.toContain("posterOrganizationId")
    expect(JSON.stringify(results?.rows)).not.toContain(LANDING_ORG)
    expect(JSON.stringify(results?.rows)).not.toContain(HAULER_ORG)
    // The own-job rule still holds: it is decided on the server before the id is dropped.
    expect(results?.rows.find((row) => row.job.id === OWN)).toMatchObject({ canExpressInterest: false })
  })
})

/** The props of the first element of `type` in a server tree, looking through element props (e.g. `actions`). */
function findProps<P>(node: unknown, type: unknown): P | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findProps<P>(child, type)
      if (found) return found
    }
    return undefined
  }
  if (!React.isValidElement(node)) return undefined
  if (node.type === type) return node.props as P
  for (const value of Object.values(node.props as Record<string, unknown>)) {
    const found = findProps<P>(value, type)
    if (found) return found
  }
  return undefined
}
