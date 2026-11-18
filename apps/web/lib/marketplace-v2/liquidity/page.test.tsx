import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * #326: `/v2/admin/liquidity`, rendered on the server as a first visit receives it. One row per basin, figures only.
 * A person who is not LogLoads staff gets the V2 not-found page and none of the board.
 */

const mocks = vi.hoisted(() => ({ enabled: vi.fn(() => true), load: vi.fn() }))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  }
}))
vi.mock("@/lib/marketplace-v2/flag", () => ({ marketplaceV2Enabled: mocks.enabled }))
vi.mock("@/lib/marketplace-v2/liquidity/load", () => ({ loadLiquidityBoard: mocks.load }))

import LiquidityBoardPage from "@/app/v2/admin/liquidity/page"
import LiquidityBoardLoading from "@/app/v2/admin/liquidity/loading"

import { liquidityBoard, type BasinLiquidityCounts } from "./board"

const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()

function counts(overrides: Partial<BasinLiquidityCounts> = {}): BasinLiquidityCounts {
  return {
    activeJobs: 20,
    haulersAvailable: 7,
    id: "11111111-1111-4111-8111-111111111111",
    inquiries: { answered: 30, medianFirstReplyMinutes: 95, received: 40 },
    jobsConfirmed: 19,
    name: "Willamette Valley",
    stateCode: "OR",
    status: "pilot",
    verifiedLandings: 4,
    ...overrides
  }
}

const render = async () => renderToStaticMarkup(await LiquidityBoardPage())

beforeEach(() => {
  vi.clearAllMocks()
  mocks.enabled.mockReturnValue(true)
  // The app compiles JSX with the classic runtime under Vitest, as in v2-pages.test.tsx.
  vi.stubGlobal("React", React)
})

describe("who gets the page", () => {
  it("is not found for a landing or hauler account, with none of the board", async () => {
    mocks.load.mockResolvedValue({ kind: "denied" })

    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("is not found while V2 is off, before anything is read", async () => {
    mocks.enabled.mockReturnValue(false)

    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND")
    expect(mocks.load).not.toHaveBeenCalled()
  })
})

describe("the board", () => {
  it("has one row per basin under one heading, as a table with a caption and scoped headers", async () => {
    mocks.load.mockResolvedValue({
      board: liquidityBoard([
        counts({ id: "33333333-3333-4333-8333-333333333333", name: "Coast Range", status: "closed" }),
        counts()
      ]),
      kind: "ready"
    })

    const html = await render()

    expect(html).toContain('data-ds-page="admin-liquidity"')
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toMatch(/<h1[^>]*>Basin liquidity<\/h1>/)
    expect(html).toMatch(/<caption[^>]*>[^<]*last 14 days/)
    expect(html.match(/<th[^>]*scope="col"/g)).toHaveLength(9)
    expect(html.match(/<th[^>]*scope="row"/g)).toHaveLength(2)
    expect(html.indexOf("Coast Range")).toBeLessThan(html.indexOf("Willamette Valley"))
    expect(textOf(html)).toContain("Willamette Valley OR · Pilot")
    expect(textOf(html)).toContain("Coast Range OR · Closed")
  })

  it("labels every cell for the stacked phone layout, and says in words whether a target is met", async () => {
    mocks.load.mockResolvedValue({
      board: liquidityBoard([counts({ activeJobs: 10, inquiries: { answered: 3, medianFirstReplyMinutes: 200, received: 4 }, jobsConfirmed: 10 })]),
      kind: "ready"
    })

    const html = await render()

    for (const label of ["Verified landings", "Active jobs", "Confirmed in 14 days", "Haulers available", "Inquiries per job", "Answered", "Median first reply", "Stale jobs"]) {
      expect(html, label).toContain(`data-label="${label}"`)
    }
    expect(html).toMatch(/data-label="Median first reply"[^>]*data-target="missed"[^>]*>3 h 20 min<span[^>]*>Over target<\/span>/)
    expect(html).toMatch(/data-label="Stale jobs"[^>]*data-target="met"[^>]*>0%<span[^>]*>On target<\/span>/)
    expect(textOf(html)).toContain("Targets: a median first reply under 2 hours, and stale jobs under 10% of active jobs.")
  })

  it("says in words when a basin has nothing to compute a share from, and shows no zero in its place", async () => {
    mocks.load.mockResolvedValue({
      board: liquidityBoard([counts({ activeJobs: 0, haulersAvailable: 0, inquiries: { answered: 0, medianFirstReplyMinutes: null, received: 0 }, jobsConfirmed: 0 })]),
      kind: "ready"
    })

    const html = await render()

    expect(html).toMatch(/data-label="Active jobs"[^>]*data-state="value"[^>]*>0</)
    expect(html).toMatch(/data-label="Inquiries per job"[^>]*data-state="none"[^>]*>No active jobs</)
    expect(html).toMatch(/data-label="Answered"[^>]*data-state="none"[^>]*>No inquiries</)
    expect(html).toMatch(/data-label="Median first reply"[^>]*data-state="none"[^>]*>No replies</)
    expect(html).toMatch(/data-label="Stale jobs"[^>]*data-state="none"[^>]*>No active jobs</)
    expect(html).not.toContain("data-target")
  })

  it("says so when no basin is recorded, with no table", async () => {
    mocks.load.mockResolvedValue({ board: liquidityBoard([]), kind: "ready" })

    const html = await render()

    expect(html).toContain('data-kind="empty"')
    expect(textOf(html)).toContain("No basins are recorded yet")
    expect(html).not.toContain("<table")
  })

  it("carries figures only: no id, boundary, person or business", async () => {
    mocks.load.mockResolvedValue({ board: liquidityBoard([counts()]), kind: "ready" })

    const html = await render()

    expect(html).not.toContain("11111111-1111-4111-8111-111111111111")
    expect(html).not.toMatch(/POLYGON|@|mailto:|tel:/)
  })
})

describe("when the board cannot be shown", () => {
  it("says the read failed, with the reference and a way to try again, and no figures", async () => {
    mocks.load.mockResolvedValue({ kind: "failed", requestId: "req_7Q2M4K" })

    const html = await render()

    expect(html).toMatch(/role="alert"/)
    expect(textOf(html)).toContain("The board couldn't load")
    expect(textOf(html)).toContain("Reference: req_7Q2M4K.")
    expect(html).toMatch(/<a[^>]*href="\/v2\/admin\/liquidity"[^>]*>[\s\S]*Try again/)
    expect(html).not.toContain("<table")
  })

  it("leaves the reference out when there is none", async () => {
    mocks.load.mockResolvedValue({ kind: "failed", requestId: null })

    expect(textOf(await render())).not.toContain("Reference")
  })

  it("tells staff on the pilot store that basins need the normalized store", async () => {
    mocks.load.mockResolvedValue({ kind: "unavailable" })

    const html = await render()

    expect(html).toMatch(/role="status"/)
    expect(textOf(html)).toContain("Basins are kept in the normalized marketplace store, which this preview is not using.")
    expect(html).not.toContain("<table")
  })
})

describe("while it loads", () => {
  it("shows the page's heading and a labelled skeleton, so nothing jumps", () => {
    const html = renderToStaticMarkup(<LiquidityBoardLoading />)

    expect(html).toContain('data-ds-page="admin-liquidity"')
    expect(html).toMatch(/<h1[^>]*>Basin liquidity<\/h1>/)
    expect(textOf(html)).toContain("Loading the liquidity board")
  })
})
