import { describe, expect, it } from "vitest"

import { createInMemoryDatabase } from "@logloads/db"

import { createLogLoadsServices } from "./index"

const AT = "2026-06-05T12:00:00.000Z"
const OFFER_ID = "29292929-2929-4929-8929-292929292911"
const LOAD_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3"
const TARGET_ORGANIZATION_ID = "33333333-3333-4333-8333-333333333331"
const SOURCE_ORGANIZATION_ID = "33333333-3333-4333-8333-333333333332"
const TARGET_DISPATCHER_ID = "22222222-2222-4222-8222-222222222224"
const SOURCE_OWNER_ID = "22222222-2222-4222-8222-222222222223"
const FIRST_COMBINATION_ID = "18181818-1818-4818-8818-181818181811"
const SECOND_COMBINATION_ID = "18181818-1818-4818-8818-181818181812"
const FIRST_SLOT_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd4"
const SECOND_SLOT_ID = "d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4"
const THIRD_SLOT_ID = "d5d5d5d5-d5d5-4d5d-8d5d-d5d5d5d5d5d5"

function directOfferServices() {
  const services = createLogLoadsServices(createInMemoryDatabase())
  const load = services.state.loadPostings.find((candidate) => candidate.id === LOAD_ID)

  if (!load) throw new Error("Direct-offer test load is missing")

  // These tests target lifecycle integrity, not a particular seed equipment
  // tag. Compatibility is exercised by the normal request policy underneath.
  load.accessRequirements = []
  load.equipmentRequirements = []

  return services
}

function claimInput(equipmentCombinationId = FIRST_COMBINATION_ID, truckSlotId = FIRST_SLOT_ID) {
  return {
    actorUserId: TARGET_DISPATCHER_ID,
    directOfferId: OFFER_ID,
    equipmentCombinationId,
    organizationId: TARGET_ORGANIZATION_ID,
    truckSlotId
  }
}

function makeSecondRigAvailable(services: ReturnType<typeof directOfferServices>) {
  const combination = services.state.equipmentCombinations.find((candidate) => candidate.id === SECOND_COMBINATION_ID)
  const truck = services.state.truckProfiles.find((candidate) => candidate.id === combination?.truckProfileId)
  const trailer = services.state.trailerProfiles.find((candidate) => candidate.id === combination?.trailerProfileId)
  const sourceSlot = services.state.truckSlots.find((candidate) => candidate.id === FIRST_SLOT_ID)

  if (!combination || !truck || !trailer || !sourceSlot) throw new Error("Second direct-offer test rig is missing")

  combination.status = "available"
  combination.truckTypes = ["log_truck"]
  combination.trailerTypes = ["pole_trailer"]
  truck.truckType = "log_truck"
  trailer.trailerType = "pole_trailer"
  services.state.truckSlots.push({
    ...sourceSlot,
    capacity: 1,
    endAt: "2026-06-06T16:20:00.000Z",
    id: SECOND_SLOT_ID,
    reservedCount: 0,
    startAt: "2026-06-06T16:00:00.000Z",
    status: "open"
  })
}

describe("direct-offer lifecycle", () => {
  it("claims one truck atomically and makes an identical retry idempotent", () => {
    const services = directOfferServices()
    const before = {
      assignments: services.state.assignments.length,
      audits: services.state.auditEvents.length,
      capacity: services.state.opportunityCapacities.find((item) => item.loadPostingId === LOAD_ID),
      events: services.state.tripEvents.length,
      notifications: services.state.notifications.length,
      packs: services.state.routePacks.length,
      slot: services.state.truckSlots.find((item) => item.id === FIRST_SLOT_ID),
      trips: services.state.tripsV2.length
    }

    const accepted = services.claimDirectOffer(claimInput(), { at: AT })
    const capacity = services.state.opportunityCapacities.find((item) => item.loadPostingId === LOAD_ID)
    const slot = services.state.truckSlots.find((item) => item.id === FIRST_SLOT_ID)
    const pack = services.state.routePacks.find((item) => item.assignmentId === accepted.assignment.id)

    expect(accepted.assignment.status).toBe("accepted")
    expect(accepted.assignment.directOfferId).toBe(OFFER_ID)
    expect(accepted.assignment.termsSnapshot.acceptanceSource).toBe("direct_offer")
    expect(accepted.trip.assignmentId).toBe(accepted.assignment.id)
    expect(accepted.trip.routePackId).toBe(pack?.id)
    expect(accepted.directOffer.status).toBe("sent")
    expect(services.state.assignments).toHaveLength(before.assignments + 1)
    expect(services.state.tripsV2).toHaveLength(before.trips + 1)
    expect(services.state.routePacks).toHaveLength(before.packs + 1)
    expect(services.state.tripEvents).toHaveLength(before.events + 1)
    expect(services.state.auditEvents.length).toBeGreaterThanOrEqual(before.audits + 3)
    expect(services.state.notifications.length).toBeGreaterThanOrEqual(before.notifications + 2)
    expect(capacity?.committedTruckloads).toBe((before.capacity?.committedTruckloads ?? 0) + 1)
    expect(capacity?.remainingTruckloads).toBe((before.capacity?.remainingTruckloads ?? 0) - 1)
    expect(slot?.reservedCount).toBe((before.slot?.reservedCount ?? 0) + 1)
    expect(services.state.notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ relatedEntityId: accepted.assignment.id, userId: "22222222-2222-4222-8222-222222222221" }),
      expect.objectContaining({ relatedEntityId: OFFER_ID, userId: SOURCE_OWNER_ID })
    ]))

    const afterFirstClaim = structuredClone(services.state)
    const retried = services.claimDirectOffer(claimInput(), { at: AT })

    expect(retried.assignment.id).toBe(accepted.assignment.id)
    expect(retried.trip.id).toBe(accepted.trip.id)
    expect(services.state).toEqual(afterFirstClaim)
  })

  it("keeps a multi-truck offer open until distinct claims fill its exact limit", () => {
    const services = directOfferServices()
    makeSecondRigAvailable(services)

    const first = services.claimDirectOffer(claimInput(), { at: AT })
    const second = services.claimDirectOffer(claimInput(SECOND_COMBINATION_ID, SECOND_SLOT_ID), { at: AT })

    expect(first.directOffer.status).toBe("sent")
    expect(second.directOffer.status).toBe("accepted")
    expect(services.state.assignments.filter((assignment) => assignment.directOfferId === OFFER_ID)).toHaveLength(2)

    const sourceSlot = services.state.truckSlots.find((candidate) => candidate.id === SECOND_SLOT_ID)
    if (!sourceSlot) throw new Error("Second test slot is missing")
    services.state.truckSlots.push({
      ...sourceSlot,
      endAt: "2026-06-06T17:20:00.000Z",
      id: THIRD_SLOT_ID,
      reservedCount: 0,
      startAt: "2026-06-06T17:00:00.000Z",
      status: "open"
    })
    const beforeThirdClaim = structuredClone(services.state)

    expect(() => services.claimDirectOffer(claimInput(FIRST_COMBINATION_ID, THIRD_SLOT_ID), { at: AT }))
      .toThrow(/no longer actionable/)
    expect(services.state).toEqual(beforeThirdClaim)
  })

  it("does not reopen a fully accepted offer after its assignment is cancelled", () => {
    const services = directOfferServices()
    const offer = services.state.directOffers.find((candidate) => candidate.id === OFFER_ID)
    if (!offer) throw new Error("Seed direct offer is missing")
    offer.offeredTruckloads = 1

    const accepted = services.claimDirectOffer(claimInput(), { at: AT })
    services.cancelAssignmentWithPolicy({
      actorUserId: TARGET_DISPATCHER_ID,
      assignmentId: accepted.assignment.id,
      organizationId: TARGET_ORGANIZATION_ID,
      reason: "Truck unavailable"
    })
    const beforeRetry = structuredClone(services.state)

    expect(() => services.claimDirectOffer(claimInput(), { at: AT })).toThrow(/new direct offer is required/)
    expect(services.state).toEqual(beforeRetry)
    expect(services.state.directOffers.find((candidate) => candidate.id === OFFER_ID)?.status).toBe("accepted")
  })

  it("rejects unauthorized and cross-organization acceptance without any partial mutation", () => {
    const services = directOfferServices()
    const beforeDriverAttempt = structuredClone(services.state)

    expect(() => services.claimDirectOffer({
      ...claimInput(),
      actorUserId: "22222222-2222-4222-8222-222222222221"
    }, { at: AT })).toThrow(/cannot assign capacity/)
    expect(services.state).toEqual(beforeDriverAttempt)

    const foreignCombination = services.state.equipmentCombinations.find((candidate) => candidate.id === FIRST_COMBINATION_ID)
    if (!foreignCombination) throw new Error("Test combination is missing")
    foreignCombination.organizationId = SOURCE_ORGANIZATION_ID
    const beforeForeignAttempt = structuredClone(services.state)

    expect(() => services.claimDirectOffer(claimInput(), { at: AT })).toThrow(/was not found/)
    expect(services.state).toEqual(beforeForeignAttempt)
  })

  it.each(["inactive profile", "removed membership"] as const)(
    "rejects an assigned driver with an %s without any partial mutation",
    (inactiveState) => {
      const services = directOfferServices()
      const combination = services.state.equipmentCombinations.find(
        (candidate) => candidate.id === FIRST_COMBINATION_ID
      )
      const driver = services.state.driverProfiles.find(
        (candidate) => candidate.id === combination?.assignedDriverProfileId
      )

      if (!driver) throw new Error("Direct-offer test driver is missing")

      if (inactiveState === "inactive profile") {
        const profile = services.state.profiles.find((candidate) => candidate.id === driver.userId)
        if (!profile) throw new Error("Direct-offer test user profile is missing")
        profile.isActive = false
      } else {
        const membership = services.state.organizationMemberships.find((candidate) =>
          candidate.organizationId === TARGET_ORGANIZATION_ID && candidate.userId === driver.userId
        )
        if (!membership) throw new Error("Direct-offer test membership is missing")
        membership.status = "removed"
      }

      const beforeClaim = structuredClone(services.state)

      expect(() => services.claimDirectOffer(claimInput(), { at: AT })).toThrow(/driver is not active/)
      expect(services.state).toEqual(beforeClaim)
    }
  )

  it("derives offer terms server-side and rejects over-capacity, stale, and duplicate invitations", () => {
    const services = directOfferServices()
    services.state.directOffers = []
    const input = {
      actorUserId: SOURCE_OWNER_ID,
      expiresAt: "2026-06-06T20:00:00.000Z",
      loadPostingId: LOAD_ID,
      offeredToOrganizationId: TARGET_ORGANIZATION_ID,
      offeredTruckloads: 2,
      organizationId: SOURCE_ORGANIZATION_ID
    }

    const offer = services.createDirectOffer(input, { at: AT })

    expect(offer.termsSnapshot).toMatchObject({
      capacityReservation: "none_until_truck_claimed",
      hostOrganizationId: SOURCE_ORGANIZATION_ID,
      loadPostingId: LOAD_ID,
      paymentMode: "off_platform",
      rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3"
    })
    expect(() => services.createDirectOffer(input, { at: AT })).toThrow(/active direct offer already exists/)

    const overCapacity = directOfferServices()
    overCapacity.state.directOffers = []
    const beforeOverCapacity = structuredClone(overCapacity.state)
    expect(() => overCapacity.createDirectOffer({ ...input, offeredTruckloads: 4 }, { at: AT }))
      .toThrow(/Only 3 truckloads remain/)
    expect(overCapacity.state).toEqual(beforeOverCapacity)

    expect(() => overCapacity.createDirectOffer({ ...input, expiresAt: AT }, { at: AT }))
      .toThrow(/future expiration/)
  })

  it("rejects acceptance when the server-derived offer terms have changed", () => {
    const services = directOfferServices()
    services.state.directOffers = []
    const offer = services.createDirectOffer({
      actorUserId: SOURCE_OWNER_ID,
      expiresAt: "2026-06-06T20:00:00.000Z",
      loadPostingId: LOAD_ID,
      offeredToOrganizationId: TARGET_ORGANIZATION_ID,
      offeredTruckloads: 1,
      organizationId: SOURCE_ORGANIZATION_ID
    }, { at: AT })
    const rate = services.state.rates.find((candidate) => candidate.id === offer.termsSnapshot.rateId)

    if (!rate) throw new Error("Direct-offer test rate is missing")
    rate.baseRate = { ...rate.baseRate, amountCents: rate.baseRate.amountCents + 1 }
    const beforeClaim = structuredClone(services.state)

    expect(() => services.claimDirectOffer({
      ...claimInput(),
      directOfferId: offer.id
    }, { at: AT })).toThrow(/terms changed/)
    expect(services.state).toEqual(beforeClaim)
  })

  it("records exact slot availability on confirmation and rejects partial overlaps atomically", () => {
    const services = directOfferServices()
    const combination = services.state.equipmentCombinations.find((candidate) => candidate.id === FIRST_COMBINATION_ID)
    const driverProfileId = combination?.assignedDriverProfileId
    const slot = services.state.truckSlots.find((candidate) => candidate.id === FIRST_SLOT_ID)

    if (!combination || !driverProfileId || !slot) throw new Error("Direct-offer availability fixture is missing")
    services.state.availabilityWindows = services.state.availabilityWindows.filter(
      (window) => window.driverProfileId !== driverProfileId
    )

    services.claimDirectOffer(claimInput(), { at: AT })
    expect(services.state.availabilityWindows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        driverProfileId,
        endAt: slot.endAt,
        startAt: slot.startAt,
        status: "available",
        truckProfileId: combination.truckProfileId
      })
    ]))

    const conflicting = directOfferServices()
    const conflictingCombination = conflicting.state.equipmentCombinations.find(
      (candidate) => candidate.id === FIRST_COMBINATION_ID
    )
    const conflictingDriverId = conflictingCombination?.assignedDriverProfileId

    if (!conflictingCombination || !conflictingDriverId) throw new Error("Direct-offer conflict fixture is missing")
    conflicting.state.availabilityWindows = conflicting.state.availabilityWindows.filter(
      (window) => window.driverProfileId !== conflictingDriverId
    )
    conflicting.upsertAvailabilityWindow({
      driverProfileId: conflictingDriverId,
      endAt: "2026-06-06T15:10:00.000Z",
      startAt: "2026-06-06T14:50:00.000Z",
      status: "limited",
      truckProfileId: conflictingCombination.truckProfileId
    })
    const beforeClaim = structuredClone(conflicting.state)

    expect(() => conflicting.claimDirectOffer(claimInput(), { at: AT })).toThrow(/does not cover this full haul window/)
    expect(conflicting.state).toEqual(beforeClaim)
  })

  it("supports recipient decline, host revoke, and effective expiry without leaking invite-only work", () => {
    const declinedServices = directOfferServices()
    const declined = declinedServices.declineDirectOffer({
      actorUserId: TARGET_DISPATCHER_ID,
      directOfferId: OFFER_ID,
      organizationId: TARGET_ORGANIZATION_ID
    }, { at: AT })
    expect(declined.status).toBe("declined")
    expect(declinedServices.state.notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ relatedEntityId: OFFER_ID, userId: SOURCE_OWNER_ID })
    ]))

    const revokedServices = directOfferServices()
    const revoked = revokedServices.revokeDirectOffer({
      actorUserId: SOURCE_OWNER_ID,
      directOfferId: OFFER_ID,
      organizationId: SOURCE_ORGANIZATION_ID
    }, { at: AT })
    expect(revoked.status).toBe("revoked")
    expect(revokedServices.state.notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ relatedEntityId: OFFER_ID, userId: TARGET_DISPATCHER_ID })
    ]))

    const expiredServices = directOfferServices()
    const capacity = expiredServices.state.opportunityCapacities.find((item) => item.loadPostingId === LOAD_ID)
    if (!capacity) throw new Error("Test capacity is missing")
    capacity.visibilityMode = "direct_offer"

    expect(expiredServices.listVisibleLoadsForOrganization(TARGET_ORGANIZATION_ID, AT).some((load) => load.id === LOAD_ID)).toBe(true)
    expect(
      expiredServices
        .listVisibleLoadsForOrganization(TARGET_ORGANIZATION_ID, "2026-06-07T12:00:00.000Z")
        .some((load) => load.id === LOAD_ID)
    ).toBe(false)
  })
})
