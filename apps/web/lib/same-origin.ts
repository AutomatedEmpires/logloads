import { ApiError } from "./api-actor"

/**
 * The host the browser addressed. `request.url` is not it: under `next start`
 * Next builds that URL from the listening address (`-H 127.0.0.1` gives
 * `http://localhost:<port>`), so comparing against it refuses every real page.
 * The Host header, or the proxy's X-Forwarded-Host, is what the browser sent,
 * and a cross-site page cannot change either. Next's Server Actions use the
 * same comparison.
 */
function requestedHost(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()

  return (forwarded || request.headers.get("host") || new URL(request.url).host).toLowerCase()
}

function originHost(origin: string | null): string | null {
  if (!origin) {
    return null
  }

  try {
    return new URL(origin).host
  } catch {
    return null
  }
}

/**
 * Refuses a state-changing request that did not come from a LogLoads page.
 *
 * The browser sets `Origin` on every POST and `Sec-Fetch-Site` where it is
 * supported; neither can be set by a cross-site page. Admin POSTs require both
 * to agree with this deployment, so their CSRF protection does not rest on the
 * session cookie's `SameSite=Lax` alone.
 */
export function assertSameOrigin(request: Request): void {
  const fetchSite = request.headers.get("sec-fetch-site")
  const host = originHost(request.headers.get("origin"))

  if (
    host === null ||
    host !== requestedHost(request) ||
    (fetchSite !== null && fetchSite !== "same-origin")
  ) {
    throw new ApiError("This request must come from the LogLoads application", 403)
  }
}
