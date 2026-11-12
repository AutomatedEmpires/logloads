import "server-only"

import type { NormalizedFeature } from "../normalized-adapter"
import { MARKETPLACE_FUNCTIONS } from "../normalized-db"
import { MARKETPLACE_QUERIES } from "../normalized-queries"
import { unavailableMarketplaceV2Feature, type MarketplaceBoostsPort } from "../port"
import { boostMethods } from "./methods"
import type { BoostStatementName } from "./statements"

/**
 * boosts (#254): the audience estimate and the business's boosts, over the normalized store. No purchase.
 *
 * The functions are catalogue entries in `MARKETPLACE_FUNCTIONS` (normalized-db.ts) and the table read is a catalogue
 * statement in `MARKETPLACE_QUERIES` (normalized-queries.ts), with this group's SQL in `statements.ts`. Both catalogues
 * are shared files this task does not edit. Until both hold everything every method needs, the whole group refuses
 * with `MarketplaceFeatureUnavailableError` and reaches no store, as the shared port v3 test requires of a group that
 * is not supported:
 *
 * - `count_boost_audience_trucks` (trucks from fresh availability for the job's equipment) is not in stages 01–31: it
 *   needs a schema stage, then its catalogue entry;
 * - `boost_list` waits on its catalogue entry.
 *
 * `supported` stays false until that wiring is on; the task that completes it sets it and updates the shared test.
 * Sponsored ranking and expiry are pure rules (`rankSponsoredJobs`, `marketplaceBoostPhase` in packages/services).
 * The store already labels only a running boost, capped per list (`list_marketplace_jobs`); applying the placement in
 * discovery (`refineDiscovery` and the job keyset order, shared files) is a follow-up for their owner.
 */

/** What each port method runs through the adapter: catalogue functions it calls and this group's statements. */
export const BOOST_METHOD_NEEDS: Readonly<Record<keyof MarketplaceBoostsPort, { functions: readonly string[]; statements: readonly BoostStatementName[] }>> = {
  boostAudience: { functions: ["get_marketplace_job", "estimate_boost_audience", "count_boost_audience_trucks"], statements: [] },
  listJobBoosts: { functions: [], statements: ["boost_list"] }
}

export interface BoostCatalogue {
  functions: ReadonlySet<string>
  statements: ReadonlySet<string>
}

const CATALOGUE: BoostCatalogue = {
  functions: new Set(Object.keys(MARKETPLACE_FUNCTIONS)),
  statements: new Set(Object.keys(MARKETPLACE_QUERIES))
}

/** True once the catalogues hold every function and statement `method` runs. */
export function boostMethodReady(method: keyof MarketplaceBoostsPort, catalogue: BoostCatalogue = CATALOGUE): boolean {
  const needs = BOOST_METHOD_NEEDS[method]

  return needs.functions.every((name) => catalogue.functions.has(name)) && needs.statements.every((name) => catalogue.statements.has(name))
}

/** True once the catalogues hold every function and statement any boosts method runs. */
export function boostsCatalogueReady(catalogue: BoostCatalogue = CATALOGUE): boolean {
  return (Object.keys(BOOST_METHOD_NEEDS) as Array<keyof MarketplaceBoostsPort>).every((method) => boostMethodReady(method, catalogue))
}

export const normalizedBoosts: NormalizedFeature<"boosts"> = {
  methods: (context) => (boostsCatalogueReady() ? boostMethods(context) : unavailableMarketplaceV2Feature("boosts")),
  supported: false
}

export { boostMethods } from "./methods"
