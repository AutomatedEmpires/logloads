// LogLoads billing verification — inspect entitlement state after a real purchase.
//
//   SUPABASE_URL=https://fdzohbiiyzgvjzfsjyxo.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node tools/verify-billing.mjs "North Pine Logging"
//
// Reads the canonical operating state (service-role only) and reports each org's plan
// status + Stripe ids. Use after the founder completes the controlled purchase to
// confirm the webhook → entitlement loop landed. Optionally pass an org name to
// filter. Requires canonical-state access (SUPABASE_SERVICE_ROLE_KEY).
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const orgFilter = process.argv[2]?.toLowerCase()

if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-only). Canonical state is service-role only.")
  process.exit(2)
}

const res = await fetch(`${url}/rest/v1/operating_state?id=eq.primary&select=state,updated_at,version,schema_version`, {
  headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  signal: AbortSignal.timeout(15000)
})

if (!res.ok) {
  console.error(`Mirror read failed: ${res.status} ${await res.text()}`)
  process.exit(1)
}

const rows = await res.json()
const state = rows[0]?.state

if (!state) {
  console.error("No canonical operating_state row. Stop and verify the intended environment before bootstrap.")
  process.exit(1)
}

const orgs = new Map((state.organizations ?? []).map((o) => [o.id, o.displayName]))
const entitlements = (state.entitlements ?? []).filter(
  (e) => !orgFilter || (orgs.get(e.organizationId) ?? "").toLowerCase().includes(orgFilter)
)

console.log(`Canonical state: schema=${rows[0].schema_version} version=${rows[0].version} updated=${rows[0].updated_at}`)
console.log(`Entitlements (${entitlements.length}):\n`)

for (const e of entitlements) {
  console.log(`  ${orgs.get(e.organizationId) ?? e.organizationId}`)
  console.log(`    product:        ${e.product}`)
  console.log(`    status:         ${e.status}`)
  console.log(`    stripeCustomer: ${e.stripeCustomerId ?? "—"}`)
  console.log(`    stripeSub:      ${e.stripeSubscriptionId ?? "—"}`)
  console.log(`    periodEnds:     ${e.currentPeriodEndsAt ?? "—"}`)
  console.log("")
}

const active = entitlements.filter((e) => e.status === "active" && e.stripeSubscriptionId)
const commercialSubscriptions = (state.organizationSubscriptions ?? []).filter((subscription) => {
  const organizationName = orgs.get(subscription.organizationId) ?? ""

  return (
    subscription.planCode !== "internal_billing_test" &&
    (!orgFilter || organizationName.toLowerCase().includes(orgFilter))
  )
})
const usageEvents = state.networkUsageEvents ?? []
const summaries = state.billingPeriodSummaries ?? []
const overageInvoices = state.networkOverageInvoices ?? []

console.log(active.length > 0
  ? `OK: ${active.length} active Dispatch Pro subscription(s) with Stripe ids.`
  : "No active Dispatch Pro subscriptions with Stripe ids yet.")
console.log(`\nCommercial subscriptions (${commercialSubscriptions.length}, internal tests excluded):\n`)

for (const subscription of commercialSubscriptions) {
  const subscriptionSummaries = summaries.filter(
    (summary) => summary.subscriptionId === subscription.id
  )
  const subscriptionUsageIds = new Set(
    subscriptionSummaries.flatMap((summary) => summary.usageEventIds ?? [])
  )
  const subscriptionOverages = overageInvoices.filter(
    (invoice) => invoice.subscriptionId === subscription.id ||
      subscriptionSummaries.some((summary) => summary.id === invoice.billingPeriodSummaryId)
  )

  console.log(`  ${orgs.get(subscription.organizationId) ?? subscription.organizationId}`)
  console.log(`    plan:           ${subscription.planCode}`)
  console.log(`    status:         ${subscription.status}`)
  console.log(`    paymentState:   ${subscription.paymentState}`)
  console.log(`    stripeCustomer: ${subscription.stripeCustomerId ?? "—"}`)
  console.log(`    stripeSub:      ${subscription.stripeSubscriptionId ?? "—"}`)
  console.log(`    period:         ${subscription.currentPeriodStart ?? "—"} → ${subscription.currentPeriodEnd ?? "—"}`)
  console.log(`    usage:          ${subscriptionUsageIds.size} frozen unit(s) across ${subscriptionSummaries.length} summary row(s)`)
  console.log(`    overage:        ${subscriptionOverages.length} invoice row(s)`)
  console.log("")
}

const orphanedUsage = usageEvents.filter(
  (usage) =>
    !commercialSubscriptions.some((subscription) => subscription.id === usage.subscriptionId)
)

if (orphanedUsage.length > 0) {
  console.error(`RECONCILIATION REQUIRED: ${orphanedUsage.length} Network usage event(s) have no selected commercial subscription.`)
  process.exitCode = 1
}

const boundCommercial = commercialSubscriptions.filter(
  (subscription) =>
    subscription.stripeCustomerId &&
    subscription.stripeSubscriptionId &&
    ["active", "past_due", "grace"].includes(subscription.status)
)

console.log(boundCommercial.length > 0
  ? `OK: ${boundCommercial.length} commercial subscription(s) have canonical Stripe bindings.`
  : "No bound commercial subscription has completed webhook reconciliation yet.")
