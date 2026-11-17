-- =============================================================================
-- LogLoads normalized-v2 — 39 regression suite for 38 (basins, #324)
--
-- NON-ACTIVE PROTOTYPE TEST SUITE. Disposable PostgreSQL only. Run after 38.
-- Wraps everything in BEGIN ... ROLLBACK. Negative tests require the SQLSTATE and a matching message.
-- Run as the role that applied 38.
-- The gate is off until a basin exists: the assertions before the first create_basin are the proof.
-- =============================================================================

begin;

create function pg_temp.as_jwt(p_role text, p_sub text default null) returns void language plpgsql as $$
begin
  if p_role = 'service_role' then
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    execute 'set local role service_role';
  elsif p_role = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  elsif p_role = 'harness' then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
  else
    perform set_config('request.jwt.claims', jsonb_build_object(
      'role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', p_sub, 'aud', 'logloads-app',
      'exp', extract(epoch from now())::bigint + 3600)::text, true);
    execute 'set local role authenticated';
  end if;
end
$$;

create function pg_temp.as_reader(p_sub text) returns void language plpgsql as $$
begin
  if p_sub is null then
    perform pg_temp.as_jwt('anon');
  else
    perform pg_temp.as_jwt('authenticated', p_sub);
  end if;
end
$$;

create function pg_temp.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if p_cond is not true then
    raise exception 'TEST FAILED: %', p_label using errcode = 'P0001';
  end if;
  raise notice 'PASS: %', p_label;
end
$$;

create function pg_temp.fails(p_sql text, p_state text, p_reason text, p_label text) returns void language plpgsql as $$
declare v_state text; v_msg text; v_constraint text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_constraint = constraint_name;
    if v_state = p_state and (coalesce(v_constraint, '') ~* p_reason or v_msg ~* p_reason) then
      raise notice 'PASS: % (% /%/)', p_label, v_state, p_reason;
      return;
    end if;
    raise exception 'TEST FAILED: % — expected % /%/, got % constraint=% message=%',
      p_label, p_state, p_reason, v_state, coalesce(v_constraint, '-'), v_msg using errcode = 'P0001';
  end;
  raise exception 'TEST FAILED: % — expected failure %, statement succeeded', p_label, p_state using errcode = 'P0001';
end
$$;

create function pg_temp.count_as(p_sub text, p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform pg_temp.as_reader(p_sub);
  execute p_sql into v;
  perform pg_temp.as_jwt('harness');
  return v;
end
$$;

create function pg_temp.sees(p_sub text, p_job uuid) returns boolean language sql as $$
  select pg_temp.count_as(p_sub, format('select count(*) from marketplace.job_postings where id = %L', p_job)) = 1
$$;
create function pg_temp.lists(p_sub text, p_job uuid, p_org uuid) returns boolean language sql as $$
  select pg_temp.count_as(p_sub, format(
    'select count(*) from marketplace.list_marketplace_jobs(p_accepting_only => false, p_org_id => %L, p_limit => 200) l where l.job_id = %L',
    p_org, p_job)) = 1
$$;
create function pg_temp.searches(p_sub text, p_job uuid) returns boolean language sql as $$
  select pg_temp.count_as(p_sub, format(
    'select count(*) from marketplace.search_job_postings(null, 100, null, null, null, 2, 100) s where s.job_id = %L', p_job)) = 1
$$;
create function pg_temp.gets(p_sub text, p_job uuid) returns boolean language sql as $$
  select pg_temp.count_as(p_sub, format('select count(*) from marketplace.get_marketplace_job(%L)', p_job)) = 1
$$;
create function pg_temp.notice(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.as_jwt('anon');
  execute p_sql into v;
  perform pg_temp.as_jwt('harness');
  return v;
end
$$;
create function pg_temp.answer(p_sub text, p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text;
begin
  perform pg_temp.as_reader(p_sub);
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    perform pg_temp.as_jwt('harness');
    return v_state || ' ' || v_msg;
  end;
  perform pg_temp.as_jwt('harness');
  return 'ok';
end
$$;

grant execute on all functions in schema pg_temp to public;

insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true) on conflict (issuer) do nothing;

do $$
declare
  c_iss constant text := 'https://clerk.logloads.test';
  c_box constant text := 'SRID=4326;POLYGON((-121.8 44.0, -121.0 44.0, -121.0 44.8, -121.8 44.8, -121.8 44.0))';
  c_core constant text := 'SRID=4326;POLYGON((-121.6 44.2, -121.4 44.2, -121.4 44.4, -121.6 44.4, -121.6 44.2))';
  u_own uuid; u_haul uuid; u_haul2 uuid; u_old uuid; u_gone uuid; u_admin uuid; u_none uuid;
  o_land uuid; o_haul uuid; o_haul2 uuid; o_old uuid; o_gone uuid;
  l_box uuid; l_lane uuid; j_box uuid; j_lane uuid;
  b_box uuid; b_lane uuid; b_core uuid;
  v_ready record; v_audits bigint;
begin
  perform pg_temp.as_jwt('service_role');
  u_own   := marketplace.sync_verified_identity(c_iss, 's38_own',   'S38 Landing Owner', 'own@s38.test',   true);
  u_haul  := marketplace.sync_verified_identity(c_iss, 's38_haul',  'S38 Hauler',        'haul@s38.test',  true);
  u_haul2 := marketplace.sync_verified_identity(c_iss, 's38_haul2', 'S38 Second Hauler', 'haul2@s38.test', true);
  u_old   := marketplace.sync_verified_identity(c_iss, 's38_old',   'S38 Stale Hauler',  'old@s38.test',   true);
  u_gone  := marketplace.sync_verified_identity(c_iss, 's38_gone',  'S38 Withdrawn',     'gone@s38.test',  true);
  u_admin := marketplace.sync_verified_identity(c_iss, 's38_admin', 'S38 Platform Admin','admin@s38.test', true);
  u_none  := marketplace.sync_verified_identity(c_iss, 's38_none',  'S38 Signed In',     'none@s38.test',  true);
  perform pg_temp.as_jwt('harness');
  insert into marketplace.platform_admins (user_id, admin_role, note) values (u_admin, 'superadmin', 'suite 39');

  perform pg_temp.as_jwt('authenticated', 's38_own');
  o_land := marketplace.create_organization('S38 Landing Co', 's38-landing', 'OR', false);
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_land, 'pro', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_s38', 'sub_s38', false, 7, false);
  perform pg_temp.as_jwt('authenticated', 's38_own');
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code, county)
  values (o_land, 'S38 Sisters', 'active', 'Near Sisters, OR', marketplace.make_public_point(-121.5, 44.3), 'OR', 'Deschutes')
  returning id into l_box;
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code, county)
  values (o_land, 'S38 Lane', 'active', 'Near Eugene, OR', marketplace.make_public_point(-123.1, 44.1), 'OR', 'Lane')
  returning id into l_lane;
  j_box := marketplace.publish_job_posting(l_box, 'S38 Sisters Haul', array['log_truck'], 2, 'Fir', 'Suite 39 Sisters job.', 'per_ton', 510, null,
    2, current_date + 10, 8, 3.0, 6, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  j_lane := marketplace.publish_job_posting(l_lane, 'S38 Lane Haul', array['log_truck'], 1, 'Fir', 'Suite 39 Lane job.', 'per_ton', 480, null,
    1, current_date + 10, 8, 3.0, 6, 30.0, 'Eugene Mill, OR', 40, null, null, array['ppe'], true);

  perform pg_temp.as_jwt('authenticated', 's38_haul');
  o_haul := marketplace.create_organization('S38 Hauling', 's38-hauling', 'OR', true);
  perform pg_temp.as_jwt('authenticated', 's38_haul2');
  o_haul2 := marketplace.create_organization('S38 Second Hauling', 's38-hauling-2', 'OR', true);
  perform pg_temp.as_jwt('authenticated', 's38_old');
  o_old := marketplace.create_organization('S38 Stale Hauling', 's38-stale', 'OR', true);
  perform pg_temp.as_jwt('authenticated', 's38_gone');
  o_gone := marketplace.create_organization('S38 Withdrawn Hauling', 's38-withdrawn', 'OR', true);
  perform pg_temp.as_jwt('harness');

  -- Gate off: no basin has been recorded, so discovery and interest are unchanged and the notice is null.
  perform pg_temp.ok(pg_temp.sees(null, j_box) and pg_temp.lists(null, j_box, null) and pg_temp.searches(null, j_box) and pg_temp.gets(null, j_box),
    'gate off: anon lists, searches and opens a job when no basin exists');
  perform pg_temp.ok(pg_temp.notice('select marketplace.public_area_notice()') is null
                     and pg_temp.notice(format('select marketplace.public_area_notice(%L)', j_box)) is null,
    'gate off: the area notice is null');
  perform pg_temp.ok(marketplace.job_takes_new_interest(j_box)
                     and pg_temp.answer('s38_haul', format('select marketplace.submit_expression_of_interest(%L, %L, 1)', o_haul, j_box)) = 'ok',
    'gate off: a hauler can express interest');

  -- Staff only, and a basin needs a shape and a reason.
  perform pg_temp.ok(pg_temp.answer('s38_own', format(
      'select marketplace.create_basin(%L, %L, array[%L], null, %L)', 'Nope', 'OR', 'Lane', 'A landing owner is not staff')) ~ '^42501',
    'a landing owner cannot record a basin');
  perform pg_temp.as_jwt('authenticated', 's38_admin');
  perform pg_temp.fails('select marketplace.create_basin(''Nowhere'', ''OR'', ''{}''::text[], null, ''No shape at all here'')',
    '22023', 'boundary or a county', 'a basin needs a boundary or a county');
  perform pg_temp.fails('select marketplace.create_basin(''Nowhere'', ''OR'', array[''Lane''], null, ''no'')',
    '22023', 'reason', 'a short reason is refused');
  perform pg_temp.fails('select marketplace.create_basin(''Nowhere'', ''Oregon'', array[''Lane''], null, ''A real reason here'')',
    '22023', 'state', 'a state must be two letters');
  perform pg_temp.fails(format('select marketplace.create_basin(''Dot'', ''OR'', ''{}''::text[], %L, ''A point is not an area'')', 'SRID=4326;POINT(-121.5 44.3)'),
    '22023', 'polygon', 'a point is not a basin boundary');

  b_box := marketplace.create_basin('Sisters', 'OR', '{}'::text[], c_box, 'Recording the Sisters box');
  b_lane := marketplace.create_basin('Lane', 'OR', array['Lane', ' lane '], null, 'Recording the Lane county list');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(b_box is not null and b_lane is not null
                     and (select status = 'closed' and cardinality(counties) = 1 from marketplace.basins where id = b_lane)
                     and (select count(*) = 1 from marketplace.audit_events where entity_id = b_box and action = 'basin.created'),
    'a new basin is closed, counties are deduped, and the reason is audited');
  perform pg_temp.ok(marketplace.basin_for_landing(l_box) = b_box and marketplace.basin_for_landing(l_lane) = b_lane,
    'a landing takes the boundary that covers its point, or else its county');

  -- Closed: the public board, search, the share read and new interest stop. The desk still sees its job.
  perform pg_temp.ok(not pg_temp.sees(null, j_box) and not pg_temp.lists(null, j_box, null) and not pg_temp.searches(null, j_box) and not pg_temp.gets(null, j_box)
                     and not pg_temp.sees(null, j_lane) and pg_temp.count_as(null, format('select count(*) from marketplace.job_posting_equipment where job_id = %L', j_box)) = 0,
    'closed: anon cannot list, search, open or read equipment for either job');
  perform pg_temp.ok(pg_temp.sees('s38_own', j_box) and pg_temp.lists('s38_own', j_box, o_land) and not pg_temp.sees('s38_none', j_box),
    'closed: the owning desk still sees its job and a stranger does not');
  perform pg_temp.ok(pg_temp.notice(format('select marketplace.public_area_notice(%L)', j_box)) = 'not in your area yet'
                     and pg_temp.notice('select marketplace.public_area_notice(''00000000-0000-4000-8000-000000000099'')') is null
                     and pg_temp.notice('select marketplace.public_area_notice(null, 44.3, -121.5, ''OR'', null)') = 'not in your area yet'
                     and pg_temp.notice('select marketplace.public_area_notice(null, 47.6, -122.3, ''WA'', null)') = 'not in your area yet'
                     and pg_temp.notice('select marketplace.public_area_notice()') = 'not in your area yet',
    'closed: the notice is the phrase, and an unknown job id stays null');
  perform pg_temp.ok(not marketplace.job_takes_new_interest(j_box)
                     and pg_temp.answer('s38_haul2', format('select marketplace.submit_expression_of_interest(%L, %L, 1)', o_haul2, j_box)) ~ '^23514 .*accepting',
    'closed: a new expression of interest is refused');

  -- Readiness counts supply even while the basin is closed. Stale and withdrawn reports do not count.
  perform pg_temp.as_jwt('authenticated', 's38_haul');
  insert into marketplace.availability_reports (org_id, equipment_code, available_count, area_center, area_label, radius_miles, available_from, available_until)
  values (o_haul, 'log_truck', 1, extensions.st_geogfromtext('SRID=4326;POINT(-121.5 44.3)'), 'Sisters', 80, current_date, current_date + 14);
  perform pg_temp.as_jwt('authenticated', 's38_old');
  insert into marketplace.availability_reports (org_id, equipment_code, available_count, area_center, area_label, radius_miles, available_from, available_until)
  values (o_old, 'log_truck', 1, extensions.st_geogfromtext('SRID=4326;POINT(-121.5 44.3)'), 'Sisters', 80, current_date, current_date + 14);
  perform pg_temp.as_jwt('authenticated', 's38_gone');
  insert into marketplace.availability_reports (org_id, equipment_code, available_count, area_center, area_label, radius_miles, available_from, available_until, withdrawn_at)
  values (o_gone, 'log_truck', 1, extensions.st_geogfromtext('SRID=4326;POINT(-121.5 44.3)'), 'Sisters', 80, current_date, current_date + 14, now());
  perform pg_temp.as_jwt('harness');
  alter table marketplace.availability_reports disable trigger user;
  update marketplace.availability_reports set reported_at = now() - interval '337 hours' where org_id = o_old;
  alter table marketplace.availability_reports enable trigger user;

  perform pg_temp.as_jwt('authenticated', 's38_admin');
  select * into v_ready from marketplace.basin_readiness(b_box);
  perform pg_temp.ok(v_ready.verified_landings = 0 and v_ready.active_jobs = 1 and v_ready.haulers_available = 1,
    'readiness: an unverified landing does not count, a fresh hauler does, a stale or withdrawn one does not');
  perform marketplace.admin_set_org_verification(o_land, 'verified', 'Suite 39 verification');
  select * into v_ready from marketplace.basin_readiness(b_box);
  perform pg_temp.ok(v_ready.verified_landings = 1 and v_ready.active_jobs = 1 and v_ready.haulers_available = 1 and v_ready.status = 'closed',
    'readiness: a verified active landing in the basin counts');
  select * into v_ready from marketplace.basin_readiness(b_lane);
  perform pg_temp.ok(v_ready.verified_landings = 1 and v_ready.active_jobs = 1 and v_ready.haulers_available = 0,
    'readiness: a county-only basin counts its landing and job, and no hauler point');

  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.answer('s38_own', format('select marketplace.set_basin_status(%L, %L, %L)', b_box, 'pilot', 'Not staff')) ~ '^42501',
    'a landing owner cannot set a basin status');
  perform pg_temp.as_jwt('authenticated', 's38_admin');
  perform pg_temp.fails(format('select marketplace.set_basin_status(%L, ''live'', ''Not a status'')', b_box), '22023', 'status', 'an unknown status is refused');
  perform pg_temp.fails('select marketplace.set_basin_status(''00000000-0000-4000-8000-000000000099'', ''pilot'', ''No such basin'')', 'P0002', 'not found', 'an unknown basin is refused');
  perform marketplace.set_basin_status(b_box, 'pilot', 'Enough landings and trucks to pilot');
  perform marketplace.set_basin_status(b_box, 'pilot', 'Saying pilot again changes nothing');
  perform pg_temp.as_jwt('harness');
  select count(*) into v_audits from marketplace.audit_events where entity_id = b_box and action = 'basin.status_set';
  perform pg_temp.ok(v_audits = 1 and (select status = 'pilot' from marketplace.basins where id = b_box),
    'pilot is audited once, and the same status again is not audited');

  perform pg_temp.ok(pg_temp.sees(null, j_box) and pg_temp.lists(null, j_box, null) and pg_temp.searches(null, j_box) and pg_temp.gets(null, j_box)
                     and not pg_temp.sees(null, j_lane),
    'pilot: the box job is public and the closed county job is not');
  perform pg_temp.ok(pg_temp.notice(format('select marketplace.public_area_notice(%L)', j_box)) is null
                     and pg_temp.notice(format('select marketplace.public_area_notice(%L)', j_lane)) = 'not in your area yet'
                     and pg_temp.notice('select marketplace.public_area_notice()') is null
                     and pg_temp.notice('select marketplace.public_area_notice(null, 44.1, -123.1, ''OR'', ''Lane'')') = 'not in your area yet',
    'pilot: a launched place has no notice, a closed county still does, and anywhere is open');
  perform pg_temp.ok(pg_temp.answer('s38_haul2', format('select marketplace.submit_expression_of_interest(%L, %L, 1)', o_haul2, j_box)) = 'ok'
                     and pg_temp.answer('s38_haul2', format('select marketplace.submit_expression_of_interest(%L, %L, 1)', o_haul2, j_lane)) ~ '^23514',
    'pilot: interest is accepted on the launched job and refused on the closed one');

  -- The smallest boundary wins, so a closed basin inside an open one hides the point.
  perform pg_temp.as_jwt('authenticated', 's38_admin');
  b_core := marketplace.create_basin('Sisters core', 'OR', '{}'::text[], c_core, 'A smaller closed basin inside the pilot');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(marketplace.basin_for_landing(l_box) = b_core and not pg_temp.sees(null, j_box)
                     and pg_temp.notice(format('select marketplace.public_area_notice(%L)', j_box)) = 'not in your area yet',
    'the smallest boundary wins: a closed core hides a job the larger pilot basin also covers');
  perform pg_temp.as_jwt('authenticated', 's38_admin');
  perform marketplace.set_basin_status(b_core, 'open', 'The core is open too');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.sees(null, j_box) and pg_temp.notice(format('select marketplace.public_area_notice(%L)', j_box)) is null,
    'open: the job is public again');
  perform pg_temp.as_jwt('authenticated', 's38_admin');
  perform marketplace.set_basin_status(b_box, 'open', 'The larger basin is open as well');
  perform marketplace.set_basin_status(b_core, 'closed', 'The core closes again');
  perform pg_temp.ok((select count(*) = 3 from marketplace.list_basins()), 'staff can list every basin');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(not pg_temp.sees(null, j_box), 'a closed core still hides the job when the larger basin is open');
  perform pg_temp.ok(pg_temp.answer('s38_own', 'select * from marketplace.list_basins()') ~ '^42501'
                     and pg_temp.answer('s38_own', 'insert into marketplace.basins (name, state_code, counties) values (''Nope'', ''OR'', array[''Lane''])') ~ '^42501',
    'a landing owner cannot list basins or insert one directly');

  perform pg_temp.ok(has_function_privilege('anon', 'marketplace.public_area_notice(uuid, numeric, numeric, text, text)', 'EXECUTE')
                     and has_function_privilege('authenticated', 'marketplace.public_area_notice(uuid, numeric, numeric, text, text)', 'EXECUTE')
                     and not has_function_privilege('service_role', 'marketplace.public_area_notice(uuid, numeric, numeric, text, text)', 'EXECUTE')
                     and not has_function_privilege('anon', 'marketplace.create_basin(text, text, text[], text, text)', 'EXECUTE')
                     and has_function_privilege('authenticated', 'marketplace.create_basin(text, text, text[], text, text)', 'EXECUTE')
                     and not has_function_privilege('service_role', 'marketplace.set_basin_status(uuid, text, text)', 'EXECUTE')
                     and not has_function_privilege('anon', 'marketplace.basin_counties_valid(text[])', 'EXECUTE')
                     and not has_function_privilege('authenticated', 'marketplace.basin_counties_valid(text[])', 'EXECUTE')
                     and not has_function_privilege('anon', 'marketplace.basin_for_point(extensions.geography, text, text)', 'EXECUTE')
                     and not has_function_privilege('authenticated', 'marketplace.landing_basin_launched(uuid)', 'EXECUTE')
                     and (select p.provolatile = 's' from pg_proc p where p.oid = 'marketplace.public_area_notice(uuid, numeric, numeric, text, text)'::regprocedure)
                     and (select count(*) = 1 and bool_and(p.proname = 'unsubscribe_with_token') from pg_proc p
                          where p.pronamespace = 'marketplace'::regnamespace and p.provolatile = 'v' and has_function_privilege('anon', p.oid, 'EXECUTE')),
    'grants: the notice is a stable read for anon and authenticated; staff functions are authenticated only; internals are neither');
  perform pg_temp.ok((select c.relrowsecurity and not c.relforcerowsecurity from pg_class c where c.oid = 'marketplace.basins'::regclass)
                     and not exists (select 1 from pg_policies where schemaname = 'marketplace' and tablename = 'basins')
                     and not has_table_privilege('anon', 'marketplace.basins', 'SELECT')
                     and not has_table_privilege('authenticated', 'marketplace.basins', 'SELECT')
                     and not has_table_privilege('service_role', 'marketplace.basins', 'INSERT'),
    'the basin table has row-level security, no policy and no API grant');
  perform pg_temp.ok((select bool_and(p.prosrc like '%landing_basin_launched%') from pg_proc p
                      where p.pronamespace = 'marketplace'::regnamespace and p.proname in ('job_is_publicly_visible', 'search_job_postings')),
    'the public job check and the search both ask whether the landing''s basin is launched');
  perform pg_temp.ok((select string_agg(version, ',' order by applied_at, version) from marketplace.schema_migrations)
                       = '06,11,12,16,18,23,26,29,31,33,35,38',
    'the migration ledger records 38 after 35');

  raise notice 'ALL BASIN LAUNCH (38-B) TESTS PASSED';
end
$$;

rollback;
