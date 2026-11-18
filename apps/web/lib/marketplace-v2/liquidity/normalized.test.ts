import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { MarketplaceDb } from "../normalized-db"
import { MarketplaceRefusalError, MarketplaceStoreError } from "../port"
import { normalizedLiquidity } from "./normalized"

/**
 * #326: the board's read on the normalized store. It runs as the signed-in person, so `is_platform_admin` in the
 * database decides who gets rows; it only reads; and it returns counts, never a boundary, a person or a business.
 */

const STAFF = { audience: "logloads-app", issuer: "https://clerk.basin.test", subject: "liquidity_staff" }
const LANE = "11111111-1111-4111-8111-111111111111"
const COAST = "33333333-3333-4333-8333-333333333333"

const basinRow = (id: string, name: string, status = "pilot") => ({
  basin_id: id,
  boundary_wkt: "POLYGON((-123 44,-122 44,-122 45,-123 45,-123 44))",
  counties: ["Lane"],
  created_at: "2026-11-17T18:00:00.000Z",
  name,
  state_code: "OR",
  status
})

const readinessRow = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  active_jobs: 12,
  basin_id: id,
  haulers_available: 5,
  name,
  status: "pilot",
  verified_landings: 3,
  ...overrides
})

type Reply = (fn: string, args: Record<string, unknown>) => unknown[]

function fakeDb(reply: Reply) {
  const calls: Array<{ args: Record<string, unknown>; fn: string }> = []
  const transactions: Array<{ principal: unknown; readOnly: boolean }> = []
  const db = {
    asAnon: async () => {
      throw new Error("the board never reads as anon")
    },
    asUser: async (
      principal: unknown,
      work: (calls: { call: (fn: string, args: Record<string, unknown>) => Promise<unknown[]> }) => Promise<unknown>,
      options?: { readOnly?: boolean }
    ) => {
      transactions.push({ principal, readOnly: options?.readOnly !== false })
      return work({
        call: async (fn, args) => {
          calls.push({ args, fn })
          return reply(fn, args)
        }
      })
    },
    close: async () => undefined
  }

  return { calls, db: db as unknown as MarketplaceDb, transactions }
}

describe("the board's read", () => {
  it("reads every basin's counts as the person, in one read-only transaction", async () => {
    const { calls, db, transactions } = fakeDb((fn, args) => {
      if (fn === "list_basins") return [basinRow(COAST, "Coast Range", "closed"), basinRow(LANE, "Lane")]
      return args.p_basin_id === LANE
        ? [readinessRow(LANE, "Lane")]
        : [readinessRow(COAST, "Coast Range", { active_jobs: 0, haulers_available: 0, status: "closed", verified_landings: 0 })]
    })

    await expect(normalizedLiquidity(db).board(STAFF)).resolves.toEqual([
      { activeJobs: null, haulersAvailable: 0, id: COAST, inquiries: null, jobsConfirmed: 0, name: "Coast Range", stateCode: "OR", status: "closed", verifiedLandings: 0 },
      { activeJobs: null, haulersAvailable: 5, id: LANE, inquiries: null, jobsConfirmed: 12, name: "Lane", stateCode: "OR", status: "pilot", verifiedLandings: 3 }
    ])
    expect(transactions).toEqual([{ principal: STAFF, readOnly: true }])
    expect(calls).toEqual([
      { args: {}, fn: "list_basins" },
      { args: { p_basin_id: COAST }, fn: "basin_readiness" },
      { args: { p_basin_id: LANE }, fn: "basin_readiness" }
    ])
  })

  it("returns counts only: no boundary, no county list and nothing else a row carried", async () => {
    const { db } = fakeDb((fn) => fn === "list_basins"
      ? [{ ...basinRow(LANE, "Lane"), contact_email: "maya@northpine.example" }]
      : [{ ...readinessRow(LANE, "Lane"), hauler_names: ["Maya Ortiz"] }])

    const [row] = await normalizedLiquidity(db).board(STAFF)

    expect(Object.keys(row ?? {}).sort()).toEqual(["activeJobs", "haulersAvailable", "id", "inquiries", "jobsConfirmed", "name", "stateCode", "status", "verifiedLandings"])
    expect(JSON.stringify(row)).not.toMatch(/POLYGON|northpine|Maya|counties/)
  })

  it("asks for nothing more when there are no basins", async () => {
    const { calls, db } = fakeDb(() => [])

    await expect(normalizedLiquidity(db).board(STAFF)).resolves.toEqual([])
    expect(calls.map((call) => call.fn)).toEqual(["list_basins"])
  })

  it("passes the database's refusal on, so a person who is not staff gets no row", async () => {
    const { calls, db } = fakeDb(() => {
      throw new MarketplaceRefusalError("platform admin required", "42501")
    })

    await expect(normalizedLiquidity(db).board(STAFF)).rejects.toMatchObject({ code: "42501", name: "MarketplaceRefusalError" })
    expect(calls.map((call) => call.fn)).toEqual(["list_basins"])
  })

  const lane: Reply = () => [basinRow(LANE, "Lane")]
  const laneCounts = (overrides: Record<string, unknown>): Reply => () => [readinessRow(LANE, "Lane", overrides)]

  it.each<[string, Reply, Reply]>([
    ["a basin with no id", () => [{ ...basinRow(LANE, "Lane"), basin_id: 7 }], laneCounts({})],
    ["a basin with no name", () => [{ ...basinRow(LANE, "Lane"), name: " " }], laneCounts({})],
    ["a status the contract does not have", () => [basinRow(LANE, "Lane", "beta")], laneCounts({})],
    ["a negative count", lane, laneCounts({ active_jobs: -1 })],
    ["a count that is not a whole number", lane, laneCounts({ haulers_available: 2.5 })],
    ["a count sent as text", lane, laneCounts({ verified_landings: "3" })],
    ["counts for another basin", lane, laneCounts({ basin_id: COAST })],
    ["no counts for a listed basin", lane, () => []]
  ])("refuses %s instead of showing a guess", async (_label, basins, readiness) => {
    const { db } = fakeDb((fn, args) => (fn === "list_basins" ? basins(fn, args) : readiness(fn, args)))

    await expect(normalizedLiquidity(db).board(STAFF)).rejects.toBeInstanceOf(MarketplaceStoreError)
  })
})
