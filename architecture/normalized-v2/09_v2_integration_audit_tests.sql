-- =============================================================================
-- LogLoads normalized-v2 — 09 independent integration-audit regression suite
--
-- NON-ACTIVE PROTOTYPE TEST SUITE. Disposable PostgreSQL only. Run after
-- 01 -> 02 -> 03 -> 06 -> 11 -> 12 (and 04, 07). Wraps everything in BEGIN ... ROLLBACK.
-- Phase 3 founder decisions changed two expectations here, each noted where it applies:
-- F3 (re-activation needs a fresh attestation) and F2 (legacy postings need pay before reconfirmation).
--
-- Written by the integration owner, independently of 07. Every negative test requires the
-- expected SQLSTATE AND a matching constraint name or message, and checks that nothing was
-- written, so a test cannot pass because an unrelated rule fired. Covers the corrections made
-- during integration (C1..C7, S1, S4 in GAP_AUDIT review) plus founder decisions V2-DEC-01..03,
-- authorization roles, discovery visibility, inquiries and boosts.
-- =============================================================================

begin;

create function pg_temp.as_jwt(p_role text, p_sub text default null) returns void language plpgsql as $$
begin
  if p_role = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  elsif p_role = 'service_role' then
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    execute 'set local role service_role';
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

-- Requires failure with SQLSTATE p_state AND constraint name / message matching p_reason.
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

-- Row counts for "nothing was written" checks (harness privileges; caller context unchanged).
create function pg_temp.n(p_table text) returns bigint language plpgsql security definer as $$
declare v bigint;
begin
  execute format('select count(*) from marketplace.%I', p_table) into v;
  return v;
end
$$;

insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true) on conflict (issuer) do nothing;

do $$
declare
  c_iss constant text := 'https://clerk.logloads.test';
  u_land uuid; u_rival uuid; u_haul uuid; u_drv uuid; u_admin uuid; u_solo uuid;
  o_land uuid; o_rival uuid; o_haul uuid; o_solo uuid;
  l_land uuid; l_rival uuid;
  j1 uuid; j2 uuid; j_rival2 uuid; j_old uuid; j_legacy uuid; j_legacy2 uuid; j_rival uuid; v_draft uuid; v_boost uuid;
  i1 uuid; i_rival uuid;
  v_n bigint; v_n2 bigint; v_ts timestamptz; v_ts2 timestamptz; v_upd timestamptz;
  v_lat double precision; v_lng double precision;
  r record;
begin
  -- -------------------------------------------------------------------------
  -- Fixture
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('service_role');
  u_land  := marketplace.sync_verified_identity(c_iss, 'a9_land',  'Lana Landing', 'lana@a9.test', true);
  u_rival := marketplace.sync_verified_identity(c_iss, 'a9_rival', 'Rex Rival',    'rex@a9.test',  true);
  u_haul  := marketplace.sync_verified_identity(c_iss, 'a9_haul',  'Hal Hauler',   'hal@a9.test',  true);
  u_drv   := marketplace.sync_verified_identity(c_iss, 'a9_drv',   'Dee Driver',   'dee@a9.test',  true);
  u_admin := marketplace.sync_verified_identity(c_iss, 'a9_admin', 'Ada Admin',    'ada@a9.test',  true);
  u_solo  := marketplace.sync_verified_identity(c_iss, 'a9_solo',  'Sol Solo',     'sol@a9.test',  true);
  perform pg_temp.as_jwt('harness');
  insert into marketplace.platform_admins (user_id, admin_role, note) values (u_admin, 'superadmin', 'audit suite');

  perform pg_temp.as_jwt('authenticated', 'a9_land');
  o_land := marketplace.create_organization('A9 Timber', 'a9-timber', 'OR', false);
  perform pg_temp.as_jwt('authenticated', 'a9_rival');
  o_rival := marketplace.create_organization('A9 Rival Logging', 'a9-rival', 'WA', false);
  perform pg_temp.as_jwt('authenticated', 'a9_haul');
  o_haul := marketplace.create_organization('A9 Hauling', 'a9-hauling', 'OR', true);
  insert into marketplace.equipment_units (org_id, equipment_code, unit_label, unit_count) values (o_haul, 'log_truck', 'A9 trucks', 2);
  insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
  values (o_haul, u_drv, 'driver', false, 'invited');
  perform pg_temp.as_jwt('authenticated', 'a9_drv');
  update marketplace.organization_memberships set status = 'active' where org_id = o_haul and user_id = u_drv;
  perform pg_temp.as_jwt('authenticated', 'a9_solo');
  o_solo := marketplace.create_organization('A9 Solo Hauler', 'a9-solo', 'OR', true);

  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_land, 'basic', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_a9', 'sub_a9', false, 7, false);
  perform marketplace.open_subscription_cycle(o_rival, 'basic', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_a9r', 'sub_a9r', false, 7, false);

  perform pg_temp.as_jwt('authenticated', 'a9_land');
  -- An off-grid public point; the landing guard must store it on the fixed 0.10-degree grid.
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_land, 'A9 Landing', 'active', 'Near Lowell, OR', extensions.st_GeogFromText('SRID=4326;POINT(-122.71234 44.41234)'), 'OR')
  returning id into l_land;
  insert into marketplace.landing_private_details (landing_id, org_id, exact_point, directions, gate_instructions)
  values (l_land, o_land, extensions.st_GeogFromText('SRID=4326;POINT(-122.71234 44.41234)'), 'Spur 7', 'Blue gate');
  perform pg_temp.as_jwt('authenticated', 'a9_rival');
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_rival, 'Rival Landing', 'active', 'Near Forks, WA', extensions.st_GeogFromText('SRID=4326;POINT(-124.4 47.9)'), 'WA')
  returning id into l_rival;
  j_rival := marketplace.publish_job_posting(p_landing_id => l_rival, p_title => 'Rival Pulp Run', p_equipment_codes => array['log_truck'],
    p_trucks_requested => 3, p_pay_unit => 'per_load', p_pay_amount_cents => 50000, p_attest_available => true);
  j_rival2 := marketplace.publish_job_posting(p_landing_id => l_rival, p_title => 'Rival Cedar Run', p_equipment_codes => array['log_truck'],
    p_trucks_requested => 2, p_pay_unit => 'per_load', p_pay_amount_cents => 52000, p_attest_available => true);

  -- -------------------------------------------------------------------------
  -- V2-DEC-01: fixed 0.10-degree grid, half away from zero, server-controlled
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('anon');
  perform pg_temp.ok(
    extensions.st_y(marketplace.make_public_point(-117.45, 47.65)::extensions.geometry) = 47.7
    and extensions.st_x(marketplace.make_public_point(-117.45, 47.65)::extensions.geometry) = -117.5
    and extensions.st_x(marketplace.make_public_point(-0.05, 0.05)::extensions.geometry) = -0.1
    and extensions.st_y(marketplace.make_public_point(-0.05, 0.05)::extensions.geometry) = 0.1,
    'V2-DEC-01: midpoints round half AWAY from zero (47.65 -> 47.7, -117.45 -> -117.5, +/-0.05 -> +/-0.1); JS Math.round differs on negatives, so clients must not re-round');
  perform set_config('app.public_coord_grid_degrees', '0.0001', true);
  perform pg_temp.ok(
    extensions.st_y(marketplace.make_public_point(-122.71234, 44.41234)::extensions.geometry) = 44.4,
    'V2-DEC-01: a session setting cannot change public precision');
  perform pg_temp.fails('select marketplace.make_public_point(-181, 44)', '22023', 'longitude', 'V2-DEC-01: out-of-range longitude rejected');
  perform pg_temp.fails('select marketplace.make_public_point(-122, 91)', '22023', 'latitude', 'V2-DEC-01: out-of-range latitude rejected');

  perform pg_temp.as_jwt('harness');
  select extensions.st_y(public_point::extensions.geometry), extensions.st_x(public_point::extensions.geometry) into v_lat, v_lng
  from marketplace.landings where id = l_land;
  perform pg_temp.ok(v_lat = 44.4 and v_lng = -122.7, 'V2-DEC-01: off-grid landing input stored at (44.4, -122.7)');

  -- -------------------------------------------------------------------------
  -- V2-DEC-02 / V2-DEC-03: publication rules, with "nothing written" checks
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 'a9_land');
  v_n := pg_temp.n('job_postings'); v_n2 := pg_temp.n('job_publication_attestations');
  perform pg_temp.fails(format($q$select marketplace.publish_job_posting(p_landing_id => %L, p_title => 'Zero pay', p_equipment_codes => array['log_truck'],
    p_trucks_requested => 2, p_pay_unit => 'per_ton', p_pay_amount_cents => 0, p_attest_available => true)$q$, l_land),
    '23514', 'positive', 'V2-DEC-02: zero amount rejected');
  perform pg_temp.fails(format($q$select marketplace.publish_job_posting(p_landing_id => %L, p_title => 'Negative pay', p_equipment_codes => array['log_truck'],
    p_trucks_requested => 2, p_pay_unit => 'per_ton', p_pay_amount_cents => -100, p_attest_available => true)$q$, l_land),
    '23514', 'positive', 'V2-DEC-02: negative amount rejected');
  perform pg_temp.fails(format($q$select marketplace.publish_job_posting(p_landing_id => %L, p_title => 'Negotiable with amount', p_equipment_codes => array['log_truck'],
    p_trucks_requested => 2, p_pay_unit => 'negotiable', p_pay_amount_cents => 5000, p_pay_note => 'By haul length', p_attest_available => true)$q$, l_land),
    '23514', 'fixed amount', 'V2-DEC-02: negotiable with a fixed amount rejected');
  perform pg_temp.fails(format($q$select marketplace.publish_job_posting(p_landing_id => %L, p_title => 'Negotiable, no note', p_equipment_codes => array['log_truck'],
    p_trucks_requested => 2, p_pay_unit => 'negotiable', p_pay_note => '  ab  ', p_attest_available => true)$q$, l_land),
    '23514', 'explain|note', 'V2-DEC-02: negotiable with a <3-character note rejected');
  perform pg_temp.fails(format($q$select marketplace.publish_job_posting(p_landing_id => %L, p_title => 'No pay', p_equipment_codes => array['log_truck'],
    p_trucks_requested => 2, p_attest_available => true)$q$, l_land),
    '23514', 'pay', 'V2-DEC-02: missing pay rejected');
  perform pg_temp.fails(format($q$select marketplace.publish_job_posting(p_landing_id => %L, p_title => 'No attestation', p_equipment_codes => array['log_truck'],
    p_trucks_requested => 2, p_pay_unit => 'per_ton', p_pay_amount_cents => 900, p_attest_available => false)$q$, l_land),
    '23514', 'attestation', 'V2-DEC-03: attestation false rejected');
  perform pg_temp.fails(format($q$select marketplace.publish_job_posting(p_landing_id => %L, p_title => 'Null attestation', p_equipment_codes => array['log_truck'],
    p_trucks_requested => 2, p_pay_unit => 'per_ton', p_pay_amount_cents => 900)$q$, l_land),
    '23514', 'attestation', 'V2-DEC-03: missing attestation rejected');
  perform pg_temp.fails(format($q$insert into marketplace.job_postings (org_id, landing_id, title, pay_amount_cents, pay_unit, trucks_requested, status)
    values (%L, %L, 'Direct active insert', 900, 'per_ton', 2, 'active')$q$, o_land, l_land),
    '23514', 'attestation', 'V2-DEC-03: a direct active INSERT cannot bypass attestation');
  perform pg_temp.ok(pg_temp.n('job_postings') = v_n and pg_temp.n('job_publication_attestations') = v_n2,
    'failed publications left no job or attestation rows');

  -- Draft: saved incomplete, never confirmed; publication stamps the server time and the publisher.
  v_draft := marketplace.save_job_posting_draft(p_landing_id => l_land, p_title => 'Draft Cedar Run', p_equipment_codes => array['log_truck'], p_trucks_requested => 2);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'draft' and last_confirmed_at is null and published_at is null from marketplace.job_postings where id = v_draft),
    'V2-DEC-03: a saved draft carries no confirmation');
  perform pg_temp.as_jwt('authenticated', 'a9_land');
  perform marketplace.publish_job_posting(p_landing_id => l_land, p_title => 'Draft Cedar Run', p_equipment_codes => array['log_truck'],
    p_trucks_requested => 2, p_pay_unit => 'per_load', p_pay_amount_cents => 41000, p_attest_available => true, p_draft_job_id => v_draft);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'active' and last_confirmed_by = u_land and last_confirmed_at is not null from marketplace.job_postings where id = v_draft),
    'V2-DEC-03: draft promotion records the authenticated publisher and a server timestamp');

  perform pg_temp.as_jwt('authenticated', 'a9_land');
  j1 := marketplace.publish_job_posting(p_landing_id => l_land, p_title => 'A9 Sawlog Run', p_equipment_codes => array['log_truck'],
    p_trucks_requested => 4, p_trucks_per_day => 2, p_pay_unit => 'per_ton', p_pay_amount_cents => 8500, p_attest_available => true);
  perform pg_temp.as_jwt('harness');
  select last_confirmed_at, updated_at into v_ts, v_upd from marketplace.job_postings where id = j1;
  perform pg_temp.as_jwt('authenticated', 'a9_land');
  update marketplace.job_postings set title = 'A9 Sawlog Run (edited)' where id = j1;
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select last_confirmed_at = v_ts and updated_at > v_upd from marketplace.job_postings where id = j1),
    'V2-DEC-03: an edit advances last_modified_at and never refreshes confirmation');
  perform pg_temp.as_jwt('authenticated', 'a9_land');
  perform pg_temp.fails(format('update marketplace.job_postings set last_confirmed_at = now() where id = %L', j1),
    '42501', 'permission denied', 'V2-DEC-03: last_confirmed_at cannot be written directly');
  v_ts2 := marketplace.reconfirm_job_posting(j1);
  perform pg_temp.ok(v_ts2 > v_ts, 'V2-DEC-03: explicit reconfirmation advances confirmation');

  -- -------------------------------------------------------------------------
  -- Authorization
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 'a9_drv');
  perform pg_temp.fails(format($q$select marketplace.publish_job_posting(p_landing_id => %L, p_title => 'Driver attempt', p_equipment_codes => array['log_truck'],
    p_trucks_requested => 1, p_pay_unit => 'per_ton', p_pay_amount_cents => 900, p_attest_available => true)$q$, l_land),
    '42501', 'cannot publish|not available', 'a driver of another organization cannot publish at a landing');
  perform pg_temp.fails(format('select * from marketplace.list_authoring_landings(%L)', o_haul), '42501', 'cannot publish',
    'a fleet driver without a landing seat gets no authoring landings');
  perform pg_temp.as_jwt('authenticated', 'a9_rival');
  perform pg_temp.fails(format('select marketplace.reconfirm_job_posting(%L)', j1), '42501', 'cannot confirm|not available', 'a rival landing cannot reconfirm another org''s job');
  perform pg_temp.fails(format('select marketplace.set_job_posting_status(%L, %L)', j1, 'closed'), '42501', '', 'a rival landing cannot change another org''s job status');
  perform pg_temp.as_jwt('service_role');
  perform pg_temp.fails(format($q$select marketplace.publish_job_posting(p_landing_id => %L, p_title => 'Service role', p_equipment_codes => array['log_truck'],
    p_trucks_requested => 1, p_pay_unit => 'per_ton', p_pay_amount_cents => 900, p_attest_available => true)$q$, l_land),
    '42501', 'permission denied', 'service_role holds no EXECUTE on V2 user RPCs (the adapter must call them with the user''s JWT)');
  perform pg_temp.as_jwt('anon');
  perform pg_temp.fails(format('select marketplace.reconfirm_job_posting(%L)', j1), '42501', 'permission denied', 'anon cannot call write RPCs');

  -- A hauler-only owner who self-grants a landing seat still cannot publish without a landing and plan.
  perform pg_temp.as_jwt('authenticated', 'a9_solo');
  update marketplace.organization_memberships set landing_workspace_seat = true where org_id = o_solo and user_id = u_solo;
  perform pg_temp.ok(not exists (select 1 from marketplace.get_viewer_marketplace_access(o_solo) a where 'job.publish' = any (a.capabilities)),
    'a self-granted seat on a hauler-only org confers no job.publish capability');

  -- -------------------------------------------------------------------------
  -- Discovery visibility (C5) and exact-location secrecy
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('anon');
  select * into r from marketplace.get_marketplace_job(j1);
  perform pg_temp.ok(r.job_id = j1 and r.origin_lat = 44.4 and r.origin_lng = -122.7,
    'discovery returns only the 0.10-degree public point (never the exact private point)');

  perform pg_temp.as_jwt('authenticated', 'a9_land');
  perform marketplace.set_job_posting_status(j1, 'paused');
  perform pg_temp.as_jwt('anon');
  perform pg_temp.ok(not exists (select 1 from marketplace.get_marketplace_job(j1))
    and not exists (select 1 from marketplace.list_marketplace_jobs(null, null, null, false, null, null, null, 2, 200) where job_id = j1),
    'C5: anon cannot read a paused job through discovery RPCs');
  perform pg_temp.as_jwt('authenticated', 'a9_land');
  perform pg_temp.ok((select status from marketplace.get_marketplace_job(j1)) = 'paused', 'C5: the owning desk still reads its paused job');

  perform pg_temp.as_jwt('authenticated', 'a9_admin');
  perform marketplace.admin_moderate_job_posting(j_rival, 'closed', 'Abusive content report #9');
  perform pg_temp.as_jwt('anon');
  perform pg_temp.ok(not exists (select 1 from marketplace.list_marketplace_jobs(null, null, null, false, null, null, null, 2, 200) where job_id = j_rival),
    'C5: a moderated (closed) job is not publicly readable');

  -- getJob must not depend on a page of 200 results (C5).
  perform pg_temp.as_jwt('authenticated', 'a9_land');
  perform marketplace.reactivate_job_posting(j1, true); -- F3: re-activation carries a fresh attestation
  for v_n in 1..205 loop
    perform marketplace.publish_job_posting(p_landing_id => l_land, p_title => 'Bulk run ' || v_n, p_equipment_codes => array['log_truck'],
      p_trucks_requested => 1, p_pay_unit => 'per_load', p_pay_amount_cents => 30000 + v_n, p_attest_available => true);
  end loop;
  perform pg_temp.as_jwt('anon');
  perform pg_temp.ok(exists (select 1 from marketplace.get_marketplace_job(v_draft)), 'C5: getJob finds a job beyond the first 200 results');

  -- -------------------------------------------------------------------------
  -- Legacy imports (C2, C3, C4)
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 'a9_land');
  perform pg_temp.fails(format($q$select marketplace.admin_import_legacy_job_posting(%L, %L, 'Sneaky import', array['log_truck'], 'Not an admin', p_trucks_per_day => 1)$q$, o_land, l_land),
    '42501', 'superadmin', 'C4: an ordinary landing user cannot import legacy jobs');
  perform pg_temp.as_jwt('authenticated', 'a9_admin');
  -- Pilot listings know trucks per day but not a job-wide total (GAP-01).
  j_legacy := marketplace.admin_import_legacy_job_posting(o_land, l_land, 'Pilot legacy haul', array['log_truck'], 'Pilot migration batch 1',
    p_trucks_per_day => 2, p_last_confirmed_at => now() - interval '20 days');
  j_legacy2 := marketplace.admin_import_legacy_job_posting(o_land, l_land, 'Pilot legacy haul 2', array['log_truck'], 'Pilot migration batch 1',
    p_trucks_per_day => 3);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select imported_by = u_admin from marketplace.legacy_job_imports where job_id = j_legacy)
    and (select last_confirmed_by is null and pay_unit is null from marketplace.job_postings where id = j_legacy),
    'C4: the import records the real admin and never invents a confirmer');

  perform pg_temp.as_jwt('authenticated', 'a9_land');
  perform marketplace.set_job_posting_status(j_legacy, 'paused');
  -- C2 (now enforced through F3/F2): no plain status change or direct UPDATE re-activates it, and the
  -- attested path refuses it while it has no pay.
  perform pg_temp.fails(format('select marketplace.set_job_posting_status(%L, %L)', j_legacy, 'active'), '23514', 'fresh availability attestation',
    'C2: a paused unquoted legacy job cannot be re-activated via set_job_posting_status');
  perform pg_temp.fails(format($q$update marketplace.job_postings set status = 'active' where id = %L$q$, j_legacy), '23514', 'fresh availability attestation',
    'C2: ... nor by a direct UPDATE');
  perform pg_temp.fails(format('select marketplace.reactivate_job_posting(%L, true)', j_legacy), '23514', 'add pay',
    'C2/F2: ... nor through attested re-activation while it states no pay');
  -- F2: a legacy job states pay before it can be reconfirmed; C3 then checks the confirmation is recorded.
  perform pg_temp.fails(format('select marketplace.reconfirm_job_posting(%L)', j_legacy2), '23514', 'add pay',
    'F2: an unpriced legacy job cannot be reconfirmed');
  update marketplace.job_postings set pay_unit = 'per_ton', pay_amount_cents = 8800 where id = j_legacy2;
  v_ts := marketplace.reconfirm_job_posting(j_legacy2);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select last_confirmed_at = v_ts and last_confirmed_by = u_land from marketplace.job_postings where id = j_legacy2),
    'C3: reconfirming a legacy job really records the confirmation');

  -- -------------------------------------------------------------------------
  -- Inquiries
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 'a9_haul');
  perform pg_temp.fails(format($q$select * from marketplace.submit_expression_of_interest(%L, %L, null, '[{"configurationKey":"log_truck","count":3}]'::jsonb)$q$, o_haul, j1),
    '23514', 'profile lists', 'offering more units than the profile lists is rejected');
  perform pg_temp.fails(format($q$select * from marketplace.submit_expression_of_interest(%L, %L, null, '[{"configurationKey":"chip_truck","count":1}]'::jsonb)$q$, o_haul, j1),
    '23514', 'business profile', 'equipment not in the profile is rejected');
  select s.interest_id into i1 from marketplace.submit_expression_of_interest(o_haul, j1, null, '[{"configurationKey":"log_truck","count":2}]'::jsonb, null, null, 'Two trucks') s;
  perform pg_temp.ok((select created from marketplace.submit_expression_of_interest(o_haul, j1, null, '[{"configurationKey":"log_truck","count":2}]'::jsonb, null, null, 'Two trucks')) is false,
    'an identical resubmission is a no-op');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select trucks_offered = 2 from marketplace.expressions_of_interest where id = i1)
    and (select sum(unit_count) = 2 from marketplace.expression_of_interest_equipment where interest_id = i1),
    'trucks_offered equals the persisted equipment lines');

  perform pg_temp.as_jwt('authenticated', 'a9_rival');
  perform pg_temp.ok(not exists (select 1 from marketplace.expressions_of_interest where id = i1), 'a rival landing cannot read the inquiry');
  perform pg_temp.fails(format($q$select marketplace.respond_to_interest(%L, 'replied', null, gen_random_uuid(), 'Hi')$q$, i1), '42501', 'not found',
    'a rival landing cannot respond to the inquiry');

  perform pg_temp.as_jwt('authenticated', 'a9_land');
  perform pg_temp.fails(format($q$select marketplace.respond_to_interest(%L, 'replied')$q$, i1), '23514', 'needs a message', 'C6: a reply needs a message');
  perform marketplace.respond_to_interest(i1, 'replied', true, gen_random_uuid(), 'Approved; access details shared');
  perform pg_temp.as_jwt('authenticated', 'a9_haul');
  perform marketplace.withdraw_interest(i1);
  perform marketplace.submit_expression_of_interest(o_haul, j1, null, '[{"configurationKey":"log_truck","count":1}]'::jsonb);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'submitted' and private_details_shared_at is null from marketplace.expressions_of_interest where id = i1),
    'renewal after withdrawal does not restore private-detail sharing');

  perform pg_temp.as_jwt('authenticated', 'a9_land');
  perform marketplace.respond_to_interest(i1, 'declined', null, gen_random_uuid(), 'Fully booked');
  perform pg_temp.as_jwt('authenticated', 'a9_haul');
  perform pg_temp.fails(format('select marketplace.post_hauler_interest_reply(%L, gen_random_uuid(), %L)', i1, 'Next week?'), '23514', 'closed',
    'a hauler cannot message a declined inquiry');
  perform pg_temp.fails(format($q$select * from marketplace.submit_expression_of_interest(%L, %L, 1)$q$, o_haul, j1), '23514', 'closed',
    'a hauler cannot resubmit a declined inquiry');

  -- S4: a job of a suspended organization no longer accepts inquiries.
  perform pg_temp.as_jwt('harness');
  update marketplace.organizations set status = 'suspended' where id = o_rival;
  perform pg_temp.as_jwt('authenticated', 'a9_haul');
  perform pg_temp.fails(format($q$select * from marketplace.submit_expression_of_interest(%L, %L, 1)$q$, o_haul, j_rival2), '23514', 'no longer accepting',
    'S4: an active job of a suspended organization does not accept inquiries');

  -- -------------------------------------------------------------------------
  -- GAP-09: a boost stops when its job leaves active
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('service_role');
  v_boost := marketplace.activate_job_boost(j1, 'quick', u_land, 'pi_a9_boost', now() - interval '1 hour');
  perform pg_temp.as_jwt('authenticated', 'a9_land');
  perform marketplace.set_job_posting_status(j1, 'filled');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'ended' and ends_at = starts_at + duration_days * interval '24 hours' from marketplace.job_boosts where id = v_boost),
    'GAP-09: filling a job ends its active boost and keeps the purchased window intact');

  raise notice 'ALL V2 INTEGRATION AUDIT TESTS PASSED.';
end
$$;

rollback;
