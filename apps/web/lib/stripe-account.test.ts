import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  expectedStripeLivemode,
  stripePublishableModeProblem,
  stripeRuntimeModeProblem,
  verifyExpectedStripeAccount
} from "./stripe-account"

function fakeAccountPort(accountId = "acct_logloads") {
  const calls: string[] = []

  return {
    calls,
    port: {
      async retrieveAccountId() {
        calls.push("retrieveAccountId")

        return accountId
      }
    }
  }
}

describe("the Stripe provider mode", () => {
  it("requires an explicit provider mode and refuses cross-mode keys", () => {
    expect(() => expectedStripeLivemode({})).toThrow(/must be configured/)
    expect(() => expectedStripeLivemode({ LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "sandbox" })).toThrow(
      /must be configured/
    )
    expect(expectedStripeLivemode({ LOGLOADS_STRIPE_EXPECTED_LIVEMODE: " LIVE " })).toBe(true)
    expect(
      stripeRuntimeModeProblem({
        LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "live",
        STRIPE_SECRET_KEY: "sk_test_logloads"
      })
    ).toMatch(/does not match/)
    expect(
      stripePublishableModeProblem("pk_test_logloads", {
        LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "live"
      })
    ).toMatch(/does not match/)
    expect(
      stripeRuntimeModeProblem({
        LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test",
        STRIPE_SECRET_KEY: "sk_test_logloads"
      })
    ).toBeNull()
    expect(
      stripePublishableModeProblem("pk_test_logloads", {
        LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test"
      })
    ).toBeNull()
  })

  it("refuses a missing secret and a key of unknown mode", () => {
    expect(stripeRuntimeModeProblem({ LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test" })).toMatch(
      /not configured/
    )
    expect(
      stripeRuntimeModeProblem({
        LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test",
        STRIPE_SECRET_KEY: "rk_test_restricted"
      })
    ).toMatch(/does not match/)
    expect(stripeRuntimeModeProblem({ STRIPE_SECRET_KEY: "sk_test_logloads" })).toMatch(
      /must be configured/
    )
  })
})

describe("the Stripe account identity", () => {
  it("fails closed when the secret key cannot prove the configured LogLoads account", async () => {
    const fake = fakeAccountPort()

    await expect(
      verifyExpectedStripeAccount(fake.port, {
        LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test",
        STRIPE_SECRET_KEY: "sk_test_logloads"
      })
    ).rejects.toThrow(/expected LogLoads Stripe account identity/)
    expect(fake.calls).not.toContain("retrieveAccountId")

    await expect(
      verifyExpectedStripeAccount(fake.port, {
        LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID: "acct_anothercompany",
        LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test",
        STRIPE_SECRET_KEY: "sk_test_logloads"
      })
    ).rejects.toThrow(/does not match the LogLoads activation boundary/)
    expect(fake.calls).toContain("retrieveAccountId")

    await expect(
      verifyExpectedStripeAccount(fake.port, {
        LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID: "acct_logloads",
        LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test",
        STRIPE_SECRET_KEY: "sk_test_logloads"
      })
    ).resolves.toBeUndefined()
  })

  it("checks the provider mode before asking Stripe who the key belongs to", async () => {
    const fake = fakeAccountPort()

    await expect(
      verifyExpectedStripeAccount(fake.port, {
        LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID: "acct_logloads",
        LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "live",
        STRIPE_SECRET_KEY: "sk_test_logloads"
      })
    ).rejects.toThrow(/does not match the expected LogLoads provider mode/)
    expect(fake.calls).toEqual([])
  })
})
