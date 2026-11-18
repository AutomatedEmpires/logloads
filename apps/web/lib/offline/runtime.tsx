"use client"

import { useEffect } from "react"
import { usePathname, useSearchParams } from "next/navigation"

import { bindInterestDrafts, restoreInterestPage } from "./interest-form"

/**
 * Registers the low-signal service worker and keeps interest drafts on the
 * phone. Mounted once, inside a Suspense boundary, because the draft restore
 * follows the query string (`?error=`, `?sent=1`).
 */
export function OfflineRuntime() {
  const pathname = usePathname()
  const search = useSearchParams().toString()

  useEffect(() => bindInterestDrafts(window), [])

  useEffect(() => {
    restoreInterestPage(window)
  }, [pathname, search])

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return
    navigator.serviceWorker.register("/sw.js").catch(() => undefined)
  }, [])

  return null
}
