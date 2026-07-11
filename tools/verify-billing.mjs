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
console.log(active.length > 0
  ? `OK: ${active.length} active paid subscription(s) with Stripe ids — webhook loop confirmed.`
  : "No active paid subscriptions with Stripe ids yet.")
