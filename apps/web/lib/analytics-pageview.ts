/**
 * Analytics pageviews deliberately stop at the pathname boundary. Query
 * strings can carry invitation state, filters, or a private continuation and
 * therefore never belong in a third-party analytics payload.
 */
export function analyticsPageviewUrl(origin: string, pathname: string): string {
  const safeOrigin = origin.replace(/\/+$/, "")
  const rawPathname = pathname.split(/[?#]/, 1)[0] ?? "/"
  const safePathname = rawPathname.startsWith("/") ? rawPathname : `/${rawPathname}`

  return `${safeOrigin}${safePathname}`
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
  save_campaign_params: false,
  save_referrer: false
})

const URL_PROPERTY_PATTERN = /(?:url|referrer)/i
const EXTRACTED_QUERY_PROPERTY_PATTERN = /^\$?(?:ph_keyword|utm_[a-z0-9_]+|gclid|dclid|fbclid|msclkid|gbraid|wbraid|twclid|ttclid|li_fat_id|mc_cid|mc_eid)$/i

function urlWithoutQueryOrFragment(value: string): string {
  try {
    const parsed = new URL(value)

    parsed.search = ""
    parsed.hash = ""
    return parsed.toString()
  } catch {
    return value.split(/[?#]/, 1)[0] ?? value
  }
}

export function sanitizeAnalyticsProperties(
  properties: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).flatMap(([key, value]) =>
      EXTRACTED_QUERY_PROPERTY_PATTERN.test(key)
        ? []
        : [[
            key,
            typeof value === "string" && URL_PROPERTY_PATTERN.test(key)
              ? urlWithoutQueryOrFragment(value)
              : value
          ]]
    )
  )
}

export function sanitizePostHogEvent<
  T extends { properties?: Record<string, unknown> } | null | undefined
>(event: T): T {
  if (!event?.properties) {
    return event
  }

  return {
    ...event,
    properties: sanitizeAnalyticsProperties(event.properties)
  } as T
}
