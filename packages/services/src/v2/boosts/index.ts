/**
 * boosts (#254): boost rules (audience estimate, Sponsored ranking, expiry; no purchase).
 *
 * Port v3 (#244) entry module, re-exported by `packages/services/src/index.ts`. Pure rules over the views in
 * `packages/contracts/src/v2/boosts/`:
 *
 * - what a landing sees before any boost: the trucks the store counted from fresh availability, said plainly, beside
 *   the package's locked terms from `BOOST_PACKAGES` (§4.10, §10.24);
 * - where a boost stands at a moment, so it stops being sponsored at its end, at once (§8.13, §9.16);
 * - how a list of results places sponsored jobs: above the ordinary jobs that match the same filters, labelled, at
 *   most `MARKETPLACE_SPONSORED_SLOTS` of them, and never one the hauler's filters exclude (§8.8, §10.32);
 * - that nothing is purchasable: every package and every request to buy says so with the billing read model's own
 *   sentence (Blueprint §14, the #108 ruling).
 *
 * No price, duration or radius is restated here, nothing reads who is counted, and nothing charges anyone.
 */

import {
  BOOST_AUTO_RENEWS,
  BOOST_PACKAGES,
  BOOST_RADIUS_MILES,
  boostPackageCodeSchema,
  MARKETPLACE_PLAN_NOT_PURCHASABLE,
  MARKETPLACE_SPONSORED_SLOTS,
  type BoostPackageCode,
  type MarketplaceBoostAudienceSummaryView,
  type MarketplaceBoostAudienceView,
  type MarketplaceBoostPackageOptionView,
  type MarketplaceBoostPhase,
  type MarketplaceBoostPurchaseRefusal,
  type MarketplaceBoostView
} from "@logloads/contracts"

// ---------------------------------------------------------------------------
// No purchase
// ---------------------------------------------------------------------------

/** One package's locked terms, as the boost page may show them. Refuses a code `BOOST_PACKAGES` does not define. */
export function marketplaceBoostPackageOption(code: BoostPackageCode): MarketplaceBoostPackageOptionView {
  const boostPackage = BOOST_PACKAGES[boostPackageCodeSchema.parse(code)]

  // `autoRenews` is the literal `false`: if `BOOST_AUTO_RENEWS` ever changed, this would stop compiling.
  return { autoRenews: BOOST_AUTO_RENEWS, package: boostPackage, purchasable: false, radiusMiles: BOOST_RADIUS_MILES }
}

/** Every package, shortest first (`boostPackageCodeSchema` order), none of them for sale. */
export function marketplaceBoostPackageOptions(): MarketplaceBoostPackageOptionView[] {
  return boostPackageCodeSchema.options.map(marketplaceBoostPackageOption)
}

/**
 * The answer to any request to buy, start or renew a boost, whatever it names: refused, with the billing read model's
 * sentence. There is no purchase flow and no payment control (Blueprint §14, the #108 ruling).
 */
export function marketplaceBoostPurchase(request?: unknown): MarketplaceBoostPurchaseRefusal {
  // Whatever `request` names (a package, a job, a price, a start date), the answer is the same.
  void request

  return { purchasable: false, reason: MARKETPLACE_PLAN_NOT_PURCHASABLE }
}

// ---------------------------------------------------------------------------
// Audience estimate
// ---------------------------------------------------------------------------

const WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })

function requireCount(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a whole number, 0 or more`)
  }

  return value
}

/**
 * "14 trucks available within 100 miles" (the strategy's wedge: a landing sees its audience before it pays). Zero is
 * said as none, never as a forecast. `radiusMiles` is the radius the store counted in.
 */
export function marketplaceBoostAudienceHeadline(availableTrucks: number, radiusMiles: number): string {
  const trucks = requireCount(availableTrucks, "availableTrucks")
  const within = `within ${WHOLE.format(requireCount(radiusMiles, "radiusMiles"))} miles`

  if (trucks === 0) {
    return `No trucks available ${within} right now`
  }

  return `${WHOLE.format(trucks)} ${trucks === 1 ? "truck" : "trucks"} available ${within}`
}

/**
 * What the landing sees before any boost (§4.10, §10.24): the store's truck count, said plainly, and the package's
 * locked terms. The count is the store's own (`count_boost_audience_trucks`, fresh availability for the job's
 * equipment); businesses and reports are never shown as trucks. Nothing on it can be bought.
 */
export function marketplaceBoostAudienceSummary(audience: MarketplaceBoostAudienceView): MarketplaceBoostAudienceSummaryView {
  return {
    availableTrucks: audience.availableTrucks,
    headline: marketplaceBoostAudienceHeadline(audience.availableTrucks, audience.radiusMiles),
    jobId: audience.jobId,
    option: marketplaceBoostPackageOption(audience.packageCode),
    purchasable: false,
    purchaseNote: MARKETPLACE_PLAN_NOT_PURCHASABLE,
    radiusMiles: audience.radiusMiles
  }
}

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

/** What the phase of a boost reads: the store's status and window. */
export type MarketplaceBoostWindow = Pick<MarketplaceBoostView, "status" | "startsAt" | "endsAt">

function instant(value: string | null): number | null {
  if (value === null) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : time
}

/**
 * Where a boost stands at `now` (`MARKETPLACE_BOOST_PHASES`). An active boost runs from its start up to, but not
 * including, its end, exactly as the store sponsors it (`now() >= starts_at and now() < ends_at`); at its end it is
 * `ended` at once although the store keeps `active`. An active boost without a readable window never runs.
 */
export function marketplaceBoostPhase(boost: MarketplaceBoostWindow, now: Date): MarketplaceBoostPhase {
  switch (boost.status) {
    case "pending_payment":
      return "awaiting_payment"
    case "canceled":
      return "canceled"
    case "ended":
      return "ended"
    case "active": {
      const start = instant(boost.startsAt)
      const end = instant(boost.endsAt)
      const at = now.getTime()

      if (start === null || end === null || Number.isNaN(at)) return "ended"
      if (at < start) return "scheduled"

      return at < end ? "running" : "ended"
    }
  }
}

/** True only while the boost runs (`marketplaceBoostPhase` is `running`): the one time a job may be sponsored. */
export function marketplaceBoostRunning(boost: MarketplaceBoostWindow, now: Date): boolean {
  return marketplaceBoostPhase(boost, now) === "running"
}

// ---------------------------------------------------------------------------
// Sponsored ranking
// ---------------------------------------------------------------------------

export interface SponsoredRankingOptions<T> {
  /** The hauler's filters. A job that fails them is never in the result, boosted or not. */
  matches: (job: T) => boolean
  /**
   * The organic order, negative when `a` comes first: discovery's own comparator (`compareMarketplaceJobs` with the
   * hauler's sort). It should be total, as that one is, so the result is the same on every read.
   */
  compare: (a: T, b: T) => number
  /**
   * Whether a boost runs for the job now. By default the job's `sponsored` flag, which the store sets only while a
   * boost runs (`list_marketplace_jobs`, as of the read); pass `marketplaceBoostRunning` over a window to check again.
   */
  running?: (job: T) => boolean
  /** How many sponsored placements the list may hold; `MARKETPLACE_SPONSORED_SLOTS` by default. */
  slots?: number
}

/**
 * Results with sponsored placement applied (§8.8, §8.13, §10.32). Every job shown matches the hauler's filters, so they
 * are equally relevant; among them, the first `slots` jobs (in organic order) whose boost runs are lifted above the
 * rest and labelled `sponsored`. Every other job keeps its organic place and carries no label, including a boosted job
 * beyond the cap and a job whose label the boost no longer backs. A boosted job that fails the filters is never shown,
 * so it can outrank nothing. Returns new objects where the label changes; the input is never changed.
 */
export function rankSponsoredJobs<T extends { sponsored: boolean }>(jobs: readonly T[], options: SponsoredRankingOptions<T>): T[] {
  const slots = options.slots ?? MARKETPLACE_SPONSORED_SLOTS

  if (!Number.isSafeInteger(slots) || slots < 0) {
    throw new RangeError("slots must be a whole number, 0 or more")
  }

  const running = options.running ?? ((job: T) => job.sponsored)
  const organic = jobs.filter((job) => options.matches(job)).sort(options.compare)
  const lifted = new Set<T>(organic.filter((job) => running(job)).slice(0, slots))
  const label = (job: T, sponsored: boolean): T => (job.sponsored === sponsored ? job : { ...job, sponsored })

  return [
    ...organic.filter((job) => lifted.has(job)).map((job) => label(job, true)),
    ...organic.filter((job) => !lifted.has(job)).map((job) => label(job, false))
  ]
}
