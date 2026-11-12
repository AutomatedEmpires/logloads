-- =============================================================================
-- LogLoads normalized-v2 — 36 regression suite for 35 (the day-14 rule on direct job reads, unsubscribe token pruning
-- and signing-key rotation; #361)
--
-- NON-ACTIVE PROTOTYPE TEST SUITE. Disposable PostgreSQL only. Run after
-- 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23 -> 26 -> 29 -> 31 -> 33 -> 35. Wraps everything in BEGIN ... ROLLBACK.
-- Negative tests require the expected SQLSTATE AND a matching message or constraint name.
-- The leak 35 closes is asserted first: on a database without 35, anon reads a job past day 14 directly and the suite
-- stops there. Each change of 35 is needed by at least one assertion.
-- The two-session races (one token used twice at once, two answers to one invitation, a rotation while a token is
-- being minted) are in 37_v2_day14_unsubscribe_concurrency_test.sh; this suite proves, in one session, that a
-- prune never makes a used token work again.
-- Run as the role that applied 35 (the table owner, which the fixture uses for service steps, to age jobs through the
-- attestation ledger, and to build tokens and age keys).
-- Takes about four seconds longer than the earlier suites: it waits on the clock for a token to expire.
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

-- A reader: anon for a null subject, otherwise the signed-in person.
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

-- A count read as the reader (anon for a null subject), through row-level security. Returns to the harness role.
create function pg_temp.count_as(p_sub text, p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform pg_temp.as_reader(p_sub);
  execute p_sql into v;
  perform pg_temp.as_jwt('harness');
  return v;
end
$$;

-- The four ways a reader meets a job: a direct read of the row (PostgREST's path), Find Work's list and its pages
-- (list_marketplace_jobs, list_marketplace_jobs_page, not limited to jobs taking interest, as the poster's desk lists
-- them), and the public search.
create function pg_temp.sees(p_sub text, p_job uuid) returns boolean language sql as $$
  select pg_temp.count_as(p_sub, format('select count(*) from marketplace.job_postings where id = %L', p_job)) = 1
$$;
create function pg_temp.lists(p_sub text, p_job uuid, p_org uuid) returns boolean language sql as $$
  select pg_temp.count_as(p_sub, format(
    'select count(*) from marketplace.list_marketplace_jobs(p_accepting_only => false, p_org_id => %L, p_limit => 200) l where l.job_id = %L',
    p_org, p_job)) = 1
$$;
create function pg_temp.pages(p_sub text, p_job uuid, p_org uuid) returns boolean language sql as $$
  select pg_temp.count_as(p_sub, format(
    'select count(*) from marketplace.list_marketplace_jobs_page(p_accepting_only => false, p_org_id => %L, p_limit => 200) l where l.job_id = %L',
    p_org, p_job)) = 1
$$;
create function pg_temp.searches(p_sub text, p_job uuid) returns boolean language sql as $$
  select pg_temp.count_as(p_sub, format(
    'select count(*) from marketplace.search_job_postings(null, 100, null, null, null, 2, 100) s where s.job_id = %L', p_job)) = 1
$$;
create function pg_temp.equipment_of(p_sub text, p_job uuid) returns bigint language sql as $$
  select pg_temp.count_as(p_sub, format('select count(*) from marketplace.job_posting_equipment where job_id = %L', p_job))
$$;

-- The SQLSTATE and message a statement fails with, as the reader ('ok' when it succeeds).
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

-- Runs the signed-out link as anon. The call itself must never fail.
create function pg_temp.click(p_token text) returns void language plpgsql as $$
begin
  perform pg_temp.as_jwt('anon');
  perform marketplace.unsubscribe_with_token(p_token);
  perform pg_temp.as_jwt('harness');
end
$$;

-- A token over p_payload signed with p_secret (the table owner builds tokens with a chosen expiry with it).
create function pg_temp.make_token(p_secret bytea, p_payload text) returns text language plpgsql as $$
begin
  return translate(encode(convert_to(p_payload, 'UTF8'), 'base64'), '+/' || E'=\n', '-_')
         || '.' || encode(marketplace.hmac_sha256(p_secret, convert_to(p_payload, 'UTF8')), 'hex');
end
$$;

create function pg_temp.token_key(p_token text) returns uuid language sql as $$
  select split_part(convert_from(decode(rpad(translate(split_part(p_token, '.', 1), '-_', '+/'),
                                             (char_length(split_part(p_token, '.', 1)) + 3) / 4 * 4, '='), 'base64'), 'UTF8'), '|', 2)::uuid
$$;

-- Whether one of the hauler owner's preferences is on.
create function pg_temp.pref_on(p_user uuid, p_org uuid, p_category text, p_channel text) returns boolean language sql as $$
  select enabled from marketplace.notification_preferences
  where user_id = p_user and org_id = p_org and category = p_category and channel = p_channel
$$;

-- 18 (HF-18) withholds EXECUTE from PUBLIC on functions this role creates; the helpers run after SET ROLE.
grant execute on all functions in schema pg_temp to public;

insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true) on conflict (issuer) do nothing;

do $$
declare
  c_iss constant text := 'https://clerk.logloads.test';
  u_own uuid; u_mgr uuid; u_staff uuid; u_ldrv uuid; u_haul uuid; u_hdrv uuid; u_haul2 uuid; u_rival uuid; u_admin uuid; u_none uuid;
  o_land uuid; o_haul uuid; o_haul2 uuid; o_rival uuid;
  l_a uuid; l_b uuid; l_r uuid;
  j_fresh uuid; j_14m uuid; j_14 uuid; j_20 uuid; j_never uuid; j_paused uuid; j_b20 uuid; j_rival uuid; j_draft uuid;
  e_20 uuid; e_paused uuid; v_inv uuid; v_tinv uuid; v_ts timestamptz; v_n bigint; v_text text;
  r record; v_jobs uuid[]; v_subs text[]; v_bad text; v_sub text; v_job uuid;
  -- unsubscribe
  k1 uuid; k2 uuid; k3 uuid; k4 uuid; v_secret bytea; v_retired timestamptz; v_epoch bigint; v_tok uuid;
  t_a text; t_b text; t_c text; t_d text; t_race text; v_uses integer; v_keys integer; v_audits bigint;
begin
  perform pg_temp.as_jwt('service_role');
  u_own   := marketplace.sync_verified_identity(c_iss, 's35_own',   'S35 Landing Owner',   'own@s35.test',   true);
  u_mgr   := marketplace.sync_verified_identity(c_iss, 's35_mgr',   'S35 Landing Manager', 'mgr@s35.test',   true);
  u_staff := marketplace.sync_verified_identity(c_iss, 's35_staff', 'S35 Staff at A',      'staff@s35.test', true);
  u_ldrv  := marketplace.sync_verified_identity(c_iss, 's35_ldrv',  'S35 Yard Driver',     'ldrv@s35.test',  true);
  u_haul  := marketplace.sync_verified_identity(c_iss, 's35_haul',  'S35 Hauler Owner',    'haul@s35.test',  true);
  u_hdrv  := marketplace.sync_verified_identity(c_iss, 's35_hdrv',  'S35 Hauler Driver',   'hdrv@s35.test',  true);
  u_haul2 := marketplace.sync_verified_identity(c_iss, 's35_haul2', 'S35 Invited Hauler',  'haul2@s35.test', true);
  u_rival := marketplace.sync_verified_identity(c_iss, 's35_rival', 'S35 Rival Landing',   'rival@s35.test', true);
  u_admin := marketplace.sync_verified_identity(c_iss, 's35_admin', 'S35 Platform Admin',  'admin@s35.test', true);
  u_none  := marketplace.sync_verified_identity(c_iss, 's35_none',  'S35 Signed In',       'none@s35.test',  true);
  perform pg_temp.as_jwt('harness');
  insert into marketplace.platform_admins (user_id, admin_role, note) values (u_admin, 'superadmin', 'suite 36');

  -- -------------------------------------------------------------------------
  -- Fixture: a Pro landing business with landings A and B; an owner, a manager, staff limited to landing A and a
  -- driver without a seat. A hauling business (owner and driver) inquires on two jobs; a second hauling business can
  -- be invited and gets an invitation; a rival landing business; a signed-in person in no business; a platform admin.
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 's35_own');
  o_land := marketplace.create_organization('S35 Landing Co', 's35-landing', 'OR', false);
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_land, 'pro', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_s35', 'sub_s35', false, 7, false);
  perform pg_temp.as_jwt('authenticated', 's35_own');
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_land, 'S35 Landing A', 'active', 'Near Sisters, OR', marketplace.make_public_point(-121.5, 44.3), 'OR') returning id into l_a;
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_land, 'S35 Landing B', 'active', 'Near Bend, OR', marketplace.make_public_point(-121.3, 44.1), 'OR') returning id into l_b;
  j_fresh := marketplace.publish_job_posting(l_a, 'S35 Fresh Haul', array['log_truck'], 2, 'Fir', 'Suite 36 fresh job.', 'per_ton', 501, null,
    2, current_date + 10, 8, 3.0, 6, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  j_14m := marketplace.publish_job_posting(l_a, 'S35 Day 14 Minus Haul', array['log_truck'], 2, 'Fir', 'Suite 36 boundary job.', 'per_ton', 502, null,
    2, current_date + 10, 8, 3.0, 6, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  j_14 := marketplace.publish_job_posting(l_a, 'S35 Day 14 Haul', array['log_truck'], 2, 'Fir', 'Suite 36 boundary job.', 'per_ton', 503, null,
    2, current_date + 10, 8, 3.0, 6, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  j_20 := marketplace.publish_job_posting(l_a, 'S35 Stale Haul', array['log_truck'], 2, 'Fir', 'Suite 36 stale job.', 'per_ton', 504, null,
    2, current_date + 10, 8, 3.0, 6, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  j_paused := marketplace.publish_job_posting(l_a, 'S35 Paused Haul', array['log_truck'], 2, 'Fir', 'Suite 36 paused job.', 'per_ton', 505, null,
    2, current_date + 10, 8, 3.0, 6, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  j_b20 := marketplace.publish_job_posting(l_b, 'S35 Stale Haul B', array['log_truck'], 2, 'Pine', 'Suite 36 stale job at B.', 'per_ton', 506, null,
    2, current_date + 10, 8, 3.0, 6, 30.0, 'Prineville Mill, OR', 35, null, null, array['ppe'], true);

  v_inv := marketplace.invite_team_member(o_land, 'mgr@s35.test', 'manager', true, interval '7 days');
  perform pg_temp.as_jwt('authenticated', 's35_mgr');
  perform marketplace.accept_team_invitation(v_inv);
  perform pg_temp.as_jwt('authenticated', 's35_own');
  v_inv := marketplace.invite_team_member(o_land, 'staff@s35.test', 'staff', true, interval '7 days', array[l_a]);
  perform pg_temp.as_jwt('authenticated', 's35_staff');
  perform marketplace.accept_team_invitation(v_inv);
  perform pg_temp.as_jwt('authenticated', 's35_own');
  v_inv := marketplace.invite_team_member(o_land, 'ldrv@s35.test', 'driver', false, interval '7 days');
  perform pg_temp.as_jwt('authenticated', 's35_ldrv');
  perform marketplace.accept_team_invitation(v_inv);

  perform pg_temp.as_jwt('authenticated', 's35_haul');
  o_haul := marketplace.create_organization('S35 Hauling', 's35-hauling', 'OR', true);
  v_inv := marketplace.invite_team_member(o_haul, 'hdrv@s35.test', 'driver', false, interval '7 days');
  perform pg_temp.as_jwt('authenticated', 's35_hdrv');
  perform marketplace.accept_team_invitation(v_inv);
  perform pg_temp.as_jwt('authenticated', 's35_haul');
  select interest_id into e_20 from marketplace.submit_expression_of_interest(o_haul, j_20, 1);
  select interest_id into e_paused from marketplace.submit_expression_of_interest(o_haul, j_paused, 1);

  perform pg_temp.as_jwt('authenticated', 's35_haul2');
  o_haul2 := marketplace.create_organization('S35 Invited Hauling', 's35-invited-hauling', 'OR', true);
  update marketplace.hauler_profiles
  set headline = 'S35 log fleet', base_area_label = 'Sisters, OR', is_public = true,
      service_center = extensions.st_geogfromtext('SRID=4326;POINT(-121.5 44.3)'), service_radius_miles = 120,
      operating_states = array['OR'], accepts_targeted_invitations = true, max_invitations_per_week = 5
  where org_id = o_haul2;
  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled)
  values (u_haul2, o_haul2, 'targeted_invitation', 'in_app', true);
  insert into marketplace.equipment_units (org_id, equipment_code, unit_label, unit_count) values (o_haul2, 'log_truck', 'S35 Trucks', 2);
  insert into marketplace.availability_reports (org_id, equipment_code, available_count, area_center, area_label, radius_miles, available_from, available_until)
  values (o_haul2, 'log_truck', 2, extensions.st_geogfromtext('SRID=4326;POINT(-121.5 44.3)'), 'Sisters', 100, current_date, current_date + 14);
  perform pg_temp.as_jwt('authenticated', 's35_own');
  v_tinv := marketplace.reserve_targeted_invitation(j_20, o_haul2, 'Two trucks from Monday');

  perform pg_temp.as_jwt('authenticated', 's35_rival');
  o_rival := marketplace.create_organization('S35 Rival Landing Co', 's35-rival', 'OR', false);
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_rival, 'pro', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_s35r', 'sub_s35r', false, 7, false);
  perform pg_temp.as_jwt('authenticated', 's35_rival');
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_rival, 'S35 Rival Landing', 'active', 'Near Madras, OR', marketplace.make_public_point(-121.1, 44.6), 'OR') returning id into l_r;
  j_rival := marketplace.publish_job_posting(l_r, 'S35 Rival Haul', array['log_truck'], 1, 'Juniper', 'Suite 36 rival job.', 'per_ton', 400, null,
    1, current_date + 12, 8, 3.0, 6, 30.0, 'Madras Yard, OR', 12, null, null, array['ppe'], true);

  -- A legacy job that was never confirmed (only the import path stores no confirmation).
  perform pg_temp.as_jwt('authenticated', 's35_admin');
  j_never := marketplace.admin_import_legacy_job_posting(o_land, l_a, 'S35 Never Confirmed Haul', array['log_truck'], 'suite 36 day-14 rule', 'active',
    2, 2, 'Fir', 'Never confirmed.', 'per_ton', 500, null, 6, 27.0, 'Bend Mill, OR', 28, now() - interval '30 days', null);

  -- Ages, through the attestation ledger the job guard reads last_confirmed_at from: exactly 14 x 24 hours ago,
  -- one microsecond later than that, and 20 days ago. Then the paused job is paused.
  perform pg_temp.as_jwt('harness');
  update marketplace.job_publication_attestations set reconfirmed_at = now() - interval '336 hours' where job_id = j_14;
  update marketplace.job_publication_attestations set reconfirmed_at = now() - interval '336 hours' + interval '1 microsecond' where job_id = j_14m;
  update marketplace.job_publication_attestations set reconfirmed_at = now() - interval '20 days' where job_id in (j_20, j_paused, j_b20);
  update marketplace.job_postings set title = title where id in (j_14, j_14m, j_20, j_paused, j_b20);
  perform pg_temp.as_jwt('authenticated', 's35_own');
  perform marketplace.set_job_posting_status(j_paused, 'paused');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select last_confirmed_at = now() - interval '336 hours' and status = 'active' from marketplace.job_postings where id = j_14)
                     and (select last_confirmed_at = now() - interval '336 hours' + interval '1 microsecond' from marketplace.job_postings where id = j_14m)
                     and (select bool_and(last_confirmed_at = now() - interval '20 days') and count(*) = 3 from marketplace.job_postings where id in (j_20, j_paused, j_b20))
                     and (select status = 'paused' from marketplace.job_postings where id = j_paused)
                     and (select last_confirmed_at is null and status = 'active' and is_legacy_import from marketplace.job_postings where id = j_never)
                     and (select count(*) = 1 from marketplace.targeted_invitations where id = v_tinv and recipient_org_id = o_haul2 and job_id = j_20),
    'fixture: active jobs confirmed now, 14 days less a microsecond ago, exactly 14 days ago and 20 days ago (one at landing B), a paused job confirmed 20 days ago, a legacy job never confirmed; an inquiry and an invitation on the 20-day job');

  -- =========================================================================
  -- 35-R: direct reads follow the day-14 rule
  -- =========================================================================
  perform pg_temp.ok(not pg_temp.sees(null, j_20),
    '35-R: anon no longer reads an active job confirmed 20 days ago directly (the leak #350 left open)');
  perform pg_temp.ok(not pg_temp.sees(null, j_never) and not pg_temp.sees(null, j_14) and pg_temp.sees(null, j_14m) and pg_temp.sees(null, j_fresh),
    '35-R: ... nor one never confirmed, nor one confirmed exactly 14 x 24 hours ago; one confirmed a microsecond later, and a fresh one, it still reads');
  perform pg_temp.ok(pg_temp.count_as(null, format('select count(*) from marketplace.job_postings where org_id = %L', o_land)) = 2
                     and pg_temp.count_as(null, format('select count(*) from marketplace.job_postings where org_id = %L and id in (%L, %L)', o_land, j_fresh, j_14m)) = 2,
    '35-R: a whole-table read by anon (PostgREST''s listing) returns the business''s two current jobs only');
  perform pg_temp.ok(not pg_temp.sees('s35_none', j_20) and not pg_temp.sees('s35_rival', j_20) and not pg_temp.sees('s35_rival', j_never)
                     and pg_temp.sees('s35_none', j_fresh) and pg_temp.sees('s35_rival', j_14m),
    '35-R: a signed-in person in no business and another landing business do not read it either; they read the current jobs');
  perform pg_temp.ok(not pg_temp.sees('s35_haul', j_20) and not pg_temp.sees('s35_hdrv', j_20),
    '35-R: the hauling business that inquired on it, owner and driver, does not read it directly either (Find Work does not list it to them)');
  perform pg_temp.ok(not pg_temp.sees('s35_haul2', j_20),
    '35-R: ... nor the business invited to it');
  perform pg_temp.ok(not pg_temp.sees('s35_ldrv', j_20) and pg_temp.sees('s35_ldrv', j_fresh),
    '35-R: ... nor a driver of the posting business, who has no landing seat');
  perform pg_temp.ok(pg_temp.sees('s35_own', j_20) and pg_temp.sees('s35_mgr', j_20) and pg_temp.sees('s35_staff', j_20)
                     and pg_temp.sees('s35_own', j_never) and pg_temp.sees('s35_mgr', j_14),
    '35-R: the posting business''s landing desk still reads it: owner, manager and staff');
  perform pg_temp.ok(pg_temp.sees('s35_staff', j_b20) and pg_temp.lists('s35_staff', j_b20, o_land),
    '35-R: ... staff limited to landing A reads the stale job at landing B, as Find Work lists it to them');
  perform pg_temp.ok(pg_temp.sees('s35_admin', j_20) and pg_temp.sees('s35_admin', j_never),
    '35-R: platform staff still read it');
  perform pg_temp.ok(pg_temp.sees('s35_haul', j_paused) and not pg_temp.sees(null, j_paused) and pg_temp.sees('s35_own', j_paused),
    '35-R: a job that is not active is left to the other rules: the paused job, confirmed 20 days ago, stays readable to the business that inquired on it');

  -- Exactly what the functions do: every reader, every job.
  v_jobs := array[j_fresh, j_14m, j_14, j_20, j_never, j_paused, j_b20];
  v_subs := array[null, 's35_none', 's35_haul', 's35_hdrv', 's35_haul2', 's35_rival', 's35_own', 's35_mgr', 's35_staff', 's35_ldrv', 's35_admin'];
  v_bad := null;
  for i in 1 .. cardinality(v_subs) loop
    v_sub := v_subs[i];
    foreach v_job in array v_jobs loop
      if pg_temp.sees(v_sub, v_job) is distinct from pg_temp.lists(v_sub, v_job, o_land)
         or pg_temp.sees(v_sub, v_job) is distinct from pg_temp.pages(v_sub, v_job, o_land) then
        v_bad := concat_ws('; ', v_bad, format('%s/%s: direct %s, list %s, page %s', coalesce(v_sub, 'anon'),
          (select title from marketplace.job_postings where id = v_job),
          pg_temp.sees(v_sub, v_job), pg_temp.lists(v_sub, v_job, o_land), pg_temp.pages(v_sub, v_job, o_land)));
      end if;
    end loop;
  end loop;
  perform pg_temp.ok(v_bad is null,
    '35-R: for 11 readers and 7 jobs, a direct read shows a job exactly when list_marketplace_jobs and list_marketplace_jobs_page list it' || coalesce(' — MISMATCH ' || v_bad, ''));
  v_bad := null;
  foreach v_sub in array array['anon', 's35_none'] loop
    foreach v_job in array v_jobs loop
      if pg_temp.sees(nullif(v_sub, 'anon'), v_job) is distinct from pg_temp.searches(nullif(v_sub, 'anon'), v_job)
         or pg_temp.sees(nullif(v_sub, 'anon'), v_job) is distinct from marketplace.job_takes_new_interest(v_job) then
        v_bad := concat_ws('; ', v_bad, format('%s/%s', v_sub, (select title from marketplace.job_postings where id = v_job)));
      end if;
    end loop;
  end loop;
  perform pg_temp.ok(v_bad is null,
    '35-R: for the public (anon and a signed-in person in no business), a direct read shows a job exactly when search_job_postings finds it and job_takes_new_interest takes interest' || coalesce(' — MISMATCH ' || v_bad, ''));

  -- A job's equipment follows the job.
  perform pg_temp.ok(pg_temp.equipment_of(null, j_20) = 0 and pg_temp.equipment_of(null, j_never) = 0 and pg_temp.equipment_of('s35_haul', j_20) = 0
                     and pg_temp.equipment_of('s35_rival', j_20) = 0
                     and pg_temp.equipment_of(null, j_fresh) = 1 and pg_temp.equipment_of('s35_own', j_20) = 1 and pg_temp.equipment_of('s35_admin', j_20) = 1,
    '35-R: a hidden job''s equipment rows are hidden with it (anon, the inquiring business, a rival); a current job''s are public; the desk and staff read them');
  perform pg_temp.ok(pg_temp.count_as(null, format(
      'select count(distinct job_id) from marketplace.job_posting_equipment where job_id in (%L, %L, %L, %L, %L, %L)', j_fresh, j_14m, j_14, j_20, j_never, j_b20)) = 2,
    '35-R: ... so anon''s whole-table read of job_posting_equipment names only the two current jobs');

  -- Reconfirming restores it at once.
  perform pg_temp.as_jwt('authenticated', 's35_staff');
  v_ts := marketplace.reconfirm_job_posting(j_20);
  perform pg_temp.as_jwt('authenticated', 's35_own');
  v_ts := marketplace.reconfirm_job_posting(j_never);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.sees(null, j_20) and pg_temp.sees('s35_haul', j_20) and pg_temp.sees('s35_haul2', j_20) and pg_temp.sees('s35_rival', j_20)
                     and pg_temp.sees(null, j_never) and pg_temp.equipment_of(null, j_20) = 1 and pg_temp.searches(null, j_20),
    '35-R: reconfirming restores the job to every direct reader at once, with its equipment, as it does to the lists and search');
  perform pg_temp.ok(not pg_temp.sees(null, j_14) and not pg_temp.sees(null, j_b20),
    '35-R: ... and a job that was not reconfirmed stays hidden');
  -- Back to 20 days for the checks below.
  update marketplace.job_publication_attestations set reconfirmed_at = now() - interval '20 days' where job_id = j_20;
  update marketplace.job_postings set title = title where id = j_20;
  perform pg_temp.ok(not pg_temp.sees(null, j_20), 'fixture: the 20-day job is stale again');

  -- =========================================================================
  -- 35-R: what still reads job_postings, and how
  -- =========================================================================
  perform pg_temp.ok((select string_agg(p.proname, ',' order by p.proname) from pg_proc p
                      where p.pronamespace = 'marketplace'::regnamespace and not p.prosecdef and p.prosrc ~ 'job_postings') = 'tg_set_updated_at'
                     and (select prosrc !~ '(from|join)[[:space:]]+marketplace[.]job_postings' from pg_proc where oid = 'marketplace.tg_set_updated_at()'::regprocedure),
    '35-R: no marketplace function reads job_postings with the caller''s rights: the one SECURITY INVOKER function naming it, tg_set_updated_at, only compares the trigger''s table name');
  perform pg_temp.ok((select string_agg(tablename || '.' || policyname, ',' order by tablename, policyname) from pg_policies
                      where schemaname = 'marketplace' and (coalesce(qual, '') ~ 'job_postings' or coalesce(with_check, '') ~ 'job_postings'))
                     = 'job_posting_equipment.job_equipment_remove,job_posting_equipment.job_equipment_write',
    '35-R: the policies that read job_postings as the person are the two equipment write policies, which read the person''s own business''s jobs');
  -- The adapter's own-jobs statements (normalized-queries.ts, #247) and its inquiry-jobs read run as the person.
  perform pg_temp.ok(pg_temp.count_as('s35_own', format(
      $q$select count(*) from marketplace.list_marketplace_jobs(p_accepting_only => false, p_org_id => %L, p_limit => 200, p_job_id => %L) as pub
         join marketplace.job_postings j on j.id = pub.job_id and j.org_id = %L
         join marketplace.landings l on l.id = j.landing_id and l.org_id = j.org_id
         where j.status <> 'draft' and marketplace.has_org_role(j.org_id, array['owner', 'manager', 'staff'], true)
           and marketplace.landing_scope_allows(j.org_id, j.landing_id)$q$, o_land, j_20, o_land)) = 1
                     and pg_temp.count_as('s35_staff', format(
      $q$select count(*) from marketplace.job_postings j where j.id = %L and j.org_id = %L and j.status <> 'draft'
           and marketplace.has_org_role(j.org_id, array['owner', 'manager', 'staff'], true)
           and marketplace.landing_scope_allows(j.org_id, j.landing_id)$q$, j_20, o_land)) = 1,
    '35-R: the desk''s own_jobs and own_job_lock statements still find the stale job, for the owner and for staff at its landing');
  perform pg_temp.as_jwt('authenticated', 's35_staff');
  perform 1 from marketplace.job_postings j where j.id = j_20 and j.org_id = o_land for update;
  update marketplace.job_postings j set title = 'S35 Stale Haul (edited)'
  where j.id = j_20 and j.org_id = o_land and marketplace.landing_scope_allows(j.org_id, j.landing_id);
  get diagnostics v_n = row_count;
  insert into marketplace.job_posting_equipment (job_id, equipment_code) values (j_20, 'self_loader') returning job_id into v_job;
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_n = 1 and v_job = j_20
                     and (select title = 'S35 Stale Haul (edited)' and last_confirmed_at = now() - interval '20 days' from marketplace.job_postings where id = j_20)
                     and pg_temp.equipment_of('s35_staff', j_20) = 2,
    '35-R: the desk edits the stale job directly (own_job_edit), adds equipment with INSERT ... RETURNING, and the edit does not reconfirm it');
  perform pg_temp.as_jwt('authenticated', 's35_own');
  delete from marketplace.job_posting_equipment where job_id = j_20 and equipment_code = 'self_loader';
  get diagnostics v_n = row_count;
  insert into marketplace.job_postings (org_id, landing_id, title, status) values (o_land, l_a, 'S35 Draft', 'draft') returning id into j_draft;
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_n = 1 and j_draft is not null and pg_temp.equipment_of('s35_own', j_20) = 1,
    '35-R: ... removes it again (job_equipment_remove), and still inserts a draft job with RETURNING (02''s note on job_postings_read)');
  perform pg_temp.ok(pg_temp.count_as('s35_own', format(
      $q$select count(*) from marketplace.job_postings jp left join marketplace.landings l on l.id = jp.landing_id
         where jp.org_id = %L and exists (select 1 from marketplace.expressions_of_interest i where i.job_id = jp.id and i.job_org_id = jp.org_id)$q$, o_land)) = 2
                     and pg_temp.count_as('s35_own', format(
      $q$select count(*) from marketplace.job_postings j where j.landing_id = %L and j.org_id = %L and j.status = 'active'$q$, l_a, o_land)) = 5,
    '35-R: the inquiry-jobs read lists both jobs with inquiries, and the landing''s active-job count still counts the stale jobs');
  perform pg_temp.as_jwt('authenticated', 's35_rival');
  update marketplace.job_postings set title = 'Hijacked' where id = j_20;
  get diagnostics v_n = row_count;
  perform pg_temp.as_jwt('authenticated', 's35_haul');
  perform pg_temp.fails(format('insert into marketplace.job_posting_equipment (job_id, equipment_code) values (%L, %L)', j_20, 'self_loader'),
    '42501', 'row-level security', '35-R: a hauling business still cannot add equipment to the job');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_n = 0 and (select title = 'S35 Stale Haul (edited)' from marketplace.job_postings where id = j_20),
    '35-R: a rival''s direct UPDATE of the stale job changes nothing');
  -- The SECURITY DEFINER readers are not row-level security: 31's by-id rule and the inquiry list are unchanged.
  perform pg_temp.ok(pg_temp.count_as(null, format('select count(*) from marketplace.get_marketplace_job(%L) g where g.status = ''active'' and g.accepting_interest is false', j_20)) = 1
                     and pg_temp.count_as('s35_haul', format('select count(*) from marketplace.list_marketplace_interests(%L, ''hauler'') i where i.job_id = %L and i.job_accepting_interest is false', o_haul, j_20)) = 1,
    '35-R: the functions still behave: get_marketplace_job returns the stale job by id to anon (31-R), and the hauler''s inquiry list still shows its inquiry on it');
  perform pg_temp.ok((select permissive = 'RESTRICTIVE' and cmd = 'SELECT' and roles = '{anon,authenticated}'::name[]
                             and qual like '%job_day14_visible(org_id, status, last_confirmed_at)%'
                      from pg_policies where schemaname = 'marketplace' and tablename = 'job_postings' and policyname = 'job_postings_day14')
                     and (select permissive = 'RESTRICTIVE' and cmd = 'SELECT' and roles = '{anon,authenticated}'::name[]
                             and qual like '%job_day14_visible_by_id(job_id)%'
                      from pg_policies where schemaname = 'marketplace' and tablename = 'job_posting_equipment' and policyname = 'job_equipment_day14')
                     and (select prosrc like '%marketplace.job_confirmation_current(p_last_confirmed_at)%'
                          from pg_proc where oid = 'marketplace.job_day14_visible(uuid, text, timestamptz)'::regprocedure),
    '35-R: both policies are restrictive SELECT policies for anon and authenticated, on 31''s one definition of the boundary');

  -- =========================================================================
  -- 35-K: signing-key rotation
  -- =========================================================================
  perform pg_temp.as_jwt('authenticated', 's35_haul');
  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled)
  values (u_haul, o_haul, 'inquiry_reply', 'email', true), (u_haul, o_haul, 'job_alert', 'email', true),
         (u_haul, o_haul, 'targeted_invitation', 'email', true), (u_haul, o_haul, 'inquiry_reply', 'in_app', true),
         (u_haul, o_haul, 'job_alert', 'in_app', true), (u_haul, o_haul, 'targeted_invitation', 'in_app', true);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select count(*) = 0 from marketplace.notification_unsubscribe_keys) and (select count(*) = 0 from marketplace.notification_unsubscribe_uses)
                     and exists (select 1 from pg_attribute where attrelid = 'marketplace.notification_unsubscribe_keys'::regclass and attname = 'retired_at' and not attisdropped),
    '35-K: 35 stores no key; keys now carry when they were retired');

  perform pg_temp.as_jwt('service_role');
  t_a := marketplace.issue_unsubscribe_token(u_haul, o_haul, 'inquiry_reply');
  perform pg_temp.as_jwt('harness');
  select id into k1 from marketplace.notification_unsubscribe_keys;
  perform pg_temp.as_jwt('service_role');
  k2 := marketplace.rotate_unsubscribe_key();
  t_b := marketplace.issue_unsubscribe_token(u_haul, o_haul, 'job_alert');
  perform pg_temp.as_jwt('harness');
  select retired_at into v_retired from marketplace.notification_unsubscribe_keys where id = k1;
  perform pg_temp.ok(k2 is not null and k2 <> k1 and v_retired is not null
                     and (select retired_at is null from marketplace.notification_unsubscribe_keys where id = k2)
                     and (select count(*) = 1 from marketplace.notification_unsubscribe_keys where retired_at is null)
                     and pg_temp.token_key(t_a) = k1 and pg_temp.token_key(t_b) = k2,
    '35-K: a rotation makes a new key current and retires the old one; a token minted after it is signed with the new key');
  perform pg_temp.ok((select count(*) = 1 from marketplace.audit_events
                      where action = 'notification.unsubscribe_key_rotated' and entity_id = k2 and org_id is null and actor_kind = 'system'
                        and metadata ->> 'previous_keys_retired' = '1' and metadata ->> 'previous_keys_revoked' = '0'),
    '35-K: ... audited, naming the new key''s id and how many keys it retired (never a secret)');
  perform pg_temp.click(t_a);
  perform pg_temp.click(t_b);
  perform pg_temp.ok(not pg_temp.pref_on(u_haul, o_haul, 'inquiry_reply', 'email') and not pg_temp.pref_on(u_haul, o_haul, 'job_alert', 'email')
                     and pg_temp.pref_on(u_haul, o_haul, 'targeted_invitation', 'email'),
    '35-K: the grace window: a link signed with the retired key still works, and so does one signed with the new key');

  -- The bound: a retired key verifies only expiries up to 90 days after its retirement (the longest lifetime).
  select secret into v_secret from marketplace.notification_unsubscribe_keys where id = k1;
  v_epoch := floor(extract(epoch from v_retired + interval '90 days'))::bigint;
  t_c := pg_temp.make_token(v_secret, concat_ws('|', 'v1', k1, gen_random_uuid(), u_haul, o_haul, 'targeted_invitation', 'email', v_epoch + 1));
  perform pg_temp.click(t_c);
  perform pg_temp.ok(pg_temp.pref_on(u_haul, o_haul, 'targeted_invitation', 'email')
                     and (select count(*) = 2 from marketplace.notification_unsubscribe_uses),
    '35-K: a token under the retired key that expires a second after 90 days from the retirement (so not one it minted) does nothing');
  t_c := pg_temp.make_token(v_secret, concat_ws('|', 'v1', k1, gen_random_uuid(), u_haul, o_haul, 'targeted_invitation', 'email', v_epoch));
  perform pg_temp.click(t_c);
  perform pg_temp.ok(not pg_temp.pref_on(u_haul, o_haul, 'targeted_invitation', 'email'),
    '35-K: ... one that expires within the 90 days works');

  -- Housekeeping keeps what still matters.
  perform pg_temp.as_jwt('service_role');
  select p.uses_pruned, p.keys_pruned into v_uses, v_keys from marketplace.prune_unsubscribe_tokens() p;
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_uses = 0 and v_keys = 0 and (select count(*) = 3 from marketplace.notification_unsubscribe_uses)
                     and (select count(*) = 2 from marketplace.notification_unsubscribe_keys),
    '35-P: a prune keeps the use records of tokens that have not expired, and a key retired today');
  perform pg_temp.as_jwt('authenticated', 's35_haul');
  update marketplace.notification_preferences set enabled = true where user_id = u_haul and org_id = o_haul and category = 'inquiry_reply' and channel = 'email';
  perform pg_temp.as_jwt('harness');
  perform pg_temp.click(t_a);
  perform pg_temp.ok(pg_temp.pref_on(u_haul, o_haul, 'inquiry_reply', 'email'),
    '35-P: ... so a used link, still unexpired, does nothing after the prune: the person turned the email back on and it stays on');

  -- A second rotation; the first key, aged to 91 days after its retirement, verifies nothing and is pruned.
  perform pg_temp.as_jwt('service_role');
  k3 := marketplace.rotate_unsubscribe_key(false);
  perform pg_temp.as_jwt('harness');
  update marketplace.notification_unsubscribe_keys set created_at = now() - interval '200 days', retired_at = now() - interval '91 days' where id = k1;
  t_c := pg_temp.make_token(v_secret, concat_ws('|', 'v1', k1, gen_random_uuid(), u_haul, o_haul, 'job_alert', 'in_app',
                                                floor(extract(epoch from now() + interval '1 day'))::bigint));
  perform pg_temp.click(t_c);
  perform pg_temp.ok(pg_temp.pref_on(u_haul, o_haul, 'job_alert', 'in_app'),
    '35-K: a key retired more than 90 days ago verifies nothing, even before the prune deletes it');
  perform pg_temp.as_jwt('service_role');
  select p.uses_pruned, p.keys_pruned into v_uses, v_keys from marketplace.prune_unsubscribe_tokens() p;
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_keys = 1 and not exists (select 1 from marketplace.notification_unsubscribe_keys where id = k1)
                     and (select count(*) = 2 from marketplace.notification_unsubscribe_keys where id in (k2, k3))
                     and (select retired_at is null from marketplace.notification_unsubscribe_keys where id = k3),
    '35-P: the prune deletes that key, and keeps the key retired today and the current one');

  -- Revoking: fail closed.
  perform pg_temp.as_jwt('service_role');
  t_c := marketplace.issue_unsubscribe_token(u_haul, o_haul, 'targeted_invitation', 'in_app');
  k4 := marketplace.rotate_unsubscribe_key(p_revoke_previous => true);
  t_d := marketplace.issue_unsubscribe_token(u_haul, o_haul, 'inquiry_reply', 'in_app');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.token_key(t_c) = k3 and pg_temp.token_key(t_d) = k4
                     and (select array_agg(id) = array[k4] and bool_and(retired_at is null) from marketplace.notification_unsubscribe_keys)
                     and (select count(*) = 1 from marketplace.audit_events
                          where action = 'notification.unsubscribe_key_rotated' and entity_id = k4
                            and metadata ->> 'previous_keys_revoked' = '2' and metadata ->> 'previous_keys_retired' = '0'),
    '35-K: revoking deletes every earlier key (the current one and the retired one), audited');
  perform pg_temp.click(t_c);
  perform pg_temp.click(t_b);
  perform pg_temp.click(t_d);
  perform pg_temp.ok(pg_temp.pref_on(u_haul, o_haul, 'targeted_invitation', 'in_app') and not pg_temp.pref_on(u_haul, o_haul, 'inquiry_reply', 'in_app'),
    '35-K: ... so a link signed before the revocation fails closed (it does nothing), and a link signed after it works');
  perform pg_temp.as_jwt('service_role');
  perform pg_temp.fails('select marketplace.rotate_unsubscribe_key(null)', '22023', 'revoked .* or retired', '35-K: a rotation says which of the two it is');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.fails(format('insert into marketplace.notification_unsubscribe_keys (secret) values (%L::bytea)', '\x' || repeat('ab', 32)),
    '23505', 'notification_unsubscribe_keys_one_current_uq', '35-K: at most one key is current, whatever path writes one');

  -- =========================================================================
  -- 35-P: a prune never makes a used token work again
  -- =========================================================================
  -- A token that expires three seconds from now on the clock, used once; the person turns the preference back on;
  -- the token expires; the prune deletes its use record; then the token is presented again in a transaction that
  -- began before it expired (this one). Only the clock check after the use is recorded stops it.
  perform pg_temp.as_jwt('harness');
  select secret into v_secret from marketplace.notification_unsubscribe_keys where id = k4;
  v_tok := gen_random_uuid();
  v_epoch := floor(extract(epoch from clock_timestamp()))::bigint + 3;
  t_race := pg_temp.make_token(v_secret, concat_ws('|', 'v1', k4, v_tok, u_haul, o_haul, 'job_alert', 'email', v_epoch));
  perform pg_temp.as_jwt('authenticated', 's35_haul');
  update marketplace.notification_preferences set enabled = true where user_id = u_haul and org_id = o_haul and category = 'job_alert' and channel = 'email';
  perform pg_temp.as_jwt('harness');
  perform pg_temp.click(t_race);
  perform pg_temp.ok(not pg_temp.pref_on(u_haul, o_haul, 'job_alert', 'email')
                     and (select count(*) = 1 from marketplace.notification_unsubscribe_uses where token_id = v_tok),
    'fixture: a token that expires in three seconds turns its preference off once');
  perform pg_temp.as_jwt('authenticated', 's35_haul');
  update marketplace.notification_preferences set enabled = true where user_id = u_haul and org_id = o_haul and category = 'job_alert' and channel = 'email';
  perform pg_temp.as_jwt('harness');
  while clock_timestamp() <= to_timestamp(v_epoch) loop
    perform pg_sleep(0.1);
  end loop;
  perform pg_temp.as_jwt('service_role');
  select p.uses_pruned, p.keys_pruned into v_uses, v_keys from marketplace.prune_unsubscribe_tokens() p;
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_uses >= 1 and not exists (select 1 from marketplace.notification_unsubscribe_uses where token_id = v_tok)
                     and to_timestamp(v_epoch) > now(),
    '35-P: once the token has expired the prune deletes its use record (while this transaction began before the expiry)');
  select count(*) into v_audits from marketplace.audit_events where action = 'notification.unsubscribed' and metadata ->> 'token_id' = v_tok::text;
  perform pg_temp.click(t_race);
  perform pg_temp.ok(pg_temp.pref_on(u_haul, o_haul, 'job_alert', 'email')
                     and (select count(*) from marketplace.audit_events where action = 'notification.unsubscribed' and metadata ->> 'token_id' = v_tok::text) = v_audits,
    '35-P: the pruned token, presented again, does nothing: the preference the person turned back on stays on, and nothing more is audited');

  -- =========================================================================
  -- Privileges and wiring
  -- =========================================================================
  perform pg_temp.as_jwt('anon');
  perform pg_temp.fails('select marketplace.prune_unsubscribe_tokens()', '42501', 'permission denied', 'privileges: anon cannot prune');
  perform pg_temp.fails('select marketplace.rotate_unsubscribe_key()', '42501', 'permission denied', 'privileges: ... nor rotate the key');
  perform pg_temp.as_jwt('authenticated', 's35_admin');
  perform pg_temp.fails('select marketplace.prune_unsubscribe_tokens()', '42501', 'permission denied', 'privileges: a signed-in person, platform staff included, cannot prune');
  perform pg_temp.fails('select marketplace.rotate_unsubscribe_key(true)', '42501', 'permission denied', 'privileges: ... nor rotate the key');
  perform pg_temp.fails('select count(*) from marketplace.notification_unsubscribe_keys', '42501', 'permission denied', 'privileges: ... nor read the keys');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(bool_and(has_function_privilege('service_role', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE')
                              and not has_function_privilege('authenticated', f, 'EXECUTE')),
    'privileges: prune_unsubscribe_tokens and rotate_unsubscribe_key are executable by service_role only')
  from unnest(array['marketplace.prune_unsubscribe_tokens()', 'marketplace.rotate_unsubscribe_key(boolean)']::regprocedure[]) f;
  perform pg_temp.ok(bool_and(has_function_privilege('anon', f, 'EXECUTE') and has_function_privilege('authenticated', f, 'EXECUTE')
                              and not has_function_privilege('service_role', f, 'EXECUTE') and p.provolatile = 's' and p.prosecdef),
    'privileges: the two day-14 helpers are stable, SECURITY DEFINER, and executable by anon and authenticated, as the policies need')
  from unnest(array['marketplace.job_day14_visible(uuid, text, timestamptz)', 'marketplace.job_day14_visible_by_id(uuid)']::regprocedure[]) f
  join pg_proc p on p.oid = f;
  perform pg_temp.ok(has_function_privilege('anon', 'marketplace.unsubscribe_with_token(text)', 'EXECUTE')
                     and not has_function_privilege('authenticated', 'marketplace.unsubscribe_with_token(text)', 'EXECUTE')
                     and has_function_privilege('service_role', 'marketplace.issue_unsubscribe_token(uuid, uuid, text, text, interval)', 'EXECUTE')
                     and not has_function_privilege('anon', 'marketplace.issue_unsubscribe_token(uuid, uuid, text, text, interval)', 'EXECUTE')
                     and (select count(*) = 1 from pg_proc p where p.pronamespace = 'marketplace'::regnamespace and p.provolatile = 'v'
                          and has_function_privilege('anon', p.oid, 'EXECUTE')),
    'privileges: the two redefined functions keep their grants; unsubscribe_with_token is still the only volatile function anon can execute');
  perform pg_temp.ok(not exists (select 1 from pg_policies where schemaname = 'marketplace' and tablename like 'notification_unsubscribe_%')
                     and not exists (select 1 from information_schema.role_table_grants
                                     where table_schema = 'marketplace' and table_name like 'notification_unsubscribe_%'
                                       and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')),
    'privileges: the key and used-token tables still have no policy and no grant to any API role');

  perform pg_temp.ok((select string_agg(version, ',' order by applied_at, version) from marketplace.schema_migrations) = '06,11,12,16,18,23,26,29,31,33,35',
    'the migration ledger records 06, 11, 12, 16, 18, 23, 26, 29, 31, 33 and 35 in order');

  raise notice 'ALL DAY-14 DIRECT READ, UNSUBSCRIBE PRUNE AND KEY ROTATION (35-R, 35-P, 35-K) TESTS PASSED.';
end
$$;

rollback;
