-- =============================================================================
-- LogLoads normalized-v2 — 27 regression suite for 26 (the V2 product gaps: G1 landing public details, G2 a hauling
-- business's private details, G3 the private legal name, G4 truck-only equipment options, G5 report reasons and one
-- standing report, G6 availability integrity)
--
-- NON-ACTIVE PROTOTYPE TEST SUITE. Disposable PostgreSQL only. Run after
-- 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23 -> 26. Wraps everything in BEGIN ... ROLLBACK.
-- Negative tests require the expected SQLSTATE AND a matching message or constraint name.
-- Run as the role that applied 26 (the table owner, which the fixture uses for staff and service steps).
-- G6's races (a report against a lowered list, two reports of one type) need two sessions, and 26's changes to
-- existing rows need data from before 26: both are in 28_v2_product_gap_concurrency_test.sh.
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

-- 18 (HF-18) withholds EXECUTE from PUBLIC on functions this role creates; the helpers run after SET ROLE.
grant execute on all functions in schema pg_temp to public;

insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true) on conflict (issuer) do nothing;

do $$
declare
  c_iss constant text := 'https://clerk.logloads.test';
  u_land uuid; u_haul uuid; u_mgr uuid; u_drv uuid; u_stranger uuid; u_admin uuid;
  o_land uuid; o_haul uuid;
  l_open uuid; l_paused uuid; l_bare uuid; v_job uuid; v_eoi uuid;
  v_unit uuid; v_scales uuid; v_report uuid; v_report2 uuid;
  v_text text; v_rows integer; v_n integer;
begin
  -- =========================================================================
  -- Ledger
  -- =========================================================================
  perform pg_temp.ok(
    (select string_agg(version, ',' order by applied_at, version) from marketplace.schema_migrations) like '%,23,26',
    '26: the ledger records 26 after 23');

  -- =========================================================================
  -- Fixture: a landing business on Pro with a recruiting landing (with public details), a paused one and one saved
  -- before anyone filled the details in, and a published job; a hauling business with a manager and a driver; a
  -- stranger; a platform support reviewer.
  -- =========================================================================
  perform pg_temp.as_jwt('service_role');
  u_land     := marketplace.sync_verified_identity(c_iss, 's26_land',     'S26 Landing Owner', 'land@s26.test',     true);
  u_haul     := marketplace.sync_verified_identity(c_iss, 's26_haul',     'S26 Hauling Owner', 'haul@s26.test',     true);
  u_mgr      := marketplace.sync_verified_identity(c_iss, 's26_mgr',      'S26 Manager',       'mgr@s26.test',      true);
  u_drv      := marketplace.sync_verified_identity(c_iss, 's26_drv',      'S26 Driver',        'drv@s26.test',      true);
  u_stranger := marketplace.sync_verified_identity(c_iss, 's26_stranger', 'S26 Stranger',      'stranger@s26.test', true);
  u_admin    := marketplace.sync_verified_identity(c_iss, 's26_admin',    'S26 Reviewer',      'admin@s26.test',    true);
  perform pg_temp.as_jwt('harness');
  insert into marketplace.platform_admins (user_id, admin_role, note) values (u_admin, 'support', 'Suite 27 reviewer');

  perform pg_temp.as_jwt('authenticated', 's26_land');
  o_land := marketplace.create_organization('S26 Landing Co', 's26-landing', 'OR', false);
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_land, 'pro', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_s26', 'sub_s26', false, 7, false);

  perform pg_temp.as_jwt('authenticated', 's26_land');
  update marketplace.organizations set legal_name = 'S26 Landing Holdings LLC' where id = o_land;
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code, typical_hours, public_road_notes)
  values (o_land, 'S26 Open Landing', 'active', 'Oakridge, OR', marketplace.make_public_point(-122.4, 43.7), 'OR',
          '5 a.m. to 3 p.m., Mon to Fri', 'Gravel the last 6 miles; chains when posted.')
  returning id into l_open;
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code, typical_hours, public_road_notes)
  values (o_land, 'S26 Paused Landing', 'inactive', 'Westfir, OR', marketplace.make_public_point(-122.5, 43.8), 'OR',
          'Two shifts', 'Paved to the gate.')
  returning id into l_paused;
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_land, 'S26 Bare Landing', 'active', 'Lowell, OR', marketplace.make_public_point(-122.8, 43.9), 'OR')
  returning id into l_bare;
  v_job := marketplace.publish_job_posting(
    l_open, 'S26 Fir Haul', array['log_truck'], 3, 'Fir sawlogs', 'Suite 27 haul.', 'per_ton', 525, null,
    3, current_date + 10, 8, 3.0, 9, 30.0, 'Springfield Mill, OR', 28, null, null, array['ppe'], true);

  perform pg_temp.as_jwt('authenticated', 's26_haul');
  o_haul := marketplace.create_organization('S26 Hauling', 's26-hauling', 'OR', true);
  update marketplace.organizations set legal_name = 'S26 Hauling Holdings LLC' where id = o_haul;
  update marketplace.hauler_profiles
  set base_area_label = 'Sweet Home, OR', service_center = marketplace.make_public_point(-122.7, 44.4), service_radius_miles = 100
  where org_id = o_haul;
  perform pg_temp.as_jwt('harness');
  insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
  values (o_haul, u_mgr, 'manager', false, 'active'), (o_haul, u_drv, 'driver', false, 'active');

  -- =========================================================================
  -- G1. A landing's public details (#127)
  -- =========================================================================
  perform pg_temp.ok(
    (select count(*) = 2 and bool_and(is_nullable = 'YES') and bool_and(data_type = 'text')
     from information_schema.columns
     where table_schema = 'marketplace' and table_name = 'landings' and column_name in ('typical_hours', 'public_road_notes')),
    'G1: landings has typical_hours and public_road_notes, both nullable text');
  perform pg_temp.ok(
    coalesce(col_description('marketplace.landings'::regclass,
      (select attnum from pg_attribute where attrelid = 'marketplace.landings'::regclass and attname = 'typical_hours')), '') ~ 'Public \(Seen by haulers\)'
    and coalesce(col_description('marketplace.landings'::regclass,
      (select attnum from pg_attribute where attrelid = 'marketplace.landings'::regclass and attname = 'public_road_notes')), '') ~ 'Public \(Seen by haulers\)',
    'G1: both columns are documented as public');
  perform pg_temp.ok(
    has_column_privilege('anon', 'marketplace.landings', 'typical_hours', 'SELECT')
    and has_column_privilege('anon', 'marketplace.landings', 'public_road_notes', 'SELECT')
    and not has_column_privilege('anon', 'marketplace.landings', 'typical_hours', 'UPDATE')
    and not has_column_privilege('anon', 'marketplace.landings', 'public_road_notes', 'INSERT'),
    'G1 grants: anon reads both public columns and writes neither');
  perform pg_temp.ok(
    has_column_privilege('authenticated', 'marketplace.landings', 'typical_hours', 'INSERT')
    and has_column_privilege('authenticated', 'marketplace.landings', 'typical_hours', 'UPDATE')
    and has_column_privilege('authenticated', 'marketplace.landings', 'public_road_notes', 'INSERT')
    and has_column_privilege('authenticated', 'marketplace.landings', 'public_road_notes', 'UPDATE')
    and not has_column_privilege('service_role', 'marketplace.landings', 'typical_hours', 'SELECT'),
    'G1 grants: authenticated writes both under the landing policies; service_role still holds no table privilege');

  perform pg_temp.as_jwt('anon');
  select typical_hours || ' | ' || public_road_notes into v_text from marketplace.landings where id = l_open;
  perform pg_temp.ok(v_text = '5 a.m. to 3 p.m., Mon to Fri | Gravel the last 6 miles; chains when posted.',
    'G1 public: anon reads a recruiting landing''s hours and road notes');
  perform pg_temp.ok(not exists (select 1 from marketplace.landings where id = l_paused),
    'G1 public: anon reads nothing of a paused landing');
  select coalesce(typical_hours, 'null') || ' | ' || coalesce(public_road_notes, 'null') into v_text from marketplace.landings where id = l_bare;
  perform pg_temp.ok(v_text = 'null | null', 'G1 public: a landing saved without details has none (NULL, never invented)');
  perform pg_temp.fails(format('select exact_point from marketplace.landing_private_details where landing_id = %L', l_open),
    '42501', 'permission denied', 'G1 private: anon still cannot read landing_private_details');

  perform pg_temp.as_jwt('authenticated', 's26_haul');
  perform pg_temp.ok((select typical_hours from marketplace.landings where id = l_open) = '5 a.m. to 3 p.m., Mon to Fri',
    'G1 public: another business reads a recruiting landing''s hours');
  update marketplace.landings set typical_hours = 'Hijacked hours', public_road_notes = 'Hijacked notes' where id = l_open;
  get diagnostics v_rows = row_count;
  perform pg_temp.ok(v_rows = 0, 'G1 write: another business updates no landing of the landing business');
  perform pg_temp.fails(format(
    'insert into marketplace.landings (org_id, name, status, public_area_label, state_code, typical_hours) values (%L, %L, %L, %L, %L, %L)',
    o_land, 'Planted Landing', 'inactive', 'Oakridge, OR', 'OR', 'Planted hours'),
    '42501', 'row-level security', 'G1 write: another business cannot add a landing (with details) to the landing business');

  perform pg_temp.as_jwt('authenticated', 's26_land');
  perform pg_temp.ok((select typical_hours from marketplace.landings where id = l_open) = '5 a.m. to 3 p.m., Mon to Fri',
    'G1 write: the hours are unchanged after the refused write');
  update marketplace.landings set typical_hours = 'Dawn to 2 p.m.', public_road_notes = null where id = l_open;
  get diagnostics v_rows = row_count;
  perform pg_temp.ok(v_rows = 1 and (select coalesce(public_road_notes, 'null') = 'null' and typical_hours = 'Dawn to 2 p.m.' and status = 'active'
                                     from marketplace.landings where id = l_open),
    'G1 write: the owner edits the hours and clears the road notes; the landing stays recruiting');
  perform pg_temp.fails(format('update marketplace.landings set typical_hours = %L where id = %L', repeat('h', 121), l_open),
    '23514', 'landings_typical_hours_chk', 'G1 cap: typical hours at 121 characters are refused');
  perform pg_temp.fails(format('update marketplace.landings set public_road_notes = %L where id = %L', repeat('r', 1001), l_open),
    '23514', 'landings_public_road_notes_chk', 'G1 cap: public road notes at 1001 characters are refused');
  perform pg_temp.fails(format('update marketplace.landings set typical_hours = %L where id = %L', '   ', l_open),
    '23514', 'landings_typical_hours_chk', 'G1 cap: blank hours are refused (the application stores NULL)');
  perform pg_temp.fails(format('update marketplace.landings set public_road_notes = %L where id = %L', 'Turn at 43.74712, -122.46171 past the scale', l_open),
    '23514', 'landings_public_road_notes_chk', 'G1 public text: a coordinate pair in the road notes is refused');
  perform pg_temp.fails(format('update marketplace.landings set typical_hours = %L where id = %L', 'Open 5 a.m., gate code 4417', l_open),
    '23514', 'landings_typical_hours_chk', 'G1 public text: a gate code in the hours is refused');
  update marketplace.landings set typical_hours = repeat('h', 120), public_road_notes = repeat('r', 1000) where id = l_open;
  perform pg_temp.ok((select char_length(typical_hours) = 120 and char_length(public_road_notes) = 1000 from marketplace.landings where id = l_open),
    'G1 cap: exactly 120 and 1000 characters are accepted');
  update marketplace.landings set typical_hours = '5 a.m. to 3 p.m.', public_road_notes = 'Gravel road.' where id = l_open;

  -- An inquiry from the hauling business: the two businesses become counterparts (each reads the other's row).
  perform pg_temp.as_jwt('authenticated', 's26_haul');
  select interest_id into v_eoi from marketplace.submit_expression_of_interest(o_haul, v_job, 1);
  perform pg_temp.ok(v_eoi is not null, 'fixture: the hauling business sent the landing an inquiry');

  -- =========================================================================
  -- G2. A hauling business's private details (#125)
  -- =========================================================================
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select relrowsecurity from pg_class where oid = 'marketplace.hauler_private_details'::regclass),
    'G2: hauler_private_details has row-level security');
  perform pg_temp.ok(
    not exists (select 1 from information_schema.role_table_grants
                where table_schema = 'marketplace' and table_name = 'hauler_private_details' and grantee in ('anon', 'service_role', 'PUBLIC'))
    and has_table_privilege('authenticated', 'marketplace.hauler_private_details', 'SELECT')
    and not has_table_privilege('authenticated', 'marketplace.hauler_private_details', 'DELETE')
    and not has_column_privilege('authenticated', 'marketplace.hauler_private_details', 'org_id', 'UPDATE')
    and not has_column_privilege('authenticated', 'marketplace.hauler_private_details', 'created_at', 'INSERT'),
    'G2 grants: no anon, service_role or PUBLIC grant; members read; no delete; the key and timestamps are not client-written');

  perform pg_temp.as_jwt('authenticated', 's26_haul');
  insert into marketplace.hauler_private_details (org_id, business_kind, business_phone, default_contact_route)
  values (o_haul, 'solo', '+15415550111', 'phone');
  perform pg_temp.ok((select business_kind = 'solo' and business_phone = '+15415550111' and default_contact_route = 'phone'
                      from marketplace.hauler_private_details where org_id = o_haul),
    'G2: the owner records the business type, a business phone and phone as the default route');

  perform pg_temp.as_jwt('authenticated', 's26_mgr');
  update marketplace.hauler_private_details set business_kind = 'company', default_contact_route = 'in_app' where org_id = o_haul;
  get diagnostics v_rows = row_count;
  perform pg_temp.ok(v_rows = 1, 'G2: a manager changes them');

  perform pg_temp.as_jwt('authenticated', 's26_drv');
  perform pg_temp.ok((select business_kind = 'company' and business_phone = '+15415550111' and default_contact_route = 'in_app'
                      from marketplace.hauler_private_details where org_id = o_haul),
    'G2: a driver (a member) reads them');
  update marketplace.hauler_private_details set business_phone = '+15415550999' where org_id = o_haul;
  get diagnostics v_rows = row_count;
  perform pg_temp.ok(v_rows = 0, 'G2: a driver changes nothing (owners and managers only)');

  -- No one outside the business reads them: not the landing it wrote to, not a stranger, not platform staff, not anon.
  perform pg_temp.as_jwt('authenticated', 's26_land');
  perform pg_temp.ok(exists (select 1 from marketplace.hauler_profiles where org_id = o_haul),
    'G2: the landing desk reads the hauling profile that sent it interest (has_live_inquiry_from_hauler) ...');
  perform pg_temp.ok(not exists (select 1 from marketplace.hauler_private_details where org_id = o_haul),
    'G2: ... but not its private details');
  perform pg_temp.fails(format('insert into marketplace.hauler_private_details (org_id, business_phone) values (%L, %L)', o_haul, '+15415550000'),
    '42501', 'row-level security', 'G2: another business cannot write them');
  perform pg_temp.as_jwt('authenticated', 's26_stranger');
  perform pg_temp.ok(not exists (select 1 from marketplace.hauler_private_details), 'G2: a signed-in stranger reads none');
  perform pg_temp.as_jwt('authenticated', 's26_admin');
  perform pg_temp.ok(not exists (select 1 from marketplace.hauler_private_details), 'G2: platform staff read none (members only)');
  perform pg_temp.as_jwt('anon');
  perform pg_temp.fails('select business_phone from marketplace.hauler_private_details', '42501', 'permission denied',
    'G2: anon cannot read them');
  perform pg_temp.as_jwt('service_role');
  perform pg_temp.fails('select business_phone from marketplace.hauler_private_details', '42501', 'permission denied',
    'G2: service_role cannot read them');

  perform pg_temp.as_jwt('authenticated', 's26_haul');
  perform pg_temp.fails(format('update marketplace.hauler_private_details set business_phone = %L where org_id = %L', '541-555-0111', o_haul),
    '23514', 'business_phone', 'G2: a phone that is not E.164 is refused');
  perform pg_temp.fails(format('update marketplace.hauler_private_details set business_kind = %L where org_id = %L', 'member', o_haul),
    '23514', 'business_kind', 'G2: a business type other than solo or company is refused');
  perform pg_temp.fails(format('update marketplace.hauler_private_details set default_contact_route = %L where org_id = %L', 'fax', o_haul),
    '23514', 'default_contact_route', 'G2: a contact route other than in_app, phone or email is refused');
  perform pg_temp.fails(format('update marketplace.hauler_private_details set business_phone = null, default_contact_route = %L where org_id = %L', 'phone', o_haul),
    '23514', 'hauler_private_details_phone_route_chk', 'G2: phone as the default route needs a business phone');
  update marketplace.hauler_private_details set business_kind = null, business_phone = null, default_contact_route = 'email' where org_id = o_haul;
  perform pg_temp.ok((select business_kind is null and business_phone is null and default_contact_route = 'email'
                      from marketplace.hauler_private_details where org_id = o_haul),
    'G2: each is optional (NULL clears it)');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.fails(format('insert into marketplace.hauler_private_details (org_id) values (%L)', o_land),
    '23503', 'hauler_private_details_org_id_fkey', 'G2: only a hauling business (with a hauler profile) has private hauler details');

  -- =========================================================================
  -- G3. The legal name: the organization's own members and platform staff only (#187)
  -- =========================================================================
  perform pg_temp.ok(
    not has_column_privilege('authenticated', 'marketplace.organizations', 'legal_name', 'SELECT')
    and not has_column_privilege('anon', 'marketplace.organizations', 'legal_name', 'SELECT')
    and has_column_privilege('authenticated', 'marketplace.organizations', 'legal_name', 'UPDATE')
    and has_column_privilege('authenticated', 'marketplace.organizations', 'display_name', 'SELECT'),
    'G3 grants: no client role selects legal_name; the owner still writes it; the rest of the row is readable as before');
  perform pg_temp.ok(
    has_function_privilege('authenticated', 'marketplace.organization_legal_name(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'marketplace.organization_legal_name(uuid)', 'EXECUTE')
    and not has_function_privilege('service_role', 'marketplace.organization_legal_name(uuid)', 'EXECUTE')
    and not has_function_privilege('public', 'marketplace.organization_legal_name(uuid)', 'EXECUTE')
    and (select prosecdef and exists (select 1 from unnest(proconfig) c where c like 'search_path=%')
         from pg_proc where oid = 'marketplace.organization_legal_name(uuid)'::regprocedure),
    'G3: organization_legal_name is SECURITY DEFINER with a pinned search_path, executable by authenticated only (HF-18: explicit grant)');

  perform pg_temp.as_jwt('authenticated', 's26_haul');
  perform pg_temp.ok(marketplace.organization_legal_name(o_haul) = 'S26 Hauling Holdings LLC', 'G3: the owner reads the legal name');
  perform pg_temp.fails(format('select legal_name from marketplace.organizations where id = %L', o_haul),
    '42501', 'permission denied', 'G3: ... only through the function, never the column');
  perform pg_temp.ok(marketplace.organization_legal_name(o_land) is null and exists (select 1 from marketplace.organizations where id = o_land),
    'G3 counterpart: the hauling business reads the landing organization it wrote to, but not its legal name');
  perform pg_temp.as_jwt('authenticated', 's26_mgr');
  perform pg_temp.ok(marketplace.organization_legal_name(o_haul) = 'S26 Hauling Holdings LLC', 'G3: a manager reads it');
  perform pg_temp.as_jwt('authenticated', 's26_drv');
  perform pg_temp.ok(marketplace.organization_legal_name(o_haul) = 'S26 Hauling Holdings LLC', 'G3: a driver (a member) reads it');

  perform pg_temp.as_jwt('authenticated', 's26_land');
  perform pg_temp.ok(exists (select 1 from marketplace.organizations where id = o_haul),
    'G3 counterpart: the landing desk reads the hauling business that sent it interest ...');
  perform pg_temp.ok(marketplace.organization_legal_name(o_haul) is null, 'G3 counterpart: ... but not its legal name');
  perform pg_temp.fails(format('select legal_name from marketplace.organizations where id = %L', o_haul),
    '42501', 'permission denied', 'G3 counterpart: ... nor the column');
  perform pg_temp.ok(marketplace.organization_legal_name(o_land) = 'S26 Landing Holdings LLC', 'G3: the landing owner reads its own');

  perform pg_temp.as_jwt('authenticated', 's26_stranger');
  perform pg_temp.ok(exists (select 1 from marketplace.organizations where id = o_land) and marketplace.organization_legal_name(o_land) is null,
    'G3 stranger: a signed-in stranger reads a public organization but not its legal name');
  perform pg_temp.ok(marketplace.organization_legal_name(o_haul) is null, 'G3 stranger: ... nor a private one''s');
  perform pg_temp.fails('select legal_name from marketplace.organizations limit 1', '42501', 'permission denied',
    'G3 stranger: the column is not readable');

  perform pg_temp.as_jwt('anon');
  perform pg_temp.ok(exists (select 1 from marketplace.organizations where id = o_land), 'G3 anon: anon reads the public organization row ...');
  perform pg_temp.fails('select legal_name from marketplace.organizations limit 1', '42501', 'permission denied', 'G3 anon: ... not its legal name');
  perform pg_temp.fails(format('select marketplace.organization_legal_name(%L::uuid)', o_land), '42501', 'permission denied',
    'G3 anon: ... nor through the function');

  perform pg_temp.as_jwt('authenticated', 's26_admin');
  perform pg_temp.ok(marketplace.organization_legal_name(o_haul) = 'S26 Hauling Holdings LLC', 'G3: platform staff read it');

  perform pg_temp.as_jwt('authenticated', 's26_haul');
  update marketplace.organizations set legal_name = 'S26 Hauling Co.' where id = o_haul;
  get diagnostics v_rows = row_count;
  perform pg_temp.ok(v_rows = 1 and marketplace.organization_legal_name(o_haul) = 'S26 Hauling Co.',
    'G3: the owner still changes it (owner-only update, unchanged)');
  perform pg_temp.as_jwt('authenticated', 's26_mgr');
  update marketplace.organizations set legal_name = 'Renamed by a manager' where id = o_haul;
  get diagnostics v_rows = row_count;
  perform pg_temp.ok(v_rows = 0 and marketplace.organization_legal_name(o_haul) = 'S26 Hauling Co.',
    'G3: a manager still cannot change it');
  -- A person who leaves stops reading it.
  perform pg_temp.as_jwt('harness');
  update marketplace.organization_memberships set status = 'removed' where org_id = o_haul and user_id = u_drv;
  perform pg_temp.as_jwt('authenticated', 's26_drv');
  perform pg_temp.ok(marketplace.organization_legal_name(o_haul) is null, 'G3: a removed member no longer reads it');
  perform pg_temp.as_jwt('harness');
  update marketplace.organization_memberships set status = 'active' where org_id = o_haul and user_id = u_drv;

  -- =========================================================================
  -- G4. The interest form offers truck configurations only
  -- =========================================================================
  perform pg_temp.as_jwt('authenticated', 's26_haul');
  insert into marketplace.equipment_units (org_id, equipment_code, paired_trailer_code, unit_label, unit_count)
  values (o_haul, 'log_truck', 'pole_trailer', 'Log truck + Pole trailer', 2)
  returning id into v_unit;
  insert into marketplace.equipment_units (org_id, equipment_code, unit_label, unit_count)
  values (o_haul, 'onboard_scales', 'On-board scales', 2)
  returning id into v_scales;
  insert into marketplace.equipment_units (org_id, equipment_code, unit_label, unit_count)
  values (o_haul, 'pole_trailer', 'Spare pole trailer', 1);
  select string_agg(o.configuration_key || ':' || o.label || ':' || o.units_listed, ',' order by o.configuration_key) into v_text
  from marketplace.list_hauler_equipment_options(o_haul) o;
  perform pg_temp.ok(v_text = 'log_truck|pole_trailer:Log truck + Pole trailer:2',
    'G4: only the truck configuration is offered, not the extra (attachment) or the trailer alone; got ' || coalesce(v_text, 'nothing'));
  perform pg_temp.fails(format($q$select * from marketplace.submit_expression_of_interest(%L::uuid, %L::uuid, 2, '[{"configurationKey":"onboard_scales","count":2}]'::jsonb)$q$, o_haul, v_job),
    '23514', 'Choose equipment from your business profile', 'G4: an extra cannot be offered as equipment on an inquiry');
  perform pg_temp.ok(
    has_function_privilege('authenticated', 'marketplace.list_hauler_equipment_options(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'marketplace.list_hauler_equipment_options(uuid)', 'EXECUTE')
    and not has_function_privilege('service_role', 'marketplace.list_hauler_equipment_options(uuid)', 'EXECUTE'),
    'G4: the function keeps its grants (authenticated only)');

  -- =========================================================================
  -- G5. Report reasons and one standing report per person and target (#214)
  -- =========================================================================
  perform pg_temp.as_jwt('authenticated', 's26_stranger');
  insert into marketplace.abuse_reports (target_kind, target_id, reason, details)
  values ('job_posting', v_job, 'stale', 'Filled last week') returning id into v_report;
  perform pg_temp.ok((select reason = 'stale' and details = 'Filled last week' from marketplace.abuse_reports where id = v_report),
    'G5: "No longer available" is stored as its own code (stale), with the person''s words as they wrote them');
  perform pg_temp.fails(format($q$insert into marketplace.abuse_reports (target_kind, target_id, reason) values ('job_posting', %L, 'wrong_equipment')$q$, v_job),
    '23505', 'abuse_reports_one_standing_uq', 'G5: a second open report of the same listing by the same person is refused');
  perform pg_temp.fails(format($q$insert into marketplace.abuse_reports (target_kind, target_id, reason) values ('job_posting', %L, 'not_a_reason')$q$, l_open),
    '23514', 'abuse_reports_reason_check', 'G5: a reason outside the list is refused');

  perform pg_temp.as_jwt('authenticated', 's26_haul');
  insert into marketplace.abuse_reports (target_kind, target_id, reason) values ('job_posting', v_job, 'suspicious_contact');
  perform pg_temp.ok(found, 'G5: another person reports the same listing (suspicious_contact)');
  insert into marketplace.abuse_reports (target_kind, target_id, reason) values ('organization', o_land, 'wrong_equipment');
  perform pg_temp.ok(found, 'G5: the same person reports another target (wrong_equipment)');

  perform pg_temp.as_jwt('harness');
  update marketplace.abuse_reports set status = 'reviewing' where id = v_report;
  perform pg_temp.as_jwt('authenticated', 's26_stranger');
  perform pg_temp.fails(format($q$insert into marketplace.abuse_reports (target_kind, target_id, reason) values ('job_posting', %L, 'inaccurate_pay')$q$, v_job),
    '23505', 'abuse_reports_one_standing_uq', 'G5: ... and while staff review the first one');
  perform pg_temp.as_jwt('harness');
  update marketplace.abuse_reports set status = 'dismissed', reviewed_by = u_admin, reviewed_at = now() where id = v_report;
  perform pg_temp.as_jwt('authenticated', 's26_stranger');
  insert into marketplace.abuse_reports (target_kind, target_id, reason) values ('job_posting', v_job, 'inaccurate_pay')
  returning id into v_report2;
  perform pg_temp.ok(v_report2 is not null and (select count(*) from marketplace.abuse_reports where target_id = v_job and reporter_user_id = u_stranger) = 2,
    'G5: once the report is closed, the person may report the listing again');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(exists (select 1 from pg_indexes where schemaname = 'marketplace' and indexname = 'abuse_reports_one_standing_uq'
                             and indexdef ~* 'unique' and indexdef ~ 'reporter_user_id, target_kind, target_id' and indexdef ~ 'open' and indexdef ~ 'reviewing'),
    'G5: the rule is a unique partial index on (reporter, target kind, target) over open and in-review reports');

  -- =========================================================================
  -- G6. Availability integrity (#210). The business lists 2 log trucks (with pole trailers).
  -- =========================================================================
  perform pg_temp.as_jwt('authenticated', 's26_haul');
  perform pg_temp.fails(format($q$insert into marketplace.availability_reports (org_id, equipment_code, available_count, area_center, radius_miles, available_from, available_until)
      values (%L, 'log_truck', 3, marketplace.make_public_point(-122.7, 44.4), 100, current_date, current_date + 7)$q$, o_haul),
    '23514', 'availability_reports_listed_units_cap', 'G6 cap: 3 log trucks available with 2 listed is refused');
  perform pg_temp.fails(format($q$insert into marketplace.availability_reports (org_id, equipment_code, available_count, area_center, radius_miles, available_from, available_until)
      values (%L, 'chip_truck', 1, marketplace.make_public_point(-122.7, 44.4), 100, current_date, current_date + 7)$q$, o_haul),
    '23514', 'availability_reports_listed_units_cap', 'G6 cap: a truck type the business does not list cannot be reported');
  insert into marketplace.availability_reports (org_id, equipment_code, available_count, area_center, radius_miles, available_from, available_until)
  values (o_haul, 'log_truck', 2, marketplace.make_public_point(-122.7, 44.4), 100, current_date, current_date + 7)
  returning id into v_report;
  perform pg_temp.ok(v_report is not null, 'G6 cap: 2 of 2 listed is accepted');
  perform pg_temp.fails(format('update marketplace.availability_reports set available_count = 3 where id = %L', v_report),
    '23514', 'availability_reports_listed_units_cap', 'G6 cap: raising an open report over the list is refused');
  perform pg_temp.fails(format($q$insert into marketplace.availability_reports (org_id, equipment_code, available_count, area_center, radius_miles, available_from, available_until)
      values (%L, 'log_truck', 1, marketplace.make_public_point(-122.7, 44.4), 100, current_date, current_date + 7)$q$, o_haul),
    '23505', 'availability_reports_one_open_uq', 'G6 one open report: a second open report of the same type is refused');
  update marketplace.availability_reports set available_from = current_date, available_until = current_date + 7 where id = v_report;
  get diagnostics v_rows = row_count;
  perform pg_temp.ok(v_rows = 1, 'G6: renewing an open report within the list is accepted');
  update marketplace.availability_reports set withdrawn_at = now() where id = v_report;
  insert into marketplace.availability_reports (org_id, equipment_code, available_count, area_center, radius_miles, available_from, available_until)
  values (o_haul, 'log_truck', 2, marketplace.make_public_point(-122.7, 44.4), 100, current_date, current_date + 7)
  returning id into v_report;
  perform pg_temp.ok((select count(*) = 2 and count(*) filter (where withdrawn_at is null) = 1
                      from marketplace.availability_reports where org_id = o_haul and equipment_code = 'log_truck'),
    'G6 one open report: withdraw, then report again (the adapter''s order) keeps one open report and the history');

  -- The store, not only the client: the table owner is held to the list too.
  perform pg_temp.as_jwt('harness');
  perform pg_temp.fails(format('update marketplace.availability_reports set available_count = 5 where id = %L', v_report),
    '23514', 'availability_reports_listed_units_cap', 'G6 cap: holds for every writer, including the table owner');

  -- Lowering the list brings the open report down; an extra (another type) never touches it.
  perform pg_temp.as_jwt('authenticated', 's26_haul');
  update marketplace.equipment_units set unit_count = 1 where id = v_scales;
  perform pg_temp.ok((select available_count = 2 and withdrawn_at is null from marketplace.availability_reports where id = v_report),
    'G6 fit: lowering another type''s count leaves the report alone');
  update marketplace.equipment_units set unit_count = 1 where id = v_unit;
  perform pg_temp.ok((select available_count = 1 and withdrawn_at is null from marketplace.availability_reports where id = v_report),
    'G6 fit: 2 listed lowered to 1 brings the open report down to 1');
  update marketplace.equipment_units set unit_count = 3 where id = v_unit;
  perform pg_temp.ok((select available_count = 1 from marketplace.availability_reports where id = v_report),
    'G6 fit: raising the list never raises a report (only the business reports availability)');
  update marketplace.equipment_units set equipment_code = 'self_loader' where id = v_unit;
  perform pg_temp.ok((select withdrawn_at is not null and available_count = 1 from marketplace.availability_reports where id = v_report),
    'G6 fit: a unit that becomes another type leaves no log truck listed, so the log-truck report is withdrawn (its count kept)');
  update marketplace.equipment_units set equipment_code = 'log_truck' where id = v_unit;
  insert into marketplace.availability_reports (org_id, equipment_code, available_count, area_center, radius_miles, available_from, available_until)
  values (o_haul, 'log_truck', 3, marketplace.make_public_point(-122.7, 44.4), 100, current_date, current_date + 7)
  returning id into v_report;
  update marketplace.equipment_units set is_active = false where id = v_unit;
  perform pg_temp.ok((select withdrawn_at is not null from marketplace.availability_reports where id = v_report),
    'G6 fit: taking the last unit of a type off the list withdraws its open report');
  perform pg_temp.as_jwt('harness');
  select count(*) into v_n from marketplace.availability_reports where org_id = o_haul and withdrawn_at is null;
  perform pg_temp.ok(v_n = 0, 'G6 fit: no open report is left above the list');
  update marketplace.equipment_units set is_active = true where id = v_unit;
  insert into marketplace.availability_reports (org_id, equipment_code, available_count, area_center, radius_miles, available_from, available_until, reported_by)
  values (o_haul, 'log_truck', 3, marketplace.make_public_point(-122.7, 44.4), 100, current_date, current_date + 7, u_haul)
  returning id into v_report;
  delete from marketplace.equipment_units where id = v_unit;
  perform pg_temp.ok((select withdrawn_at is not null from marketplace.availability_reports where id = v_report),
    'G6 fit: deleting the listed units (a staff path) withdraws the open report too');

  perform pg_temp.ok(
    exists (select 1 from pg_indexes where schemaname = 'marketplace' and indexname = 'availability_reports_one_open_uq'
            and indexdef ~* 'unique' and indexdef ~ 'org_id, equipment_code' and indexdef ~* 'withdrawn_at IS NULL')
    and exists (select 1 from pg_trigger where tgrelid = 'marketplace.availability_reports'::regclass and tgname = 'availability_cap' and tgenabled = 'O')
    and exists (select 1 from pg_trigger where tgrelid = 'marketplace.equipment_units'::regclass and tgname = 'equipment_availability_fit' and tgenabled = 'O'),
    'G6: one open report per business and type (unique partial index); the cap and fit triggers are installed and enabled');
  perform pg_temp.ok(
    not has_function_privilege('authenticated', 'marketplace.tg_availability_cap()', 'EXECUTE')
    and not has_function_privilege('anon', 'marketplace.tg_equipment_availability_fit()', 'EXECUTE')
    and not has_function_privilege('service_role', 'marketplace.tg_availability_cap()', 'EXECUTE')
    and not has_function_privilege('public', 'marketplace.tg_equipment_availability_fit()', 'EXECUTE')
    and (select bool_and(prosecdef and exists (select 1 from unnest(proconfig) c where c like 'search_path=%'))
         from pg_proc where oid in ('marketplace.tg_availability_cap()'::regprocedure, 'marketplace.tg_equipment_availability_fit()'::regprocedure))
    and (select prosrc like '%marketplace.availability_cap:%' from pg_proc where oid = 'marketplace.tg_availability_cap()'::regprocedure)
    and (select prosrc like '%marketplace.availability_cap:%' from pg_proc where oid = 'marketplace.tg_equipment_availability_fit()'::regprocedure),
    'G6: both trigger functions are SECURITY DEFINER with a pinned search_path, callable by no one, and share the availability_cap lock');

  perform pg_temp.as_jwt('harness');
  raise notice 'ALL PRODUCT GAP BATCH (26: G1-G6) TESTS PASSED';
end
$$;

rollback;
