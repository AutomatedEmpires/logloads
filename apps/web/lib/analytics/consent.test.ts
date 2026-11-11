import { afterEach, describe, expect, it, vi } from "vitest"

import { browserRefusesTracking, currentBrowserRefusesTracking, requestRefusesTracking } from "./consent"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("requestRefusesTracking", () => {
  it.each([
    [{ dnt: "1" }, true],
    [{ "sec-gpc": "1" }, true],
    [{ DNT: " 1 " }, true],
    [{ dnt: "0" }, false],
    [{ "sec-gpc": "0" }, false],
    [{}, false]
  ])("reads %o as refused: %s", (values, refused) => {
    expect(requestRefusesTracking(new Headers(values))).toBe(refused)
  })

  it("treats no request (a scheduled job) as no refusal", () => {
    expect(requestRefusesTracking(null)).toBe(false)
    expect(requestRefusesTracking(undefined)).toBe(false)
  })
})

describe("browserRefusesTracking", () => {
  it.each([
    [{ navigator: { doNotTrack: "1" } }, true],
    [{ navigator: { doNotTrack: "yes" } }, true],
    [{ navigator: { msDoNotTrack: "1" } }, true],
    [{ window: { doNotTrack: "1" } }, true],
    [{ navigator: { globalPrivacyControl: true } }, true],
    [{ navigator: { doNotTrack: "0", globalPrivacyControl: false } }, false],
    [{ navigator: { doNotTrack: "unspecified" } }, false],
    [{ navigator: null, window: null }, false]
  ])("reads %o as refused: %s", (signals, refused) => {
    expect(browserRefusesTracking(signals)).toBe(refused)
  })

  it("refuses when there is no browser, so nothing runs during server rendering", () => {
    expect(currentBrowserRefusesTracking()).toBe(true)
  })

  it("reads the current browser's signals", () => {
    vi.stubGlobal("window", {})
    vi.stubGlobal("navigator", { globalPrivacyControl: true })
    expect(currentBrowserRefusesTracking()).toBe(true)

    vi.stubGlobal("navigator", { doNotTrack: null })
    expect(currentBrowserRefusesTracking()).toBe(false)
  })
})
