import { describe, expect, it } from "vitest"

import {
  FIRST_REPLY_TARGET_MINUTES,
  LIQUIDITY_COLUMNS,
  LIQUIDITY_WINDOW_DAYS,
  STALE_SHARE_TARGET,
  liquidityBoard,
  liquidityRow,
  type BasinLiquidityCounts
} from "./board"

/**
 * #326: what the staff board says for one basin. The targets are the issue's: a median first reply under 2 hours and
 * stale jobs under 10% of active jobs. A share with nothing to compute it from says so, never a zero.
 */

const BASIN = "11111111-1111-4111-8111-111111111111"

function counts(overrides: Partial<BasinLiquidityCounts> = {}): BasinLiquidityCounts {
  return {
    activeJobs: 20,
    haulersAvailable: 7,
    id: BASIN,
    inquiries: { answered: 30, medianFirstReplyMinutes: 95, received: 40 },
    jobsConfirmed: 19,
    name: "Willamette Valley",
    stateCode: "OR",
    status: "pilot",
    verifiedLandings: 4,
    ...overrides
  }
}

describe("the targets", () => {
  it("are the issue's", () => {
    expect(LIQUIDITY_WINDOW_DAYS).toBe(14)
    expect(FIRST_REPLY_TARGET_MINUTES).toBe(120)
    expect(STALE_SHARE_TARGET).toBe(0.1)
  })
})

describe("one basin's row", () => {
  it("states every figure, with the two targets met", () => {
    expect(liquidityRow(counts())).toEqual({
      activeJobs: { state: "value", text: "20" },
      answeredShare: { state: "value", text: "75%" },
      haulersAvailable: { state: "value", text: "7" },
      id: BASIN,
      inquiriesPerJob: { state: "value", text: "2.0" },
      jobsConfirmed: { state: "value", text: "19" },
      medianFirstReply: { state: "value", target: "met", text: "1 h 35 min" },
      name: "Willamette Valley",
      staleShare: { state: "value", target: "met", text: "5%" },
      stateCode: "OR",
      status: "pilot",
      statusLabel: "Pilot",
      verifiedLandings: { state: "value", text: "4" }
    })
  })

  it("misses the reply target at exactly 2 hours and the stale target at exactly 10%", () => {
    const row = liquidityRow(counts({ activeJobs: 10, inquiries: { answered: 1, medianFirstReplyMinutes: 120, received: 1 }, jobsConfirmed: 9 }))

    expect(row.medianFirstReply).toEqual({ state: "value", target: "missed", text: "2 h" })
    expect(row.staleShare).toEqual({ state: "value", target: "missed", text: "10%" })
  })

  it("meets them just under", () => {
    const row = liquidityRow(counts({ activeJobs: 1000, inquiries: { answered: 1, medianFirstReplyMinutes: 119, received: 1 }, jobsConfirmed: 901 }))

    expect(row.medianFirstReply).toEqual({ state: "value", target: "met", text: "1 h 59 min" })
    // 9.9%, not a rounded "10%" beside "On target".
    expect(row.staleShare).toEqual({ state: "value", target: "met", text: "9.9%" })
  })

  it("never rounds a share up to the next whole figure across the target", () => {
    // 9.96% is under the target; "10%" beside "On target" would contradict itself.
    const row = liquidityRow(counts({ activeJobs: 10_000, jobsConfirmed: 9004 }))

    expect(row.staleShare).toEqual({ state: "value", target: "met", text: "9.9%" })
  })

  it("writes short and long waits in the unit a person reads", () => {
    const reply = (minutes: number) => liquidityRow(counts({ inquiries: { answered: 1, medianFirstReplyMinutes: minutes, received: 1 } })).medianFirstReply.text

    expect(reply(0)).toBe("Under 1 min")
    expect(reply(45)).toBe("45 min")
    expect(reply(60)).toBe("1 h")
    expect(reply(26 * 60 + 30)).toBe("1 d 2 h")
    expect(reply(48 * 60)).toBe("2 d")
  })

  it("says there is nothing to measure instead of dividing by zero", () => {
    const row = liquidityRow(counts({ activeJobs: 0, inquiries: { answered: 0, medianFirstReplyMinutes: null, received: 0 }, jobsConfirmed: 0 }))

    expect(row.activeJobs).toEqual({ state: "value", text: "0" })
    expect(row.inquiriesPerJob).toEqual({ state: "none", text: "No active jobs" })
    expect(row.staleShare).toEqual({ state: "none", text: "No active jobs" })
    expect(row.answeredShare).toEqual({ state: "none", text: "No inquiries" })
    expect(row.medianFirstReply).toEqual({ state: "none", text: "No replies" })
  })

  it("has inquiries but no reply yet", () => {
    const row = liquidityRow(counts({ inquiries: { answered: 0, medianFirstReplyMinutes: null, received: 6 } }))

    expect(row.answeredShare).toEqual({ state: "value", text: "0%" })
    expect(row.medianFirstReply).toEqual({ state: "none", text: "No replies" })
  })

  it("never shows a share outside 0 to 100% when two counts were read a moment apart", () => {
    const row = liquidityRow(counts({ activeJobs: 3, inquiries: { answered: 5, medianFirstReplyMinutes: 10, received: 4 }, jobsConfirmed: 4 }))

    expect(row.staleShare.text).toBe("0%")
    expect(row.answeredShare.text).toBe("100%")
  })

  it("names each launch status", () => {
    expect(liquidityRow(counts({ status: "closed" })).statusLabel).toBe("Closed")
    expect(liquidityRow(counts({ status: "open" })).statusLabel).toBe("Open")
  })
})

describe("the board", () => {
  it("keeps the store's order", () => {
    const board = liquidityBoard([counts({ name: "Coast Range" }), counts({ id: "33333333-3333-4333-8333-333333333333", name: "Willamette Valley" })])

    expect(board.rows.map((row) => row.name)).toEqual(["Coast Range", "Willamette Valley"])
  })

  it("is empty with no basins", () => {
    expect(liquidityBoard([])).toEqual({ rows: [] })
  })

  it("has one column per figure, each with a heading", () => {
    expect(LIQUIDITY_COLUMNS.map((column) => column.label)).toEqual([
      "Identity-reviewed landings",
      "Active jobs",
      "Confirmed in 14 days",
      "Haulers available",
      "Inquiries per job",
      "Answered",
      "Median first reply",
      "Stale jobs"
    ])
  })
})
