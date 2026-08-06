import { describe, expect, it, vi } from "vitest"

import {
  ANALYTICS_CAPTURE_POLICY,
  analyticsPageviewUrl,
  captureAnalyticsPageview,
  createAnalyticsClientLoader,
  sanitizePostHogEvent
} from "./analytics-pageview"

describe("analyticsPageviewUrl", () => {
  it("captures only the origin and pathname", () => {
    expect(
      analyticsPageviewUrl(
        "https://logloads.com/",
        "/driver/profile?welcome=1&next=%2Fdriver%2Floads%2Fprivate-load"
      )
    ).toBe("https://logloads.com/driver/profile")
  })

  it("does not retain query or fragment values on public paths", () => {
    expect(
      analyticsPageviewUrl("https://logloads.com", "/sign-up?invitation=secret#join")
    ).toBe("https://logloads.com/sign-up")
  })

  it("reuses one initialized client while capturing every navigation", async () => {
    const client = { capture: vi.fn() }
    const initialize = vi.fn(async () => client)
    const ensureClient = createAnalyticsClientLoader(initialize)

    captureAnalyticsPageview(
      (await ensureClient())!,
      "https://logloads.com",
      "/driver/profile?welcome=1"
    )
    captureAnalyticsPageview(
      (await ensureClient())!,
      "https://logloads.com",
      "/driver/loads?filter=private"
    )

    expect(initialize).toHaveBeenCalledTimes(1)
    expect(client.capture).toHaveBeenNthCalledWith(1, "$pageview", {
      $current_url: "https://logloads.com/driver/profile"
    })
    expect(client.capture).toHaveBeenNthCalledWith(2, "$pageview", {
      $current_url: "https://logloads.com/driver/loads"
    })
  })

  it("keeps automatic DOM capture and session replay disabled", () => {
    expect(ANALYTICS_CAPTURE_POLICY).toMatchObject({
      advanced_disable_flags: true,
      autocapture: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      capture_heatmaps: false,
      capture_pageview: false,
      capture_performance: false,
      disable_conversations: true,
      disable_external_dependency_loading: true,
      disable_product_tours: true,
      disable_session_recording: true,
      disable_surveys: true,
      disable_surveys_automatic_display: true,
      disable_web_experiments: true,
      enable_recording_console_log: false,
      logs: { captureConsoleLogs: false },
      mask_personal_data_properties: true,
      person_profiles: "identified_only",
      save_campaign_params: false,
      save_referrer: false
    })
  })

  it("scrubs every derived URL field as a defense in depth", () => {
    const event = sanitizePostHogEvent({
      event: "$pageview",
      properties: {
        $current_url: "https://logloads.com/driver/profile?welcome=1&next=private#setup",
        $referrer: "https://logloads.com/sign-up?invitation=secret",
        $session_entry_url: "https://logloads.com/onboarding?next=private",
        $utm_content: "private campaign text",
        count: 2,
        ph_keyword: "private search words"
      }
    })

    expect(event?.properties).toEqual({
      $current_url: "https://logloads.com/driver/profile",
      $referrer: "https://logloads.com/sign-up",
      $session_entry_url: "https://logloads.com/onboarding",
      count: 2
    })
  })
})
