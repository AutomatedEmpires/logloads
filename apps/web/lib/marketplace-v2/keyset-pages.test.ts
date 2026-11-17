import { describe, expect, it } from "vitest"

import { sortMarketplaceJobs, type MarketplaceInterestView, type MarketplaceJobDetailView, type MarketplaceJobFilters } from "@logloads/contracts"

import {
  encodeKeysetCursor,
  KEYSET_CURSOR_MAX_LENGTH,
  KEYSET_PAGE_DEFAULT_LIMIT,
  KEYSET_PAGE_MAX_LIMIT,
  keysetFingerprint,
  keysetLimit,
  marketplaceInterestPage,
  marketplaceJobPage,
  readKeysetCursor
} from "./keyset-pages"
import type { MarketplacePage } from "./port"

/**
 * Keyset pages (#280; quality bar B4): every page of a list is cut by the last row's order key, bound to the query it
 * was read for. These are the rules both adapters page with, so they hold for the pilot and the normalized store alike.
 */

const POSTER = "22222222-aaaa-4aaa-8aaa-222222222222"
const HAULER = "33333333-bbbb-4bbb-8bbb-333333333333"
const RIVAL = "44444444-cccc-4ccc-8ccc-444444444444"

function job(index: number, overrides: Partial<MarketplaceJobDetailView> = {}): MarketplaceJobDetailView {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
  return {
    acceptingInterest: true,
    destinationLabel: null,
    endsOn: null,
    equipment: ["log_truck"],
    estimatedDailyLoads: null,
    estimatedLoadsPerTruckPerDay: null,
    estimatedTonsPerLoad: null,
    expiresAt: null,
    haulDistance: null,
    id,
    // Every fourth job was confirmed; the rest are ordered by last edit, several on the same minute.
    lastConfirmedAt: index % 4 === 0 ? new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString() : null,
    lastModifiedAt: new Date(Date.UTC(2026, 10, 1, 0, Math.floor(index / 3))).toISOString(),
    origin: { approximatePoint: { lat: 44 + (index % 7) / 10, lng: -122.5 }, label: "Oakridge, OR", stateCode: "OR" },
    pay: { amountCents: 40_000 + (index % 5) * 1_000, note: null, unit: index % 2 === 0 ? "per_load" : "per_ton" },
    posterName: "Example Timber Co",
    posterOrganizationId: POSTER,
    posterVerification: null,
    product: "Saw logs",
    publicAccessRequirements: [],
    publicRoadNotes: null,
    scheduleNote: null,
    slug: id,
    sponsored: false,
    startsOn: null,
    status: "active",
    // Shared titles, so the order needs the id to be total.
    title: `Saw log run ${index % 3}`,
    trucks: { perDay: null, total: 2 },
    ...overrides
  }
}

const NEAR = { lat: 44.4, lng: -122.7 }
const SORTS: MarketplaceJobFilters[] = [{ sort: "newest" }, { near: NEAR, sort: "nearest" }, { sort: "pay" }]

/** Every page of `ordered`, following each page's cursor, as the pages would. */
function allPages<T>(read: (after: string | null) => MarketplacePage<T>): MarketplacePage<T>[] {
  const pages: MarketplacePage<T>[] = []
  let after: string | null = null

  do {
    const page = read(after)
    pages.push(page)
    after = page.nextCursor
  } while (after !== null && pages.length < 50)

  return pages
}

const ids = <T extends { id: string }>(items: readonly T[]) => items.map((item) => item.id)

describe("cursors are bound to their query", () => {
  it("fingerprints a query the same way whatever order its fields were written in", () => {
    expect(keysetFingerprint({ a: 1, b: [2, { c: 3, d: null }] })).toBe(keysetFingerprint({ b: [2, { d: null, c: 3 }], a: 1 }))
    expect(keysetFingerprint({ a: 1 })).toBe(keysetFingerprint({ a: 1, b: undefined }))
    expect(keysetFingerprint({ a: 1 })).not.toBe(keysetFingerprint({ a: 2 }))
    expect(keysetFingerprint({ a: 1 })).not.toBe(keysetFingerprint({ a: 1, b: null }))
  })

  it("reads a cursor back only for the query it was made for, and refuses anything malformed without throwing", () => {
    const fingerprint = keysetFingerprint({ list: "test" })
    const readKey = (value: unknown) => (typeof value === "string" ? value : null)
    const cursor = encodeKeysetCursor(fingerprint, "boundary")

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(readKeysetCursor(cursor, fingerprint, readKey)).toBe("boundary")
    expect(readKeysetCursor(cursor, keysetFingerprint({ list: "other" }), readKey)).toBeNull()
    expect(readKeysetCursor(encodeKeysetCursor(fingerprint, 42), fingerprint, readKey)).toBeNull()

    for (const bad of ["", "not base64!", "e30", Buffer.from("[1,2]").toString("base64url"), Buffer.from('{"v":2,"q":"x","k":"y"}').toString("base64url"), "A".repeat(KEYSET_CURSOR_MAX_LENGTH + 1)]) {
      expect(readKeysetCursor(bad, fingerprint, readKey), bad.slice(0, 20)).toBeNull()
    }
  })

  it("clamps the page size to 1–100 and defaults to 25", () => {
    expect(keysetLimit(undefined)).toBe(KEYSET_PAGE_DEFAULT_LIMIT)
    expect(keysetLimit(0)).toBe(KEYSET_PAGE_DEFAULT_LIMIT)
    expect(keysetLimit(-3)).toBe(KEYSET_PAGE_DEFAULT_LIMIT)
    expect(keysetLimit(2.5)).toBe(KEYSET_PAGE_DEFAULT_LIMIT)
    expect(keysetLimit(7)).toBe(7)
    expect(keysetLimit(10_000)).toBe(KEYSET_PAGE_MAX_LIMIT)
  })
})

describe("job pages (Find work)", () => {
  it("visits every job exactly once, in order, for each sort", () => {
    for (const filters of SORTS) {
      const ordered = sortMarketplaceJobs(Array.from({ length: 60 }, (_, index) => job(index + 1)), filters)
      const pages = allPages((after) => marketplaceJobPage(ordered, filters, { after, limit: 25 }, { exact: true }))

      expect(pages.map((page) => page.items.length), filters.sort ?? "").toEqual([25, 25, 10])
      expect(pages.map((page) => page.start)).toEqual([0, 25, 50])
      expect(pages.flatMap((page) => ids(page.items))).toEqual(ids(ordered))
      expect(pages.every((page) => page.total.count === 60 && page.total.exact && !page.restarted)).toBe(true)
      expect(pages.at(-1)?.nextCursor).toBeNull()
    }
  })

  it("is stable across pages: jobs added, removed or reordered ahead of the cursor never repeat or skip one", () => {
    for (const filters of SORTS) {
      const board = Array.from({ length: 60 }, (_, index) => job(index + 1))
      const ordered = sortMarketplaceJobs(board, filters)
      const first = marketplaceJobPage(ordered, filters, { limit: 25 }, { exact: true })
      const boundary = first.items.at(-1)!

      // Between the two reads: a new job lands at the top in every order (newest, nearest and best paid), the page's
      // own last job closes, and the first job is reconfirmed. None of that moves where the second page starts.
      const fresh = job(999, {
        lastConfirmedAt: "2026-12-01T00:00:00.000Z",
        lastModifiedAt: "2026-12-01T00:00:00.000Z",
        origin: { approximatePoint: NEAR, label: "Sweet Home, OR", stateCode: "OR" },
        pay: { amountCents: 99_000, note: null, unit: "per_load" }
      })
      const changed = board
        .filter((item) => item.id !== boundary.id)
        .map((item) => (item.id === first.items[0]?.id ? { ...item, lastConfirmedAt: "2026-12-02T00:00:00.000Z" } : item))
      const reread = sortMarketplaceJobs([...changed, fresh], filters)
      const second = marketplaceJobPage(reread, filters, { after: first.nextCursor, limit: 25 }, { exact: true })

      expect(ids(second.items), filters.sort ?? "").toEqual(ids(ordered.slice(25, 50)))
      expect(second.restarted).toBe(false)
    }
  })

  it("starts again from the first job when the cursor was made for other filters", () => {
    const filters: MarketplaceJobFilters = { equipmentSetups: [["log_truck"]], sort: "newest" }
    const ordered = sortMarketplaceJobs(Array.from({ length: 30 }, (_, index) => job(index + 1)), filters)
    const { nextCursor } = marketplaceJobPage(ordered, filters, { limit: 10 }, { exact: true })

    for (const other of [
      { ...filters, sort: "pay" as const },
      { ...filters, equipmentSetups: [["log_truck", "pole_trailer"]] },
      { ...filters, acceptingOnly: false },
      { ...filters, startsBy: "2026-11-20" }
    ]) {
      const page = marketplaceJobPage(sortMarketplaceJobs(ordered, other), other, { after: nextCursor, limit: 10 }, { exact: true })
      expect(page.restarted).toBe(true)
      expect(page.start).toBe(0)
    }

    // The same filters, written with defaults left out, are the same query.
    const same = marketplaceJobPage(ordered, { acceptingOnly: true, equipmentSetups: [["log_truck"]], near: null, sort: "newest" }, { after: nextCursor, limit: 10 }, { exact: true })
    expect(same.restarted).toBe(false)
    expect(same.start).toBe(10)
  })

  it("never reads a tampered key: an edited cursor starts again from the first job", () => {
    const ordered = sortMarketplaceJobs(Array.from({ length: 30 }, (_, index) => job(index + 1)), {})
    const { nextCursor } = marketplaceJobPage(ordered, {}, { limit: 10 }, { exact: true })
    const decoded = JSON.parse(Buffer.from(nextCursor!, "base64url").toString("utf8")) as { k: Record<string, unknown> }

    for (const k of [{ ...decoded.k, lastModifiedAt: "yesterday" }, { ...decoded.k, pay: { amountCents: -1, unit: "per_load" } }, { ...decoded.k, id: "" }, null]) {
      const forged = Buffer.from(JSON.stringify({ ...decoded, k })).toString("base64url")
      expect(marketplaceJobPage(ordered, {}, { after: forged, limit: 10 }, { exact: true })).toMatchObject({ restarted: true, start: 0 })
    }
  })

  it("counts honestly: a read that stopped at the store's limit is a floor, and its last page has no cursor", () => {
    const ordered = sortMarketplaceJobs(Array.from({ length: 30 }, (_, index) => job(index + 1)), {})
    const pages = allPages((after) => marketplaceJobPage(ordered, {}, { after, limit: 25 }, { exact: false }))

    expect(pages.map((page) => page.total)).toEqual([{ count: 30, exact: false }, { count: 30, exact: false }])
    expect(pages[1]?.nextCursor).toBeNull()
  })

  it("puts only the order fields of a public job in the cursor", () => {
    const ordered = [job(1, { publicRoadNotes: "Gate code 4411" }), job(2)]
    const { nextCursor } = marketplaceJobPage(ordered, {}, { limit: 1 }, { exact: true })
    const decoded = JSON.parse(Buffer.from(nextCursor!, "base64url").toString("utf8")) as { k: Record<string, unknown> }

    expect(Object.keys(decoded.k).sort()).toEqual(["id", "lastConfirmedAt", "lastModifiedAt", "origin", "pay", "title"])
    expect(nextCursor!.length).toBeLessThan(KEYSET_CURSOR_MAX_LENGTH)
    expect(JSON.stringify(decoded)).not.toContain("Gate code")
    expect(JSON.stringify(decoded)).not.toContain(POSTER)
  })
})

function interest(index: number, overrides: Partial<MarketplaceInterestView> = {}): MarketplaceInterestView {
  return {
    availableFrom: null,
    availableUntil: null,
    contactPreference: "in_app",
    createdAt: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(),
    equipment: [],
    haulerOrganization: { id: HAULER, name: "Example Hauling", type: "carrier" },
    id: `66666666-0000-4000-8000-${String(index).padStart(12, "0")}`,
    job: { acceptingInterest: true, id: "job", slug: "job", status: "active", title: "Saw log run" },
    landingOrganization: { id: POSTER, name: "Example Timber Co" },
    message: `Private note ${index}`,
    replies: [],
    status: "submitted",
    submittedBy: { name: "Hank", userId: "user" },
    trucksOffered: 1,
    // Last activity runs the other way from arrival, several on the same minute.
    updatedAt: new Date(Date.UTC(2026, 10, 2, 0, 60 - Math.floor(index / 2))).toISOString(),
    ...overrides
  }
}

describe("inquiry pages (audit K1)", () => {
  const own = Array.from({ length: 30 }, (_, index) => interest(index + 1))
  const rivals = [
    interest(101, { haulerOrganization: { id: RIVAL, name: "Rival Hauling", type: "carrier" } }),
    interest(102, { landingOrganization: { id: RIVAL, name: "Rival Timber" } })
  ]

  it("orders the hauler's by last activity and the landing's by arrival, newest first, then by id", () => {
    const hauler = marketplaceInterestPage(own, { organizationId: HAULER, side: "hauler" }, { limit: 100 }, { exact: true })
    const landing = marketplaceInterestPage(own, { organizationId: POSTER, side: "landing" }, { limit: 100 }, { exact: true })
    const byTimeThenId = (time: (item: MarketplaceInterestView) => string) => (a: MarketplaceInterestView, b: MarketplaceInterestView) =>
      Date.parse(time(b)) - Date.parse(time(a)) || (a.id < b.id ? -1 : 1)

    expect(ids(hauler.items)).toEqual(ids([...own].sort(byTimeThenId((item) => item.updatedAt))))
    expect(ids(landing.items)).toEqual(ids([...own].sort(byTimeThenId((item) => item.createdAt))))
  })

  it("visits every inquiry exactly once, and stays stable when a new one arrives between pages", () => {
    const scope = { organizationId: HAULER, side: "hauler" as const }
    const all = marketplaceInterestPage(own, scope, { limit: 100 }, { exact: true }).items
    const first = marketplaceInterestPage(own, scope, { limit: 12 }, { exact: true })
    const arrived = interest(200, { updatedAt: "2026-12-01T00:00:00.000Z" })
    const pages = allPages((after) => marketplaceInterestPage(after ? [arrived, ...own] : own, scope, { after, limit: 12 }, { exact: true }))

    expect(ids(first.items)).toEqual(ids(all.slice(0, 12)))
    expect(pages.flatMap((page) => ids(page.items))).toEqual(ids(all))
  })

  it("never counts or pages another business's inquiry, whatever the store returned", () => {
    const hauler = marketplaceInterestPage([...own, ...rivals], { organizationId: HAULER, side: "hauler" }, { limit: 100 }, { exact: true })
    const landing = marketplaceInterestPage([...own, ...rivals], { organizationId: POSTER, side: "landing" }, { limit: 100 }, { exact: true })

    expect(hauler.total.count).toBe(31)
    expect(hauler.items.some((item) => item.haulerOrganization.id === RIVAL)).toBe(false)
    expect(landing.total.count).toBe(31)
    expect(landing.items.some((item) => item.landingOrganization.id === RIVAL)).toBe(false)
    expect(marketplaceInterestPage([...own, ...rivals], { organizationId: RIVAL.toUpperCase(), side: "hauler" }, {}, { exact: true }).items.map((item) => item.id))
      .toEqual([rivals[0]?.id])
  })

  it("does not use one business's cursor for another business or the other side", () => {
    const mine = marketplaceInterestPage(own, { organizationId: HAULER, side: "hauler" }, { limit: 5 }, { exact: true })

    expect(marketplaceInterestPage(own, { organizationId: HAULER, side: "hauler" }, { after: mine.nextCursor, limit: 5 }, { exact: true }))
      .toMatchObject({ restarted: false, start: 5 })
    expect(marketplaceInterestPage(own, { organizationId: RIVAL, side: "hauler" }, { after: mine.nextCursor, limit: 5 }, { exact: true }))
      .toMatchObject({ items: [], restarted: true, start: 0 })
    expect(marketplaceInterestPage(own, { organizationId: HAULER, side: "landing" }, { after: mine.nextCursor, limit: 5 }, { exact: true }))
      .toMatchObject({ restarted: true, start: 0 })
  })

  it("keeps the inquiry's private text out of the cursor", () => {
    const { nextCursor } = marketplaceInterestPage(own, { organizationId: HAULER, side: "hauler" }, { limit: 1 }, { exact: true })
    const decoded = Buffer.from(nextCursor!, "base64url").toString("utf8")

    expect(Object.keys((JSON.parse(decoded) as { k: object }).k).sort()).toEqual(["at", "id"])
    expect(decoded).not.toContain("Private note")
  })
})
