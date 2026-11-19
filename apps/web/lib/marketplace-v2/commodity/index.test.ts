import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { MarketplaceDb } from "../normalized-db"
import { MARKETPLACE_FUNCTIONS } from "../normalized-db"
import { MarketplaceOperationUnavailableError, MarketplaceRefusalError, MarketplaceStoreError } from "../port"
import {
  COMMODITY_MONTH_CATALOGUE_ENTRY,
  COMMODITY_MONTH_FUNCTION,
  commodityCatalogueReady,
  CommodityReadUnavailableError,
  normalizedCommodity
} from "./index"

const STAFF = { audience: "logloads-app", issuer: "https://clerk.commodity.test", subject: "commodity_staff" }
const HAULER = { audience: "logloads-app", issuer: "https://clerk.commodity.test", subject: "commodity_hauler" }
const LANE = "11111111-1111-4111-8111-111111111111"
const CATALOGUED = new Set([COMMODITY_MONTH_FUNCTION])
const NOW = () => new Date("2026-11-18T17:45:00.000Z")

/** The database's own refusal for anyone who is not active platform staff (`is_platform_admin`, 42501). */
function notStaff(): Error {
  return Object.assign(new Error("platform admin required"), { code: "42501", severity: "ERROR" })
}

function fakeDb(reply: (principal: { subject: string }, fn: string) => unknown[]) {
  const calls: Array<{ args: unknown; fn: string; readOnly: boolean; subject: string }> = []
  const db = {
    asAnon: async () => {
      throw new Error("the commodity read never runs signed out")
    },
    asUser: async (
      principal: { subject: string },
      work: (calls: { call: (fn: string, args: unknown) => Promise<unknown[]> }) => Promise<unknown>,
      options?: { readOnly?: boolean }
    ) => work({
      call: async (fn: string, args: unknown) => {
        calls.push({ args, fn, readOnly: options?.readOnly !== false, subject: principal.subject })
        return reply(principal, fn)
      }
    }),
    close: async () => undefined
  }

  return { calls, db: db as unknown as MarketplaceDb }
}

const staffOnly = (principal: { subject: string }) => {
  if (principal.subject !== STAFF.subject) throw notStaff()
  return [
    { basin_id: LANE, basin_name: "Lane", basin_status: "pilot", jobs: 3, product_key: "saw logs" },
    { basin_id: LANE, basin_name: "Lane", basin_status: "pilot", jobs: 1, product_key: null }
  ]
}

describe("the staff read of the monthly notice share (#339)", () => {
  it("asks the store once, read-only, for one UTC month and the listed products", async () => {
    const { calls, db } = fakeDb(staffOnly)
    const view = await normalizedCommodity(db, { catalogue: CATALOGUED, now: NOW }).monthlyNoticeShare(STAFF, "2026-11")

    expect(calls).toEqual([{
      args: {
        p_from: "2026-11-01T00:00:00.000Z",
        p_products: ["saw logs", "pulpwood", "poles and pilings", "chips", "hog fuel and biomass", "hardwood logs"],
        p_until: "2026-12-01T00:00:00.000Z"
      },
      fn: "commodity_month",
      readOnly: true,
      subject: STAFF.subject
    }])
    expect(view.basins).toHaveLength(1)
    expect(view.basins[0]).toMatchObject({ activeJobs: 4, name: "Lane", noticeJobs: 1, noticeShare: 0.25 })
  })

  it("gives a landing or hauler account nothing: the store's staff check refuses and no figure comes back", async () => {
    const { calls, db } = fakeDb(staffOnly)
    const read = normalizedCommodity(db, { catalogue: CATALOGUED, now: NOW }).monthlyNoticeShare(HAULER, "2026-11")

    await expect(read).rejects.toBeInstanceOf(MarketplaceRefusalError)
    await expect(read).rejects.toMatchObject({ code: "42501" })
    expect(calls).toHaveLength(1)
  })

  it("refuses a month that is not YYYY-MM, or has not started, before asking the store", async () => {
    const { calls, db } = fakeDb(staffOnly)
    const commodity = normalizedCommodity(db, { catalogue: CATALOGUED, now: NOW })

    await expect(commodity.monthlyNoticeShare(STAFF, "2026-13")).rejects.toMatchObject({ code: "22023" })
    await expect(commodity.monthlyNoticeShare(STAFF, "November")).rejects.toBeInstanceOf(MarketplaceRefusalError)
    await expect(commodity.monthlyNoticeShare(STAFF, "2026-12")).rejects.toThrow("That month has not started yet.")
    await expect(commodity.monthlyNoticeShare(STAFF, "2026-10")).resolves.toMatchObject({ month: "2026-10" })
    expect(calls.map((call) => call.fn)).toEqual(["commodity_month"])
  })

  it("is not available, and reaches no store, until the SQL function is catalogued", async () => {
    const { calls, db } = fakeDb(staffOnly)
    const read = normalizedCommodity(db, { catalogue: new Set(), now: NOW }).monthlyNoticeShare(STAFF, "2026-11")

    await expect(read).rejects.toBeInstanceOf(CommodityReadUnavailableError)
    await expect(read).rejects.toBeInstanceOf(MarketplaceOperationUnavailableError)
    await expect(read).rejects.toThrow("Reading the monthly commodity share is not available yet")
    expect(calls).toEqual([])
    expect(commodityCatalogueReady(new Set())).toBe(false)
    expect(commodityCatalogueReady(CATALOGUED)).toBe(true)
  })

  it("matches the catalogue entry once its owner adds it", () => {
    const catalogued = (MARKETPLACE_FUNCTIONS as Readonly<Record<string, unknown>>)[COMMODITY_MONTH_FUNCTION]

    expect(COMMODITY_MONTH_CATALOGUE_ENTRY).toEqual({
      anonymous: false,
      args: { p_from: "timestamptz", p_products: "text[]", p_until: "timestamptz" },
      returns: "rows"
    })
    if (catalogued !== undefined) expect(catalogued).toEqual(COMMODITY_MONTH_CATALOGUE_ENTRY)
    expect(commodityCatalogueReady()).toBe(catalogued !== undefined)
  })

  it("turns any other store failure into a safe error that names no value", async () => {
    const { db } = fakeDb(() => {
      throw Object.assign(new Error("connection to db.internal.example failed for role app_login"), { code: "08006", severity: "FATAL" })
    })
    const read = normalizedCommodity(db, { catalogue: CATALOGUED, now: NOW }).monthlyNoticeShare(STAFF, "2026-11")

    await expect(read).rejects.toBeInstanceOf(MarketplaceStoreError)
    await expect(read).rejects.not.toThrow(/db\.internal|app_login/)
  })
})
