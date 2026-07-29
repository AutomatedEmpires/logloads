import assert from "node:assert/strict"
import test from "node:test"

import {
  assertClockAdvanceWithinLimit,
  assertStripeTestKey,
  findCanonicalSubscription,
  parseCliArguments,
  pilotLifecycleCheckpoints,
  pollUntil
} from "./stripe-test-clock.mjs"

test("test-clock tools categorically refuse live keys", () => {
  assert.doesNotThrow(() => assertStripeTestKey("sk_test_example"))
  assert.throws(() => assertStripeTestKey("sk_live_example"), /requires an sk_test_/)
  assert.throws(() => assertStripeTestKey(undefined), /requires an sk_test_/)
})

test("clock advancement permits no more than two shortest intervals", () => {
  assert.doesNotThrow(() => assertClockAdvanceWithinLimit(100, 160, 30))
  assert.throws(
    () => assertClockAdvanceWithinLimit(100, 161, 30),
    /at most two/
  )
})

test("Pilot checkpoints prove day 0, 30, and 60 installments with cancellation before day 90 renewal", () => {
  const start = 1_800_000_000
  const plan = pilotLifecycleCheckpoints(start)
  const day = 24 * 60 * 60

  assert.deepEqual(plan.installmentAt, [
    start,
    start + 30 * day,
    start + 60 * day
  ])
  assert.deepEqual(plan.advanceTargets, [
    start + 30 * day + 1,
    start + 60 * day + 1,
    start + 90 * day + 1
  ])
  assert.equal(plan.termEndSeconds, start + 90 * day)
})

test("polling observes asynchronous readiness without a real delay", async () => {
  let attempts = 0
  let waits = 0
  const result = await pollUntil({
    attempt: async () => {
      attempts += 1

      return attempts === 3 ? { done: true, value: "ready" } : { done: false }
    },
    wait: async () => {
      waits += 1
    }
  })

  assert.equal(result, "ready")
  assert.equal(attempts, 3)
  assert.equal(waits, 2)
})

test("canonical verification ignores absent collections and finds the exact local id", () => {
  assert.equal(findCanonicalSubscription({}, "sub-local"), null)
  assert.deepEqual(
    findCanonicalSubscription(
      {
        organizationSubscriptions: [
          { id: "other" },
          { id: "sub-local", stripeSubscriptionId: "sub_provider" }
        ]
      },
      "sub-local"
    ),
    { id: "sub-local", stripeSubscriptionId: "sub_provider" }
  )
})

test("CLI parsing keeps explicit values separate from safety flags", () => {
  const parsed = parseCliArguments([
    "--apply",
    "--clock",
    "clock_1",
    "--customer",
    "cus_1"
  ])

  assert.equal(parsed.flags.has("--apply"), true)
  assert.equal(parsed.values.get("--clock"), "clock_1")
  assert.equal(parsed.values.get("--customer"), "cus_1")
})
