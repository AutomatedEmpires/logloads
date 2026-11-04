-- =============================================================================
-- LogLoads Normalized Database & Account Architecture (v2)
-- 07_v2_contract_tests.sql — Executable SQL & RLS verification suite for
-- `06_v2_contract_alignment.sql`, covering Known Gaps 1–4 and Founder Decisions:
--   * V2-DEC-01: Fixed 0.10-degree public coordinate quantization & privacy
--   * V2-DEC-02: Mandatory compensation on active postings & draft/legacy separation
--   * V2-DEC-03: Explicit initial availability attestation & confirmation semantics
--
-- Execution order:
--   psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f architecture/normalized-v2/01_schema.sql \
--     -f architecture/normalized-v2/02_access.sql \
--     -f architecture/normalized-v2/03_entitlements.sql \
--     -f architecture/normalized-v2/06_v2_contract_alignment.sql \
--     -f architecture/normalized-v2/07_v2_contract_tests.sql
--
-- Runs inside a single `BEGIN ... ROLLBACK` transaction so it leaves no test
-- data behind and fails immediately with nonzero exit code on any error.
-- =============================================================================

begin;

create or replace function pg_temp.as_jwt(
  p_role text,
  p_iss text default null,
  p_sub text default null,
  p_aud text default 'logloads-app',
  p_exp_offset_sec integer default 3600
) returns void
language plpgsql
as $$
declare
  v_claims jsonb;
begin
  if p_role = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  elsif p_role = 'service_role' then
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    execute 'set local role service_role';
  else
    v_claims := jsonb_build_object(
      'role', p_role,
      'iss', p_iss,
      'sub', p_sub,
      'aud', p_aud,
      'exp', extract(epoch from now())::bigint + p_exp_offset_sec
    );
    perform set_config('request.jwt.claims', v_claims::text, true);
    execute 'set local role authenticated';
  end if;
end
$$;

create or replace function pg_temp.assert_true(p_cond boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_cond is not true then
    raise exception 'TEST FAILED: %', p_label using errcode = 'P0001';
  end if;
  raise notice 'PASS: %', p_label;
end
$$;

create or replace function pg_temp.assert_errcode(p_sql text, p_expected_errcode text, p_label text)
returns void language plpgsql as $$
declare
  v_sqlstate text;
  v_msg      text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_msg = message_text;
    if v_sqlstate = p_expected_errcode then
      raise notice 'PASS: % (caught expected SQLSTATE %: %)', p_label, v_sqlstate, v_msg;
      return;
    end if;
    raise exception 'TEST FAILED: % — expected SQLSTATE %, got % (%)', p_label, p_expected_errcode, v_sqlstate, v_msg
      using errcode = 'P0001';
  end;
  raise exception 'TEST FAILED: % — expected SQLSTATE %, but statement succeeded', p_label, p_expected_errcode
    using errcode = 'P0001';
end
$$;

-- 18 (HF-18): functions created by the migration role no longer get EXECUTE for PUBLIC, and this harness runs as
-- that role. The helpers are called after SET ROLE anon / authenticated / service_role, so they are granted here.
grant execute on all functions in schema pg_temp to public;

do $$
declare
  v_issuer constant text := 'https://clerk.logloads.v2.test';

  v_u_landing_owner uuid;
  v_u_rival_owner   uuid;
  v_u_fleet_owner   uuid;
  v_u_fleet_driver  uuid;
  v_u_solo_hauler   uuid;
  v_u_superadmin    uuid;

  v_org_landing     uuid;
  v_org_rival       uuid;
  v_org_fleet       uuid;
  v_org_solo        uuid;

  v_landing_wa      uuid;
  v_landing_or      uuid;
  v_landing_null_pt uuid;
  v_landing_rival   uuid;

  v_draft_id        uuid;
  v_job_1           uuid;
  v_job_1_dup       uuid;
  v_job_neg         uuid;
  v_job_ton         uuid;
  v_job_hour        uuid;
  v_job_legacy      uuid;
  v_boost_id        uuid;

  v_interest_id     uuid;
  v_interest_id_2   uuid;
  v_solo_interest   uuid;
  v_created         boolean;
  v_reply_1         uuid := '11111111-2222-4333-8444-555555555501';
  v_reply_2         uuid := '11111111-2222-4333-8444-555555555502';
  v_reply_3         uuid := '11111111-2222-4333-8444-555555555503';

  v_lat             double precision;
  v_lng             double precision;
  v_created_at_1    timestamptz;
  v_mod_before      timestamptz;
  v_mod_after       timestamptz;
  v_conf_initial    timestamptz;
  v_conf_after_edit timestamptz;
  v_conf_reconfirm  timestamptz;
  v_conf_reconfirm2 timestamptz;
  v_rec             record;
  v_cnt             integer;
  v_before_cnt      integer;
begin
  -- ===========================================================================
  -- 1. Identity Setup & Known Gap 4 (Workspace Seats & Optional Public Profiles)
  -- ===========================================================================
  execute 'reset role';
  insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
  values (v_issuer, 'Clerk V2 Contract Test Instance', 'logloads-app', true);

  perform pg_temp.as_jwt('service_role');
  v_u_landing_owner := marketplace.sync_verified_identity(v_issuer, 'user_v2_landing_owner', 'Timber Ridge Owner', 'owner@timberridge.test', true);
  v_u_rival_owner   := marketplace.sync_verified_identity(v_issuer, 'user_v2_rival_owner',   'Rival Logging Owner', 'owner@rival.test', true);
  v_u_fleet_owner   := marketplace.sync_verified_identity(v_issuer, 'user_v2_fleet_owner',   'New River Fleet Owner', 'owner@newriver.test', true);
  v_u_fleet_driver  := marketplace.sync_verified_identity(v_issuer, 'user_v2_fleet_driver',  'New River Driver', 'driver@newriver.test', true);
  v_u_solo_hauler   := marketplace.sync_verified_identity(v_issuer, 'user_v2_solo_hauler',   'Quiet Pines Solo Hauler', 'solo@quietpines.test', true);
  v_u_superadmin    := marketplace.sync_verified_identity(v_issuer, 'user_v2_superadmin',    'LogLoads Superadmin', 'admin@logloads.test', true);

  execute 'reset role';
  insert into marketplace.platform_admins (user_id, admin_role, note)
  values (v_u_superadmin, 'superadmin', 'V2 contract test superadmin');

  -- Create Landing Operator organization (`p_enable_hauler = false`).
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_landing_owner');
  v_org_landing := marketplace.create_organization('Timber Ridge Logging', 'timber-ridge-v2', 'OR', false);

  select * into v_rec from marketplace.get_viewer_marketplace_access(v_org_landing);
  perform pg_temp.assert_true(
    v_rec.role = 'owner'
    and v_rec.landing_workspace_seat = true
    and v_rec.hauler_profile = false
    and v_rec.capabilities = array['job.publish', 'landing.manage', 'inquiry.respond'],
    'Gap 4a: Landing organization owner has landing_workspace_seat = true and exact landing capabilities'
  );

  -- Create Rival Landing Operator organization.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_rival_owner');
  v_org_rival := marketplace.create_organization('Rival Basin Timber', 'rival-basin-v2', 'WA', false);

  -- Activate Pro subscription for `v_org_landing` and Basic for `v_org_rival`.
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(
    v_org_landing, 'pro', 'active', now() - interval '1 hour', now() + interval '29 days',
    'cus_v2_land', 'sub_v2_land', false, 7
  );
  perform marketplace.open_subscription_cycle(
    v_org_rival, 'basic', 'active', now() - interval '1 hour', now() + interval '29 days',
    'cus_v2_rival', 'sub_v2_rival', false, 7
  );

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_superadmin');
  perform marketplace.admin_set_org_verification(v_org_landing, 'verified', 'Verified WA/OR timber operator');

  -- Create pure Fleet/Hauler organization (`p_enable_hauler = true`).
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_fleet_owner');
  v_org_fleet := marketplace.create_organization('New River Log Transport', 'new-river-v2', 'OR', true);

  select * into v_rec from marketplace.get_viewer_marketplace_access(v_org_fleet);
  perform pg_temp.assert_true(
    v_rec.role = 'owner'
    and v_rec.landing_workspace_seat = false
    and v_rec.hauler_profile = true
    and v_rec.capabilities = array['interest.express', 'interest.withdraw', 'interest.reply', 'equipment.manage'],
    'Gap 4b: Pure hauler/fleet owner has landing_workspace_seat = false and hauler-only capabilities'
  );

  -- Add a fleet driver (`role = 'driver'`) to `v_org_fleet`.
  insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
  values (v_org_fleet, v_u_fleet_driver, 'driver', false, 'invited');

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_fleet_driver');
  update marketplace.organization_memberships set status = 'active'
  where org_id = v_org_fleet and user_id = v_u_fleet_driver;

  select * into v_rec from marketplace.get_viewer_marketplace_access(v_org_fleet);
  perform pg_temp.assert_true(
    v_rec.role = 'driver'
    and v_rec.landing_workspace_seat = false
    and v_rec.hauler_profile = true
    and v_rec.capabilities = array['interest.express', 'interest.withdraw', 'interest.reply'],
    'Gap 4c: Fleet driver has interest capabilities without equipment.manage or landing capabilities'
  );

  -- Create a solo hauler organization that keeps `hauler_profiles.is_public = false` and 0 listed units.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_solo_hauler');
  v_org_solo := marketplace.create_organization('Quiet Pines Hauling', 'quiet-pines-v2', 'OR', true);

  perform pg_temp.assert_true(
    exists (select 1 from marketplace.hauler_profiles where org_id = v_org_solo and is_public = false),
    'Gap 4d: Newly created hauler profile defaults to is_public = false (directory opt-in)'
  );

  -- ===========================================================================
  -- 2. DECISION V2-DEC-01 — PUBLIC COORDINATE PRIVACY (Fixed 0.10-Degree Grid)
  -- ===========================================================================
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_landing_owner');

  -- 2a. Verify exact quantization of the founder's specification examples:
  --     latitude 47.654°  -> 47.7°
  --     longitude -117.457° -> -117.5°
  --     Even when caller attempts to override session precision via `set_config('app.public_coord_grid_degrees', '0.0001', true)`!
  perform set_config('app.public_coord_grid_degrees', '0.0001', true);

  insert into marketplace.landings (
    org_id, name, status, state_code, county, public_area_label, public_point
  )
  values (
    v_org_landing,
    'Spokane North Timber Landing',
    'active',
    'WA',
    'Spokane',
    'Near Deer Park, WA',
    extensions.st_setsrid(extensions.st_makepoint(-117.457, 47.654), 4326)::extensions.geography
  )
  returning id into v_landing_wa;

  insert into marketplace.landing_private_details (
    landing_id, org_id, exact_point, directions, gate_instructions, site_contact_name, site_contact_phone
  )
  values (
    v_landing_wa,
    v_org_landing,
    extensions.st_setsrid(extensions.st_makepoint(-117.457, 47.654), 4326)::extensions.geography,
    'Turn west off US-395 onto Spur 14 at milepost 22.4',
    'Padlock combo 7741',
    'Foreman Dan',
    '+15095550199'
  );

  select
    extensions.st_y(public_point::extensions.geometry),
    extensions.st_x(public_point::extensions.geometry)
  into v_lat, v_lng
  from marketplace.landings
  where id = v_landing_wa;

  perform pg_temp.assert_true(
    v_lat = 47.7
    and v_lng = -117.5
    and abs((round(v_lat * 50.0) / 50.0) - v_lat) < 1e-9
    and abs((round(v_lng * 50.0) / 50.0) - v_lng) < 1e-9,
    'V2-DEC-01 (a): 47.654° -> 47.7° and -117.457° -> -117.5° on fixed 0.10° grid; session override app.public_coord_grid_degrees is ignored and 0.02° frontend compatibility holds'
  );

  -- 2b. Verify positive and negative coordinates and boundary values (-90, 90, -180, 180).
  perform pg_temp.assert_true(
    marketplace.quantize_public_coordinate(47.654, -90.0, 90.0, 'latitude') = 47.7
    and marketplace.quantize_public_coordinate(-117.457, -180.0, 180.0, 'longitude') = -117.5
    and marketplace.quantize_public_coordinate(-43.249, -90.0, 90.0, 'latitude') = -43.2
    and marketplace.quantize_public_coordinate(122.851, -180.0, 180.0, 'longitude') = 122.9
    and marketplace.quantize_public_coordinate(90.0, -90.0, 90.0, 'latitude') = 90.0
    and marketplace.quantize_public_coordinate(-90.0, -90.0, 90.0, 'latitude') = -90.0
    and marketplace.quantize_public_coordinate(180.0, -180.0, 180.0, 'longitude') = 180.0
    and marketplace.quantize_public_coordinate(-180.0, -180.0, 180.0, 'longitude') = -180.0,
    'V2-DEC-01 (b): Positive, negative, and boundary coordinates quantize accurately to nearest 0.10°'
  );

  -- 2c. Verify out-of-bounds coordinates are rejected with SQLSTATE 22023 and create no landing row.
  select count(*) into v_before_cnt from marketplace.landings;

  perform pg_temp.assert_errcode(
    $sql$select marketplace.make_public_point(-117.457, 90.1)$sql$,
    '22023',
    'V2-DEC-01 (c1): Latitude > 90° rejected with 22023'
  );

  perform pg_temp.assert_errcode(
    $sql$select marketplace.make_public_point(-117.457, -90.1)$sql$,
    '22023',
    'V2-DEC-01 (c2): Latitude < -90° rejected with 22023'
  );

  perform pg_temp.assert_errcode(
    $sql$select marketplace.make_public_point(-180.1, 47.654)$sql$,
    '22023',
    'V2-DEC-01 (c3): Longitude < -180° rejected with 22023'
  );

  perform pg_temp.assert_errcode(
    $sql$select marketplace.make_public_point(180.1, 47.654)$sql$,
    '22023',
    'V2-DEC-01 (c4): Longitude > 180° rejected with 22023'
  );

  perform pg_temp.assert_errcode(
    $sql$select marketplace.make_public_point(null, 47.654)$sql$,
    '22023',
    'V2-DEC-01 (c5): Half-null coordinate pair rejected with 22023'
  );

  select count(*) into v_cnt from marketplace.landings;
  perform pg_temp.assert_true(
    v_cnt = v_before_cnt,
    'V2-DEC-01 (c6): Failed coordinate validations did not mutate landings table'
  );

  -- 2d. Verify second active landing in Oregon (`43.746321, -122.478912` -> `43.7, -122.5`)
  --     and a third active landing with `public_point = NULL` (nullable coordinates).
  insert into marketplace.landings (
    org_id, name, status, state_code, county, public_area_label, public_point
  )
  values (
    v_org_landing,
    'North Fork Tract 9',
    'active',
    'OR',
    'Lane',
    'Near Oakridge, OR',
    extensions.st_setsrid(extensions.st_makepoint(-122.478912, 43.746321), 4326)::extensions.geography
  )
  returning id into v_landing_or;

  insert into marketplace.landing_private_details (
    landing_id, org_id, exact_point, directions, gate_instructions, site_contact_name, site_contact_phone
  )
  values (
    v_landing_or,
    v_org_landing,
    extensions.st_setsrid(extensions.st_makepoint(-122.478912, 43.746321), 4326)::extensions.geography,
    'Milepost 14.2 off FS Road 19, lock gate behind you',
    'GATE-9941',
    'Foreman Dan',
    '+15415559999'
  );

  insert into marketplace.landings (
    org_id, name, status, state_code, county, public_area_label, public_point
  )
  values (
    v_org_landing,
    'Unmapped Ridge Landing',
    'active',
    'OR',
    'Douglas',
    'Drain / Yoncalla Area, OR',
    null
  )
  returning id into v_landing_null_pt;

  perform pg_temp.assert_true(
    marketplace.make_public_point(null, null) is null -- granted public constructor (approximate_point is internal, ungranted)
    and exists (select 1 from marketplace.landings where id = v_landing_null_pt and public_point is null),
    'V2-DEC-01 (d): Nullable public coordinates preserved when no publishable location exists'
  );

  -- 2e. Verify cross-organization and public access restrictions on `landing_private_details`.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_rival_owner');
  select count(*) into v_cnt from marketplace.landing_private_details where landing_id in (v_landing_wa, v_landing_or);
  perform pg_temp.assert_true(
    v_cnt = 0,
    'V2-DEC-01 (e1): Rival landing organization cannot read landing_private_details'
  );

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_fleet_driver');
  select count(*) into v_cnt from marketplace.landing_private_details where landing_id in (v_landing_wa, v_landing_or);
  perform pg_temp.assert_true(
    v_cnt = 0,
    'V2-DEC-01 (e2): Unshared hauler cannot read landing_private_details'
  );

  perform pg_temp.as_jwt('anon');
  select count(*) into v_cnt from marketplace.landings where id = v_landing_wa and extensions.st_y(public_point::extensions.geometry) = 47.7;
  perform pg_temp.assert_true(
    v_cnt = 1,
    'V2-DEC-01 (e3): Anonymous user sees only quantized 0.10° public_point on active landing'
  );

  -- ===========================================================================
  -- 3. DECISION V2-DEC-02 — REQUIRED COMPENSATION INFORMATION
  --    & DECISION V2-DEC-03 — EXPLICIT INITIAL AVAILABILITY ATTESTATION
  -- ===========================================================================
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_landing_owner');

  select count(*) into v_before_cnt from marketplace.job_postings;

  -- 3a. Negative compensation tests (`V2-DEC-02`): every invalid compensation
  --     combination must fail with SQLSTATE 23514 and create zero rows.
  perform set_config('app.allow_unquoted_active_jobs', 'true', true);

  -- (1) Missing both pay_unit and pay_amount_cents (even with `app.allow_unquoted_active_jobs = 'true'`!).
  perform pg_temp.assert_errcode(
    format(
      $sql$select marketplace.publish_job_posting(
        %L::uuid, 'Unquoted Haul Attempt', array['log_truck'], 3,
        'Douglas-fir', 'Desc', null, null, null,
        2, date '2026-11-10', 10, 3.0, 6, 28.0, 'Mill', 35, null, null, '{}', true
      )$sql$,
      v_landing_or
    ),
    '23514',
    'V2-DEC-02 (a1): Active job with no pay information rejected even when app.allow_unquoted_active_jobs = true'
  );

  -- (2) Pay amount without a pay unit.
  perform pg_temp.assert_errcode(
    format(
      $sql$select marketplace.publish_job_posting(
        %L::uuid, 'Amount Without Unit Haul', array['log_truck'], 3,
        'Douglas-fir', 'Desc', null, 52500, null,
        2, date '2026-11-10', 10, 3.0, 6, 28.0, 'Mill', 35, null, null, '{}', true
      )$sql$,
      v_landing_or
    ),
    '23514',
    'V2-DEC-02 (a2): Pay amount without pay_unit rejected with 23514'
  );

  -- (3) Pay unit without an amount.
  perform pg_temp.assert_errcode(
    format(
      $sql$select marketplace.publish_job_posting(
        %L::uuid, 'Unit Without Amount Haul', array['log_truck'], 3,
        'Douglas-fir', 'Desc', 'per_load', null, null,
        2, date '2026-11-10', 10, 3.0, 6, 28.0, 'Mill', 35, null, null, '{}', true
      )$sql$,
      v_landing_or
    ),
    '23514',
    'V2-DEC-02 (a3): Fixed pay_unit without pay_amount_cents rejected with 23514'
  );

  -- (4) Zero compensation amount.
  perform pg_temp.assert_errcode(
    format(
      $sql$select marketplace.publish_job_posting(
        %L::uuid, 'Zero Pay Haul', array['log_truck'], 3,
        'Douglas-fir', 'Desc', 'per_load', 0, null,
        2, date '2026-11-10', 10, 3.0, 6, 28.0, 'Mill', 35, null, null, '{}', true
      )$sql$,
      v_landing_or
    ),
    '23514',
    'V2-DEC-02 (a4): Zero pay_amount_cents rejected with 23514'
  );

  -- (5) Negative compensation amount.
  perform pg_temp.assert_errcode(
    format(
      $sql$select marketplace.publish_job_posting(
        %L::uuid, 'Negative Pay Haul', array['log_truck'], 3,
        'Douglas-fir', 'Desc', 'per_ton', -525, null,
        2, date '2026-11-10', 10, 3.0, 6, 28.0, 'Mill', 35, null, null, '{}', true
      )$sql$,
      v_landing_or
    ),
    '23514',
    'V2-DEC-02 (a5): Negative pay_amount_cents rejected with 23514'
  );

  -- (6) Negotiable without an explanatory note.
  perform pg_temp.assert_errcode(
    format(
      $sql$select marketplace.publish_job_posting(
        %L::uuid, 'Negotiable Without Note Haul', array['log_truck'], 3,
        'Douglas-fir', 'Desc', 'negotiable', null, null,
        2, date '2026-11-10', 10, 3.0, 6, 28.0, 'Mill', 35, null, null, '{}', true
      )$sql$,
      v_landing_or
    ),
    '23514',
    'V2-DEC-02 (a6): Negotiable without pay_note rejected with 23514'
  );

  -- (7) Negotiable with whitespace-only or <3 char explanatory note.
  perform pg_temp.assert_errcode(
    format(
      $sql$select marketplace.publish_job_posting(
        %L::uuid, 'Negotiable Whitespace Note Haul', array['log_truck'], 3,
        'Douglas-fir', 'Desc', 'negotiable', null, '    ',
        2, date '2026-11-10', 10, 3.0, 6, 28.0, 'Mill', 35, null, null, '{}', true
      )$sql$,
      v_landing_or
    ),
    '23514',
    'V2-DEC-02 (a7): Negotiable with whitespace-only pay_note rejected with 23514'
  );

  perform pg_temp.assert_errcode(
    format(
      $sql$select marketplace.publish_job_posting(
        %L::uuid, 'Negotiable Two-Char Note Haul', array['log_truck'], 3,
        'Douglas-fir', 'Desc', 'negotiable', null, ' ab ',
        2, date '2026-11-10', 10, 3.0, 6, 28.0, 'Mill', 35, null, null, '{}', true
      )$sql$,
      v_landing_or
    ),
    '23514',
    'V2-DEC-02 (a8): Negotiable with <3 trimmed character pay_note rejected with 23514'
  );

  -- (8) Negotiable paired with a fixed numeric pay amount.
  perform pg_temp.assert_errcode(
    format(
      $sql$select marketplace.publish_job_posting(
        %L::uuid, 'Negotiable With Fixed Amount Haul', array['log_truck'], 3,
        'Douglas-fir', 'Desc', 'negotiable', 52500, 'Depends on distance and road conditions',
        2, date '2026-11-10', 10, 3.0, 6, 28.0, 'Mill', 35, null, null, '{}', true
      )$sql$,
      v_landing_or
    ),
    '23514',
    'V2-DEC-02 (a9): Negotiable paired with numeric pay_amount_cents rejected with 23514'
  );

  -- 3b. Negative attestation tests (`V2-DEC-03`):
  -- (1) Publication with omitted / NULL attestation (`p_attest_available => null`) rejected.
  perform pg_temp.assert_errcode(
    format(
      $sql$select marketplace.publish_job_posting(
        %L::uuid, 'Missing Attestation Haul', array['log_truck'], 3,
        'Douglas-fir', 'Desc', 'per_load', 52500, null,
        2, date '2026-11-10', 10, 3.0, 6, 28.0, 'Mill', 35, null, null, '{}', null
      )$sql$,
      v_landing_or
    ),
    '23514',
    'V2-DEC-03 (b1): publish_job_posting without attestation (NULL) rejected with 23514'
  );

  -- (2) Publication with false attestation (`p_attest_available => false`) rejected.
  perform pg_temp.assert_errcode(
    format(
      $sql$select marketplace.publish_job_posting(
        %L::uuid, 'False Attestation Haul', array['log_truck'], 3,
        'Douglas-fir', 'Desc', 'per_load', 52500, null,
        2, date '2026-11-10', 10, 3.0, 6, 28.0, 'Mill', 35, null, null, '{}', false
      )$sql$,
      v_landing_or
    ),
    '23514',
    'V2-DEC-03 (b2): publish_job_posting with p_attest_available = false rejected with 23514'
  );

  -- (3) Direct SQL INSERT into `marketplace.job_postings` with `status = 'active'` bypassing
  --     `publish_job_posting` rejected with 23514.
  perform pg_temp.assert_errcode(
    format(
      $sql$insert into marketplace.job_postings (
        org_id, landing_id, title, pay_amount_cents, pay_unit, trucks_requested, status
      ) values (
        %L::uuid, %L::uuid, 'Direct SQL Bypass Attempt', 52500, 'per_load', 3, 'active'
      )$sql$,
      v_org_landing, v_landing_or
    ),
    '23514',
    'V2-DEC-03 (b3): Direct SQL INSERT with status = active bypassing publish_job_posting rejected with 23514'
  );

  -- (4) Unauthorized publishers (fleet driver, rival org owner) rejected with 42501.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_fleet_driver');
  perform pg_temp.assert_errcode(
    format(
      $sql$select marketplace.publish_job_posting(
        %L::uuid, 'Unauthorized Driver Publish', array['log_truck'], 3,
        'Douglas-fir', 'Desc', 'per_load', 52500, null,
        2, date '2026-11-10', 10, 3.0, 6, 28.0, 'Mill', 35, null, null, '{}', true
      )$sql$,
      v_landing_or
    ),
    '42501',
    'V2-DEC-03 (b4): Fleet driver cannot publish a job posting (42501)'
  );

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_rival_owner');
  perform pg_temp.assert_errcode(
    format(
      $sql$select marketplace.publish_job_posting(
        %L::uuid, 'Cross-Org Publish Attempt', array['log_truck'], 3,
        'Douglas-fir', 'Desc', 'per_load', 52500, null,
        2, date '2026-11-10', 10, 3.0, 6, 28.0, 'Mill', 35, null, null, '{}', true
      )$sql$,
      v_landing_or
    ),
    '42501',
    'V2-DEC-03 (b5): Rival organization owner cannot publish at another org''s landing (42501)'
  );

  -- Verify ZERO job rows or attestation rows were created by any of the failed attempts above!
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_landing_owner');
  select count(*) into v_cnt from marketplace.job_postings;
  perform pg_temp.assert_true(
    v_cnt = v_before_cnt,
    'V2-DEC-02 & V2-DEC-03 (b6): Zero partial or unauthorized job rows created after all negative tests'
  );

  -- 3c. Draft saving & preview semantics (`V2-DEC-02` & `V2-DEC-03`):
  --     * An incomplete draft (without pay information) may be saved as `status = 'draft'`.
  --     * Drafts have `published_at = null`, `last_confirmed_at = null`, `last_confirmed_by = null`.
  --     * Drafts are invisible in `list_marketplace_jobs`, `get_marketplace_job`, and `search_job_postings`.
  --     * Attempting to transition an incomplete draft directly to `status = 'active'` via SQL UPDATE
  --       or `set_job_posting_status` is rejected with 23514.
  v_draft_id := marketplace.save_job_posting_draft(
    v_landing_or,
    'Incomplete Winter Sawlog Draft',
    array['log_truck', 'pole_trailer'],
    4,
    'Douglas-fir sawlogs',
    'Drafting haul details while waiting on mill rate sheet.',
    null, -- no pay_unit yet
    null, -- no pay_amount_cents yet
    null,
    3,
    date '2026-11-15',
    14
  );

  perform pg_temp.assert_true(
    exists (
      select 1 from marketplace.job_postings
      where id = v_draft_id
        and status = 'draft'
        and pay_unit is null
        and pay_amount_cents is null
        and published_at is null
        and last_confirmed_at is null
        and last_confirmed_by is null
    ),
    'V2-DEC-02 & V2-DEC-03 (c1): Incomplete draft saved with status = draft, null pay, and null confirmation/publication timestamps'
  );

  perform pg_temp.assert_true(
    not exists (select 1 from marketplace.list_marketplace_jobs(null, null, null, false, v_org_landing, null, null, 2, 50) where job_id = v_draft_id)
    and not exists (select 1 from marketplace.get_marketplace_job(v_draft_id)),
    'V2-DEC-02 & V2-DEC-03 (c2): Saved draft is never exposed in public or acceptingOnly=false discovery queries'
  );

  perform pg_temp.assert_errcode(
    format($sql$update marketplace.job_postings set status = 'active' where id = %L::uuid$sql$, v_draft_id),
    '23514',
    'V2-DEC-02 & V2-DEC-03 (c3): Direct UPDATE of incomplete draft to status = active rejected with 23514'
  );

  perform pg_temp.assert_errcode(
    format($sql$select marketplace.set_job_posting_status(%L::uuid, 'active')$sql$, v_draft_id),
    '23514',
    'V2-DEC-03 (c4): set_job_posting_status cannot activate a draft bypassing publish_job_posting (23514)'
  );

  -- Now promote `v_draft_id` to an active published job via `publish_job_posting`
  -- with valid compensation (`$525 per load` = 52500 cents) and `p_attest_available = true`!
  v_job_1 := marketplace.publish_job_posting(
    v_landing_or,
    'Oakridge to Springfield Doug-Fir Sawlogs',
    array['log_truck', 'pole_trailer', 'self_loader'],
    4,
    'Douglas-fir sawlogs',
    'Steady winter sort yard haul off rocked USFS main line.',
    'per_load',
    52500,
    'Paid bi-weekly direct by Timber Ridge',
    3,
    date '2026-11-10',
    12,
    3.5,
    10,
    29.5,
    'Springfield Mill, OR',
    42,
    '2 miles of rocked 8% adverse grade; chains required after frost.',
    'Loader runs 4:30 AM - 3:00 PM Mon-Fri',
    array['ppe', 'cb_radio', 'chains_season'],
    true,       -- explicit availability attestation
    v_draft_id  -- promote saved draft
  );

  select * into v_rec from marketplace.get_marketplace_job(v_job_1);
  perform pg_temp.assert_true(
    v_job_1 = v_draft_id
    and v_rec.status = 'active'
    and v_rec.accepting_interest = true
    and v_rec.pay_unit = 'per_load'
    and v_rec.pay_amount_cents = 52500
    and v_rec.trucks_total = 4
    and v_rec.trucks_per_day = 3
    and v_rec.estimated_loads_per_truck_per_day = 3.5
    and v_rec.estimated_daily_loads = 10
    and v_rec.estimated_tons_per_load = 29.5
    and v_rec.starts_on = date '2026-11-10'
    and v_rec.duration_days = 12
    and v_rec.ends_on = date '2026-11-21'
    and v_rec.origin_lat = 43.7
    and v_rec.origin_lng = -122.5
    and v_rec.last_confirmed_at is not null,
    'V2-DEC-01..03 (c5): Attested publication of draft stamps server last_confirmed_at, quantizes origin to 43.7 / -122.5, and persists all V2 fields'
  );

  -- Verify audit event recorded `attested_by_user_id = v_u_landing_owner` and `attested_available = true`.
  execute 'reset role';
  perform pg_temp.assert_true(
    exists (
      select 1 from marketplace.audit_events
      where action = 'job_posting.published'
        and entity_id = v_job_1
        and actor_user_id = v_u_landing_owner
        and (metadata ->> 'attested_available')::boolean = true
        and (metadata ->> 'attested_by_user_id')::uuid = v_u_landing_owner
    ),
    'V2-DEC-03 (c6): Audit trail records confirming user identity on attested publication'
  );

  -- 3d. Verify additional valid compensation bases (`$5.25 per ton`, `$85 per hour`,
  --     and `Negotiable — depends on distance, road conditions, and timber type`),
  --     plus idempotent repeated submission (`V2-DEC-02` & `V2-DEC-03`).
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_landing_owner');

  v_job_ton := marketplace.publish_job_posting(
    v_landing_wa,
    'Deer Park Hem-Fir Tonnage Haul',
    array['log_truck', 'bunk_trailer'],
    3,
    'Hem-fir sawlogs',
    'Scale-ticket tonnage haul to Arden mill.',
    'per_ton',
    525, -- $5.25 per ton
    null,
    3,
    date '2026-11-12',
    8,
    3.0,
    9,
    30.0,
    'Arden Mill, WA',
    28,
    null,
    null,
    array['ppe'],
    true
  );

  -- Repeated identical submission of `Deer Park Hem-Fir Tonnage Haul` is idempotent:
  -- returns the exact same `v_job_ton` UUID without creating a second row!
  select count(*) into v_before_cnt from marketplace.job_postings;
  v_job_1_dup := marketplace.publish_job_posting(
    v_landing_wa,
    'Deer Park Hem-Fir Tonnage Haul',
    array['bunk_trailer', 'log_truck'], -- even with reordered equipment array
    3,
    'Hem-fir sawlogs',
    'Scale-ticket tonnage haul to Arden mill.',
    'per_ton',
    525,
    null,
    3,
    date '2026-11-12',
    8,
    3.0,
    9,
    30.0,
    'Arden Mill, WA',
    28,
    null,
    null,
    array['ppe'],
    true
  );
  select count(*) into v_cnt from marketplace.job_postings;

  perform pg_temp.assert_true(
    v_job_1_dup = v_job_ton and v_cnt = v_before_cnt,
    'V2-DEC-03 (d1): Repeated identical publish_job_posting call is idempotent and creates no duplicate row'
  );

  v_job_hour := marketplace.publish_job_posting(
    v_landing_wa,
    'Hourly Right-of-Way Deck Cleanup',
    array['self_loader'],
    2,
    'Mixed deck logs',
    'Short shuttle deck cleanup.',
    'per_hour',
    8500, -- $85.00 per hour
    null,
    2,
    date '2026-11-14',
    4,
    null,
    null,
    null,
    'Sort Yard, WA',
    12,
    null,
    null,
    '{}',
    true
  );

  v_job_neg := marketplace.publish_job_posting(
    v_landing_or,
    'Steep-Ground Custom Salvage Haul',
    array['self_loader', 'mule_train'],
    2,
    'Old-growth windthrow salvage',
    'Variable spur grades and sort destinations.',
    'negotiable',
    null,
    'Depends on distance, road conditions, and timber type',
    2,
    date '2026-11-18',
    10,
    2.5,
    5,
    28.0,
    'Eugene / Roseburg Sorts, OR',
    55,
    null,
    null,
    array['cb_radio'],
    true
  );

  perform pg_temp.assert_true(
    v_job_ton is not null and v_job_hour is not null and v_job_neg is not null,
    'V2-DEC-02 (d2): Valid positive rates ($5.25/ton, $85/hour) and Negotiable with explanatory note succeed'
  );

  -- 3e. Verify distinction between `created_at`, `updated_at` (`last_modified_at`),
  --     `last_confirmed_at`, and `expires_at` (`V2-DEC-03`):
  --     * Ordinary content edit advances `updated_at` and NEVER refreshes `last_confirmed_at`.
  --     * Direct SQL attempt to spoof `last_confirmed_at` is denied (`42501`).
  --     * Explicit `reconfirm_job_posting` advances `last_confirmed_at` and preserves `updated_at`.
  select created_at, updated_at, last_confirmed_at
  into v_created_at_1, v_mod_before, v_conf_initial
  from marketplace.job_postings
  where id = v_job_1;

  update marketplace.job_postings
  set pay_amount_cents = 54000,
      description = 'Updated rate to $540/load; steady winter sort yard haul.'
  where id = v_job_1;

  select updated_at, last_confirmed_at
  into v_mod_after, v_conf_after_edit
  from marketplace.job_postings
  where id = v_job_1;

  perform pg_temp.assert_true(
    v_mod_after > v_mod_before
    and v_conf_after_edit = v_conf_initial,
    'V2-DEC-03 (e1): Ordinary content edit advances updated_at (last_modified_at) and leaves last_confirmed_at untouched'
  );

  -- Direct SQL attempt by authenticated owner to spoof `last_confirmed_at` fails with 42501.
  perform pg_temp.assert_errcode(
    format(
      $sql$update marketplace.job_postings set last_confirmed_at = now() + interval '1 day' where id = %L::uuid$sql$,
      v_job_1
    ),
    '42501',
    'V2-DEC-03 (e2): Direct SQL UPDATE of last_confirmed_at is denied by column-level privileges (42501)'
  );

  -- Explicit reconfirmation advances `last_confirmed_at` and preserves `updated_at` (`v_mod_after`).
  v_conf_reconfirm := marketplace.reconfirm_job_posting(v_job_1);
  v_conf_reconfirm2 := marketplace.reconfirm_job_posting(v_job_1);

  select * into v_rec from marketplace.get_marketplace_job(v_job_1);
  perform pg_temp.assert_true(
    v_conf_reconfirm > v_conf_initial
    and v_conf_reconfirm2 > v_conf_reconfirm
    and v_rec.last_confirmed_at = v_conf_reconfirm2
    and v_rec.last_modified_at = v_mod_after,
    'V2-DEC-03 (e3): Explicit reconfirm_job_posting strictly advances last_confirmed_at while preserving last_modified_at'
  );

  -- 3f. Verify privileged legacy import path (`V2-DEC-02` & `V2-DEC-03`):
  --     * Ordinary authenticated user cannot invoke `admin_import_legacy_job_posting` (`42501`).
  --     * Platform `superadmin` can import a historical unquoted, unconfirmed pilot record
  --       (`pay_unit = null, pay_amount_cents = null, last_confirmed_at = null, trucks_requested = null, trucks_per_day = 2`).
  --     * The historical record remains readable and honestly labeled (`pay_unit = null`, `last_confirmed_at = null`),
  --       and ranks behind confirmed listings in `list_marketplace_jobs`.
  perform pg_temp.assert_errcode(
    format(
      $sql$select marketplace.admin_import_legacy_job_posting(
        %L::uuid, %L::uuid, 'Unauthorized Legacy Import', array['log_truck'], 'Try to bypass pay rule'
      )$sql$,
      v_org_landing, v_landing_null_pt
    ),
    '42501',
    'V2-DEC-02 (f1): Ordinary authenticated user cannot call admin_import_legacy_job_posting (42501)'
  );

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_superadmin');
  v_job_legacy := marketplace.admin_import_legacy_job_posting(
    v_org_landing,
    v_landing_null_pt,
    'Historical Pilot Unquoted Sort Haul',
    array['log_truck'],
    'Pilot operating_state migration batch #2026-11-01',
    'active',
    null, -- historical pilot listing had no job-wide total trucks
    2,    -- 2 trucks per day
    'Hem-fir pulp',
    'Imported from legacy pilot operating_state.',
    null, -- unquoted historical record
    null,
    null,
    6,
    27.0,
    'Longview Pulp Mill, WA',
    48,
    now() - interval '14 days',
    null  -- never explicitly confirmed in pilot
  );

  perform pg_temp.as_jwt('anon');
  select * into v_rec from marketplace.get_marketplace_job(v_job_legacy);
  perform pg_temp.assert_true(
    v_rec.job_id = v_job_legacy
    and v_rec.pay_unit is null
    and v_rec.pay_amount_cents is null
    and v_rec.last_confirmed_at is null
    and v_rec.trucks_total is null
    and v_rec.trucks_per_day = 2
    and v_rec.origin_lat is null
    and v_rec.origin_lng is null,
    'V2-DEC-02 & V2-DEC-03 (f2): Historical unquoted/unconfirmed record remains readable and honestly labeled without fabricated pay, confirmation, or truck totals'
  );

  -- Verify `list_marketplace_jobs` orders all 4 confirmed jobs ahead of the unconfirmed legacy job (`NULLS LAST`).
  select job_id into v_rec
  from marketplace.list_marketplace_jobs(null, null, null, true, v_org_landing, null, null, 2, 10)
  offset 4 limit 1;
  perform pg_temp.assert_true(
    v_rec.job_id = v_job_legacy,
    'V2-DEC-03 (f3): Confirmed V2 jobs sort ahead of unconfirmed legacy job (last_confirmed_at IS NOT NULL DESC)'
  );

  -- ===========================================================================
  -- 4. Known Gap 2 & 4 End-to-End Inquiry Flow (Equipment Breakdown, Private
  --    Hauler Eligibility, Idempotent Replies, Declined Lock, Boost Auto-Expiry)
  -- ===========================================================================
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_fleet_owner');

  insert into marketplace.equipment_units (org_id, equipment_code, paired_trailer_code, operational_status, unit_count, unit_label, is_active)
  values
    (v_org_fleet, 'log_truck', 'pole_trailer', 'available', 2, 'Kenworth T800 Long-Log Pair', true),
    (v_org_fleet, 'log_truck', 'pole_trailer', 'committed', 1, 'Peterbilt 389 Long-Log', true),
    (v_org_fleet, 'self_loader', null, 'available', 1, 'Western Star Self-Loader', true),
    (v_org_fleet, 'lowboy_tractor', null, 'maintenance', 1, 'Shop Lowboy (In Maintenance)', true);

  select count(*) into v_cnt from marketplace.list_hauler_equipment_options(v_org_fleet);
  perform pg_temp.assert_true(
    v_cnt = 2,
    'Gap 2a: list_hauler_equipment_options groups active available/committed units into 2 configurations and excludes maintenance units'
  );

  select * into v_rec
  from marketplace.list_hauler_equipment_options(v_org_fleet)
  where configuration_key = 'log_truck|pole_trailer';
  perform pg_temp.assert_true(
    v_rec.label = 'Log truck + Pole trailer'
    and v_rec.units_listed = 3,
    'Gap 2b: list_hauler_equipment_options computes configuration_key = log_truck|pole_trailer, label = "Log truck + Pole trailer", and units_listed = 3'
  );

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_fleet_driver');

  -- Offering more units than listed on profile (4 > 3) fails with 23514.
  perform pg_temp.assert_errcode(
    format(
      $sql$select * from marketplace.submit_expression_of_interest(
        %L::uuid, %L::uuid, null,
        '[{"configurationKey":"log_truck|pole_trailer","count":4}]'::jsonb,
        date '2026-11-10', date '2026-11-21', 'Trying to offer 4 pole trailers', 'phone'
      )$sql$,
      v_org_fleet, v_job_1
    ),
    '23514',
    'Gap 2c: submit_expression_of_interest rejects offering more units than listed on hauler profile'
  );

  -- Submit valid equipment breakdown (2 x `log_truck|pole_trailer` + 1 x `self_loader` = 3 trucks).
  select interest_id, created into v_interest_id, v_created
  from marketplace.submit_expression_of_interest(
    v_org_fleet,
    v_job_1,
    99,
    '[{"configurationKey":"log_truck|pole_trailer","count":2},{"configurationKey":"self_loader","count":1}]'::jsonb,
    date '2026-11-10',
    date '2026-11-21',
    'Can put 2 pole trucks and 1 self-loader on Oakridge Monday morning.',
    'phone'
  );

  select * into v_rec
  from marketplace.list_marketplace_interests(v_org_fleet, 'hauler', v_job_1);

  perform pg_temp.assert_true(
    v_created = true
    and v_rec.trucks_offered = 3
    and v_rec.hauler_org_type = 'fleet'
    and jsonb_array_length(v_rec.equipment) = 2
    and (v_rec.equipment -> 0 ->> 'configurationKey') = 'log_truck|pole_trailer'
    and (v_rec.equipment -> 0 ->> 'label') = 'Log truck + Pole trailer'
    and (v_rec.equipment -> 0 ->> 'count')::integer = 2
    and (v_rec.equipment -> 1 ->> 'configurationKey') = 'self_loader'
    and (v_rec.equipment -> 1 ->> 'label') = 'Self-loader log truck'
    and (v_rec.equipment -> 1 ->> 'count')::integer = 1,
    'Gap 2d: list_marketplace_interests returns snapshotted equipment configurations, labels, counts, and derived trucks_offered = 3'
  );

  -- Private solo hauler (`is_public = false`, 0 equipment units) submits an inquiry (`Gap 4`).
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_solo_hauler');
  select interest_id, created into v_solo_interest, v_created
  from marketplace.submit_expression_of_interest(
    v_org_solo,
    v_job_1,
    1,
    '[]'::jsonb,
    date '2026-11-11',
    null,
    'Owner-operator with 1 truck available Tuesday.',
    'in_app'
  );

  perform pg_temp.assert_true(
    v_solo_interest is not null and v_created = true,
    'Gap 4e: Hauling business with hauler_profiles.is_public = false and 0 listed equipment units can submit an inquiry'
  );

  -- Verify landing operator can read `v_org_solo`'s `hauler_profiles` row after inquiry.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_landing_owner');
  perform pg_temp.assert_true(
    exists (select 1 from marketplace.hauler_profiles where org_id = v_org_solo),
    'Gap 4f: Landing operator can read hauler_profiles row of an inquiring hauler even when hauler is_public = false'
  );

  -- Solo hauler withdraws and renews inquiry in place.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_solo_hauler');
  perform marketplace.withdraw_interest(v_solo_interest);

  select interest_id, created into v_interest_id_2, v_created
  from marketplace.submit_expression_of_interest(
    v_org_solo,
    v_job_1,
    1,
    '[]'::jsonb,
    date '2026-11-12',
    null,
    'Schedule opened back up — can start Wednesday.',
    'in_app'
  );

  perform pg_temp.assert_true(
    v_interest_id_2 = v_solo_interest
    and v_created = false
    and exists (
      select 1 from marketplace.expressions_of_interest
      where id = v_solo_interest and status = 'submitted' and withdrawn_at is null
    ),
    'Lifecycle 4g: Resubmitting a withdrawn inquiry renews the existing record back to status = submitted'
  );

  -- Landing operator marks `v_interest_id` viewed (`responded_at` stays null), then replies with `v_reply_1` and shares private details.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_landing_owner');
  perform marketplace.respond_to_interest(v_interest_id, 'viewed', false, null, null);

  perform pg_temp.assert_true(
    exists (
      select 1 from marketplace.expressions_of_interest
      where id = v_interest_id and status = 'viewed' and responded_at is null
    ),
    'Lifecycle 4h: Marking an inquiry viewed does NOT stamp responded_at'
  );

  perform marketplace.respond_to_interest(
    v_interest_id, 'replied', true, v_reply_1, 'Sounds great — gate code shared, call Foreman Dan.'
  );
  perform marketplace.respond_to_interest(
    v_interest_id, 'replied', true, v_reply_1, 'Sounds great — gate code shared, call Foreman Dan.'
  );

  -- Fleet driver replies with `v_reply_2` and reads shared `landing_private_details`.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_fleet_driver');
  perform marketplace.post_hauler_interest_reply(v_interest_id, v_reply_2, 'Copy that, our 3 trucks will be at MP 14.2 at 4:30 AM.');
  perform marketplace.post_hauler_interest_reply(v_interest_id, v_reply_2, 'Copy that, our 3 trucks will be at MP 14.2 at 4:30 AM.');

  perform pg_temp.assert_true(
    exists (select 1 from marketplace.landing_private_details where landing_id = v_landing_or and gate_instructions = 'GATE-9941')
    and (select count(*) from marketplace.interest_messages where interest_id = v_interest_id) = 2,
    'Lifecycle 4i: Landing & hauler replies are idempotent on reply_id and hauler can read shared landing_private_details'
  );

  -- Landing operator declines `v_solo_interest`; verify it is locked against edits and replies.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_landing_owner');
  perform marketplace.respond_to_interest(v_solo_interest, 'declined', false, v_reply_3, 'Filled all positions for this week, thank you.');

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_solo_hauler');
  perform pg_temp.assert_errcode(
    format(
      $sql$select * from marketplace.submit_expression_of_interest(%L::uuid, %L::uuid, 1, '[]'::jsonb, null, null, 'Try to reopen declined', 'in_app')$sql$,
      v_org_solo, v_job_1
    ),
    '23514',
    'Lifecycle 4j: Declined inquiry cannot be reopened via submit_expression_of_interest'
  );

  perform pg_temp.assert_errcode(
    format(
      $sql$select marketplace.post_hauler_interest_reply(%L::uuid, gen_random_uuid(), 'Try to message declined inquiry')$sql$,
      v_solo_interest
    ),
    '23514',
    'Lifecycle 4k: Declined inquiry blocks new hauler messages'
  );

  -- Activate a 7-day Quick Boost on `v_job_1`, then mark `v_job_1` filled -> boost auto-expires.
  perform pg_temp.as_jwt('service_role');
  v_boost_id := marketplace.activate_job_boost(
    v_job_1, 'quick', v_u_landing_owner, 'pi_v2_test_boost_1', now() - interval '1 hour'
  );

  -- service_role has no table grants by design; read the boost as the owning landing desk.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_landing_owner');
  perform pg_temp.assert_true(
    exists (select 1 from marketplace.job_boosts where id = v_boost_id and status = 'active'),
    'Boost 4l: Sponsored boost is active on active job'
  );

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_v2_landing_owner');
  perform marketplace.set_job_posting_status(v_job_1, 'filled');

  perform pg_temp.assert_true(
    exists (select 1 from marketplace.job_boosts where id = v_boost_id and status = 'ended'), -- 'expired' is not a job_boosts status
    'Boost 4m: Transitioning job to filled automatically expires active job_boosts row'
  );

  raise notice 'ALL V2 CONTRACT ALIGNMENT & FOUNDER DECISION (V2-DEC-01..03) TESTS PASSED.';
end
$$;

rollback;
