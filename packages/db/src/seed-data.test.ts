import { describe, expect, it } from "vitest"

import { createInMemoryDatabase } from "./index"

describe("seed load posting sources", () => {
  it("keeps every synthetic posting inside one host organization and one coherent lane", () => {
    const state = createInMemoryDatabase()

    for (const load of state.loadPostings) {
      const dispatcher = state.dispatcherProfiles.find((profile) => profile.id === load.dispatcherProfileId)
      const landing = state.landings.find((candidate) => candidate.id === load.pickupLandingId)
      const rate = state.rates.find((candidate) => candidate.id === load.rateId)
      const route = state.haulRoutes.find((candidate) => candidate.id === load.routeId)

      expect(dispatcher?.companyId, `${load.title}: dispatcher organization`).toBe(load.companyId)
      expect(landing?.companyId, `${load.title}: landing organization`).toBe(load.companyId)
      expect(rate?.companyId, `${load.title}: rate organization`).toBe(load.companyId)
      expect(route?.companyId, `${load.title}: route organization`).toBe(load.companyId)
      expect(route?.landingId, `${load.title}: route start`).toBe(load.pickupLandingId)
      expect(route?.millId, `${load.title}: route destination`).toBe(load.dropoffMillId)
      expect(load.dispatcherContact, `${load.title}: dispatch contact snapshot`).toEqual(dispatcher?.contact)
    }
  })
})
