import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server"

import {
  legacyOnboardingEntry,
  safeEntryNext,
  V2_SETUP_RESUME_COOKIE,
  v2EntryDestination,
  v2SetupResumeCookieOptions,
  v2SetupStep
} from "./lib/entry-routing"
import { marketplaceV2Enabled } from "./lib/marketplace-v2/flag"
import { isKnownPilotPath } from "./lib/pilot-route-contract"

export const protectedRoutePatterns = [
  "/driver(.*)",
  "/fleet(.*)",
  "/host(.*)",
  "/admin(.*)",
  "/support(.*)"
]

export const privateIndexingRoutePatterns = [
  ...protectedRoutePatterns,
  "/access-restricted(.*)",
  "/onboarding(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/v2(.*)",
  "/workspace(.*)"
]

const isProtectedRoute = createRouteMatcher(protectedRoutePatterns)
const isPrivateIndexingRoute = createRouteMatcher(privateIndexingRoutePatterns)
export const pilotCaptureNoIndexRoutePatterns = ["/pilot/(.*).jpg"]
const isPilotCaptureAssetRoute = createRouteMatcher(pilotCaptureNoIndexRoutePatterns)

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY)

const pilotNotFoundDocument = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>Pilot surface not found — LogLoads</title>
    <style>
      :root { color-scheme: light; font-family: Arial, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; color: #14261d; background: #f0ebdf; }
      main { width: min(100%, 680px); padding: clamp(32px, 7vw, 64px); border: 1px solid #b8ad96; border-radius: 28px; background: #fffdf7; box-shadow: 0 22px 70px rgba(20, 38, 29, .13); }
      p { color: #4f5c53; font-size: 1.05rem; line-height: 1.7; }
      .eyebrow { margin: 0 0 14px; color: #18523b; font-size: .78rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
      h1 { margin: 0; max-width: 12ch; font-size: clamp(2.35rem, 8vw, 4.8rem); line-height: .98; letter-spacing: -.055em; }
      a { display: inline-flex; min-height: 48px; align-items: center; margin-top: 18px; padding: 0 20px; border-radius: 12px; color: #fff; background: #174d38; font-weight: 800; text-decoration: none; }
      a:focus-visible { outline: 3px solid #0b2f22; outline-offset: 4px; }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">LogLoads Pilot Center</p>
      <h1>That pilot surface is not available.</h1>
      <p>The public tour includes the current Host, Fleet, and Driver operating surfaces. Return to the Pilot Center to choose a real role or product capture.</p>
      <a href="/pilot">Return to the Pilot Center</a>
    </main>
  </body>
</html>`

function rejectUnknownPilotPath(request: NextRequest): NextResponse | null {
  if (isKnownPilotPath(request.nextUrl.pathname)) return null

  return new NextResponse(pilotNotFoundDocument, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow"
    }
  })
}

/**
 * Marketplace V2 is a development preview. When its flag is off, every /v2 path is a plain 404 before
 * any layout or page renders (App Router renders layouts and pages in parallel, so a layout-level
 * notFound() alone would not stop page data from being produced).
 */
export function rejectDisabledMarketplaceV2(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl

  if ((pathname !== "/v2" && !pathname.startsWith("/v2/")) || marketplaceV2Enabled()) return null

  return new NextResponse("Not found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow"
    }
  })
}

export function protectFromIndexing(request: NextRequest, response: NextResponse): NextResponse {
  if (isPrivateIndexingRoute(request) || isPilotCaptureAssetRoute(request)) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow")
  }

  return response
}

const AUTH_ENTRY_ROUTES = ["/sign-in", "/sign-up"] as const

function isAuthEntryRoute(pathname: string): boolean {
  return AUTH_ENTRY_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
}

/** A page visit, not a form post: only these are routed, and only these set or forget the remembered step. */
function isPageVisit(request: NextRequest): boolean {
  return request.method === "GET" || request.method === "HEAD"
}

/** The router looking ahead (Next.js prefetch, or a browser speculation), not the person arriving. */
function isPrefetch(request: NextRequest): boolean {
  const purpose = request.headers.get("sec-purpose") ?? request.headers.get("purpose") ?? ""

  return request.headers.has("next-router-prefetch") || /\bprefetch\b/i.test(purpose)
}

function forgetSetupStep(response: NextResponse): NextResponse {
  response.cookies.set(V2_SETUP_RESUME_COOKIE, "", { ...v2SetupResumeCookieOptions(), maxAge: 0 })
  return response
}

/**
 * Marketplace V2's entry (#246), only while V2 is on (never in production). A finished sign-up lands on the legacy
 * onboarding, `/onboarding` or `/onboarding/<role>`; V2 replaces it with its own setup (UX 02 §2.3), so the visit
 * continues where `v2EntryDestination` says. A sign-in lands on `/workspace`: with a remembered setup step it resumes
 * that step, and otherwise `/workspace` resolves the V2 home as before (#124, #213), which is `/v2/start` for an
 * account with no business. `null` renders the page. A form post is never redirected.
 */
export function routeMarketplaceV2Entry(request: NextRequest): NextResponse | null {
  if (!isPageVisit(request) || !marketplaceV2Enabled()) return null

  const { pathname, searchParams } = request.nextUrl
  const remembered = request.cookies.get(V2_SETUP_RESUME_COOKIE)?.value
  const entry = legacyOnboardingEntry(pathname)
  const destination = entry
    ? v2EntryDestination({ intent: entry.intent, next: searchParams.get("next"), resume: remembered })
    : pathname === "/workspace" && remembered && v2SetupStep(remembered) === remembered
      ? remembered
      : null

  if (!destination) return null

  const response = NextResponse.redirect(new URL(destination, request.url))

  // The remembered step is used up. A prefetch only looks ahead, so the real visit still finds it.
  return remembered !== undefined && !isPrefetch(request) ? forgetSetupStep(response) : response
}

/**
 * Remembers the setup step a sign-in or sign-up continues to (#246), so setup resumes there however the person moves
 * between sign-in, sign-up and the provider's email verification, which do not all carry `next` along. The cookie
 * holds a canonical setup step (`v2SetupStep`) and nothing about the person. It is forgotten once the person is back on
 * that step, when a newer sign-in continues anywhere else, and when it holds anything LogLoads did not write.
 */
export function trackMarketplaceV2Setup(request: NextRequest, response: NextResponse): NextResponse {
  if (!isPageVisit(request) || isPrefetch(request) || !marketplaceV2Enabled()) return response

  const { pathname, search, searchParams } = request.nextUrl
  const remembered = request.cookies.get(V2_SETUP_RESUME_COOKIE)?.value
  const authEntry = isAuthEntryRoute(pathname)

  if (authEntry && searchParams.has("next")) {
    const step = v2SetupStep(safeEntryNext(searchParams.get("next")))

    if (step) {
      response.cookies.set(V2_SETUP_RESUME_COOKIE, step, v2SetupResumeCookieOptions())
      return response
    }

    // The newest continuation is not a setup step, so the older step no longer says where the person is going.
    return remembered === undefined ? response : forgetSetupStep(response)
  }

  if (remembered === undefined) return response

  const forged = !remembered || v2SetupStep(remembered) !== remembered
  const reached = !authEntry && v2SetupStep(`${pathname}${search}`) === remembered

  return forged || reached ? forgetSetupStep(response) : response
}

/** The response for a page that passed the guards above: the V2 entry, the remembered step and the noindex header. */
export function pageResponse(request: NextRequest): NextResponse {
  return protectFromIndexing(request, trackMarketplaceV2Setup(request, routeMarketplaceV2Entry(request) ?? NextResponse.next()))
}

const withClerk = clerkMiddleware(async (auth, request) => {
  if (isProtectedRoute(request)) {
    const session = await auth()

    if (!session.userId) {
      return protectFromIndexing(
        request,
        NextResponse.redirect(new URL(`/sign-in?next=${encodeURIComponent(request.nextUrl.pathname)}`, request.url))
      )
    }
  }

  return pageResponse(request)
})

// Session integrity is verified server-side in lib/session.ts on every page; the
// middleware only handles the fast unauthenticated redirect.
export default function middleware(request: NextRequest, event: NextFetchEvent) {
  const pilotNotFound = rejectUnknownPilotPath(request)

  if (pilotNotFound) return pilotNotFound

  const marketplaceV2NotFound = rejectDisabledMarketplaceV2(request)

  if (marketplaceV2NotFound) return marketplaceV2NotFound

  if (clerkConfigured) {
    return withClerk(request, event)
  }

  if (isProtectedRoute(request) && !request.cookies.get("ll_session")?.value) {
    return protectFromIndexing(
      request,
      NextResponse.redirect(new URL(`/sign-in?next=${encodeURIComponent(request.nextUrl.pathname)}`, request.url))
    )
  }

  return pageResponse(request)
}

export const config = {
  matcher: [
    "/((?!_next|.*\\..*|api/health).*)",
    "/pilot/:path*",
    "/__clerk/(.*)"
  ]
}
