import { describe, expect, it } from "vitest"

import {
  formatRate,
  rateTone,
  reputationBand,
  reputationLabel,
  summarizeReviews,
  type ReviewLike
} from "./reputation"

function review(stars: number, tags: ReviewLike["tags"] = []): ReviewLike {
  return { stars, tags }
}

describe("reputation summary", () => {
  it("returns a cold-start 'new' band with no reviews", () => {
    const summary = summarizeReviews([])

    expect(summary.avgRating).toBeNull()
    expect(summary.ratedCount).toBe(0)
    expect(summary.band).toBe("new")
    expect(reputationLabel(summary)).toBe("New")
  })

  it("averages stars to one decimal and counts them", () => {
    const summary = summarizeReviews([review(5), review(4), review(5)])

    expect(summary.avgRating).toBe(4.7)
    expect(summary.ratedCount).toBe(3)
    expect(reputationLabel(summary)).toBe("4.7 · 3 reviews")
  })

  it("bands by average rating", () => {
    expect(reputationBand(4.8, 10)).toBe("excellent")
    expect(reputationBand(4.2, 10)).toBe("solid")
    expect(reputationBand(3.1, 10)).toBe("mixed")
    expect(reputationBand(null, 0)).toBe("new")
  })

  it("surfaces only positive tags, most common first, capped at three", () => {
    const summary = summarizeReviews([
      review(5, ["on_time", "professional", "late"]),
      review(5, ["on_time", "safe"]),
      review(4, ["on_time", "professional", "accurate_load"])
    ])

    expect(summary.topTags[0]).toMatchObject({ tag: "on_time", count: 3 })
    expect(summary.topTags.length).toBeLessThanOrEqual(3)
    // The negative "late" tag is never promoted as a strength.
    expect(summary.topTags.some((t) => t.tag === "late")).toBe(false)
  })

  it("formats reliability rates and tones by threshold", () => {
    expect(formatRate(0.934)).toBe("93%")
    expect(formatRate(null)).toBe("—")
    expect(rateTone(0.95)).toBe("success")
    expect(rateTone(0.75)).toBe("warning")
    expect(rateTone(0.4)).toBe("critical")
  })

  it("never emits a raw NN/100 style score in the label", () => {
    const summary = summarizeReviews([review(5), review(5)])
    expect(reputationLabel(summary)).not.toMatch(/\/\s*100/)
  })
})
