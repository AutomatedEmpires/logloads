import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * HF-09 (#187): GET /api/loads is unauthenticated, and building the board
 * downloads the whole operating_state document. The redacted public projection
 * is shared for a short window instead of rebuilt per request.
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
vi.mock("@/lib/network", () => ({ buildNetworkView: mocks.buildNetworkView }))
vi.mock("@/lib/services", () => ({
  mutateState: () => Promise.reject(new Error("These tests only read")),
  readState: mocks.readState
}))

import { GET } from "../app/api/loads/route"

const STATE = { marker: "operating-state" }
let testClock = Date.parse("2026-11-03T12:00:00.000Z")

describe("public load board window (HF-09)", () => {
  beforeEach(() => {
    testClock += 60_000
    vi.useFakeTimers({ now: testClock, toFake: ["Date"] })
    vi.resetAllMocks()
    mocks.readState.mockImplementation(async (read: (current: { state: typeof STATE }) => unknown) =>
      read({ state: STATE })
    )
    mocks.buildNetworkView.mockImplementation(() => ({ loads: [{ id: `load-at-${Date.now()}` }] }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("serves every anonymous caller inside the window from one state download", async () => {
    const first = await GET()
    vi.setSystemTime(testClock + 9_999)
    const second = await GET()

    expect(await second.json()).toEqual(await first.json())
    expect(second.headers.get("cache-control")).toBe("public, no-store")
    expect(mocks.readState).toHaveBeenCalledTimes(1)
    expect(mocks.buildNetworkView).toHaveBeenCalledWith(STATE, { kind: "public" })
  })

  it("rebuilds the board once the window has passed", async () => {
    const first = await (await GET()).json()
    vi.setSystemTime(testClock + 10_000)
    const second = await (await GET()).json()

    expect(second).not.toEqual(first)
    expect(mocks.readState).toHaveBeenCalledTimes(2)
  })

  it("answers an unavailable state with the sanitized 503 and retries on the next call", async () => {
    mocks.readState.mockRejectedValueOnce(new mocks.OperatingStateUnavailableError("down"))

    const unavailable = await GET()
    const recovered = await GET()

    expect(unavailable.status).toBe(503)
    expect(recovered.status).toBe(200)
    expect(mocks.readState).toHaveBeenCalledTimes(2)
  })
})
