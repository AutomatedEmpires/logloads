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
    const { load, request, services, sourceContext, viewer } = networkFixture()
    const details = services.state.richLandingDetails.find((item) => item.landingId === load.pickupLandingId)
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
    expect(accepted?.landing.lat).toBe(details?.entranceLat)
    expect(accepted?.landing.lng).toBe(details?.entranceLng)
    expect(accepted?.criticalInstructions.length).toBeGreaterThan(0)
    expect(accepted?.routePack).not.toBeNull()
  })

  it("keeps a host viewer out of exact location and instruction fields", () => {
    const { load, services, sourceContext } = networkFixture()
    const membership = services.state.organizationMemberships.find(
      (item) =>
        item.userId === sourceContext.actorUserId &&
        item.organizationId === sourceContext.organizationId
    )

    expect(membership).toBeDefined()
    if (!membership) return
    membership.role = "viewer"

    const view = buildNetworkView(services.state, {
      actorUserId: sourceContext.actorUserId,
      kind: "actor",
      organizationId: sourceContext.organizationId
    }, new Date("2026-06-05T12:00:00.000Z")).loads.find((candidate) => candidate.id === load.id)

    expect(view?.access).toEqual({ reason: "locked", unlocked: false })
    expect(view?.landing.approximate).toBe(true)
    expect(view?.landingDetails?.gateInstructions).toBeNull()
    expect(view?.criticalInstructions).toEqual([])
    expect(view?.routePack).toBeNull()
  })

  it("lets operational staff with their own driver profile open a coworker's accepted briefing", () => {
    const { load, request, services, sourceContext, viewer } = networkFixture()
    const assignment = request()
    services.approveCapacityRequest({ ...sourceContext, assignmentId: assignment.id })

    const staffUserId = services.state.profiles.find((profile) => profile.email === "maya@northpine.example")?.id
    const staffMembership = services.state.organizationMemberships.find(
      (item) => item.userId === staffUserId && item.organizationId === viewer.organizationId
    )

    expect(staffUserId).toBeDefined()
    expect(staffMembership).toBeDefined()
    if (!staffUserId || !staffMembership) return
    staffMembership.role = "fleet_manager"

    const view = buildNetworkView(services.state, {
      actorUserId: staffUserId,
      kind: "actor",
      organizationId: staffMembership.organizationId
    }, new Date("2026-06-05T12:00:00.000Z")).loads.find((candidate) => candidate.id === load.id)

    expect(view?.access).toEqual({ reason: "assigned", unlocked: true })
    expect(view?.landing.approximate).toBe(false)
    expect(view?.landingDetails?.gateInstructions).toBeTruthy()
    expect(view?.routePack).not.toBeNull()
    expect(view?.viewerAssignment).toBeNull()
  })

  it("keeps an accepted driver's map and gate on the issued pack until reissue", () => {
    const { load, request, services, sourceContext, viewer } = networkFixture()
    const assignment = request()
    services.approveCapacityRequest({ ...sourceContext, assignmentId: assignment.id })

    const issued = buildNetworkView(services.state, viewer, new Date("2026-06-05T12:00:00.000Z")).loads.find(
      (candidate) => candidate.id === load.id
    )
    const issuedGate = issued?.landingDetails?.gateInstructions

    services.state.richLandingDetails = services.state.richLandingDetails.map((details) =>
      details.landingId === load.pickupLandingId
        ? {
            ...details,
            entranceLat: 10,
            entranceLng: 20,
            gateInstructions: "NEW GATE AFTER BRIEFING EDIT"
          }
        : details
    )

    const beforeReissue = buildNetworkView(
      services.state,
      viewer,
      new Date("2026-06-05T12:00:00.000Z")
    ).loads.find((candidate) => candidate.id === load.id)

    expect(beforeReissue?.landing.lat).toBe(issued?.landing.lat)
    expect(beforeReissue?.landing.lng).toBe(issued?.landing.lng)
    expect(beforeReissue?.landingDetails?.gateInstructions).toBe(issuedGate)
    expect(beforeReissue?.criticalInstructions).not.toContain("Gate: NEW GATE AFTER BRIEFING EDIT")

    services.refreshRoutePackForAssignment({
      ...sourceContext,
      assignmentId: assignment.id
    })

    const afterReissue = buildNetworkView(
      services.state,
      viewer,
      new Date("2026-06-05T12:00:00.000Z")
    ).loads.find((candidate) => candidate.id === load.id)

    expect(afterReissue?.landing).toMatchObject({ approximate: false, lat: 10, lng: 20 })
    expect(afterReissue?.landingDetails?.gateInstructions).toBe("NEW GATE AFTER BRIEFING EDIT")
    expect(afterReissue?.routePack?.version).toBe(2)
  })

  it("does not unlock rich details controlled by another organization", () => {
    const { load, request, services, sourceContext, viewer } = networkFixture()
    const landing = services.state.landings.find((item) => item.id === load.pickupLandingId)

    services.state.richLandingDetails = services.state.richLandingDetails.map((details) =>
      details.landingId === load.pickupLandingId
        ? {
            ...details,
            controlledByOrganizationId: viewer.organizationId,
            entranceLat: 10,
            entranceLng: 20,
            gateInstructions: "FOREIGN GATE SECRET"
          }
        : details
    )

    const assignment = request()
    services.approveCapacityRequest({ ...sourceContext, assignmentId: assignment.id })

    const accepted = buildNetworkView(services.state, viewer, new Date("2026-06-05T12:00:00.000Z")).loads.find(
      (candidate) => candidate.id === assignment.loadPostingId
    )

    expect(accepted?.landingDetails).toBeNull()
    expect(accepted?.criticalInstructions).not.toContain("Gate: FOREIGN GATE SECRET")
    expect(accepted?.landing.lat).toBe(landing?.coordinates.lat)
    expect(accepted?.landing.lng).toBe(landing?.coordinates.lng)
  })

  it("does not choose between duplicate owned landing briefings", () => {
    const { load, request, services, sourceContext, viewer } = networkFixture()
    const landing = services.state.landings.find((item) => item.id === load.pickupLandingId)
    const original = services.state.richLandingDetails.find((details) => details.landingId === load.pickupLandingId)

    expect(original).toBeDefined()
    if (!original) return
    services.state.richLandingDetails.push({
      ...original,
      gateInstructions: "CONFLICTING GATE SECRET",
      id: "4f4f4f4f-4f4f-4f4f-8f4f-4f4f4f4f4f01"
    })

    const assignment = request()
    services.approveCapacityRequest({ ...sourceContext, assignmentId: assignment.id })
    const accepted = buildNetworkView(services.state, viewer, new Date("2026-06-05T12:00:00.000Z")).loads.find(
      (candidate) => candidate.id === assignment.loadPostingId
    )

    expect(accepted?.landingDetails).toBeNull()
    expect(accepted?.landing.lat).toBe(landing?.coordinates.lat)
    expect(accepted?.landing.lng).toBe(landing?.coordinates.lng)
    expect(accepted?.routePack?.instructions.some((instruction) =>
      instruction.detail === "CONFLICTING GATE SECRET" || instruction.detail === original.gateInstructions
    )).toBe(false)
    expect(accepted?.routePack?.snapshot?.originEntranceLat).toBe(landing?.coordinates.lat)
    expect(accepted?.routePack?.snapshot?.originEntranceLng).toBe(landing?.coordinates.lng)
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

  it("never serves a pre-guard Route Pack whose stored source ids cross organizations", () => {
    const { request, services, sourceContext, viewer } = networkFixture()
    const assignment = request()

    services.approveCapacityRequest({ ...sourceContext, assignmentId: assignment.id })
    const stored = services.state.routePacks.find((pack) => pack.assignmentId === assignment.id)

    expect(stored).toBeDefined()
    if (!stored) return

    stored.landingId = "66666666-6666-4666-8666-666666666661"

    const current = buildNetworkView(
      services.state,
      viewer,
      new Date("2026-06-05T12:00:00.000Z")
    ).loads.find((load) => load.id === assignment.loadPostingId)

    expect(current?.access.unlocked).toBe(true)
    expect(current?.routePack?.id).not.toBe(stored.id)
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

describe("direct-offer network views", () => {
  function participantViewers(services: ReturnType<typeof createLogLoadsServices>) {
    const targetActor = services.state.profiles.find((profile) => profile.email === "dispatch@northpine.example")
    const sourceActor = services.state.profiles.find((profile) => profile.email === "cole@summit.example")
    const offer = services.state.directOffers[0]

    if (!targetActor || !sourceActor || !offer) throw new Error("Direct-offer participants are missing")

    return {
      sourceViewer: {
        actorUserId: sourceActor.id,
        kind: "actor" as const,
        organizationId: offer.offeredByOrganizationId
      },
      targetViewer: {
        actorUserId: targetActor.id,
        kind: "actor" as const,
        organizationId: offer.offeredToOrganizationId
      }
    }
  }

  it("serializes offers only to participants and makes expiry effective on discovery", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { sourceViewer, targetViewer } = participantViewers(services)
    const loadId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc8"
    const capacity = services.state.opportunityCapacities.find((item) => item.loadPostingId === loadId)
    const targetAtSend = buildNetworkView(services.state, targetViewer, new Date("2026-06-05T12:00:00.000Z"))
    const sourceAtSend = buildNetworkView(services.state, sourceViewer, new Date("2026-06-05T12:00:00.000Z"))

    const targetPartial = targetAtSend.directOffers.find((offer) => offer.id === "29292929-2929-4929-8929-292929292915")
    const sourcePartial = sourceAtSend.directOffers.find((offer) => offer.id === "29292929-2929-4929-8929-292929292915")

    expect(targetPartial).toMatchObject({
      acceptedTruckloads: 1,
      actionable: true,
      direction: "received",
      offeredTruckloads: 2,
      remainingTruckloads: 1,
      status: "sent"
    })
    expect(sourcePartial).toMatchObject({ direction: "sent", status: "sent" })
    expect(targetAtSend.directOffers.map((offer) => offer.status)).toEqual(
      expect.arrayContaining(["sent", "declined", "revoked", "expired"])
    )

    const unrelatedOrganizationId = "33333333-3333-4333-8333-333333333333"
    const unrelatedUser = services.state.profiles.find((profile) => profile.email === "loader@northpine.example")
    const templateOrganization = services.state.organizations[0]
    const templateMembership = services.state.organizationMemberships[0]
    if (!templateOrganization || !templateMembership || !capacity || !unrelatedUser) {
      throw new Error("Direct-offer view fixture is incomplete")
    }
    services.state.organizations.push({
      ...templateOrganization,
      displayName: "Unrelated Fleet",
      id: unrelatedOrganizationId,
      legalName: "Unrelated Fleet LLC",
      slug: "unrelated-fleet"
    })
    services.state.organizationMemberships.push({
      ...templateMembership,
      id: "16161616-1616-4616-8616-161616161620",
      organizationId: unrelatedOrganizationId,
      role: "dispatcher",
      userId: unrelatedUser.id
    })
    const unrelated = buildNetworkView(
      services.state,
      { actorUserId: unrelatedUser.id, kind: "actor", organizationId: unrelatedOrganizationId },
      new Date("2026-06-05T12:00:00.000Z")
    )
    expect(unrelated.directOffers).toEqual([])

    capacity.visibilityMode = "direct_offer"
    const expired = buildNetworkView(services.state, targetViewer, new Date("2026-06-07T12:00:00.000Z"))

    expect(expired.directOffers.find((offer) => offer.id === "29292929-2929-4929-8929-292929292915"))
      .toMatchObject({ actionable: false, status: "expired" })
    // The unused invitation expires, while the truckload already accepted from
    // that offer keeps its participant-scoped operating record visible.
    expect(expired.loads.some((load) => load.id === loadId)).toBe(true)
  })

  it("starts from partial acceptance and completes the remaining offered truckload", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { targetViewer } = participantViewers(services)
    const load = services.state.loadPostings.find((candidate) => candidate.id === "cccccccc-cccc-4ccc-8ccc-ccccccccccc8")
    if (!load) throw new Error("Direct-offer claim fixture is incomplete")

    const beforeClaim = buildNetworkView(
      services.state,
      targetViewer,
      new Date("2026-06-05T12:00:00.000Z")
    ).directOffers.find((candidate) => candidate.id === "29292929-2929-4929-8929-292929292915")

    expect(beforeClaim).toMatchObject({
      acceptedTruckloads: 1,
      actionable: true,
      remainingTruckloads: 1,
      status: "sent"
    })

    const accepted = services.claimDirectOffer({
      actorUserId: targetViewer.actorUserId,
      directOfferId: "29292929-2929-4929-8929-292929292915",
      equipmentCombinationId: "18181818-1818-4818-8818-181818181811",
      organizationId: targetViewer.organizationId,
      truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd7"
    }, { at: "2026-06-05T12:00:00.000Z" })
    const view = buildNetworkView(services.state, targetViewer, new Date("2026-06-05T12:00:00.000Z"))
    const offer = view.directOffers.find((candidate) => candidate.id === accepted.directOffer.id)
    const networkLoad = view.loads.find((candidate) => candidate.id === load.id)

    expect(offer).toMatchObject({
      acceptedTruckloads: 2,
      actionable: false,
      remainingTruckloads: 0,
      status: "accepted"
    })
    expect(services.state.opportunityCapacities.find((candidate) => candidate.loadPostingId === load.id))
      .toMatchObject({ committedTruckloads: 2, completedTruckloads: 1, remainingTruckloads: 0, totalTruckloads: 2 })
    expect(services.state.loadPostings.find((candidate) => candidate.id === load.id)?.status).toBe("filled")
    expect(networkLoad?.access).toEqual({ reason: "assigned", unlocked: true })
    expect(networkLoad?.routePack?.id).toBe(accepted.trip.routePackId)
    expect(networkLoad?.routePack?.snapshot?.originEntranceLat).toBeTypeOf("number")
  })
})
