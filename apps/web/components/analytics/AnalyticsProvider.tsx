"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { Suspense, useEffect } from "react"

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com"

let initialized = false

async function ensurePostHog() {
  if (initialized || !POSTHOG_KEY || typeof window === "undefined") {
    return null
  }

  initialized = true
  const { default: posthog } = await import("posthog-js")

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: false,
    person_profiles: "identified_only"
  })

  return posthog
}

function PageViewTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!POSTHOG_KEY) {
      return
    }

    void ensurePostHog().then((posthog) => {
      if (!posthog) {
        return
      }

      const query = searchParams.toString()
      posthog.capture("$pageview", { $current_url: window.location.origin + pathname + (query ? `?${query}` : "") })
    })
  }, [pathname, searchParams])

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

  return (
    <Suspense fallback={null}>
      <PageViewTracker />
    </Suspense>
  )
}
