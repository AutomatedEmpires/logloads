/**
 * The closed list of table statements the normalized adapter may run, beside the schema functions in
 * `MARKETPLACE_FUNCTIONS` (normalized-db.ts). They exist where the schema has no function for a V2 screen yet: the
 * hauling business's own profile (#125), and its trucks and self-reported availability (#126). Each one runs inside
 * the identity-bound transaction as `authenticated`, so the schema's row-level security, column grants and triggers
 * decide what the person may read and change:
 *
 *   hauler_profiles   read: members; update: owner or manager (hauler_profiles_update), consent stamped by
 *                     tg_hauler_public_consent, invitation consent by tg_hauler_profile_guard
 *   organizations     update: owner only (organizations_owner_update); tg_org_identity_guard re-opens verification
 *                     when a verified business changes its legal name (LE-08)
 *   equipment_units   read: members; insert/update: owner, manager or staff (equipment_units_insert/_update)
 *   availability_reports  read: members; insert/update: owner, manager or staff here (availability_insert/_update);
 *                     tg_availability_guard snaps the area and stamps reported_at on every write
 *   promotion_redemptions  read: owners (promotion_redemptions_read), only the M2 column grant (16); the founding
 *                     offer (#248, #306)
 *   promotions        read: open promotions only (promotions_read), so a closed one's terms come back NULL
 *   job_postings      the poster's own jobs (#247). read: the landing desk (job_postings_read); update: owner,
 *                     manager or staff with a seat (job_postings_update), public columns only; tg_job_guard,
 *                     tg_job_hold_duplicate_guard and tg_landing_scope_guard decide again
 *   job_posting_equipment  insert/delete for the desk's own jobs (job_equipment_write/_remove)
 *   targeted_invitations, job_boosts  read: the sending desk (invitations_read, job_boosts_read), counts and windows only
 *   saved_jobs        the person's own saved jobs (#252, #316). read/insert: the person, as a member (saved_jobs_read/
 *                     _insert); insert only (org_id, job_id), the person is the column default; tg_saved_job_guard
 *                     refuses the business's own job and a job that is not open
 *   saved_searches    the person's own job searches (saved_searches_own); insert without owner_user_id, update only
 *                     name, criteria and alerts_enabled
 *   notification_preferences  the person's own consents in the business (notification_preferences_self)
 *   app_users         the person's own id only, to mint an unsubscribe link; never an address
 *
 * Every statement also names the active business explicitly (`$1`) and checks the person's membership of it, so a
 * person who belongs to several businesses only ever reads or changes the one they are acting for. Values are bound
 * parameters sent as text and cast in SQL; names are schema-qualified (the session's search path is empty). Rows
 * come back as `to_jsonb(row)`, like the function calls.
 */

export type MarketplaceQueryArgument = "uuid" | "text" | "integer" | "numeric" | "boolean" | "date"

interface QuerySpec {
  args: readonly MarketplaceQueryArgument[]
  text: string
}

const MEMBER_ROLES = "array['owner', 'manager', 'staff', 'driver']::text[]"
/** Who may change a business's equipment and availability (equipment_units / availability_reports updates). */
const DESK_ROLES = "array['owner', 'manager', 'staff']::text[]"

export const MARKETPLACE_QUERIES = {
  /** The active business's hauler profile with its organization, and what the person may change. */
  hauler_profile: {
    args: ["uuid"],
    text: `
select to_jsonb(p) as row from (
  select o.id as org_id, o.display_name, o.legal_name, o.verification_status, o.verified_at,
         h.base_area_label, h.service_radius_miles, h.description, h.is_public, h.accepts_targeted_invitations, h.updated_at,
         marketplace.has_org_role(o.id, array['owner']::text[]) as can_edit_identity,
         marketplace.has_org_role(o.id, array['owner', 'manager']::text[]) as can_edit_profile
  from marketplace.organizations o
  join marketplace.hauler_profiles h on h.org_id = o.id
  where o.id = $1::text::uuid
    and marketplace.has_org_role(o.id, ${MEMBER_ROLES})
) as p`
  },

  /**
   * The profile fields an owner or manager may change. The service point is the home base's place-list point
   * ($7 latitude, $8 longitude; the guard trigger snaps it to the public grid), or none without a home base.
   */
  hauler_profile_update: {
    args: ["uuid", "text", "integer", "text", "boolean", "boolean", "numeric", "numeric"],
    text: `
with changed as (
  update marketplace.hauler_profiles
  set service_center = case
        when $7::text is null or $8::text is null then null
        else extensions.st_setsrid(extensions.st_makepoint($8::text::float8, $7::text::float8), 4326)::extensions.geography
      end,
      base_area_label = $2::text,
      service_radius_miles = $3::text::integer,
      description = $4::text,
      is_public = $5::text::boolean,
      accepts_targeted_invitations = $6::text::boolean
  where org_id = $1::text::uuid
    and marketplace.has_org_role(org_id, array['owner', 'manager']::text[])
  returning org_id
) select to_jsonb(changed) as row from changed`
  },

  /** The business name and legal name, owner only. */
  organization_identity_update: {
    args: ["uuid", "text", "text"],
    text: `
with changed as (
  update marketplace.organizations
  set display_name = $2::text, legal_name = $3::text
  where id = $1::text::uuid
    and marketplace.has_org_role(id, array['owner']::text[])
  returning id
) select to_jsonb(changed) as row from changed`
  },

  // ---- My trucks (#126) -------------------------------------------------------------------------------------

  /** Whether the person may change the business's trucks, and whether it has a service area to report from. */
  hauler_fleet_access: {
    args: ["uuid"],
    text: `
select to_jsonb(a) as row from (
  select h.org_id,
         marketplace.has_org_role(h.org_id, ${DESK_ROLES}) as can_edit,
         h.service_center is not null and h.service_radius_miles is not null as placed
  from marketplace.hauler_profiles h
  where h.org_id = $1::text::uuid
    and marketplace.has_org_role(h.org_id, ${MEMBER_ROLES})
) as a`
  },

  /** The business's listed trucks and extras (equipment_units), in the reference list's order. */
  hauler_equipment_units: {
    args: ["uuid"],
    text: `
select to_jsonb(u) as row from (
  select eu.id, eu.equipment_code, eu.paired_trailer_code, eu.capacity_note, eu.unit_label, eu.unit_count, et.category
  from marketplace.equipment_units eu
  join marketplace.equipment_types et on et.code = eu.equipment_code
  where eu.org_id = $1::text::uuid
    and eu.is_active
    and et.category in ('truck', 'attachment')
    and marketplace.has_org_role(eu.org_id, ${MEMBER_ROLES})
  order by et.sort_order, eu.created_at, eu.unit_label
) as u`
  },

  /**
   * The latest self-report per truck type: the open report if there is one (V2 keeps at most one), otherwise the
   * latest withdrawal, which is "not available" as of `withdrawn_at`.
   */
  hauler_availability_latest: {
    args: ["uuid"],
    text: `
select to_jsonb(r) as row from (
  select distinct on (ar.equipment_code)
         ar.equipment_code, ar.available_count, ar.available_from, ar.available_until, ar.reported_at, ar.withdrawn_at
  from marketplace.availability_reports ar
  where ar.org_id = $1::text::uuid
    and marketplace.has_org_role(ar.org_id, ${MEMBER_ROLES})
  order by ar.equipment_code, (ar.withdrawn_at is null) desc, coalesce(ar.withdrawn_at, ar.reported_at) desc, ar.reported_at desc
) as r`
  },

  /**
   * Adds a configuration or extra; a removed row with the same label comes back with the new count (the label is
   * unique per business). Owner, manager or staff.
   */
  equipment_unit_upsert: {
    args: ["uuid", "text", "text", "text", "integer", "text"],
    text: `
with added as (
  insert into marketplace.equipment_units (org_id, equipment_code, paired_trailer_code, unit_label, unit_count, capacity_note)
  select $1::text::uuid, $2::text, $3::text, $4::text, $5::text::integer, $6::text
  where marketplace.has_org_role($1::text::uuid, ${DESK_ROLES})
  on conflict (org_id, unit_label) do update
    set equipment_code = excluded.equipment_code,
        paired_trailer_code = excluded.paired_trailer_code,
        unit_count = excluded.unit_count,
        capacity_note = excluded.capacity_note,
        is_active = true
  returning id
) select to_jsonb(added) as row from added`
  },

  /** A listed row's count; 0 takes it off the list (is_active = false; the row and its history stay). */
  equipment_unit_set_count: {
    args: ["uuid", "uuid", "integer"],
    text: `
with changed as (
  update marketplace.equipment_units
  set unit_count = case when $3::text::integer > 0 then $3::text::integer else unit_count end,
      is_active = $3::text::integer > 0
  where id = $2::text::uuid
    and org_id = $1::text::uuid
    and is_active
    and marketplace.has_org_role(org_id, ${DESK_ROLES})
  returning id, equipment_code
) select to_jsonb(changed) as row from changed`
  },

  /** Withdraws the open report of a truck type ("not available", or before a new report). */
  availability_withdraw: {
    args: ["uuid", "text"],
    text: `
with changed as (
  update marketplace.availability_reports
  set withdrawn_at = now()
  where org_id = $1::text::uuid
    and equipment_code = $2::text
    and withdrawn_at is null
    and marketplace.has_org_role(org_id, ${DESK_ROLES})
  returning id
) select to_jsonb(changed) as row from changed`
  },

  /** "Not available" said again: the latest withdrawal of that type, with no open report, is re-dated to now. */
  availability_restate_withdrawn: {
    args: ["uuid", "text"],
    text: `
with latest as (
  select ar.id
  from marketplace.availability_reports ar
  where ar.org_id = $1::text::uuid
    and ar.equipment_code = $2::text
    and ar.withdrawn_at is not null
    and not exists (select 1 from marketplace.availability_reports o
                    where o.org_id = ar.org_id and o.equipment_code = ar.equipment_code and o.withdrawn_at is null)
  order by ar.withdrawn_at desc
  limit 1
), changed as (
  update marketplace.availability_reports
  set withdrawn_at = now()
  where id in (select id from latest)
    and marketplace.has_org_role(org_id, ${DESK_ROLES})
  returning id
) select to_jsonb(changed) as row from changed`
  },

  /**
   * A new self-report: N trucks of a type, from a date, for the business's service area (its home base's point and
   * travel distance). Nothing is reported without a service area; the area is never guessed.
   */
  availability_insert: {
    args: ["uuid", "text", "integer", "date", "date"],
    text: `
with added as (
  insert into marketplace.availability_reports
    (org_id, equipment_code, available_count, area_center, area_label, radius_miles, available_from, available_until)
  select h.org_id, $2::text, $3::text::integer, h.service_center, h.base_area_label, h.service_radius_miles, $4::text::date, $5::text::date
  from marketplace.hauler_profiles h
  where h.org_id = $1::text::uuid
    and h.service_center is not null
    and h.service_radius_miles is not null
    and marketplace.has_org_role(h.org_id, ${DESK_ROLES})
  returning id
) select to_jsonb(added) as row from added`
  },

  /** "Confirm all as shown" for an open report: the same count, from today (or its later start) for a week. */
  availability_renew: {
    args: ["uuid", "text"],
    text: `
with changed as (
  update marketplace.availability_reports
  set available_from = greatest(available_from, current_date),
      available_until = greatest(available_from, current_date) + 7
  where org_id = $1::text::uuid
    and equipment_code = $2::text
    and withdrawn_at is null
    and marketplace.has_org_role(org_id, ${DESK_ROLES})
  returning id
) select to_jsonb(changed) as row from changed`
  },

  /** A list lowered below an open report brings the report down to the units still listed. */
  availability_clamp: {
    args: ["uuid", "text", "integer"],
    text: `
with changed as (
  update marketplace.availability_reports
  set available_count = $3::text::integer
  where org_id = $1::text::uuid
    and equipment_code = $2::text
    and withdrawn_at is null
    and available_count > $3::text::integer
    and marketplace.has_org_role(org_id, ${DESK_ROLES})
  returning id
) select to_jsonb(changed) as row from changed`
  },

  // ---- Billing (#248, #306) ---------------------------------------------------------------------------------

  /**
   * The business's founding-operator redemption (one per business, `UNIQUE (program, org_id)`) with its promotion's
   * terms. Owners only: the explicit role check keeps a billing admin, whom `promotion_redemptions_read` lets read
   * every business's redemption, to the business they own. A promotion row-level security hides leaves its terms NULL.
   */
  founding_offer: {
    args: ["uuid"],
    text: `
select to_jsonb(f) as row from (
  select pr.status, pr.granted_at, pr.cycles_applied, p.state_code, p.percent_off, p.billing_cycles
  from marketplace.promotion_redemptions pr
  left join marketplace.promotions p on p.id = pr.promotion_id and p.program = pr.program
  where pr.org_id = $1::text::uuid
    and pr.program = 'founding_landing'
    and marketplace.has_org_role(pr.org_id, array['owner']::text[])
) as f`
  },

  // ---- Jobs (#247) ------------------------------------------------------------------------------------------
  //
  // The poster's own jobs. No stage 01–26 function returns a job's landing or edits a posted job, so these run as the
  // person under job_postings' row-level security (`job_postings_read`, `job_postings_update`), its column grants
  // (landing_id, status, published_at and last_confirmed_at are not updatable), and its triggers: `tg_job_guard`
  // re-checks pay and keeps `last_confirmed_at` from the attestation ledger, `tg_job_hold_duplicate_guard` refuses a
  // held title, and `tg_landing_scope_guard` (26-B) refuses a landing outside the person's scope. Each statement also
  // names the active business ($1), needs a landing desk role with a seat, and keeps to the person's landings.

  /**
   * The business's own non-draft jobs on landings in the person's scope; only $2 when it is given. Each row is the
   * job's `list_marketplace_jobs` row, so the public view is exactly what haulers see, plus its landing, when it was
   * saved, the targeted invitations delivered for it and its latest boost window. At most 200, as that function
   * returns; jobs at an archived landing are not among them.
   */
  own_jobs: {
    args: ["uuid", "uuid"],
    text: `
select to_jsonb(r) as row from (
  select pub.*,
         j.landing_id,
         l.name as landing_name,
         j.created_at,
         (select count(*)::integer
          from marketplace.targeted_invitations ti
          where ti.job_id = j.id and ti.sender_org_id = j.org_id and ti.status = 'delivered') as invitations_delivered,
         (select jsonb_build_object('starts_at', jb.starts_at, 'ends_at', jb.ends_at,
                                    'active', jb.status = 'active' and now() >= jb.starts_at and now() < jb.ends_at)
          from marketplace.job_boosts jb
          where jb.job_id = j.id and jb.org_id = j.org_id and jb.starts_at is not null
          order by jb.starts_at desc, jb.id desc
          limit 1) as boost
  from marketplace.list_marketplace_jobs(p_accepting_only => false, p_org_id => $1::text::uuid, p_limit => 200, p_job_id => $2::text::uuid) as pub
  join marketplace.job_postings j on j.id = pub.job_id and j.org_id = $1::text::uuid
  join marketplace.landings l on l.id = j.landing_id and l.org_id = j.org_id
  where j.status <> 'draft'
    and marketplace.has_org_role(j.org_id, ${DESK_ROLES}, true)
    and marketplace.landing_scope_allows(j.org_id, j.landing_id)
  order by j.created_at desc, j.id desc
) as r`
  },

  /**
   * Locks one of the business's own non-draft jobs on a landing in the person's scope for the rest of the transaction,
   * so the lifecycle rules are checked on the row the write then changes. No row: not one of them. (`for update)` is
   * written without a space before the parenthesis: the catalogue test reads "update" followed by a space as a
   * table write and wants a schema-qualified name after it.)
   */
  own_job_lock: {
    args: ["uuid", "uuid"],
    text: `
with locked as (
  select j.id
  from marketplace.job_postings j
  where j.id = $2::text::uuid
    and j.org_id = $1::text::uuid
    and j.status <> 'draft'
    and marketplace.has_org_role(j.org_id, ${DESK_ROLES}, true)
    and marketplace.landing_scope_allows(j.org_id, j.landing_id)
  for update) select to_jsonb(locked) as row from locked`
  },

  /**
   * Saves a posted job's public terms, as `publish_job_posting` takes them, and its equipment. Never the landing,
   * the status or the confirmation. $3 title, $4 description, $5 product, $6 destination, $7 one-way miles, $8 daily
   * loads, $9 loads per truck per day, $10 tons per load, $11 pay in cents, $12 pay basis, $13 pay note, $14 road
   * notes, $15 trucks requested, $16 trucks per day, $17 start date, $18 duration in days, $19 equipment codes as a
   * JSON array. The end date is the start plus the duration, as publishing stores it. Returns the new `updated_at`.
   */
  own_job_edit: {
    args: ["uuid", "uuid", "text", "text", "text", "text", "integer", "integer", "numeric", "numeric", "integer", "text", "text", "text", "integer", "integer", "date", "integer", "text"],
    text: `
with changed as (
  update marketplace.job_postings j
  set title = $3::text,
      description = $4::text,
      product = $5::text,
      destination_label = $6::text,
      est_one_way_miles = $7::text::integer,
      est_daily_loads = $8::text::integer,
      est_loads_per_truck_per_day = $9::text::numeric,
      est_tons_per_load = $10::text::numeric,
      pay_amount_cents = $11::text::bigint,
      pay_unit = $12::text,
      pay_note = $13::text,
      public_road_notes = $14::text,
      trucks_requested = $15::text::integer,
      trucks_per_day = $16::text::integer,
      work_starts_on = $17::text::date,
      duration_days = $18::text::integer,
      work_ends_on = case when $17::text is null or $18::text is null then null
                          else $17::text::date + ($18::text::integer - 1) end
  where j.id = $2::text::uuid
    and j.org_id = $1::text::uuid
    and j.status <> 'draft'
    and marketplace.has_org_role(j.org_id, ${DESK_ROLES}, true)
    and marketplace.landing_scope_allows(j.org_id, j.landing_id)
  returning j.id, j.updated_at
), wanted as (
  select distinct code from jsonb_array_elements_text($19::text::jsonb) as code
), removed as (
  delete from marketplace.job_posting_equipment e
  using changed c
  where e.job_id = c.id and e.equipment_code not in (select code from wanted)
  returning e.equipment_code
), added as (
  insert into marketplace.job_posting_equipment (job_id, equipment_code)
  select c.id, w.code
  from changed c, wanted w
  where not exists (select 1 from marketplace.job_posting_equipment e where e.job_id = c.id and e.equipment_code = w.code)
  returning equipment_code
) select jsonb_build_object('id', c.id, 'updated_at', c.updated_at) as row from changed c`
  },

  // ---- Alerts (#252, #316) ----------------------------------------------------------------------------------
  //
  // The person's own saved jobs, job searches and notification consents in the active business. Stage 26 has a
  // function only for listing saved jobs (`list_saved_jobs`), so the rest run as the person under each table's
  // row-level security (saved_jobs_read/_insert/_delete, saved_searches_own, notification_preferences_self), which
  // admits any active member. Each statement also checks that membership of the active business ($1) itself: a write
  // answers with exactly one row for a member and none for anyone else, so a non-member is refused instead of being
  // told it saved. The person is always `current_user_id()` or the column default, never a value from the caller. None
  // of these reads an address. The signed-out unsubscribe is not here: it has no session, and stage 26's policy is
  // authenticated-only, so it waits for #294's function (alerts/statements.ts).

  /** Saves a job for the person. Saving it again hits the primary key and changes nothing ($2 job). */
  alert_save_job: {
    args: ["uuid", "uuid"],
    text: `
with saved as (
  insert into marketplace.saved_jobs (org_id, job_id)
  select $1::text::uuid, $2::text::uuid
  where marketplace.has_org_role($1::text::uuid, ${MEMBER_ROLES})
  on conflict (user_id, org_id, job_id) do nothing
  returning job_id
)
select jsonb_build_object('changed', exists (select 1 from saved)) as row
where marketplace.has_org_role($1::text::uuid, ${MEMBER_ROLES})`
  },

  /** Removes one of the person's saved jobs. Removing one that is already gone changes nothing ($2 job). */
  alert_unsave_job: {
    args: ["uuid", "uuid"],
    text: `
with removed as (
  delete from marketplace.saved_jobs
  where org_id = $1::text::uuid
    and job_id = $2::text::uuid
    and user_id = marketplace.current_user_id()
    and marketplace.has_org_role($1::text::uuid, ${MEMBER_ROLES})
  returning job_id
)
select jsonb_build_object('changed', exists (select 1 from removed)) as row
where marketplace.has_org_role($1::text::uuid, ${MEMBER_ROLES})`
  },

  /** The person's own job searches, newest edit first. */
  alert_list_job_searches: {
    args: ["uuid"],
    text: `
select to_jsonb(s) as row from (
  select id, kind, name, criteria, alerts_enabled, last_alerted_at, updated_at
  from marketplace.saved_searches
  where org_id = $1::text::uuid
    and owner_user_id = marketplace.current_user_id()
    and kind = 'jobs'
    and marketplace.has_org_role($1::text::uuid, ${MEMBER_ROLES})
  order by updated_at desc, id
) as s`
  },

  /** A new job search: $2 name, $3 criteria as JSON, $4 alerts on. Kind is always jobs; the owner is the column default. */
  alert_insert_job_search: {
    args: ["uuid", "text", "text", "boolean"],
    text: `
with added as (
  insert into marketplace.saved_searches (org_id, kind, name, criteria, alerts_enabled)
  select $1::text::uuid, 'jobs', $2::text, $3::text::jsonb, $4::text::boolean
  where marketplace.has_org_role($1::text::uuid, ${MEMBER_ROLES})
  returning id
) select to_jsonb(added) as row from added`
  },

  /**
   * Edits one of the person's own job searches ($2 search): $3 name, $4 criteria as JSON, $5 alerts on. Only the
   * granted columns change. No row: not one of theirs in this business.
   */
  alert_update_job_search: {
    args: ["uuid", "uuid", "text", "text", "boolean"],
    text: `
with changed as (
  update marketplace.saved_searches
  set name = $3::text, criteria = $4::text::jsonb, alerts_enabled = $5::text::boolean
  where id = $2::text::uuid
    and org_id = $1::text::uuid
    and owner_user_id = marketplace.current_user_id()
    and kind = 'jobs'
    and marketplace.has_org_role($1::text::uuid, ${MEMBER_ROLES})
  returning id
) select to_jsonb(changed) as row from changed`
  },

  /** Deletes one of the person's own job searches ($2 search). Deleting one that is already gone changes nothing. */
  alert_delete_job_search: {
    args: ["uuid", "uuid"],
    text: `
with removed as (
  delete from marketplace.saved_searches
  where id = $2::text::uuid
    and org_id = $1::text::uuid
    and owner_user_id = marketplace.current_user_id()
    and kind = 'jobs'
    and marketplace.has_org_role($1::text::uuid, ${MEMBER_ROLES})
  returning id
)
select jsonb_build_object('changed', exists (select 1 from removed)) as row
where marketplace.has_org_role($1::text::uuid, ${MEMBER_ROLES})`
  },

  /** The person's stored consents in the business: category, channel, on or off, and when. No address. */
  alert_list_notification_preferences: {
    args: ["uuid"],
    text: `
select to_jsonb(p) as row from (
  select category, channel, enabled, updated_at
  from marketplace.notification_preferences
  where user_id = marketplace.current_user_id()
    and org_id = $1::text::uuid
    and marketplace.has_org_role($1::text::uuid, ${MEMBER_ROLES})
) as p`
  },

  /** Turns one consent on or off: $2 category, $3 channel, $4 on. The person is `current_user_id()`, on insert and on conflict. */
  alert_set_notification_preference: {
    args: ["uuid", "text", "text", "boolean"],
    text: `
with saved as (
  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled)
  select marketplace.current_user_id(), $1::text::uuid, $2::text, $3::text, $4::text::boolean
  where marketplace.has_org_role($1::text::uuid, ${MEMBER_ROLES})
  on conflict (user_id, org_id, category, channel)
  do update set enabled = excluded.enabled, updated_at = now()
  where notification_preferences.user_id = marketplace.current_user_id()
    and notification_preferences.org_id = $1::text::uuid
  returning category
) select jsonb_build_object('changed', true) as row from saved`
  },

  /** The person's marketplace id, for minting an unsubscribe link in the active business. The address is not selected. */
  alert_viewer_user: {
    args: ["uuid"],
    text: `
select to_jsonb(u) as row from (
  select a.id
  from marketplace.app_users a
  where a.id = marketplace.current_user_id()
    and marketplace.has_org_role($1::text::uuid, ${MEMBER_ROLES})
) as u`
  }
} as const satisfies Record<string, QuerySpec>

export type MarketplaceQueryName = keyof typeof MARKETPLACE_QUERIES

export type MarketplaceQueryValue = string | number | boolean | null

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function serializeQueryValue(value: MarketplaceQueryValue, type: MarketplaceQueryArgument, position: number): string | null {
  if (value === null) {
    return null
  }

  switch (type) {
    case "uuid":
      if (typeof value === "string" && UUID.test(value)) return value
      break
    case "text":
      if (typeof value === "string") return value
      break
    case "integer":
      if (typeof value === "number" && Number.isSafeInteger(value)) return String(value)
      break
    case "numeric":
      if (typeof value === "number" && Number.isFinite(value)) return String(value)
      break
    case "boolean":
      if (typeof value === "boolean") return value ? "true" : "false"
      break
    case "date":
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
      break
  }

  throw new TypeError(`Argument $${position} must be a ${type}`)
}

/** The SQL and bound values for one catalogued statement. Pure; exported for tests. */
export function marketplaceQueryStatement(
  name: MarketplaceQueryName,
  values: readonly MarketplaceQueryValue[]
): { text: string; values: Array<string | null> } {
  if (!Object.prototype.hasOwnProperty.call(MARKETPLACE_QUERIES, name)) {
    throw new TypeError(`${String(name)} is not a catalogued marketplace statement`)
  }

  const spec: QuerySpec = MARKETPLACE_QUERIES[name]

  if (values.length !== spec.args.length) {
    throw new TypeError(`${name} takes ${spec.args.length} argument(s)`)
  }

  return { text: spec.text, values: values.map((value, index) => serializeQueryValue(value, spec.args[index] as MarketplaceQueryArgument, index + 1)) }
}
