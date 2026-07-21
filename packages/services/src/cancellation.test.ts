import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices, type LogLoadsServices } from "./index"
import { stubTripDocumentMedia } from "./test-helpers"

const HAULER_ORG = "33333333-3333-4333-8333-333333333331"
const HOST_ORG = "33333333-3333-4333-8333-333333333332"
const HAULER_ACTOR = "22222222-2222-4222-8222-222222222221"
const HOST_ACTOR = "22222222-2222-4222-8222-222222222224"
const DRIVER_PROFILE = "44444444-4444-4444-8444-444444444441"
const TRUCK_PROFILE = "77777777-7777-4777-8777-777777777771"
const TRAILER_PROFILE = "88888888-8888-4888-8888-888888888881"
const SEED_LOAD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3"
const SEED_SLOT = "dddddddd-dddd-4ddd-8ddd-ddddddddddd4"
const SEED_WINDOW = "2026-06-05T12:00:00.000Z"

const FRESH_LOAD_DATE = "2026-06-25"
const FRESH_WINDOW = `${FRESH_LOAD_DATE}T12:00:00.000Z`

function requestSeedLoad(services: LogLoadsServices) {
  return services.requestCapacityWithPolicy({
    actorUserId: HAULER_ACTOR,
    organizationId: HAULER_ORG,
    loadPostingId: SEED_LOAD,
    truckSlotId: SEED_SLOT,
    driverProfileId: DRIVER_PROFILE,
    truckProfileId: TRUCK_PROFILE,
    trailerProfileId: TRAILER_PROFILE
  }, { at: SEED_WINDOW })
}

/**
 * Publishes a fresh host-owned load with its own capacity ledger and loading
 * slot, plus driver availability covering the window, so tests can exercise
 * the full request -> approve -> haul -> cancel/complete loop end to end.
 */
function publishFreshLoad(services: LogLoadsServices, dailyTruckCountNeeded = 1, companyId = HOST_ORG) {
  const sources = companyId === HOST_ORG
    ? {
        dispatcherContact: { name: "Cole Cedar", phone: "555-3001", email: "dispatch@summit.example" },
        dispatcherProfileId: "55555555-5555-4555-8555-555555555553",
        pickupLandingId: "66666666-6666-4666-8666-666666666662",
        rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
        routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"
      }
    : {
        dispatcherContact: { name: "Dana Dispatch", phone: "555-2001", email: "dispatch@northpine.example" },
        dispatcherProfileId: "55555555-5555-4555-8555-555555555551",
        pickupLandingId: "66666666-6666-4666-8666-666666666661",
        rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
      }
  const load = services.createLoadPosting({
    companyId,
    dispatcherProfileId: sources.dispatcherProfileId,
    loaderProfileId: null,
    pickupLandingId: sources.pickupLandingId,
    dropoffMillId: "99999999-9999-4999-8999-999999999991",
    routeId: sources.routeId,
    rateId: sources.rateId,
    title: "Cancellation loop fixture",
    loadType: "saw_logs",
    status: "open",
    scheduleType: "one_off",
    loadDate: FRESH_LOAD_DATE,
    campaignStartDate: null,
    campaignEndDate: null,
    recurringSchedule: null,
    dailyTruckCountNeeded,
    estimatedTonsPerLoad: 27,
    equipmentRequirements: ["pole-trailer"],
    accessRequirements: [],
    roadCondition: "good",
    weatherNotes: null,
    dispatcherContact: sources.dispatcherContact,
    loaderContact: null
  })
  const slot = services.state.truckSlots.find((candidate) => candidate.loadPostingId === load.id)

  if (!slot) {
    throw new Error("The fresh load fixture did not create a loading slot")
  }

  services.upsertAvailabilityWindow({
    driverProfileId: DRIVER_PROFILE,
    truckProfileId: TRUCK_PROFILE,
    status: "available",
    startAt: `${FRESH_LOAD_DATE}T00:00:00.000Z`,
    endAt: `${FRESH_LOAD_DATE}T23:59:00.000Z`,
    preferredRouteIds: [],
    notes: "Fixture window for the cancellation loop.",
    recurringSchedule: null
  })

  return { load, slot }
}

function requestFreshLoad(services: LogLoadsServices, loadPostingId: string, truckSlotId: string) {
  return services.requestCapacityWithPolicy({
    actorUserId: HAULER_ACTOR,
    organizationId: HAULER_ORG,
    loadPostingId,
    truckSlotId,
    driverProfileId: DRIVER_PROFILE,
    truckProfileId: TRUCK_PROFILE,
    trailerProfileId: TRAILER_PROFILE
  }, { at: FRESH_WINDOW })
}

function capacityFor(services: LogLoadsServices, loadPostingId: string) {
  return services.state.opportunityCapacities.find((candidate) => candidate.loadPostingId === loadPostingId)
}

function loadFor(services: LogLoadsServices, loadPostingId: string) {
  return services.state.loadPostings.find((candidate) => candidate.id === loadPostingId)
}

describe("assignment cancellation", () => {
  it("lets the hauler withdraw a pending request and restores slot and capacity", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const capacityBefore = capacityFor(services, SEED_LOAD)
    const slotBefore = services.state.truckSlots.find((candidate) => candidate.id === SEED_SLOT)
    const assignment = requestSeedLoad(services)

    const result = services.cancelAssignmentWithPolicy({
      actorUserId: HAULER_ACTOR,
      assignmentId: assignment.id,
      organizationId: HAULER_ORG,
      reason: "Truck went down."
    })

    expect(result.assignment.status).toBe("cancelled")
    expect(result.assignment.cancellationReason).toBe("Truck went down.")
    expect(result.trip).toBeNull()

    const capacityAfter = capacityFor(services, SEED_LOAD)
    const slotAfter = services.state.truckSlots.find((candidate) => candidate.id === SEED_SLOT)

    expect(capacityAfter?.committedTruckloads).toBe(capacityBefore?.committedTruckloads)
    expect(capacityAfter?.remainingTruckloads).toBe(capacityBefore?.remainingTruckloads)
    expect(slotAfter?.reservedCount).toBe(slotBefore?.reservedCount)

    const load = loadFor(services, SEED_LOAD)
    const dispatcher = services.state.dispatcherProfiles.find((profile) => profile.id === load?.dispatcherProfileId)
    const notification = services.state.notifications.find((candidate) =>
      candidate.relatedEntityId === assignment.id && candidate.type === "assignment_cancelled"
    )

    expect(notification?.userId).toBe(dispatcher?.userId)

    const requestedAgain = requestSeedLoad(services)

    expect(requestedAgain.status).toBe("requested")
  })

  it("lets the host cancel a booked haul, cancelling the trip and reopening the load", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { load, slot } = publishFreshLoad(services)
    const assignment = requestFreshLoad(services, load.id, slot.id)

    expect(loadFor(services, load.id)?.status).toBe("filled")

    services.approveCapacityRequest({
      actorUserId: HOST_ACTOR,
      assignmentId: assignment.id,
      organizationId: HOST_ORG
    })

    const result = services.cancelAssignmentWithPolicy({
      actorUserId: HOST_ACTOR,
      assignmentId: assignment.id,
      organizationId: HOST_ORG,
      reason: "The landing closed for weather."
    })

    expect(result.assignment.status).toBe("cancelled")
    expect(result.trip?.status).toBe("cancelled")

    const capacity = capacityFor(services, load.id)
    const slotAfter = services.state.truckSlots.find((candidate) => candidate.id === slot.id)

    expect(capacity?.committedTruckloads).toBe(0)
    expect(capacity?.remainingTruckloads).toBe(1)
    expect(slotAfter?.reservedCount).toBe(0)
    expect(slotAfter?.status).toBe("open")
    expect(loadFor(services, load.id)?.status).toBe("open")

    const driverNotification = services.state.notifications.find((candidate) =>
      candidate.relatedEntityId === assignment.id &&
      candidate.type === "assignment_cancelled" &&
      candidate.userId === HAULER_ACTOR
    )

    expect(driverNotification?.title).toBe("Haul cancelled")

    const requestedAgain = requestFreshLoad(services, load.id, slot.id)

    expect(requestedAgain.status).toBe("requested")
  })

  it("keeps cancellation inside the assignment's participants", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const assignment = requestSeedLoad(services)
    const outsider = services.createAccount({
      accountType: "small_fleet",
      availabilityPreset: "not_ready",
      email: "outside-fleet@example.com",
      equipment: null,
      fullName: "Outside Fleet",
      organizationName: "Outside Fleet LLC",
      path: "fleet",
      phone: "555-9100",
      region: "Elsewhere, OR"
    })
    const outsiderOrgId = outsider.memberships[0]?.organization.id

    expect(outsiderOrgId).toBeTruthy()
    if (!outsiderOrgId) return

    expect(() => services.cancelAssignmentWithPolicy({
      actorUserId: outsider.profile.id,
      assignmentId: assignment.id,
      organizationId: outsiderOrgId
    })).toThrow(/not a participant/)
  })

  it("keeps a driver from cancelling another driver's haul", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const assignment = requestSeedLoad(services)
    const otherDriverMembership = services.state.organizationMemberships.find((membership) =>
      membership.organizationId === HAULER_ORG &&
      membership.role === "driver" &&
      membership.status === "active" &&
      membership.userId !== HAULER_ACTOR
    )

    expect(otherDriverMembership).toBeDefined()
    if (!otherDriverMembership) return

    expect(() => services.cancelAssignmentWithPolicy({
      actorUserId: otherDriverMembership.userId,
      assignmentId: assignment.id,
      organizationId: HAULER_ORG
    })).toThrow(/own hauls/)
  })

  it("refuses to cancel a completed haul and closes a fully delivered load", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { load, slot } = publishFreshLoad(services)
    const assignment = requestFreshLoad(services, load.id, slot.id)
    const { trip } = services.approveCapacityRequest({
      actorUserId: HOST_ACTOR,
      assignmentId: assignment.id,
      organizationId: HOST_ORG
    })

    // The destination requires a scale ticket; a haul no longer closes without
    // the proof its Route Pack demanded.
    services.attachTripDocument({
      actorUserId: HAULER_ACTOR,
      filename: "scale-ticket.jpg",
      media: stubTripDocumentMedia(trip.id),
      organizationId: HAULER_ORG,
      tripId: trip.id,
      type: "scale_ticket"
    })

    const steps = [
      "en_route_to_landing",
      "checked_in",
      "loading",
      "loaded",
      "en_route_to_destination",
      "at_destination",
      "unloading",
      "completed"
    ] as const

    for (const nextStatus of steps) {
      services.progressTripStatus({
        actorUserId: HAULER_ACTOR,
        organizationId: HAULER_ORG,
        tripId: trip.id,
        nextStatus,
        source: "driver"
      })
    }

    expect(loadFor(services, load.id)?.status).toBe("completed")
    expect(capacityFor(services, load.id)?.completedTruckloads).toBe(1)

    expect(() => services.cancelAssignmentWithPolicy({
      actorUserId: HOST_ACTOR,
      assignmentId: assignment.id,
      organizationId: HOST_ORG
    })).toThrow(/Only an active assignment/)
  })

  it("cancelling a trip cancels the booking, restores capacity, and allows a re-request", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { load, slot } = publishFreshLoad(services)
    const assignment = requestFreshLoad(services, load.id, slot.id)
    const { trip } = services.approveCapacityRequest({
      actorUserId: HOST_ACTOR,
      assignmentId: assignment.id,
      organizationId: HOST_ORG
    })

    services.progressTripStatus({
      actorUserId: HAULER_ACTOR,
      organizationId: HAULER_ORG,
      tripId: trip.id,
      nextStatus: "en_route_to_landing",
      source: "driver"
    })
    services.progressTripStatus({
      actorUserId: HAULER_ACTOR,
      organizationId: HAULER_ORG,
      tripId: trip.id,
      nextStatus: "cancelled",
      note: "Road washed out below the landing.",
      source: "driver"
    })

    const assignmentAfter = services.state.assignments.find((candidate) => candidate.id === assignment.id)
    const capacity = capacityFor(services, load.id)
    const slotAfter = services.state.truckSlots.find((candidate) => candidate.id === slot.id)

    expect(assignmentAfter?.status).toBe("cancelled")
    expect(assignmentAfter?.cancellationReason).toBe("Road washed out below the landing.")
    expect(capacity?.committedTruckloads).toBe(0)
    expect(capacity?.remainingTruckloads).toBe(1)
    expect(slotAfter?.reservedCount).toBe(0)
    expect(loadFor(services, load.id)?.status).toBe("open")

    // The trip surface writes the same audit record as the policy surface.
    const audit = services.state.auditEvents.find((event) =>
      event.entityId === assignment.id && event.action === "assignment_cancelled"
    )

    expect(audit?.metadata).toMatchObject({ cancelledBy: "hauler", loadPostingId: load.id })

    const load2 = loadFor(services, load.id)
    const dispatcher = services.state.dispatcherProfiles.find((profile) => profile.id === load2?.dispatcherProfileId)
    const dispatcherNotification = services.state.notifications.find((candidate) =>
      candidate.relatedEntityId === assignment.id &&
      candidate.type === "assignment_cancelled" &&
      candidate.userId === dispatcher?.userId
    )

    expect(dispatcherNotification).toBeDefined()

    const requestedAgain = requestFreshLoad(services, load.id, slot.id)

    expect(requestedAgain.status).toBe("requested")
  })

  it("keeps an org-mate driver from cancelling a teammate's haul through the trip path", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { load, slot } = publishFreshLoad(services)
    const assignment = requestFreshLoad(services, load.id, slot.id)
    const { trip } = services.approveCapacityRequest({
      actorUserId: HOST_ACTOR,
      assignmentId: assignment.id,
      organizationId: HOST_ORG
    })
    const otherDriverMembership = services.state.organizationMemberships.find((membership) =>
      membership.organizationId === HAULER_ORG &&
      membership.role === "driver" &&
      membership.status === "active" &&
      membership.userId !== HAULER_ACTOR
    )

    expect(otherDriverMembership).toBeDefined()
    if (!otherDriverMembership) return

    expect(() => services.progressTripStatus({
      actorUserId: otherDriverMembership.userId,
      organizationId: HAULER_ORG,
      tripId: trip.id,
      nextStatus: "cancelled",
      source: "driver"
    })).toThrow(/own hauls/)

    expect(services.state.tripsV2.find((candidate) => candidate.id === trip.id)?.status).toBe("assigned")
    expect(services.state.assignments.find((candidate) => candidate.id === assignment.id)?.status).toBe("accepted")
  })

  it("lets a host organization's own driver withdraw their own-org request", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { load, slot } = publishFreshLoad(services, 1, HAULER_ORG)
    const assignment = requestFreshLoad(services, load.id, slot.id)

    const result = services.cancelAssignmentWithPolicy({
      actorUserId: HAULER_ACTOR,
      assignmentId: assignment.id,
      organizationId: HAULER_ORG
    })

    expect(result.assignment.status).toBe("cancelled")
    expect(capacityFor(services, load.id)?.remainingTruckloads).toBe(1)

    const notification = services.state.notifications.find((candidate) =>
      candidate.relatedEntityId === assignment.id && candidate.type === "assignment_cancelled"
    )

    expect(notification?.title).toBe("Request withdrawn")
  })

  it("caps the cancellation reason server-side", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const assignment = requestSeedLoad(services)

    expect(() => services.cancelAssignmentWithPolicy({
      actorUserId: HAULER_ACTOR,
      assignmentId: assignment.id,
      organizationId: HAULER_ORG,
      reason: "x".repeat(141)
    })).toThrow(/under 140 characters/)
  })

  it("rejects a capacity request whose haul window has already passed", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    expect(() => services.requestCapacityWithPolicy({
      actorUserId: HAULER_ACTOR,
      organizationId: HAULER_ORG,
      loadPostingId: SEED_LOAD,
      truckSlotId: SEED_SLOT,
      driverProfileId: DRIVER_PROFILE,
      truckProfileId: TRUCK_PROFILE,
      trailerProfileId: TRAILER_PROFILE
    }, { at: "2026-07-13T12:00:00.000Z" })).toThrow(/haul window has already passed/)
  })

  it("ignores a client-smuggled clock in the request input", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    // A REST caller spreading JSON into the input must not be able to move
    // the validation clock: `at` inside the input is dead weight, and with
    // no trusted option the real (post-fixture) clock rejects the request.
    const smuggled = {
      actorUserId: HAULER_ACTOR,
      at: SEED_WINDOW,
      organizationId: HAULER_ORG,
      loadPostingId: SEED_LOAD,
      truckSlotId: SEED_SLOT,
      driverProfileId: DRIVER_PROFILE,
      truckProfileId: TRUCK_PROFILE,
      trailerProfileId: TRAILER_PROFILE
    } as unknown as Parameters<LogLoadsServices["requestCapacityWithPolicy"]>[0]

    expect(() => services.requestCapacityWithPolicy(smuggled)).toThrow(/haul window has already passed/)
  })

  it("marks a fully committed load as filled and keeps a partially reserved day requestable", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { load, slot } = publishFreshLoad(services, 2)
    const assignment = requestFreshLoad(services, load.id, slot.id)

    expect(loadFor(services, load.id)?.status).toBe("open")

    services.approveCapacityRequest({
      actorUserId: HOST_ACTOR,
      assignmentId: assignment.id,
      organizationId: HOST_ORG
    })

    const slotAfter = services.state.truckSlots.find((candidate) => candidate.id === slot.id)

    expect(slotAfter?.status).toBe("reserved")
    expect(slotAfter?.reservedCount).toBe(1)
    expect(services.isLoadRequestableAt(loadFor(services, load.id)!, FRESH_WINDOW)).toBe(true)
    expect(
      services.listRequestableLoadsForOrganization(HAULER_ORG, FRESH_WINDOW).some((candidate) => candidate.id === load.id)
    ).toBe(true)
  })
})
