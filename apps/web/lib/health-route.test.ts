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

vi.mock("@/lib/stripe-account", () => ({
  stripeRuntimeModeProblem: mocks.stripeRuntimeModeProblem
}))

import { GET } from "@/app/api/health/route"

describe("public health route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.platformFeeCollectionEnabled.mockReturnValue(false)
    mocks.refreshState.mockResolvedValue(undefined)
    mocks.stripeRuntimeModeProblem.mockReturnValue(null)
    vi.stubEnv("LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID", "acct_expected")
    vi.stubEnv("LOGLOADS_STRIPE_EXPECTED_LIVEMODE", "test")
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_example")
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_example")
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_example")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("publishes only coarse billing posture", async () => {
    const response = await GET()
    const body = await response.json()
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(body.engine).toEqual({ ok: true })
    expect(body.integrations.billing).toEqual({
      collection: "disabled",
      readiness: "configured"
    })
    for (const forbidden of [
      "acct_expected",
      "providerAccountAssertionConfigured",
      "providerModeAligned",
      "stripeSecretConfigured",
      "webhookConfigured"
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it("reports collection when the single fee-collection switch is on", async () => {
    mocks.platformFeeCollectionEnabled.mockReturnValue(true)

    const body = await (await GET()).json()

    expect(body.integrations.billing).toEqual({
      collection: "enabled",
      readiness: "configured"
    })
  })

  it("reports billing misconfigured when the Stripe key does not match the expected mode", async () => {
    mocks.stripeRuntimeModeProblem.mockReturnValue("mode mismatch")

    const body = await (await GET()).json()

    expect(body.integrations.billing).toMatchObject({ readiness: "misconfigured" })
  })

  it("reports billing misconfigured without the expected account assertion", async () => {
    vi.stubEnv("LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID", "")

    const body = await (await GET()).json()

    expect(body.integrations.billing).toMatchObject({ readiness: "misconfigured" })
  })
})
