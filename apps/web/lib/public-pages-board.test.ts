import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * HF-09 (#187), the server-rendered half: `/`, `/loads`, `/loads/[slug]` and
 * the sitemap read the public board through `getPublicLoads`. Anonymous views
 * share the short-lived projection `GET /api/loads` serves instead of each
 * downloading the whole operating_state document.
 */

const mocks = vi.hoisted(() => ({
  OperatingStateUnavailableError: class OperatingStateUnavailableError extends Error {},
  buildNetworkView: vi.fn(),
  readState: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/api-actor", () => ({
  apiErrorResponse: (error: unknown) =>
    Response.json(
      { error: "The service is busy. Try again shortly." },
      { status: error instanceof mocks.OperatingStateUnavailableError ? 503 : 500 }
    ),
  requireApiActor: () => Promise.reject(new Error("The public board never resolves an API actor"))
}))
vi.mock("./network", () => ({
  buildNetworkView: mocks.buildNetworkView,
  publicAvailableEquipmentCount: () => 0
}))
vi.mock("./services", () => ({
  mutateState: () => Promise.reject(new Error("These tests only read")),
  readState: mocks.readState,
  services: { state: {} }
}))
vi.mock("./session", () => ({ requireCockpitActor: vi.fn() }))

import { GET } from "../app/api/loads/route"
import { findPublicLoad, getPublicLoads } from "./v3"

const STATE = { marker: "operating-state" }
let testClock = Date.parse("2026-11-03T12:00:00.000Z")

function boardAt(time: number) {
  return [{ id: `load-${time}`, reference: `LL-${time}`, title: "Ridge saw-log block" }]
}

describe("public pages share the short-lived board (HF-09)", () => {
  beforeEach(() => {
    // Each case starts past the previous case's window.
    testClock += 60_000
    vi.useFakeTimers({ now: testClock, toFake: ["Date"] })
    vi.resetAllMocks()
    mocks.readState.mockImplementation(async (read: (current: { state: typeof STATE }) => unknown) =>
      read({ state: STATE })
    )
    mocks.buildNetworkView.mockImplementation(() => ({ loads: boardAt(Date.now()) }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("serves every anonymous page view inside the window from one state download", async () => {
    const listing = await getPublicLoads()
    vi.setSystemTime(testClock + 5_000)
    const home = await getPublicLoads()
    const detail = await findPublicLoad(`ridge-saw-log-block-ll-${testClock}`)
    vi.setSystemTime(testClock + 9_999)
    const board = await (await GET()).json()

    expect(home).toEqual(listing)
    expect(detail).toEqual(listing[0])
    expect(board).toEqual({ loads: listing })
    expect(mocks.readState).toHaveBeenCalledTimes(1)
    expect(mocks.buildNetworkView).toHaveBeenCalledTimes(1)
    expect(mocks.buildNetworkView).toHaveBeenCalledWith(STATE, { kind: "public" })
  })

  it("rebuilds the board once the window has passed", async () => {
    const first = await getPublicLoads()
    vi.setSystemTime(testClock + 10_000)
    const second = await getPublicLoads()

    expect(second).not.toEqual(first)
    expect(mocks.readState).toHaveBeenCalledTimes(2)
  })

  it("does not keep a failed load, so the next page view retries", async () => {
    mocks.readState.mockRejectedValueOnce(new mocks.OperatingStateUnavailableError("down"))

    await expect(getPublicLoads()).rejects.toThrow("down")
    await expect(getPublicLoads()).resolves.toEqual(boardAt(testClock))
    expect(mocks.readState).toHaveBeenCalledTimes(2)
  })
})
