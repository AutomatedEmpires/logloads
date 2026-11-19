-- =============================================================================
-- LogLoads normalized-v2 — 44 reveal ledger, withheld shares, the staff clear through the report queue, the hauler's
-- view of released access details, and the poster's review date on job reads (#403, review of PR 389 for #325)
--
-- NON-ACTIVE PROTOTYPE. Not an approved migration. Applied after 42_v2_basin_liquidity.sql.
-- Run order: 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23 -> 26 -> 29 -> 31 -> 33 -> 35 -> 38 -> 40 -> 42 -> 44
-- (the odd stages and 10, 15 are tests, not migrations). Apply exactly once, in one transaction:
-- psql -v ON_ERROR_STOP=1 --single-transaction -f 44_v2_reveal_ledger.sql
--
-- 44-L  (BLOCKER.) 40 counted reveals from expressions_of_interest.private_details_shared_at, which a withdrawal, a
--       revoke or a decline sets back to null, so a hauler could read four numbers, withdraw, and read four more. Each
--       reveal is now a row in phone_reveal_events, written by the AFTER trigger and never updated or deleted. The
--       counts read only that ledger. It starts with the share history already in the audit log (landing_private.shared).
-- 44-W  A paused hauler no longer makes the landing's reply fail. The BEFORE trigger keeps the reply and drops only the
--       share; respond_to_interest records landing_private.share_withheld for staff only (no organization on the audit
--       row), and the landing's app says "Your number was not shared". Nothing tells either side about a hold.
-- 44-Q  The staff clear works with the #255 report queue. Dismissing the pause's report there closes the pause (a
--       trigger on abuse_reports). Marking it actioned keeps the hauler paused, and admin_clear_reveal_pause can still
--       clear it later without touching the resolved report. list_reveal_pauses lists the open pauses for staff.
-- 44-S  The pause report is filed by LogLoads itself (reporter_user_id null), not by the landing member whose share
--       reached the threshold, so no member reads it or its resolution note. The staff reason is on the audit row
--       only, and the pause audit rows carry no organization, so only staff read them.
-- 44-P  Reveals also count per person: the member who sent the inquiries, across all of their hauling businesses.
--       Five distinct landings for one person in 24 hours pauses that person (a pause row with user_id).
-- 44-H  hauler_job_access(org, job) returns the landing's directions, gate instructions, site contact and phone to a
--       member of that hauling business while its inquiry on the job is replied and shared, and nothing otherwise.
--       landing_interest_disclosure(org, interest) tells the landing desk whether its details are shared on one
--       inquiry, with its own site phone, for the Show my number control (flow C, C4 and C5).
-- 44-V  get_marketplace_job and list_marketplace_jobs_page also return poster_verified_at, the date LogLoads reviewed
--       the posting business (null unless it is verified), so a verification mark can show its review date (#337).
--
-- 44 adds one table (phone_reveal_events, filled from the audit history), a column and a check on hauler_reveal_pauses,
-- a check on abuse_reports (reporter_user_id may be null only for a reveal-pause report), eleven functions and three
-- triggers. It redefines respond_to_interest, tg_hauler_reveal_pause, open_hauler_reveal_pause and
-- admin_clear_hauler_reveal_pause (CREATE OR REPLACE keeps each ACL), and drops and recreates get_marketplace_job and
-- list_marketplace_jobs_page with one more column and their 06 and 33 grants. No function here writes a phone number
-- to a report, an audit row, the outbox or a message.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Migration-order guard: requires 42, refuses a repeat. Runs before any change.
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_advisory_xact_lock(hashtextextended('marketplace.schema_migrations', 0));
  if to_regclass('marketplace.schema_migrations') is null then
    raise exception 'migration 44 requires migration 42 to be applied first' using errcode = '55000';
  end if;
  if not exists (select 1 from marketplace.schema_migrations where version = '42') then
    raise exception 'migration 44 requires migration 42 to be applied first' using errcode = '55000';
  end if;
  if exists (select 1 from marketplace.schema_migrations where version = '44') then
    raise exception 'migration 44 is already applied (%); re-running it is refused and nothing was changed',
      (select applied_at from marketplace.schema_migrations where version = '44')
      using errcode = '55000', hint = 'Migrations are forward-only.';
  end if;
  if to_regclass('marketplace.phone_reveal_events') is not null
     or to_regprocedure('marketplace.admin_clear_reveal_pause(uuid, text)') is not null then
    raise exception 'migration 44 appears to be applied already (its objects exist) but is not recorded; refusing to re-run'
      using errcode = '55000';
  end if;
  perform set_config('logloads.migration_xact', txid_current()::text, true);
end
$$;

do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    perform set_config('default_transaction_read_only', 'on', false);
    perform set_config('logloads.migration_refused', '44', false);
  end if;
end
$$;

do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    raise exception 'migration 44 must be applied in one transaction (psql --single-transaction); nothing was changed'
      using errcode = '25P01', hint = 'This session (or pooled backend) was made read-only to stop the rest of the file.';
  end if;
  if coalesce(current_setting('logloads.migration_refused', true), '') <> '' then
    raise exception 'migration 44 refused: this session was made read-only by an earlier non-atomic attempt (migration %); reconnect and apply it with psql --single-transaction',
      current_setting('logloads.migration_refused')
      using errcode = '25P01';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 44-L. The reveal ledger. One row per reveal: the moment a landing's private details became readable by one hauling
-- business on one inquiry. The AFTER trigger is the only writer. No policy and no grant; append-only for everyone,
-- the owner included. It holds no phone number, no direction and no gate detail.
-- -----------------------------------------------------------------------------
create table marketplace.phone_reveal_events (
  id            bigint generated always as identity primary key,
  interest_id   uuid not null,
  hauler_org_id uuid not null references marketplace.organizations (id),
  submitted_by  uuid not null references marketplace.app_users (id),
  landing_id    uuid not null references marketplace.landings (id),
  revealed_at   timestamptz not null default now(),
  revealed_by   uuid references marketplace.app_users (id)
);

create index phone_reveal_events_org_idx on marketplace.phone_reveal_events (hauler_org_id, revealed_at desc);
create index phone_reveal_events_person_idx on marketplace.phone_reveal_events (submitted_by, revealed_at desc);

alter table marketplace.phone_reveal_events enable row level security;
revoke all on table marketplace.phone_reveal_events from public, anon, authenticated, service_role;

comment on table marketplace.phone_reveal_events is
  '44-L (#403): one row per phone reveal, written by tg_hauler_reveal_pause and never changed. The reveal pause counts this ledger, so a withdrawal, a revoke or a decline cannot lower the count. No phone number is stored.';

create function marketplace.tg_phone_reveal_events_append_only()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp
as $$ begin raise exception 'phone_reveal_events is append-only' using errcode = '42501'; end $$;

create trigger phone_reveal_events_append_only before update or delete on marketplace.phone_reveal_events
  for each row execute function marketplace.tg_phone_reveal_events_append_only();
create trigger phone_reveal_events_no_truncate before truncate on marketplace.phone_reveal_events
  for each statement execute function marketplace.tg_phone_reveal_events_append_only();

-- The history already on record: every landing_private.shared audit row of an inquiry on a job with a landing, at
-- the time it was written. A repeated share of one inquiry is one landing again, so it does not add to a count.
insert into marketplace.phone_reveal_events (interest_id, hauler_org_id, submitted_by, landing_id, revealed_at, revealed_by)
select e.id, e.hauler_org_id, e.submitted_by, j.landing_id, a.occurred_at, a.actor_user_id
from marketplace.audit_events a
join marketplace.expressions_of_interest e on e.id = a.entity_id
join marketplace.job_postings j on j.id = e.job_id
where a.action = 'landing_private.shared'
  and a.entity_table = 'expressions_of_interest'
  and j.landing_id is not null
order by a.occurred_at, a.id;

-- -----------------------------------------------------------------------------
-- 44-P. A pause names one subject: a hauling business (hauler_org_id) or a person (user_id). One open pause each.
-- 44-S. A reveal-pause report has no member as its reporter.
-- -----------------------------------------------------------------------------
alter table marketplace.hauler_reveal_pauses alter column hauler_org_id drop not null;
alter table marketplace.hauler_reveal_pauses add column user_id uuid references marketplace.app_users (id);
alter table marketplace.hauler_reveal_pauses
  add constraint hauler_reveal_pauses_one_subject_ck check (num_nonnulls(hauler_org_id, user_id) = 1);
create unique index hauler_reveal_pauses_one_open_person_uq
  on marketplace.hauler_reveal_pauses (user_id)
  where cleared_at is null;

comment on table marketplace.hauler_reveal_pauses is
  'A hauling business (hauler_org_id) or a person (user_id, 44-P) paused after phone reveals from distinct landings reached the review threshold. The row does not store the phone.';

alter table marketplace.abuse_reports alter column reporter_user_id drop not null;
alter table marketplace.abuse_reports
  add constraint abuse_reports_system_reporter_ck
  check (reporter_user_id is not null or (reason = 'unsafe_disclosure' and target_kind in ('organization', 'user')));

-- -----------------------------------------------------------------------------
-- Internal helpers. No grant beyond the owner.
-- -----------------------------------------------------------------------------

-- The hauling business first, then the person. Every function that holds both takes them in this order, after any
-- report row it locks, so a reveal and a clear never wait on each other in a circle.
create function marketplace.lock_reveal_subjects(p_hauler_org uuid, p_person uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
begin
  if p_hauler_org is not null then
    perform pg_advisory_xact_lock(hashtextextended('logloads.hauler_reveal:' || p_hauler_org::text, 0));
  end if;
  if p_person is not null then
    perform pg_advisory_xact_lock(hashtextextended('logloads.person_reveal:' || p_person::text, 0));
  end if;
end
$$;

-- True while the business or the person has an open pause.
create function marketplace.reveal_paused(p_hauler_org uuid, p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select exists (
    select 1 from marketplace.hauler_reveal_pauses p
    where p.cleared_at is null
      and (p.hauler_org_id = p_hauler_org or p.user_id = p_person)
  )
$$;

-- The window from the ledger only: distinct landings in the last 24 hours after the subject's last clear, for the
-- business and for the person, and whether p_landing is already one of them (it then does not count again).
create function marketplace.reveal_window(p_hauler_org uuid, p_person uuid, p_landing uuid)
returns table (org_landings integer, org_has_landing boolean, person_landings integer, person_has_landing boolean)
language sql
stable
security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  with lim as (
    select now() - make_interval(hours => window_hours) as opened from marketplace.phone_reveal_pause_limit()
  ),
  org_since as (
    select greatest((select opened from lim), coalesce((
      select max(p.cleared_at) from marketplace.hauler_reveal_pauses p where p.hauler_org_id = p_hauler_org
    ), '-infinity'::timestamptz)) as since
  ),
  person_since as (
    select greatest((select opened from lim), coalesce((
      select max(p.cleared_at) from marketplace.hauler_reveal_pauses p where p.user_id = p_person
    ), '-infinity'::timestamptz)) as since
  )
  select
    (select count(distinct r.landing_id)::integer from marketplace.phone_reveal_events r
      where r.hauler_org_id = p_hauler_org and r.revealed_at > (select since from org_since)),
    exists (select 1 from marketplace.phone_reveal_events r
      where r.hauler_org_id = p_hauler_org and r.landing_id = p_landing and r.revealed_at > (select since from org_since)),
    (select count(distinct r.landing_id)::integer from marketplace.phone_reveal_events r
      where r.submitted_by = p_person and r.revealed_at > (select since from person_since)),
    exists (select 1 from marketplace.phone_reveal_events r
      where r.submitted_by = p_person and r.landing_id = p_landing and r.revealed_at > (select since from person_since))
$$;

-- Opens the pauses that tripped, under one LogLoads report. A subject already paused is not paused twice.
-- The report and the audit rows name no phone number and no member as reporter. The audit rows carry no
-- organization, so only staff read them (audit_events_read).
create function marketplace.open_reveal_pause(p_hauler_org uuid, p_person uuid, p_org_tripped boolean, p_person_tripped boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_org    boolean;
  v_person boolean;
  v_report uuid;
  v_limit  integer;
begin
  perform marketplace.lock_reveal_subjects(
    case when p_org_tripped then p_hauler_org end,
    case when p_person_tripped then p_person end);
  v_org := coalesce(p_org_tripped, false) and p_hauler_org is not null and not exists (
    select 1 from marketplace.hauler_reveal_pauses where hauler_org_id = p_hauler_org and cleared_at is null);
  v_person := coalesce(p_person_tripped, false) and p_person is not null and not exists (
    select 1 from marketplace.hauler_reveal_pauses where user_id = p_person and cleared_at is null);
  if not v_org and not v_person then
    return;
  end if;
  select landing_count into v_limit from marketplace.phone_reveal_pause_limit();
  insert into marketplace.abuse_reports (reporter_user_id, target_kind, target_id, reason, details)
  values (
    null, -- 44-S: filed by LogLoads
    case when v_org then 'organization' else 'user' end,
    case when v_org then p_hauler_org else p_person end,
    'unsafe_disclosure',
    case when v_org
      then 'Phone reveals from distinct landings to this hauling business reached the review threshold.'
      else 'Phone reveals from distinct landings to the hauling businesses of one person reached the review threshold.' end
  )
  returning id into v_report;
  if v_org then
    insert into marketplace.hauler_reveal_pauses (hauler_org_id, report_id) values (p_hauler_org, v_report);
    perform marketplace.write_audit(
      'hauler_reveal.paused', 'organizations', p_hauler_org, null, null,
      jsonb_build_object('report_id', v_report, 'landing_count', v_limit, 'subject', 'organization'), false);
  end if;
  if v_person then
    insert into marketplace.hauler_reveal_pauses (user_id, report_id) values (p_person, v_report);
    perform marketplace.write_audit(
      'hauler_reveal.paused', 'app_users', p_person, null, null,
      jsonb_build_object('report_id', v_report, 'landing_count', v_limit, 'subject', 'person'), false);
  end if;
end
$$;

-- 40's opener, kept for its name: it now opens a business pause through open_reveal_pause.
create or replace function marketplace.open_hauler_reveal_pause(p_hauler_org uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
begin
  if p_hauler_org is null then
    raise exception 'Reveal pause not found' using errcode = 'P0002';
  end if;
  perform marketplace.open_reveal_pause(p_hauler_org, null, true, false);
end
$$;

-- 44-W. The audit row for one share request, after the update: shared, revoked, or withheld by a pause. A withheld
-- share has no organization on its row, so neither the landing nor the hauler reads it.
create function marketplace.audit_share_outcome(p_interest_id uuid, p_job_org uuid, p_hauler_org uuid, p_job uuid, p_share boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
begin
  if p_share is null then
    return;
  end if;
  if not p_share then
    perform marketplace.write_audit(
      'landing_private.revoked', 'expressions_of_interest', p_interest_id, p_job_org,
      null, jsonb_build_object('hauler_org_id', p_hauler_org, 'job_id', p_job));
  elsif exists (
    select 1 from marketplace.expressions_of_interest
    where id = p_interest_id and private_details_shared_at is not null
  ) then
    perform marketplace.write_audit(
      'landing_private.shared', 'expressions_of_interest', p_interest_id, p_job_org,
      null, jsonb_build_object('hauler_org_id', p_hauler_org, 'job_id', p_job));
  else
    perform marketplace.write_audit(
      'landing_private.share_withheld', 'expressions_of_interest', p_interest_id, null,
      null, jsonb_build_object('hauler_org_id', p_hauler_org, 'job_id', p_job, 'landing_org_id', p_job_org));
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 44-L, 44-W, 44-P. 40's trigger function, reading the ledger. CREATE OR REPLACE keeps both triggers and the ACL.
-- BEFORE: a share is dropped (the rest of the update stands) while the business or the person is paused, or when
-- other landings already fill either window. A landing already in the window does not count again.
-- AFTER: the reveal is written to the ledger, and a window that reached the threshold opens the pause.
-- A decline, a revoke or a withdrawal sets the column null: both triggers return without counting, and the ledger
-- keeps every earlier reveal.
-- -----------------------------------------------------------------------------
create or replace function marketplace.tg_hauler_reveal_pause()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_limit   integer;
  v_landing uuid;
  w         record;
begin
  if tg_op <> 'UPDATE' or new.private_details_shared_at is null or old.private_details_shared_at is not null then
    if tg_when = 'BEFORE' then
      return new;
    end if;
    return null;
  end if;

  select j.landing_id into v_landing from marketplace.job_postings j where j.id = new.job_id;
  if v_landing is null then
    if tg_when = 'BEFORE' then
      return new;
    end if;
    return null;
  end if;

  perform marketplace.lock_reveal_subjects(new.hauler_org_id, new.submitted_by);
  select landing_count into v_limit from marketplace.phone_reveal_pause_limit();

  if tg_when = 'BEFORE' then
    if marketplace.reveal_paused(new.hauler_org_id, new.submitted_by) then
      new.private_details_shared_at := null;
      new.private_details_shared_by := null;
      return new;
    end if;
    select * into w from marketplace.reveal_window(new.hauler_org_id, new.submitted_by, v_landing);
    if (not w.org_has_landing and w.org_landings >= v_limit)
       or (not w.person_has_landing and w.person_landings >= v_limit) then
      -- A full window with no pause open (the ledger began with the audit history): open it, so staff see why.
      perform marketplace.open_reveal_pause(new.hauler_org_id, new.submitted_by,
        w.org_landings >= v_limit, w.person_landings >= v_limit);
      new.private_details_shared_at := null;
      new.private_details_shared_by := null;
    end if;
    return new;
  end if;

  insert into marketplace.phone_reveal_events (interest_id, hauler_org_id, submitted_by, landing_id, revealed_at, revealed_by)
  values (new.id, new.hauler_org_id, new.submitted_by, v_landing, now(), new.private_details_shared_by);
  select * into w from marketplace.reveal_window(new.hauler_org_id, new.submitted_by, v_landing);
  if w.org_landings >= v_limit or w.person_landings >= v_limit then
    perform marketplace.open_reveal_pause(new.hauler_org_id, new.submitted_by,
      w.org_landings >= v_limit, w.person_landings >= v_limit);
  end if;
  return null;
end
$$;

-- -----------------------------------------------------------------------------
-- 44-Q. Dismissing a reveal-pause report in the #255 queue closes its open pauses. Actioned keeps them open.
-- -----------------------------------------------------------------------------
create function marketplace.tg_reveal_pause_report_resolved()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_by uuid;
  p    record;
begin
  v_by := coalesce(new.reviewed_by, marketplace.current_user_id());
  if v_by is null then
    return null;
  end if;
  for p in
    select hauler_org_id, user_id from marketplace.hauler_reveal_pauses
    where report_id = new.id and cleared_at is null
    order by (hauler_org_id is null), id
  loop
    perform marketplace.lock_reveal_subjects(p.hauler_org_id, p.user_id);
  end loop;
  for p in
    update marketplace.hauler_reveal_pauses
    set cleared_at = now(), cleared_by = v_by
    where report_id = new.id and cleared_at is null
    returning id, hauler_org_id, user_id
  loop
    perform marketplace.write_audit(
      'hauler_reveal.pause_cleared',
      case when p.hauler_org_id is not null then 'organizations' else 'app_users' end,
      coalesce(p.hauler_org_id, p.user_id), null, null,
      jsonb_build_object('report_id', new.id, 'pause_id', p.id, 'via', 'report_dismissed'), true);
  end loop;
  return null;
end
$$;

create trigger reveal_pause_report_resolved
  after update of status on marketplace.abuse_reports
  for each row
  when (new.status = 'dismissed' and old.status is distinct from 'dismissed')
  execute function marketplace.tg_reveal_pause_report_resolved();

-- 44-Q. A moderator closes one pause. An open or reviewing report is dismissed with a fixed note (which closes any
-- other pause filed under it); a report already resolved in the queue keeps its outcome and is not touched. The staff
-- reason is written to the audit row only. A billing or support admin is refused.
create function marketplace.admin_clear_reveal_pause(p_pause_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_pause  marketplace.hauler_reveal_pauses;
  v_status text;
  v_reason text := btrim(coalesce(p_reason, ''));
  p        record;
begin
  if not marketplace.is_platform_admin(array['moderator']) then
    raise exception 'platform moderator required' using errcode = '42501';
  end if;
  if char_length(v_reason) not between 5 and 500 then
    raise exception 'a reason of 5 to 500 characters is required' using errcode = '22023';
  end if;
  select * into v_pause from marketplace.hauler_reveal_pauses where id = p_pause_id;
  if not found or v_pause.cleared_at is not null then
    raise exception 'Reveal pause not found' using errcode = 'P0002';
  end if;
  -- The report row first, then the subjects, as the queue's trigger takes them.
  select r.status into v_status from marketplace.abuse_reports r where r.id = v_pause.report_id for update;
  for p in
    select hauler_org_id, user_id from marketplace.hauler_reveal_pauses
    where report_id = v_pause.report_id and cleared_at is null
    order by (hauler_org_id is null), id
  loop
    perform marketplace.lock_reveal_subjects(p.hauler_org_id, p.user_id);
  end loop;
  update marketplace.hauler_reveal_pauses
  set cleared_at = now(), cleared_by = marketplace.current_user_id()
  where id = p_pause_id and cleared_at is null;
  if not found then
    raise exception 'Reveal pause not found' using errcode = 'P0002';
  end if;
  perform marketplace.write_audit(
    'hauler_reveal.pause_cleared',
    case when v_pause.hauler_org_id is not null then 'organizations' else 'app_users' end,
    coalesce(v_pause.hauler_org_id, v_pause.user_id), null, v_reason,
    jsonb_build_object('report_id', v_pause.report_id, 'pause_id', v_pause.id, 'via', 'staff_clear'), true);
  if v_status in ('open', 'reviewing') then
    perform marketplace.admin_resolve_report(v_pause.report_id, 'dismissed', 'Closed when LogLoads staff cleared the phone-reveal pause.');
  end if;
end
$$;

-- 40's clear by business, kept for its name and grant: it clears that business's open pause through admin_clear_reveal_pause.
create or replace function marketplace.admin_clear_hauler_reveal_pause(p_org_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  if not marketplace.is_platform_admin(array['moderator']) then
    raise exception 'platform moderator required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then
    raise exception 'a reason of 5 to 500 characters is required' using errcode = '22023';
  end if;
  select id into v_id from marketplace.hauler_reveal_pauses where hauler_org_id = p_org_id and cleared_at is null;
  if not found then
    raise exception 'Reveal pause not found' using errcode = 'P0002';
  end if;
  perform marketplace.admin_clear_reveal_pause(v_id, p_reason);
end
$$;

-- 44-Q. The open pauses, oldest first, for moderators and support. The subject's name, when it opened, its report's
-- status, and how many distinct landings revealed to it in the last 24 hours. No phone, landing or job.
create function marketplace.list_reveal_pauses()
returns table (
  pause_id uuid,
  subject_kind text,
  subject_id uuid,
  subject_name text,
  opened_at timestamptz,
  report_id uuid,
  report_status text,
  landings_in_window integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
#variable_conflict use_column
begin
  if not marketplace.is_platform_admin(array['moderator', 'support']) then
    raise exception 'platform moderator or support admin required' using errcode = '42501';
  end if;
  return query
  select
    p.id,
    case when p.hauler_org_id is not null then 'organization' else 'person' end,
    coalesce(p.hauler_org_id, p.user_id),
    coalesce(o.display_name, u.display_name),
    p.opened_at,
    p.report_id,
    r.status,
    (select count(distinct e.landing_id)::integer
     from marketplace.phone_reveal_events e
     where (e.hauler_org_id = p.hauler_org_id or e.submitted_by = p.user_id)
       and e.revealed_at > now() - make_interval(hours => (select l.window_hours from marketplace.phone_reveal_pause_limit() l)))
  from marketplace.hauler_reveal_pauses p
  join marketplace.abuse_reports r on r.id = p.report_id
  left join marketplace.organizations o on o.id = p.hauler_org_id
  left join marketplace.app_users u on u.id = p.user_id
  where p.cleared_at is null
  order by p.opened_at, p.id;
end
$$;

-- -----------------------------------------------------------------------------
-- 44-H. The hauler's job view of the released details. A member (owner, manager, staff or driver) of p_org_id reads the
-- job's landing directions, gate instructions, site contact and phone while that business's inquiry on the job is
-- replied and shared, and the job is active or paused: the same rule as can_view_landing_private, bound to one
-- business. Anyone else, another business, and a revoked, declined or withdrawn inquiry get no row.
-- -----------------------------------------------------------------------------
create function marketplace.hauler_job_access(p_org_id uuid, p_job_id uuid)
returns table (
  landing_id uuid,
  directions text,
  gate_instructions text,
  site_contact_name text,
  site_contact_phone text,
  shared_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select d.landing_id, d.directions, d.gate_instructions, d.site_contact_name, d.site_contact_phone, e.private_details_shared_at
  from marketplace.expressions_of_interest e
  join marketplace.job_postings j on j.id = e.job_id
  join marketplace.landing_private_details d on d.landing_id = j.landing_id
  where marketplace.has_org_role(p_org_id, array['owner', 'manager', 'staff', 'driver'])
    and e.hauler_org_id = p_org_id
    and e.job_id = p_job_id
    and e.status = 'replied'
    and e.private_details_shared_at is not null
    and j.status in ('active', 'paused')
  order by e.private_details_shared_at desc
  limit 1
$$;

-- 44-H. The landing desk's view of one of its inquiries: its status, whether its details are shared now, and the
-- landing's own site phone (what Show my number would share). Owners, managers and staff with a landing seat whose
-- landing scope covers the job; anyone else gets no row.
create function marketplace.landing_interest_disclosure(p_org_id uuid, p_interest_id uuid)
returns table (
  interest_id uuid,
  interest_status text,
  shared_at timestamptz,
  site_contact_phone text
)
language sql
stable
security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select e.id, e.status, e.private_details_shared_at, d.site_contact_phone
  from marketplace.expressions_of_interest e
  join marketplace.job_postings j on j.id = e.job_id
  left join marketplace.landing_private_details d on d.landing_id = j.landing_id
  where e.id = p_interest_id
    and e.job_org_id = p_org_id
    and marketplace.has_org_role(p_org_id, array['owner', 'manager', 'staff'], true)
    and marketplace.job_scope_allows(e.job_id)
$$;

-- -----------------------------------------------------------------------------
-- 44-W. 31's respond_to_interest. Every line is 31's, verbatim, except the two audit calls marked "44": the outcome
-- of a share request is recorded after the update, so a share the pause withheld is not recorded as shared.
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
      perform marketplace.audit_share_outcome(p_interest_id, v_row.job_org_id, v_row.hauler_org_id, v_row.job_id, p_share_private_details); -- 44
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
    perform marketplace.audit_share_outcome(p_interest_id, v_row.job_org_id, v_row.hauler_org_id, v_row.job_id, p_share_private_details); -- 44
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 44-V. 06's get_marketplace_job with the poster's review date. Dropped and created again because a function's
-- result columns cannot change in place; the grants are 06's.
-- -----------------------------------------------------------------------------
drop function marketplace.get_marketplace_job(uuid);

create function marketplace.get_marketplace_job(p_job_id uuid)
returns table (
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
  sponsored boolean,
  poster_verified_at timestamptz -- 44-V
)
language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select j.*,
         (select o.verified_at from marketplace.organizations o
          where o.id = j.poster_organization_id and o.verification_status = 'verified') -- 44-V
  from marketplace.list_marketplace_jobs(null, null, null, false, null, null, null, 2, 1, p_job_id) j
$$;

-- -----------------------------------------------------------------------------
-- 44-V. 33's list_marketplace_jobs_page with the poster's review date. Every line is 33's, verbatim, except the three
-- marked "44-V". Dropped and created again for the new result column; the grants are 33's.
-- -----------------------------------------------------------------------------
drop function marketplace.list_marketplace_jobs_page(text, text, text, boolean, uuid, numeric, numeric, integer, text, text[], date, jsonb, text, jsonb, integer);

create function marketplace.list_marketplace_jobs_page(
  p_query text default null,
  p_equipment text default null,
  p_pay_unit text default null,
  p_accepting_only boolean default true,
  p_org_id uuid default null,
  p_lat numeric default null,
  p_lng numeric default null,
  p_radius_miles integer default null,
  p_product text default null,
  p_product_excluded text[] default null,
  p_starts_by date default null,
  p_equipment_setups jsonb default null,
  p_sort text default 'newest',
  p_after jsonb default null,
  p_limit integer default 50
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
  sponsored boolean,
  total_count bigint,
  page_cursor jsonb,
  poster_verified_at timestamptz -- 44-V
)
language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_origin  extensions.geography;
  v_sort    text := lower(btrim(coalesce(p_sort, 'newest')));
  v_limit   integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_product text := nullif(lower(btrim(coalesce(p_product, ''))), '');
  v_setups  jsonb;
  a_k0 integer; a_k1 numeric; a_k2 numeric; a_k3 integer; a_k4 numeric; a_title text; a_id uuid;
begin
  if v_sort not in ('newest', 'nearest', 'pay') then
    raise exception 'p_sort must be newest, nearest or pay' using errcode = '22023';
  end if;
  if p_lat is not null and p_lng is not null and p_lat between -90 and 90 and p_lng between -180 and 180 then
    v_origin := extensions.st_setsrid(extensions.st_makepoint(p_lng::double precision, p_lat::double precision), 4326)::extensions.geography;
  end if;
  if v_sort = 'nearest' and v_origin is null then
    v_sort := 'newest';
  end if;
  if p_equipment_setups is not null then
    if jsonb_typeof(p_equipment_setups) <> 'array' then
      raise exception 'p_equipment_setups must be an array of arrays of equipment codes' using errcode = '22023';
    end if;
    -- A setup with nothing in it compares with nothing (marketplaceEquipmentFit).
    select jsonb_agg(s) into v_setups
    from jsonb_array_elements(p_equipment_setups) s
    where jsonb_typeof(s) = 'array' and jsonb_array_length(s) > 0;
  end if;
  if p_after is not null then
    begin
      if jsonb_typeof(p_after) <> 'object' or (p_after ->> 's') is distinct from v_sort
         or jsonb_typeof(p_after -> 'k') <> 'array' or jsonb_array_length(p_after -> 'k') <> 5 then
        raise exception 'cursor shape' using errcode = '22023';
      end if;
      a_k0 := (p_after -> 'k' ->> 0)::integer;
      a_k1 := (p_after -> 'k' ->> 1)::numeric;
      a_k2 := (p_after -> 'k' ->> 2)::numeric;
      a_k3 := (p_after -> 'k' ->> 3)::integer;
      a_k4 := (p_after -> 'k' ->> 4)::numeric;
      a_title := p_after ->> 't';
      a_id := (p_after ->> 'i')::uuid;
      if a_k0 is null or a_k1 is null or a_k2 is null or a_k3 is null or a_k4 is null or a_title is null or a_id is null then
        raise exception 'cursor shape' using errcode = '22023';
      end if;
    exception when others then
      raise exception 'This page link does not match the search; start again from the first page' using errcode = '22023';
    end;
  end if;

  return query
  with search_origin as (
    select marketplace.approximate_point(v_origin) as snapped_point, -- 33: from p_lat and p_lng
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
      case when o.verification_status = 'verified' then o.verified_at end as poster_verified_at, -- 44-V
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
      ) as raw_sponsored,
      -- 33: the two sort keys the page order needs beside the columns above.
      case when so.snapped_point is not null and l.public_point is not null
           then extensions.st_distance(l.public_point, so.snapped_point)
      end as distance_m,
      case when j.pay_amount_cents is not null and j.pay_unit is not null and j.pay_unit not in ('negotiable', 'other')
           then coalesce(array_position(array['per_load', 'per_ton', 'per_mbf', 'per_cord', 'per_mile', 'per_hour', 'per_day', 'flat_rate'],
                                        j.pay_unit), 99)
      end as pay_rank
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
      -- 31-R: an active job that was not confirmed in the last 14 days (a legacy job never confirmed included) is
      -- off every list until its poster reconfirms it; its own landing desk and platform staff still see it.
      and (j.status <> 'active'
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
      -- 33: the filters the adapter applied in memory.
      and (v_product is null or lower(btrim(coalesce(j.product, ''))) = v_product)
      and (p_product_excluded is null
           or (btrim(coalesce(j.product, '')) <> ''
               and lower(btrim(j.product)) <> all (select lower(btrim(x)) from unnest(p_product_excluded) x where x is not null)))
      and (p_starts_by is null or (j.work_starts_on is not null and j.work_starts_on <= p_starts_by))
      -- One of the viewer's setups has every piece of equipment the job lists. A job that lists none, and a viewer
      -- with no setup, are not compared.
      and (v_setups is null
           or coalesce(cardinality(eq.codes), 0) = 0
           or exists (
             select 1 from jsonb_array_elements(v_setups) s
             where not exists (
               select 1 from unnest(eq.codes) c
               where not exists (select 1 from jsonb_array_elements_text(s) x where lower(btrim(x)) = lower(c)))))
  ),
  keyed as (
    select r.*,
           case v_sort when 'nearest' then (r.distance_m is null)::integer
                       when 'pay' then (r.pay_rank is null)::integer
                       else 0 end as k0,
           case v_sort when 'nearest' then coalesce(r.distance_m, 0)::numeric
                       when 'pay' then coalesce(r.pay_rank, 0)::numeric
                       else 0::numeric end as k1,
           case when v_sort = 'pay' and r.pay_rank is not null then -(r.pay_amount_cents::numeric) else 0::numeric end as k2,
           (r.last_confirmed_at is null)::integer as k3,
           -(extract(epoch from coalesce(r.last_confirmed_at, r.last_modified_at))::numeric) as k4
    from job_rows r
  ),
  counted as (
    select k.*, count(*) over () as matching from keyed k
  )
  select
    c.job_id, c.slug, c.title, c.poster_organization_id, c.poster_name, c.poster_verified,
    c.product, c.description, c.pay_amount_cents, c.pay_unit, c.pay_note,
    c.equipment_codes, c.equipment_labels,
    c.origin_label, c.origin_state_code, c.origin_lat, c.origin_lng,
    c.destination_label, c.est_one_way_miles, c.distance_miles,
    c.starts_on, c.ends_on, c.duration_days, c.schedule_note,
    c.trucks_total, c.trucks_per_day,
    c.estimated_loads_per_truck_per_day, c.estimated_daily_loads, c.estimated_tons_per_load,
    c.public_road_notes, c.public_access_requirements,
    c.eff_status as status, c.accepting_interest,
    c.last_modified_at, c.last_confirmed_at, c.expires_at,
    false as sponsored,
    c.matching as total_count,
    -- The key travels as text: a JSON number would lose the timestamp's microseconds in a JavaScript client.
    jsonb_build_object('s', v_sort, 'k', jsonb_build_array(c.k0::text, c.k1::text, c.k2::text, c.k3::text, c.k4::text),
                       't', c.title, 'i', c.job_id) as page_cursor,
    c.poster_verified_at -- 44-V
  from counted c
  where p_after is null
     or (c.k0, c.k1, c.k2, c.k3, c.k4, c.title collate "C", c.job_id) > (a_k0, a_k1, a_k2, a_k3, a_k4, a_title collate "C", a_id)
  order by c.k0, c.k1, c.k2, c.k3, c.k4, c.title collate "C", c.job_id
  limit v_limit;
end
$$;

comment on function marketplace.hauler_job_access(uuid, uuid) is
  '44-H (#403): the job''s landing access details and site phone for a member of p_org_id while its inquiry on the job is replied and shared; no row otherwise.';
comment on function marketplace.landing_interest_disclosure(uuid, uuid) is
  '44-H (#403): for the landing desk, whether one inquiry has the landing''s details shared, and the landing''s own site phone.';
comment on function marketplace.list_reveal_pauses() is
  '44-Q (#403): open reveal pauses for moderators and support. No phone, landing or job.';
comment on function marketplace.admin_clear_reveal_pause(uuid, text) is
  '44-Q (#403): a moderator closes one reveal pause; an open report is dismissed with a fixed note, a resolved one is left as it is. The reason is audited.';

-- -----------------------------------------------------------------------------
-- Grants. The internals stay with the owner. Staff and members call only the four reads and clears below; the two
-- job reads keep their public grants.
-- -----------------------------------------------------------------------------
revoke all on function
  marketplace.tg_phone_reveal_events_append_only(),
  marketplace.lock_reveal_subjects(uuid, uuid),
  marketplace.reveal_paused(uuid, uuid),
  marketplace.reveal_window(uuid, uuid, uuid),
  marketplace.open_reveal_pause(uuid, uuid, boolean, boolean),
  marketplace.audit_share_outcome(uuid, uuid, uuid, uuid, boolean),
  marketplace.tg_reveal_pause_report_resolved(),
  marketplace.admin_clear_reveal_pause(uuid, text),
  marketplace.list_reveal_pauses(),
  marketplace.hauler_job_access(uuid, uuid),
  marketplace.landing_interest_disclosure(uuid, uuid),
  marketplace.get_marketplace_job(uuid),
  marketplace.list_marketplace_jobs_page(text, text, text, boolean, uuid, numeric, numeric, integer, text, text[], date, jsonb, text, jsonb, integer)
  from public, anon, authenticated, service_role;

grant execute on function
  marketplace.admin_clear_reveal_pause(uuid, text),
  marketplace.list_reveal_pauses(),
  marketplace.hauler_job_access(uuid, uuid),
  marketplace.landing_interest_disclosure(uuid, uuid)
  to authenticated;

grant execute on function
  marketplace.get_marketplace_job(uuid),
  marketplace.list_marketplace_jobs_page(text, text, text, boolean, uuid, numeric, numeric, integer, text, text[], date, jsonb, text, jsonb, integer)
  to anon, authenticated;

grant execute on function
  marketplace.tg_phone_reveal_events_append_only(),
  marketplace.lock_reveal_subjects(uuid, uuid),
  marketplace.reveal_paused(uuid, uuid),
  marketplace.reveal_window(uuid, uuid, uuid),
  marketplace.open_reveal_pause(uuid, uuid, boolean, boolean),
  marketplace.audit_share_outcome(uuid, uuid, uuid, uuid, boolean),
  marketplace.tg_reveal_pause_report_resolved()
  to current_user;

insert into marketplace.schema_migrations (version, name) values ('44', '44_v2_reveal_ledger');
