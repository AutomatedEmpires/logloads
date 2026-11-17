import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { NOT_IN_YOUR_AREA_YET } from "@logloads/contracts"

import type { MarketplaceDb } from "../normalized-db"
import { MarketplaceRefusalError, MarketplaceStoreError } from "../port"
import { normalizedBasins } from "./normalized"

const STAFF = { audience: "logloads-app", issuer: "https://clerk.basin.test", subject: "basin_staff" }
const BASIN = "11111111-1111-4111-8111-111111111111"

function fakeDb(reply: (fn: string) => unknown[]) {
  const calls: Array<{ args: unknown; fn: string; write: boolean }> = []
  const db = {
    asAnon: async (work: (calls: { call: (fn: string, args: unknown) => Promise<unknown[]> }) => Promise<unknown>) =>
      work({
        call: async (fn: string, args: unknown) => {
          calls.push({ args, fn, write: false })
          return reply(fn)
        }
      }),
    asUser: async (
      _principal: unknown,
      work: (calls: { call: (fn: string, args: unknown) => Promise<unknown[]> }) => Promise<unknown>,
      options?: { readOnly?: boolean }
    ) => work({
      call: async (fn: string, args: unknown) => {
        calls.push({ args, fn, write: options?.readOnly === false })
        return reply(fn)
      }
    }),
    close: async () => undefined
  }

  return { calls, db: db as unknown as MarketplaceDb }
}

describe("normalized basin calls", () => {
  it("maps the catalogue and refuses a basin that has no shape before asking the database", async () => {
    const { calls, db } = fakeDb((fn) => {
      if (fn === "public_area_notice") return [NOT_IN_YOUR_AREA_YET]
      if (fn === "create_basin") return [BASIN]
      if (fn === "list_basins") {
        return [{
          basin_id: BASIN,
          boundary_wkt: null,
          counties: ["Lane"],
          created_at: "2026-11-17T18:00:00.000Z",
          name: "Lane",
          state_code: "OR",
          status: "closed"
        }]
      }
      if (fn === "basin_readiness") {
        return [{ active_jobs: 0, basin_id: BASIN, haulers_available: 0, name: "Lane", status: "closed", verified_landings: 0 }]
      }
      return []
    })
    const basins = normalizedBasins(db)

    await expect(basins.createBasin(STAFF, { counties: [], name: "Lane", reason: "No shape here", stateCode: "OR" }))
      .rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect(calls).toEqual([])

    await expect(basins.areaNotice({ stateCode: "OR" })).resolves.toBe(NOT_IN_YOUR_AREA_YET)
    await expect(basins.createBasin(STAFF, { counties: ["Lane"], name: "Lane", reason: "Recording Lane", stateCode: "or" })).resolves.toBe(BASIN)
    await expect(basins.setBasinStatus(STAFF, { basinId: BASIN, reason: "Enough trucks", status: "pilot" })).resolves.toBeUndefined()
    await expect(basins.listBasins(STAFF)).resolves.toMatchObject([{ id: BASIN, stateCode: "OR", status: "closed" }])
    await expect(basins.readiness(STAFF, BASIN)).resolves.toMatchObject({ activeJobs: 0, haulersAvailable: 0, verifiedLandings: 0 })

    expect(calls.map((call) => [call.fn, call.write])).toEqual([
      ["public_area_notice", false],
      ["create_basin", true],
      ["set_basin_status", true],
      ["list_basins", false],
      ["basin_readiness", false]
    ])
    expect(calls[1]?.args).toMatchObject({ p_counties: ["Lane"], p_state_code: "OR" })
  })

  it("refuses a notice the database did not write for people", async () => {
    const { db } = fakeDb(() => ["maybe later"])

    await expect(normalizedBasins(db).areaNotice()).rejects.toBeInstanceOf(MarketplaceStoreError)
  })
})
