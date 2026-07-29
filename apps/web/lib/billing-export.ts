import type {
  BillingAdjustment,
  BillingPeriodSummary,
  HostInvoice,
  NetworkOverageInvoice,
  NetworkUsageEvent,
  Organization,
  OrganizationSubscription,
  PlatformFeeEvent,
  SubscriptionBaseInvoice
} from "@logloads/contracts"

export interface BillingExportSource {
  billingAdjustments: readonly BillingAdjustment[]
  billingPeriodSummaries: readonly BillingPeriodSummary[]
  hostInvoices: readonly HostInvoice[]
  networkOverageInvoices: readonly NetworkOverageInvoice[]
  networkUsageEvents: readonly NetworkUsageEvent[]
  organizationSubscriptions: readonly OrganizationSubscription[]
  organizations: readonly Organization[]
  platformFeeEvents: readonly PlatformFeeEvent[]
  subscriptionBaseInvoices: readonly SubscriptionBaseInvoice[]
}

const COLUMNS = [
  "record_type",
  "organization_id",
  "organization_name",
  "subscription_id",
  "plan_code",
  "period_start",
  "period_end",
  "record_id",
  "assignment_id",
  "load_movement_id",
  "occurred_at",
  "status",
  "unit_count",
  "included_units",
  "used_units",
  "overage_units",
  "unit_amount_cents",
  "amount_cents",
  "amount_remaining_cents",
  "local_invoice_id",
  "provider_reference",
  "provider_state",
  "provider_amount_due_cents",
  "provider_amount_paid_cents",
  "provider_amount_remaining_cents",
  "adjustment_type",
  "reason"
] as const

type Column = (typeof COLUMNS)[number]
type ExportRow = Record<Column, number | string | null>

function csvCell(value: number | string | null): string {
  if (value === null) {
    return ""
  }

  if (typeof value === "number") {
    return String(value)
  }

  // Spreadsheet programs treat these prefixes as formulas even inside a CSV.
  // The export is an operating artifact, not an execution channel.
  const safe = /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value

  return `"${safe.replaceAll('"', '""')}"`
}

function emptyRow(): ExportRow {
  return Object.fromEntries(COLUMNS.map((column) => [column, null])) as ExportRow
}

function organizationName(
  source: BillingExportSource,
  organizationId: string
): string {
  return (
    source.organizations.find((organization) => organization.id === organizationId)
      ?.displayName ?? "Unknown organization"
  )
}

function summaryRow(
  source: BillingExportSource,
  summary: BillingPeriodSummary
): ExportRow {
  return {
    ...emptyRow(),
    amount_cents: summary.overageAmountCents,
    included_units: summary.includedUnits,
    organization_id: summary.organizationId,
    organization_name: organizationName(source, summary.organizationId),
    overage_units: summary.overageUnits,
    period_end: summary.periodEnd,
    period_start: summary.periodStart,
    plan_code: summary.planCode,
    record_id: summary.id,
    record_type: "period_summary",
    status: summary.status,
    subscription_id: summary.subscriptionId,
    unit_amount_cents: summary.overageUnitPriceCents,
    used_units: summary.usedUnits
  }
}

function usageRow(
  source: BillingExportSource,
  event: NetworkUsageEvent
): ExportRow {
  const summary = source.billingPeriodSummaries.find(
    (candidate) => candidate.id === event.billingPeriodSummaryId
  )
  const invoice = event.invoiceId
    ? source.networkOverageInvoices.find(
        (candidate) => candidate.id === event.invoiceId
      )
    : undefined

  return {
    ...emptyRow(),
    assignment_id: event.assignmentId,
    load_movement_id: event.loadMovementId,
    local_invoice_id: event.invoiceId ?? null,
    occurred_at: event.completionAt,
    organization_id: event.organizationId,
    organization_name: organizationName(source, event.organizationId),
    period_end: summary?.periodEnd ?? null,
    period_start: summary?.periodStart ?? null,
    plan_code: event.planCode,
    provider_reference: invoice?.stripeInvoiceId ?? null,
    record_id: event.id,
    record_type: "network_usage",
    status: event.status,
    subscription_id: summary?.subscriptionId ?? null,
    unit_count: event.unitCount
  }
}

function overageInvoiceRow(
  source: BillingExportSource,
  invoice: NetworkOverageInvoice
): ExportRow {
  const summary = source.billingPeriodSummaries.find(
    (candidate) => candidate.id === invoice.billingPeriodSummaryId
  )

  return {
    ...emptyRow(),
    amount_cents: invoice.amountDueCents,
    amount_remaining_cents:
      invoice.providerAmountRemainingCents,
    local_invoice_id: invoice.id,
    organization_id: invoice.organizationId,
    organization_name: organizationName(source, invoice.organizationId),
    overage_units: invoice.quantity,
    period_end: invoice.periodEnd,
    period_start: invoice.periodStart,
    plan_code: invoice.planCode,
    provider_reference: invoice.stripeInvoiceId ?? null,
    provider_amount_due_cents: invoice.providerAmountDueCents,
    provider_amount_paid_cents: invoice.providerAmountPaidCents,
    provider_amount_remaining_cents:
      invoice.providerAmountRemainingCents,
    provider_state: invoice.stripeInvoiceId ? invoice.status : null,
    record_id: invoice.id,
    record_type: invoice.sequence === 1 ? "overage_invoice" : "supplemental_invoice",
    status: invoice.status,
    subscription_id: summary?.subscriptionId ?? null,
    unit_amount_cents: invoice.unitAmountCents,
    unit_count: invoice.quantity
  }
}

function baseInvoiceRow(
  source: BillingExportSource,
  invoice: SubscriptionBaseInvoice
): ExportRow {
  return {
    ...emptyRow(),
    amount_cents: invoice.amountDueCents,
    amount_remaining_cents: invoice.amountRemainingCents,
    local_invoice_id: invoice.id,
    occurred_at: invoice.attemptedAt ?? invoice.createdAt,
    organization_id: invoice.organizationId,
    organization_name: organizationName(source, invoice.organizationId),
    plan_code: invoice.planCode,
    provider_amount_due_cents: invoice.amountDueCents,
    provider_amount_paid_cents:
      invoice.amountDueCents - invoice.amountRemainingCents,
    provider_amount_remaining_cents: invoice.amountRemainingCents,
    provider_reference: invoice.providerInvoiceId,
    provider_state: invoice.status,
    record_id: invoice.id,
    record_type: "subscription_base_invoice",
    status: invoice.status,
    subscription_id: invoice.subscriptionId
  }
}

function adjustmentRow(
  source: BillingExportSource,
  adjustment: BillingAdjustment
): ExportRow {
  const summary = source.billingPeriodSummaries.find(
    (candidate) => candidate.id === adjustment.billingPeriodSummaryId
  )

  return {
    ...emptyRow(),
    adjustment_type: adjustment.type,
    amount_cents: adjustment.amountDeltaCents,
    amount_remaining_cents:
      adjustment.providerSettlementRemainingCents,
    local_invoice_id: adjustment.invoiceId,
    occurred_at: adjustment.createdAt,
    organization_id: adjustment.organizationId,
    organization_name: organizationName(source, adjustment.organizationId),
    plan_code: summary?.planCode ?? null,
    provider_reference: adjustment.providerReference,
    provider_state: adjustment.providerSettlementState,
    reason: adjustment.reason,
    record_id: adjustment.id,
    record_type: "billing_adjustment",
    status: adjustment.providerSettlementState,
    subscription_id: summary?.subscriptionId ?? null,
    unit_count: adjustment.unitDelta
  }
}

function legacyFeeRow(
  source: BillingExportSource,
  event: PlatformFeeEvent
): ExportRow {
  return {
    ...emptyRow(),
    amount_cents: event.feeCents,
    assignment_id: event.assignmentId,
    local_invoice_id: event.invoiceId ?? null,
    occurred_at: event.occurredAt,
    organization_id: event.organizationId,
    organization_name: organizationName(source, event.organizationId),
    plan_code: "legacy_percentage",
    reason: event.voidReason ?? null,
    record_id: event.id,
    record_type: "legacy_percentage_fee",
    status: event.status,
    unit_count: 1
  }
}

function legacyInvoiceRow(
  source: BillingExportSource,
  invoice: HostInvoice
): ExportRow {
  return {
    ...emptyRow(),
    amount_cents: invoice.subtotalCents,
    local_invoice_id: invoice.id,
    organization_id: invoice.organizationId,
    organization_name: organizationName(source, invoice.organizationId),
    period_end: invoice.periodEnd,
    period_start: invoice.periodStart,
    plan_code: "legacy_percentage",
    provider_reference: invoice.stripeInvoiceId ?? null,
    record_id: invoice.id,
    record_type: "legacy_percentage_invoice",
    status: invoice.status
  }
}

export function buildBillingCsv(
  source: BillingExportSource,
  organizationId?: string
): string {
  const included = (candidateOrganizationId: string): boolean =>
    !organizationId || candidateOrganizationId === organizationId
  const rows: ExportRow[] = [
    ...source.billingPeriodSummaries
      .filter((summary) => included(summary.organizationId))
      .map((summary) => summaryRow(source, summary)),
    ...source.networkUsageEvents
      .filter((event) => included(event.organizationId))
      .map((event) => usageRow(source, event)),
    ...source.networkOverageInvoices
      .filter((invoice) => included(invoice.organizationId))
      .map((invoice) => overageInvoiceRow(source, invoice)),
    ...source.subscriptionBaseInvoices
      .filter((invoice) => included(invoice.organizationId))
      .map((invoice) => baseInvoiceRow(source, invoice)),
    ...source.billingAdjustments
      .filter((adjustment) => included(adjustment.organizationId))
      .map((adjustment) => adjustmentRow(source, adjustment)),
    ...source.platformFeeEvents
      .filter((event) => included(event.organizationId))
      .map((event) => legacyFeeRow(source, event)),
    ...source.hostInvoices
      .filter((invoice) => included(invoice.organizationId))
      .map((invoice) => legacyInvoiceRow(source, invoice))
  ].sort(
    (left, right) =>
      String(left.organization_id).localeCompare(String(right.organization_id)) ||
      String(left.period_start ?? left.occurred_at ?? "").localeCompare(
        String(right.period_start ?? right.occurred_at ?? "")
      ) ||
      String(left.record_type).localeCompare(String(right.record_type)) ||
      String(left.record_id).localeCompare(String(right.record_id))
  )
  const lines = [
    COLUMNS.join(","),
    ...rows.map((row) => COLUMNS.map((column) => csvCell(row[column])).join(","))
  ]

  return `${lines.join("\r\n")}\r\n`
}
