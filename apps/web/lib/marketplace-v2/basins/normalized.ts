import "server-only"

import {
  basinStatusSchema,
  createBasinInputSchema,
  NOT_IN_YOUR_AREA_YET,
  setBasinStatusInputSchema,
  type BasinReadinessView,
  type BasinView
} from "@logloads/contracts"

import type { MarketplaceDb, MarketplacePrincipal } from "../normalized-db"
import { MarketplaceRefusalError, MarketplaceStoreError } from "../port"

export interface AreaNoticeInput {
  county?: string | null
  jobId?: string | null
  lat?: number | null
  lng?: number | null
  stateCode?: string | null
}

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

  return value
}

function whole(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new MarketplaceStoreError()
  }

  return value
}

function basin(value: unknown): BasinView {
  const row = record(value)
  const status = basinStatusSchema.safeParse(row.status)

  if (!status.success || !Array.isArray(row.counties) || !row.counties.every((county) => typeof county === "string")) {
    throw new MarketplaceStoreError()
  }

  return {
    boundaryWkt: row.boundary_wkt === null ? null : text(row.boundary_wkt),
    counties: row.counties,
    createdAt: text(row.created_at),
    id: text(row.basin_id),
    name: text(row.name),
    stateCode: text(row.state_code).trim(),
    status: status.data
  }
}

function readiness(value: unknown): BasinReadinessView {
  const row = record(value)
  const status = basinStatusSchema.safeParse(row.status)

  if (!status.success) {
    throw new MarketplaceStoreError()
  }

  return {
    activeJobs: whole(row.active_jobs),
    haulersAvailable: whole(row.haulers_available),
    id: text(row.basin_id),
    name: text(row.name),
    status: status.data,
    verifiedLandings: whole(row.verified_landings)
  }
}

/**
 * Basin staff calls and the public area notice on the normalized store (#324). Staff methods check
 * `is_platform_admin` in the database and audit the reason. The notice is the exact phrase or null.
 */
export function normalizedBasins(db: MarketplaceDb) {
  return {
    async areaNotice(input: AreaNoticeInput = {}): Promise<string | null> {
      const [value] = await db.asAnon((calls) => calls.call("public_area_notice", {
        p_county: input.county ?? null,
        p_job_id: input.jobId ?? null,
        p_lat: input.lat ?? null,
        p_lng: input.lng ?? null,
        p_state_code: input.stateCode ?? null
      }))

      if (value === null || value === undefined) return null
      if (value === NOT_IN_YOUR_AREA_YET) return NOT_IN_YOUR_AREA_YET
      throw new MarketplaceStoreError()
    },

    async createBasin(principal: MarketplacePrincipal, input: unknown): Promise<string> {
      const parsed = createBasinInputSchema.safeParse(input)

      if (!parsed.success) {
        throw new MarketplaceRefusalError(parsed.error.issues[0]?.message ?? "Check the basin and try again.", "22023")
      }

      const [value] = await db.asUser(principal, (calls) => calls.call("create_basin", {
        p_boundary_wkt: parsed.data.boundaryWkt ?? null,
        p_counties: parsed.data.counties ?? [],
        p_name: parsed.data.name,
        p_reason: parsed.data.reason,
        p_state_code: parsed.data.stateCode.toUpperCase()
      }), { readOnly: false })

      if (typeof value !== "string" || value.trim() === "") throw new MarketplaceStoreError()
      return value
    },

    async listBasins(principal: MarketplacePrincipal): Promise<BasinView[]> {
      const rows = await db.asUser(principal, (calls) => calls.call("list_basins", {}))
      return rows.map(basin)
    },

    async readiness(principal: MarketplacePrincipal, basinId: string): Promise<BasinReadinessView> {
      const parsed = setBasinStatusInputSchema.shape.basinId.safeParse(basinId)

      if (!parsed.success) throw new MarketplaceRefusalError("That basin was not found.", "P0002")

      const rows = await db.asUser(principal, (calls) => calls.call("basin_readiness", { p_basin_id: parsed.data }))
      const [row] = rows

      if (!row) throw new MarketplaceStoreError()
      return readiness(row)
    },

    async setBasinStatus(principal: MarketplacePrincipal, input: unknown): Promise<void> {
      const parsed = setBasinStatusInputSchema.safeParse(input)

      if (!parsed.success) {
        throw new MarketplaceRefusalError(parsed.error.issues[0]?.message ?? "Check the status and try again.", "22023")
      }

      await db.asUser(principal, (calls) => calls.call("set_basin_status", {
        p_basin_id: parsed.data.basinId,
        p_reason: parsed.data.reason,
        p_status: parsed.data.status
      }), { readOnly: false })
    }
  }
}
