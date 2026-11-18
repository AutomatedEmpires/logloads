-- =============================================================================
-- LogLoads normalized-v2 — 45 regression suite for 44 (reveal ledger, withheld shares, the staff clear through the
-- report queue, per-person counts, the hauler's view of released details, the poster's review date; #403)
--
-- NON-ACTIVE PROTOTYPE TEST SUITE. Disposable PostgreSQL only. Run after 44.
-- Wraps everything in BEGIN ... ROLLBACK. Negative tests require the SQLSTATE and a matching message.
-- Run as the role that applied 44.
-- The phone numbers in this fixture are the only copies. The audit log, the outbox, reports and messages must not
-- contain them. Every clear here happens in the same transaction as the shares before it; a clear's time is then the
-- shares' time, and only shares after a clear count again (44-L), which is why each share after a clear succeeds.
--
-- Cases: four shares then a withdrawal of each (H1), a revoke of each (H2) or a decline of each (H3), and the fifth
-- distinct landing still opens the pause. A paused hauler's reply is kept and only the share is withheld. One person
-- across two businesses (H4, H5) is paused as a person. The queue's dismissal closes a pause; actioned keeps it, and
-- the clear then leaves the resolved report alone. A full window with no pause opens one (H7). The hauler's view of the
-- released details (H6) for its members only, and never for another business, a revoked, declined or withdrawn
-- inquiry, or anon.
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

-- What one person reads directly from the private details table (row-level security, can_view_landing_private).
create function pg_temp.phone_of(p_sub text, p_landing uuid) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.as_jwt('authenticated', p_sub);
  execute format('select site_contact_phone from marketplace.landing_private_details where landing_id = %L', p_landing) into v;
  perform pg_temp.as_jwt('harness');
  return v;
end
$$;

-- hauler_job_access as one person, for one business and one job: 'phone|directions|gate|contact', or '' for no row.
create function pg_temp.access_of(p_sub text, p_org uuid, p_job uuid) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.as_jwt('authenticated', p_sub);
  execute format(
    'select coalesce(string_agg(concat_ws(''|'', a.site_contact_phone, a.directions, a.gate_instructions, a.site_contact_name), '',''), '''') from marketplace.hauler_job_access(%L::uuid, %L::uuid) a',
    p_org, p_job) into v;
  perform pg_temp.as_jwt('harness');
  return v;
end
$$;

-- landing_interest_disclosure as one person: 'shared|phone' or 'unshared|phone', or '' for no row.
create function pg_temp.disclosure_of(p_sub text, p_org uuid, p_interest uuid) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.as_jwt('authenticated', p_sub);
  execute format(
    'select coalesce(string_agg(concat_ws(''|'', case when d.shared_at is null then ''unshared'' else ''shared'' end, d.site_contact_phone), '',''), '''') from marketplace.landing_interest_disclosure(%L::uuid, %L::uuid) d',
    p_org, p_interest) into v;
  perform pg_temp.as_jwt('harness');
  return v;
end
$$;

-- Rows one person reads through a query, as text.
create function pg_temp.read_as(p_sub text, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.as_jwt('authenticated', p_sub);
  execute p_sql into v;
  perform pg_temp.as_jwt('harness');
  return v;
end
$$;

create function pg_temp.open_pauses(p_org uuid, p_user uuid) returns integer language sql as $$
  select count(*)::integer from marketplace.hauler_reveal_pauses
  where cleared_at is null and (hauler_org_id = p_org or user_id = p_user)
$$;

create function pg_temp.shared(p_interest uuid) returns boolean language sql as $$
  select private_details_shared_at is not null from marketplace.expressions_of_interest where id = p_interest
$$;

-- True when the fixture phone digits were copied into a channel that must not carry them.
create function pg_temp.phone_leaked() returns boolean language plpgsql as $$
declare v boolean;
begin
  select exists (
    select 1 from marketplace.audit_events
    where coalesce(reason, '') like '%1541555044%' or metadata::text like '%1541555044%'
  ) or exists (
    select 1 from marketplace.notification_outbox
    where payload::text like '%1541555044%' or coalesce(recipient_email, '') like '%1541555044%'
  ) or exists (
    select 1 from marketplace.interest_messages where body like '%1541555044%'
  ) or exists (
    select 1 from marketplace.abuse_reports
    where coalesce(details, '') like '%1541555044%' or coalesce(resolution_note, '') like '%1541555044%'
  ) or exists (
    select 1 from marketplace.expressions_of_interest where coalesce(message, '') like '%1541555044%'
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
  u_own uuid; u_ldrv uuid; u_h1 uuid; u_h2 uuid; u_h3 uuid; u_multi uuid; u_h6 uuid; u_h6drv uuid; u_h7 uuid;
  u_mod uuid; u_bill uuid; u_sup uuid;
  o_land uuid; o_h1 uuid; o_h2 uuid; o_h3 uuid; o_h4 uuid; o_h5 uuid; o_h6 uuid; o_h7 uuid;
  l_ids uuid[] := array[]::uuid[]; j_ids uuid[] := array[]::uuid[];
  e1 uuid[] := array[]::uuid[]; e2 uuid[] := array[]::uuid[]; e3 uuid[] := array[]::uuid[];
  e4 uuid[] := array[]::uuid[]; e5 uuid[] := array[]::uuid[];
  l uuid; j uuid; e uuid; e_h6 uuid; e_h7 uuid; e_h5_j1 uuid; v_inv uuid;
  i integer;
  v_report uuid; v_pause_org uuid; v_pause_person uuid; v_verified timestamptz;
begin
  perform pg_temp.as_jwt('harness');

  -- ---------------------------------------------------------------------------------------------------------------
  -- Shape and grants
  -- ---------------------------------------------------------------------------------------------------------------
  perform pg_temp.ok(
    (select c.relrowsecurity from pg_class c where c.oid = 'marketplace.phone_reveal_events'::regclass)
    and not exists (select 1 from pg_policies p where p.schemaname = 'marketplace' and p.tablename = 'phone_reveal_events')
    and not exists (select 1 from information_schema.role_table_grants g
                    where g.table_schema = 'marketplace' and g.table_name = 'phone_reveal_events'
                      and g.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role'))
    and not exists (select 1 from information_schema.columns c
                    where c.table_schema = 'marketplace' and c.table_name = 'phone_reveal_events'
                      and c.column_name in ('site_contact_phone', 'phone', 'directions', 'gate_instructions')),
    'the reveal ledger has row-level security, no policy, no client grant, and no phone or access column');
  perform pg_temp.ok(
    has_function_privilege('authenticated', 'marketplace.admin_clear_reveal_pause(uuid,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'marketplace.list_reveal_pauses()', 'EXECUTE')
    and has_function_privilege('authenticated', 'marketplace.hauler_job_access(uuid,uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'marketplace.landing_interest_disclosure(uuid,uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'marketplace.admin_clear_hauler_reveal_pause(uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'marketplace.admin_clear_reveal_pause(uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'marketplace.list_reveal_pauses()', 'EXECUTE')
    and not has_function_privilege('anon', 'marketplace.hauler_job_access(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'marketplace.landing_interest_disclosure(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('service_role', 'marketplace.hauler_job_access(uuid,uuid)', 'EXECUTE')
    and has_function_privilege('anon', 'marketplace.get_marketplace_job(uuid)', 'EXECUTE')
    and has_function_privilege('anon', 'marketplace.list_marketplace_jobs_page(text,text,text,boolean,uuid,numeric,numeric,integer,text,text[],date,jsonb,text,jsonb,integer)', 'EXECUTE')
    and not has_function_privilege('service_role', 'marketplace.get_marketplace_job(uuid)', 'EXECUTE'),
    'grants: the staff list and clear, the hauler view and the landing view are for signed-in people only; the job reads stay public');
  perform pg_temp.ok((
    select bool_and(not has_function_privilege(r, p.oid, 'EXECUTE'))
    from pg_proc p
    cross join unnest(array['anon', 'authenticated', 'service_role']) r
    where p.pronamespace = 'marketplace'::regnamespace
      and p.proname in ('lock_reveal_subjects', 'reveal_paused', 'reveal_window', 'open_reveal_pause', 'audit_share_outcome',
                        'tg_reveal_pause_report_resolved', 'tg_phone_reveal_events_append_only', 'open_hauler_reveal_pause',
                        'tg_hauler_reveal_pause', 'phone_reveal_pause_limit')
  ), 'the ledger, window, opener and trigger functions are callable by no client role');
  perform pg_temp.ok((
    select bool_and(p.prosrc not like '%site_contact_phone%')
    from pg_proc p
    where p.pronamespace = 'marketplace'::regnamespace
      and p.proname in ('lock_reveal_subjects', 'reveal_paused', 'reveal_window', 'open_reveal_pause', 'audit_share_outcome',
                        'tg_reveal_pause_report_resolved', 'tg_hauler_reveal_pause', 'open_hauler_reveal_pause',
                        'admin_clear_reveal_pause', 'admin_clear_hauler_reveal_pause', 'list_reveal_pauses', 'respond_to_interest')
  ), 'no pause, ledger or clear function reads the phone column; only the two views do');
  perform pg_temp.ok(
    (select count(*) = 2 from pg_trigger t where t.tgrelid = 'marketplace.expressions_of_interest'::regclass
       and t.tgname in ('hauler_reveal_pause_before', 'hauler_reveal_pause_after') and not t.tgisinternal)
    and exists (select 1 from pg_trigger t where t.tgrelid = 'marketplace.abuse_reports'::regclass
                  and t.tgname = 'reveal_pause_report_resolved' and not t.tgisinternal),
    'the share triggers are still installed, and the report queue has its pause trigger');

  perform pg_temp.as_jwt('service_role');
  u_own    := marketplace.sync_verified_identity(c_iss, 's44_own',    'S44 Landing Owner',  'own@s44.test',    true);
  u_ldrv   := marketplace.sync_verified_identity(c_iss, 's44_ldrv',   'S44 Landing Driver', 'ldrv@s44.test',   true);
  u_h1     := marketplace.sync_verified_identity(c_iss, 's44_h1',     'S44 Withdraw Owner', 'h1@s44.test',     true);
  u_h2     := marketplace.sync_verified_identity(c_iss, 's44_h2',     'S44 Revoke Owner',   'h2@s44.test',     true);
  u_h3     := marketplace.sync_verified_identity(c_iss, 's44_h3',     'S44 Decline Owner',  'h3@s44.test',     true);
  u_multi  := marketplace.sync_verified_identity(c_iss, 's44_multi',  'S44 Multi Owner',    'multi@s44.test',  true);
  u_h6     := marketplace.sync_verified_identity(c_iss, 's44_h6',     'S44 Access Owner',   'h6@s44.test',     true);
  u_h6drv  := marketplace.sync_verified_identity(c_iss, 's44_h6drv',  'S44 Access Driver',  'h6drv@s44.test',  true);
  u_h7     := marketplace.sync_verified_identity(c_iss, 's44_h7',     'S44 History Owner',  'h7@s44.test',     true);
  u_mod    := marketplace.sync_verified_identity(c_iss, 's44_mod',    'S44 Moderator',      'mod@s44.test',    true);
  u_bill   := marketplace.sync_verified_identity(c_iss, 's44_bill',   'S44 Billing Admin',  'bill@s44.test',   true);
  u_sup    := marketplace.sync_verified_identity(c_iss, 's44_sup',    'S44 Support Admin',  'sup@s44.test',    true);
  perform pg_temp.as_jwt('harness');
  insert into marketplace.platform_admins (user_id, admin_role, note) values
    (u_mod, 'moderator', 'suite 45'),
    (u_bill, 'billing', 'suite 45'),
    (u_sup, 'support', 'suite 45');

  perform pg_temp.as_jwt('authenticated', 's44_own');
  o_land := marketplace.create_organization('S44 Landing Co', 's44-landing', 'OR', false);
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_land, 'regional', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_s44', 'sub_s44', false, 7, false);
  perform pg_temp.as_jwt('authenticated', 's44_own');
  for i in 1..7 loop
    insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
    values (o_land, 'S44 Landing ' || i, 'active', 'Near Sisters, OR', marketplace.make_public_point(-121.40 - (i * 0.01), 44.20), 'OR')
    returning id into l;
    insert into marketplace.landing_private_details (landing_id, org_id, exact_point, directions, gate_instructions, site_contact_name, site_contact_phone)
    values (
      l, o_land,
      extensions.st_setsrid(extensions.st_makepoint(-121.40 - (i * 0.01), 44.20), 4326)::extensions.geography,
      'S44 road ' || i, 'S44 gate ' || i, 'S44 Foreman ' || i, '+1541555044' || i::text
    );
    j := marketplace.publish_job_posting(l, 'S44 Haul ' || i, array['log_truck'], 1, 'Fir sawlogs', 'Suite 45 haul.', 'per_ton', 500, null,
      1, current_date + 10, 8, 3.0, 6, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
    l_ids := array_append(l_ids, l);
    j_ids := array_append(j_ids, j);
  end loop;
  v_inv := marketplace.invite_team_member(o_land, 'ldrv@s44.test', 'driver', false, interval '7 days');
  perform pg_temp.as_jwt('authenticated', 's44_ldrv');
  perform marketplace.accept_team_invitation(v_inv);

  -- Hauling businesses. H1, H2 and H3 each send interest on jobs 1 to 6.
  perform pg_temp.as_jwt('authenticated', 's44_h1');
  o_h1 := marketplace.create_organization('S44 Withdraw Hauling', 's44-h1', 'OR', true);
  for i in 1..6 loop
    select interest_id into e from marketplace.submit_expression_of_interest(o_h1, j_ids[i], 1);
    e1 := array_append(e1, e);
  end loop;
  perform pg_temp.as_jwt('authenticated', 's44_h2');
  o_h2 := marketplace.create_organization('S44 Revoke Hauling', 's44-h2', 'OR', true);
  for i in 1..6 loop
    select interest_id into e from marketplace.submit_expression_of_interest(o_h2, j_ids[i], 1);
    e2 := array_append(e2, e);
  end loop;
  perform pg_temp.as_jwt('authenticated', 's44_h3');
  o_h3 := marketplace.create_organization('S44 Decline Hauling', 's44-h3', 'OR', true);
  for i in 1..6 loop
    select interest_id into e from marketplace.submit_expression_of_interest(o_h3, j_ids[i], 1);
    e3 := array_append(e3, e);
  end loop;
  -- One person, two businesses: H4 on jobs 1, 2 and 6; H5 on jobs 3, 4 and 5, and on job 1 (never shared).
  perform pg_temp.as_jwt('authenticated', 's44_multi');
  o_h4 := marketplace.create_organization('S44 Multi Hauling North', 's44-h4', 'OR', true);
  o_h5 := marketplace.create_organization('S44 Multi Hauling South', 's44-h5', 'OR', true);
  foreach i in array array[1, 2, 6] loop
    select interest_id into e from marketplace.submit_expression_of_interest(o_h4, j_ids[i], 1);
    e4 := array_append(e4, e);
  end loop;
  foreach i in array array[3, 4, 5] loop
    select interest_id into e from marketplace.submit_expression_of_interest(o_h5, j_ids[i], 1);
    e5 := array_append(e5, e);
  end loop;
  select interest_id into e_h5_j1 from marketplace.submit_expression_of_interest(o_h5, j_ids[1], 1);
  -- H6 (owner and driver) on job 7; H7 on job 6.
  perform pg_temp.as_jwt('authenticated', 's44_h6');
  o_h6 := marketplace.create_organization('S44 Access Hauling', 's44-h6', 'OR', true);
  select interest_id into e_h6 from marketplace.submit_expression_of_interest(o_h6, j_ids[7], 1);
  v_inv := marketplace.invite_team_member(o_h6, 'h6drv@s44.test', 'driver', false, interval '7 days');
  perform pg_temp.as_jwt('authenticated', 's44_h6drv');
  perform marketplace.accept_team_invitation(v_inv);
  perform pg_temp.as_jwt('authenticated', 's44_h7');
  o_h7 := marketplace.create_organization('S44 History Hauling', 's44-h7', 'OR', true);
  select interest_id into e_h7 from marketplace.submit_expression_of_interest(o_h7, j_ids[6], 1);

  -- ---------------------------------------------------------------------------------------------------------------
  -- 44-L: four shares, then a WITHDRAWAL of each; the fifth distinct landing still opens the pause (H1)
  -- ---------------------------------------------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 's44_own');
  for i in 1..4 loop
    perform marketplace.respond_to_interest(e1[i], 'replied', true, null, c_body);
  end loop;
  perform pg_temp.as_jwt('authenticated', 's44_h1');
  for i in 1..4 loop
    perform marketplace.withdraw_interest(e1[i]);
  end loop;
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(
    (select count(*) = 0 from marketplace.expressions_of_interest where hauler_org_id = o_h1 and private_details_shared_at is not null)
    and (select count(*) = 4 from marketplace.phone_reveal_events where hauler_org_id = o_h1)
    and (select count(distinct landing_id) = 4 from marketplace.phone_reveal_events where hauler_org_id = o_h1 and submitted_by = u_h1),
    '44-L: after four shares are withdrawn no share is live, and the ledger still holds the four reveals');
  perform pg_temp.as_jwt('authenticated', 's44_own');
  perform marketplace.respond_to_interest(e1[5], 'replied', true, null, c_body);
  perform pg_temp.as_jwt('harness');
  select p.id, p.report_id into v_pause_org, v_report from marketplace.hauler_reveal_pauses p
  where p.hauler_org_id = o_h1 and p.cleared_at is null;
  select p.id into v_pause_person from marketplace.hauler_reveal_pauses p where p.user_id = u_h1 and p.cleared_at is null;
  perform pg_temp.ok(v_pause_org is not null and pg_temp.shared(e1[5]),
    '44-L: the fifth distinct landing is shared and opens the pause, although the first four were withdrawn');
  perform pg_temp.ok(v_pause_person is not null
    and (select report_id = v_report from marketplace.hauler_reveal_pauses where id = v_pause_person),
    '44-P: the one person behind those inquiries is paused too, under the same report');
  perform pg_temp.ok(exists (
    select 1 from marketplace.abuse_reports
    where id = v_report and reporter_user_id is null and status = 'open' and reason = 'unsafe_disclosure'
      and target_kind = 'organization' and target_id = o_h1
  ), '44-S: the report is filed by LogLoads (no member reporter) against the hauling business');
  perform pg_temp.ok(
    (select count(*) = 2 from marketplace.audit_events where action = 'hauler_reveal.paused' and org_id is null
       and (entity_id = o_h1 or entity_id = u_h1))
    and not exists (select 1 from marketplace.audit_events where action = 'hauler_reveal.paused' and org_id is not null
                      and entity_id in (o_h1, u_h1)),
    '44-S: the pause audit rows name no organization, so only staff read them');

  -- 44-W: the sixth landing replies; the reply is kept, the share is withheld, and nothing errors.
  perform pg_temp.as_jwt('authenticated', 's44_own');
  perform marketplace.respond_to_interest(e1[6], 'replied', true, null, c_body);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(
    (select status = 'replied' and private_details_shared_at is null and private_details_shared_by is null
       from marketplace.expressions_of_interest where id = e1[6])
    and exists (select 1 from marketplace.interest_messages where interest_id = e1[6] and author_side = 'landing' and body = c_body)
    and pg_temp.phone_of('s44_h1', l_ids[6]) is null
    and not exists (select 1 from marketplace.phone_reveal_events where interest_id = e1[6]),
    '44-W: a paused hauler gets the reply; only the share is withheld, and it is not in the ledger');
  perform pg_temp.ok(
    exists (select 1 from marketplace.audit_events where action = 'landing_private.share_withheld' and entity_id = e1[6] and org_id is null)
    and not exists (select 1 from marketplace.audit_events where action = 'landing_private.shared' and entity_id = e1[6]),
    '44-W: the withheld share is audited for staff only and is not recorded as shared');
  perform pg_temp.as_jwt('authenticated', 's44_own');
  perform marketplace.respond_to_interest(e1[6], 'viewed', true);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(not pg_temp.shared(e1[6]) and (select status = 'replied' from marketplace.expressions_of_interest where id = e1[6]),
    '44-W: a later Show my number on the replied inquiry is withheld too, without an error');
  perform pg_temp.ok(
    pg_temp.read_as('s44_own', $q$select count(*)::text from marketplace.audit_events
      where action in ('hauler_reveal.paused', 'hauler_reveal.pause_cleared', 'landing_private.share_withheld')$q$) = '0'
    and pg_temp.read_as('s44_h1', $q$select count(*)::text from marketplace.audit_events
      where action in ('hauler_reveal.paused', 'hauler_reveal.pause_cleared', 'landing_private.share_withheld')$q$) = '0'
    and pg_temp.read_as('s44_own', $q$select count(*)::text from marketplace.abuse_reports where reason = 'unsafe_disclosure'$q$) = '0'
    and pg_temp.read_as('s44_h1', $q$select count(*)::text from marketplace.abuse_reports where reason = 'unsafe_disclosure'$q$) = '0',
    '44-W/44-S: neither the landing owner nor the hauler owner can read the hold, its report or a withheld share');

  -- ---------------------------------------------------------------------------------------------------------------
  -- 44-L: four shares, then a landing REVOKE of each (H2); 44-Q: dismissing the report in the queue closes the pause
  -- ---------------------------------------------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 's44_own');
  for i in 1..4 loop
    perform marketplace.respond_to_interest(e2[i], 'replied', true, null, c_body);
  end loop;
  for i in 1..4 loop
    perform marketplace.respond_to_interest(e2[i], 'viewed', false);
  end loop;
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(
    (select count(*) = 0 from marketplace.expressions_of_interest where hauler_org_id = o_h2 and private_details_shared_at is not null)
    and pg_temp.phone_of('s44_h2', l_ids[1]) is null,
    '44-L: a revoke ends the hauler''s read at once');
  perform pg_temp.as_jwt('authenticated', 's44_own');
  perform marketplace.respond_to_interest(e2[5], 'replied', true, null, c_body);
  perform pg_temp.as_jwt('harness');
  select report_id into v_report from marketplace.hauler_reveal_pauses where hauler_org_id = o_h2 and cleared_at is null;
  perform pg_temp.ok(v_report is not null and pg_temp.open_pauses(o_h2, u_h2) = 2 and pg_temp.shared(e2[5]),
    '44-L: after four revokes the fifth distinct landing still opens the pause');
  perform pg_temp.as_jwt('authenticated', 's44_mod');
  perform marketplace.admin_resolve_report(v_report, 'dismissed', 'Reviewed in the queue; nothing found');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.open_pauses(o_h2, u_h2) = 0
    and (select bool_and(cleared_by = u_mod) from marketplace.hauler_reveal_pauses where report_id = v_report)
    and (select count(*) = 2 from marketplace.audit_events
         where action = 'hauler_reveal.pause_cleared' and org_id is null and metadata ->> 'via' = 'report_dismissed'
           and metadata ->> 'report_id' = v_report::text),
    '44-Q: dismissing the report in the #255 queue closes both pauses filed under it, audited');
  perform pg_temp.as_jwt('authenticated', 's44_own');
  perform marketplace.respond_to_interest(e2[6], 'replied', true, null, c_body);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.shared(e2[6]) and pg_temp.phone_of('s44_h2', l_ids[6]) = '+15415550446',
    '44-Q: after the queue dismissed it, the next landing shares again');

  -- ---------------------------------------------------------------------------------------------------------------
  -- 44-L: four shares, then a DECLINE of each (H3); the legacy clear by business dismisses an open report
  -- ---------------------------------------------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 's44_own');
  for i in 1..4 loop
    perform marketplace.respond_to_interest(e3[i], 'replied', true, null, c_body);
  end loop;
  for i in 1..4 loop
    perform marketplace.respond_to_interest(e3[i], 'declined', null, gen_random_uuid(), 'Filled for this week');
  end loop;
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(
    (select count(*) = 0 from marketplace.expressions_of_interest where hauler_org_id = o_h3 and private_details_shared_at is not null),
    '44-L: four declines leave no live share');
  perform pg_temp.as_jwt('authenticated', 's44_own');
  perform marketplace.respond_to_interest(e3[5], 'replied', true, null, c_body);
  perform pg_temp.as_jwt('harness');
  select report_id into v_report from marketplace.hauler_reveal_pauses where hauler_org_id = o_h3 and cleared_at is null;
  perform pg_temp.ok(v_report is not null and pg_temp.open_pauses(o_h3, u_h3) = 2,
    '44-L: after four declines the fifth distinct landing still opens the pause');
  perform pg_temp.as_jwt('authenticated', 's44_bill');
  perform pg_temp.fails(
    format('select marketplace.admin_clear_hauler_reveal_pause(%L::uuid, %L)', o_h3, 'Billing cannot clear a reveal pause'),
    '42501', 'moderator', 'a billing admin cannot clear a pause by business');
  perform pg_temp.as_jwt('authenticated', 's44_mod');
  perform marketplace.admin_clear_hauler_reveal_pause(o_h3, 'Staff reviewed the hauler and releases may resume');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.open_pauses(o_h3, u_h3) = 0
    and (select status = 'dismissed' and resolution_note = 'Closed when LogLoads staff cleared the phone-reveal pause.'
           and resolution_note not like '%Staff reviewed%' from marketplace.abuse_reports where id = v_report)
    and exists (select 1 from marketplace.audit_events where action = 'hauler_reveal.pause_cleared' and entity_id = o_h3
                  and reason = 'Staff reviewed the hauler and releases may resume' and org_id is null),
    '44-Q/44-S: the clear dismisses the open report with a fixed note; the staff reason is on the audit row only');

  -- ---------------------------------------------------------------------------------------------------------------
  -- 44-Q: a report marked ACTIONED keeps the pauses (H1); the clear then skips the resolved report
  -- ---------------------------------------------------------------------------------------------------------------
  select report_id into v_report from marketplace.hauler_reveal_pauses where id = v_pause_org;
  perform pg_temp.as_jwt('authenticated', 's44_mod');
  perform marketplace.admin_resolve_report(v_report, 'actioned', 'Hauler warned about collecting numbers');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.open_pauses(o_h1, u_h1) = 2, '44-Q: marking the report actioned keeps the hauler paused');
  perform pg_temp.as_jwt('authenticated', 's44_sup');
  perform pg_temp.ok((select count(*) = 2 from marketplace.list_reveal_pauses() p
                      where p.report_id = v_report and p.report_status = 'actioned'
                        and ((p.subject_kind = 'organization' and p.subject_id = o_h1 and p.subject_name = 'S44 Withdraw Hauling')
                          or (p.subject_kind = 'person' and p.subject_id = u_h1 and p.subject_name = 'S44 Withdraw Owner'))
                        and p.landings_in_window = 5),
    '44-Q: support lists the open pauses with their subject, report status and landing count');
  perform pg_temp.fails(
    format('select marketplace.admin_clear_reveal_pause(%L::uuid, %L)', v_pause_org, 'Support cannot clear a reveal pause'),
    '42501', 'moderator', 'a support admin can list the pauses but not clear one');
  perform pg_temp.as_jwt('authenticated', 's44_own');
  perform pg_temp.fails('select count(*) from marketplace.list_reveal_pauses()', '42501', 'moderator or support',
    'a landing member cannot list the pauses');
  perform pg_temp.as_jwt('authenticated', 's44_mod');
  perform pg_temp.fails(
    format('select marketplace.admin_clear_reveal_pause(%L::uuid, %L)', v_pause_org, 'no'),
    '22023', '5 to 500', 'a clear needs a reason of 5 to 500 characters');
  perform marketplace.admin_clear_reveal_pause(v_pause_org, 'Staff lifted the pause after the warning');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(
    (select cleared_at is not null and cleared_by = u_mod from marketplace.hauler_reveal_pauses where id = v_pause_org)
    and (select status = 'actioned' and resolution_note = 'Hauler warned about collecting numbers' from marketplace.abuse_reports where id = v_report)
    and pg_temp.open_pauses(null, u_h1) = 1,
    '44-Q: the clear closes the business pause and leaves the actioned report as it was; the person pause stays');
  perform pg_temp.as_jwt('authenticated', 's44_own');
  perform marketplace.respond_to_interest(e1[6], 'viewed', true);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(not pg_temp.shared(e1[6]), '44-P: the open person pause still withholds the share');
  perform pg_temp.as_jwt('authenticated', 's44_mod');
  perform marketplace.admin_clear_reveal_pause(v_pause_person, 'Staff lifted the person pause after the warning');
  perform pg_temp.fails(
    format('select marketplace.admin_clear_reveal_pause(%L::uuid, %L)', v_pause_person, 'Staff cleared it already'),
    'P0002', 'not found', 'clearing a pause that is already closed is refused');
  perform pg_temp.as_jwt('authenticated', 's44_own');
  perform marketplace.respond_to_interest(e1[6], 'viewed', true);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.shared(e1[6]) and pg_temp.phone_of('s44_h1', l_ids[6]) = '+15415550446'
    and (select status = 'actioned' from marketplace.abuse_reports where id = v_report),
    '44-Q: with both pauses cleared the landing shares again, and the report keeps its outcome');

  -- ---------------------------------------------------------------------------------------------------------------
  -- 44-P: one person across two businesses (H4 and H5) is paused as a person; neither business reached five
  -- ---------------------------------------------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 's44_own');
  perform marketplace.respond_to_interest(e4[1], 'replied', true, null, c_body);
  perform marketplace.respond_to_interest(e4[2], 'replied', true, null, c_body);
  perform marketplace.respond_to_interest(e5[1], 'replied', true, null, c_body);
  perform marketplace.respond_to_interest(e5[2], 'replied', true, null, c_body);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.open_pauses(o_h4, u_multi) + pg_temp.open_pauses(o_h5, null) = 0,
    '44-P: four distinct landings for one person across two businesses stay under the pause');
  perform pg_temp.as_jwt('authenticated', 's44_own');
  perform marketplace.respond_to_interest(e5[3], 'replied', true, null, c_body);
  perform pg_temp.as_jwt('harness');
  select p.id, p.report_id into v_pause_person, v_report from marketplace.hauler_reveal_pauses p
  where p.user_id = u_multi and p.cleared_at is null;
  perform pg_temp.ok(v_pause_person is not null and pg_temp.shared(e5[3])
    and pg_temp.open_pauses(o_h4, null) = 0 and pg_temp.open_pauses(o_h5, null) = 0
    and exists (select 1 from marketplace.abuse_reports where id = v_report and reporter_user_id is null
                  and target_kind = 'user' and target_id = u_multi),
    '44-P: the fifth landing for that person opens a person pause, filed by LogLoads against the person; neither business is paused');
  perform pg_temp.as_jwt('authenticated', 's44_own');
  perform marketplace.respond_to_interest(e4[3], 'replied', true, null, c_body);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(not pg_temp.shared(e4[3]) and (select status = 'replied' from marketplace.expressions_of_interest where id = e4[3]),
    '44-P: the paused person''s other business gets the reply and not the share');
  perform pg_temp.as_jwt('authenticated', 's44_mod');
  perform pg_temp.ok((select count(*) = 1 from marketplace.list_reveal_pauses() p
                      where p.pause_id = v_pause_person and p.subject_kind = 'person' and p.subject_name = 'S44 Multi Owner'
                        and p.report_status = 'open' and p.landings_in_window = 5),
    '44-Q: a moderator lists the person pause by the person''s name');
  perform marketplace.admin_clear_reveal_pause(v_pause_person, 'Two real businesses; staff confirmed both');
  perform pg_temp.as_jwt('authenticated', 's44_own');
  perform marketplace.respond_to_interest(e4[3], 'viewed', true);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.shared(e4[3]) and (select status = 'dismissed' from marketplace.abuse_reports where id = v_report),
    '44-P: after the clear the person''s business shares again, and the report is dismissed');

  -- ---------------------------------------------------------------------------------------------------------------
  -- 44-L: a full window with no pause open (history from before 44) opens the pause instead of letting a share past (H7)
  -- ---------------------------------------------------------------------------------------------------------------
  insert into marketplace.phone_reveal_events (interest_id, hauler_org_id, submitted_by, landing_id, revealed_at)
  select gen_random_uuid(), o_h7, u_h7, l_ids[k], now() - interval '1 hour' from generate_series(1, 5) k;
  perform pg_temp.as_jwt('authenticated', 's44_own');
  perform marketplace.respond_to_interest(e_h7, 'replied', true, null, c_body);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(not pg_temp.shared(e_h7) and pg_temp.open_pauses(o_h7, u_h7) = 2
    and (select status = 'replied' from marketplace.expressions_of_interest where id = e_h7),
    '44-L: five landings already in the ledger withhold the next share and open the pause for staff');
  perform pg_temp.fails('update marketplace.phone_reveal_events set revealed_at = now() where hauler_org_id = ''' || o_h7 || '''',
    '42501', 'append-only', 'the ledger cannot be updated, even by its owner');
  perform pg_temp.fails('delete from marketplace.phone_reveal_events where hauler_org_id = ''' || o_h7 || '''',
    '42501', 'append-only', 'the ledger cannot be deleted from, even by its owner');
  perform pg_temp.as_jwt('authenticated', 's44_h7');
  perform pg_temp.fails('select count(*) from marketplace.phone_reveal_events', '42501', 'permission denied',
    'a signed-in member cannot read the ledger');
  perform pg_temp.fails(
    format('insert into marketplace.abuse_reports (reporter_user_id, target_kind, target_id, reason) values (null, %L, %L::uuid, %L)',
      'organization', o_h1, 'unsafe_disclosure'),
    '42501', 'permission denied', '44-S: a member cannot file a report without a reporter');
  perform pg_temp.as_jwt('harness');

  -- ---------------------------------------------------------------------------------------------------------------
  -- 44-H: the hauler's view of released details (H6), and the landing's view of its own disclosure
  -- ---------------------------------------------------------------------------------------------------------------
  perform pg_temp.ok(pg_temp.access_of('s44_h6', o_h6, j_ids[7]) = ''
    and pg_temp.disclosure_of('s44_own', o_land, e_h6) = 'unshared|+15415550447',
    '44-H: before a reply and a share the hauler sees nothing, and the landing sees its own number to offer');
  perform pg_temp.as_jwt('authenticated', 's44_own');
  perform marketplace.respond_to_interest(e_h6, 'replied', null, null, c_body);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.access_of('s44_h6', o_h6, j_ids[7]) = '',
    '44-H: a reply without the opt-in shows the hauler nothing');
  perform pg_temp.as_jwt('authenticated', 's44_own');
  perform marketplace.respond_to_interest(e_h6, 'viewed', true);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(
    pg_temp.access_of('s44_h6', o_h6, j_ids[7]) = '+15415550447|S44 road 7|S44 gate 7|S44 Foreman 7'
    and pg_temp.access_of('s44_h6drv', o_h6, j_ids[7]) = '+15415550447|S44 road 7|S44 gate 7|S44 Foreman 7'
    and pg_temp.disclosure_of('s44_own', o_land, e_h6) = 'shared|+15415550447',
    '44-H: while the release is live the hauler''s owner and driver read the access notes, gate details and phone');
  perform pg_temp.ok(
    pg_temp.access_of('s44_h2', o_h6, j_ids[7]) = ''
    and pg_temp.access_of('s44_h2', o_h2, j_ids[7]) = ''
    and pg_temp.access_of('s44_ldrv', o_h6, j_ids[7]) = ''
    and pg_temp.access_of('s44_own', o_h6, j_ids[7]) = '',
    '44-H: another business, a landing driver and the landing owner get no row for that hauler''s job');
  perform pg_temp.ok(
    pg_temp.access_of('s44_multi', o_h4, j_ids[1]) = '+15415550441|S44 road 1|S44 gate 1|S44 Foreman 1'
    and pg_temp.access_of('s44_multi', o_h5, j_ids[1]) = '',
    '44-H: one person in two businesses reads only what was released to the business named');
  perform pg_temp.ok(
    pg_temp.disclosure_of('s44_ldrv', o_land, e_h6) = ''
    and pg_temp.disclosure_of('s44_h6', o_land, e_h6) = ''
    and pg_temp.disclosure_of('s44_own', o_h6, e_h6) = '',
    '44-H: the landing view is for the landing desk of the inquiry''s own business only');
  perform pg_temp.as_jwt('anon');
  perform pg_temp.fails(format('select count(*) from marketplace.hauler_job_access(%L::uuid, %L::uuid)', o_h6, j_ids[7]),
    '42501', 'permission denied', '44-H: anon cannot call the hauler view');
  perform pg_temp.fails(format('select count(*) from marketplace.landing_interest_disclosure(%L::uuid, %L::uuid)', o_land, e_h6),
    '42501', 'permission denied', '44-H: anon cannot call the landing view');
  perform pg_temp.as_jwt('authenticated', 's44_own');
  perform marketplace.respond_to_interest(e_h6, 'viewed', false);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.access_of('s44_h6', o_h6, j_ids[7]) = '' and pg_temp.access_of('s44_h6drv', o_h6, j_ids[7]) = ''
    and pg_temp.phone_of('s44_h6', l_ids[7]) is null
    and pg_temp.disclosure_of('s44_own', o_land, e_h6) = 'unshared|+15415550447',
    '44-H: a revoke removes the hauler''s view at once');
  perform pg_temp.as_jwt('authenticated', 's44_own');
  perform marketplace.respond_to_interest(e_h6, 'viewed', true);
  perform marketplace.respond_to_interest(e_h6, 'declined', null, gen_random_uuid(), 'Filled for this week');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.access_of('s44_h6', o_h6, j_ids[7]) = '',
    '44-H: a decline removes the hauler''s view');
  perform pg_temp.ok(pg_temp.access_of('s44_h1', o_h1, j_ids[1]) = '',
    '44-H: a withdrawn inquiry shows nothing');

  -- ---------------------------------------------------------------------------------------------------------------
  -- 44-V: the poster's review date on the two job reads
  -- ---------------------------------------------------------------------------------------------------------------
  perform pg_temp.as_jwt('anon');
  perform pg_temp.ok((select poster_verified is false and poster_verified_at is null from marketplace.get_marketplace_job(j_ids[1])),
    '44-V: an unreviewed poster has no review date');
  perform pg_temp.as_jwt('authenticated', 's44_mod');
  perform marketplace.admin_set_org_verification(o_land, 'verified', 'Business documents reviewed for suite 45');
  perform pg_temp.as_jwt('harness');
  select o.verified_at into v_verified from marketplace.organizations o where o.id = o_land;
  perform pg_temp.as_jwt('anon');
  perform pg_temp.ok(v_verified is not null
                     and (select g.poster_verified and g.poster_verified_at = v_verified from marketplace.get_marketplace_job(j_ids[1]) g),
    '44-V: get_marketplace_job carries the reviewed poster''s review date');
  perform pg_temp.ok((select bool_and(p.poster_verified and p.poster_verified_at is not null) and count(*) >= 1
                      from marketplace.list_marketplace_jobs_page(p_query => 'S44 Haul', p_limit => 50) p
                      where p.poster_organization_id = o_land),
    '44-V: list_marketplace_jobs_page carries it too');
  perform pg_temp.as_jwt('harness');

  -- ---------------------------------------------------------------------------------------------------------------
  -- The phone stays out of every channel
  -- ---------------------------------------------------------------------------------------------------------------
  perform pg_temp.ok(not pg_temp.phone_leaked(),
    'the audit log, the outbox, reports, resolution notes and messages do not contain the phone');
  perform pg_temp.ok((select count(*) = 0 from marketplace.audit_events a
                      where (a.action like 'hauler_reveal.%' or a.action = 'landing_private.share_withheld') and a.org_id is not null
                        and a.entity_id in (o_h1, o_h2, o_h3, o_h4, o_h5, o_h6, o_h7, u_h1, u_h2, u_h3, u_multi, u_h6, u_h7)),
    'every pause and clear audit row is staff only');
  perform pg_temp.ok((select string_agg(version, ',' order by applied_at, version) from marketplace.schema_migrations)
                       = '06,11,12,16,18,23,26,29,31,33,35,38,40,42,44',
    'the migration ledger records 44 after 42');

  raise notice 'ALL REVEAL LEDGER (44) TESTS PASSED';
end
$$;

rollback;
