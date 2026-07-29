import { NextResponse } from "next/server"

import { isDedicatedMediaConfigured } from "@/lib/media-config"
import { refreshState, services } from "@/lib/services"
import { isClerkConfigured } from "@/lib/session"
import {
  dispatchSelfServeEnabled,
  internalBillingSmokeEnabled,
  stripeCatalogReadiness,
  stripeRuntimeModeProblem,
  subscriptionCollectionEnabled
} from "@/lib/subscription-stripe"

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

  const stripeCatalog = stripeCatalogReadiness(process.env)
  const expectedStripeMode =
    process.env.LOGLOADS_STRIPE_EXPECTED_LIVEMODE?.trim().toLowerCase()
  const allowedOrganizations = (
    process.env.LOGLOADS_SUBSCRIPTION_ALLOWED_ORGANIZATION_IDS ?? ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  const enrollmentScope = allowedOrganizations.includes("*")
    ? "general_availability"
    : allowedOrganizations.length > 0
      ? "canary"
      : "disabled"
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
      billingSubscriptionV1: {
        catalogConfigured: stripeCatalog.configured,
        collection: subscriptionCollectionEnabled(process.env) ? "enabled" : "disabled",
        dispatchSelfServe: dispatchSelfServeEnabled(process.env)
          ? "enabled"
          : "disabled",
        enrollmentScope,
        expectedProviderMode:
          expectedStripeMode === "live" || expectedStripeMode === "test"
            ? expectedStripeMode
            : "invalid",
        invalidPriceIds: stripeCatalog.invalid.length,
        missingPrices: stripeCatalog.missing.length,
        ownerSmoke: internalBillingSmokeEnabled(process.env) ? "enabled" : "disabled",
        ownerSmokeTargetConfigured: Boolean(
          process.env.LOGLOADS_INTERNAL_BILLING_SMOKE_ALLOWED_ORGANIZATION_IDS
        ),
        portalConfigured: Boolean(
          process.env.STRIPE_PORTAL_CONFIGURATION_NETWORK
        ),
        providerAccountAssertionConfigured: Boolean(
          process.env.LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID
        ),
        providerModeAligned: stripeRuntimeModeProblem(process.env) === null,
        webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET)
      },
      credentialReview: Boolean(process.env.ANTHROPIC_API_KEY),
      email: Boolean(process.env.RESEND_API_KEY),
      media: isDedicatedMediaConfigured(process.env),
      analytics: Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY),
      errorTracking: Boolean(process.env.SENTRY_DSN)
    },
    timestamp: new Date().toISOString()
  }

  return NextResponse.json(body, { status: engineOk ? 200 : 503 })
}
