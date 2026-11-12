import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  MARKETPLACE_TRUCK_CARD_KEYS,
  TRUCK_DIRECTORY_PAGE_SIZE,
  TRUCK_DIRECTORY_REFUSALS,
  type MarketplaceTruckCardView
} from "@logloads/contracts"
import { truckAlertDedupeKey, type TruckAlertCandidate } from "@logloads/services"

import { runTruckAlertMatching, type TruckAlertWorkerSearch, type TruckAlertWorkerStore } from "./alert-worker"
import {
  TRUCK_DIRECTORY_ROBOTS,
  TRUCK_METHOD_NEEDS,
  missingTruckCatalogueEntries,
  normalizedTrucks,
  truckMethods,
  trucksCatalogueReady
} from "./index"
import { savedTruckSearchFromRow, truckEntryFromRow } from "./mapping"
import { TRUCK_DIRECTORY_QUERY_LIMIT, TRUCK_FUNCTION_NAMES, TRUCK_STATEMENTS, TRUCK_STATEMENT_NAMES, truckStatement, type TruckStatementName } from "./statements"
import type { NormalizedFeatureContext } from "../normalized-adapter"
import { MARKETPLACE_FUNCTIONS, type MarketplaceCalls } from "../normalized-db"
import { MARKETPLACE_QUERIES } from "../normalized-queries"
import {
  MarketplaceFeatureUnavailableError,
  MarketplaceRefusalError,
  MarketplaceStoreError,
  marketplaceV2FeatureMethods,
  type MarketplaceV2Viewer
} from "../port"

const CLERK = "user_clerk_landing"
const LANDING = "33333333-bbbb-4bbb-8bbb-333333333333"
const HAULER = "44444444-cccc-4ccc-8ccc-444444444444"
const HAULER_B = "55555555-dddd-4ddd-8ddd-555555555555"
const SEARCH = "66666666-eeee-4eee-8eee-666666666666"
const REPORT = "77777777-ffff-4fff-8fff-777777777777"
const NOW = new Date("2026-11-10T12:00:00.000Z")
const viewer: MarketplaceV2Viewer = { organizationId: LANDING, userId: CLERK }

/** Columns and tables a directory or alert must never read: contact data, private text and exact points. */
const PRIVATE_SQL = /phone|email|user_contacts|exact_point|landing_private|description|headline|capacity_note|legal_name|photo_path|unit_label/i

const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString()

function accessRow(overrides: Record<string, unknown> = {}) {
  return {
    capabilities: ["job.publish", "landing.manage", "inquiry.respond"],
    hauler_profile: false,
    landing_workspace_seat: true,
    organization_id: LANDING,
    organization_name: "Cascade Landing Co",
    role: "owner",
    ...overrides
  }
}

function entitlementRow(planCode: string | null) {
  return {
    active_landings: 1,
    fleet_only_members: 0,
    grace_ends_at: null,
    invitations_remaining: planCode ? 3 : 0,
    landing_conflict: false,
    max_active_landings: planCode ? 1 : null,
    max_team_members: planCode ? 2 : null,
    paid_landing_seats: 1,
    period_end: planCode ? "2026-12-01T00:00:00+00:00" : null,
    plan_code: planCode,
    seat_conflict: false,
    subscription_status: planCode ? "active" : null
  }
}

function identityRow(status: string) {
  return { org_id: LANDING, verification_status: status, verified_at: status === "verified" ? "2026-10-14T16:00:00+00:00" : null }
}

function directoryRow(overrides: Record<string, unknown> = {}) {
  return {
    accepts_targeted_invitations: true,
    availability: [{
      available_count: 2,
      available_from: "2026-11-10",
      available_until: "2026-11-17",
      equipment_code: "log_truck",
      id: REPORT,
      reported_at: "2026-11-09T12:00:00+00:00"
    }],
    base_area_label: "Sweet Home, OR",
    display_name: "Sweet Home Hauling",
    equipment: [{ equipment_code: "log_truck", paired_trailer_code: "pole_trailer", unit_count: 3 }],
    is_public: true,
    operating_states: ["OR"],
    org_id: HAULER,
    service_lat: 44.4,
    service_lng: -122.7,
    service_radius_miles: 80,
    verification_status: "unverified",
    verified_at: null,
    ...overrides
  }
}

function grantRow(views: number, allowed = true, pagesUsed = 1, viewsUsed = views) {
  return { allowed, pages_used: pagesUsed, views_granted: allowed ? views : 0, views_used: viewsUsed }
}

interface Recorded { kind: "call" | "query"; name: string; args: unknown; readOnly: boolean }

let recorded: Recorded[]
let functions: Record<string, (args: Record<string, unknown>) => unknown[]>
let statements: Partial<Record<TruckStatementName, unknown[]>>
let context: NormalizedFeatureContext

function fakeContext(): NormalizedFeatureContext {
  let readOnly = true
  const calls: MarketplaceCalls = {
    async call(fn, args) {
      recorded.push({ args, kind: "call", name: fn, readOnly })
      return functions[fn]?.(args as Record<string, unknown>) ?? []
    },
    fileListingReport: async () => { throw new Error("not used") },
    inquiryJobs: async () => [],
    inquiryParties: async () => null,
    landingStatement: async () => [],
    async query(name, values) {
      // The same binder the methods use: a value of the wrong type or count never reaches SQL.
      const bound = truckStatement(name as TruckStatementName, values)
      recorded.push({ args: bound.values, kind: "query", name, readOnly })
      return statements[name as TruckStatementName] ?? []
    },
    standingListingReport: async () => null,
    viewerSession: async () => ({ memberships: [], person: null })
  }

  return {
    asAccount: async (_account, work, options) => { readOnly = options.readOnly; return work(calls) },
    asViewer: async (_viewer, work, options) => { readOnly = options.readOnly; return work(calls) },
    now: () => NOW
  }
}

/** A reviewed landing business on `plan`, with a desk seat. */
function landingOn(plan: string | null = "pro", status = "verified", access: Record<string, unknown> = {}) {
  functions.get_viewer_marketplace_access = () => [accessRow(access)]
  functions.get_org_entitlement_state = () => [entitlementRow(plan)]
  statements.truck_viewer_identity = [identityRow(status)]
}

const names = (kind: Recorded["kind"]) => recorded.filter((entry) => entry.kind === kind).map((entry) => entry.name)

beforeEach(() => {
  recorded = []
  functions = {
    record_truck_directory_page: (args) => [grantRow(Number(args.p_views))]
  }
  statements = { truck_directory: [directoryRow()] }
  context = fakeContext()
  landingOn()
})

describe("the group as it ships", () => {
  it("is not supported and refuses every method without reaching a store until the catalogue has its SQL", async () => {
    expect(trucksCatalogueReady()).toBe(false)
    expect(normalizedTrucks.supported).toBe(false)

    const methods = normalizedTrucks.methods(context)

    for (const method of marketplaceV2FeatureMethods("trucks")) {
      const call = (methods[method] as (...args: unknown[]) => Promise<unknown>)(viewer, {})

      await expect(call).rejects.toBeInstanceOf(MarketplaceFeatureUnavailableError)
    }
    expect(recorded).toEqual([])
  })

  it("names exactly the catalogue entries it is waiting for", () => {
    expect(missingTruckCatalogueEntries()).toEqual({
      functions: ["record_truck_directory_page"],
      statements: [...TRUCK_STATEMENT_NAMES]
    })
    expect(trucksCatalogueReady({
      functions: new Set([...Object.keys(MARKETPLACE_FUNCTIONS), ...TRUCK_FUNCTION_NAMES]),
      statements: new Set([...Object.keys(MARKETPLACE_QUERIES), ...TRUCK_STATEMENT_NAMES])
    })).toBe(true)
  })

  it("lists what every port method runs", () => {
    expect(Object.keys(TRUCK_METHOD_NEEDS).sort()).toEqual([...marketplaceV2FeatureMethods("trucks")].sort())
    expect(TRUCK_METHOD_NEEDS.searchTrucks).toEqual({
      functions: ["get_viewer_marketplace_access", "get_org_entitlement_state", "record_truck_directory_page"],
      statements: ["truck_viewer_identity", "truck_directory"]
    })
  })

  it("matches the catalogue for every statement the catalogue already has", () => {
    for (const name of TRUCK_STATEMENT_NAMES) {
      const catalogued = (MARKETPLACE_QUERIES as Record<string, { args: readonly string[]; text: string } | undefined>)[name]

      if (catalogued) {
        expect(catalogued).toEqual(TRUCK_STATEMENTS[name])
      }
    }
  })
})

describe("the SQL (privacy and the legal rules)", () => {
  it("never reads a contact field, private text or an exact point", () => {
    for (const name of TRUCK_STATEMENT_NAMES) {
      expect(TRUCK_STATEMENTS[name].text).not.toMatch(PRIVATE_SQL)
    }
  })

  it("lists only businesses that chose to be, never the landing's own, and only to a reviewed landing seat", () => {
    const text = TRUCK_STATEMENTS.truck_directory.text

    expect(text).toContain("where h.is_public")
    expect(text).toContain("h.org_id <> $1::text::uuid")
    expect(text).toContain("marketplace.has_org_role($1::text::uuid, array['owner', 'manager', 'staff']::text[], true)")
    expect(text).toContain("v.verification_status = 'verified'")
    expect(text).toContain("o.status = 'active'")
  })

  it("rounds every point to the public 0.1° grid and never orders by the identity review", () => {
    const text = TRUCK_STATEMENTS.truck_directory.text
    const order = text.slice(text.lastIndexOf("order by"))

    expect(text).toContain("round(extensions.st_y(h.service_center::extensions.geometry)::numeric, 1) as service_lat")
    expect(text).toContain("round(extensions.st_x(h.service_center::extensions.geometry)::numeric, 1) as service_lng")
    expect(order).not.toMatch(/verif|review/)
    expect(text).toContain(`least(greatest($3::text::integer, 1), ${TRUCK_DIRECTORY_QUERY_LIMIT})`)
  })

  it("keeps saved searches to the person's own truck searches, and writes only with availability alerts", () => {
    for (const name of ["truck_list_searches", "truck_insert_search", "truck_update_search", "truck_delete_search"] as const) {
      expect(TRUCK_STATEMENTS[name].text).toMatch(/'trucks'/)
    }
    for (const name of ["truck_list_searches", "truck_update_search", "truck_delete_search"] as const) {
      expect(TRUCK_STATEMENTS[name].text).toContain("owner_user_id = marketplace.current_user_id()")
    }
    for (const name of ["truck_insert_search", "truck_update_search"] as const) {
      expect(TRUCK_STATEMENTS[name].text).toContain("marketplace.org_has_feature($1::text::uuid, 'availability_alerts')")
    }
    expect(TRUCK_STATEMENTS.truck_insert_search.text).not.toContain("owner_user_id")
  })

  it("binds values by type and count", () => {
    expect(truckStatement("truck_directory", [LANDING, null, 200]).values).toEqual([LANDING, null, "200"])
    expect(() => truckStatement("truck_directory", [LANDING, null])).toThrow(TypeError)
    expect(() => truckStatement("truck_directory", ["not-a-uuid", null, 200])).toThrow(TypeError)
    expect(() => truckStatement("truck_insert_search", [LANDING, "x", "{}", "true"])).toThrow(TypeError)
  })
})

describe("row mapping", () => {
  it("rounds the service point to the 0.1° grid whatever the row says", () => {
    expect(truckEntryFromRow(directoryRow({ service_lat: 44.396123, service_lng: -122.735512 })).servicePoint).toEqual({ lat: 44.4, lng: -122.7 })
    expect(truckEntryFromRow(directoryRow({ service_lat: "44.4", service_lng: "-122.7" })).servicePoint).toEqual({ lat: 44.4, lng: -122.7 })
    expect(truckEntryFromRow(directoryRow({ service_lat: null, service_lng: null })).servicePoint).toBeNull()
  })

  it("fails closed on a row that carries a contact field", () => {
    expect(() => truckEntryFromRow(directoryRow({ phone: "541-555-0100" }))).toThrow(MarketplaceStoreError)
    expect(() => truckEntryFromRow(directoryRow({ email: "owner@example.com" }))).toThrow(MarketplaceStoreError)
    expect(() => truckEntryFromRow({ ...directoryRow(), availability: [{ ...directoryRow().availability[0], note: "call 541-555-0100" }] })).toThrow(MarketplaceStoreError)
  })

  it("reads the identity review as a dated mark, and anything else as none", () => {
    expect(truckEntryFromRow(directoryRow({ verification_status: "verified", verified_at: "2026-10-14T16:00:00+00:00" })).verification)
      .toEqual({ reviewedOn: "2026-10-14", scope: "business_identity" })
    expect(truckEntryFromRow(directoryRow({ verification_status: "pending" })).verification).toBeNull()
  })

  it("reads a saved truck search and refuses a job search", () => {
    const row = {
      alerts_enabled: true,
      criteria: { equipment: ["log_truck"], identityReviewedOnly: false, near: { lat: 44.4, lng: -122.7 }, place: "Sweet Home", radiusMiles: 60 },
      id: SEARCH,
      kind: "trucks",
      last_alerted_at: null,
      name: "Near the landing",
      updated_at: "2026-11-09T12:00:00+00:00"
    }

    expect(savedTruckSearchFromRow(row)).toEqual({
      alertsEnabled: true,
      criteria: row.criteria,
      id: SEARCH,
      kind: "trucks",
      lastAlertedAt: null,
      name: "Near the landing",
      updatedAt: "2026-11-09T12:00:00.000Z"
    })
    expect(() => savedTruckSearchFromRow({ ...row, kind: "jobs" })).toThrow(MarketplaceStoreError)
  })
})

describe("searchTrucks", () => {
  it("returns cards with only the card keys, on the public grid, from one read-write transaction", async () => {
    statements.truck_directory = [directoryRow({ service_lat: 44.396123, service_lng: -122.735512 })]

    const cards = await truckMethods(context).searchTrucks(viewer, {})

    expect(cards).toHaveLength(1)
    expect(Object.keys(cards[0] as MarketplaceTruckCardView).sort()).toEqual([...MARKETPLACE_TRUCK_CARD_KEYS].sort())
    expect(cards[0]?.approximatePoint).toEqual({ lat: 44.4, lng: -122.7 })
    expect(JSON.stringify(cards)).not.toMatch(/phone|email|@|44\.396|122\.735/)
    expect(recorded.every((entry) => entry.readOnly === false)).toBe(true)
    expect(recorded.find((entry) => entry.name === "truck_directory")?.args).toEqual([LANDING, null, String(TRUCK_DIRECTORY_QUERY_LIMIT)])
  })

  it("refuses a landing whose identity was not reviewed, before reading the directory", async () => {
    landingOn("pro", "pending")

    await expect(truckMethods(context).searchTrucks(viewer, {})).rejects.toMatchObject({
      code: "42501",
      message: TRUCK_DIRECTORY_REFUSALS.identity_not_reviewed
    })
    expect(names("query")).not.toContain("truck_directory")
    expect(names("call")).not.toContain("record_truck_directory_page")
  })

  it("refuses a member without a Landing Operator seat, and a business without a plan", async () => {
    landingOn("pro", "verified", { landing_workspace_seat: false, role: "staff" })
    await expect(truckMethods(context).searchTrucks(viewer, {})).rejects.toMatchObject({ code: "42501", message: TRUCK_DIRECTORY_REFUSALS.no_landing_seat })

    landingOn("pro", "verified", { landing_workspace_seat: false, role: "driver" })
    await expect(truckMethods(context).searchTrucks(viewer, {})).rejects.toMatchObject({ code: "42501", message: TRUCK_DIRECTORY_REFUSALS.no_landing_seat })

    landingOn(null)
    await expect(truckMethods(context).searchTrucks(viewer, {})).rejects.toMatchObject({ code: "42501", message: TRUCK_DIRECTORY_REFUSALS.no_plan })
    expect(names("query")).not.toContain("truck_directory")
  })

  it("refuses a person who is not a member of the active business", async () => {
    functions.get_viewer_marketplace_access = () => []

    await expect(truckMethods(context).searchTrucks(viewer, {})).rejects.toMatchObject({ code: "42501" })
    expect(names("query")).not.toContain("truck_directory")
  })

  it("works on Basic: the directory is not a Pro feature", async () => {
    landingOn("basic")

    await expect(truckMethods(context).searchTrucks(viewer, {})).resolves.toHaveLength(1)
  })

  it("trips the daily page and card limits with a plain refusal and no cards", async () => {
    functions.record_truck_directory_page = () => [grantRow(0, false, 40, 120)]
    await expect(truckMethods(context).searchTrucks(viewer, {})).rejects.toMatchObject({
      code: "23514",
      message: TRUCK_DIRECTORY_REFUSALS.daily_page_limit
    })

    functions.record_truck_directory_page = () => [grantRow(0, false, 12, 400)]
    await expect(truckMethods(context).searchTrucks(viewer, {})).rejects.toBeInstanceOf(MarketplaceRefusalError)
    await expect(truckMethods(context).searchTrucks(viewer, {})).rejects.toMatchObject({ message: TRUCK_DIRECTORY_REFUSALS.daily_view_limit })
  })

  it("shows only the cards the store granted, and counts every page, even an empty one", async () => {
    statements.truck_directory = Array.from({ length: 60 }, (_, index) => directoryRow({
      display_name: `Hauler ${String(index).padStart(2, "0")}`,
      org_id: `88888888-0000-4000-8000-${String(index).padStart(12, "0")}`
    }))
    functions.record_truck_directory_page = () => [grantRow(7, true, 3, 400)]

    const cards = await truckMethods(context).searchTrucks(viewer, {})
    const page = recorded.find((entry) => entry.name === "record_truck_directory_page")

    expect(cards).toHaveLength(7)
    expect(page?.args).toEqual({ p_org_id: LANDING, p_views: TRUCK_DIRECTORY_PAGE_SIZE })

    recorded = []
    statements.truck_directory = []
    functions.record_truck_directory_page = (args) => [grantRow(Number(args.p_views))]

    await expect(truckMethods(context).searchTrucks(viewer, {})).resolves.toEqual([])
    expect(recorded.find((entry) => entry.name === "record_truck_directory_page")?.args).toEqual({ p_org_id: LANDING, p_views: 0 })
  })

  it("never shows a hidden business, even if a row slips through", async () => {
    statements.truck_directory = [directoryRow({ is_public: false }), directoryRow({ org_id: HAULER_B })]

    const cards = await truckMethods(context).searchTrucks(viewer, {})

    expect(cards.map((card) => card.organizationId)).toEqual([HAULER_B])
  })

  it("never shows stale availability as current", async () => {
    statements.truck_directory = [directoryRow({
      availability: [{ ...directoryRow().availability[0], reported_at: "2026-10-30T12:00:00+00:00" }]
    })]

    const [card] = await truckMethods(context).searchTrucks(viewer, {})

    expect(card?.availability.status).toBe("not_recently_confirmed")
    expect(card?.availableTrucks).toBeNull()
    expect(card?.availability.label).toBe("Not recently confirmed. Sweet Home Hauling last confirmed 11 days ago")
    await expect(truckMethods(context).searchTrucks(viewer, { availableOnly: true })).resolves.toEqual([])
  })

  it("orders by the named key and ignores the identity mark", async () => {
    const fresh = directoryRow({ display_name: "Cedar Haul", org_id: HAULER })
    const older = directoryRow({
      availability: [{ ...directoryRow().availability[0], id: "77777777-ffff-4fff-8fff-000000000002", reported_at: "2026-11-06T12:00:00+00:00" }],
      display_name: "Alder Trucking",
      org_id: HAULER_B,
      verification_status: "verified",
      verified_at: "2026-10-14T16:00:00+00:00"
    })

    statements.truck_directory = [older, fresh]
    expect((await truckMethods(context).searchTrucks(viewer, {})).map((card) => card.businessName)).toEqual(["Cedar Haul", "Alder Trucking"])

    statements.truck_directory = [{ ...older, verification_status: "unverified", verified_at: null }, { ...fresh, verification_status: "verified", verified_at: "2026-10-14T16:00:00+00:00" }]
    expect((await truckMethods(context).searchTrucks(viewer, {})).map((card) => card.businessName)).toEqual(["Cedar Haul", "Alder Trucking"])

    expect((await truckMethods(context).searchTrucks(viewer, { sort: "name" })).map((card) => card.businessName)).toEqual(["Alder Trucking", "Cedar Haul"])
    expect((await truckMethods(context).searchTrucks(viewer, { identityReviewedOnly: true })).map((card) => card.businessName)).toEqual(["Cedar Haul"])
  })

  it("passes the equipment filter to the store and refuses bad filters before any read", async () => {
    await truckMethods(context).searchTrucks(viewer, { equipment: "pole_trailer" })
    expect(recorded.find((entry) => entry.name === "truck_directory")?.args).toEqual([LANDING, "pole_trailer", String(TRUCK_DIRECTORY_QUERY_LIMIT)])

    recorded = []
    await expect(truckMethods(context).searchTrucks(viewer, { sort: "best_match" } as never)).rejects.toMatchObject({ code: "22023" })
    await expect(truckMethods(context).searchTrucks(viewer, { query: "owner@example.com" })).rejects.toMatchObject({ code: "22023" })
    expect(recorded).toEqual([])
  })
})

describe("saved truck searches", () => {
  const input = { alertsEnabled: true, criteria: { equipment: ["log_truck"] }, name: "Log trucks" }

  it("saves on a plan with availability alerts, as kind trucks for the active business", async () => {
    statements.truck_insert_search = [{ id: SEARCH }]

    await expect(truckMethods(context).saveTruckSearch(viewer, input)).resolves.toEqual({ searchId: SEARCH })

    const insert = recorded.find((entry) => entry.name === "truck_insert_search")

    expect(insert?.readOnly).toBe(false)
    expect(insert?.args).toEqual([
      LANDING,
      "Log trucks",
      JSON.stringify({ equipment: ["log_truck"], identityReviewedOnly: false, near: null, place: null, radiusMiles: null }),
      "true"
    ])
  })

  it("refuses Basic, and an unreviewed landing, before any write", async () => {
    landingOn("basic")
    await expect(truckMethods(context).saveTruckSearch(viewer, input)).rejects.toMatchObject({ code: "42501", message: TRUCK_DIRECTORY_REFUSALS.alerts_not_in_plan })

    landingOn("pro", "unverified")
    await expect(truckMethods(context).saveTruckSearch(viewer, input)).rejects.toMatchObject({ code: "42501", message: TRUCK_DIRECTORY_REFUSALS.identity_not_reviewed })
    expect(names("query").filter((name) => name.startsWith("truck_insert") || name.startsWith("truck_update"))).toEqual([])
  })

  it("edits only one of the person's own searches, and says when it is not found", async () => {
    statements.truck_update_search = [{ id: SEARCH }]
    await expect(truckMethods(context).saveTruckSearch(viewer, { ...input, searchId: SEARCH })).resolves.toEqual({ searchId: SEARCH })
    expect((recorded.find((entry) => entry.name === "truck_update_search")?.args as unknown[] | undefined)?.slice(0, 2)).toEqual([LANDING, SEARCH])

    statements.truck_update_search = []
    await expect(truckMethods(context).saveTruckSearch(viewer, { ...input, searchId: SEARCH })).rejects.toMatchObject({ code: "P0002" })
  })

  it("refuses an input that names an owner or another business", async () => {
    await expect(truckMethods(context).saveTruckSearch(viewer, { ...input, organizationId: HAULER })).rejects.toMatchObject({ code: "22023" })
    expect(recorded).toEqual([])
  })

  it("lists and deletes the person's own searches", async () => {
    statements.truck_list_searches = [{
      alerts_enabled: false,
      criteria: { equipment: [], identityReviewedOnly: false, near: null, place: null, radiusMiles: null },
      id: SEARCH,
      kind: "trucks",
      last_alerted_at: "2026-11-09T12:00:00+00:00",
      name: "Paused",
      updated_at: "2026-11-09T12:00:00+00:00"
    }]

    const searches = await truckMethods(context).listTruckSearches(viewer)

    expect(searches.map((search) => [search.id, search.kind, search.alertsEnabled])).toEqual([[SEARCH, "trucks", false]])
    expect(recorded.find((entry) => entry.name === "truck_list_searches")?.readOnly).toBe(true)

    statements.truck_delete_search = [{ changed: true }]
    await expect(truckMethods(context).deleteTruckSearch(viewer, SEARCH)).resolves.toBeUndefined()

    statements.truck_delete_search = []
    await expect(truckMethods(context).deleteTruckSearch(viewer, SEARCH)).rejects.toMatchObject({ code: "42501" })
    await expect(truckMethods(context).deleteTruckSearch(viewer, "not-an-id")).rejects.toMatchObject({ code: "22023" })
  })
})

describe("availability alert matching (the worker)", () => {
  const consented = [{ channel: "in_app", enabled: true }, { channel: "email", enabled: true }]

  function workerSearch(overrides: Partial<TruckAlertWorkerSearch> = {}): TruckAlertWorkerSearch {
    return {
      alertsEnabled: true,
      consents: consented,
      criteria: { equipment: ["log_truck"], identityReviewedOnly: false, near: null, place: null, radiusMiles: null },
      id: SEARCH,
      name: "Log trucks",
      organizationId: LANDING,
      since: hoursAgo(48),
      ...overrides
    }
  }

  function candidate(overrides: Partial<TruckAlertCandidate> = {}): TruckAlertCandidate {
    return {
      areaLabel: "Sweet Home, OR",
      areaPoint: { lat: 44.4, lng: -122.7 },
      availableCount: 2,
      availableFrom: "2026-11-10",
      availableUntil: "2026-11-17",
      businessName: "Sweet Home Hauling",
      equipmentCode: "log_truck",
      identityReviewed: false,
      listed: true,
      listedEquipment: ["log_truck"],
      organizationId: HAULER,
      reportId: REPORT,
      reportedAt: hoursAgo(2),
      ...overrides
    }
  }

  /** A store that, like `enqueue_notification`, writes each dedupe key once and only on a consented channel. */
  function fakeWorkerStore(searches: TruckAlertWorkerSearch[], candidates: TruckAlertCandidate[]) {
    const outbox = new Set<string>()
    const handedOver: Array<{ searchId: string; reportIds: readonly string[] }> = []
    const since: string[] = []
    const store: TruckAlertWorkerStore = {
      alertingTruckSearches: async () => searches,
      truckAlertCandidates: async (from) => { since.push(from); return candidates },
      async enqueueTruckAlerts(searchId, reportIds) {
        handedOver.push({ reportIds, searchId })
        const search = searches.find((item) => item.id === searchId)
        let queued = 0

        for (const reportId of reportIds) {
          for (const consent of search?.consents ?? []) {
            if (!consent.enabled || (consent.channel !== "in_app" && consent.channel !== "email")) continue
            const key = truckAlertDedupeKey(searchId, reportId, consent.channel)
            if (!outbox.has(key)) { outbox.add(key); queued += 1 }
          }
        }

        return { queued }
      }
    }

    return { handedOver, outbox, since, store }
  }

  it("queues each matching report once per consented channel, and a second run queues nothing", async () => {
    const fake = fakeWorkerStore([workerSearch()], [candidate()])

    await expect(runTruckAlertMatching(fake.store, NOW)).resolves.toEqual({ failed: 0, handedOver: 1, queued: 2, searches: 1 })
    await expect(runTruckAlertMatching(fake.store, NOW)).resolves.toEqual({ failed: 0, handedOver: 1, queued: 0, searches: 1 })
    expect([...fake.outbox].sort()).toEqual([
      truckAlertDedupeKey(SEARCH, REPORT, "email"),
      truckAlertDedupeKey(SEARCH, REPORT, "in_app")
    ])
    expect(fake.since[0]).toBe(hoursAgo(24 * 7))
  })

  it("never hands over a hidden business or the landing's own, and never uses SMS", async () => {
    const fake = fakeWorkerStore(
      [workerSearch({ consents: [...consented, { channel: "sms", enabled: true }] })],
      [candidate({ listed: false }), candidate({ organizationId: LANDING, reportId: "77777777-ffff-4fff-8fff-000000000003" })]
    )

    await expect(runTruckAlertMatching(fake.store, NOW)).resolves.toMatchObject({ handedOver: 0, queued: 0 })
    expect(fake.handedOver).toEqual([])
    expect([...fake.outbox].some((key) => key.endsWith(":sms"))).toBe(false)
  })

  it("skips a search without consent, and keeps going when one search fails", async () => {
    const failing = workerSearch({ id: "99999999-aaaa-4aaa-8aaa-999999999999" })
    const fake = fakeWorkerStore([workerSearch({ consents: [] }), failing, workerSearch({ id: "99999999-bbbb-4bbb-8bbb-999999999999" })], [candidate()])
    const enqueue = fake.store.enqueueTruckAlerts.bind(fake.store)

    fake.store.enqueueTruckAlerts = async (searchId, reportIds) => {
      if (searchId === failing.id) throw new Error("store unavailable")
      return enqueue(searchId, reportIds)
    }

    await expect(runTruckAlertMatching(fake.store, NOW)).resolves.toEqual({ failed: 1, handedOver: 1, queued: 2, searches: 3 })
  })
})

describe("signed-out surfaces (legal review §6.5 item 4)", () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")

  it("the V2 pages, where Find Trucks lives, carry noindex", () => {
    expect(TRUCK_DIRECTORY_ROBOTS).toEqual({ follow: false, index: false })
    expect(read("../../../app/v2/layout.tsx")).toContain("robots: { follow: false, index: false }")
  })

  it("the sitemap lists no V2 page, so no hauler profile or directory page", () => {
    const sitemap = read("../../../app/sitemap.ts")

    expect(sitemap).not.toMatch(/["'`]\/v2/)
    expect(sitemap).not.toMatch(/\/trucks|\/haulers\//)
  })
})
