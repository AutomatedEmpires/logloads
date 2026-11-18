-- =============================================================================
-- LogLoads normalized-v2 — 38 basins (#324)
--
-- NON-ACTIVE PROTOTYPE. Not an approved migration. Applied after 35_v2_day14_direct_reads_unsubscribe_keys.sql.
-- Run order: 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23 -> 26 -> 29 -> 31 -> 33 -> 35 -> 38
-- (the odd stages and 10, 15, 36, 37, 39 are tests, not migrations). Apply exactly once, in one transaction:
-- psql -v ON_ERROR_STOP=1 --single-transaction -f 38_v2_basins.sql
--
-- A basin is a named area in one state: a boundary, a county list, or both. A landing's basin is the smallest
-- boundary that covers its public point (then the lowest id), and, only when no boundary covers it, a county-list
-- basin in the same state. Hauler availability has a point and no county, so a county-only basin counts no haulers.
-- Status starts closed. Only platform staff can create a basin or set its status, and the reason is audited.
-- Pilot and open are launched. Closed is not.
--
-- The gate is off while marketplace.basins is empty, so every existing suite, the seed and the demo keep the jobs
-- they have. The moment any basin exists, a job is public only when its landing's basin is pilot or open. A landing
-- that matches nothing is hidden too. The owning desk still sees its own jobs (can_read_job_posting's membership
-- clause), and platform staff still see them. Find Work's list and get go through job_is_publicly_visible; search
-- does not, so search_job_postings gains the same predicate. No new row-level policy: the anon policies already
-- call job_is_publicly_visible.
--
-- 38 adds one table and nine functions, and redefines two (CREATE OR REPLACE keeps each ACL). It changes no stored
-- row. Stage 38 in CI checks this exact set.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Migration-order guard: requires 35, refuses a repeat. Runs before any change.
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_advisory_xact_lock(hashtextextended('marketplace.schema_migrations', 0));
  if to_regclass('marketplace.schema_migrations') is null then
    raise exception 'migration 38 requires migration 35 to be applied first' using errcode = '55000';
  end if;
  if not exists (select 1 from marketplace.schema_migrations where version = '35') then
    raise exception 'migration 38 requires migration 35 to be applied first' using errcode = '55000';
  end if;
  if exists (select 1 from marketplace.schema_migrations where version = '38') then
    raise exception 'migration 38 is already applied (%); re-running it is refused and nothing was changed',
      (select applied_at from marketplace.schema_migrations where version = '38')
      using errcode = '55000', hint = 'Migrations are forward-only.';
  end if;
  if to_regclass('marketplace.basins') is not null
     or to_regprocedure('marketplace.create_basin(text, text, text[], text, text)') is not null then
    raise exception 'migration 38 appears to be applied already (its objects exist) but is not recorded; refusing to re-run'
      using errcode = '55000';
  end if;
  perform set_config('logloads.migration_xact', txid_current()::text, true);
end
$$;

do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    perform set_config('default_transaction_read_only', 'on', false);
    perform set_config('logloads.migration_refused', '38', false);
  end if;
end
$$;

do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    raise exception 'migration 38 must be applied in one transaction (psql --single-transaction); nothing was changed'
      using errcode = '25P01', hint = 'This session (or pooled backend) was made read-only to stop the rest of the file.';
  end if;
  if coalesce(current_setting('logloads.migration_refused', true), '') <> '' then
    raise exception 'migration 38 refused: this session was made read-only by an earlier non-atomic attempt (migration %); reconnect and apply it with psql --single-transaction',
      current_setting('logloads.migration_refused')
      using errcode = '25P01';
  end if;
end
$$;

-- A check constraint cannot hold a subquery, so the county-length rule is a function.
create function marketplace.basin_counties_valid(p_counties text[])
returns boolean
language sql
immutable
as $$
  select p_counties is not null
     and not exists (
       select 1 from unnest(p_counties) as c
       where c is null or char_length(btrim(c)) not between 1 and 80
     )
$$;

-- -----------------------------------------------------------------------------
-- Table. No policy and no grant: staff functions are the only writers and readers.
-- The owner bypasses row-level security; it is not forced.
-- -----------------------------------------------------------------------------
create table marketplace.basins (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  state_code  char(2) not null check (state_code ~ '^[A-Z]{2}$'),
  counties    text[] not null default '{}',
  boundary    extensions.geography(MultiPolygon, 4326),
  status      text not null default 'closed' check (status in ('closed', 'pilot', 'open')),
  created_by  uuid references marketplace.app_users (id) default marketplace.current_user_id(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (boundary is not null or cardinality(counties) > 0),
  check (marketplace.basin_counties_valid(counties))
);

create unique index basins_state_name_uq on marketplace.basins (state_code, lower(name));
create index basins_boundary_gix on marketplace.basins using gist (boundary);
create index basins_state_status_idx on marketplace.basins (state_code, status);

create trigger basins_set_updated_at before update on marketplace.basins
  for each row execute function marketplace.tg_set_updated_at();

alter table marketplace.basins enable row level security;
revoke all on table marketplace.basins from public, anon, authenticated, service_role;

comment on table marketplace.basins is
  '38 (#324): a named area in one state. Empty until staff record one. While empty, discovery is unchanged.';

-- -----------------------------------------------------------------------------
-- Derivation. Internal: no API role can execute these.
-- -----------------------------------------------------------------------------
create function marketplace.basin_for_point(
  p_point extensions.geography,
  p_state_code text default null,
  p_county text default null
) returns uuid
language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_point extensions.geography;
  v_state text;
  v_id uuid;
begin
  if p_state_code is not null and btrim(p_state_code) <> '' then
    v_state := upper(btrim(p_state_code));
    if v_state !~ '^[A-Z]{2}$' then
      return null;
    end if;
  end if;

  v_point := marketplace.approximate_point(p_point);
  if v_point is not null then
    select b.id into v_id
    from marketplace.basins b
    where b.boundary is not null
      and extensions.st_covers(b.boundary, v_point)
      and (v_state is null or b.state_code = v_state::char(2))
    order by extensions.st_area(b.boundary), b.id
    limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  -- A county list matches only a basin that has no boundary, and only with a state.
  if v_state is null or p_county is null or btrim(p_county) = '' then
    return null;
  end if;
  select b.id into v_id
  from marketplace.basins b
  where b.boundary is null
    and b.state_code = v_state::char(2)
    and exists (
      select 1 from unnest(b.counties) c
      where lower(btrim(c)) = lower(btrim(p_county))
    )
  order by b.id
  limit 1;
  return v_id;
end
$$;

create function marketplace.basin_for_landing(p_landing uuid)
returns uuid language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select marketplace.basin_for_point(l.public_point, l.state_code::text, l.county)
  from marketplace.landings l
  where l.id = p_landing
$$;

-- True when no basin has been recorded, or this landing's basin is pilot or open.
create function marketplace.landing_basin_launched(p_landing uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select not exists (select 1 from marketplace.basins)
      or exists (
        select 1 from marketplace.basins b
        where b.id = marketplace.basin_for_landing(p_landing)
          and b.status in ('pilot', 'open')
      )
$$;

-- -----------------------------------------------------------------------------
-- Staff. Any active platform admin. Reason is 5 to 500 characters and is audited.
-- -----------------------------------------------------------------------------
create function marketplace.create_basin(
  p_name text,
  p_state_code text,
  p_counties text[],
  p_boundary_wkt text,
  p_reason text
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_name text;
  v_state text;
  v_reason text;
  v_county text;
  v_counties text[] := '{}';
  v_geog extensions.geography;
  v_type text;
  v_id uuid;
begin
  if not marketplace.is_platform_admin() then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  v_name := btrim(p_name);
  v_state := upper(btrim(coalesce(p_state_code, '')));
  v_reason := btrim(coalesce(p_reason, ''));
  if v_name is null or char_length(v_name) not between 1 and 80
     or v_state !~ '^[A-Z]{2}$'
     or char_length(v_reason) not between 5 and 500 then
    raise exception 'a basin needs a name, a two-letter state and a reason' using errcode = '22023';
  end if;

  if p_counties is not null then
    for v_county in select btrim(c) from unnest(p_counties) as u(c) loop
      if v_county is null or char_length(v_county) not between 1 and 80 then
        raise exception 'each county name must be 1 to 80 characters' using errcode = '22023';
      end if;
      if not exists (select 1 from unnest(v_counties) existing where lower(existing) = lower(v_county)) then
        v_counties := v_counties || v_county;
      end if;
    end loop;
  end if;

  if p_boundary_wkt is not null and btrim(p_boundary_wkt) <> '' then
    if char_length(p_boundary_wkt) > 500000 then
      raise exception 'boundary must be a polygon' using errcode = '22023';
    end if;
    begin
      v_geog := extensions.st_geogfromtext(btrim(p_boundary_wkt));
    exception
      when others then
        raise exception 'boundary must be a polygon' using errcode = '22023';
    end;
    v_type := extensions.geometrytype(v_geog::extensions.geometry);
    if v_type = 'POLYGON' then
      v_geog := extensions.st_multi(v_geog::extensions.geometry)::extensions.geography;
      v_type := 'MULTIPOLYGON';
    end if;
    if v_type is distinct from 'MULTIPOLYGON'
       or extensions.st_isempty(v_geog::extensions.geometry)
       or not extensions.st_isvalid(v_geog::extensions.geometry) then
      raise exception 'boundary must be a polygon' using errcode = '22023';
    end if;
  end if;

  if v_geog is null and cardinality(v_counties) = 0 then
    raise exception 'a basin needs a boundary or a county list' using errcode = '22023';
  end if;

  begin
    insert into marketplace.basins (name, state_code, counties, boundary, status, created_by)
    values (v_name, v_state::char(2), v_counties, v_geog, 'closed', marketplace.current_user_id())
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'a basin with this name already exists in this state' using errcode = '22023';
  end;

  perform marketplace.write_audit(
    'basin.created', 'basins', v_id, null, v_reason,
    jsonb_build_object('state_code', v_state, 'status', 'closed', 'counties', cardinality(v_counties), 'boundary', v_geog is not null),
    true);
  return v_id;
end
$$;

create function marketplace.set_basin_status(
  p_basin_id uuid,
  p_status text,
  p_reason text
) returns void
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_status text;
  v_reason text;
  v_current text;
begin
  if not marketplace.is_platform_admin() then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  v_status := btrim(coalesce(p_status, ''));
  v_reason := btrim(coalesce(p_reason, ''));
  if v_status not in ('closed', 'pilot', 'open') or char_length(v_reason) not between 5 and 500 then
    raise exception 'valid status and audit reason required' using errcode = '22023';
  end if;

  select b.status into v_current from marketplace.basins b where b.id = p_basin_id for update;
  if not found then
    raise exception 'Basin not found' using errcode = 'P0002';
  end if;
  -- Setting the status it already has changes nothing and is not audited again.
  if v_current = v_status then
    return;
  end if;

  update marketplace.basins set status = v_status where id = p_basin_id;
  perform marketplace.write_audit(
    'basin.status_set', 'basins', p_basin_id, null, v_reason,
    jsonb_build_object('from', v_current, 'to', v_status),
    true);
end
$$;

create function marketplace.list_basins()
returns table (
  basin_id uuid,
  name text,
  state_code char(2),
  counties text[],
  boundary_wkt text,
  status text,
  created_at timestamptz
)
language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
begin
  if not marketplace.is_platform_admin() then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  return query
    select b.id, b.name, b.state_code, b.counties,
           extensions.st_astext(b.boundary), b.status, b.created_at
    from marketplace.basins b
    order by b.state_code, lower(b.name), b.id;
end
$$;

create function marketplace.basin_readiness(p_basin_id uuid)
returns table (
  basin_id uuid,
  name text,
  status text,
  verified_landings integer,
  active_jobs integer,
  haulers_available integer
)
language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_name text;
  v_status text;
begin
  if not marketplace.is_platform_admin() then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  select b.name, b.status into v_name, v_status from marketplace.basins b where b.id = p_basin_id;
  if not found then
    raise exception 'Basin not found' using errcode = 'P0002';
  end if;

  return query
    select p_basin_id, v_name, v_status,
      -- A verified landing: the business is verified and active, and the landing is active, in this basin.
      (select count(*)::integer
       from marketplace.landings l
       join marketplace.organizations o on o.id = l.org_id and o.status = 'active'
       where l.status = 'active'
         and o.verification_status = 'verified'
         and marketplace.basin_for_landing(l.id) = p_basin_id),
      -- An active job: active, unexpired, confirmed in the last 14 days, at a landing in this basin.
      (select count(*)::integer
       from marketplace.job_postings j
       join marketplace.landings l on l.id = j.landing_id and l.status = 'active'
       join marketplace.organizations o on o.id = j.org_id and o.status = 'active'
       where j.status = 'active'
         and (j.expires_at is null or j.expires_at > now())
         and marketplace.job_confirmation_current(j.last_confirmed_at)
         and marketplace.basin_for_landing(l.id) = p_basin_id),
      -- A hauler with availability confirmed in the last 14 days whose reported point falls in this basin.
      -- County-only basins match no point, so they count no haulers.
      (select count(distinct ar.org_id)::integer
       from marketplace.availability_reports ar
       join marketplace.organizations o on o.id = ar.org_id and o.status = 'active'
       join marketplace.hauler_profiles h on h.org_id = ar.org_id
       where ar.withdrawn_at is null
         and ar.reported_at > now() - interval '336 hours'
         and ar.available_until >= current_date
         and marketplace.basin_for_point(ar.area_center) = p_basin_id);
end
$$;

-- The public sentence for an area that is not launched. Null when the gate is off, the place is launched,
-- or the job id is not a real job (an unknown id and a launched job look the same).
create function marketplace.public_area_notice(
  p_job_id uuid default null,
  p_lat numeric default null,
  p_lng numeric default null,
  p_state_code text default null,
  p_county text default null
) returns text
language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_point extensions.geography;
  v_basin uuid;
  v_launched boolean;
begin
  if not exists (select 1 from marketplace.basins) then
    return null;
  end if;

  if p_job_id is not null then
    select marketplace.landing_basin_launched(j.landing_id) into v_launched
    from marketplace.job_postings j
    where j.id = p_job_id;
    if not found or v_launched then
      return null;
    end if;
    return 'not in your area yet';
  end if;

  if (p_lat is null) <> (p_lng is null) then
    raise exception 'both longitude and latitude are required when specifying a point' using errcode = '22023';
  end if;

  if p_lat is null then
    if exists (select 1 from marketplace.basins b where b.status in ('pilot', 'open')) then
      return null;
    end if;
    return 'not in your area yet';
  end if;

  v_point := marketplace.make_public_point(p_lng::double precision, p_lat::double precision);
  v_basin := marketplace.basin_for_point(v_point, p_state_code, p_county);
  if v_basin is not null and exists (
    select 1 from marketplace.basins b where b.id = v_basin and b.status in ('pilot', 'open')
  ) then
    return null;
  end if;
  return 'not in your area yet';
end
$$;

comment on function marketplace.create_basin(text, text, text[], text, text) is
  '38 (#324): platform staff record a basin. It starts closed. The reason is audited (basin.created).';
comment on function marketplace.set_basin_status(uuid, text, text) is
  '38 (#324): platform staff set closed, pilot or open. The same status again is a no-op. Audited (basin.status_set).';
comment on function marketplace.list_basins() is
  '38 (#324): platform staff read every basin. Anyone else is refused.';
comment on function marketplace.basin_readiness(uuid) is
  '38 (#324): platform staff read verified landings, active jobs and haulers confirmed in the last 14 days.';
comment on function marketplace.public_area_notice(uuid, numeric, numeric, text, text) is
  '38 (#324): null, or exactly "not in your area yet" when the gate is on and the job or place is not in a pilot or open basin.';

-- -----------------------------------------------------------------------------
-- Visibility. 02's job_is_publicly_visible and 31's search_job_postings, plus the basin gate.
-- CREATE OR REPLACE keeps the grants. Every other line is the previous definition.
-- -----------------------------------------------------------------------------
create or replace function marketplace.job_is_publicly_visible(p_job uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select exists (
    select 1
    from marketplace.job_postings j
    join marketplace.landings l on l.id = j.landing_id and l.status = 'active'
    join marketplace.organizations o on o.id = j.org_id and o.status = 'active'
    where j.id = p_job
      and j.status = 'active'
      and (j.expires_at is null or j.expires_at > now())
      and marketplace.landing_basin_launched(l.id) -- 38: pilot or open, or no basin recorded yet
  )
$$;

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
      and marketplace.job_confirmation_current(j.last_confirmed_at)
      and marketplace.landing_basin_launched(l.id) -- 38: pilot or open, or no basin recorded yet
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

-- -----------------------------------------------------------------------------
-- Grants. Internals stay with the owner. Staff functions are authenticated only.
-- The notice is a read, granted to anon and authenticated, and it is stable so it is
-- not a second volatile function for anon (unsubscribe_with_token stays the only one).
-- -----------------------------------------------------------------------------
revoke all on function
  marketplace.basin_counties_valid(text[]),
  marketplace.basin_for_point(extensions.geography, text, text),
  marketplace.basin_for_landing(uuid),
  marketplace.landing_basin_launched(uuid),
  marketplace.create_basin(text, text, text[], text, text),
  marketplace.set_basin_status(uuid, text, text),
  marketplace.list_basins(),
  marketplace.basin_readiness(uuid),
  marketplace.public_area_notice(uuid, numeric, numeric, text, text)
  from public, anon, authenticated, service_role;

grant execute on function
  marketplace.create_basin(text, text, text[], text, text),
  marketplace.set_basin_status(uuid, text, text),
  marketplace.list_basins(),
  marketplace.basin_readiness(uuid)
  to authenticated;

grant execute on function
  marketplace.public_area_notice(uuid, numeric, numeric, text, text)
  to anon, authenticated;

-- The migration role calls the internals from the security-definer functions it owns.
grant execute on function
  marketplace.basin_counties_valid(text[]),
  marketplace.basin_for_point(extensions.geography, text, text),
  marketplace.basin_for_landing(uuid),
  marketplace.landing_basin_launched(uuid)
  to current_user;

insert into marketplace.schema_migrations (version, name) values ('38', '38_v2_basins');
