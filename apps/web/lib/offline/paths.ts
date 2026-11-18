/**
 * Which URLs the low-signal pack keeps on the phone (#288).
 *
 * Documents: the app shell, the Find Work list, and one job. Assets: the hashed
 * bundles and the self-hosted V2 fonts those pages need in order to open.
 * Inquiries, landing pages and APIs are never in this set: a cached job is the
 * public page the person already opened, not a private thread.
 */

export const OFFLINE_CACHE = "logloads-low-signal-v1"

export function isAppShellDocument(pathname: string): boolean {
  return pathname === "/" || pathname === "/v2"
}

export function isFindWorkDocument(pathname: string): boolean {
  return pathname === "/v2/work"
}

/** `/v2/work/<slug>` — one segment, the public job page. */
export function isJobDetailDocument(pathname: string): boolean {
  if (!pathname.startsWith("/v2/work/")) return false
  const slug = pathname.slice("/v2/work/".length)
  return slug.length > 0 && !slug.includes("/")
}

export function isCachedDocument(pathname: string): boolean {
  return isAppShellDocument(pathname) || isFindWorkDocument(pathname) || isJobDetailDocument(pathname)
}

export function isShellAsset(pathname: string): boolean {
  return pathname.startsWith("/_next/static/") || pathname.startsWith("/v2/_fonts/")
}

export function jobSlugFromPath(pathname: string): string | null {
  if (!isJobDetailDocument(pathname)) return null
  try {
    return decodeURIComponent(pathname.slice("/v2/work/".length))
  } catch {
    return null
  }
}
