import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { MarketplaceDb } from "../normalized-db"
import { MarketplaceRefusalError, MarketplaceStoreError } from "../port"
import { normalizedLiquidity } from "./normalized"

/**
 * #326: the board's read on the normalized store. It runs as the signed-in person, so `is_platform_admin` in the
 * database decides who gets rows; it only reads; it is one call however many basins there are; and it returns
 * counts, never a boundary, a person or a business.
 */

const STAFF = { audience: "logloads-app", issuer: "https://clerk.basin.test", subject: "liquidity_staff" }
const LANE = "11111111-1111-4111-8111-111111111111"
const COAST = "33333333-3333-4333-8333-333333333333"

const boardRow = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  active_jobs: 12,
  basin_id: id,
  haulers_available: 5,
  interests: 20,
  interests_answered: 15,
  jobs_confirmed: 11,
  median_first_reply_minutes: 95,
  name,
  state_code: "OR",
  status: "pilot",
  verified_landings: 3,
  ...overrides
})

const EMPTY = { active_jobs: 0, haulers_available: 0, interests: 0, interests_answered: 0, jobs_confirmed: 0, median_first_reply_minutes: null, verified_landings: 0 }

function fakeDb(reply: () => unknown[]) {
  const calls: Array<{ args: unknown; fn: string }> = []
  const transactions: Array<{ principal: unknown; readOnly: boolean }> = []
  const db = {
    asAnon: async () => {
      throw new Error("the board never reads as anon")
    },
    asUser: async (
      principal: unknown,
      work: (calls: { call: (fn: string, args: unknown) => Promise<unknown[]> }) => Promise<unknown>,
      options?: { readOnly?: boolean }
    ) => {
      transactions.push({ principal, readOnly: options?.readOnly !== false })
      return work({
        call: async (fn, args) => {
          calls.push({ args, fn })
          return reply()
        }
      })
    },
    close: async () => undefined
  }

  return { calls, db: db as unknown as MarketplaceDb, transactions }
}

describe("the board's read", () => {
  it("reads every basin in one call, as the person, in a read-only transaction", async () => {
    const { calls, db, transactions } = fakeDb(() => [boardRow(COAST, "Coast Range", { ...EMPTY, status: "closed" }), boardRow(LANE, "Lane")])

    await expect(normalizedLiquidity(db).board(STAFF)).resolves.toEqual([
      {
        activeJobs: 0,
        haulersAvailable: 0,
        id: COAST,
        inquiries: { answered: 0, medianFirstReplyMinutes: null, received: 0 },
        jobsConfirmed: 0,
        name: "Coast Range",
        stateCode: "OR",
        status: "closed",
        verifiedLandings: 0
      },
      {
        activeJobs: 12,
        haulersAvailable: 5,
        id: LANE,
        inquiries: { answered: 15, medianFirstReplyMinutes: 95, received: 20 },
        jobsConfirmed: 11,
        name: "Lane",
        stateCode: "OR",
        status: "pilot",
        verifiedLandings: 3
      }
    ])
    expect(transactions).toEqual([{ principal: STAFF, readOnly: true }])
    expect(calls).toEqual([{ args: {}, fn: "basin_liquidity_board" }])
  })

  it("returns counts only: nothing else a row carried reaches the page", async () => {
    const { db } = fakeDb(() => [{ ...boardRow(LANE, "Lane"), boundary_wkt: "POLYGON((-123 44,-122 44,-122 45,-123 44))", contact_email: "maya@northpine.example", hauler_names: ["Maya Ortiz"] }])

    const [row] = await normalizedLiquidity(db).board(STAFF)

    expect(Object.keys(row ?? {}).sort()).toEqual(["activeJobs", "haulersAvailable", "id", "inquiries", "jobsConfirmed", "name", "stateCode", "status", "verifiedLandings"])
    expect(Object.keys(row?.inquiries ?? {}).sort()).toEqual(["answered", "medianFirstReplyMinutes", "received"])
    expect(JSON.stringify(row)).not.toMatch(/POLYGON|northpine|Maya/)
  })

  it("is an empty board with no basins", async () => {
    const { db } = fakeDb(() => [])

    await expect(normalizedLiquidity(db).board(STAFF)).resolves.toEqual([])
  })

  it("passes the database's refusal on, so a person who is not staff gets no row", async () => {
    const { db } = fakeDb(() => {
      throw new MarketplaceRefusalError("platform admin required", "42501")
    })

    await expect(normalizedLiquidity(db).board(STAFF)).rejects.toMatchObject({ code: "42501", name: "MarketplaceRefusalError" })
  })

  it.each<[string, unknown]>([
    ["a row that is not an object", "Lane"],
    ["a basin with no id", boardRow(LANE, "Lane", { basin_id: 7 })],
    ["a basin with no name", boardRow(LANE, " ")],
    ["a status the contract does not have", boardRow(LANE, "Lane", { status: "beta" })],
    ["a negative count", boardRow(LANE, "Lane", { haulers_available: -1 })],
    ["a count that is not a whole number", boardRow(LANE, "Lane", { verified_landings: 2.5 })],
    ["a count sent as text", boardRow(LANE, "Lane", { interests: "20" })],
    ["a missing count", boardRow(LANE, "Lane", { active_jobs: undefined })],
    ["more confirmed jobs than active jobs", boardRow(LANE, "Lane", { active_jobs: 3, jobs_confirmed: 4 })],
    ["more answers than inquiries", boardRow(LANE, "Lane", { interests: 2, interests_answered: 3 })],
    ["a median with no answer", boardRow(LANE, "Lane", { interests_answered: 0 })],
    ["answers with no median", boardRow(LANE, "Lane", { median_first_reply_minutes: null })]
  ])("refuses %s instead of showing a guess", async (_label, row) => {
    const { db } = fakeDb(() => [boardRow(COAST, "Coast Range"), row])

    await expect(normalizedLiquidity(db).board(STAFF)).rejects.toBeInstanceOf(MarketplaceStoreError)
  })
})
