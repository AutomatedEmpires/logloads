import { readFileSync } from "node:fs"

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { MARKETPLACE_JOB_UNCONFIRMED_LABEL, MARKETPLACE_PRODUCTS, validateMarketplaceJobDraft } from "@logloads/contracts"

import { createNormalizedMarketplaceV2 } from "./normalized-adapter"
import type {
  LandingStatementName,
  MarketplaceCalls,
  MarketplaceDb,
  MarketplaceFunctionName,
  MarketplaceInquiryParties,
  MarketplacePrincipal,
  StoredListingReport
} from "./normalized-db"
import { MarketplaceRefusalError, MarketplaceStoreError, type MarketplaceV2Viewer } from "./port"

/**
 * The normalized adapter over a recording fake of the store. Proves what the adapter itself adds on top of the
 * database's checks: identity from the injected session resolver, anonymous discovery, the active-business binding
 * for every write, the attestation rules, and input validation before anything reaches the store. The database's
 * own behaviour is proven against PostgreSQL 17 by `normalized-adapter.contract.test.ts` in CI.
 */

const NOW = new Date("2026-11-03T12:00:00.000Z")
const LAND = "33333333-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const HAUL = "44444444-cccc-4ccc-8ccc-cccccccccccc"
const OTHER = "88888888-cccc-4ccc-8ccc-cccccccccccc"
const USER = "55555555-dddd-4ddd-8ddd-dddddddddddd"
const JOB = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const INTEREST = "66666666-eeee-4eee-8eee-eeeeeeeeeeee"
const LANDING = "77777777-ffff-4fff-8fff-ffffffffffff"
const REPLY = "99999999-dddd-4ddd-8ddd-dddddddddddd"
const REPORT = "22222222-eeee-4eee-8eee-eeeeeeeeeeee"
const PRINCIPAL: MarketplacePrincipal = { audience: "logloads-test-audience", issuer: "https://clerk.logloads.test", subject: "user_test_subject" }

const landingViewer: MarketplaceV2Viewer = { organizationId: LAND, userId: USER }
const haulerViewer: MarketplaceV2Viewer = { organizationId: HAUL, userId: USER }

interface Recorded { session: "anon" | "user"; principal?: MarketplacePrincipal; readOnly?: boolean; fn: string; args: Record<string, unknown> }

/** A listed job, confirmed an hour before NOW, so the day-14 rule (#321) keeps it on Find Work. */
function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    accepting_interest: true, destination_label: null, ends_on: null, equipment_codes: ["log_truck"], est_one_way_miles: null,
    estimated_daily_loads: null, estimated_loads_per_truck_per_day: null, estimated_tons_per_load: null, expires_at: null,
    job_id: JOB, last_confirmed_at: "2026-11-03T11:00:00+00:00", last_modified_at: "2026-11-03T11:00:00+00:00", origin_label: "Near Vida, OR",
    origin_lat: 44.2, origin_lng: -122.5, origin_state_code: "OR", pay_amount_cents: 9100, pay_note: null, pay_unit: "per_ton",
    poster_name: "Adapter Timber", poster_organization_id: LAND, poster_verified: false, product: "Saw logs",
    public_access_requirements: [], public_road_notes: null, schedule_note: null, slug: JOB, sponsored: false,
    starts_on: "2026-12-01", status: "active", title: "Adapter Sawlog Run", trucks_per_day: null, trucks_total: 3,
    ...overrides
  }
}

function interestRow(overrides: Record<string, unknown> = {}) {
  return {
    available_from: null, available_until: null, contact_preference: "in_app", created_at: "2026-11-03T11:00:00+00:00",
    equipment: [], hauler_org_id: HAUL, hauler_org_name: "Adapter Hauling", hauler_org_type: "fleet", id: INTEREST,
    job_accepting_interest: true, job_id: JOB, job_slug: JOB, job_status: "active", job_title: "Adapter Sawlog Run",
    landing_org_id: LAND, landing_org_name: "Adapter Timber", message: null, replies: [], status: "submitted",
    submitted_by_name: "Haul Owner", submitted_by_user_id: USER, trucks_offered: 2, updated_at: "2026-11-03T11:00:00+00:00",
    ...overrides
  }
}

/** What a function answers: fixed rows, or rows worked out from the arguments it was called with. */
type Response = unknown[] | ((args: Record<string, unknown>) => unknown[])

let recorded: Recorded[]
let responses: Partial<Record<MarketplaceFunctionName, Response>>
let parties: MarketplaceInquiryParties | null
/** Landing workspace statements (#127, #133), by name. */
let statements: Partial<Record<LandingStatementName, unknown[]>>
let inquiryJobs: unknown[]
let standingReport: StoredListingReport | null
let principal: ReturnType<typeof vi.fn>

function fakeDb(): MarketplaceDb {
  function calls(session: Recorded["session"], extra: Partial<Recorded>): MarketplaceCalls {
    return {
      async call(fn, args) {
        recorded.push({ ...extra, args: args as Record<string, unknown>, fn, session })
        const response = responses[fn]
        return typeof response === "function" ? response(args as Record<string, unknown>) : response ?? []
      },
      async inquiryParties() {
        recorded.push({ ...extra, args: {}, fn: "inquiryParties", session })
        return parties
      },
      async landingStatement(name, values) {
        recorded.push({ ...extra, args: { values: [...values] }, fn: `statement:${name}`, session })
        return statements[name] ?? []
      },
      async query(name, values) {
        recorded.push({ ...extra, args: { values }, fn: name, session })
        return []
      },
      async inquiryJobs(organizationId) {
        recorded.push({ ...extra, args: { organizationId }, fn: "inquiryJobs", session })
        return inquiryJobs
      },
      async viewerSession() {
        recorded.push({ ...extra, args: {}, fn: "viewerSession", session })
        return { memberships: [], person: null }
      },
      async standingListingReport(jobId) {
        recorded.push({ ...extra, args: { jobId }, fn: "standingListingReport", session })
        return standingReport
      },
      async fileListingReport(report) {
        recorded.push({ ...extra, args: report, fn: "fileListingReport", session })
        return { createdAt: "2026-11-03T12:00:00.123456+00:00", id: REPORT }
      }
    }
  }

  return {
    asAnon: (work) => work(calls("anon", {})),
    asUser: (identity, work, options) => work(calls("user", { principal: identity, readOnly: options?.readOnly !== false })),
    close: async () => undefined
  }
}

function adapter() {
  return createNormalizedMarketplaceV2({ db: fakeDb(), now: () => NOW, principal: principal as never })
}

/** Every argument of `list_marketplace_jobs_page` for a search with no filter: the first page of everything open. */
const JOB_PAGE_ARGS = {
  p_accepting_only: true, p_after: null, p_equipment: null, p_equipment_setups: null, p_lat: null, p_limit: 200, p_lng: null, p_org_id: null,
  p_pay_unit: null, p_product: null, p_product_excluded: null, p_query: null, p_radius_miles: null, p_sort: "newest", p_starts_by: null
}

/** The `page_cursor` stage 33 returns with a row: the sort, the five order keys as text, the title and the id. */
function jobCursor(row: Record<string, unknown>, sort = "newest") {
  return { i: row.job_id, k: ["0", "0", "0", "0", "-1762171200.123456"], s: sort, t: row.title }
}

/**
 * A stand-in for `list_marketplace_jobs_page` over `board`, which is already filtered and in the function's order:
 * rows after the cursor's job, at most `p_limit`, each with the whole search's count and its own cursor.
 */
function jobPages(board: ReadonlyArray<Record<string, unknown>>, sort = "newest") {
  return (args: Record<string, unknown>) => {
    const after = args.p_after as { i?: unknown } | null
    const start = after ? board.findIndex((row) => row.job_id === after.i) + 1 : 0
    return board.slice(start, start + (args.p_limit as number)).map((row) => ({ ...row, page_cursor: jobCursor(row, sort), total_count: board.length }))
  }
}

/** A stand-in for the paged `list_marketplace_interests` over `rows`, which are in the function's order for the side. */
function interestPages(rows: ReadonlyArray<Record<string, unknown>>) {
  return (args: Record<string, unknown>) => {
    const matching = rows.filter((row) => (!args.p_interest_id || row.id === args.p_interest_id) && (!args.p_job_id || row.job_id === args.p_job_id))
    const start = args.p_after_id ? matching.findIndex((row) => row.id === args.p_after_id) + 1 : 0
    return matching.slice(start, typeof args.p_limit === "number" ? start + args.p_limit : undefined)
  }
}

/** `count_marketplace_interests`: always the side's three tabs. */
function interestCounts(side: "hauler" | "landing", totals: [number, number, number]) {
  const queues = side === "hauler" ? ["active", "replied", "closed"] : ["new", "responded", "closed"]
  return queues.map((queue, index) => ({ queue, total: totals[index] }))
}

function storeCalls() {
  return recorded.filter((call) => call.fn !== "inquiryParties" && call.fn !== "inquiryJobs").map((call) => call.fn)
}

function publishDraft() {
  const result = validateMarketplaceJobDraft({
    durationDays: "10", equipment: ["log_truck"], landingId: LANDING, payAmount: "91", payUnit: "per_ton",
    product: "Saw logs", startsOn: "2026-12-01", title: "Adapter Sawlog Run", trucksRequested: "3"
  })
  if (!result.ok) throw new Error("fixture draft must be valid")
  return result.draft
}

const publishAttestation = { action: "publish" as const, confirmedAt: NOW.toISOString() }
const reconfirmAttestation = { action: "reconfirm" as const, confirmedAt: NOW.toISOString() }

beforeEach(() => {
  recorded = []
  responses = {}
  parties = { haulerOrganizationId: HAUL, jobId: JOB, jobOrganizationId: LAND }
  statements = {}
  inquiryJobs = []
  standingReport = null
  principal = vi.fn(async () => PRINCIPAL)
})

describe("normalized adapter: identity and discovery", () => {
  it("reports native publishing", () => {
    expect(adapter().supportsPublishing).toBe(true)
  })

  it("runs public discovery anonymously, with no identity", async () => {
    responses.list_marketplace_jobs_page = jobPages([jobRow()])
    responses.get_marketplace_job = [jobRow()]

    expect((await adapter().listJobs({ query: "saw" }))[0]?.id).toBe(JOB)
    expect((await adapter().getJob(JOB))?.title).toBe("Adapter Sawlog Run")
    expect(recorded.map((call) => call.session)).toEqual(["anon", "anon"])
    expect(principal).not.toHaveBeenCalled()
  })

  it("sends every discovery filter and the sort to the store, and filters and orders nothing itself (#185, #362)", async () => {
    const other = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaa2"
    // Rows no filter below would keep, in an order no sort below would give: the store's answer is the answer.
    responses.list_marketplace_jobs_page = jobPages([jobRow({ product: "Chips" }), jobRow({ job_id: other, origin_lat: null, origin_lng: null, pay_unit: "per_load", slug: other, starts_on: null })])

    const jobs = await adapter().listJobs({
      equipment: " log_truck ", equipmentSetups: [["log_truck", "pole_trailer"], []], near: { lat: 44.16, lng: -122.48 }, payUnit: "per_ton",
      product: " saw logs ", query: " sawlog ", radiusMiles: 49.6, sort: "nearest", startsBy: "2026-12-15"
    })

    expect(jobs.map((job) => job.id)).toEqual([JOB, other])
    expect(recorded).toEqual([{
      args: {
        ...JOB_PAGE_ARGS, p_equipment: "log_truck", p_equipment_setups: [["log_truck", "pole_trailer"], []], p_lat: 44.16, p_lng: -122.48,
        p_pay_unit: "per_ton", p_product: "saw logs", p_query: "sawlog", p_radius_miles: 50, p_sort: "nearest", p_starts_by: "2026-12-15"
      },
      fn: "list_marketplace_jobs_page",
      session: "anon"
    }])
    expect(storeCalls()).not.toContain("list_marketplace_jobs")
  })

  it("asks for 'Other' as every stated product outside the named list, and for the nearest only from a real place", async () => {
    await adapter().listJobs({ product: "other", sort: "nearest" })
    await adapter().listJobs({ near: { lat: 91, lng: -122.48 }, radiusMiles: 25, sort: "nearest" })
    await adapter().listJobs({ near: { lat: 44.16, lng: -122.48 }, radiusMiles: null, sort: "pay" })

    const named = MARKETPLACE_PRODUCTS.filter((product) => product !== "Other")
    expect(named.length).toBeGreaterThan(0)
    expect(recorded.map((call) => call.args)).toEqual([
      { ...JOB_PAGE_ARGS, p_product_excluded: named },
      // A place that is not on the map is no place: no distance filter, and nothing to be nearest to.
      JOB_PAGE_ARGS,
      { ...JOB_PAGE_ARGS, p_lat: 44.16, p_lng: -122.48, p_sort: "pay" }
    ])
  })

  it("asks the store for one business's own jobs, still anonymously, and asks nothing for a search that can match nothing (#209)", async () => {
    responses.list_marketplace_jobs_page = jobPages([jobRow()])

    expect((await adapter().listJobs({ acceptingOnly: false, posterOrganizationId: LAND })).map((job) => job.id)).toEqual([JOB])
    expect(recorded).toEqual([
      { args: { ...JOB_PAGE_ARGS, p_accepting_only: false, p_org_id: LAND }, fn: "list_marketplace_jobs_page", session: "anon" }
    ])
    expect(principal).not.toHaveBeenCalled()

    expect(await adapter().listJobs({ posterOrganizationId: "not-a-business" })).toEqual([])
    expect(await adapter().listJobs({ payUnit: "per_furlong" as never })).toEqual([])
    expect(await adapter().listJobs({ startsBy: "2026-02-31" })).toEqual([])
    expect(await adapter().listJobs({ startsBy: "next week" })).toEqual([])
    expect(recorded).toHaveLength(1)
  })

  it("reads one job as the session's person when there is one, so a job that stopped can still say why (#130)", async () => {
    responses.get_marketplace_job = [jobRow({ accepting_interest: false, status: "paused" })]

    expect((await adapter().getJob(JOB, haulerViewer))?.status).toBe("paused")
    expect(recorded).toEqual([{ args: { p_job_id: JOB }, fn: "get_marketplace_job", principal: PRINCIPAL, readOnly: true, session: "user" }])
  })

  it("falls back to the public view when the store refuses the person, and never hides a store failure", async () => {
    responses.get_marketplace_job = [jobRow()]
    principal.mockRejectedValueOnce(new MarketplaceRefusalError("Sign in again to continue."))

    expect((await adapter().getJob(JOB, haulerViewer))?.id).toBe(JOB)
    expect(recorded.map((call) => call.session)).toEqual(["anon"])

    principal.mockRejectedValueOnce(new Error("connection reset"))
    await expect(adapter().getJob(JOB, haulerViewer)).rejects.toThrow("connection reset")
  })

  it("answers not-found for an id that cannot exist, without asking the store", async () => {
    expect(await adapter().getJob("not-a-job")).toBeNull()
    expect(await adapter().interestForJob(haulerViewer, "../etc")).toBeNull()
    expect(recorded).toEqual([])
  })

  it("acts as the session's person for every signed-in call, read-only for reads", async () => {
    responses.get_viewer_marketplace_access = [{
      capabilities: ["job.publish"], hauler_profile: false, landing_workspace_seat: true, organization_id: LAND, organization_name: "Adapter Timber", role: "owner"
    }]

    expect(await adapter().viewerAccess(landingViewer)).toEqual({ capabilities: ["job.publish"], organizationName: "Adapter Timber" })
    expect(principal).toHaveBeenCalledWith(landingViewer)
    expect(recorded).toEqual([{ args: { p_org_id: LAND }, fn: "get_viewer_marketplace_access", principal: PRINCIPAL, readOnly: true, session: "user" }])
  })

  it("refuses when the session resolver refuses, before reaching the store", async () => {
    principal.mockRejectedValueOnce(new MarketplaceRefusalError("Sign in again to continue."))

    await expect(adapter().listLandingInterests(landingViewer)).rejects.toThrow("Sign in again")
    expect(recorded).toEqual([])
  })

  it("refuses a viewer whose business id is malformed", async () => {
    await expect(adapter().viewerAccess({ organizationId: "x'; --", userId: USER })).rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect(principal).not.toHaveBeenCalled()
  })
})

describe("normalized adapter: Find work pages (#280)", () => {
  const jobId = (index: number) => `11111111-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`
  const board = (count: number) => Array.from({ length: count }, (_, index) => jobRow({
    job_id: jobId(index),
    last_confirmed_at: new Date(Date.UTC(2026, 10, 3, 0, count - index)).toISOString(),
    last_modified_at: new Date(Date.UTC(2026, 10, 3, 0, count - index)).toISOString(),
    public_road_notes: "Gravel for the last 2 mi",
    slug: jobId(index)
  }))

  it("reads a page with ONE anonymous call for one row more than the page, each job with its public detail (#280, #362)", async () => {
    const jobs = board(60)
    responses.list_marketplace_jobs_page = jobPages(jobs)

    const first = await adapter().listJobPage({}, { limit: 25 })
    expect(first.items).toHaveLength(25)
    expect(first.items[0]).toMatchObject({ id: jobId(0), publicAccessRequirements: [], publicRoadNotes: "Gravel for the last 2 mi" })
    expect(first).toMatchObject({ restarted: false, start: 0, total: { count: 60, exact: true } })
    // The 26th row only says that there is a next page; it is not shown.
    expect(recorded).toEqual([{ args: { ...JOB_PAGE_ARGS, p_limit: 26 }, fn: "list_marketplace_jobs_page", session: "anon" }])

    const second = await adapter().listJobPage({}, { after: first.nextCursor, limit: 25 })
    expect(second).toMatchObject({ restarted: false, start: 25, total: { count: 60, exact: true } })
    expect(second.items.map((job) => job.id)).toEqual(Array.from({ length: 25 }, (_, index) => jobId(index + 25)))
    // The store resumes after the last job shown, from the cursor it returned with that row.
    expect(recorded[1]?.args).toEqual({ ...JOB_PAGE_ARGS, p_after: jobCursor(jobs[24]!), p_limit: 26 })

    const last = await adapter().listJobPage({}, { after: second.nextCursor, limit: 25 })
    expect(last).toMatchObject({ nextCursor: null, restarted: false, start: 50 })
    expect(last.items.map((job) => job.id)).toEqual(Array.from({ length: 10 }, (_, index) => jobId(index + 50)))

    expect(storeCalls()).toEqual(["list_marketplace_jobs_page", "list_marketplace_jobs_page", "list_marketplace_jobs_page"])
    expect(principal).not.toHaveBeenCalled()
  })

  it("counts the whole search exactly, however many jobs match (the store counts; nothing is cut at 200)", async () => {
    responses.list_marketplace_jobs_page = jobPages(board(450))
    const page = await adapter().listJobPage({})

    expect(page.items).toHaveLength(25)
    expect(page.total).toEqual({ count: 450, exact: true })
    expect(recorded[0]?.args).toMatchObject({ p_limit: 26 })

    recorded = []
    await adapter().listJobPage({}, { limit: 10_000 })
    expect(recorded[0]?.args).toMatchObject({ p_limit: 101 })
  })

  it("sends the page's filters and sort to the store, as the list does", async () => {
    const filters = { equipmentSetups: [["log_truck"]], near: { lat: 44.16, lng: -122.48 }, product: "Pulpwood", radiusMiles: 50, sort: "pay" as const, startsBy: "2026-12-15" }
    const args = { ...JOB_PAGE_ARGS, p_equipment_setups: [["log_truck"]], p_lat: 44.16, p_limit: 3, p_lng: -122.48, p_product: "Pulpwood", p_radius_miles: 50, p_sort: "pay", p_starts_by: "2026-12-15" }
    const jobs = board(3)
    responses.list_marketplace_jobs_page = jobPages(jobs, "pay")

    const page = await adapter().listJobPage(filters, { limit: 2 })
    expect(recorded[0]?.args).toEqual(args)

    await adapter().listJobPage(filters, { after: page.nextCursor, limit: 2 })
    expect(recorded[1]?.args).toEqual({ ...args, p_after: jobCursor(jobs[1]!, "pay") })
  })

  it("does not use a cursor made for another search, or one it cannot read: the list starts again", async () => {
    responses.list_marketplace_jobs_page = jobPages(board(60))
    const first = await adapter().listJobPage({}, { limit: 25 })
    const forged = Buffer.from(JSON.stringify({ k: { c: { i: jobId(3), k: ["0", "0; drop table", "0", "0", "0"], s: "newest", t: "x" }, n: 3 }, q: "x", v: 1 })).toString("base64url")

    for (const [filters, after] of [
      [{ product: "Pulpwood" }, first.nextCursor],
      [{ sort: "pay" as const }, first.nextCursor],
      [{ posterOrganizationId: LAND }, first.nextCursor],
      [{}, "not a cursor"],
      [{}, forged],
      [{}, "A".repeat(5000)]
    ] as const) {
      recorded = []
      const page = await adapter().listJobPage(filters, { after, limit: 25 })

      expect(page).toMatchObject({ restarted: true, start: 0 })
      expect(recorded[0]?.args).toMatchObject({ p_after: null })
    }

    // The same search written another way is the same search.
    recorded = []
    expect(await adapter().listJobPage({ acceptingOnly: true, sort: "newest" }, { after: first.nextCursor, limit: 25 })).toMatchObject({ restarted: false, start: 25 })
  })

  it("still counts the search when nothing is left after the cursor", async () => {
    const jobs = board(30)
    responses.list_marketplace_jobs_page = jobPages(jobs)
    const first = await adapter().listJobPage({}, { limit: 25 })

    // Every job after the first page closed before the next page was read.
    responses.list_marketplace_jobs_page = jobPages(jobs.slice(0, 25))
    recorded = []
    const next = await adapter().listJobPage({}, { after: first.nextCursor, limit: 25 })

    expect(next).toEqual({ items: [], nextCursor: null, restarted: false, start: 25, total: { count: 25, exact: true } })
    expect(recorded.map((call) => call.args)).toEqual([
      { ...JOB_PAGE_ARGS, p_after: jobCursor(jobs[24]!), p_limit: 26 },
      { ...JOB_PAGE_ARGS, p_limit: 1 }
    ])
  })

  it("reads an empty search with one call", async () => {
    expect(await adapter().listJobPage({})).toEqual({ items: [], nextCursor: null, restarted: false, start: 0, total: { count: 0, exact: true } })
    expect(storeCalls()).toEqual(["list_marketplace_jobs_page"])
  })

  it("fails loudly when the store's count or cursor drifted from the SQL", async () => {
    for (const drift of [{ total_count: "many" }, { total_count: -1 }, { page_cursor: null }, { page_cursor: { i: "x", k: ["0"], s: "newest", t: "t" } }]) {
      responses.list_marketplace_jobs_page = (args) => jobPages(board(3))(args).map((row) => ({ ...row, ...drift }))
      await expect(adapter().listJobPage({}, { limit: 2 })).rejects.toBeInstanceOf(MarketplaceStoreError)
    }
  })

  it("asks nothing for filters that can match nothing", async () => {
    expect(await adapter().listJobPage({ posterOrganizationId: "not-a-business" })).toMatchObject({ items: [], total: { count: 0, exact: true } })
    expect(await adapter().listJobPage({ startsBy: "soon" })).toEqual({ items: [], nextCursor: null, restarted: false, start: 0, total: { count: 0, exact: true } })
    expect(recorded).toEqual([])
  })
})

/*
 * The day-14 rule (#308, #321): from exactly 14 x 24 hours after its last confirmation, and when it was never confirmed
 * (a legacy import), a job still on the marketplace is off Find Work and takes no new interest. It stays active, is
 * still read by id, and reconfirming restores it. Stage 31 enforces it in the store. These rows play a store that
 * still returned such a job (another version, or a clock a moment behind), to prove the adapter applies the same
 * shared rule, `jobTakesNewInterest`, itself.
 */
describe("normalized adapter: the day-14 reconfirmation rule (#308, #321)", () => {
  const DAY_MS = 86_400_000
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
  const job = (n: number) => `11111111-aaaa-4aaa-8aaa-00000000000${n}`
  const row = (n: number, overrides: Record<string, unknown>) => jobRow({ job_id: job(n), slug: job(n), title: `Job ${n}`, ...overrides })
  const ids = (jobs: ReadonlyArray<{ id: string }>) => jobs.map((candidate) => candidate.id)

  const FRESH = row(1, { last_confirmed_at: ago(14 * DAY_MS - 1) })
  const STALE = row(2, { last_confirmed_at: ago(14 * DAY_MS) })
  const LEGACY = row(3, { last_confirmed_at: null })
  const RECONFIRMED = row(4, { last_confirmed_at: NOW.toISOString(), last_modified_at: ago(30 * DAY_MS) })
  const PAUSED = row(5, { accepting_interest: false, last_confirmed_at: ago(40 * DAY_MS), status: "paused" })

  it("leaves a job off Find Work from exactly 14 x 24 hours after its last confirmation, and a legacy job never confirmed", async () => {
    responses.list_marketplace_jobs_page = jobPages([RECONFIRMED, FRESH, STALE, LEGACY])

    expect(ids(await adapter().listJobs({}))).toEqual([job(4), job(1)])
    // "Include filled, paused and closed" does not bring it back: it is none of those.
    expect(ids(await adapter().listJobs({ acceptingOnly: false }))).toEqual([job(4), job(1)])

    // On a page, the jobs left out come off the store's count, which is then a floor: another page may hold more.
    const page = await adapter().listJobPage({}, { limit: 25 })
    expect(ids(page.items)).toEqual([job(4), job(1)])
    expect(page.total).toEqual({ count: 2, exact: false })
  })

  it("keeps a stopped job in the all-statuses list: the rule hides only a job still on the marketplace", async () => {
    responses.list_marketplace_jobs_page = jobPages([PAUSED, STALE])

    expect(await adapter().listJobs({ acceptingOnly: false })).toEqual([expect.objectContaining({ acceptingInterest: false, id: job(5), status: "paused" })])

    // The store keeps a stopped job out of the default list itself; a stale one it still returned is left out here.
    responses.list_marketplace_jobs_page = jobPages([STALE])
    expect(await adapter().listJobs({})).toEqual([])
  })

  it("still reads the job by id, as active and not taking new interest, never as expired or paused", async () => {
    for (const stale of [STALE, LEGACY]) {
      responses.get_marketplace_job = [stale]

      for (const view of [await adapter().getJob(stale.job_id), await adapter().getJob(stale.job_id, haulerViewer)]) {
        expect(view).toMatchObject({ acceptingInterest: false, id: stale.job_id, lastConfirmedAt: stale.last_confirmed_at, status: "active" })
      }
    }

    responses.get_marketplace_job = [FRESH]
    expect(await adapter().getJob(job(1))).toMatchObject({ acceptingInterest: true, status: "active" })
  })

  it("brings a job straight back once its poster reconfirms it", async () => {
    responses.list_marketplace_jobs_page = jobPages([STALE])
    expect(await adapter().listJobs({})).toEqual([])

    responses.list_marketplace_jobs_page = jobPages([{ ...STALE, last_confirmed_at: NOW.toISOString() }])
    responses.get_marketplace_job = [{ ...STALE, last_confirmed_at: NOW.toISOString() }]
    expect(ids(await adapter().listJobs({}))).toEqual([job(2)])
    expect(await adapter().getJob(job(2))).toMatchObject({ acceptingInterest: true, status: "active" })
  })

  it("refuses new interest with 'Waiting for the poster to confirm' before the store writes anything", async () => {
    for (const stale of [STALE, LEGACY]) {
      for (const standing of [[], [interestRow({ job_id: stale.job_id, status: "withdrawn" })]]) {
        recorded = []
        responses.get_marketplace_job = [stale]
        responses.list_marketplace_interests = standing

        const refusal = await adapter().expressInterest(haulerViewer, { loadPostingId: stale.job_id, trucksOffered: "2" }).catch((error: unknown) => error)

        expect(refusal).toBeInstanceOf(MarketplaceRefusalError)
        expect(refusal).toMatchObject({ code: "23514", message: MARKETPLACE_JOB_UNCONFIRMED_LABEL })
        expect((refusal as Error).message).not.toMatch(/expire|pause|close/i)
        expect(storeCalls()).toEqual(["get_marketplace_job", "list_marketplace_interests"])
        // Only the statuses are read: the business's inquiries on this job, without their messages.
        expect(recorded[1]?.args).toEqual({ p_job_id: stale.job_id, p_org_id: HAUL, p_side: "hauler", p_with_replies: false })
        expect(recorded.every((call) => call.session === "user" && call.readOnly === false)).toBe(true)
      }
    }
  })

  it("lets the hauler change an inquiry already sent on such a job: that is not new interest", async () => {
    responses.get_marketplace_job = [STALE]
    responses.list_marketplace_interests = [interestRow({ id: INTEREST, job_id: job(2), status: "replied" })]
    responses.get_marketplace_interest = [interestRow({ id: INTEREST, job_id: job(2), status: "replied" })]
    responses.submit_expression_of_interest = [{ created: false, interest_id: INTEREST }]

    expect((await adapter().expressInterest(haulerViewer, { loadPostingId: job(2), trucksOffered: "3" })).id).toBe(INTEREST)
    expect(storeCalls()).toEqual(["get_marketplace_job", "list_marketplace_interests", "submit_expression_of_interest", "get_marketplace_interest"])
  })

  it("sends interest on a confirmed job as before, reading the job first in the same transaction", async () => {
    responses.get_marketplace_job = [FRESH]
    responses.get_marketplace_interest = [interestRow({ job_id: job(1) })]
    responses.submit_expression_of_interest = [{ created: true, interest_id: INTEREST }]

    expect((await adapter().expressInterest(haulerViewer, { loadPostingId: job(1), trucksOffered: "2" })).id).toBe(INTEREST)
    expect(storeCalls()).toEqual(["get_marketplace_job", "submit_expression_of_interest", "get_marketplace_interest"])
    expect(recorded[0]).toMatchObject({ args: { p_job_id: job(1) }, readOnly: false, session: "user" })
  })

  it("leaves a job the person cannot read, or one that stopped, to the store's own refusal", async () => {
    responses.submit_expression_of_interest = [{ created: true, interest_id: INTEREST }]
    responses.get_marketplace_interest = [interestRow()]

    for (const visible of [[], [PAUSED]]) {
      recorded = []
      responses.get_marketplace_job = visible

      await adapter().expressInterest(haulerViewer, { loadPostingId: JOB, trucksOffered: "2" })
      expect(storeCalls()).toEqual(["get_marketplace_job", "submit_expression_of_interest", "get_marketplace_interest"])
    }
  })
})

describe("normalized adapter: inquiry pages (#280, audit K1)", () => {
  const LATER = "66666666-eeee-4eee-8eee-eeeeeeeeeee2"

  const EARLIEST = "66666666-eeee-4eee-8eee-eeeeeeeeeee3"
  // The hauler's order: last activity, newest first. The time carries the store's microseconds.
  const HAULER_ROWS = [
    interestRow({ id: LATER, updated_at: "2026-11-03T11:30:00.123456+00:00" }),
    interestRow(),
    interestRow({ id: EARLIEST, status: "withdrawn", updated_at: "2026-11-02T08:00:00+00:00" })
  ]

  it("reads one page and the tab counts in one read-only transaction as the person, a row more than the page (#280, #362)", async () => {
    responses.list_marketplace_interests = interestPages(HAULER_ROWS)
    responses.count_marketplace_interests = interestCounts("hauler", [1, 1, 1])

    const page = await adapter().listInterestPage(haulerViewer, "hauler", { limit: 1 })
    expect(page.items.map((interest) => interest.id)).toEqual([LATER])
    expect(page).toMatchObject({ restarted: false, start: 0, total: { count: 3, exact: true } })
    expect(recorded).toEqual([
      { args: { p_after_at: null, p_after_id: null, p_limit: 2, p_org_id: HAUL, p_side: "hauler" }, fn: "list_marketplace_interests", principal: PRINCIPAL, readOnly: true, session: "user" },
      { args: { p_org_id: HAUL, p_side: "hauler" }, fn: "count_marketplace_interests", principal: PRINCIPAL, readOnly: true, session: "user" }
    ])
    expect(principal).toHaveBeenCalledTimes(1)

    // The store resumes after the last inquiry shown, from its time exactly as the store wrote it.
    const next = await adapter().listInterestPage(haulerViewer, "hauler", { after: page.nextCursor, limit: 1 })
    expect(next.items.map((interest) => interest.id)).toEqual([INTEREST])
    expect(next).toMatchObject({ restarted: false, start: 1 })
    expect(recorded[2]?.args).toEqual({ p_after_at: "2026-11-03T11:30:00.123456+00:00", p_after_id: LATER, p_limit: 2, p_org_id: HAUL, p_side: "hauler" })

    const last = await adapter().listInterestPage(haulerViewer, "hauler", { after: next.nextCursor, limit: 1 })
    expect(last.items.map((interest) => interest.id)).toEqual([EARLIEST])
    expect(last).toMatchObject({ nextCursor: null, start: 2, total: { count: 3, exact: true } })
  })

  it("pages the landing's inquiries by arrival, with the landing's own tabs", async () => {
    responses.list_marketplace_interests = interestPages([
      interestRow({ created_at: "2026-11-03T11:45:00.5+00:00", id: LATER, updated_at: "2026-11-01T00:00:00+00:00" }),
      interestRow()
    ])
    responses.count_marketplace_interests = interestCounts("landing", [2, 0, 0])

    const page = await adapter().listInterestPage(landingViewer, "landing", { limit: 1 })
    expect(page.total).toEqual({ count: 2, exact: true })
    expect(recorded.map((call) => call.args)).toEqual([
      { p_after_at: null, p_after_id: null, p_limit: 2, p_org_id: LAND, p_side: "landing" },
      { p_org_id: LAND, p_side: "landing" }
    ])

    await adapter().listInterestPage(landingViewer, "landing", { after: page.nextCursor, limit: 1 })
    expect(recorded[2]?.args).toMatchObject({ p_after_at: "2026-11-03T11:45:00.5+00:00", p_after_id: LATER })
  })

  it("never returns or counts another business's inquiry, even if the store did", async () => {
    responses.list_marketplace_interests = [interestRow(), interestRow({ hauler_org_id: OTHER, id: LATER, landing_org_id: OTHER })]
    responses.count_marketplace_interests = interestCounts("hauler", [2, 0, 0])

    const hauler = await adapter().listInterestPage(haulerViewer, "hauler")
    expect(hauler.items.map((interest) => interest.haulerOrganization.id)).toEqual([HAUL])
    // What was left out comes off the count, which is then a floor and no longer the total.
    expect(hauler.total).toEqual({ count: 1, exact: false })

    responses.count_marketplace_interests = interestCounts("landing", [1, 1, 0])
    const landing = await adapter().listInterestPage(landingViewer, "landing")
    expect(landing.items.map((interest) => interest.landingOrganization.id)).toEqual([LAND])
    expect(landing.total).toEqual({ count: 1, exact: false })
  })

  it("does not use one business's cursor for another business, or one side's for the other", async () => {
    responses.list_marketplace_interests = interestPages(HAULER_ROWS)
    responses.count_marketplace_interests = interestCounts("hauler", [1, 1, 1])
    const mine = await adapter().listInterestPage(haulerViewer, "hauler", { limit: 1 })
    const badTime = Buffer.from(JSON.stringify({ k: { at: "yesterday'; --", id: LATER, n: 1 }, q: "x", v: 1 })).toString("base64url")

    responses.list_marketplace_interests = interestPages(HAULER_ROWS.map((row) => ({ ...row, hauler_org_id: OTHER })))
    recorded = []
    const theirs = await adapter().listInterestPage({ organizationId: OTHER, userId: USER }, "hauler", { after: mine.nextCursor, limit: 1 })
    expect(theirs).toMatchObject({ restarted: true, start: 0 })
    expect(theirs.items.map((interest) => interest.id)).toEqual([LATER])
    expect(recorded[0]?.args).toMatchObject({ p_after_at: null, p_after_id: null, p_org_id: OTHER })

    for (const after of [mine.nextCursor, badTime, "not a cursor"]) {
      recorded = []
      responses.list_marketplace_interests = interestPages(HAULER_ROWS.map((row) => ({ ...row, hauler_org_id: OTHER, landing_org_id: HAUL })))
      responses.count_marketplace_interests = interestCounts("landing", [2, 0, 1])
      expect(await adapter().listInterestPage(haulerViewer, "landing", { after, limit: 1 })).toMatchObject({ restarted: true, start: 0 })
      expect(recorded[0]?.args).toMatchObject({ p_after_at: null, p_after_id: null, p_side: "landing" })
    }
  })

  it("fails loudly when the tab counts drifted from the SQL", async () => {
    responses.list_marketplace_interests = interestPages(HAULER_ROWS)

    for (const counts of [[], [{ queue: "active", total: "3" }], interestCounts("hauler", [1, 1, -1]), interestCounts("landing", [1, 1, 1])]) {
      responses.count_marketplace_interests = counts
      await expect(adapter().listInterestPage(haulerViewer, "hauler")).rejects.toBeInstanceOf(MarketplaceStoreError)
    }
  })

  it("refuses an unknown side and a malformed business before reaching the store", async () => {
    await expect(adapter().listInterestPage(haulerViewer, "both" as never)).rejects.toBeInstanceOf(MarketplaceRefusalError)
    await expect(adapter().listInterestPage({ organizationId: "x'; --", userId: USER }, "hauler")).rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect(recorded).toEqual([])
    expect(principal).not.toHaveBeenCalled()
  })
})

describe("normalized adapter: inquiries stay inside the active business", () => {
  it("returns the stored inquiry after submitting it for the viewer's own hauling business", async () => {
    responses.submit_expression_of_interest = [{ created: true, interest_id: INTEREST }]
    responses.get_marketplace_interest = [interestRow()]

    const view = await adapter().expressInterest(haulerViewer, { loadPostingId: JOB, trucksOffered: "2" })

    expect(view.id).toBe(INTEREST)
    const submitted = recorded.findIndex((call) => call.fn === "submit_expression_of_interest")
    expect(recorded[submitted]).toMatchObject({ args: { p_hauler_org_id: HAUL, p_job_id: JOB, p_trucks_offered: 2 }, readOnly: false })
    // The one inquiry by id (#362), not the business's whole list searched here.
    expect(recorded[submitted + 1]).toEqual({ args: { p_interest_id: INTEREST }, fn: "get_marketplace_interest", principal: PRINCIPAL, readOnly: false, session: "user" })
    expect(storeCalls()).not.toContain("list_marketplace_interests")
  })

  it("fails loudly when the stored inquiry cannot be read back, or is another business's or another inquiry", async () => {
    responses.submit_expression_of_interest = [{ created: true, interest_id: INTEREST }]

    for (const stored of [[], [interestRow({ hauler_org_id: OTHER })], [interestRow({ id: REPLY })]]) {
      responses.get_marketplace_interest = stored
      await expect(adapter().expressInterest(haulerViewer, { loadPostingId: JOB, trucksOffered: "2" })).rejects.toBeInstanceOf(MarketplaceStoreError)
    }
  })

  it("reads the business's inquiry on one job as one row", async () => {
    responses.list_marketplace_interests = interestPages([interestRow()])

    expect((await adapter().interestForJob(haulerViewer, JOB))?.id).toBe(INTEREST)
    expect(recorded).toEqual([
      { args: { p_job_id: JOB, p_limit: 1, p_org_id: HAUL, p_side: "hauler" }, fn: "list_marketplace_interests", principal: PRINCIPAL, readOnly: true, session: "user" }
    ])
    responses.list_marketplace_interests = []
    expect(await adapter().interestForJob(haulerViewer, JOB)).toBeNull()
  })

  it("refuses to withdraw or reply to an inquiry of another business, even one the person also belongs to", async () => {
    parties = { haulerOrganizationId: OTHER, jobId: JOB, jobOrganizationId: LAND }

    await expect(adapter().withdrawInterest(haulerViewer, INTEREST)).rejects.toThrow("Inquiry not found")
    await expect(adapter().postHaulerReply(haulerViewer, { body: "Hello", interestId: INTEREST, replyId: REPLY })).rejects.toThrow("Inquiry not found")
    expect(storeCalls()).toEqual([])
  })

  it("refuses a landing response from the wrong side or another landing business", async () => {
    await expect(adapter().respondToInterest(haulerViewer, { decision: "viewed", interestId: INTEREST })).rejects.toThrow("Inquiry not found")

    parties = { haulerOrganizationId: HAUL, jobId: JOB, jobOrganizationId: OTHER }
    await expect(adapter().respondToInterest(landingViewer, { decision: "viewed", interestId: INTEREST })).rejects.toThrow("Inquiry not found")

    parties = null
    await expect(adapter().respondToInterest(landingViewer, { decision: "viewed", interestId: INTEREST })).rejects.toThrow("Inquiry not found")
    expect(storeCalls()).toEqual([])
  })

  it("responds, replies and withdraws for the right business, never sharing private details", async () => {
    await adapter().respondToInterest(landingViewer, { body: "Call us", decision: "replied", interestId: INTEREST, replyId: REPLY })
    await adapter().postHaulerReply(haulerViewer, { body: "On our way to quote", interestId: INTEREST, replyId: REPLY })
    await adapter().withdrawInterest(haulerViewer, INTEREST)

    expect(storeCalls()).toEqual(["respond_to_interest", "post_hauler_interest_reply", "withdraw_interest"])
    const respond = recorded.find((call) => call.fn === "respond_to_interest")
    expect(respond?.args).toEqual({ p_body: "Call us", p_interest_id: INTEREST, p_reply_id: REPLY, p_status: "replied" })
    expect(Object.keys(respond?.args ?? {})).not.toContain("p_share_private_details")
  })

  it("validates the form input before reaching the store", async () => {
    await expect(adapter().respondToInterest(landingViewer, { decision: "replied", interestId: INTEREST, replyId: REPLY })).rejects.toThrow("A reply needs a message")
    await expect(adapter().withdrawInterest(haulerViewer, "nope")).rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect(recorded).toEqual([])
  })
})

describe("normalized adapter: inquiry conversations (UX-09, #132)", () => {
  const access = (capabilities: string[]) => [{
    capabilities, hauler_profile: false, landing_workspace_seat: true, organization_id: LAND, organization_name: "Adapter Timber", role: "owner"
  }]

  it("withdraws with the hauler's reason in one write: the reason first, then the withdrawal", async () => {
    responses.list_marketplace_interests = [interestRow()]

    await adapter().withdrawInterestWithReason(haulerViewer, { interestId: INTEREST, reason: " Booked elsewhere ", replyId: REPLY })

    expect(storeCalls()).toEqual(["list_marketplace_interests", "post_hauler_interest_reply", "withdraw_interest"])
    expect(new Set(recorded.map((call) => call.readOnly))).toEqual(new Set([false]))
    // The one inquiry's status, read on the hauler's side with the hauler's own check, without its messages (#362).
    expect(recorded.find((call) => call.fn === "list_marketplace_interests")?.args).toEqual({ p_interest_id: INTEREST, p_org_id: HAUL, p_side: "hauler", p_with_replies: false })
    expect(recorded.find((call) => call.fn === "post_hauler_interest_reply")?.args).toEqual({ p_body: "Booked elsewhere", p_interest_id: INTEREST, p_reply_id: REPLY })
  })

  it("withdraws without a message when there is no reason, and does nothing more for a withdrawn inquiry", async () => {
    responses.list_marketplace_interests = [interestRow()]
    await adapter().withdrawInterestWithReason(haulerViewer, { interestId: INTEREST, reason: "", replyId: REPLY })
    expect(storeCalls()).toEqual(["list_marketplace_interests", "withdraw_interest"])

    recorded = []
    responses.list_marketplace_interests = [interestRow({ status: "withdrawn" })]
    await adapter().withdrawInterestWithReason(haulerViewer, { interestId: INTEREST, reason: "Again", replyId: REPLY })
    expect(storeCalls()).toEqual(["list_marketplace_interests"])
  })

  it("refuses a declined inquiry with the landing's closure, before writing a reason (#194 HF-03)", async () => {
    responses.list_marketplace_interests = [interestRow({ status: "declined" })]

    await expect(adapter().withdrawInterestWithReason(haulerViewer, { interestId: INTEREST, reason: "Never mind", replyId: REPLY }))
      .rejects.toThrow("The landing has closed this inquiry")
    expect(storeCalls()).toEqual(["list_marketplace_interests"])
  })

  it("refuses when the store returns no such inquiry on the hauler's side, or another one, and writes nothing", async () => {
    for (const stored of [[], [interestRow({ id: REPLY })], [interestRow({ hauler_org_id: OTHER })]]) {
      recorded = []
      responses.list_marketplace_interests = stored

      await expect(adapter().withdrawInterestWithReason(haulerViewer, { interestId: INTEREST, reason: "Booked elsewhere", replyId: REPLY })).rejects.toThrow("Inquiry not found")
      expect(storeCalls()).toEqual(["list_marketplace_interests"])
    }
  })

  it("refuses another business's inquiry, and a reason without a reply id, before reaching the store", async () => {
    parties = { haulerOrganizationId: OTHER, jobId: JOB, jobOrganizationId: LAND }
    await expect(adapter().withdrawInterestWithReason(haulerViewer, { interestId: INTEREST, reason: "x", replyId: REPLY })).rejects.toThrow("Inquiry not found")
    await expect(adapter().withdrawInterestWithReason(haulerViewer, { interestId: INTEREST, reason: "x" })).rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect(storeCalls()).toEqual([])
  })

  it("reads the landing's own inquiry jobs read-only, once inquiry.respond is confirmed", async () => {
    responses.get_viewer_marketplace_access = access(["inquiry.respond", "job.publish"])
    inquiryJobs = [
      { equipment_codes: ["log_truck", "pole_trailer"], job_id: JOB, landing_id: LANDING, landing_name: "Upper Spur" },
      { equipment_codes: null, job_id: INTEREST, landing_id: null, landing_name: null }
    ]

    expect(await adapter().landingInquiryJobs(landingViewer)).toEqual([
      { equipmentCodes: ["log_truck", "pole_trailer"], jobId: JOB, landing: { id: LANDING, name: "Upper Spur" } },
      { equipmentCodes: [], jobId: INTEREST, landing: null }
    ])
    expect(recorded.map((call) => [call.fn, call.readOnly])).toEqual([["get_viewer_marketplace_access", true], ["inquiryJobs", true]])
    expect(recorded[1]?.args).toEqual({ organizationId: LAND })
  })

  it("refuses the job context to a role without inquiry.respond: a cross-organization read is refused", async () => {
    responses.get_viewer_marketplace_access = access(["interest.express", "interest.reply"])

    await expect(adapter().landingInquiryJobs(haulerViewer)).rejects.toThrow("Inquiry not found")
    expect(recorded.map((call) => call.fn)).toEqual(["get_viewer_marketplace_access"])
  })
})

describe("normalized adapter: publishing and reconfirmation", () => {
  beforeEach(() => {
    responses.list_authoring_landings = [{ area_label: "Near Vida, OR", id: LANDING, name: "Upper Spur", state_code: "OR" }]
    responses.publish_job_posting = [JOB]
    responses.get_marketplace_job = [jobRow()]
  })

  it("publishes at one of the active business's own landings with the explicit attestation", async () => {
    await expect(adapter().publishJob(landingViewer, publishDraft(), publishAttestation)).resolves.toEqual({ jobId: JOB })

    expect(storeCalls()).toEqual(["list_authoring_landings", "publish_job_posting"])
    expect(recorded[0]?.args).toEqual({ p_org_id: LAND })
    expect(recorded[1]).toMatchObject({ args: { p_attest_available: true, p_landing_id: LANDING, p_pay_amount_cents: 9100 }, readOnly: false })
  })

  it("refuses a landing that is not one of the active business's own", async () => {
    responses.list_authoring_landings = []

    await expect(adapter().publishJob(landingViewer, publishDraft(), publishAttestation)).rejects.toThrow("Choose one of your organization's landings")
    expect(storeCalls()).toEqual(["list_authoring_landings"])
  })

  it("refuses without a fresh publish attestation, and never publishes a reconfirmation", async () => {
    await expect(adapter().publishJob(landingViewer, publishDraft(), reconfirmAttestation)).rejects.toBeInstanceOf(MarketplaceRefusalError)
    await expect(adapter().publishJob(landingViewer, publishDraft(), { action: "publish", confirmedAt: "2026-11-03T11:00:00.000Z" })).rejects.toBeInstanceOf(MarketplaceRefusalError)
    await expect(adapter().publishJob(landingViewer, publishDraft(), null as never)).rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect(recorded).toEqual([])
  })

  it("refuses a draft that does not meet the publication rules", async () => {
    const draft = { ...publishDraft(), product: undefined }

    await expect(adapter().publishJob(landingViewer, draft, publishAttestation)).rejects.toThrow("Fix the highlighted fields")
    expect(recorded).toEqual([])
  })

  it("reconfirms only the active business's own job", async () => {
    await adapter().reconfirmJob(landingViewer, JOB, reconfirmAttestation)
    expect(storeCalls()).toEqual(["get_marketplace_job", "reconfirm_job_posting"])

    recorded = []
    responses.get_marketplace_job = [jobRow({ poster_organization_id: OTHER })]
    await expect(adapter().reconfirmJob(landingViewer, JOB, reconfirmAttestation)).rejects.toThrow("own job postings")
    expect(storeCalls()).toEqual(["get_marketplace_job"])
  })

  it("refuses a reconfirmation without its own attestation", async () => {
    await expect(adapter().reconfirmJob(landingViewer, JOB, publishAttestation)).rejects.toThrow("availability confirmation")
    expect(recorded).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Landing workspace (#127, #133)
// ---------------------------------------------------------------------------------------------------------------

function accessRow(capabilities: string[]) {
  return { capabilities, hauler_profile: false, landing_workspace_seat: true, organization_id: LAND, organization_name: "Adapter Timber", role: "owner" }
}

const MANAGER = ["job.publish", "landing.manage", "inquiry.respond"]
const DESK_STAFF = ["job.publish", "inquiry.respond"]

function ownLandingRow(overrides: Record<string, unknown> = {}) {
  return {
    active_jobs: 1, county: null, exact_lat: 44.15432, exact_lng: -122.48765, gate_instructions: "Green gate 4417", id: LANDING,
    name: "Upper Spur Landing", public_area_label: "Near Vida, OR", public_lat: 44.2, public_lng: -122.5, site_contact_name: "Lee",
    site_contact_phone: "+15415550100", state_code: "OR", status: "active", updated_at: "2026-11-03T11:00:00+00:00",
    ...overrides
  }
}

function entitlementRow(overrides: Record<string, unknown> = {}) {
  return {
    active_landings: 1, fleet_only_members: 0, grace_ends_at: null, invitations_remaining: 3, landing_conflict: false,
    max_active_landings: 1, max_team_members: 2, paid_landing_seats: 1, period_end: "2026-12-01T00:00:00+00:00",
    plan_code: "basic", seat_conflict: false, subscription_status: "active", ...overrides
  }
}

const NEW_LANDING = { areaLabel: "Oakridge", name: "Hills Creek Unit 4", stateCode: "OR" }

describe("normalized adapter: landing workspace", () => {
  it("lists the active business's own landings for its landing desk, with the private half", async () => {
    responses.get_viewer_marketplace_access = [accessRow(DESK_STAFF)]
    statements.own_landings = [ownLandingRow(), ownLandingRow({ id: OTHER, name: "Layng Creek", status: "inactive", exact_lat: null, exact_lng: null, public_lat: null, public_lng: null })]

    const landings = await adapter().listOwnLandings(landingViewer)

    expect(landings.map((landing) => [landing.name, landing.status, landing.approximatePoint])).toEqual([
      ["Upper Spur Landing", "active", { lat: 44.2, lng: -122.5 }],
      ["Layng Creek", "paused", null]
    ])
    expect(landings[0]?.privateDetails).toEqual({ exactLocation: { lat: 44.15432, lng: -122.48765 }, gateInstructions: "Green gate 4417", siteContactName: "Lee", siteContactPhone: "+15415550100" })
    expect(recorded.find((call) => call.fn === "statement:own_landings")?.args).toEqual({ values: [LAND, null] })
    expect(recorded.every((call) => call.readOnly === true)).toBe(true)
  })

  it("refuses a role without the landing desk", async () => {
    responses.get_viewer_marketplace_access = [accessRow(["interest.express"])]

    await expect(adapter().listOwnLandings(landingViewer)).rejects.toThrow("cannot see this business's landings")
    expect(storeCalls()).toEqual(["get_viewer_marketplace_access"])
  })

  it("never asks the store for a landing id that cannot exist", async () => {
    expect(await adapter().getOwnLanding(landingViewer, "../x")).toBeNull()
    expect(recorded).toEqual([])
  })

  it("saves a new landing paused without an exact location, and its public point only from the private one", async () => {
    responses.get_viewer_marketplace_access = [accessRow(MANAGER)]
    statements.insert_landing = [{ id: LANDING }]
    statements.save_landing_private = [{ id: LANDING }]

    expect(await adapter().saveLanding(landingViewer, NEW_LANDING)).toEqual({ landingId: LANDING })
    expect(storeCalls()).toEqual(["get_viewer_marketplace_access", "statement:insert_landing", "statement:save_landing_private"])
    expect(recorded.find((call) => call.fn === "statement:insert_landing")?.args).toEqual({ values: [LAND, "Hills Creek Unit 4", "inactive", "Oakridge, OR", null, null, "OR", null] })
    expect(recorded.at(-1)?.readOnly).toBe(false)
  })

  it("checks the plan before a new landing recruits, and refuses at the cap", async () => {
    responses.get_viewer_marketplace_access = [accessRow(MANAGER)]
    responses.get_org_entitlement_state = [entitlementRow()]

    await expect(adapter().saveLanding(landingViewer, { ...NEW_LANDING, recruiting: "1" })).rejects.toThrow(/Basic plan allows 1 active landing.*Pause another landing or see plans/)
    expect(storeCalls()).toEqual(["get_viewer_marketplace_access", "get_org_entitlement_state"])

    recorded = []
    responses.get_org_entitlement_state = [entitlementRow({ plan_code: null, invitations_remaining: 0, period_end: null })]
    await expect(adapter().saveLanding(landingViewer, { ...NEW_LANDING, recruiting: "1" })).rejects.toThrow("Billing isn't active yet")
  })

  it("edits only one of the business's own landings, and never its status", async () => {
    responses.get_viewer_marketplace_access = [accessRow(MANAGER)]
    statements.own_landings = [ownLandingRow()]
    statements.update_landing = [{ id: LANDING }]
    statements.save_landing_private = [{ id: LANDING }]

    await adapter().saveLanding(landingViewer, { ...NEW_LANDING, exactLat: "44.15432", exactLng: "-122.48765", landingId: LANDING, recruiting: "1" })
    expect(storeCalls()).toEqual(["get_viewer_marketplace_access", "statement:own_landings", "statement:update_landing", "statement:save_landing_private"])
    expect(recorded.find((call) => call.fn === "statement:update_landing")?.args).toEqual({
      values: [LANDING, LAND, "Hills Creek Unit 4", "Oakridge, OR", "44.15432", "-122.48765", "OR", null]
    })

    recorded = []
    statements.own_landings = []
    await expect(adapter().saveLanding(landingViewer, { ...NEW_LANDING, landingId: LANDING })).rejects.toThrow("That landing was not found")
    expect(storeCalls()).toEqual(["get_viewer_marketplace_access", "statement:own_landings"])
  })

  it("lets only owners and managers save, and validates before the store", async () => {
    responses.get_viewer_marketplace_access = [accessRow(DESK_STAFF)]
    await expect(adapter().saveLanding(landingViewer, NEW_LANDING)).rejects.toThrow("Only an owner or manager")

    recorded = []
    await expect(adapter().saveLanding(landingViewer, { ...NEW_LANDING, name: "Gate code 4417" })).rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect(recorded).toEqual([])
  })

  it("pauses, restores and starts recruiting through the plan rule", async () => {
    responses.get_viewer_marketplace_access = [accessRow(MANAGER)]
    statements.own_landings = [ownLandingRow()]
    statements.set_landing_status = [{ id: LANDING, status: "inactive" }]

    await adapter().setLandingStatus(landingViewer, LANDING, "paused")
    expect(recorded.find((call) => call.fn === "statement:set_landing_status")?.args).toEqual({ values: [LANDING, LAND, "inactive"] })

    // Already in that status: nothing is written.
    recorded = []
    await adapter().setLandingStatus(landingViewer, LANDING, "active")
    expect(storeCalls()).toEqual(["get_viewer_marketplace_access", "statement:own_landings"])

    // Paused → recruiting asks the plan; archived → recruiting is refused outright.
    recorded = []
    statements.own_landings = [ownLandingRow({ status: "inactive" })]
    responses.get_org_entitlement_state = [entitlementRow({ active_landings: 1 })]
    await expect(adapter().setLandingStatus(landingViewer, LANDING, "active")).rejects.toThrow("Pause another landing or see plans")
    expect(storeCalls()).not.toContain("statement:set_landing_status")

    statements.own_landings = [ownLandingRow({ status: "archived" })]
    await expect(adapter().setLandingStatus(landingViewer, LANDING, "active")).rejects.toThrow("comes back paused first")
  })

  it("reads the allowance with every limit left to the contracts", async () => {
    responses.get_viewer_marketplace_access = [accessRow(DESK_STAFF)]
    responses.get_org_entitlement_state = [entitlementRow({ invitations_remaining: 2, paid_landing_seats: 2 })]

    expect(await adapter().landingAllowance(landingViewer)).toEqual({
      activeLandings: 1, cycleEndsAt: "2026-12-01T00:00:00.000Z", invitationsRemaining: 2, planCode: "basic", teamMembers: 2
    })

    responses.get_org_entitlement_state = [entitlementRow({ plan_code: "dispatch_pro" })]
    await expect(adapter().landingAllowance(landingViewer)).rejects.toThrow()
  })

  it("sets up a landing business for the signed-in person, with a fresh slug", async () => {
    responses.create_organization = [OTHER]

    expect(await adapter().createLandingOrganization({ userId: USER }, { displayName: "Cedar Fork Logging", homeState: "or" })).toEqual({ organizationId: OTHER })
    const call = recorded.find((entry) => entry.fn === "create_organization")
    expect(call?.args).toMatchObject({ p_display_name: "Cedar Fork Logging", p_enable_hauler: false, p_home_state: "OR" })
    expect(String(call?.args.p_slug)).toMatch(/^cedar-fork-logging-[0-9a-f]{8}$/)
    expect(call?.readOnly).toBe(false)
    expect(principal).toHaveBeenCalledWith({ organizationId: "", userId: USER })
  })
})

describe("normalized adapter: reporting a listing (#130)", () => {
  beforeEach(() => {
    responses.get_marketplace_job = [jobRow()]
  })

  it("files one report as the person, for a listing they can see, and returns the receipt", async () => {
    await expect(adapter().reportListing(haulerViewer, { details: "Pay was $80 a ton", jobId: JOB, reason: "inaccurate_pay" })).resolves.toEqual({
      alreadyReported: false,
      reportId: REPORT,
      reportedAt: "2026-11-03T12:00:00.123Z"
    })

    expect(recorded.map((call) => [call.fn, call.session, call.readOnly])).toEqual([
      ["get_marketplace_job", "user", false],
      ["standingListingReport", "user", false],
      ["fileListingReport", "user", false]
    ])
    expect(recorded[2]?.args).toEqual({ details: "Pay was $80 a ton", jobId: JOB, reason: "inaccurate_pay" })
  })

  it("files nothing when the person already has a standing report of the listing", async () => {
    standingReport = { createdAt: "2026-11-01T08:00:00+00:00", id: REPORT }

    await expect(adapter().reportListing(haulerViewer, { jobId: JOB, reason: "stale" })).resolves.toEqual({
      alreadyReported: true,
      reportId: REPORT,
      reportedAt: "2026-11-01T08:00:00.000Z"
    })
    expect(storeCalls()).not.toContain("fileListingReport")
  })

  it("says not found for a listing the person cannot see, and files nothing", async () => {
    responses.get_marketplace_job = []

    await expect(adapter().reportListing(haulerViewer, { jobId: JOB, reason: "fake_work" })).rejects.toThrow("Listing not found")
    expect(storeCalls()).toEqual(["get_marketplace_job"])
  })

  it("validates the report before reaching the store", async () => {
    await expect(adapter().reportListing(haulerViewer, { jobId: JOB, reason: "spam" })).rejects.toThrow("Choose why you are reporting this listing")
    await expect(adapter().reportListing(haulerViewer, { jobId: "../etc", reason: "stale" })).rejects.toThrow("Listing not found")
    expect(recorded).toEqual([])
  })
})

/**
 * The shared rules the adapter core may import from `@logloads/services`, by name: the pure job lifecycle rules both
 * adapters apply (packages/services/src/v2/jobs). Nothing else from that package, which also holds the pilot services.
 */
const SHARED_RULES: ReadonlySet<string> = new Set(["jobTakesNewInterest", "unconfirmedJobNotice"])

describe("normalized adapter: no path to the pilot store", () => {
  it("imports nothing that reads or writes operating_state, loads, slots or the pilot services", () => {
    for (const file of ["normalized-adapter.ts", "normalized-db.ts", "normalized-mapping.ts"]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8")
      const imports = [...source.matchAll(/from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1] ?? match[2])
      const shared = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@logloads\/services["']/g)]

      expect(imports.filter((target) => target !== "@logloads/services" && /services|@logloads\/db|pilot-adapter|\.\/mapping$|network|session/.test(target ?? ""))).toEqual([])
      // Every import of the package is one named list of shared rules, never a namespace, a default or a dynamic import.
      expect(shared).toHaveLength(imports.filter((target) => target === "@logloads/services").length)
      for (const [, names = ""] of shared) {
        expect(names.split(",").map((name) => name.trim()).filter(Boolean).filter((name) => !SHARED_RULES.has(name)), file).toEqual([])
      }
    }
  })
})
