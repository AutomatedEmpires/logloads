import { evaluateLoadCompatibility } from "@logloads/contracts"
import { describe, expect, it } from "vitest"

import { createInMemoryDatabase } from "./index"

describe("seed load posting sources", () => {
  it("keeps every synthetic posting inside one host organization and one coherent lane", () => {
    const state = createInMemoryDatabase()

    for (const load of state.loadPostings) {
      const dispatcher = state.dispatcherProfiles.find((profile) => profile.id === load.dispatcherProfileId)
      const landing = state.landings.find((candidate) => candidate.id === load.pickupLandingId)
      const loader = load.loaderProfileId
        ? state.loaderProfiles.find((profile) => profile.id === load.loaderProfileId)
        : null
      const rate = state.rates.find((candidate) => candidate.id === load.rateId)
      const route = state.haulRoutes.find((candidate) => candidate.id === load.routeId)

      expect(dispatcher?.companyId, `${load.title}: dispatcher organization`).toBe(load.companyId)
      expect(landing?.companyId, `${load.title}: landing organization`).toBe(load.companyId)
      expect(loader?.companyId ?? null, `${load.title}: loader organization`).toBe(
        load.loaderProfileId ? load.companyId : null
      )
      expect(rate?.companyId, `${load.title}: rate organization`).toBe(load.companyId)
      expect(route?.companyId, `${load.title}: route organization`).toBe(load.companyId)
      expect(route?.landingId, `${load.title}: route start`).toBe(load.pickupLandingId)
      expect(route?.millId, `${load.title}: route destination`).toBe(load.dropoffMillId)
      expect(load.dispatcherContact, `${load.title}: dispatch contact snapshot`).toEqual(dispatcher?.contact)
      expect(load.loaderContact ?? null, `${load.title}: loader contact snapshot`).toEqual(loader?.contact ?? null)
    }
  })
})

describe("founder demo operating states", () => {
  it("reconciles the canonical campaign ledger to its real assignment and slot history", () => {
    const state = createInMemoryDatabase()
    const loadId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3"
    const load = state.loadPostings.find((candidate) => candidate.id === loadId)
    const assignments = state.assignments.filter((assignment) =>
      assignment.loadPostingId === loadId && !["cancelled", "declined"].includes(assignment.status)
    )
    const capacity = state.opportunityCapacities.find((candidate) => candidate.loadPostingId === loadId)
    const offer = state.directOffers.find((candidate) => candidate.id === "29292929-2929-4929-8929-292929292911")
    const openSlotCapacity = state.truckSlots
      .filter((slot) => slot.loadPostingId === loadId && ["open", "requested", "reserved"].includes(slot.status))
      .reduce((total, slot) => total + slot.capacity - slot.reservedCount, 0)

    expect(assignments).toHaveLength(3)
    expect(assignments.filter((assignment) => assignment.status === "completed")).toHaveLength(2)
    expect(capacity).toMatchObject({
      committedTruckloads: 3,
      completedTruckloads: 2,
      remainingTruckloads: 1,
      totalTruckloads: 4
    })
    expect(openSlotCapacity).toBe(1)
    expect(offer).toMatchObject({
      offeredTruckloads: 1,
      status: "sent",
      termsSnapshot: { driverPayCents: load?.driverPayCents }
    })
    expect(load?.driverPayCents).toBeGreaterThan(0)
  })

  it("carries one posting that is genuinely a series, reconciled to the slots that make it one", () => {
    // The slot picker is only reachable when ONE driver has more than one run to
    // choose from. A series that collapses to a single slot — or to a single day
    // — un-ships that control while every other test in the repo stays green,
    // so the shape is pinned here rather than left to the surfaces to imply.
    const state = createInMemoryDatabase()
    const loadId = "cccccccc-cccc-4ccc-8ccc-ccccccccccd1"
    const load = state.loadPostings.find((candidate) => candidate.id === loadId)
    const capacity = state.opportunityCapacities.find((candidate) => candidate.loadPostingId === loadId)
    const slots = state.truckSlots.filter((slot) => slot.loadPostingId === loadId)

    if (!load || !capacity) {
      throw new Error("The two-day series seed is incomplete")
    }

    const slotCapacity = slots.reduce((total, slot) => total + slot.capacity, 0)
    const openCapacity = slots
      .filter((slot) => ["open", "requested", "reserved"].includes(slot.status))
      .reduce((total, slot) => total + slot.capacity - slot.reservedCount, 0)

    expect(slots.length).toBeGreaterThan(1)
    expect(new Set(slots.map((slot) => slot.slotDate)).size).toBeGreaterThan(1)
    expect(load).toMatchObject({
      campaignEndDate: "2026-06-09",
      campaignStartDate: "2026-06-08",
      dailyTruckCountNeeded: 3,
      scheduleType: "campaign",
      status: "open"
    })

    // provisionLoadCapacity's own arithmetic: one slot per scheduled date at
    // capacity = dailyTruckCountNeeded, so total = perDay x dates. A fixture
    // that disagrees models a posting the product cannot publish.
    expect(slots).toHaveLength(2)
    expect(slotCapacity).toBe(load.dailyTruckCountNeeded * slots.length)
    expect(capacity).toMatchObject({
      allocationMode: "request_approval",
      committedTruckloads: 0,
      completedTruckloads: 0,
      remainingTruckloads: 6,
      totalTruckloads: 6
    })
    expect(capacity.totalTruckloads).toBe(slotCapacity)
    expect(capacity.remainingTruckloads).toBe(openCapacity)

    // The services suite pins that nothing is requestable at this instant. A
    // fixture dated past it would be requestable there and fail that test for a
    // reason nobody would look for here.
    const requestabilityCeiling = "2026-07-13T12:00:00.000Z"

    for (const slot of slots) {
      expect(
        slot.endAt.localeCompare(requestabilityCeiling),
        `slot ${slot.slotDate} must expire before the requestability ceiling`
      ).toBeLessThan(0)
    }
  })

  it("keeps a claimable partial offer beside honest terminal offer history", () => {
    const state = createInMemoryDatabase()
    const partial = state.directOffers.find((offer) => offer.id === "29292929-2929-4929-8929-292929292915")
    const partialClaims = state.assignments.filter((assignment) => assignment.directOfferId === partial?.id)
    const claim = partialClaims[0]
    const load = state.loadPostings.find((candidate) => candidate.id === partial?.loadPostingId)
    const capacity = state.opportunityCapacities.find((candidate) => candidate.loadPostingId === load?.id)
    const combination = state.equipmentCombinations.find((candidate) =>
      candidate.assignedDriverProfileId === claim?.driverProfileId &&
      candidate.truckProfileId === claim?.truckProfileId &&
      candidate.trailerProfileId === claim?.trailerProfileId
    )
    const truck = state.truckProfiles.find((candidate) => candidate.id === combination?.truckProfileId)
    const trailer = state.trailerProfiles.find((candidate) => candidate.id === combination?.trailerProfileId)
    const route = state.haulRoutes.find((candidate) => candidate.id === load?.routeId)
    const trip = state.tripsV2.find((candidate) => candidate.assignmentId === claim?.id)

    if (!partial || !claim || !load || !capacity || !combination || !truck || !trailer || !route || !trip) {
      throw new Error("The partial direct-offer seed is incomplete")
    }

    expect(partial).toMatchObject({
      offeredTruckloads: 2,
      status: "sent",
      termsSnapshot: { driverPayCents: load.driverPayCents }
    })
    expect(load.driverPayCents).toBeGreaterThan(0)
    expect(partialClaims).toHaveLength(1)
    expect(partial.respondedAt).toBe(claim.assignedAt)
    expect(partial.updatedAt).toBe(claim.assignedAt)
    expect(capacity).toMatchObject({
      committedTruckloads: 1,
      completedTruckloads: 1,
      remainingTruckloads: 1,
      totalTruckloads: 2
    })
    expect(capacity.committedTruckloads + capacity.remainingTruckloads).toBe(capacity.totalTruckloads)
    expect(trip.equipmentCombinationId).toBe(combination.id)
    expect(evaluateLoadCompatibility({
      availabilityWindows: state.availabilityWindows.filter((window) =>
        window.driverProfileId === claim.driverProfileId && window.truckProfileId === claim.truckProfileId
      ),
      load,
      route,
      trailer,
      truck
    }).eligibility).not.toBe("ineligible")
    expect(new Set(state.directOffers.map((offer) => offer.status))).toEqual(
      new Set(["sent", "declined", "revoked", "expired"])
    )
  })

  it("keeps deterministic primary keys unique in every persisted seed table", () => {
    const state = createInMemoryDatabase()

    for (const [table, rows] of Object.entries(state)) {
      const ids = (rows as Array<{ id: string }>).map((row) => row.id)

      expect(new Set(ids).size, table).toBe(ids.length)
    }
  })

  it("preserves scheduled, active, and completed trip states plus unavailable capacity", () => {
    const state = createInMemoryDatabase()
    const inheritedAvailability = state.availabilityWindows.find((window) =>
      window.id === "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3"
    )
    const inheritedTrip = state.tripsV2.find((trip) => trip.id === "24242424-2424-4424-8424-242424242411")

    expect(state.tripsV2.map((trip) => trip.status)).toEqual(
      expect.arrayContaining(["assigned", "en_route_to_landing", "completed"])
    )
    expect(inheritedAvailability).toMatchObject({
      driverProfileId: "44444444-4444-4444-8444-444444444443",
      truckProfileId: "77777777-7777-4777-8777-777777777773"
    })
    expect(inheritedTrip).toMatchObject({
      lastSyncedAt: "2026-06-05T13:00:00.000Z",
      locationSharingStartedAt: null,
      status: "assigned",
      updatedAt: "2026-06-05T13:00:00.000Z"
    })
    expect(new Set(state.driverProfiles.map((driver) => driver.availabilityStatus))).toEqual(
      new Set(["available", "limited", "unavailable"])
    )
  })

  it("provides deterministic empty and failed-document recovery states without media bytes", () => {
    const state = createInMemoryDatabase()
    const emptyOrganizationId = "33333333-3333-4333-8333-333333333334"
    const failedDocument = state.tripDocuments.find((document) => document.processingStatus === "failed")

    expect(state.organizationMemberships.some((membership) =>
      membership.organizationId === emptyOrganizationId && membership.role === "owner"
    )).toBe(true)
    expect(state.loadPostings.some((load) => load.companyId === emptyOrganizationId)).toBe(false)
    expect(state.equipmentCombinations.some((equipment) => equipment.organizationId === emptyOrganizationId)).toBe(false)
    expect(failedDocument).toMatchObject({ media: null, processingStatus: "failed" })
    expect(failedDocument?.auditMetadata).toMatchObject({ synthetic: true })
  })
})
