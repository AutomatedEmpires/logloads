import { describe, expect, it } from "vitest"

import { createLogLoadsServices, DomainRefusalError } from "."

const NORTH_PINE_ORG_ID = "33333333-3333-4333-8333-333333333331"
const SUMMIT_ORG_ID = "33333333-3333-4333-8333-333333333332"

const DISPATCHER_USER_ID = "22222222-2222-4222-8222-222222222224"
const HANK_USER_ID = "22222222-2222-4222-8222-222222222221"
const MAYA_USER_ID = "22222222-2222-4222-8222-222222222222"
const COLE_USER_ID = "22222222-2222-4222-8222-222222222223"
const LANDING_MANAGER_USER_ID = "22222222-2222-4222-8222-222222222225"

const HANK_DRIVER_ID = "44444444-4444-4444-8444-444444444441"
const MAYA_DRIVER_ID = "44444444-4444-4444-8444-444444444442"
const COLE_DRIVER_ID = "44444444-4444-4444-8444-444444444443"

const HANK_EQUIPMENT_ID = "18181818-1818-4818-8818-181818181811"
const MAYA_EQUIPMENT_ID = "18181818-1818-4818-8818-181818181812"
const COLE_EQUIPMENT_ID = "18181818-1818-4818-8818-181818181813"
const MISSING_ID = "99999999-9999-4999-8999-999999999999"

const HANK_ASSIGNMENT_ID = "ffffffff-ffff-4fff-8fff-fffffffffff1"
const COLE_ASSIGNMENT_ID = "ffffffff-ffff-4fff-8fff-fffffffffff3"
const HANK_TRIP_ID = "24242424-2424-4424-8424-242424242411"
const MAYA_TRIP_ID = "24242424-2424-4424-8424-242424242412"

function addInput(overrides: Record<string, unknown> = {}) {
  return {
    actorUserId: DISPATCHER_USER_ID,
    assignedDriverProfileId: MAYA_DRIVER_ID,
    homeRegion: "Cascade Foothills",
    label: "NP-303 test combination",
    maxPayloadTons: 30,
    organizationId: NORTH_PINE_ORG_ID,
    trailerType: "pole_trailer",
    truckMake: "Kenworth",
    truckModel: "T880",
    truckType: "log_truck",
    unitNumber: "NP-303",
    ...overrides
  }
}

function statusInput(overrides: Record<string, unknown> = {}) {
  return {
    actorUserId: DISPATCHER_USER_ID,
    combinationId: MAYA_EQUIPMENT_ID,
    organizationId: NORTH_PINE_ORG_ID,
    status: "available",
    ...overrides
  }
}

function assignmentInput(overrides: Record<string, unknown> = {}) {
  return {
    actorUserId: DISPATCHER_USER_ID,
    combinationId: MAYA_EQUIPMENT_ID,
    driverProfileId: HANK_DRIVER_ID,
    organizationId: NORTH_PINE_ORG_ID,
    ...overrides
  }
}

function withoutActor(input: Record<string, unknown>) {
  const copy = { ...input }
  delete copy.actorUserId
  return copy
}

describe("equipment mutation authorization", () => {
  it("requires an explicit actor for every equipment mutation", () => {
    const services = createLogLoadsServices()
    const before = structuredClone(services.state)

    expect(() => services.addEquipmentCombination(withoutActor(addInput()))).toThrow(/actorUserId/)
    expect(() => services.updateEquipmentStatus(withoutActor(statusInput()))).toThrow(/actorUserId/)
    expect(() => services.assignDriverToEquipment(withoutActor(assignmentInput()))).toThrow(/actorUserId/)
    expect(services.state).toEqual(before)
  })

  it.each(["rejected", "suspended"] as const)(
    "refuses equipment mutation when the organization is %s without partial writes",
    (verificationStatus) => {
      const services = createLogLoadsServices()
      const organization = services.state.organizations.find(
        (candidate) => candidate.id === NORTH_PINE_ORG_ID
      )

      if (!organization) {
        throw new Error("North Pine organization fixture missing")
      }

      organization.verificationStatus = verificationStatus
      const before = structuredClone(services.state)

      expect(() => services.addEquipmentCombination(addInput())).toThrow(/active member/)
      expect(() => services.updateEquipmentStatus(statusInput())).toThrow(/active member/)
      expect(() => services.assignDriverToEquipment(assignmentInput())).toThrow(/active member/)
      expect(services.state).toEqual(before)
    }
  )

  it("derives new equipment ownership and audit identity from the active manager actor", () => {
    const services = createLogLoadsServices()
    const before = {
      audits: services.state.auditEvents.length,
      combinations: services.state.equipmentCombinations.length,
      trailers: services.state.trailerProfiles.length,
      trucks: services.state.truckProfiles.length
    }

    const combination = services.addEquipmentCombination({
      ...addInput(),
      ownerUserId: COLE_USER_ID
    })
    const truck = services.state.truckProfiles.find((candidate) => candidate.id === combination.truckProfileId)
    const trailer = services.state.trailerProfiles.find((candidate) => candidate.id === combination.trailerProfileId)
    const audit = services.state.auditEvents.find((candidate) => candidate.entityId === combination.id)

    expect(services.state.truckProfiles).toHaveLength(before.trucks + 1)
    expect(services.state.trailerProfiles).toHaveLength(before.trailers + 1)
    expect(services.state.equipmentCombinations).toHaveLength(before.combinations + 1)
    expect(services.state.auditEvents).toHaveLength(before.audits + 1)
    expect(combination.assignedDriverProfileId).toBe(MAYA_DRIVER_ID)
    expect(truck?.ownerUserId).toBe(DISPATCHER_USER_ID)
    expect(trailer?.ownerUserId).toBe(DISPATCHER_USER_ID)
    expect(audit).toMatchObject({ action: "equipment_added", actorUserId: DISPATCHER_USER_ID })
  })

  it("rejects normalized duplicate unit numbers and malformed legacy duplicates without partial writes", () => {
    const services = createLogLoadsServices()
    const beforeConflict = structuredClone(services.state)

    const duplicateRequest = () =>
      services.addEquipmentCombination(addInput({
        label: "Visually duplicated unit",
        unitNumber: " np 101 "
      }))

    expect(duplicateRequest).toThrow(DomainRefusalError)
    expect(duplicateRequest).toThrow(/truck unit number is already in use/)
    expect(services.state).toEqual(beforeConflict)

    const existingTruck = services.state.truckProfiles.find(
      (candidate) =>
        candidate.companyId === NORTH_PINE_ORG_ID &&
        candidate.unitNumber === "NP-202"
    )
    if (!existingTruck) {
      throw new Error("Second North Pine truck fixture missing")
    }
    existingTruck.unitNumber = "NP 101"
    const beforeMalformedState = structuredClone(services.state)

    let malformedStateError: unknown

    try {
      services.addEquipmentCombination(addInput({
        label: "Otherwise valid new unit",
        unitNumber: "NP-404"
      }))
    } catch (error) {
      malformedStateError = error
    }

    expect(malformedStateError).toBeInstanceOf(Error)
    expect(malformedStateError).not.toBeInstanceOf(DomainRefusalError)
    expect((malformedStateError as Error).message).toMatch(/duplicate truck unit numbers/)
    expect(services.state).toEqual(beforeMalformedState)
  })

  it("treats a new unit number without letters or digits as a domain refusal", () => {
    const services = createLogLoadsServices()
    const before = structuredClone(services.state)
    const invalidRequest = () =>
      services.addEquipmentCombination(addInput({
        label: "Invalid unit",
        unitNumber: "---"
      }))

    expect(invalidRequest).toThrow(DomainRefusalError)
    expect(invalidRequest).toThrow(/must contain a letter or number/)
    expect(services.state).toEqual(before)
  })

  it("allows a driver to add equipment only when it is assigned to their own active same-org profile", () => {
    const services = createLogLoadsServices()

    const combination = services.addEquipmentCombination(addInput({
      actorUserId: MAYA_USER_ID,
      assignedDriverProfileId: MAYA_DRIVER_ID,
      label: "Maya self-service unit",
      unitNumber: "MAYA-2"
    }))
    const truck = services.state.truckProfiles.find((candidate) => candidate.id === combination.truckProfileId)

    expect(combination.assignedDriverProfileId).toBe(MAYA_DRIVER_ID)
    expect(truck?.ownerUserId).toBe(MAYA_USER_ID)
  })

  it.each([
    [null, /own active profile/],
    [HANK_DRIVER_ID, /own active profile/],
    [COLE_DRIVER_ID, /Driver profile not found for this organization/]
  ])("rejects driver self-service creation for target %s without partial writes", (assignedDriverProfileId, error) => {
    const services = createLogLoadsServices()
    const before = structuredClone(services.state)

    expect(() => services.addEquipmentCombination(addInput({
      actorUserId: MAYA_USER_ID,
      assignedDriverProfileId
    }))).toThrow(error)
    expect(services.state).toEqual(before)
  })

  it("requires an active actor profile and same-org active membership", () => {
    const inactiveUserServices = createLogLoadsServices()
    const inactiveUser = inactiveUserServices.state.profiles.find((candidate) => candidate.id === DISPATCHER_USER_ID)
    if (!inactiveUser) {
      throw new Error("Dispatcher fixture missing")
    }
    inactiveUser.isActive = false
    const beforeInactiveUser = structuredClone(inactiveUserServices.state)

    expect(() => inactiveUserServices.addEquipmentCombination(addInput())).toThrow(/not an active member/)
    expect(inactiveUserServices.state).toEqual(beforeInactiveUser)

    const inactiveMembershipServices = createLogLoadsServices()
    const membership = inactiveMembershipServices.state.organizationMemberships.find((candidate) =>
      candidate.organizationId === NORTH_PINE_ORG_ID && candidate.userId === DISPATCHER_USER_ID
    )
    if (!membership) {
      throw new Error("Dispatcher membership fixture missing")
    }
    membership.status = "suspended"
    const beforeInactiveMembership = structuredClone(inactiveMembershipServices.state)

    expect(() => inactiveMembershipServices.updateEquipmentStatus(statusInput())).toThrow(/not an active member/)
    expect(inactiveMembershipServices.state).toEqual(beforeInactiveMembership)
  })

  it("requires manage_trucks for manager equipment operations", () => {
    const services = createLogLoadsServices()
    const before = structuredClone(services.state)

    expect(() => services.addEquipmentCombination(addInput({
      actorUserId: LANDING_MANAGER_USER_ID,
      assignedDriverProfileId: null
    }))).toThrow(/cannot manage trucks/)
    expect(() => services.updateEquipmentStatus(statusInput({
      actorUserId: LANDING_MANAGER_USER_ID
    }))).toThrow(/cannot manage trucks/)
    expect(services.state).toEqual(before)
  })

  it("allows a driver to update only equipment assigned to their own active profile", () => {
    const services = createLogLoadsServices()

    const updated = services.updateEquipmentStatus(statusInput({
      actorUserId: MAYA_USER_ID,
      combinationId: MAYA_EQUIPMENT_ID,
      status: "available"
    }))

    expect(updated.status).toBe("available")
    expect(services.state.auditEvents.at(-1)).toMatchObject({
      action: "equipment_status_updated",
      actorUserId: MAYA_USER_ID,
      entityId: MAYA_EQUIPMENT_ID
    })

    const beforeRejected = structuredClone(services.state)
    expect(() => services.updateEquipmentStatus(statusInput({
      actorUserId: MAYA_USER_ID,
      combinationId: HANK_EQUIPMENT_ID,
      status: "available"
    }))).toThrow(/only update equipment assigned to their own active profile/)
    expect(services.state).toEqual(beforeRejected)
  })

  it("does not allow a driver to assign, reassign, or unassign equipment", () => {
    const services = createLogLoadsServices()
    const before = structuredClone(services.state)

    expect(() => services.assignDriverToEquipment(assignmentInput({
      actorUserId: MAYA_USER_ID,
      combinationId: MAYA_EQUIPMENT_ID,
      driverProfileId: null
    }))).toThrow(/cannot manage trucks/)
    expect(services.state).toEqual(before)
  })

  it("allows a manager with truck and driver permissions to reassign and unassign idle equipment", () => {
    const services = createLogLoadsServices()

    const reassigned = services.assignDriverToEquipment(assignmentInput())
    expect(reassigned.assignedDriverProfileId).toBe(HANK_DRIVER_ID)
    expect(services.state.auditEvents.at(-1)).toMatchObject({
      action: "equipment_driver_assigned",
      actorUserId: DISPATCHER_USER_ID,
      entityId: MAYA_EQUIPMENT_ID
    })

    const unassigned = services.assignDriverToEquipment(assignmentInput({ driverProfileId: null }))
    expect(unassigned.assignedDriverProfileId).toBeNull()
    expect(services.state.auditEvents.at(-1)).toMatchObject({
      action: "equipment_driver_unassigned",
      actorUserId: DISPATCHER_USER_ID,
      entityId: MAYA_EQUIPMENT_ID
    })
  })

  it.each(["inactive-user", "inactive-membership", "non-driving-membership", "foreign-profile"])(
    "rejects a %s target driver generically without state changes",
    (invalidTarget) => {
      const services = createLogLoadsServices()

      if (invalidTarget === "inactive-user") {
        const user = services.state.profiles.find((candidate) => candidate.id === HANK_USER_ID)
        if (!user) {
          throw new Error("Hank user fixture missing")
        }
        user.isActive = false
      } else if (invalidTarget === "inactive-membership") {
        const membership = services.state.organizationMemberships.find((candidate) =>
          candidate.organizationId === NORTH_PINE_ORG_ID && candidate.userId === HANK_USER_ID
        )
        if (!membership) {
          throw new Error("Hank membership fixture missing")
        }
        membership.status = "suspended"
      } else if (invalidTarget === "non-driving-membership") {
        const membership = services.state.organizationMemberships.find((candidate) =>
          candidate.organizationId === NORTH_PINE_ORG_ID && candidate.userId === HANK_USER_ID
        )
        if (!membership) {
          throw new Error("Hank membership fixture missing")
        }
        membership.role = "viewer"
      } else {
        const driver = services.state.driverProfiles.find((candidate) => candidate.id === HANK_DRIVER_ID)
        if (!driver) {
          throw new Error("Hank driver fixture missing")
        }
        driver.companyId = SUMMIT_ORG_ID
      }

      const before = structuredClone(services.state)
      expect(() => services.assignDriverToEquipment(assignmentInput())).toThrow(
        /Driver profile not found for this organization/
      )
      expect(services.state).toEqual(before)
    }
  )

  it("fails foreign combination and driver identifiers generically", () => {
    const services = createLogLoadsServices()
    const beforeForeignCombination = structuredClone(services.state)

    expect(() => services.updateEquipmentStatus(statusInput({
      combinationId: COLE_EQUIPMENT_ID
    }))).toThrow("Equipment not found for this organization")
    expect(() => services.assignDriverToEquipment(assignmentInput({
      combinationId: COLE_EQUIPMENT_ID
    }))).toThrow("Equipment not found for this organization")
    expect(() => services.updateEquipmentStatus(statusInput({
      combinationId: MISSING_ID
    }))).toThrow("Equipment not found for this organization")
    expect(services.state).toEqual(beforeForeignCombination)

    const beforeForeignDriver = structuredClone(services.state)
    expect(() => services.assignDriverToEquipment(assignmentInput({
      driverProfileId: COLE_DRIVER_ID
    }))).toThrow("Driver profile not found for this organization")
    expect(() => services.assignDriverToEquipment(assignmentInput({
      driverProfileId: MISSING_ID
    }))).toThrow("Driver profile not found for this organization")
    expect(services.state).toEqual(beforeForeignDriver)
  })

  it("validates a target driver before creating any truck, trailer, combination, or audit record", () => {
    const services = createLogLoadsServices()
    const before = structuredClone(services.state)

    expect(() => services.addEquipmentCombination(addInput({
      assignedDriverProfileId: COLE_DRIVER_ID
    }))).toThrow("Driver profile not found for this organization")
    expect(services.state).toEqual(before)
  })

  it("rejects a non-driving target membership before equipment creation begins", () => {
    const services = createLogLoadsServices()
    const membership = services.state.organizationMemberships.find((candidate) =>
      candidate.organizationId === NORTH_PINE_ORG_ID && candidate.userId === MAYA_USER_ID
    )
    if (!membership) {
      throw new Error("Maya membership fixture missing")
    }
    membership.role = "billing"
    const before = structuredClone(services.state)

    expect(() => services.addEquipmentCombination(addInput())).toThrow(
      "Driver profile not found for this organization"
    )
    expect(services.state).toEqual(before)
  })

  it("blocks parking while an accepted assignment uses the combination", () => {
    const services = createLogLoadsServices()
    const trip = services.state.tripsV2.find((candidate) => candidate.id === HANK_TRIP_ID)
    if (!trip) {
      throw new Error("Hank trip fixture missing")
    }
    trip.status = "cancelled"
    const before = structuredClone(services.state)

    expect(() => services.updateEquipmentStatus(statusInput({
      combinationId: HANK_EQUIPMENT_ID,
      status: "inactive"
    }))).toThrow(/active assignment or trip/)
    expect(services.state).toEqual(before)
  })

  it("allows In shop while an accepted assignment uses the combination, and flags the load honestly", () => {
    // Breakdowns happen mid-haul. The escape hatch goes through — and the
    // consequence is explicit: rig out of matching, dispatch notified on both
    // sides, load flagged at risk. Never silently stranded.
    const services = createLogLoadsServices()
    const trip = services.state.tripsV2.find((candidate) => candidate.id === HANK_TRIP_ID)
    if (!trip) {
      throw new Error("Hank trip fixture missing")
    }
    trip.status = "cancelled"
    const assignment = services.state.assignments.find((candidate) => candidate.id === HANK_ASSIGNMENT_ID)
    if (!assignment) {
      throw new Error("Hank assignment fixture missing")
    }

    // The driver declares their own truck down — the founder's scenario.
    const updated = services.updateEquipmentStatus(statusInput({
      actorUserId: HANK_USER_ID,
      combinationId: HANK_EQUIPMENT_ID,
      status: "maintenance"
    }))

    expect(updated.status).toBe("maintenance")
    expect(
      services.state.operationalNotices.some(
        (notice) => notice.relatedLoadId === assignment.loadPostingId && notice.severity === "critical"
      )
    ).toBe(true)
    expect(
      services.state.notifications.some(
        (notification) =>
          notification.relatedEntityId === assignment.loadPostingId &&
          notification.title.startsWith("Truck out of service")
      )
    ).toBe(true)
    expect(
      services.state.auditEvents.some(
        (event) =>
          event.entityId === HANK_EQUIPMENT_ID &&
          event.action === "equipment_status_updated" &&
          Array.isArray(event.metadata.flaggedLoadIds) &&
          (event.metadata.flaggedLoadIds as string[]).includes(assignment.loadPostingId)
      )
    ).toBe(true)
  })

  it("does not flag anything when In shop is set with no active work", () => {
    const services = createLogLoadsServices()
    const noticesBefore = services.state.operationalNotices.length
    const notificationsBefore = services.state.notifications.length

    const updated = services.updateEquipmentStatus(statusInput({ status: "maintenance" }))

    expect(updated.status).toBe("maintenance")
    expect(services.state.operationalNotices).toHaveLength(noticesBefore)
    expect(services.state.notifications).toHaveLength(notificationsBefore)
  })

  it("refuses NEW capacity requests for a rig that is In shop", () => {
    const services = createLogLoadsServices()

    services.updateEquipmentStatus(statusInput({
      actorUserId: HANK_USER_ID,
      combinationId: HANK_EQUIPMENT_ID,
      status: "maintenance"
    }))

    const candidates = services.state.loadPostings.filter((candidate) => candidate.status === "open")
    const pick = candidates
      .map((candidate) => ({
        load: candidate,
        slot: services.state.truckSlots.find(
          (slot) => slot.loadPostingId === candidate.id && slot.status === "open"
        )
      }))
      .find((entry) => entry.slot)

    expect(pick).toBeTruthy()
    if (!pick?.slot) return

    const { load, slot } = pick as { load: (typeof candidates)[number]; slot: NonNullable<typeof pick.slot> }

    const combination = services.state.equipmentCombinations.find(
      (candidate) => candidate.id === HANK_EQUIPMENT_ID
    )

    expect(() =>
      services.requestCapacityWithPolicy({
        actorUserId: HANK_USER_ID,
        driverProfileId: HANK_DRIVER_ID,
        loadPostingId: load.id,
        organizationId: NORTH_PINE_ORG_ID,
        trailerProfileId: combination?.trailerProfileId ?? null,
        truckProfileId: combination?.truckProfileId ?? "",
        truckSlotId: slot.id
      }, { at: slot.startAt })
    ).toThrow(/marked In shop/)
  })

  it("blocks reassigning or unassigning equipment used by an accepted assignment", () => {
    const services = createLogLoadsServices()
    const trip = services.state.tripsV2.find((candidate) => candidate.id === HANK_TRIP_ID)
    if (!trip) {
      throw new Error("Hank trip fixture missing")
    }
    trip.status = "cancelled"
    const before = structuredClone(services.state)

    expect(() => services.assignDriverToEquipment(assignmentInput({
      combinationId: HANK_EQUIPMENT_ID,
      driverProfileId: MAYA_DRIVER_ID
    }))).toThrow(/active assignment or trip/)
    expect(() => services.assignDriverToEquipment(assignmentInput({
      combinationId: HANK_EQUIPMENT_ID,
      driverProfileId: null
    }))).toThrow(/active assignment or trip/)
    expect(services.state).toEqual(before)
  })

  it.each(["requested", "offered"] as const)(
    "treats a %s assignment as active equipment use",
    (assignmentStatus) => {
      const services = createLogLoadsServices()
      const assignment = services.state.assignments.find((candidate) => candidate.id === COLE_ASSIGNMENT_ID)
      if (!assignment) {
        throw new Error("Cole assignment fixture missing")
      }
      assignment.status = assignmentStatus
      const before = structuredClone(services.state)
      const context = {
        actorUserId: COLE_USER_ID,
        combinationId: COLE_EQUIPMENT_ID,
        organizationId: SUMMIT_ORG_ID
      }

      expect(() => services.updateEquipmentStatus({ ...context, status: "inactive" })).toThrow(
        /active assignment or trip/
      )
      expect(() => services.assignDriverToEquipment({ ...context, driverProfileId: null })).toThrow(
        /active assignment or trip/
      )
      expect(services.state).toEqual(before)
    }
  )

  it("still treats an active trip as active use even after its assignment completed", () => {
    const services = createLogLoadsServices()
    const trip = services.state.tripsV2.find((candidate) => candidate.id === MAYA_TRIP_ID)
    if (!trip) {
      throw new Error("Maya trip fixture missing")
    }
    trip.status = "assigned"
    const assignment = services.state.assignments.find((candidate) => candidate.id === trip.assignmentId)
    if (!assignment) {
      throw new Error("Maya assignment fixture missing")
    }
    assignment.status = "completed"
    const before = structuredClone(services.state)

    // Parking and reassignment stay blocked; In shop goes through with the
    // load flagged, because the active trip is exactly the work at risk.
    expect(() => services.updateEquipmentStatus(statusInput({ status: "inactive" }))).toThrow(
      /active assignment or trip/
    )
    expect(() => services.assignDriverToEquipment(assignmentInput())).toThrow(/active assignment or trip/)
    expect(services.state).toEqual(before)

    services.updateEquipmentStatus(statusInput({ status: "maintenance" }))
    expect(
      services.state.operationalNotices.some(
        (notice) => notice.relatedLoadId === trip.loadPostingId && notice.severity === "critical"
      )
    ).toBe(true)
  })

  it("still allows non-disruptive status updates while equipment is in active use", () => {
    const services = createLogLoadsServices()

    const updated = services.updateEquipmentStatus(statusInput({
      combinationId: HANK_EQUIPMENT_ID,
      status: "committed"
    }))

    expect(updated.status).toBe("committed")
    expect(services.state.assignments.find((candidate) => candidate.id === HANK_ASSIGNMENT_ID)?.status).toBe("accepted")
  })
})
