-- =============================================================================
-- LogLoads normalized-v2 — 04 executable SQL & RLS integration test suite
--
-- NON-ACTIVE PROTOTYPE TEST SUITE. Do not run against production.
-- Run against a disposable local PostgreSQL 15+ (with PostGIS + btree_gist)
-- after loading 01_schema.sql, 02_access.sql, and 03_entitlements.sql:
--
--   psql -v ON_ERROR_STOP=1 -f architecture/normalized-v2/01_schema.sql
--   psql -v ON_ERROR_STOP=1 -f architecture/normalized-v2/02_access.sql
--   psql -v ON_ERROR_STOP=1 -f architecture/normalized-v2/03_entitlements.sql
--   psql -v ON_ERROR_STOP=1 -f architecture/normalized-v2/04_tests.sql
--
-- Wrapped in BEGIN ... ROLLBACK so the suite is idempotent and leaves no test
-- rows behind. Uses PL/pgSQL assertions and `SET LOCAL ROLE` +
-- `set_config('request.jwt.claims', ...)` to exercise real PostgREST/Supabase
-- RLS contexts (`anon`, `authenticated`, `service_role`).
-- =============================================================================

begin;

-- Test-harness fixture lookup: delivery rows are deliberately unreadable to the sending landing
-- and to service_role (no table grants; workers receive delivery ids from provider callbacks).
-- SECURITY DEFINER runs as the harness owner, so the caller's role and JWT context are unchanged.
create function pg_temp.fixture_delivery_id(p_invitation uuid)
returns uuid
language sql
security definer
as $$
  select id from marketplace.invitation_deliveries where invitation_id = p_invitation order by channel, id limit 1
$$;

-- Schema mode: 06_v2_contract_alignment.sql adds the attestation ledger. On the aligned schema,
-- active jobs can only be created through publish_job_posting (V2-DEC-03), so this suite creates
-- them through that RPC there, and by direct INSERT on the baseline schema.
create function pg_temp.aligned() returns boolean language sql stable as $$
  select to_regclass('marketplace.job_publication_attestations') is not null
$$;

-- Runs p_sql and requires failure with SQLSTATE p_state AND a constraint name or message matching
-- p_reason (case-insensitive regex), so a negative test cannot pass because an unrelated rule fired.
create function pg_temp.expect_failure(p_sql text, p_state text, p_reason text, p_label text) returns void
language plpgsql as $$
declare
  v_state text; v_msg text; v_constraint text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_constraint = constraint_name;
    if v_state = p_state and (coalesce(v_constraint, '') ~* p_reason or v_msg ~* p_reason) then
      return;
    end if;
    raise exception 'TEST ASSERTION FAILED: % (expected % matching /%/, got % constraint=% message=%)',
      p_label, p_state, p_reason, v_state, coalesce(v_constraint, '-'), v_msg;
  end;
  raise exception 'TEST ASSERTION FAILED: % (expected failure %, statement succeeded)', p_label, p_state;
end
$$;

-- Creates an active job as the current caller. Baseline: direct INSERT (+ equipment row).
-- Aligned: publish_job_posting with explicit availability attestation.
create function pg_temp.create_active_job(
  p_org uuid, p_landing uuid, p_title text, p_pay_cents bigint, p_pay_unit text, p_trucks integer,
  p_description text default null, p_product text default null, p_destination text default null,
  p_miles integer default null, p_starts date default null, p_ends date default null
) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  if pg_temp.aligned() then
    v_id := marketplace.publish_job_posting(
      p_landing_id => p_landing, p_title => p_title, p_equipment_codes => array['log_truck'],
      p_trucks_requested => p_trucks, p_product => p_product, p_description => p_description,
      p_pay_unit => p_pay_unit, p_pay_amount_cents => p_pay_cents,
      p_work_starts_on => p_starts,
      p_duration_days => case when p_starts is not null and p_ends is not null then (p_ends - p_starts) + 1 end,
      p_destination_label => p_destination, p_est_one_way_miles => p_miles, p_attest_available => true);
  else
    insert into marketplace.job_postings
      (org_id, landing_id, title, description, product, destination_label, est_one_way_miles,
       pay_amount_cents, pay_unit, trucks_requested, work_starts_on, work_ends_on, status)
    values (p_org, p_landing, p_title, p_description, p_product, p_destination, p_miles,
            p_pay_cents, p_pay_unit, p_trucks, p_starts, p_ends, 'active')
    returning id into v_id;
    insert into marketplace.job_posting_equipment (job_id, equipment_code) values (v_id, 'log_truck');
  end if;
  return v_id;
end
$$;

-- Helper used only inside this rolled-back transaction to switch caller context.
create function pg_temp.as_jwt(
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

create function pg_temp.assert_true(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is not true then
    raise exception 'TEST ASSERTION FAILED: %', p_msg;
  end if;
end
$$;

-- =============================================================================
-- 1. Schema object inventory & Blueprint v1.0 catalog alignment
-- =============================================================================
do $$
declare
  v_tables   integer;
  v_views    integer;
  v_rls      integer;
  v_funcs    integer;
  v_pub_exec integer;
begin
  select count(*) into v_tables from pg_tables where schemaname = 'marketplace';
  perform pg_temp.assert_true(v_tables = case when pg_temp.aligned() then 35 else 32 end, format('expected %s tables in marketplace, found %s', case when pg_temp.aligned() then 35 else 32 end, v_tables));

  select count(*) into v_views from pg_views where schemaname = 'marketplace';
  perform pg_temp.assert_true(v_views = 0, format('expected 0 views in marketplace, found %s', v_views));

  select count(*) into v_rls from pg_tables where schemaname = 'marketplace' and rowsecurity;
  perform pg_temp.assert_true(v_rls = v_tables, format('every marketplace table must have RLS enabled (%s of %s)', v_rls, v_tables));

  select count(*) into v_funcs
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'marketplace';
  perform pg_temp.assert_true(v_funcs = case when pg_temp.aligned() then 62 else 44 end, format('expected %s functions in marketplace, found %s', case when pg_temp.aligned() then 62 else 44 end, v_funcs));

  -- No function in `marketplace` may be executable by PUBLIC.
  select count(*) into v_pub_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'marketplace' and has_function_privilege('public', p.oid, 'EXECUTE');
  perform pg_temp.assert_true(v_pub_exec = 0, 'PUBLIC must not have EXECUTE on any marketplace function');

  -- Verify exact Blueprint v1.0 & packages/contracts/src/membership.ts seed values.
  perform pg_temp.assert_true(exists (
    select 1 from marketplace.subscription_plans
    where code = 'basic' and status = 'active' and monthly_price_cents = 14900
      and max_active_landings = 1 and max_team_members = 2 and monthly_invitations = 3
      and features = array[]::text[]
  ), 'Basic plan row mismatch');

  perform pg_temp.assert_true(exists (
    select 1 from marketplace.subscription_plans
    where code = 'pro' and status = 'active' and monthly_price_cents = 29900
      and max_active_landings = 3 and max_team_members = 5 and monthly_invitations = 10
      and features = array['advanced_hauler_search', 'availability_alerts', 'posting_templates', 'multi_landing_inbox']
  ), 'Pro plan row mismatch');

  perform pg_temp.assert_true(exists (
    select 1 from marketplace.subscription_plans
    where code = 'regional' and status = 'active' and monthly_price_cents = 49900
      and max_active_landings is null and max_team_members = 10 and monthly_invitations = 30
      and 'regional_capacity_overview' = any (features)
      and 'advanced_team_workflows' = any (features)
      and 'priority_support' = any (features)
  ), 'Regional plan row mismatch');

  perform pg_temp.assert_true((
    select count(*) from marketplace.boost_products
    where status = 'active'
      and (code, duration_days, price_cents, radius_miles) in (
        ('quick', 7, 9900, 100),
        ('extended', 14, 14900, 100),
        ('campaign', 28, 19900, 100)
      )
  ) = 3, 'Boost product catalog mismatch');
end
$$;

-- =============================================================================
-- 2. Authentication trust boundary & multi-org user setup
-- =============================================================================
do $$
declare
  v_issuer constant text := 'https://clerk.logloads.test';
  v_u_dual   uuid; -- belongs to both a hauling org (owner) and a landing org (manager)
  v_u_land   uuid; -- owner of landing org A
  v_u_land2  uuid; -- owner of landing org B (rival tenant)
  v_u_staff  uuid; -- extra user for seat limit tests
  v_u_drv1   uuid; -- fleet driver 1
  v_u_drv2   uuid; -- fleet driver 2
  v_u_admin  uuid; -- platform admin (support + moderator + billing)
  v_org_land_a uuid;
  v_org_land_b uuid;
  v_org_haul_1 uuid;
  v_org_haul_2 uuid;
  v_landing_a1 uuid;
  v_landing_a2 uuid;
  v_landing_b1 uuid;
  v_job_a1     uuid;
  v_job_b1     uuid;
  v_interest_1 uuid;
  v_inv_1      uuid;
  v_inv_2      uuid;
  v_inv_3      uuid;
  v_del_id     uuid;
  v_boost_id   uuid;
  v_promo_id   uuid;
  v_count      integer;
  v_dist_m     double precision;
begin
  -- Register the trusted Clerk issuer with audience pinning.
  insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
  values (v_issuer, 'Clerk Test Instance', 'logloads-app', true);

  -- Sync identities via `service_role` worker RPC.
  perform pg_temp.as_jwt('service_role');
  v_u_land  := marketplace.sync_verified_identity(v_issuer, 'user_land_a',  'Alice Timber',  'alice@timber.test', true);
  v_u_land2 := marketplace.sync_verified_identity(v_issuer, 'user_land_b',  'Bob Rival',     'bob@rival.test',    true);
  v_u_dual  := marketplace.sync_verified_identity(v_issuer, 'user_dual',    'Cole Hauler',   'cole@haul.test',    true);
  v_u_staff := marketplace.sync_verified_identity(v_issuer, 'user_staff',   'Dana Foreman',  'dana@timber.test',  true);
  v_u_drv1  := marketplace.sync_verified_identity(v_issuer, 'user_drv1',    'Eli Driver',    'eli@haul.test',     true);
  v_u_drv2  := marketplace.sync_verified_identity(v_issuer, 'user_drv2',    'Fran Driver',   'fran@haul.test',    true);
  v_u_admin := marketplace.sync_verified_identity(v_issuer, 'user_admin',   'Grace Admin',   'grace@logloads.test', true);

  -- Grant platform admin privileges (superadmin covers support/moderator/billing).
  execute 'reset role';
  insert into marketplace.platform_admins (user_id, admin_role, note)
  values (v_u_admin, 'superadmin', 'Test platform admin');

  -- 2a. Untrusted issuer, wrong audience, expired token, missing `exp` or `role` claims, or `anon` role must resolve NULL (Item 3).
  perform pg_temp.as_jwt('authenticated', 'https://evil.example.com', 'user_land_a', 'logloads-app', 3600);
  perform pg_temp.assert_true(marketplace.current_user_id() is null, 'untrusted issuer must resolve NULL');

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_land_a', 'wrong-audience', 3600);
  perform pg_temp.assert_true(marketplace.current_user_id() is null, 'wrong audience must resolve NULL');

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_land_a', 'logloads-app', -60);
  perform pg_temp.assert_true(marketplace.current_user_id() is null, 'expired token must resolve NULL');

  -- Missing `exp` claim must never be silently treated as valid.
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', v_issuer, 'sub', 'user_land_a', 'aud', 'logloads-app')::text, true);
  execute 'set local role authenticated';
  perform pg_temp.assert_true(marketplace.current_user_id() is null, 'token missing exp claim must resolve NULL');

  -- Missing `role` claim must never be silently treated as valid.
  perform set_config('request.jwt.claims', jsonb_build_object('iss', v_issuer, 'sub', 'user_land_a', 'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
  perform pg_temp.assert_true(marketplace.current_user_id() is null, 'token missing role claim must resolve NULL');

  -- Anonymous callers carry no identity. 02_access.sql grants EXECUTE on current_user_id() to
  -- `authenticated` only, so the `anon` role is denied outright (no anon-facing policy calls it).
  perform pg_temp.as_jwt('anon');
  begin
    perform marketplace.current_user_id();
    raise exception 'expected anon to be denied EXECUTE on marketplace.current_user_id()';
  exception when insufficient_privilege then null;
  end;
  -- The resolver itself must also refuse an anon-role claim, even with a valid issuer and a real subject.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon', 'iss', v_issuer, 'sub', 'user_land_a', 'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
  perform pg_temp.assert_true(marketplace.current_user_id() is null, 'anon role claim must resolve NULL');

  -- Valid Clerk token resolves exact app_users.id.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_land_a');
  perform pg_temp.assert_true(marketplace.current_user_id() = v_u_land, 'valid Clerk token must resolve user');

  -- ===========================================================================
  -- 3. Multi-org user & free Fleet / Hauler capabilities (no seat limit)
  -- ===========================================================================
  v_org_land_a := marketplace.create_organization('Cascade Timber Co', 'cascade-timber', 'OR', false);

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_land_b');
  v_org_land_b := marketplace.create_organization('Olympic Logging LLC', 'olympic-logging', 'WA', false);

  -- `v_u_dual` creates a free hauling fleet org AND also joins `v_org_land_a` as a manager.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_dual');
  v_org_haul_1 := marketplace.create_organization('Cole Log Hauling', 'cole-log-hauling', 'OR', true);

  -- Free fleet org invites 3 additional members (drivers/staff) — no subscription, no seat cap!
  insert into marketplace.organization_memberships (org_id, user_id, role, status)
  values
    (v_org_haul_1, v_u_drv1,  'driver', 'invited'),
    (v_org_haul_1, v_u_drv2,  'driver', 'invited'),
    (v_org_haul_1, v_u_staff, 'staff',  'invited');

  -- Invited user cannot be activated by the owner; only the invited user can accept.
  begin
    update marketplace.organization_memberships set status = 'active'
    where org_id = v_org_haul_1 and user_id = v_u_drv1;
    raise exception 'expected owner self-activation of invitee to fail';
  exception when insufficient_privilege then null;
  end;

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_drv1');
  update marketplace.organization_memberships set status = 'active'
  where org_id = v_org_haul_1 and user_id = v_u_drv1;

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_drv2');
  update marketplace.organization_memberships set status = 'active'
  where org_id = v_org_haul_1 and user_id = v_u_drv2;

  -- Second independent hauler org (for multi-recipient invitation tests).
  v_org_haul_2 := marketplace.create_organization('Fran Independent Hauling', 'fran-independent', 'OR', true);

  -- Configure fleet profile, equipment, opt-in consent, and timestamped availability.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_dual');
  update marketplace.hauler_profiles
  set headline = '8-truck log fleet',
      service_center = extensions.st_GeogFromText('SRID=4326;POINT(-122.6765 45.5231)'),
      service_radius_miles = 120,
      operating_states = array['OR', 'WA'],
      accepts_targeted_invitations = true,
      max_invitations_per_week = 5
  where org_id = v_org_haul_1;

  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled)
  values (v_u_dual, v_org_haul_1, 'targeted_invitation', 'in_app', true);

  insert into marketplace.equipment_units (org_id, equipment_code, unit_label, make, model, model_year, axle_count)
  values
    (v_org_haul_1, 'log_truck',    'Truck #101', 'Kenworth', 'W900', 2022, 4),
    (v_org_haul_1, 'self_loader',  'Truck #102', 'Peterbilt', '389', 2021, 4),
    (v_org_haul_1, 'pole_trailer', 'Trailer #P1', 'Peerless', 'Pole', 2020, 2);

  insert into marketplace.availability_reports
    (org_id, equipment_code, available_count, area_center, area_label, radius_miles, available_from, available_until)
  values
    (v_org_haul_1, 'log_truck', 4, extensions.st_GeogFromText('SRID=4326;POINT(-122.6765 45.5231)'),
     'Santiam Canyon', 100, current_date, current_date + 14);

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_drv2');
  update marketplace.hauler_profiles
  set headline = 'Owner-operator log truck',
      service_center = extensions.st_GeogFromText('SRID=4326;POINT(-122.6800 45.5200)'),
      service_radius_miles = 100,
      operating_states = array['OR'],
      accepts_targeted_invitations = true
  where org_id = v_org_haul_2;

  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled)
  values (v_u_drv2, v_org_haul_2, 'targeted_invitation', 'email', true);

  insert into marketplace.equipment_units (org_id, equipment_code, unit_label)
  values (v_org_haul_2, 'log_truck', 'Unit #1');

  -- ===========================================================================
  -- 4. Subscriptions, team-member seat limits (Risk 1), and landing limits
  -- ===========================================================================
  -- Activate Basic ($149: 1 landing, 2 seats, 3 invitations) for `v_org_land_a`.
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(
    v_org_land_a, 'basic', 'active', now() - interval '1 hour', now() + interval '29 days',
    'cus_test_a', 'sub_test_a', false, 7
  );

  -- Also activate Basic for rival landing org `v_org_land_b`.
  perform marketplace.open_subscription_cycle(
    v_org_land_b, 'basic', 'active', now() - interval '1 hour', now() + interval '29 days',
    'cus_test_b', 'sub_test_b', false, 7
  );

  -- `v_u_land` invites `v_u_dual` as manager (2nd seat on Basic — allowed).
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_land_a');
  insert into marketplace.organization_memberships (org_id, user_id, role, status)
  values (v_org_land_a, v_u_dual, 'manager', 'invited');

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_dual');
  update marketplace.organization_memberships set status = 'active'
  where org_id = v_org_land_a and user_id = v_u_dual;

  -- Verify `v_u_dual` now belongs to BOTH `v_org_haul_1` (owner) and `v_org_land_a` (manager).
  select count(*) into v_count from marketplace.my_org_ids(array['owner', 'manager']);
  perform pg_temp.assert_true(v_count = 2, 'dual user must belong to both hauling and landing organizations');

  -- Item 2 test: attempting to add a 3rd paid Landing Operator seat (`landing_workspace_seat = true`)
  -- on Basic (2 landing seats max) MUST fail.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_land_a');
  begin
    insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
    values (v_org_land_a, v_u_staff, 'staff', true, 'invited');
    raise exception 'expected 3rd paid landing seat on Basic plan to be rejected';
  exception when check_violation then null;
  end;

  -- Item 2 test: adding free fleet-only drivers (`role = 'driver'`, automatically `landing_workspace_seat = false`)
  -- and fleet-only staff (`role = 'staff', landing_workspace_seat = false`) on a company that ALSO operates
  -- landings succeeds without consuming paid landing seats, and grants ZERO Landing Operator access.
  insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
  values
    (v_org_land_a, v_u_drv1,  'driver', false, 'invited'),
    (v_org_land_a, v_u_staff, 'staff',  false, 'invited');

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_drv1');
  update marketplace.organization_memberships set status = 'active'
  where org_id = v_org_land_a and user_id = v_u_drv1;

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_staff');
  update marketplace.organization_memberships set status = 'active'
  where org_id = v_org_land_a and user_id = v_u_staff;

  -- Fleet-only staff (`landing_workspace_seat = false`) cannot self-escalate to a paid landing seat
  -- and cannot create landings or access the paid hauler directory via `v_org_land_a`.
  begin
    update marketplace.organization_memberships set landing_workspace_seat = true
    where org_id = v_org_land_a and user_id = v_u_staff;
    raise exception 'expected fleet-only staff self-upgrade to landing seat to fail';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.assert_true(not marketplace.current_user_has_landing_access(),
    'fleet-only staff without landing_workspace_seat must not get paid directory access');

  -- Basic allows 1 active landing; inactive saved landings are unlimited.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_land_a');
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code, county)
  values (
    v_org_land_a, 'North Fork Unit 4', 'active', 'Near Sweet Home, OR',
    extensions.st_GeogFromText('SRID=4326;POINT(-122.7000 44.4000)'), 'OR', 'Linn'
  ) returning id into v_landing_a1;

  -- Saved inactive landing succeeds on Basic.
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code, county)
  values (
    v_org_land_a, 'South Ridge Backup', 'inactive', 'Near Brownsville, OR',
    extensions.st_GeogFromText('SRID=4326;POINT(-122.9000 44.3000)'), 'OR', 'Linn'
  ) returning id into v_landing_a2;

  -- Activating the 2nd landing on Basic MUST fail.
  begin
    update marketplace.landings set status = 'active' where id = v_landing_a2;
    raise exception 'expected 2nd active landing on Basic plan to fail';
  exception when check_violation then null;
  end;

  -- Pro feature (`posting_templates`) is blocked on Basic.
  begin
    insert into marketplace.job_templates (org_id, name, template)
    values (v_org_land_a, 'Standard Sawlog Template', '{"product":"Doug-fir"}'::jsonb);
    raise exception 'expected posting_templates insert on Basic plan to fail RLS';
  exception when insufficient_privilege then null;
  end;

  -- ===========================================================================
  -- 5. Coordinate obfuscation (Item 5), public text filter, pay transparency (Item 9), & private access
  -- ===========================================================================
  -- Verify `v_landing_a1.public_point` was shifted to the 0.1° cell center
  -- (-122.65, 44.45), > 5 km away from the input (-122.7000, 44.4000).
  select extensions.st_distance(
    public_point,
    extensions.st_GeogFromText('SRID=4326;POINT(-122.7000 44.4000)')
  ) into v_dist_m
  from marketplace.landings where id = v_landing_a1;
  if pg_temp.aligned() then
    -- V2-DEC-01: nearest 0.10-degree grid point; (-122.7000, 44.4000) is already on the grid.
    perform pg_temp.assert_true(v_dist_m < 1, format('V2-DEC-01: on-grid input must stay on the 0.10-degree grid point, moved %s m', v_dist_m));
  else
    perform pg_temp.assert_true(v_dist_m > 4000, format('public_point must be obfuscated (>4km shift), got %s m', v_dist_m));
  end if;

  -- Public text guard: pasting exact coordinates or gate codes into public job fields fails.
  if pg_temp.aligned() then
    perform pg_temp.expect_failure(format($q$select marketplace.publish_job_posting(p_landing_id => %L, p_title => 'Sawlog Haul',
      p_equipment_codes => array['log_truck'], p_trucks_requested => 10, p_pay_unit => 'per_ton', p_pay_amount_cents => 12500,
      p_description => 'Gate code 4829 at 44.40123, -122.70456', p_attest_available => true)$q$, v_landing_a1),
      '23514', 'description', 'public job description with gate code / exact coords must be rejected by the description check');
  else
    perform pg_temp.expect_failure(format($q$insert into marketplace.job_postings
      (org_id, landing_id, title, description, pay_amount_cents, pay_unit, trucks_requested, status)
      values (%L, %L, 'Sawlog Haul', 'Gate code 4829 at 44.40123, -122.70456', 12500, 'per_ton', 10, 'active')$q$, v_org_land_a, v_landing_a1),
      '23514', 'description', 'public job description with gate code / exact coords must be rejected by the description check');
  end if;

  -- Pay transparency guard (Item 9): publishing an active job with NULL pay_unit / pay_amount_cents
  -- is blocked by default until founder sign-off on Blueprint §5.2 vs UX Spec §5.1.3.
  if pg_temp.aligned() then
    perform pg_temp.expect_failure(format($q$select marketplace.publish_job_posting(p_landing_id => %L, p_title => 'Unquoted Active Job',
      p_equipment_codes => array['log_truck'], p_trucks_requested => 4, p_description => 'Steady haul.', p_attest_available => true)$q$, v_landing_a1),
      '23514', 'pay', 'active job without stated pay or negotiable basis must be rejected by the pay rule');
  else
    perform pg_temp.expect_failure(format($q$insert into marketplace.job_postings
      (org_id, landing_id, title, description, trucks_requested, status)
      values (%L, %L, 'Unquoted Active Job', 'Steady haul.', 4, 'active')$q$, v_org_land_a, v_landing_a1),
      '23514', 'pay', 'active job without stated pay or negotiable basis must be rejected by the pay rule');
  end if;

  -- Store sensitive gate/access details in `landing_private_details`.
  insert into marketplace.landing_private_details
    (landing_id, org_id, exact_point, directions, gate_instructions, site_contact_name, site_contact_phone)
  values (
    v_landing_a1, v_org_land_a,
    extensions.st_GeogFromText('SRID=4326;POINT(-122.71234 44.41234)'),
    'Turn onto FS Rd 2041 at milepost 14.2', 'Yellow gate combo #4829', 'Alice Timber', '+15415550199'
  );

  -- Publish a valid active job posting requesting 50 trucks (unlimited/unmetered)
  -- and containing legitimate business contact information (office phone & email).
  v_job_a1 := pg_temp.create_active_job(
    v_org_land_a, v_landing_a1, 'Santiam Doug-Fir Sawlogs', 8500, 'per_ton', 50,
    'Steady 8-month haul, well-rocked mainline. Call office at (541) 555-0199 or dispatch@cascadetimber.test.',
    'Doug-fir sawlogs', 'Sweet Home Mill', 38, current_date, current_date + 240);

  -- Composite FK integrity check: rival org B cannot attach a job to org A's landing.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_land_b');
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (v_org_land_b, 'Forks Unit 1', 'active', 'Near Forks, WA',
          extensions.st_GeogFromText('SRID=4326;POINT(-124.38 47.95)'), 'WA')
  returning id into v_landing_b1;

  begin
    insert into marketplace.job_postings
      (org_id, landing_id, title, pay_amount_cents, pay_unit, trucks_requested, status)
    values (v_org_land_b, v_landing_a1, 'Cross-tenant FK spoof', 9000, 'per_ton', 1, 'draft');
    raise exception 'expected composite FK (landing_id, org_id) to reject cross-tenant landing reference';
  exception when foreign_key_violation then null;
  end;

  -- Draft job in rival org B is invisible to org A and `anon`.
  insert into marketplace.job_postings (org_id, landing_id, title, trucks_requested, status)
  values (v_org_land_b, v_landing_b1, 'Private Draft Job B', 1, 'draft')
  returning id into v_job_b1;

  -- Regression: the owning desk sees its own draft (the INSERT ... RETURNING above depends on it) ...
  select count(*) into v_count from marketplace.job_postings where id = v_job_b1;
  perform pg_temp.assert_true(v_count = 1, 'owning landing desk must see its own draft job');

  -- ... while the rival landing org A and anon cannot.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_land_a');
  select count(*) into v_count from marketplace.job_postings where id = v_job_b1;
  perform pg_temp.assert_true(v_count = 0, 'rival landing org must not see another org''s draft job');

  perform pg_temp.as_jwt('anon');
  select count(*) into v_count from marketplace.job_postings where id = v_job_b1;
  perform pg_temp.assert_true(v_count = 0, 'anon must not see draft job postings');

  -- `anon` can see active job A1 via `search_job_postings`, but has zero access to `landing_private_details`.
  select count(*) into v_count from marketplace.search_job_postings(null, 100, array['log_truck'], 'per_ton', 'Sawlogs', 2, 10);
  perform pg_temp.assert_true(v_count = 1, 'anon search_job_postings must return matching active job');

  -- Unshared hauler (`v_u_drv2` / `v_org_haul_2`) cannot read `landing_private_details`.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_drv2');
  select count(*) into v_count from marketplace.landing_private_details where landing_id = v_landing_a1;
  perform pg_temp.assert_true(v_count = 0, 'unshared hauler must not see landing_private_details');

  -- Hauler expresses interest, landing shares private details -> hauler can now read, then withdraws -> revoked.
  insert into marketplace.expressions_of_interest (job_id, job_org_id, hauler_org_id, trucks_offered, message)
  values (v_job_a1, v_org_land_a, v_org_haul_2, 1, 'Available starting Monday')
  returning id into v_interest_1;

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_land_a');
  perform marketplace.respond_to_interest(v_interest_1, 'replied', true);

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_drv2');
  select count(*) into v_count from marketplace.landing_private_details where landing_id = v_landing_a1;
  perform pg_temp.assert_true(v_count = 1, 'hauler with shared interest must see landing_private_details');

  perform marketplace.withdraw_interest(v_interest_1);
  select count(*) into v_count from marketplace.landing_private_details where landing_id = v_landing_a1;
  perform pg_temp.assert_true(v_count = 0, 'withdrawing interest must immediately revoke landing_private_details access');

  -- Platform admin cannot casually SELECT `landing_private_details`, but can call `admin_read_landing_private` with a reason.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_admin');
  select count(*) into v_count from marketplace.landing_private_details where landing_id = v_landing_a1;
  perform pg_temp.assert_true(v_count = 0, 'platform admin must not have casual SELECT on landing_private_details');

  select count(*) into v_count from marketplace.admin_read_landing_private(v_landing_a1, 'Support ticket #1042 safety check');
  perform pg_temp.assert_true(v_count = 1, 'admin_read_landing_private with valid reason must return row and log audit');

  -- ===========================================================================
  -- 6. Targeted invitations: quota exhaustion, failed delivery refund,
  --    stuck reservation timeout (Risk 3), and long-lived job re-invite (Risk 2)
  -- ===========================================================================
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_land_a');
  -- Both `v_org_haul_1` and `v_org_haul_2` are eligible now (since `v_interest_1` was withdrawn).
  v_count := marketplace.count_eligible_invitation_recipients(v_job_a1, 100);
  perform pg_temp.assert_true(v_count = 2, format('expected 2 eligible haulers, got %s', v_count));

  -- Reserve invitation 1 -> `v_org_haul_1`.
  v_inv_1 := marketplace.reserve_targeted_invitation(v_job_a1, v_org_haul_1, 'Need 4 trucks Monday');

  -- Duplicate send to `v_org_haul_1` for the same job while reserved must fail without debiting a 2nd unit.
  begin
    perform marketplace.reserve_targeted_invitation(v_job_a1, v_org_haul_1, 'Duplicate click');
    raise exception 'expected duplicate reservation to same recipient/job to fail';
  exception when check_violation then null;
  end;

  -- Simulate failed delivery on `v_inv_1` -> quota unit must be refunded (`invitations_committed` back to 0).
  -- The sending landing must not see the recipient's delivery rows (recipient user + channel are private).
  select count(*) into v_count from marketplace.invitation_deliveries where invitation_id = v_inv_1;
  perform pg_temp.assert_true(v_count = 0, 'sending landing must not see recipient invitation_deliveries');
  v_del_id := pg_temp.fixture_delivery_id(v_inv_1);
  perform pg_temp.assert_true(v_del_id is not null, 'reservation must queue at least one delivery');
  perform pg_temp.as_jwt('service_role');
  perform marketplace.resolve_invitation_delivery(v_del_id, 'failed', null, 'smtp_temp_failure');
  -- Calling resolve_invitation_delivery a second time with 'bounced' must be idempotent (never double-refund).
  perform marketplace.resolve_invitation_delivery(v_del_id, 'bounced', null, 'duplicate_webhook');

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_land_a');
  select invitations_committed into v_count from marketplace.entitlement_periods where org_id = v_org_land_a;
  perform pg_temp.assert_true(v_count = 0, 'failed delivery must refund committed invitation unit exactly once');

  -- Re-reserve to `v_org_haul_1` after failure, then test stuck reservation recovery (`expire_stale_invitation_reservations`).
  v_inv_1 := marketplace.reserve_targeted_invitation(v_job_a1, v_org_haul_1, 'Retry after failure');
  execute 'reset role';
  update marketplace.targeted_invitations set created_at = now() - interval '20 minutes' where id = v_inv_1;

  perform pg_temp.as_jwt('service_role');
  v_count := marketplace.expire_stale_invitation_reservations(interval '15 minutes');
  perform pg_temp.assert_true(v_count = 1, 'expire_stale_invitation_reservations must recover stuck reservation');

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_land_a');
  select invitations_committed into v_count from marketplace.entitlement_periods where org_id = v_org_land_a;
  perform pg_temp.assert_true(v_count = 0, 'stuck reservation timeout must release committed unit');

  -- Now deliver to `v_org_haul_1` (1 used) and `v_org_haul_2` (2 used).
  v_inv_1 := marketplace.reserve_targeted_invitation(v_job_a1, v_org_haul_1, 'Delivered invite 1');
  v_inv_2 := marketplace.reserve_targeted_invitation(v_job_a1, v_org_haul_2, 'Delivered invite 2');

  v_del_id := pg_temp.fixture_delivery_id(v_inv_1);
  perform pg_temp.as_jwt('service_role');
  perform marketplace.resolve_invitation_delivery(v_del_id, 'delivered', 'msg_1', 'ok');
  v_del_id := pg_temp.fixture_delivery_id(v_inv_2);
  perform marketplace.resolve_invitation_delivery(v_del_id, 'delivered', 'msg_2', 'ok');

  -- Consume the 3rd Basic allowance unit on a second active job at the same landing, then verify 4th is rejected.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_land_a');
  v_job_b1 := pg_temp.create_active_job(v_org_land_a, v_landing_a1, 'Pulpwood Clean-Up Haul', 6500, 'per_ton', 5);

  v_inv_3 := marketplace.reserve_targeted_invitation(v_job_b1, v_org_haul_1, '3rd and final Basic invite');

  -- 4th invitation in the same Basic cycle (allowance = 3) MUST fail with allowance exhausted.
  begin
    perform marketplace.reserve_targeted_invitation(v_job_b1, v_org_haul_2, '4th invite over limit');
    raise exception 'expected 4th invitation on Basic plan to fail with exhausted allowance';
  exception when check_violation then null;
  end;

  -- ===========================================================================
  -- 7. Billing-cycle rollover reset, long-lived job re-invite (Risk 2),
  --    and `past_due` bounded grace period (Risk 4)
  -- ===========================================================================
  -- Backdate `v_inv_1` to 40 days ago (simulating Month 1 of an 8-month job)
  -- and open Cycle 2 -> allowance resets to 3 (no rollover), and `v_org_haul_1`
  -- can be invited again for `v_job_a1` in Cycle 2 because the 30-day dedupe window elapsed!
  execute 'reset role';
  update marketplace.entitlement_periods
  set period_start = now() - interval '35 days', period_end = now() - interval '5 days'
  where org_id = v_org_land_a;
  update marketplace.targeted_invitations set created_at = now() - interval '40 days' where id = v_inv_1;

  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(
    v_org_land_a, 'basic', 'active', now() - interval '1 hour', now() + interval '30 days',
    'cus_test_a', 'sub_test_a', false, 7
  );

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_land_a');
  select invitation_allowance - invitations_committed into v_count
  from marketplace.entitlement_periods
  where org_id = v_org_land_a and now() >= period_start and now() < period_end;
  perform pg_temp.assert_true(v_count = 3, 'new cycle must start with 3 available invitations and zero rollover');

  -- Long-lived job `v_job_a1` can now re-invite `v_org_haul_1` in the new cycle!
  v_inv_1 := marketplace.reserve_targeted_invitation(v_job_a1, v_org_haul_1, 'Month 2 re-invite after dedupe window');
  perform pg_temp.assert_true(v_inv_1 is not null, 'long-lived posting must allow re-invitation after dedupe window in new cycle');

  -- Risk 4 test: transition subscription to `past_due` with 7-day grace window -> still entitled inside grace;
  -- once `grace_ends_at` is in the past, entitlements cease immediately.
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(
    v_org_land_a, 'basic', 'past_due', now() - interval '1 hour', now() + interval '30 days',
    'cus_test_a', 'sub_test_a', false, 7
  );
  execute 'reset role';
  perform pg_temp.assert_true((marketplace.org_entitled_plan(v_org_land_a)).code = 'basic', 'past_due within grace window must remain entitled');

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_land_a');
  perform pg_temp.assert_true(exists (
    select 1 from marketplace.get_org_entitlement_state(v_org_land_a)
    -- plan_code comes from org_entitled_plan() and is NULL whenever the org is not entitled,
    -- so a 'basic' plan_code during past_due proves the grace window still entitles the org.
    where subscription_status = 'past_due' and plan_code = 'basic'
  ), 'get_org_entitlement_state must report the entitled basic plan during an active past_due grace window');

  execute 'reset role';
  update marketplace.organization_subscriptions
  set past_due_since = now() - interval '10 days', grace_ends_at = now() - interval '3 days'
  where org_id = v_org_land_a;
  perform pg_temp.assert_true((marketplace.org_entitled_plan(v_org_land_a)).id is null, 'expired past_due grace window must revoke plan entitlement');

  -- Restore active Pro subscription (5 landing seats, 3 active landings).
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(
    v_org_land_a, 'pro', 'active', now() - interval '1 hour', now() + interval '30 days',
    'cus_test_a', 'sub_test_a', false, 7
  );

  -- Item 1 test: on Pro, grant `v_u_staff` a 3rd paid landing seat (`landing_workspace_seat = true`)
  -- and activate a 2nd landing (`v_landing_a2`).
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_land_a');
  update marketplace.organization_memberships set landing_workspace_seat = true
  where org_id = v_org_land_a and user_id = v_u_staff;
  update marketplace.landings set status = 'active' where id = v_landing_a2;

  -- Interactive downgrade to Basic (`p_allow_over_limit = false`, the default) MUST fail
  -- with an explicit 23514 conflict error rather than silently suspending employees.
  perform pg_temp.as_jwt('service_role');
  begin
    perform marketplace.open_subscription_cycle(
      v_org_land_a, 'basic', 'active', now() - interval '1 hour', now() + interval '30 days',
      'cus_test_a', 'sub_test_a', false, 7, false
    );
    raise exception 'expected interactive downgrade with excess landing seats/landings to fail';
  exception when check_violation then null;
  end;

  -- External renewal webhook downgrade (`p_allow_over_limit = true`) records the Basic cycle
  -- WITHOUT suspending any member (`v_u_staff` stays `status = 'active'`) and flags
  -- `seat_conflict = true` and `landing_conflict = true` in `get_org_entitlement_state`.
  perform marketplace.open_subscription_cycle(
    v_org_land_a, 'basic', 'active', now() - interval '1 hour', now() + interval '30 days',
    'cus_test_a', 'sub_test_a', false, 7, true
  );

  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_land_a');
  perform pg_temp.assert_true(exists (
    select 1 from marketplace.organization_memberships
    where org_id = v_org_land_a and user_id = v_u_staff and status = 'active' and landing_workspace_seat
  ), 'downgrade must never silently suspend existing members');

  perform pg_temp.assert_true(exists (
    select 1 from marketplace.get_org_entitlement_state(v_org_land_a)
    where plan_code = 'basic' and paid_landing_seats = 3 and max_team_members = 2
      and seat_conflict is true and active_landings = 2 and max_active_landings = 1
      and landing_conflict is true and fleet_only_members = 1
  ), 'get_org_entitlement_state must report seat_conflict and landing_conflict accurately');

  -- While conflicted, publishing a new job or sending a targeted invitation is blocked.
  perform pg_temp.expect_failure(format('select pg_temp.create_active_job(%L, %L, %L, 8000, %L, 2)',
      v_org_land_a, v_landing_a1, 'Blocked While Conflicted', 'per_ton'),
    '23514', 'exceeds plan|conflict', 'publishing while in seat/landing conflict must be rejected by the conflict rule');

  -- Owner explicitly resolves excess seat (converts `v_u_staff` back to fleet-only) and deactivates 2nd landing.
  update marketplace.organization_memberships set landing_workspace_seat = false
  where org_id = v_org_land_a and user_id = v_u_staff;
  update marketplace.landings set status = 'inactive' where id = v_landing_a2;

  perform pg_temp.assert_true(exists (
    select 1 from marketplace.get_org_entitlement_state(v_org_land_a)
    where seat_conflict is false and landing_conflict is false
      and paid_landing_seats = 2 and fleet_only_members = 2 and active_landings = 1
  ), 'explicit owner resolution must clear seat_conflict and landing_conflict');

  -- Upgrade back to Pro for promotion and boost tests.
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(
    v_org_land_a, 'pro', 'active', now() - interval '1 hour', now() + interval '30 days',
    'cus_test_a', 'sub_test_a', false, 7
  );

  -- ===========================================================================
  -- 8. Founding-member promotion caps (6 cycles) & job boost expiration
  -- ===========================================================================
  execute 'reset role';
  insert into marketplace.promotions
    (code, program, state_code, percent_off, billing_cycles, max_redemptions, starts_at, status)
  values
    ('founding_or_test', 'founding_landing', 'OR', 50.00, 6, 1, now() - interval '1 day', 'active')
  returning id into v_promo_id;

  -- Unverified organization cannot receive the founding offer.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_admin');
  begin
    perform marketplace.admin_grant_founding_promotion('founding_or_test', v_org_land_a, 'Early pilot applicant');
    raise exception 'expected unverified organization to be rejected for founding promotion';
  exception when check_violation then null;
  end;

  -- Verify `v_org_land_a`, then grant the founding offer (cap = 1 for this test cohort).
  perform marketplace.admin_set_org_verification(v_org_land_a, 'verified', 'Checked Oregon SOS registry');
  perform marketplace.admin_grant_founding_promotion('founding_or_test', v_org_land_a, 'Approved OR founder #1');

  -- A 2nd verified organization in the same cohort MUST be rejected when max_redemptions (1) is reached.
  perform marketplace.admin_set_org_verification(v_org_land_b, 'verified', 'Checked Oregon SOS registry #2');
  begin
    perform marketplace.admin_grant_founding_promotion('founding_or_test', v_org_land_b, 'Attempt over state cap');
    raise exception 'expected founding promotion grant beyond max_redemptions to fail';
  exception when check_violation then null;
  end;

  -- Fleet-only staff (`v_u_staff` has `landing_workspace_seat = false`) must be denied Landing Operator writes by RLS.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_staff_a');
  begin
    insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
    values (v_org_land_a, 'Unauthorized Fleet Staff Landing', 'inactive', 'Sweet Home, OR',
            extensions.st_setsrid(extensions.st_makepoint(-122.72, 44.39), 4326)::extensions.geography, 'OR');
    raise exception 'expected fleet-only staff without landing_workspace_seat to be denied landing insert';
  exception when insufficient_privilege then null;
  end;

  -- Restore admin session for Founding Hauler badge test.
  perform pg_temp.as_jwt('authenticated', v_issuer, 'user_admin');
  -- Granting Founding Hauler badge #1 to `v_org_haul_1`.
  v_count := marketplace.admin_grant_founding_hauler_badge(v_org_haul_1, 'Early OR hauler #1');
  perform pg_temp.assert_true(v_count = 1, 'expected Founding Hauler badge #1');

  -- Activate a 7-day Quick Boost ($99) on `v_job_a1` and verify `search_job_postings` marks it `is_sponsored = true`.
  perform pg_temp.as_jwt('service_role');
  v_boost_id := marketplace.activate_job_boost(v_job_a1, 'quick', v_u_land, 'pi_test_boost_1', now() - interval '1 hour');

  -- Overlapping active boost on the same job MUST be rejected by GiST exclusion constraint.
  begin
    perform marketplace.activate_job_boost(v_job_a1, 'extended', v_u_land, 'pi_test_boost_2', now());
    raise exception 'expected overlapping active boost on same job to fail exclusion constraint';
  exception when exclusion_violation then null;
  end;

  perform pg_temp.as_jwt('anon');
  perform pg_temp.assert_true(exists (
    select 1 from marketplace.search_job_postings(null, 100, null, null, null, 2, 10)
    where job_id = v_job_a1 and is_sponsored is true
  ), 'active boost must surface as is_sponsored = true');

  -- Expire the boost window -> `is_sponsored` must become false while organic listing remains visible.
  execute 'reset role';
  update marketplace.job_boosts
  set starts_at = now() - interval '8 days', ends_at = now() - interval '1 day'
  where id = v_boost_id;

  perform pg_temp.as_jwt('anon');
  perform pg_temp.assert_true(exists (
    select 1 from marketplace.search_job_postings(null, 100, null, null, null, 2, 10)
    where job_id = v_job_a1 and is_sponsored is false
  ), 'expired boost must no longer be marked is_sponsored');

  -- Audit log append-only enforcement: UPDATE or DELETE on `audit_events` must fail.
  execute 'reset role';
  begin
    delete from marketplace.audit_events;
    raise exception 'expected DELETE on audit_events to fail';
  exception when insufficient_privilege then null;
  end;

  raise notice 'PASS: All normalized-v2 integration, RLS, seat-separation, downgrade, spatial, and entitlement assertions succeeded.';
end
$$;

-- Two-connection concurrency verification harness (run via `pgbench -n -c 2 -j 2 -t 1 -f ...`
-- when a local PostgreSQL server is available):
--   Both sessions call `marketplace.reserve_targeted_invitation(v_job_id, v_recipient_id)`
--   when `invitation_allowance - invitations_committed = 1`. PostgreSQL row locking on
--   `marketplace.entitlement_periods` in `reserve_targeted_invitation` guarantees that
--   exactly 1 session commits and the other raises SQLSTATE 23514 (`allowance exhausted`).

rollback;
