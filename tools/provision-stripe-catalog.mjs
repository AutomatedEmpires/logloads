#!/usr/bin/env node

import {
  STRIPE_API_VERSION,
  STRIPE_CATALOG,
  assertExpectedStripeAccountId,
  assertSafeCatalogKey,
  flattenStripeForm,
  portalConfigurationMismatch,
  priceMismatch,
  stripeCatalogSummary
} from "./stripe-catalog.mjs"

const args = new Set(process.argv.slice(2))
const apply = args.has("--apply")
const allowLive = args.has("--allow-live")

if (!apply) {
  console.log(JSON.stringify({
    action: "none",
    catalog: stripeCatalogSummary(),
    note: "No provider calls were made. Re-run with --apply and an sk_test_ key. Live mode additionally requires --allow-live."
  }, null, 2))
  process.exit(0)
}

const secretKey = process.env.STRIPE_SECRET_KEY?.trim()

if (!secretKey) {
  throw new Error("Set STRIPE_SECRET_KEY before using --apply")
}

const mode = assertSafeCatalogKey(secretKey, allowLive)
const expectedAccountId =
  process.env.LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID?.trim()

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

async function listAll(path) {
  const records = []
  let startingAfter = null

  do {
    const separator = path.includes("?") ? "&" : "?"
    const page = await stripeRequest(
      "GET",
      `${path}${separator}limit=100${startingAfter ? `&starting_after=${encodeURIComponent(startingAfter)}` : ""}`
    )

    records.push(...page.data)
    startingAfter = page.has_more ? page.data.at(-1)?.id ?? null : null
  } while (startingAfter)

  return records
}

const account = await stripeRequest("GET", "/v1/account")
assertExpectedStripeAccountId(account.id, expectedAccountId)

const portalConfigurationId =
  process.env.STRIPE_PORTAL_CONFIGURATION_NETWORK?.trim()
let portalConfiguration = "not_configured"

if (portalConfigurationId) {
  if (!portalConfigurationId.startsWith("bpc_")) {
    throw new Error(
      "STRIPE_PORTAL_CONFIGURATION_NETWORK must contain a Stripe portal configuration id"
    )
  }

  const configuration = await stripeRequest(
    "GET",
    `/v1/billing_portal/configurations/${encodeURIComponent(
      portalConfigurationId
    )}`
  )
  const mismatch = portalConfigurationMismatch(configuration)

  if (mismatch) {
    throw new Error(
      `The LogLoads billing portal configuration violates the commitment boundary at ${mismatch}`
    )
  }

  portalConfiguration = "verified"
}

const products = await listAll("/v1/products?active=true")
const productByKey = new Map()

for (const specification of STRIPE_CATALOG) {
  if (productByKey.has(specification.productKey)) {
    continue
  }

  const matches = products.filter(
    (product) => product.metadata?.logloads_catalog_product_key === specification.productKey
  )

  if (matches.length > 1) {
    throw new Error(`Multiple Stripe Products use catalog key ${specification.productKey}`)
  }

  const product =
    matches[0] ??
    (await stripeRequest(
      "POST",
      "/v1/products",
      {
        metadata: {
          ...specification.metadata,
          logloads_catalog_product_key: specification.productKey,
          logloads_catalog_version: "v1"
        },
        name: specification.productName
      },
      `logloads:catalog:v1:product:${specification.productKey}`
    ))

  productByKey.set(specification.productKey, product)
}

const environment = {}

for (const specification of STRIPE_CATALOG) {
  const product = productByKey.get(specification.productKey)
  const prices = await listAll(`/v1/prices?active=true&product=${encodeURIComponent(product.id)}`)
  const matches = prices.filter(
    (price) => price.metadata?.logloads_catalog_key === specification.key
  )

  if (matches.length > 1) {
    throw new Error(`Multiple Stripe Prices use catalog key ${specification.key}`)
  }

  let price = matches[0]

  if (price) {
    const mismatch = priceMismatch(price, specification)

    if (mismatch) {
      throw new Error(
        `Stripe Price ${price.id} disagrees with ${specification.key} at ${mismatch}; do not mutate or silently replace a live catalog Price`
      )
    }
  } else {
    price = await stripeRequest(
      "POST",
      "/v1/prices",
      {
        currency: "usd",
        lookup_key: `logloads_${specification.key}`,
        metadata: {
          ...specification.metadata,
          logloads_catalog_key: specification.key,
          logloads_catalog_version: "v1"
        },
        product: product.id,
        ...(specification.kind === "recurring"
          ? {
              recurring: {
                interval: specification.interval,
                interval_count: specification.intervalCount ?? 1
              }
            }
          : {}),
        unit_amount: specification.unitAmount
      },
      `logloads:catalog:v1:price:${specification.key}`
    )
  }

  environment[specification.env] = price.id
}

console.log(JSON.stringify({
  action: "catalog_verified",
  environment,
  mode,
  portalConfiguration,
  stripeApiVersion: STRIPE_API_VERSION
}, null, 2))
