import { NextResponse } from "next/server"

import { refreshState, services } from "@/lib/services"
import { isClerkConfigured } from "@/lib/session"

export const dynamic = "force-dynamic"

/**
 * Liveness + readiness probe for the single-node runtime. Confirms the operating
 * engine responds and reports which production integrations are wired, without
 * leaking secrets. Used by the container/host health check.
 */
export async function GET() {
  let engineOk = false
  let profileCount = 0

  try {
    await refreshState()
    profileCount = services.state.profiles.length
    engineOk = Array.isArray(services.state.loadPostings)
  } catch {
    engineOk = false
  }

  const body = {
    app: "logloads",
    status: engineOk ? "ok" : "degraded",
    environment: process.env.NODE_ENV ?? "development",
    gitCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "unknown",
    engine: { ok: engineOk, profiles: profileCount },
    integrations: {
      auth: isClerkConfigured() ? "clerk" : "dev-session",
      canonicalState: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
      billing: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_DISPATCH),
      email: Boolean(process.env.RESEND_API_KEY),
      media: Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET),
      analytics: Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY),
      errorTracking: Boolean(process.env.SENTRY_DSN)
    },
    timestamp: new Date().toISOString()
  }

  return NextResponse.json(body, { status: engineOk ? 200 : 503 })
}
