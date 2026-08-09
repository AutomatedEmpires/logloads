import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server"

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
  "/workspace(.*)"
]

const isProtectedRoute = createRouteMatcher(protectedRoutePatterns)
const isPrivateIndexingRoute = createRouteMatcher(privateIndexingRoutePatterns)

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

function protectFromIndexing(request: NextRequest, response: NextResponse): NextResponse {
  if (isPrivateIndexingRoute(request)) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow")
  }

  return response
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

  return protectFromIndexing(request, NextResponse.next())
})

// Session integrity is verified server-side in lib/session.ts on every page; the
// middleware only handles the fast unauthenticated redirect.
export default function middleware(request: NextRequest, event: NextFetchEvent) {
  const pilotNotFound = rejectUnknownPilotPath(request)

  if (pilotNotFound) return pilotNotFound

  if (clerkConfigured) {
    return withClerk(request, event)
  }

  if (isProtectedRoute(request) && !request.cookies.get("ll_session")?.value) {
    return protectFromIndexing(
      request,
      NextResponse.redirect(new URL(`/sign-in?next=${encodeURIComponent(request.nextUrl.pathname)}`, request.url))
    )
  }

  return protectFromIndexing(request, NextResponse.next())
}

export const config = {
  matcher: [
    "/((?!_next|.*\\..*|api/health).*)",
    "/pilot/:path*",
    "/__clerk/(.*)"
  ]
}
