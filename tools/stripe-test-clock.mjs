export function assertStripeTestKey(secretKey) {
  if (!secretKey?.startsWith("sk_test_")) {
    throw new Error("Stripe test-clock verification requires an sk_test_ secret key")
  }
}

export function assertClockAdvanceWithinLimit(fromSeconds, toSeconds, intervalSeconds) {
  if (
    !Number.isSafeInteger(fromSeconds) ||
    !Number.isSafeInteger(toSeconds) ||
    !Number.isSafeInteger(intervalSeconds) ||
    intervalSeconds <= 0 ||
    toSeconds <= fromSeconds
  ) {
    throw new Error("Test-clock advance values must be positive integer seconds")
  }

  if (toSeconds - fromSeconds > intervalSeconds * 2) {
    throw new Error("A Stripe test clock may advance at most two shortest subscription intervals")
  }
}

export function pilotLifecycleCheckpoints(firstPeriodStartSeconds) {
  if (!Number.isSafeInteger(firstPeriodStartSeconds)) {
    throw new Error("Pilot lifecycle start must be integer epoch seconds")
  }

  const intervalSeconds = 30 * 24 * 60 * 60
  const termEndSeconds = firstPeriodStartSeconds + 3 * intervalSeconds

  return {
    advanceTargets: [
      firstPeriodStartSeconds + intervalSeconds + 1,
      firstPeriodStartSeconds + 2 * intervalSeconds + 1,
      termEndSeconds + 1
    ],
    installmentAt: [
      firstPeriodStartSeconds,
      firstPeriodStartSeconds + intervalSeconds,
      firstPeriodStartSeconds + 2 * intervalSeconds
    ],
    intervalSeconds,
    termEndSeconds
  }
}

export function parseCliArguments(argv) {
  const flags = new Set()
  const values = new Map()

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]

    if (!value?.startsWith("--")) {
      continue
    }

    const next = argv[index + 1]

    if (next && !next.startsWith("--")) {
      values.set(value, next)
      index += 1
    } else {
      flags.add(value)
    }
  }

  return { flags, values }
}

export function findCanonicalSubscription(state, organizationSubscriptionId) {
  const subscriptions = Array.isArray(state?.organizationSubscriptions)
    ? state.organizationSubscriptions
    : []

  return subscriptions.find(
    (subscription) => subscription.id === organizationSubscriptionId
  ) ?? null
}

export async function pollUntil({
  attempt,
  intervalMs = 2_000,
  maxAttempts = 30,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
}) {
  for (let index = 0; index < maxAttempts; index += 1) {
    const result = await attempt(index)

    if (result.done) {
      return result.value
    }

    if (index < maxAttempts - 1) {
      await wait(intervalMs)
    }
  }

  throw new Error("Timed out while waiting for asynchronous Stripe test-clock reconciliation")
}
