import "server-only"

import type { NormalizedFeature } from "../normalized-adapter"
import { alertMethods } from "./methods"

/**
 * alerts (#252, #316): saved jobs, job searches and notification consent, over the normalized store.
 *
 * Port v3 (#244) entry module, wired into `normalized-adapter.ts`. `alertMethods` (./methods.ts) runs the alerts rules
 * (packages/services/src/v2/alerts) over the catalogued function `list_saved_jobs` (`MARKETPLACE_FUNCTIONS`) and the
 * catalogued statements named in `ALERT_QUERY_NAMES` (./statements.ts; the SQL is in `MARKETPLACE_QUERIES`). Every
 * method works, so the group is supported.
 *
 * The signed-out unsubscribe is not a port method, and it is not wired: its update is not catalogued, because it has
 * no session and stage 26's policy is authenticated-only. #294 adds the SECURITY DEFINER function it needs.
 */
export const normalizedAlerts: NormalizedFeature<"alerts"> = {
  methods: (context) => alertMethods(context),
  supported: true
}

export { alertMethods, createAlertUnsubscribeToken, unsubscribeAlert } from "./methods"
