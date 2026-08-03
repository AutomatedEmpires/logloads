import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices, type LogLoadsServices } from "./index"

// The seed fixtures live in early June 2026; pin the request clock inside
// that window. The clock is an explicit trusted option — never client input.
function requestJune(
  services: LogLoadsServices,
  input: Parameters<LogLoadsServices["requestCapacityWithPolicy"]>[0]
) {
  return services.requestCapacityWithPolicy(input, { at: "2026-06-05T12:00:00.000Z" })
}

describe("logloads services", () => {
  it("creates a valid load posting", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    const created = services.createLoadPosting({
      companyId: "33333333-3333-4333-8333-333333333332",
      dispatcherProfileId: "55555555-5555-4555-8555-555555555553",
      loaderProfileId: null,
      pickupLandingId: "66666666-6666-4666-8666-666666666662",
      driverPayCents: 52_500,
      dropoffMillId: "99999999-9999-4999-8999-999999999991",
      routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
      rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
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
        name: "Cole Cedar",
        phone: "555-3001",
        email: "dispatch@summit.example"
      },
      loaderContact: null
    })

    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
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
        driverPayCents: 52_500,
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

  it("mints an uncommitted request with a stable physical-movement identity", () => {
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

    expect(assignment.status).toBe("requested")
    expect(assignment.loadMovementId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    expect(assignment.loadMovementId).not.toBe(assignment.id)
    expect(assignment.billingModel).toBeNull()
    expect(assignment.billingCommittedAt).toBeNull()
  })

  it("reuses a released truck-slot movement identity for a replacement assignment", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const request = {
      cancellationReason: null,
      dispatcherNotes: "Replacement identity check.",
      driverProfileId: "44444444-4444-4444-8444-444444444441",
      loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      trailerProfileId: "88888888-8888-4888-8888-888888888881",
      truckProfileId: "77777777-7777-4777-8777-777777777771",
      truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2"
    }
    const first = services.requestAssignment(request)

    services.cancelAssignment(first.id, "Driver became unavailable")
    const replacement = services.requestAssignment(request)

    expect(replacement.id).not.toBe(first.id)
    expect(replacement.loadMovementId).toBe(first.loadMovementId)
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

  it("creates a real availability window during driver onboarding", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    const account = services.createAccount({
      accountType: "owner_operator",
      availabilityPreset: "three_days",
      email: "ready-driver@example.com",
      equipment: {
        maxPayloadTons: 30,
        trailerType: "pole_trailer",
        truckType: "log_truck"
      },
      fullName: "Ready Driver",
      organizationName: "Ready Driver Hauling",
      path: "driver",
      phone: "555-9001",
      region: "Cascade Foothills, OR"
    })
    const window = services.state.availabilityWindows.find(
      (current) => current.driverProfileId === account.driverProfileId
    )

    expect(window?.status).toBe("available")
    expect(Date.parse(window?.endAt ?? "") - Date.parse(window?.startAt ?? "")).toBeGreaterThanOrEqual(
      71 * 60 * 60 * 1000
    )
  })

  it("does not create false availability when a new driver is not ready", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    const account = services.createAccount({
      accountType: "company_driver",
      availabilityPreset: "not_ready",
      email: "not-ready-driver@example.com",
      equipment: {
        maxPayloadTons: 30,
        trailerType: "pole_trailer",
        truckType: "log_truck"
      },
      fullName: "Not Ready Driver",
      organizationName: null,
      path: "driver",
      phone: "555-9002",
      region: "Cascade Foothills, OR"
    })
    const driver = services.state.driverProfiles.find((current) => current.id === account.driverProfileId)

    expect(driver?.availabilityStatus).toBe("unavailable")
    expect(services.state.availabilityWindows.some((window) => window.driverProfileId === account.driverProfileId)).toBe(false)
  })

  it("starts a new host explicitly unenrolled with no silent legacy or paid entitlement", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const account = services.createAccount({
      accountType: "landing_operator",
      availabilityPreset: "not_ready",
      email: "launch-host@example.com",
      equipment: null,
      fullName: "Launch Host",
      organizationName: "Launch Landing",
      path: "host",
      phone: "555-9003",
      region: "Douglas County, OR"
    })
    const organizationId = account.memberships[0]?.organization.id
    const entitlement = services.state.entitlements.find((candidate) =>
      candidate.organizationId === organizationId && candidate.product === "landing_operations"
    )
    const billingAccount = services.state.organizationBillingAccounts.find(
      (candidate) => candidate.organizationId === organizationId
    )

    expect(entitlement).toBeUndefined()
    expect(billingAccount).toMatchObject({
      activationState: "unenrolled",
      billingModel: null,
      subscriptionId: null
    })
  })

  it("rejects an availability update for an unknown id", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    expect(() =>
      services.upsertAvailabilityWindow({
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        driverProfileId: "44444444-4444-4444-8444-444444444441",
        truckProfileId: "77777777-7777-4777-8777-777777777771",
        status: "available",
        startAt: "2026-06-08T18:00:00.000Z",
        endAt: "2026-06-08T19:00:00.000Z",
        preferredRouteIds: [],
        notes: "Unknown window.",
        recurringSchedule: null
      })
    ).toThrow(/was not found/)
  })

  it("rejects reservations against terminal truck slots", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const slot = services.state.truckSlots.find(
      (current) => current.id === "dddddddd-dddd-4ddd-8ddd-ddddddddddd2"
    )

    expect(slot).toBeDefined()
    if (!slot) {
      return
    }

    slot.status = "cancelled"

    expect(() =>
      services.requestAssignment({
        loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
        truckSlotId: slot.id,
        driverProfileId: "44444444-4444-4444-8444-444444444441",
        truckProfileId: "77777777-7777-4777-8777-777777777771",
        trailerProfileId: "88888888-8888-4888-8888-888888888881",
        cancellationReason: null,
        dispatcherNotes: "Terminal slot must reject the request."
      })
    ).toThrow(/cannot be reserved while cancelled/)
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


  it("shows private-network opportunities to connected organizations", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    const visible = services.listVisibleLoadsForOrganization("33333333-3333-4333-8333-333333333331")

    expect(visible.map((load) => load.id)).toContain("cccccccc-cccc-4ccc-8ccc-ccccccccccc3")
  })

  it("keeps expired operating records out of live load discovery", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const organizationId = "33333333-3333-4333-8333-333333333331"
    const beforeWindow = services.listRequestableLoadsForOrganization(
      organizationId,
      "2026-06-05T12:00:00.000Z"
    )
    const afterWindow = services.listRequestableLoadsForOrganization(
      organizationId,
      "2026-07-13T12:00:00.000Z"
    )

    expect(beforeWindow.length).toBeGreaterThan(0)
    expect(afterWindow).toEqual([])
    expect(services.listVisibleLoadsForOrganization(organizationId).length).toBeGreaterThan(0)
  })

  it("rejects a second active request for the same slot", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const request = (dispatcherNotes: string) =>
      requestJune(services, {
        actorUserId: "22222222-2222-4222-8222-222222222221",
        organizationId: "33333333-3333-4333-8333-333333333331",
        loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
        truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
        driverProfileId: "44444444-4444-4444-8444-444444444441",
        truckProfileId: "77777777-7777-4777-8777-777777777771",
        trailerProfileId: "88888888-8888-4888-8888-888888888881",
        cancellationReason: null,
        dispatcherNotes
      })

    // Self-contained rather than leaning on which slot the seed already holds:
    // take the slot, then take it again.
    request("First hold.")

    expect(() => request("Duplicate hold.")).toThrow(/active assignment request/)
  })

  it("allows a second slot on the same posting, because a posting is a series", () => {
    // This asserted the opposite until 2026-07-25. A posting is a series — six
    // loads on one route across two days is one posting with six slots — so
    // scoping uniqueness to the posting refused a driver taking Tuesday
    // morning after already holding Monday afternoon. That is ordinary work,
    // not a duplicate, and refusing it made the series model unusable.
    const services = createLogLoadsServices(createInMemoryDatabase())

    expect(() =>
      requestJune(services, {
        actorUserId: "22222222-2222-4222-8222-222222222221",
        organizationId: "33333333-3333-4333-8333-333333333331",
        loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
        truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
        driverProfileId: "44444444-4444-4444-8444-444444444441",
        truckProfileId: "77777777-7777-4777-8777-777777777771",
        trailerProfileId: "88888888-8888-4888-8888-888888888881",
        cancellationReason: null,
        dispatcherNotes: "Second slot, same series."
      })
    ).not.toThrow()
  })

  it("updates opportunity capacity when a connected hauler requests private work", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    const assignment = requestJune(services, {
      actorUserId: "22222222-2222-4222-8222-222222222221",
      organizationId: "33333333-3333-4333-8333-333333333331",
      loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
      truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd4",
      driverProfileId: "44444444-4444-4444-8444-444444444441",
      truckProfileId: "77777777-7777-4777-8777-777777777771",
      trailerProfileId: "88888888-8888-4888-8888-888888888881",
      cancellationReason: null,
      dispatcherNotes: "North Pine can cover the high-grade window."
    })
    const capacity = services.state.opportunityCapacities.find((item) => item.loadPostingId === assignment.loadPostingId)
    const load = services.state.loadPostings.find((item) => item.id === assignment.loadPostingId)
    const slot = services.state.truckSlots.find((item) => item.id === assignment.truckSlotId)
    const assignments = services.state.assignments.filter((item) => item.loadPostingId === assignment.loadPostingId)

    expect(assignment.status).toBe("requested")
    expect(capacity).toMatchObject({
      committedTruckloads: 4,
      completedTruckloads: 2,
      remainingTruckloads: 0,
      totalTruckloads: 4
    })
    expect(slot).toMatchObject({ capacity: 2, reservedCount: 2, status: "requested" })
    expect(assignments).toHaveLength(4)
    expect(assignments.filter((item) => item.status === "completed")).toHaveLength(2)
    expect(load?.status).toBe("filled")
  })

  it("rejects driver-role attempts to request work for another driver", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const driverMembership = services.state.organizationMemberships.find((membership) =>
      membership.organizationId === "33333333-3333-4333-8333-333333333331" &&
      membership.role === "driver" &&
      membership.status === "active"
    )
    const ownDriver = services.state.driverProfiles.find((driver) => driver.userId === driverMembership?.userId)
    const otherCombination = services.state.equipmentCombinations.find((combination) =>
      combination.organizationId === driverMembership?.organizationId &&
      combination.assignedDriverProfileId !== ownDriver?.id &&
      combination.status !== "inactive"
    )

    expect(driverMembership).toBeDefined()
    expect(ownDriver).toBeDefined()
    expect(otherCombination?.assignedDriverProfileId).toBeTruthy()
    if (!driverMembership || !otherCombination?.assignedDriverProfileId) return
    const otherDriverProfileId = otherCombination.assignedDriverProfileId

    expect(() => requestJune(services, {
      actorUserId: driverMembership.userId,
      driverProfileId: otherDriverProfileId,
      loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
      organizationId: driverMembership.organizationId,
      trailerProfileId: otherCombination.trailerProfileId,
      truckProfileId: otherCombination.truckProfileId,
      truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd4"
    })).toThrow(/own driver profile/)
  })

  it("rejects capacity requests against terminal loads", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const load = services.state.loadPostings.find(
      (posting) => posting.id === "cccccccc-cccc-4ccc-8ccc-ccccccccccc3"
    )

    expect(load).toBeDefined()
    if (!load) return
    load.status = "cancelled"

    expect(() => requestJune(services, {
      actorUserId: "22222222-2222-4222-8222-222222222221",
      driverProfileId: "44444444-4444-4444-8444-444444444441",
      loadPostingId: load.id,
      organizationId: "33333333-3333-4333-8333-333333333331",
      trailerProfileId: "88888888-8888-4888-8888-888888888881",
      truckProfileId: "77777777-7777-4777-8777-777777777771",
      truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd4"
    })).toThrow(/not accepting requests while cancelled/)
  })

  it("lets the source organization approve capacity and creates a trip snapshot", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const assignment = requestJune(services, {
      actorUserId: "22222222-2222-4222-8222-222222222221",
      organizationId: "33333333-3333-4333-8333-333333333331",
      loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
      truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd4",
      driverProfileId: "44444444-4444-4444-8444-444444444441",
      truckProfileId: "77777777-7777-4777-8777-777777777771",
      trailerProfileId: "88888888-8888-4888-8888-888888888881",
      cancellationReason: null,
      dispatcherNotes: "Approve this request."
    })

    const result = services.approveCapacityRequest({
      actorUserId: "22222222-2222-4222-8222-222222222224",
      organizationId: "33333333-3333-4333-8333-333333333332",
      assignmentId: assignment.id
    })

    expect(result.assignment.status).toBe("accepted")
    expect(result.assignment.termsSnapshot).toMatchObject({
      hostFee: {
        collectionState: "accrues_monthly_in_arrears",
        feeCents: null,
        providerCollectionState: "feature_gated",
        rateBps: 500,
        proposedRateBps: 500
      },
      paymentMode: "off_platform"
    })
    expect(result.trip.assignmentId).toBe(assignment.id)
    // The trip points at the snapshot minted for THIS assignment, not at the
    // host's mutable load-level source pack.
    const mintedPack = services.state.routePacks.find((pack) => pack.assignmentId === assignment.id)
    expect(mintedPack).toBeDefined()
    expect(result.trip.routePackId).toBe(mintedPack?.id)
    expect(services.state.notifications.find((notification) =>
      notification.relatedEntityId === assignment.id && notification.userId === "22222222-2222-4222-8222-222222222221"
    )?.type).toBe("assignment_confirmed")
  })

  it("freezes requested pay and refuses approval after the host changes it", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const assignment = requestJune(services, {
      actorUserId: "22222222-2222-4222-8222-222222222221",
      organizationId: "33333333-3333-4333-8333-333333333331",
      loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
      truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd4",
      driverProfileId: "44444444-4444-4444-8444-444444444441",
      truckProfileId: "77777777-7777-4777-8777-777777777771",
      trailerProfileId: "88888888-8888-4888-8888-888888888881"
    })
    const load = services.state.loadPostings.find(
      (candidate) => candidate.id === assignment.loadPostingId
    )!
    const requestedPay = assignment.termsSnapshot.driverPayCents
    const beforeApproval = structuredClone(services.state)

    expect(requestedPay).toBe(load.driverPayCents)
    expect(assignment.termsSnapshot.currency).toBe("USD")

    load.driverPayCents = (load.driverPayCents ?? 0) + 10_000
    load.updatedAt = "2026-06-05T13:00:00.000Z"

    expect(() =>
      services.approveCapacityRequest({
        actorUserId: "22222222-2222-4222-8222-222222222224",
        organizationId: "33333333-3333-4333-8333-333333333332",
        assignmentId: assignment.id
      })
    ).toThrow(/driver must request again/i)

    expect(
      services.state.assignments.find((candidate) => candidate.id === assignment.id)
    ).toMatchObject({
      status: "requested",
      termsSnapshot: { driverPayCents: requestedPay }
    })
    expect(
      services.state.tripsV2.some((candidate) => candidate.assignmentId === assignment.id)
    ).toBe(false)
    expect(
      services.state.truckSlots.find((candidate) => candidate.id === assignment.truckSlotId)
    ).toEqual(
      beforeApproval.truckSlots.find((candidate) => candidate.id === assignment.truckSlotId)
    )
  })

  it("does not consume an assignment or slot when approval validation fails", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const assignment = requestJune(services, {
      actorUserId: "22222222-2222-4222-8222-222222222221",
      organizationId: "33333333-3333-4333-8333-333333333331",
      loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
      truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd4",
      driverProfileId: "44444444-4444-4444-8444-444444444441",
      truckProfileId: "77777777-7777-4777-8777-777777777771",
      trailerProfileId: "88888888-8888-4888-8888-888888888881"
    })
    const load = services.state.loadPostings.find((candidate) => candidate.id === assignment.loadPostingId)!
    const slotBefore = structuredClone(services.state.truckSlots.find((candidate) => candidate.id === assignment.truckSlotId))

    services.state.rates = services.state.rates.filter((candidate) => candidate.id !== load.rateId)

    expect(() => services.approveCapacityRequest({
      actorUserId: "22222222-2222-4222-8222-222222222224",
      organizationId: "33333333-3333-4333-8333-333333333332",
      assignmentId: assignment.id
    })).toThrow(/rate/i)

    expect(services.state.assignments.find((candidate) => candidate.id === assignment.id)?.status).toBe("requested")
    expect(services.state.truckSlots.find((candidate) => candidate.id === assignment.truckSlotId)).toEqual(slotBefore)
    expect(services.state.tripsV2.some((candidate) => candidate.assignmentId === assignment.id)).toBe(false)
  })

  it("declines a capacity request, restores capacity, and records a durable driver decision", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const loadPostingId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3"
    const truckSlotId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd4"
    const beforeCapacity = services.state.opportunityCapacities.find((item) => item.loadPostingId === loadPostingId)
    const beforeSlot = services.state.truckSlots.find((item) => item.id === truckSlotId)
    const assignment = requestJune(services, {
      actorUserId: "22222222-2222-4222-8222-222222222221",
      organizationId: "33333333-3333-4333-8333-333333333331",
      loadPostingId,
      truckSlotId,
      driverProfileId: "44444444-4444-4444-8444-444444444441",
      truckProfileId: "77777777-7777-4777-8777-777777777771",
      trailerProfileId: "88888888-8888-4888-8888-888888888881"
    })

    const declined = services.declineCapacityRequest({
      actorUserId: "22222222-2222-4222-8222-222222222224",
      assignmentId: assignment.id,
      organizationId: "33333333-3333-4333-8333-333333333332",
      reason: "Another truck was selected for this window."
    })
    const afterCapacity = services.state.opportunityCapacities.find((item) => item.loadPostingId === loadPostingId)
    const afterSlot = services.state.truckSlots.find((item) => item.id === truckSlotId)

    expect(declined.status).toBe("declined")
    expect(declined.cancellationReason).toBe("Another truck was selected for this window.")
    expect(afterCapacity).toMatchObject({
      committedTruckloads: beforeCapacity?.committedTruckloads,
      remainingTruckloads: beforeCapacity?.remainingTruckloads
    })
    expect(afterSlot?.reservedCount).toBe(beforeSlot?.reservedCount)
    expect(services.state.tripsV2.some((trip) => trip.assignmentId === assignment.id)).toBe(false)
    expect(services.state.notifications.find((notification) =>
      notification.relatedEntityId === assignment.id && notification.userId === "22222222-2222-4222-8222-222222222221"
    )).toMatchObject({ title: "Not selected for this haul", type: "assignment_declined" })

    const requestedAgain = requestJune(services, {
      actorUserId: "22222222-2222-4222-8222-222222222221",
      organizationId: "33333333-3333-4333-8333-333333333331",
      loadPostingId,
      truckSlotId,
      driverProfileId: "44444444-4444-4444-8444-444444444441",
      truckProfileId: "77777777-7777-4777-8777-777777777771",
      trailerProfileId: "88888888-8888-4888-8888-888888888881"
    })

    expect(requestedAgain.status).toBe("requested")
  })

  it("allows only the source organization to decline a request", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const assignment = requestJune(services, {
      actorUserId: "22222222-2222-4222-8222-222222222221",
      organizationId: "33333333-3333-4333-8333-333333333331",
      loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
      truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd4",
      driverProfileId: "44444444-4444-4444-8444-444444444441",
      truckProfileId: "77777777-7777-4777-8777-777777777771",
      trailerProfileId: "88888888-8888-4888-8888-888888888881"
    })

    expect(() => services.declineCapacityRequest({
      actorUserId: "22222222-2222-4222-8222-222222222224",
      assignmentId: assignment.id,
      organizationId: "33333333-3333-4333-8333-333333333331",
      reason: "Not authorized"
    })).toThrow(/Only the source organization/)
  })

  it("cannot approve a request after it has been declined", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const assignment = requestJune(services, {
      actorUserId: "22222222-2222-4222-8222-222222222221",
      organizationId: "33333333-3333-4333-8333-333333333331",
      loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
      truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd4",
      driverProfileId: "44444444-4444-4444-8444-444444444441",
      truckProfileId: "77777777-7777-4777-8777-777777777771",
      trailerProfileId: "88888888-8888-4888-8888-888888888881"
    })

    services.declineCapacityRequest({
      actorUserId: "22222222-2222-4222-8222-222222222224",
      assignmentId: assignment.id,
      organizationId: "33333333-3333-4333-8333-333333333332"
    })

    expect(() => services.approveCapacityRequest({
      actorUserId: "22222222-2222-4222-8222-222222222224",
      assignmentId: assignment.id,
      organizationId: "33333333-3333-4333-8333-333333333332"
    })).toThrow(/requested or offered/)
  })

  it("protects route packs behind assignment participation", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    const routePack = services.getRoutePackForAssignment({
      actorUserId: "22222222-2222-4222-8222-222222222221",
      organizationId: "33333333-3333-4333-8333-333333333331",
      assignmentId: "ffffffff-ffff-4fff-8fff-fffffffffff1"
    })

    expect(routePack.routePack.id).toBe("23232323-2323-4323-8323-232323232311")
    expect(routePack.notices.length).toBeGreaterThanOrEqual(0)
  })

  it("keeps route packs locked for a requesting hauler until approval", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const assignment = requestJune(services, {
      actorUserId: "22222222-2222-4222-8222-222222222221",
      organizationId: "33333333-3333-4333-8333-333333333331",
      loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
      truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd4",
      driverProfileId: "44444444-4444-4444-8444-444444444441",
      truckProfileId: "77777777-7777-4777-8777-777777777771",
      trailerProfileId: "88888888-8888-4888-8888-888888888881"
    })

    expect(() => services.getRoutePackForAssignment({
      actorUserId: "22222222-2222-4222-8222-222222222221",
      organizationId: "33333333-3333-4333-8333-333333333331",
      assignmentId: assignment.id
    })).toThrow(/unlocks after the host accepts/)

    // Before approval there is no assignment snapshot yet, so the host sees
    // its own load-level source pack.
    expect(services.getRoutePackForAssignment({
      actorUserId: "22222222-2222-4222-8222-222222222224",
      organizationId: "33333333-3333-4333-8333-333333333332",
      assignmentId: assignment.id
    }).routePack.id).toBe("23232323-2323-4323-8323-232323232313")

    services.approveCapacityRequest({
      actorUserId: "22222222-2222-4222-8222-222222222224",
      assignmentId: assignment.id,
      organizationId: "33333333-3333-4333-8333-333333333332"
    })

    // Approval mints the driver's own snapshot of that source.
    const unlocked = services.getRoutePackForAssignment({
      actorUserId: "22222222-2222-4222-8222-222222222221",
      organizationId: "33333333-3333-4333-8333-333333333331",
      assignmentId: assignment.id
    }).routePack

    expect(unlocked.assignmentId).toBe(assignment.id)
    expect(unlocked.version).toBe(1)
    expect(unlocked.id).not.toBe("23232323-2323-4323-8323-232323232313")
  })

  it("rejects impossible trip transitions", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    expect(() =>
      services.progressTripStatus({
        actorUserId: "22222222-2222-4222-8222-222222222221",
        organizationId: "33333333-3333-4333-8333-333333333331",
        tripId: "24242424-2424-4424-8424-242424242411",
        nextStatus: "completed",
        source: "driver",
        note: "Cannot jump to complete.",
        metadata: {}
      })
    ).toThrow(/Invalid trip transition/)
  })

  it("creates operational notices and notifies active assigned drivers", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    const notice = services.createOperationalNotice({
      actorUserId: "22222222-2222-4222-8222-222222222224",
      organizationId: "33333333-3333-4333-8333-333333333331",
      relatedLoadId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      relatedLandingId: "66666666-6666-4666-8666-666666666661",
      severity: "watch",
      title: "Oak bridge access review",
      body: "Dispatcher review required before the next truck crosses the bridge."
    })

    const driverNotification = services.state.notifications.find((notification) =>
      notification.userId === "22222222-2222-4222-8222-222222222221" &&
      notification.relatedEntityId === notice.id
    )

    expect(notice.organizationId).toBe("33333333-3333-4333-8333-333333333331")
    expect(services.state.operationalNotices).toContain(notice)
    expect(driverNotification?.relatedEntityType).toBe("operational_notice")
    expect(driverNotification?.type).toBe("system_alert")
  })

  it("sends direct offers through active private-network relationships", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    services.state.directOffers = []

    const offer = services.createDirectOffer({
      actorUserId: "22222222-2222-4222-8222-222222222223",
      organizationId: "33333333-3333-4333-8333-333333333332",
      loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
      offeredToOrganizationId: "33333333-3333-4333-8333-333333333331",
      offeredTruckloads: 1,
      expiresAt: "2026-06-06T20:00:00.000Z"
    }, { at: "2026-06-05T12:00:00.000Z" })

    const targetNotification = services.state.notifications.find((notification) =>
      notification.userId === "22222222-2222-4222-8222-222222222224" &&
      notification.relatedEntityId === offer.id
    )

    expect(offer.status).toBe("sent")
    expect(offer.offeredByOrganizationId).toBe("33333333-3333-4333-8333-333333333332")
    expect(targetNotification?.relatedEntityType).toBe("direct_offer")
  })

  it("publishes future availability to trusted partners", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    const availability = services.publishFutureAvailability({
      actorUserId: "22222222-2222-4222-8222-222222222224",
      organizationId: "33333333-3333-4333-8333-333333333331",
      equipmentCombinationId: "18181818-1818-4818-8818-181818181811",
      startsAt: "2026-06-09T12:00:00.000Z",
      endsAt: "2026-06-09T22:00:00.000Z",
      status: "available",
      visibleToRelationshipIds: ["17171717-1717-4717-8717-171717171713"],
      notes: "NP-101 is open for a partner saw-log run."
    })

    const summitVisible = services
      .listFutureAvailabilityForOrganization("33333333-3333-4333-8333-333333333332")
      .some((current) => current.id === availability.id)

    expect(availability.organizationId).toBe("33333333-3333-4333-8333-333333333331")
    expect(summitVisible).toBe(true)
  })


})
