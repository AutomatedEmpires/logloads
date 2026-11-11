import "server-only"

import type { NormalizedFeature } from "../normalized-adapter"
import { MARKETPLACE_FUNCTIONS } from "../normalized-db"
import { MARKETPLACE_QUERIES } from "../normalized-queries"
import { unavailableMarketplaceV2Feature } from "../port"
import { alertMethods } from "./methods"
import { ALERT_STATEMENT_NAMES } from "./statements"

/**
 * alerts (#252): saved jobs, job searches and notification consent, over the normalized store.
 *
 * `list_saved_jobs` is a catalogue function (`MARKETPLACE_FUNCTIONS`). The table writes are catalogue statements
 * (`MARKETPLACE_QUERIES`), named in `ALERT_STATEMENT_NAMES`, with the SQL in `statements.ts`. #269 owns the function
 * catalogue and this task does not edit it. Until both catalogues contain these names, every port method refuses
 * and reaches no store. `supported` stays false until that wiring is on and the group's methods are the live ones.
 */

const ALERT_FUNCTIONS = ["list_saved_jobs"] as const

/** True once the normalized catalogues contain every function and statement this group runs. */
export function alertsCatalogueReady(): boolean {
  return ALERT_FUNCTIONS.every((name) => Object.prototype.hasOwnProperty.call(MARKETPLACE_FUNCTIONS, name))
    && ALERT_STATEMENT_NAMES.every((name) => Object.prototype.hasOwnProperty.call(MARKETPLACE_QUERIES, name))
}

export const normalizedAlerts: NormalizedFeature<"alerts"> = {
  methods: (context) => (alertsCatalogueReady() ? alertMethods(context) : unavailableMarketplaceV2Feature("alerts")),
  supported: false
}

export { alertMethods, createAlertUnsubscribeToken, unsubscribeAlert } from "./methods"
