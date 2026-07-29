import assert from "node:assert/strict"
import test from "node:test"

import {
  STRIPE_API_VERSION,
  STRIPE_CATALOG,
  assertExpectedStripeAccountId,
  assertSafeCatalogKey,
  flattenStripeForm,
  portalConfigurationMismatch,
  priceMismatch
} from "./stripe-catalog.mjs"

test("subscription catalog freezes every approved amount and overage", () => {
  const amounts = Object.fromEntries(STRIPE_CATALOG.map((entry) => [entry.env, entry.unitAmount]))

  assert.deepEqual(amounts, {
    STRIPE_PRICE_DISPATCH: 49_900,
    STRIPE_PRICE_INTERNAL_BILLING_TEST: 100,
    STRIPE_PRICE_NETWORK_100: 1_000_000,
    STRIPE_PRICE_NETWORK_100_OVERAGE: 9_000,
    STRIPE_PRICE_NETWORK_25: 300_000,
    STRIPE_PRICE_NETWORK_25_OVERAGE: 12_500,
    STRIPE_PRICE_NETWORK_50: 550_000,
    STRIPE_PRICE_NETWORK_50_OVERAGE: 11_000,
    STRIPE_PRICE_NETWORK_PILOT: 150_000,
    STRIPE_PRICE_NETWORK_PILOT_OVERAGE: 15_000
  })
  assert.equal(
    STRIPE_CATALOG.find((entry) => entry.env === "STRIPE_PRICE_NETWORK_PILOT")
      ?.metadata.allowance_cadence,
    "pooled_90_day"
  )
  assert.deepEqual(
    {
      interval: STRIPE_CATALOG.find(
        (entry) => entry.env === "STRIPE_PRICE_NETWORK_PILOT"
      )?.interval,
      intervalCount: STRIPE_CATALOG.find(
        (entry) => entry.env === "STRIPE_PRICE_NETWORK_PILOT"
      )?.intervalCount
    },
    { interval: "day", intervalCount: 30 }
  )
  for (const entry of STRIPE_CATALOG) {
    assert.equal(typeof entry.metadata.logloads_plan_code, "string")
    assert.equal(typeof entry.metadata.billing_model, "string")
    assert.equal(typeof entry.metadata.included_network_loads, "string")
    assert.equal(typeof entry.metadata.allowance_cadence, "string")
    assert.equal(typeof entry.metadata.overage_unit_amount, "string")
  }
  assert.equal(new Set(STRIPE_CATALOG.map((entry) => entry.key)).size, STRIPE_CATALOG.length)
  assert.equal(new Set(STRIPE_CATALOG.map((entry) => entry.env)).size, STRIPE_CATALOG.length)
  assert.equal(STRIPE_API_VERSION, "2026-06-24.dahlia")
})

test("catalog writes refuse live mode without the second explicit flag", () => {
  assert.equal(assertSafeCatalogKey("sk_test_example", false), "test")
  assert.throws(
    () => assertSafeCatalogKey("sk_live_example", false),
    /explicit --allow-live/
  )
  assert.equal(assertSafeCatalogKey("sk_live_example", true), "live")
  assert.throws(() => assertSafeCatalogKey("pk_test_example", true), /STRIPE_SECRET_KEY/)
})

test("activation refuses a missing or cross-wired Stripe account without exposing ids", () => {
  assert.doesNotThrow(() =>
    assertExpectedStripeAccountId("acct_logloads", "acct_logloads")
  )
  assert.throws(
    () => assertExpectedStripeAccountId("acct_other", undefined),
    /LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID/
  )
  assert.throws(
    () => assertExpectedStripeAccountId("acct_other", "acct_logloads"),
    /does not match the LogLoads activation boundary/
  )
})

test("portal configuration cannot shorten commitments or switch plans", () => {
  const safe = {
    active: true,
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: false },
      subscription_update: { enabled: false }
    }
  }

  assert.equal(portalConfigurationMismatch(safe), null)
  assert.equal(
    portalConfigurationMismatch({
      ...safe,
      features: {
        ...safe.features,
        subscription_cancel: { enabled: true }
      }
    }),
    "subscription_cancel"
  )
})

test("Stripe form encoder preserves nested metadata and arrays", () => {
  const form = flattenStripeForm({
    items: [{ price: "price_base", quantity: 1 }],
    metadata: { billing_model: "subscription_v1" }
  })

  assert.equal(form.get("items[0][price]"), "price_base")
  assert.equal(form.get("items[0][quantity]"), "1")
  assert.equal(form.get("metadata[billing_model]"), "subscription_v1")
})

test("provider reconciliation rejects immutable Price drift", () => {
  const specification = STRIPE_CATALOG.find(
    (entry) => entry.env === "STRIPE_PRICE_NETWORK_25"
  )
  const providerPrice = {
    currency: "usd",
    metadata: specification.metadata,
    recurring: { interval: "month", interval_count: 1 },
    type: "recurring",
    unit_amount: specification.unitAmount
  }

  assert.equal(priceMismatch(providerPrice, specification), null)
  assert.equal(
    priceMismatch({ ...providerPrice, unit_amount: 1 }, specification),
    "unit_amount"
  )
})
