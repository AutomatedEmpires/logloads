"use client"

import { usePathname } from "next/navigation"
import { useEffect } from "react"

import {
  ANALYTICS_CAPTURE_POLICY,
  captureAnalyticsPageview,
  createAnalyticsClientLoader,
  sanitizePostHogEvent
} from "@/lib/analytics-pageview"

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com"

const loadPostHogClient = createAnalyticsClientLoader(async () => {
  const { default: posthog } = await import("posthog-js")

  posthog.init(POSTHOG_KEY!, {
    ...ANALYTICS_CAPTURE_POLICY,
    api_host: POSTHOG_HOST,
    before_send: sanitizePostHogEvent
  })

  return posthog
})

async function ensurePostHog() {
  if (!POSTHOG_KEY || typeof window === "undefined") {
    return null
  }

  return loadPostHogClient()
}

function PageViewTracker() {
  const pathname = usePathname()

  useEffect(() => {
    if (!POSTHOG_KEY) {
      return
    }

    void ensurePostHog().then((posthog) => {
      if (!posthog) {
        return
      }

      captureAnalyticsPageview(posthog, window.location.origin, pathname)
    })
  }, [pathname])

  return null
}

/**
 * Product analytics, activated only when NEXT_PUBLIC_POSTHOG_KEY is set. Without
 * it this is inert — no network, no bundle init.
 */
export function AnalyticsProvider() {
  if (!POSTHOG_KEY) {
    return null
  }

  return <PageViewTracker />
}
