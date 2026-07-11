import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import {
  getReliabilityForOrganization,
  getReputationForOrganization,
  submitTripReview
} from "./trip-reviews"

const NORTH_PINE = "33333333-3333-4333-8333-333333333331"
const SUMMIT = "33333333-3333-4333-8333-333333333332"
const OUTSIDER = "99999999-9999-4999-8999-999999999999"
const MAYA_USER = "22222222-2222-4222-8222-222222222222"
const COLE_USER = "22222222-2222-4222-8222-222222222223"

const CROSS_TRIP = "24242424-2424-4424-8424-242424242414" // completed, cross-org, hauler side open
const INTRA_TRIP = "24242424-2424-4424-8424-242424242412" // completed, North Pine both sides
const ASSIGNED_TRIP = "24242424-2424-4424-8424-242424242411" // not completed

function haulerRatesHost(over: Record<string, unknown> = {}) {
  return {
    direction: "hauler_rates_host" as const,
    raterOrganizationId: NORTH_PINE,
    raterUserId: MAYA_USER,
    stars: 5,
    tags: ["easy_access" as const],
    tripId: CROSS_TRIP,
    ...over
  }
}

describe("trip reviews", () => {
  it("a hauler reviews the host on a completed cross-org trip; subject is derived", () => {
    const state = createInMemoryDatabase()

    const review = submitTripReview(state, haulerRatesHost())

    expect(review.subjectOrganizationId).toBe(SUMMIT)
    expect(review.subjectDriverProfileId).toBeNull()
    expect(review.stars).toBe(5)
  })

  it("rejects a non-participant organization", () => {
    const state = createInMemoryDatabase()

    expect(() => submitTripReview(state, haulerRatesHost({ raterOrganizationId: OUTSIDER }))).toThrow(/other side/)
  })

  it("rejects a rater on the wrong side for the direction", () => {
    const state = createInMemoryDatabase()

    // Summit is the host, so it cannot submit a hauler_rates_host review.
    expect(() =>
      submitTripReview(state, haulerRatesHost({ raterOrganizationId: SUMMIT, raterUserId: COLE_USER }))
    ).toThrow(/other side/)
  })

  it("rejects reviewing a trip that is not completed", () => {
    const state = createInMemoryDatabase()

    expect(() => submitTripReview(state, haulerRatesHost({ tripId: ASSIGNED_TRIP }))).toThrow(/completed/)
  })

  it("rejects an intra-organization haul (nothing to review)", () => {
    const state = createInMemoryDatabase()

    expect(() => submitTripReview(state, haulerRatesHost({ tripId: INTRA_TRIP }))).toThrow(/one organization/)
  })

  it("editing a review updates the same row", () => {
    const state = createInMemoryDatabase()

    const first = submitTripReview(state, haulerRatesHost({ stars: 4, tags: [] }))
    const second = submitTripReview(state, haulerRatesHost({ stars: 5, tags: ["easy_access"] }))

    expect(second.id).toBe(first.id)
    expect(second.stars).toBe(5)
    expect(state.tripReviews.filter((r) => r.tripId === CROSS_TRIP && r.direction === "hauler_rates_host")).toHaveLength(1)
  })

  it("blocks one person from authoring both sides of the same haul", () => {
    const state = createInMemoryDatabase()
    const DANA = "22222222-2222-4222-8222-222222222224" // an active member of both orgs

    submitTripReview(state, {
      direction: "hauler_rates_host",
      raterOrganizationId: NORTH_PINE,
      raterUserId: DANA,
      stars: 5,
      tags: [],
      tripId: CROSS_TRIP
    })

    expect(() =>
      submitTripReview(state, {
        direction: "host_rates_hauler",
        raterOrganizationId: SUMMIT,
        raterUserId: DANA,
        stars: 5,
        tags: [],
        tripId: CROSS_TRIP
      })
    ).toThrow(/both sides/)
  })

  it("aggregates reputation from seeded reviews", () => {
    const state = createInMemoryDatabase()

    const northPine = getReputationForOrganization(state, NORTH_PINE)
    expect(northPine.ratedCount).toBe(2)
    expect(northPine.avgRating).toBe(4.5)

    const summit = getReputationForOrganization(state, SUMMIT)
    expect(summit.ratedCount).toBe(1)
    expect(summit.avgRating).toBe(5)
  })

  it("computes organization reliability from trips + reviews", () => {
    const state = createInMemoryDatabase()

    const reliability = getReliabilityForOrganization(state, NORTH_PINE)
    expect(reliability.completedTrips).toBeGreaterThan(0)
    expect(reliability.avgRating).toBe(4.5)
    expect(reliability.onTimeRate).toBe(1)
    expect(reliability.completionRate).not.toBeNull()
  })
})
