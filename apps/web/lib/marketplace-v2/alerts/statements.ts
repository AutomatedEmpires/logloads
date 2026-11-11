/**
 * Table statements for alerts (#252). Each one runs as the signed-in person, except the unsubscribe update, which
 * the signed token authorizes and which therefore does not call `current_user_id()`.
 *
 * Column lists match the grants in `02_access.sql` and `26_v2_team_seats_saved_jobs_outbox.sql`: `saved_jobs` may
 * be inserted only as `(org_id, job_id)` (the owner is the column default, `current_user_id()`), and `saved_searches`
 * may be inserted without `owner_user_id` and updated only in `name`, `criteria` and `alerts_enabled`.
 * Every value is a bound parameter. Nothing here selects an email address.
 */

export const ALERT_STATEMENT_NAMES = [
  "alert_delete_job_search",
  "alert_insert_job_search",
  "alert_list_job_searches",
  "alert_list_notification_preferences",
  "alert_save_job",
  "alert_set_notification_preference",
  "alert_unsubscribe_notification",
  "alert_unsave_job",
  "alert_update_job_search",
  "alert_viewer_user"
] as const

export type AlertStatementName = (typeof ALERT_STATEMENT_NAMES)[number]

interface StatementSpec {
  params: number
  text: string
}

export const ALERT_STATEMENTS: Readonly<Record<AlertStatementName, StatementSpec>> = {
  /** $1 org, $2 job. Saving again hits the primary key and changes nothing. */
  alert_save_job: {
    params: 2,
    text: `with saved as (
  insert into marketplace.saved_jobs (org_id, job_id)
  values ($1::text::uuid, $2::text::uuid)
  on conflict (user_id, org_id, job_id) do nothing
  returning job_id
)
select to_jsonb(saved) as row from saved`
  },

  /** $1 org, $2 job. Only the signed-in person's row in the active business. */
  alert_unsave_job: {
    params: 2,
    text: `with removed as (
  delete from marketplace.saved_jobs
  where org_id = $1::text::uuid
    and job_id = $2::text::uuid
    and user_id = marketplace.current_user_id()
  returning job_id
)
select to_jsonb(removed) as row from removed`
  },

  /** $1 org. The person's own job searches, newest edit first. */
  alert_list_job_searches: {
    params: 1,
    text: `select to_jsonb(s) as row from (
  select id, kind, name, criteria, alerts_enabled, last_alerted_at, updated_at
  from marketplace.saved_searches
  where org_id = $1::text::uuid
    and owner_user_id = marketplace.current_user_id()
    and kind = 'jobs'
  order by updated_at desc, id
) as s`
  },

  /** $1 org, $2 name, $3 criteria json, $4 alerts. Kind is always jobs. The owner is the column default. */
  alert_insert_job_search: {
    params: 4,
    text: `with added as (
  insert into marketplace.saved_searches (org_id, kind, name, criteria, alerts_enabled)
  values ($1::text::uuid, 'jobs', $2::text, $3::text::jsonb, $4::text::boolean)
  returning id
)
select to_jsonb(added) as row from added`
  },

  /**
   * $1 search, $2 org, $3 name, $4 criteria json, $5 alerts. Only the granted columns change, and only on the
   * person's own job search in the active business.
   */
  alert_update_job_search: {
    params: 5,
    text: `with changed as (
  update marketplace.saved_searches
  set name = $3::text, criteria = $4::text::jsonb, alerts_enabled = $5::text::boolean
  where id = $1::text::uuid
    and org_id = $2::text::uuid
    and owner_user_id = marketplace.current_user_id()
    and kind = 'jobs'
  returning id
)
select to_jsonb(changed) as row from changed`
  },

  /** $1 search, $2 org. Removing a search that is already gone changes nothing. */
  alert_delete_job_search: {
    params: 2,
    text: `with removed as (
  delete from marketplace.saved_searches
  where id = $1::text::uuid
    and org_id = $2::text::uuid
    and owner_user_id = marketplace.current_user_id()
    and kind = 'jobs'
  returning id
)
select to_jsonb(removed) as row from removed`
  },

  /** $1 org. Category, channel, enabled and when it was set. No address. */
  alert_list_notification_preferences: {
    params: 1,
    text: `select to_jsonb(p) as row from (
  select category, channel, enabled, updated_at
  from marketplace.notification_preferences
  where user_id = marketplace.current_user_id()
    and org_id = $1::text::uuid
) as p`
  },

  /** $1 org, $2 category, $3 channel, $4 enabled. The person is `current_user_id()`, on insert and on conflict. */
  alert_set_notification_preference: {
    params: 4,
    text: `with saved as (
  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled)
  values (marketplace.current_user_id(), $1::text::uuid, $2::text, $3::text, $4::text::boolean)
  on conflict (user_id, org_id, category, channel)
  do update set enabled = excluded.enabled, updated_at = now()
  where notification_preferences.user_id = marketplace.current_user_id()
    and notification_preferences.org_id = $1::text::uuid
  returning category
)
select to_jsonb(jsonb_build_object('saved', true)) as row from saved`
  },

  /**
   * $1 user, $2 org, $3 category, $4 channel. No session: the signed token already names the one preference.
   * The result is a flag, never the person, the business or an address. Zero rows (already off, or no row) is success.
   */
  alert_unsubscribe_notification: {
    params: 4,
    text: `with changed as (
  update marketplace.notification_preferences
  set enabled = false, updated_at = now()
  where user_id = $1::text::uuid
    and org_id = $2::text::uuid
    and category = $3::text
    and channel = $4::text
  returning category
)
select to_jsonb(jsonb_build_object('updated', true)) as row from changed`
  },

  /** The signed-in person's id only, for minting a link. The address column is not selected. */
  alert_viewer_user: {
    params: 0,
    text: `select to_jsonb(u) as row from (
  select a.id
  from marketplace.app_users a
  where a.id = marketplace.current_user_id()
) as u`
  }
}

/** The statement and its bound values. The text never contains a value. */
export function alertStatement(name: AlertStatementName, values: readonly (string | null)[]): { text: string; values: Array<string | null> } {
  const spec = ALERT_STATEMENTS[name]

  if (values.length !== spec.params || values.some((value) => value !== null && typeof value !== "string")) {
    throw new TypeError(`${name} takes exactly ${spec.params} text or null values`)
  }

  return { text: spec.text, values: [...values] }
}
