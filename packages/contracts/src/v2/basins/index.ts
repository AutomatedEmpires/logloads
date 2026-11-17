/**
 * Basins (#324): a named area in one state, either a boundary or a county list, with a launch status only LogLoads
 * staff can set. Find Work, a public job and a new inquiry are open when the job's landing falls in a pilot or open
 * basin. Until any basin is recorded the gate stays off, so a store with no basins keeps listing the jobs it has.
 */

import { z } from "zod"

/** `basins.status`. A new basin is closed until staff open it. */
export const BASIN_STATUSES = ["closed", "pilot", "open"] as const
export type BasinStatus = (typeof BASIN_STATUSES)[number]

export const basinStatusSchema = z.enum(BASIN_STATUSES)

/** Shown instead of an empty board when the area asked about is not pilot or open. */
export const NOT_IN_YOUR_AREA_YET = "not in your area yet"

/** Pilot and open basins are on the board. Closed is not. */
export function basinIsLaunched(status: BasinStatus): boolean {
  return status === "pilot" || status === "open"
}

const nameSchema = z.string().trim().min(1).max(80)
const stateSchema = z.string().trim().regex(/^[A-Za-z]{2}$/)
const countySchema = z.string().trim().min(1).max(80)
const reasonSchema = z.string().trim().min(5).max(500)

/** A basin is a name and a state, plus a boundary or at least one county. */
export const createBasinInputSchema = z.object({
  boundaryWkt: z.string().trim().min(1).max(500_000).nullable().optional(),
  counties: z.array(countySchema).max(80).optional(),
  name: nameSchema,
  reason: reasonSchema,
  stateCode: stateSchema
}).refine((input) => Boolean(input.boundaryWkt) || (input.counties?.length ?? 0) > 0, {
  message: "A basin needs a boundary or a county list."
})

export type CreateBasinInput = z.infer<typeof createBasinInputSchema>

export const setBasinStatusInputSchema = z.object({
  basinId: z.string().uuid(),
  reason: reasonSchema,
  status: basinStatusSchema
})

export type SetBasinStatusInput = z.infer<typeof setBasinStatusInputSchema>

export interface BasinView {
  boundaryWkt: string | null
  counties: string[]
  createdAt: string
  id: string
  name: string
  stateCode: string
  status: BasinStatus
}

/** Supply and demand staff read before they switch a basin on. Availability is the last 14 days. */
export interface BasinReadinessView {
  activeJobs: number
  haulersAvailable: number
  id: string
  name: string
  status: BasinStatus
  verifiedLandings: number
}
