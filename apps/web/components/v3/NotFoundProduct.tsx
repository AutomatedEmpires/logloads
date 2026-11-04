"use client"

import { EmptyState, PublicShell } from "./Shells"

/**
 * The root not-found page (app/not-found.tsx). Keep it in this module, imported by nothing else and kept out of the
 * components/v3 barrel (#137).
 *
 * Every route's server payload carries the root layout's not-found element, so the browser loads the chunks of the
 * client module it names on every page, legacy or V2, found or not. Next.js lists one set of chunks per client module
 * for all root-level entries, and the home page imports the whole barrel, so a module the home page also reaches
 * (PublicPages.tsx, where this lived) made every page download the home page's client bundle: about 190 KiB of
 * compressed script, Supabase and Stripe included. This module's chunks are only what the page itself needs.
 */
export function NotFoundProduct() {
  return <PublicShell><main className="page-main"><EmptyState title="This page is not available." body="The page may have moved or the load may no longer be public." actionHref="/" actionLabel="Go home" /></main></PublicShell>
}
