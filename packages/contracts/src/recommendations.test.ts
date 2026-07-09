import { describe, expect, it } from "vitest"

import type { CompatibilityResult } from "./matching"
import { rankRecommendations, recommendLoad, type RecommendationSignals } from "./recommendations"

function compatibility(overrides: Partial<CompatibilityResult> = {}): CompatibilityResult {
  return {
    cautions: [],
    eligibility: "strong_match",
    hardFailures: [],
    positiveSignals: ["Truck type fits saw logs work.", "Trailer TRL-101 fits the required configuration."],
    score: 90,
    ...overrides
  }
}

function signals(overrides: Partial<RecommendationSignals> = {}): RecommendationSignals {
  return {
    compatibility: compatibility(),
    counterpartReliability: null,
    daysUntilSchedule: 1,
    distanceMiles: 54,
    freshness: "verified",
    isRequestable: true,
    remainingCapacity: 2,
    visibility: "open_network",
    ...overrides
  }
}

describe("load recommendations", () => {
  it("promotes a strong, requestable, soon-moving load to top pick", () => {
    const result = recommendLoad(signals())

    expect(result.band).toBe("top_pick")
    expect(result.label).toBe("Top pick")
    expect(result.reasons[0]).toBe("Strong equipment and route fit")
    expect(result.reasons).toContain("Open capacity right now")
  })

  it("never recommends an ineligible load and surfaces the blocking reason", () => {
    const result = recommendLoad(
      signals({
        compatibility: compatibility({
          eligibility: "ineligible",
          hardFailures: ["Requires log truck and log trailer; truck is listed as chip truck."],
          score: 20
        })
      })
    )

    expect(result.band).toBe("not_recommended")
    expect(result.reasons[0]).toMatch(/Requires log truck/)
    expect(result.sortKey).toBeLessThan(0)
  })

  it("emits no numeric score in the human-facing surface", () => {
    const result = recommendLoad(signals())

    for (const reason of [result.label, ...result.reasons]) {
      expect(reason).not.toMatch(/\b\d{2,3}\s*\/\s*100\b/)
    }
  })

  it("credits partner work as a trust reason", () => {
    const result = recommendLoad(signals({ visibility: "private_network", compatibility: compatibility({ eligibility: "eligible" }) }))

    expect(result.reasons).toContain("Partner work you're trusted for")
  })

  it("demotes filled capacity below open capacity", () => {
    const open = recommendLoad(signals())
    const filled = recommendLoad(signals({ isRequestable: false, remainingCapacity: 0 }))

    expect(open.sortKey).toBeGreaterThan(filled.sortKey)
  })

  it("credits a proven, on-time host with a reliability reason and a lift", () => {
    const reliable = recommendLoad(signals({ counterpartReliability: { avgRating: 4.8, onTimeRate: 0.95, ratedTrips: 8 } }))
    const unknown = recommendLoad(signals({ counterpartReliability: null }))

    expect(reliable.reasons).toContain("Reliable host — consistently on time")
    expect(reliable.sortKey).toBeGreaterThanOrEqual(unknown.sortKey)
  })

  it("ignores counterpart reliability under the cold-start sample size", () => {
    const result = recommendLoad(signals({ counterpartReliability: { avgRating: 5, onTimeRate: 1, ratedTrips: 1 } }))

    expect(result.reasons).not.toContain("Reliable host — consistently on time")
  })

  it("ranks a set best-first and sinks ineligible loads", () => {
    const ranked = rankRecommendations(
      [
        { id: "far", s: signals({ distanceMiles: 200, daysUntilSchedule: 20, compatibility: compatibility({ eligibility: "eligible_with_review", score: 70, cautions: ["Road is muddy."] }) }) },
        { id: "best", s: signals() },
        { id: "ineligible", s: signals({ compatibility: compatibility({ eligibility: "ineligible", hardFailures: ["No trailer."], score: 10 }) }) }
      ],
      (entry) => entry.s
    )

    expect(ranked[0]?.item.id).toBe("best")
    expect(ranked.at(-1)?.item.id).toBe("ineligible")
  })
})
