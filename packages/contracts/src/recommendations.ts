import type { CompatibilityResult } from "./matching"

/**
 * Load recommendation ranking. Turns the deterministic compatibility result plus
 * operating signals (capacity, schedule proximity, freshness, trust) into a ranked
 * band with human "why" reasons. The numeric `sortKey` is server-only and is never
 * serialized to clients — surfaces show the band label and reasons, never a score.
 */

export type RecommendationBand = "top_pick" | "strong" | "worth_review" | "stretch" | "not_recommended"

export type RecommendationVisibility = "private_network" | "verified_network" | "direct_offer" | "open_network"

export interface RecommendationSignals {
  compatibility: CompatibilityResult
  /** Truckloads still open on the load. */
  remainingCapacity: number
  /** Whether the viewer can request a slot right now. */
  isRequestable: boolean
  /** Whole days until the load date / campaign start; null when the window is pending. */
  daysUntilSchedule: number | null
  /** Haul distance in miles; null when unknown. */
  distanceMiles: number | null
  freshness: "verified" | "recent" | "stale" | "unknown"
  visibility: RecommendationVisibility
  /** The publishing host's track record; null under a cold-start sample size. */
  counterpartReliability: { onTimeRate: number | null; avgRating: number | null; ratedTrips: number } | null
}

export interface Recommendation {
  band: RecommendationBand
  label: string
  /** Ordered "why this is recommended" reasons — human language, no numbers. */
  reasons: string[]
  /** Server-only ranking key. Do NOT serialize to clients. */
  sortKey: number
}

const BAND_LABEL: Record<RecommendationBand, string> = {
  not_recommended: "Not a fit",
  stretch: "Stretch",
  strong: "Strong option",
  top_pick: "Top pick",
  worth_review: "Worth a look"
}

function scheduleReason(days: number | null): string | null {
  if (days === null) {
    return null
  }

  if (days < 0) {
    return "Already in its window"
  }

  if (days === 0) {
    return "Moves today"
  }

  if (days === 1) {
    return "Moves tomorrow"
  }

  if (days <= 4) {
    return `Moves in ${days} days`
  }

  return null
}

function isReliableCounterpart(reliability: RecommendationSignals["counterpartReliability"]): boolean {
  if (!reliability || reliability.ratedTrips < 2) {
    return false
  }

  return (
    (reliability.avgRating !== null && reliability.avgRating >= 4.5) ||
    (reliability.onTimeRate !== null && reliability.onTimeRate >= 0.9)
  )
}

function isWeakCounterpart(reliability: RecommendationSignals["counterpartReliability"]): boolean {
  if (!reliability || reliability.ratedTrips < 2) {
    return false
  }

  return (
    (reliability.avgRating !== null && reliability.avgRating < 3.5) ||
    (reliability.onTimeRate !== null && reliability.onTimeRate < 0.6)
  )
}

function visibilityReason(visibility: RecommendationVisibility): string | null {
  if (visibility === "private_network") {
    return "Partner work you're trusted for"
  }

  if (visibility === "direct_offer") {
    return "Sent to you directly"
  }

  if (visibility === "verified_network") {
    return "Verified regional work"
  }

  return null
}

export function recommendLoad(signals: RecommendationSignals): Recommendation {
  const { compatibility, counterpartReliability, daysUntilSchedule, distanceMiles, freshness, isRequestable, remainingCapacity, visibility } = signals

  // Ineligible loads are never recommended, regardless of other signals.
  if (compatibility.eligibility === "ineligible") {
    return {
      band: "not_recommended",
      label: BAND_LABEL.not_recommended,
      reasons: compatibility.hardFailures.slice(0, 2),
      sortKey: -1000 + compatibility.score
    }
  }

  let sortKey = compatibility.score

  // Requestable open capacity is the strongest actionability signal.
  if (isRequestable && remainingCapacity > 0) {
    sortKey += 18
  } else if (remainingCapacity <= 0) {
    sortKey -= 30
  }

  // Reward soon-moving work; gently fade distant windows.
  if (daysUntilSchedule !== null) {
    if (daysUntilSchedule >= 0 && daysUntilSchedule <= 2) {
      sortKey += 10
    } else if (daysUntilSchedule > 7) {
      sortKey -= 6
    }
  }

  // Trust and freshness.
  if (visibility === "private_network" || visibility === "direct_offer") {
    sortKey += 8
  } else if (visibility === "verified_network") {
    sortKey += 4
  }

  if (freshness === "verified") {
    sortKey += 4
  } else if (freshness === "stale") {
    sortKey -= 8
  }

  // A proven, on-time host is a modest tailwind; a poorly-rated one, a headwind.
  // Gated on sample size so a cold-start host is never penalized.
  if (isReliableCounterpart(counterpartReliability)) {
    sortKey += 6
  } else if (isWeakCounterpart(counterpartReliability)) {
    sortKey -= 8
  }

  // Prefer shorter hauls at the margin (less deadhead risk, faster turns).
  if (distanceMiles !== null) {
    if (distanceMiles <= 60) {
      sortKey += 3
    } else if (distanceMiles >= 150) {
      sortKey -= 4
    }
  }

  sortKey = Math.max(0, Math.min(140, sortKey))

  const band: RecommendationBand =
    compatibility.eligibility === "strong_match" && isRequestable && remainingCapacity > 0 && sortKey >= 96
      ? "top_pick"
      : sortKey >= 82
        ? "strong"
        : compatibility.eligibility === "eligible_with_review" || sortKey < 60
          ? "worth_review"
          : "strong"

  // Human reasons, most compelling first, no numbers.
  const reasons: string[] = []
  const equipmentSignal = compatibility.positiveSignals.find((signal) => /truck|trailer|fit|payload|equipment/i.test(signal))

  if (compatibility.eligibility === "strong_match") {
    reasons.push("Strong equipment and route fit")
  } else if (equipmentSignal) {
    reasons.push(equipmentSignal)
  }

  if (isRequestable && remainingCapacity > 0) {
    reasons.push(remainingCapacity === 1 ? "Open capacity — one load left" : "Open capacity right now")
  }

  const trust = visibilityReason(visibility)
  if (trust) {
    reasons.push(trust)
  }

  if (isReliableCounterpart(counterpartReliability)) {
    const onTime = counterpartReliability?.onTimeRate ?? null
    // Only claim an on-time record when the data actually shows one; otherwise
    // credit the rating. Words only, never a number.
    reasons.push(onTime !== null && onTime >= 0.9 ? "Reliable host — consistently on time" : "Reliable host — highly rated")
  }

  const schedule = scheduleReason(daysUntilSchedule)
  if (schedule) {
    reasons.push(schedule)
  }

  if (distanceMiles !== null && distanceMiles <= 60) {
    reasons.push(`Short ${Math.round(distanceMiles)} mi haul`)
  }

  if (reasons.length === 0 && compatibility.cautions[0]) {
    reasons.push(compatibility.cautions[0])
  }

  const finalBand: RecommendationBand =
    band === "worth_review" && sortKey >= 70 ? "worth_review" : band === "strong" && sortKey < 70 ? "stretch" : band

  return {
    band: finalBand,
    label: BAND_LABEL[finalBand],
    reasons: reasons.slice(0, 3),
    sortKey
  }
}

/**
 * Ranks a set of loads by recommendation strength, best first. Returns each item
 * with its recommendation attached. Ineligible loads sink to the bottom.
 */
export function rankRecommendations<T>(
  items: readonly T[],
  toSignals: (item: T) => RecommendationSignals
): Array<{ item: T; recommendation: Recommendation }> {
  return items
    .map((item) => ({ item, recommendation: recommendLoad(toSignals(item)) }))
    .sort((left, right) => right.recommendation.sortKey - left.recommendation.sortKey)
}
