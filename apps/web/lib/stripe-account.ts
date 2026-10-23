import "server-only"

/**
 * Which Stripe account and mode this deployment is allowed to move money in.
 *
 * A valid Stripe key is not sufficient on its own: the machine running a
 * deployment may be authenticated to a different Stripe account, or hold a test
 * key where a live one is expected. Every boundary that creates or charges a
 * Stripe object proves, first, that the key matches the expected mode
 * (`LOGLOADS_STRIPE_EXPECTED_LIVEMODE`) and belongs to the one configured
 * LogLoads account (`LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID`), without ever
 * returning or logging either account id.
 */

export type StripeEnvironment = Record<string, string | undefined>

export function expectedStripeLivemode(env: StripeEnvironment = process.env): boolean {
  const expected = env.LOGLOADS_STRIPE_EXPECTED_LIVEMODE?.trim().toLowerCase()

  if (expected !== "test" && expected !== "live") {
    throw new Error("The expected LogLoads Stripe mode must be configured as test or live")
  }

  return expected === "live"
}

function keyLivemode(key: string, kind: "publishable" | "secret"): boolean | null {
  const prefix = kind === "secret" ? "sk_" : "pk_"

  if (key.startsWith(`${prefix}test`)) {
    return false
  }

  if (key.startsWith(`${prefix}live`)) {
    return true
  }

  return null
}

function expectedLivemodeOrProblem(env: StripeEnvironment): boolean | string {
  try {
    return expectedStripeLivemode(env)
  } catch (error) {
    return error instanceof Error ? error.message : "The expected LogLoads Stripe mode is invalid"
  }
}

/** Why the configured secret key may not be used, or null when it may. */
export function stripeRuntimeModeProblem(env: StripeEnvironment = process.env): string | null {
  const expectedLive = expectedLivemodeOrProblem(env)

  if (typeof expectedLive === "string") {
    return expectedLive
  }

  const secretKey = env.STRIPE_SECRET_KEY?.trim()

  if (!secretKey) {
    return "The Stripe secret key is not configured"
  }

  const actualLive = keyLivemode(secretKey, "secret")

  return actualLive === null || actualLive !== expectedLive
    ? "The Stripe secret key does not match the expected LogLoads provider mode"
    : null
}

/** Why a publishable key may not be handed to the browser, or null when it may. */
export function stripePublishableModeProblem(
  key: string,
  env: StripeEnvironment = process.env
): string | null {
  const expectedLive = expectedLivemodeOrProblem(env)

  if (typeof expectedLive === "string") {
    return expectedLive
  }

  const actualLive = keyLivemode(key.trim(), "publishable")

  return actualLive === null || actualLive !== expectedLive
    ? "The Stripe publishable key does not match the expected LogLoads provider mode"
    : null
}

/**
 * Proves the configured key belongs to the one expected LogLoads Stripe account.
 * Throws, with a message that names neither account, when it does not.
 */
export async function verifyExpectedStripeAccount(
  port: { retrieveAccountId(): Promise<string> },
  env: StripeEnvironment = process.env
): Promise<void> {
  const modeProblem = stripeRuntimeModeProblem(env)

  if (modeProblem) {
    throw new Error(modeProblem)
  }

  const expectedAccountId = env.LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID?.trim() ?? ""

  if (!/^acct_[A-Za-z0-9]+$/.test(expectedAccountId)) {
    throw new Error("The expected LogLoads Stripe account identity is not configured")
  }

  const actualAccountId = await port.retrieveAccountId()

  if (actualAccountId !== expectedAccountId) {
    throw new Error("Stripe account identity does not match the LogLoads activation boundary")
  }
}
