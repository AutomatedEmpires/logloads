import { describe, expect, it } from "vitest"

import {
  computePlatformFeeCents,
  platformFeeEventId,
  PLATFORM_FEE_BPS,
  type HostInvoice,
  type Organization,
  type PlatformFeeEvent
} from "@logloads/contracts"

import { buildBillingCsv, type BillingExportSource } from "./billing-export"

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_ORGANIZATION_ID = "20202020-2020-4020-8020-202020202020"
const MOVEMENT_ID = "30303030-3030-4030-8030-303030303030"
const INVOICE_ID = "40404040-4040-4040-8040-404040404040"

function fee(organizationId: string, voidReason: string | null = null): PlatformFeeEvent {
  return {
    assignmentId: "50505050-5050-4050-8050-505050505050",
    createdAt: "2026-07-10T12:00:00.000Z",
    driverPayCents: 50_000,
    feeBps: PLATFORM_FEE_BPS,
    feeCents: computePlatformFeeCents(50_000, PLATFORM_FEE_BPS),
    id: organizationId === ORGANIZATION_ID
      ? platformFeeEventId(MOVEMENT_ID)
      : "60606060-6060-4060-8060-606060606060",
    invoiceId: voidReason ? null : INVOICE_ID,
    loadMovementId: MOVEMENT_ID,
    loadPostingId: "70707070-7070-4070-8070-707070707070",
    occurredAt: "2026-07-10T12:00:00.000Z",
    organizationId,
    status: voidReason ? "voided" : "invoiced",
    truckSlotId: "80808080-8080-4080-8080-808080808080",
    updatedAt: "2026-07-10T12:00:00.000Z",
    voidReason
  }
}

function invoice(): HostInvoice {
  return {
    createdAt: "2026-08-01T06:00:00.000Z",
    feeEventIds: [platformFeeEventId(MOVEMENT_ID)],
    id: INVOICE_ID,
    issuedAt: "2026-08-01T06:00:00.000Z",
    organizationId: ORGANIZATION_ID,
    paidAt: null,
    periodEnd: "2026-08-01T00:00:00.000Z",
    periodStart: "2026-07-01T00:00:00.000Z",
    status: "open",
    stripeInvoiceId: "in_host001",
    subtotalCents: 1_000,
    updatedAt: "2026-08-01T06:00:00.000Z",
    voidedAt: null
  }
}

function organization(id: string, displayName: string): Organization {
  return { displayName, id } as Organization
}

function source(): BillingExportSource {
  return {
    hostInvoices: [invoice()],
    organizations: [
      organization(ORGANIZATION_ID, "North Timber"),
      organization(OTHER_ORGANIZATION_ID, "South Timber")
    ],
    platformFeeEvents: [
      fee(ORGANIZATION_ID),
      fee(OTHER_ORGANIZATION_ID, '=HYPERLINK("https://invalid.example")')
    ]
  }
}

describe("billing CSV export", () => {
  it("returns a stable header even when no billing records exist", () => {
    const csv = buildBillingCsv({ ...source(), hostInvoices: [], platformFeeEvents: [] })

    expect(csv).toBe(
      "record_type,organization_id,organization_name,record_id,assignment_id,load_movement_id,period_start,period_end,occurred_at,status,driver_pay_cents,fee_bps,amount_cents,local_invoice_id,provider_reference,reason\r\n"
    )
  })

  it("exports each fee with its frozen pay and rate, and each invoice with its provider reference", () => {
    const csv = buildBillingCsv(source(), ORGANIZATION_ID)

    expect(csv).toContain(`"host_fee","${ORGANIZATION_ID}","North Timber"`)
    expect(csv).toContain(`,50000,${PLATFORM_FEE_BPS},1000,"${INVOICE_ID}"`)
    expect(csv).toContain(`"host_invoice","${ORGANIZATION_ID}","North Timber","${INVOICE_ID}"`)
    expect(csv).toContain('"in_host001"')
  })

  it("filters by organization and neutralizes spreadsheet formulas", () => {
    expect(buildBillingCsv(source(), ORGANIZATION_ID)).not.toContain("South Timber")

    const other = buildBillingCsv(source(), OTHER_ORGANIZATION_ID)

    expect(other).toContain('"South Timber"')
    expect(other).toContain(`"'=HYPERLINK(""https://invalid.example"")"`)
  })
})
