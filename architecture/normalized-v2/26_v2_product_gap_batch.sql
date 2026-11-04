-- =============================================================================
-- LogLoads normalized-v2 — 26 the V2 product gaps found in review (#125, #127, #187, #210, #214)
--
-- NON-ACTIVE PROTOTYPE. Not an approved migration. Applied after 23_v2_round2_hardening.sql.
-- Run order: 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23 -> 26 (19..22, 24, 25, 27 and 28 are test suites
-- and harnesses, not migrations). Apply exactly once, in one transaction: psql -v ON_ERROR_STOP=1 --single-transaction -f 26_...sql
--
-- Changes:
--   G1  A landing's public details (#127): `landings.typical_hours` (1..120) and `landings.public_road_notes`
--       (1..1000), public text with the existing coordinate and gate-code check. anon reads both on an active
--       landing; the landing's own desk writes them under the existing landing policies.
--   G2  A hauling business's private details (#125): `hauler_private_details`, one row per hauling business, holding
--       the business type chosen at setup (`solo` or `company`), a business phone (E.164) and the default way
--       landings reach the business (`in_app`, `phone` or `email`; `phone` needs a business phone). Members of the
--       business read it, its owners and managers write it, and no one else reads it (no counterpart, no anon, no
--       platform staff), so nothing here can reach a public profile.
--   G3  `organizations.legal_name` is readable only by the organization's own active members and platform staff
--       (#187). Until now every signed-in person who could read the organization row read its legal name, though the
--       V2 profile labels it private. The column grant is withdrawn and `organization_legal_name(uuid)` returns it
--       to those readers only. Writing it (owner only, organizations_owner_update) is unchanged.
--   G4  `list_hauler_equipment_options` offers only truck configurations (a truck, optionally with its trailer), the
--       taxonomy of `packages/contracts` (`MARKETPLACE_EQUIPMENT_GROUPS`). Extras (attachments) and trailer-only rows
--       are no longer offered as equipment on an inquiry. Its signature, grants and every other rule are unchanged.
--   G5  Report reasons (#214): `abuse_reports.reason` accepts the three spec §8.18 reasons it lacked, under the
--       contract's codes (`stale`, `suspicious_contact`, `wrong_equipment`). Reports stored as `other` with the
--       adapter's "Reason: {label}." prefix get their own code back and lose the prefix (audited). One person keeps
--       at most one open or in-review report per target: earlier duplicates are kept and closed as duplicates
--       (audited), then a unique partial index holds the rule.
--   G6  Availability integrity (#210): an open availability report never claims more trucks of a type than the
--       business lists (`equipment_units`, active rows of that `equipment_code`): a write over the list is refused
--       (23514), and lowering the list brings an open report down to it, or withdraws it when none is left. A report
--       and a lowered list take turns on one advisory lock per business and type (lock order: the type's open
--       reports, then the lock), so neither reads the other's uncommitted change. A business keeps at most one open
--       report per type (unique partial index). Existing data is brought into line first, audited, without
--       refreshing any report time: earlier duplicate open reports are withdrawn, and an open report over the list is
--       brought down to it (or withdrawn when none is listed).
--
-- New functions: organization_legal_name(uuid) (EXECUTE to authenticated only), tg_availability_cap() and
-- tg_equipment_availability_fit() (trigger functions, no EXECUTE for anyone). Redefined: list_hauler_equipment_options
-- (CREATE OR REPLACE keeps its ACL). Migration 18 (HF-18) withholds EXECUTE from PUBLIC on every function this role
-- creates, so each grant here is explicit. Stage 26 in CI checks this exact set.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Migration-order guard: requires 23, refuses a repeat. Runs before any change.
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_advisory_xact_lock(hashtextextended('marketplace.schema_migrations', 0));
  -- Two statements: PL/pgSQL plans each condition whole, so the ledger is referenced only once it exists.
  if to_regclass('marketplace.schema_migrations') is null then
    raise exception 'migration 26 requires migration 23 to be applied first' using errcode = '55000';
  end if;
  if not exists (select 1 from marketplace.schema_migrations where version = '23') then
    raise exception 'migration 26 requires migration 23 to be applied first' using errcode = '55000';
  end if;
  if exists (select 1 from marketplace.schema_migrations where version = '26') then
    raise exception 'migration 26 is already applied (%); re-running it is refused and nothing was changed',
      (select applied_at from marketplace.schema_migrations where version = '26')
      using errcode = '55000', hint = 'Migrations are forward-only.';
  end if;
  if to_regclass('marketplace.hauler_private_details') is not null
     or exists (select 1 from information_schema.columns
                where table_schema = 'marketplace' and table_name = 'landings' and column_name in ('typical_hours', 'public_road_notes')) then
    raise exception 'migration 26 appears to be applied already (a landing public-detail column or hauler_private_details exists) but is not recorded; refusing to re-run'
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
    perform set_config('logloads.migration_refused', '26', false);
  end if;
end
$$;
-- The refusal needs no session state (a pooler may run this statement on another backend); see 06.
do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    raise exception 'migration 26 must be applied in one transaction (psql --single-transaction); nothing was changed'
      using errcode = '25P01', hint = 'This session (or pooled backend) was made read-only to stop the rest of the file.';
  end if;
  if coalesce(current_setting('logloads.migration_refused', true), '') <> '' then
    raise exception 'migration 26 refused: this session was made read-only by an earlier non-atomic attempt (migration %); reconnect and apply it with psql --single-transaction',
      current_setting('logloads.migration_refused')
      using errcode = '25P01';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- G1. A landing's public details: typical hours and public road notes (#127 criterion 3, UX-04 B3).
--     Public text like `name` and `public_area_label`: no coordinate pair, no gate or lock code. The application
--     stores a blank value as NULL, never ''. Existing landings get NULL in both.
-- -----------------------------------------------------------------------------
alter table marketplace.landings
  add column typical_hours text,
  add column public_road_notes text,
  add constraint landings_typical_hours_chk check (
    typical_hours is null
    or (char_length(btrim(typical_hours)) between 1 and 120
        and char_length(typical_hours) <= 120
        and not marketplace.contains_sensitive_access_pattern(typical_hours))
  ),
  add constraint landings_public_road_notes_chk check (
    public_road_notes is null
    or (char_length(btrim(public_road_notes)) between 1 and 1000
        and char_length(public_road_notes) <= 1000
        and not marketplace.contains_sensitive_access_pattern(public_road_notes))
  );

comment on column marketplace.landings.typical_hours is
  'Public (Seen by haulers): when trucks are loaded, in the operator''s words. 1..120 characters, no coordinates or gate codes. Migration 26.';
comment on column marketplace.landings.public_road_notes is
  'Public (Seen by haulers): road conditions to the landing. 1..1000 characters, no coordinates or gate codes. Private access details live in landing_private_details. Migration 26.';

-- anon: SELECT on the two columns (landings_public still limits rows to active landings of active organizations).
-- authenticated: the table-level SELECT covers new columns; INSERT and UPDATE are column grants, so both are added.
grant select (typical_hours, public_road_notes) on marketplace.landings to anon;
grant insert (typical_hours, public_road_notes), update (typical_hours, public_road_notes) on marketplace.landings to authenticated;

-- -----------------------------------------------------------------------------
-- G2. A hauling business's private details (#125): business type, business phone, default contact route.
--     A separate table, like landing_private_details: hauler_profiles is readable by landing desks (a listed
--     profile, or one that sent them interest), so a private field cannot live there.
-- -----------------------------------------------------------------------------
create table marketplace.hauler_private_details (
  org_id                 uuid primary key references marketplace.hauler_profiles (org_id),
  business_kind          text check (business_kind in ('solo', 'company')),
  business_phone         text check (business_phone ~ '^\+[1-9][0-9]{6,14}$'),
  default_contact_route  text check (default_contact_route in ('in_app', 'phone', 'email')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint hauler_private_details_phone_route_chk check (default_contact_route is distinct from 'phone' or business_phone is not null)
);

comment on table marketplace.hauler_private_details is
  'Private to the hauling business (members read; owners and managers write): the business type chosen at setup (A2), a business phone and the default contact route. Never readable by a landing, anon or platform staff. Migration 26.';
comment on column marketplace.hauler_private_details.business_kind is
  'The setup choice "Just me" (solo) or "A hauling company" (company). A person who joins a hauling company by invitation stores none. Migration 26.';
comment on column marketplace.hauler_private_details.default_contact_route is
  'The route an inquiry starts with (expressions_of_interest.contact_preference); the hauler can change it on each inquiry. phone needs business_phone. Migration 26.';

create trigger set_updated_at before update on marketplace.hauler_private_details
  for each row execute function marketplace.tg_set_updated_at();

alter table marketplace.hauler_private_details enable row level security;
create policy hauler_private_details_read on marketplace.hauler_private_details for select to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver'])));
create policy hauler_private_details_insert on marketplace.hauler_private_details for insert to authenticated
  with check (org_id in (select marketplace.my_org_ids(array['owner', 'manager'])));
create policy hauler_private_details_update on marketplace.hauler_private_details for update to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner', 'manager'])))
  with check (org_id in (select marketplace.my_org_ids(array['owner', 'manager'])));

revoke all on marketplace.hauler_private_details from public, anon, authenticated, service_role;
grant select on marketplace.hauler_private_details to authenticated;
grant insert (org_id, business_kind, business_phone, default_contact_route) on marketplace.hauler_private_details to authenticated;
grant update (business_kind, business_phone, default_contact_route) on marketplace.hauler_private_details to authenticated;

-- -----------------------------------------------------------------------------
-- G3. The legal name: the organization's own active members and platform staff only (#187).
--     Row-level security decides rows, not columns, so the column grant is withdrawn and this function returns the
--     value to those readers; anyone else gets NULL. Counterparts (an inquiry or a targeted invitation), people who
--     see a public organization and anon read the rest of the row as before.
-- -----------------------------------------------------------------------------
revoke select (legal_name) on marketplace.organizations from authenticated;

create function marketplace.organization_legal_name(p_org uuid)
returns text language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select o.legal_name
  from marketplace.organizations o
  where o.id = p_org
    and (o.id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
         or marketplace.is_platform_admin())
$$;

comment on function marketplace.organization_legal_name(uuid) is
  'G3 (26): the organization''s legal name for its own active members and platform staff; NULL for anyone else. The column itself is not client-readable.';

revoke all on function marketplace.organization_legal_name(uuid) from public, anon, authenticated, service_role;
grant execute on function marketplace.organization_legal_name(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- G4. The interest form offers truck configurations only (06's 7c with one more condition: the unit's own type is a
--     truck). Every other line is 06's, verbatim.
-- -----------------------------------------------------------------------------
create or replace function marketplace.list_hauler_equipment_options(p_org_id uuid)
returns table (
  configuration_key text,
  label text,
  units_listed integer
)
language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_caps text[];
begin
  select a.capabilities into v_caps
  from marketplace.get_viewer_marketplace_access(p_org_id) a;

  if not ('interest.express' = any (coalesce(v_caps, array[]::text[]))) then
    raise exception 'Your role cannot act on inquiries for this business' using errcode = '42501';
  end if;

  return query
  select
    eu.configuration_key,
    case
      when et2.label is not null and et2.label <> et1.label then et1.label || ' + ' || et2.label
      else et1.label
    end as label,
    sum(eu.unit_count)::integer as units_listed
  from marketplace.equipment_units eu
  join marketplace.equipment_types et1 on et1.code = eu.equipment_code
  left join marketplace.equipment_types et2 on et2.code = eu.paired_trailer_code
  where eu.org_id = p_org_id
    and eu.is_active
    and eu.operational_status in ('available', 'committed')
    and et1.category = 'truck'
  group by eu.configuration_key, et1.label, et2.label
  order by sum(eu.unit_count) desc, label asc;
end
$$;

-- -----------------------------------------------------------------------------
-- G5. Report reasons: the three spec §8.18 reasons, their stored rows, and one standing report per person and target.
-- -----------------------------------------------------------------------------
do $$
declare v_name text;
begin
  select c.conname into v_name
  from pg_catalog.pg_constraint c
  where c.conrelid = 'marketplace.abuse_reports'::regclass and c.contype = 'c'
    and pg_catalog.pg_get_constraintdef(c.oid) like '%inaccurate_pay%';
  if v_name is null then
    raise exception 'migration 26: the abuse_reports reason check was not found' using errcode = '55000';
  end if;
  execute format('alter table marketplace.abuse_reports drop constraint %I', v_name);
end
$$;
alter table marketplace.abuse_reports
  add constraint abuse_reports_reason_check check (reason in ('inaccurate_pay', 'nonexistent_job', 'spam', 'impersonation',
                                                              'unsafe_disclosure', 'abuse', 'other',
                                                              'stale', 'suspicious_contact', 'wrong_equipment'));

-- The adapter stored these three as `other`, with "Reason: {label}." as the first line of the details
-- (normalized-mapping.ts before 26). Each gets its code back; the person's own words after the prefix are kept.
do $$
declare r record;
begin
  for r in
    with prefixed as (
      select a.id, m.code, m.prefix
      from marketplace.abuse_reports a
      join (values ('stale', 'Reason: No longer available.'),
                   ('suspicious_contact', 'Reason: Suspicious contact request.'),
                   ('wrong_equipment', 'Reason: Wrong equipment listed.')) as m(code, prefix)
        on a.details = m.prefix or a.details like m.prefix || E'\n%'
      where a.reason = 'other' and a.target_kind = 'job_posting'
    )
    update marketplace.abuse_reports a
    set reason = p.code,
        details = case when a.details = p.prefix then null
                       else nullif(substr(a.details, char_length(p.prefix) + 2), '') end
    from prefixed p
    where a.id = p.id
    returning a.id, p.code
  loop
    perform marketplace.write_audit(
      'abuse_report.reason_recoded', 'abuse_reports', r.id, null,
      'migration 26: the reason was stored as other with a Reason: prefix before the schema had its own code',
      jsonb_build_object('from', 'other', 'to', r.code));
  end loop;
end
$$;

-- One standing report per person and target. An earlier duplicate is kept as a record and closed; the one kept is
-- the report staff already picked up (reviewing), else the earliest.
do $$
declare r record;
begin
  for r in
    with ranked as (
      select a.id,
             first_value(a.id) over w as kept_id,
             row_number() over w as rn
      from marketplace.abuse_reports a
      where a.status in ('open', 'reviewing')
      window w as (partition by a.reporter_user_id, a.target_kind, a.target_id
                   order by (a.status = 'reviewing') desc, a.created_at, a.id)
    )
    update marketplace.abuse_reports a
    set status = 'dismissed',
        reviewed_at = now(),
        resolution_note = 'Closed as a duplicate of your other open report.'
    from ranked k
    where a.id = k.id and k.rn > 1
    returning a.id, k.kept_id
  loop
    perform marketplace.write_audit(
      'abuse_report.duplicate_closed', 'abuse_reports', r.id, null,
      'migration 26: one open or in-review report per person and target',
      jsonb_build_object('kept_report_id', r.kept_id));
  end loop;
end
$$;

create unique index abuse_reports_one_standing_uq
  on marketplace.abuse_reports (reporter_user_id, target_kind, target_id)
  where status in ('open', 'reviewing');

-- -----------------------------------------------------------------------------
-- G6. Availability integrity (#210).
--     a. Existing data first, with availability_guard suspended so no report time is refreshed (its "every edit is
--        a fresh self-report" rule would fabricate a confirmation, as 06 and 11 note). Each change is audited.
-- -----------------------------------------------------------------------------
alter table marketplace.availability_reports disable trigger availability_guard;
do $$
declare r record;
begin
  -- Earlier duplicate open reports of one type: the latest report stands; the others are withdrawn.
  for r in
    with ranked as (
      select a.id,
             first_value(a.id) over w as kept_id,
             row_number() over w as rn
      from marketplace.availability_reports a
      where a.withdrawn_at is null
      window w as (partition by a.org_id, a.equipment_code order by a.reported_at desc, a.id desc)
    )
    update marketplace.availability_reports a
    set withdrawn_at = now()
    from ranked k
    where a.id = k.id and k.rn > 1
    returning a.id, a.org_id, a.equipment_code, k.kept_id
  loop
    perform marketplace.write_audit(
      'availability.duplicate_withdrawn', 'availability_reports', r.id, r.org_id,
      'migration 26: a later open report of the same truck type stands',
      jsonb_build_object('equipment_code', r.equipment_code, 'kept_report_id', r.kept_id));
  end loop;

  -- An open report over the units listed of its type: brought down to them, or withdrawn when none is listed.
  for r in
    with listed as (
      select a.id, a.available_count as previous_count,
             coalesce((select sum(u.unit_count) from marketplace.equipment_units u
                       where u.org_id = a.org_id and u.equipment_code = a.equipment_code and u.is_active), 0)::integer as units_listed
      from marketplace.availability_reports a
      where a.withdrawn_at is null
    )
    update marketplace.availability_reports a
    set available_count = case when l.units_listed >= 1 then l.units_listed else a.available_count end,
        withdrawn_at = case when l.units_listed >= 1 then null else now() end
    from listed l
    where a.id = l.id and a.available_count > l.units_listed
    returning a.id, a.org_id, a.equipment_code, l.previous_count, l.units_listed
  loop
    perform marketplace.write_audit(
      'availability.fitted_to_list', 'availability_reports', r.id, r.org_id,
      'migration 26: an open report never claims more trucks of a type than the business lists',
      jsonb_build_object('equipment_code', r.equipment_code, 'previous_count', r.previous_count,
                         'units_listed', r.units_listed, 'withdrawn', r.units_listed < 1));
  end loop;
end
$$;
alter table marketplace.availability_reports enable trigger availability_guard;

-- b. At most one open report per business and truck type.
create unique index availability_reports_one_open_uq
  on marketplace.availability_reports (org_id, equipment_code)
  where withdrawn_at is null;

-- c. A report never claims more than is listed. Every write that leaves a report open takes the per-business, per-type
--    lock and then reads the list, so a concurrent lowering of the list is either committed and seen, or waits.
create function marketplace.tg_availability_cap()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_listed integer;
begin
  if new.withdrawn_at is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('marketplace.availability_cap:' || new.org_id::text || ':' || new.equipment_code, 0));
  select coalesce(sum(u.unit_count), 0)::integer into v_listed
  from marketplace.equipment_units u
  where u.org_id = new.org_id and u.equipment_code = new.equipment_code and u.is_active;
  if new.available_count > v_listed then
    raise exception 'This business lists % unit(s) of %, so at most % can be reported available', v_listed, new.equipment_code, v_listed
      using errcode = '23514', constraint = 'availability_reports_listed_units_cap',
            hint = 'List the trucks first (equipment_units), or report fewer.';
  end if;
  return new;
end
$$;

comment on function marketplace.tg_availability_cap() is
  'G6 (26): an open availability report claims at most the active equipment_units of its org and equipment_code. Takes the advisory lock hashtextextended(''marketplace.availability_cap:'' || org_id || '':'' || equipment_code, 0) before reading the list; tg_equipment_availability_fit takes the same lock. Serializes under READ COMMITTED (the adapter and PostgREST); SERIALIZABLE aborts one side instead; REPEATABLE READ is not covered (ARCHITECTURE.md section 4, migration 26).';

create trigger availability_cap before insert or update on marketplace.availability_reports
  for each row execute function marketplace.tg_availability_cap();

-- d. A lowered list brings the open report down. Lock order: the type's open reports, then the advisory lock. A
--    report being replaced holds its old row (the withdrawal) before it waits for the lock, so taking the rows first
--    here means the two paths never wait on each other in a cycle.
create function marketplace.tg_equipment_availability_fit()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_listed integer;
begin
  -- Only a row that was listed and now lists fewer units of its type (fewer, another type, inactive, deleted).
  if not old.is_active then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    if new.is_active and new.org_id = old.org_id and new.equipment_code = old.equipment_code and new.unit_count >= old.unit_count then
      return null;
    end if;
  end if;

  perform 1 from marketplace.availability_reports a
  where a.org_id = old.org_id and a.equipment_code = old.equipment_code and a.withdrawn_at is null
  for update;
  perform pg_advisory_xact_lock(hashtextextended('marketplace.availability_cap:' || old.org_id::text || ':' || old.equipment_code, 0));

  select coalesce(sum(u.unit_count), 0)::integer into v_listed
  from marketplace.equipment_units u
  where u.org_id = old.org_id and u.equipment_code = old.equipment_code and u.is_active;

  if v_listed >= 1 then
    update marketplace.availability_reports
    set available_count = v_listed
    where org_id = old.org_id and equipment_code = old.equipment_code and withdrawn_at is null and available_count > v_listed;
  else
    update marketplace.availability_reports
    set withdrawn_at = now()
    where org_id = old.org_id and equipment_code = old.equipment_code and withdrawn_at is null;
  end if;
  return null;
end
$$;

comment on function marketplace.tg_equipment_availability_fit() is
  'G6 (26): after a listed equipment_units row lists fewer units of its type, the business''s open report of that type is brought down to the units still listed, or withdrawn when none is left (the adapter''s own rule, now held by the store). Locks the open reports, then the advisory lock of tg_availability_cap.';

create trigger equipment_availability_fit after update or delete on marketplace.equipment_units
  for each row execute function marketplace.tg_equipment_availability_fit();

-- Trigger functions run without EXECUTE; nobody may call them directly.
revoke all on function marketplace.tg_availability_cap(), marketplace.tg_equipment_availability_fit()
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Record this migration.
-- -----------------------------------------------------------------------------
insert into marketplace.schema_migrations (version, name) values ('26', '26_v2_product_gap_batch');
