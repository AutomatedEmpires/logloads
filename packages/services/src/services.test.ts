import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices } from "./index"

describe("logloads services", () => {
  it("creates a valid load posting", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    const created = services.createLoadPosting({
      companyId: "33333333-3333-4333-8333-333333333331",
      dispatcherProfileId: "55555555-5555-4555-8555-555555555551",
      loaderProfileId: "55555555-5555-4555-8555-555555555552",
      pickupLandingId: "66666666-6666-4666-8666-666666666661",
      dropoffMillId: "99999999-9999-4999-8999-999999999991",
      routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      title: "Extra afternoon run",
      loadType: "saw_logs",
      status: "open",
      scheduleType: "one_off",
      loadDate: "2026-06-10",
      campaignStartDate: null,
      campaignEndDate: null,
      recurringSchedule: null,
      dailyTruckCountNeeded: 1,
      estimatedTonsPerLoad: 27,
      equipmentRequirements: ["pole-trailer"],
      accessRequirements: ["radio"],
      roadCondition: "good",
      weatherNotes: null,
      dispatcherContact: {
        name: "Dana Dispatch",
        phone: "555-2001",
        email: "dispatch@northpine.example"
      },
      loaderContact: {
        name: "Lee Loader",
        phone: "555-2002",
        email: "loader@northpine.example"
      }
    })

    expect(created.id).toMatch(/^00000000-0000-4000-8000-/)
    expect(services.getLoadById(created.id)?.title).toBe("Extra afternoon run")
  })

  it("rejects invalid load data", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    expect(() =>
      services.createLoadPosting({
        companyId: "33333333-3333-4333-8333-333333333331",
        dispatcherProfileId: "55555555-5555-4555-8555-555555555551",
        loaderProfileId: null,
        pickupLandingId: "66666666-6666-4666-8666-666666666661",
        dropoffMillId: "99999999-9999-4999-8999-999999999991",
        routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        title: "",
        loadType: "saw_logs",
        status: "open",
        scheduleType: "one_off",
        loadDate: "2026-06-10",
        campaignStartDate: null,
        campaignEndDate: null,
        recurringSchedule: null,
        dailyTruckCountNeeded: 1,
        estimatedTonsPerLoad: 27,
        equipmentRequirements: [],
        accessRequirements: [],
        roadCondition: "good",
        weatherNotes: null,
        dispatcherContact: {
          name: "Dana Dispatch",
          phone: "555-2001",
          email: "dispatch@northpine.example"
        },
        loaderContact: null
      })
    ).toThrow()
  })

  it("moves an assignment from request to accepted", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const assignment = services.requestAssignment({
      loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
      driverProfileId: "44444444-4444-4444-8444-444444444441",
      truckProfileId: "77777777-7777-4777-8777-777777777771",
      trailerProfileId: "88888888-8888-4888-8888-888888888881",
      cancellationReason: null,
      dispatcherNotes: "Slot confirmed pending radio check."
    })

    const accepted = services.assignDriverToSlot(assignment.id)

    expect(assignment.status).toBe("requested")
    expect(accepted.status).toBe("accepted")
  })

  it("enforces truck slot capacity", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    expect(() =>
      services.requestAssignment({
        loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
        truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd3",
        driverProfileId: "44444444-4444-4444-8444-444444444442",
        truckProfileId: "77777777-7777-4777-8777-777777777772",
        trailerProfileId: "88888888-8888-4888-8888-888888888882",
        cancellationReason: null,
        dispatcherNotes: "Should fail because capacity is full."
      })
    ).toThrow(/at capacity/)
  })

  it("rejects overlapping availability windows for the same driver", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    expect(() =>
      services.upsertAvailabilityWindow({
        driverProfileId: "44444444-4444-4444-8444-444444444441",
        truckProfileId: "77777777-7777-4777-8777-777777777771",
        status: "available",
        startAt: "2026-06-06T18:00:00.000Z",
        endAt: "2026-06-06T19:00:00.000Z",
        preferredRouteIds: [],
        notes: "Conflicts with existing window.",
        recurringSchedule: null
      })
    ).toThrow(/overlaps existing window/)
  })

  it("releases slot capacity when an assignment is cancelled", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const assignment = services.requestAssignment({
      loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
      driverProfileId: "44444444-4444-4444-8444-444444444441",
      truckProfileId: "77777777-7777-4777-8777-777777777771",
      trailerProfileId: "88888888-8888-4888-8888-888888888881",
      cancellationReason: null,
      dispatcherNotes: "Temporary hold."
    })

    const cancelled = services.cancelAssignment(assignment.id, "Weather closure")
    const slot = services.listTruckSlotsForDate("2026-06-06").find((current) => current.id === "dddddddd-dddd-4ddd-8ddd-ddddddddddd2")

    expect(cancelled.status).toBe("cancelled")
    expect(cancelled.cancellationReason).toBe("Weather closure")
    expect(slot?.reservedCount).toBe(0)
    expect(slot?.status).toBe("open")
  })
})