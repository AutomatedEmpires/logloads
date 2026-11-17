/**
 * boosts (#254): audience estimate, Sponsored ranking and expiry — no purchase (UX spec §4.10, §8.13, §8.14). Views for
 * `MarketplaceBoostsPort` (apps/web/lib/marketplace-v2/port.ts), the schemas its inputs are parsed with, and the read
 * models its rules build in `packages/services/src/v2/boosts/`.
 *
 * Packages, prices, durations and the radius stay in `BOOST_PACKAGES` and `BOOST_RADIUS_MILES` (membership.ts); they
 * are never restated here. Nothing is purchasable (Blueprint §14, the #108 ruling): every read model says so with the
 * billing read model's own sentence (`MARKETPLACE_PLAN_NOT_PURCHASABLE`), and no view, schema or rule starts a charge.
 */

import { z } from "zod"

import type { MarketplaceId } from "../../marketplace-port-v3"
import { boostPackageCodeSchema, type BoostPackage, type BoostPackageCode } from "../../membership"

/**
 * `estimate_boost_audience` and `count_boost_audience_trucks`: real counts in the boost radius around the job's public
 * landing area, never an impression forecast and never who is counted.
 */
export interface MarketplaceBoostAudienceView {
  jobId: MarketplaceId
  packageCode: BoostPackageCode
  /** The radius the store counted in (the package's `boost_products.radius_miles`). */
  radiusMiles: number
  /** Listed hauling businesses that consented to public discovery, whose service area is within the radius. */
  optedInHaulers: number
  /** Their availability reports whose window has not ended, for any equipment. */
  activeAvailabilityReports: number
  /**
   * Trucks those businesses reported available today for one of the job's equipment types, from FRESH reports only:
   * each business's latest report per equipment type, reported less than `HAULER_AVAILABILITY_FRESH_DAYS` ago, not
   * withdrawn, and with a window that covers today. A stale report counts nothing, and 0 is a real zero.
   */
  availableTrucks: number
}

/** `job_boosts.status`, as the store keeps it. An `active` boost stays `active` past its end; see `MarketplaceBoostPhase`. */
export const MARKETPLACE_BOOST_STATUSES = ["pending_payment", "active", "ended", "canceled"] as const
export type MarketplaceBoostStatus = (typeof MARKETPLACE_BOOST_STATUSES)[number]

/** One boost of one of the business's own jobs, as the store records it. */
export interface MarketplaceBoostView {
  id: MarketplaceId
  jobId: MarketplaceId
  /** The package the boost was sold as; `null` for a product not in `BOOST_PACKAGES`. */
  packageCode: BoostPackageCode | null
  status: MarketplaceBoostStatus
  durationDays: number
  /** The price the store froze when it recorded the boost. A record, never an offer (`MarketplaceBoostPackageOptionView`). */
  priceCents: number
  radiusMiles: number
  startsAt: string | null
  endsAt: string | null
  createdAt: string
}

// ---------------------------------------------------------------------------
// Expiry (§8.13, §9.16)
// ---------------------------------------------------------------------------

/**
 * Where a boost stands at a moment. Only `running` is sponsored: from its start up to, but not including, its end (the
 * store's `now() >= starts_at and now() < ends_at`). At its end a boost is `ended` at once, whatever status the store
 * still keeps, and a boost the store ended early (its job stopped) is `ended` too.
 */
export const MARKETPLACE_BOOST_PHASES = ["awaiting_payment", "scheduled", "running", "ended", "canceled"] as const
export type MarketplaceBoostPhase = (typeof MARKETPLACE_BOOST_PHASES)[number]

// ---------------------------------------------------------------------------
// Sponsored ranking (§8.8, §8.13, §10.32)
// ---------------------------------------------------------------------------

/**
 * The most Sponsored placements in one list of results, so sponsored jobs never crowd out ordinary ones (§8.13, "fair
 * cap per results page"). The store's own default for `list_marketplace_jobs` (`p_max_sponsored`, stages 03 and 06).
 */
export const MARKETPLACE_SPONSORED_SLOTS = 2

/** The one word a sponsored placement carries (AGENTS.md §1.5; `SponsoredIndicator` in packages/ui). */
export const MARKETPLACE_SPONSORED_LABEL = "Sponsored"

// ---------------------------------------------------------------------------
// No purchase (Blueprint §14, the #108 ruling)
// ---------------------------------------------------------------------------

/** One boost package as the boost page may show it: the locked terms from `BOOST_PACKAGES`, never for sale yet. */
export interface MarketplaceBoostPackageOptionView {
  package: BoostPackage
  /** `BOOST_RADIUS_MILES`: an approximate straight-line radius, not a road-distance promise. */
  radiusMiles: number
  /** A literal: a boost never renews (`BOOST_AUTO_RENEWS`). */
  autoRenews: false
  /** A literal: no purchase flow exists, so a page cannot offer a checkout by mistake. */
  purchasable: false
}

/**
 * What a landing sees before any boost (§4.10, §10.24): the trucks a boost could reach, and the package's locked terms.
 * Nothing on it can be bought.
 */
export interface MarketplaceBoostAudienceSummaryView {
  jobId: MarketplaceId
  /** The store's count (`MarketplaceBoostAudienceView.availableTrucks`), never padded or rounded. */
  availableTrucks: number
  radiusMiles: number
  /** "14 trucks available within 100 miles"; at zero, a plain statement that none are. */
  headline: string
  option: MarketplaceBoostPackageOptionView
  purchasable: false
  /** `MARKETPLACE_PLAN_NOT_PURCHASABLE`. */
  purchaseNote: string
}

/** The answer to any attempt to buy a boost: always refused, with the billing read model's sentence. */
export interface MarketplaceBoostPurchaseRefusal {
  purchasable: false
  reason: string
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

/** One job of the business, as a canonical lower-case UUID. */
export const marketplaceBoostJobIdSchema = z.string().trim().toLowerCase().uuid("Choose one of your business's jobs.")

/** One of `BOOST_PACKAGES`' codes; anything else is refused before the store. */
export const marketplaceBoostPackageCodeSchema = z.enum(boostPackageCodeSchema.options, { errorMap: () => ({ message: "Choose a boost package." }) })
