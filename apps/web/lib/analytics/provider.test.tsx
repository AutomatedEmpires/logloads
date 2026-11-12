import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The pageview tracker (`components/analytics/AnalyticsProvider.tsx`, #330). Effects never run in server rendering, so
 * this file runs each effect as it is declared, with the browser's privacy signals and location stubbed. PostHog is a
 * fake: the tracker's job is to decide whether to load it at all and what pageview to hand it.
 */

const fake = vi.hoisted(() => ({
  capture: vi.fn(),
  load: vi.fn(),
  pathname: "/"
}))

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => unknown) => {
    effect()
  }
}))
vi.mock("next/navigation", () => ({ usePathname: () => fake.pathname }))
vi.mock("./client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client")>()),
  loadProductAnalyticsClient: fake.load
}))

import { AnalyticsProvider } from "@/components/analytics/AnalyticsProvider"

const INQUIRY = "3e7c9f40-5b6d-4e8f-8091-a2b3c4d5e6f7"
const ONE_TAP_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJhIjoicmVwbHkiLCJpIjoxfQ.Qm9ndXNTaWduYXR1cmUx"

function browser(signals: { doNotTrack?: unknown; msDoNotTrack?: unknown; windowDoNotTrack?: unknown; globalPrivacyControl?: unknown } = {}) {
  vi.stubGlobal("navigator", { doNotTrack: signals.doNotTrack, globalPrivacyControl: signals.globalPrivacyControl, msDoNotTrack: signals.msDoNotTrack })
  vi.stubGlobal("window", { doNotTrack: signals.windowDoNotTrack, location: { origin: "https://logloads.com", pathname: fake.pathname } })
}

/** Renders the provider on `pathname` and lets the loader's promise settle. */
async function visit(pathname: string) {
  fake.pathname = pathname
  const html = renderToStaticMarkup(<AnalyticsProvider />)
  await Promise.resolve()
  await Promise.resolve()
  return html
}

beforeEach(() => {
  // The app compiles JSX with the classic runtime under Vitest, as in v2-pages.test.tsx.
  vi.stubGlobal("React", React)
  fake.capture.mockClear()
  fake.load.mockReset()
  fake.load.mockResolvedValue({ capture: fake.capture })
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test")
  browser()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("the pageview tracker", () => {
  it("is inert without a PostHog key: no PostHog, no pageview", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "")

    expect(await visit("/v2/work")).toBe("")
    expect(fake.load).not.toHaveBeenCalled()
    expect(fake.capture).not.toHaveBeenCalled()
  })

  it("sends one pageview per route through the product events' single PostHog initialisation, without the query", async () => {
    expect(await visit("/v2/work?near=47.6,-117.4")).toBe("")

    expect(fake.load).toHaveBeenCalledTimes(1)
    expect(fake.capture).toHaveBeenCalledTimes(1)
    expect(fake.capture).toHaveBeenCalledWith("$pageview", { $current_url: "https://logloads.com/v2/work" })
  })

  it.each([
    ["Do Not Track", { doNotTrack: "1" }],
    ["Do Not Track (yes)", { doNotTrack: "yes" }],
    ["Do Not Track (Internet Explorer)", { msDoNotTrack: "1" }],
    ["Do Not Track (window)", { windowDoNotTrack: "1" }],
    ["Global Privacy Control", { globalPrivacyControl: true }]
  ])("never loads PostHog, so sends nothing, in a browser that sends %s", async (_signal, signals) => {
    browser(signals)

    expect(await visit("/v2/work")).toBe("")
    expect(fake.load).not.toHaveBeenCalled()
    expect(fake.capture).not.toHaveBeenCalled()
  })

  it("still sends a pageview when Do Not Track is off ('0') and Global Privacy Control is not true", async () => {
    browser({ doNotTrack: "0", globalPrivacyControl: false })

    await visit("/v2/work")
    expect(fake.capture).toHaveBeenCalledTimes(1)
  })

  it.each([
    [`/v2/inquiries?inquiry=${INQUIRY}`, "/v2/inquiries"],
    [`/v2/landing/inquiries?inquiry=${INQUIRY}`, "/v2/landing/inquiries"],
    ["/sign-in/factor-one", "/sign-in"],
    ["/sign-up/verify-email-address", "/sign-up"],
    ["/v2/settings/phone/verify", "/v2/settings/phone"],
    ["/v2/settings/sms-consent", "/v2/settings/sms-consent"],
    [`/v2/act/${ONE_TAP_TOKEN}`, "/v2/act"]
  ])("sends only a pageview at the route's root on %s", async (path, root) => {
    await visit(path)

    expect(fake.capture).toHaveBeenCalledTimes(1)
    expect(fake.capture).toHaveBeenCalledWith("$pageview", { $current_url: `https://logloads.com${root}` })
    expect(JSON.stringify(fake.capture.mock.calls)).not.toMatch(new RegExp(`${INQUIRY}|${ONE_TAP_TOKEN}|factor-one|verify-email`))
  })

  it("sends nothing when PostHog fails to load", async () => {
    fake.load.mockResolvedValue(null)

    await visit("/v2/work")
    expect(fake.capture).not.toHaveBeenCalled()
  })
})
