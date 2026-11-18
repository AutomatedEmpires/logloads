-- =============================================================================
-- LogLoads normalized-v2 — 40 phone-reveal pause (#325)
--
-- NON-ACTIVE PROTOTYPE. Not an approved migration. Applied after 38_v2_basins.sql.
-- Run order: 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23 -> 26 -> 29 -> 31 -> 33 -> 35 -> 38 -> 40
-- (the odd stages and 10, 15, 39, 41 are tests, not migrations). Apply exactly once, in one transaction:
-- psql -v ON_ERROR_STOP=1 --single-transaction -f 40_v2_reveal_pause.sql
--
-- 31 already shares a landing's phone with one hauler, and only after the landing replies and opts in.
-- This file does not replace respond_to_interest. A trigger on the share column counts distinct landings.
-- PHONE_REVEAL_PAUSE_THRESHOLD = 5 and PHONE_REVEAL_PAUSE_WINDOW_HOURS = 24, the same numbers as
-- packages/contracts/src/v2/disclosure and marketplace.phone_reveal_pause_limit().
-- The share that reaches 5 is kept. It opens one abuse report (unsafe_disclosure, the hauler organization)
-- and one pause row. The next new landing is refused until a moderator clears the pause, which dismisses
-- the report through admin_resolve_report. Shares at or before that clear do not count again.
-- An advisory transaction lock serializes two landings sharing at the same moment, so the count cannot
-- pass the threshold twice. No function here reads site_contact_phone. The phone is not written to the
-- report, the audit metadata, or the exception text.
--
-- 40 adds one empty table and four functions, and two triggers. It changes no stored row.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Migration-order guard: requires 38, refuses a repeat. Runs before any change.
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_advisory_xact_lock(hashtextextended('marketplace.schema_migrations', 0));
  if to_regclass('marketplace.schema_migrations') is null then
    raise exception 'migration 40 requires migration 38 to be applied first' using errcode = '55000';
  end if;
  if not exists (select 1 from marketplace.schema_migrations where version = '38') then
    raise exception 'migration 40 requires migration 38 to be applied first' using errcode = '55000';
  end if;
  if exists (select 1 from marketplace.schema_migrations where version = '40') then
    raise exception 'migration 40 is already applied (%); re-running it is refused and nothing was changed',
      (select applied_at from marketplace.schema_migrations where version = '40')
      using errcode = '55000', hint = 'Migrations are forward-only.';
  end if;
  if to_regclass('marketplace.hauler_reveal_pauses') is not null
     or to_regprocedure('marketplace.admin_clear_hauler_reveal_pause(uuid, text)') is not null then
    raise exception 'migration 40 appears to be applied already (its objects exist) but is not recorded; refusing to re-run'
      using errcode = '55000';
  end if;
  perform set_config('logloads.migration_xact', txid_current()::text, true);
end
$$;

do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    perform set_config('default_transaction_read_only', 'on', false);
    perform set_config('logloads.migration_refused', '40', false);
  end if;
end
$$;

do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    raise exception 'migration 40 must be applied in one transaction (psql --single-transaction); nothing was changed'
      using errcode = '25P01', hint = 'This session (or pooled backend) was made read-only to stop the rest of the file.';
  end if;
  if coalesce(current_setting('logloads.migration_refused', true), '') <> '' then
    raise exception 'migration 40 refused: this session was made read-only by an earlier non-atomic attempt (migration %); reconnect and apply it with psql --single-transaction',
      current_setting('logloads.migration_refused')
      using errcode = '25P01';
  end if;
end
$$;

-- The named constants. Immutable, so it is not a second volatile function if it were ever granted to anon.
-- It is not granted to anon, authenticated, or service_role.
create function marketplace.phone_reveal_pause_limit()
returns table (landing_count integer, window_hours integer)
language sql
immutable
as $$
  select 5, 24
$$;

comment on function marketplace.phone_reveal_pause_limit() is
  'PHONE_REVEAL_PAUSE_THRESHOLD = 5 distinct landings and PHONE_REVEAL_PAUSE_WINDOW_HOURS = 24. packages/contracts/src/v2/disclosure.';

-- One open pause per hauler. Staff clear sets both cleared columns. No policy and no grant:
-- the trigger and the staff function are the only writers. The owner bypasses row-level security; it is not forced.
-- The table holds no phone number.
create table marketplace.hauler_reveal_pauses (
  id            uuid primary key default gen_random_uuid(),
  hauler_org_id uuid not null references marketplace.organizations (id),
  report_id     uuid not null references marketplace.abuse_reports (id),
  opened_at     timestamptz not null default now(),
  cleared_at    timestamptz,
  cleared_by    uuid references marketplace.app_users (id),
  check ((cleared_at is null) = (cleared_by is null))
);

create unique index hauler_reveal_pauses_one_open_uq
  on marketplace.hauler_reveal_pauses (hauler_org_id)
  where cleared_at is null;

alter table marketplace.hauler_reveal_pauses enable row level security;
revoke all on table marketplace.hauler_reveal_pauses from public, anon, authenticated, service_role;

comment on table marketplace.hauler_reveal_pauses is
  'A hauler paused after phone reveals from distinct landings reached the review threshold. The row does not store the phone.';

-- Opens the pause and the #255 report. A second open for the same hauler does nothing.
-- The details sentence and the audit metadata name no phone number.
create function marketplace.open_hauler_reveal_pause(p_hauler_org uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_report uuid;
  v_limit  integer;
begin
  if p_hauler_org is null then
    raise exception 'Reveal pause not found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('logloads.hauler_reveal:' || p_hauler_org::text, 0));
  if exists (
    select 1 from marketplace.hauler_reveal_pauses
    where hauler_org_id = p_hauler_org and cleared_at is null
  ) then
    return;
  end if;
  if marketplace.current_user_id() is null then
    raise exception 'a signed-in member is required' using errcode = '42501';
  end if;
  select landing_count into v_limit from marketplace.phone_reveal_pause_limit();
  insert into marketplace.abuse_reports (reporter_user_id, target_kind, target_id, reason, details)
  values (
    marketplace.current_user_id(),
    'organization',
    p_hauler_org,
    'unsafe_disclosure',
    'Phone reveals from distinct landings reached the review threshold.'
  )
  returning id into v_report;
  insert into marketplace.hauler_reveal_pauses (hauler_org_id, report_id)
  values (p_hauler_org, v_report);
  perform marketplace.write_audit(
    'hauler_reveal.paused',
    'organizations',
    p_hauler_org,
    p_hauler_org,
    null,
    jsonb_build_object('report_id', v_report, 'landing_count', v_limit),
    false
  );
end
$$;

-- BEFORE: a new release is refused when a pause is open, or when other landings already fill the window.
-- The release that reaches the threshold is allowed. AFTER: that release opens the pause.
-- A landing already shared in the window does not count again. Shares at or before the last clear do not count.
-- Decline sets the column null and both triggers return without counting.
create function marketplace.tg_hauler_reveal_pause()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_limit       integer;
  v_hours       integer;
  v_cleared     timestamptz;
  v_landing     uuid;
  v_count       integer;
  v_already     boolean;
  v_include_new boolean;
begin
  if tg_op <> 'UPDATE' or new.private_details_shared_at is null or old.private_details_shared_at is not null then
    if tg_when = 'BEFORE' then
      return new;
    end if;
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('logloads.hauler_reveal:' || new.hauler_org_id::text, 0));

  if exists (
    select 1 from marketplace.hauler_reveal_pauses
    where hauler_org_id = new.hauler_org_id and cleared_at is null
  ) then
    if tg_when = 'BEFORE' then
      raise exception 'This hauler is paused for review' using errcode = '42501';
    end if;
    return null;
  end if;

  select landing_count, window_hours into v_limit, v_hours from marketplace.phone_reveal_pause_limit();
  select coalesce(max(cleared_at), '-infinity'::timestamptz) into v_cleared
  from marketplace.hauler_reveal_pauses
  where hauler_org_id = new.hauler_org_id;

  select j.landing_id into v_landing from marketplace.job_postings j where j.id = new.job_id;
  if v_landing is null then
    if tg_when = 'BEFORE' then
      return new;
    end if;
    return null;
  end if;

  select exists (
    select 1
    from marketplace.expressions_of_interest e
    join marketplace.job_postings j on j.id = e.job_id
    where e.hauler_org_id = new.hauler_org_id
      and e.id <> new.id
      and j.landing_id = v_landing
      and e.private_details_shared_at > now() - make_interval(hours => v_hours)
      and e.private_details_shared_at > v_cleared
  ) into v_already;

  if v_already then
    if tg_when = 'BEFORE' then
      return new;
    end if;
    return null;
  end if;

  v_include_new := tg_when = 'AFTER';
  select count(distinct j.landing_id) into v_count
  from marketplace.expressions_of_interest e
  join marketplace.job_postings j on j.id = e.job_id
  where e.hauler_org_id = new.hauler_org_id
    and (v_include_new or e.id <> new.id)
    and e.private_details_shared_at > now() - make_interval(hours => v_hours)
    and e.private_details_shared_at > v_cleared;

  if tg_when = 'BEFORE' then
    if v_count >= v_limit then
      raise exception 'This hauler is paused for review' using errcode = '42501';
    end if;
    return new;
  end if;

  if v_count >= v_limit then
    perform marketplace.open_hauler_reveal_pause(new.hauler_org_id);
  end if;
  return null;
end
$$;

create trigger hauler_reveal_pause_before
  before update of private_details_shared_at on marketplace.expressions_of_interest
  for each row execute function marketplace.tg_hauler_reveal_pause();

create trigger hauler_reveal_pause_after
  after update of private_details_shared_at on marketplace.expressions_of_interest
  for each row execute function marketplace.tg_hauler_reveal_pause();

-- A moderator dismisses the report through admin_resolve_report (#255) and closes the pause.
-- Releases may resume. A billing admin is refused. The reason is the staff note, not a phone number.
create function marketplace.admin_clear_hauler_reveal_pause(p_org_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_id     uuid;
  v_report uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not marketplace.is_platform_admin(array['moderator']) then
    raise exception 'platform moderator required' using errcode = '42501';
  end if;
  if char_length(v_reason) not between 5 and 500 then
    raise exception 'a reason of 5 to 500 characters is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('logloads.hauler_reveal:' || p_org_id::text, 0));
  select id, report_id into v_id, v_report
  from marketplace.hauler_reveal_pauses
  where hauler_org_id = p_org_id and cleared_at is null
  for update;
  if not found then
    raise exception 'Reveal pause not found' using errcode = 'P0002';
  end if;
  perform marketplace.admin_resolve_report(v_report, 'dismissed', v_reason);
  update marketplace.hauler_reveal_pauses
  set cleared_at = now(), cleared_by = marketplace.current_user_id()
  where id = v_id;
  perform marketplace.write_audit(
    'hauler_reveal.pause_cleared',
    'organizations',
    p_org_id,
    p_org_id,
    v_reason,
    jsonb_build_object('report_id', v_report),
    true
  );
end
$$;

-- -----------------------------------------------------------------------------
-- Grants. Internals stay with the owner. Only the staff clear is authenticated.
-- -----------------------------------------------------------------------------
revoke all on function
  marketplace.phone_reveal_pause_limit(),
  marketplace.open_hauler_reveal_pause(uuid),
  marketplace.tg_hauler_reveal_pause(),
  marketplace.admin_clear_hauler_reveal_pause(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function
  marketplace.admin_clear_hauler_reveal_pause(uuid, text)
  to authenticated;

grant execute on function
  marketplace.phone_reveal_pause_limit(),
  marketplace.open_hauler_reveal_pause(uuid),
  marketplace.tg_hauler_reveal_pause()
  to current_user;

insert into marketplace.schema_migrations (version, name) values ('40', '40_v2_reveal_pause');
