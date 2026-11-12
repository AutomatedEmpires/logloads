/**
 * Message, sign-in, sign-up, verification, consent and one-tap screens (legal review §6.5, P0 item 12, #330). California
 * and Washington wiretap laws have been used against sites where a third-party script captures what people type, so
 * on these screens the browser sends one pageview at most, at the route's root with no id, token or query from the
 * path, and no other event: no product event, click, input or error capture. Session recording, autocapture,
 * heatmaps, surveys and conversations are off everywhere (`ANALYTICS_CAPTURE_POLICY`).
 */
export const SENSITIVE_ROUTES = Object.freeze(["/sign-in", "/sign-up", "/v2/act", "/v2/inquiries", "/v2/landing/inquiries"] as const)

/**
 * Words that mark a screen of the same kind wherever it sits, as a whole path segment or one hyphenated part of it: a
 * message thread, and the phone verification and SMS consent screens of #291, whose routes are not built yet. A route
 * caught by mistake only sends less.
 */
export const SENSITIVE_ROUTE_WORDS = Object.freeze(["consent", "inquiries", "messages", "phone", "sms", "verification", "verify"] as const)

const SENSITIVE_WORDS: ReadonlySet<string> = new Set(SENSITIVE_ROUTE_WORDS)
/** A route's own words ("settings", "sms-consent", "v2"), as opposed to an id or a token, which becomes `:id`. */
const PLAIN_SEGMENT = /^(?:[a-z]+|v\d{1,2})(?:-[a-z]+)*$/
const PLAIN_SEGMENT_MAX = 32

function pathSegments(pathname: string): string[] {
  return (pathname.split(/[?#]/, 1)[0] ?? "").split("/").filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment)
    } catch {
      return segment
    }
  })
}

function plainSegment(segment: string): string {
  return segment.length <= PLAIN_SEGMENT_MAX && PLAIN_SEGMENT.test(segment) ? segment : ":id"
}

/**
 * The root of the sensitive route a path is on, or `null` for an ordinary route. The root is the listed route, or the
 * path up to its first sensitive word with any id or token before it replaced by `:id`; nothing after it is kept.
 */
export function sensitiveRouteRoot(pathname: string): string | null {
  const segments = pathSegments(pathname)
  const lower = segments.map((segment) => segment.toLowerCase())

  for (const route of SENSITIVE_ROUTES) {
    const parts = route.split("/").filter(Boolean)

    if (parts.every((part, index) => lower[index] === part)) {
      return route
    }
  }

  const marker = lower.findIndex((segment) => segment.split("-").some((word) => SENSITIVE_WORDS.has(word)))

  return marker === -1 ? null : `/${segments.slice(0, marker + 1).map(plainSegment).join("/")}`
}

/**
 * Analytics pageviews deliberately stop at the pathname boundary. Query
 * strings can carry invitation state, filters, or a private continuation and
 * therefore never belong in a third-party analytics payload. On a sensitive
 * route the pathname stops at the route's root (`sensitiveRouteRoot`).
 */
export function analyticsPageviewUrl(origin: string, pathname: string): string {
  const safeOrigin = origin.replace(/\/+$/, "")
  const rawPathname = pathname.split(/[?#]/, 1)[0] ?? "/"
  const safePathname = rawPathname.startsWith("/") ? rawPathname : `/${rawPathname}`

  return `${safeOrigin}${sensitiveRouteRoot(safePathname) ?? safePathname}`
}

export function createAnalyticsClientLoader<T>(
  load: () => Promise<T>
): () => Promise<T | null> {
  let clientPromise: Promise<T | null> | null = null

  return () => {
    clientPromise ??= load().catch(() => {
      clientPromise = null
      return null
    })

    return clientPromise
  }
}

export function captureAnalyticsPageview(
  client: { capture: (event: string, properties: Record<string, unknown>) => unknown },
  origin: string,
  pathname: string
): void {
  client.capture("$pageview", {
    $current_url: analyticsPageviewUrl(origin, pathname)
  })
}

export const ANALYTICS_CAPTURE_POLICY = Object.freeze({
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
  person_profiles: "identified_only" as const,
  rageclick: false,
  // A second check behind `currentBrowserRefusesTracking` (lib/analytics/consent.ts), which also reads Global
  // Privacy Control: posthog-js reads only Do Not Track.
  respect_dnt: true,
  save_campaign_params: false,
  save_referrer: false
})

const URL_PROPERTY_PATTERN = /(?:url|referrer|pathname)/i
const EXTRACTED_QUERY_PROPERTY_PATTERN = /^\$?(?:ph_keyword|utm_[a-z0-9_]+|gclid|dclid|fbclid|msclkid|gbraid|wbraid|twclid|ttclid|li_fat_id|mc_cid|mc_eid)$/i
/** Properties a sensitive route's pageview never carries: the document title can name the other side of a thread. */
const SENSITIVE_ROUTE_DROPPED_PROPERTIES: ReadonlySet<string> = new Set(["title"])

/** A URL or a bare path without its query or fragment, and on a sensitive route at that route's root. */
function safeLocation(value: string): string {
  try {
    const parsed = new URL(value)

    parsed.search = ""
    parsed.hash = ""
    parsed.pathname = sensitiveRouteRoot(parsed.pathname) ?? parsed.pathname
    return parsed.toString()
  } catch {
    const path = value.split(/[?#]/, 1)[0] ?? value
    return path.startsWith("/") ? sensitiveRouteRoot(path) ?? path : path
  }
}

export function sanitizeAnalyticsProperties(
  properties: Record<string, unknown>,
  options: { sensitiveRoute?: boolean } = {}
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).flatMap(([key, value]) =>
      EXTRACTED_QUERY_PROPERTY_PATTERN.test(key) || (options.sensitiveRoute && SENSITIVE_ROUTE_DROPPED_PROPERTIES.has(key))
        ? []
        : [[
            key,
            typeof value === "string" && URL_PROPERTY_PATTERN.test(key)
              ? safeLocation(value)
              : value
          ]]
    )
  )
}

interface PostHogEventLike {
  event?: string
  properties?: Record<string, unknown>
  $set?: Record<string, unknown>
  $set_once?: Record<string, unknown>
}

function pathOf(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  try {
    return new URL(value).pathname
  } catch {
    return value.startsWith("/") ? value : null
  }
}

function openPagePathname(): string | null {
  try {
    return typeof window === "undefined" ? null : window.location?.pathname ?? null
  } catch {
    return null
  }
}

/** Whether the event was captured on a sensitive route: its own path or URL says so, or the open page does. */
function onSensitiveRoute(event: PostHogEventLike): boolean {
  const properties = event.properties ?? {}

  return [pathOf(properties.$pathname), pathOf(properties.$current_url), openPagePathname()].some(
    (path) => path !== null && sensitiveRouteRoot(path) !== null
  )
}

/**
 * PostHog's `before_send` for every client event, whichever loader initialised it. It removes query strings and
 * campaign data everywhere and a sensitive route's ids from every URL, path and referrer (in the event and in its
 * `$set` and `$set_once`). On a sensitive route it drops every event but the pageview (`null` tells PostHog to send
 * nothing), so at most a pageview at the route's root leaves the browser there.
 */
export function sanitizePostHogEvent<T extends PostHogEventLike | null | undefined>(event: T): T | null {
  if (!event) {
    return event
  }

  const sensitiveRoute = onSensitiveRoute(event)

  if (sensitiveRoute && event.event !== "$pageview") {
    return null
  }

  if (!event.properties) {
    return event
  }

  return {
    ...event,
    properties: sanitizeAnalyticsProperties(event.properties, { sensitiveRoute }),
    ...(event.$set ? { $set: sanitizeAnalyticsProperties(event.$set, { sensitiveRoute }) } : {}),
    ...(event.$set_once ? { $set_once: sanitizeAnalyticsProperties(event.$set_once, { sensitiveRoute }) } : {})
  } as T
}
