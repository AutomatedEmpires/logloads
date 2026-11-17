-- =============================================================================
-- LogLoads normalized-v2 — 31 reply gate for private details, day-14 reconfirmation, signed-out unsubscribe,
-- founding-offer reads and the job lifecycle's not-found answer (#294, part A)
--
-- NON-ACTIVE PROTOTYPE. Not an approved migration. Applied after 29_v2_landing_scope_hardening.sql.
-- Run order: 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23 -> 26 -> 29 -> 31 (19..22, 24, 25, 27, 28, 30 and 32
-- are test suites and harnesses, not migrations). Apply exactly once, in one transaction:
-- psql -v ON_ERROR_STOP=1 --single-transaction -f 31_...sql
-- 31 changes no stored row. It redefines eight functions (CREATE OR REPLACE keeps each ACL), adds five functions and
-- two empty tables, and replaces three row-level security policies. Stage 31 in CI checks this exact set; 10 proves on
-- existing data that no row changes.
--
-- 31-P1  (P1, cloud security sweep of 2026-11-11.) A landing's private details (site contact name and phone, exact
--        point, directions, gate instructions) could reach a hauling business before the landing replied.
--        respond_to_interest(..., 'viewed', true) turned sharing on for a submitted or viewed inquiry, and
--        can_view_landing_private asked only for a shared, live inquiry. The founder's rule is: only after the
--        landing replies AND opts in. Now:
--          * can_view_landing_private lets the hauling business read only while the inquiry's status is 'replied';
--          * respond_to_interest refuses to turn sharing on with 'viewed' before a reply, and with a decline;
--          * a decline clears the sharing columns (and audits the revocation), as a withdrawal already does.
-- 31-R   (#308's day-14 rule, from #247.) An active job whose last confirmation is 14 days old or older, or that was
--        never confirmed (a legacy import), is off list_marketplace_jobs and search_job_postings and takes no new
--        interest: submit_expression_of_interest refuses with the neutral 'Waiting for the poster to confirm'. The
--        job is not expired or paused and its status stays 'active'. It is still returned by id, with
--        accepting_interest false, and to its own landing desk. Reconfirming restores it at once. The boundary is the
--        one packages/services/src/v2/jobs/lifecycle.ts uses: hidden from exactly 14 x 24 hours after the confirmation.
--        A direct INSERT of an inquiry (02's column grant, 06's interests_hauler_insert policy) is held to the same
--        rule through job_takes_new_interest.
-- 31-U   (#252.) A signed-out unsubscribe link. unsubscribe_with_token takes a signed, expiring, single-use token and
--        turns off that one recipient's one channel preference. It is the only marketplace function anon can call that
--        writes. It returns nothing and raises nothing for a token that is malformed, forged, expired, already used
--        or for a preference that does not exist, so it reveals nothing. Tokens are minted by the email worker
--        (issue_unsubscribe_token, service_role only) and signed with HMAC-SHA-256 under a key that never leaves the
--        database (notification_unsubscribe_keys, no grants; created on first use, so 31 itself stores nothing).
-- 31-F   (#248.) Founding offer reads. Every active member of a business may read its founding-offer redemption
--        (they all hold plan.view), not only owners; and a member of a business that redeemed a promotion may read
--        that promotion's terms after it closes. The column grant of 16 still hides who granted it.
-- 31-O   (P2, same sweep.) reconfirm_job_posting, set_job_posting_status and reactivate_job_posting answered a job
--        of another business with a role refusal (42501) and a missing job with 'Job not found' (P0002), which told a
--        caller whether a job id exists. Both now get the same 'Job not found' (P0002). A member of the job's own
--        business keeps the role and landing refusals.
--
-- Every other line of the eight redefined functions is the current definition, verbatim (26, 29, 06 and 11); lines
-- marked "31" are new or changed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Migration-order guard: requires 29, refuses a repeat. Runs before any change.
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_advisory_xact_lock(hashtextextended('marketplace.schema_migrations', 0));
  -- Two statements: PL/pgSQL plans each condition whole, so the ledger is referenced only once it exists.
  if to_regclass('marketplace.schema_migrations') is null then
    raise exception 'migration 31 requires migration 29 to be applied first' using errcode = '55000';
  end if;
  if not exists (select 1 from marketplace.schema_migrations where version = '29') then
    raise exception 'migration 31 requires migration 29 to be applied first' using errcode = '55000';
  end if;
  if exists (select 1 from marketplace.schema_migrations where version = '31') then
    raise exception 'migration 31 is already applied (%); re-running it is refused and nothing was changed',
      (select applied_at from marketplace.schema_migrations where version = '31')
      using errcode = '55000', hint = 'Migrations are forward-only.';
  end if;
  if to_regprocedure('marketplace.job_confirmation_current(timestamptz)') is not null
     or to_regclass('marketplace.notification_unsubscribe_keys') is not null then
    raise exception 'migration 31 appears to be applied already (its objects exist) but is not recorded; refusing to re-run'
      using errcode = '55000';
  end if;
  -- M1: remember this transaction; the next statement refuses if it is not the same one.
  perform set_config('logloads.migration_xact', txid_current()::text, true);
end
$$;

-- M1: a migration file must run as ONE transaction (psql --single-transaction); see 06.
do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    -- Without ON_ERROR_STOP psql would carry on statement by statement after a refusal, so the rest of
    -- this session is made read-only first (every later write fails), then the next statement refuses.
    perform set_config('default_transaction_read_only', 'on', false);
    perform set_config('logloads.migration_refused', '31', false);
  end if;
end
$$;
-- The refusal needs no session state (a pooler may run this statement on another backend); see 06.
do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    raise exception 'migration 31 must be applied in one transaction (psql --single-transaction); nothing was changed'
      using errcode = '25P01', hint = 'This session (or pooled backend) was made read-only to stop the rest of the file.';
  end if;
  if coalesce(current_setting('logloads.migration_refused', true), '') <> '' then
    raise exception 'migration 31 refused: this session was made read-only by an earlier non-atomic attempt (migration %); reconnect and apply it with psql --single-transaction',
      current_setting('logloads.migration_refused')
      using errcode = '25P01';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 31-P1. 26's can_view_landing_private. The hauling business reads a landing's private details only while its
-- inquiry is 'replied': the landing answered it, and it was not declined or withdrawn afterwards.
-- -----------------------------------------------------------------------------
create or replace function marketplace.can_view_landing_private(p_landing uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select exists (
    select 1 from marketplace.landings l
    where l.id = p_landing and marketplace.has_org_role(l.org_id, array['owner', 'manager', 'staff'], true)
      and marketplace.landing_scope_allows(l.org_id, l.id) -- 26-B
  ) or exists (
    select 1
    from marketplace.expressions_of_interest e
    join marketplace.job_postings j on j.id = e.job_id
    where j.landing_id = p_landing
      and j.status in ('active', 'paused')
      and e.status = 'replied' -- 31-P1: only after the landing replied (and not withdrawn or declined since)
      and e.private_details_shared_at is not null
      and e.hauler_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
  )
$$;

-- -----------------------------------------------------------------------------
-- 31-P1. 29's respond_to_interest. Sharing is turned on only with a reply or after one.
-- -----------------------------------------------------------------------------
create or replace function marketplace.respond_to_interest(
  p_interest_id uuid,
  p_status text,
  p_share_private_details boolean default null,
  p_reply_id uuid default null,
  p_body text default null
) returns void
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_user       uuid := marketplace.current_user_id();
  v_row        marketplace.expressions_of_interest;
  v_clean_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_msg_id     uuid := coalesce(p_reply_id, gen_random_uuid());
  v_msg_count  integer;
begin
  if p_status not in ('viewed', 'replied', 'declined') then
    raise exception 'invalid landing response status: %', p_status using errcode = '22023';
  end if;

  select * into v_row from marketplace.expressions_of_interest where id = p_interest_id for update;
  if not found or not marketplace.has_org_role(v_row.job_org_id, array['owner', 'manager', 'staff'], true) then
    raise exception 'Inquiry not found' using errcode = '42501';
  end if;

  -- 29: the job's landing must be in the caller's scope, also for a person who belongs to the inquiring hauling
  -- business. Checked before the inquiry's state is read, with landing_scope_guard's refusal.
  if not marketplace.job_scope_allows(v_row.job_id) then
    raise exception 'This landing is not one of the landings you are assigned to' using errcode = '42501',
      hint = 'An owner of the organization can change which landings you work on.';
  end if;

  if v_row.status = 'withdrawn' then
    raise exception 'The hauler withdrew this inquiry' using errcode = '23514';
  end if;

  -- 31-P1: the landing's private details are shared only with a reply or after one. Marking an inquiry viewed
  -- cannot turn sharing on before the landing has replied, and a decline never shares.
  if p_share_private_details is true
     and ((p_status = 'viewed' and v_row.status <> 'replied') or p_status = 'declined') then
    raise exception 'Reply to this inquiry before sharing the landing''s private details' using errcode = '23514',
      hint = 'Private access details and the site phone are shared only after the landing replies.';
  end if;

  if p_status = 'viewed' then
    if v_row.status = 'submitted' then
      update marketplace.expressions_of_interest
      set status = 'viewed',
          private_details_shared_at = case
            when p_share_private_details is true  then coalesce(private_details_shared_at, now())
            when p_share_private_details is false then null
            else private_details_shared_at end,
          private_details_shared_by = case
            when p_share_private_details is true  then coalesce(private_details_shared_by, v_user)
            when p_share_private_details is false then null
            else private_details_shared_by end
      where id = p_interest_id;
      perform marketplace.write_audit('interest.viewed', 'expressions_of_interest', p_interest_id, v_row.job_org_id);
    elsif p_share_private_details is not null then
      update marketplace.expressions_of_interest
      set private_details_shared_at = case when p_share_private_details then coalesce(private_details_shared_at, now()) else null end,
          private_details_shared_by = case when p_share_private_details then coalesce(private_details_shared_by, v_user) else null end
      where id = p_interest_id;
    end if;

    if p_share_private_details is not null then
      perform marketplace.write_audit(
        case when p_share_private_details then 'landing_private.shared' else 'landing_private.revoked' end,
        'expressions_of_interest', p_interest_id, v_row.job_org_id,
        null, jsonb_build_object('hauler_org_id', v_row.hauler_org_id, 'job_id', v_row.job_id));
    end if;
    return;
  end if;

  if p_reply_id is not null and exists (
    select 1 from marketplace.interest_messages m
    where m.id = p_reply_id and m.interest_id = p_interest_id
  ) then
    return;
  end if;

  if p_status = 'replied' then
    if v_row.status = 'declined' then
      raise exception 'This inquiry is closed' using errcode = '23514';
    end if;
    if v_clean_body is null then
      raise exception 'A reply needs a message' using errcode = '23514';
    end if;
    if v_clean_body is not null then
      select count(*) into v_msg_count from marketplace.interest_messages where interest_id = p_interest_id;
      if v_msg_count >= 200 then
        raise exception 'Maximum of 200 messages reached for this inquiry' using errcode = '23514';
      end if;
      insert into marketplace.interest_messages (id, interest_id, author_user_id, author_side, body)
      values (v_msg_id, p_interest_id, v_user, 'landing', v_clean_body);
    end if;

    update marketplace.expressions_of_interest
    set status = 'replied',
        responded_at = coalesce(responded_at, now()),
        private_details_shared_at = case
          when p_share_private_details is true  then coalesce(private_details_shared_at, now())
          when p_share_private_details is false then null
          else private_details_shared_at end,
        private_details_shared_by = case
          when p_share_private_details is true  then coalesce(private_details_shared_by, v_user)
          when p_share_private_details is false then null
          else private_details_shared_by end
    where id = p_interest_id;

    perform marketplace.write_audit('interest.replied', 'expressions_of_interest', p_interest_id, v_row.job_org_id);
  else
    if v_row.status = 'declined' then
      return;
    end if;

    if v_clean_body is not null then
      insert into marketplace.interest_messages (id, interest_id, author_user_id, author_side, body)
      values (v_msg_id, p_interest_id, v_user, 'landing', v_clean_body);
    end if;

    update marketplace.expressions_of_interest
    set status = 'declined',
        responded_at = coalesce(responded_at, now()),
        private_details_shared_at = null, -- 31-P1: a decline ends the sharing
        private_details_shared_by = null  -- 31-P1
    where id = p_interest_id;

    perform marketplace.write_audit('interest.declined', 'expressions_of_interest', p_interest_id, v_row.job_org_id);
    -- 31-P1: the decline revoked details that were shared; record it when the caller did not ask for it.
    if v_row.private_details_shared_at is not null and p_share_private_details is null then
      perform marketplace.write_audit(
        'landing_private.revoked', 'expressions_of_interest', p_interest_id, v_row.job_org_id,
        null, jsonb_build_object('hauler_org_id', v_row.hauler_org_id, 'job_id', v_row.job_id));
    end if;
  end if;

  if p_share_private_details is not null then
    perform marketplace.write_audit(
      case when p_share_private_details then 'landing_private.shared' else 'landing_private.revoked' end,
      'expressions_of_interest', p_interest_id, v_row.job_org_id,
      null, jsonb_build_object('hauler_org_id', v_row.hauler_org_id, 'job_id', v_row.job_id));
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 31-R. The day-14 rule (#308). One definition of "confirmed recently enough", used by the three functions below.
-- 336 hours, not '14 days': an interval of days follows the session time zone across a daylight-saving change, and
-- lifecycle.ts counts 14 x 24 hours. A job never confirmed (a legacy import) is not current.
-- -----------------------------------------------------------------------------
create function marketplace.job_confirmation_current(p_last_confirmed_at timestamptz)
returns boolean language sql stable
set search_path = pg_catalog, pg_temp
as $$
  select p_last_confirmed_at is not null and p_last_confirmed_at > now() - interval '336 hours'
$$;

comment on function marketplace.job_confirmation_current(timestamptz) is
  '31-R (#308): true when a job was confirmed less than 14 x 24 hours ago. False from exactly 14 days, and for a job that was never confirmed. An active job that is not current is off every list and takes no new interest until its poster reconfirms it; it is neither expired nor paused.';

-- The same rule on the direct path. 02 grants authenticated a column INSERT on expressions_of_interest, and 06's
-- interests_hauler_insert policy asked only for a publicly visible job, so a direct INSERT (PostgREST) would skip the
-- refusal submit_expression_of_interest makes below. The policy is 06's, verbatim, plus its last line. A withdrawn
-- inquiry cannot be sent again directly: status is not among the columns a person can update.
create function marketplace.job_takes_new_interest(p_job uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select marketplace.job_is_publicly_visible(p_job)
     and exists (select 1 from marketplace.job_postings j
                 where j.id = p_job and marketplace.job_confirmation_current(j.last_confirmed_at))
$$;

comment on function marketplace.job_takes_new_interest(uuid) is
  '31-R (#308): true for a publicly visible job that was confirmed in the last 14 days. Used by the interests_hauler_insert policy, so a direct INSERT of an inquiry follows the rule submit_expression_of_interest enforces.';

drop policy interests_hauler_insert on marketplace.expressions_of_interest;
create policy interests_hauler_insert on marketplace.expressions_of_interest for insert to authenticated
  with check (hauler_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
              and submitted_by = (select marketplace.current_user_id())
              and status = 'submitted'
              and exists (select 1 from marketplace.hauler_profiles h
                          join marketplace.organizations o on o.id = h.org_id and o.status = 'active'
                          where h.org_id = expressions_of_interest.hauler_org_id)
              and marketplace.job_is_publicly_visible(job_id)
              and marketplace.job_takes_new_interest(job_id)); -- 31-R

-- 06's list_marketplace_jobs.
create or replace function marketplace.list_marketplace_jobs(
  p_query text default null,
  p_equipment text default null,
  p_pay_unit text default null,
  p_accepting_only boolean default true,
  p_org_id uuid default null,
  p_point extensions.geography default null,
  p_radius_miles integer default null,
  p_max_sponsored integer default 2,
  p_limit integer default 100,
  p_job_id uuid default null
) returns table (
  job_id uuid,
  slug text,
  title text,
  poster_organization_id uuid,
  poster_name text,
  poster_verified boolean,
  product text,
  description text,
  pay_amount_cents bigint,
  pay_unit text,
  pay_note text,
  equipment_codes text[],
  equipment_labels text[],
  origin_label text,
  origin_state_code char(2),
  origin_lat double precision,
  origin_lng double precision,
  destination_label text,
  est_one_way_miles integer,
  distance_miles numeric,
  starts_on date,
  ends_on date,
  duration_days integer,
  schedule_note text,
  trucks_total integer,
  trucks_per_day integer,
  estimated_loads_per_truck_per_day numeric,
  estimated_daily_loads integer,
  estimated_tons_per_load numeric,
  public_road_notes text,
  public_access_requirements text[],
  status text,
  accepting_interest boolean,
  last_modified_at timestamptz,
  last_confirmed_at timestamptz,
  expires_at timestamptz,
  sponsored boolean
)
language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  with search_origin as (
    select marketplace.approximate_point(p_point) as snapped_point,
           nullif(lower(btrim(coalesce(p_query, ''))), '') as q_norm,
           nullif(lower(btrim(coalesce(p_equipment, ''))), '') as eq_norm
  ),
  job_rows as (
    select
      j.id as job_id,
      j.id::text as slug,
      j.title,
      j.org_id as poster_organization_id,
      o.display_name as poster_name,
      (o.verification_status = 'verified') as poster_verified,
      j.product,
      j.description,
      j.pay_amount_cents,
      j.pay_unit,
      j.pay_note,
      coalesce(eq.codes, array[]::text[]) as equipment_codes,
      coalesce(eq.labels, array[]::text[]) as equipment_labels,
      l.public_area_label as origin_label,
      l.state_code as origin_state_code,
      case when l.public_point is not null
           then round(extensions.st_y(l.public_point::extensions.geometry)::numeric, 1)::double precision
      end as origin_lat,
      case when l.public_point is not null
           then round(extensions.st_x(l.public_point::extensions.geometry)::numeric, 1)::double precision
      end as origin_lng,
      j.destination_label,
      j.est_one_way_miles,
      case when so.snapped_point is not null and l.public_point is not null
           then round((extensions.st_distance(l.public_point, so.snapped_point) / 1609.344)::numeric, 0)
      end as distance_miles,
      j.work_starts_on as starts_on,
      j.work_ends_on as ends_on,
      j.duration_days,
      j.schedule_note,
      j.trucks_requested as trucks_total,
      j.trucks_per_day,
      j.est_loads_per_truck_per_day as estimated_loads_per_truck_per_day,
      j.est_daily_loads as estimated_daily_loads,
      j.est_tons_per_load as estimated_tons_per_load,
      j.public_road_notes,
      j.public_access_requirements,
      case
        when j.status = 'active' and j.expires_at is not null and j.expires_at <= now() then 'expired'
        else j.status
      end as eff_status,
      (j.status = 'active' and (j.expires_at is null or j.expires_at > now())
       and marketplace.job_confirmation_current(j.last_confirmed_at)) as accepting_interest, -- 31-R
      j.updated_at as last_modified_at,
      j.last_confirmed_at,
      j.expires_at,
      (
        j.status = 'active'
        and (j.expires_at is null or j.expires_at > now())
        and marketplace.job_confirmation_current(j.last_confirmed_at) -- 31-R
        and exists (
          select 1 from marketplace.job_boosts b
          where b.job_id = j.id and b.status = 'active'
            and now() >= b.starts_at and now() < b.ends_at
            and (so.snapped_point is null
                 or extensions.st_dwithin(
                      b.center_point, so.snapped_point,
                      b.radius_miles::double precision * 1609.344 + 8000.0))
        )
      ) as raw_sponsored
    from search_origin so
    cross join marketplace.job_postings j
    join marketplace.landings l on l.id = j.landing_id
    join marketplace.organizations o on o.id = j.org_id and o.status = 'active'
    left join lateral (
      select
        array_agg(et.code order by et.sort_order, et.code) as codes,
        array_agg(et.label order by et.sort_order, et.code) as labels
      from marketplace.job_posting_equipment jpe
      join marketplace.equipment_types et on et.code = jpe.equipment_code
      where jpe.job_id = j.id
    ) eq on true
    where j.status <> 'draft'
      -- Same visibility as job_postings RLS: anonymous callers see only publicly visible jobs; paused,
      -- filled, closed (including moderated) or expired jobs only to the owning desk, haulers with an
      -- inquiry, invitation recipients and platform admins.
      and marketplace.can_read_job_posting(j.id)
      and (p_job_id is null or j.id = p_job_id)
      -- 31-R: an active job that was not confirmed in the last 14 days (a legacy job never confirmed included) is
      -- off every list until its poster reconfirms it. It is still returned by id (get_marketplace_job), where it
      -- reads as active and not accepting interest, and to its own landing desk and platform staff.
      and (p_job_id is not null
           or j.status <> 'active'
           or marketplace.job_confirmation_current(j.last_confirmed_at)
           or j.org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true))
           or marketplace.is_platform_admin())
      and (l.status = 'active' or (not coalesce(p_accepting_only, true) and l.status <> 'archived'))
      and (p_org_id is null or j.org_id = p_org_id)
      and (not coalesce(p_accepting_only, true)
           or (j.status = 'active' and l.status = 'active' and (j.expires_at is null or j.expires_at > now())
               and marketplace.job_confirmation_current(j.last_confirmed_at))) -- 31-R
      and (p_pay_unit is null or btrim(p_pay_unit) = '' or j.pay_unit = p_pay_unit)
      and (so.eq_norm is null
           or exists (
             select 1 from unnest(coalesce(eq.codes, array[]::text[])) c where lower(c) = so.eq_norm
           )
           or exists (
             select 1 from unnest(coalesce(eq.labels, array[]::text[])) lbl where lower(lbl) = so.eq_norm
           ))
      and (so.q_norm is null
           or position(so.q_norm in lower(j.title)) > 0
           or position(so.q_norm in lower(o.display_name)) > 0
           or position(so.q_norm in lower(coalesce(j.product, ''))) > 0
           or position(so.q_norm in lower(l.public_area_label)) > 0
           or position(so.q_norm in lower(coalesce(j.destination_label, ''))) > 0
           or exists (
             select 1 from unnest(coalesce(eq.labels, array[]::text[])) lbl
             where position(so.q_norm in lower(lbl)) > 0
           )
           or exists (
             select 1 from unnest(coalesce(eq.codes, array[]::text[])) c
             where position(so.q_norm in lower(c)) > 0
           )
           or j.search_document @@ websearch_to_tsquery('english'::regconfig, so.q_norm))
      and (so.snapped_point is null or p_radius_miles is null
           or (l.public_point is not null
               and extensions.st_dwithin(
                     l.public_point, so.snapped_point,
                     least(greatest(p_radius_miles, 5), 500)::double precision * 1609.344 + 8000.0)))
  ),
  ranked as (
    select r.*,
           case when r.raw_sponsored then
             row_number() over (
               partition by r.raw_sponsored
               order by r.distance_miles asc nulls last,
                        (r.last_confirmed_at is not null) desc,
                        coalesce(r.last_confirmed_at, r.last_modified_at) desc,
                        r.title asc)
           end as sponsored_rank
    from job_rows r
  )
  select
    r.job_id, r.slug, r.title, r.poster_organization_id, r.poster_name, r.poster_verified,
    r.product, r.description, r.pay_amount_cents, r.pay_unit, r.pay_note,
    r.equipment_codes, r.equipment_labels,
    r.origin_label, r.origin_state_code, r.origin_lat, r.origin_lng,
    r.destination_label, r.est_one_way_miles, r.distance_miles,
    r.starts_on, r.ends_on, r.duration_days, r.schedule_note,
    r.trucks_total, r.trucks_per_day,
    r.estimated_loads_per_truck_per_day, r.estimated_daily_loads, r.estimated_tons_per_load,
    r.public_road_notes, r.public_access_requirements,
    r.eff_status as status, r.accepting_interest,
    r.last_modified_at, r.last_confirmed_at, r.expires_at,
    (r.raw_sponsored and r.sponsored_rank <= greatest(coalesce(p_max_sponsored, 2), 0)) as sponsored
  from ranked r
  order by
    (r.raw_sponsored and r.sponsored_rank <= greatest(coalesce(p_max_sponsored, 2), 0)) desc,
    r.distance_miles asc nulls last,
    (r.last_confirmed_at is not null) desc,
    coalesce(r.last_confirmed_at, r.last_modified_at) desc,
    r.title asc
  limit least(greatest(coalesce(p_limit, 100), 1), 200)
$$;

-- 06's search_job_postings.
create or replace function marketplace.search_job_postings(
  p_point extensions.geography default null,
  p_radius_miles integer default 100,
  p_equipment_codes text[] default null,
  p_pay_unit text default null,
  p_query text default null,
  p_max_sponsored integer default 2,
  p_limit integer default 50
) returns table (
  job_id uuid, org_id uuid, org_name text, org_verified boolean,
  landing_id uuid, landing_name text, public_area_label text, state_code char(2),
  public_point extensions.geography, distance_miles numeric,
  title text, product text, destination_label text, est_one_way_miles integer,
  pay_amount_cents bigint, pay_unit text, trucks_requested integer,
  work_starts_on date, work_ends_on date, last_confirmed_at timestamptz,
  is_sponsored boolean
)
language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  with search_origin as (
    select marketplace.approximate_point(p_point) as snapped_point
  ),
  matching as (
    select j.id as job_id, j.org_id, o.display_name as org_name,
           (o.verification_status = 'verified') as org_verified,
           l.id as landing_id, l.name as landing_name, l.public_area_label, l.state_code,
           marketplace.approximate_point(l.public_point) as public_point,
           case when so.snapped_point is not null and l.public_point is not null
                then round((extensions.st_distance(l.public_point, so.snapped_point) / 1609.344)::numeric, 0)
           end as distance_miles,
           j.title, j.product, j.destination_label, j.est_one_way_miles,
           j.pay_amount_cents, j.pay_unit, j.trucks_requested,
           j.work_starts_on, j.work_ends_on, j.last_confirmed_at,
           exists (
             select 1 from marketplace.job_boosts b
             where b.job_id = j.id and b.status = 'active'
               and now() >= b.starts_at and now() < b.ends_at
               and (so.snapped_point is null
                    or extensions.st_dwithin(
                         b.center_point, so.snapped_point,
                         b.radius_miles::double precision * 1609.344 + 8000.0))
           ) as raw_sponsored
    from search_origin so
    cross join marketplace.job_postings j
    join marketplace.landings l on l.id = j.landing_id and l.status = 'active'
    join marketplace.organizations o on o.id = j.org_id and o.status = 'active'
    where j.status = 'active'
      and (j.expires_at is null or j.expires_at > now())
      and marketplace.job_confirmation_current(j.last_confirmed_at) -- 31-R: confirmed in the last 14 days
      and (so.snapped_point is null
           or (l.public_point is not null
               and extensions.st_dwithin(
                     l.public_point, so.snapped_point,
                     least(greatest(coalesce(p_radius_miles, 100), 5), 500)::double precision * 1609.344 + 8000.0)))
      and (p_pay_unit is null or j.pay_unit = p_pay_unit)
      and (p_query is null or btrim(p_query) = ''
           or j.search_document @@ websearch_to_tsquery('english'::regconfig, p_query))
      and (p_equipment_codes is null or cardinality(p_equipment_codes) = 0
           or exists (select 1 from marketplace.job_posting_equipment e
                      where e.job_id = j.id and e.equipment_code = any (p_equipment_codes)))
  ),
  ranked as (
    select m.*,
           case when m.raw_sponsored then
             row_number() over (
               partition by m.raw_sponsored
               order by m.distance_miles asc nulls last,
                        (m.last_confirmed_at is not null) desc,
                        coalesce(m.last_confirmed_at, '-infinity'::timestamptz) desc)
           end as sponsored_rank
    from matching m
  )
  select r.job_id, r.org_id, r.org_name, r.org_verified,
         r.landing_id, r.landing_name, r.public_area_label, r.state_code,
         r.public_point, r.distance_miles,
         r.title, r.product, r.destination_label, r.est_one_way_miles,
         r.pay_amount_cents, r.pay_unit, r.trucks_requested,
         r.work_starts_on, r.work_ends_on, r.last_confirmed_at,
         (r.raw_sponsored and r.sponsored_rank <= greatest(coalesce(p_max_sponsored, 2), 0)) as is_sponsored
  from ranked r
  order by (r.raw_sponsored and r.sponsored_rank <= greatest(coalesce(p_max_sponsored, 2), 0)) desc,
           r.distance_miles asc nulls last,
           (r.last_confirmed_at is not null) desc,
           coalesce(r.last_confirmed_at, '-infinity'::timestamptz) desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

-- 06's submit_expression_of_interest.
create or replace function marketplace.submit_expression_of_interest(
  p_hauler_org_id uuid,
  p_job_id uuid,
  p_trucks_offered integer default null,
  p_equipment jsonb default '[]'::jsonb,
  p_available_from date default null,
  p_available_until date default null,
  p_message text default null,
  p_contact_preference text default 'in_app'
) returns table (
  interest_id uuid,
  created boolean
)
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_user            uuid := marketplace.current_user_id();
  v_caps            text[];
  v_job             marketplace.job_postings;
  v_landing         marketplace.landings;
  v_existing        marketplace.expressions_of_interest;
  v_clean_msg       text := nullif(btrim(coalesce(p_message, '')), '');
  v_contact         text := coalesce(nullif(btrim(p_contact_preference), ''), 'in_app');
  v_equip_lines     jsonb := coalesce(p_equipment, '[]'::jsonb);
  v_resolved_lines  jsonb := '[]'::jsonb;
  v_existing_lines  jsonb := '[]'::jsonb;
  v_line            record;
  v_opt             record;
  v_idx             smallint := 0;
  v_sum_trucks      integer := 0;
  v_trucks          integer;
  v_unchanged       boolean := false;
  v_renewed         boolean := false;
  v_id              uuid;
begin
  select a.capabilities into v_caps
  from marketplace.get_viewer_marketplace_access(p_hauler_org_id) a;

  if not ('interest.express' = any (coalesce(v_caps, array[]::text[]))) then
    raise exception 'Switch to a hauling business to express interest' using errcode = '42501';
  end if;

  if p_available_from is not null and p_available_until is not null and p_available_until < p_available_from then
    raise exception 'Available until must not be before available from' using errcode = '23514';
  end if;

  if v_contact not in ('in_app', 'phone', 'email') then
    raise exception 'Invalid contact preference: %', v_contact using errcode = '22023';
  end if;

  select * into v_job from marketplace.job_postings where id = p_job_id;
  if not found or v_job.status = 'draft' then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;

  select * into v_landing from marketplace.landings where id = v_job.landing_id;
  if not found or v_landing.status = 'archived' then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;

  if v_job.org_id = p_hauler_org_id then
    raise exception 'You cannot express interest in your own organization''s job' using errcode = '23514';
  end if;

  -- Same test as the RLS insert policy: active job, active landing, active posting organization.
  if not marketplace.job_is_publicly_visible(p_job_id) then
    raise exception 'This job is no longer accepting interest' using errcode = '23514';
  end if;

  if jsonb_typeof(v_equip_lines) <> 'array' then
    raise exception 'equipment must be a JSON array' using errcode = '22023';
  end if;

  for v_line in
    select
      btrim(coalesce(elem ->> 'configurationKey', elem ->> 'configuration_key', '')) as config_key,
      coalesce((elem ->> 'count')::integer, (elem ->> 'unit_count')::integer, 0) as cnt
    from jsonb_array_elements(v_equip_lines) as elem
    where coalesce((elem ->> 'count')::integer, (elem ->> 'unit_count')::integer, 0) > 0
  loop
    if v_line.config_key = '' then
      raise exception 'Choose equipment from your business profile' using errcode = '23514';
    end if;

    if exists (
      select 1 from jsonb_array_elements(v_resolved_lines) e
      where (e ->> 'configurationKey') = v_line.config_key
    ) then
      raise exception 'List each equipment configuration once' using errcode = '23514';
    end if;

    select o.configuration_key, o.label, o.units_listed
    into v_opt
    from marketplace.list_hauler_equipment_options(p_hauler_org_id) o
    where o.configuration_key = v_line.config_key;

    if not found then
      raise exception 'Choose equipment from your business profile' using errcode = '23514';
    end if;

    if v_line.cnt > v_opt.units_listed then
      raise exception 'Your profile lists % x %; update your equipment to offer more',
        v_opt.units_listed, v_opt.label
        using errcode = '23514';
    end if;

    v_sum_trucks := v_sum_trucks + v_line.cnt;
    v_resolved_lines := v_resolved_lines || jsonb_build_array(
      jsonb_build_object(
        'configurationKey', v_opt.configuration_key,
        'label', v_opt.label,
        'count', v_line.cnt,
        'sortOrder', v_idx
      )
    );
    v_idx := v_idx + 1;
  end loop;

  if v_idx > 20 then
    raise exception 'Offer at most 20 equipment configurations' using errcode = '23514';
  end if;

  if v_idx > 0 then
    v_trucks := v_sum_trucks;
  else
    v_trucks := p_trucks_offered;
  end if;

  if v_trucks is null or v_trucks < 1 then
    raise exception 'Enter how many trucks you can offer' using errcode = '23514';
  end if;

  if v_trucks > 500 then
    raise exception 'Offer at most 500 trucks' using errcode = '23514';
  end if;

  -- Serialize submissions for one (job, hauler organization): two concurrent first submissions
  -- otherwise both miss the existing row and the second fails on the unique index (23505).
  perform pg_advisory_xact_lock(hashtextextended('marketplace.interest:' || p_job_id::text || ':' || p_hauler_org_id::text, 0));

  select * into v_existing
  from marketplace.expressions_of_interest e
  where e.job_id = p_job_id and e.hauler_org_id = p_hauler_org_id
    and e.superseded_by is null
  for update;

  if found then
    if v_existing.status = 'declined' then
      raise exception 'The landing has closed this inquiry' using errcode = '23514';
    end if;

    -- 31-R: sending a withdrawn inquiry again is new interest.
    if v_existing.status = 'withdrawn' and not marketplace.job_confirmation_current(v_job.last_confirmed_at) then
      raise exception 'Waiting for the poster to confirm' using errcode = '23514',
        hint = 'The poster has not confirmed this job in 14 days, so it is not taking new interest until they do.';
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_build_object('configurationKey', eq.configuration_key, 'count', eq.unit_count)
        order by eq.configuration_key
      ),
      '[]'::jsonb
    )
    into v_existing_lines
    from marketplace.expression_of_interest_equipment eq
    where eq.interest_id = v_existing.id;

    v_unchanged := (
      v_existing.status <> 'withdrawn'
      and v_existing.trucks_offered = v_trucks
      and v_existing.available_from is not distinct from p_available_from
      and v_existing.available_until is not distinct from p_available_until
      and v_existing.message is not distinct from v_clean_msg
      and v_existing.contact_preference = v_contact
      and v_existing_lines = coalesce((
        select jsonb_agg(
          jsonb_build_object('configurationKey', e ->> 'configurationKey', 'count', (e ->> 'count')::integer)
          order by e ->> 'configurationKey'
        )
        from jsonb_array_elements(v_resolved_lines) e
      ), '[]'::jsonb)
    );

    if v_unchanged then
      return query select v_existing.id, false;
      return;
    end if;

    v_renewed := (v_existing.status = 'withdrawn');

    update marketplace.expressions_of_interest
    set submitted_by = v_user,
        trucks_offered = v_trucks,
        available_from = p_available_from,
        available_until = p_available_until,
        message = v_clean_msg,
        contact_preference = v_contact,
        status = case when v_renewed then 'submitted' else status end,
        withdrawn_at = case when v_renewed then null else withdrawn_at end
    where id = v_existing.id;

    delete from marketplace.expression_of_interest_equipment where interest_id = v_existing.id;

    insert into marketplace.expression_of_interest_equipment (interest_id, configuration_key, label, unit_count, sort_order)
    select
      v_existing.id,
      e ->> 'configurationKey',
      e ->> 'label',
      (e ->> 'count')::integer,
      (e ->> 'sortOrder')::smallint
    from jsonb_array_elements(v_resolved_lines) e;

    perform marketplace.write_audit(
      case when v_renewed then 'interest.renewed' else 'interest.updated' end,
      'expressions_of_interest', v_existing.id, p_hauler_org_id,
      null, jsonb_build_object('job_id', p_job_id, 'trucks_offered', v_trucks));

    return query select v_existing.id, false;
    return;
  end if;

  -- 31-R: no new interest on a job its poster has not confirmed in the last 14 days. The job is still active: it
  -- is neither expired nor paused, and an inquiry already sent can still be edited, answered and withdrawn.
  if not marketplace.job_confirmation_current(v_job.last_confirmed_at) then
    raise exception 'Waiting for the poster to confirm' using errcode = '23514',
      hint = 'The poster has not confirmed this job in 14 days, so it is not taking new interest until they do.';
  end if;

  insert into marketplace.expressions_of_interest (
    job_id, job_org_id, hauler_org_id, submitted_by, trucks_offered,
    available_from, available_until, message, contact_preference, status
  )
  values (
    p_job_id, v_job.org_id, p_hauler_org_id, v_user, v_trucks,
    p_available_from, p_available_until, v_clean_msg, v_contact, 'submitted'
  )
  returning id into v_id;

  insert into marketplace.expression_of_interest_equipment (interest_id, configuration_key, label, unit_count, sort_order)
  select
    v_id,
    e ->> 'configurationKey',
    e ->> 'label',
    (e ->> 'count')::integer,
    (e ->> 'sortOrder')::smallint
  from jsonb_array_elements(v_resolved_lines) e;

  perform marketplace.write_audit(
    'interest.submitted', 'expressions_of_interest', v_id, p_hauler_org_id,
    null, jsonb_build_object('job_id', p_job_id, 'job_org_id', v_job.org_id, 'trucks_offered', v_trucks));

  return query select v_id, true;
end
$$;

-- -----------------------------------------------------------------------------
-- 31-O. 11's job lifecycle functions. A job of a business the caller does not belong to and a job that does not
-- exist get the same answer. A member of the job's business who may not act keeps the refusals that name the reason:
-- the role refusal below, and landing_scope_guard's for a landing outside their scope (26-B, as respond_to_interest
-- does since 29).
-- -----------------------------------------------------------------------------
create or replace function marketplace.reconfirm_job_posting(p_job_id uuid)
returns timestamptz
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_user         uuid := marketplace.current_user_id();
  v_job          marketplace.job_postings;
  v_caps         text[];
  v_confirmed_at timestamptz;
  v_seq          bigint;
begin
  select * into v_job from marketplace.job_postings where id = p_job_id for update;
  -- 31-O: a job of a business the caller does not belong to reads exactly as a job that does not exist.
  if not found or not marketplace.has_org_role(v_job.org_id, array['owner', 'manager', 'staff', 'driver']) then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;

  select a.capabilities into v_caps
  from marketplace.get_viewer_marketplace_access(v_job.org_id) a;

  if not ('job.publish' = any (coalesce(v_caps, array[]::text[]))) then
    raise exception 'Your role cannot confirm jobs for this organization' using errcode = '42501';
  end if;

  if v_job.status <> 'active' or (v_job.expires_at is not null and v_job.expires_at <= now()) then
    raise exception 'Only active job postings can be confirmed available' using errcode = '23514';
  end if;

  -- F2: a legacy posting must state valid pay (V2-DEC-02) before it can be reconfirmed.
  if v_job.is_legacy_import and not marketplace.job_pay_is_valid(v_job.pay_unit, v_job.pay_amount_cents, v_job.pay_note) then
    raise exception 'Add pay to this legacy posting (a positive rate with a pay basis, or Negotiable with a note) before reconfirming it'
      using errcode = '23514';
  end if;

  v_confirmed_at := greatest(
    clock_timestamp(),
    coalesce(v_job.last_confirmed_at + interval '1 microsecond', clock_timestamp())
  );

  insert into marketplace.job_publication_attestations (
    job_id, org_id, attested_by, attested_at, reconfirmed_at, reconfirmed_by, confirmation_seq
  )
  values (
    p_job_id, v_job.org_id, v_user, coalesce(v_job.published_at, v_confirmed_at), v_confirmed_at, v_user, 1
  )
  on conflict (job_id) do update
    set reconfirmed_at = v_confirmed_at,
        reconfirmed_by = v_user,
        confirmation_seq = marketplace.job_publication_attestations.confirmation_seq + 1
  returning confirmation_seq into v_seq;

  update marketplace.job_postings
  set last_confirmed_at = v_confirmed_at,
      last_confirmed_by = v_user
  where id = p_job_id;

  perform marketplace.write_audit(
    'job_posting.reconfirmed', 'job_postings', p_job_id, v_job.org_id,
    'Explicit availability reconfirmation',
    jsonb_build_object(
      'confirmed_by_user_id', v_user,
      'confirmed_at', to_char(v_confirmed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'confirmation_seq', v_seq
    )
  );
  return v_confirmed_at;
end
$$;

create or replace function marketplace.set_job_posting_status(p_job_id uuid, p_status text)
returns void
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_job  marketplace.job_postings;
  v_caps text[];
begin
  if p_status not in ('active', 'paused', 'filled', 'closed', 'expired') then
    raise exception 'Invalid job status: %', p_status using errcode = '22023';
  end if;

  select * into v_job from marketplace.job_postings where id = p_job_id for update;
  -- 31-O: a job of a business the caller does not belong to reads exactly as a job that does not exist.
  if not found or not marketplace.has_org_role(v_job.org_id, array['owner', 'manager', 'staff', 'driver']) then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;

  select a.capabilities into v_caps
  from marketplace.get_viewer_marketplace_access(v_job.org_id) a;

  if not ('job.publish' = any (coalesce(v_caps, array[]::text[]))) then
    raise exception 'Your role cannot update jobs for this organization' using errcode = '42501';
  end if;

  if v_job.status = 'draft' then
    raise exception 'Draft job postings must be published via publish_job_posting with explicit availability attestation'
      using errcode = '23514';
  end if;

  -- F3: re-activation is not a plain status change; it needs a fresh availability attestation.
  if p_status = 'active' and v_job.status <> 'active' then
    raise exception 'Re-activating a job posting requires a fresh availability attestation (marketplace.reactivate_job_posting with p_attest_available = true)'
      using errcode = '23514';
  end if;

  update marketplace.job_postings
  set status = p_status,
      expires_at = case when p_status = 'expired' then coalesce(least(expires_at, now()), now()) else expires_at end
  where id = p_job_id;

  perform marketplace.write_audit(
    'job_posting.status_changed', 'job_postings', p_job_id, v_job.org_id,
    null, jsonb_build_object('from_status', v_job.status, 'to_status', p_status));
end
$$;

create or replace function marketplace.reactivate_job_posting(
  p_job_id uuid,
  p_attest_available boolean default null
) returns timestamptz
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_user         uuid := marketplace.current_user_id();
  v_job          marketplace.job_postings;
  v_caps         text[];
  v_confirmed_at timestamptz;
  v_seq          bigint;
begin
  if p_attest_available is not true then
    raise exception 'Explicit availability attestation (p_attest_available = true) is required to put a job posting back on the marketplace'
      using errcode = '23514',
            hint = 'Confirm that this hauling opportunity is currently available.';
  end if;

  select * into v_job from marketplace.job_postings where id = p_job_id for update;
  -- 31-O: a job of a business the caller does not belong to reads exactly as a job that does not exist.
  if not found or not marketplace.has_org_role(v_job.org_id, array['owner', 'manager', 'staff', 'driver']) then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;

  select a.capabilities into v_caps
  from marketplace.get_viewer_marketplace_access(v_job.org_id) a;
  if not ('job.publish' = any (coalesce(v_caps, array[]::text[]))) then
    raise exception 'Your role cannot re-activate jobs for this organization' using errcode = '42501';
  end if;

  if v_job.status = 'draft' then
    raise exception 'Drafts are published with publish_job_posting' using errcode = '23514';
  end if;
  if v_job.status = 'active' then
    raise exception 'This posting is already active; reconfirm it instead' using errcode = '23514';
  end if;
  if exists (select 1 from marketplace.job_moderation_holds h where h.job_id = p_job_id) then
    raise exception 'This posting is on a moderation hold and cannot be re-activated' using errcode = '42501';
  end if;
  if v_job.expires_at is not null and v_job.expires_at <= now() then
    raise exception 'This posting has passed its expiry; publish a new posting' using errcode = '23514';
  end if;
  if not marketplace.job_pay_is_valid(v_job.pay_unit, v_job.pay_amount_cents, v_job.pay_note) then
    raise exception 'Add pay to this posting (a positive rate with a pay basis, or Negotiable with a note) before putting it back on the marketplace'
      using errcode = '23514';
  end if;

  v_confirmed_at := greatest(
    clock_timestamp(),
    coalesce(v_job.last_confirmed_at + interval '1 microsecond', clock_timestamp())
  );

  insert into marketplace.job_publication_attestations (
    job_id, org_id, attested_by, attested_at, reconfirmed_at, reconfirmed_by, confirmation_seq
  )
  values (p_job_id, v_job.org_id, v_user, v_confirmed_at, v_confirmed_at, v_user, 1)
  on conflict (job_id) do update
    set reconfirmed_at = v_confirmed_at,
        reconfirmed_by = v_user,
        confirmation_seq = marketplace.job_publication_attestations.confirmation_seq + 1
  returning confirmation_seq into v_seq;

  update marketplace.job_postings set status = 'active' where id = p_job_id;

  perform marketplace.write_audit(
    'job_posting.reactivated', 'job_postings', p_job_id, v_job.org_id,
    'Explicit availability attestation on re-activation',
    jsonb_build_object(
      'from_status', v_job.status,
      'legacy_import', v_job.is_legacy_import,
      'confirmed_by_user_id', v_user,
      'confirmed_at', to_char(v_confirmed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'confirmation_seq', v_seq
    ));
  return v_confirmed_at;
end
$$;

-- -----------------------------------------------------------------------------
-- 31-F. Founding offer reads (#248). 02's policies let only owners read a redemption, and showed a promotion only
-- while it was active, so an owner lost an offer's terms when its promotion closed.
-- Decision (2026-11-11, #294): every active member of the business may read its redemption. They all hold plan.view
-- (get_org_entitlement_state already shows any member the plan), and the offer is part of what the plan costs. The
-- columns stay those 16 granted: never granted_by. A billing admin reads every redemption, as before.
-- -----------------------------------------------------------------------------
drop policy promotion_redemptions_read on marketplace.promotion_redemptions;
create policy promotion_redemptions_read on marketplace.promotion_redemptions for select to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
         or marketplace.is_platform_admin(array['billing']));

-- The redemption subquery runs under promotion_redemptions' own policy, so it adds nothing a member cannot already
-- read there.
drop policy promotions_read on marketplace.promotions;
create policy promotions_read on marketplace.promotions for select to authenticated
  using (status = 'active'
         or marketplace.is_platform_admin(array['billing'])
         or exists (select 1 from marketplace.promotion_redemptions pr
                    where pr.promotion_id = promotions.id
                      and pr.org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))));

-- -----------------------------------------------------------------------------
-- 31-U. Signed-out unsubscribe (#252).
--
-- Token:  base64url("v1|<key id>|<token id>|<user id>|<org id>|<category>|<channel>|<expiry, epoch seconds>")
--         || '.' || hex(HMAC-SHA-256(key, those payload bytes))
-- The key is 32 random bytes in notification_unsubscribe_keys, which no API role can read. The newest key signs;
-- every stored key verifies, so a key is rotated by inserting a new row and retired by deleting the old one after
-- the longest token lifetime (90 days). A used token id is recorded, so a token works once.
-- -----------------------------------------------------------------------------
create table marketplace.notification_unsubscribe_keys (
  id          uuid primary key default gen_random_uuid(),
  secret      bytea not null check (octet_length(secret) = 32),
  created_at  timestamptz not null default clock_timestamp()
);

create table marketplace.notification_unsubscribe_uses (
  token_id          uuid primary key,
  token_expires_at  timestamptz not null,
  used_at           timestamptz not null default now()
);
create index notification_unsubscribe_uses_expiry_idx on marketplace.notification_unsubscribe_uses (token_expires_at);

alter table marketplace.notification_unsubscribe_keys enable row level security;
alter table marketplace.notification_unsubscribe_uses enable row level security;
-- No policies and no grants: only the two SECURITY DEFINER functions below read or write these tables.
revoke all on marketplace.notification_unsubscribe_keys, marketplace.notification_unsubscribe_uses
  from public, anon, authenticated, service_role;

-- HMAC-SHA-256 (RFC 2104) over the built-in sha256, so 31 needs no extension. 32 checks it against RFC 4231's vectors.
create function marketplace.hmac_sha256(p_key bytea, p_message bytea)
returns bytea language plpgsql immutable strict
set search_path = pg_catalog, pg_temp
as $$
declare
  v_key  bytea := case when octet_length(p_key) > 64 then sha256(p_key) else p_key end;
  v_ipad bytea;
  v_opad bytea;
begin
  v_key := v_key || decode(repeat('00', 64 - octet_length(v_key)), 'hex');
  v_ipad := v_key;
  v_opad := v_key;
  for i in 0..63 loop
    v_ipad := set_byte(v_ipad, i, get_byte(v_key, i) # 54);  -- 0x36
    v_opad := set_byte(v_opad, i, get_byte(v_key, i) # 92);  -- 0x5c
  end loop;
  return sha256(v_opad || sha256(v_ipad || p_message));
end
$$;

-- The email worker mints one token per unsubscribe link it sends. service_role only.
create function marketplace.issue_unsubscribe_token(
  p_user_id uuid,
  p_org_id uuid,
  p_category text,
  p_channel text default 'email',
  p_valid_for interval default interval '30 days'
) returns text
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_key     marketplace.notification_unsubscribe_keys;
  v_payload bytea;
begin
  if p_user_id is null or p_org_id is null
     or p_category is null or p_category !~ '^[a-z][a-z_]{1,40}$'
     or p_channel is null or p_channel not in ('in_app', 'email') then
    raise exception 'a recipient, a business, a category and a channel are required' using errcode = '22023';
  end if;
  if p_valid_for is null or p_valid_for < interval '1 minute' or p_valid_for > interval '90 days' then
    raise exception 'an unsubscribe link is valid for between 1 minute and 90 days' using errcode = '22023';
  end if;
  if not exists (select 1 from marketplace.organization_memberships m
                 where m.user_id = p_user_id and m.org_id = p_org_id) then
    raise exception 'the recipient is not a member of this business' using errcode = 'P0002';
  end if;

  select * into v_key from marketplace.notification_unsubscribe_keys order by created_at desc, id desc limit 1;
  if not found then
    -- The first token creates the key. Serialized, so two first tokens do not create two keys.
    perform pg_advisory_xact_lock(hashtextextended('marketplace.notification_unsubscribe_keys', 0));
    select * into v_key from marketplace.notification_unsubscribe_keys order by created_at desc, id desc limit 1;
    if not found then
      insert into marketplace.notification_unsubscribe_keys (secret)
      values (sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text
                                || gen_random_uuid()::text, 'UTF8')))
      returning * into v_key;
    end if;
  end if;

  v_payload := convert_to(concat_ws('|', 'v1', v_key.id, gen_random_uuid(), p_user_id, p_org_id, p_category, p_channel,
                                    floor(extract(epoch from now() + p_valid_for))::bigint), 'UTF8');
  return translate(encode(v_payload, 'base64'), '+/' || E'=\n', '-_')
         || '.' || encode(marketplace.hmac_sha256(v_key.secret, v_payload), 'hex');
end
$$;

-- The link itself. anon only. Every refusal is the same silent return: a caller learns nothing from a token that is
-- malformed, forged, expired or already used, and nothing about the person or the business in a valid one. Call it
-- in a read-write transaction.
create function marketplace.unsubscribe_with_token(p_token text)
returns void
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_b64     text;
  v_payload bytea;
  v_parts   text[];
  v_secret  bytea;
  v_expires timestamptz;
  v_changed integer;
begin
  -- A token is about 320 characters. (A regular expression bound cannot exceed 255, so the length is checked apart.)
  if p_token is null or char_length(p_token) not between 100 and 512
     or p_token !~ '^[A-Za-z0-9_-]+\.[0-9a-f]{64}$' then
    return;
  end if;
  v_b64 := split_part(p_token, '.', 1);

  -- Nothing from the token is trusted until its signature is checked; only the key id is read first, to find the key.
  begin
    v_payload := decode(rpad(translate(v_b64, '-_', '+/'), (char_length(v_b64) + 3) / 4 * 4, '='), 'base64');
    v_parts := string_to_array(convert_from(v_payload, 'UTF8'), '|');
    if cardinality(v_parts) is distinct from 8 or v_parts[1] <> 'v1' then
      return;
    end if;
    select k.secret into v_secret from marketplace.notification_unsubscribe_keys k where k.id = v_parts[2]::uuid;
  exception when others then
    return;
  end;
  if v_secret is null then
    return;
  end if;
  -- Compared as digests of the two signatures, not byte by byte.
  if sha256(marketplace.hmac_sha256(v_secret, v_payload)) <> sha256(decode(split_part(p_token, '.', 2), 'hex')) then
    return;
  end if;

  -- The payload is ours from here on.
  v_expires := to_timestamp(v_parts[8]::bigint);
  if v_expires <= now() then
    return;
  end if;

  -- One use per token. A second caller waits for the first to finish, then finds the token used.
  insert into marketplace.notification_unsubscribe_uses (token_id, token_expires_at)
  values (v_parts[3]::uuid, v_expires)
  on conflict (token_id) do nothing;
  if not found then
    return;
  end if;

  update marketplace.notification_preferences np
  set enabled = false
  where np.user_id = v_parts[4]::uuid and np.org_id = v_parts[5]::uuid
    and np.category = v_parts[6] and np.channel = v_parts[7]
    and np.enabled;
  get diagnostics v_changed = row_count;

  if v_changed > 0 then
    perform marketplace.write_audit(
      'notification.unsubscribed', 'notification_preferences', v_parts[4]::uuid, v_parts[5]::uuid,
      'Signed unsubscribe link',
      jsonb_build_object('category', v_parts[6], 'channel', v_parts[7], 'token_id', v_parts[3]));
  end if;
end
$$;

comment on function marketplace.unsubscribe_with_token(text) is
  '31-U (#252): the signed-out unsubscribe link. Verifies the token''s HMAC-SHA-256 signature and expiry, uses it once, and turns off only the one (user, business, category, channel) preference it names. Returns nothing and raises nothing for any token, so it reveals nothing. Executable by anon only.';

-- -----------------------------------------------------------------------------
-- Function grants (none by default: HF-18). The eight redefined functions keep their ACLs.
-- -----------------------------------------------------------------------------
revoke all on function
  marketplace.job_confirmation_current(timestamptz),
  marketplace.job_takes_new_interest(uuid),
  marketplace.hmac_sha256(bytea, bytea),
  marketplace.issue_unsubscribe_token(uuid, uuid, text, text, interval),
  marketplace.unsubscribe_with_token(text)
  from public, anon, authenticated, service_role;

-- interests_hauler_insert runs it as the person inserting.
grant execute on function marketplace.job_takes_new_interest(uuid) to authenticated;
-- The signed-out link. It is the only function 31 gives anon, and the only one anon holds that writes.
grant execute on function marketplace.unsubscribe_with_token(text) to anon;
-- The email worker runs with the service role.
grant execute on function marketplace.issue_unsubscribe_token(uuid, uuid, text, text, interval) to service_role;

-- -----------------------------------------------------------------------------
-- Record this migration.
-- -----------------------------------------------------------------------------
insert into marketplace.schema_migrations (version, name) values ('31', '31_v2_reply_gate_reconfirmation_unsubscribe');
