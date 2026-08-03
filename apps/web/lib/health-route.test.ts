import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  platformFeeCollectionEnabled: vi.fn(),
  refreshState: vi.fn(),
  stripeRuntimeModeProblem: vi.fn()
}))

vi.mock("@/lib/billing", () => ({
  platformFeeCollectionEnabled: mocks.platformFeeCollectionEnabled
}))

vi.mock("@/lib/media-config", () => ({
  isDedicatedMediaConfigured: () => true
}))

vi.mock("@/lib/services", () => ({
  refreshState: mocks.refreshState,
  services: { state: { loadPostings: [] } }
}))

vi.mock("@/lib/session", () => ({
  isClerkConfigured: () => true
}))

vi.mock("@/lib/subscription-stripe", () => ({
  stripeRuntimeModeProblem: mocks.stripeRuntimeModeProblem
}))

import { GET } from "@/app/api/health/route"

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ORGANIZATION_SCOPE_SHA256 =
  "303617b9730210ef3c86c52dc2aecc4dce54aaca6af8c8b0f4ceec9ecc54e57e"

describe("public health route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.platformFeeCollectionEnabled.mockReturnValue(false)
    mocks.refreshState.mockResolvedValue(undefined)
    mocks.stripeRuntimeModeProblem.mockReturnValue(null)
    vi.stubEnv("LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS", ORGANIZATION_ID)
    vi.stubEnv("LOGLOADS_PERCENTAGE_ENROLLMENT", "enabled")
    vi.stubEnv(
      "LOGLOADS_PERCENTAGE_EXPECTED_ORGANIZATION_SCOPE_SHA256",
      ORGANIZATION_SCOPE_SHA256
    )
    vi.stubEnv("LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID", "acct_expected")
    vi.stubEnv("LOGLOADS_STRIPE_EXPECTED_LIVEMODE", "test")
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_example")
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_example")
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_example")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("publishes only coarse billing posture and a boolean scope proof", async () => {
    const response = await GET()
    const body = await response.json()
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(body.engine).toEqual({ ok: true })
    expect(body.integrations.billing).toBe("dark_configured")
    expect(body.integrations.billingPercentageV1).toEqual({
      collection: "disabled",
      enrollment: "enabled",
      readiness: "dark_configured",
      scopeVerified: true
    })
    expect(body.integrations).not.toHaveProperty("billingSubscriptionHistory")
    for (const forbidden of [
      "allowedOrganizationCount",
      "allowedOrganizationScopeSha256",
      ORGANIZATION_SCOPE_SHA256,
      "invalidEnrollmentEntryCount",
      "missingPrices",
      "ownerSmoke",
      "providerAccountAssertionConfigured",
      "providerModeAligned",
      "stripeSecretConfigured",
      "webhookConfigured"
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it("reports billing misconfigured when the private scope assertion drifts", async () => {
    vi.stubEnv(
      "LOGLOADS_PERCENTAGE_EXPECTED_ORGANIZATION_SCOPE_SHA256",
      "0".repeat(64)
    )

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.integrations.billing).toBe("misconfigured")
    expect(body.integrations.billingPercentageV1).toMatchObject({
      enrollment: "misconfigured",
      readiness: "misconfigured",
      scopeVerified: false
    })
  })
})
