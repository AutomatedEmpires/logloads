import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices, type LogLoadsServices } from "./index"
import { stubTripDocumentMedia } from "./test-helpers"

const HAULER_ORG = "33333333-3333-4333-8333-333333333331"
const HOST_ORG = "33333333-3333-4333-8333-333333333332"
const HAULER_DRIVER_ACTOR = "22222222-2222-4222-8222-222222222221"
const HOST_OWNER = "22222222-2222-4222-8222-222222222223"
const DRIVER_PROFILE = "44444444-4444-4444-8444-444444444441"
const TRUCK_PROFILE = "77777777-7777-4777-8777-777777777771"
const TRAILER_PROFILE = "88888888-8888-4888-8888-888888888881"

const LOAD_DATE = "2026-06-25"
const WINDOW = `${LOAD_DATE}T12:00:00.000Z`

function bookHaul(services: LogLoadsServices) {
  const load = services.createLoadPostingWithPolicy({
    accessRequirements: [],
    actorUserId: HOST_OWNER,
    campaignEndDate: null,
    campaignStartDate: null,
    companyId: HOST_ORG,
    dailyTruckCountNeeded: 1,
    dispatcherContact: { email: "dispatch@northpine.example", name: "Dana Dispatch", phone: "555-2001" },
    dispatcherProfileId: "55555555-5555-4555-8555-555555555551",
    dropoffMillId: "99999999-9999-4999-8999-999999999991",
    equipmentRequirements: ["pole-trailer"],
    estimatedTonsPerLoad: 27,
    loadDate: LOAD_DATE,
    loadType: "saw_logs",
    loaderContact: null,
    loaderProfileId: null,
    organizationId: HOST_ORG,
    pickupLandingId: "66666666-6666-4666-8666-666666666661",
    rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    recurringSchedule: null,
    roadCondition: "good",
    routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    scheduleType: "one_off",
    status: "open",
    title: "Completion fixture",
    weatherNotes: null
  })
  const slot = services.state.truckSlots.find((candidate) => candidate.loadPostingId === load.id)

  if (!slot) throw new Error("fixture load has no slot")

  services.upsertAvailabilityWindow({
    driverProfileId: DRIVER_PROFILE,
    endAt: `${LOAD_DATE}T23:59:00.000Z`,
    notes: "Completion fixture window.",
    preferredRouteIds: [],
    recurringSchedule: null,
    startAt: `${LOAD_DATE}T00:00:00.000Z`,
    status: "available",
    truckProfileId: TRUCK_PROFILE
  })

  const assignment = services.requestCapacityWithPolicy({
    actorUserId: HAULER_DRIVER_ACTOR,
    driverProfileId: DRIVER_PROFILE,
    loadPostingId: load.id,
    organizationId: HAULER_ORG,
    trailerProfileId: TRAILER_PROFILE,
    truckProfileId: TRUCK_PROFILE,
    truckSlotId: slot.id
  }, { at: WINDOW })

  const { trip } = services.approveCapacityRequest({
    actorUserId: HOST_OWNER,
    assignmentId: assignment.id,
    organizationId: HOST_ORG
  })

  return { assignment, load, trip }
}

/** Drives the trip to the destination, where a delivery can be recorded. */
function haulToDestination(services: LogLoadsServices, tripId: string) {
  for (const nextStatus of [
    "en_route_to_landing",
    "checked_in",
    "loading",
    "loaded",
    "en_route_to_destination",
    "at_destination"
  ] as const) {
    services.progressTripStatus({
      actorUserId: HAULER_DRIVER_ACTOR,
      nextStatus,
      organizationId: HAULER_ORG,
      source: "driver",
      tripId
    })
  }
}

function attachTicket(services: LogLoadsServices, tripId: string) {
  return services.attachTripDocument({
    actorUserId: HAULER_DRIVER_ACTOR,
    filename: "scale-ticket.jpg",
    media: stubTripDocumentMedia(tripId),
    organizationId: HAULER_ORG,
    tripId,
    type: "scale_ticket"
  })
}

describe("driver submission", () => {
  it("records what came off the truck and asks the host to confirm", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { assignment, trip } = bookHaul(services)

    expect(services.state.tripsV2.find((current) => current.id === trip.id)?.completionStatus).toBe("pending")

    haulToDestination(services, trip.id)

    const result = services.submitHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      deliveredQuantity: { ticketNumber: "SC-40192", unit: "tons", value: 26.4 },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })

    expect(result.trip.completionStatus).toBe("submitted")
    expect(result.trip.deliveredQuantity).toMatchObject({ ticketNumber: "SC-40192", unit: "tons", value: 26.4 })
    expect(result.trip.completionSubmittedByUserId).toBe(HAULER_DRIVER_ACTOR)

    const dispatcher = services.state.dispatcherProfiles.find(
      (profile) => profile.id === "55555555-5555-4555-8555-555555555551"
    )
    const notified = services.state.notifications.find((notification) =>
      notification.relatedEntityId === assignment.id && notification.title === "Delivery recorded"
    )

    expect(notified?.userId).toBe(dispatcher?.userId)
    expect(services.state.auditEvents.some((event) =>
      event.entityId === trip.id && event.action === "haul_completion_submitted"
    )).toBe(true)
  })

  it("refuses a delivery recorded before the load reaches the destination", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)

    expect(() => services.submitHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      deliveredQuantity: { unit: "tons", value: 26.4 },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })).toThrow(/at the destination/)
  })

  it("requires a quantity or an exception, and explains a zero", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)

    haulToDestination(services, trip.id)

    expect(() => services.submitHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      organizationId: HAULER_ORG,
      tripId: trip.id
    })).toThrow(/Record what was delivered/)

    // Zero is a real outcome, but it must be explained.
    expect(() => services.submitHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      deliveredQuantity: { unit: "tons", value: 0 },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })).toThrow(/zero delivery needs an exception/)

    const rejected = services.submitHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      deliveredQuantity: { unit: "tons", value: 0 },
      exception: { note: "Scale rejected the load for excess mud.", type: "rejected_at_scale" },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })

    expect(rejected.trip.completionStatus).toBe("submitted")
    expect(rejected.trip.haulException?.type).toBe("rejected_at_scale")
    expect(rejected.trip.haulException?.reportedAt).toBeTruthy()
  })

  it("keeps the account on the hauling side", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)

    haulToDestination(services, trip.id)

    // The host confirms the record; it must not also author it.
    expect(() => services.submitHaulCompletion({
      actorUserId: HOST_OWNER,
      deliveredQuantity: { unit: "tons", value: 99 },
      organizationId: HOST_ORG,
      tripId: trip.id
    })).toThrow(/hauling organization records what was delivered/)
  })

  it("keeps a driver from recording another driver's haul", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)

    haulToDestination(services, trip.id)

    const otherDriver = services.state.organizationMemberships.find((membership) =>
      membership.organizationId === HAULER_ORG &&
      membership.role === "driver" &&
      membership.status === "active" &&
      membership.userId !== HAULER_DRIVER_ACTOR
    )

    expect(otherDriver).toBeDefined()
    if (!otherDriver) return

    expect(() => services.submitHaulCompletion({
      actorUserId: otherDriver.userId,
      deliveredQuantity: { unit: "tons", value: 26.4 },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })).toThrow(/own hauls/)
  })
})

describe("host settlement", () => {
  it("confirms the delivered record and tells the driver", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { assignment, trip } = bookHaul(services)

    haulToDestination(services, trip.id)
    services.submitHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      deliveredQuantity: { unit: "tons", value: 26.4 },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })

    const settled = services.settleHaulCompletion({
      actorUserId: HOST_OWNER,
      decision: "confirm",
      organizationId: HOST_ORG,
      tripId: trip.id
    })

    expect(settled.trip.completionStatus).toBe("confirmed")
    expect(settled.trip.completionConfirmedByUserId).toBe(HOST_OWNER)
    // The driver's figures survive settlement untouched.
    expect(settled.trip.deliveredQuantity?.value).toBe(26.4)
    expect(services.state.notifications.some((notification) =>
      notification.relatedEntityId === assignment.id && notification.title === "Delivery confirmed"
    )).toBe(true)
  })

  it("disputes without erasing the driver's figures, and allows a resubmission", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)

    haulToDestination(services, trip.id)
    services.submitHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      deliveredQuantity: { ticketNumber: "SC-1", unit: "tons", value: 30 },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })

    const disputed = services.settleHaulCompletion({
      actorUserId: HOST_OWNER,
      decision: "dispute",
      organizationId: HOST_ORG,
      reason: "Our scale read 26.4 tons on ticket SC-1.",
      tripId: trip.id
    })

    expect(disputed.trip.completionStatus).toBe("disputed")
    expect(disputed.trip.completionDisputeReason).toBe("Our scale read 26.4 tons on ticket SC-1.")
    // A dispute is a disagreement, not an erasure.
    expect(disputed.trip.deliveredQuantity?.value).toBe(30)
    // Nobody confirmed, so nobody is recorded as the confirmer.
    expect(disputed.trip.completionConfirmedByUserId).toBeNull()
    expect(disputed.trip.completionConfirmedAt).toBeNull()
    expect(services.state.auditEvents.some((event) =>
      event.entityId === trip.id &&
      event.action === "haul_completion_disputed" &&
      event.actorUserId === HOST_OWNER
    )).toBe(true)

    const resubmitted = services.submitHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      deliveredQuantity: { ticketNumber: "SC-1", unit: "tons", value: 26.4 },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })

    expect(resubmitted.trip.completionStatus).toBe("submitted")
    expect(resubmitted.trip.completionDisputeReason).toBeNull()

    const confirmed = services.settleHaulCompletion({
      actorUserId: HOST_OWNER,
      decision: "confirm",
      organizationId: HOST_ORG,
      tripId: trip.id
    })

    expect(confirmed.trip.completionStatus).toBe("confirmed")
    expect(confirmed.trip.deliveredQuantity?.value).toBe(26.4)
  })

  it("requires a reason to dispute and refuses to settle an unsubmitted haul", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)

    haulToDestination(services, trip.id)

    expect(() => services.settleHaulCompletion({
      actorUserId: HOST_OWNER,
      decision: "confirm",
      organizationId: HOST_ORG,
      tripId: trip.id
    })).toThrow(/Only a submitted haul can be confirmed/)

    services.submitHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      deliveredQuantity: { unit: "tons", value: 26.4 },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })

    expect(() => services.settleHaulCompletion({
      actorUserId: HOST_OWNER,
      decision: "dispute",
      organizationId: HOST_ORG,
      reason: "   ",
      tripId: trip.id
    })).toThrow(/Say what is wrong/)
  })

  it("keeps settlement with the posting organization", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)

    haulToDestination(services, trip.id)
    services.submitHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      deliveredQuantity: { unit: "tons", value: 26.4 },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })

    // The hauler cannot confirm its own account.
    expect(() => services.settleHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      decision: "confirm",
      organizationId: HAULER_ORG,
      tripId: trip.id
    })).toThrow(/cannot assign capacity/)
  })

  it("will not let a confirmed record be quietly rewritten", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)

    haulToDestination(services, trip.id)
    services.submitHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      deliveredQuantity: { unit: "tons", value: 26.4 },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })
    services.settleHaulCompletion({
      actorUserId: HOST_OWNER,
      decision: "confirm",
      organizationId: HOST_ORG,
      tripId: trip.id
    })

    expect(() => services.submitHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      deliveredQuantity: { unit: "tons", value: 40 },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })).toThrow(/confirmed; ask the host to reopen/)
  })
})

describe("separation of duties", () => {
  it("stops one person recording and settling the same haul by switching organizations", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)

    // Dana Dispatch ships as an active dispatcher in BOTH the hauling org and
    // the posting org, and dispatcher holds progress_trip AND assign_capacity.
    // The workspace switcher makes swapping hats one click.
    const DANA = "22222222-2222-4222-8222-222222222224"
    const bothSides = services.state.organizationMemberships.filter(
      (membership) => membership.userId === DANA && membership.status === "active"
    ).map((membership) => membership.organizationId)

    expect(bothSides).toContain(HAULER_ORG)
    expect(bothSides).toContain(HOST_ORG)

    haulToDestination(services, trip.id)
    services.submitHaulCompletion({
      actorUserId: DANA,
      deliveredQuantity: { ticketNumber: "SC-SELF", unit: "tons", value: 31.9 },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })

    // Same human, other hat: the figure they invented must not be settleable
    // by them into a terminal record with no second party involved.
    expect(() => services.settleHaulCompletion({
      actorUserId: DANA,
      decision: "confirm",
      organizationId: HOST_ORG,
      tripId: trip.id
    })).toThrow(/cannot also settle it/)

    // A different person on the host side still can.
    const settled = services.settleHaulCompletion({
      actorUserId: HOST_OWNER,
      decision: "confirm",
      organizationId: HOST_ORG,
      tripId: trip.id
    })

    expect(settled.trip.completionStatus).toBe("confirmed")
  })

  it("refuses to settle a cancelled haul", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { assignment, trip } = bookHaul(services)

    haulToDestination(services, trip.id)
    services.submitHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      deliveredQuantity: { unit: "tons", value: 26.4 },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })
    services.cancelAssignmentWithPolicy({
      actorUserId: HOST_OWNER,
      assignmentId: assignment.id,
      organizationId: HOST_ORG,
      reason: "Load pulled."
    })

    expect(() => services.settleHaulCompletion({
      actorUserId: HOST_OWNER,
      decision: "confirm",
      organizationId: HOST_ORG,
      tripId: trip.id
    })).toThrow(/no delivery to settle/)
  })

  it("refuses to cancel a haul whose delivery both sides confirmed", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { assignment, trip } = bookHaul(services)

    haulToDestination(services, trip.id)
    services.submitHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      deliveredQuantity: { unit: "tons", value: 26.4 },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })
    services.settleHaulCompletion({
      actorUserId: HOST_OWNER,
      decision: "confirm",
      organizationId: HOST_ORG,
      tripId: trip.id
    })

    // Delivered work that is settled is not rolled back.
    expect(() => services.cancelAssignmentWithPolicy({
      actorUserId: HOST_OWNER,
      assignmentId: assignment.id,
      organizationId: HOST_ORG,
      reason: "Changed my mind."
    })).toThrow(/confirmed and cannot be cancelled/)
  })

  it("makes the host answer a resubmission rather than confirming the figure it contested", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)

    haulToDestination(services, trip.id)
    services.submitHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      deliveredQuantity: { unit: "tons", value: 30 },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })
    services.settleHaulCompletion({
      actorUserId: HOST_OWNER,
      decision: "dispute",
      organizationId: HOST_ORG,
      reason: "Our scale read 26.4.",
      tripId: trip.id
    })

    // Confirming straight out of disputed would settle the contested figure
    // without the driver ever answering.
    expect(() => services.settleHaulCompletion({
      actorUserId: HOST_OWNER,
      decision: "confirm",
      organizationId: HOST_ORG,
      tripId: trip.id
    })).toThrow(/Only a submitted haul can be confirmed/)
  })
})

describe("completion evidence gate", () => {
  it("does not let a self-declared exception excuse proof a delivered haul still owes", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)

    haulToDestination(services, trip.id)
    // A long wait is not a reason to have no scale ticket — the load was still
    // weighed. The driver authors this exception, so it cannot be a blanket key.
    services.submitHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      deliveredQuantity: { unit: "tons", value: 30 },
      exception: { note: "x", type: "wait_time" },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })
    services.progressTripStatus({
      actorUserId: HAULER_DRIVER_ACTOR,
      nextStatus: "unloading",
      organizationId: HAULER_ORG,
      source: "driver",
      tripId: trip.id
    })

    expect(() => services.progressTripStatus({
      actorUserId: HAULER_DRIVER_ACTOR,
      nextStatus: "completed",
      organizationId: HAULER_ORG,
      source: "driver",
      tripId: trip.id
    })).toThrow(/Attach the proof this haul needs/)
  })

  it("reads the requirement from whichever pack the driver is actually looking at", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)
    const live = services.state.tripsV2.find((current) => current.id === trip.id)!

    // The assignment's own snapshot is the requirement.
    expect(services.requiredCompletionEvidence(live).length).toBeGreaterThan(0)

    // A haul booked before packs carried snapshots reads the host's load-level
    // source, which records no requirement — so no gate applies. Holding a
    // driver to something they were never told would be inventing a rule.
    services.state.routePacks = services.state.routePacks.map((pack) =>
      pack.assignmentId === trip.assignmentId ? { ...pack, assignmentId: null, snapshot: null } : pack
    )

    expect(services.requiredCompletionEvidence(live)).toEqual([])

    // The host establishes one by re-issuing the pack, which mints a snapshot.
    services.refreshRoutePackForAssignment({
      actorUserId: HOST_OWNER,
      assignmentId: trip.assignmentId,
      organizationId: HOST_ORG
    })

    expect(services.requiredCompletionEvidence(live).length).toBeGreaterThan(0)
  })

  it("does not let the exception that closed a haul be quietly deleted afterwards", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)

    haulToDestination(services, trip.id)
    services.submitHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      deliveredQuantity: { unit: "tons", value: 0 },
      exception: { note: "Turned away; the scale was closed.", type: "rejected_at_scale" },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })
    services.progressTripStatus({
      actorUserId: HAULER_DRIVER_ACTOR,
      nextStatus: "unloading",
      organizationId: HAULER_ORG,
      source: "driver",
      tripId: trip.id
    })
    services.progressTripStatus({
      actorUserId: HAULER_DRIVER_ACTOR,
      nextStatus: "completed",
      organizationId: HAULER_ORG,
      source: "driver",
      tripId: trip.id
    })

    // Clearing the excuse would leave a clean ticketed record on a haul that
    // never produced the ticket.
    expect(() => services.submitHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      deliveredQuantity: { ticketNumber: "SC-CLEAN", unit: "tons", value: 26.4 },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })).toThrow(/closed on an exception/)

    // Attaching the proof makes the correction legitimate.
    attachTicket(services, trip.id)

    const corrected = services.submitHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      deliveredQuantity: { ticketNumber: "SC-CLEAN", unit: "tons", value: 26.4 },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })

    expect(corrected.trip.haulException).toBeNull()
  })

  it("refuses to close a haul without the proof its Route Pack demanded", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)

    haulToDestination(services, trip.id)
    services.progressTripStatus({
      actorUserId: HAULER_DRIVER_ACTOR,
      nextStatus: "unloading",
      organizationId: HAULER_ORG,
      source: "driver",
      tripId: trip.id
    })

    // The seeded destination requires a scale ticket, and the Route Pack the
    // driver accepted said so.
    expect(services.requiredCompletionEvidence(services.state.tripsV2.find((t) => t.id === trip.id)!).length)
      .toBeGreaterThan(0)

    expect(() => services.progressTripStatus({
      actorUserId: HAULER_DRIVER_ACTOR,
      nextStatus: "completed",
      organizationId: HAULER_ORG,
      source: "driver",
      tripId: trip.id
    })).toThrow(/Attach the proof this haul needs/)

    attachTicket(services, trip.id)

    const closed = services.progressTripStatus({
      actorUserId: HAULER_DRIVER_ACTOR,
      nextStatus: "completed",
      organizationId: HAULER_ORG,
      source: "driver",
      tripId: trip.id
    })

    expect(closed.trip.status).toBe("completed")
  })

  it("closes a haul that has no ticket to give when an exception explains it", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)

    haulToDestination(services, trip.id)
    services.submitHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      deliveredQuantity: { unit: "tons", value: 0 },
      exception: { note: "Turned away: the scale was closed for the day.", type: "rejected_at_scale" },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })
    services.progressTripStatus({
      actorUserId: HAULER_DRIVER_ACTOR,
      nextStatus: "unloading",
      organizationId: HAULER_ORG,
      source: "driver",
      tripId: trip.id
    })

    // No scale ticket exists to attach; the exception is the record.
    const closed = services.progressTripStatus({
      actorUserId: HAULER_DRIVER_ACTOR,
      nextStatus: "completed",
      organizationId: HAULER_ORG,
      source: "driver",
      tripId: trip.id
    })

    expect(closed.trip.status).toBe("completed")
  })
})

describe("durable haul history", () => {
  it("keeps the delivered record, evidence, and events after settlement", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)

    haulToDestination(services, trip.id)
    attachTicket(services, trip.id)
    services.submitHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      deliveredQuantity: { ticketNumber: "SC-9", unit: "tons", value: 25.1 },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })
    services.progressTripStatus({
      actorUserId: HAULER_DRIVER_ACTOR,
      nextStatus: "unloading",
      organizationId: HAULER_ORG,
      source: "driver",
      tripId: trip.id
    })
    services.progressTripStatus({
      actorUserId: HAULER_DRIVER_ACTOR,
      nextStatus: "completed",
      organizationId: HAULER_ORG,
      source: "driver",
      tripId: trip.id
    })
    services.settleHaulCompletion({
      actorUserId: HOST_OWNER,
      decision: "confirm",
      organizationId: HOST_ORG,
      tripId: trip.id
    })

    const settled = services.state.tripsV2.find((current) => current.id === trip.id)

    expect(settled?.status).toBe("completed")
    expect(settled?.completionStatus).toBe("confirmed")
    expect(settled?.deliveredQuantity).toMatchObject({ ticketNumber: "SC-9", value: 25.1 })
    expect(services.listTripDocuments(trip.id).some((doc) => doc.type === "scale_ticket")).toBe(true)

    // The audit trail carries submission and confirmation, both attributed.
    const actions = services.state.auditEvents
      .filter((event) => event.entityId === trip.id)
      .map((event) => event.action)

    expect(actions).toContain("haul_completion_submitted")
    expect(actions).toContain("haul_completion_confirmed")
  })
})
