import { createInMemoryDatabase } from "@logloads/db"
import { createLogLoadsServices } from "@logloads/services"
import { describe, expect, it } from "vitest"

import { buildNetworkView } from "./network"

function networkFixture() {
  const services = createLogLoadsServices(createInMemoryDatabase())
  const driverUser = services.state.profiles.find((profile) => profile.email === "hank@northpine.example")
  const driver = services.state.driverProfiles.find((profile) => profile.userId === driverUser?.id)
  const equipment = services.state.equipmentCombinations.find(
    (combination) => combination.assignedDriverProfileId === driver?.id
  )
  const load = services.state.loadPostings.find((posting) => posting.title === "Blue River high-grade campaign")
  const slot = services.state.truckSlots.find(
    (current) => current.loadPostingId === load?.id && current.reservedCount < current.capacity
  )
  const sourceMembership = services.state.organizationMemberships.find((membership) =>
    membership.organizationId === load?.companyId &&
    membership.status === "active" &&
    ["owner", "admin", "dispatcher", "fleet_manager"].includes(membership.role)
  )

  if (!driverUser || !driver || !equipment || !load || !slot || !sourceMembership) {
    throw new Error("The network access fixture is incomplete")
  }

  const viewer = {
    actorUserId: driverUser.id,
    kind: "actor" as const,
    organizationId: equipment.organizationId
  }
  const request = () => services.requestCapacityWithPolicy({
    actorUserId: viewer.actorUserId,
    driverProfileId: driver.id,
    loadPostingId: load.id,
    organizationId: viewer.organizationId,
    trailerProfileId: equipment.trailerProfileId,
    truckProfileId: equipment.truckProfileId,
    truckSlotId: slot.id
  }, { at: "2026-06-05T12:00:00.000Z" })
  const sourceContext = {
    actorUserId: sourceMembership.userId,
    organizationId: load.companyId
  }

  return { load, request, services, sourceContext, viewer }
}

describe("driver network access", () => {
  it("keeps exact load access locked while a request is pending and unlocks it after approval", () => {
    const { request, services, sourceContext, viewer } = networkFixture()
    const assignment = request()
    const pending = buildNetworkView(services.state, viewer, new Date("2026-06-05T12:00:00.000Z")).loads.find(
      (load) => load.id === assignment.loadPostingId
    )

    expect(pending?.viewerAssignment?.status).toBe("requested")
    expect(pending?.access.unlocked).toBe(false)
    expect(pending?.landing.approximate).toBe(true)
    expect(pending?.landingDetails?.gateInstructions).toBeNull()
    expect(pending?.criticalInstructions).toEqual([])
    expect(pending?.routePack).toBeNull()

    services.approveCapacityRequest({
      ...sourceContext,
      assignmentId: assignment.id
    })

    const accepted = buildNetworkView(services.state, viewer, new Date("2026-06-05T12:00:00.000Z")).loads.find(
      (load) => load.id === assignment.loadPostingId
    )

    expect(accepted?.viewerAssignment?.status).toBe("accepted")
    expect(accepted?.access.unlocked).toBe(true)
    expect(accepted?.landing.approximate).toBe(false)
    expect(accepted?.criticalInstructions.length).toBeGreaterThan(0)
    expect(accepted?.routePack).not.toBeNull()
  })

  it("keeps a declined request visible as a driver decision without treating it as active", () => {
    const { request, services, sourceContext, viewer } = networkFixture()
    const assignment = request()

    services.declineCapacityRequest({
      ...sourceContext,
      assignmentId: assignment.id,
      reason: "A different truck was selected."
    })

    const declined = buildNetworkView(services.state, viewer, new Date("2026-06-05T12:00:00.000Z")).loads.find(
      (load) => load.id === assignment.loadPostingId
    )

    expect(declined?.viewerAssignment).toBeNull()
    expect(declined?.viewerDecision).toMatchObject({
      id: assignment.id,
      reason: "A different truck was selected.",
      status: "declined"
    })
    expect(declined?.access.unlocked).toBe(false)
  })

  it("supersedes a declined decision when the driver requests the load again", () => {
    const { request, services, sourceContext, viewer } = networkFixture()
    const declinedAssignment = request()

    services.declineCapacityRequest({
      ...sourceContext,
      assignmentId: declinedAssignment.id,
      reason: "A different truck was selected."
    })
    const requestedAgain = request()
    const current = buildNetworkView(services.state, viewer, new Date("2026-06-05T12:00:00.000Z")).loads.find(
      (load) => load.id === requestedAgain.loadPostingId
    )

    expect(current?.viewerAssignment).toMatchObject({ id: requestedAgain.id, status: "requested" })
    expect(current?.viewerDecision).toBeNull()
  })

  it("never labels a terminal load as available", () => {
    const { load, services, viewer } = networkFixture()
    load.status = "cancelled"

    const current = buildNetworkView(services.state, viewer, new Date("2026-06-05T12:00:00.000Z")).loads.find(
      (candidate) => candidate.id === load.id
    )

    expect(current?.discovery.available).toBe(false)
    expect(current?.discovery.reason).toBe("not_requestable")
  })
})
