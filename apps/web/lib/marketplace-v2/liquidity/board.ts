import type { BasinStatus } from "@logloads/contracts"

/**
 * The per-basin liquidity board (#326): what LogLoads staff read to judge whether a basin has enough work and enough
 * trucks. One row per basin (#324), counts and shares only. Pure: the store read is `./normalized.ts`.
 *
 * The targets are the issue's. A share with nothing to compute it from (no active jobs, no inquiries, no replies) says
 * so in words; it is never shown as a zero.
 */

/** A job or an availability report counts as current when it was confirmed within this many days. */
export const LIQUIDITY_WINDOW_DAYS = 14
/** Target: the median time to a first reply is under this. */
export const FIRST_REPLY_TARGET_MINUTES = 120
/** Target: stale jobs are under this share of active jobs. */
export const STALE_SHARE_TARGET = 0.1

/** What the store reports for one basin. Aggregates only: no person, business, job or place. */
export interface BasinLiquidityCounts {
  id: string
  name: string
  stateCode: string
  status: BasinStatus
  /** Active landings of verified, active businesses. */
  verifiedLandings: number
  /** Active, unexpired jobs confirmed in the last 14 days. */
  jobsConfirmed: number
  /** Hauling businesses whose availability was confirmed in the last 14 days. */
  haulersAvailable: number
  /** Every active, unexpired job, stale ones included. */
  activeJobs: number
  /** Inquiries on the active jobs that were not withdrawn, and the median whole minutes to a landing's first response. */
  inquiries: { received: number; answered: number; medianFirstReplyMinutes: number | null }
}

/**
 * One cell. `value`: a figure. `none`: there is nothing to compute it from. `target` is set only on the two figures
 * that have one.
 */
export interface LiquidityReading {
  state: "value" | "none"
  text: string
  target?: "met" | "missed"
}

export const LIQUIDITY_COLUMNS = [
  { key: "verifiedLandings", label: "Identity-reviewed landings" },
  { key: "activeJobs", label: "Active jobs" },
  { key: "jobsConfirmed", label: `Confirmed in ${LIQUIDITY_WINDOW_DAYS} days` },
  { key: "haulersAvailable", label: "Haulers available" },
  { key: "inquiriesPerJob", label: "Inquiries per job" },
  { key: "answeredShare", label: "Answered" },
  { key: "medianFirstReply", label: "Median first reply" },
  { key: "staleShare", label: "Stale jobs" }
] as const

export type LiquidityColumnKey = (typeof LIQUIDITY_COLUMNS)[number]["key"]

export type BasinLiquidityRow = Record<LiquidityColumnKey, LiquidityReading> & {
  id: string
  name: string
  stateCode: string
  status: BasinStatus
  statusLabel: string
}

export interface LiquidityBoard {
  rows: BasinLiquidityRow[]
}

const STATUS_LABELS: Readonly<Record<BasinStatus, string>> = { closed: "Closed", open: "Open", pilot: "Pilot" }

const NO_ACTIVE_JOBS: LiquidityReading = { state: "none", text: "No active jobs" }

const value = (text: string): LiquidityReading => ({ state: "value", text })

/**
 * `part` of `whole` in tenths of a percent, rounded down and kept within 0 to 100%. Rounded down so a share just
 * under a target never reads as the target; clamped because two counts read a moment apart can disagree.
 */
function shareTenths(part: number, whole: number): number {
  return Math.floor((Math.min(Math.max(part, 0), whole) * 1000) / whole)
}

function percentText(tenths: number): string {
  return tenths % 10 === 0 ? `${tenths / 10}%` : `${(tenths / 10).toFixed(1)}%`
}

function durationText(minutes: number): string {
  if (minutes < 1) return "Under 1 min"

  const whole = Math.floor(minutes)
  const days = Math.floor(whole / 1440)
  const hours = Math.floor((whole % 1440) / 60)
  const rest = whole % 60

  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`
  if (hours > 0) return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`
  return `${rest} min`
}

export function liquidityRow(counts: BasinLiquidityCounts): BasinLiquidityRow {
  const { activeJobs, inquiries } = counts

  const staleShare = (): LiquidityReading => {
    if (activeJobs === 0) return NO_ACTIVE_JOBS

    const tenths = shareTenths(activeJobs - counts.jobsConfirmed, activeJobs)
    return { state: "value", target: tenths < STALE_SHARE_TARGET * 1000 ? "met" : "missed", text: percentText(tenths) }
  }

  const inquiriesPerJob = (): LiquidityReading =>
    activeJobs === 0 ? NO_ACTIVE_JOBS : value((inquiries.received / activeJobs).toFixed(1))

  const answeredShare = (): LiquidityReading =>
    inquiries.received === 0 ? { state: "none", text: "No inquiries" } : value(percentText(shareTenths(inquiries.answered, inquiries.received)))

  const medianFirstReply = (): LiquidityReading => {
    if (inquiries.medianFirstReplyMinutes === null) return { state: "none", text: "No replies" }

    return {
      state: "value",
      target: inquiries.medianFirstReplyMinutes < FIRST_REPLY_TARGET_MINUTES ? "met" : "missed",
      text: durationText(inquiries.medianFirstReplyMinutes)
    }
  }

  return {
    activeJobs: value(String(activeJobs)),
    answeredShare: answeredShare(),
    haulersAvailable: value(String(counts.haulersAvailable)),
    id: counts.id,
    inquiriesPerJob: inquiriesPerJob(),
    jobsConfirmed: value(String(counts.jobsConfirmed)),
    medianFirstReply: medianFirstReply(),
    name: counts.name,
    staleShare: staleShare(),
    stateCode: counts.stateCode,
    status: counts.status,
    statusLabel: STATUS_LABELS[counts.status],
    verifiedLandings: value(String(counts.verifiedLandings))
  }
}

/** The board in the store's order (state, then name). */
export function liquidityBoard(counts: readonly BasinLiquidityCounts[]): LiquidityBoard {
  return { rows: counts.map(liquidityRow) }
}
