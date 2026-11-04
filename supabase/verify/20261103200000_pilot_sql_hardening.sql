-- ============================================================================
-- Behavioural checks for migration 20261103200000_pilot_sql_hardening.sql
-- (#187 HF-19, HF-20, HF-21).
--
-- Run by tools/db-check.sh right after `supabase db reset --local`, as the
-- migration role (postgres), on the disposable local stack only. Everything
-- runs inside one transaction that is rolled back, so no fixture survives.
-- Each failed expectation raises; ON_ERROR_STOP turns that into a non-zero
-- exit, which fails `pnpm db:check` / `pnpm db:assert`.
-- ============================================================================
\set ON_ERROR_STOP on

begin;

-- Runs one statement as p_role with the given JWT claims and returns its single
-- value as text. Role and claims are reset before returning.
create function pg_temp.value_as(p_role text, p_claims text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_result text;
begin
  perform pg_catalog.set_config('request.jwt.claims', coalesce(p_claims, ''), true);
  execute pg_catalog.format('set local role %I', p_role);
  execute p_sql into v_result;
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

-- Runs one statement as p_role and requires it to fail with p_sqlstate (and,
-- when given, a message matching p_message_like). Its effects are rolled back.
create function pg_temp.expect_refused(
  p_label text,
  p_role text,
  p_claims text,
  p_sql text,
  p_sqlstate text,
  p_message_like text default null
)
returns void
language plpgsql
as $$
declare
  v_state text;
  v_message text;
begin
  begin
    perform pg_catalog.set_config('request.jwt.claims', coalesce(p_claims, ''), true);
    execute pg_catalog.format('set local role %I', p_role);
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claims', '', true);

  if v_state is null then
    raise exception 'FAIL %: the statement succeeded; expected SQLSTATE %', p_label, p_sqlstate;
  end if;

  if v_state <> p_sqlstate or (p_message_like is not null and v_message not like p_message_like) then
    raise exception 'FAIL %: got % (%); expected % (%)',
      p_label, v_state, v_message, p_sqlstate, coalesce(p_message_like, 'any message');
  end if;

  raise notice 'ok: % refused with %', p_label, v_state;
end;
$$;

create function pg_temp.expect(p_label text, p_condition boolean)
returns void
language plpgsql
as $$
begin
  if p_condition is distinct from true then
    raise exception 'FAIL %', p_label;
  end if;

  raise notice 'ok: %', p_label;
end;
$$;

do $$
declare
  -- Fixtures. Clerk ids are obviously fake; every row is rolled back.
  v_host uuid := gen_random_uuid();
  v_hauler uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid();
  v_host_user uuid := gen_random_uuid();
  v_driver_a_user uuid := gen_random_uuid();
  v_driver_b_user uuid := gen_random_uuid();
  v_spare_user uuid := gen_random_uuid();
  v_host_dispatcher uuid := gen_random_uuid();
  v_landing uuid := gen_random_uuid();
  v_mill uuid := gen_random_uuid();
  v_shared_mill uuid := gen_random_uuid();
  v_route uuid := gen_random_uuid();
  v_rate uuid := gen_random_uuid();
  v_load uuid := gen_random_uuid();
  v_slot uuid := gen_random_uuid();
  v_driver_a uuid := gen_random_uuid();
  v_driver_b uuid := gen_random_uuid();
  v_truck_a uuid := gen_random_uuid();
  v_truck_a_archived uuid := gen_random_uuid();
  v_truck_b uuid := gen_random_uuid();
  v_trailer_a uuid := gen_random_uuid();
  v_trailer_b uuid := gen_random_uuid();
  v_actor_claims text := '{"role":"service_role","sub":"user_hf187_actor"}';
  v_spare_claims text := '{"role":"authenticated","sub":"user_hf187_spare"}';
  v_host_claims text := '{"role":"authenticated","sub":"user_hf187_host"}';
  v_ids text;
  v_assignment uuid;
  v_audit uuid;
  v_call text;
begin
  insert into public.companies (id, slug, legal_name, display_name, primary_region, contact_name, contact_phone)
  values
    (v_host, 'hf187-host', 'HF187 Host LLC', 'HF187 Host', 'Test Region', 'Host Contact', '555-0100'),
    (v_hauler, 'hf187-hauler', 'HF187 Hauler LLC', 'HF187 Hauler', 'Test Region', 'Hauler Contact', '555-0101'),
    (v_other, 'hf187-other', 'HF187 Other LLC', 'HF187 Other', 'Test Region', 'Other Contact', '555-0102');

  insert into public.profiles (id, clerk_user_id, role, full_name, phone, company_id)
  values
    (v_actor, 'user_hf187_actor', 'dispatcher', 'HF187 Actor', '555-0110', v_hauler),
    (v_host_user, 'user_hf187_host', 'dispatcher', 'HF187 Host Dispatcher', '555-0111', v_host),
    (v_driver_a_user, 'user_hf187_driver_a', 'driver', 'HF187 Driver A', '555-0112', v_hauler),
    (v_driver_b_user, 'user_hf187_driver_b', 'driver', 'HF187 Driver B', '555-0113', v_other),
    (v_spare_user, 'user_hf187_spare', 'driver', 'HF187 Spare', '555-0114', null);

  insert into public.organization_memberships (company_id, profile_id, role)
  values
    (v_hauler, v_actor, 'dispatcher'),
    (v_host, v_host_user, 'dispatcher');

  insert into public.dispatcher_profiles (id, profile_id, company_id, dispatch_region, contact_name, contact_phone)
  values (v_host_dispatcher, v_host_user, v_host, 'Test Region', 'Host Dispatcher', '555-0111');

  insert into public.landings (id, company_id, name, address_line_1, city, state, postal_code, latitude, longitude, contact_name, contact_phone)
  values (v_landing, v_host, 'HF187 Landing', '1 Test Road', 'Testville', 'OR', '97000', 44.4, -122.7, 'Landing Contact', '555-0120');

  insert into public.mills (id, company_id, mill_code, name, address_line_1, city, state, postal_code, latitude, longitude, contact_name, contact_phone, access_notes)
  values
    (v_mill, v_host, 'HF187-OWNED', 'HF187 Owned Mill', '2 Test Road', 'Testville', 'OR', '97000', 44.5, -122.6, 'Mill Contact', '555-0121', 'private gate code'),
    (v_shared_mill, null, 'HF187-SHARED', 'HF187 Shared Mill', '3 Test Road', 'Testville', 'OR', '97000', 44.6, -122.5, 'Shared Contact', '555-0122', 'private dock note');

  insert into public.destination_facilities (mill_id, managed_by_company_id, truck_entrance, receiving_hours, check_in_process, scale_process, unloading_instructions, last_verified_at)
  values (v_mill, v_host, 'SRID=4326;POINT(-122.6 44.5)'::geography, '06:00-16:00', 'Radio the scale house', 'Weigh in and out', 'Unload at deck 2', now());

  insert into public.haul_routes (id, company_id, landing_id, mill_id, route_name, estimated_distance_miles, estimated_run_time_minutes, road_condition)
  values (v_route, v_host, v_landing, v_mill, 'HF187 Route', 12.5, 40, 'dry');

  insert into public.rates (id, company_id, rate_type, amount_cents, effective_date)
  values (v_rate, v_host, 'per_load', 50000, current_date);

  insert into public.load_postings (
    id, company_id, dispatcher_profile_id, pickup_landing_id, dropoff_mill_id, route_id, rate_id,
    title, load_type, status, schedule_type, daily_truck_count_needed, road_condition,
    dispatcher_contact_name, dispatcher_contact_phone
  )
  values (
    v_load, v_host, v_host_dispatcher, v_landing, v_mill, v_route, v_rate,
    'HF187 Load', 'saw_logs', 'open', 'one_off', 2, 'dry',
    'Host Dispatcher', '555-0111'
  );

  insert into public.truck_slots (id, load_posting_id, landing_id, slot_date, start_at, end_at, capacity, status)
  values (v_slot, v_load, v_landing, current_date, now(), now() + interval '2 hours', 3, 'open');

  insert into public.driver_profiles (id, profile_id, company_id, license_number, home_base)
  values
    (v_driver_a, v_driver_a_user, v_hauler, 'HF187-A', 'Testville'),
    (v_driver_b, v_driver_b_user, v_other, 'HF187-B', 'Testville');

  insert into public.truck_profiles (id, owner_profile_id, company_id, truck_type, unit_number, make, model, plate_number, axle_count, max_payload_tons, archived_at)
  values
    (v_truck_a, v_actor, v_hauler, 'log_truck', 'A1', 'Make', 'Model', 'HF187A1', 5, 30, null),
    (v_truck_a_archived, v_actor, v_hauler, 'log_truck', 'A2', 'Make', 'Model', 'HF187A2', 5, 30, now()),
    (v_truck_b, v_driver_b_user, v_other, 'log_truck', 'B1', 'Make', 'Model', 'HF187B1', 5, 30, null);

  insert into public.trailer_profiles (id, owner_profile_id, truck_id, trailer_type, unit_number, capacity_tons)
  values
    (v_trailer_a, v_actor, v_truck_a, 'pole', 'TA1', 25),
    (v_trailer_b, v_driver_b_user, v_truck_b, 'pole', 'TB1', 25);

  -- ==========================================================================
  -- HF-19a. current_clerk_user_id(): missing, empty or blank sub -> NULL.
  -- ==========================================================================
  perform pg_temp.expect('no claims at all resolve to no Clerk id',
    pg_temp.value_as('service_role', null, 'select public.current_clerk_user_id()') is null);
  perform pg_temp.expect('a token without sub resolves to no Clerk id',
    pg_temp.value_as('service_role', '{"role":"service_role"}', 'select public.current_clerk_user_id()') is null);
  perform pg_temp.expect('an empty sub resolves to no Clerk id',
    pg_temp.value_as('service_role', '{"role":"service_role","sub":""}', 'select public.current_clerk_user_id()') is null);
  perform pg_temp.expect('a blank sub resolves to no Clerk id',
    pg_temp.value_as('service_role', '{"role":"service_role","sub":"   "}', 'select public.current_clerk_user_id()') is null);
  perform pg_temp.expect('a present sub is returned exactly',
    pg_temp.value_as('service_role', v_actor_claims, 'select public.current_clerk_user_id()') = 'user_hf187_actor');
  perform pg_temp.expect('a present sub resolves to its profile',
    pg_temp.value_as('service_role', v_actor_claims, 'select public.current_profile_id()') = v_actor::text);
  perform pg_temp.expect('a padded sub is not trimmed into another identity',
    pg_temp.value_as('service_role', '{"role":"service_role","sub":" user_hf187_actor"}', 'select public.current_profile_id()') is null);
  perform pg_temp.expect('a token without sub resolves to no profile',
    pg_temp.value_as('service_role', '{"role":"service_role"}', 'select public.current_profile_id()') is null);

  -- ==========================================================================
  -- HF-19b. No profile may carry an empty or blank Clerk id.
  -- ==========================================================================
  perform pg_temp.expect_refused('profile with an empty clerk_user_id', 'postgres', null,
    $sql$insert into public.profiles (clerk_user_id, role, full_name, phone) values ('', 'driver', 'Blank', '555-0199')$sql$,
    '23514', '%profiles_clerk_user_id_not_blank%');
  perform pg_temp.expect_refused('profile with a blank clerk_user_id', 'postgres', null,
    $sql$insert into public.profiles (clerk_user_id, role, full_name, phone) values ('   ', 'driver', 'Blank', '555-0199')$sql$,
    '23514', '%profiles_clerk_user_id_not_blank%');
  perform pg_temp.expect_refused('changing a clerk_user_id to empty', 'postgres', null,
    pg_catalog.format($sql$update public.profiles set clerk_user_id = '' where id = %L$sql$, v_spare_user),
    '23514', '%profiles_clerk_user_id_not_blank%');

  -- ==========================================================================
  -- HF-19c. Every SECURITY DEFINER function in public pins an empty search_path.
  -- ==========================================================================
  perform pg_temp.expect('every public SECURITY DEFINER function sets search_path to empty',
    not exists (
      select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prosecdef
        and not exists (
          select 1 from pg_catalog.pg_depend d
          where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
        )
        and not exists (
          select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
          where cfg in ('search_path=""', 'search_path=')
        )
    ));
  perform pg_temp.expect('the five previously public-pinned definers are covered',
    (select count(*) from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and p.proname in ('current_profile_id', 'is_org_member', 'orgs_have_active_relationship', 'load_visible_to_org', 'request_capacity')) = 5);

  -- ==========================================================================
  -- HF-19d. request_capacity refuses equipment of another organization.
  -- ==========================================================================
  v_call := 'select (public.request_capacity(%L, %L, %L, %L, %L, %L)).id';

  perform pg_temp.expect_refused('request_capacity without a sub claim', 'service_role', '{"role":"service_role"}',
    pg_catalog.format(v_call, v_hauler, v_load, v_slot, v_driver_a, v_truck_a, v_trailer_a),
    'P0001', 'Authenticated profile is required');
  perform pg_temp.expect_refused('request_capacity with another organization''s driver', 'service_role', v_actor_claims,
    pg_catalog.format(v_call, v_hauler, v_load, v_slot, v_driver_b, v_truck_a, v_trailer_a),
    'P0001', 'Driver profile % does not belong to organization %');
  perform pg_temp.expect_refused('request_capacity with another organization''s truck', 'service_role', v_actor_claims,
    pg_catalog.format(v_call, v_hauler, v_load, v_slot, v_driver_a, v_truck_b, null),
    'P0001', 'Truck profile % does not belong to organization %');
  perform pg_temp.expect_refused('request_capacity with an archived truck', 'service_role', v_actor_claims,
    pg_catalog.format(v_call, v_hauler, v_load, v_slot, v_driver_a, v_truck_a_archived, null),
    'P0001', 'Truck profile % does not belong to organization %');
  perform pg_temp.expect_refused('request_capacity with a trailer attached to another truck', 'service_role', v_actor_claims,
    pg_catalog.format(v_call, v_hauler, v_load, v_slot, v_driver_a, v_truck_a, v_trailer_b),
    'P0001', 'Trailer profile % is not attached to truck profile %');
  perform pg_temp.expect('refused requests reserved nothing',
    (select reserved_count from public.truck_slots where id = v_slot) = 0
    and not exists (select 1 from public.assignments where load_posting_id = v_load));

  v_assignment := pg_temp.value_as('service_role', v_actor_claims,
    pg_catalog.format(v_call, v_hauler, v_load, v_slot, v_driver_a, v_truck_a, v_trailer_a))::uuid;
  perform pg_temp.expect('request_capacity accepts the organization''s own driver, truck and attached trailer',
    v_assignment is not null
    and (select reserved_count from public.truck_slots where id = v_slot) = 1);

  select id into v_audit
  from public.audit_events
  where entity_id = v_assignment and action = 'capacity_requested' and actor_user_id = v_actor;
  perform pg_temp.expect('the accepted request wrote its audit event', v_audit is not null);

  -- ==========================================================================
  -- HF-20. No anonymous reads; mills and destination_facilities member-only.
  -- ==========================================================================
  perform pg_temp.expect('the USING (true) policies are gone',
    not exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'public'
        and policyname in ('mills_public_select', 'destination_facilities_select')
    ));
  perform pg_temp.expect('no public policy admits PUBLIC or anon unconditionally',
    not exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'public'
        and roles && array['public', 'anon']::name[]
        and (qual = 'true' or with_check = 'true')
    ));
  perform pg_temp.expect('mills_member_select applies to authenticated only',
    (select roles from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'mills' and policyname = 'mills_member_select') = array['authenticated']::name[]);
  perform pg_temp.expect('destination_facilities_member_select applies to authenticated only',
    (select roles from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'destination_facilities'
       and policyname = 'destination_facilities_member_select') = array['authenticated']::name[]);
  perform pg_temp.expect('both replacement policies carry a comment',
    (select count(*) from pg_catalog.pg_policy pol
     where pol.polname in ('mills_member_select', 'destination_facilities_member_select')
       and obj_description(pol.oid, 'pg_policy') is not null) = 2);
  perform pg_temp.expect('anon holds SELECT on no application table in public',
    not exists (
      select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
        and not exists (
          select 1 from pg_catalog.pg_depend d
          where d.classid = 'pg_catalog.pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
        )
        and has_table_privilege('anon', c.oid, 'SELECT')
    ));

  perform pg_temp.expect_refused('anon reading mills', 'anon', '{"role":"anon"}',
    'select count(*) from public.mills', '42501');
  perform pg_temp.expect_refused('anon reading destination_facilities', 'anon', '{"role":"anon"}',
    'select count(*) from public.destination_facilities', '42501');

  -- The member rule. authenticated cannot execute the member helper
  -- (20260726090000), so a client read through these policies is refused; that
  -- refusal is asserted through privileges rather than executed. The rule itself
  -- is then exercised with EXECUTE granted inside this rolled-back transaction,
  -- so it still holds if that grant is ever restored.
  perform pg_temp.expect('authenticated cannot execute the member helper the policies call',
    not has_function_privilege('authenticated', 'public.is_org_member(uuid)', 'EXECUTE'));
  perform pg_temp.expect('mills_member_select is the controlling-organization member rule',
    (select qual from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'mills' and policyname = 'mills_member_select')
      ~ '^\(\(company_id IS NOT NULL\) AND (public\.)?is_org_member\(company_id\)\)$');
  perform pg_temp.expect('destination_facilities_member_select is the managing-organization member rule',
    (select qual from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'destination_facilities'
       and policyname = 'destination_facilities_member_select')
      ~ '^\(\(managed_by_company_id IS NOT NULL\) AND (public\.)?is_org_member\(managed_by_company_id\)\)$');

  grant execute on function public.is_org_member(uuid) to authenticated;
  v_ids := pg_catalog.format('%L, %L', v_mill, v_shared_mill);
  perform pg_temp.expect('a signed-in non-member reads no mill',
    pg_temp.value_as('authenticated', v_spare_claims,
      'select count(*) from public.mills where id in (' || v_ids || ')')::bigint = 0);
  perform pg_temp.expect('a member reads its organization''s mill and not the shared platform mill',
    pg_temp.value_as('authenticated', v_host_claims,
      'select string_agg(mill_code, '','' order by mill_code) from public.mills where id in (' || v_ids || ')') = 'HF187-OWNED');
  perform pg_temp.expect('a signed-in non-member reads no destination facility',
    pg_temp.value_as('authenticated', v_spare_claims,
      pg_catalog.format('select count(*) from public.destination_facilities where mill_id = %L', v_mill))::bigint = 0);
  perform pg_temp.expect('a member reads its organization''s destination facility',
    pg_temp.value_as('authenticated', v_host_claims,
      pg_catalog.format('select count(*) from public.destination_facilities where mill_id = %L', v_mill))::bigint = 1);
  revoke execute on function public.is_org_member(uuid) from authenticated;

  perform pg_temp.expect('the service role still reads every mill (server-side reads unaffected)',
    pg_temp.value_as('service_role', '{"role":"service_role"}',
      pg_catalog.format('select count(*) from public.mills where id in (%L, %L)', v_mill, v_shared_mill))::bigint = 2);
  perform pg_temp.expect('the service role still reads destination facilities',
    pg_temp.value_as('service_role', '{"role":"service_role"}',
      pg_catalog.format('select count(*) from public.destination_facilities where mill_id = %L', v_mill))::bigint = 1);

  -- Default privileges: a table the migration role creates from now on arrives
  -- without anon SELECT, while authenticated and service_role keep it.
  create table public.hf187_default_acl_probe (id integer);
  perform pg_temp.expect('a new public table is not anon-readable',
    not has_table_privilege('anon', 'public.hf187_default_acl_probe', 'SELECT'));
  perform pg_temp.expect('a new public table is still readable by authenticated and service_role',
    has_table_privilege('authenticated', 'public.hf187_default_acl_probe', 'SELECT')
    and has_table_privilege('service_role', 'public.hf187_default_acl_probe', 'SELECT'));
  drop table public.hf187_default_acl_probe;

  -- ==========================================================================
  -- HF-21. audit_events is append-only; its actor foreign key is RESTRICT.
  -- ==========================================================================
  perform pg_temp.expect('exactly one foreign key on audit_events.actor_user_id, ON DELETE RESTRICT',
    (select count(*) from pg_catalog.pg_constraint con
     join pg_catalog.pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
     where con.conrelid = 'public.audit_events'::regclass and con.contype = 'f' and att.attname = 'actor_user_id') = 1
    and (select con.confdeltype from pg_catalog.pg_constraint con
         where con.conrelid = 'public.audit_events'::regclass and con.conname = 'audit_events_actor_user_id_fkey') = 'r');

  perform pg_temp.expect_refused('the table owner updating an audit event', 'postgres', null,
    pg_catalog.format($sql$update public.audit_events set action = 'tampered' where id = %L$sql$, v_audit),
    '42501', '%append-only%');
  perform pg_temp.expect_refused('the table owner deleting an audit event', 'postgres', null,
    pg_catalog.format('delete from public.audit_events where id = %L', v_audit),
    '42501', '%append-only%');
  perform pg_temp.expect_refused('service_role updating an audit event', 'service_role', '{"role":"service_role"}',
    pg_catalog.format($sql$update public.audit_events set metadata = '{}'::jsonb where id = %L$sql$, v_audit),
    '42501');
  perform pg_temp.expect_refused('service_role deleting an audit event', 'service_role', '{"role":"service_role"}',
    pg_catalog.format('delete from public.audit_events where id = %L', v_audit),
    '42501');
  perform pg_temp.expect('no API role holds UPDATE, DELETE or TRUNCATE on audit_events',
    not exists (
      select 1
      from unnest(array['anon', 'authenticated', 'service_role']) as api(role_name)
      cross join unnest(array['UPDATE', 'DELETE', 'TRUNCATE']) as priv(privilege)
      where has_table_privilege(api.role_name, 'public.audit_events', priv.privilege)
    ));
  perform pg_temp.expect('service_role keeps SELECT and INSERT on audit_events',
    has_table_privilege('service_role', 'public.audit_events', 'SELECT')
    and has_table_privilege('service_role', 'public.audit_events', 'INSERT'));
  perform pg_temp.expect('service_role can still append an audit event',
    pg_temp.value_as('service_role', '{"role":"service_role"}',
      pg_catalog.format($sql$with appended as (
        insert into public.audit_events (actor_user_id, entity_type, entity_id, action)
        values (%L, 'assignment', %L, 'hf187_probe') returning 1
      ) select count(*) from appended$sql$, v_actor, v_assignment))::bigint = 1);

  perform pg_temp.expect_refused('deleting a profile that audit events name as actor', 'postgres', null,
    pg_catalog.format('delete from public.profiles where id = %L', v_actor),
    '23503', '%audit_events_actor_user_id_fkey%');
  perform pg_temp.expect('the audit event still names its actor',
    (select actor_user_id from public.audit_events where id = v_audit) = v_actor);
  delete from public.profiles where id = v_spare_user;
  perform pg_temp.expect('a profile no audit event names can still be deleted',
    not exists (select 1 from public.profiles where id = v_spare_user));

  raise notice 'PASS: pilot SQL hardening (#187 HF-19, HF-20, HF-21)';
end
$$;

rollback;
