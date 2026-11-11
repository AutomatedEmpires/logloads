/**
 * boosts (#254): audience estimate, Sponsored ranking and expiry — no purchase (UX spec §4.10, §8.13, §8.14). Views for
 * `MarketplaceBoostsPort` (apps/web/lib/marketplace-v2/port.ts). Packages and prices stay in `BOOST_PACKAGES`. #254
 * adds its rules here and in `packages/services/src/v2/boosts/`.
 */

import type { MarketplaceId } from "../../marketplace-port-v3"
import type { BoostPackageCode } from "../../membership"

/** `estimate_boost_audience`: real opted-in counts in the boost radius, never an impression forecast. */
export interface MarketplaceBoostAudienceView {
  jobId: MarketplaceId
  packageCode: BoostPackageCode
  radiusMiles: number
  optedInHaulers: number
  activeAvailabilityReports: number
}

/** `job_boosts.status`. */
export const MARKETPLACE_BOOST_STATUSES = ["pending_payment", "active", "ended", "canceled"] as const
export type MarketplaceBoostStatus = (typeof MARKETPLACE_BOOST_STATUSES)[number]

/** One boost of one of the business's own jobs. */
export interface MarketplaceBoostView {
  id: MarketplaceId
  jobId: MarketplaceId
  /** The package the boost was sold as; `null` for a product not in `BOOST_PACKAGES`. */
  packageCode: BoostPackageCode | null
  status: MarketplaceBoostStatus
  durationDays: number
  priceCents: number
  radiusMiles: number
  startsAt: string | null
  endsAt: string | null
  createdAt: string
}
