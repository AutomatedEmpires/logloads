import { describe, expect, it } from "vitest"

import {
  subscriptionBaseInvoiceId,
  subscriptionBaseInvoiceSchema,
  type BillingAdjustment,
  type Organization
} from "@logloads/contracts"

import {
  buildBillingCsv,
  type BillingExportSource
} from "./billing-export"

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_ORGANIZATION_ID = "20202020-2020-4020-8020-202020202020"

function adjustment(
  organizationId: string,
  reason: string
): BillingAdjustment {
  return {
    actorUserId: "33333333-3333-4333-8333-333333333333",
    amountDeltaCents: -1_500,
    billingPeriodSummaryId: "44444444-4444-4444-8444-444444444444",
    createdAt: "2026-08-01T12:00:00.000Z",
    id:
      organizationId === ORGANIZATION_ID
        ? "55555555-5555-4555-8555-555555555555"
        : "66666666-6666-4666-8666-666666666666",
    invoiceId: null,
    minimumChargeWriteoffCents: 0,
    organizationId,
    providerReference: null,
    providerRevenueDeltaCents: 0,
    providerSettlementAmountCents: null,
    providerSettlementAttemptCount: 0,
    providerSettlementFailure: null,
    providerSettlementLastAttemptAt: null,
    providerSettlementRemainingCents: null,
    providerSettlementSettledAt: null,
    providerSettlementState: "not_started",
    reason,
    settlementIntent: "unapplied",
    type: "service_credit",
    unitDelta: 0,
    usageEventId: null
  }
}

function organization(id: string, displayName: string): Organization {
  return { displayName, id } as Organization
}

function source(): BillingExportSource {
  return {
    billingAdjustments: [
      adjustment(ORGANIZATION_ID, '=HYPERLINK("https://invalid.example")'),
      adjustment(OTHER_ORGANIZATION_ID, "Other organization")
    ],
    billingPeriodSummaries: [],
    hostInvoices: [],
    networkOverageInvoices: [],
    networkUsageEvents: [],
    organizationSubscriptions: [],
    organizations: [
      organization(ORGANIZATION_ID, "North Timber"),
      organization(OTHER_ORGANIZATION_ID, "South Timber")
    ],
    platformFeeEvents: [],
    subscriptionBaseInvoices: []
  }
}

describe("billing CSV export", () => {
  it("returns a stable header even when no billing records exist", () => {
    const csv = buildBillingCsv({
      ...source(),
      billingAdjustments: []
    })

    expect(csv).toMatch(/^record_type,organization_id,organization_name,/)
    expect(csv).toContain("amount_remaining_cents")
    expect(csv.endsWith("\r\n")).toBe(true)
  })

  it("filters by organization and neutralizes spreadsheet formulas", () => {
    const csv = buildBillingCsv(source(), ORGANIZATION_ID)

    expect(csv).toContain('"North Timber"')
    expect(csv).not.toContain("South Timber")
    expect(csv).toContain(`"'=HYPERLINK(""https://invalid.example"")"`)
  })

  it("exports the provider-confirmed base amount and exact remaining balance", () => {
    const subscriptionId = "77777777-7777-4777-8777-777777777777"
    const providerInvoiceId = "in_base001"
    const csv = buildBillingCsv({
      ...source(),
      subscriptionBaseInvoices: [
        subscriptionBaseInvoiceSchema.parse({
          amountDueCents: 300_000,
          amountRemainingCents: 125_000,
          attemptCount: 2,
          attemptedAt: "2026-08-01T12:00:00.000Z",
          createdAt: "2026-08-01T12:00:00.000Z",
          currency: "usd",
          id: subscriptionBaseInvoiceId(
            subscriptionId,
            providerInvoiceId
          ),
          internalBillingTest: false,
          organizationId: ORGANIZATION_ID,
          planCode: "network_25",
          providerInvoiceId,
          status: "open",
          subscriptionId,
          updatedAt: "2026-08-01T12:05:00.000Z"
        })
      ]
    })

    expect(csv).toContain('"subscription_base_invoice"')
    expect(csv).toContain(",300000,125000,")
    expect(csv).toContain(`"${providerInvoiceId}"`)
  })
})
