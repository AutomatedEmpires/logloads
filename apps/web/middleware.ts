import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server"

export const protectedRoutePatterns = [
  "/driver(.*)",
  "/fleet(.*)",
  "/host(.*)",
  "/admin(.*)",
  "/support(.*)"
]

const isProtectedRoute = createRouteMatcher(protectedRoutePatterns)

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY)

const withClerk = clerkMiddleware(async (auth, request) => {
  if (isProtectedRoute(request)) {
    const session = await auth()

    if (!session.userId) {
      return NextResponse.redirect(new URL(`/sign-in?next=${encodeURIComponent(request.nextUrl.pathname)}`, request.url))
    }
  }

  return NextResponse.next()
})

// Session integrity is verified server-side in lib/session.ts on every page; the
// middleware only handles the fast unauthenticated redirect.
export default function middleware(request: NextRequest, event: NextFetchEvent) {
  if (clerkConfigured) {
    return withClerk(request, event)
  }

  if (isProtectedRoute(request) && !request.cookies.get("ll_session")?.value) {
    return NextResponse.redirect(new URL(`/sign-in?next=${encodeURIComponent(request.nextUrl.pathname)}`, request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!_next|.*\\..*|api/health).*)",
    "/__clerk/(.*)"
  ]
}
