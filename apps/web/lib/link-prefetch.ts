/**
 * Which links may keep Next.js's automatic prefetch (#153, #159).
 *
 * In Next 15.5, an automatic prefetch of a page that is rendered per request (force-dynamic, or anything reading
 * cookies) holds only the route tree. A click from that partial entry commits the page through a second, lazy fetch,
 * and intermittently React parks that transition and never commits it: the tap is handled, the payload arrives and
 * the page never changes (vercel/next.js#98305, closed for 15.5 as Maintenance LTS). Without a prefetch the click
 * makes one full fetch and commits it, and that costs nothing, because a per-request prefetch never carried the data.
 *
 * A prefetch of a statically prerendered page carries the whole page, so the click commits straight from it and the
 * prefetch is pure benefit. Those are the routes `next build` lists as ○ (static) or ● (SSG). Every other route is
 * treated as dynamic. A route missing from this list only loses its prefetch, so when in doubt, leave it out.
 */
export const STATICALLY_PRERENDERED_ROUTES: readonly string[] = [
  "/about",
  "/acceptable-use",
  "/for-fleets",
  "/for-haulers",
  "/for-landings",
  "/how-it-works",
  "/marketplace-rules",
  "/pilot",
  "/pricing",
  "/privacy",
  "/terms",
  "/trust"
]

/** Prerendered route families (`generateStaticParams`): /pilot/[role] and /pilot/capture/[slug]. */
export const STATICALLY_PRERENDERED_PREFIXES: readonly string[] = ["/pilot/", "/terms/"]

type HrefObject = { pathname?: string | null }

function pathnameOf(href: string | HrefObject | URL): string | null {
  if (href instanceof URL) return href.pathname
  if (typeof href !== "string") return href.pathname ?? null
  // Only app-relative paths name a route. Query-only, hash-only and external hrefs do not.
  if (!href.startsWith("/") || href.startsWith("//")) return null

  return href.split(/[?#]/, 1)[0] || "/"
}

export function isStaticallyPrerendered(href: string | HrefObject | URL): boolean {
  const pathname = pathnameOf(href)

  if (pathname === null) return false

  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname

  return (
    STATICALLY_PRERENDERED_ROUTES.includes(normalized) ||
    STATICALLY_PRERENDERED_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  )
}

/**
 * The `prefetch` prop for a link: Next's default for a statically prerendered page, `false` for everything else.
 */
export function prefetchFor(href: string | HrefObject | URL): false | undefined {
  return isStaticallyPrerendered(href) ? undefined : false
}
