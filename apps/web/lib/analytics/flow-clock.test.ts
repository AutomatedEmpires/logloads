import { describe, expect, it, vi } from "vitest"

import { buildProductEvent, FLOW_TIMING_CAP_MS } from "./events"
import { FIXTURE_JOB } from "./fixtures"
import {
  attachFlowTapCounter,
  FLOW_CLOCK_STALE_MS,
  noteFlowTap,
  startFlowClock,
  stopFlowClock,
  type FlowClockStorage
} from "./flow-clock"

function memoryStorage(): FlowClockStorage & { values: Map<string, string> } {
  const values = new Map<string, string>()

  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
    values
  }
}

const allowed = () => true
const T0 = Date.parse("2026-11-10T06:00:00.000Z")

describe("the flow clock", () => {
  it("times flow A from the shared link to the first send, with its taps, as a valid flow_timed event", () => {
    const storage = memoryStorage()

    expect(startFlowClock("A", { allowed, job: FIXTURE_JOB, now: T0, storage })).toBe(true)
    for (let tap = 0; tap < 7; tap += 1) noteFlowTap("A", { now: T0 + tap * 1000, storage })

    const timed = stopFlowClock("A", "first_send", { now: T0 + 71_500, storage })

    expect(timed).toEqual({ capped: false, elapsed_ms: 71_500, flow: "A", job: FIXTURE_JOB, step: "first_send", taps: 7 })
    expect(buildProductEvent("flow_timed", timed!).ok).toBe(true)
  })

  it("keeps only the start time, the tap count and the public job id", () => {
    const storage = memoryStorage()

    startFlowClock("B", { allowed, now: T0, storage })
    noteFlowTap("B", { now: T0 + 1, storage })

    expect([...storage.values.entries()]).toEqual([["logloads:v2:flow-clock:B", JSON.stringify({ job: null, startedAt: T0, taps: 1 })]])
  })

  it("does not restart a running clock on a reload or a return from sign-up", () => {
    const storage = memoryStorage()

    startFlowClock("A", { allowed, now: T0, storage })
    startFlowClock("A", { allowed, now: T0 + 30_000, storage })

    expect(stopFlowClock("A", "first_send", { now: T0 + 60_000, storage })?.elapsed_ms).toBe(60_000)
  })

  it("times an outcome once, and reports nothing when the flow never started", () => {
    const storage = memoryStorage()

    expect(stopFlowClock("C", "answered", { now: T0, storage })).toBeNull()

    startFlowClock("C", { allowed, now: T0, storage })
    expect(stopFlowClock("C", "answered", { now: T0 + 5_000, storage })).not.toBeNull()
    expect(stopFlowClock("C", "answered", { now: T0 + 6_000, storage })).toBeNull()
  })

  it("caps long waits and many taps, and drops a clock from another day", () => {
    const storage = memoryStorage()

    startFlowClock("B", { allowed, now: T0, storage })
    for (let tap = 0; tap < 150; tap += 1) noteFlowTap("B", { now: T0 + tap, storage })
    expect(stopFlowClock("B", "published", { now: T0 + 2 * FLOW_TIMING_CAP_MS, storage })).toMatchObject({
      capped: true,
      elapsed_ms: FLOW_TIMING_CAP_MS,
      taps: 99
    })

    startFlowClock("D", { allowed, now: T0, storage })
    expect(stopFlowClock("D", "confirmed", { now: T0 + FLOW_CLOCK_STALE_MS + 1, storage })).toBeNull()

    startFlowClock("E", { allowed, now: T0, storage })
    expect(startFlowClock("E", { allowed, now: T0 + FLOW_CLOCK_STALE_MS + 1, storage })).toBe(true)
    expect(stopFlowClock("E", "reconfirmed", { now: T0 + FLOW_CLOCK_STALE_MS + 2, storage })?.elapsed_ms).toBe(1)
  })

  it("stores nothing when measuring is not allowed (Do Not Track, Global Privacy Control, no PostHog key)", () => {
    const storage = memoryStorage()

    expect(startFlowClock("A", { allowed: () => false, now: T0, storage })).toBe(false)
    noteFlowTap("A", { now: T0, storage })
    expect(storage.values.size).toBe(0)
  })

  it("by default needs a browser, so server rendering stores nothing", () => {
    expect(startFlowClock("A")).toBe(false)
    expect(stopFlowClock("A", "first_send")).toBeNull()
  })

  it("keeps a job id only when it is a listing id", () => {
    const storage = memoryStorage()

    startFlowClock("A", { allowed, job: "jo.hauler@example.com", now: T0, storage })
    expect(stopFlowClock("A", "first_send", { now: T0 + 1, storage })?.job).toBeNull()
  })

  it("survives storage that throws or holds something unreadable", () => {
    const throwing: FlowClockStorage = {
      getItem: () => {
        throw new Error("denied")
      },
      removeItem: () => {
        throw new Error("denied")
      },
      setItem: () => {
        throw new Error("quota")
      }
    }

    expect(startFlowClock("A", { allowed, now: T0, storage: throwing })).toBe(false)
    expect(() => noteFlowTap("A", { now: T0, storage: throwing })).not.toThrow()
    expect(stopFlowClock("A", "first_send", { now: T0, storage: throwing })).toBeNull()

    const corrupted = memoryStorage()
    corrupted.setItem("logloads:v2:flow-clock:A", "{not json")
    expect(stopFlowClock("A", "first_send", { now: T0, storage: corrupted })).toBeNull()
    corrupted.setItem("logloads:v2:flow-clock:A", JSON.stringify({ startedAt: "yesterday", taps: 2 }))
    expect(stopFlowClock("A", "first_send", { now: T0, storage: corrupted })).toBeNull()
  })
})

describe("attachFlowTapCounter", () => {
  function fakeSource() {
    const listeners = new Set<(event: { isPrimary?: boolean; target: unknown }) => void>()

    return {
      addEventListener: vi.fn((_type: string, listener: (event: { isPrimary?: boolean; target: unknown }) => void) => void listeners.add(listener)),
      press: (event: { isPrimary?: boolean; target: unknown }) => listeners.forEach((listener) => listener(event)),
      removeEventListener: vi.fn((_type: string, listener: (event: { isPrimary?: boolean; target: unknown }) => void) => void listeners.delete(listener))
    }
  }

  const control = { closest: () => ({}) }
  const text = { closest: () => null }

  it("counts primary presses on controls only, never which control, and stops when detached", () => {
    const storage = memoryStorage()
    const source = fakeSource()

    startFlowClock("A", { allowed, now: Date.now(), storage })
    const detach = attachFlowTapCounter("A", { source, storage })

    source.press({ isPrimary: true, target: control })
    source.press({ target: control })
    source.press({ isPrimary: false, target: control })
    source.press({ isPrimary: true, target: text })
    source.press({ isPrimary: true, target: null })
    detach()
    source.press({ isPrimary: true, target: control })

    expect(stopFlowClock("A", "first_send", { storage })?.taps).toBe(2)
    expect(source.addEventListener).toHaveBeenCalledWith("pointerdown", expect.any(Function), { capture: true, passive: true })
    expect(source.removeEventListener).toHaveBeenCalledTimes(1)
  })

  it("does nothing without a document", () => {
    expect(attachFlowTapCounter("A")()).toBeUndefined()
  })
})
