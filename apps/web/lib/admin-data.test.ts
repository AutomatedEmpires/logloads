import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  computePlatformFeeCents,
  HOST_FEE_TERMS_VERSION,
  hostFeeAgreementId,
  hostFeeAgreementSchema,
  hostInvoiceSchema,
  organizationSchema,
  PLATFORM_FEE_BPS,
  platformFeeEventId,
  platformFeeEventSchema,
  type HostFeeAgreement,
  type HostInvoice,
  type PlatformFeeEvent
} from "@logloads/contracts"

import { buildAdminBillingSnapshot, type AdminBillingSource } from "./admin-data"

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111"
const ACCEPTED_BY = "20202020-2020-4020-8020-202020202020"
const AT = "2026-08-10T12:00:00.000Z"
const OPEN_INVOICE_ID = "70000000-0000-4000-8000-000000000001"
const PAID_INVOICE_ID = "70000000-0000-4000-8000-000000000002"

function organization() {
  return organizationSchema.parse({
    archivedAt: null,
    createdAt: AT,
    displayName: "Timberline Hauling",
    id: ORGANIZATION_ID,
    legalName: "Timberline Hauling LLC",
    primaryRegion: "Pacific Northwest",
    slug: "timberline-hauling",
    type: "carrier",
    updatedAt: AT,
    verificationStatus: "verified"
  })
}

function agreement(overrides: Partial<HostFeeAgreement> = {}): HostFeeAgreement {
  return hostFeeAgreementSchema.parse({
    acceptedAt: AT,
    acceptedByUserId: ACCEPTED_BY,
    createdAt: AT,
    feeBps: PLATFORM_FEE_BPS,
    id: hostFeeAgreementId(ORGANIZATION_ID),
    organizationId: ORGANIZATION_ID,
    termsVersion: HOST_FEE_TERMS_VERSION,
    updatedAt: AT,
    ...overrides
  })
}

function fee(
  movementId: string,
  driverPayCents: number,
  invoiceId: string | null,
  status: PlatformFeeEvent["status"] = invoiceId ? "invoiced" : "accrued"
): PlatformFeeEvent {
  return platformFeeEventSchema.parse({
    assignmentId: movementId,
    createdAt: AT,
    driverPayCents,
    feeBps: PLATFORM_FEE_BPS,
    feeCents: computePlatformFeeCents(driverPayCents, PLATFORM_FEE_BPS),
    id: platformFeeEventId(movementId),
    invoiceId: status === "accrued" ? null : invoiceId,
    loadMovementId: movementId,
    loadPostingId: "40000000-0000-4000-8000-000000000001",
    occurredAt: AT,
    organizationId: ORGANIZATION_ID,
    status,
    truckSlotId: "50000000-0000-4000-8000-000000000001",
    updatedAt: AT,
    voidReason: status === "voided" ? "Load cancelled after completion was recorded" : null
  })
}

function invoice(
  id: string,
  fees: readonly PlatformFeeEvent[],
  status: HostInvoice["status"]
): HostInvoice {
  return hostInvoiceSchema.parse({
    createdAt: AT,
    feeEventIds: fees.map((candidate) => candidate.id),
    id,
    issuedAt: AT,
    organizationId: ORGANIZATION_ID,
    paidAt: status === "paid" ? AT : null,
    periodEnd: "2026-08-01T00:00:00.000Z",
    periodStart: "2026-07-01T00:00:00.000Z",
    status,
    stripeInvoiceId: status === "paid" ? "in_paid" : null,
    subtotalCents: fees
      .filter((candidate) => candidate.status !== "voided")
      .reduce((total, candidate) => total + candidate.feeCents, 0),
    updatedAt: AT,
    voidedAt: null
  })
}

function source(overrides: Partial<AdminBillingSource> = {}): AdminBillingSource {
  return {
    assignments: [],
    hostFeeAgreements: [],
    hostInvoices: [],
    organizations: [organization()],
    platformFeeEvents: [],
    ...overrides
  }
}

describe("admin host fee ledger", () => {
  it("reports an empty ledger as zero, not as revenue or failure", () => {
    expect(buildAdminBillingSnapshot(source())).toEqual({
      acceptedAgreementCount: 0,
      accruedFeeLabel: "$0.00",
      committedAssignmentCount: 0,
      exceptions: [],
      feeEventCount: 0,
      invoiceCount: 0,
      outstandingInvoiceLabel: "$0.00"
    })
  })

  it("counts only agreements on the current fee terms", () => {
    const snapshot = buildAdminBillingSnapshot(
      source({
        hostFeeAgreements: [
          agreement(),
          agreement({
            id: hostFeeAgreementId("12121212-1212-4212-8212-121212121212"),
            organizationId: "12121212-1212-4212-8212-121212121212",
            termsVersion: "2026-01-01"
          })
        ]
      })
    )

    expect(snapshot.acceptedAgreementCount).toBe(1)
  })

  it("separates accrued, outstanding, and paid fees at 2% of driver pay", () => {
    // $500.00 of driver pay is a $10.00 fee; $300.00 is $6.00; $200.00 is $4.00.
    const accrued = fee("80000000-0000-4000-8000-000000000001", 50_000, null)
    const outstanding = fee("80000000-0000-4000-8000-000000000002", 30_000, OPEN_INVOICE_ID)
    const paid = fee("80000000-0000-4000-8000-000000000003", 20_000, PAID_INVOICE_ID)
    const voided = fee("80000000-0000-4000-8000-000000000004", 40_000, OPEN_INVOICE_ID, "voided")
    const snapshot = buildAdminBillingSnapshot(
      source({
        hostInvoices: [
          invoice(OPEN_INVOICE_ID, [outstanding, voided], "open"),
          invoice(PAID_INVOICE_ID, [paid], "paid")
        ],
        platformFeeEvents: [accrued, outstanding, paid, voided]
      })
    )

    expect(accrued.feeCents).toBe(1_000)
    expect(snapshot).toMatchObject({
      accruedFeeLabel: "$10.00",
      exceptions: [],
      feeEventCount: 3,
      invoiceCount: 2,
      outstandingInvoiceLabel: "$6.00"
    })
  })
})
