-- =============================================================================
-- LogLoads normalized-v2 — 32 regression suite for 31 (reply gate for private details, day-14 reconfirmation,
-- signed-out unsubscribe, founding-offer reads, the job lifecycle's not-found answer; #294 part A)
--
-- NON-ACTIVE PROTOTYPE TEST SUITE. Disposable PostgreSQL only. Run after
-- 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23 -> 26 -> 29 -> 31; stage 34 runs it again after 33. Wraps
-- everything in BEGIN ... ROLLBACK.
-- Negative tests require the expected SQLSTATE AND a matching message or constraint name.
-- The P1 attack of the security sweep is asserted first, as the attacker and then by its effect. On a database
-- without 31 that attack succeeds and the suite stops there. Each change of 31 is needed by at least one assertion:
-- with any one of its redefined functions or policies put back to its earlier definition, the suite fails.
-- Run as the role that applied 31 (the table owner, which the fixture uses for service steps, for writes that stand
-- in for any SECURITY DEFINER path, and to build forged and expired tokens).
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

-- A count read through row-level security as the presented identity. Returns to the harness role.
create function pg_temp.count_as(p_sub text, p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform pg_temp.as_jwt('authenticated', p_sub);
  execute p_sql into v;
  perform pg_temp.as_jwt('harness');
  return v;
end
$$;

-- How many of a landing's private rows the person reads, with every private column present and as stored.
create function pg_temp.private_rows(p_sub text, p_landing uuid) returns bigint language plpgsql as $$
begin
  return pg_temp.count_as(p_sub, format(
    $q$select count(*) from marketplace.landing_private_details
       where landing_id = %L and site_contact_phone like '+1541555013_' and site_contact_name like 'S31 %%'
         and gate_instructions like '%%gate code%%' and directions like '%%mile%%' and exact_point is not null$q$, p_landing));
end
$$;

-- The SQLSTATE and message a statement fails with ('ok' when it succeeds).
create function pg_temp.answer(p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    return v_state || ' ' || v_msg;
  end;
  return 'ok';
end
$$;

-- Runs the signed-out link as anon. The call itself must never fail.
create function pg_temp.click(p_token text) returns void language plpgsql as $$
begin
  perform pg_temp.as_jwt('anon');
  perform marketplace.unsubscribe_with_token(p_token);
  perform pg_temp.as_jwt('harness');
end
$$;

-- A token over p_payload signed with p_secret (the table owner builds forged and expired tokens with it).
-- PL/pgSQL, so the suite still loads on a database without 31 and fails at its first assertion instead.
create function pg_temp.make_token(p_secret bytea, p_payload text) returns text language plpgsql as $$
begin
  return translate(encode(convert_to(p_payload, 'UTF8'), 'base64'), '+/' || E'=\n', '-_')
         || '.' || encode(marketplace.hmac_sha256(p_secret, convert_to(p_payload, 'UTF8')), 'hex');
end
$$;

create function pg_temp.token_payload(p_token text) returns text language sql as $$
  select convert_from(decode(rpad(translate(split_part(p_token, '.', 1), '-_', '+/'),
                                  (char_length(split_part(p_token, '.', 1)) + 3) / 4 * 4, '='), 'base64'), 'UTF8')
$$;

-- 18 (HF-18) withholds EXECUTE from PUBLIC on functions this role creates; the helpers run after SET ROLE.
grant execute on all functions in schema pg_temp to public;

insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true) on conflict (issuer) do nothing;

do $$
declare
  c_iss constant text := 'https://clerk.logloads.test';
  u_own uuid; u_mgr uuid; u_staff uuid; u_ldrv uuid; u_haul uuid; u_hdrv uuid; u_haul2 uuid; u_rival uuid; u_admin uuid;
  o_land uuid; o_haul uuid; o_haul2 uuid; o_rival uuid;
  l_a uuid; l_b uuid; l_c uuid; l_r uuid;
  j_a uuid; j_b uuid; j_c uuid; j_c2 uuid; j_fresh uuid; j_old uuid; j_rival uuid;
  j_13 uuid; j_14m uuid; j_14 uuid; j_15 uuid; j_never uuid; j_paused uuid;
  e_a uuid; e_a2 uuid; e_b uuid; e_c uuid; e_c2 uuid; e_old uuid; e_new uuid;
  v_inv uuid; v_created boolean; v_n integer; v_text text; v_ts timestamptz;
  v_promo uuid; v_promo_other uuid;
  v_key_id uuid; v_key_secret bytea; -- scalars, so the suite still loads on a database without 31
  t_reply text; t_alert text; t_hdrv text; t_none text; t_spare text; v_payload text; v_parts text[];
  v_audits bigint;
begin
  perform pg_temp.as_jwt('service_role');
  u_own   := marketplace.sync_verified_identity(c_iss, 's31_own',   'S31 Landing Owner',   'own@s31.test',   true);
  u_mgr   := marketplace.sync_verified_identity(c_iss, 's31_mgr',   'S31 Landing Manager', 'mgr@s31.test',   true);
  u_staff := marketplace.sync_verified_identity(c_iss, 's31_staff', 'S31 Desk Staff',      'staff@s31.test', true);
  u_ldrv  := marketplace.sync_verified_identity(c_iss, 's31_ldrv',  'S31 Yard Driver',     'ldrv@s31.test',  true);
  u_haul  := marketplace.sync_verified_identity(c_iss, 's31_haul',  'S31 Hauler Owner',    'haul@s31.test',  true);
  u_hdrv  := marketplace.sync_verified_identity(c_iss, 's31_hdrv',  'S31 Hauler Driver',   'hdrv@s31.test',  true);
  u_haul2 := marketplace.sync_verified_identity(c_iss, 's31_haul2', 'S31 Other Hauler',    'haul2@s31.test', true);
  u_rival := marketplace.sync_verified_identity(c_iss, 's31_rival', 'S31 Rival Landing',   'rival@s31.test', true);
  u_admin := marketplace.sync_verified_identity(c_iss, 's31_admin', 'S31 Platform Admin',  'admin@s31.test', true);
  perform pg_temp.as_jwt('harness');
  insert into marketplace.platform_admins (user_id, admin_role, note) values (u_admin, 'superadmin', 'suite 32');

  -- -------------------------------------------------------------------------
  -- Fixture: a Pro landing business with landings A, B and C, each with a site phone, a contact, an exact point,
  -- directions and gate instructions; an owner, a manager, desk staff and a driver without a seat. A hauling
  -- business (owner and driver) inquires on a job at each landing; a second hauling business inquires at A and C.
  -- A rival landing business has its own landing and job.
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 's31_own');
  o_land := marketplace.create_organization('S31 Landing Co', 's31-landing', 'OR', false);
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_land, 'pro', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_s31', 'sub_s31', false, 7, false);
  perform pg_temp.as_jwt('authenticated', 's31_own');
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_land, 'S31 Landing A', 'active', 'Near Sisters, OR', marketplace.make_public_point(-121.5, 44.3), 'OR') returning id into l_a;
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_land, 'S31 Landing B', 'active', 'Near Bend, OR', marketplace.make_public_point(-121.3, 44.1), 'OR') returning id into l_b;
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_land, 'S31 Landing C', 'active', 'Near La Pine, OR', marketplace.make_public_point(-121.5, 43.7), 'OR') returning id into l_c;
  insert into marketplace.landing_private_details (landing_id, org_id, exact_point, directions, gate_instructions, site_contact_name, site_contact_phone)
  values (l_a, o_land, extensions.st_setsrid(extensions.st_makepoint(-121.5123, 44.3456), 4326)::extensions.geography,
          'A: 3 mile up the 1012 spur', 'A: gate code 3101', 'S31 Foreman A', '+15415550131'),
         (l_b, o_land, extensions.st_setsrid(extensions.st_makepoint(-121.3123, 44.1456), 4326)::extensions.geography,
          'B: 5 mile past the cattle guard', 'B: gate code 3102', 'S31 Foreman B', '+15415550132'),
         (l_c, o_land, extensions.st_setsrid(extensions.st_makepoint(-121.5321, 43.7654), 4326)::extensions.geography,
          'C: 1 mile south of the scale house', 'C: gate code 3103', 'S31 Foreman C', '+15415550133');
  j_a := marketplace.publish_job_posting(l_a, 'S31 Fir Haul A', array['log_truck'], 3, 'Fir sawlogs', 'Suite 32 haul A.', 'per_ton', 525, null,
    3, current_date + 10, 8, 3.0, 9, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  j_b := marketplace.publish_job_posting(l_b, 'S31 Pine Haul B', array['log_truck'], 2, 'Pine sawlogs', 'Suite 32 haul B.', 'per_ton', 480, null,
    2, current_date + 12, 8, 3.0, 6, 30.0, 'Prineville Mill, OR', 35, null, null, array['ppe'], true);
  j_c := marketplace.publish_job_posting(l_c, 'S31 Cedar Haul C', array['log_truck'], 2, 'Cedar', 'Suite 32 haul C.', 'per_ton', 500, null,
    2, current_date + 12, 8, 3.0, 6, 30.0, 'Gilchrist Mill, OR', 20, null, null, array['ppe'], true);
  j_c2 := marketplace.publish_job_posting(l_c, 'S31 Larch Haul C', array['log_truck'], 1, 'Larch', 'Suite 32 haul C two.', 'per_ton', 510, null,
    1, current_date + 12, 8, 3.0, 6, 30.0, 'Gilchrist Mill, OR', 20, null, null, array['ppe'], true);

  v_inv := marketplace.invite_team_member(o_land, 'mgr@s31.test', 'manager', true, interval '7 days');
  perform pg_temp.as_jwt('authenticated', 's31_mgr');
  perform marketplace.accept_team_invitation(v_inv);
  perform pg_temp.as_jwt('authenticated', 's31_own');
  v_inv := marketplace.invite_team_member(o_land, 'staff@s31.test', 'staff', true, interval '7 days');
  perform pg_temp.as_jwt('authenticated', 's31_staff');
  perform marketplace.accept_team_invitation(v_inv);
  perform pg_temp.as_jwt('authenticated', 's31_own');
  v_inv := marketplace.invite_team_member(o_land, 'ldrv@s31.test', 'driver', false, interval '7 days');
  perform pg_temp.as_jwt('authenticated', 's31_ldrv');
  perform marketplace.accept_team_invitation(v_inv);

  perform pg_temp.as_jwt('authenticated', 's31_haul');
  o_haul := marketplace.create_organization('S31 Hauling', 's31-hauling', 'OR', true);
  v_inv := marketplace.invite_team_member(o_haul, 'hdrv@s31.test', 'driver', false, interval '7 days');
  perform pg_temp.as_jwt('authenticated', 's31_hdrv');
  perform marketplace.accept_team_invitation(v_inv);
  perform pg_temp.as_jwt('authenticated', 's31_haul');
  select interest_id into e_a from marketplace.submit_expression_of_interest(o_haul, j_a, 1);
  select interest_id into e_b from marketplace.submit_expression_of_interest(o_haul, j_b, 1);
  select interest_id into e_c from marketplace.submit_expression_of_interest(o_haul, j_c, 1);
  perform pg_temp.as_jwt('authenticated', 's31_haul2');
  o_haul2 := marketplace.create_organization('S31 Other Hauling', 's31-other-hauling', 'OR', true);
  select interest_id into e_a2 from marketplace.submit_expression_of_interest(o_haul2, j_a, 1);
  select interest_id into e_c2 from marketplace.submit_expression_of_interest(o_haul2, j_c2, 1);

  perform pg_temp.as_jwt('authenticated', 's31_rival');
  o_rival := marketplace.create_organization('S31 Rival Landing Co', 's31-rival', 'OR', false);
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_rival, 'pro', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_s31r', 'sub_s31r', false, 7, false);
  perform pg_temp.as_jwt('authenticated', 's31_rival');
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_rival, 'S31 Rival Landing', 'active', 'Near Madras, OR', marketplace.make_public_point(-121.1, 44.6), 'OR') returning id into l_r;
  j_rival := marketplace.publish_job_posting(l_r, 'S31 Rival Haul', array['log_truck'], 1, 'Juniper', 'Suite 32 rival haul.', 'per_ton', 400, null,
    1, current_date + 12, 8, 3.0, 6, 30.0, 'Madras Yard, OR', 12, null, null, array['ppe'], true);

  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.private_rows('s31_own', l_a) = 1 and pg_temp.private_rows('s31_staff', l_b) = 1 and pg_temp.private_rows('s31_mgr', l_c) = 1
                     and pg_temp.private_rows('s31_ldrv', l_a) = 0
                     and pg_temp.private_rows('s31_haul', l_a) + pg_temp.private_rows('s31_haul', l_b) + pg_temp.private_rows('s31_haul', l_c) = 0
                     and pg_temp.private_rows('s31_hdrv', l_a) = 0 and pg_temp.private_rows('s31_haul2', l_a) = 0,
    'fixture: the landing desk reads each landing''s phone, contact, exact point, directions and gate instructions; its driver without a seat and the hauling businesses read none');

  -- =========================================================================
  -- 31-P1: private details and the phone only after the landing replies AND opts in
  -- =========================================================================
  perform pg_temp.as_jwt('authenticated', 's31_staff');
  perform pg_temp.fails(format('select marketplace.respond_to_interest(%L::uuid, %L, true)', e_a, 'viewed'),
    '23514', 'Reply to this inquiry before sharing',
    '31-P1: a desk member cannot mark a new inquiry viewed with sharing on (the sweep''s attack)');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'submitted' and responded_at is null and private_details_shared_at is null and private_details_shared_by is null
                      from marketplace.expressions_of_interest where id = e_a)
                     and not exists (select 1 from marketplace.audit_events where entity_id = e_a and action in ('interest.viewed', 'landing_private.shared')),
    '31-P1: ... the refused call changed nothing: not viewed, not shared, no audit row');
  perform pg_temp.ok(pg_temp.private_rows('s31_haul', l_a) = 0 and pg_temp.private_rows('s31_hdrv', l_a) = 0,
    '31-P1: ... and neither the hauling business''s owner nor its driver reads landing A''s phone or private details');

  perform pg_temp.as_jwt('authenticated', 's31_staff');
  perform marketplace.respond_to_interest(e_a, 'viewed');
  perform pg_temp.fails(format('select marketplace.respond_to_interest(%L::uuid, %L, true)', e_a, 'viewed'),
    '23514', 'Reply to this inquiry before sharing', '31-P1: sharing is refused on a viewed inquiry too, before any reply');
  perform pg_temp.as_jwt('authenticated', 's31_own');
  perform pg_temp.fails(format('select marketplace.respond_to_interest(%L::uuid, %L, true)', e_a, 'viewed'),
    '23514', 'Reply to this inquiry before sharing', '31-P1: ... also for the owner');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'viewed' and private_details_shared_at is null from marketplace.expressions_of_interest where id = e_a)
                     and pg_temp.private_rows('s31_haul', l_a) = 0,
    '31-P1: viewed plus share stays hidden: the inquiry is viewed, nothing is shared, the hauling business reads nothing');

  -- The reader alone: sharing columns set on a viewed inquiry by any other path (the table owner stands in for a
  -- SECURITY DEFINER function, or for a row shared before 31) still show nothing until the landing replies.
  perform pg_temp.as_jwt('harness');
  update marketplace.expressions_of_interest set private_details_shared_at = now(), private_details_shared_by = u_staff where id = e_a;
  perform pg_temp.ok((select status = 'viewed' and private_details_shared_at is not null from marketplace.expressions_of_interest where id = e_a)
                     and pg_temp.private_rows('s31_haul', l_a) = 0 and pg_temp.private_rows('s31_hdrv', l_a) = 0,
    '31-P1 (can_view_landing_private): an inquiry marked shared while only viewed, by any path or before 31, shows the hauling business nothing');
  perform pg_temp.as_jwt('harness');
  update marketplace.expressions_of_interest set private_details_shared_at = null, private_details_shared_by = null where id = e_a;

  perform pg_temp.as_jwt('authenticated', 's31_staff');
  perform marketplace.respond_to_interest(e_a, 'replied', null, gen_random_uuid(), 'We can use one truck from Monday.');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'replied' and responded_at is not null and private_details_shared_at is null from marketplace.expressions_of_interest where id = e_a)
                     and pg_temp.private_rows('s31_haul', l_a) = 0 and pg_temp.private_rows('s31_hdrv', l_a) = 0,
    '31-P1: a reply without share stays hidden');

  perform pg_temp.as_jwt('authenticated', 's31_staff');
  perform marketplace.respond_to_interest(e_a, 'viewed', true);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'replied' and private_details_shared_at is not null and private_details_shared_by = u_staff
                      from marketplace.expressions_of_interest where id = e_a)
                     and pg_temp.private_rows('s31_haul', l_a) = 1 and pg_temp.private_rows('s31_hdrv', l_a) = 1,
    '31-P1: after the reply the desk opts in, and the hauling business reads landing A''s phone and private details');
  perform pg_temp.ok(pg_temp.private_rows('s31_haul', l_b) = 0 and pg_temp.private_rows('s31_haul', l_c) = 0
                     and pg_temp.private_rows('s31_haul2', l_a) = 0,
    '31-P1: ... only landing A''s, and only that hauling business: another with its own inquiry at A reads nothing');
  perform pg_temp.as_jwt('authenticated', 's31_staff');
  perform marketplace.respond_to_interest(e_a, 'viewed', false);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.private_rows('s31_haul', l_a) = 0
                     and (select count(*) = 1 from marketplace.audit_events where entity_id = e_a and action = 'landing_private.shared')
                     and (select count(*) = 1 from marketplace.audit_events where entity_id = e_a and action = 'landing_private.revoked'),
    '31-P1: the desk revokes it again; one shared and one revoked audit row, none for the refused attempts');

  perform pg_temp.as_jwt('authenticated', 's31_mgr');
  perform marketplace.respond_to_interest(e_b, 'replied', true, gen_random_uuid(), 'Come Tuesday; the gate details are shared.');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'replied' and private_details_shared_by = u_mgr from marketplace.expressions_of_interest where id = e_b)
                     and pg_temp.private_rows('s31_haul', l_b) = 1 and pg_temp.private_rows('s31_hdrv', l_b) = 1,
    '31-P1: a reply with share is visible');
  perform pg_temp.as_jwt('authenticated', 's31_haul');
  perform marketplace.post_hauler_interest_reply(e_b, gen_random_uuid(), 'Thanks, see you Tuesday.');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.private_rows('s31_haul', l_b) = 1, '31-P1: ... and stays visible when the hauling business answers');
  perform pg_temp.as_jwt('authenticated', 's31_mgr');
  perform marketplace.respond_to_interest(e_b, 'declined');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.private_rows('s31_haul', l_b) = 0 and pg_temp.private_rows('s31_hdrv', l_b) = 0,
    '31-P1: a later decline hides it again');
  perform pg_temp.ok((select status = 'declined' and private_details_shared_at is null and private_details_shared_by is null
                      from marketplace.expressions_of_interest where id = e_b)
                     and (select count(*) = 1 from marketplace.audit_events where entity_id = e_b and action = 'landing_private.revoked'),
    '31-P1: ... the decline clears the sharing and audits the revocation');
  -- The reader alone again: a declined inquiry that still carries the sharing columns shows nothing.
  update marketplace.expressions_of_interest set private_details_shared_at = now(), private_details_shared_by = u_mgr where id = e_b;
  perform pg_temp.ok(pg_temp.private_rows('s31_haul', l_b) = 0,
    '31-P1 (can_view_landing_private): a declined inquiry that is still marked shared shows nothing');
  perform pg_temp.as_jwt('harness');
  update marketplace.expressions_of_interest set private_details_shared_at = null, private_details_shared_by = null where id = e_b;

  perform pg_temp.as_jwt('authenticated', 's31_own');
  perform pg_temp.fails(format('select marketplace.respond_to_interest(%L::uuid, %L, true)', e_c2, 'declined'),
    '23514', 'Reply to this inquiry before sharing', '31-P1: a decline cannot turn sharing on');
  perform marketplace.respond_to_interest(e_c, 'replied', true, gen_random_uuid(), 'Start Wednesday at C.');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.private_rows('s31_haul', l_c) = 1 and pg_temp.private_rows('s31_haul2', l_c) = 0,
    '31-P1: at landing C the reply with share shows the first hauling business, not the second');
  perform pg_temp.as_jwt('authenticated', 's31_haul');
  perform marketplace.withdraw_interest(e_c);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.private_rows('s31_haul', l_c) = 0, '31-P1: ... and a withdrawal hides it');

  -- =========================================================================
  -- 31-R: the day-14 reconfirmation rule
  -- =========================================================================
  -- Legacy imports carry a stored confirmation time, so they give exact ages: 13 days, a minute short of 14 days,
  -- exactly 14 days (now() is fixed inside this transaction), 15 days, and never confirmed.
  perform pg_temp.as_jwt('authenticated', 's31_admin');
  j_13    := marketplace.admin_import_legacy_job_posting(o_land, l_a, 'S31 Day 13 Haul', array['log_truck'], 'suite 32 day-14 boundary', 'active',
    2, 2, 'Fir', 'Confirmed 13 days ago.', 'per_ton', 500, null, 6, 27.0, 'Bend Mill, OR', 28, now() - interval '30 days', now() - interval '312 hours');
  j_14m   := marketplace.admin_import_legacy_job_posting(o_land, l_a, 'S31 Day 14 Minus Haul', array['log_truck'], 'suite 32 day-14 boundary', 'active',
    2, 2, 'Fir', 'Confirmed a minute short of 14 days ago.', 'per_ton', 500, null, 6, 27.0, 'Bend Mill, OR', 28, now() - interval '30 days', now() - interval '336 hours' + interval '1 minute');
  j_14    := marketplace.admin_import_legacy_job_posting(o_land, l_a, 'S31 Day 14 Haul', array['log_truck'], 'suite 32 day-14 boundary', 'active',
    2, 2, 'Fir', 'Confirmed exactly 14 days ago.', 'per_ton', 500, null, 6, 27.0, 'Bend Mill, OR', 28, now() - interval '30 days', now() - interval '336 hours');
  j_15    := marketplace.admin_import_legacy_job_posting(o_land, l_a, 'S31 Day 15 Haul', array['log_truck'], 'suite 32 day-14 boundary', 'active',
    2, 2, 'Fir', 'Confirmed 15 days ago.', 'per_ton', 500, null, 6, 27.0, 'Bend Mill, OR', 28, now() - interval '30 days', now() - interval '360 hours');
  j_never := marketplace.admin_import_legacy_job_posting(o_land, l_a, 'S31 Never Confirmed Haul', array['log_truck'], 'suite 32 day-14 boundary', 'active',
    2, 2, 'Fir', 'Never confirmed.', 'per_ton', 500, null, 6, 27.0, 'Bend Mill, OR', 28, now() - interval '30 days', null);
  -- A V2 job with an inquiry, confirmed 20 days ago (its confirmation comes from the attestation ledger), a fresh one,
  -- and a paused job that was confirmed long ago.
  perform pg_temp.as_jwt('authenticated', 's31_own');
  j_old := marketplace.publish_job_posting(l_a, 'S31 Stale V2 Haul', array['log_truck'], 2, 'Fir', 'Suite 32 stale V2 job.', 'per_ton', 505, null,
    2, current_date + 12, 8, 3.0, 6, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  j_fresh := marketplace.publish_job_posting(l_a, 'S31 Fresh Haul', array['log_truck'], 2, 'Fir', 'Suite 32 fresh job.', 'per_ton', 506, null,
    2, current_date + 12, 8, 3.0, 6, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  j_paused := marketplace.publish_job_posting(l_a, 'S31 Paused Haul', array['log_truck'], 2, 'Fir', 'Suite 32 paused job.', 'per_ton', 507, null,
    2, current_date + 12, 8, 3.0, 6, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  perform pg_temp.as_jwt('authenticated', 's31_haul');
  select interest_id into e_old from marketplace.submit_expression_of_interest(o_haul, j_old, 1);
  perform pg_temp.as_jwt('harness');
  update marketplace.job_publication_attestations set reconfirmed_at = now() - interval '20 days' where job_id in (j_old, j_paused);
  update marketplace.job_postings set title = title where id in (j_old, j_paused);
  perform pg_temp.as_jwt('authenticated', 's31_own');
  perform marketplace.set_job_posting_status(j_paused, 'paused');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select last_confirmed_at = now() - interval '20 days' and status = 'active' from marketplace.job_postings where id = j_old)
                     and (select last_confirmed_at is null and status = 'active' and is_legacy_import from marketplace.job_postings where id = j_never)
                     and (select last_confirmed_at = now() - interval '336 hours' from marketplace.job_postings where id = j_14),
    'fixture: active jobs confirmed 13 days, 14 days less a minute, exactly 14 days, 15 days and 20 days ago, and a legacy job never confirmed');

  perform pg_temp.as_jwt('anon');
  perform pg_temp.ok((select array_agg(l.title order by l.title) from marketplace.list_marketplace_jobs(p_org_id => o_land) l
                      where l.title like 'S31 Day %' or l.title like 'S31 Never%' or l.title like 'S31 Stale%' or l.title like 'S31 Fresh%')
                     = array['S31 Day 13 Haul', 'S31 Day 14 Minus Haul', 'S31 Fresh Haul'],
    '31-R: Find Work lists a job confirmed 13 days ago and one a minute short of 14 days; at exactly 14 days, at 15 and 20 days, and never confirmed, a job is off the list');
  perform pg_temp.ok((select count(*) = 0 from marketplace.list_marketplace_jobs(p_accepting_only => false, p_org_id => o_land) l
                      where l.job_id in (j_14, j_15, j_never, j_old))
                     and (select count(*) = 3 from marketplace.list_marketplace_jobs(p_accepting_only => false, p_org_id => o_land) l
                          where l.job_id in (j_13, j_14m, j_fresh)),
    '31-R: ... also when the list is not limited to jobs taking interest');
  perform pg_temp.ok((select count(*) = 0 from marketplace.list_marketplace_jobs(p_query => 'S31 Day 15') l)
                     and (select count(*) = 1 from marketplace.list_marketplace_jobs(p_query => 'S31 Day 13') l),
    '31-R: ... and a search by its title does not find it');
  perform pg_temp.ok((select g.status = 'active' and g.accepting_interest is false and g.sponsored is false and g.last_confirmed_at = now() - interval '360 hours'
                      from marketplace.get_marketplace_job(j_15) g)
                     and (select g.status = 'active' and g.accepting_interest is false and g.last_confirmed_at is null from marketplace.get_marketplace_job(j_never) g)
                     and (select g.status = 'active' and g.accepting_interest is false from marketplace.get_marketplace_job(j_14) g)
                     and (select g.status = 'active' and g.accepting_interest is true from marketplace.get_marketplace_job(j_13) g)
                     and (select g.status = 'active' and g.accepting_interest is true from marketplace.get_marketplace_job(j_14m) g),
    '31-R: by id the job is still returned as active, not expired or paused, with accepting_interest false from day 14 and true before');

  perform pg_temp.as_jwt('authenticated', 's31_haul');
  perform pg_temp.ok((select array_agg(s.title order by s.title) from marketplace.search_job_postings(null, 100, null, null, 'S31') s
                      where s.org_id = o_land and (s.title like 'S31 Day %' or s.title like 'S31 Never%' or s.title like 'S31 Stale%' or s.title like 'S31 Fresh%'))
                     = array['S31 Day 13 Haul', 'S31 Day 14 Minus Haul', 'S31 Fresh Haul'],
    '31-R: search_job_postings applies the same rule at the same boundary');
  perform pg_temp.ok((select count(*) = 0 from marketplace.list_marketplace_jobs(p_accepting_only => false, p_org_id => o_land) l where l.job_id in (j_14, j_15, j_never))
                     and (select count(*) = 1 from marketplace.list_marketplace_jobs(p_accepting_only => false, p_job_id => j_old) l where l.accepting_interest is false),
    '31-R: a signed-in hauler does not see them listed either; the stale job it inquired on is still returned by id');
  perform pg_temp.as_jwt('authenticated', 's31_rival');
  perform pg_temp.ok((select count(*) = 0 from marketplace.list_marketplace_jobs(p_accepting_only => false, p_org_id => o_land) l where l.job_id in (j_14, j_15, j_never, j_old)),
    '31-R: ... nor does another landing business');
  perform pg_temp.as_jwt('authenticated', 's31_own');
  perform pg_temp.ok((select count(*) = 4 and bool_and(l.status = 'active' and l.accepting_interest is false)
                      from marketplace.list_marketplace_jobs(p_accepting_only => false, p_org_id => o_land) l where l.job_id in (j_14, j_15, j_never, j_old))
                     and (select count(*) = 0 from marketplace.list_marketplace_jobs(p_org_id => o_land) l where l.job_id in (j_14, j_15, j_never, j_old)),
    '31-R: the poster''s own desk still lists them as active and not taking interest, so it can reconfirm them');
  perform pg_temp.as_jwt('authenticated', 's31_staff');
  perform pg_temp.ok((select count(*) = 4 from marketplace.list_marketplace_jobs(p_accepting_only => false, p_org_id => o_land) l where l.job_id in (j_14, j_15, j_never, j_old)),
    '31-R: ... for its desk staff too');

  perform pg_temp.as_jwt('authenticated', 's31_haul2');
  perform pg_temp.fails(format('select * from marketplace.submit_expression_of_interest(%L::uuid, %L::uuid, 1)', o_haul2, j_15),
    '23514', '^Waiting for the poster to confirm$', '31-R: new interest on a job confirmed 15 days ago is refused with the neutral reason');
  perform pg_temp.fails(format('select * from marketplace.submit_expression_of_interest(%L::uuid, %L::uuid, 1)', o_haul2, j_14),
    '23514', '^Waiting for the poster to confirm$', '31-R: ... at exactly 14 days too');
  perform pg_temp.fails(format('select * from marketplace.submit_expression_of_interest(%L::uuid, %L::uuid, 1)', o_haul2, j_never),
    '23514', '^Waiting for the poster to confirm$', '31-R: ... and on a legacy job that was never confirmed');
  perform pg_temp.fails(format('select * from marketplace.submit_expression_of_interest(%L::uuid, %L::uuid, 1)', o_haul2, j_old),
    '23514', '^Waiting for the poster to confirm$', '31-R: ... and on a V2 job whose last confirmation is 20 days old');
  perform pg_temp.fails(format('select * from marketplace.submit_expression_of_interest(%L::uuid, %L::uuid, 1)', o_haul2, j_paused),
    '23514', 'no longer accepting interest', '31-R: a paused job keeps its own reason, however old its confirmation');
  -- The direct path: 02 lets a signed-in person INSERT an inquiry, under the interests_hauler_insert policy.
  perform pg_temp.fails(format('insert into marketplace.expressions_of_interest (job_id, job_org_id, hauler_org_id, trucks_offered) values (%L, %L, %L, 1)', j_15, o_land, o_haul2),
    '42501', 'row-level security', '31-R: a direct INSERT of an inquiry on a job confirmed 15 days ago is refused too (interests_hauler_insert)');
  perform pg_temp.fails(format('insert into marketplace.expressions_of_interest (job_id, job_org_id, hauler_org_id, trucks_offered) values (%L, %L, %L, 1)', j_never, o_land, o_haul2),
    '42501', 'row-level security', '31-R: ... and on a legacy job that was never confirmed');
  perform pg_temp.fails(format('insert into marketplace.expressions_of_interest (job_id, job_org_id, hauler_org_id, trucks_offered) values (%L, %L, %L, 1)', j_14, o_land, o_haul2),
    '42501', 'row-level security', '31-R: ... and at exactly 14 days');
  insert into marketplace.expressions_of_interest (job_id, job_org_id, hauler_org_id, trucks_offered) values (j_fresh, o_land, o_haul2, 1);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select count(*) = 1 from marketplace.expressions_of_interest where job_id = j_fresh and hauler_org_id = o_haul2 and status = 'submitted' and submitted_by = u_haul2),
    '31-R: ... while a direct INSERT on a freshly confirmed job is still accepted');
  perform pg_temp.as_jwt('authenticated', 's31_haul2');
  select created into v_created from marketplace.submit_expression_of_interest(o_haul2, j_13, 1);
  perform pg_temp.ok(v_created, '31-R: new interest on a job confirmed 13 days ago is accepted');
  select created into v_created from marketplace.submit_expression_of_interest(o_haul2, j_14m, 1);
  perform pg_temp.ok(v_created, '31-R: ... and a minute short of 14 days');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select count(*) = 0 from marketplace.expressions_of_interest where job_id in (j_14, j_15, j_never) or (job_id = j_old and hauler_org_id = o_haul2))
                     and (select bool_and(status = 'active' and expires_at is null) and count(*) = 4 from marketplace.job_postings where id in (j_14, j_15, j_never, j_old))
                     and not exists (select 1 from marketplace.audit_events where entity_id in (j_14, j_15, j_never, j_old) and action = 'job_posting.status_changed'),
    '31-R: ... no inquiry was recorded, and the jobs stay active: not expired, not paused, no status change');

  -- Interest already sent is untouched; sending a withdrawn inquiry again is new interest.
  perform pg_temp.as_jwt('authenticated', 's31_haul');
  select created into v_created from marketplace.submit_expression_of_interest(o_haul, j_old, 2, '[]'::jsonb, null, null, 'Two trucks if you still need them');
  perform pg_temp.as_jwt('authenticated', 's31_own');
  perform marketplace.respond_to_interest(e_old, 'replied', null, gen_random_uuid(), 'Still on; confirming the job today.');
  perform pg_temp.as_jwt('authenticated', 's31_haul');
  perform marketplace.post_hauler_interest_reply(e_old, gen_random_uuid(), 'Good, thanks.');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_created is false
                     and (select trucks_offered = 2 and status = 'replied' from marketplace.expressions_of_interest where id = e_old)
                     and (select count(*) = 2 from marketplace.interest_messages where interest_id = e_old),
    '31-R: an inquiry already sent is untouched: the hauling business edits it, the landing replies and the hauler answers');
  perform pg_temp.as_jwt('authenticated', 's31_haul');
  perform marketplace.withdraw_interest(e_old);
  perform pg_temp.fails(format('select * from marketplace.submit_expression_of_interest(%L::uuid, %L::uuid, 1)', o_haul, j_old),
    '23514', '^Waiting for the poster to confirm$', '31-R: ... it can be withdrawn, but sending it again is new interest and is refused');

  -- Reconfirming restores the job at once.
  perform pg_temp.as_jwt('authenticated', 's31_own');
  v_ts := marketplace.reconfirm_job_posting(j_15);
  v_ts := marketplace.reconfirm_job_posting(j_never);
  perform pg_temp.as_jwt('authenticated', 's31_mgr');
  v_ts := marketplace.reconfirm_job_posting(j_old);
  perform pg_temp.as_jwt('anon');
  perform pg_temp.ok((select count(*) = 3 and bool_and(l.accepting_interest and l.status = 'active')
                      from marketplace.list_marketplace_jobs(p_org_id => o_land) l where l.job_id in (j_15, j_never, j_old))
                     and (select count(*) = 0 from marketplace.list_marketplace_jobs(p_org_id => o_land) l where l.job_id = j_14),
    '31-R: reconfirming restores a job to Find Work at once (15 days, never confirmed, the V2 job); the one not reconfirmed stays off');
  perform pg_temp.as_jwt('authenticated', 's31_haul');
  perform pg_temp.ok((select count(*) = 3 from marketplace.search_job_postings(null, 100, null, null, 'S31') s where s.job_id in (j_15, j_never, j_old)),
    '31-R: ... and to search_job_postings');
  select created into v_created from marketplace.submit_expression_of_interest(o_haul, j_old, 1);
  perform pg_temp.as_jwt('authenticated', 's31_haul2');
  select interest_id into e_new from marketplace.submit_expression_of_interest(o_haul2, j_15, 1);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_created is false and e_new is not null
                     and (select status = 'submitted' and withdrawn_at is null from marketplace.expressions_of_interest where id = e_old)
                     and (select status = 'submitted' from marketplace.expressions_of_interest where id = e_new),
    '31-R: ... and it takes new interest again: a new inquiry, and the withdrawn one sent again');
  perform pg_temp.ok(marketplace.job_confirmation_current(now() - interval '336 hours' + interval '1 microsecond')
                     and not marketplace.job_confirmation_current(now() - interval '336 hours')
                     and not marketplace.job_confirmation_current(null)
                     and marketplace.job_confirmation_current(now()),
    '31-R (job_confirmation_current): current until 14 x 24 hours after the confirmation, not from that instant on, and never for no confirmation');

  -- =========================================================================
  -- 31-O: a job of another business answers exactly as a job that does not exist
  -- =========================================================================
  perform pg_temp.as_jwt('authenticated', 's31_rival');
  perform pg_temp.ok(pg_temp.answer(format('select marketplace.reconfirm_job_posting(%L::uuid)', j_a)) = 'P0002 Job not found'
                     and pg_temp.answer(format('select marketplace.reconfirm_job_posting(%L::uuid)', gen_random_uuid())) = 'P0002 Job not found',
    '31-O: reconfirm_job_posting answers another business''s job and an unknown id alike: Job not found');
  perform pg_temp.ok(pg_temp.answer(format('select marketplace.set_job_posting_status(%L::uuid, %L)', j_a, 'paused')) = 'P0002 Job not found'
                     and pg_temp.answer(format('select marketplace.set_job_posting_status(%L::uuid, %L)', gen_random_uuid(), 'paused')) = 'P0002 Job not found',
    '31-O: set_job_posting_status too');
  perform pg_temp.ok(pg_temp.answer(format('select marketplace.reactivate_job_posting(%L::uuid, true)', j_paused)) = 'P0002 Job not found'
                     and pg_temp.answer(format('select marketplace.reactivate_job_posting(%L::uuid, true)', gen_random_uuid())) = 'P0002 Job not found',
    '31-O: reactivate_job_posting too, for a paused job its public cannot see');
  perform pg_temp.as_jwt('authenticated', 's31_haul');
  perform pg_temp.ok(pg_temp.answer(format('select marketplace.reconfirm_job_posting(%L::uuid)', j_a)) = 'P0002 Job not found'
                     and pg_temp.answer(format('select marketplace.set_job_posting_status(%L::uuid, %L)', j_paused, 'closed')) = 'P0002 Job not found'
                     and pg_temp.answer(format('select marketplace.reactivate_job_posting(%L::uuid, true)', j_paused)) = 'P0002 Job not found',
    '31-O: a hauling business that inquired at the landing gets the same answer');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'active' from marketplace.job_postings where id = j_a)
                     and (select status = 'paused' from marketplace.job_postings where id = j_paused),
    '31-O: ... and nothing changed');
  perform pg_temp.as_jwt('authenticated', 's31_ldrv');
  perform pg_temp.fails(format('select marketplace.reconfirm_job_posting(%L::uuid)', j_a),
    '42501', 'Your role cannot confirm jobs', '31-O: a member of the job''s own business without the role keeps the role refusal (reconfirm)');
  perform pg_temp.fails(format('select marketplace.set_job_posting_status(%L::uuid, %L)', j_a, 'paused'),
    '42501', 'Your role cannot update jobs', '31-O: ... (status)');
  perform pg_temp.fails(format('select marketplace.reactivate_job_posting(%L::uuid, true)', j_paused),
    '42501', 'Your role cannot re-activate jobs', '31-O: ... (re-activate)');
  perform pg_temp.as_jwt('authenticated', 's31_staff');
  perform marketplace.set_job_posting_status(j_a, 'paused');
  v_ts := marketplace.reactivate_job_posting(j_a, true);
  v_ts := marketplace.reconfirm_job_posting(j_a);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'active' and last_confirmed_by = u_staff from marketplace.job_postings where id = j_a),
    '31-O: the desk still pauses, re-activates and reconfirms its own job');

  -- =========================================================================
  -- 31-F: founding offer reads
  -- =========================================================================
  perform pg_temp.as_jwt('harness');
  insert into marketplace.promotions (code, program, state_code, percent_off, billing_cycles, max_redemptions, starts_at, status)
  values ('founding_or_s31', 'founding_landing', 'OR', 50.00, 6, 5, now() - interval '1 day', 'active') returning id into v_promo;
  insert into marketplace.promotions (code, program, state_code, percent_off, billing_cycles, max_redemptions, starts_at, status)
  values ('founding_wa_s31', 'founding_landing', 'WA', 40.00, 3, 5, now() - interval '1 day', 'closed') returning id into v_promo_other;
  perform pg_temp.as_jwt('authenticated', 's31_admin');
  perform marketplace.admin_set_org_verification(o_land, 'verified', 'suite 32 founding offer');
  perform marketplace.admin_grant_founding_promotion('founding_or_s31', o_land, 'Founding OR cohort, suite 32');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.count_as('s31_own', format('select count(*) from marketplace.promotion_redemptions where org_id = %L', o_land)) = 1
                     and pg_temp.count_as('s31_mgr', format('select count(*) from marketplace.promotion_redemptions where org_id = %L', o_land)) = 1
                     and pg_temp.count_as('s31_staff', format('select count(*) from marketplace.promotion_redemptions where org_id = %L', o_land)) = 1
                     and pg_temp.count_as('s31_ldrv', format('select count(*) from marketplace.promotion_redemptions where org_id = %L', o_land)) = 1,
    '31-F: every active member of the business reads its founding-offer redemption: owner, manager, staff and driver');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.count_as('s31_rival', 'select count(*) from marketplace.promotion_redemptions') = 0
                     and pg_temp.count_as('s31_haul', 'select count(*) from marketplace.promotion_redemptions') = 0,
    '31-F: ... and no one outside it does');
  perform pg_temp.as_jwt('authenticated', 's31_mgr');
  perform pg_temp.fails('select granted_by from marketplace.promotion_redemptions', '42501', 'permission denied',
    '31-F: who granted it stays unreadable (16''s column grant)');
  perform pg_temp.as_jwt('harness');
  update marketplace.promotions set status = 'closed' where id = v_promo;
  perform pg_temp.ok(pg_temp.count_as('s31_own', format('select count(*) from marketplace.promotions where id = %L and percent_off = 50 and billing_cycles = 6', v_promo)) = 1
                     and pg_temp.count_as('s31_mgr', format('select count(*) from marketplace.promotions where id = %L', v_promo)) = 1
                     and pg_temp.count_as('s31_ldrv', format('select count(*) from marketplace.promotions where id = %L', v_promo)) = 1,
    '31-F: after the promotion closes, the business that redeemed it still reads its terms');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.count_as('s31_own', format($q$select count(*) from marketplace.promotion_redemptions pr
                                                        left join marketplace.promotions p on p.id = pr.promotion_id and p.program = pr.program
                                                        where pr.org_id = %L and pr.program = 'founding_landing' and p.percent_off = 50$q$, o_land)) = 1,
    '31-F: ... so the billing read model''s join returns the terms, not NULL');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.count_as('s31_rival', format('select count(*) from marketplace.promotions where id = %L', v_promo)) = 0
                     and pg_temp.count_as('s31_haul', format('select count(*) from marketplace.promotions where id = %L', v_promo)) = 0
                     and pg_temp.count_as('s31_own', format('select count(*) from marketplace.promotions where id = %L', v_promo_other)) = 0,
    '31-F: a closed promotion stays hidden from a business that did not redeem it');
  perform pg_temp.as_jwt('anon');
  perform pg_temp.fails('select count(*) from marketplace.promotions', '42501', 'permission denied', '31-F: anon still reads no promotion');

  -- =========================================================================
  -- 31-U: the signed-out unsubscribe link
  -- =========================================================================
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(encode(marketplace.hmac_sha256(decode(repeat('0b', 20), 'hex'), convert_to('Hi There', 'UTF8')), 'hex')
                       = 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'
                     and encode(marketplace.hmac_sha256(convert_to('Jefe', 'UTF8'), convert_to('what do ya want for nothing?', 'UTF8')), 'hex')
                       = '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'
                     and encode(marketplace.hmac_sha256(decode(repeat('aa', 131), 'hex'),
                                                        convert_to('Test Using Larger Than Block-Size Key - Hash Key First', 'UTF8')), 'hex')
                       = '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
    '31-U: hmac_sha256 matches RFC 4231 test cases 1, 2 and 6 (a key longer than the block)');

  perform pg_temp.as_jwt('authenticated', 's31_haul');
  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled)
  values (u_haul, o_haul, 'inquiry_reply', 'email', true), (u_haul, o_haul, 'job_alert', 'email', true), (u_haul, o_haul, 'inquiry_reply', 'in_app', true);
  perform pg_temp.as_jwt('authenticated', 's31_hdrv');
  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled)
  values (u_hdrv, o_haul, 'inquiry_reply', 'email', true);
  perform pg_temp.as_jwt('authenticated', 's31_own');
  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled)
  values (u_own, o_land, 'inquiry_reply', 'email', true);

  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select count(*) = 0 from marketplace.notification_unsubscribe_keys) and (select count(*) = 0 from marketplace.notification_unsubscribe_uses),
    '31-U: 31 stores no key and no token; the first token creates the key');
  perform pg_temp.as_jwt('service_role');
  t_reply := marketplace.issue_unsubscribe_token(u_haul, o_haul, 'inquiry_reply');
  t_alert := marketplace.issue_unsubscribe_token(u_haul, o_haul, 'job_alert', 'email', interval '7 days');
  t_hdrv  := marketplace.issue_unsubscribe_token(u_hdrv, o_haul, 'inquiry_reply', 'email');
  t_none  := marketplace.issue_unsubscribe_token(u_hdrv, o_haul, 'job_alert', 'email');
  t_spare := marketplace.issue_unsubscribe_token(u_haul, o_haul, 'inquiry_reply');
  perform pg_temp.fails(format('select marketplace.issue_unsubscribe_token(%L::uuid, %L::uuid, %L)', u_haul, o_haul, 'Inquiry|reply'),
    '22023', 'category and a channel are required', '31-U: a token names a plain category');
  perform pg_temp.fails(format('select marketplace.issue_unsubscribe_token(%L::uuid, %L::uuid, %L, %L)', u_haul, o_haul, 'inquiry_reply', 'sms'),
    '22023', 'category and a channel are required', '31-U: ... and a known channel');
  perform pg_temp.fails(format('select marketplace.issue_unsubscribe_token(%L::uuid, %L::uuid, %L, %L, interval %L)', u_haul, o_haul, 'inquiry_reply', 'email', '91 days'),
    '22023', 'between 1 minute and 90 days', '31-U: ... and lasts at most 90 days');
  perform pg_temp.fails(format('select marketplace.issue_unsubscribe_token(%L::uuid, %L::uuid, %L)', u_haul, o_land, 'inquiry_reply'),
    'P0002', 'not a member of this business', '31-U: ... for a member of the business only');
  perform pg_temp.as_jwt('harness');
  select id, secret into v_key_id, v_key_secret from marketplace.notification_unsubscribe_keys;
  v_parts := string_to_array(pg_temp.token_payload(t_reply), '|');
  perform pg_temp.ok((select count(*) = 1 from marketplace.notification_unsubscribe_keys) and octet_length(v_key_secret) = 32
                     and t_reply ~ '^[A-Za-z0-9_-]+\.[0-9a-f]{64}$' and char_length(t_reply) between 100 and 512 and t_reply <> t_spare
                     and cardinality(v_parts) = 8 and v_parts[1] = 'v1' and v_parts[2] = v_key_id::text
                     and v_parts[4] = u_haul::text and v_parts[5] = o_haul::text and v_parts[6] = 'inquiry_reply' and v_parts[7] = 'email'
                     and to_timestamp(v_parts[8]::bigint) between now() + interval '29 days 23 hours' and now() + interval '30 days'
                     and t_reply = pg_temp.make_token(v_key_secret, pg_temp.token_payload(t_reply)),
    '31-U: five tokens share one 32-byte key; a token is URL-safe, expires in 30 days by default, and is HMAC-SHA-256 over its payload');

  -- Who may call what.
  perform pg_temp.as_jwt('anon');
  perform pg_temp.fails(format('select marketplace.issue_unsubscribe_token(%L::uuid, %L::uuid, %L)', u_haul, o_haul, 'inquiry_reply'),
    '42501', 'permission denied', '31-U: anon cannot mint a token');
  perform pg_temp.fails('select count(*) from marketplace.notification_unsubscribe_keys', '42501', 'permission denied', '31-U: anon cannot read the signing key');
  perform pg_temp.fails('select count(*) from marketplace.notification_unsubscribe_uses', '42501', 'permission denied', '31-U: ... nor the used tokens');
  perform pg_temp.fails(format('select marketplace.hmac_sha256(%L::bytea, %L::bytea)', '\x00', '\x00'), '42501', 'permission denied', '31-U: ... nor sign anything');
  perform pg_temp.fails(format('update marketplace.notification_preferences set enabled = false where user_id = %L', u_haul),
    '42501', 'permission denied', '31-U: ... nor touch a preference directly');
  perform pg_temp.as_jwt('authenticated', 's31_haul2');
  perform pg_temp.fails(format('select marketplace.issue_unsubscribe_token(%L::uuid, %L::uuid, %L)', u_haul, o_haul, 'inquiry_reply'),
    '42501', 'permission denied', '31-U: a signed-in person cannot mint a token');
  perform pg_temp.fails(format('select marketplace.unsubscribe_with_token(%L)', t_spare), '42501', 'permission denied',
    '31-U: the link is anon''s only: a signed-in person changes preferences through their own rows');
  perform pg_temp.fails('select count(*) from marketplace.notification_unsubscribe_keys', '42501', 'permission denied', '31-U: ... and cannot read the signing key');
  perform pg_temp.as_jwt('service_role');
  perform pg_temp.fails(format('select marketplace.unsubscribe_with_token(%L)', t_spare), '42501', 'permission denied', '31-U: the service role cannot use a link');
  perform pg_temp.fails('select count(*) from marketplace.notification_unsubscribe_keys', '42501', 'permission denied', '31-U: ... or read the key it signs with');

  -- Tamper: nothing below is a valid token, the call never fails, and nothing changes.
  perform pg_temp.as_jwt('harness');
  select count(*) into v_audits from marketplace.audit_events;
  v_payload := pg_temp.token_payload(t_reply);
  perform pg_temp.click(null);
  perform pg_temp.click('');
  perform pg_temp.click('not-a-token');
  perform pg_temp.click(repeat('A', 5000));
  perform pg_temp.click(split_part(t_reply, '.', 1));
  perform pg_temp.click(split_part(t_reply, '.', 1) || '.' || repeat('0', 64));
  perform pg_temp.click(repeat('!', 60) || '.' || split_part(t_reply, '.', 2));
  perform pg_temp.click(repeat('A', 61) || '.' || split_part(t_reply, '.', 2));
  perform pg_temp.click(t_reply || '0');
  perform pg_temp.click(upper(t_reply));
  -- One signature character changed.
  perform pg_temp.click(left(t_reply, char_length(t_reply) - 1) || case when right(t_reply, 1) = '0' then '1' else '0' end);
  -- The payload rewritten under the original signature: another person, another category, a later expiry.
  perform pg_temp.click(split_part(pg_temp.make_token('\x00', replace(v_payload, u_haul::text, u_hdrv::text)), '.', 1) || '.' || split_part(t_reply, '.', 2));
  perform pg_temp.click(split_part(pg_temp.make_token('\x00', replace(v_payload, 'inquiry_reply', 'job_alert')), '.', 1) || '.' || split_part(t_reply, '.', 2));
  perform pg_temp.click(split_part(pg_temp.make_token('\x00', replace(v_payload, v_parts[8], (v_parts[8]::bigint + 86400)::text)), '.', 1) || '.' || split_part(t_reply, '.', 2));
  -- Signed with a key the attacker made up, under the real key id and under an unknown one.
  perform pg_temp.click(pg_temp.make_token(decode(repeat('ab', 32), 'hex'), v_payload));
  perform pg_temp.click(pg_temp.make_token(v_key_secret, replace(v_payload, v_key_id::text, gen_random_uuid()::text)));
  -- Signed with the real key, but not a v1 payload of eight fields.
  perform pg_temp.click(pg_temp.make_token(v_key_secret, replace(v_payload, 'v1|', 'v2|')));
  perform pg_temp.click(pg_temp.make_token(v_key_secret, v_payload || '|extra-field-to-pad-the-payload'));
  perform pg_temp.ok((select count(*) = 5 from marketplace.notification_preferences where enabled)
                     and (select count(*) = 0 from marketplace.notification_unsubscribe_uses)
                     and (select count(*) from marketplace.audit_events) = v_audits,
    '31-U (tamper): malformed, truncated, re-signed, rewritten and wrong-key tokens all return quietly and change nothing');

  -- Expiry: a token signed with the real key whose expiry has passed.
  perform pg_temp.click(pg_temp.make_token(v_key_secret, replace(v_payload, v_parts[8], (floor(extract(epoch from now()))::bigint - 3600)::text)));
  perform pg_temp.click(pg_temp.make_token(v_key_secret, replace(v_payload, v_parts[8], floor(extract(epoch from now()))::bigint::text)));
  perform pg_temp.ok((select count(*) = 5 from marketplace.notification_preferences where enabled)
                     and (select count(*) = 0 from marketplace.notification_unsubscribe_uses),
    '31-U (expiry): a correctly signed token an hour past its expiry, or in its last second, returns quietly and changes nothing');

  -- The link works: one person, one business, one category, one channel.
  perform pg_temp.click(t_reply);
  perform pg_temp.ok((select not enabled from marketplace.notification_preferences where user_id = u_haul and org_id = o_haul and category = 'inquiry_reply' and channel = 'email')
                     and (select count(*) = 4 from marketplace.notification_preferences where enabled)
                     and (select enabled from marketplace.notification_preferences where user_id = u_haul and category = 'job_alert' and channel = 'email')
                     and (select enabled from marketplace.notification_preferences where user_id = u_haul and category = 'inquiry_reply' and channel = 'in_app')
                     and (select enabled from marketplace.notification_preferences where user_id = u_hdrv and category = 'inquiry_reply' and channel = 'email')
                     and (select enabled from marketplace.notification_preferences where user_id = u_own),
    '31-U: a valid link turns off exactly the one preference it names; the person''s other category and channel, their colleague and another business keep theirs (cross-user)');
  perform pg_temp.ok((select count(*) = 1 from marketplace.notification_unsubscribe_uses where token_id = v_parts[3]::uuid)
                     and (select count(*) = 1 from marketplace.audit_events
                          where action = 'notification.unsubscribed' and entity_id = u_haul and org_id = o_haul and actor_user_id is null
                            and metadata ->> 'category' = 'inquiry_reply' and metadata ->> 'channel' = 'email'),
    '31-U: ... the token is recorded as used and the change is audited, with no signed-in actor');

  -- Replay: the person turns the email back on; the same link, and a copy of it, do nothing more.
  perform pg_temp.as_jwt('authenticated', 's31_haul');
  update marketplace.notification_preferences set enabled = true where user_id = u_haul and org_id = o_haul and category = 'inquiry_reply' and channel = 'email';
  perform pg_temp.as_jwt('harness');
  perform pg_temp.click(t_reply);
  perform pg_temp.click(pg_temp.make_token(v_key_secret, v_payload));
  perform pg_temp.ok((select enabled from marketplace.notification_preferences where user_id = u_haul and org_id = o_haul and category = 'inquiry_reply' and channel = 'email')
                     and (select count(*) = 1 from marketplace.notification_unsubscribe_uses)
                     and (select count(*) = 1 from marketplace.audit_events where action = 'notification.unsubscribed'),
    '31-U (replay): a used link does not turn off a preference the person turned back on');
  -- A second, unused link for the same preference still works once.
  perform pg_temp.click(t_spare);
  perform pg_temp.click(t_spare);
  perform pg_temp.ok((select not enabled from marketplace.notification_preferences where user_id = u_haul and org_id = o_haul and category = 'inquiry_reply' and channel = 'email')
                     and (select count(*) = 2 from marketplace.notification_unsubscribe_uses)
                     and (select count(*) = 2 from marketplace.audit_events where action = 'notification.unsubscribed'),
    '31-U: each link works once');

  -- A link for a preference that does not exist, and one for a person who has since left: quiet, and nothing else moves.
  perform pg_temp.click(t_none);
  perform pg_temp.click(t_alert);
  perform pg_temp.click(t_hdrv);
  perform pg_temp.ok((select count(*) = 0 from marketplace.notification_preferences where user_id = u_hdrv and category = 'job_alert')
                     and (select not enabled from marketplace.notification_preferences where user_id = u_haul and category = 'job_alert' and channel = 'email')
                     and (select not enabled from marketplace.notification_preferences where user_id = u_hdrv and category = 'inquiry_reply' and channel = 'email')
                     and (select enabled from marketplace.notification_preferences where user_id = u_haul and category = 'inquiry_reply' and channel = 'in_app')
                     and (select enabled from marketplace.notification_preferences where user_id = u_own)
                     and (select count(*) = 4 from marketplace.audit_events where action = 'notification.unsubscribed'),
    '31-U: a link for a preference that was never set changes and audits nothing; the other links each turn off their own preference only');

  -- =========================================================================
  -- Privileges and wiring
  -- =========================================================================
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(has_function_privilege('anon', 'marketplace.unsubscribe_with_token(text)', 'EXECUTE')
                     and not has_function_privilege('authenticated', 'marketplace.unsubscribe_with_token(text)', 'EXECUTE')
                     and not has_function_privilege('service_role', 'marketplace.unsubscribe_with_token(text)', 'EXECUTE')
                     and has_function_privilege('service_role', 'marketplace.issue_unsubscribe_token(uuid, uuid, text, text, interval)', 'EXECUTE')
                     and not has_function_privilege('authenticated', 'marketplace.issue_unsubscribe_token(uuid, uuid, text, text, interval)', 'EXECUTE')
                     and not has_function_privilege('anon', 'marketplace.issue_unsubscribe_token(uuid, uuid, text, text, interval)', 'EXECUTE'),
    'privileges: unsubscribe_with_token is executable by anon only, issue_unsubscribe_token by service_role only');
  perform pg_temp.ok(bool_and(not has_function_privilege(r, f, 'EXECUTE')),
    'privileges: hmac_sha256 and job_confirmation_current are executable by no API role')
  from unnest(array['marketplace.hmac_sha256(bytea, bytea)', 'marketplace.job_confirmation_current(timestamptz)']::regprocedure[]) f,
       unnest(array['anon', 'authenticated', 'service_role']) r;
  perform pg_temp.ok((select count(*) = 1 from pg_proc p
                      where p.pronamespace = 'marketplace'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE') and p.provolatile = 'v'),
    'privileges: unsubscribe_with_token is the only volatile marketplace function anon can execute');
  perform pg_temp.ok(bool_and(has_function_privilege('authenticated', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE')
                              and not has_function_privilege('service_role', f, 'EXECUTE')),
    'privileges: respond_to_interest, submit_expression_of_interest and the three lifecycle functions stay executable by authenticated only')
  from unnest(array['marketplace.respond_to_interest(uuid, text, boolean, uuid, text)',
                    'marketplace.submit_expression_of_interest(uuid, uuid, integer, jsonb, date, date, text, text)',
                    'marketplace.reconfirm_job_posting(uuid)', 'marketplace.set_job_posting_status(uuid, text)',
                    'marketplace.reactivate_job_posting(uuid, boolean)']::regprocedure[]) f;
  perform pg_temp.ok(bool_and(has_function_privilege('authenticated', f, 'EXECUTE') and has_function_privilege('anon', f, 'EXECUTE')
                              and not has_function_privilege('service_role', f, 'EXECUTE')),
    'privileges: list_marketplace_jobs and search_job_postings stay executable by anon and authenticated')
  from unnest(array['marketplace.list_marketplace_jobs(text, text, text, boolean, uuid, extensions.geography, integer, integer, integer, uuid)',
                    'marketplace.search_job_postings(extensions.geography, integer, text[], text, text, integer, integer)']::regprocedure[]) f;
  perform pg_temp.ok((select bool_and(c.relrowsecurity) and count(*) = 2 from pg_class c
                      where c.oid in ('marketplace.notification_unsubscribe_keys'::regclass, 'marketplace.notification_unsubscribe_uses'::regclass))
                     and not exists (select 1 from pg_policies where schemaname = 'marketplace' and tablename like 'notification_unsubscribe_%')
                     and not exists (select 1 from information_schema.role_table_grants
                                     where table_schema = 'marketplace' and table_name like 'notification_unsubscribe_%'
                                       and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')),
    'privileges: the key and used-token tables have row-level security, no policy and no grant to any API role');
  perform pg_temp.ok(not has_column_privilege('authenticated', 'marketplace.expressions_of_interest', 'private_details_shared_at', 'UPDATE')
                     and not has_column_privilege('authenticated', 'marketplace.expressions_of_interest', 'private_details_shared_by', 'UPDATE')
                     and not has_column_privilege('authenticated', 'marketplace.expressions_of_interest', 'status', 'UPDATE')
                     and not has_column_privilege('authenticated', 'marketplace.expressions_of_interest', 'status', 'INSERT')
                     and not has_column_privilege('authenticated', 'marketplace.expressions_of_interest', 'private_details_shared_at', 'INSERT'),
    'privileges: a signed-in person cannot write an inquiry''s status or sharing columns directly, on insert or update, so respond_to_interest is the only path to sharing');
  perform pg_temp.ok((select with_check like '%job_takes_new_interest(job_id)%' and with_check like '%job_is_publicly_visible(job_id)%'
                      from pg_policies where schemaname = 'marketplace' and tablename = 'expressions_of_interest' and policyname = 'interests_hauler_insert')
                     and has_function_privilege('authenticated', 'marketplace.job_takes_new_interest(uuid)', 'EXECUTE')
                     and not has_function_privilege('anon', 'marketplace.job_takes_new_interest(uuid)', 'EXECUTE')
                     and not has_function_privilege('service_role', 'marketplace.job_takes_new_interest(uuid)', 'EXECUTE'),
    'privileges: a direct INSERT of an inquiry passes through interests_hauler_insert, which asks job_takes_new_interest (authenticated only)');

  -- -------------------------------------------------------------------------
  -- Ledger
  -- -------------------------------------------------------------------------
  perform pg_temp.ok((select string_agg(version, ',' order by applied_at, version) from marketplace.schema_migrations)
                       in ('06,11,12,16,18,23,26,29,31', '06,11,12,16,18,23,26,29,31,33'),
    'the migration ledger records 06, 11, 12, 16, 18, 23, 26, 29, 31 in order (and 33 after them, when stage 34 runs this suite again)');

  raise notice 'ALL REPLY GATE, RECONFIRMATION, UNSUBSCRIBE, FOUNDING OFFER AND NOT-FOUND (31-P1, 31-R, 31-U, 31-F, 31-O) TESTS PASSED.';
end
$$;

rollback;
