-- =============================================================================
-- LogLoads normalized-v2 — 01 schema (tables, constraints, indexes)
--
-- NON-ACTIVE PROTOTYPE. Not an approved migration. Do not copy into
-- supabase/migrations and do not run against any Supabase project. Intended
-- for a disposable local PostgreSQL 15+ with PostGIS and btree_gist.
-- Run order: 01_schema.sql -> 02_access.sql -> 03_entitlements.sql -> 04_tests.sql.
--
-- Everything lives in its own `marketplace` schema (32 tables, 0 views) so it
-- cannot collide with pilot-era `public` tables or `public.operating_state`.
-- Status/kind columns are text + CHECK (cheaper to evolve than enum types).
-- No freight payments, settlement, trips, GPS, or dispatch tables by design.
-- =============================================================================

create schema if not exists extensions;

-- Plain-PostgreSQL / CI container compatibility:
--   1. Official `postgis/postgis:17-*` containers pre-install `postgis` in `public`
--      (and PostGIS is not `ALTER EXTENSION ... SET SCHEMA` relocatable). In a
--      disposable test DB where `postgis` was pre-created outside `extensions`,
--      re-create it in `extensions` so `extensions.geography` and `extensions.st_*`
--      resolve identically to Supabase.
--      D-5: dropping PostGIS is destructive (CASCADE removes every geometry column,
--      function and view built on it), so it is REFUSED unless BOTH hold:
--        a. the database is stamped disposable: its comment starts with
--           `logloads-ci-disposable:` (tools/normalized-v2-ci/guard.sh), or the session
--           sets `logloads.confirm_postgis_relocation` to `drop-postgis-in-<database name>`;
--        b. nothing outside PostGIS's own extensions depends on it (no user column,
--           function, view or other object would be cascaded away).
--      Any other database stops here with nothing changed.
--   2. Bootstrap Supabase's `anon`, `authenticated`, and `service_role` roles with
--      `nologin noinherit nobypassrls` and grant them to `current_user` so
--      `SET LOCAL ROLE` works in any disposable PostgreSQL 17 environment.
do $$
declare
  v_postgis    oid;
  v_schema     text;
  v_marked     boolean;
  v_confirmed  boolean;
  v_dependents text;
begin
  select e.oid, n.nspname into v_postgis, v_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'postgis';

  if v_postgis is null or v_schema = 'extensions' then
    return;
  end if;

  v_marked := coalesce(shobj_description((select d.oid from pg_database d where d.datname = current_database()), 'pg_database'), '')
              like 'logloads-ci-disposable:%';
  v_confirmed := coalesce(current_setting('logloads.confirm_postgis_relocation', true), '')
                 = 'drop-postgis-in-' || current_database();
  if not (v_marked or v_confirmed) then
    raise exception 'refusing to drop PostGIS: it is installed in schema "%" and this database is not stamped disposable', v_schema
      using errcode = '55000',
            hint = 'Install PostGIS in schema "extensions" yourself, or run against a guarded disposable database. Nothing was changed.';
  end if;

  -- User objects (not members of any extension) that a CASCADE would destroy: columns of PostGIS-family
  -- types (geometry, geography, topogeometry, raster, or arrays/domains of them), functions taking or
  -- returning them, and any constraint, default, policy, trigger, index or view rule that depends on a
  -- PostGIS-family object, resolved to the relation it belongs to (extension-owned relations excluded).
  with members as (
    select d.classid, d.objid from pg_depend d
    where d.refclassid = 'pg_extension'::regclass and d.deptype = 'e'
      and d.refobjid in (select x.oid from pg_extension x
                         where x.extname in ('postgis', 'postgis_topology', 'postgis_raster', 'postgis_sfcgal', 'postgis_tiger_geocoder'))
  ), ext_members as (
    select d.classid, d.objid from pg_depend d
    where d.refclassid = 'pg_extension'::regclass and d.deptype = 'e'
  ), postgis_types as (
    select m.objid as typ from members m where m.classid = 'pg_type'::regclass
  )
  select string_agg(s.x, '; ' order by s.x)
  into v_dependents
  from (
    select format('column %s.%I', a.attrelid::regclass, a.attname) as x
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_type t on t.oid = a.atttypid
    where a.attnum > 0 and not a.attisdropped
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'c')
      and (t.oid in (select typ from postgis_types)
           or t.typelem in (select typ from postgis_types)
           or t.typbasetype in (select typ from postgis_types))
      -- An extension's composite types are members through their pg_type row, its tables through pg_class.
      and not exists (select 1 from ext_members e
                      where (e.classid = 'pg_class'::regclass and e.objid = c.oid)
                         or (e.classid = 'pg_type'::regclass and e.objid = c.reltype))
    union all
    select format('function %s', p.oid::regprocedure)
    from pg_proc p
    where not exists (select 1 from ext_members e where e.classid = 'pg_proc'::regclass and e.objid = p.oid)
      and exists (
        select 1 from pg_type t
        where t.oid = any (array[p.prorettype] || p.proargtypes::oid[])
          and (t.oid in (select typ from postgis_types) or t.typelem in (select typ from postgis_types)
               or t.typbasetype in (select typ from postgis_types)))
    union all
    select format('domain constraint %s on %s', c.conname, c.contypid::regtype)
    from pg_depend d
    join pg_constraint c on d.classid = 'pg_constraint'::regclass and d.objid = c.oid and c.contypid <> 0
    where (d.refclassid, d.refobjid) in (select m.classid, m.objid from members m)
      and not exists (select 1 from ext_members e where e.classid = 'pg_type'::regclass and e.objid = c.contypid)
    union all
    select format('extension %s (requires PostGIS)', x.extname)
    from pg_depend d
    join pg_extension x on d.classid = 'pg_extension'::regclass and d.objid = x.oid
    where d.refclassid = 'pg_extension'::regclass and d.refobjid = v_postgis and d.deptype = 'n'
      and x.extname not in ('postgis_topology', 'postgis_raster', 'postgis_sfcgal', 'postgis_tiger_geocoder')
    union all
    select pg_describe_object(d.classid, d.objid, 0)
    from pg_depend d
    cross join lateral (
      select case d.classid
        when 'pg_constraint'::regclass then (select c.conrelid from pg_constraint c where c.oid = d.objid)
        when 'pg_attrdef'::regclass    then (select a.adrelid from pg_attrdef a where a.oid = d.objid)
        when 'pg_policy'::regclass     then (select p.polrelid from pg_policy p where p.oid = d.objid)
        when 'pg_trigger'::regclass    then (select t.tgrelid from pg_trigger t where t.oid = d.objid)
        when 'pg_rewrite'::regclass    then (select r.ev_class from pg_rewrite r where r.oid = d.objid)
        when 'pg_class'::regclass      then (select i.indrelid from pg_index i where i.indexrelid = d.objid)
      end as owner_rel
    ) o
    where d.deptype in ('n', 'a')
      and (d.refclassid, d.refobjid) in (select m.classid, m.objid from members m)
      and o.owner_rel is not null and o.owner_rel <> 0
      and not exists (select 1 from ext_members e where e.classid = 'pg_class'::regclass and e.objid = o.owner_rel)
  ) s;
  if v_dependents is not null then
    raise exception 'refusing to drop PostGIS: objects outside its extensions depend on it (%)', left(v_dependents, 400)
      using errcode = '2BP01',
            hint = 'Nothing was changed. PostGIS is only relocated in an empty disposable database.';
  end if;

  execute 'drop extension if exists postgis_tiger_geocoder cascade';
  execute 'drop extension if exists postgis_topology cascade';
  execute 'drop extension postgis cascade';
end
$$;

create extension if not exists postgis with schema extensions;
create extension if not exists btree_gist with schema extensions;
create schema if not exists marketplace;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin noinherit nobypassrls', r);
    end if;
    execute format('grant %I to %I', r, current_user);
  end loop;
end
$$;

-- Guard helper for public-facing text columns: blocks accidental disclosure of
-- high-precision lat/lon coordinate pairs (4+ decimal places) or gate/padlock
-- combinations in public landing/job fields, while allowing legitimate
-- business-contact information (office phone numbers, emails, highway numbers).
create function marketplace.contains_sensitive_access_pattern(p_text text)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_text is null then false
    else p_text ~ '[-+]?[0-9]{1,2}\.[0-9]{4,}\s*[,;/\s]\s*[-+]?[0-9]{1,3}\.[0-9]{4,}'
      or p_text ~* '\m(gate\s*(code|combo|pin|combination)|lock\s*(code|combo|combination)|padlock\s*(code|combo)|combo\s*[:#]\s*[0-9a-z-]+)\M'
  end
$$;

-- -----------------------------------------------------------------------------
-- Identity: users are LogLoads records; external identities are linked to them.
-- -----------------------------------------------------------------------------

-- Explicit allowlist of JWT issuers (Supabase Clerk third-party auth).
-- An unlisted or disabled issuer resolves no user. When expected_audience is
-- set, the JWT `aud` claim must also match.
create table marketplace.trusted_identity_issuers (
  issuer             text primary key check (char_length(issuer) between 8 and 300),
  label              text not null,
  expected_audience  text check (expected_audience is null or char_length(expected_audience) between 1 and 200),
  enabled            boolean not null default true,
  created_at         timestamptz not null default now()
);

create table marketplace.app_users (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null check (char_length(btrim(display_name)) between 1 and 120),
  avatar_path   text check (char_length(avatar_path) <= 300), -- private Storage object key, never a URL
  bio           text check (char_length(bio) <= 2000),
  status        text not null default 'active' check (status in ('active', 'suspended', 'deactivated')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table marketplace.identity_links (
  issuer      text not null references marketplace.trusted_identity_issuers (issuer),
  subject     text not null check (char_length(subject) between 1 and 255), -- Clerk user id (`sub`)
  user_id     uuid not null references marketplace.app_users (id),
  created_at  timestamptz not null default now(),
  primary key (issuer, subject),
  unique (user_id, issuer)
);

-- Personal contact data is split out so it can be locked to self + support.
create table marketplace.user_contacts (
  user_id            uuid primary key references marketplace.app_users (id),
  email              text check (email = lower(email) and position('@' in email) > 1),
  phone              text check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  email_verified_at  timestamptz,
  updated_at         timestamptz not null default now()
);
create unique index user_contacts_email_uq on marketplace.user_contacts (email) where email is not null;

-- Resolve the caller from Supabase-verified Clerk JWT claims.
-- Two-layer trust boundary (Supabase native Clerk third-party auth):
--   Layer 1 (Supabase Auth / PostgREST gateway): verifies the Clerk RS256
--     signature against Clerk's JWKS and switches the DB role to `authenticated`.
--   Layer 2 (SQL claim inspection here): never treats missing required claims
--     as valid. Requires non-empty `iss`, non-empty `sub`, explicit
--     `role = 'authenticated'`, a present numeric future `exp` claim, optional
--     valid `nbf <= now()`, matching `expected_audience` when pinned, and an
--     active `identity_links -> app_users` mapping.
create function marketplace.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  with c as (
    select nullif(current_setting('request.jwt.claims', true), '')::jsonb as claims
  )
  select l.user_id
  from c
  join marketplace.identity_links l
    on l.issuer = c.claims ->> 'iss' and l.subject = c.claims ->> 'sub'
  join marketplace.trusted_identity_issuers i on i.issuer = l.issuer and i.enabled
  join marketplace.app_users u on u.id = l.user_id and u.status = 'active'
  where c.claims is not null
    and char_length(btrim(coalesce(c.claims ->> 'iss', ''))) > 0
    and char_length(btrim(coalesce(c.claims ->> 'sub', ''))) > 0
    and c.claims ->> 'role' = 'authenticated'
    and c.claims ->> 'exp' is not null
    and (c.claims ->> 'exp') ~ '^[0-9]+(\.[0-9]+)?$'
    and to_timestamp((c.claims ->> 'exp')::double precision) > now()
    and (c.claims ->> 'nbf' is null
         or ((c.claims ->> 'nbf') ~ '^[0-9]+(\.[0-9]+)?$'
             and to_timestamp((c.claims ->> 'nbf')::double precision) <= now()))
    and (i.expected_audience is null
         or c.claims ->> 'aud' = i.expected_audience
         or (jsonb_typeof(c.claims -> 'aud') = 'array' and (c.claims -> 'aud') ? i.expected_audience))
$$;

-- Platform staff privileges are a separate table, never an organization role.
create table marketplace.platform_admins (
  user_id     uuid primary key references marketplace.app_users (id),
  admin_role  text not null check (admin_role in ('support', 'moderator', 'billing', 'superadmin')),
  granted_by  uuid references marketplace.app_users (id),
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  note        text check (char_length(note) <= 300)
);

-- -----------------------------------------------------------------------------
-- Organizations and memberships. One org model for landing operators and
-- hauling businesses; "fleet" is just a hauling org with several units/users.
-- -----------------------------------------------------------------------------

create table marketplace.organizations (
  id                   uuid primary key default gen_random_uuid(),
  display_name         text not null check (char_length(btrim(display_name)) between 1 and 160),
  legal_name           text check (char_length(legal_name) <= 200),
  slug                 text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  home_state           char(2) check (home_state ~ '^[A-Z]{2}$'),
  verification_status  text not null default 'unverified'
                       check (verification_status in ('unverified', 'pending', 'verified', 'rejected')),
  verified_at          timestamptz,
  verified_by          uuid references marketplace.app_users (id),
  status               text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  created_by           uuid not null references marketplace.app_users (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check ((verification_status = 'verified') = (verified_at is not null))
);

-- Roles: owner (billing, team), manager (landings, postings, invitations,
-- boosts, equipment), staff (postings, inquiries, equipment), driver (hauler
-- login).
-- `landing_workspace_seat` separates paid Landing Operator workspace seats
-- from free Hauler/Fleet workspace seats on dual-mode companies:
--   * Owners (`role = 'owner'`) always hold `landing_workspace_seat = true`.
--   * Drivers (`role = 'driver'`) always have `landing_workspace_seat = false`
--     and never consume paid landing seats.
--   * Managers and staff have `landing_workspace_seat = true` when authorized
--     for Landing Operator operations (counting toward the 2/5/10 plan limit),
--     or `landing_workspace_seat = false` when they are free fleet-only staff
--     (blocked by RLS from all Landing Operator actions).
create table marketplace.organization_memberships (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references marketplace.organizations (id),
  user_id                 uuid not null references marketplace.app_users (id),
  role                    text not null check (role in ('owner', 'manager', 'staff', 'driver')),
  landing_workspace_seat  boolean not null default true,
  status                  text not null default 'invited' check (status in ('invited', 'active', 'suspended', 'removed')),
  invited_by              uuid references marketplace.app_users (id) default marketplace.current_user_id(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  ended_at                timestamptz,
  check ((status = 'removed') = (ended_at is not null)),
  check (role <> 'owner' or landing_workspace_seat),
  check (role <> 'driver' or not landing_workspace_seat)
);
create unique index organization_memberships_live_uq
  on marketplace.organization_memberships (org_id, user_id) where status <> 'removed';
create index organization_memberships_user_idx
  on marketplace.organization_memberships (user_id) where status = 'active';

-- Per-user notification channels, scoped to the org they act for.
create table marketplace.notification_preferences (
  user_id     uuid not null references marketplace.app_users (id),
  org_id      uuid not null references marketplace.organizations (id),
  category    text not null check (category in ('job_alert', 'targeted_invitation', 'inquiry_reply')),
  channel     text not null check (channel in ('in_app', 'email')),
  enabled     boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (user_id, org_id, category, channel)
);

-- -----------------------------------------------------------------------------
-- Hauler profile, personal qualifications, equipment, availability
-- -----------------------------------------------------------------------------

-- Existence of this row = the org has the (free) hauling capability.
-- founding_hauler_number models Blueprint §8.2 (first 1,000 haulers badge,
-- recognition only, never a paid plan or safety/insurance verification).
create table marketplace.hauler_profiles (
  org_id                        uuid primary key references marketplace.organizations (id),
  headline                      text check (char_length(headline) <= 160),
  description                   text check (char_length(description) <= 4000),
  base_area_label               text check (char_length(base_area_label) <= 120),
  service_center                extensions.geography(Point, 4326), -- coarse ~11 km grid; snapped by trigger
  service_radius_miles          integer check (service_radius_miles between 5 and 500),
  operating_states              char(2)[] not null default '{}',
  is_public                     boolean not null default true,
  accepts_targeted_invitations  boolean not null default false,
  invitation_consent_at         timestamptz,
  invitation_consent_by         uuid references marketplace.app_users (id),
  max_invitations_per_week      smallint not null default 5 check (max_invitations_per_week between 1 and 50),
  founding_hauler_number        smallint unique check (founding_hauler_number between 1 and 1000),
  founding_hauler_granted_at    timestamptz,
  last_confirmed_at             timestamptz not null default now(),
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  check (not accepts_targeted_invitations or invitation_consent_at is not null),
  check ((founding_hauler_number is not null) = (founding_hauler_granted_at is not null))
);
create index hauler_profiles_service_center_gix
  on marketplace.hauler_profiles using gist (service_center) where is_public;

-- Self-reported unless reviewed_at is set by a platform admin.
create table marketplace.user_qualifications (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references marketplace.app_users (id),
  kind                 text not null check (kind in ('cdl', 'endorsement', 'certification', 'training', 'experience', 'other')),
  label                text not null check (char_length(label) between 1 and 160),
  issuing_region       text check (char_length(issuing_region) <= 80),
  expires_on           date,
  evidence_path        text check (char_length(evidence_path) <= 300), -- private Storage object key
  verification_status  text not null default 'self_reported'
                       check (verification_status in ('self_reported', 'verified', 'rejected')),
  reviewed_by          uuid references marketplace.app_users (id),
  reviewed_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check ((verification_status = 'self_reported') = (reviewed_at is null))
);
create index user_qualifications_user_idx on marketplace.user_qualifications (user_id);

create table marketplace.equipment_types (
  code        text primary key check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  category    text not null check (category in ('truck', 'trailer', 'attachment')),
  label       text not null,
  is_active   boolean not null default true,
  sort_order  smallint not null default 100
);

-- Trucks, trailers and attachments share one table, typed by equipment_types.
create table marketplace.equipment_units (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references marketplace.organizations (id),
  equipment_code  text not null references marketplace.equipment_types (code),
  unit_label      text not null check (char_length(unit_label) between 1 and 60),
  make            text check (char_length(make) <= 60),
  model           text check (char_length(model) <= 60),
  model_year      smallint check (model_year between 1950 and 2100),
  axle_count      smallint check (axle_count between 1 and 12),
  capacity_note   text check (char_length(capacity_note) <= 200),
  photo_path      text check (char_length(photo_path) <= 300),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, unit_label)
);
create index equipment_units_code_idx on marketplace.equipment_units (equipment_code, org_id) where is_active;

-- Self-reported capacity: "N trucks of type X around here between dates".
-- Never inferred from online presence; always timestamped.
create table marketplace.availability_reports (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references marketplace.organizations (id),
  equipment_code   text not null references marketplace.equipment_types (code),
  available_count  integer not null check (available_count between 1 and 500),
  area_center      extensions.geography(Point, 4326) not null, -- snapped by trigger
  area_label       text check (char_length(area_label) <= 120),
  radius_miles     integer not null check (radius_miles between 5 and 500),
  available_from   date not null,
  available_until  date not null,
  note             text check (char_length(note) <= 500),
  reported_by      uuid not null references marketplace.app_users (id) default marketplace.current_user_id(),
  reported_at      timestamptz not null default now(),
  withdrawn_at     timestamptz,
  check (available_until >= available_from),
  check (available_until <= available_from + 90)
);
create index availability_reports_area_gix
  on marketplace.availability_reports using gist (area_center) where withdrawn_at is null;
create index availability_reports_code_idx
  on marketplace.availability_reports (equipment_code, available_until) where withdrawn_at is null;
create index availability_reports_org_idx on marketplace.availability_reports (org_id, reported_at desc);

-- -----------------------------------------------------------------------------
-- Landings and job postings
-- -----------------------------------------------------------------------------

-- Public row: safe to show anyone. Private access details live separately.
-- Public text fields are checked against contains_sensitive_access_pattern
-- and public_point is snapped to a coarse ~11 km grid cell center by trigger.
create table marketplace.landings (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references marketplace.organizations (id),
  name               text not null check (char_length(btrim(name)) between 1 and 120
                                          and not marketplace.contains_sensitive_access_pattern(name)),
  status             text not null default 'inactive' check (status in ('inactive', 'active', 'archived')),
  public_area_label  text not null check (char_length(public_area_label) between 1 and 120
                                          and not marketplace.contains_sensitive_access_pattern(public_area_label)),
  public_point       extensions.geography(Point, 4326) not null, -- snapped to ~11 km grid center by trigger
  state_code         char(2) not null check (state_code ~ '^[A-Z]{2}$'),
  county             text check (char_length(county) <= 80),
  activated_at       timestamptz,
  created_by         uuid not null references marketplace.app_users (id) default marketplace.current_user_id(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, org_id) -- target for tenant-consistent composite foreign keys
);
create index landings_org_idx on marketplace.landings (org_id, status);
create index landings_public_point_gix on marketplace.landings using gist (public_point) where status = 'active';

create table marketplace.landing_private_details (
  landing_id          uuid primary key,
  org_id              uuid not null,
  exact_point         extensions.geography(Point, 4326),
  directions          text check (char_length(directions) <= 4000),
  gate_instructions   text check (char_length(gate_instructions) <= 2000),
  site_contact_name   text check (char_length(site_contact_name) <= 120),
  site_contact_phone  text check (site_contact_phone ~ '^\+[1-9][0-9]{6,14}$'),
  updated_by          uuid references marketplace.app_users (id) default marketplace.current_user_id(),
  updated_at          timestamptz not null default now(),
  foreign key (landing_id, org_id) references marketplace.landings (id, org_id)
);

create table marketplace.job_postings (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null,
  landing_id         uuid not null,
  title              text not null check (char_length(btrim(title)) between 3 and 140
                                          and not marketplace.contains_sensitive_access_pattern(title)),
  description        text check (char_length(description) <= 6000
                                 and not marketplace.contains_sensitive_access_pattern(description)),
  product            text check (char_length(product) <= 120),           -- e.g. "Doug-fir sawlogs"
  destination_label  text check (char_length(destination_label) <= 160
                                 and not marketplace.contains_sensitive_access_pattern(destination_label)),
  est_one_way_miles  integer check (est_one_way_miles between 1 and 1000),
  est_daily_loads    integer check (est_daily_loads between 1 and 500),
  est_tons_per_load  numeric(5, 1) check (est_tons_per_load > 0 and est_tons_per_load <= 100),
  pay_amount_cents   bigint check (pay_amount_cents > 0),
  pay_unit           text check (pay_unit in ('per_ton', 'per_mbf', 'per_cord', 'per_load', 'per_mile', 'per_hour', 'per_day', 'flat_rate', 'negotiable', 'other')),
  pay_note           text check (char_length(pay_note) <= 300
                                 and not marketplace.contains_sensitive_access_pattern(pay_note)),
  public_road_notes  text check (char_length(public_road_notes) <= 1000
                                 and not marketplace.contains_sensitive_access_pattern(public_road_notes)),
  trucks_requested   integer not null default 1 check (trucks_requested between 1 and 9999), -- unmetered; sanity bound only
  work_starts_on     date,
  work_ends_on       date,
  status             text not null default 'draft'
                     check (status in ('draft', 'active', 'paused', 'filled', 'closed', 'expired')),
  published_at       timestamptz,
  last_confirmed_at  timestamptz,
  expires_at         timestamptz,
  created_by         uuid not null references marketplace.app_users (id) default marketplace.current_user_id(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  search_document    tsvector generated always as (
                       to_tsvector('english'::regconfig,
                         coalesce(title, '') || ' ' || coalesce(product, '') || ' ' || coalesce(description, ''))
                     ) stored,
  unique (id, org_id),
  foreign key (landing_id, org_id) references marketplace.landings (id, org_id),
  -- Pay transparency (Item 9):
  --   * When pay_unit is 'negotiable', pay_amount_cents must be NULL and pay_note must explain the terms.
  --   * When pay_unit is any unit rate ('per_ton', 'per_load', etc.), pay_amount_cents must be > 0.
  --   * Drafts may omit both (pay_unit IS NULL AND pay_amount_cents IS NULL); publishing an
  --     active job without pay_unit is blocked by tg_job_guard unless the founder explicitly
  --     enables `app.allow_unquoted_active_jobs = 'true'` to resolve Blueprint §5.2 vs UX Spec §5.1.3.
  check (
    (pay_unit is null and pay_amount_cents is null)
    or (pay_unit = 'negotiable' and pay_amount_cents is null and pay_note is not null and char_length(btrim(pay_note)) >= 3)
    or (pay_unit is not null and pay_unit <> 'negotiable' and pay_amount_cents is not null and pay_amount_cents > 0)
  ),
  check (status = 'draft' or published_at is not null),
  check (work_ends_on is null or work_starts_on is null or work_ends_on >= work_starts_on)
);
create index job_postings_status_idx on marketplace.job_postings (status, last_confirmed_at desc);
create index job_postings_landing_idx on marketplace.job_postings (landing_id, status);
create index job_postings_org_idx on marketplace.job_postings (org_id, status);
create index job_postings_search_gin on marketplace.job_postings using gin (search_document);

create table marketplace.job_posting_equipment (
  job_id          uuid not null references marketplace.job_postings (id),
  equipment_code  text not null references marketplace.equipment_types (code),
  primary key (job_id, equipment_code)
);
create index job_posting_equipment_code_idx on marketplace.job_posting_equipment (equipment_code, job_id);

-- Pro+ feature (`posting_templates`). Payload is a small posting draft.
create table marketplace.job_templates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references marketplace.organizations (id),
  name        text not null check (char_length(name) between 1 and 80),
  template    jsonb not null check (jsonb_typeof(template) = 'object' and octet_length(template::text) <= 16384),
  created_by  uuid not null references marketplace.app_users (id) default marketplace.current_user_id(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index job_templates_org_idx on marketplace.job_templates (org_id);

-- Haulers save job searches for free; truck searches/alerts are Pro+ features.
create table marketplace.saved_searches (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references marketplace.organizations (id),
  owner_user_id    uuid not null references marketplace.app_users (id) default marketplace.current_user_id(),
  kind             text not null check (kind in ('jobs', 'trucks')),
  name             text not null check (char_length(name) between 1 and 80),
  criteria         jsonb not null check (jsonb_typeof(criteria) = 'object' and octet_length(criteria::text) <= 4096),
  alerts_enabled   boolean not null default false,
  last_alerted_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index saved_searches_owner_idx on marketplace.saved_searches (owner_user_id, org_id);
create index saved_searches_alerts_idx on marketplace.saved_searches (kind) where alerts_enabled;

-- -----------------------------------------------------------------------------
-- Expressions of interest (unlimited, never metered) and lightweight replies
-- -----------------------------------------------------------------------------

create table marketplace.expressions_of_interest (
  id                         uuid primary key default gen_random_uuid(),
  job_id                     uuid not null,
  job_org_id                 uuid not null,
  hauler_org_id              uuid not null references marketplace.organizations (id),
  submitted_by               uuid not null references marketplace.app_users (id) default marketplace.current_user_id(),
  trucks_offered             integer not null default 1 check (trucks_offered between 1 and 500),
  available_from             date,
  available_until            date,
  message                    text check (char_length(message) <= 2000),
  contact_preference         text not null default 'in_app'
                             check (contact_preference in ('in_app', 'phone', 'email')),
  status                     text not null default 'submitted'
                             check (status in ('submitted', 'viewed', 'replied', 'declined', 'withdrawn')),
  responded_at               timestamptz,
  withdrawn_at               timestamptz,
  private_details_shared_at  timestamptz,
  private_details_shared_by  uuid references marketplace.app_users (id),
  source_invitation_id       uuid, -- FK added below, after targeted_invitations
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  foreign key (job_id, job_org_id) references marketplace.job_postings (id, org_id),
  check (hauler_org_id <> job_org_id),
  check ((status = 'withdrawn') = (withdrawn_at is not null)),
  check (available_until is null or available_from is null or available_until >= available_from)
);
create unique index expressions_of_interest_live_uq
  on marketplace.expressions_of_interest (job_id, hauler_org_id) where status <> 'withdrawn';
create index expressions_of_interest_job_org_idx
  on marketplace.expressions_of_interest (job_org_id, status, created_at desc);
create index expressions_of_interest_hauler_idx
  on marketplace.expressions_of_interest (hauler_org_id, created_at desc);

create table marketplace.interest_messages (
  id              uuid primary key default gen_random_uuid(),
  interest_id     uuid not null references marketplace.expressions_of_interest (id),
  author_user_id  uuid not null references marketplace.app_users (id) default marketplace.current_user_id(),
  author_side     text not null check (author_side in ('hauler', 'landing')),
  body            text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at      timestamptz not null default now()
);
create index interest_messages_interest_idx on marketplace.interest_messages (interest_id, created_at);

-- -----------------------------------------------------------------------------
-- Plans, promotions, subscriptions, billing-cycle allowances
-- Prices/limits are rows, never constants in functions or policies.
-- -----------------------------------------------------------------------------

create table marketplace.subscription_plans (
  id                      uuid primary key default gen_random_uuid(),
  code                    text not null check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  version                 integer not null check (version > 0),
  name                    text not null,
  status                  text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  monthly_price_cents     integer not null check (monthly_price_cents >= 0),
  currency                char(3) not null default 'USD',
  max_active_landings     integer check (max_active_landings > 0), -- NULL = unlimited (fair use)
  max_team_members        integer not null check (max_team_members > 0),
  monthly_invitations     integer not null check (monthly_invitations >= 0),
  -- Provisional operational defaults (Item 8 — configurable data, NOT immutable founder policy):
  past_due_grace_days                     smallint not null default 7 check (past_due_grace_days between 0 and 60),
  invitation_dedupe_days                  smallint default 30 check (invitation_dedupe_days is null or invitation_dedupe_days between 1 and 365),
  invitation_reservation_timeout_minutes  smallint not null default 15 check (invitation_reservation_timeout_minutes between 1 and 1440),
  features                                text[] not null default '{}',
  provider_price_ref      text, -- test-mode price id once configured; NULL in this prototype
  created_at              timestamptz not null default now(),
  unique (code, version)
);
create unique index subscription_plans_one_active_uq on marketplace.subscription_plans (code) where status = 'active';

create table marketplace.promotions (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique check (code ~ '^[a-z][a-z0-9_]{1,60}$'),
  program              text not null check (program ~ '^[a-z][a-z0-9_]{1,40}$'), -- e.g. founding_landing
  state_code           char(2) check (state_code ~ '^[A-Z]{2}$'),
  percent_off          numeric(5, 2) not null check (percent_off > 0 and percent_off <= 100),
  billing_cycles       integer not null check (billing_cycles between 1 and 36),
  max_redemptions      integer check (max_redemptions > 0),
  starts_at            timestamptz not null,
  ends_at              timestamptz,
  status               text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  provider_coupon_ref  text,
  created_at           timestamptz not null default now(),
  unique (id, program)
);

create table marketplace.promotion_redemptions (
  id              uuid primary key default gen_random_uuid(),
  promotion_id    uuid not null,
  program         text not null,
  org_id          uuid not null references marketplace.organizations (id),
  granted_by      uuid not null references marketplace.app_users (id),
  granted_at      timestamptz not null default now(),
  cycles_applied  integer not null default 0 check (cycles_applied >= 0),
  status          text not null default 'granted' check (status in ('granted', 'applied', 'exhausted', 'revoked')),
  foreign key (promotion_id, program) references marketplace.promotions (id, program),
  unique (program, org_id) -- one founding offer per organization, across all states
);
create index promotion_redemptions_promo_idx on marketplace.promotion_redemptions (promotion_id, status);

-- `past_due` access requires an explicit bounded grace window (`grace_ends_at`);
-- once `now() >= grace_ends_at` (or `now() >= current_period_end` on active),
-- plan entitlements cease until a new paid cycle is opened.
create table marketplace.organization_subscriptions (
  id                         uuid primary key default gen_random_uuid(),
  org_id                     uuid not null references marketplace.organizations (id),
  plan_id                    uuid not null references marketplace.subscription_plans (id),
  status                     text not null check (status in ('incomplete', 'trialing', 'active', 'past_due', 'canceled')),
  current_period_start       timestamptz not null,
  current_period_end         timestamptz not null,
  past_due_since             timestamptz,
  grace_ends_at              timestamptz,
  cancel_at_period_end       boolean not null default false,
  promotion_redemption_id    uuid references marketplace.promotion_redemptions (id),
  provider                   text check (provider in ('stripe')),
  provider_customer_ref      text,
  provider_subscription_ref  text unique,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  canceled_at                timestamptz,
  check (current_period_end > current_period_start),
  check ((status = 'past_due') = (past_due_since is not null and grace_ends_at is not null)),
  check (grace_ends_at is null or grace_ends_at > past_due_since)
);
create unique index organization_subscriptions_live_uq
  on marketplace.organization_subscriptions (org_id) where status <> 'canceled';

-- One row per org per billing cycle. A new cycle is a new row starting at 0,
-- which is the whole "reset without rollover" mechanism.
create table marketplace.entitlement_periods (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references marketplace.organizations (id),
  subscription_id        uuid not null references marketplace.organization_subscriptions (id),
  plan_id                uuid not null references marketplace.subscription_plans (id),
  period_start           timestamptz not null,
  period_end             timestamptz not null,
  invitation_allowance   integer not null check (invitation_allowance >= 0),
  invitations_committed  integer not null default 0, -- reserved + delivered; failed/suppressed are released
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (period_end > period_start),
  check (invitations_committed between 0 and invitation_allowance),
  unique (subscription_id, period_start),
  exclude using gist (org_id with =, tstzrange(period_start, period_end, '[)') with &&)
);

-- -----------------------------------------------------------------------------
-- Targeted invitations and delivery attempts
-- -----------------------------------------------------------------------------

create table marketplace.targeted_invitations (
  id                     uuid primary key default gen_random_uuid(),
  job_id                 uuid not null,
  sender_org_id          uuid not null,
  recipient_org_id       uuid not null references marketplace.organizations (id),
  sent_by                uuid not null references marketplace.app_users (id),
  entitlement_period_id  uuid not null references marketplace.entitlement_periods (id),
  -- reserved/delivered count against the allowance; failed/suppressed do not.
  status                 text not null default 'reserved' check (status in ('reserved', 'delivered', 'failed', 'suppressed')),
  note                   text check (char_length(note) <= 500),
  failure_reason         text check (char_length(failure_reason) <= 200),
  recipient_response     text not null default 'none' check (recipient_response in ('none', 'viewed', 'interested', 'declined')),
  created_at             timestamptz not null default now(),
  delivered_at           timestamptz,
  resolved_at            timestamptz,
  responded_at           timestamptz,
  foreign key (job_id, sender_org_id) references marketplace.job_postings (id, org_id),
  check (recipient_org_id <> sender_org_id),
  check ((status = 'reserved') = (resolved_at is null)),
  check ((status = 'delivered') = (delivered_at is not null))
);
-- Dedupe without permanently blocking 8-month jobs across later billing cycles:
--   1. At most one in-flight `reserved` invitation per (job, recipient) at a time.
--   2. At most one committed (`reserved` or `delivered`) invitation per
--      (entitlement_period_id, job_id, recipient_org_id).
--   3. Configurable rolling `p_dedupe_window` (default 30 days) enforced under
--      recipient advisory lock in `reserve_targeted_invitation`.
create unique index targeted_invitations_reserved_uq
  on marketplace.targeted_invitations (job_id, recipient_org_id) where status = 'reserved';
create unique index targeted_invitations_period_dedupe_uq
  on marketplace.targeted_invitations (entitlement_period_id, job_id, recipient_org_id)
  where status in ('reserved', 'delivered');
create index targeted_invitations_recipient_idx on marketplace.targeted_invitations (recipient_org_id, created_at desc);
create index targeted_invitations_sender_idx on marketplace.targeted_invitations (sender_org_id, created_at desc);
create index targeted_invitations_period_idx on marketplace.targeted_invitations (entitlement_period_id);
create index targeted_invitations_reserved_idx on marketplace.targeted_invitations (created_at) where status = 'reserved';

alter table marketplace.expressions_of_interest
  add constraint expressions_of_interest_source_invitation_fk
  foreign key (source_invitation_id) references marketplace.targeted_invitations (id);

create table marketplace.invitation_deliveries (
  id                    uuid primary key default gen_random_uuid(),
  invitation_id         uuid not null references marketplace.targeted_invitations (id),
  channel               text not null check (channel in ('in_app', 'email')),
  recipient_user_id     uuid not null references marketplace.app_users (id),
  status                text not null default 'pending' check (status in ('pending', 'sent', 'delivered', 'failed', 'bounced')),
  provider_message_ref  text,
  detail                text check (char_length(detail) <= 200),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (invitation_id, channel, recipient_user_id)
);

-- -----------------------------------------------------------------------------
-- Paid job boosts (sponsored exposure only; never touch invitation allowances)
-- -----------------------------------------------------------------------------

create table marketplace.boost_products (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  version             integer not null check (version > 0),
  name                text not null,
  duration_days       integer not null check (duration_days between 1 and 90),
  price_cents         integer not null check (price_cents >= 0),
  currency            char(3) not null default 'USD',
  radius_miles        integer not null default 100 check (radius_miles between 10 and 500),
  status              text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  provider_price_ref  text,
  created_at          timestamptz not null default now(),
  unique (code, version)
);
create unique index boost_products_one_active_uq on marketplace.boost_products (code) where status = 'active';

create table marketplace.job_boosts (
  id                    uuid primary key default gen_random_uuid(),
  job_id                uuid not null,
  org_id                uuid not null,
  product_id            uuid not null references marketplace.boost_products (id),
  -- Terms frozen at purchase so later product/price changes never rewrite history.
  duration_days         integer not null check (duration_days between 1 and 90),
  price_cents           integer not null check (price_cents >= 0),
  currency              char(3) not null,
  radius_miles          integer not null check (radius_miles between 10 and 500),
  center_point          extensions.geography(Point, 4326) not null, -- landing's coarse public point
  status                text not null default 'pending_payment'
                        check (status in ('pending_payment', 'active', 'ended', 'canceled')),
  starts_at             timestamptz,
  ends_at               timestamptz,
  purchased_by          uuid not null references marketplace.app_users (id),
  provider_payment_ref  text unique,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  foreign key (job_id, org_id) references marketplace.job_postings (id, org_id),
  check ((starts_at is null) = (ends_at is null)),
  check (status not in ('active', 'ended') or starts_at is not null),
  -- Duration is fixed in 24h units so the check is independent of session TimeZone.
  check (starts_at is null or ends_at = starts_at + duration_days * interval '24 hours'),
  exclude using gist (job_id with =, tstzrange(starts_at, ends_at, '[)') with &&) where (status = 'active')
);
create index job_boosts_center_gix on marketplace.job_boosts using gist (center_point) where status = 'active';
create index job_boosts_org_idx on marketplace.job_boosts (org_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Minimal trust / audit records
-- -----------------------------------------------------------------------------

create table marketplace.abuse_reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references marketplace.app_users (id) default marketplace.current_user_id(),
  target_kind      text not null check (target_kind in ('job_posting', 'organization', 'user', 'interest_message')),
  target_id        uuid not null,
  reason           text not null check (reason in ('inaccurate_pay', 'nonexistent_job', 'spam', 'impersonation',
                                                   'unsafe_disclosure', 'abuse', 'other')),
  details          text check (char_length(details) <= 2000),
  status           text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  reviewed_by      uuid references marketplace.app_users (id),
  reviewed_at      timestamptz,
  resolution_note  text check (char_length(resolution_note) <= 1000),
  created_at       timestamptz not null default now()
);
create index abuse_reports_open_idx on marketplace.abuse_reports (created_at) where status in ('open', 'reviewing');

-- Append-only. Metadata must never contain secrets, contact data, or private
-- landing access details.
create table marketplace.audit_events (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default now(),
  actor_user_id  uuid references marketplace.app_users (id),
  actor_kind     text not null check (actor_kind in ('user', 'platform_admin', 'system')),
  org_id         uuid references marketplace.organizations (id),
  action         text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  entity_table   text not null,
  entity_id      uuid,
  reason         text check (char_length(reason) <= 500),
  metadata       jsonb not null default '{}'
                 check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 8192)
);
create index audit_events_org_idx on marketplace.audit_events (org_id, occurred_at desc);
create index audit_events_entity_idx on marketplace.audit_events (entity_table, entity_id);
