import "server-only"

import type { NormalizedFeature } from "../normalized-adapter"
import { MARKETPLACE_FUNCTIONS } from "../normalized-db"
import { MARKETPLACE_QUERIES } from "../normalized-queries"
import { unavailableMarketplaceV2Feature, type MarketplaceTrucksPort } from "../port"
import { truckMethods } from "./methods"
import { TRUCK_FUNCTION_NAMES, TRUCK_STATEMENT_NAMES, type TruckStatementName } from "./statements"

/**
 * trucks (#251): Find Trucks, saved truck searches and availability alerts, over the normalized store.
 *
 * The functions are catalogue entries in `MARKETPLACE_FUNCTIONS` (normalized-db.ts) and the table reads and writes are
 * catalogue statements in `MARKETPLACE_QUERIES` (normalized-queries.ts), with this group's SQL in `statements.ts`.
 * Both catalogues are shared files this task does not edit. Until both hold everything every method needs, the whole
 * group refuses with `MarketplaceFeatureUnavailableError` and reaches no store, as the shared port v3 test requires of
 * a group that is not supported:
 *
 * - `record_truck_directory_page` (the daily seat limits) is not in stage 01–29: it needs a schema stage;
 * - the `truck_*` statements wait on their catalogue entries.
 *
 * The availability-alert matcher (`./alert-worker.ts`) is for the notification worker (#253) and needs the
 * service-role functions and the `truck_alert` notice category, also not in stage 01–29. `supported` stays false
 * until that wiring is on; the task that completes it sets it and updates the shared test.
 */

/** What each port method runs through the adapter: catalogue functions it calls and this group's statements. */
export const TRUCK_METHOD_NEEDS: Readonly<Record<keyof MarketplaceTrucksPort, { functions: readonly string[]; statements: readonly TruckStatementName[] }>> = {
  deleteTruckSearch: { functions: [], statements: ["truck_delete_search"] },
  listTruckSearches: { functions: [], statements: ["truck_list_searches"] },
  saveTruckSearch: {
    functions: ["get_viewer_marketplace_access", "get_org_entitlement_state"],
    statements: ["truck_viewer_identity", "truck_insert_search", "truck_update_search"]
  },
  searchTrucks: {
    functions: ["get_viewer_marketplace_access", "get_org_entitlement_state", "record_truck_directory_page"],
    statements: ["truck_viewer_identity", "truck_directory"]
  }
}

export interface TruckCatalogue {
  functions: ReadonlySet<string>
  statements: ReadonlySet<string>
}

const CATALOGUE: TruckCatalogue = {
  functions: new Set(Object.keys(MARKETPLACE_FUNCTIONS)),
  statements: new Set(Object.keys(MARKETPLACE_QUERIES))
}

/** The functions and statements this group runs that the catalogues do not have yet. */
export function missingTruckCatalogueEntries(catalogue: TruckCatalogue = CATALOGUE): { functions: string[]; statements: string[] } {
  const functions = new Set<string>(TRUCK_FUNCTION_NAMES)

  for (const needs of Object.values(TRUCK_METHOD_NEEDS)) {
    for (const name of needs.functions) functions.add(name)
  }

  return {
    functions: [...functions].filter((name) => !catalogue.functions.has(name)).sort(),
    statements: [...TRUCK_STATEMENT_NAMES].filter((name) => !catalogue.statements.has(name))
  }
}

/** True once the catalogues hold every function and statement any trucks method runs. */
export function trucksCatalogueReady(catalogue: TruckCatalogue = CATALOGUE): boolean {
  const missing = missingTruckCatalogueEntries(catalogue)

  return missing.functions.length === 0 && missing.statements.length === 0
}

export const normalizedTrucks: NormalizedFeature<"trucks"> = {
  methods: (context) => (trucksCatalogueReady() ? truckMethods(context) : unavailableMarketplaceV2Feature("trucks")),
  supported: false
}

/**
 * Robots for every Find Trucks and hauler profile page (legal review §6.5 item 4): never indexed or followed, and
 * never in the sitemap. The V2 layout already sets the same for every V2 page.
 */
export const TRUCK_DIRECTORY_ROBOTS = Object.freeze({ follow: false, index: false })

export { truckMethods } from "./methods"
export { runTruckAlertMatching, type TruckAlertRun, type TruckAlertWorkerSearch, type TruckAlertWorkerStore } from "./alert-worker"
