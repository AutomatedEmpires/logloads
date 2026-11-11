import { afterEach, describe, expect, it, vi } from "vitest"

import { captureClientProductEvent, parseShareChannel, type ClientCaptureDependencies } from "./client"
import { COMMON_PROPERTY_KEYS, PRODUCT_EVENT_VERSION } from "./events"
import { FIXTURE_JOB, PERSONAL_STRINGS, VALID_PROPERTIES } from "./fixtures"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function fakeBrowser(overrides: Partial<ClientCaptureDependencies> = {}) {
  const capture = vi.fn()
  const load = vi.fn(async () => ({ capture }))

  return { capture, dependencies: { enabled: () => true, load, refusesTracking: () => false, ...overrides }, load }
}

describe("client product events", () => {
  it.each(["share_link_opened", "flow_timed"] as const)("sends %s once with its declared properties, the version and its flows", async (name) => {
    const browser = fakeBrowser()

    await expect(captureClientProductEvent(name, VALID_PROPERTIES[name] as never, browser.dependencies)).resolves.toBe("sent")

    expect(browser.capture).toHaveBeenCalledTimes(1)
    const [event, properties] = browser.capture.mock.calls[0]!
    expect(event).toBe(name)
    expect(Object.keys(properties).sort()).toEqual([...Object.keys(VALID_PROPERTIES[name]), ...COMMON_PROPERTY_KEYS].sort())
    expect(properties.event_version).toBe(PRODUCT_EVENT_VERSION)
  })

  it("does not load PostHog in a browser that sends Do Not Track or Global Privacy Control", async () => {
    const browser = fakeBrowser({ refusesTracking: () => true })

    await expect(captureClientProductEvent("share_link_opened", VALID_PROPERTIES.share_link_opened as never, browser.dependencies)).resolves.toBe("declined")
    expect(browser.load).not.toHaveBeenCalled()
  })

  it("is inert without a PostHog key", async () => {
    const browser = fakeBrowser({ enabled: () => false })

    await expect(captureClientProductEvent("share_link_opened", VALID_PROPERTIES.share_link_opened as never, browser.dependencies)).resolves.toBe("disabled")
    expect(browser.load).not.toHaveBeenCalled()
  })

  it("refuses personal data and server events before loading anything", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const browser = fakeBrowser()

    for (const personal of PERSONAL_STRINGS) {
      await expect(
        captureClientProductEvent("share_link_opened", { ...VALID_PROPERTIES.share_link_opened, channel: personal } as never, browser.dependencies)
      ).resolves.toBe("invalid")
    }

    await expect(
      captureClientProductEvent("share_link_opened", { ...VALID_PROPERTIES.share_link_opened, referrer: "https://m.facebook.com/" } as never, browser.dependencies)
    ).resolves.toBe("invalid")
    await expect(captureClientProductEvent("job_published" as never, VALID_PROPERTIES.job_published as never, browser.dependencies)).resolves.toBe("invalid")
    expect(browser.load).not.toHaveBeenCalled()
  })

  it("sends nothing for an empty measurement, an unavailable client or a client that throws", async () => {
    const skipped = fakeBrowser()
    await expect(captureClientProductEvent("flow_timed", null, skipped.dependencies)).resolves.toBe("skipped")
    expect(skipped.load).not.toHaveBeenCalled()

    const unavailable = fakeBrowser({ load: async () => null })
    await expect(captureClientProductEvent("flow_timed", VALID_PROPERTIES.flow_timed as never, unavailable.dependencies)).resolves.toBe("disabled")

    const broken = fakeBrowser({
      load: async () => ({
        capture: () => {
          throw new Error("blocked by an extension")
        }
      })
    })
    await expect(captureClientProductEvent("flow_timed", VALID_PROPERTIES.flow_timed as never, broken.dependencies)).resolves.toBe("invalid")
  })

  it("by default needs a PostHog key and a browser, so server rendering sends nothing", async () => {
    await expect(captureClientProductEvent("share_link_opened", VALID_PROPERTIES.share_link_opened as never)).resolves.toBe("disabled")

    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test")
    await expect(captureClientProductEvent("share_link_opened", VALID_PROPERTIES.share_link_opened as never)).resolves.toBe("declined")
  })
})

describe("parseShareChannel", () => {
  it.each([
    ["sms", "sms"],
    [" SMS ", "sms"],
    ["facebook", "facebook"],
    ["copy_link", "copy_link"],
    ["whatsapp", "other"],
    ["Jo's group chat", "other"],
    ["unknown", "other"],
    ["", "unknown"],
    [null, "unknown"],
    [undefined, "unknown"]
  ])("reads %o as %s", (raw, channel) => {
    expect(parseShareChannel(raw)).toBe(channel)
  })

  it("feeds share_link_opened a value its schema accepts", async () => {
    const browser = fakeBrowser()

    await captureClientProductEvent("share_link_opened", { channel: parseShareChannel("whatsapp"), job: FIXTURE_JOB, signed_in: true }, browser.dependencies)
    expect(browser.capture.mock.calls[0]?.[1]).toMatchObject({ channel: "other", signed_in: true })
  })
})
