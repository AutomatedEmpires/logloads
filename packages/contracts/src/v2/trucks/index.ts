/**
 * trucks (#251): Find Trucks — the directory of listed hauling businesses, and availability alerts (UX spec §4.8,
 * §4.13). Views for `MarketplaceTrucksPort` (apps/web/lib/marketplace-v2/port.ts); saved truck searches use the
 * shared `MarketplaceSavedSearchView`. #251 adds its schemas and rules here and in `packages/services/src/v2/trucks/`.
 */

import type { Coordinates } from "../../geo"
import type { HaulerEquipmentSummaryLine } from "../../marketplace-hauler"
import type { MarketplaceId } from "../../marketplace-port-v3"
import type { MarketplaceVerification } from "../../marketplace-v2"

export interface MarketplaceTruckFilters {
  query?: string | null
  /** One equipment code the business lists. */
  equipment?: string | null
  /** A place the user typed, snapped to the public 0.1° grid; never a device location. */
  near?: Coordinates | null
  radiusMiles?: number | null
  /** Only businesses with an open availability report. */
  availableOnly?: boolean
}

/** One listed business in the directory. Self-reported; "available" never means it can haul today. */
export interface MarketplaceTruckCardView {
  organizationId: MarketplaceId
  businessName: string
  homeBase: string | null
  serviceRadiusMiles: number | null
  equipment: HaulerEquipmentSummaryLine[]
  /** Trucks reported available across types, when the business shared a count; `null` otherwise. */
  availableTrucks: number | null
  /** The latest availability report time; `null` when it never reported. Stale dates stay visible. */
  availabilityReportedAt: string | null
  acceptsInvitations: boolean
  verification: MarketplaceVerification | null
}
