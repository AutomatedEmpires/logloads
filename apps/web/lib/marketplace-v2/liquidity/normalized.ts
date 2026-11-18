import "server-only"

import { basinStatusSchema } from "@logloads/contracts"

import type { MarketplaceDb, MarketplacePrincipal } from "../normalized-db"
import { MarketplaceStoreError } from "../port"
import type { BasinLiquidityCounts } from "./board"

/**
 * The liquidity board's read on the normalized store (#326): one call to `basin_liquidity_board` (stage 42), as the
 * signed-in person, in a read-only transaction. The function checks `is_platform_admin` in the database, so a person
 * who is not LogLoads staff is refused (42501) and gets no row. However many basins there are, it is one statement.
 *
 * The function returns counts only, and only these fields are mapped: nothing here names a person, a business, a
 * job or a point. A row that could not be true (more confirmed jobs than active jobs, more answers than inquiries, a
 * median with no answer) is refused instead of shown, since every count comes from one snapshot.
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

function counts(value: unknown): BasinLiquidityCounts {
  const row = record(value)
  const status = basinStatusSchema.safeParse(row.status)
  const activeJobs = count(row.active_jobs)
  const jobsConfirmed = count(row.jobs_confirmed)
  const received = count(row.interests)
  const answered = count(row.interests_answered)
  const median = row.median_first_reply_minutes === null ? null : count(row.median_first_reply_minutes)

  if (!status.success || jobsConfirmed > activeJobs || answered > received || (median === null) !== (answered === 0)) {
    throw new MarketplaceStoreError()
  }

  return {
    activeJobs,
    haulersAvailable: count(row.haulers_available),
    id: text(row.basin_id),
    inquiries: { answered, medianFirstReplyMinutes: median, received },
    jobsConfirmed,
    name: text(row.name),
    stateCode: text(row.state_code),
    status: status.data,
    verifiedLandings: count(row.verified_landings)
  }
}

export function normalizedLiquidity(db: MarketplaceDb) {
  return {
    /** One row of counts per basin, in state and name order. */
    async board(principal: MarketplacePrincipal): Promise<BasinLiquidityCounts[]> {
      const rows = await db.asUser(principal, (calls) => calls.call("basin_liquidity_board", {}))

      return rows.map(counts)
    }
  }
}
