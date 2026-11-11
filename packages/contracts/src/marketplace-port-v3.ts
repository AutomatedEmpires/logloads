/**
 * Marketplace V2 port v3 (#244): what the feature groups that `MarketplaceV2Port`
 * (apps/web/lib/marketplace-v2/port.ts) gained for the UX spec v1.0 work still missing (logloads#235, N1–N9) share.
 *
 * Each group is built by its own task in its own three folders: `apps/web/lib/marketplace-v2/<group>/`,
 * `packages/contracts/src/v2/<group>/` (its views, inputs and schemas) and `packages/services/src/v2/<group>/` (its
 * pure rules). Every folder already has an `index.ts` that the shared files export or wire, so a task changes only
 * its own folders. Views state only what the store records: an unknown value is `null`, never a guess, and no figure
 * is derived where the store keeps none (AGENTS.md §8).
 *
 * Write methods take `input: unknown` and the adapter re-parses it, as every port write does. Each group's `…Input`
 * interface is the parsed shape; the group's schema must produce exactly that shape (`z.ZodType<…Input>`).
 *
 * Plan limits are never part of a view. They come from `LANDING_PLANS` by plan code, as for
 * `MarketplaceLandingAllowanceView`.
 */

// ---------------------------------------------------------------------------
// Feature groups
// ---------------------------------------------------------------------------

/**
 * The port v3 groups, named after the folders their tasks own: jobs #247, billing #248, team #249, invites #250,
 * trucks #251, alerts #252, notify #253, boosts #254, admin #255.
 */
export const MARKETPLACE_V2_FEATURES = ["jobs", "billing", "team", "invites", "trucks", "alerts", "notify", "boosts", "admin"] as const
export type MarketplaceV2Feature = (typeof MARKETPLACE_V2_FEATURES)[number]

/**
 * Which groups work through an adapter. A page checks this before offering a group's actions, as it checks
 * `supportsPublishing`; a group that is `false` refuses its methods with `MarketplaceOperationUnavailableError`
 * (some read methods of a group may already work; each method's documentation says so).
 */
export type MarketplaceV2FeatureSupport = Readonly<Record<MarketplaceV2Feature, boolean>>

/** A frozen support record: `true` for the groups named, `false` for every other one. */
export function marketplaceV2FeatureSupport(supported: readonly MarketplaceV2Feature[] = []): MarketplaceV2FeatureSupport {
  const entries = MARKETPLACE_V2_FEATURES.map((feature) => [feature, supported.includes(feature)] as const)

  return Object.freeze(Object.fromEntries(entries) as Record<MarketplaceV2Feature, boolean>)
}

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** An id a port v3 method takes or returns (a UUID in the normalized store). A malformed id is refused before the store. */
export type MarketplaceId = string

/** One of the business's own landings, by name. */
export interface MarketplaceLandingRef {
  id: MarketplaceId
  name: string
}

/** `notification_preferences.channel` and `notification_outbox.channel`. */
export const MARKETPLACE_NOTIFICATION_CHANNELS = ["in_app", "email"] as const
export type MarketplaceNotificationChannel = (typeof MARKETPLACE_NOTIFICATION_CHANNELS)[number]

/** Job searches (alerts #252) and truck searches (trucks #251) share `saved_searches`. */
export const MARKETPLACE_SAVED_SEARCH_KINDS = ["jobs", "trucks"] as const
export type MarketplaceSavedSearchKind = (typeof MARKETPLACE_SAVED_SEARCH_KINDS)[number]

/** One of the person's own saved searches in the active business. */
export interface MarketplaceSavedSearchView<Criteria = Record<string, unknown>> {
  id: MarketplaceId
  kind: MarketplaceSavedSearchKind
  name: string
  /** The search's filters as saved; the owning group's schema parses them. */
  criteria: Criteria
  alertsEnabled: boolean
  lastAlertedAt: string | null
  updatedAt: string
}

export interface MarketplaceSavedSearchInput<Criteria = Record<string, unknown>> {
  /** Present to edit one of the person's own searches. */
  searchId?: MarketplaceId
  /** 1–80 characters. */
  name: string
  criteria: Criteria
  alertsEnabled: boolean
}
