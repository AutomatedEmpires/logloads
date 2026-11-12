import { randomUUID } from "node:crypto"

import {
  computePlatformFeeCents,
  organizationMembershipSchema,
  organizationRoleCan,
  PERCENTAGE_FEE_RETIRED_CODE,
  PERCENTAGE_FEE_RETIRED_MESSAGE,
  percentageFeeEventId,
  platformFeeEventSchema,
  PLATFORM_FEE_BPS,
  type PlatformFeeEvent
} from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createLogLoadsServices } from "./index"
import { reconcileMissingPlatformFees } from "./platform-fees"

/**
 * The completed-load percentage fee is retired. Completing a load, retrying the
 * completion, physical completion after a destination confirmation, driver
 * payment receipt and the billing cron must all leave the fee ledger alone,
 * while a fee recorded before the retirement is still read back unchanged.
 *
 * These tests drive the production wiring, not only the ledger function.
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

/**
 * A delivered percentage_v1 haul whose assignment carries the fee-bearing terms
 * an assignment committed before the retirement froze. The strongest case: the
 * terms still say a fee accrues, and still nothing may be written.
 */
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

/** The fee row exactly as the retired accrual wrote it before the retirement. */
function recordHistoricalFee(
  fixture: ReturnType<typeof settleableHaul>,
  overrides: Partial<PlatformFeeEvent> = {}
): PlatformFeeEvent {
  const { assignment, load, services } = fixture
  const held = services.state.assignments.find((candidate) => candidate.id === assignment.id)!
  const movementId = held.loadMovementId ?? held.id
  const recordedAt = "2026-06-20T15:00:00.000Z"
  const event = platformFeeEventSchema.parse({
    assignmentId: held.id,
    billingModel: "percentage_v1",
    createdAt: recordedAt,
    driverPayCents: 52_500,
    feeBps: PLATFORM_FEE_BPS,
    feeCents: computePlatformFeeCents(52_500, PLATFORM_FEE_BPS),
    id: percentageFeeEventId(movementId),
    invoiceId: null,
    loadMovementId: movementId,
    loadPostingId: load.id,
    occurredAt: recordedAt,
    organizationId: load.companyId,
    status: "accrued",
    truckSlotId: held.truckSlotId,
    updatedAt: recordedAt,
    voidReason: null,
    ...overrides
  })

  services.state.platformFeeEvents.push(event)

  return event
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

function retiredAnswer(assignmentId: string) {
  return {
    assignmentId,
    code: PERCENTAGE_FEE_RETIRED_CODE,
    outcome: "retired",
    reason: PERCENTAGE_FEE_RETIRED_MESSAGE
  }
}

function accrualAudits(fixture: ReturnType<typeof settleableHaul>) {
  return fixture.services.state.auditEvents.filter(
    (event) => event.action === "platform_fee_accrued"
  )
}

function lastCompletionAudit(fixture: ReturnType<typeof settleableHaul>) {
  return fixture.services.state.auditEvents
    .filter((event) => event.action === "haul_completion_confirmed")
    .at(-1)
}

describe("completing a load records no new percentage fee", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("confirms the delivery and writes no fee, even under fee-bearing historical terms", () => {
    const fixture = settleableHaul()
    forceSettleableState(fixture, 52_500)

    const completion = confirmDelivery(fixture)

    expect(completion.trip.completionStatus).toBe("confirmed")
    expect(completion.platformFeeOutcome).toBe("retired")
    expect(completion.platformFee).toEqual(retiredAnswer(fixture.assignment.id))
    expect(fixture.services.state.platformFeeEvents).toHaveLength(0)
    expect(accrualAudits(fixture)).toHaveLength(0)
    expect(lastCompletionAudit(fixture)?.metadata).toMatchObject({
      platformFeeCents: null,
      platformFeeEventId: null,
      platformFeeOutcome: "retired"
    })
  })

  it("writes no fee with LOGLOADS_FEE_COLLECTION and LOGLOADS_PERCENTAGE_ENROLLMENT set to enabled", () => {
    vi.stubEnv("LOGLOADS_FEE_COLLECTION", "enabled")
    vi.stubEnv("LOGLOADS_PERCENTAGE_ENROLLMENT", "enabled")
    const fixture = settleableHaul()
    forceSettleableState(fixture, 52_500)

    expect(confirmDelivery(fixture).platformFeeOutcome).toBe("retired")
    expect(
      reconcileMissingPlatformFees(fixture.services.state, "2026-07-01T06:00:00.000Z")
        .map((row) => row.outcome)
    ).toEqual(["retired"])
    expect(fixture.services.state.platformFeeEvents).toHaveLength(0)
    expect(accrualAudits(fixture)).toHaveLength(0)
  })

  it("writes no fee when physical completion follows a confirmation at the destination", () => {
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

    expect(confirmDelivery(fixture).platformFeeOutcome).toBe("retired")

    const completion = fixture.services.progressTripStatus({
      actorUserId: fixture.driver.userId,
      nextStatus: "completed",
      organizationId: fixture.driverMembership.organizationId,
      source: "driver",
      tripId: fixture.trip.id
    })

    expect(completion.trip.status).toBe("completed")
    expect(fixture.services.state.platformFeeEvents).toHaveLength(0)
    expect(accrualAudits(fixture)).toHaveLength(0)
  })

  it("answers every accrual retry identically and changes nothing", () => {
    const fixture = settleableHaul()
    forceSettleableState(fixture, 52_500)
    confirmDelivery(fixture)
    const before = structuredClone(fixture.services.state)

    for (const at of ["2026-06-20T15:00:00.000Z", "2026-07-01T06:00:00.000Z", undefined]) {
      expect(
        fixture.services.accruePlatformFee(
          { actorUserId: fixture.hostBilling.userId, assignmentId: fixture.assignment.id, feeBps: PLATFORM_FEE_BPS },
          at
        )
      ).toEqual(retiredAnswer(fixture.assignment.id))
    }

    expect(fixture.services.state).toEqual(before)
  })

  it("writes no fee for a legacy haul after the driver confirms receipt", () => {
    const fixture = settleableHaul()
    const { held } = forceSettleableState(fixture, 52_500)
    held.billingModel = "legacy_percentage"

    expect(confirmDelivery(fixture).platformFeeOutcome).toBe("retired")
    markSent(fixture)
    const receipt = confirmReceived(fixture)

    expect(receipt.platformFeeOutcome).toBe("not_applicable")
    expect(
      reconcileMissingPlatformFees(fixture.services.state, "2026-07-01T06:00:00.000Z")
        .map((row) => row.outcome)
    ).toEqual(["retired"])
    expect(fixture.services.state.platformFeeEvents).toHaveLength(0)
  })

  it.each([
    "rejected_at_scale",
    "access_blocked",
    "equipment_failure",
    "weather_hold"
  ] as const)("confirms a %s zero-delivery record without a fee", (exceptionType) => {
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
    expect(completion.platformFeeOutcome).toBe("retired")
    expect(fixture.services.state.platformFeeEvents).toHaveLength(0)
  })

  it("writes no fee when the host disputes the delivered record", () => {
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

  it("lets the billing cron repair nothing and write nothing, run after run", () => {
    const fixture = settleableHaul()
    forceSettleableState(fixture, 52_500)
    confirmDelivery(fixture)
    const before = structuredClone(fixture.services.state)
    const expected = [
      {
        assignmentId: fixture.assignment.id,
        eventId: null,
        outcome: "retired",
        reason: PERCENTAGE_FEE_RETIRED_MESSAGE
      }
    ]

    expect(reconcileMissingPlatformFees(fixture.services.state, "2026-07-01T06:00:00.000Z")).toEqual(expected)
    expect(reconcileMissingPlatformFees(fixture.services.state, "2026-08-01T06:00:00.000Z")).toEqual(expected)
    expect(fixture.services.state).toEqual(before)
  })
})

describe("fees recorded before the retirement stay readable", () => {
  it("reads a recorded fee back on a retried completion without writing another", () => {
    const fixture = settleableHaul()
    forceSettleableState(fixture, 52_500)
    const recorded = recordHistoricalFee(fixture)
    const recordedCopy = structuredClone(recorded)

    const completion = confirmDelivery(fixture)

    expect(completion.platformFeeOutcome).toBe("already_accrued")
    expect(completion.platformFee).toEqual({ event: recordedCopy, outcome: "already_accrued" })
    expect(fixture.services.state.platformFeeEvents).toEqual([recordedCopy])
    expect(lastCompletionAudit(fixture)?.metadata).toMatchObject({
      platformFeeCents: 2_625,
      platformFeeEventId: recordedCopy.id,
      platformFeeOutcome: "already_accrued"
    })
    expect(accrualAudits(fixture)).toHaveLength(0)
  })

  it("keeps a withdrawn fee final when completion is retried", () => {
    const fixture = settleableHaul()
    forceSettleableState(fixture, 52_500)
    recordHistoricalFee(fixture)
    confirmDelivery(fixture)

    expect(
      fixture.services.voidPlatformFee({
        actorUserId: fixture.hostBilling.userId,
        assignmentId: fixture.assignment.id,
        organizationId: fixture.load.companyId,
        reason: "Delivery was reversed after confirmation"
      }).outcome
    ).toBe("voided")

    // A corrected delivery can be submitted after the original confirmation was
    // withdrawn. The movement identity is the same, so the void stays final.
    const live = fixture.services.state.tripsV2.find(
      (trip) => trip.id === fixture.trip.id
    )!
    live.completionConfirmedAt = null
    live.completionConfirmedByUserId = null
    live.completionStatus = "submitted"

    const retried = confirmDelivery(fixture)

    expect(retried.platformFeeOutcome).toBe("already_voided")
    expect(retried.platformFee).toMatchObject({
      event: { status: "voided" },
      outcome: "already_voided"
    })
    expect(lastCompletionAudit(fixture)?.metadata).toMatchObject({
      platformFeeCents: null,
      platformFeeEventId: null,
      platformFeeOutcome: "already_voided"
    })
    expect(fixture.services.state.platformFeeEvents).toHaveLength(1)
  })

  it("keeps the recorded fee base when the driver later records a short payment", () => {
    const fixture = settleableHaul()
    forceSettleableState(fixture, 52_500)
    const recorded = structuredClone(recordHistoricalFee(fixture))
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
    expect(fixture.services.state.platformFeeEvents).toEqual([recorded])
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

  it("keeps completion when a recorded fee is cross-wired, and rewrites nothing", () => {
    const fixture = settleableHaul()
    forceSettleableState(fixture, 52_500)
    const crossWired = structuredClone(
      recordHistoricalFee(fixture, {
        organizationId: "33333333-3333-4333-8333-333333333339"
      })
    )

    const completion = confirmDelivery(fixture)
    const failures = fixture.services.state.auditEvents.filter(
      (event) => event.action === "platform_fee_accrual_failed"
    )

    expect(completion.trip.completionStatus).toBe("confirmed")
    expect(completion.platformFeeOutcome).toBe("error")
    expect(failures).toHaveLength(1)
    expect(failures[0]?.entityId).toBe(fixture.assignment.id)
    expect(fixture.services.state.platformFeeEvents).toEqual([crossWired])
  })
})

describe("residual driver-pay settlement does not depend on a fee", () => {
  it("keeps only the completed-haul payment receipt path open after organization lock", () => {
    const fixture = settleableHaul()
    forceSettleableState(fixture, 52_500)
    confirmDelivery(fixture)

    const participantOrganizationIds = new Set([
      fixture.load.companyId,
      fixture.driverMembership.organizationId
    ])
    for (const organization of fixture.services.state.organizations) {
      if (participantOrganizationIds.has(organization.id)) {
        organization.verificationStatus = "suspended"
      }
    }

    expect(markSent(fixture)).toMatchObject({ changed: true })
    expect(confirmReceived(fixture)).toMatchObject({
      changed: true,
      matchesExpected: true,
      platformFeeOutcome: "not_applicable"
    })
    expect(fixture.services.state.platformFeeEvents).toHaveLength(0)
  })

  it("lets the exact assigned owner-operator finish a residual payment receipt", () => {
    const fixture = settleableHaul()
    forceSettleableState(fixture, 52_500)
    confirmDelivery(fixture)
    markSent(fixture)
    fixture.driverMembership.role = "owner"
    const driverOrganization = fixture.services.state.organizations.find(
      (organization) => organization.id === fixture.driverMembership.organizationId
    )

    if (!driverOrganization) {
      throw new Error("Expected the owner-operator organization")
    }

    driverOrganization.verificationStatus = "suspended"

    expect(confirmReceived(fixture)).toMatchObject({
      changed: true,
      matchesExpected: true,
      platformFeeOutcome: "not_applicable"
    })
  })

  it("keeps residual settlement tenant-exact and leaves state untouched on cross-tenant attempts", () => {
    const fixture = settleableHaul()
    forceSettleableState(fixture, 52_500)
    confirmDelivery(fixture)
    const state = fixture.services.state
    const host = state.organizations.find((organization) => organization.id === fixture.load.companyId)
    const driverOrganization = state.organizations.find(
      (organization) => organization.id === fixture.driverMembership.organizationId
    )
    const outsider = state.profiles.find(
      (profile) =>
        profile.isActive &&
        !state.organizationMemberships.some(
          (membership) =>
            membership.userId === profile.id &&
            [fixture.load.companyId, fixture.driverMembership.organizationId].includes(membership.organizationId)
        )
    )

    if (!host || !driverOrganization || !outsider) {
      throw new Error("Expected locked settlement and outsider fixtures")
    }

    host.verificationStatus = "suspended"
    driverOrganization.verificationStatus = "suspended"
    const beforeHostAttempt = structuredClone(state)

    expect(() =>
      fixture.services.markDriverPaymentSent({
        actorUserId: outsider.id,
        assignmentId: fixture.assignment.id,
        organizationId: fixture.load.companyId
      })
    ).toThrow(/not an active member/)
    expect(state).toEqual(beforeHostAttempt)

    markSent(fixture)
    const beforeDriverAttempt = structuredClone(state)

    expect(() =>
      fixture.services.confirmDriverPaymentReceived({
        actorUserId: outsider.id,
        amountCents: 52_500,
        assignmentId: fixture.assignment.id,
        currency: "USD",
        organizationId: fixture.driverMembership.organizationId
      })
    ).toThrow(/not an active member/)
    expect(state).toEqual(beforeDriverAttempt)
  })

  it("requires an explicit organization for an ambiguous multi-workspace settlement actor", () => {
    const fixture = settleableHaul()
    forceSettleableState(fixture, 52_500)
    confirmDelivery(fixture)
    const state = fixture.services.state
    const actorMemberships = state.organizationMemberships.filter(
      (membership) =>
        membership.userId === fixture.hostBilling.userId &&
        membership.status === "active"
    )
    const activeOrganizationIds = new Set(
      actorMemberships.map((membership) => membership.organizationId)
    )

    if (activeOrganizationIds.size < 2) {
      const template = actorMemberships[0]
      const otherOrganization = state.organizations.find(
        (organization) => !activeOrganizationIds.has(organization.id)
      )

      if (!template || !otherOrganization) {
        throw new Error("Expected a second organization for the ambiguity fixture")
      }

      state.organizationMemberships.push(organizationMembershipSchema.parse({
        ...template,
        id: randomUUID(),
        organizationId: otherOrganization.id
      }))
    }

    const before = structuredClone(state)

    expect(() =>
      fixture.services.markDriverPaymentSent({
        actorUserId: fixture.hostBilling.userId,
        assignmentId: fixture.assignment.id
      })
    ).toThrow(/select exactly one organization/)
    expect(state).toEqual(before)
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

  it("still settles a legacy haul whose frozen pay is missing", () => {
    const fixture = settleableHaul()
    const { held } = forceSettleableState(fixture, null)
    held.billingModel = "legacy_percentage"

    expect(confirmDelivery(fixture).trip.completionStatus).toBe("confirmed")
    expect(fixture.services.state.platformFeeEvents).toHaveLength(0)
    expect(() => markSent(fixture)).toThrow(/no frozen driver pay/i)
  })

  it("keeps the receipt audit independent of any fee", () => {
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
    expect(fixture.services.state.platformFeeEvents).toHaveLength(0)

    const cancelled = fixture.services.state.assignments.find(
      (candidate) => candidate.id === fixture.assignment.id
    )!
    cancelled.status = "cancelled"
    const beforeCancelledReceipt = structuredClone(fixture.services.state)

    expect(() => confirmReceived(fixture)).toThrow(/cancelled haul/i)
    expect(fixture.services.state).toEqual(beforeCancelledReceipt)
  })
})
