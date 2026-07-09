import type { ReviewTag } from "./enums"

/**
 * Reputation math — pure and display-safe. Turns raw review rows into an
 * aggregate a viewer can see (average, count, common praise, a band). The engine
 * never exposes individual authors or notes across an org boundary; that stays in
 * the service layer. Reliability percentages are formatted here too so every
 * surface (cards, dashboards, the assistant) reads the same way.
 */

export type ReputationBand = "excellent" | "solid" | "mixed" | "new"

export interface ReviewLike {
  stars: number
  tags: ReviewTag[]
}

export interface ReputationSummary {
  avgRating: number | null
  ratedCount: number
  topTags: Array<{ tag: ReviewTag; label: string; count: number }>
  band: ReputationBand
}

const POSITIVE_TAGS: ReadonlySet<ReviewTag> = new Set([
  "on_time",
  "professional",
  "clear_instructions",
  "accurate_load",
  "easy_access",
  "good_communication",
  "safe"
])

const TAG_LABELS: Record<ReviewTag, string> = {
  access_issues: "Access issues",
  accurate_load: "Accurate load",
  clear_instructions: "Clear instructions",
  easy_access: "Easy access",
  good_communication: "Good communication",
  inaccurate_load: "Inaccurate load",
  late: "Late",
  on_time: "On time",
  poor_communication: "Poor communication",
  professional: "Professional",
  safe: "Safe",
  unsafe_access: "Unsafe access"
}

export function reviewTagLabel(tag: ReviewTag): string {
  return TAG_LABELS[tag] ?? tag
}

export function reputationBand(avgRating: number | null, ratedCount: number): ReputationBand {
  if (avgRating === null || ratedCount === 0) {
    return "new"
  }

  if (avgRating >= 4.6) {
    return "excellent"
  }

  if (avgRating >= 4.0) {
    return "solid"
  }

  return "mixed"
}

export function reputationTone(band: ReputationBand): "success" | "info" | "warning" | "neutral" {
  if (band === "excellent") {
    return "success"
  }

  if (band === "solid") {
    return "info"
  }

  if (band === "mixed") {
    return "warning"
  }

  return "neutral"
}

export function summarizeReviews(reviews: ReviewLike[]): ReputationSummary {
  if (reviews.length === 0) {
    return { avgRating: null, band: "new", ratedCount: 0, topTags: [] }
  }

  const total = reviews.reduce((sum, review) => sum + review.stars, 0)
  const avgRating = Math.round((total / reviews.length) * 10) / 10

  const counts = new Map<ReviewTag, number>()
  for (const review of reviews) {
    for (const tag of review.tags) {
      if (POSITIVE_TAGS.has(tag)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
  }

  const topTags = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([tag, count]) => ({ count, label: reviewTagLabel(tag), tag }))

  return { avgRating, band: reputationBand(avgRating, reviews.length), ratedCount: reviews.length, topTags }
}

/** A compact human label for a reputation chip. Never a raw internal score. */
export function reputationLabel(summary: ReputationSummary): string {
  if (summary.avgRating === null || summary.ratedCount === 0) {
    return "New"
  }

  return `${summary.avgRating.toFixed(1)} · ${summary.ratedCount} ${summary.ratedCount === 1 ? "review" : "reviews"}`
}

/** Percentage helper shared by reliability tiles: rounds a 0..1 ratio, null-safe. */
export function formatRate(rate: number | null): string {
  if (rate === null) {
    return "—"
  }

  return `${Math.round(rate * 100)}%`
}

export function rateTone(rate: number | null): "success" | "warning" | "critical" | "info" {
  if (rate === null) {
    return "info"
  }

  if (rate >= 0.9) {
    return "success"
  }

  if (rate >= 0.7) {
    return "warning"
  }

  return "critical"
}
