-- =============================================================================
-- LogLoads normalized-v2 — 47 regression suite for 46 (the email suppression list, one stable unsubscribe link per
-- notice, and the landing's new-inquiry notice; #405)
--
-- NON-ACTIVE PROTOTYPE TEST SUITE. Disposable PostgreSQL only. Run after 46.
-- Wraps everything in BEGIN ... ROLLBACK. Negative tests require the SQLSTATE and a matching message.
-- Run as the role that applied 46.
--
-- Cases: the list's shape and grants (no client role reads or writes it; the worker's three calls are service_role's
-- alone). suppress_email_address records a keyed hash once and keeps its first reason; email_suppressed_hashes answers
-- only for hashes on the list. A new inquiry queues an inquiry_submitted notice for each opted-in landing member in
-- scope, on each channel they chose, and for no one else: not the hauler, not a member who opted out, not a member
-- outside the job's landing. Its payload holds ids and names and never the inquiry's message. Editing the inquiry
-- queues nothing more (the trigger fires on insert only). notification_email_context answers only the current claim, gives the same token on
-- every call, and that token unsubscribes once; a team invitation gets no token and its send count.
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

-- Runs one statement as one role and returns its single text value.
create function pg_temp.value_as(p_role text, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.as_jwt(p_role);
  execute p_sql into v;
  perform pg_temp.as_jwt('harness');
  return v;
end
$$;

grant execute on all functions in schema pg_temp to public;

insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true) on conflict (issuer) do nothing;

do $$
declare
  c_iss constant text := 'https://clerk.logloads.test';
  c_hash_a constant text := repeat('a', 64);
  c_hash_b constant text := repeat('b', 64);
  c_note constant text := 'S46 private note for the landing';
  u_own uuid; u_quiet uuid; u_limited uuid; u_haul uuid; u_haul2 uuid;
  o_land uuid; o_haul uuid; o_haul2 uuid;
  l_main uuid; l_other uuid; j_main uuid; j_other uuid;
  e_main uuid; e_other uuid; v_inv uuid;
  v_n integer; v_payload jsonb; v_id uuid; v_token uuid; v_queued timestamptz;
  v_unsub text; v_unsub_again text; v_count integer; v_ctx record;
  r record;
begin
  perform pg_temp.as_jwt('harness');

  -- ---------------------------------------------------------------------------------------------------------------
  -- Shape and grants
  -- ---------------------------------------------------------------------------------------------------------------
  perform pg_temp.ok(
    (select c.relrowsecurity from pg_class c where c.oid = 'marketplace.email_suppressions'::regclass)
    and not exists (select 1 from pg_policies p where p.schemaname = 'marketplace' and p.tablename = 'email_suppressions')
    and not exists (select 1 from information_schema.role_table_grants g
                    where g.table_schema = 'marketplace' and g.table_name = 'email_suppressions'
                      and g.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role'))
    and not exists (select 1 from information_schema.columns c
                    where c.table_schema = 'marketplace' and c.table_name = 'email_suppressions'
                      and c.column_name ~ '(email|address)$'),
    'the suppression list has row-level security, no policy, no client grant, and no address column');
  perform pg_temp.ok((
    select bool_and(has_function_privilege('service_role', f, 'EXECUTE')
                    and not has_function_privilege('anon', f, 'EXECUTE')
                    and not has_function_privilege('authenticated', f, 'EXECUTE'))
    from unnest(array['marketplace.suppress_email_address(text,text)', 'marketplace.email_suppressed_hashes(text[])',
                      'marketplace.notification_email_context(uuid,uuid)']) f
  ), 'the worker''s three calls are service_role''s alone');
  perform pg_temp.ok(
    not has_function_privilege('anon', 'marketplace.tg_interest_submitted_notify()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'marketplace.tg_interest_submitted_notify()', 'EXECUTE')
    and not has_function_privilege('service_role', 'marketplace.tg_interest_submitted_notify()', 'EXECUTE')
    and exists (select 1 from pg_trigger t where t.tgrelid = 'marketplace.expressions_of_interest'::regclass
                  and t.tgname = 'interest_submitted_notify' and not t.tgisinternal),
    'the new-inquiry trigger is installed and its function is callable by no client role');
  perform pg_temp.ok((
    select bool_and(p.prosrc not like '%site_contact_phone%' and p.prosrc not like '%.message%' and p.prosrc not like '%contact_preference%')
    from pg_proc p
    where p.pronamespace = 'marketplace'::regnamespace
      and p.proname in ('tg_interest_submitted_notify', 'notification_email_context', 'suppress_email_address', 'email_suppressed_hashes')
  ), 'no 46 function reads a phone, an inquiry message or a contact preference');

  -- ---------------------------------------------------------------------------------------------------------------
  -- 46-S: the list
  -- ---------------------------------------------------------------------------------------------------------------
  perform pg_temp.as_jwt('service_role');
  perform pg_temp.fails('select marketplace.suppress_email_address(''not-a-hash'', ''bounced'')', '22023', 'hexadecimal',
    'a malformed hash is refused');
  perform pg_temp.fails(format('select marketplace.suppress_email_address(%L, %L)', upper(c_hash_a), 'bounced'), '22023', 'hexadecimal',
    'an upper-case hash is refused (the list keeps one form)');
  perform pg_temp.fails(format('select marketplace.suppress_email_address(%L, %L)', c_hash_a, 'tired'), '22023', 'unsubscribed, bounced or complained',
    'an unknown reason is refused');
  perform pg_temp.ok(marketplace.suppress_email_address(c_hash_a, 'unsubscribed') is true, 'a new address is added to the list');
  perform pg_temp.ok(marketplace.suppress_email_address(c_hash_a, 'bounced') is false, 'the same address again is not new');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(
    (select reason = 'unsubscribed' and event_count = 2 and last_event_at >= suppressed_at
     from marketplace.email_suppressions where address_hash = c_hash_a),
    'the first reason is kept, and the repeat is counted');

  perform pg_temp.ok(
    pg_temp.value_as('service_role', format(
      'select coalesce(string_agg(address_hash, '',''), '''') from marketplace.email_suppressed_hashes(array[%L, %L, %L])',
      c_hash_a, c_hash_b, 'junk')) = c_hash_a,
    'email_suppressed_hashes answers only for hashes on the list');
  perform pg_temp.ok(
    pg_temp.value_as('service_role', 'select count(*)::text from marketplace.email_suppressed_hashes(null)') = '0',
    'an empty question gets an empty answer');
  perform pg_temp.as_jwt('service_role');
  perform pg_temp.fails('select * from marketplace.email_suppressed_hashes(array(select repeat(''c'', 64) from generate_series(1, 201)))',
    '22023', 'at most 200', 'more than 200 hashes at a time is refused');
  perform pg_temp.as_jwt('authenticated', 's46_own');
  perform pg_temp.fails(format('select marketplace.suppress_email_address(%L, %L)', c_hash_b, 'bounced'), '42501', 'permission denied',
    'a signed-in person cannot write the list');
  perform pg_temp.fails('select * from marketplace.email_suppressions', '42501', 'permission denied',
    'a signed-in person cannot read the list');
  perform pg_temp.as_jwt('anon');
  perform pg_temp.fails(format('select * from marketplace.email_suppressed_hashes(array[%L])', c_hash_a), '42501', 'permission denied',
    'anon cannot ask the list');
  perform pg_temp.as_jwt('harness');

  -- ---------------------------------------------------------------------------------------------------------------
  -- Fixture: a landing business with two landings, three members, and two hauling businesses.
  -- ---------------------------------------------------------------------------------------------------------------
  perform pg_temp.as_jwt('service_role');
  u_own     := marketplace.sync_verified_identity(c_iss, 's46_own',     'S46 Landing Owner', 'own@s46.test',     true);
  u_quiet   := marketplace.sync_verified_identity(c_iss, 's46_quiet',   'S46 Quiet Staff',   'quiet@s46.test',   true);
  u_limited := marketplace.sync_verified_identity(c_iss, 's46_limited', 'S46 Limited Staff', 'limited@s46.test', true);
  u_haul    := marketplace.sync_verified_identity(c_iss, 's46_haul',    'S46 Hauler',        'haul@s46.test',    true);
  u_haul2   := marketplace.sync_verified_identity(c_iss, 's46_haul2',   'S46 Hauler Two',    'haul2@s46.test',   true);
  perform pg_temp.as_jwt('authenticated', 's46_own');
  o_land := marketplace.create_organization('S46 Landing Co', 's46-landing', 'OR', false);
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_land, 'regional', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_s46', 'sub_s46', false, 7, false);
  perform pg_temp.as_jwt('authenticated', 's46_own');
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_land, 'S46 Main Landing', 'active', 'Near Sisters, OR', marketplace.make_public_point(-121.40, 44.20), 'OR')
  returning id into l_main;
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_land, 'S46 Other Landing', 'active', 'Near Sisters, OR', marketplace.make_public_point(-121.45, 44.22), 'OR')
  returning id into l_other;
  insert into marketplace.landing_private_details (landing_id, org_id, exact_point, directions, gate_instructions, site_contact_name, site_contact_phone)
  values (l_main, o_land, extensions.st_setsrid(extensions.st_makepoint(-121.40, 44.20), 4326)::extensions.geography,
          'S46 road', 'S46 gate', 'S46 Foreman', '+15415550460'),
         (l_other, o_land, extensions.st_setsrid(extensions.st_makepoint(-121.45, 44.22), 4326)::extensions.geography,
          'S46 road 2', 'S46 gate 2', 'S46 Foreman 2', '+15415550461');
  j_main := marketplace.publish_job_posting(l_main, 'S46 Main Haul', array['log_truck'], 1, 'Fir sawlogs', 'Suite 47 haul.', 'per_ton', 500, null,
    1, current_date + 10, 8, 3.0, 6, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  j_other := marketplace.publish_job_posting(l_other, 'S46 Other Haul', array['log_truck'], 1, 'Fir sawlogs', 'Suite 47 haul.', 'per_ton', 500, null,
    1, current_date + 10, 8, 3.0, 6, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  -- Quiet staff: a seat, all landings, but no inquiry notices. Limited staff: a seat on the other landing only.
  v_inv := marketplace.invite_team_member(o_land, 'quiet@s46.test', 'staff', true, interval '7 days');
  perform pg_temp.as_jwt('authenticated', 's46_quiet');
  perform marketplace.accept_team_invitation(v_inv);
  perform pg_temp.as_jwt('authenticated', 's46_own');
  v_inv := marketplace.invite_team_member(o_land, 'limited@s46.test', 'staff', true, interval '7 days', array[l_other]);
  perform pg_temp.as_jwt('authenticated', 's46_limited');
  perform marketplace.accept_team_invitation(v_inv);
  perform pg_temp.as_jwt('harness');
  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled) values
    (u_own, o_land, 'inquiry_reply', 'email', true),
    (u_own, o_land, 'inquiry_reply', 'in_app', true),
    (u_quiet, o_land, 'inquiry_reply', 'email', false),
    (u_limited, o_land, 'inquiry_reply', 'email', true)
  on conflict (user_id, org_id, category, channel) do update set enabled = excluded.enabled;

  perform pg_temp.as_jwt('authenticated', 's46_haul');
  o_haul := marketplace.create_organization('S46 New River Hauling', 's46-haul', 'OR', true);
  perform pg_temp.as_jwt('authenticated', 's46_haul2');
  o_haul2 := marketplace.create_organization('S46 Second Hauling', 's46-haul2', 'OR', true);
  perform pg_temp.as_jwt('harness');
  -- The hauler opted in to its own inquiry notices: a new inquiry it sends must not notify it.
  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled)
  values (u_haul, o_haul, 'inquiry_reply', 'email', true)
  on conflict (user_id, org_id, category, channel) do update set enabled = true;

  -- ---------------------------------------------------------------------------------------------------------------
  -- 46-N: a new inquiry notifies the landing
  -- ---------------------------------------------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 's46_haul');
  select interest_id into e_main from marketplace.submit_expression_of_interest(
    o_haul, j_main, 2, '[]'::jsonb, current_date + 3, null, c_note, 'in_app');
  perform pg_temp.as_jwt('harness');

  perform pg_temp.ok(
    (select count(*) = 2 and bool_and(recipient_user_id = u_own and recipient_org_id = o_land and category = 'inquiry_reply'
                                      and subject_table = 'expressions_of_interest' and subject_id = e_main)
            and count(*) filter (where channel = 'email' and status = 'pending') = 1
            and count(*) filter (where channel = 'in_app' and status = 'delivered') = 1
     from marketplace.notification_outbox where subject_id = e_main),
    'a new inquiry queues one email and one in-app notice for the opted-in owner, and nothing else');
  perform pg_temp.ok(
    not exists (select 1 from marketplace.notification_outbox
                where subject_id = e_main and recipient_user_id in (u_quiet, u_limited, u_haul)),
    'no notice for the member who opted out, the member outside the job''s landing, or the hauler who sent it');

  select payload into v_payload from marketplace.notification_outbox where subject_id = e_main and channel = 'email';
  perform pg_temp.ok(
    v_payload ->> 'event' = 'inquiry_submitted'
    and v_payload ->> 'from_side' = 'hauler'
    and v_payload ->> 'interest_id' = e_main::text
    and v_payload ->> 'job_id' = j_main::text
    and v_payload ->> 'job_title' = 'S46 Main Haul'
    and v_payload ->> 'from_organization_name' = 'S46 New River Hauling'
    and v_payload ->> 'available_from' = (current_date + 3)::text,
    'the payload names the event, the inquiry, the job, its title, the hauling business and the first day offered');
  perform pg_temp.ok(
    v_payload::text not like '%' || c_note || '%'
    and v_payload::text not like '%5415550%'
    and v_payload::text not like '%@%'
    and not (v_payload ? 'message') and not (v_payload ? 'contact_preference'),
    'the payload carries no message, no contact preference, no phone and no address');

  -- Editing the inquiry queues nothing more.
  perform pg_temp.as_jwt('authenticated', 's46_haul');
  perform marketplace.submit_expression_of_interest(o_haul, j_main, 3, '[]'::jsonb, current_date + 4, null, 'S46 edited', 'in_app');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select count(*) = 2 from marketplace.notification_outbox where subject_id = e_main),
    'an edited inquiry queues no second notice');

  -- The member scoped to the other landing hears about an inquiry there; the owner does too.
  perform pg_temp.as_jwt('authenticated', 's46_haul2');
  select interest_id into e_other from marketplace.submit_expression_of_interest(o_haul2, j_other, 1);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(
    (select count(*) filter (where recipient_user_id = u_limited and channel = 'email') = 1
            and count(*) filter (where recipient_user_id = u_own) = 2
            and count(*) filter (where recipient_user_id = u_quiet) = 0
     from marketplace.notification_outbox where subject_id = e_other),
    'a limited member hears about an inquiry on their own landing');

  -- ---------------------------------------------------------------------------------------------------------------
  -- 46-U: the worker's context for one claimed notice
  -- ---------------------------------------------------------------------------------------------------------------
  -- Only this suite's due emails are claimed: the rest are pushed past now for the claim.
  update marketplace.notification_outbox set available_at = now() + interval '1 day'
  where channel = 'email' and status = 'pending' and subject_id <> e_main;
  select o.id into v_id from marketplace.notification_outbox o where o.subject_id = e_main and o.channel = 'email';
  perform pg_temp.as_jwt('service_role');
  select c.claim_token into v_token
  from marketplace.claim_email_notifications(10, interval '5 minutes') c
  where c.notification_id = v_id;
  perform pg_temp.ok(v_id is not null and v_token is not null, 'the worker claims the new-inquiry email');

  perform pg_temp.fails(format('select * from marketplace.notification_email_context(%L::uuid, %L::uuid)', v_id, gen_random_uuid()),
    '55000', 'not claimed with that token', 'another claim token gets no context');
  perform pg_temp.fails(format('select * from marketplace.notification_email_context(%L::uuid, %L::uuid)', gen_random_uuid(), v_token),
    '55000', 'not claimed with that token', 'an unknown notice gets no context');

  select c.queued_at, c.unsubscribe_token, c.invitation_send_count into v_ctx
  from marketplace.notification_email_context(v_id, v_token) c;
  v_queued := v_ctx.queued_at;
  v_unsub := v_ctx.unsubscribe_token;
  select c.unsubscribe_token into v_unsub_again from marketplace.notification_email_context(v_id, v_token) c;
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(
    v_queued = (select created_at from marketplace.notification_outbox where id = v_id)
    and v_ctx.invitation_send_count is null
    and v_unsub ~ '^[A-Za-z0-9_-]+\.[0-9a-f]{64}$' and char_length(v_unsub) between 100 and 512,
    'the context gives the queue time and an unsubscribe token in 31''s format');
  perform pg_temp.ok(v_unsub = v_unsub_again, 'the same notice gets the same token on every call');
  perform pg_temp.ok(
    v_unsub not like '%own@s46%'
    and convert_from(decode(rpad(translate(split_part(v_unsub, '.', 1), '-_', '+/'),
                                 (char_length(split_part(v_unsub, '.', 1)) + 3) / 4 * 4, '='), 'base64'), 'UTF8')
        like 'v1|%|' || u_own || '|' || o_land || '|inquiry_reply|email|%',
    'the token names the recipient, the business, the category and the email channel, and no address');

  -- The token unsubscribes once, signed out, and only that one preference.
  perform pg_temp.as_jwt('anon');
  perform marketplace.unsubscribe_with_token(v_unsub);
  perform marketplace.unsubscribe_with_token(v_unsub);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(
    (select not enabled from marketplace.notification_preferences
     where user_id = u_own and org_id = o_land and category = 'inquiry_reply' and channel = 'email')
    and (select enabled from marketplace.notification_preferences
         where user_id = u_own and org_id = o_land and category = 'inquiry_reply' and channel = 'in_app'),
    'the stable link turns off that recipient''s inquiry email, and only that');
  perform pg_temp.ok(
    (select count(*) = 1 from marketplace.audit_events
     where action = 'notification.unsubscribed' and entity_id = u_own and org_id = o_land),
    'the link was used once: a second click records nothing');

  perform pg_temp.as_jwt('service_role');
  perform pg_temp.ok(marketplace.complete_email_notification(v_id, v_token, 'sent', 'msg-s46-1') = 'sent',
    'the worker completes the notice');
  perform pg_temp.fails(format('select * from marketplace.notification_email_context(%L::uuid, %L::uuid)', v_id, v_token),
    '55000', 'not claimed with that token', 'a completed notice gets no context');
  perform pg_temp.as_jwt('authenticated', 's46_own');
  perform pg_temp.fails(format('select * from marketplace.notification_email_context(%L::uuid, %L::uuid)', v_id, v_token),
    '42501', 'permission denied', 'a signed-in person cannot ask for a notice''s context');
  perform pg_temp.as_jwt('harness');

  -- A team invitation: no member token, and its send count.
  perform pg_temp.as_jwt('authenticated', 's46_own');
  v_inv := marketplace.invite_team_member(o_land, 'newcomer@s46.test', 'driver', false, interval '7 days');
  perform pg_temp.as_jwt('harness');
  update marketplace.notification_outbox set available_at = now() + interval '1 day'
  where channel = 'email' and status = 'pending' and not (subject_table = 'team_invitations' and subject_id = v_inv);
  perform pg_temp.as_jwt('service_role');
  select c.notification_id, c.claim_token into v_id, v_token
  from marketplace.claim_email_notifications(10, interval '5 minutes') c
  where c.category = 'team_invitation';
  select c.queued_at, c.unsubscribe_token, c.invitation_send_count into v_ctx
  from marketplace.notification_email_context(v_id, v_token) c;
  perform pg_temp.ok(v_id is not null and v_ctx.unsubscribe_token is null and v_ctx.invitation_send_count = 1,
    'a team invitation gets no member token here, and its send count');
  perform pg_temp.as_jwt('harness');

  perform pg_temp.ok((select string_agg(version, ',' order by applied_at, version) from marketplace.schema_migrations)
                       = '06,11,12,16,18,23,26,29,31,33,35,38,40,42,44,46',
    'the migration ledger records 46 after 44');

  raise notice 'ALL EMAIL SUPPRESSION (46) TESTS PASSED';
end
$$;

rollback;
