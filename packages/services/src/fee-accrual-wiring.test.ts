import { randomUUID } from "node:crypto"

import {
  computePlatformFeeCents,
  organizationMembershipSchema,
  organizationRoleCan,
  PLATFORM_FEE_BPS
} from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices } from "./index"

/**
 * A fee is earned only after the complete two-party chain:
 *
 * driver records delivery -> host confirms delivery -> host marks the frozen
 * off-platform pay sent -> the assigned driver confirms it arrived.
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
  live.status = "completed"
  held.status = "completed"
  held.driverPaymentSentAt = null
  held.driverPaymentSentByUserId = null
  held.driverPaymentReceivedAt = null
  held.driverPaymentReceivedByUserId = null
  held.termsSnapshot = { ...held.termsSnapshot, driverPayCents }
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
    assignmentId: fixture.assignment.id,
    organizationId: fixture.driverMembership.organizationId
  })
}

describe("a driver-confirmed payment receipt raises the platform fee", () => {
  it("writes exactly one fee from the frozen driver pay only after receipt", () => {
    const fixture = settleableHaul()
    const { posting } = forceSettleableState(fixture, 52_500)

    confirmDelivery(fixture)
    expect(fixture.services.state.platformFeeEvents).toHaveLength(0)

    markSent(fixture)
    expect(fixture.services.state.platformFeeEvents).toHaveLength(0)

    const receipt = confirmReceived(fixture)
    const events = fixture.services.state.platformFeeEvents

    expect(receipt.platformFeeOutcome).toBe("accrued")
    expect(events).toHaveLength(1)
    expect(events[0]!.assignmentId).toBe(fixture.assignment.id)
    expect(events[0]!.organizationId).toBe(posting.companyId)
    expect(events[0]!.status).toBe("accrued")
    expect(events[0]!.driverPayCents).toBe(52_500)
    expect(events[0]!.feeCents).toBe(computePlatformFeeCents(52_500, PLATFORM_FEE_BPS))
    expect(events[0]!.feeCents).toBe(2_625)
  })

  it("is idempotent when receipt confirmation is retried", () => {
    const fixture = settleableHaul()
    forceSettleableState(fixture, 52_500)
    confirmDelivery(fixture)
    markSent(fixture)

    const first = confirmReceived(fixture)
    const firstId = fixture.services.state.platformFeeEvents[0]!.id
    const second = confirmReceived(fixture)

    expect(first.changed).toBe(true)
    expect(first.platformFeeOutcome).toBe("accrued")
    expect(second.changed).toBe(false)
    expect(second.platformFeeOutcome).toBe("already_accrued")
    expect(fixture.services.state.platformFeeEvents).toHaveLength(1)
    expect(fixture.services.state.platformFeeEvents[0]!.id).toBe(firstId)
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
    forceSettleableState(fixture, null)

    expect(confirmDelivery(fixture).trip.completionStatus).toBe("confirmed")
    expect(fixture.services.state.platformFeeEvents).toHaveLength(0)
    expect(() => markSent(fixture)).toThrow(/no frozen driver pay/i)
  })

  it("records the receipt and resulting fee on the receipt audit event", () => {
    const fixture = settleableHaul()
    forceSettleableState(fixture, 52_500)
    confirmDelivery(fixture)
    markSent(fixture)
    confirmReceived(fixture)

    const receipt = fixture.services.state.auditEvents
      .filter((event) => event.action === "driver_payment_received")
      .at(-1)
    const metadata = receipt?.metadata as Record<string, unknown> | undefined

    expect(metadata?.platformFeeOutcome).toBe("accrued")
    expect(metadata?.platformFeeEventId).toBe(fixture.services.state.platformFeeEvents[0]!.id)
    expect(receipt?.actorUserId).toBe(fixture.driver.userId)
  })

  it("refuses anyone other than the assigned driver from confirming receipt", () => {
    const fixture = settleableHaul()
    forceSettleableState(fixture, 52_500)
    confirmDelivery(fixture)
    markSent(fixture)

    expect(() =>
      fixture.services.confirmDriverPaymentReceived({
        actorUserId: fixture.hostBilling.userId,
        assignmentId: fixture.assignment.id,
        organizationId: fixture.load.companyId
      })
    ).toThrow(/assigned driver/i)
    expect(fixture.services.state.platformFeeEvents).toHaveLength(0)
  })
})
