import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server"

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
    "/__clerk/(.*)"
  ]
}
