import {
  computePlatformFeeCents,
  platformFeeEventId,
  PLATFORM_FEE_BPS,
  type PlatformFeeEvent
} from "@logloads/contracts"
import { describe, expect, it } from "vitest"

import { auditStateSnapshot } from "./snapshot"
import { createInMemoryDatabase } from "./store"

const BILLING_COLLECTIONS = ["hostBillingProfiles", "platformFeeEvents", "hostInvoices"] as const

/** A fee that agrees with itself, built from rows the seed actually contains. */
function accrualForCompletedSeedLoad(state: ReturnType<typeof createInMemoryDatabase>): PlatformFeeEvent {
  const assignment = state.assignments.find((candidate) => candidate.status === "completed")
  const load = state.loadPostings.find((candidate) => candidate.id === assignment?.loadPostingId)

  if (!assignment || !load) {
    throw new Error("The seed no longer contains a completed assignment to bill")
  }

  const driverPayCents = load.driverPayCents ?? 52_500

  return {
    assignmentId: assignment.id,
    createdAt: assignment.completedAt ?? load.updatedAt,
    driverPayCents,
    feeBps: PLATFORM_FEE_BPS,
    feeCents: computePlatformFeeCents(driverPayCents, PLATFORM_FEE_BPS),
    id: platformFeeEventId(assignment.id),
    invoiceId: null,
    loadPostingId: load.id,
    occurredAt: assignment.completedAt ?? load.updatedAt,
    organizationId: load.companyId,
    status: "accrued",
    truckSlotId: assignment.truckSlotId,
    updatedAt: assignment.completedAt ?? load.updatedAt,
    voidReason: null
  }
}

describe("platform fee billing collections", () => {
  it("loads a canonical document written before billing existed", () => {
    // The document in production predates these three collections, and a row
    // validator puts a collection into REQUIRED_TABLES. Without the additive
    // backfill the first read after deploy refuses the whole document and every
    // request fails, so this is the deploy-safety test, not a formality.
    const { hostBillingProfiles, hostInvoices, platformFeeEvents, ...legacy } =
      createInMemoryDatabase()

    expect([hostBillingProfiles, platformFeeEvents, hostInvoices]).toHaveLength(3)

    const audit = auditStateSnapshot(legacy)

    expect(audit.missingCollections).toEqual([])
    expect(audit.state).not.toBeNull()

    for (const collection of BILLING_COLLECTIONS) {
      expect(audit.state?.[collection], collection).toEqual([])
    }
  })

  it("gives every host organization that posts loads a card on file", () => {
    // Derived from the postings rather than listing organization ids, so a new
    // seeded host cannot quietly arrive without the payment method that publishing
    // requires.
    const state = createInMemoryDatabase()
    const hostOrganizationIds = new Set(state.loadPostings.map((load) => load.companyId))

    expect(hostOrganizationIds.size).toBe(2)

    for (const organizationId of hostOrganizationIds) {
      const profile = state.hostBillingProfiles.find(
        (candidate) => candidate.organizationId === organizationId
      )

      expect(profile?.status, organizationId).toBe("attached")
      expect(profile?.defaultPaymentMethodId, organizationId).toBeTruthy()
    }
  })

  it("ships an empty fee ledger, because no host has ever been charged", () => {
    const state = createInMemoryDatabase()

    expect(state.platformFeeEvents).toEqual([])
    expect(state.hostInvoices).toEqual([])
  })

  it("stores only card details a host could not be defrauded with", () => {
    const state = createInMemoryDatabase()

    for (const profile of state.hostBillingProfiles) {
      expect(profile.paymentMethodLast4).toMatch(/^\d{4}$/)
    }
  })

  it("validates a stored fee against the row contract, not against nothing", () => {
    // Proves the collection is wired to the fee-event validator: a fee whose amount
    // disagrees with the pay and rate frozen beside it is held out of runtime state
    // and reported, rather than read as a bill.
    const state = createInMemoryDatabase()
    const accrual = accrualForCompletedSeedLoad(state)

    state.platformFeeEvents = [accrual]
    expect(auditStateSnapshot(state).state?.platformFeeEvents).toEqual([accrual])

    state.platformFeeEvents = [{ ...accrual, feeCents: accrual.feeCents + 1 }]

    const audit = auditStateSnapshot(state)

    expect(audit.state?.platformFeeEvents).toEqual([])
    expect(audit.withheldRows.platformFeeEvents).toHaveLength(1)
    expect(audit.defects.map((defect) => defect.kind)).toContain("invalid_row")
  })

  it("reports a fee that names a load or assignment the document does not have", () => {
    const state = createInMemoryDatabase()
    const accrual = accrualForCompletedSeedLoad(state)

    state.platformFeeEvents = [
      { ...accrual, assignmentId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa" }
    ]

    const audit = auditStateSnapshot(state)
    const dangling = audit.defects.filter((defect) => defect.kind === "missing_reference")

    expect(dangling.map((defect) => defect.detail).join(" ")).toContain("assignmentId")
    // Reported, never withheld: dropping the fee would hide a charge instead of
    // repairing it.
    expect(audit.state?.platformFeeEvents).toHaveLength(1)
  })
})
