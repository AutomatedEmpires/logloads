-- =============================================================================
-- LogLoads normalized-v2 — 06 V2 contract alignment (schema, RLS, triggers, RPCs)
--
-- NON-ACTIVE PROTOTYPE MIGRATION LAYER. Do not run against production.
-- Designed to apply cleanly on top of:
--   01_schema.sql -> 02_access.sql -> 03_entitlements.sql
-- without disrupting Claude Agent 1's baseline PostgreSQL 17 CI test run.
--
-- Incorporates the three binding Founder Decisions (2026-11-01):
--   * V2-DEC-01: Fixed 0.10-degree server-side quantization for public landing
--                coordinates (`round(coord::numeric, 1)`), with zero session
--                precision overrides and strict coordinate bounds validation.
--   * V2-DEC-02: Mandatory compensation on all active V2 postings (either a
--                stated positive rate `pay_amount_cents > 0` with a defined
--                `MarketplacePayUnit`, or `pay_unit = 'negotiable'` with
--                `pay_amount_cents IS NULL` and a `>= 3` char trimmed `pay_note`).
--                Incomplete drafts may be saved only with `status = 'draft'`.
--                No session variable (`app.allow_unquoted_active_jobs`) can bypass
--                this rule. Historical unquoted records are isolated to a
--                privileged, audited migration RPC (`admin_import_legacy_job_posting`).
--   * V2-DEC-03: Explicit initial availability attestation (`p_attest_available = true`)
--                is required to publish an active V2 job (`publish_job_posting`).
--                Absent (`NULL`) or `false` attestation is rejected. Drafts,
--                previews, and content edits never stamp or refresh
--                `last_confirmed_at`. Direct table INSERT/UPDATE cannot bypass
--                attestation or spoof confirmation timestamps.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Known Gap 1 & V2-DEC-02 / V2-DEC-03 table columns and constraints on
--    `marketplace.job_postings` and `marketplace.landings`.
-- -----------------------------------------------------------------------------

alter table marketplace.job_postings
  alter column trucks_requested drop not null,
  alter column trucks_requested drop default;

alter table marketplace.job_postings
  add column if not exists trucks_per_day integer
    check (trucks_per_day between 1 and 9999),
  add column if not exists duration_days integer
    check (duration_days between 1 and 365),
  add column if not exists est_loads_per_truck_per_day numeric(4, 1)
    check (est_loads_per_truck_per_day >= 0.5 and est_loads_per_truck_per_day <= 24.0),
  add column if not exists schedule_note text
    check (char_length(schedule_note) <= 240
           and not marketplace.contains_sensitive_access_pattern(schedule_note)),
  add column if not exists public_access_requirements text[] not null default '{}',
  add column if not exists last_confirmed_by uuid
    references marketplace.app_users (id),
  add column if not exists is_legacy_import boolean not null default false;

-- Internal ungranted ledger tables backing V2-DEC-02 and V2-DEC-03 so neither
-- session variables (`set_config`) nor direct table writes by `authenticated`,
-- `anon`, or `service_role` can spoof publication attestation or legacy imports.
create table if not exists marketplace.job_publication_attestations (
  job_id           uuid primary key,
  org_id           uuid not null references marketplace.organizations (id) on delete cascade,
  attested_by      uuid not null references marketplace.app_users (id),
  attested_at      timestamptz not null default clock_timestamp(),
  reconfirmed_at   timestamptz not null default clock_timestamp(),
  reconfirmed_by   uuid not null references marketplace.app_users (id),
  confirmation_seq bigint not null default 1 check (confirmation_seq >= 1)
);
alter table marketplace.job_publication_attestations enable row level security;

create table if not exists marketplace.legacy_job_imports (
  job_id       uuid primary key,
  org_id       uuid not null references marketplace.organizations (id) on delete cascade,
  imported_by  uuid references marketplace.app_users (id),
  reason       text not null check (char_length(btrim(reason)) between 5 and 500),
  imported_at  timestamptz not null default clock_timestamp()
);
alter table marketplace.legacy_job_imports enable row level security;

-- Pre-existing non-draft rows predate V2-DEC-03: nobody attested their availability. They are
-- recorded as audited legacy imports and keep exactly the confirmation they had (often none).
-- Confirmation is never fabricated from published_at/created_at.
insert into marketplace.legacy_job_imports (job_id, org_id, imported_by, reason)
select j.id, j.org_id, null, 'Pre-V2 baseline row: availability never explicitly attested'
from marketplace.job_postings j
where j.status <> 'draft'
  and not j.is_legacy_import
on conflict (job_id) do nothing;

update marketplace.job_postings j
set is_legacy_import = true
where j.status <> 'draft'
  and not j.is_legacy_import;

-- Drop the baseline anonymous check constraint on `job_postings` that allowed
-- unquoted active jobs (`pay_unit is null and pay_amount_cents is null`) on any status,
-- and replace it with explicit V2-DEC-02 and V2-DEC-03 constraints.
do $$
declare
  v_con record;
begin
  for v_con in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'marketplace'
      and t.relname = 'job_postings'
      and c.contype = 'c'
      and (
        pg_get_constraintdef(c.oid) ilike '%pay_unit is null and pay_amount_cents is null%'
        or pg_get_constraintdef(c.oid) ilike '%status = ''draft'' or published_at is not null%'
      )
  loop
    execute format('alter table marketplace.job_postings drop constraint %I', v_con.conname);
  end loop;
end
$$;

alter table marketplace.job_postings
  drop constraint if exists job_postings_truck_demand_chk,
  add constraint job_postings_truck_demand_chk check (
    (trucks_requested is not null or trucks_per_day is not null)
    and (trucks_per_day is null or trucks_requested is null or trucks_per_day <= trucks_requested)
  ),
  drop constraint if exists job_postings_duration_start_chk,
  add constraint job_postings_duration_start_chk check (
    duration_days is null or work_starts_on is not null
  ),
  drop constraint if exists job_postings_access_reqs_safe_chk,
  add constraint job_postings_access_reqs_safe_chk check (
    cardinality(public_access_requirements) <= 20
    and not marketplace.contains_sensitive_access_pattern(array_to_string(public_access_requirements, ' '))
  ),
  -- V2-DEC-02:
  --   * Fixed-rate pay units require `pay_amount_cents > 0`.
  --   * `'negotiable'` requires `pay_amount_cents is null` and `char_length(btrim(pay_note)) >= 3`.
  --   * Omitting both (`pay_unit is null and pay_amount_cents is null`) is allowed ONLY
  --     on non-published drafts (`status = 'draft'`) or audited legacy imports (`is_legacy_import = true`).
  drop constraint if exists job_postings_compensation_chk,
  add constraint job_postings_compensation_chk check (
    (pay_unit is null and pay_amount_cents is null and (status = 'draft' or is_legacy_import))
    or (
      pay_unit = 'negotiable'
      and pay_amount_cents is null
      and pay_note is not null
      and char_length(btrim(pay_note)) >= 3
    )
    or (
      pay_unit is not null
      and pay_unit <> 'negotiable'
      and pay_amount_cents is not null
      and pay_amount_cents > 0
    )
  ),
  -- V2-DEC-03:
  --   * Drafts (`status = 'draft'`) must never have `published_at`, `last_confirmed_at`, or `last_confirmed_by`.
  --   * Published V2 jobs (`status <> 'draft' and not is_legacy_import`) must always have
  --     `published_at`, `last_confirmed_at`, and `last_confirmed_by` populated via explicit attestation.
  --   * Legacy imported jobs (`is_legacy_import = true`) preserve `last_confirmed_at is null` when never confirmed.
  drop constraint if exists job_postings_attestation_chk,
  add constraint job_postings_attestation_chk check (
    (status = 'draft' and published_at is null and last_confirmed_at is null and last_confirmed_by is null)
    or (
      status <> 'draft'
      and published_at is not null
      and (
        is_legacy_import
        or (last_confirmed_at is not null and last_confirmed_by is not null)
      )
    )
  );

-- Allow landings to be created with a public area label when no publishable map
-- point exists (`MarketplaceJobCardView.origin.approximatePoint` is nullable).
alter table marketplace.landings
  alter column public_point drop not null;

-- -----------------------------------------------------------------------------
-- 2. Known Gap 2: Hauler equipment configuration options (`equipment_units`)
--    and persisted per-inquiry offered equipment lines
--    (`expression_of_interest_equipment`).
-- -----------------------------------------------------------------------------

alter table marketplace.equipment_units
  add column if not exists paired_trailer_code text
    references marketplace.equipment_types (code),
  add column if not exists operational_status text not null default 'available'
    check (operational_status in ('available', 'committed', 'maintenance', 'inactive')),
  add column if not exists unit_count integer not null default 1
    check (unit_count between 1 and 500),
  add column if not exists configuration_key text generated always as (
    case
      when paired_trailer_code is not null then equipment_code || '|' || paired_trailer_code
      else equipment_code
    end
  ) stored;

create index if not exists equipment_units_org_config_idx
  on marketplace.equipment_units (org_id, configuration_key)
  where is_active and operational_status in ('available', 'committed');

create table if not exists marketplace.expression_of_interest_equipment (
  interest_id        uuid not null references marketplace.expressions_of_interest (id) on delete cascade,
  configuration_key  text not null check (char_length(btrim(configuration_key)) between 1 and 200),
  label              text not null check (char_length(btrim(label)) between 1 and 160),
  unit_count         integer not null check (unit_count between 1 and 500),
  sort_order         smallint not null default 0 check (sort_order between 0 and 19),
  primary key (interest_id, configuration_key)
);
create index if not exists eoi_equipment_interest_idx
  on marketplace.expression_of_interest_equipment (interest_id, sort_order);

alter table marketplace.expression_of_interest_equipment enable row level security;

drop index if exists marketplace.expressions_of_interest_live_uq;
create unique index if not exists expressions_of_interest_job_hauler_uq
  on marketplace.expressions_of_interest (job_id, hauler_org_id);

alter table marketplace.interest_messages
  drop constraint if exists interest_messages_body_check,
  add constraint interest_messages_body_check
    check (char_length(btrim(body)) between 1 and 2000);

create or replace function marketplace.tg_eoi_equipment_consistency()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_interest_id uuid := coalesce(new.interest_id, old.interest_id);
  v_trucks      integer;
  v_line_count  integer;
  v_unit_sum    integer;
begin
  select trucks_offered into v_trucks
  from marketplace.expressions_of_interest
  where id = v_interest_id;

  if not found then
    return null;
  end if;

  select count(*), coalesce(sum(unit_count), 0)
  into v_line_count, v_unit_sum
  from marketplace.expression_of_interest_equipment
  where interest_id = v_interest_id;

  if v_line_count > 20 then
    raise exception 'an inquiry may list at most 20 equipment configurations (found %)', v_line_count
      using errcode = '23514';
  end if;

  if v_line_count > 0 and v_unit_sum <> v_trucks then
    raise exception 'trucks_offered (%) must equal the sum of trucks listed per equipment configuration (%)',
      v_trucks, v_unit_sum
      using errcode = '23514';
  end if;

  return null;
end
$$;

drop trigger if exists eoi_equipment_consistency on marketplace.expression_of_interest_equipment;
create constraint trigger eoi_equipment_consistency
  after insert or update or delete on marketplace.expression_of_interest_equipment
  deferrable initially deferred
  for each row execute function marketplace.tg_eoi_equipment_consistency();

-- -----------------------------------------------------------------------------
-- 3. DECISION V2-DEC-01 — PUBLIC COORDINATE PRIVACY (Fixed 0.10-Degree Grid)
--
--    * Quantizes all public coordinates to the nearest 0.10-degree increment:
--        47.654°  -> 47.7°
--        -117.457° -> -117.5°
--    * Every 0.10° increment is an exact multiple of 0.02° (`5 * 0.02°`), so
--      `Math.round(coord * 50) / 50 === coord` holds for all V2 frontend consumers.
--    * Removes `app.public_coord_grid_degrees` completely: no session setting
--      can alter public coordinate quantization.
--    * Validates geographic bounds (`lat in [-90, 90]`, `lng in [-180, 180]`)
--      and rejects NaN/Infinity or out-of-range coordinates with SQLSTATE 22023.
-- -----------------------------------------------------------------------------

create or replace function marketplace.quantize_public_coordinate(
  p_value double precision,
  p_min double precision,
  p_max double precision,
  p_axis text
) returns double precision
language plpgsql immutable
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_value is null then
    return null;
  end if;
  if p_value in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
     or p_value < p_min
     or p_value > p_max then
    raise exception '% coordinate (%) is outside valid bounds [%, %]', p_axis, p_value, p_min, p_max
      using errcode = '22023';
  end if;
  return round(p_value::numeric, 1)::double precision;
end
$$;

create or replace function marketplace.make_public_point(
  p_lng double precision,
  p_lat double precision
) returns extensions.geography
language plpgsql immutable
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_lng double precision;
  v_lat double precision;
begin
  if p_lng is null and p_lat is null then
    return null;
  end if;
  if p_lng is null or p_lat is null then
    raise exception 'both longitude and latitude are required when specifying a point'
      using errcode = '22023';
  end if;
  v_lng := marketplace.quantize_public_coordinate(p_lng, -180.0, 180.0, 'longitude');
  v_lat := marketplace.quantize_public_coordinate(p_lat, -90.0, 90.0, 'latitude');
  return extensions.st_setsrid(extensions.st_makepoint(v_lng, v_lat), 4326)::extensions.geography;
end
$$;

create or replace function marketplace.approximate_point(p extensions.geography)
returns extensions.geography language plpgsql immutable
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_lng double precision;
  v_lat double precision;
begin
  if p is null then
    return null;
  end if;
  v_lng := marketplace.quantize_public_coordinate(
    extensions.st_x(p::extensions.geometry), -180.0, 180.0, 'longitude'
  );
  v_lat := marketplace.quantize_public_coordinate(
    extensions.st_y(p::extensions.geometry), -90.0, 90.0, 'latitude'
  );
  return extensions.st_setsrid(extensions.st_makepoint(v_lng, v_lat), 4326)::extensions.geography;
end
$$;

-- Re-snap any existing points to the fixed 0.10-degree grid and add a CHECK
-- constraint on `landings.public_point` so an unquantized coordinate can never
-- be stored on `marketplace.landings`.
update marketplace.landings
set public_point = marketplace.approximate_point(public_point)
where public_point is not null;

update marketplace.hauler_profiles
set service_center = marketplace.approximate_point(service_center)
where service_center is not null;

update marketplace.availability_reports
set area_center = marketplace.approximate_point(area_center)
where area_center is not null;

update marketplace.job_boosts
set center_point = marketplace.approximate_point(center_point)
where center_point is not null;

alter table marketplace.landings
  drop constraint if exists landings_public_point_quantized_chk,
  add constraint landings_public_point_quantized_chk check (
    public_point is null
    or (
      extensions.st_y(public_point::extensions.geometry) between -90.0 and 90.0
      and extensions.st_x(public_point::extensions.geometry) between -180.0 and 180.0
      and abs(
        extensions.st_y(public_point::extensions.geometry)
        - round(extensions.st_y(public_point::extensions.geometry)::numeric, 1)::double precision
      ) < 1e-9
      and abs(
        extensions.st_x(public_point::extensions.geometry)
        - round(extensions.st_x(public_point::extensions.geometry)::numeric, 1)::double precision
      ) < 1e-9
    )
  );

-- -----------------------------------------------------------------------------
-- 4. Known Gap 4 & Seat/Workspace Separation
-- -----------------------------------------------------------------------------

alter table marketplace.organization_memberships
  drop constraint if exists organization_memberships_check1;

create or replace function marketplace.tg_membership_guard()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_actor        uuid := marketplace.current_user_id();
  v_plan         marketplace.subscription_plans;
  v_has_landings boolean;
  v_count        integer;
begin
  if new.role = 'driver' then
    new.landing_workspace_seat := false;
  elsif new.role = 'owner' then
    v_plan := marketplace.org_entitled_plan(new.org_id);
    select exists (select 1 from marketplace.landings l where l.org_id = new.org_id)
    into v_has_landings;
    if v_plan.id is not null or v_has_landings or not exists (
      select 1 from marketplace.hauler_profiles h where h.org_id = new.org_id
    ) then
      new.landing_workspace_seat := coalesce(new.landing_workspace_seat, true);
      if v_plan.id is not null or v_has_landings then
        new.landing_workspace_seat := true;
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id or new.user_id <> old.user_id then
      raise exception 'membership identity is immutable' using errcode = '42501';
    end if;
    if old.status = 'invited' and new.status = 'active' and v_actor is distinct from new.user_id and v_actor is not null then
      raise exception 'only the invited person can accept a membership' using errcode = '42501';
    end if;
    if v_actor = old.user_id and not marketplace.has_org_role(old.org_id, array['owner']) then
      if new.role <> old.role
         or new.landing_workspace_seat <> old.landing_workspace_seat
         or not ((old.status = 'invited' and new.status = 'active') or new.status = 'removed') then
        raise exception 'members may only accept an invitation or leave' using errcode = '42501';
      end if;
    end if;
    if old.role = 'owner' and old.status = 'active' and (new.role <> 'owner' or new.status <> 'active')
       and not exists (
         select 1 from marketplace.organization_memberships m
         where m.org_id = old.org_id and m.role = 'owner' and m.status = 'active' and m.id <> old.id) then
      raise exception 'an organization needs at least one active owner' using errcode = '23514';
    end if;
    if new.status = 'removed' and old.status <> 'removed' then
      new.ended_at := now();
    end if;
  end if;

  if new.status in ('invited', 'active')
     and new.landing_workspace_seat
     and (tg_op = 'INSERT' or old.status not in ('invited', 'active') or not old.landing_workspace_seat) then
    perform 1 from marketplace.organizations o where o.id = new.org_id for update;
    v_plan := marketplace.org_entitled_plan(new.org_id);
    if v_plan.id is not null then
      select count(*) into v_count
      from marketplace.organization_memberships m
      where m.org_id = new.org_id
        and m.status in ('invited', 'active')
        and m.landing_workspace_seat
        and m.id <> new.id;
      if v_count >= v_plan.max_team_members then
        raise exception 'plan % allows % team member(s) in the Landing Operator workspace', v_plan.name, v_plan.max_team_members
          using errcode = '23514',
                hint = 'Remove or convert a landing seat to fleet-only (landing_workspace_seat = false), or upgrade your subscription.';
      end if;
    end if;
  end if;
  return new;
end
$$;

create or replace function marketplace.create_organization(
  p_display_name text, p_slug text, p_home_state char(2) default null, p_enable_hauler boolean default false
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_user uuid := marketplace.current_user_id();
  v_org  uuid;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  insert into marketplace.organizations (display_name, slug, home_state, created_by)
  values (p_display_name, p_slug, p_home_state, v_user)
  returning id into v_org;

  if p_enable_hauler then
    insert into marketplace.hauler_profiles (org_id, is_public) values (v_org, false);
  end if;

  insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status, invited_by)
  values (v_org, v_user, 'owner', not p_enable_hauler, 'active', v_user);

  perform marketplace.write_audit('organization.created', 'organizations', v_org, v_org);
  return v_org;
end
$$;

create or replace function marketplace.tg_ensure_owner_landing_seat()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
begin
  update marketplace.organization_memberships
  set landing_workspace_seat = true
  where org_id = new.org_id
    and role = 'owner'
    and status in ('invited', 'active')
    and not landing_workspace_seat;
  return new;
end
$$;

drop trigger if exists ensure_owner_landing_seat_on_sub on marketplace.organization_subscriptions;
create trigger ensure_owner_landing_seat_on_sub
  before insert or update on marketplace.organization_subscriptions
  for each row execute function marketplace.tg_ensure_owner_landing_seat();

-- -----------------------------------------------------------------------------
-- 5. Job lifecycle, compensation, & attestation triggers (`V2-DEC-02`, `V2-DEC-03`):
--    * Distinguishes `created_at`, `updated_at` (`last_modified_at`),
--      `last_confirmed_at`, and `expires_at`.
--    * Blocks any session-variable bypass (`app.allow_unquoted_active_jobs` is gone).
--    * Requires every active V2 posting to have a verified attestation row in
--      `marketplace.job_publication_attestations` created by `publish_job_posting`
--      with `p_attest_available = true`.
--    * Preserves `last_confirmed_at` untouched across ordinary content edits, and
--      preserves `updated_at` untouched when only `last_confirmed_at` is advanced
--      by `reconfirm_job_posting`.
-- -----------------------------------------------------------------------------

create or replace function marketplace.tg_set_updated_at()
returns trigger language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_table_schema = 'marketplace' and tg_table_name = 'job_postings' then
    -- If only `last_confirmed_at` / `last_confirmed_by` changed (an explicit reconfirmation),
    -- preserve `updated_at` (`last_modified_at`) so confirmation and content modification
    -- timestamps remain distinct (`V2-DEC-03`).
    if (
      new.title, new.description, new.product, new.destination_label,
      new.est_one_way_miles, new.est_daily_loads, new.est_loads_per_truck_per_day, new.est_tons_per_load,
      new.pay_amount_cents, new.pay_unit, new.pay_note, new.public_road_notes,
      new.schedule_note, new.public_access_requirements,
      new.trucks_requested, new.trucks_per_day, new.work_starts_on, new.duration_days, new.work_ends_on,
      new.status, new.expires_at
    ) is not distinct from (
      old.title, old.description, old.product, old.destination_label,
      old.est_one_way_miles, old.est_daily_loads, old.est_loads_per_truck_per_day, old.est_tons_per_load,
      old.pay_amount_cents, old.pay_unit, old.pay_note, old.public_road_notes,
      old.schedule_note, old.public_access_requirements,
      old.trucks_requested, old.trucks_per_day, old.work_starts_on, old.duration_days, old.work_ends_on,
      old.status, old.expires_at
    ) and new.last_confirmed_at is distinct from old.last_confirmed_at then
      new.updated_at := old.updated_at;
      return new;
    end if;
    new.updated_at := clock_timestamp();
    return new;
  end if;

  new.updated_at := now();
  return new;
end
$$;

create or replace function marketplace.tg_job_guard()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_plan     marketplace.subscription_plans;
  v_members  integer;
  v_landings integer;
  v_att      marketplace.job_publication_attestations;
begin
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then
    raise exception 'job postings cannot move between organizations' using errcode = '42501';
  end if;

  -- Compute `work_ends_on` from `work_starts_on` + `duration_days` when `duration_days` is provided
  -- and `work_ends_on` was omitted (`draftEndsOn` in `marketplace-job-draft.ts`).
  if new.work_starts_on is not null and new.duration_days is not null and new.work_ends_on is null then
    new.work_ends_on := new.work_starts_on + (new.duration_days - 1);
  end if;

  -- Verify `is_legacy_import` cannot be forged without an entry in `marketplace.legacy_job_imports`.
  if new.is_legacy_import then
    if not exists (
      select 1 from marketplace.legacy_job_imports li
      where li.job_id = new.id and li.org_id = new.org_id
    ) then
      raise exception 'is_legacy_import can only be set by the audited admin_import_legacy_job_posting migration path'
        using errcode = '42501';
    end if;
  end if;

  -- A legacy (unattested, possibly unquoted) posting cannot be put back into service directly:
  -- re-activation would bypass V2-DEC-02 and V2-DEC-03 for an ordinary landing user.
  if new.is_legacy_import and tg_op = 'UPDATE' and new.status = 'active' and old.status <> 'active' then
    raise exception 'Legacy job postings cannot be re-activated; publish a new posting with stated pay and an availability attestation'
      using errcode = '23514';
  end if;

  -- Draft semantics (`V2-DEC-02` & `V2-DEC-03`):
  --   * Drafts never have `published_at`, `last_confirmed_at`, or `last_confirmed_by`.
  --   * Once published (`old.status <> 'draft'`), a job cannot be reverted back to `'draft'`.
  if new.status = 'draft' then
    if tg_op = 'UPDATE' and old.status <> 'draft' then
      raise exception 'published job postings cannot revert to draft status; pause or close the posting instead'
        using errcode = '23514';
    end if;
    new.published_at := null;
    new.last_confirmed_at := null;
    new.last_confirmed_by := null;
    return new;
  end if;

  -- Active / published compensation enforcement (`V2-DEC-02`):
  --   No session variable (`app.allow_unquoted_active_jobs`) can bypass this check.
  if not new.is_legacy_import or new.status = 'active' and tg_op = 'UPDATE' and not old.is_legacy_import then
    if new.pay_unit is null then
      raise exception 'Published job postings must state a positive pay rate with a pay basis or Negotiable with an explanatory note'
        using errcode = '23514',
              hint = 'Provide pay_amount_cents > 0 with a pay_unit, or set pay_unit = ''negotiable'' with a 3+ character pay_note.';
    elsif new.pay_unit = 'negotiable' then
      if new.pay_amount_cents is not null then
        raise exception 'Negotiable pay cannot be paired with a fixed pay_amount_cents'
          using errcode = '23514';
      end if;
      if new.pay_note is null or char_length(btrim(new.pay_note)) < 3 then
        raise exception 'Negotiable pay requires a meaningful explanatory pay_note (at least 3 non-whitespace characters)'
          using errcode = '23514';
      end if;
    else
      if new.pay_amount_cents is null or new.pay_amount_cents <= 0 then
        raise exception 'Pay unit % requires a positive pay_amount_cents (> 0)', new.pay_unit
          using errcode = '23514';
      end if;
    end if;
  end if;

  -- Explicit availability attestation enforcement (`V2-DEC-03`). The ledger is read for legacy rows
  -- too, so an explicit reconfirmation of a legacy posting is reflected on the row.
  select * into v_att
  from marketplace.job_publication_attestations a
  where a.job_id = new.id and a.org_id = new.org_id;

  if not new.is_legacy_import then
    if v_att.job_id is null then
      raise exception 'Active job postings require explicit availability attestation via marketplace.publish_job_posting (p_attest_available = true)'
        using errcode = '23514';
    end if;
  end if;

  if new.status = 'active' and (tg_op = 'INSERT' or old.status <> 'active') then
    if not exists (select 1 from marketplace.landings l where l.id = new.landing_id and l.status = 'active') then
      raise exception 'job postings can only be active at an active landing' using errcode = '23514';
    end if;
    v_plan := marketplace.org_entitled_plan(new.org_id);
    if not exists (select 1 from marketplace.organizations o where o.id = new.org_id and o.status = 'active')
       or v_plan.id is null then
      raise exception 'an active landing subscription is required to publish' using errcode = '23514';
    end if;
    select count(*) into v_members
    from marketplace.organization_memberships m
    where m.org_id = new.org_id and m.status in ('invited', 'active') and m.landing_workspace_seat;
    if v_members > v_plan.max_team_members then
      raise exception 'organization has % paid landing seats which exceeds plan % limit of %; resolve seat conflict before publishing',
        v_members, v_plan.name, v_plan.max_team_members
        using errcode = '23514', hint = 'Remove or convert excess landing seats to fleet-only, or upgrade your subscription.';
    end if;
    if v_plan.max_active_landings is not null then
      select count(*) into v_landings
      from marketplace.landings l
      where l.org_id = new.org_id and l.status = 'active';
      if v_landings > v_plan.max_active_landings then
        raise exception 'organization has % active landings which exceeds plan % limit of %; resolve landing conflict before publishing',
          v_landings, v_plan.name, v_plan.max_active_landings
          using errcode = '23514', hint = 'Deactivate excess landings or upgrade your subscription.';
      end if;
    end if;

    if not new.is_legacy_import then
      if tg_op = 'INSERT' or old.status = 'draft' then
        new.published_at := v_att.attested_at;
        new.last_confirmed_at := v_att.reconfirmed_at;
        new.last_confirmed_by := v_att.reconfirmed_by;
      else
        new.published_at := old.published_at;
        new.last_confirmed_at := v_att.reconfirmed_at;
        new.last_confirmed_by := v_att.reconfirmed_by;
      end if;
    else
      new.published_at := coalesce(new.published_at, clock_timestamp());
    end if;
  elsif tg_op = 'UPDATE' then
    -- Preserve `published_at`; and sync `last_confirmed_at` / `last_confirmed_by` strictly
    -- from the ungranted `job_publication_attestations` ledger so ordinary edits never
    -- refresh confirmation and direct UPDATEs cannot spoof `last_confirmed_at`.
    new.published_at := old.published_at;
    if not new.is_legacy_import or v_att.job_id is not null then
      new.last_confirmed_at := v_att.reconfirmed_at;
      new.last_confirmed_by := v_att.reconfirmed_by;
    else
      new.last_confirmed_at := old.last_confirmed_at;
      new.last_confirmed_by := old.last_confirmed_by;
    end if;
  end if;

  return new;
end
$$;

-- When a job posting leaves `status = 'active'` (`closed`, `filled`, `expired`, `paused`),
-- end any active boost on that job so inactive jobs do not run boosts. 'ended' is the job_boosts
-- terminal status ('expired' is not allowed), and the purchased window is left intact: job_boosts
-- requires ends_at = starts_at + duration_days * 24h, and sponsorship/exclusion key on status = 'active'.
create or replace function marketplace.tg_job_after_status()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
begin
  if old.status = 'active' and new.status in ('paused', 'filled', 'closed', 'expired') then
    update marketplace.job_boosts
    set status = 'ended'
    where job_id = new.id and status = 'active';
  end if;
  return null;
end
$$;

drop trigger if exists job_after_status on marketplace.job_postings;
create trigger job_after_status
  after update of status on marketplace.job_postings
  for each row execute function marketplace.tg_job_after_status();

-- -----------------------------------------------------------------------------
-- 6. RLS & helper updates for Known Gap 4, closed/declined inquiries, and
--    per-inquiry equipment lines (`expression_of_interest_equipment`).
-- -----------------------------------------------------------------------------

create or replace function marketplace.can_access_interest(p_interest uuid, p_write_side text default null)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select exists (
    select 1
    from marketplace.expressions_of_interest e
    where e.id = p_interest
      and (
        (p_write_side is null and (
           e.hauler_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
           or e.job_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true))
           or marketplace.is_platform_admin()
        ))
        or (p_write_side = 'hauler' and e.status not in ('withdrawn', 'declined')
            and e.hauler_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver'])))
        or (p_write_side = 'landing' and e.status not in ('withdrawn', 'declined')
            and e.job_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true)))
      )
  )
$$;

drop policy if exists interests_hauler_insert on marketplace.expressions_of_interest;
create policy interests_hauler_insert on marketplace.expressions_of_interest for insert to authenticated
  with check (hauler_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
              and submitted_by = (select marketplace.current_user_id())
              and status = 'submitted'
              and exists (select 1 from marketplace.hauler_profiles h
                          join marketplace.organizations o on o.id = h.org_id and o.status = 'active'
                          where h.org_id = expressions_of_interest.hauler_org_id)
              and marketplace.job_is_publicly_visible(job_id));

drop policy if exists interests_hauler_edit on marketplace.expressions_of_interest;
create policy interests_hauler_edit on marketplace.expressions_of_interest for update to authenticated
  using (hauler_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
         and status not in ('withdrawn', 'declined'))
  with check (hauler_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
              and status not in ('withdrawn', 'declined'));

-- The "landing desk with a live inquiry from this hauler" clause lives in a SECURITY DEFINER helper.
-- Written inline it made hauler_profiles_read query expressions_of_interest while
-- interests_hauler_insert queries hauler_profiles, and PostgreSQL rejected every direct inquiry insert
-- with 42P17 (infinite recursion detected in policy for relation "expressions_of_interest").
-- Same access rule; the helper reads expressions_of_interest without re-entering its policies.
create or replace function marketplace.has_live_inquiry_from_hauler(p_hauler_org uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select exists (
    select 1 from marketplace.expressions_of_interest e
    where e.hauler_org_id = p_hauler_org
      and e.status <> 'withdrawn'
      and e.job_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true))
  )
$$;

drop policy if exists hauler_profiles_read on marketplace.hauler_profiles;
create policy hauler_profiles_read on marketplace.hauler_profiles for select to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
         or (is_public and marketplace.current_user_has_landing_access())
         or marketplace.has_live_inquiry_from_hauler(org_id)
         or marketplace.is_platform_admin());

drop policy if exists eoi_equipment_read on marketplace.expression_of_interest_equipment;
create policy eoi_equipment_read on marketplace.expression_of_interest_equipment for select to authenticated
  using (marketplace.can_access_interest(interest_id, null));

drop policy if exists eoi_equipment_write on marketplace.expression_of_interest_equipment;
create policy eoi_equipment_write on marketplace.expression_of_interest_equipment for all to authenticated
  using (marketplace.can_access_interest(interest_id, 'hauler'))
  with check (marketplace.can_access_interest(interest_id, 'hauler'));

-- -----------------------------------------------------------------------------
-- 7. Complete V2 Port RPCs (`MarketplaceV2Port` in `apps/web/lib/marketplace-v2/port.ts`)
-- -----------------------------------------------------------------------------

-- 7a. `viewerAccess(viewer)`
create or replace function marketplace.get_viewer_marketplace_access(p_org_id uuid)
returns table (
  organization_id uuid,
  organization_name text,
  role text,
  landing_workspace_seat boolean,
  hauler_profile boolean,
  capabilities text[]
)
language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_user         uuid := marketplace.current_user_id();
  v_org          marketplace.organizations;
  v_member       marketplace.organization_memberships;
  v_has_hauler   boolean;
  v_has_landing  boolean;
  v_landing_seat boolean;
  v_caps         text[] := array[]::text[];
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_org
  from marketplace.organizations o
  where o.id = p_org_id and o.status = 'active';

  select * into v_member
  from marketplace.organization_memberships m
  where m.org_id = p_org_id and m.user_id = v_user and m.status = 'active';

  if v_org.id is null or v_member.id is null then
    raise exception 'Organization operations are not available' using errcode = '42501';
  end if;

  select exists (select 1 from marketplace.hauler_profiles h where h.org_id = p_org_id)
  into v_has_hauler;

  select (marketplace.org_entitled_plan(p_org_id)).id is not null
         or exists (select 1 from marketplace.landings l where l.org_id = p_org_id)
         or not v_has_hauler
  into v_has_landing;

  v_landing_seat := v_member.landing_workspace_seat and v_member.role <> 'driver' and v_has_landing;

  if v_landing_seat and v_member.role in ('owner', 'manager', 'staff') then
    v_caps := array_append(v_caps, 'job.publish');
  end if;
  if v_landing_seat and v_member.role in ('owner', 'manager') then
    v_caps := array_append(v_caps, 'landing.manage');
  end if;
  if v_landing_seat and v_member.role in ('owner', 'manager', 'staff') then
    v_caps := array_append(v_caps, 'inquiry.respond');
  end if;
  if v_has_hauler and v_member.role in ('owner', 'manager', 'staff', 'driver') then
    v_caps := v_caps || array['interest.express', 'interest.withdraw', 'interest.reply'];
  end if;
  if v_has_hauler and v_member.role in ('owner', 'manager', 'staff') then
    v_caps := array_append(v_caps, 'equipment.manage');
  end if;

  return query
  select v_org.id, v_org.display_name, v_member.role, v_landing_seat, v_has_hauler, v_caps;
end
$$;

-- 7b. `authoringLandings(viewer)`
create or replace function marketplace.list_authoring_landings(p_org_id uuid)
returns table (
  id uuid,
  name text,
  area_label text,
  state_code char(2)
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

  if not ('job.publish' = any (coalesce(v_caps, array[]::text[]))) then
    raise exception 'Your role cannot publish jobs for this organization' using errcode = '42501';
  end if;

  return query
  select l.id, l.name, l.public_area_label as area_label, l.state_code
  from marketplace.landings l
  where l.org_id = p_org_id and l.status = 'active'
  order by l.name asc;
end
$$;

-- 7c. `haulerEquipment(viewer)`
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
  group by eu.configuration_key, et1.label, et2.label
  order by sum(eu.unit_count) desc, label asc;
end
$$;

-- 7d. `save_job_posting_draft(...)`: saves or updates an unpublished draft
--     (`status = 'draft'`, `published_at = null`, `last_confirmed_at = null`).
--     Drafts may omit pay information while incomplete, but cannot be published
--     until `publish_job_posting` is called with valid pay and `p_attest_available = true`.
create or replace function marketplace.save_job_posting_draft(
  p_landing_id uuid,
  p_title text,
  p_equipment_codes text[] default '{}',
  p_trucks_requested integer default 1,
  p_product text default null,
  p_description text default null,
  p_pay_unit text default null,
  p_pay_amount_cents bigint default null,
  p_pay_note text default null,
  p_trucks_per_day integer default null,
  p_work_starts_on date default null,
  p_duration_days integer default null,
  p_est_loads_per_truck_per_day numeric default null,
  p_est_daily_loads integer default null,
  p_est_tons_per_load numeric default null,
  p_destination_label text default null,
  p_est_one_way_miles integer default null,
  p_public_road_notes text default null,
  p_schedule_note text default null,
  p_public_access_requirements text[] default '{}',
  p_draft_job_id uuid default null
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_user       uuid := marketplace.current_user_id();
  v_landing    marketplace.landings;
  v_caps       text[];
  v_uniq_equip text[];
  v_ends_on    date;
  v_job_id     uuid;
begin
  select * into v_landing from marketplace.landings where id = p_landing_id;
  if not found then
    raise exception 'Choose one of your organization''s landings' using errcode = 'P0002';
  end if;

  select a.capabilities into v_caps
  from marketplace.get_viewer_marketplace_access(v_landing.org_id) a;

  if not ('job.publish' = any (coalesce(v_caps, array[]::text[]))) then
    raise exception 'Your role cannot author jobs for this organization' using errcode = '42501';
  end if;

  select array_agg(distinct btrim(c) order by btrim(c))
  into v_uniq_equip
  from unnest(coalesce(p_equipment_codes, array[]::text[])) as c
  where btrim(c) <> '';

  if p_work_starts_on is not null and p_duration_days is not null then
    v_ends_on := p_work_starts_on + (p_duration_days - 1);
  end if;

  if p_draft_job_id is not null then
    update marketplace.job_postings
    set landing_id = v_landing.id,
        title = btrim(p_title),
        description = nullif(btrim(p_description), ''),
        product = nullif(btrim(p_product), ''),
        destination_label = nullif(btrim(p_destination_label), ''),
        est_one_way_miles = p_est_one_way_miles,
        est_daily_loads = p_est_daily_loads,
        est_loads_per_truck_per_day = p_est_loads_per_truck_per_day,
        est_tons_per_load = p_est_tons_per_load,
        pay_amount_cents = p_pay_amount_cents,
        pay_unit = nullif(btrim(p_pay_unit), ''),
        pay_note = nullif(btrim(p_pay_note), ''),
        public_road_notes = nullif(btrim(p_public_road_notes), ''),
        schedule_note = nullif(btrim(p_schedule_note), ''),
        public_access_requirements = coalesce(p_public_access_requirements, '{}'),
        trucks_requested = coalesce(p_trucks_requested, 1),
        trucks_per_day = p_trucks_per_day,
        work_starts_on = p_work_starts_on,
        duration_days = p_duration_days,
        work_ends_on = v_ends_on
    where id = p_draft_job_id
      and org_id = v_landing.org_id
      and status = 'draft'
    returning id into v_job_id;

    if not found then
      raise exception 'Draft job posting not found or already published' using errcode = 'P0002';
    end if;

    delete from marketplace.job_posting_equipment where job_id = v_job_id;
  else
    insert into marketplace.job_postings (
      org_id, landing_id, title, description, product, destination_label,
      est_one_way_miles, est_daily_loads, est_loads_per_truck_per_day, est_tons_per_load,
      pay_amount_cents, pay_unit, pay_note, public_road_notes,
      schedule_note, public_access_requirements,
      trucks_requested, trucks_per_day, work_starts_on, duration_days, work_ends_on,
      status, created_by
    )
    values (
      v_landing.org_id, v_landing.id, btrim(p_title), nullif(btrim(p_description), ''), nullif(btrim(p_product), ''),
      nullif(btrim(p_destination_label), ''),
      p_est_one_way_miles, p_est_daily_loads, p_est_loads_per_truck_per_day, p_est_tons_per_load,
      p_pay_amount_cents, nullif(btrim(p_pay_unit), ''), nullif(btrim(p_pay_note), ''), nullif(btrim(p_public_road_notes), ''),
      nullif(btrim(p_schedule_note), ''), coalesce(p_public_access_requirements, '{}'),
      coalesce(p_trucks_requested, 1), p_trucks_per_day, p_work_starts_on, p_duration_days, v_ends_on,
      'draft', v_user
    )
    returning id into v_job_id;
  end if;

  if v_uniq_equip is not null and cardinality(v_uniq_equip) > 0 then
    insert into marketplace.job_posting_equipment (job_id, equipment_code)
    select v_job_id, code from unnest(v_uniq_equip) as code;
  end if;

  perform marketplace.write_audit(
    'job_posting.draft_saved', 'job_postings', v_job_id, v_landing.org_id,
    null, jsonb_build_object('landing_id', v_landing.id));

  return v_job_id;
end
$$;

-- 7e. `publishJob(viewer, draft)` (`V2-DEC-02` & `V2-DEC-03`):
--     * Requires explicit affirmative availability attestation (`p_attest_available is true`).
--       Passing `false` or `null` (or omitting `p_attest_available`) is rejected with `23514`.
--     * Enforces mandatory compensation (`V2-DEC-02`) before and during insert.
--     * Assigns `published_at` and `last_confirmed_at` using the server clock (`clock_timestamp()`).
--     * Serializes per landing (`FOR UPDATE`) and deduplicates repeated identical submissions
--       idempotently so retries or double-clicks never create duplicate active jobs.
create or replace function marketplace.publish_job_posting(
  p_landing_id uuid,
  p_title text,
  p_equipment_codes text[],
  p_trucks_requested integer,
  p_product text default null,
  p_description text default null,
  p_pay_unit text default null,
  p_pay_amount_cents bigint default null,
  p_pay_note text default null,
  p_trucks_per_day integer default null,
  p_work_starts_on date default null,
  p_duration_days integer default null,
  p_est_loads_per_truck_per_day numeric default null,
  p_est_daily_loads integer default null,
  p_est_tons_per_load numeric default null,
  p_destination_label text default null,
  p_est_one_way_miles integer default null,
  p_public_road_notes text default null,
  p_schedule_note text default null,
  p_public_access_requirements text[] default '{}',
  p_attest_available boolean default null,
  p_draft_job_id uuid default null
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_user         uuid := marketplace.current_user_id();
  v_landing      marketplace.landings;
  v_caps         text[];
  v_uniq_equip   text[];
  v_clean_title  text := btrim(coalesce(p_title, ''));
  v_clean_desc   text := nullif(btrim(coalesce(p_description, '')), '');
  v_clean_prod   text := nullif(btrim(coalesce(p_product, '')), '');
  v_clean_dest   text := nullif(btrim(coalesce(p_destination_label, '')), '');
  v_clean_unit   text := nullif(btrim(coalesce(p_pay_unit, '')), '');
  v_clean_note   text := nullif(btrim(coalesce(p_pay_note, '')), '');
  v_clean_road   text := nullif(btrim(coalesce(p_public_road_notes, '')), '');
  v_clean_sched  text := nullif(btrim(coalesce(p_schedule_note, '')), '');
  v_access_reqs  text[] := coalesce(p_public_access_requirements, '{}');
  v_ends_on      date;
  v_now          timestamptz := clock_timestamp();
  v_existing_id  uuid;
  v_job_id       uuid;
begin
  -- V2-DEC-03: Explicit availability attestation is mandatory to publish.
  if p_attest_available is not true then
    raise exception 'Explicit availability attestation (p_attest_available = true) is required to publish a job posting'
      using errcode = '23514',
            hint = 'Confirm that this hauling opportunity is currently available before publishing.';
  end if;

  -- Lock the landing row to serialize concurrent publications at the same landing.
  select * into v_landing
  from marketplace.landings
  where id = p_landing_id
  for update;

  if not found then
    raise exception 'Choose one of your organization''s landings' using errcode = 'P0002';
  end if;

  select a.capabilities into v_caps
  from marketplace.get_viewer_marketplace_access(v_landing.org_id) a;

  if not ('job.publish' = any (coalesce(v_caps, array[]::text[]))) then
    raise exception 'Your role cannot publish jobs for this organization' using errcode = '42501';
  end if;

  -- V2-DEC-02: Mandatory compensation check at RPC boundary (as well as table CHECK & trigger).
  if v_clean_unit is null then
    raise exception 'Published job postings must state a positive pay rate with a pay basis or Negotiable with an explanatory note'
      using errcode = '23514';
  elsif v_clean_unit = 'negotiable' then
    if p_pay_amount_cents is not null then
      raise exception 'Negotiable pay has no fixed amount — describe it in the pay note'
        using errcode = '23514';
    end if;
    if v_clean_note is null or char_length(v_clean_note) < 3 then
      raise exception 'Explain how negotiable pay is set (at least 3 non-whitespace characters)'
        using errcode = '23514';
    end if;
  else
    if p_pay_amount_cents is null or p_pay_amount_cents <= 0 then
      raise exception 'Enter a positive pay amount (> $0) for pay basis %', v_clean_unit
        using errcode = '23514';
    end if;
  end if;

  select array_agg(distinct btrim(c) order by btrim(c))
  into v_uniq_equip
  from unnest(coalesce(p_equipment_codes, array[]::text[])) as c
  where btrim(c) <> '';

  if v_uniq_equip is null or cardinality(v_uniq_equip) < 1 or cardinality(v_uniq_equip) > 11 then
    raise exception 'Choose at least one equipment type' using errcode = '23514';
  end if;

  if p_trucks_requested is null or p_trucks_requested < 1 or p_trucks_requested > 9999 then
    raise exception 'Enter how many trucks the job needs' using errcode = '23514';
  end if;

  if p_trucks_per_day is not null and p_trucks_per_day > p_trucks_requested then
    raise exception 'Trucks per day cannot exceed total trucks requested' using errcode = '23514';
  end if;

  if p_duration_days is not null and p_work_starts_on is null then
    raise exception 'Add a start date to state a duration' using errcode = '23514';
  end if;

  if p_work_starts_on is not null and p_duration_days is not null then
    v_ends_on := p_work_starts_on + (p_duration_days - 1);
  end if;

  -- Idempotency check (`V2-DEC-03`): if an identical active job with the same
  -- equipment set already exists at this landing for this organization, return
  -- its `id` without inserting a duplicate posting or forging a new timestamp.
  if p_draft_job_id is null then
    select j.id into v_existing_id
    from marketplace.job_postings j
    where j.org_id = v_landing.org_id
      and j.landing_id = v_landing.id
      and j.status = 'active'
      and j.title = v_clean_title
      and j.description is not distinct from v_clean_desc
      and j.product is not distinct from v_clean_prod
      and j.destination_label is not distinct from v_clean_dest
      and j.est_one_way_miles is not distinct from p_est_one_way_miles
      and j.est_daily_loads is not distinct from p_est_daily_loads
      and j.est_loads_per_truck_per_day is not distinct from p_est_loads_per_truck_per_day
      and j.est_tons_per_load is not distinct from p_est_tons_per_load
      and j.pay_amount_cents is not distinct from p_pay_amount_cents
      and j.pay_unit is not distinct from v_clean_unit
      and j.pay_note is not distinct from v_clean_note
      and j.public_road_notes is not distinct from v_clean_road
      and j.schedule_note is not distinct from v_clean_sched
      and j.public_access_requirements = v_access_reqs
      and j.trucks_requested is not distinct from p_trucks_requested
      and j.trucks_per_day is not distinct from p_trucks_per_day
      and j.work_starts_on is not distinct from p_work_starts_on
      and j.duration_days is not distinct from p_duration_days
      and coalesce((
        select array_agg(jpe.equipment_code order by jpe.equipment_code)
        from marketplace.job_posting_equipment jpe
        where jpe.job_id = j.id
      ), array[]::text[]) = v_uniq_equip
    limit 1;

    if v_existing_id is not null then
      return v_existing_id;
    end if;
  end if;

  v_job_id := coalesce(p_draft_job_id, gen_random_uuid());

  if p_draft_job_id is not null then
    perform 1 from marketplace.job_postings
    where id = p_draft_job_id and org_id = v_landing.org_id and status = 'draft'
    for update;
    if not found then
      raise exception 'Draft job posting not found or already published' using errcode = 'P0002';
    end if;
  end if;

  -- Record the verified availability attestation in the ungranted ledger table
  -- before inserting/activating the job row.
  insert into marketplace.job_publication_attestations (
    job_id, org_id, attested_by, attested_at, reconfirmed_at, reconfirmed_by, confirmation_seq
  )
  values (
    v_job_id, v_landing.org_id, v_user, v_now, v_now, v_user, 1
  );

  if p_draft_job_id is not null then
    update marketplace.job_postings
    set landing_id = v_landing.id,
        title = v_clean_title,
        description = v_clean_desc,
        product = v_clean_prod,
        destination_label = v_clean_dest,
        est_one_way_miles = p_est_one_way_miles,
        est_daily_loads = p_est_daily_loads,
        est_loads_per_truck_per_day = p_est_loads_per_truck_per_day,
        est_tons_per_load = p_est_tons_per_load,
        pay_amount_cents = p_pay_amount_cents,
        pay_unit = v_clean_unit,
        pay_note = v_clean_note,
        public_road_notes = v_clean_road,
        schedule_note = v_clean_sched,
        public_access_requirements = v_access_reqs,
        trucks_requested = p_trucks_requested,
        trucks_per_day = p_trucks_per_day,
        work_starts_on = p_work_starts_on,
        duration_days = p_duration_days,
        work_ends_on = v_ends_on,
        status = 'active',
        published_at = v_now,
        last_confirmed_at = v_now,
        last_confirmed_by = v_user
    where id = p_draft_job_id
      and org_id = v_landing.org_id
      and status = 'draft';

    if not found then
      raise exception 'Draft job posting not found or already published' using errcode = 'P0002';
    end if;

    delete from marketplace.job_posting_equipment where job_id = v_job_id;
  else
    insert into marketplace.job_postings (
      id, org_id, landing_id, title, description, product, destination_label,
      est_one_way_miles, est_daily_loads, est_loads_per_truck_per_day, est_tons_per_load,
      pay_amount_cents, pay_unit, pay_note, public_road_notes,
      schedule_note, public_access_requirements,
      trucks_requested, trucks_per_day, work_starts_on, duration_days, work_ends_on,
      status, published_at, last_confirmed_at, last_confirmed_by, created_by
    )
    values (
      v_job_id, v_landing.org_id, v_landing.id, v_clean_title, v_clean_desc, v_clean_prod,
      v_clean_dest,
      p_est_one_way_miles, p_est_daily_loads, p_est_loads_per_truck_per_day, p_est_tons_per_load,
      p_pay_amount_cents, v_clean_unit, v_clean_note, v_clean_road,
      v_clean_sched, v_access_reqs,
      p_trucks_requested, p_trucks_per_day, p_work_starts_on, p_duration_days, v_ends_on,
      'active', v_now, v_now, v_user, v_user
    );
  end if;

  insert into marketplace.job_posting_equipment (job_id, equipment_code)
  select v_job_id, code from unnest(v_uniq_equip) as code;

  perform marketplace.write_audit(
    'job_posting.published', 'job_postings', v_job_id, v_landing.org_id,
    'Explicit initial availability attestation on publish',
    jsonb_build_object(
      'landing_id', v_landing.id,
      'equipment', v_uniq_equip,
      'attested_available', true,
      'attested_by_user_id', v_user,
      'attested_at', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )
  );

  return v_job_id;
end
$$;

-- 7f. `reconfirmJob(viewer, jobId)` (`V2-DEC-03`):
--     * Explicitly advances `last_confirmed_at` using the server clock
--       (`greatest(clock_timestamp(), last_confirmed_at + 1us)` so even rapid
--       same-transaction reconfirmations strictly advance the timestamp).
--     * Preserves `updated_at` (`last_modified_at`) unchanged.
--     * Records the confirming user in both `job_postings.last_confirmed_by`
--       and `marketplace.audit_events`.
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
  if not found then
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

-- 7g. Privileged, audited migration RPC for historical pilot records
--     (`V2-DEC-02` & `V2-DEC-03`):
--     * Executable ONLY by a platform `superadmin` or database owner migration session
--       (never granted to ordinary `authenticated`, `anon`, or `service_role` callers).
--     * Preserves missing pay (`pay_unit = null, pay_amount_cents = null`) and missing
--       confirmation (`last_confirmed_at = null`) on historical records honestly without
--       fabricating rates, truck totals, or confirmation timestamps.
create or replace function marketplace.admin_import_legacy_job_posting(
  p_org_id uuid,
  p_landing_id uuid,
  p_title text,
  p_equipment_codes text[],
  p_migration_reason text,
  p_status text default 'active',
  p_trucks_requested integer default null,
  p_trucks_per_day integer default null,
  p_product text default null,
  p_description text default null,
  p_pay_unit text default null,
  p_pay_amount_cents bigint default null,
  p_pay_note text default null,
  p_est_daily_loads integer default null,
  p_est_tons_per_load numeric default null,
  p_destination_label text default null,
  p_est_one_way_miles integer default null,
  p_published_at timestamptz default null,
  p_last_confirmed_at timestamptz default null
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_actor      uuid := marketplace.current_user_id();
  v_job_id     uuid := gen_random_uuid();
  v_uniq_equip text[];
begin
  -- Allow-list: a platform superadmin, or a direct privileged migration login (no SET ROLE in effect and
  -- not one of the API roles). Everything else is refused.
  if not marketplace.is_platform_admin(array['superadmin'])
     and not (coalesce(current_setting('role', true), 'none') = 'none'
              and session_user::text not in ('anon', 'authenticated', 'service_role', 'authenticator')) then
    raise exception 'Only a platform superadmin or privileged migration session may import legacy unquoted jobs'
      using errcode = '42501';
  end if;

  if p_migration_reason is null or char_length(btrim(p_migration_reason)) < 5 then
    raise exception 'A migration reason (5+ characters) is required for audited legacy job import'
      using errcode = '22023';
  end if;

  if p_status not in ('active', 'paused', 'filled', 'closed', 'expired') then
    raise exception 'Invalid legacy job status: %', p_status using errcode = '22023';
  end if;

  -- imported_by is the real actor (NULL for a migration login). created_by must be a user, so a
  -- migration login records the organization's creator only as the owner of record.
  insert into marketplace.legacy_job_imports (job_id, org_id, imported_by, reason)
  values (v_job_id, p_org_id, v_actor, btrim(p_migration_reason));

  insert into marketplace.job_postings (
    id, org_id, landing_id, title, description, product, destination_label,
    est_one_way_miles, est_daily_loads, est_tons_per_load,
    pay_amount_cents, pay_unit, pay_note,
    trucks_requested, trucks_per_day,
    status, published_at, last_confirmed_at, last_confirmed_by,
    is_legacy_import, created_by
  )
  values (
    v_job_id, p_org_id, p_landing_id, btrim(p_title),
    nullif(btrim(p_description), ''), nullif(btrim(p_product), ''), nullif(btrim(p_destination_label), ''),
    p_est_one_way_miles, p_est_daily_loads, p_est_tons_per_load,
    p_pay_amount_cents, nullif(btrim(p_pay_unit), ''), nullif(btrim(p_pay_note), ''),
    p_trucks_requested, p_trucks_per_day,
    p_status,
    coalesce(p_published_at, clock_timestamp()),
    p_last_confirmed_at,
    null, -- the historical confirmer is unknown; never attribute it to the importer or org creator
    true,
    coalesce(v_actor, (select o.created_by from marketplace.organizations o where o.id = p_org_id))
  );

  select array_agg(distinct btrim(c) order by btrim(c))
  into v_uniq_equip
  from unnest(coalesce(p_equipment_codes, array[]::text[])) as c
  where btrim(c) <> '';

  if v_uniq_equip is not null and cardinality(v_uniq_equip) > 0 then
    insert into marketplace.job_posting_equipment (job_id, equipment_code)
    select v_job_id, code from unnest(v_uniq_equip) as code;
  end if;

  perform marketplace.write_audit(
    'job_posting.legacy_imported', 'job_postings', v_job_id, p_org_id,
    btrim(p_migration_reason),
    jsonb_build_object(
      'pay_unit', p_pay_unit,
      'pay_amount_cents', p_pay_amount_cents,
      'last_confirmed_at', p_last_confirmed_at,
      'trucks_requested', p_trucks_requested,
      'trucks_per_day', p_trucks_per_day
    ),
    true
  );

  return v_job_id;
end
$$;

-- 7h. `set_job_posting_status(p_job_id, p_status)`
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
  if not found then
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

  update marketplace.job_postings
  set status = p_status,
      expires_at = case when p_status = 'expired' then coalesce(least(expires_at, now()), now()) else expires_at end
  where id = p_job_id;

  perform marketplace.write_audit(
    'job_posting.status_changed', 'job_postings', p_job_id, v_job.org_id,
    null, jsonb_build_object('from_status', v_job.status, 'to_status', p_status));
end
$$;

-- 7i. `list_marketplace_jobs`, `get_marketplace_job`, and updated `search_job_postings`
--     (`V2-DEC-01`):
--     * Quantizes caller search origin `p_point` to the fixed 0.10-degree grid.
--     * Computes distance and spatial filtering strictly against quantized `l.public_point`
--       and `b.center_point` (never `landing_private_details.exact_point`).
--     * Returns `origin_lat` and `origin_lng` quantized to 0.10 degrees (`round(..., 1)`).
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
      (j.status = 'active' and (j.expires_at is null or j.expires_at > now())) as accepting_interest,
      j.updated_at as last_modified_at,
      j.last_confirmed_at,
      j.expires_at,
      (
        j.status = 'active'
        and (j.expires_at is null or j.expires_at > now())
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
      and (l.status = 'active' or (not coalesce(p_accepting_only, true) and l.status <> 'archived'))
      and (p_org_id is null or j.org_id = p_org_id)
      and (not coalesce(p_accepting_only, true)
           or (j.status = 'active' and l.status = 'active' and (j.expires_at is null or j.expires_at > now())))
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

create or replace function marketplace.get_marketplace_job(p_job_id uuid)
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
  sponsored boolean
)
language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select *
  from marketplace.list_marketplace_jobs(null, null, null, false, null, null, null, 2, 1, p_job_id) j
$$;

-- Also update `marketplace.search_job_postings` from `03_entitlements.sql` so it
-- uses the fixed 0.10-degree `marketplace.approximate_point` and orders confirmed
-- jobs ahead of unconfirmed legacy jobs (`last_confirmed_at desc nulls last`).
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

-- 7j. `expressInterest(viewer, input)`
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
  for update;

  if found then
    if v_existing.status = 'declined' then
      raise exception 'The landing has closed this inquiry' using errcode = '23514';
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

-- 7k. `respondToInterest` & `post_hauler_interest_reply`
drop function if exists marketplace.respond_to_interest(uuid, text, boolean);
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

create or replace function marketplace.post_hauler_interest_reply(
  p_interest_id uuid,
  p_reply_id uuid,
  p_body text
) returns void
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_user       uuid := marketplace.current_user_id();
  v_row        marketplace.expressions_of_interest;
  v_caps       text[];
  v_clean_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_msg_count  integer;
begin
  if p_reply_id is null or v_clean_body is null then
    raise exception 'A reply needs an id and message' using errcode = '22023';
  end if;

  select * into v_row from marketplace.expressions_of_interest where id = p_interest_id for update;
  if not found then
    raise exception 'Inquiry not found' using errcode = '42501';
  end if;

  select a.capabilities into v_caps
  from marketplace.get_viewer_marketplace_access(v_row.hauler_org_id) a;

  if not ('interest.reply' = any (coalesce(v_caps, array[]::text[]))) then
    raise exception 'Inquiry not found' using errcode = '42501';
  end if;

  if exists (
    select 1 from marketplace.interest_messages m
    where m.id = p_reply_id and m.interest_id = p_interest_id
  ) then
    return;
  end if;

  if v_row.status in ('withdrawn', 'declined') then
    raise exception 'This inquiry is closed' using errcode = '23514';
  end if;

  select count(*) into v_msg_count from marketplace.interest_messages where interest_id = p_interest_id;
  if v_msg_count >= 200 then
    raise exception 'Maximum of 200 messages reached for this inquiry' using errcode = '23514';
  end if;

  insert into marketplace.interest_messages (id, interest_id, author_user_id, author_side, body)
  values (p_reply_id, p_interest_id, v_user, 'hauler', v_clean_body);

  update marketplace.expressions_of_interest
  set updated_at = now()
  where id = p_interest_id;
end
$$;

-- 7l. `list_marketplace_interests`
create or replace function marketplace.list_marketplace_interests(
  p_org_id uuid,
  p_side text,
  p_job_id uuid default null
) returns table (
  id uuid,
  job_id uuid,
  job_slug text,
  job_title text,
  job_status text,
  job_accepting_interest boolean,
  landing_org_id uuid,
  landing_org_name text,
  hauler_org_id uuid,
  hauler_org_name text,
  hauler_org_type text,
  submitted_by_user_id uuid,
  submitted_by_name text,
  trucks_offered integer,
  equipment jsonb,
  available_from date,
  available_until date,
  message text,
  contact_preference text,
  status text,
  replies jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  responded_at timestamptz,
  withdrawn_at timestamptz
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

  if p_side = 'hauler' then
    if not ('interest.reply' = any (coalesce(v_caps, array[]::text[]))) then
      raise exception 'Your role cannot act on inquiries for this business' using errcode = '42501';
    end if;
  elsif p_side = 'landing' then
    if not ('inquiry.respond' = any (coalesce(v_caps, array[]::text[]))) then
      raise exception 'Inquiry not found' using errcode = '42501';
    end if;
  else
    raise exception 'p_side must be hauler or landing' using errcode = '22023';
  end if;

  return query
  select
    e.id,
    e.job_id,
    e.job_id::text as job_slug,
    coalesce(j.title, 'Job no longer listed') as job_title,
    case
      when j.id is null or j.status = 'draft' then 'closed'
      when j.status = 'active' and j.expires_at is not null and j.expires_at <= now() then 'expired'
      else j.status
    end as job_status,
    (j.id is not null and j.status = 'active' and (j.expires_at is null or j.expires_at > now())) as job_accepting_interest,
    e.job_org_id as landing_org_id,
    coalesce(lo.display_name, 'Landing organization') as landing_org_name,
    e.hauler_org_id,
    coalesce(ho.display_name, 'Hauling business') as hauler_org_name,
    case
      when coalesce((select sum(eu.unit_count) from marketplace.equipment_units eu where eu.org_id = e.hauler_org_id and eu.is_active), 0) > 1
        then 'fleet'
      else 'carrier'
    end as hauler_org_type,
    e.submitted_by as submitted_by_user_id,
    coalesce(su.display_name, 'LogLoads member') as submitted_by_name,
    e.trucks_offered,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'configurationKey', eq.configuration_key,
          'label', eq.label,
          'count', eq.unit_count
        ) order by eq.sort_order, eq.configuration_key
      )
      from marketplace.expression_of_interest_equipment eq
      where eq.interest_id = e.id
    ), '[]'::jsonb) as equipment,
    e.available_from,
    e.available_until,
    e.message,
    e.contact_preference,
    e.status,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'authorUserId', m.author_user_id,
          'authorName', coalesce(au.display_name, 'LogLoads member'),
          'authorSide', m.author_side,
          'body', m.body,
          'createdAt', to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ) order by m.created_at, m.id
      )
      from marketplace.interest_messages m
      left join marketplace.app_users au on au.id = m.author_user_id
      where m.interest_id = e.id
    ), '[]'::jsonb) as replies,
    e.created_at,
    e.updated_at,
    e.responded_at,
    e.withdrawn_at
  from marketplace.expressions_of_interest e
  left join marketplace.job_postings j on j.id = e.job_id
  left join marketplace.organizations lo on lo.id = e.job_org_id
  left join marketplace.organizations ho on ho.id = e.hauler_org_id
  left join marketplace.app_users su on su.id = e.submitted_by
  where ((p_side = 'hauler' and e.hauler_org_id = p_org_id)
         or (p_side = 'landing' and e.job_org_id = p_org_id))
    and (p_job_id is null or e.job_id = p_job_id)
  order by
    case when p_side = 'hauler' then e.updated_at else e.created_at end desc,
    e.id;
end
$$;

-- -----------------------------------------------------------------------------
-- 8. Column-scoped grants & function execute privileges
-- -----------------------------------------------------------------------------

-- Internal ledger tables for V2-DEC-02 and V2-DEC-03 have ZERO table grants to
-- `PUBLIC`, `anon`, `authenticated`, or `service_role`.
revoke all on table marketplace.job_publication_attestations from public, anon, authenticated, service_role;
revoke all on table marketplace.legacy_job_imports from public, anon, authenticated, service_role;

revoke all on table marketplace.expression_of_interest_equipment from public, anon, authenticated, service_role;
grant select on marketplace.expression_of_interest_equipment to authenticated;
grant insert (interest_id, configuration_key, label, unit_count, sort_order) on marketplace.expression_of_interest_equipment to authenticated;
grant update (label, unit_count, sort_order) on marketplace.expression_of_interest_equipment to authenticated;
grant delete on marketplace.expression_of_interest_equipment to authenticated;

-- Grant new public read columns on `job_postings` to `anon` and `authenticated`.
-- Note: `last_confirmed_at`, `last_confirmed_by`, `published_at`, and `is_legacy_import`
-- are NEVER granted for INSERT or UPDATE to `authenticated` or `anon`.
grant select (
  trucks_per_day, duration_days, est_loads_per_truck_per_day,
  schedule_note, public_access_requirements, updated_at, is_legacy_import
) on marketplace.job_postings to anon, authenticated;
-- The confirming user's id is not public: readable by authenticated callers (still row-filtered by RLS) only.
grant select (last_confirmed_by) on marketplace.job_postings to authenticated;

-- V2-DEC-03: 02_access.sql granted UPDATE (last_confirmed_at) for the superseded auto-stamping design.
-- Confirmation is now written only by publish_job_posting / reconfirm_job_posting (SECURITY DEFINER).
revoke update (last_confirmed_at) on marketplace.job_postings from authenticated;

grant insert (
  trucks_per_day, duration_days, est_loads_per_truck_per_day,
  schedule_note, public_access_requirements
) on marketplace.job_postings to authenticated;

grant update (
  trucks_per_day, duration_days, est_loads_per_truck_per_day,
  schedule_note, public_access_requirements
) on marketplace.job_postings to authenticated;

-- Grant new `equipment_units` columns to `authenticated`.
grant insert (paired_trailer_code, operational_status, unit_count) on marketplace.equipment_units to authenticated;
grant update (paired_trailer_code, operational_status, unit_count) on marketplace.equipment_units to authenticated;

-- Grant `id` on `interest_messages` to `authenticated` so idempotent client `replyId` works on direct insert too.
grant insert (id, interest_id, author_side, body) on marketplace.interest_messages to authenticated;

revoke all on function
  marketplace.has_live_inquiry_from_hauler(uuid),
  marketplace.quantize_public_coordinate(double precision, double precision, double precision, text),
  marketplace.make_public_point(double precision, double precision),
  marketplace.tg_eoi_equipment_consistency(),
  marketplace.tg_ensure_owner_landing_seat(),
  marketplace.tg_job_after_status(),
  marketplace.get_viewer_marketplace_access(uuid),
  marketplace.list_authoring_landings(uuid),
  marketplace.list_hauler_equipment_options(uuid),
  marketplace.save_job_posting_draft(uuid, text, text[], integer, text, text, text, bigint, text, integer, date, integer, numeric, integer, numeric, text, integer, text, text, text[], uuid),
  marketplace.publish_job_posting(uuid, text, text[], integer, text, text, text, bigint, text, integer, date, integer, numeric, integer, numeric, text, integer, text, text, text[], boolean, uuid),
  marketplace.reconfirm_job_posting(uuid),
  marketplace.admin_import_legacy_job_posting(uuid, uuid, text, text[], text, text, integer, integer, text, text, text, bigint, text, integer, numeric, text, integer, timestamptz, timestamptz),
  marketplace.set_job_posting_status(uuid, text),
  marketplace.list_marketplace_jobs(text, text, text, boolean, uuid, extensions.geography, integer, integer, integer, uuid),
  marketplace.get_marketplace_job(uuid),
  marketplace.submit_expression_of_interest(uuid, uuid, integer, jsonb, date, date, text, text),
  marketplace.respond_to_interest(uuid, text, boolean, uuid, text),
  marketplace.post_hauler_interest_reply(uuid, uuid, text),
  marketplace.list_marketplace_interests(uuid, text, uuid)
  from public, anon, authenticated, service_role;

grant execute on function
  marketplace.quantize_public_coordinate(double precision, double precision, double precision, text),
  marketplace.make_public_point(double precision, double precision),
  marketplace.list_marketplace_jobs(text, text, text, boolean, uuid, extensions.geography, integer, integer, integer, uuid),
  marketplace.get_marketplace_job(uuid)
  to anon, authenticated;

grant execute on function
  marketplace.has_live_inquiry_from_hauler(uuid),
  marketplace.get_viewer_marketplace_access(uuid),
  marketplace.list_authoring_landings(uuid),
  marketplace.list_hauler_equipment_options(uuid),
  marketplace.save_job_posting_draft(uuid, text, text[], integer, text, text, text, bigint, text, integer, date, integer, numeric, integer, numeric, text, integer, text, text, text[], uuid),
  marketplace.publish_job_posting(uuid, text, text[], integer, text, text, text, bigint, text, integer, date, integer, numeric, integer, numeric, text, integer, text, text, text[], boolean, uuid),
  marketplace.reconfirm_job_posting(uuid),
  marketplace.admin_import_legacy_job_posting(uuid, uuid, text, text[], text, text, integer, integer, text, text, text, bigint, text, integer, numeric, text, integer, timestamptz, timestamptz),
  marketplace.set_job_posting_status(uuid, text),
  marketplace.submit_expression_of_interest(uuid, uuid, integer, jsonb, date, date, text, text),
  marketplace.respond_to_interest(uuid, text, boolean, uuid, text),
  marketplace.post_hauler_interest_reply(uuid, uuid, text),
  marketplace.list_marketplace_interests(uuid, text, uuid)
  to authenticated;
