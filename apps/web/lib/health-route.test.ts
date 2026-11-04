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

// The engine probe's window lives with the route module, so every test starts
// a minute after the last one and never sees an earlier test's answer.
let testClock = Date.parse("2026-11-03T12:00:00.000Z")

describe("public health route", () => {
  beforeEach(() => {
    testClock += 60_000
    vi.useFakeTimers({ now: testClock, toFake: ["Date"] })
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
    vi.useRealTimers()
  })

  it("answers repeated anonymous probes inside the window from one state download (HF-09)", async () => {
    const responses = await Promise.all([GET(), GET()])
    vi.setSystemTime(testClock + 9_999)
    responses.push(await GET())

    for (const response of responses) {
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({ engine: { ok: true }, status: "ok" })
    }
    expect(mocks.refreshState).toHaveBeenCalledTimes(1)
  })

  it("checks the engine again once the window has passed (HF-09)", async () => {
    await GET()
    vi.setSystemTime(testClock + 10_000)
    await GET()

    expect(mocks.refreshState).toHaveBeenCalledTimes(2)
  })

  it("keeps a degraded answer for the window, then reports recovery (HF-09)", async () => {
    mocks.refreshState.mockRejectedValueOnce(new Error("state unavailable"))

    const degraded = await GET()
    const stillDegraded = await GET()
    vi.setSystemTime(testClock + 10_000)
    const recovered = await GET()

    expect(degraded.status).toBe(503)
    await expect(degraded.json()).resolves.toMatchObject({ engine: { ok: false }, status: "degraded" })
    expect(stillDegraded.status).toBe(503)
    expect(recovered.status).toBe(200)
    expect(mocks.refreshState).toHaveBeenCalledTimes(2)
  })

  it("publishes only coarse billing posture and a boolean scope proof", async () => {
    const response = await GET()
    const body = await response.json()
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
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
