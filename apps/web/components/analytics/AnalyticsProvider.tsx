"use client"

import { usePathname } from "next/navigation"
import { useEffect } from "react"

import { captureAnalyticsPageview } from "@/lib/analytics-pageview"
import { clientAnalyticsEnabled, loadProductAnalyticsClient } from "@/lib/analytics/client"
import { currentBrowserRefusesTracking } from "@/lib/analytics/consent"

function PageViewTracker() {
  const pathname = usePathname()

  useEffect(() => {
    // Do Not Track or Global Privacy Control: PostHog is never loaded here, so nothing is sent.
    if (currentBrowserRefusesTracking()) {
      return
    }

    void loadProductAnalyticsClient().then((posthog) => {
      if (!posthog) {
        return
      }

      // On a sensitive route (message, sign-in, verification, consent, one-tap) this is the route's root only.
      captureAnalyticsPageview(posthog, window.location.origin, pathname)
    })
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
  if (!clientAnalyticsEnabled()) {
    return null
  }

  return <PageViewTracker />
}
