import { NextResponse } from "next/server"

import { isDedicatedMediaConfigured } from "@/lib/media-config"
import { platformFeeCollectionEnabled } from "@/lib/billing"
import { percentageEnrollmentStatus } from "@/lib/percentage-enrollment"
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
  const stripeSecretConfigured = Boolean(process.env.STRIPE_SECRET_KEY)
  const stripePublishableConfigured = Boolean(
    process.env.STRIPE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  )
  const stripeWebhookConfigured = Boolean(process.env.STRIPE_WEBHOOK_SECRET)
  const providerAccountAssertionConfigured = Boolean(
    process.env.LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID
  )
  const providerModeAligned = stripeRuntimeModeProblem(process.env) === null
  const expectedProviderModeValid =
    expectedStripeMode === "live" || expectedStripeMode === "test"
  const percentageBillingInfrastructureReady =
    stripeSecretConfigured &&
    stripePublishableConfigured &&
    stripeWebhookConfigured &&
    providerAccountAssertionConfigured &&
    providerModeAligned &&
    expectedProviderModeValid
  const percentageCollectionEnabled = platformFeeCollectionEnabled(process.env)
  const percentageEnrollment = percentageEnrollmentStatus(process.env)
  const percentageBillingReadiness = percentageBillingInfrastructureReady
    ? percentageCollectionEnabled
      ? "collection_configured"
      : "dark_configured"
    : "misconfigured"
  const body = {
    app: "logloads",
    status: engineOk ? "ok" : "degraded",
    environment: process.env.NODE_ENV ?? "development",
    gitCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "unknown",
    engine: { ok: engineOk, profiles: profileCount },
    integrations: {
      auth: isClerkConfigured() ? "clerk" : "dev-session",
      canonicalState: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
      billing: percentageBillingReadiness,
      billingPercentageV1: {
        allowedOrganizationCount:
          percentageEnrollment.allowedOrganizationCount,
        allowedOrganizationScopeSha256:
          percentageEnrollment.allowedOrganizationScopeSha256,
        cardSetupConfigured:
          stripeSecretConfigured && stripePublishableConfigured,
        collection: percentageCollectionEnabled
          ? "enabled"
          : "disabled",
        enrollment: percentageEnrollment.enrollment,
        expectedProviderMode:
          expectedStripeMode === "live" || expectedStripeMode === "test"
            ? expectedStripeMode
            : "invalid",
        providerAccountAssertionConfigured,
        providerModeAligned,
        providerVerification: "not_probed",
        readiness: percentageBillingReadiness,
        stripeSecretConfigured,
        invalidEnrollmentEntryCount:
          percentageEnrollment.invalidEntryCount,
        webhookConfigured: stripeWebhookConfigured
      },
      billingSubscriptionHistory: {
        catalogConfigured: stripeCatalog.configured,
        collection: subscriptionCollectionEnabled(process.env) ? "enabled" : "disabled",
        dispatchSelfServe: dispatchSelfServeEnabled(process.env)
          ? "enabled"
          : "disabled",
        enrollment: "closed",
        invalidPriceIds: stripeCatalog.invalid.length,
        missingPrices: stripeCatalog.missing.length,
        ownerSmoke: internalBillingSmokeEnabled(process.env) ? "enabled" : "disabled",
        ownerSmokeTargetConfigured: Boolean(
          process.env.LOGLOADS_INTERNAL_BILLING_SMOKE_ALLOWED_ORGANIZATION_IDS
        ),
        portalConfigured: Boolean(
          process.env.STRIPE_PORTAL_CONFIGURATION_NETWORK
        ),
        providerAccountAssertionConfigured,
        providerModeAligned,
        webhookConfigured: stripeWebhookConfigured
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
