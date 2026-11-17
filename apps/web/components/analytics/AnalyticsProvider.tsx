"use client"

import { usePathname } from "next/navigation"
import { useEffect } from "react"

import { currentBrowserRefusesTracking } from "@/lib/analytics/consent"

/**
 * The capture code, loaded only once a pageview is to be sent: the layout every route shares carries just this
 * component and the privacy check, which keeps the route budgets (#242) where they were.
 */
const loadCapture = () =>
  Promise.all([import("@/lib/analytics/client"), import("@/lib/analytics-pageview")]).then(([client, pageview]) => ({
    capture: pageview.captureAnalyticsPageview,
    load: client.loadProductAnalyticsClient
  }))

function PageViewTracker() {
  const pathname = usePathname()

  useEffect(() => {
    // Do Not Track or Global Privacy Control: PostHog is never loaded here, so nothing is sent.
    if (currentBrowserRefusesTracking()) {
      return
    }

    void loadCapture()
      .then(async ({ capture, load }) => {
        const posthog = await load()

        if (posthog) {
          // On a sensitive route (message, sign-in, verification, consent, one-tap) this is the route's root only.
          capture(posthog, window.location.origin, pathname)
        }
      })
      .catch(() => undefined)
  }, [pathname])

  return null
}

/**
 * Pageviews, activated only when NEXT_PUBLIC_POSTHOG_KEY is set. Without it this is inert: no network, no bundle
 * init. It honours Do Not Track and Global Privacy Control (docs/analytics/event-plan.md §2), and shares one PostHog
 * initialisation with the product events (`loadProductAnalyticsClient`), so both use the same capture policy and the
 * same `before_send`, which keeps a sensitive route to a pageview at its root (`lib/analytics-pageview.ts`).
 */
export function AnalyticsProvider() {
  // `NEXT_PUBLIC_*` is inlined at build time, as in `clientAnalyticsEnabled` (lib/analytics/client.ts).
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    return null
  }

  return <PageViewTracker />
}
