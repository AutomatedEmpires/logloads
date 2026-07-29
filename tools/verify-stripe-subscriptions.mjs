#!/usr/bin/env node

import {
  STRIPE_API_VERSION,
  assertExpectedStripeAccountId,
  flattenStripeForm,
  portalConfigurationMismatch
} from "./stripe-catalog.mjs"
import {
  assertClockAdvanceWithinLimit,
  assertStripeTestKey,
  findCanonicalSubscription,
  parseCliArguments,
  pilotLifecycleCheckpoints,
  pollUntil
} from "./stripe-test-clock.mjs"

const { flags, values } = parseCliArguments(process.argv.slice(2))

if (!flags.has("--apply")) {
  console.log(JSON.stringify({
    action: "none",
    createFixture:
      "Use --apply --create-fixture --fixture-key <stable-key> with an sk_test_ key. No live key is accepted.",
    run:
      "After binding the returned clock/customer to a canonical test billing account, use --apply --run --clock <clock_id> --customer <cus_id> --organization-id <uuid> --organization-subscription-id <uuid> [--verify-local].",
    note: "No provider calls were made."
  }, null, 2))
  process.exit(0)
}

const secretKey = process.env.STRIPE_SECRET_KEY?.trim()
assertStripeTestKey(secretKey)

async function stripeRequest(method, path, body, idempotencyKey) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    body: body ? flattenStripeForm(body) : undefined,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      "Stripe-Version": STRIPE_API_VERSION
    },
    method,
    signal: AbortSignal.timeout(30_000)
  })
  const payload = await response.json()

  if (!response.ok) {
    throw new Error(
      `Stripe ${method} ${path} failed (${response.status}): ${payload.error?.message ?? "unknown provider error"}`
    )
  }

  return payload
}

const account = await stripeRequest("GET", "/v1/account")
assertExpectedStripeAccountId(
  account.id,
  process.env.LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID?.trim()
)
const portalConfigurationId =
  process.env.STRIPE_PORTAL_CONFIGURATION_NETWORK?.trim()

if (!portalConfigurationId?.startsWith("bpc_")) {
  throw new Error(
    "STRIPE_PORTAL_CONFIGURATION_NETWORK must identify the restricted LogLoads portal configuration"
  )
}

const portalConfiguration = await stripeRequest(
  "GET",
  `/v1/billing_portal/configurations/${encodeURIComponent(
    portalConfigurationId
  )}`
)
const portalMismatch = portalConfigurationMismatch(portalConfiguration)

if (portalMismatch) {
  throw new Error(
    `The LogLoads billing portal configuration violates the commitment boundary at ${portalMismatch}`
  )
}

if (flags.has("--create-fixture")) {
  const fixtureKey = values.get("--fixture-key")

  if (!fixtureKey) {
    throw new Error("--create-fixture requires --fixture-key so retries remain idempotent")
  }

  const frozenTime = Math.floor(Date.now() / 1000)
  const clock = await stripeRequest(
    "POST",
    "/v1/test_helpers/test_clocks",
    { frozen_time: frozenTime, name: `LogLoads ${fixtureKey}` },
    `logloads:test-clock:${fixtureKey}:clock`
  )
  const customer = await stripeRequest(
    "POST",
    "/v1/customers",
    {
      metadata: {
        internal_billing_test: "true",
        logloads_test_fixture: fixtureKey
      },
      name: `LogLoads billing fixture ${fixtureKey}`,
      test_clock: clock.id
    },
    `logloads:test-clock:${fixtureKey}:customer`
  )
  await stripeRequest(
    "POST",
    "/v1/payment_methods/pm_card_visa/attach",
    { customer: customer.id },
    `logloads:test-clock:${fixtureKey}:attach-card`
  )
  await stripeRequest(
    "POST",
    `/v1/customers/${encodeURIComponent(customer.id)}`,
    { invoice_settings: { default_payment_method: "pm_card_visa" } },
    `logloads:test-clock:${fixtureKey}:default-card`
  )

  console.log(JSON.stringify({
    action: "fixture_created",
    customerId: customer.id,
    next:
      "Bind this test customer to an internal canonical billing account and create a pending organization subscription before --run.",
    testClockId: clock.id
  }, null, 2))
  process.exit(0)
}

if (!flags.has("--run")) {
  throw new Error("Choose exactly one workflow: --create-fixture or --run")
}

const clockId = values.get("--clock")
const customerId = values.get("--customer")
const organizationId = values.get("--organization-id")
const organizationSubscriptionId = values.get("--organization-subscription-id")
const priceEnv = values.get("--price-env") ?? "STRIPE_PRICE_NETWORK_PILOT"
const allowedBasePriceEnvs = new Set([
  "STRIPE_PRICE_DISPATCH",
  "STRIPE_PRICE_NETWORK_PILOT",
  "STRIPE_PRICE_NETWORK_25",
  "STRIPE_PRICE_NETWORK_50",
  "STRIPE_PRICE_NETWORK_100"
])

if (!clockId || !customerId || !organizationId || !organizationSubscriptionId) {
  throw new Error(
    "--run requires --clock, --customer, --organization-id, and --organization-subscription-id"
  )
}

if (!allowedBasePriceEnvs.has(priceEnv)) {
  throw new Error("--price-env must name a pre-created LogLoads recurring base Price")
}

const priceId = process.env[priceEnv]?.trim()

if (!priceId?.startsWith("price_")) {
  throw new Error(`${priceEnv} must contain a pre-created Stripe Price id`)
}

const planCodeByPriceEnv = {
  STRIPE_PRICE_DISPATCH: "dispatch_pro",
  STRIPE_PRICE_NETWORK_100: "network_100",
  STRIPE_PRICE_NETWORK_25: "network_25",
  STRIPE_PRICE_NETWORK_50: "network_50",
  STRIPE_PRICE_NETWORK_PILOT: "network_pilot"
}
const planCode = planCodeByPriceEnv[priceEnv]
const billingModel = planCode === "dispatch_pro" ? "dispatch_pro" : "subscription_v1"
const customer = await stripeRequest(
  "GET",
  `/v1/customers/${encodeURIComponent(customerId)}`
)
const customerClockId =
  typeof customer.test_clock === "string" ? customer.test_clock : customer.test_clock?.id

if (customerClockId !== clockId) {
  throw new Error("The supplied test customer is not attached to the supplied test clock")
}

const startedAt = Math.floor(Date.now() / 1000)
const subscription = await stripeRequest(
  "POST",
  "/v1/subscriptions",
  {
    customer: customerId,
    items: [{ price: priceId, quantity: 1 }],
    metadata: {
      billingModel,
      internal_billing_test: "false",
      organizationId,
      organizationSubscriptionId,
      planCode
    },
    payment_behavior: "error_if_incomplete"
  },
  `logloads:test-clock:${organizationSubscriptionId}:subscription`
)

if (subscription.items?.data?.length !== 1) {
  throw new Error("The provider test subscription must contain exactly one base item")
}

const firstItem = subscription.items.data[0]
const firstPeriodStart = firstItem.current_period_start
const firstPeriodEnd = firstItem.current_period_end
const intervalSeconds = firstPeriodEnd - firstPeriodStart
const clock = await stripeRequest(
  "GET",
  `/v1/test_helpers/test_clocks/${encodeURIComponent(clockId)}`
)
const pilotPlan =
  planCode === "network_pilot"
    ? pilotLifecycleCheckpoints(firstPeriodStart)
    : null
let scheduleId = null

if (pilotPlan) {
  if (intervalSeconds !== pilotPlan.intervalSeconds) {
    throw new Error(
      "The provider Pilot Price is not an exact recurring 30-day Price"
    )
  }

  const schedule = await stripeRequest(
    "POST",
    "/v1/subscription_schedules",
    { from_subscription: subscription.id },
    `logloads:test-clock:${organizationSubscriptionId}:pilot-schedule:create`
  )
  const updatedSchedule = await stripeRequest(
    "POST",
    `/v1/subscription_schedules/${encodeURIComponent(schedule.id)}`,
    {
      end_behavior: "cancel",
      metadata: {
        billingModel,
        internal_billing_test: "false",
        logloads_schedule_kind: "network_pilot_90_day_v1",
        organizationId,
        organizationSubscriptionId,
        planCode
      },
      phases: [
        {
          end_date: pilotPlan.termEndSeconds,
          items: [{ price: priceId, quantity: 1 }],
          proration_behavior: "none",
          start_date: firstPeriodStart
        }
      ],
      proration_behavior: "none"
    },
    `logloads:test-clock:${organizationSubscriptionId}:pilot-schedule:update`
  )

  if (
    updatedSchedule.end_behavior !== "cancel" ||
    updatedSchedule.phases?.length !== 1 ||
    updatedSchedule.phases[0]?.start_date !== firstPeriodStart ||
    updatedSchedule.phases[0]?.end_date !== pilotPlan.termEndSeconds
  ) {
    throw new Error(
      "Stripe did not preserve the exact finite 90-day Pilot schedule"
    )
  }

  scheduleId = updatedSchedule.id
}

const advanceTargets =
  pilotPlan?.advanceTargets ?? [firstPeriodEnd + 1]
let currentClock = clock

for (const targetTime of advanceTargets) {
  assertClockAdvanceWithinLimit(
    currentClock.frozen_time,
    targetTime,
    intervalSeconds
  )

  await stripeRequest(
    "POST",
    `/v1/test_helpers/test_clocks/${encodeURIComponent(clockId)}/advance`,
    { frozen_time: targetTime },
    `logloads:test-clock:${organizationSubscriptionId}:advance:${targetTime}`
  )

  currentClock = await pollUntil({
    attempt: async () => {
      const current = await stripeRequest(
        "GET",
        `/v1/test_helpers/test_clocks/${encodeURIComponent(clockId)}`
      )

      return current.status === "ready"
        ? { done: true, value: current }
        : { done: false }
    }
  })
}

const advancedSubscription = await stripeRequest(
  "GET",
  `/v1/subscriptions/${encodeURIComponent(subscription.id)}`
)
const advancedItem = advancedSubscription.items?.data?.[0]

if (!advancedItem || advancedItem.current_period_end <= firstPeriodEnd) {
  throw new Error("Stripe did not advance the subscription into its next billing period")
}

if (
  pilotPlan &&
  (
    advancedSubscription.status !== "canceled" ||
    advancedItem.current_period_end !== pilotPlan.termEndSeconds
  )
) {
  throw new Error(
    "The Network Pilot did not cancel at its exact provider term boundary"
  )
}

const invoicePage = await stripeRequest(
  "GET",
  `/v1/invoices?customer=${encodeURIComponent(customerId)}&limit=100`
)
const subscriptionInvoices = invoicePage.data.filter((invoice) => {
  return (
    invoice.parent?.subscription_details?.subscription === subscription.id ||
    invoice.subscription === subscription.id
  )
})
const paidSubscriptionInvoices = subscriptionInvoices.filter(
  (invoice) => invoice.status === "paid"
)

if (pilotPlan && paidSubscriptionInvoices.length !== 3) {
  throw new Error(
    `The finite Network Pilot produced ${paidSubscriptionInvoices.length} paid invoices instead of exactly three`
  )
}

const events = await stripeRequest(
  "GET",
  `/v1/events?limit=100&created[gte]=${startedAt}`
)
const relevantEvents = events.data.filter((event) => {
  const object = event.data?.object

  return (
    object?.id === subscription.id ||
    object?.parent?.subscription_details?.subscription === subscription.id ||
    object?.subscription === subscription.id
  )
})
const relevantTypes = new Set(relevantEvents.map((event) => event.type))

if (!relevantTypes.has("invoice.payment_succeeded")) {
  throw new Error("No invoice.payment_succeeded event was observed for the advanced subscription")
}

let local = null

if (flags.has("--verify-local")) {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "")
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("--verify-local requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
  }

  local = await pollUntil({
    attempt: async () => {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/operating_state?id=eq.primary&select=state,version,updated_at`,
        {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
            apikey: serviceRoleKey
          },
          signal: AbortSignal.timeout(15_000)
        }
      )

      if (!response.ok) {
        throw new Error(`Canonical state read failed with ${response.status}`)
      }

      const rows = await response.json()
      const candidate = findCanonicalSubscription(
        rows[0]?.state,
        organizationSubscriptionId
      )
      const reconciled =
        candidate?.stripeSubscriptionId === subscription.id &&
        typeof candidate.currentPeriodEnd === "string" &&
        Date.parse(candidate.currentPeriodEnd) >= advancedItem.current_period_end * 1000

      return reconciled
        ? {
            done: true,
            value: {
              currentPeriodEnd: candidate.currentPeriodEnd,
              paymentState: candidate.paymentState,
              stateVersion: rows[0].version,
              status: candidate.status,
              updatedAt: rows[0].updated_at
            }
          }
        : { done: false }
    }
  })
}

console.log(JSON.stringify({
  action: "test_clock_verified",
  currentPeriodEnd: new Date(advancedItem.current_period_end * 1000).toISOString(),
  eventTypes: [...relevantTypes].sort(),
  local,
  mode: "test",
  paidInvoiceCount: paidSubscriptionInvoices.length,
  portalConfiguration: "verified",
  scheduleId,
  stripeApiVersion: STRIPE_API_VERSION,
  stripeSubscriptionId: subscription.id,
  testClockId: clockId
}, null, 2))
