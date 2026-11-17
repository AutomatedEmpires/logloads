-- =============================================================================
-- LogLoads normalized-v2 — 34 regression suite for 33 (the missing port v3 SQL: invitations, team removal, report
-- resolution, admin target checks, inquiry and job pages; #294 part B)
--
-- NON-ACTIVE PROTOTYPE TEST SUITE. Disposable PostgreSQL only. Run after
-- 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23 -> 26 -> 29 -> 31 -> 33; stage 36 runs it again after 35. Wraps everything
-- in BEGIN ... ROLLBACK.
-- Negative tests require the expected SQLSTATE AND a matching message or constraint name.
-- On a database without 33 the suite stops at its first assertion. Each of 33's three redefinitions is needed by at
-- least one assertion: with any one of them put back to its earlier definition, the suite fails.
-- Run as the role that applied 33 (the table owner, which the fixture uses for service steps and to age rows).
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

-- A scalar read as the presented identity (the functions and row-level security apply). Returns to the harness role.
create function pg_temp.as_user(p_sub text, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  if p_sub is null then
    perform pg_temp.as_jwt('anon');
  else
    perform pg_temp.as_jwt('authenticated', p_sub);
  end if;
  execute p_sql into v;
  perform pg_temp.as_jwt('harness');
  return v;
end
$$;

-- The SQLSTATE and message a statement fails with ('ok' when it succeeds), as the presented identity.
create function pg_temp.answer(p_sub text, p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text;
begin
  perform pg_temp.as_jwt('authenticated', p_sub);
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

-- Walks list_marketplace_jobs_page to the end with the cursor of each page's last row. p_args is its other named
-- arguments. Returns every job id in the order read; fails if a page reports another total or the walk does not end.
create function pg_temp.walk(p_sub text, p_args text, p_limit integer) returns uuid[] language plpgsql as $$
declare
  v_all uuid[] := '{}'; v_ids uuid[]; v_cursor jsonb; v_next jsonb; v_total bigint; v_first_total bigint; v_pages integer := 0;
begin
  if p_sub is null then perform pg_temp.as_jwt('anon'); else perform pg_temp.as_jwt('authenticated', p_sub); end if;
  loop
    execute format(
      'select array_agg(x.job_id order by x.n), (array_agg(x.page_cursor order by x.n desc))[1], max(x.total_count)
       from marketplace.list_marketplace_jobs_page(%s p_limit => %s, p_after => %L::jsonb) with ordinality as x(job_id, slug, title, poster_organization_id, poster_name, poster_verified, product, description, pay_amount_cents, pay_unit, pay_note, equipment_codes, equipment_labels, origin_label, origin_state_code, origin_lat, origin_lng, destination_label, est_one_way_miles, distance_miles, starts_on, ends_on, duration_days, schedule_note, trucks_total, trucks_per_day, estimated_loads_per_truck_per_day, estimated_daily_loads, estimated_tons_per_load, public_road_notes, public_access_requirements, status, accepting_interest, last_modified_at, last_confirmed_at, expires_at, sponsored, total_count, page_cursor, n)',
      case when btrim(p_args) = '' then '' else p_args || ',' end, p_limit, v_cursor)
    into v_ids, v_next, v_total;
    exit when v_ids is null;
    v_first_total := coalesce(v_first_total, v_total);
    if v_total <> v_first_total or cardinality(v_ids) > p_limit then
      raise exception 'walk: page % has total % (first page %) and % rows for limit %', v_pages + 1, v_total, v_first_total, cardinality(v_ids), p_limit;
    end if;
    v_all := v_all || v_ids;
    v_cursor := v_next;
    v_pages := v_pages + 1;
    if v_pages > 60 then raise exception 'walk: the pages do not end'; end if;
  end loop;
  if v_first_total is not null and v_first_total <> cardinality(v_all) then
    raise exception 'walk: read % rows but total_count says %', cardinality(v_all), v_first_total;
  end if;
  perform pg_temp.as_jwt('harness');
  return v_all;
end
$$;

-- 18 (HF-18) withholds EXECUTE from PUBLIC on functions this role creates; the helpers run after SET ROLE.
grant execute on all functions in schema pg_temp to public;

insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true) on conflict (issuer) do nothing;

do $$
declare
  c_iss constant text := 'https://clerk.logloads.test';
  u_own uuid; u_mgr uuid; u_staff uuid; u_ldrv uuid; u_haul uuid; u_hdrv uuid; u_haul2 uuid; u_rival uuid;
  u_admin uuid; u_mod uuid; u_sup uuid;
  o_land uuid; o_haul uuid; o_haul2 uuid; o_rival uuid;
  l_a uuid; l_b uuid; l_r uuid;
  j_a uuid; j_a2 uuid; j_b uuid; j_load uuid; j_neg uuid; j_hour uuid; j_two uuid; j_rival uuid;
  e1 uuid; e2 uuid; e3 uuid; e4 uuid;
  m_staff uuid; m_mgr uuid; m_own uuid; m_hdrv uuid;
  v_inv uuid; v_tinv uuid; v_tinv2 uuid; v_del uuid; v_n bigint; v_ts timestamptz; v_text text;
  r1 uuid; r2 uuid;
  v_all uuid[]; v_expected uuid[]; v_page uuid[]; v_cursor_at timestamptz; v_cursor_id uuid; v_cursor jsonb;
begin
  perform pg_temp.as_jwt('service_role');
  u_own   := marketplace.sync_verified_identity(c_iss, 's33_own',   'S33 Landing Owner',   'own@s33.test',   true);
  u_mgr   := marketplace.sync_verified_identity(c_iss, 's33_mgr',   'S33 Landing Manager', 'mgr@s33.test',   true);
  u_staff := marketplace.sync_verified_identity(c_iss, 's33_staff', 'S33 Staff at A',      'staff@s33.test', true);
  u_ldrv  := marketplace.sync_verified_identity(c_iss, 's33_ldrv',  'S33 Yard Driver',     'ldrv@s33.test',  true);
  u_haul  := marketplace.sync_verified_identity(c_iss, 's33_haul',  'S33 Hauler Owner',    'haul@s33.test',  true);
  u_hdrv  := marketplace.sync_verified_identity(c_iss, 's33_hdrv',  'S33 Hauler Driver',   'hdrv@s33.test',  true);
  u_haul2 := marketplace.sync_verified_identity(c_iss, 's33_haul2', 'S33 Other Hauler',    'haul2@s33.test', true);
  u_rival := marketplace.sync_verified_identity(c_iss, 's33_rival', 'S33 Rival Landing',   'rival@s33.test', true);
  u_admin := marketplace.sync_verified_identity(c_iss, 's33_admin', 'S33 Superadmin',      'admin@s33.test', true);
  u_mod   := marketplace.sync_verified_identity(c_iss, 's33_mod',   'S33 Moderator',       'mod@s33.test',   true);
  u_sup   := marketplace.sync_verified_identity(c_iss, 's33_sup',   'S33 Support',         'sup@s33.test',   true);
  perform pg_temp.as_jwt('harness');
  insert into marketplace.platform_admins (user_id, admin_role, note)
  values (u_admin, 'superadmin', 'suite 34'), (u_mod, 'moderator', 'suite 34'), (u_sup, 'support', 'suite 34');

  perform pg_temp.ok(to_regprocedure('marketplace.list_invitation_recipients(uuid, integer)') is not null
                     and to_regprocedure('marketplace.remove_team_member(uuid)') is not null
                     and to_regprocedure('marketplace.admin_resolve_report(uuid, text, text)') is not null
                     and to_regprocedure('marketplace.get_marketplace_interest(uuid)') is not null
                     and to_regprocedure('marketplace.count_marketplace_interests(uuid, text)') is not null
                     and to_regprocedure('marketplace.list_marketplace_interests(uuid, text, uuid, integer, timestamptz, uuid, uuid[], boolean, uuid, text)') is not null
                     and to_regprocedure('marketplace.list_marketplace_interests(uuid, text, uuid)') is null
                     and (select count(*) = 1 from pg_proc where pronamespace = 'marketplace'::regnamespace and proname = 'list_marketplace_jobs_page'),
    '33 is applied: its seven new functions exist, and list_marketplace_interests has the page arguments');

  -- -------------------------------------------------------------------------
  -- Fixture: a Pro landing business with landings A and B; an owner, a manager, staff limited to landing A and a
  -- driver without a seat. A hauling business that can be invited (public, opted in, equipment, availability, an
  -- enabled channel) with an owner and a driver; a second hauling business that did not opt in; a rival landing.
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 's33_own');
  o_land := marketplace.create_organization('S33 Landing Co', 's33-landing', 'OR', false);
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_land, 'pro', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_s33', 'sub_s33', false, 7, false);
  perform pg_temp.as_jwt('authenticated', 's33_own');
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_land, 'S33 Landing A', 'active', 'Near Sisters, OR', marketplace.make_public_point(-121.5, 44.3), 'OR') returning id into l_a;
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_land, 'S33 Landing B', 'active', 'Near Bend, OR', marketplace.make_public_point(-121.3, 44.1), 'OR') returning id into l_b;
  insert into marketplace.landing_private_details (landing_id, org_id, directions) values (l_a, o_land, 'A: gate code 3301');
  j_a := marketplace.publish_job_posting(l_a, 'S33 Fir Haul A', array['log_truck'], 3, 'Fir sawlogs', 'Suite 34 haul A.', 'per_ton', 525, null,
    3, current_date + 10, 8, 3.0, 9, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  j_a2 := marketplace.publish_job_posting(l_a, 'S33 Hemlock Haul A', array['log_truck'], 2, 'Hemlock', 'Suite 34 haul A two.', 'per_ton', 480, null,
    2, current_date + 20, 8, 3.0, 6, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  j_b := marketplace.publish_job_posting(l_b, 'S33 Pine Haul B', array['log_truck'], 2, 'Pine sawlogs', 'Suite 34 haul B.', 'per_ton', 500, null,
    2, current_date + 12, 8, 3.0, 6, 30.0, 'Prineville Mill, OR', 35, null, null, array['ppe'], true);

  v_inv := marketplace.invite_team_member(o_land, 'mgr@s33.test', 'manager', true, interval '7 days');
  perform pg_temp.as_jwt('authenticated', 's33_mgr');
  m_mgr := marketplace.accept_team_invitation(v_inv);
  perform pg_temp.as_jwt('authenticated', 's33_own');
  v_inv := marketplace.invite_team_member(o_land, 'staff@s33.test', 'staff', true, interval '7 days', array[l_a]);
  perform pg_temp.as_jwt('authenticated', 's33_staff');
  m_staff := marketplace.accept_team_invitation(v_inv);
  perform pg_temp.as_jwt('authenticated', 's33_own');
  v_inv := marketplace.invite_team_member(o_land, 'ldrv@s33.test', 'driver', false, interval '7 days');
  perform pg_temp.as_jwt('authenticated', 's33_ldrv');
  perform marketplace.accept_team_invitation(v_inv);

  perform pg_temp.as_jwt('authenticated', 's33_haul');
  o_haul := marketplace.create_organization('S33 Hauling', 's33-hauling', 'OR', true);
  v_inv := marketplace.invite_team_member(o_haul, 'hdrv@s33.test', 'driver', false, interval '7 days');
  perform pg_temp.as_jwt('authenticated', 's33_hdrv');
  m_hdrv := marketplace.accept_team_invitation(v_inv);
  perform pg_temp.as_jwt('authenticated', 's33_haul');
  update marketplace.hauler_profiles
  set headline = 'S33 log fleet', base_area_label = 'Sisters, OR', is_public = true,
      service_center = extensions.st_geogfromtext('SRID=4326;POINT(-121.5 44.3)'), service_radius_miles = 120,
      operating_states = array['OR'], accepts_targeted_invitations = true, max_invitations_per_week = 5
  where org_id = o_haul;
  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled)
  values (u_haul, o_haul, 'targeted_invitation', 'in_app', true);
  insert into marketplace.equipment_units (org_id, equipment_code, unit_label, unit_count)
  values (o_haul, 'log_truck', 'S33 Trucks', 3), (o_haul, 'self_loader', 'S33 Loader', 1);
  insert into marketplace.availability_reports (org_id, equipment_code, available_count, area_center, area_label, radius_miles, available_from, available_until)
  values (o_haul, 'log_truck', 2, extensions.st_geogfromtext('SRID=4326;POINT(-121.5 44.3)'), 'Sisters', 100, current_date, current_date + 14);
  perform pg_temp.as_jwt('authenticated', 's33_haul2');
  o_haul2 := marketplace.create_organization('S33 Other Hauling', 's33-other-hauling', 'OR', true);

  perform pg_temp.as_jwt('authenticated', 's33_rival');
  o_rival := marketplace.create_organization('S33 Rival Landing Co', 's33-rival', 'OR', false);
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_rival, 'pro', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_s33r', 'sub_s33r', false, 7, false);
  perform pg_temp.as_jwt('authenticated', 's33_rival');
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_rival, 'S33 Rival Landing', 'active', 'Near Madras, OR', marketplace.make_public_point(-121.1, 44.6), 'OR') returning id into l_r;
  j_rival := marketplace.publish_job_posting(l_r, 'S33 Rival Juniper Haul', array['log_truck'], 1, 'Juniper', 'Suite 34 rival haul.', 'per_ton', 400, null,
    1, current_date + 12, 8, 3.0, 6, 30.0, 'Madras Yard, OR', 12, null, null, array['ppe'], true);
  perform pg_temp.as_jwt('harness');
  select id into m_own from marketplace.organization_memberships where org_id = o_land and user_id = u_own;

  -- =========================================================================
  -- 33-I1: list_invitation_recipients
  -- =========================================================================
  perform pg_temp.ok(pg_temp.as_user('s33_own', format('select count(*) from marketplace.list_invitation_recipients(%L)', j_a)) = '1'
                     and pg_temp.as_user('s33_own', format('select marketplace.count_eligible_invitation_recipients(%L)', j_a)) = '1',
    '33-I1: the owner lists the one business that can be invited for the job, the same one the count counts');
  perform pg_temp.ok(pg_temp.as_user('s33_own', format(
      $q$select (r.org_id = %L and r.business_name = 'S33 Hauling' and r.home_base = 'Sisters, OR'
                 and r.equipment = '[{"label": "Log truck", "units": 3}, {"label": "Self-loader log truck", "units": 1}]'::jsonb
                 and r.availability_reported_at is not null and r.verified is false and r.verified_at is null)::text
         from marketplace.list_invitation_recipients(%L) r$q$, o_haul, j_a)) = 'true',
    '33-I1: ... with its name, home base, active equipment by type, last availability report and verification');
  perform pg_temp.ok(pg_temp.as_user('s33_own', format(
      $q$select (select string_agg(k, ',' order by k) from jsonb_object_keys(to_jsonb(r)) k)
         from marketplace.list_invitation_recipients(%L) r$q$, j_a))
      = 'availability_reported_at,business_name,equipment,home_base,org_id,verified,verified_at',
    '33-I1: ... and nothing else: no person, phone, email, point or private landing detail');
  perform pg_temp.ok(pg_temp.as_user('s33_mgr', format('select count(*) from marketplace.list_invitation_recipients(%L, 100)', j_b)) = '1'
                     and pg_temp.as_user('s33_staff', format('select count(*) from marketplace.list_invitation_recipients(%L)', j_a)) = '1',
    '33-I1: a manager lists them for a job at landing B, and staff limited to landing A for a job at A');
  perform pg_temp.ok(pg_temp.answer('s33_staff', format('select * from marketplace.list_invitation_recipients(%L)', j_b)) = '42501 not authorized for this job'
                     and pg_temp.answer('s33_ldrv', format('select * from marketplace.list_invitation_recipients(%L)', j_a)) = '42501 not authorized for this job'
                     and pg_temp.answer('s33_rival', format('select * from marketplace.list_invitation_recipients(%L)', j_a)) = '42501 not authorized for this job'
                     and pg_temp.answer('s33_haul', format('select * from marketplace.list_invitation_recipients(%L)', j_a)) = '42501 not authorized for this job'
                     and pg_temp.answer('s33_own', format('select * from marketplace.list_invitation_recipients(%L)', gen_random_uuid())) = '42501 not authorized for this job',
    '33-I1: staff limited to A (for a job at B), a driver without a seat, another landing business and a hauler are refused, exactly as for an unknown job');
  perform pg_temp.as_jwt('anon');
  perform pg_temp.fails(format('select * from marketplace.list_invitation_recipients(%L)', j_a), '42501', 'permission denied', '33-I1: anon cannot call it');

  -- =========================================================================
  -- 33-I2: respond_to_invitation
  -- =========================================================================
  perform pg_temp.as_jwt('authenticated', 's33_own');
  v_tinv := marketplace.reserve_targeted_invitation(j_a, o_haul, 'Three trucks from Monday');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'reserved' and recipient_response = 'none' from marketplace.targeted_invitations where id = v_tinv),
    'fixture: an invitation is reserved and not delivered yet');
  perform pg_temp.ok(pg_temp.answer('s33_hdrv', format('select marketplace.respond_to_invitation(%L, %L)', v_tinv, 'interested')) = 'P0002 Invitation not found',
    '33-I2: an invitation that was not delivered cannot be answered');
  perform pg_temp.ok(pg_temp.answer('s33_rival', format('select marketplace.respond_to_invitation(%L, %L)', v_tinv, 'interested')) = 'P0002 Invitation not found'
                     and pg_temp.answer('s33_haul', format('select marketplace.respond_to_invitation(%L, %L)', gen_random_uuid(), 'interested')) = 'P0002 Invitation not found',
    '33-I2: ... and reads exactly like another business''s invitation and one that does not exist');
  perform pg_temp.ok((select recipient_response = 'none' and responded_at is null from marketplace.targeted_invitations where id = v_tinv)
                     and not exists (select 1 from marketplace.audit_events where entity_id = v_tinv and action in ('invitation.viewed', 'invitation.interested', 'invitation.declined')),
    '33-I2: ... nothing was recorded');

  select d.id into v_del from marketplace.invitation_deliveries d where d.invitation_id = v_tinv order by d.id limit 1;
  perform pg_temp.as_jwt('service_role');
  perform marketplace.resolve_invitation_delivery(v_del, 'delivered', 'msg_s33_1');
  perform pg_temp.as_jwt('authenticated', 's33_haul');
  perform marketplace.respond_to_invitation(v_tinv, 'viewed');
  perform marketplace.respond_to_invitation(v_tinv, 'viewed');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'delivered' and recipient_response = 'viewed' and responded_at is not null from marketplace.targeted_invitations where id = v_tinv)
                     and (select count(*) = 1 from marketplace.audit_events where entity_id = v_tinv and action = 'invitation.viewed' and actor_user_id = u_haul and org_id = o_haul),
    '33-I2: once delivered, the recipient marks it viewed; a second view changes nothing; one audit row');
  select responded_at into v_ts from marketplace.targeted_invitations where id = v_tinv;
  perform pg_temp.as_jwt('authenticated', 's33_hdrv');
  perform marketplace.respond_to_invitation(v_tinv, 'interested');
  perform marketplace.respond_to_invitation(v_tinv, 'interested');
  perform pg_temp.as_jwt('authenticated', 's33_haul');
  perform marketplace.respond_to_invitation(v_tinv, 'viewed');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select recipient_response = 'interested' from marketplace.targeted_invitations where id = v_tinv)
                     and (select count(*) = 1 from marketplace.audit_events where entity_id = v_tinv and action = 'invitation.interested' and actor_user_id = u_hdrv)
                     and (select count(*) = 2 from marketplace.audit_events where entity_id = v_tinv and action in ('invitation.viewed', 'invitation.interested', 'invitation.declined')),
    '33-I2: the driver answers interested, once: the same answer again and a later view change nothing and audit nothing');
  perform pg_temp.as_jwt('authenticated', 's33_haul');
  perform pg_temp.fails(format('select marketplace.respond_to_invitation(%L, %L)', v_tinv, 'declined'),
    '23514', 'already answered', '33-I2: a different answer is refused');
  perform pg_temp.fails(format('select marketplace.respond_to_invitation(%L, %L)', v_tinv, 'maybe'), '22023', 'invalid invitation response', '33-I2: an unknown response is refused');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select recipient_response = 'interested' from marketplace.targeted_invitations where id = v_tinv)
                     and pg_temp.answer('s33_own', format('select marketplace.respond_to_invitation(%L, %L)', v_tinv, 'declined')) = 'P0002 Invitation not found',
    '33-I2: ... the answer stands, and the sending landing cannot answer for the recipient');

  -- =========================================================================
  -- 33-T: remove_team_member
  -- =========================================================================
  perform pg_temp.ok(pg_temp.answer('s33_rival', format('select marketplace.remove_team_member(%L)', m_staff)) = '42501 Membership not found'
                     and pg_temp.answer('s33_mgr', format('select marketplace.remove_team_member(%L)', m_staff)) = '42501 Membership not found'
                     and pg_temp.answer('s33_staff', format('select marketplace.remove_team_member(%L)', m_staff)) = '42501 Membership not found'
                     and pg_temp.answer('s33_own', format('select marketplace.remove_team_member(%L)', gen_random_uuid())) = '42501 Membership not found',
    '33-T: only an owner removes a member: another business''s owner, a manager and the member get the answer an unknown id gets');
  perform pg_temp.ok(pg_temp.as_user('s33_staff', format('select count(*) from marketplace.list_authoring_landings(%L)', o_land)) = '1'
                     and (select count(*) = 1 from marketplace.membership_landing_scopes where membership_id = m_staff),
    'fixture: the staff member works at landing A');
  perform pg_temp.as_jwt('authenticated', 's33_own');
  perform marketplace.remove_team_member(m_staff);
  perform marketplace.remove_team_member(m_staff);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'removed' and ended_at is not null from marketplace.organization_memberships where id = m_staff)
                     and not exists (select 1 from marketplace.membership_landing_scopes where membership_id = m_staff)
                     and (select count(*) = 1 from marketplace.audit_events
                          where entity_id = m_staff and action = 'membership.removed' and actor_user_id = u_own and metadata ->> 'role' = 'staff'),
    '33-T: the owner removes the staff member: removed, landing limits cleared, audited once (a second call changes nothing)');
  perform pg_temp.ok(pg_temp.answer('s33_staff', format('select * from marketplace.list_authoring_landings(%L)', o_land)) like '42501 %'
                     and pg_temp.answer('s33_staff', format('select marketplace.reconfirm_job_posting(%L)', j_a)) = 'P0002 Job not found'
                     and pg_temp.as_user('s33_staff', format('select count(*) from marketplace.landing_private_details where landing_id = %L', l_a)) = '0',
    '33-T: ... and their access ends at once: no landings, no job actions, no private details');
  perform pg_temp.ok(pg_temp.answer('s33_own', format('select marketplace.remove_team_member(%L)', m_own)) = '23514 A business keeps at least one owner'
                     and (select status = 'active' from marketplace.organization_memberships where id = m_own),
    '33-T: the last active owner cannot be removed');
  perform pg_temp.as_jwt('authenticated', 's33_haul');
  perform marketplace.remove_team_member(m_hdrv);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'removed' from marketplace.organization_memberships where id = m_hdrv)
                     and pg_temp.answer('s33_hdrv', format('select marketplace.respond_to_invitation(%L, %L)', v_tinv, 'viewed')) = 'P0002 Invitation not found',
    '33-T: a hauling business''s owner removes its driver, who can no longer act for it');

  -- =========================================================================
  -- 33-A1: admin target checks
  -- =========================================================================
  r1 := gen_random_uuid();
  perform pg_temp.ok(pg_temp.answer('s33_admin', format('select marketplace.admin_set_org_verification(%L, %L, %L)', r1, 'verified', 'suite 34 unknown business')) = 'P0002 Organization not found'
                     and pg_temp.answer('s33_admin', format('select * from marketplace.admin_read_landing_private(%L, %L)', r1, 'suite 34 unknown landing')) = 'P0002 Landing not found'
                     and not exists (select 1 from marketplace.audit_events where entity_id = r1),
    '33-A1: verifying an unknown business and reading an unknown landing''s private details are refused, and write no audit row');
  perform pg_temp.as_jwt('authenticated', 's33_admin');
  perform marketplace.admin_set_org_verification(o_land, 'verified', 'suite 34 verification');
  perform pg_temp.ok((select count(*) = 1 from marketplace.admin_read_landing_private(l_a, 'suite 34 support ticket 1')),
    '33-A1: a support read of an existing landing still returns its private row');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select verification_status = 'verified' and verified_by = u_admin from marketplace.organizations where id = o_land)
                     and (select count(*) = 1 from marketplace.audit_events where entity_id = o_land and action = 'organization.verification_set')
                     and (select count(*) = 1 from marketplace.audit_events where entity_id = l_a and action = 'landing_private.admin_viewed'),
    '33-A1: ... and both existing targets are changed, read and audited as before');
  perform pg_temp.ok(pg_temp.answer('s33_own', format('select marketplace.admin_set_org_verification(%L, %L, %L)', r1, 'verified', 'not an admin')) like '42501 %'
                     and pg_temp.answer('s33_own', format('select * from marketplace.admin_read_landing_private(%L, %L)', r1, 'not an admin at all')) like '42501 %',
    '33-A1: a person who is not staff gets the staff refusal for any id');

  -- =========================================================================
  -- 33-A2: admin_resolve_report
  -- =========================================================================
  perform pg_temp.as_jwt('authenticated', 's33_haul');
  insert into marketplace.abuse_reports (target_kind, target_id, reason, details) values ('job_posting', j_a, 'inaccurate_pay', 'Pay on the page is not what was offered.') returning id into r1;
  perform pg_temp.as_jwt('authenticated', 's33_haul2');
  insert into marketplace.abuse_reports (target_kind, target_id, reason, details) values ('job_posting', j_b, 'spam', null) returning id into r2;
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.answer('s33_own', format('select marketplace.admin_resolve_report(%L, %L, %L)', r1, 'dismissed', 'not staff')) = '42501 platform moderator required'
                     and pg_temp.answer('s33_haul', format('select marketplace.admin_resolve_report(%L, %L, %L)', r1, 'dismissed', 'my own report')) = '42501 platform moderator required'
                     and pg_temp.answer('s33_sup', format('select marketplace.admin_resolve_report(%L, %L, %L)', r1, 'dismissed', 'support only')) = '42501 platform moderator required',
    '33-A2: only a moderator resolves a report: an owner, the reporter and a support admin are refused');
  perform pg_temp.ok(pg_temp.answer('s33_mod', format('select marketplace.admin_resolve_report(%L, %L, %L)', r1, 'open', 'reopen it')) like '22023 %'
                     and pg_temp.answer('s33_mod', format('select marketplace.admin_resolve_report(%L, %L)', r1, 'actioned')) like '22023 resolving a report needs a note%'
                     and pg_temp.answer('s33_mod', format('select marketplace.admin_resolve_report(%L, %L, %L)', r1, 'dismissed', 'no')) like '22023 %'
                     and pg_temp.answer('s33_mod', format('select marketplace.admin_resolve_report(%L, %L, %L)', gen_random_uuid(), 'dismissed', 'unknown report')) = 'P0002 Report not found',
    '33-A2: a report is marked reviewing, actioned or dismissed; resolving needs a note; an unknown report is not found');
  perform pg_temp.as_jwt('authenticated', 's33_mod');
  perform marketplace.admin_resolve_report(r1, 'reviewing');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'reviewing' and reviewed_by = u_mod and reviewed_at is not null and resolution_note is null from marketplace.abuse_reports where id = r1)
                     and (select count(*) = 1 from marketplace.audit_events where entity_id = r1 and action = 'abuse_report.reviewing' and actor_kind = 'platform_admin'),
    '33-A2: a moderator takes a report into review, without a note; audited');
  perform pg_temp.as_jwt('authenticated', 's33_mod');
  perform marketplace.admin_resolve_report(r1, 'actioned', 'Poster corrected the pay; listing checked.');
  perform marketplace.admin_resolve_report(r1, 'actioned', 'A second click.');
  perform pg_temp.as_jwt('authenticated', 's33_admin');
  perform marketplace.admin_resolve_report(r2, 'dismissed', 'Not spam: a real posting.');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'actioned' and resolution_note = 'Poster corrected the pay; listing checked.' from marketplace.abuse_reports where id = r1)
                     and (select status = 'dismissed' and reviewed_by = u_admin from marketplace.abuse_reports where id = r2)
                     and (select count(*) = 1 from marketplace.audit_events where entity_id = r1 and action = 'abuse_report.actioned')
                     and (select count(*) = 1 from marketplace.audit_events where entity_id = r2 and action = 'abuse_report.dismissed'),
    '33-A2: the moderator actions it with a note (the same outcome again changes nothing); a superadmin dismisses another; each audited once');
  perform pg_temp.ok(pg_temp.answer('s33_mod', format('select marketplace.admin_resolve_report(%L, %L, %L)', r1, 'dismissed', 'changed my mind')) = '23514 This report is already resolved'
                     and pg_temp.answer('s33_mod', format('select marketplace.admin_resolve_report(%L, %L)', r2, 'reviewing')) = '23514 This report is already resolved',
    '33-A2: a resolved report keeps its outcome');
  perform pg_temp.ok(pg_temp.as_user('s33_haul', format('select status || ''|'' || resolution_note from marketplace.abuse_reports where id = %L', r1))
                       = 'actioned|Poster corrected the pay; listing checked.',
    '33-A2: the reporter reads the outcome');

  -- =========================================================================
  -- 33-Q1: inquiry pages
  -- =========================================================================
  -- e1: replied, then the hauler wrote last. e2: new, on a job that then goes past day 14. e3: declined, at landing B.
  -- e4: replied by the landing, from the second hauling business.
  perform pg_temp.as_jwt('authenticated', 's33_haul');
  select interest_id into e2 from marketplace.submit_expression_of_interest(o_haul, j_a2, 1);
  select interest_id into e3 from marketplace.submit_expression_of_interest(o_haul, j_b, 1);
  perform pg_temp.as_jwt('authenticated', 's33_haul2');
  select interest_id into e4 from marketplace.submit_expression_of_interest(o_haul2, j_a, 1);
  perform pg_temp.as_jwt('harness');
  -- The hauling business was invited to j_a and answered interested; its inquiry there is e1.
  perform pg_temp.as_jwt('authenticated', 's33_haul');
  select interest_id into e1 from marketplace.submit_expression_of_interest(o_haul, j_a, 2);
  perform pg_temp.as_jwt('authenticated', 's33_own');
  perform marketplace.respond_to_interest(e1, 'replied', null, gen_random_uuid(), 'Two trucks works. Monday?');
  perform marketplace.respond_to_interest(e3, 'declined');
  perform marketplace.respond_to_interest(e4, 'replied', null, gen_random_uuid(), 'One truck from Tuesday.');
  perform pg_temp.as_jwt('authenticated', 's33_haul');
  perform marketplace.post_hauler_interest_reply(e1, gen_random_uuid(), 'Monday is fine.');
  perform pg_temp.as_jwt('harness');
  -- Distinct times for the two orders (landing: created_at; hauler: updated_at), with one tie on each.
  alter table marketplace.expressions_of_interest disable trigger user;
  update marketplace.expressions_of_interest set created_at = now() - interval '4 hours', updated_at = now() - interval '1 hour' where id = e1;
  update marketplace.expressions_of_interest set created_at = now() - interval '3 hours', updated_at = now() - interval '2 hours' where id = e2;
  update marketplace.expressions_of_interest set created_at = now() - interval '3 hours', updated_at = now() - interval '2 hours' where id = e3;
  update marketplace.expressions_of_interest set created_at = now() - interval '1 hour', updated_at = now() - interval '30 minutes' where id = e4;
  alter table marketplace.expressions_of_interest enable trigger user;
  -- The two messages on e1 were written in this one transaction, so they share a timestamp; give them the order
  -- they were written in (the landing first, the hauler last).
  alter table marketplace.interest_messages disable trigger user;
  update marketplace.interest_messages set created_at = now() - interval '50 minutes' where interest_id = e1 and author_side = 'landing';
  update marketplace.interest_messages set created_at = now() - interval '40 minutes' where interest_id = e1 and author_side = 'hauler';
  alter table marketplace.interest_messages enable trigger user;
  update marketplace.job_publication_attestations set reconfirmed_at = now() - interval '20 days' where job_id = j_a2;
  update marketplace.job_postings set title = title where id = j_a2;

  perform pg_temp.ok(pg_temp.as_user('s33_own', format('select string_agg(id::text, '','') from marketplace.list_marketplace_interests(%L, %L)', o_land, 'landing'))
                       = (select string_agg(id::text, ',' order by created_at desc, id) from marketplace.expressions_of_interest where job_org_id = o_land)
                     and pg_temp.as_user('s33_haul', format('select string_agg(id::text, '','') from marketplace.list_marketplace_interests(%L, %L)', o_haul, 'hauler'))
                       = (select string_agg(id::text, ',' order by updated_at desc, id) from marketplace.expressions_of_interest where hauler_org_id = o_haul)
                     and pg_temp.as_user('s33_own', format('select count(*) from marketplace.list_marketplace_interests(%L, %L)', o_land, 'landing')) = '4'
                     and pg_temp.as_user('s33_haul', format('select count(*) from marketplace.list_marketplace_interests(%L, %L, %L)', o_haul, 'hauler', j_a)) = '1',
    '33-Q1: without the page arguments the list is what it was: every inquiry of the side, newest first, and one job''s');

  -- Landing side, two rows at a time, across the tie at three hours.
  perform pg_temp.as_jwt('authenticated', 's33_own');
  select array_agg(x.id order by x.n), (array_agg(x.created_at order by x.n desc))[1], (array_agg(x.id order by x.n desc))[1]
  into v_page, v_cursor_at, v_cursor_id
  from (select l.id, l.created_at, row_number() over () as n from marketplace.list_marketplace_interests(o_land, 'landing', p_limit => 2) l) x;
  v_all := v_page;
  select array_agg(x.id order by x.n), (array_agg(x.created_at order by x.n desc))[1], (array_agg(x.id order by x.n desc))[1]
  into v_page, v_cursor_at, v_cursor_id
  from (select l.id, l.created_at, row_number() over () as n
        from marketplace.list_marketplace_interests(o_land, 'landing', p_limit => 2, p_after_at => v_cursor_at, p_after_id => v_cursor_id) l) x;
  v_all := v_all || v_page;
  select count(*) into v_n from marketplace.list_marketplace_interests(o_land, 'landing', p_limit => 2, p_after_at => v_cursor_at, p_after_id => v_cursor_id);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_all = (select array_agg(id order by created_at desc, id) from marketplace.expressions_of_interest where job_org_id = o_land)
                     and cardinality(v_all) = 4 and v_n = 0,
    '33-Q1: two rows at a time with the cursor of the last row reads every inquiry once, in order, across a tie in time, and then ends');
  -- Hauler side, one row at a time.
  perform pg_temp.as_jwt('authenticated', 's33_haul');
  v_all := '{}'; v_cursor_at := null; v_cursor_id := null;
  for i in 1..5 loop
    select l.id, l.updated_at into v_cursor_id, v_ts
    from marketplace.list_marketplace_interests(o_haul, 'hauler', p_limit => 1, p_after_at => v_cursor_at, p_after_id => v_cursor_id) l;
    exit when not found;
    v_all := v_all || v_cursor_id; v_cursor_at := v_ts;
  end loop;
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_all = (select array_agg(id order by updated_at desc, id) from marketplace.expressions_of_interest where hauler_org_id = o_haul)
                     and cardinality(v_all) = 3,
    '33-Q1: ... and one row at a time on the hauler side, by its own order');

  perform pg_temp.ok(pg_temp.as_user('s33_haul', format('select string_agg(id::text, '','' order by id) from marketplace.list_marketplace_interests(%L, %L, p_job_ids => array[%L, %L]::uuid[])', o_haul, 'hauler', j_a, j_b))
                       = (select string_agg(id::text, ',' order by id) from marketplace.expressions_of_interest where hauler_org_id = o_haul and job_id in (j_a, j_b))
                     and pg_temp.as_user('s33_haul', format('select count(*) from marketplace.list_marketplace_interests(%L, %L, p_job_ids => %L::uuid[])', o_haul, 'hauler', '{}')) = '0'
                     and pg_temp.as_user('s33_own', format('select count(*) from marketplace.list_marketplace_interests(%L, %L, p_job_ids => array[%L]::uuid[])', o_land, 'landing', j_a)) = '2',
    '33-Q1: p_job_ids keeps the inquiries on those jobs only');
  perform pg_temp.ok(pg_temp.as_user('s33_haul', format('select jsonb_array_length(replies)::text || ''/'' || status from marketplace.list_marketplace_interests(%L, %L, p_interest_id => %L)', o_haul, 'hauler', e1)) = '2/replied'
                     and pg_temp.as_user('s33_haul', format('select jsonb_array_length(replies)::text || ''/'' || status from marketplace.list_marketplace_interests(%L, %L, p_interest_id => %L, p_with_replies => false)', o_haul, 'hauler', e1)) = '0/replied'
                     and pg_temp.as_user('s33_haul', format('select count(*) from marketplace.list_marketplace_interests(%L, %L, p_interest_id => %L)', o_haul, 'hauler', e4)) = '0',
    '33-Q1: p_interest_id reads one inquiry of the side; p_with_replies false leaves its messages out');
  perform pg_temp.ok(pg_temp.as_user('s33_own', format('select string_agg(id::text, '','' order by id) from marketplace.list_marketplace_interests(%L, %L, p_queue => %L)', o_land, 'landing', 'new'))
                       = (select string_agg(id::text, ',' order by id) from marketplace.expressions_of_interest where id in (e1, e2))
                     and pg_temp.as_user('s33_own', format('select string_agg(id::text, '','') from marketplace.list_marketplace_interests(%L, %L, p_queue => %L)', o_land, 'landing', 'responded')) = e4::text
                     and pg_temp.as_user('s33_own', format('select string_agg(id::text, '','') from marketplace.list_marketplace_interests(%L, %L, p_queue => %L)', o_land, 'landing', 'closed')) = e3::text
                     and pg_temp.as_user('s33_haul', format('select string_agg(id::text, '','') from marketplace.list_marketplace_interests(%L, %L, p_queue => %L)', o_haul, 'hauler', 'active')) = e2::text
                     and pg_temp.as_user('s33_haul', format('select string_agg(id::text, '','') from marketplace.list_marketplace_interests(%L, %L, p_queue => %L)', o_haul, 'hauler', 'replied')) = e1::text
                     and pg_temp.as_user('s33_haul', format('select string_agg(id::text, '','') from marketplace.list_marketplace_interests(%L, %L, p_queue => %L)', o_haul, 'hauler', 'closed')) = e3::text,
    '33-Q1: p_queue reads one tab: for the landing a replied inquiry is back in New when the hauler wrote last; for the hauler it is Replied');
  perform pg_temp.ok(pg_temp.as_user('s33_own', format('select string_agg(queue || ''='' || total, '','') from marketplace.count_marketplace_interests(%L, %L)', o_land, 'landing')) = 'new=2,responded=1,closed=1'
                     and pg_temp.as_user('s33_haul', format('select string_agg(queue || ''='' || total, '','') from marketplace.count_marketplace_interests(%L, %L)', o_haul, 'hauler')) = 'active=1,replied=1,closed=1'
                     and pg_temp.as_user('s33_haul2', format('select string_agg(queue || ''='' || total, '','') from marketplace.count_marketplace_interests(%L, %L)', o_haul2, 'hauler')) = 'active=0,replied=1,closed=0',
    '33-Q1: count_marketplace_interests returns the three tab counts of a side, zeros included');
  perform pg_temp.ok(pg_temp.as_user('s33_own', format('select job_accepting_interest::text || ''/'' || job_status from marketplace.list_marketplace_interests(%L, %L, p_interest_id => %L)', o_land, 'landing', e2)) = 'false/active'
                     and pg_temp.as_user('s33_own', format('select job_accepting_interest::text || ''/'' || job_status from marketplace.list_marketplace_interests(%L, %L, p_interest_id => %L)', o_land, 'landing', e1)) = 'true/active',
    '33-Q1: job_accepting_interest follows the day-14 rule: false for an active job confirmed 20 days ago');
  perform pg_temp.as_jwt('authenticated', 's33_own');
  perform pg_temp.fails(format('select * from marketplace.list_marketplace_interests(%L, %L, p_queue => %L)', o_land, 'landing', 'active'), '22023', 'unknown inquiry queue', '33-Q1: a tab of the other side is refused');
  perform pg_temp.fails(format('select * from marketplace.list_marketplace_interests(%L, %L, p_after_id => %L)', o_land, 'landing', e1), '22023', 'cursor needs both', '33-Q1: half a cursor is refused');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.answer('s33_rival', format('select * from marketplace.count_marketplace_interests(%L, %L)', o_land, 'landing')) like '42501 %'
                     and pg_temp.answer('s33_ldrv', format('select * from marketplace.count_marketplace_interests(%L, %L)', o_land, 'landing')) = '42501 Inquiry not found'
                     and pg_temp.answer('s33_own', format('select * from marketplace.count_marketplace_interests(%L, %L)', o_land, 'hauler')) like '42501 %'
                     and pg_temp.answer('s33_rival', format('select * from marketplace.list_marketplace_interests(%L, %L, p_limit => 5)', o_land, 'landing')) like '42501 %',
    '33-Q1: the counts and the pages keep the list''s access rule: another business, a driver without a seat and the wrong side are refused');

  -- A manager limited to landing B (set after the fact) sees only landing B's inquiries, in the list, counts and single read.
  perform pg_temp.as_jwt('authenticated', 's33_own');
  perform marketplace.set_membership_landing_scope(m_mgr, array[l_b]);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.as_user('s33_mgr', format('select string_agg(queue || ''='' || total, '','') from marketplace.count_marketplace_interests(%L, %L)', o_land, 'landing')) = 'new=0,responded=0,closed=1'
                     and pg_temp.as_user('s33_mgr', format('select string_agg(id::text, '','') from marketplace.list_marketplace_interests(%L, %L, p_limit => 10)', o_land, 'landing')) = e3::text
                     and pg_temp.as_user('s33_mgr', format('select count(*) from marketplace.get_marketplace_interest(%L)', e3)) = '1'
                     and pg_temp.as_user('s33_mgr', format('select count(*) from marketplace.get_marketplace_interest(%L)', e1)) = '0',
    '33-Q1: a manager limited to landing B counts, pages and reads only the inquiries at landing B (26-B)');
  perform pg_temp.ok(pg_temp.as_user('s33_haul', format('select id::text || ''/'' || jsonb_array_length(replies) from marketplace.get_marketplace_interest(%L)', e1)) = e1::text || '/2'
                     and pg_temp.as_user('s33_own', format('select id::text || ''/'' || hauler_org_name from marketplace.get_marketplace_interest(%L)', e1)) = e1::text || '/S33 Hauling'
                     and pg_temp.as_user('s33_own', format('select (to_jsonb(g) = (select to_jsonb(l) from marketplace.list_marketplace_interests(%L, %L, p_interest_id => %L) l))::text from marketplace.get_marketplace_interest(%L) g', o_land, 'landing', e4, e4)) = 'true',
    '33-Q1: get_marketplace_interest returns one inquiry to its hauling business and to its landing desk, the row the list returns');
  perform pg_temp.ok(pg_temp.as_user('s33_haul2', format('select count(*) from marketplace.get_marketplace_interest(%L)', e1)) = '0'
                     and pg_temp.as_user('s33_rival', format('select count(*) from marketplace.get_marketplace_interest(%L)', e1)) = '0'
                     and pg_temp.as_user('s33_ldrv', format('select count(*) from marketplace.get_marketplace_interest(%L)', e1)) = '0'
                     and pg_temp.as_user('s33_hdrv', format('select count(*) from marketplace.get_marketplace_interest(%L)', e1)) = '0'
                     and pg_temp.as_user('s33_own', format('select count(*) from marketplace.get_marketplace_interest(%L)', gen_random_uuid())) = '0',
    '33-Q1: ... and no row to another hauling business, another landing, a driver without a seat, a removed member, or for an unknown id');
  perform pg_temp.as_jwt('anon');
  perform pg_temp.fails(format('select * from marketplace.get_marketplace_interest(%L)', e1), '42501', 'permission denied', '33-Q1: anon cannot read an inquiry');
  perform pg_temp.fails(format('select * from marketplace.count_marketplace_interests(%L, %L)', o_land, 'landing'), '42501', 'permission denied', '33-Q1: ... or count them');

  -- =========================================================================
  -- 33-Q2: Find Work as pages
  -- =========================================================================
  -- Landing B gets four more jobs: a per-load rate, negotiable pay, an hourly rate and one that needs two machines.
  perform pg_temp.as_jwt('authenticated', 's33_own');
  j_load := marketplace.publish_job_posting(l_b, 'S33 Chip Haul B', array['chip_van'], 2, 'Chips', 'Suite 34 per load.', 'per_load', 90000, null,
    2, current_date + 5, 8, 3.0, 6, 30.0, 'Prineville Mill, OR', 35, null, null, array['ppe'], true);
  j_neg := marketplace.publish_job_posting(l_b, 'S33 Pole Haul B', array['log_truck'], 1, 'Poles and pilings', 'Suite 34 negotiable.', 'negotiable', null, 'Rate by distance; call the desk.',
    1, current_date + 40, 8, 3.0, 6, 30.0, 'Prineville Mill, OR', 35, null, null, array['ppe'], true);
  j_hour := marketplace.publish_job_posting(l_b, 'S33 Yard Shuttle B', array['log_truck'], 1, 'Cedar shake bolts', 'Suite 34 hourly.', 'per_hour', 12000, null,
    1, current_date + 8, 8, 3.0, 6, 30.0, 'Prineville Mill, OR', 35, null, null, array['ppe'], true);
  j_two := marketplace.publish_job_posting(l_b, 'S33 Self Load Haul B', array['log_truck', 'self_loader'], 1, 'Pine sawlogs', 'Suite 34 two machines.', 'per_ton', 610, null,
    1, current_date + 9, 8, 3.0, 6, 30.0, 'Prineville Mill, OR', 35, null, null, array['ppe'], true);
  perform pg_temp.as_jwt('harness');

  -- newest: the contract's order, computed here from the table.
  select array_agg(j.id order by (j.last_confirmed_at is null), coalesce(j.last_confirmed_at, j.updated_at) desc, j.title collate "C", j.id)
  into v_expected from marketplace.job_postings j where j.title like 'S33 %' and j.id <> j_a2;
  v_all := pg_temp.walk(null, $a$p_query => 'S33'$a$, 3);
  perform pg_temp.ok(v_all = v_expected and cardinality(v_all) = 7 and v_all[1] = j_two,
    '33-Q2 (newest): three rows at a time, anon reads all 7 listed jobs once, the latest confirmation first; the job past day 14 is not among them; every page reports total_count 7');
  perform pg_temp.ok(pg_temp.walk(null, $a$p_query => 'S33'$a$, 1) = v_expected and pg_temp.walk('s33_haul', $a$p_query => 'S33'$a$, 200) = v_expected,
    '33-Q2 (newest): ... the same list one row at a time, and in a single page for a signed-in hauler');
  perform pg_temp.ok(pg_temp.as_user(null, $q$select (select array_agg(p.job_id order by p.job_id) from marketplace.list_marketplace_jobs_page(p_query => 'S33', p_limit => 200) p)
                                              = (select array_agg(l.job_id order by l.job_id) from marketplace.list_marketplace_jobs(p_query => 'S33') l)$q$) = 'true'
                     and pg_temp.as_user(null, $q$select bool_and(not p.sponsored and p.total_count = 7 and p.status = 'active' and p.accepting_interest)::text
                                              from marketplace.list_marketplace_jobs_page(p_query => 'S33') p$q$) = 'true',
    '33-Q2: the pages hold exactly the jobs list_marketplace_jobs lists; none is marked sponsored');

  -- pay: per load, then per ton by amount, then per hour; negotiable last.
  v_all := pg_temp.walk(null, $a$p_query => 'S33', p_sort => 'pay'$a$, 2);
  perform pg_temp.ok(cardinality(v_all) = 7 and v_all[1] = j_load and v_all[2] = j_two and v_all[3] = j_a and v_all[4] = j_b and v_all[5] = j_rival
                     and v_all[6] = j_hour and v_all[7] = j_neg,
    '33-Q2 (pay): two rows at a time: the per-load rate, then per-ton rates from the highest, then the hourly rate, and negotiable pay last');
  -- nearest: from landing B's cell; B's jobs, then A's, then the rival's (farther north).
  v_all := pg_temp.walk(null, $a$p_query => 'S33', p_sort => 'nearest', p_lat => 44.12, p_lng => -121.31$a$, 2);
  perform pg_temp.ok(cardinality(v_all) = 7 and v_all[6] = j_a and v_all[7] = j_rival
                     and (select bool_and(x = any (array[j_b, j_load, j_neg, j_hour, j_two])) from unnest(v_all[1:5]) x)
                     and v_all[1:5] = (select array_agg(e order by array_position(v_expected, e)) from unnest(v_all[1:5]) e),
    '33-Q2 (nearest): from a place at landing B: its five jobs first, newest first among them, then landing A''s, then the farther rival''s');
  perform pg_temp.ok(pg_temp.walk(null, $a$p_query => 'S33', p_sort => 'nearest'$a$, 4) = v_expected,
    '33-Q2 (nearest): without a place it is the newest order');
  perform pg_temp.ok(pg_temp.as_user(null, $q$select string_agg(distinct p.distance_miles::text, ',') from marketplace.list_marketplace_jobs_page(p_query => 'S33 Pine', p_lat => 44.12, p_lng => -121.31) p$q$) = '0'
                     and pg_temp.as_user(null, $q$select (p.origin_lat = 44.1 and p.origin_lng = -121.3)::text from marketplace.list_marketplace_jobs_page(p_query => 'S33 Pine') p$q$) = 'true',
    '33-Q2: the typed place is snapped to the 0.10 degree grid, and a job shows only its public grid point');

  -- Filters.
  perform pg_temp.ok(pg_temp.walk(null, $a$p_query => 'S33', p_product => ' pine SAWLOGS '$a$, 5) = (select array_agg(e order by array_position(v_expected, e)) from unnest(array[j_b, j_two]) e)
                     and pg_temp.walk(null, $a$p_query => 'S33', p_product_excluded => array['Saw logs', 'Pulpwood', 'Poles and pilings', 'Chips', 'Hog fuel and biomass', 'Hardwood logs']$a$, 5)
                         = (select array_agg(e order by array_position(v_expected, e)) from unnest(array[j_a, j_b, j_hour, j_two, j_rival]) e),
    '33-Q2 (product): one product by name, whatever its case; and "Other" as every stated product outside the named ones');
  perform pg_temp.ok(pg_temp.walk(null, format('p_query => %L, p_starts_by => %L::date', 'S33', current_date + 9), 5)
                       = (select array_agg(e order by array_position(v_expected, e)) from unnest(array[j_load, j_hour, j_two]) e),
    '33-Q2 (start): jobs that start by a date');
  perform pg_temp.ok(pg_temp.walk(null, $a$p_query => 'S33', p_equipment_setups => '[["LOG_TRUCK"], []]'::jsonb$a$, 5)
                       = (select array_agg(e order by array_position(v_expected, e)) from unnest(array[j_a, j_b, j_neg, j_hour, j_rival]) e)
                     and pg_temp.walk(null, $a$p_query => 'S33', p_equipment_setups => '[["chip_van"], ["self_loader", "log_truck"]]'::jsonb$a$, 5) = v_expected
                     and pg_temp.walk(null, $a$p_query => 'S33', p_equipment_setups => '[[]]'::jsonb$a$, 5) = v_expected,
    '33-Q2 (setups): a job is kept when one of the viewer''s setups has every piece of equipment it lists; no setup means no comparison');
  perform pg_temp.ok(pg_temp.walk(null, $a$p_query => 'S33', p_lat => 44.1, p_lng => -121.3, p_radius_miles => 5$a$, 5)
                       = (select array_agg(e order by array_position(v_expected, e)) from unnest(array[j_b, j_load, j_neg, j_hour, j_two]) e)
                     and pg_temp.walk(null, $a$p_query => 'S33', p_lat => 44.1, p_lng => -121.3, p_radius_miles => 500$a$, 5) = v_expected,
    '33-Q2 (distance): within a radius of the typed place');
  perform pg_temp.ok(pg_temp.walk(null, $a$p_query => 'S33', p_pay_unit => 'per_ton', p_equipment => 'log_truck', p_sort => 'pay'$a$, 2) = array[j_two, j_a, j_b, j_rival]
                     and pg_temp.walk(null, format('p_org_id => %L', o_rival), 5) = array[j_rival],
    '33-Q2: the pay basis, one equipment code and the poster are applied as list_marketplace_jobs applies them');

  -- The day-14 job: on its own desk's pages only.
  perform pg_temp.ok(pg_temp.walk(null, format('p_org_id => %L, p_accepting_only => false', o_land), 4) = (select array_agg(e order by array_position(v_expected, e)) from unnest(v_expected) e where e <> j_rival)
                     and j_a2 = any (pg_temp.walk('s33_own', format('p_org_id => %L, p_accepting_only => false', o_land), 4))
                     and not (j_a2 = any (pg_temp.walk('s33_own', format('p_org_id => %L', o_land), 4)))
                     and not (j_a2 = any (pg_temp.walk('s33_haul', format('p_org_id => %L, p_accepting_only => false', o_land), 4))),
    '33-Q2 (day 14): the job past day 14 is on no public page; its own desk still pages to it when not limited to jobs taking interest');

  -- Cursors and arguments.
  perform pg_temp.as_jwt('anon');
  select p.page_cursor into v_cursor from marketplace.list_marketplace_jobs_page(p_query => 'S33', p_sort => 'pay', p_limit => 1) p;
  perform pg_temp.fails(format('select * from marketplace.list_marketplace_jobs_page(p_query => %L, p_after => %L::jsonb)', 'S33', v_cursor),
    '22023', 'does not match the search', '33-Q2: a cursor of another sort is refused');
  perform pg_temp.fails($q$select * from marketplace.list_marketplace_jobs_page(p_after => '{"s":"newest","k":[0,0,0,"x",1],"t":"a","i":"not-a-uuid"}'::jsonb)$q$,
    '22023', 'does not match the search', '33-Q2: a malformed cursor is refused with the same words');
  perform pg_temp.fails($q$select * from marketplace.list_marketplace_jobs_page(p_after => '[1, 2]'::jsonb)$q$, '22023', 'does not match the search', '33-Q2: ... and one that is not an object');
  perform pg_temp.fails($q$select * from marketplace.list_marketplace_jobs_page(p_sort => 'cheapest')$q$, '22023', 'p_sort must be', '33-Q2: an unknown sort is refused');
  perform pg_temp.fails($q$select * from marketplace.list_marketplace_jobs_page(p_equipment_setups => '{"a": 1}'::jsonb)$q$, '22023', 'array of arrays', '33-Q2: setups that are not an array are refused');
  perform pg_temp.ok((select count(*) = 1 from marketplace.list_marketplace_jobs_page(p_query => 'S33', p_limit => 0))
                     and (select count(*) = 7 from marketplace.list_marketplace_jobs_page(p_query => 'S33', p_limit => 100000))
                     and (select count(*) = 7 from marketplace.list_marketplace_jobs_page(p_query => 'S33', p_lat => 999, p_lng => 0, p_radius_miles => 5)),
    '33-Q2: the limit is held between 1 and 200, and a place off the globe is no place');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_cursor ->> 's' = 'pay' and jsonb_array_length(v_cursor -> 'k') = 5 and (v_cursor ->> 'i')::uuid = j_load
                     and (select bool_and(jsonb_typeof(k) = 'string') from jsonb_array_elements(v_cursor -> 'k') k)
                     and (select string_agg(k, ',' order by k) from jsonb_object_keys(v_cursor) k) = 'i,k,s,t',
    '33-Q2: a cursor holds the sort, the order key as text (so no client rounds it), the title and the id of its row, and nothing else');

  -- =========================================================================
  -- Privileges and wiring
  -- =========================================================================
  perform pg_temp.ok(bool_and(has_function_privilege('authenticated', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE')
                              and not has_function_privilege('service_role', f, 'EXECUTE')),
    'privileges: the invitation, team, report and inquiry functions are executable by authenticated only')
  from unnest(array['marketplace.list_invitation_recipients(uuid, integer)', 'marketplace.respond_to_invitation(uuid, text)',
                    'marketplace.remove_team_member(uuid)', 'marketplace.admin_resolve_report(uuid, text, text)',
                    'marketplace.admin_set_org_verification(uuid, text, text)', 'marketplace.admin_read_landing_private(uuid, text)',
                    'marketplace.list_marketplace_interests(uuid, text, uuid, integer, timestamptz, uuid, uuid[], boolean, uuid, text)',
                    'marketplace.count_marketplace_interests(uuid, text)', 'marketplace.get_marketplace_interest(uuid)']::regprocedure[]) f;
  perform pg_temp.ok((select bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE') and has_function_privilege('anon', p.oid, 'EXECUTE')
                                      and not has_function_privilege('service_role', p.oid, 'EXECUTE') and p.prosecdef and p.provolatile = 's')
                      from pg_proc p where p.pronamespace = 'marketplace'::regnamespace and p.proname = 'list_marketplace_jobs_page')
                     and not has_function_privilege('authenticated', 'marketplace.interest_queue(text, text, uuid)', 'EXECUTE')
                     and not has_function_privilege('anon', 'marketplace.interest_queue(text, text, uuid)', 'EXECUTE')
                     and not has_function_privilege('service_role', 'marketplace.interest_queue(text, text, uuid)', 'EXECUTE'),
    'privileges: list_marketplace_jobs_page is a read-only function for anon and authenticated; interest_queue is executable by no API role');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'marketplace.abuse_reports', 'UPDATE')
                     and not has_table_privilege('authenticated', 'marketplace.targeted_invitations', 'UPDATE'),
    'privileges: a signed-in person cannot update a report or an invitation directly, so the functions are the only path');

  -- -------------------------------------------------------------------------
  -- Ledger
  -- -------------------------------------------------------------------------
  perform pg_temp.ok((select string_agg(version, ',' order by applied_at, version) from marketplace.schema_migrations)
                       in ('06,11,12,16,18,23,26,29,31,33', '06,11,12,16,18,23,26,29,31,33,35'),
    'the migration ledger records 06, 11, 12, 16, 18, 23, 26, 29, 31, 33 in order (and 35 after them, when stage 36 runs this suite again)');

  raise notice 'ALL PORT V3 FUNCTION (33-I1, 33-I2, 33-T, 33-A1, 33-A2, 33-Q1, 33-Q2) TESTS PASSED.';
end
$$;

rollback;
