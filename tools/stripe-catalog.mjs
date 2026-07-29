export const STRIPE_API_VERSION = "2026-06-24.dahlia"

export const STRIPE_CATALOG = Object.freeze([
  {
    env: "STRIPE_PRICE_DISPATCH",
    interval: "month",
    key: "dispatch_pro_monthly_v1",
    kind: "recurring",
    metadata: {
      allowance_cadence: "none",
      billing_model: "dispatch_pro",
      included_network_loads: "0",
      logloads_plan_code: "dispatch_pro",
      overage_unit_amount: "0"
    },
    productKey: "dispatch_pro",
    productName: "LogLoads Dispatch Pro",
    unitAmount: 49_900
  },
  {
    env: "STRIPE_PRICE_NETWORK_PILOT",
    interval: "day",
    intervalCount: 30,
    key: "network_pilot_30_day_v1",
    kind: "recurring",
    metadata: {
      allowance_cadence: "pooled_90_day",
      billing_model: "subscription_v1",
      included_network_loads: "30",
      logloads_plan_code: "network_pilot",
      overage_unit_amount: "15000"
    },
    productKey: "network_pilot",
    productName: "LogLoads Network Pilot",
    unitAmount: 150_000
  },
  {
    env: "STRIPE_PRICE_NETWORK_PILOT_OVERAGE",
    key: "network_pilot_overage_v1",
    kind: "one_time",
    metadata: {
      allowance_cadence: "pooled_90_day",
      billing_model: "subscription_v1",
      included_network_loads: "30",
      logloads_plan_code: "network_pilot",
      overage_unit_amount: "15000",
      price_role: "overage"
    },
    productKey: "network_pilot",
    productName: "LogLoads Network Pilot",
    unitAmount: 15_000
  },
  {
    env: "STRIPE_PRICE_NETWORK_25",
    interval: "month",
    key: "network_25_monthly_v1",
    kind: "recurring",
    metadata: {
      allowance_cadence: "monthly_no_rollover",
      billing_model: "subscription_v1",
      included_network_loads: "25",
      logloads_plan_code: "network_25",
      overage_unit_amount: "12500"
    },
    productKey: "network_25",
    productName: "LogLoads Network 25",
    unitAmount: 300_000
  },
  {
    env: "STRIPE_PRICE_NETWORK_25_OVERAGE",
    key: "network_25_overage_v1",
    kind: "one_time",
    metadata: {
      allowance_cadence: "monthly_no_rollover",
      billing_model: "subscription_v1",
      included_network_loads: "25",
      logloads_plan_code: "network_25",
      overage_unit_amount: "12500",
      price_role: "overage"
    },
    productKey: "network_25",
    productName: "LogLoads Network 25",
    unitAmount: 12_500
  },
  {
    env: "STRIPE_PRICE_NETWORK_50",
    interval: "month",
    key: "network_50_monthly_v1",
    kind: "recurring",
    metadata: {
      allowance_cadence: "monthly_no_rollover",
      billing_model: "subscription_v1",
      included_network_loads: "50",
      logloads_plan_code: "network_50",
      overage_unit_amount: "11000"
    },
    productKey: "network_50",
    productName: "LogLoads Network 50",
    unitAmount: 550_000
  },
  {
    env: "STRIPE_PRICE_NETWORK_50_OVERAGE",
    key: "network_50_overage_v1",
    kind: "one_time",
    metadata: {
      allowance_cadence: "monthly_no_rollover",
      billing_model: "subscription_v1",
      included_network_loads: "50",
      logloads_plan_code: "network_50",
      overage_unit_amount: "11000",
      price_role: "overage"
    },
    productKey: "network_50",
    productName: "LogLoads Network 50",
    unitAmount: 11_000
  },
  {
    env: "STRIPE_PRICE_NETWORK_100",
    interval: "month",
    key: "network_100_monthly_v1",
    kind: "recurring",
    metadata: {
      allowance_cadence: "monthly_no_rollover",
      billing_model: "subscription_v1",
      included_network_loads: "100",
      logloads_plan_code: "network_100",
      overage_unit_amount: "9000"
    },
    productKey: "network_100",
    productName: "LogLoads Network 100",
    unitAmount: 1_000_000
  },
  {
    env: "STRIPE_PRICE_NETWORK_100_OVERAGE",
    key: "network_100_overage_v1",
    kind: "one_time",
    metadata: {
      allowance_cadence: "monthly_no_rollover",
      billing_model: "subscription_v1",
      included_network_loads: "100",
      logloads_plan_code: "network_100",
      overage_unit_amount: "9000",
      price_role: "overage"
    },
    productKey: "network_100",
    productName: "LogLoads Network 100",
    unitAmount: 9_000
  },
  {
    env: "STRIPE_PRICE_INTERNAL_BILLING_TEST",
    key: "internal_billing_test_v1",
    kind: "one_time",
    metadata: {
      allowance_cadence: "none",
      billing_model: "internal_billing_test",
      included_network_loads: "0",
      internal_billing_test: "true",
      logloads_plan_code: "internal_billing_test",
      overage_unit_amount: "0"
    },
    productKey: "internal_billing_test",
    productName: "LogLoads Internal Billing Verification",
    unitAmount: 100
  }
])

export function stripeCatalogSummary() {
  return STRIPE_CATALOG.map((entry) => ({
    amountCents: entry.unitAmount,
    env: entry.env,
    interval: entry.interval ?? null,
    intervalCount: entry.intervalCount ?? (entry.interval ? 1 : null),
    key: entry.key,
    kind: entry.kind,
    product: entry.productName
  }))
}

export function flattenStripeForm(value, prefix = "", target = new URLSearchParams()) {
  if (value === undefined || value === null) {
    return target
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      flattenStripeForm(entry, `${prefix}[${index}]`, target)
    })

    return target
  }

  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      flattenStripeForm(entry, prefix ? `${prefix}[${key}]` : key, target)
    }

    return target
  }

  target.append(prefix, String(value))
  return target
}

export function assertSafeCatalogKey(secretKey, allowLive) {
  if (secretKey.startsWith("sk_test_")) {
    return "test"
  }

  if (secretKey.startsWith("sk_live_") && allowLive) {
    return "live"
  }

  if (secretKey.startsWith("sk_live_")) {
    throw new Error("Live catalog writes require the explicit --allow-live flag")
  }

  throw new Error("STRIPE_SECRET_KEY must be an sk_test_ or sk_live_ secret key")
}

export function assertExpectedStripeAccountId(actualAccountId, expectedAccountId) {
  if (!/^acct_[A-Za-z0-9]+$/.test(expectedAccountId ?? "")) {
    throw new Error(
      "LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID must contain the dedicated LogLoads Stripe account id"
    )
  }

  if (actualAccountId !== expectedAccountId) {
    throw new Error(
      "Stripe account identity does not match the LogLoads activation boundary"
    )
  }
}

export function portalConfigurationMismatch(configuration) {
  if (!configuration?.active) {
    return "inactive"
  }

  if (configuration.features?.payment_method_update?.enabled !== true) {
    return "payment_method_update"
  }

  if (configuration.features?.invoice_history?.enabled !== true) {
    return "invoice_history"
  }

  if (configuration.features?.subscription_cancel?.enabled !== false) {
    return "subscription_cancel"
  }

  if (configuration.features?.subscription_update?.enabled !== false) {
    return "subscription_update"
  }

  return null
}

export function priceMismatch(price, specification) {
  if (price.currency !== "usd") {
    return "currency"
  }

  if (price.unit_amount !== specification.unitAmount) {
    return "unit_amount"
  }

  if (price.type !== specification.kind) {
    return "type"
  }

  if (
    specification.kind === "recurring" &&
    (
      price.recurring?.interval !== specification.interval ||
      price.recurring?.interval_count !== (specification.intervalCount ?? 1)
    )
  ) {
    return "recurring_interval"
  }

  for (const [key, value] of Object.entries(specification.metadata)) {
    if (price.metadata?.[key] !== value) {
      return `metadata.${key}`
    }
  }

  return null
}
