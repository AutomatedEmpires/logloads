import "server-only"

import { basinStatusSchema } from "@logloads/contracts"

import type { MarketplaceDb, MarketplacePrincipal } from "../normalized-db"
import { MarketplaceStoreError } from "../port"
import type { BasinLiquidityCounts } from "./board"

/**
 * The liquidity board's read on the normalized store (#326).
 *
 * It runs as the signed-in person in one read-only transaction and calls only the stage 38 staff functions (#324):
 * `list_basins`, then `basin_readiness` for each basin. Both check `is_platform_admin` in the database, so a person
 * who is not LogLoads staff is refused (42501) before any basin is read.
 *
 * What it cannot read yet: every active job (stale ones included), inquiries per job, the share answered and the
 * median first reply. `marketplace.basins` and `basin_for_landing` are closed to the `authenticated` role, so those
 * need one staff function in a new schema stage. Until it exists they are `null` here, and this read makes one
 * `basin_readiness` call per basin; that function replaces the whole loop with a single call.
 *
 * Only counts leave this module: a basin's boundary and county list are dropped, and no row names a person, a
 * business, a job or a point.
 */

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MarketplaceStoreError()
  }

  return value as Record<string, unknown>
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new MarketplaceStoreError()
  }

  return value.trim()
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new MarketplaceStoreError()
  }

  return value
}

export function normalizedLiquidity(db: MarketplaceDb) {
  return {
    async board(principal: MarketplacePrincipal): Promise<BasinLiquidityCounts[]> {
      return db.asUser(principal, async (calls) => {
        const basins = (await calls.call("list_basins", {})).map((value) => {
          const row = record(value)
          const status = basinStatusSchema.safeParse(row.status)

          if (!status.success) throw new MarketplaceStoreError()
          return { id: text(row.basin_id), name: text(row.name), stateCode: text(row.state_code), status: status.data }
        })
        const board: BasinLiquidityCounts[] = []

        for (const basin of basins) {
          const [value] = await calls.call("basin_readiness", { p_basin_id: basin.id })
          const row = record(value)

          // Counts for another basin are never shown under this one's name.
          if (row.basin_id !== basin.id) throw new MarketplaceStoreError()

          board.push({
            ...basin,
            activeJobs: null,
            haulersAvailable: count(row.haulers_available),
            inquiries: null,
            // `basin_readiness.active_jobs` counts only jobs confirmed in the last 14 days (38_v2_basins.sql).
            jobsConfirmed: count(row.active_jobs),
            verifiedLandings: count(row.verified_landings)
          })
        }

        return board
      })
    }
  }
}
