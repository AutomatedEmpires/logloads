import { ApiError } from "./api-actor"

/**
 * Refuses a state-changing request that did not come from a LogLoads page.
 *
 * The browser sets `Origin` on every POST and `Sec-Fetch-Site` where it is
 * supported; neither can be set by a cross-site page. Admin POSTs require both
 * to agree with this deployment, so their CSRF protection does not rest on the
 * session cookie's `SameSite=Lax` alone.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin")
  const fetchSite = request.headers.get("sec-fetch-site")

  if (
    origin !== new URL(request.url).origin ||
    (fetchSite !== null && fetchSite !== "same-origin")
  ) {
    throw new ApiError("This request must come from the LogLoads application", 403)
  }
}
