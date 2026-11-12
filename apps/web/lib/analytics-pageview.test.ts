import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ANALYTICS_CAPTURE_POLICY,
  analyticsPageviewUrl,
  captureAnalyticsPageview,
  createAnalyticsClientLoader,
  sanitizePostHogEvent,
  SENSITIVE_ROUTES,
  sensitiveRouteRoot
} from "./analytics-pageview"

const INQUIRY = "3e7c9f40-5b6d-4e8f-8091-a2b3c4d5e6f7"
const ORG = "1c5a7d2e-3f4b-4c6d-8e7f-8091a2b3c4d5"
const ONE_TAP_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJhIjoicmVwbHkiLCJpIjoxfQ.Qm9ndXNTaWduYXR1cmUx"

/**
 * One path per sensitive screen (legal review §6.5, P0 item 12, #330), as a person reaches it, and the most that may
 * leave the browser there: a pageview at the route's root, with no id, token or query from the path.
 */
const SENSITIVE_PATHS: Array<{ screen: string; path: string; root: string }> = [
  { path: `/v2/inquiries?inquiry=${INQUIRY}#reply`, root: "/v2/inquiries", screen: "the hauler's messages" },
  { path: `/v2/landing/inquiries?inquiry=${INQUIRY}&updated=replied`, root: "/v2/landing/inquiries", screen: "the landing's messages" },
  { path: "/sign-in/factor-one?redirect_url=%2Fv2%2Fwork", root: "/sign-in", screen: "sign-in" },
  { path: "/sign-up/verify-email-address", root: "/sign-up", screen: "sign-up" },
  { path: "/v2/settings/phone/verify?code=482913", root: "/v2/settings/phone", screen: "phone verification (#291)" },
  { path: "/v2/settings/sms-consent", root: "/v2/settings/sms-consent", screen: "SMS consent (#291)" },
  { path: `/v2/org/${ORG}/consent/${ONE_TAP_TOKEN}`, root: "/v2/org/:id/consent", screen: "a consent screen under an id" },
  { path: `/v2/act/${ONE_TAP_TOKEN}`, root: "/v2/act", screen: "a one-tap link (#292)" }
]

afterEach(() => {
  vi.unstubAllGlobals()
})

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
      capture_pageleave: false,
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
      rageclick: false,
      respect_dnt: true,
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

describe("sensitive routes send a pageview at most, with no id from the path (#330)", () => {
  /** What posthog-js adds to every event on the page it is captured on (lib/src/utils/event-utils.ts). */
  function posthogEvent(event: string, path: string, extra: Record<string, unknown> = {}) {
    const url = `https://logloads.com${path}`

    return {
      event,
      properties: {
        $browser: "Chrome",
        $current_url: url,
        $host: "logloads.com",
        $pathname: path.split(/[?#]/, 1)[0],
        $prev_pageview_pathname: path.split(/[?#]/, 1)[0],
        $referrer: "$direct",
        $session_entry_pathname: path.split(/[?#]/, 1)[0],
        $session_entry_url: url,
        title: "Reply to Jo Hauler · LogLoads",
        ...extra
      },
      $set_once: { $initial_current_url: url, $initial_pathname: path.split(/[?#]/, 1)[0] }
    }
  }

  it("names every route the legal review lists", () => {
    expect([...SENSITIVE_ROUTES].sort()).toEqual(["/sign-in", "/sign-up", "/v2/act", "/v2/inquiries", "/v2/landing/inquiries"])
  })

  it.each(SENSITIVE_PATHS)("reduces $screen to its route's root", ({ path, root }) => {
    expect(sensitiveRouteRoot(path)).toBe(root)
    expect(analyticsPageviewUrl("https://logloads.com/", path)).toBe(`https://logloads.com${root}`)
  })

  it.each(SENSITIVE_PATHS)("sends $screen's pageview with every path, URL and referrer at the root, and no title", ({ path, root }) => {
    const sent = sanitizePostHogEvent(posthogEvent("$pageview", path, { $current_url: analyticsPageviewUrl("https://logloads.com", path) }))

    expect(sent?.properties).toEqual({
      $browser: "Chrome",
      $current_url: `https://logloads.com${root}`,
      $host: "logloads.com",
      $pathname: root,
      $prev_pageview_pathname: root,
      $referrer: "$direct",
      $session_entry_pathname: root,
      $session_entry_url: `https://logloads.com${root}`
    })
    expect(sent?.$set_once).toEqual({ $initial_current_url: `https://logloads.com${root}`, $initial_pathname: root })

    const serialized = JSON.stringify(sent)
    for (const secret of [INQUIRY, ORG, ONE_TAP_TOKEN, "482913", "factor-one", "verify-email-address", "Jo Hauler"]) {
      expect(serialized).not.toContain(secret)
    }
  })

  it.each(SENSITIVE_PATHS)("sends nothing else from $screen: no product event, click, input or error capture", ({ path }) => {
    for (const event of ["flow_timed", "share_link_opened", "$autocapture", "$rageclick", "$dead_click", "$exception", "$pageleave", "$web_vitals", "$snapshot", "interest_typed"]) {
      expect(sanitizePostHogEvent(posthogEvent(event, path)), event).toBeNull()
    }
  })

  it("reads the open page from the browser when an event carries no path of its own", () => {
    vi.stubGlobal("window", { location: { pathname: `/v2/act/${ONE_TAP_TOKEN}` } })

    expect(sanitizePostHogEvent({ event: "flow_timed", properties: { flow: "C" } })).toBeNull()
    expect(sanitizePostHogEvent({ event: "$pageview", properties: {} })?.properties).toEqual({})
  })

  it("strips a sensitive route's ids from the referrer of an ordinary page, and keeps that page's events", () => {
    const sent = sanitizePostHogEvent(
      posthogEvent("flow_timed", "/v2/landing/jobs", { $referrer: `https://logloads.com/v2/act/${ONE_TAP_TOKEN}`, flow: "E" })
    )

    expect(sent?.event).toBe("flow_timed")
    expect(sent?.properties).toMatchObject({ $pathname: "/v2/landing/jobs", $referrer: "https://logloads.com/v2/act", flow: "E", title: "Reply to Jo Hauler · LogLoads" })
    expect(JSON.stringify(sent)).not.toContain(ONE_TAP_TOKEN)
  })

  it.each(["/", "/v2/work", "/v2/work/6f1c2a7e-3b4d-4c5e-8f60-718293a4b5c6", "/v2/landing/jobs/new", "/v2/hauler/trucks", "/sign-in-help", "/pricing"])(
    "leaves %s an ordinary route",
    (path) => {
      expect(sensitiveRouteRoot(path)).toBeNull()
      expect(analyticsPageviewUrl("https://logloads.com", path)).toBe(`https://logloads.com${path === "/" ? "/" : path}`)
      expect(sanitizePostHogEvent(posthogEvent("flow_timed", path))?.properties.$pathname).toBe(path)
    }
  )
})
