import { PRE_TRIP_INSPECTION_CHECKLIST } from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices, type LogLoadsServices } from "./index"

const HAULER_ORG = "33333333-3333-4333-8333-333333333331"
const HOST_ORG = "33333333-3333-4333-8333-333333333332"
const HAULER_DRIVER_ACTOR = "22222222-2222-4222-8222-222222222221"
const HOST_OWNER = "22222222-2222-4222-8222-222222222223"
const HOST_DISPATCHER = "22222222-2222-4222-8222-222222222224"
const DRIVER_PROFILE = "44444444-4444-4444-8444-444444444441"
const TRUCK_PROFILE = "77777777-7777-4777-8777-777777777771"
const TRAILER_PROFILE = "88888888-8888-4888-8888-888888888881"

const LOAD_DATE = "2026-06-25"
const WINDOW = `${LOAD_DATE}T12:00:00.000Z`

function bookRuntimeHaul(services: LogLoadsServices) {
  const load = services.createLoadPostingWithPolicy({
    accessRequirements: [],
    actorUserId: HOST_OWNER,
    campaignEndDate: null,
    campaignStartDate: null,
    companyId: HOST_ORG,
    dailyTruckCountNeeded: 1,
    dispatcherContact: { email: "dispatch@summit.example", name: "Cole Cedar", phone: "555-3001" },
    dispatcherProfileId: "55555555-5555-4555-8555-555555555553",
    driverPayCents: 52_500,
    dropoffMillId: "99999999-9999-4999-8999-999999999991",
    equipmentRequirements: ["pole-trailer"],
    estimatedTonsPerLoad: 27,
    loadDate: LOAD_DATE,
    loadType: "saw_logs",
    loaderContact: null,
    loaderProfileId: null,
    organizationId: HOST_ORG,
    pickupLandingId: "66666666-6666-4666-8666-666666666662",
    rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
    recurringSchedule: null,
    roadCondition: "good",
    routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    scheduleType: "one_off",
    status: "open",
    title: "Pre-trip inspection runtime load",
    weatherNotes: null
  })
  const slot = services.state.truckSlots.find((candidate) => candidate.loadPostingId === load.id)

  if (!slot) {
    throw new Error("The runtime load fixture did not create a loading slot")
  }

  services.upsertAvailabilityWindow({
    driverProfileId: DRIVER_PROFILE,
    endAt: `${LOAD_DATE}T23:59:00.000Z`,
    notes: "Pre-trip fixture window.",
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
  const approved = services.approveCapacityRequest({
    actorUserId: HOST_OWNER,
    assignmentId: assignment.id,
    organizationId: HOST_ORG
  })

  return { assignment, load, trip: approved.trip }
}

function allPassItems() {
  return PRE_TRIP_INSPECTION_CHECKLIST.map((item) => ({ key: item.key, note: null, status: "pass" as const }))
}

function itemsWithFailure(failKey: string, note: string | null) {
  return PRE_TRIP_INSPECTION_CHECKLIST.map((item) => ({
    key: item.key,
    note: item.key === failKey ? note : null,
    status: item.key === failKey ? ("fail" as const) : ("pass" as const)
  }))
}

function rollInput(tripId: string) {
  return {
    actorUserId: HAULER_DRIVER_ACTOR,
    nextStatus: "en_route_to_landing" as const,
    organizationId: HAULER_ORG,
    source: "driver" as const,
    tripId
  }
}

describe("pre-trip inspection gate", () => {
  it("refuses to roll a haul that has no recorded inspection", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookRuntimeHaul(services)

    expect(() => services.progressTripStatus(rollInput(trip.id))).toThrow(
      /Complete the pre-trip inspection before rolling/
    )
  })

  it("rolls after the assigned driver records a passing walk-around, and the record is real", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookRuntimeHaul(services)

    const { inspection } = services.recordPreTripInspection({
      actorUserId: HAULER_DRIVER_ACTOR,
      items: allPassItems(),
      organizationId: HAULER_ORG,
      tripId: trip.id
    })

    expect(inspection.outcome).toBe("pass")
    expect(inspection.performedByUserId).toBe(HAULER_DRIVER_ACTOR)
    expect(inspection.items).toHaveLength(PRE_TRIP_INSPECTION_CHECKLIST.length)
    expect(services.latestTripInspection(trip.id)?.id).toBe(inspection.id)
    expect(
      services.state.tripEvents.some((event) => event.tripId === trip.id && event.type === "pre_trip_inspection")
    ).toBe(true)
    expect(
      services.state.auditEvents.some(
        (event) => event.entityType === "trip_inspection" && event.entityId === inspection.id
      )
    ).toBe(true)

    const progressed = services.progressTripStatus(rollInput(trip.id))

    expect(progressed.trip.status).toBe("en_route_to_landing")
  })

  it("records a failed walk-around honestly: rig to the shop, dispatch notified, load flagged, rolling still refused", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { load, trip } = bookRuntimeHaul(services)

    const { inspection } = services.recordPreTripInspection({
      actorUserId: HAULER_DRIVER_ACTOR,
      items: itemsWithFailure("brakes", "Air pressure will not build past 60 psi"),
      organizationId: HAULER_ORG,
      tripId: trip.id
    })

    expect(inspection.outcome).toBe("fail")

    // The rig leaves matching.
    const combination = services.state.equipmentCombinations.find(
      (candidate) => candidate.id === trip.equipmentCombinationId
    )

    expect(trip.equipmentCombinationId).toBeTruthy()
    expect(combination?.status).toBe("maintenance")

    // Dispatch hears about it on both sides: the hauling organization's staff
    // and the dispatcher on the posting.
    const postingDispatcher = services.state.dispatcherProfiles.find(
      (profile) => profile.id === load.dispatcherProfileId
    )

    expect(postingDispatcher).toBeDefined()
    expect(
      services.state.notifications.some(
        (notification) =>
          notification.userId === postingDispatcher?.userId &&
          notification.title === "Truck out of service on your load" &&
          notification.relatedEntityId === load.id
      )
    ).toBe(true)
    expect(
      services.state.notifications.some(
        (notification) =>
          notification.userId === HOST_DISPATCHER &&
          notification.title === "Truck out of service" &&
          notification.relatedEntityId === load.id
      )
    ).toBe(true)

    // The load is flagged at risk where dispatch boards look.
    expect(
      services.state.operationalNotices.some(
        (notice) => notice.relatedLoadId === load.id && notice.severity === "critical"
      )
    ).toBe(true)
    expect(
      services.listAttentionItems(HOST_ORG).some((item) => item.relatedLoadId === load.id && item.severity === "critical")
    ).toBe(true)

    // And the truck still does not roll.
    expect(() => services.progressTripStatus(rollInput(trip.id))).toThrow(
      /The pre-trip inspection failed/
    )
  })

  it("supersedes a failed inspection with a re-inspection instead of editing it", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookRuntimeHaul(services)

    const failed = services.recordPreTripInspection({
      actorUserId: HAULER_DRIVER_ACTOR,
      items: itemsWithFailure("lights", "Left rear marker out"),
      organizationId: HAULER_ORG,
      tripId: trip.id
    })
    const passed = services.recordPreTripInspection({
      actorUserId: HAULER_DRIVER_ACTOR,
      items: allPassItems(),
      organizationId: HAULER_ORG,
      tripId: trip.id
    })

    const storedFailed = services.state.tripInspections.find((candidate) => candidate.id === failed.inspection.id)

    expect(storedFailed?.supersededAt).toBeTruthy()
    expect(services.latestTripInspection(trip.id)?.id).toBe(passed.inspection.id)
    expect(services.progressTripStatus(rollInput(trip.id)).trip.status).toBe("en_route_to_landing")
  })

  it("only the assigned driver records the walk-around — not the host, not the hauling dispatcher", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookRuntimeHaul(services)

    expect(() =>
      services.recordPreTripInspection({
        actorUserId: HOST_OWNER,
        items: allPassItems(),
        organizationId: HOST_ORG,
        tripId: trip.id
      })
    ).toThrow(/Only the assigned driver/)

    expect(() =>
      services.recordPreTripInspection({
        actorUserId: HOST_DISPATCHER,
        items: allPassItems(),
        organizationId: HAULER_ORG,
        tripId: trip.id
      })
    ).toThrow(/Only the assigned driver/)
  })

  it("refuses a partial checklist and a failure with no account of what failed", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookRuntimeHaul(services)

    expect(() =>
      services.recordPreTripInspection({
        actorUserId: HAULER_DRIVER_ACTOR,
        items: allPassItems().slice(1),
        organizationId: HAULER_ORG,
        tripId: trip.id
      })
    ).toThrow(/Answer every item/)

    expect(() =>
      services.recordPreTripInspection({
        actorUserId: HAULER_DRIVER_ACTOR,
        items: itemsWithFailure("tires", null),
        organizationId: HAULER_ORG,
        tripId: trip.id
      })
    ).toThrow(/Describe what failed/)

    expect(services.state.tripInspections).toHaveLength(0)
  })

  it("is recorded before rolling, not after", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookRuntimeHaul(services)

    services.recordPreTripInspection({
      actorUserId: HAULER_DRIVER_ACTOR,
      items: allPassItems(),
      organizationId: HAULER_ORG,
      tripId: trip.id
    })
    services.progressTripStatus(rollInput(trip.id))

    expect(() =>
      services.recordPreTripInspection({
        actorUserId: HAULER_DRIVER_ACTOR,
        items: allPassItems(),
        organizationId: HAULER_ORG,
        tripId: trip.id
      })
    ).toThrow(/before rolling/)
  })
})
