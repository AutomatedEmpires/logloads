import { ANALYTICS_CAPTURE_POLICY, createAnalyticsClientLoader, sanitizePostHogEvent } from "@/lib/analytics-pageview"

import { currentBrowserRefusesTracking } from "./consent"
import {
  buildProductEvent,
  productEventSide,
  SHARE_CHANNELS,
  type ClientProductEventName,
  type ProductEventOutcome,
  type ProductEventProperties,
  type ShareChannel
} from "./events"

/**
 * Browser capture for the two client product events (#286): `share_link_opened` and `flow_timed`. Call it from a
 * client component's effect, never during server rendering. It sends nothing without a PostHog key, in a browser that
 * sends Do Not Track or Global Privacy Control, or for properties that fail the event's schema or the personal-data
 * guard, and it never throws.
 *
 * PostHog is initialised with the same capture policy as the pageview tracker (`ANALYTICS_CAPTURE_POLICY`: no
 * autocapture, recording, surveys or campaign data, and query strings stripped before send). Whichever loads first
 * initialises it; the other reuses that instance.
 */

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com"

export interface ProductAnalyticsClient {
  capture(event: string, properties: Record<string, unknown>): unknown
}

/** Whether this build has a PostHog key. `NEXT_PUBLIC_*` is inlined at build time, so this is a constant in the browser. */
export function clientAnalyticsEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY)
}

export const loadProductAnalyticsClient = createAnalyticsClientLoader<ProductAnalyticsClient>(async () => {
  const { default: posthog } = await import("posthog-js")

  if (!posthog.__loaded) {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      ...ANALYTICS_CAPTURE_POLICY,
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
      before_send: sanitizePostHogEvent
    })
  }

  return posthog
})

/** Replaceable parts, for tests. */
export interface ClientCaptureDependencies {
  enabled?: () => boolean
  refusesTracking?: () => boolean
  load?: () => Promise<ProductAnalyticsClient | null>
}

function warnDropped(name: string, problems: readonly string[]): void {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[analytics] dropped product event ${name}: ${problems.join(" ")}`)
  }
}

/** Sends one client product event. `properties: null` (nothing to record, such as no running flow clock) sends nothing. */
export async function captureClientProductEvent<N extends ClientProductEventName>(
  name: N,
  properties: ProductEventProperties<N> | null,
  dependencies: ClientCaptureDependencies = {}
): Promise<ProductEventOutcome> {
  try {
    if (properties === null) {
      return "skipped"
    }

    if (productEventSide(name) !== "client") {
      warnDropped(name, ["(event):not_a_client_event"])
      return "invalid"
    }

    const built = buildProductEvent(name, properties)

    if (!built.ok) {
      warnDropped(name, built.problems)
      return "invalid"
    }

    if (!(dependencies.enabled ?? clientAnalyticsEnabled)()) {
      return "disabled"
    }

    if ((dependencies.refusesTracking ?? currentBrowserRefusesTracking)()) {
      return "declined"
    }

    const client = await (dependencies.load ?? loadProductAnalyticsClient)()

    if (!client) {
      return "disabled"
    }

    client.capture(built.event.name, built.event.properties)
    return "sent"
  } catch {
    return "invalid"
  }
}

const CHANNELS: ReadonlySet<string> = new Set(SHARE_CHANNELS)

/**
 * The share channel a link says it came from, as one of `SHARE_CHANNELS`. Only an exact channel value counts;
 * anything else is `other`, and no value is `unknown`. The raw value is never sent.
 */
export function parseShareChannel(raw: string | null | undefined): ShareChannel {
  const value = raw?.trim().toLowerCase() ?? ""

  if (!value) {
    return "unknown"
  }

  return CHANNELS.has(value) && value !== "unknown" ? (value as ShareChannel) : "other"
}
