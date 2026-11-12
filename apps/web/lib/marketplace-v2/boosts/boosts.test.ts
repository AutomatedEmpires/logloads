import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { HAULER_AVAILABILITY_FRESH_DAYS } from "@logloads/contracts"

import { BOOST_METHOD_NEEDS, boostMethodReady, boostsCatalogueReady, normalizedBoosts } from "./index"
import { audienceFromRows, boostFromRow } from "./mapping"
import { boostMethods } from "./methods"
import { BOOST_FUNCTIONS, BOOST_STATEMENT_NAMES, BOOST_STATEMENTS, boostStatement } from "./statements"
import { createNormalizedMarketplaceV2 } from "../normalized-adapter"
import { MARKETPLACE_FUNCTIONS, type MarketplaceCalls, type MarketplaceDb, type MarketplacePrincipal } from "../normalized-db"
import { MARKETPLACE_QUERIES } from "../normalized-queries"
import {
  MARKETPLACE_V2_FEATURE_OPERATIONS,
  MarketplaceFeatureUnavailableError,
  MarketplaceRefusalError,
  MarketplaceStoreError,
  marketplaceV2FeatureMethods,
  type MarketplaceBoostsPort,
  type MarketplaceV2Viewer
} from "../port"

const CLERK = "user_clerk_landing"
const ORG = "33333333-bbbb-4bbb-8bbb-333333333333"
const OTHER_ORG = "44444444-cccc-4ccc-8ccc-cccccccccccc"
const JOB = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const BOOST_1 = "88888888-dddd-4ddd-8ddd-000000000001"
const BOOST_2 = "88888888-dddd-4ddd-8ddd-000000000002"
const NOW = new Date("2026-11-11T18:00:00.000Z")
const PRINCIPAL: MarketplacePrincipal = { audience: "logloads-test-audience", issuer: "https://clerk.logloads.test", subject: CLERK }

const landing: MarketplaceV2Viewer = { organizationId: ORG, userId: CLERK }

interface Recorded { kind: "call" | "query"; name: string; args: unknown; readOnly?: boolean; transaction: number }

let recorded: Recorded[]
let transactions: number
let calls: Record<string, unknown[]>
let queries: Record<string, unknown[]>
let failures: Record<string, Error[]>

function postgresError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code, severity: "ERROR" })
}

function fakeDb(): MarketplaceDb {
  const api = (readOnly?: boolean): MarketplaceCalls => {
    const transaction = ++transactions

    return {
      async call(fn, args) {
        recorded.push({ args, kind: "call", name: fn, readOnly, transaction })
        const failure = failures[fn]?.shift()
        if (failure) throw failure
        return calls[fn] ?? []
      },
      fileListingReport: async () => { throw new Error("not used") },
      inquiryJobs: async () => [],
      inquiryParties: async () => null,
      landingStatement: async () => [],
      async query(name, values) {
        recorded.push({ args: values, kind: "query", name, readOnly, transaction })
        const failure = failures[name]?.shift()
        if (failure) throw failure
        return queries[name] ?? []
      },
      standingListingReport: async () => null,
      viewerSession: async () => ({ memberships: [], person: null })
    }
  }

  return {
    asAnon: async (work) => work(api()),
    asUser: async (_principal, work, options) => work(api(options?.readOnly)),
    close: async () => undefined
  }
}

/** The adapter with this group's live methods, whatever the catalogues hold today. */
function adapter(): MarketplaceBoostsPort {
  return createNormalizedMarketplaceV2({
    db: fakeDb(),
    features: { boosts: { methods: boostMethods, supported: false } },
    now: () => NOW,
    principal: async () => PRINCIPAL
  })
}

/** The fields of a `get_marketplace_job` row the methods read; the rest of the public row is passed through. */
function jobRow(overrides: Record<string, unknown> = {}) {
  return { job_id: JOB, poster_organization_id: ORG, status: "active", title: "Fir haul", ...overrides }
}

function estimateRow(overrides: Record<string, unknown> = {}) {
  return { active_availability_reports: 9, opted_in_haulers: 6, radius_miles: 100, ...overrides }
}

function boostRow(overrides: Record<string, unknown> = {}) {
  return {
    created_at: "2026-11-10T14:00:00+00:00",
    duration_days: 7,
    ends_at: "2026-11-17T15:00:00+00:00",
    id: BOOST_1,
    job_id: JOB,
    org_id: ORG,
    package_code: "quick",
    price_cents: 9900,
    radius_miles: 100,
    starts_at: "2026-11-10T15:00:00+00:00",
    status: "active",
    ...overrides
  }
}

beforeEach(() => {
  recorded = []
  transactions = 0
  calls = {
    count_boost_audience_trucks: [14],
    estimate_boost_audience: [estimateRow()],
    get_marketplace_job: [jobRow()]
  }
  queries = { boost_list: [boostRow()] }
  failures = {}
})

describe("boosts entry module", () => {
  it("states what every port method runs, and nothing for a method the port does not have", () => {
    expect(Object.keys(BOOST_METHOD_NEEDS).sort()).toEqual(marketplaceV2FeatureMethods("boosts").sort())
    expect(BOOST_METHOD_NEEDS).toEqual({
      boostAudience: { functions: ["get_marketplace_job", "estimate_boost_audience", "count_boost_audience_trucks"], statements: [] },
      listJobBoosts: { functions: [], statements: ["boost_list"] }
    })
  })

  it("withholds the whole group, reaching no store, until the catalogues hold everything it runs", async () => {
    // Today `count_boost_audience_trucks` (a new SQL function) and `boost_list` are not catalogued yet.
    expect(Object.prototype.hasOwnProperty.call(MARKETPLACE_FUNCTIONS, "count_boost_audience_trucks")).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(MARKETPLACE_QUERIES, "boost_list")).toBe(false)
    expect(boostsCatalogueReady()).toBe(false)
    expect(normalizedBoosts.supported).toBe(false)

    const port = createNormalizedMarketplaceV2({ db: fakeDb(), now: () => NOW, principal: async () => PRINCIPAL })

    for (const method of marketplaceV2FeatureMethods("boosts")) {
      const outcome = await (port[method] as (...values: unknown[]) => Promise<unknown>)(landing, JOB, "quick").then(() => null, (error: unknown) => error)

      expect(outcome, method).toBeInstanceOf(MarketplaceFeatureUnavailableError)
      expect((outcome as Error).message).toBe(`${MARKETPLACE_V2_FEATURE_OPERATIONS.boosts[method]} is not available yet`)
    }

    expect(recorded).toEqual([])
  })

  it("is ready once the catalogues hold every function and statement, and not one short", () => {
    const everything = {
      functions: new Set([...Object.keys(MARKETPLACE_FUNCTIONS), ...BOOST_FUNCTIONS]),
      statements: new Set([...Object.keys(MARKETPLACE_QUERIES), ...BOOST_STATEMENT_NAMES])
    }

    expect(boostsCatalogueReady(everything)).toBe(true)
    expect(boostMethodReady("listJobBoosts", { ...everything, statements: new Set(Object.keys(MARKETPLACE_QUERIES)) })).toBe(false)
    expect(boostMethodReady("boostAudience", { ...everything, functions: new Set(Object.keys(MARKETPLACE_FUNCTIONS)) })).toBe(false)
    expect(boostMethodReady("boostAudience", { ...everything, statements: new Set() })).toBe(true)
  })
})

describe("boost statements", () => {
  it("binds the active business as $1, checks a seated desk role in it, and never reads payment or purchaser details", () => {
    for (const name of BOOST_STATEMENT_NAMES) {
      const { text } = BOOST_STATEMENTS[name]

      expect(BOOST_STATEMENTS[name].args[0], name).toBe("uuid")
      expect(text).toContain("$1::text::uuid")
      expect(text).toContain("marketplace.has_org_role(jb.org_id, array['owner', 'manager', 'staff']::text[], true)")
      expect(text).not.toMatch(/provider_payment_ref|purchased_by|center_point|\bupdate\b|\binsert\b|\bdelete\b/i)
      // The shared catalogue's own rule: every table is schema-qualified.
      expect(text).not.toMatch(/\b(update|join|from)\s+(?!\s|marketplace\.|\(|set\b)/i)
    }
  })

  it("binds exactly its values and never puts one in the text", () => {
    expect(boostStatement("boost_list", [ORG, null])).toEqual({ text: BOOST_STATEMENTS.boost_list.text, values: [ORG, null] })
    expect(() => boostStatement("boost_list", [ORG])).toThrow(TypeError)
    expect(() => boostStatement("boost_list", [ORG, 7 as never])).toThrow(TypeError)
  })

  it("is not in the shared catalogue under another name, so nothing else can run it", () => {
    for (const { text } of Object.values(MARKETPLACE_QUERIES)) {
      expect(text).not.toBe(BOOST_STATEMENTS.boost_list.text)
    }
  })
})

describe("boostAudience", () => {
  it("counts in one read-only transaction: the job is the business's own, then the store's counts from fresh availability", async () => {
    const view = await adapter().boostAudience(landing, JOB.toUpperCase(), "extended")

    expect(view).toEqual({
      activeAvailabilityReports: 9,
      availableTrucks: 14,
      jobId: JOB,
      optedInHaulers: 6,
      packageCode: "extended",
      radiusMiles: 100
    })
    expect(recorded).toEqual([
      { args: { p_job_id: JOB }, kind: "call", name: "get_marketplace_job", readOnly: true, transaction: 1 },
      { args: { p_job_id: JOB, p_product_code: "extended" }, kind: "call", name: "estimate_boost_audience", readOnly: true, transaction: 1 },
      {
        args: { p_fresh_days: HAULER_AVAILABILITY_FRESH_DAYS, p_job_id: JOB, p_product_code: "extended" },
        kind: "call",
        name: "count_boost_audience_trucks",
        readOnly: true,
        transaction: 1
      }
    ])
  })

  it("passes the one freshness threshold the app shows availability with, so stale reports are never counted", async () => {
    await adapter().boostAudience(landing, JOB, "quick")

    expect(recorded.find((entry) => entry.name === "count_boost_audience_trucks")?.args).toMatchObject({ p_fresh_days: HAULER_AVAILABILITY_FRESH_DAYS })
  })

  it("reports zero trucks as zero, beside the businesses the store still counts", async () => {
    calls.count_boost_audience_trucks = [0]

    expect(await adapter().boostAudience(landing, JOB, "quick")).toMatchObject({ activeAvailabilityReports: 9, availableTrucks: 0, optedInHaulers: 6 })
  })

  it("refuses another business's job before counting anything (cross-tenant)", async () => {
    calls.get_marketplace_job = [jobRow({ poster_organization_id: OTHER_ORG })]

    await expect(adapter().boostAudience(landing, JOB, "quick")).rejects.toEqual(new MarketplaceRefusalError("Choose one of your business's jobs.", "P0002"))
    expect(recorded.map((entry) => entry.name)).toEqual(["get_marketplace_job"])
  })

  it("refuses a job the store does not show the person", async () => {
    calls.get_marketplace_job = []

    await expect(adapter().boostAudience(landing, JOB, "quick")).rejects.toMatchObject({ code: "P0002", message: "Choose one of your business's jobs." })
    expect(recorded.map((entry) => entry.name)).toEqual(["get_marketplace_job"])
  })

  it("says plainly when the person's role or landings do not cover the job", async () => {
    failures.estimate_boost_audience = [postgresError("not authorized for this job", "42501")]

    await expect(adapter().boostAudience(landing, JOB, "quick")).rejects.toEqual(
      new MarketplaceRefusalError("Your role can't see the boost audience for this job.", "42501")
    )
  })

  it("refuses a malformed job id or an unknown package before the store", async () => {
    await expect(adapter().boostAudience(landing, "job-1", "quick")).rejects.toMatchObject({ code: "22023", message: "Choose one of your business's jobs." })
    await expect(adapter().boostAudience(landing, JOB, "premium" as never)).rejects.toMatchObject({ code: "22023", message: "Choose a boost package." })
    expect(recorded).toEqual([])
  })

  it("fails closed on a count the store should never return", async () => {
    for (const bad of [[estimateRow({ phone: "555-0100" })], [estimateRow({ opted_in_haulers: -1 })], []]) {
      calls.estimate_boost_audience = bad

      await expect(adapter().boostAudience(landing, JOB, "quick")).rejects.toBeInstanceOf(MarketplaceStoreError)
    }

    calls.estimate_boost_audience = [estimateRow()]
    calls.count_boost_audience_trucks = [1.5]

    await expect(adapter().boostAudience(landing, JOB, "quick")).rejects.toBeInstanceOf(MarketplaceStoreError)
  })
})

describe("listJobBoosts", () => {
  it("reads the business's boosts, newest first, read-only, for one job or for all", async () => {
    queries.boost_list = [boostRow({ id: BOOST_2, status: "ended" }), boostRow()]

    const all = await adapter().listJobBoosts(landing, null)

    expect(all.map((boost) => [boost.id, boost.status])).toEqual([[BOOST_2, "ended"], [BOOST_1, "active"]])
    expect(all[1]).toEqual({
      createdAt: "2026-11-10T14:00:00.000Z",
      durationDays: 7,
      endsAt: "2026-11-17T15:00:00.000Z",
      id: BOOST_1,
      jobId: JOB,
      packageCode: "quick",
      priceCents: 9900,
      radiusMiles: 100,
      startsAt: "2026-11-10T15:00:00.000Z",
      status: "active"
    })

    await adapter().listJobBoosts(landing, JOB.toUpperCase())

    expect(recorded.map(({ args, name, readOnly }) => ({ args, name, readOnly }))).toEqual([
      { args: [ORG, null], name: "boost_list", readOnly: true },
      { args: [ORG, JOB], name: "boost_list", readOnly: true }
    ])
  })

  it("names no package for a product that is not in BOOST_PACKAGES", async () => {
    queries.boost_list = [boostRow({ package_code: null }), boostRow({ id: BOOST_2, package_code: "legacy_boost" })]

    expect((await adapter().listJobBoosts(landing, null)).map((boost) => boost.packageCode)).toEqual([null, null])
  })

  it("never returns another business's boost: a row of another business fails closed (cross-tenant)", async () => {
    queries.boost_list = [boostRow({ org_id: OTHER_ORG })]

    await expect(adapter().listJobBoosts(landing, null)).rejects.toBeInstanceOf(MarketplaceStoreError)
  })

  it("fails closed on a private column or a window the store cannot hold", async () => {
    const bad = [
      boostRow({ provider_payment_ref: "pi_123" }),
      boostRow({ purchased_by: ORG }),
      boostRow({ ends_at: null }),
      boostRow({ ends_at: null, starts_at: null }),
      boostRow({ status: "expired" })
    ]

    for (const row of bad) {
      queries.boost_list = [row]

      await expect(adapter().listJobBoosts(landing, null), JSON.stringify(row)).rejects.toBeInstanceOf(MarketplaceStoreError)
    }

    queries.boost_list = [boostRow({ ends_at: null, starts_at: null, status: "pending_payment" })]

    expect(await adapter().listJobBoosts(landing, null)).toMatchObject([{ endsAt: null, startsAt: null, status: "pending_payment" }])
  })

  it("refuses a malformed job id before the store", async () => {
    await expect(adapter().listJobBoosts(landing, "job-1")).rejects.toMatchObject({ code: "22023" })
    expect(recorded).toEqual([])
  })
})

describe("no purchase", () => {
  it("has no way to buy, activate or renew a boost: two read methods, and no write transaction", async () => {
    const methods = boostMethods({
      asAccount: async () => { throw new Error("not used") },
      asViewer: async (_viewer, work, options) => {
        recorded.push({ args: null, kind: "call", name: "transaction", readOnly: options.readOnly, transaction: 0 })
        return work(await fakeDb().asUser(PRINCIPAL, async (api) => api))
      },
      now: () => NOW
    })

    expect(Object.keys(methods).sort()).toEqual(["boostAudience", "listJobBoosts"])

    await methods.boostAudience(landing, JOB, "quick")
    await methods.listJobBoosts(landing, null)

    expect(recorded.filter((entry) => entry.name === "transaction").map((entry) => entry.readOnly)).toEqual([true, true])
    expect(Object.keys(MARKETPLACE_FUNCTIONS).filter((name) => /boost/.test(name))).toEqual(["estimate_boost_audience"])
    expect(BOOST_FUNCTIONS).not.toContain("activate_job_boost")
  })
})

describe("boost row mapping", () => {
  it("maps the estimate row and the truck count into the audience view", () => {
    expect(audienceFromRows(JOB, "campaign", [estimateRow({ radius_miles: 100 })], [3])).toEqual({
      activeAvailabilityReports: 9,
      availableTrucks: 3,
      jobId: JOB,
      optedInHaulers: 6,
      packageCode: "campaign",
      radiusMiles: 100
    })
    expect(() => audienceFromRows(JOB, "quick", [estimateRow()], [])).toThrow(MarketplaceStoreError)
  })

  it("maps a boost row for the active business only", () => {
    expect(boostFromRow(boostRow(), ORG).id).toBe(BOOST_1)
    expect(() => boostFromRow(boostRow(), OTHER_ORG)).toThrow(MarketplaceStoreError)
  })
})
