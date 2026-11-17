-- =============================================================================
-- LogLoads normalized-v2 — 41 regression suite for 40 (phone-reveal pause, #325)
--
-- NON-ACTIVE PROTOTYPE TEST SUITE. Disposable PostgreSQL only. Run after 40.
-- Wraps everything in BEGIN ... ROLLBACK. Negative tests require the SQLSTATE and a matching message.
-- Run as the role that applied 40.
-- The phone numbers in this fixture are the only copies. Lists, the outbox, the audit log, reports and
-- messages must not contain them. A second share of the same landing does not count. The fifth distinct
-- landing is stored and opens the pause. The sixth is refused until a moderator clears it, and that clear
-- uses admin_resolve_report. Shares from before the clear do not fill the window again: the sixth then
-- succeeds inside this one transaction, which is only possible when they are excluded.
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

create function pg_temp.phone_of(p_sub text, p_landing uuid) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.as_jwt('authenticated', p_sub);
  execute format('select site_contact_phone from marketplace.landing_private_details where landing_id = %L', p_landing) into v;
  perform pg_temp.as_jwt('harness');
  return v;
end
$$;

create function pg_temp.interest_list(p_sub text, p_org uuid, p_side text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.as_jwt('authenticated', p_sub);
  execute format(
    'select coalesce(string_agg(t::text, ''|''), '''') from marketplace.list_marketplace_interests(%L::uuid, %L) t',
    p_org, p_side) into v;
  perform pg_temp.as_jwt('harness');
  return v;
end
$$;

-- True when the fixture phone digits were copied into a channel that must not carry them.
create function pg_temp.phone_leaked() returns boolean language plpgsql as $$
declare v boolean;
begin
  select exists (
    select 1 from marketplace.audit_events
    where coalesce(reason, '') like '%1541555019%' or metadata::text like '%1541555019%'
  ) or exists (
    select 1 from marketplace.notification_outbox
    where payload::text like '%1541555019%' or coalesce(recipient_email, '') like '%1541555019%'
  ) or exists (
    select 1 from marketplace.interest_messages where body like '%1541555019%'
  ) or exists (
    select 1 from marketplace.abuse_reports
    where coalesce(details, '') like '%1541555019%' or coalesce(resolution_note, '') like '%1541555019%'
  ) or exists (
    select 1 from marketplace.expressions_of_interest where coalesce(message, '') like '%1541555019%'
  ) into v;
  return coalesce(v, false);
end
$$;

grant execute on all functions in schema pg_temp to public;

insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true) on conflict (issuer) do nothing;

do $$
declare
  c_iss constant text := 'https://clerk.logloads.test';
  c_body constant text := 'Trucks can start Monday';
  u_own uuid; u_haul uuid; u_haul2 uuid; u_drv uuid; u_mod uuid; u_bill uuid;
  o_land uuid; o_haul uuid; o_haul2 uuid;
  l_ids uuid[] := array[]::uuid[]; j_ids uuid[] := array[]::uuid[]; e_ids uuid[] := array[]::uuid[];
  l uuid; j uuid; e uuid; j_extra uuid; e_extra uuid; v_inv uuid;
  i integer;
  v_open integer;
  v_report uuid;
begin
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select landing_count = 5 and window_hours = 24 from marketplace.phone_reveal_pause_limit()),
    'the pause limit is 5 distinct landings in 24 hours');
  perform pg_temp.ok(
    has_function_privilege('authenticated', 'marketplace.admin_clear_hauler_reveal_pause(uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'marketplace.admin_clear_hauler_reveal_pause(uuid,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'marketplace.open_hauler_reveal_pause(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'marketplace.open_hauler_reveal_pause(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'marketplace.phone_reveal_pause_limit()', 'EXECUTE')
    and not has_function_privilege('anon', 'marketplace.phone_reveal_pause_limit()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'marketplace.tg_hauler_reveal_pause()', 'EXECUTE')
    and not has_function_privilege('anon', 'marketplace.tg_hauler_reveal_pause()', 'EXECUTE'),
    'only a signed-in member can clear a pause; the count, the opener and the trigger stay internal');
  perform pg_temp.ok((
    select bool_and(p.prosrc not like '%site_contact_phone%')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'marketplace'
      and p.proname in ('phone_reveal_pause_limit', 'open_hauler_reveal_pause', 'tg_hauler_reveal_pause', 'admin_clear_hauler_reveal_pause')
  ), 'the pause functions do not read the phone column');
  perform pg_temp.ok(
    to_regclass('marketplace.analytics_events') is null
    and not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'marketplace' and c.relkind = 'r' and c.relname like '%analytic%'
    )
    and not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'marketplace' and p.proname like '%export%'
        and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    ),
    'there is no analytics table and no export function granted to a public role');

  perform pg_temp.as_jwt('service_role');
  u_own   := marketplace.sync_verified_identity(c_iss, 's40_own',   'S40 Landing Owner',  'own@s40.test',   true);
  u_haul  := marketplace.sync_verified_identity(c_iss, 's40_haul',  'S40 Hauler Owner',   'haul@s40.test',  true);
  u_haul2 := marketplace.sync_verified_identity(c_iss, 's40_haul2', 'S40 Other Hauler',   'haul2@s40.test', true);
  u_drv   := marketplace.sync_verified_identity(c_iss, 's40_drv',   'S40 Yard Driver',    'drv@s40.test',   true);
  u_mod   := marketplace.sync_verified_identity(c_iss, 's40_mod',   'S40 Moderator',      'mod@s40.test',   true);
  u_bill  := marketplace.sync_verified_identity(c_iss, 's40_bill',  'S40 Billing Admin',  'bill@s40.test',  true);
  perform pg_temp.as_jwt('harness');
  insert into marketplace.platform_admins (user_id, admin_role, note) values
    (u_mod, 'moderator', 'suite 41'),
    (u_bill, 'billing', 'suite 41');

  perform pg_temp.as_jwt('authenticated', 's40_own');
  o_land := marketplace.create_organization('S40 Landing Co', 's40-landing', 'OR', false);
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_land, 'regional', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_s40', 'sub_s40', false, 7, false);
  perform pg_temp.as_jwt('authenticated', 's40_own');
  for i in 1..6 loop
    insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
    values (o_land, 'S40 Landing ' || i, 'active', 'Near Sisters, OR', marketplace.make_public_point(-121.50 - (i * 0.01), 44.30), 'OR')
    returning id into l;
    insert into marketplace.landing_private_details (landing_id, org_id, exact_point, directions, gate_instructions, site_contact_name, site_contact_phone)
    values (
      l, o_land,
      extensions.st_setsrid(extensions.st_makepoint(-121.50 - (i * 0.01), 44.30), 4326)::extensions.geography,
      'County road', 'Locked gate', 'S40 Foreman ' || i, '+1541555019' || i::text
    );
    j := marketplace.publish_job_posting(l, 'S40 Haul ' || i, array['log_truck'], 1, 'Fir sawlogs', 'Suite 41 haul.', 'per_ton', 500, null,
      1, current_date + 10, 8, 3.0, 6, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
    l_ids := array_append(l_ids, l);
    j_ids := array_append(j_ids, j);
  end loop;
  j_extra := marketplace.publish_job_posting(l_ids[1], 'S40 Haul 1 again', array['log_truck'], 1, 'Fir sawlogs', 'Suite 41 second haul.', 'per_ton', 500, null,
    1, current_date + 10, 8, 3.0, 6, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  v_inv := marketplace.invite_team_member(o_land, 'drv@s40.test', 'driver', false, interval '7 days');
  perform pg_temp.as_jwt('authenticated', 's40_drv');
  perform marketplace.accept_team_invitation(v_inv);

  perform pg_temp.as_jwt('authenticated', 's40_haul');
  o_haul := marketplace.create_organization('S40 Hauling', 's40-hauling', 'OR', true);
  for i in 1..6 loop
    select interest_id into e from marketplace.submit_expression_of_interest(o_haul, j_ids[i], 1);
    e_ids := array_append(e_ids, e);
  end loop;
  select interest_id into e_extra from marketplace.submit_expression_of_interest(o_haul, j_extra, 1);
  perform pg_temp.as_jwt('authenticated', 's40_haul2');
  o_haul2 := marketplace.create_organization('S40 Other Hauling', 's40-other', 'OR', true);

  perform pg_temp.as_jwt('authenticated', 's40_own');
  perform marketplace.respond_to_interest(e_ids[1], 'replied', true, null, c_body);
  perform marketplace.respond_to_interest(e_extra, 'replied', true, null, c_body);
  perform pg_temp.as_jwt('harness');
  select count(*) into v_open from marketplace.hauler_reveal_pauses where hauler_org_id = o_haul and cleared_at is null;
  perform pg_temp.ok(v_open = 0
    and (select count(distinct j.landing_id) from marketplace.expressions_of_interest e
         join marketplace.job_postings j on j.id = e.job_id
         where e.hauler_org_id = o_haul and e.private_details_shared_at is not null) = 1,
    'a second release from the same landing does not count and does not pause');

  perform pg_temp.as_jwt('authenticated', 's40_own');
  for i in 2..4 loop
    perform marketplace.respond_to_interest(e_ids[i], 'replied', true, null, c_body);
  end loop;
  perform pg_temp.as_jwt('harness');
  select count(*) into v_open from marketplace.hauler_reveal_pauses where hauler_org_id = o_haul and cleared_at is null;
  perform pg_temp.ok(v_open = 0, 'four distinct landings stay under the pause');

  perform pg_temp.as_jwt('authenticated', 's40_own');
  perform marketplace.respond_to_interest(e_ids[5], 'replied', true, null, c_body);
  perform pg_temp.as_jwt('harness');
  select count(*) into v_open from marketplace.hauler_reveal_pauses where hauler_org_id = o_haul and cleared_at is null;
  select r.id into v_report
  from marketplace.hauler_reveal_pauses p
  join marketplace.abuse_reports r on r.id = p.report_id
  where p.hauler_org_id = o_haul and p.cleared_at is null;
  perform pg_temp.ok(v_open = 1
    and (select private_details_shared_at is not null from marketplace.expressions_of_interest where id = e_ids[5])
    and (select count(distinct j.landing_id) from marketplace.expressions_of_interest e
         join marketplace.job_postings j on j.id = e.job_id
         where e.hauler_org_id = o_haul and e.private_details_shared_at is not null) = 5,
    'the fifth distinct landing is stored and opens one pause');
  perform pg_temp.ok(exists (
    select 1 from marketplace.abuse_reports
    where id = v_report and status = 'open' and reason = 'unsafe_disclosure' and target_kind = 'organization' and target_id = o_haul
  ), 'the pause opens an unsafe-disclosure report on that hauler organization');
  perform pg_temp.ok(exists (
    select 1 from marketplace.audit_events
    where action = 'hauler_reveal.paused' and entity_id = o_haul and org_id = o_haul
  ), 'the pause writes an audit row for the hauler organization');
  perform pg_temp.ok(pg_temp.phone_of('s40_own', l_ids[1]) = '+15415550191'
    and pg_temp.phone_of('s40_haul', l_ids[1]) = '+15415550191'
    and pg_temp.phone_of('s40_haul', l_ids[5]) = '+15415550195'
    and pg_temp.phone_of('s40_haul', l_ids[6]) is null
    and pg_temp.phone_of('s40_haul2', l_ids[1]) is null
    and pg_temp.phone_of('s40_haul2', l_ids[5]) is null
    and pg_temp.phone_of('s40_drv', l_ids[1]) is null,
    'the released hauler reads the shared numbers; the other hauler and the landing driver read none');
  perform pg_temp.ok(
    pg_temp.interest_list('s40_haul', o_haul, 'hauler') not like '%1541555019%'
    and pg_temp.interest_list('s40_own', o_land, 'landing') not like '%1541555019%'
    and not pg_temp.phone_leaked(),
    'the inquiry lists, the outbox, the audit log, the report and the messages do not contain the phone');

  perform pg_temp.as_jwt('authenticated', 's40_own');
  perform pg_temp.fails(
    format('select marketplace.respond_to_interest(%L::uuid, %L, true, null, %L)', e_ids[6], 'replied', c_body),
    '42501', 'paused for review',
    'the sixth distinct landing is refused while the hauler is paused');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select private_details_shared_at is null and status = 'submitted' from marketplace.expressions_of_interest where id = e_ids[6]),
    'the refused release is not stored');

  perform pg_temp.as_jwt('authenticated', 's40_bill');
  perform pg_temp.fails(
    format('select marketplace.admin_clear_hauler_reveal_pause(%L::uuid, %L)', o_haul, 'Billing cannot clear a reveal pause'),
    '42501', 'moderator',
    'a billing admin cannot clear the pause');
  perform pg_temp.as_jwt('authenticated', 's40_mod');
  perform pg_temp.fails(
    format('select marketplace.admin_clear_hauler_reveal_pause(%L::uuid, %L)', o_haul, 'no'),
    '22023', '5 to 500',
    'a clear needs a reason of 5 to 500 characters');
  perform marketplace.admin_clear_hauler_reveal_pause(o_haul, 'Staff reviewed the hauler and releases may resume');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select cleared_at is not null and cleared_by = u_mod from marketplace.hauler_reveal_pauses where hauler_org_id = o_haul)
    and (select status = 'dismissed' from marketplace.abuse_reports where id = v_report)
    and exists (select 1 from marketplace.audit_events where action = 'hauler_reveal.pause_cleared' and entity_id = o_haul)
    and exists (select 1 from marketplace.audit_events where action = 'abuse_report.dismissed' and entity_id = v_report),
    'a moderator dismisses the report through the moderation path and closes the pause');

  perform pg_temp.as_jwt('authenticated', 's40_own');
  perform marketplace.respond_to_interest(e_ids[6], 'replied', true, null, c_body);
  perform pg_temp.as_jwt('harness');
  select count(*) into v_open from marketplace.hauler_reveal_pauses where hauler_org_id = o_haul and cleared_at is null;
  perform pg_temp.ok(v_open = 0
    and (select private_details_shared_at is not null from marketplace.expressions_of_interest where id = e_ids[6])
    and pg_temp.phone_of('s40_haul', l_ids[6]) = '+15415550196'
    and pg_temp.phone_of('s40_haul2', l_ids[6]) is null,
    'after the clear the next landing is released and the earlier shares do not open a new pause');
  perform pg_temp.ok(
    pg_temp.interest_list('s40_haul', o_haul, 'hauler') not like '%1541555019%'
    and not pg_temp.phone_leaked(),
    'the channels still do not contain the phone after the clear');

  perform pg_temp.as_jwt('authenticated', 's40_mod');
  perform pg_temp.fails(
    format('select marketplace.admin_clear_hauler_reveal_pause(%L::uuid, %L)', o_haul, 'Staff reviewed a pause that is already closed'),
    'P0002', 'not found',
    'clearing a hauler that is not paused is refused');

  perform pg_temp.as_jwt('harness');
  raise notice 'ALL REVEAL PAUSE (40) TESTS PASSED';
end
$$;

rollback;
