/**
 * Statements for alerts (#252, #316).
 *
 * The signed-in reads and writes are catalogued table statements (`MARKETPLACE_QUERIES`, normalized-queries.ts) named
 * in `ALERT_QUERY_NAMES`. Each one runs as the person, binds the active business as `$1` and checks the person's
 * membership of it, and writes only the columns `02_access.sql` and `26_v2_team_seats_saved_jobs_outbox.sql` grant.
 *
 * The one statement kept here is the signed-out unsubscribe update. It is deliberately NOT catalogued: it has no
 * session, so it cannot pass stage 26's authenticated-only `notification_preferences_self` policy, and no adapter
 * transaction can run it (`marketplaceQueryStatement` refuses a name outside the catalogue). #294 adds the narrow
 * SECURITY DEFINER function that replaces it. Until then nothing applies an unsubscribe link.
 */

import type { AlertUnsubscribeTarget } from "@logloads/services"

import type { MarketplaceQueryName } from "../normalized-queries"

/** The catalogued statements the alerts methods run, besides the `list_saved_jobs` function. */
export const ALERT_QUERY_NAMES = [
  "alert_delete_job_search",
  "alert_insert_job_search",
  "alert_list_job_searches",
  "alert_list_notification_preferences",
  "alert_save_job",
  "alert_set_notification_preference",
  "alert_unsave_job",
  "alert_update_job_search",
  "alert_viewer_user"
] as const satisfies readonly MarketplaceQueryName[]

/**
 * $1 user, $2 org, $3 category, $4 channel. No session: the signed token already names the one preference. The
 * result is a flag, never the person, the business or an address. Zero rows (already off, or no row) is success.
 */
export const ALERT_UNSUBSCRIBE_STATEMENT = `with changed as (
  update marketplace.notification_preferences
  set enabled = false, updated_at = now()
  where user_id = $1::text::uuid
    and org_id = $2::text::uuid
    and category = $3::text
    and channel = $4::text
  returning category
)
select to_jsonb(jsonb_build_object('updated', true)) as row from changed`

/** The unsubscribe update and its bound values for one verified token's target. The text never contains a value. */
export function alertUnsubscribeStatement(target: AlertUnsubscribeTarget): { text: string; values: Array<string | null> } {
  return { text: ALERT_UNSUBSCRIBE_STATEMENT, values: [target.userId, target.organizationId, target.category, target.channel] }
}
