-- =============================================================================
-- LogLoads normalized-v2 — 43 regression suite for 42 (per-basin liquidity board, #326)
--
-- NON-ACTIVE PROTOTYPE TEST SUITE. Disposable PostgreSQL only. Run after 42.
-- Wraps everything in BEGIN ... ROLLBACK. Run as the role that applied 42.
-- The inquiries are sent before any basin is recorded, while the launch gate (38) is still off.
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

create function pg_temp.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if p_cond is not true then
    raise exception 'TEST FAILED: %', p_label using errcode = 'P0001';
  end if;
  raise notice 'PASS: %', p_label;
end
$$;

-- 'ok', or the SQLSTATE and message of the refusal. A null subject reads as a signed-out visitor.
create function pg_temp.answer(p_sub text, p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text;
begin
  if p_sub is null then
    perform pg_temp.as_jwt('anon');
  else
    perform pg_temp.as_jwt('authenticated', p_sub);
  end if;
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
  c_box constant text := 'SRID=4326;POLYGON((-118.1 44.5, -117.5 44.5, -117.5 45.1, -118.1 45.1, -118.1 44.5))';
  c_board constant text := 'select * from marketplace.basin_liquidity_board()';
  u_own uuid; u_haul uuid; u_haul2 uuid; u_haul3 uuid; u_admin uuid; u_mod uuid;
  o_land uuid; o_haul uuid; o_haul2 uuid; o_haul3 uuid;
  l_box uuid; l_lane uuid;
  j_fresh uuid; j_stale uuid; j_paused uuid; j_lane uuid;
  e_fast uuid; e_mid uuid; e_slow uuid; e_open uuid; e_gone uuid; e_paused uuid; e_lane uuid;
  b_box uuid; b_lane uuid; b_coos uuid;
  v_row record; v_ready record; v_names text;
begin
  perform pg_temp.as_jwt('service_role');
  u_own   := marketplace.sync_verified_identity(c_iss, 's42_own',   'S42 Landing Owner',  'own@s42.test',   true);
  u_haul  := marketplace.sync_verified_identity(c_iss, 's42_haul',  'S42 Hauler',         'haul@s42.test',  true);
  u_haul2 := marketplace.sync_verified_identity(c_iss, 's42_haul2', 'S42 Second Hauler',  'haul2@s42.test', true);
  u_haul3 := marketplace.sync_verified_identity(c_iss, 's42_haul3', 'S42 Third Hauler',   'haul3@s42.test', true);
  u_admin := marketplace.sync_verified_identity(c_iss, 's42_admin', 'S42 Platform Admin', 'admin@s42.test', true);
  u_mod   := marketplace.sync_verified_identity(c_iss, 's42_mod',   'S42 Moderator',      'mod@s42.test',   true);
  perform pg_temp.as_jwt('harness');
  insert into marketplace.platform_admins (user_id, admin_role, note) values
    (u_admin, 'superadmin', 'suite 43'),
    (u_mod, 'moderator', 'suite 43');

  perform pg_temp.as_jwt('authenticated', 's42_own');
  o_land := marketplace.create_organization('S42 Landing Co', 's42-landing', 'OR', false);
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_land, 'pro', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_s42', 'sub_s42', false, 7, false);
  perform pg_temp.as_jwt('authenticated', 's42_own');
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code, county)
  values (o_land, 'S42 Baker', 'active', 'Near Baker City, OR', marketplace.make_public_point(-117.8, 44.8), 'OR', 'Baker')
  returning id into l_box;
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code, county)
  values (o_land, 'S42 Lane', 'active', 'Near Eugene, OR', marketplace.make_public_point(-123.1, 44.1), 'OR', 'Lane')
  returning id into l_lane;
  j_fresh := marketplace.publish_job_posting(l_box, 'S42 Fresh Haul', array['log_truck'], 2, 'Fir', 'Suite 43 fresh job.', 'per_ton', 510, null,
    2, current_date + 10, 8, 3.0, 6, 30.0, 'Baker Mill, OR', 28, null, null, array['ppe'], true);
  j_stale := marketplace.publish_job_posting(l_box, 'S42 Stale Haul', array['log_truck'], 1, 'Fir', 'Suite 43 stale job.', 'per_ton', 500, null,
    1, current_date + 10, 8, 3.0, 6, 30.0, 'Baker Mill, OR', 28, null, null, array['ppe'], true);
  j_paused := marketplace.publish_job_posting(l_box, 'S42 Paused Haul', array['log_truck'], 1, 'Fir', 'Suite 43 paused job.', 'per_ton', 490, null,
    1, current_date + 10, 8, 3.0, 6, 30.0, 'Baker Mill, OR', 28, null, null, array['ppe'], true);
  j_lane := marketplace.publish_job_posting(l_lane, 'S42 Lane Haul', array['log_truck'], 1, 'Fir', 'Suite 43 Lane job.', 'per_ton', 480, null,
    1, current_date + 10, 8, 3.0, 6, 30.0, 'Eugene Mill, OR', 40, null, null, array['ppe'], true);

  -- Seven inquiries while the launch gate is off. Baker: three answered, one waiting, one withdrawn, and one on
  -- the job that is paused below. Lane: one waiting.
  perform pg_temp.as_jwt('authenticated', 's42_haul');
  o_haul := marketplace.create_organization('S42 Hauling', 's42-hauling', 'OR', true);
  select interest_id into e_fast from marketplace.submit_expression_of_interest(o_haul, j_fresh, 1);
  select interest_id into e_slow from marketplace.submit_expression_of_interest(o_haul, j_stale, 1);
  select interest_id into e_paused from marketplace.submit_expression_of_interest(o_haul, j_paused, 1);
  perform pg_temp.as_jwt('authenticated', 's42_haul2');
  o_haul2 := marketplace.create_organization('S42 Second Hauling', 's42-hauling-2', 'OR', true);
  select interest_id into e_mid from marketplace.submit_expression_of_interest(o_haul2, j_fresh, 1);
  select interest_id into e_open from marketplace.submit_expression_of_interest(o_haul2, j_stale, 1);
  select interest_id into e_lane from marketplace.submit_expression_of_interest(o_haul2, j_lane, 1);
  perform pg_temp.as_jwt('authenticated', 's42_haul3');
  o_haul3 := marketplace.create_organization('S42 Third Hauling', 's42-hauling-3', 'OR', true);
  select interest_id into e_gone from marketplace.submit_expression_of_interest(o_haul3, j_fresh, 1);
  perform marketplace.withdraw_interest(e_gone);

  perform pg_temp.as_jwt('authenticated', 's42_own');
  perform marketplace.respond_to_interest(e_fast, 'replied', null, gen_random_uuid(), 'Suite 43: yes, Monday.');
  perform marketplace.respond_to_interest(e_mid, 'replied', null, gen_random_uuid(), 'Suite 43: yes, Tuesday.');
  perform marketplace.respond_to_interest(e_slow, 'declined');
  perform marketplace.respond_to_interest(e_paused, 'replied', null, gen_random_uuid(), 'Suite 43: this one is on hold.');
  perform marketplace.set_job_posting_status(j_paused, 'paused');
  perform pg_temp.as_jwt('harness');

  -- First responses after 30, 60 and 180 minutes: the median is 60. The paused job's 5-minute reply is not counted.
  alter table marketplace.expressions_of_interest disable trigger user;
  update marketplace.expressions_of_interest set created_at = now() - interval '4 hours', responded_at = now() - interval '210 minutes' where id = e_fast;
  update marketplace.expressions_of_interest set created_at = now() - interval '4 hours', responded_at = now() - interval '3 hours' where id = e_mid;
  update marketplace.expressions_of_interest set created_at = now() - interval '4 hours', responded_at = now() - interval '1 hour' where id = e_slow;
  update marketplace.expressions_of_interest set created_at = now() - interval '4 hours', responded_at = now() - interval '235 minutes' where id = e_paused;
  alter table marketplace.expressions_of_interest enable trigger user;
  -- One Baker job was last confirmed 20 days ago: still active, and stale.
  update marketplace.job_publication_attestations set reconfirmed_at = now() - interval '20 days' where job_id = j_stale;
  update marketplace.job_postings set title = title where id = j_stale;
  perform pg_temp.ok((select status = 'active' and not marketplace.job_confirmation_current(last_confirmed_at) from marketplace.job_postings where id = j_stale)
                     and (select status = 'active' and marketplace.job_confirmation_current(last_confirmed_at) from marketplace.job_postings where id = j_fresh)
                     and (select status = 'paused' from marketplace.job_postings where id = j_paused)
                     and (select count(*) = 4 from marketplace.expressions_of_interest where responded_at is not null and job_org_id = o_land)
                     and (select status = 'withdrawn' from marketplace.expressions_of_interest where id = e_gone),
    'setup: one fresh, one stale and one paused job in Baker; four first responses; one withdrawn inquiry');

  -- Availability: one fresh report in Baker and one stale one. Lane has no boundary, so no point falls in it.
  perform pg_temp.as_jwt('authenticated', 's42_haul');
  insert into marketplace.availability_reports (org_id, equipment_code, available_count, area_center, area_label, radius_miles, available_from, available_until)
  values (o_haul, 'log_truck', 1, extensions.st_geogfromtext('SRID=4326;POINT(-117.8 44.8)'), 'Baker', 80, current_date, current_date + 14);
  perform pg_temp.as_jwt('authenticated', 's42_haul2');
  insert into marketplace.availability_reports (org_id, equipment_code, available_count, area_center, area_label, radius_miles, available_from, available_until)
  values (o_haul2, 'log_truck', 1, extensions.st_geogfromtext('SRID=4326;POINT(-117.8 44.8)'), 'Baker', 80, current_date, current_date + 14);
  perform pg_temp.as_jwt('harness');
  alter table marketplace.availability_reports disable trigger user;
  update marketplace.availability_reports set reported_at = now() - interval '337 hours' where org_id = o_haul2;
  alter table marketplace.availability_reports enable trigger user;

  -- Staff only. A landing owner, a hauler and a signed-out visitor get no row.
  perform pg_temp.ok(pg_temp.answer('s42_own', c_board) ~ '^42501', 'a landing owner is refused');
  perform pg_temp.ok(pg_temp.answer('s42_haul', c_board) ~ '^42501', 'a hauler is refused');
  perform pg_temp.ok(pg_temp.answer(null, c_board) ~ '^42501', 'a signed-out visitor is refused');

  -- No basin recorded: staff get an empty board, not an error.
  perform pg_temp.as_jwt('authenticated', 's42_admin');
  perform pg_temp.ok((select count(*) = 0 from marketplace.basin_liquidity_board()), 'with no basin recorded the board is empty');
  b_box := marketplace.create_basin('S42 Baker', 'OR', '{}'::text[], c_box, 'Suite 43 Baker box');
  b_lane := marketplace.create_basin('S42 Lane', 'OR', array['Lane'], null, 'Suite 43 Lane county list');
  b_coos := marketplace.create_basin('S42 Coos', 'OR', array['Coos'], null, 'Suite 43 basin with nothing in it');

  select string_agg(b.name, ',') into v_names from marketplace.basin_liquidity_board() b;
  perform pg_temp.ok(v_names = 'S42 Baker,S42 Coos,S42 Lane', 'one row per basin, in state and name order');

  select * into v_row from marketplace.basin_liquidity_board() b where b.basin_id = b_coos;
  perform pg_temp.ok(v_row.status = 'closed' and v_row.state_code = 'OR'
                     and v_row.verified_landings = 0 and v_row.active_jobs = 0 and v_row.jobs_confirmed = 0 and v_row.haulers_available = 0
                     and v_row.interests = 0 and v_row.interests_answered = 0 and v_row.median_first_reply_minutes is null,
    'a basin with nothing in it is all zeros with no median');

  select * into v_row from marketplace.basin_liquidity_board() b where b.basin_id = b_box;
  perform pg_temp.ok(v_row.active_jobs = 2 and v_row.jobs_confirmed = 1,
    'Baker: two active jobs, one confirmed in 14 days; the stale job still counts as active and the paused job does not');
  perform pg_temp.ok(v_row.interests = 4 and v_row.interests_answered = 3,
    'Baker: four inquiries on active jobs, three answered; the withdrawn one and the paused job are not counted');
  perform pg_temp.ok(v_row.median_first_reply_minutes = 60, 'Baker: the median first reply of 30, 60 and 180 minutes is 60');
  perform pg_temp.ok(v_row.haulers_available = 1 and v_row.verified_landings = 0,
    'Baker: a fresh availability report counts and a stale one does not; an unverified landing does not count');

  select * into v_row from marketplace.basin_liquidity_board() b where b.basin_id = b_lane;
  perform pg_temp.ok(v_row.active_jobs = 1 and v_row.jobs_confirmed = 1 and v_row.interests = 1 and v_row.interests_answered = 0
                     and v_row.median_first_reply_minutes is null and v_row.haulers_available = 0,
    'Lane: a county-only basin counts its job and its waiting inquiry, has no median and matches no hauler point');

  -- A moderator is staff too. Verification then shows on the board.
  perform pg_temp.as_jwt('authenticated', 's42_mod');
  perform marketplace.admin_set_org_verification(o_land, 'verified', 'Suite 43 verification');
  perform pg_temp.ok((select b.verified_landings = 1 from marketplace.basin_liquidity_board() b where b.basin_id = b_box)
                     and (select b.verified_landings = 1 from marketplace.basin_liquidity_board() b where b.basin_id = b_lane),
    'any platform admin role reads the board, and a verified active landing counts in its basin');

  -- The board and basin_readiness (38) agree on the three counts they share.
  perform pg_temp.as_jwt('authenticated', 's42_admin');
  select * into v_ready from marketplace.basin_readiness(b_box);
  select * into v_row from marketplace.basin_liquidity_board() b where b.basin_id = b_box;
  perform pg_temp.ok(v_ready.verified_landings = v_row.verified_landings and v_ready.active_jobs = v_row.jobs_confirmed
                     and v_ready.haulers_available = v_row.haulers_available and v_ready.status = v_row.status,
    'the board agrees with basin_readiness on verified landings, confirmed jobs and available haulers');

  -- A status change shows at once, and the counts do not depend on the status.
  perform marketplace.set_basin_status(b_box, 'pilot', 'Suite 43 opens the pilot');
  perform pg_temp.ok((select b.status = 'pilot' and b.active_jobs = 2 and b.interests = 4 from marketplace.basin_liquidity_board() b where b.basin_id = b_box),
    'a pilot basin reports the same counts with its new status');

  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select p.proargnames = array['basin_id', 'name', 'state_code', 'status', 'verified_landings', 'active_jobs', 'jobs_confirmed',
                                                 'haulers_available', 'interests', 'interests_answered', 'median_first_reply_minutes']
                             and p.pronargs = 0
                      from pg_proc p where p.oid = 'marketplace.basin_liquidity_board()'::regprocedure),
    'the board returns the basin, its status and seven counts, and nothing else');
  perform pg_temp.ok(has_function_privilege('authenticated', 'marketplace.basin_liquidity_board()', 'EXECUTE')
                     and not has_function_privilege('anon', 'marketplace.basin_liquidity_board()', 'EXECUTE')
                     and not has_function_privilege('service_role', 'marketplace.basin_liquidity_board()', 'EXECUTE')
                     and (select p.provolatile = 's' and p.prosecdef from pg_proc p where p.oid = 'marketplace.basin_liquidity_board()'::regprocedure)
                     and (select count(*) = 1 and bool_and(p.proname = 'unsubscribe_with_token') from pg_proc p
                          where p.pronamespace = 'marketplace'::regnamespace and p.provolatile = 'v' and has_function_privilege('anon', p.oid, 'EXECUTE')),
    'grants: the board is a stable read for authenticated only; anon and service_role cannot call it');
  perform pg_temp.ok((select string_agg(version, ',' order by applied_at, version) from marketplace.schema_migrations)
                       = '06,11,12,16,18,23,26,29,31,33,35,38,40,42',
    'the migration ledger records 42 after 40');

  raise notice 'ALL BASIN LIQUIDITY BOARD (42) TESTS PASSED';
end
$$;

rollback;
