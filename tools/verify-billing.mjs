// LogLoads billing verification — inspect percentage-v1 state after a controlled test.
//
//   SUPABASE_URL=https://example.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node tools/verify-billing.mjs [optional-organization-name]
//
// Reads the service-role-only canonical document without mutating it. Output is
// aggregate by default: provider identifiers and unrelated organization names
// are not printed. An optional organization-name filter narrows every count.

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const orgFilter = process.argv[2]?.trim().toLowerCase() || null

if (!url || !key) {
  console.error(
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-only). Canonical state is service-role only."
  )
  process.exit(2)
}

const response = await fetch(
  `${url}/rest/v1/operating_state?id=eq.primary&select=state,updated_at,version,schema_version`,
  {
    headers: {
      Accept: "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`
    },
    signal: AbortSignal.timeout(15_000)
  }
)

if (!response.ok) {
  // Do not echo the provider body: an unexpected gateway or policy response can
  // contain implementation detail that does not belong in a CI artifact.
  console.error(`Canonical billing read failed with HTTP ${response.status}.`)
  process.exit(1)
}

const rows = await response.json()
const row = rows[0]
const state = row?.state

if (!state) {
  console.error(
    "No canonical operating_state row. Verify the intended environment before any bootstrap."
  )
  process.exit(1)
}

const organizations = new Map(
  (state.organizations ?? []).map((organization) => [
    organization.id,
    organization.displayName
  ])
)
const organizationIsSelected = (organizationId) => {
  if (!orgFilter) return true

  return (organizations.get(organizationId) ?? "")
    .toLowerCase()
    .includes(orgFilter)
}
const selectedOrganizationIds = new Set(
  [...organizations.keys()].filter(organizationIsSelected)
)

if (orgFilter && selectedOrganizationIds.size === 0) {
  console.error("No organization matched the requested filter.")
  process.exit(1)
}

const accounts = (state.organizationBillingAccounts ?? []).filter((account) =>
  organizationIsSelected(account.organizationId)
)
const assignments = (state.assignments ?? []).filter((assignment) => {
  const load = (state.loadPostings ?? []).find(
    (posting) => posting.id === assignment.loadPostingId
  )

  return load ? organizationIsSelected(load.companyId) : !orgFilter
})
const assignmentById = new Map(
  (state.assignments ?? []).map((assignment) => [assignment.id, assignment])
)
const loadById = new Map(
  (state.loadPostings ?? []).map((load) => [load.id, load])
)
const fees = (state.platformFeeEvents ?? []).filter((fee) =>
  organizationIsSelected(fee.organizationId)
)
const invoices = (state.hostInvoices ?? []).filter((invoice) =>
  organizationIsSelected(invoice.organizationId)
)
const subscriptions = (state.organizationSubscriptions ?? []).filter(
  (subscription) =>
    subscription.planCode !== "internal_billing_test" &&
    organizationIsSelected(subscription.organizationId)
)
const usage = (state.networkUsageEvents ?? []).filter((event) =>
  organizationIsSelected(event.organizationId)
)

const currentAccounts = accounts.filter(
  (account) =>
    account.activationState === "percentage_active" &&
    account.billingModel === "percentage_v1"
)
const malformedCurrentAccounts = currentAccounts.filter((account) => {
  const terms = account.percentageTermsSnapshot

  return !(
    terms &&
    terms.feeBps === 500 &&
    terms.currency === "USD" &&
    terms.billingCadence === "monthly_in_arrears" &&
    terms.acceptedAt &&
    terms.acceptedByUserId &&
    terms.acceptedTermsVersion
  )
})

const computedFeeCents = (driverPayCents, feeBps) => {
  const scaled = driverPayCents * feeBps
  const remainder = scaled % 10_000
  const whole = (scaled - remainder) / 10_000

  return remainder * 2 >= 10_000 ? whole + 1 : whole
}
const noDeliveryExceptions = new Set([
  "rejected_at_scale",
  "access_blocked",
  "equipment_failure",
  "weather_hold"
])

const activeMovementFees = new Map()
const activeMovementUsage = new Set(
  usage
    .filter((event) => event.status !== "reversed")
    .map((event) => event.loadMovementId)
)
const defects = []
const rowsById = (rows) => {
  const grouped = new Map()

  for (const row of rows) {
    const matches = grouped.get(row.id) ?? []
    matches.push(row)
    grouped.set(row.id, matches)
  }

  return grouped
}
const allFeesById = rowsById(state.platformFeeEvents ?? [])
const allInvoicesById = rowsById(state.hostInvoices ?? [])

for (const [id, matches] of allFeesById) {
  if (
    matches.length > 1 &&
    matches.some((fee) => organizationIsSelected(fee.organizationId))
  ) {
    defects.push(`platform fee id ${id} appears ${matches.length} times`)
  }
}

for (const [id, matches] of allInvoicesById) {
  if (
    matches.length > 1 &&
    matches.some((invoice) => organizationIsSelected(invoice.organizationId))
  ) {
    defects.push(`host invoice id ${id} appears ${matches.length} times`)
  }
}

for (const fee of fees) {
  const assignment = assignmentById.get(fee.assignmentId)
  const movementId =
    fee.loadMovementId ?? assignment?.loadMovementId ?? fee.assignmentId
  const billingModel =
    fee.billingModel ?? assignment?.billingModel ?? "legacy_percentage"

  if (!fee.driverPayCents || fee.feeBps <= 0) {
    defects.push(`fee ${fee.id} has no positive frozen pay/rate basis`)
  } else if (
    computedFeeCents(fee.driverPayCents, fee.feeBps) !== fee.feeCents
  ) {
    defects.push(`fee ${fee.id} does not match the frozen integer calculation`)
  }

  if (!["legacy_percentage", "percentage_v1"].includes(billingModel)) {
    defects.push(`fee ${fee.id} carries non-percentage model ${billingModel}`)
  }

  const load = assignment ? loadById.get(fee.loadPostingId) : null
  const frozenPay = assignment?.termsSnapshot
  const frozenRateBps = frozenPay?.hostFee?.rateBps
  const modelMatches = assignment && (
    assignment.billingModel === billingModel ||
    (billingModel === "legacy_percentage" && assignment.billingModel == null)
  )
  if (!assignment || !load) {
    defects.push(`fee ${fee.id} does not resolve to an assignment and load`)
  } else if (
    assignment.loadPostingId !== load.id ||
    load.companyId !== fee.organizationId ||
    (assignment.loadMovementId ?? assignment.id) !== movementId ||
    assignment.truckSlotId !== fee.truckSlotId ||
    !modelMatches
  ) {
    defects.push(`fee ${fee.id} is cross-wired to its host, load, movement, slot, or model`)
  } else if (
    frozenPay.driverPayCents !== fee.driverPayCents ||
    String(frozenPay.currency ?? "").toUpperCase() !== "USD" ||
    frozenRateBps !== fee.feeBps
  ) {
    defects.push(`fee ${fee.id} disagrees with the pay, currency, or rate frozen at acceptance`)
  }

  const confirmedTrips = (state.tripsV2 ?? []).filter(
    (trip) =>
      trip.assignmentId === fee.assignmentId &&
      trip.completionStatus === "confirmed" &&
      trip.status !== "cancelled" &&
      trip.deliveredQuantity?.value > 0 &&
      !noDeliveryExceptions.has(trip.haulException?.type)
  )
  if (confirmedTrips.length !== 1) {
    defects.push(`fee ${fee.id} does not resolve to exactly one confirmed physical delivery`)
  } else if (billingModel === "percentage_v1") {
    if (fee.occurredAt !== confirmedTrips[0].completionConfirmedAt) {
      defects.push(`percentage fee ${fee.id} is not timestamped at host confirmation`)
    }
  } else if (
    !assignment?.driverPaymentReceivedAt ||
    assignment.driverPaymentReceivedAmountCents == null ||
    String(assignment.driverPaymentReceivedCurrency ?? "").toUpperCase() !== "USD" ||
    fee.occurredAt !== assignment.driverPaymentReceivedAt
  ) {
    defects.push(`legacy fee ${fee.id} is not backed and timestamped by its driver receipt`)
  }

  if (fee.status === "accrued" && fee.invoiceId) {
    defects.push(`accrued fee ${fee.id} already names invoice ${fee.invoiceId}`)
  }
  if (fee.status === "invoiced") {
    const invoiceMatches = allInvoicesById.get(fee.invoiceId) ?? []
    if (
      !fee.invoiceId ||
      invoiceMatches.length !== 1 ||
      invoiceMatches[0].organizationId !== fee.organizationId ||
      !invoiceMatches[0].feeEventIds.includes(fee.id)
    ) {
      defects.push(`invoiced fee ${fee.id} is not reciprocally linked to exactly one host invoice`)
    }
  }

  if (fee.status !== "voided") {
    if (activeMovementFees.has(movementId)) {
      defects.push(`physical movement ${movementId} has multiple active fees`)
    } else {
      activeMovementFees.set(movementId, fee.id)
    }

    if (activeMovementUsage.has(movementId)) {
      defects.push(
        `physical movement ${movementId} has both a percentage fee and subscription usage`
      )
    }
  }
}

for (const account of malformedCurrentAccounts) {
  defects.push(`percentage account ${account.id} has incomplete frozen terms`)
}

for (const account of currentAccounts) {
  if (account.subscriptionId !== null) {
    defects.push(`percentage account ${account.id} still points to a subscription`)
  }
}

const providerInvoiceClaims = new Map()
for (const invoice of invoices) {
  if (invoice.stripeInvoiceId) {
    const claims = providerInvoiceClaims.get(invoice.stripeInvoiceId) ?? []
    claims.push(invoice.id)
    providerInvoiceClaims.set(invoice.stripeInvoiceId, claims)
  }

  if (invoice.status === "void") continue

  if (new Set(invoice.feeEventIds).size !== invoice.feeEventIds.length) {
    defects.push(`host invoice ${invoice.id} repeats a fee id`)
  }

  let itemizedSubtotalCents = 0
  for (const feeId of invoice.feeEventIds) {
    const feeMatches = allFeesById.get(feeId) ?? []
    if (feeMatches.length !== 1) {
      defects.push(`host invoice ${invoice.id} cannot resolve fee ${feeId} exactly once`)
      continue
    }
    const fee = feeMatches[0]
    if (
      fee.organizationId !== invoice.organizationId ||
      fee.status !== "invoiced" ||
      fee.invoiceId !== invoice.id
    ) {
      defects.push(`host invoice ${invoice.id} is not reciprocally linked to fee ${feeId}`)
    }
    const occurredAt = Date.parse(fee.occurredAt)
    if (
      !Number.isFinite(occurredAt) ||
      occurredAt < Date.parse(invoice.periodStart) ||
      occurredAt >= Date.parse(invoice.periodEnd)
    ) {
      defects.push(`host invoice ${invoice.id} contains fee ${feeId} outside its billing period`)
    }
    const otherClaims = (state.hostInvoices ?? []).filter(
      (candidate) =>
        candidate.id !== invoice.id &&
        candidate.status !== "void" &&
        candidate.feeEventIds.includes(feeId)
    )
    if (otherClaims.length > 0) {
      defects.push(`fee ${feeId} is claimed by multiple non-void host invoices`)
    }
    itemizedSubtotalCents += fee.feeCents
  }

  if (itemizedSubtotalCents !== invoice.subtotalCents) {
    defects.push(
      `host invoice ${invoice.id} subtotal ${invoice.subtotalCents} does not equal itemized fees ${itemizedSubtotalCents}`
    )
  }
}

for (const [providerInvoiceId, claims] of providerInvoiceClaims) {
  if (claims.length > 1) {
    defects.push(`Stripe invoice ${providerInvoiceId} is linked to ${claims.length} host invoices`)
  }
}

const billableFees = fees.filter((fee) => fee.status !== "voided")
const outstandingInvoices = invoices.filter((invoice) =>
  ["draft", "open", "uncollectible"].includes(invoice.status)
)
const cents = (amount) =>
  new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency"
  }).format(amount / 100)
const countBy = (values, key) =>
  Object.fromEntries(
    [...new Set(values.map((value) => value[key] ?? "missing"))]
      .sort()
      .map((value) => [
        value,
        values.filter((candidate) => (candidate[key] ?? "missing") === value)
          .length
      ])
  )

console.log(
  `Canonical state: schema=${row.schema_version} version=${row.version} updated=${row.updated_at}`
)
console.log(
  orgFilter
    ? `Scope: ${selectedOrganizationIds.size} matching organization(s)`
    : `Scope: all ${organizations.size} organizations (names and provider ids redacted)`
)
console.log(`Billing accounts: ${accounts.length} ${JSON.stringify(countBy(accounts, "billingModel"))}`)
console.log(`Current percentage agreements: ${currentAccounts.length}`)
console.log(`Assignments in scope: ${assignments.length}`)
console.log(
  `Platform fees: ${fees.length} ${JSON.stringify(countBy(fees, "status"))}; billable=${cents(
    billableFees.reduce((sum, fee) => sum + fee.feeCents, 0)
  )}`
)
console.log(
  `Host invoices: ${invoices.length} ${JSON.stringify(countBy(invoices, "status"))}; outstanding=${cents(
    outstandingInvoices.reduce(
      (sum, invoice) => sum + (invoice.subtotalCents ?? 0),
      0
    )
  )}`
)
console.log(
  `Historical commercial subscriptions: ${subscriptions.length}; provider-bound=${
    subscriptions.filter(
      (subscription) =>
        subscription.stripeCustomerId && subscription.stripeSubscriptionId
    ).length
  }`
)
console.log(`Historical Network usage events: ${usage.length}`)

if (defects.length > 0) {
  console.error(`RECONCILIATION REQUIRED: ${defects.length} billing defect(s).`)
  for (const defect of defects.slice(0, 25)) console.error(`- ${defect}`)
  if (defects.length > 25) console.error(`- ${defects.length - 25} more`)
  process.exitCode = 1
} else {
  console.log("OK: percentage accounts, movement claims, frozen fee basis, and reciprocal host invoices reconcile.")
}
