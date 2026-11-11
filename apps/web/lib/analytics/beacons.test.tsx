import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { FIXTURE_JOB, VALID_PROPERTIES } from "./fixtures"

/**
 * The beacons' wiring. Effects never run in server rendering, so this file runs each effect as it is declared; the
 * capture and clock functions are spies, tested for themselves in client.test.ts and flow-clock.test.ts.
 */

const spies = vi.hoisted(() => ({
  allowed: vi.fn(() => true),
  attach: vi.fn(() => () => undefined),
  capture: vi.fn(async () => "sent"),
  start: vi.fn(() => true),
  stop: vi.fn((): unknown => null)
}))

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => unknown) => {
    effect()
  }
}))
vi.mock("./client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client")>()),
  captureClientProductEvent: spies.capture
}))
vi.mock("./flow-clock", () => ({
  attachFlowTapCounter: spies.attach,
  flowTimingAllowed: spies.allowed,
  startFlowClock: spies.start,
  stopFlowClock: spies.stop
}))

import { FlowClockStart, FlowClockStop, FlowTapCounter, ShareLinkOpenedBeacon } from "./beacons"

beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockClear()
  spies.allowed.mockReturnValue(true)
  spies.start.mockReturnValue(true)
  spies.stop.mockReturnValue(null)
})

describe("product event beacons", () => {
  it("records a share-link open with the parsed channel and starts flow A's clock and tap counter", () => {
    expect(renderToStaticMarkup(<ShareLinkOpenedBeacon channel="facebook" jobId={FIXTURE_JOB} signedIn={false} />)).toBe("")

    expect(spies.capture).toHaveBeenCalledWith("share_link_opened", { channel: "facebook", job: FIXTURE_JOB, signed_in: false })
    expect(spies.start).toHaveBeenCalledWith("A", { job: FIXTURE_JOB })
    expect(spies.attach).toHaveBeenCalledWith("A")
  })

  it("sends a channel it does not recognise as other, and a link with no channel as unknown", () => {
    renderToStaticMarkup(<ShareLinkOpenedBeacon channel="Jo's group chat" jobId={FIXTURE_JOB} signedIn />)
    renderToStaticMarkup(<ShareLinkOpenedBeacon jobId={FIXTURE_JOB} signedIn />)

    expect(spies.capture.mock.calls.map((call: unknown[]) => (call[1] as { channel: string }).channel)).toEqual(["other", "unknown"])
  })

  it("counts no taps when the clock could not start (measuring is off)", () => {
    spies.start.mockReturnValue(false)

    renderToStaticMarkup(<FlowClockStart flow="B" />)

    expect(spies.start).toHaveBeenCalledWith("B", { job: null })
    expect(spies.attach).not.toHaveBeenCalled()
  })

  it("starts a flow's clock on its first screen and counts taps there", () => {
    expect(renderToStaticMarkup(<FlowClockStart flow="E" jobId={FIXTURE_JOB} />)).toBe("")

    expect(spies.start).toHaveBeenCalledWith("E", { job: FIXTURE_JOB })
    expect(spies.attach).toHaveBeenCalledWith("E")
  })

  it("counts taps on a middle screen only when measuring is allowed", () => {
    renderToStaticMarkup(<FlowTapCounter flow="A" />)
    expect(spies.attach).toHaveBeenCalledWith("A")

    spies.attach.mockClear()
    spies.allowed.mockReturnValue(false)
    renderToStaticMarkup(<FlowTapCounter flow="A" />)
    expect(spies.attach).not.toHaveBeenCalled()
  })

  it("stops the clock on the outcome screen and sends what it measured, or nothing", () => {
    spies.stop.mockReturnValue(VALID_PROPERTIES.flow_timed)

    expect(renderToStaticMarkup(<FlowClockStop flow="A" step="first_send" />)).toBe("")

    expect(spies.stop).toHaveBeenCalledWith("A", "first_send")
    expect(spies.capture).toHaveBeenCalledWith("flow_timed", VALID_PROPERTIES.flow_timed)

    spies.stop.mockReturnValue(null)
    renderToStaticMarkup(<FlowClockStop flow="B" step="published" />)
    expect(spies.capture).toHaveBeenLastCalledWith("flow_timed", null)
  })
})
