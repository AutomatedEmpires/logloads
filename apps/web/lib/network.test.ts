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

describe("trip document deliverability", () => {
  it("offers no download for a record that names a file nobody stored", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const legacy = services.state.tripDocuments[0]

    if (!legacy) throw new Error("the fixture has no pre-existing trip document")

    const trip = services.state.tripsV2.find((candidate) => candidate.id === legacy.tripId)
    const driver = services.state.driverProfiles.find((candidate) => candidate.id === trip?.driverProfileId)

    if (!trip || !driver) throw new Error("the legacy trip document fixture is incomplete")

    const view = buildNetworkView(
      services.state,
      { actorUserId: driver.userId, kind: "actor", organizationId: driver.companyId },
      new Date("2026-06-05T12:00:00.000Z")
    )
    const document = view.trips
      .find((candidate) => candidate.id === trip.id)
      ?.documents.find((candidate) => candidate.id === legacy.id)

    expect(document).toBeDefined()
    // This record claims `storageProvider: "cloudinary"` and carries a storage
    // key, but no file was ever uploaded — so keying the download on either of
    // those would render a link that 404s on the one screen that has to be
    // trustworthy. Stored bytes are the only honest signal.
    expect(legacy.storageProvider).toBe("cloudinary")
    expect(legacy.storageKey.length).toBeGreaterThan(0)
    expect(legacy.media ?? null).toBeNull()
    expect(document?.viewable).toBe(false)
  })
})

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

  it("shows a driver the host's source pack when their haul predates assignment snapshots", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    // A seeded accepted assignment: exactly the state of every in-flight haul
    // at deploy — the host published a pack, but not a per-assignment snapshot.
    const legacyAssignmentId = "ffffffff-ffff-4fff-8fff-fffffffffff1"
    const legacy = services.state.assignments.find((candidate) => candidate.id === legacyAssignmentId)
    const driver = services.state.driverProfiles.find((candidate) => candidate.id === legacy?.driverProfileId)
    const membership = services.state.organizationMemberships.find((candidate) =>
      candidate.userId === driver?.userId && candidate.status === "active"
    )

    expect(legacy && driver && membership).toBeTruthy()
    if (!legacy || !driver || !membership) return

    const viewer = {
      actorUserId: driver.userId,
      kind: "actor" as const,
      organizationId: membership.organizationId
    }
    const view = buildNetworkView(services.state, viewer, new Date("2026-06-05T12:00:00.000Z")).loads.find(
      (load) => load.id === legacy.loadPostingId
    )
    const served = services.getRoutePackForAssignment({
      actorUserId: driver.userId,
      assignmentId: legacyAssignmentId,
      organizationId: membership.organizationId
    }).routePack

    // The page must not tell the driver no briefing exists while the server
    // hands one over.
    expect(view?.access.unlocked).toBe(true)
    expect(view?.routePack).not.toBeNull()
    expect(view?.routePack?.id).toBe(served.id)
  })

  it("never shows a driver a route pack minted for another driver's assignment", () => {
    const { request, services, sourceContext, viewer } = networkFixture()
    const assignment = request()

    services.approveCapacityRequest({ ...sourceContext, assignmentId: assignment.id })

    const mintedForViewer = services.state.routePacks.find((pack) => pack.assignmentId === assignment.id)

    expect(mintedForViewer).toBeDefined()
    if (!mintedForViewer) return

    // Another driver in the same hauling organization. They may have their own
    // standing on this load, but they must never be handed the snapshot minted
    // for someone else's assignment — it carries that haul's entrance pin and
    // gate detail.
    const otherDriver = services.state.driverProfiles.find(
      (candidate) => candidate.id !== assignment.driverProfileId && candidate.companyId === viewer.organizationId
    )

    expect(otherDriver).toBeDefined()
    if (!otherDriver) return

    const view = buildNetworkView(
      services.state,
      { actorUserId: otherDriver.userId, kind: "actor", organizationId: viewer.organizationId },
      new Date("2026-06-05T12:00:00.000Z")
    ).loads.find((load) => load.id === assignment.loadPostingId)

    expect(view?.routePack?.id).not.toBe(mintedForViewer.id)
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
