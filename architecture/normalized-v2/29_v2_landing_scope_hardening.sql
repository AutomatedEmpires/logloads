-- =============================================================================
-- LogLoads normalized-v2 — 29 landing-scope hardening: follow-ups from the review of 26 (PR #241; #263, #264)
--
-- NON-ACTIVE PROTOTYPE. Not an approved migration. Applied after 26_v2_team_seats_saved_jobs_outbox.sql.
-- Run order: 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23 -> 26 -> 29 (19..22, 24, 25, 27, 28 and 30 are test
-- suites and harnesses, not migrations). Apply exactly once, in one transaction:
-- psql -v ON_ERROR_STOP=1 --single-transaction -f 29_...sql
-- 29 changes no stored row, no table, no policy, no trigger and no grant. It redefines four functions
-- (CREATE OR REPLACE keeps each ACL): tg_landing_scope_guard, respond_to_interest, count_eligible_invitation_recipients
-- and estimate_boost_audience. Stage 29 in CI checks this exact set; 10 proves on existing data that no row changes.
--
-- Source: the post-merge review of #241 (logloads#263, comment 6781627119): 0 P1, 1 P2, 1 P3.
--
-- 29-P2  26-B limits a manager or staff member to some landings. Its guard (tg_landing_scope_guard) let a member of
--        the inquiring hauling business change an inquiry without the landing check, so a person who is both a
--        limited member of the landing organization and a member of the hauling business could respond to an
--        inquiry at a landing outside their scope through respond_to_interest (SECURITY DEFINER, which checked the
--        organization role only): mark it viewed and share the landing's private details, or decline it without a
--        reply. Sharing set private_details_shared_at, and can_view_landing_private then let the hauling business
--        read that landing's private access details. Now:
--          * the guard takes the hauling-business bypass only when no landing-side response column changes: not
--            responded_at, not a move to viewed, replied or declined, and not private_details_shared_at or
--            private_details_shared_by, except that a withdrawal clears them. The hauling business still edits,
--            withdraws, renews and replies on its own inquiry;
--          * respond_to_interest refuses an inquiry on a job at a landing outside the caller's scope
--            (job_scope_allows) before it reads or writes anything, with the guard's own refusal. The guard alone
--            would leave respond_to_interest's no-op paths (a repeated decline, a view of a viewed inquiry, a
--            withdrawn inquiry) answering an out-of-scope member with the inquiry's state.
-- 29-P3  count_eligible_invitation_recipients and estimate_boost_audience (SECURITY DEFINER) checked the organization
--        role only, so a limited member could read both counts for a job at another landing, including a draft or a
--        paused job that 26-B's row policies hide from them. Both now also require job_scope_allows, with the
--        refusal they already give a job the caller cannot act on ('not authorized for this job').
--
-- Every other line of the four functions is the current definition, verbatim (26, 06, 03 and 18); lines marked "29"
-- are new or changed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Migration-order guard: requires 26, refuses a repeat. Runs before any change.
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_advisory_xact_lock(hashtextextended('marketplace.schema_migrations', 0));
  -- Two statements: PL/pgSQL plans each condition whole, so the ledger is referenced only once it exists.
  if to_regclass('marketplace.schema_migrations') is null then
    raise exception 'migration 29 requires migration 26 to be applied first' using errcode = '55000';
  end if;
  if not exists (select 1 from marketplace.schema_migrations where version = '26') then
    raise exception 'migration 29 requires migration 26 to be applied first' using errcode = '55000';
  end if;
  if exists (select 1 from marketplace.schema_migrations where version = '29') then
    raise exception 'migration 29 is already applied (%); re-running it is refused and nothing was changed',
      (select applied_at from marketplace.schema_migrations where version = '29')
      using errcode = '55000', hint = 'Migrations are forward-only.';
  end if;
  if to_regprocedure('marketplace.job_scope_allows(uuid)') is null
     or to_regprocedure('marketplace.tg_landing_scope_guard()') is null then
    raise exception 'migration 29 requires the current 26 (26-B landing scope); this database applied an earlier 26'
      using errcode = '55000';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p
             where p.oid = to_regprocedure('marketplace.tg_landing_scope_guard()')
               and p.prosrc like '%v_landing_response%') then
    raise exception 'migration 29 appears to be applied already (the landing-response check is installed) but is not recorded; refusing to re-run'
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
    perform set_config('logloads.migration_refused', '29', false);
  end if;
end
$$;
-- The refusal needs no session state (a pooler may run this statement on another backend); see 06.
do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    raise exception 'migration 29 must be applied in one transaction (psql --single-transaction); nothing was changed'
      using errcode = '25P01', hint = 'This session (or pooled backend) was made read-only to stop the rest of the file.';
  end if;
  if coalesce(current_setting('logloads.migration_refused', true), '') <> '' then
    raise exception 'migration 29 refused: this session was made read-only by an earlier non-atomic attempt (migration %); reconnect and apply it with psql --single-transaction',
      current_setting('logloads.migration_refused')
      using errcode = '25P01';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 29-P2. 26's landing-scope guard. On expressions_of_interest, the bypass for a member of the hauling business now
-- covers only what the hauling business itself changes; a landing-side response is held to the job's landing.
-- -----------------------------------------------------------------------------
create or replace function marketplace.tg_landing_scope_guard()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_user    uuid := marketplace.current_user_id();
  v_ok      boolean := true;
  v_job     uuid;
  v_hauler  uuid;
  v_landing_response boolean := false; -- 29
begin
  if v_user is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_table_name = 'landings' then
    if tg_op = 'INSERT' then
      v_ok := marketplace.user_landing_scope_allows(v_user, new.org_id, null);
    else
      v_ok := marketplace.user_landing_scope_allows(v_user, old.org_id, old.id);
    end if;
  elsif tg_table_name = 'landing_private_details' then
    v_ok := marketplace.user_landing_scope_allows(v_user, new.org_id, new.landing_id)
            and (tg_op = 'INSERT' or marketplace.user_landing_scope_allows(v_user, old.org_id, old.landing_id));
  elsif tg_table_name = 'job_postings' then
    v_ok := marketplace.user_landing_scope_allows(v_user, new.org_id, new.landing_id)
            and (tg_op = 'INSERT' or marketplace.user_landing_scope_allows(v_user, old.org_id, old.landing_id));
  elsif tg_table_name = 'job_posting_equipment' then
    v_job := case when tg_op = 'DELETE' then old.job_id else new.job_id end;
  elsif tg_table_name = 'targeted_invitations' then
    v_job := new.job_id;
  elsif tg_table_name = 'expressions_of_interest' then
    -- The hauling business edits, withdraws and renews its own inquiry; only the landing side is limited.
    -- 29: a landing-side response is checked against the job's landing even when the person also belongs to the
    -- hauling business: responded_at, a move to viewed, replied or declined, or sharing or revoking the landing's
    -- private details (a withdrawal, which only the hauling business makes, clears them).
    v_landing_response := new.responded_at is distinct from old.responded_at
      or (new.status is distinct from old.status and new.status in ('viewed', 'replied', 'declined'))
      or ((new.private_details_shared_at is distinct from old.private_details_shared_at
           or new.private_details_shared_by is distinct from old.private_details_shared_by)
          and not (new.status = 'withdrawn'
                   and new.private_details_shared_at is null and new.private_details_shared_by is null)); -- 29
    if not v_landing_response then -- 29
      v_hauler := new.hauler_org_id;
    end if;
    v_job := new.job_id;
  elsif tg_table_name = 'interest_messages' then
    if new.author_side = 'landing' then
      select e.job_id into v_job from marketplace.expressions_of_interest e where e.id = new.interest_id;
    end if;
  end if;

  if v_job is not null and (v_hauler is null or not exists (
        select 1 from marketplace.organization_memberships m
        where m.org_id = v_hauler and m.user_id = v_user and m.status = 'active')) then
    v_ok := v_ok and coalesce((select marketplace.user_landing_scope_allows(v_user, j.org_id, j.landing_id)
                               from marketplace.job_postings j where j.id = v_job), true);
  end if;

  if not v_ok then
    raise exception 'This landing is not one of the landings you are assigned to' using errcode = '42501',
      hint = 'An owner of the organization can change which landings you work on.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

-- -----------------------------------------------------------------------------
-- 29-P2. 06's respond_to_interest, refusing an inquiry on a job at a landing outside the caller's scope (26-B) before
-- anything is read or written.
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
        private_details_shared_at = case when p_share_private_details is false then null else private_details_shared_at end,
        private_details_shared_by = case when p_share_private_details is false then null else private_details_shared_by end
    where id = p_interest_id;

    perform marketplace.write_audit('interest.declined', 'expressions_of_interest', p_interest_id, v_row.job_org_id);
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
-- 29-P3. 03's recipient count and 18's boost estimate (HF-17), each limited to jobs at landings in the caller's scope.
-- -----------------------------------------------------------------------------
create or replace function marketplace.count_eligible_invitation_recipients(
  p_job_id uuid,
  p_radius_miles integer default 100,
  p_dedupe_window interval default null
)
returns integer language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare v_org uuid;
begin
  select org_id into v_org from marketplace.job_postings where id = p_job_id;
  if v_org is null or not marketplace.has_org_role(v_org, array['owner', 'manager', 'staff'], true)
     or not marketplace.job_scope_allows(p_job_id) then -- 29
    raise exception 'not authorized for this job' using errcode = '42501';
  end if;
  return (select count(*)::integer from marketplace.eligible_invitation_recipients(p_job_id, p_radius_miles, p_dedupe_window));
end
$$;

create or replace function marketplace.estimate_boost_audience(p_job_id uuid, p_product_code text default 'quick')
returns table (radius_miles integer, opted_in_haulers integer, active_availability_reports integer)
language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_org    uuid;
  v_point  extensions.geography;
  v_radius integer;
  v_m      double precision;
begin
  select j.org_id, l.public_point into v_org, v_point
  from marketplace.job_postings j join marketplace.landings l on l.id = j.landing_id
  where j.id = p_job_id;
  if v_org is null or not marketplace.has_org_role(v_org, array['owner', 'manager', 'staff'], true)
     or not marketplace.job_scope_allows(p_job_id) then -- 29
    raise exception 'not authorized for this job' using errcode = '42501';
  end if;
  select coalesce(bp.radius_miles, 100) into v_radius
  from marketplace.boost_products bp where bp.code = p_product_code and bp.status = 'active';
  v_radius := coalesce(v_radius, 100);
  v_m := v_radius::double precision * 1609.344 + 8000.0;

  return query
  select v_radius,
    (select count(*)::integer from marketplace.hauler_profiles h
     join marketplace.organizations o on o.id = h.org_id and o.status = 'active'
     where h.is_public and h.public_listing_consent_at is not null and h.service_center is not null
       and extensions.st_dwithin(h.service_center, v_point, v_m)),
    (select count(*)::integer from marketplace.availability_reports ar
     join marketplace.hauler_profiles h on h.org_id = ar.org_id and h.is_public and h.public_listing_consent_at is not null
     join marketplace.organizations o on o.id = ar.org_id and o.status = 'active'
     where ar.withdrawn_at is null and ar.available_until >= current_date
       and extensions.st_dwithin(ar.area_center, v_point, v_m));
end
$$;

-- -----------------------------------------------------------------------------
-- Grants: none change. CREATE OR REPLACE keeps each function's ACL (stage 29 in CI checks every grant):
-- respond_to_interest, count_eligible_invitation_recipients and estimate_boost_audience stay executable by
-- authenticated only (03, 06), and tg_landing_scope_guard by no API role (26).
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- Record this migration.
-- -----------------------------------------------------------------------------
insert into marketplace.schema_migrations (version, name) values ('29', '29_v2_landing_scope_hardening');
