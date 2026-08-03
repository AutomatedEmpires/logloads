import { randomUUID } from "node:crypto"

import {
  computePlatformFeeCents,
  organizationMembershipSchema,
  organizationRoleCan,
  percentageFeeEventId,
  PLATFORM_FEE_BPS
} from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices } from "./index"
import { reconcileMissingPlatformFees } from "./platform-fees"

/**
 * A fee is earned when the host authoritatively confirms the completed movement.
 * Off-platform driver-payment evidence remains a separate later workflow.
 *
 * These tests assert that production wiring, not only the fee arithmetic.
 */
function settleableHaul() {
  const services = createLogLoadsServices(createInMemoryDatabase())
  const state = services.state
  const trip = state.tripsV2.find((candidate) => candidate.completionStatus === "submitted")
    ?? state.tripsV2.find((candidate) => candidate.status !== "cancelled")

  if (!trip) throw new Error("the seed carries no trip that could be settled")

  const assignment = state.assignments.find((candidate) => candidate.id === trip.assignmentId)
  const load = state.loadPostings.find((candidate) => candidate.id === trip.loadPostingId)
  const driver = state.driverProfiles.find((candidate) => candidate.id === trip.driverProfileId)

  if (!assignment || !load || !driver) {
    throw new Error("the seeded trip is not attached to an assignment, load, and driver")
  }

  const hostOperator = state.organizationMemberships.find(
    (candidate) =>
      candidate.organizationId === load.companyId &&
      candidate.status === "active" &&
      organizationRoleCan(candidate.role, "assign_capacity")
  )
  let driverMembership = state.organizationMemberships.find(
    (candidate) =>
      candidate.userId === driver.userId &&
      candidate.status === "active"
  )

  if (!hostOperator) {
    throw new Error("the payment fixture needs a host operating member")
  }
  hostOperator.role = "owner"

  if (!driverMembership) {
    driverMembership = organizationMembershipSchema.parse({
      createdAt: "2026-06-01T00:00:00.000Z",
      id: randomUUID(),
      organizationId: driver.companyId,
      role: "driver",
      status: "active",
      updatedAt: "2026-06-01T00:00:00.000Z",
      userId: driver.userId
    })
    state.organizationMemberships.push(driverMembership)
  }
  driverMembership.role = "driver"

  return {
    assignment,
    driver,
    driverMembership,
    hostBilling: hostOperator,
    hostOperator,
    load,
    services,
    trip
  }
}

function forceSettleableState(
  fixture: ReturnType<typeof settleableHaul>,
  driverPayCents: number | null
) {
  const { assignment, driver, load, services, trip } = fixture
  const live = services.state.tripsV2.find((candidate) => candidate.id === trip.id)!
  const posting = services.state.loadPostings.find((candidate) => candidate.id === load.id)!
  const held = services.state.assignments.find((candidate) => candidate.id === assignment.id)!

  live.completionStatus = "submitted"
  live.completionSubmittedByUserId = driver.userId
  live.completionConfirmedAt = null
  live.completedAt = "2026-06-20T14:55:00.000Z"
  live.deliveredQuantity = {
    ticketNumber: "E2E-FEE-DELIVERY",
    unit: "tons",
    value: 26.4
  }
  live.haulException = null
  live.status = "completed"
  held.status = "completed"
  held.completedAt = live.completedAt
  held.billingModel = "percentage_v1"
  held.driverPaymentSentAt = null
  held.driverPaymentSentByUserId = null
  held.driverPaymentReceivedAt = null
  held.driverPaymentReceivedAmountCents = null
  held.driverPaymentReceivedByUserId = null
  held.driverPaymentReceivedCurrency = null
  held.termsSnapshot = {
    ...held.termsSnapshot,
    currency: "USD",
    driverPayCents,
    hostFee: {
      collectionState: "accrues_monthly_in_arrears",
      feeCents: null,
      providerCollectionState: "feature_gated",
      proposedRateBps: PLATFORM_FEE_BPS,
      rateBps: PLATFORM_FEE_BPS
    }
  }
  posting.driverPayCents = driverPayCents

  return { held, live, posting }
}

function confirmDelivery(fixture: ReturnType<typeof settleableHaul>) {
  return fixture.services.settleHaulCompletion({
    actorUserId: fixture.hostOperator.userId,
    decision: "confirm",
    organizationId: fixture.load.companyId,
    tripId: fixture.trip.id
  })
}

function markSent(fixture: ReturnType<typeof settleableHaul>) {
  return fixture.services.markDriverPaymentSent({
    actorUserId: fixture.hostBilling.userId,
    assignmentId: fixture.assignment.id,
    organizationId: fixture.load.companyId
  })
}

function confirmReceived(fixture: ReturnType<typeof settleableHaul>) {
  return fixture.services.confirmDriverPaymentReceived({
    actorUserId: fixture.driver.userId,
    amountCents: 52_500,
    assignmentId: fixture.assignment.id,
    currency: "USD",
    organizationId: fixture.driverMembership.organizationId
  })
}

describe("host completion confirmation raises the platform fee", () => {
  it("writes exactly one fee from frozen driver pay before any payment receipt", () => {
    const fixture = settleableHaul()
    const { posting } = forceSettleableState(fixture, 52_500)

    const completion = confirmDelivery(fixture)
    expect(completion.platformFeeOutcome).toBe("accrued")
    expect(fixture.services.state.platformFeeEvents).toHaveLength(1)

    markSent(fixture)
    expect(fixture.services.state.platformFeeEvents).toHaveLength(1)

    const receipt = confirmReceived(fixture)
    const events = fixture.services.state.platformFeeEvents

    expect(receipt.platformFeeOutcome).toBe("not_applicable")
    expect(events).toHaveLength(1)
    expect(events[0]!.assignmentId).toBe(fixture.assignment.id)
    expect(events[0]!.organizationId).toBe(posting.companyId)
    expect(events[0]!.status).toBe("accrued")
    expect(events[0]!.driverPayCents).toBe(52_500)
    expect(events[0]!.feeCents).toBe(computePlatformFeeCents(52_500, PLATFORM_FEE_BPS))
    expect(events[0]!.feeCents).toBe(2_625)
  })

  it("waits for physical completion when the host confirms at the destination", () => {
    const fixture = settleableHaul()
    const { held, live } = forceSettleableState(fixture, 52_500)
    live.completedAt = null
    live.status = "unloading"
    held.completedAt = null
    held.status = "hauled"

    for (const pack of fixture.services.state.routePacks) {
      if (
        pack.snapshot &&
        (
          pack.assignmentId === fixture.assignment.id ||
          (!pack.assignmentId && pack.loadPostingId === fixture.load.id)
        )
      ) {
        pack.snapshot.completionEvidence = []
      }
    }

    const confirmation = confirmDelivery(fixture)

    expect(confirmation.platformFeeOutcome).toBe("not_completed")
    expect(fixture.services.state.platformFeeEvents).toHaveLength(0)

    const completion = fixture.services.progressTripStatus({
      actorUserId: fixture.driver.userId,
      nextStatus: "completed",
      organizationId: fixture.driverMembership.organizationId,
      source: "driver",
      tripId: fixture.trip.id
    })

    expect(completion.trip.status).toBe("completed")
    expect(fixture.services.state.platformFeeEvents).toHaveLength(1)
    expect(fixture.services.state.platformFeeEvents[0]).toMatchObject({
      assignmentId: fixture.assignment.id,
      feeCents: 2_625,
      occurredAt: completion.trip.completedAt
    })
    expect(fixture.services.state.platformFeeEvents[0]!.occurredAt)
      .not.toBe(confirmation.trip.completionConfirmedAt)

    expect(
      fixture.services.progressTripStatus({
        actorUserId: fixture.driver.userId,
        nextStatus: "completed",
        organizationId: fixture.driverMembership.organizationId,
        source: "driver",
        tripId: fixture.trip.id
      }).changed
    ).toBe(false)
    expect(fixture.services.state.platformFeeEvents).toHaveLength(1)
  })

  it.each([
    "rejected_at_scale",
    "access_blocked",
    "equipment_failure",
    "weather_hold"
  ] as const)("confirms a %s zero-delivery record without accruing a fee", (exceptionType) => {
    const fixture = settleableHaul()
    const { live } = forceSettleableState(fixture, 52_500)
    live.deliveredQuantity = { unit: "tons", value: 0 }
    live.haulException = {
      note: "The movement closed without a physical delivery.",
      reportedAt: "2026-06-20T14:59:00.000Z",
      type: exceptionType
    }

    const completion = confirmDelivery(fixture)

    expect(completion.trip.completionStatus).toBe("confirmed")
    expect(completion.platformFeeOutcome).toBe("not_completed")
    expect(fixture.services.state.platformFeeEvents).toHaveLength(0)
  })

  it("is idempotent when completion and later receipt confirmation are retried", () => {
    const fixture = settleableHaul()
    forceSettleableState(fixture, 52_500)

    const first = confirmDelivery(fixture)
    const firstId = fixture.services.state.platformFeeEvents[0]!.id
    const second = fixture.services.accruePlatformFee({
      assignmentId: fixture.assignment.id
    })
    markSent(fixture)
    const firstReceipt = confirmReceived(fixture)
    const secondReceipt = confirmReceived(fixture)

    expect(first.platformFeeOutcome).toBe("accrued")
    expect(second.outcome).toBe("already_accrued")
    expect(firstReceipt.changed).toBe(true)
    expect(firstReceipt.platformFeeOutcome).toBe("not_applicable")
    expect(secondReceipt.changed).toBe(false)
    expect(secondReceipt.platformFeeOutcome).toBe("not_applicable")
    expect(fixture.services.state.platformFeeEvents).toHaveLength(1)
    expect(fixture.services.state.platformFeeEvents[0]!.id).toBe(firstId)
  })

  it("repairs a confirmed assignment whose fee basis was initially incomplete", () => {
    const fixture = settleableHaul()
    const { held } = forceSettleableState(fixture, 52_500)
    held.termsSnapshot = { ...held.termsSnapshot, driverPayCents: null }

    const completion = confirmDelivery(fixture)
    const completed = fixture.services.state.assignments.find(
      (candidate) => candidate.id === fixture.assignment.id
    )!

    expect(completion.platformFeeOutcome).toBe("no_basis")
    expect(completion.trip.completionStatus).toBe("confirmed")
    expect(fixture.services.state.platformFeeEvents).toHaveLength(0)

    completed.termsSnapshot = {
      ...completed.termsSnapshot,
      currency: "USD",
      driverPayCents: 52_500
    }

    const reconciled = reconcileMissingPlatformFees(
      fixture.services.state,
      "2026-07-01T06:00:00.000Z"
    )

    expect(reconciled).toEqual([
      {
        assignmentId: fixture.assignment.id,
        eventId: percentageFeeEventId(completed.loadMovementId ?? completed.id),
        outcome: "accrued",
        reason: null
      }
    ])
    expect(fixture.services.state.platformFeeEvents).toHaveLength(1)
    expect(fixture.services.state.platformFeeEvents[0]).toMatchObject({
      assignmentId: fixture.assignment.id,
      occurredAt: completion.trip.completionConfirmedAt
    })
    expect(reconcileMissingPlatformFees(fixture.services.state)).toEqual([])
  })

  it("preserves completion through billing exceptions and repairs deterministically", () => {
    const fixture = settleableHaul()
    const { held } = forceSettleableState(fixture, 52_500)
    const originalTruckSlotId = held.truckSlotId

    held.truckSlotId = "not-a-uuid"

    const first = confirmDelivery(fixture)
    const failures = fixture.services.state.auditEvents.filter(
      (event) => event.action === "platform_fee_accrual_failed"
    )
    const reconciled = reconcileMissingPlatformFees(
      fixture.services.state,
      "2026-07-01T06:00:00.000Z"
    )
    const reconciliationFailures = fixture.services.state.auditEvents.filter(
      (event) => event.action === "platform_fee_reconciliation_failed"
    )

    expect(first.trip.completionStatus).toBe("confirmed")
    expect(first.platformFeeOutcome).toBe("error")
    expect(failures).toHaveLength(1)
    expect(failures.every((event) => event.entityId === fixture.assignment.id)).toBe(true)
    expect(reconciled).toEqual([
      {
        assignmentId: fixture.assignment.id,
        eventId: null,
        outcome: "error",
        reason: expect.any(String)
      }
    ])
    expect(reconciliationFailures).toHaveLength(1)
    expect(reconciliationFailures[0]?.entityId).toBe(fixture.assignment.id)
    expect(fixture.services.state.platformFeeEvents).toHaveLength(0)

    held.truckSlotId = originalTruckSlotId
    expect(reconcileMissingPlatformFees(fixture.services.state)).toMatchObject([
      { assignmentId: fixture.assignment.id, outcome: "accrued" }
    ])
    expect(fixture.services.state.platformFeeEvents).toHaveLength(1)
  })

  it("uses the frozen currency when telling the driver what the host sent", () => {
    const fixture = settleableHaul()
    const { held } = forceSettleableState(fixture, 52_500)
    held.termsSnapshot = { ...held.termsSnapshot, currency: "CAD" }
    confirmDelivery(fixture)
    markSent(fixture)

    const notice = fixture.services.state.notifications
      .filter((notification) => notification.userId === fixture.driver.userId)
      .at(-1)

    expect(notice?.body).toContain("CA$525.00")
  })

  it("raises no fee when the host disputes the delivered record", () => {
    const fixture = settleableHaul()
    const { posting } = forceSettleableState(fixture, 52_500)

      fixture.services.settleHaulCompletion({
      actorUserId: fixture.hostOperator.userId,
      decision: "dispute",
      organizationId: posting.companyId,
      reason: "Short by four tons against the ticket",
      tripId: fixture.trip.id
    })

    expect(fixture.services.state.platformFeeEvents).toHaveLength(0)
    expect(() => markSent(fixture)).toThrow(/confirm the delivered record/i)
  })

  it("still settles a legacy haul whose frozen pay is missing", () => {
    const fixture = settleableHaul()
    const { held } = forceSettleableState(fixture, null)
    held.billingModel = "legacy_percentage"

    expect(confirmDelivery(fixture).trip.completionStatus).toBe("confirmed")
    expect(fixture.services.state.platformFeeEvents).toHaveLength(0)
    expect(() => markSent(fixture)).toThrow(/no frozen driver pay/i)
  })

  it("records the fee on completion and keeps the receipt audit independent", () => {
    const fixture = settleableHaul()
    forceSettleableState(fixture, 52_500)
    confirmDelivery(fixture)
    markSent(fixture)
    confirmReceived(fixture)

    const receipt = fixture.services.state.auditEvents
      .filter((event) => event.action === "driver_payment_received")
      .at(-1)
    const metadata = receipt?.metadata as Record<string, unknown> | undefined

    expect(metadata?.platformFeeOutcome).toBe("not_applicable")
    expect(metadata?.platformFeeEventId).toBeNull()
    expect(metadata).toMatchObject({
      amountCents: 52_500,
      currency: "USD",
      matchesExpected: true
    })
    expect(receipt?.actorUserId).toBe(fixture.driver.userId)
    expect(
      fixture.services.state.auditEvents
        .filter((event) => event.action === "haul_completion_confirmed")
        .at(-1)?.metadata
    ).toMatchObject({
      platformFeeEventId: fixture.services.state.platformFeeEvents[0]!.id,
      platformFeeOutcome: "accrued"
    })
  })

  it("preserves a short payment as a detectable receipt without changing the host-stated fee base", () => {
    const fixture = settleableHaul()
    forceSettleableState(fixture, 52_500)
    confirmDelivery(fixture)
    markSent(fixture)

    const receipt = fixture.services.confirmDriverPaymentReceived({
      actorUserId: fixture.driver.userId,
      amountCents: 50_000,
      assignmentId: fixture.assignment.id,
      currency: "usd",
      organizationId: fixture.driverMembership.organizationId
    })
    const paymentAudit = fixture.services.state.auditEvents
      .filter((event) => event.action === "driver_payment_received")
      .at(-1)

    expect(receipt.assignment).toMatchObject({
      driverPaymentReceivedAmountCents: 50_000,
      driverPaymentReceivedCurrency: "USD"
    })
    expect(fixture.services.state.platformFeeEvents[0]).toMatchObject({
      driverPayCents: 52_500,
      feeBps: PLATFORM_FEE_BPS,
      feeCents: 2_625
    })
    expect(paymentAudit?.metadata).toMatchObject({
      amountCents: 50_000,
      currency: "USD",
      matchesExpected: false
    })
    expect(
      fixture.services.state.notifications
        .filter((notification) => notification.userId === fixture.hostBilling.userId)
        .at(-1)?.body
    ).toMatch(/differs from the accepted amount/i)
  })

  it("refuses anyone other than the assigned driver and any cancelled assignment", () => {
    const fixture = settleableHaul()
    forceSettleableState(fixture, 52_500)
    confirmDelivery(fixture)
    markSent(fixture)

    expect(() =>
      fixture.services.confirmDriverPaymentReceived({
        actorUserId: fixture.hostBilling.userId,
        amountCents: 52_500,
        assignmentId: fixture.assignment.id,
        currency: "USD",
        organizationId: fixture.load.companyId
      })
    ).toThrow(/assigned driver/i)
    expect(fixture.services.state.platformFeeEvents).toHaveLength(1)

    const cancelled = fixture.services.state.assignments.find(
      (candidate) => candidate.id === fixture.assignment.id
    )!
    cancelled.status = "cancelled"
    const beforeCancelledReceipt = structuredClone(fixture.services.state)

    expect(() => confirmReceived(fixture)).toThrow(/cancelled haul/i)
    expect(fixture.services.state).toEqual(beforeCancelledReceipt)
  })
})
