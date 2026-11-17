import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { FIXTURE_JOB, VALID_PROPERTIES } from "./fixtures"

/**
 * The beacons' wiring. Effects never run in server rendering, so this file runs each effect as it is declared; the
 * capture and clock functions are spies, tested for themselves in client.test.ts and flow-clock.test.ts. The beacons
 * load that code with a dynamic import (#330), so each render waits for it to settle.
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

/** Server-renders a beacon, runs its effects, and lets the beacon code's dynamic import settle. */
async function render(element: React.ReactElement): Promise<string> {
  const html = renderToStaticMarkup(element)
  await vi.dynamicImportSettled()
  await new Promise((resolve) => setTimeout(resolve, 0))
  return html
}

beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockClear()
  spies.allowed.mockReturnValue(true)
  spies.start.mockReturnValue(true)
  spies.stop.mockReturnValue(null)
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_beacons")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("product event beacons", () => {
  it("records a share-link open with the parsed channel and starts flow A's clock and tap counter", async () => {
    expect(await render(<ShareLinkOpenedBeacon channel="facebook" jobId={FIXTURE_JOB} signedIn={false} />)).toBe("")

    expect(spies.capture).toHaveBeenCalledWith("share_link_opened", { channel: "facebook", job: FIXTURE_JOB, signed_in: false })
    expect(spies.start).toHaveBeenCalledWith("A", { job: FIXTURE_JOB })
    expect(spies.attach).toHaveBeenCalledWith("A")
  })

  it("sends a channel it does not recognise as other, and a link with no channel as unknown", async () => {
    await render(<ShareLinkOpenedBeacon channel="Jo's group chat" jobId={FIXTURE_JOB} signedIn />)
    await render(<ShareLinkOpenedBeacon jobId={FIXTURE_JOB} signedIn />)

    expect(spies.capture.mock.calls.map((call: unknown[]) => (call[1] as { channel: string }).channel)).toEqual(["other", "unknown"])
  })

  it("counts no taps when the clock could not start (measuring is off)", async () => {
    spies.start.mockReturnValue(false)

    await render(<FlowClockStart flow="B" />)

    expect(spies.start).toHaveBeenCalledWith("B", { job: null })
    expect(spies.attach).not.toHaveBeenCalled()
  })

  it("starts a flow's clock on its first screen and counts taps there", async () => {
    expect(await render(<FlowClockStart flow="E" jobId={FIXTURE_JOB} />)).toBe("")

    expect(spies.start).toHaveBeenCalledWith("E", { job: FIXTURE_JOB })
    expect(spies.attach).toHaveBeenCalledWith("E")
  })

  it("counts taps on a middle screen only when measuring is allowed", async () => {
    await render(<FlowTapCounter flow="A" />)
    expect(spies.attach).toHaveBeenCalledWith("A")

    spies.attach.mockClear()
    spies.allowed.mockReturnValue(false)
    await render(<FlowTapCounter flow="A" />)
    expect(spies.attach).not.toHaveBeenCalled()
  })

  it("stops the clock on the outcome screen and sends what it measured, or nothing", async () => {
    spies.stop.mockReturnValue(VALID_PROPERTIES.flow_timed)

    expect(await render(<FlowClockStop flow="A" jobId={FIXTURE_JOB} step="first_send" />)).toBe("")

    expect(spies.stop).toHaveBeenCalledWith("A", "first_send", { job: FIXTURE_JOB })
    expect(spies.capture).toHaveBeenCalledWith("flow_timed", VALID_PROPERTIES.flow_timed)

    spies.stop.mockReturnValue(null)
    await render(<FlowClockStop flow="B" step="published" />)
    expect(spies.stop).toHaveBeenLastCalledWith("B", "published", { job: null })
    expect(spies.capture).toHaveBeenLastCalledWith("flow_timed", null)
  })

  it("loads no capture or clock code and does nothing without a PostHog key", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "")

    await render(<ShareLinkOpenedBeacon channel="sms" jobId={FIXTURE_JOB} signedIn={false} />)
    await render(<FlowClockStart flow="B" />)
    await render(<FlowTapCounter flow="A" />)
    await render(<FlowClockStop flow="A" jobId={FIXTURE_JOB} step="first_send" />)

    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled()
  })

  it("imports only React up front, so a page that renders a beacon carries no event schemas (#330, #242)", () => {
    const source = readFileSync(fileURLToPath(new URL("./beacons.tsx", import.meta.url)), "utf8")
    const runtimeImports = [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)].map((match) => match[1])

    expect(runtimeImports).toEqual(["react"])
  })
})
