import type { HostInvoice, Organization, PlatformFeeEvent } from "@logloads/contracts"

export interface BillingExportSource {
  hostInvoices: readonly HostInvoice[]
  organizations: readonly Organization[]
  platformFeeEvents: readonly PlatformFeeEvent[]
}

const COLUMNS = [
  "record_type",
  "organization_id",
  "organization_name",
  "record_id",
  "assignment_id",
  "load_movement_id",
  "period_start",
  "period_end",
  "occurred_at",
  "status",
  "driver_pay_cents",
  "fee_bps",
  "amount_cents",
  "local_invoice_id",
  "provider_reference",
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

function feeRow(source: BillingExportSource, event: PlatformFeeEvent): ExportRow {
  return {
    ...emptyRow(),
    amount_cents: event.feeCents,
    assignment_id: event.assignmentId,
    driver_pay_cents: event.driverPayCents,
    fee_bps: event.feeBps,
    load_movement_id: event.loadMovementId,
    local_invoice_id: event.invoiceId ?? null,
    occurred_at: event.occurredAt,
    organization_id: event.organizationId,
    organization_name: organizationName(source, event.organizationId),
    reason: event.voidReason ?? null,
    record_id: event.id,
    record_type: "host_fee",
    status: event.status
  }
}

function invoiceRow(source: BillingExportSource, invoice: HostInvoice): ExportRow {
  return {
    ...emptyRow(),
    amount_cents: invoice.subtotalCents,
    local_invoice_id: invoice.id,
    organization_id: invoice.organizationId,
    organization_name: organizationName(source, invoice.organizationId),
    period_end: invoice.periodEnd,
    period_start: invoice.periodStart,
    provider_reference: invoice.stripeInvoiceId ?? null,
    record_id: invoice.id,
    record_type: "host_invoice",
    status: invoice.status
  }
}

/** Every host fee and monthly invoice, one CSV row each, optionally for one host. */
export function buildBillingCsv(
  source: BillingExportSource,
  organizationId?: string
): string {
  const included = (candidateOrganizationId: string): boolean =>
    !organizationId || candidateOrganizationId === organizationId
  const rows: ExportRow[] = [
    ...source.platformFeeEvents
      .filter((event) => included(event.organizationId))
      .map((event) => feeRow(source, event)),
    ...source.hostInvoices
      .filter((invoice) => included(invoice.organizationId))
      .map((invoice) => invoiceRow(source, invoice))
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
