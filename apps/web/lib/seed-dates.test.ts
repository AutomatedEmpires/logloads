import { describe, expect, it } from "vitest"

import { hostInvoiceSchema } from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"

import { shiftSeedDates } from "./seed-dates"

describe("shiftSeedDates", () => {
  it("moves operational demo dates without rewriting fee agreements or bills", () => {
    const state = createInMemoryDatabase()
    const invoicePeriodStart = "2026-07-01T00:00:00.000Z"
    const invoicePeriodEnd = "2026-08-01T00:00:00.000Z"
    const invoice = hostInvoiceSchema.parse({
      createdAt: invoicePeriodEnd,
      feeEventIds: [],
      id: "70707070-7070-4070-8070-707070707070",
      issuedAt: invoicePeriodEnd,
      organizationId: "33333333-3333-4333-8333-333333333332",
      paidAt: null,
      periodEnd: invoicePeriodEnd,
      periodStart: invoicePeriodStart,
      status: "open",
      stripeInvoiceId: null,
      subtotalCents: 1_050,
      updatedAt: invoicePeriodEnd,
      voidedAt: null
    })

    state.hostInvoices.push(invoice)
    const originalAuditCreatedAt = state.auditEvents[0]?.createdAt
    const originalLoadCreatedAt = state.loadPostings[0]?.createdAt
    const summitAgreement = state.hostFeeAgreements.find(
      (agreement) => agreement.organizationId === "33333333-3333-4333-8333-333333333332"
    )

    expect(originalAuditCreatedAt).toBeDefined()
    expect(summitAgreement).toBeDefined()

    const shifted = shiftSeedDates(state, Date.parse("2026-10-14T12:00:00.000Z"))
    const shiftedAgreement = shifted.hostFeeAgreements.find(
      (agreement) => agreement.organizationId === "33333333-3333-4333-8333-333333333332"
    )

    // Negative control: operational demo data does move.
    expect(shifted.loadPostings[0]?.createdAt).not.toBe(originalLoadCreatedAt)
    expect(shiftedAgreement).toEqual(summitAgreement)
    expect(shifted.hostInvoices[0]?.issuedAt).toBe(invoicePeriodEnd)
    expect(shifted.hostInvoices[0]?.periodStart).toBe(invoicePeriodStart)
    expect(shifted.auditEvents[0]?.createdAt).toBe(originalAuditCreatedAt)
  })
})
