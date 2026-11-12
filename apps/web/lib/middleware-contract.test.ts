import { NextRequest, NextResponse, type NextFetchEvent } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import middleware, {
  config,
  pageResponse,
  pilotCaptureNoIndexRoutePatterns,
  privateIndexingRoutePatterns,
  protectFromIndexing,
  protectedRoutePatterns,
  routeMarketplaceV2Entry,
  trackMarketplaceV2Setup
} from "../middleware"
import { V2_SETUP_RESUME_COOKIE } from "./entry-routing"
import {
  isKnownPilotPath,
  pilotSurfaceSlugs
} from "./pilot-route-contract"

const ORIGIN = "https://logloads.test"

function request(path: string, init: { cookie?: string; method?: string; headers?: Record<string, string> } = {}): NextRequest {
  const headers = new Headers(init.headers)

  if (init.cookie !== undefined) headers.set("cookie", `${V2_SETUP_RESUME_COOKIE}=${encodeURIComponent(init.cookie)}`)

  return new NextRequest(`${ORIGIN}${path}`, { headers, method: init.method ?? "GET" })
}

function location(response: NextResponse | null): string | null {
  const header = response?.headers.get("location")

  return header ? header.replace(ORIGIN, "") : null
}

/** What the response does to the remembered setup step: set it, forget it, or leave it alone. */
function resumeCookie(response: NextResponse): { action: "set"; value: string; maxAge?: number; httpOnly?: boolean; sameSite?: unknown; path?: string } | { action: "forget" } | { action: "none" } {
  const cookie = response.cookies.get(V2_SETUP_RESUME_COOKIE)

  if (!cookie) return { action: "none" }
  if (!cookie.value) return { action: "forget" }

  return { action: "set", httpOnly: cookie.httpOnly, maxAge: cookie.maxAge, path: cookie.path, sameSite: cookie.sameSite, value: cookie.value }
}

describe("middleware matcher", () => {
  it("always runs Clerk's frontend API proxy path", () => {
    expect(config.matcher).toContain("/__clerk/(.*)")
  })

  it("runs every Pilot path through the exact public catalog guard", () => {
    expect(config.matcher).toContain("/pilot/:path*")
  })

  it("keeps raw synthetic Pilot captures out of search indexes", () => {
    expect(pilotCaptureNoIndexRoutePatterns).toEqual(["/pilot/(.*).jpg"])
    const response = protectFromIndexing(
      new NextRequest("https://logloads.test/pilot/host-command.jpg"),
      NextResponse.next()
    )

    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow")
  })

  it("protects product feedback for every authenticated role", () => {
    expect(protectedRoutePatterns).toContain("/support(.*)")
  })

  it("marks every private and account-state HTML surface as non-indexable", () => {
    expect(privateIndexingRoutePatterns).toEqual(
      expect.arrayContaining([
        "/admin(.*)",
        "/driver(.*)",
        "/fleet(.*)",
        "/host(.*)",
        "/support(.*)",
        "/access-restricted(.*)",
        "/onboarding(.*)",
        "/sign-in(.*)",
        "/sign-up(.*)",
        "/workspace(.*)"
      ])
    )
  })

  it("fails closed around the exact public Pilot route catalog", () => {
    expect(isKnownPilotPath("/pilot")).toBe(true)
    expect(isKnownPilotPath("/pilot/host")).toBe(true)
    expect(isKnownPilotPath("/pilot/fleet/")).toBe(true)
    expect(isKnownPilotPath("/pilot/capture/host-command")).toBe(true)
    expect(isKnownPilotPath("/pilot/capture/" + pilotSurfaceSlugs.at(-1))).toBe(true)
    expect(isKnownPilotPath("/pilot/host-command.jpg")).toBe(true)
    expect(isKnownPilotPath("/pilot/not-a-role")).toBe(false)
    expect(isKnownPilotPath("/pilot/not.a-role")).toBe(false)
    expect(isKnownPilotPath("/pilot/capture/not-a-capture")).toBe(false)
    expect(isKnownPilotPath("/pilot/capture/not.a-capture")).toBe(false)
    expect(isKnownPilotPath("/pilot/not-a-capture.jpg")).toBe(false)
    expect(isKnownPilotPath("/pilot/host/extra")).toBe(false)
    expect(isKnownPilotPath("/pricing")).toBe(true)
  })
})

describe("Marketplace V2 entry routing (#246)", () => {
  beforeEach(() => {
    vi.stubEnv("LOGLOADS_MARKETPLACE_V2", "enabled")
    vi.stubEnv("VERCEL_ENV", "preview")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("sends a finished sign-up, which lands on the legacy onboarding, to /v2/start", () => {
    const response = routeMarketplaceV2Entry(request("/onboarding"))

    expect(response?.status).toBe(307)
    expect(location(response)).toBe("/v2/start")
  })

  it("starts the setup a public call to action already chose", () => {
    expect(location(routeMarketplaceV2Entry(request("/onboarding/driver")))).toBe("/v2/start/hauler")
    expect(location(routeMarketplaceV2Entry(request("/onboarding/fleet")))).toBe("/v2/start/hauler")
    expect(location(routeMarketplaceV2Entry(request("/onboarding/host")))).toBe("/v2/start/landing")
  })

  it("continues to the V2 page the person asked for before signing up, and drops a legacy or unsafe continuation", () => {
    expect(location(routeMarketplaceV2Entry(request(`/onboarding/driver?next=${encodeURIComponent("/v2/work/job-1")}`)))).toBe("/v2/work/job-1")
    expect(location(routeMarketplaceV2Entry(request(`/onboarding?next=${encodeURIComponent("/v2/start/hauler?type=solo")}`)))).toBe("/v2/start/hauler?type=solo")
    expect(location(routeMarketplaceV2Entry(request(`/onboarding?next=${encodeURIComponent("/driver/loads")}`)))).toBe("/v2/start")
    expect(location(routeMarketplaceV2Entry(request(`/onboarding?next=${encodeURIComponent("https://attacker.example/v2/work")}`)))).toBe("/v2/start")
    expect(location(routeMarketplaceV2Entry(request(`/onboarding?next=${encodeURIComponent("//attacker.example")}`)))).toBe("/v2/start")
  })

  it("leaves the legacy onboarding's form posts and every other page alone", () => {
    expect(routeMarketplaceV2Entry(request("/onboarding/driver", { method: "POST" }))).toBeNull()
    expect(routeMarketplaceV2Entry(request("/onboarding/admin"))).toBeNull()
    expect(routeMarketplaceV2Entry(request("/v2/start"))).toBeNull()
    expect(routeMarketplaceV2Entry(request("/sign-in"))).toBeNull()
    expect(routeMarketplaceV2Entry(request("/workspace"))).toBeNull()
    expect(routeMarketplaceV2Entry(request("/driver/loads"))).toBeNull()
  })

  it("changes nothing while Marketplace V2 is off, and never in production", () => {
    vi.stubEnv("LOGLOADS_MARKETPLACE_V2", "")
    expect(routeMarketplaceV2Entry(request("/onboarding/driver"))).toBeNull()
    expect(resumeCookie(trackMarketplaceV2Setup(request(`/sign-in?next=${encodeURIComponent("/v2/start/landing")}`), NextResponse.next())))
      .toEqual({ action: "none" })

    vi.stubEnv("LOGLOADS_MARKETPLACE_V2", "enabled")
    vi.stubEnv("VERCEL_ENV", "production")
    expect(routeMarketplaceV2Entry(request("/onboarding", { cookie: "/v2/start/landing" }))).toBeNull()
    expect(routeMarketplaceV2Entry(request("/workspace", { cookie: "/v2/start/landing" }))).toBeNull()
  })

  it("remembers the setup step a sign-in or sign-up continues to, in canonical form, as an HttpOnly cookie", () => {
    const signIn = trackMarketplaceV2Setup(request(`/sign-in?next=${encodeURIComponent("/v2/start/hauler?type=solo&utm=mail")}`), NextResponse.next())

    expect(resumeCookie(signIn)).toEqual({ action: "set", httpOnly: true, maxAge: 3600, path: "/", sameSite: "lax", value: "/v2/start/hauler?type=solo" })
    expect(resumeCookie(trackMarketplaceV2Setup(request(`/sign-up?next=${encodeURIComponent("/v2/start/landing")}`), NextResponse.next())))
      .toMatchObject({ action: "set", value: "/v2/start/landing" })
  })

  it("resumes the remembered step when the sign-up lost its continuation on the way (sign-in, then sign-up, then verify)", () => {
    const response = routeMarketplaceV2Entry(request("/onboarding", { cookie: "/v2/start/hauler?type=solo" }))

    expect(location(response)).toBe("/v2/start/hauler?type=solo")
    expect(resumeCookie(response!)).toEqual({ action: "forget" })
  })

  it("resumes the remembered step when a sign-in lands on /workspace instead of the step", () => {
    const response = routeMarketplaceV2Entry(request("/workspace", { cookie: "/v2/start/landing" }))

    expect(location(response)).toBe("/v2/start/landing")
    expect(resumeCookie(response!)).toEqual({ action: "forget" })
    // Without a remembered step /workspace resolves the V2 home as before.
    expect(routeMarketplaceV2Entry(request("/workspace"))).toBeNull()
  })

  it("lets an explicit continuation or intent on the entry win over the remembered step", () => {
    expect(location(routeMarketplaceV2Entry(request(`/onboarding?next=${encodeURIComponent("/v2/work/job-1")}`, { cookie: "/v2/start/landing" }))))
      .toBe("/v2/work/job-1")
    expect(location(routeMarketplaceV2Entry(request("/onboarding/host", { cookie: "/v2/start/hauler?type=solo" })))).toBe("/v2/start/landing")
  })

  it("never follows a remembered value that is not a canonical setup step, and forgets it", () => {
    for (const forged of ["/v2/work/job-1", "https://attacker.example/v2/start", "/v2/start/hauler?type=solo&x=1", "/driver/loads"]) {
      const onboarding = routeMarketplaceV2Entry(request("/onboarding", { cookie: forged }))

      expect(location(onboarding)).toBe("/v2/start")
      expect(resumeCookie(onboarding!)).toEqual({ action: "forget" })
      expect(routeMarketplaceV2Entry(request("/workspace", { cookie: forged }))).toBeNull()
      expect(resumeCookie(trackMarketplaceV2Setup(request("/workspace", { cookie: forged }), NextResponse.next()))).toEqual({ action: "forget" })
    }
  })

  it("forgets the remembered step once the person is back on it, and keeps it on any other page", () => {
    expect(resumeCookie(trackMarketplaceV2Setup(request("/v2/start/hauler?type=solo", { cookie: "/v2/start/hauler?type=solo" }), NextResponse.next())))
      .toEqual({ action: "forget" })
    // `/v2/start?path=hauler` is the same step as `/v2/start/hauler`.
    expect(resumeCookie(trackMarketplaceV2Setup(request("/v2/start?path=hauler", { cookie: "/v2/start/hauler" }), NextResponse.next())))
      .toEqual({ action: "forget" })
    expect(resumeCookie(trackMarketplaceV2Setup(request("/v2/start/hauler?type=company", { cookie: "/v2/start/hauler?type=solo" }), NextResponse.next())))
      .toEqual({ action: "none" })
    expect(resumeCookie(trackMarketplaceV2Setup(request("/v2/work", { cookie: "/v2/start/landing" }), NextResponse.next()))).toEqual({ action: "none" })
    // A sign-in or sign-up page without a continuation keeps the step for when it finishes.
    expect(resumeCookie(trackMarketplaceV2Setup(request("/sign-up", { cookie: "/v2/start/landing" }), NextResponse.next()))).toEqual({ action: "none" })
  })

  it("forgets the remembered step when a newer sign-in continues somewhere that is not a setup step", () => {
    expect(resumeCookie(trackMarketplaceV2Setup(request(`/sign-in?next=${encodeURIComponent("/v2/work/job-1")}`, { cookie: "/v2/start/landing" }), NextResponse.next())))
      .toEqual({ action: "forget" })
    expect(resumeCookie(trackMarketplaceV2Setup(
      request(`/sign-in?next=${encodeURIComponent("https://attacker.example/v2/start")}`, { cookie: "/v2/start/landing" }),
      NextResponse.next()
    ))).toEqual({ action: "forget" })
    // Nothing to forget, nothing written.
    expect(resumeCookie(trackMarketplaceV2Setup(request(`/sign-in?next=${encodeURIComponent("/v2/work/job-1")}`), NextResponse.next())))
      .toEqual({ action: "none" })
  })

  it("ignores router prefetches and non-navigation requests, so only a real visit sets, follows or forgets the step", () => {
    const prefetch = { headers: { "next-router-prefetch": "1" } }

    expect(resumeCookie(trackMarketplaceV2Setup(request(`/sign-in?next=${encodeURIComponent("/v2/start/landing")}`, prefetch), NextResponse.next())))
      .toEqual({ action: "none" })
    expect(resumeCookie(trackMarketplaceV2Setup(request("/v2/start/landing", { ...prefetch, cookie: "/v2/start/landing" }), NextResponse.next())))
      .toEqual({ action: "none" })
    expect(resumeCookie(trackMarketplaceV2Setup(
      request("/v2/start/landing", { cookie: "/v2/start/landing", headers: { "sec-purpose": "prefetch" } }),
      NextResponse.next()
    ))).toEqual({ action: "none" })
    expect(resumeCookie(trackMarketplaceV2Setup(request(`/sign-in?next=${encodeURIComponent("/v2/start/landing")}`, { method: "POST" }), NextResponse.next())))
      .toEqual({ action: "none" })

    // A prefetched entry is still routed, but the remembered step is kept for the real visit.
    const prefetched = routeMarketplaceV2Entry(request("/onboarding", { ...prefetch, cookie: "/v2/start/landing" }))

    expect(location(prefetched)).toBe("/v2/start/landing")
    expect(resumeCookie(prefetched!)).toEqual({ action: "none" })
  })

  it("composes routing, the remembered step and the noindex header for every page response", () => {
    const routed = pageResponse(request("/onboarding", { cookie: "/v2/start/landing" }))

    expect(location(routed)).toBe("/v2/start/landing")
    expect(resumeCookie(routed)).toEqual({ action: "forget" })
    expect(routed.headers.get("X-Robots-Tag")).toBe("noindex, nofollow")

    const signIn = pageResponse(request(`/sign-in?next=${encodeURIComponent("/v2/start/landing")}`))

    expect(location(signIn)).toBeNull()
    expect(resumeCookie(signIn)).toMatchObject({ action: "set", value: "/v2/start/landing" })
    expect(signIn.headers.get("X-Robots-Tag")).toBe("noindex, nofollow")
  })

  // The Clerk branch is chosen when the module loads; it runs the same pageResponse inside clerkMiddleware.
  it.skipIf(Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY))(
    "runs the V2 entry through the exported middleware on the credential-free bench",
    async () => {
      const response = await middleware(request("/onboarding/host"), {} as NextFetchEvent)

      expect(location(response as NextResponse)).toBe("/v2/start/landing")
    }
  )
})
