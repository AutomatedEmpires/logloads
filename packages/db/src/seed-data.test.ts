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
  it("keeps a claimable partial offer beside honest terminal offer history", () => {
    const state = createInMemoryDatabase()
    const partial = state.directOffers.find((offer) => offer.id === "29292929-2929-4929-8929-292929292911")
    const partialClaims = state.assignments.filter((assignment) => assignment.directOfferId === partial?.id)

    expect(partial).toMatchObject({ offeredTruckloads: 2, status: "sent" })
    expect(partialClaims).toHaveLength(1)
    expect(new Set(state.directOffers.map((offer) => offer.status))).toEqual(
      new Set(["sent", "declined", "revoked", "expired"])
    )
  })

  it("preserves scheduled, active, and completed trip states plus unavailable capacity", () => {
    const state = createInMemoryDatabase()

    expect(state.tripsV2.map((trip) => trip.status)).toEqual(
      expect.arrayContaining(["assigned", "en_route_to_landing", "completed"])
    )
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
