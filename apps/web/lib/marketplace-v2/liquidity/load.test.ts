import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { MarketplaceRefusalError, MarketplaceStoreError } from "../port"
import type { BasinLiquidityCounts } from "./board"
import { loadLiquidityBoard, type LiquidityBoardDependencies } from "./load"

/**
 * #326: who gets the board. Only LogLoads staff: on the normalized store the database decides (`platform_admins`),
 * and a landing or hauler account, a signed-out visitor and a refused read all get the same answer, "denied", which
 * the page turns into its not-found page. Nothing about a basin is read for them.
 */

const STAFF = { audience: "logloads-app", issuer: "https://clerk.basin.test", subject: "liquidity_staff" }
const MEMBER = { audience: "logloads-app", issuer: "https://clerk.basin.test", subject: "landing_owner" }

const COUNTS: BasinLiquidityCounts = {
  activeJobs: 14,
  haulersAvailable: 5,
  id: "11111111-1111-4111-8111-111111111111",
  inquiries: { answered: 9, medianFirstReplyMinutes: 80, received: 12 },
  jobsConfirmed: 12,
  name: "Lane",
  stateCode: "OR",
  status: "pilot",
  verifiedLandings: 3
}

function dependencies(overrides: Partial<LiquidityBoardDependencies> = {}) {
  const deps = {
    adapterKind: vi.fn<LiquidityBoardDependencies["adapterKind"]>(() => "normalized"),
    pilotStaff: vi.fn<LiquidityBoardDependencies["pilotStaff"]>(async () => false),
    principal: vi.fn<LiquidityBoardDependencies["principal"]>(async () => STAFF),
    read: vi.fn<LiquidityBoardDependencies["read"]>(async () => [COUNTS]),
    report: vi.fn<LiquidityBoardDependencies["report"]>(() => ({ requestId: "req_7Q2M4K" })),
    ...overrides
  }

  return deps
}

describe("on the normalized store", () => {
  it("gives staff the board, read as themselves", async () => {
    const deps = dependencies()
    const result = await loadLiquidityBoard(deps)

    expect(result.kind).toBe("ready")
    expect(result.kind === "ready" ? result.board.rows.map((row) => row.name) : []).toEqual(["Lane"])
    expect(deps.read).toHaveBeenCalledExactlyOnceWith(STAFF)
    expect(deps.pilotStaff).not.toHaveBeenCalled()
    expect(deps.report).not.toHaveBeenCalled()
  })

  it("gives a landing or hauler account nothing: the database refuses, and the refusal is not an error to log", async () => {
    const deps = dependencies({
      principal: vi.fn(async () => MEMBER),
      read: vi.fn(async () => {
        throw new MarketplaceRefusalError("platform admin required", "42501")
      })
    })

    await expect(loadLiquidityBoard(deps)).resolves.toEqual({ kind: "denied" })
    expect(deps.read).toHaveBeenCalledExactlyOnceWith(MEMBER)
    expect(deps.report).not.toHaveBeenCalled()
  })

  it("gives a signed-out visitor nothing, and reads nothing", async () => {
    const deps = dependencies({ principal: vi.fn(async () => null) })

    await expect(loadLiquidityBoard(deps)).resolves.toEqual({ kind: "denied" })
    expect(deps.read).not.toHaveBeenCalled()
  })

  it("reports a store failure under a request id and shows no figures", async () => {
    const failure = new MarketplaceStoreError()
    const deps = dependencies({
      read: vi.fn(async () => {
        throw failure
      })
    })

    await expect(loadLiquidityBoard(deps)).resolves.toEqual({ kind: "failed", requestId: "req_7Q2M4K" })
    expect(deps.report).toHaveBeenCalledExactlyOnceWith(failure, "liquidity.board")
  })

  it("treats any other refusal as a failure, not as permission", async () => {
    const deps = dependencies({
      read: vi.fn(async () => {
        throw new MarketplaceRefusalError("Basin not found", "P0002")
      })
    })

    await expect(loadLiquidityBoard(deps)).resolves.toEqual({ kind: "failed", requestId: "req_7Q2M4K" })
  })
})

describe("on the pilot store, which keeps no basins", () => {
  it("gives a landing or hauler account nothing", async () => {
    const deps = dependencies({ adapterKind: vi.fn(() => "pilot" as const) })

    await expect(loadLiquidityBoard(deps)).resolves.toEqual({ kind: "denied" })
    expect(deps.principal).not.toHaveBeenCalled()
    expect(deps.read).not.toHaveBeenCalled()
  })

  it("tells staff the board needs the normalized store, and reads nothing", async () => {
    const deps = dependencies({ adapterKind: vi.fn(() => "pilot" as const), pilotStaff: vi.fn(async () => true) })

    await expect(loadLiquidityBoard(deps)).resolves.toEqual({ kind: "unavailable" })
    expect(deps.read).not.toHaveBeenCalled()
  })
})
