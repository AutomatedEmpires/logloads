import { createInMemoryDatabase } from "@logloads/db"
import { computePlatformFeeCents, PLATFORM_FEE_BPS } from "@logloads/contracts"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices } from "./index"

/**
 * The fee engine can be perfect and earn nothing if no code path calls it.
 *
 * These tests exist because that was the actual state: `accruePlatformFee` was
 * built, exported and bound on the facade with ZERO call sites, so every load
 * could complete and the ledger stayed empty forever. They assert the wiring — a
 * confirmed delivery raises exactly one fee — rather than re-testing the fee
 * arithmetic, which platform-fees.test.ts already covers.
 */
function settleableHaul() {
  const services = createLogLoadsServices(createInMemoryDatabase())
  const state = services.state
  // A trip whose driver has submitted a delivered record and whose host has not
  // settled it yet: the one state from which confirmation is legal.
  const trip = state.tripsV2.find((candidate) => candidate.completionStatus === "submitted")
    ?? state.tripsV2.find((candidate) => candidate.status !== "cancelled")

  if (!trip) throw new Error("the seed carries no trip that could be settled")

  const assignment = state.assignments.find((candidate) => candidate.id === trip.assignmentId)
  const load = state.loadPostings.find((candidate) => candidate.id === trip.loadPostingId)

  if (!assignment || !load) throw new Error("the seeded trip is not attached to an assignment and a load")

  const membership = state.organizationMemberships.find(
    (candidate) =>
      candidate.organizationId === load.companyId &&
      candidate.status === "active" &&
      ["owner", "admin", "dispatcher"].includes(candidate.role)
  )

  if (!membership) throw new Error("the posting organization has no member who could settle")

  return { assignment, load, membership, services, trip }
}

function forceSettleableState(fixture: ReturnType<typeof settleableHaul>, driverPayCents: number | null) {
  const { assignment, load, services, trip } = fixture
  const live = services.state.tripsV2.find((candidate) => candidate.id === trip.id)!
  const posting = services.state.loadPostings.find((candidate) => candidate.id === load.id)!
  const held = services.state.assignments.find((candidate) => candidate.id === assignment.id)!

  // Put the haul in the exact shape a real settlement arrives in, so the test
  // exercises the production path rather than a hand-built object.
  live.completionStatus = "submitted"
  live.completionSubmittedByUserId = "44444444-4444-4444-8444-444444444441"
  live.completionConfirmedAt = null
  live.status = "completed"
  held.status = "completed"
  posting.driverPayCents = driverPayCents

  return { held, live, posting }
}

describe("a confirmed delivery raises the platform fee", () => {
  it("writes exactly one fee, computed from the host's stated driver pay", () => {
    const fixture = settleableHaul()
    const { posting } = forceSettleableState(fixture, 52_500)

    expect(fixture.services.state.platformFeeEvents).toHaveLength(0)

    fixture.services.settleHaulCompletion({
      actorUserId: fixture.membership.userId,
      decision: "confirm",
      organizationId: posting.companyId,
      tripId: fixture.trip.id
    })

    const events = fixture.services.state.platformFeeEvents

    expect(events).toHaveLength(1)
    expect(events[0]!.assignmentId).toBe(fixture.assignment.id)
    expect(events[0]!.organizationId).toBe(posting.companyId)
    expect(events[0]!.status).toBe("accrued")
    // 5% of $525.00 = $26.25, and the base is the host's figure, not a rate card.
    expect(events[0]!.driverPayCents).toBe(52_500)
    expect(events[0]!.feeCents).toBe(computePlatformFeeCents(52_500, PLATFORM_FEE_BPS))
    expect(events[0]!.feeCents).toBe(2_625)
  })

  it("charges nothing twice when the settlement is retried", () => {
    // A client that lost the response retries, and a compare-and-swap conflict
    // replays the whole mutation. With no unique index behind this store, the
    // at-most-one guard is the only thing between a retry and a double charge.
    const fixture = settleableHaul()
    const { posting } = forceSettleableState(fixture, 52_500)

    fixture.services.settleHaulCompletion({
      actorUserId: fixture.membership.userId,
      decision: "confirm",
      organizationId: posting.companyId,
      tripId: fixture.trip.id
    })

    const firstId = fixture.services.state.platformFeeEvents[0]!.id

    // Re-arm the trip so a second settlement is attempted against a load that has
    // already been billed. The trip has to be re-read from state rather than held
    // by reference: confirmation replaces the row immutably, so a captured object
    // is a stale copy and mutating it would leave the live row confirmed and this
    // test silently asserting nothing.
    const rearmed = fixture.services.state.tripsV2.find((candidate) => candidate.id === fixture.trip.id)!

    rearmed.completionStatus = "submitted"
    rearmed.completionConfirmedAt = null

    fixture.services.settleHaulCompletion({
      actorUserId: fixture.membership.userId,
      decision: "confirm",
      organizationId: posting.companyId,
      tripId: fixture.trip.id
    })

    expect(fixture.services.state.platformFeeEvents).toHaveLength(1)
    expect(fixture.services.state.platformFeeEvents[0]!.id).toBe(firstId)
  })

  it("raises no fee when the host disputes the delivered record", () => {
    // A disputed haul is not an agreed one, so there is nothing defensible to bill.
    const fixture = settleableHaul()
    const { posting } = forceSettleableState(fixture, 52_500)

    fixture.services.settleHaulCompletion({
      actorUserId: fixture.membership.userId,
      decision: "dispute",
      organizationId: posting.companyId,
      reason: "Short by four tons against the ticket",
      tripId: fixture.trip.id
    })

    expect(fixture.services.state.platformFeeEvents).toHaveLength(0)
  })

  it("still settles the haul when there is no pay to charge a percentage of", () => {
    // A legacy posting states no driver pay. LogLoads not being able to bill is
    // LogLoads' problem; it must not cost a host and a driver their record of the
    // haul. The settlement succeeds and the ledger stays honestly empty.
    const fixture = settleableHaul()
    const { posting } = forceSettleableState(fixture, null)

    const settled = fixture.services.settleHaulCompletion({
      actorUserId: fixture.membership.userId,
      decision: "confirm",
      organizationId: posting.companyId,
      tripId: fixture.trip.id
    })

    expect(settled.trip.completionStatus).toBe("confirmed")
    expect(fixture.services.state.platformFeeEvents).toHaveLength(0)
  })

  it("records the charge on the same audit event the parties settled", () => {
    // An invoice line has to be traceable to the moment both parties agreed, not
    // to a later batch job that nobody can reconstruct.
    const fixture = settleableHaul()
    const { posting } = forceSettleableState(fixture, 52_500)

    fixture.services.settleHaulCompletion({
      actorUserId: fixture.membership.userId,
      decision: "confirm",
      organizationId: posting.companyId,
      tripId: fixture.trip.id
    })

    const settlement = fixture.services.state.auditEvents
      .filter((event) => event.action === "haul_completion_confirmed")
      .at(-1)
    const metadata = settlement?.metadata as Record<string, unknown> | undefined

    expect(metadata?.platformFeeOutcome).toBe("accrued")
    expect(metadata?.platformFeeCents).toBe(2_625)
    expect(metadata?.platformFeeEventId).toBe(fixture.services.state.platformFeeEvents[0]!.id)
  })
})
