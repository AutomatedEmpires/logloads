-- =============================================================================
-- LogLoads normalized-v2 — 19 regression suite for 18 (hardening from the #106 security review, issue #187)
--
-- NON-ACTIVE PROTOTYPE TEST SUITE. Disposable PostgreSQL only. Run after
-- 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18. Wraps everything in BEGIN ... ROLLBACK.
-- Negative tests require the expected SQLSTATE AND a matching message or constraint name.
-- HF-15's race (two owners leaving at the same time) needs two sessions: 20_v2_review_106_concurrency_test.sh.
-- Run as the role that applied 18 (the HF-18 test checks that role's default privileges).
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

-- 18 (HF-18): functions created by the migration role no longer get EXECUTE for PUBLIC, and this harness runs as
-- that role. The helpers are called after SET ROLE anon / authenticated / service_role, so they are granted here.
grant execute on all functions in schema pg_temp to public;

insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true) on conflict (issuer) do nothing;

do $$
declare
  c_iss constant text := 'https://clerk.logloads.test';
  u_land uuid; u_haul uuid; u_drv uuid; u_own2 uuid; u_stranger uuid; u_admin uuid;
  o_land uuid; o_haul uuid; l_one uuid; v_job uuid; v_eoi uuid; m_drv uuid; m_own2 uuid;
  v_q uuid; v_q2 uuid; v_report uuid; v_est record;
begin
  perform pg_temp.as_jwt('service_role');
  u_land     := marketplace.sync_verified_identity(c_iss, 's18_land',     'S18 Landing Owner', 'land@s18.test',     true);
  u_haul     := marketplace.sync_verified_identity(c_iss, 's18_haul',     'S18 Hauling Owner', 'haul@s18.test',     true);
  u_drv      := marketplace.sync_verified_identity(c_iss, 's18_drv',      'S18 Driver',        'drv@s18.test',      true);
  u_own2     := marketplace.sync_verified_identity(c_iss, 's18_own2',     'S18 Second Owner',  'own2@s18.test',     true);
  u_stranger := marketplace.sync_verified_identity(c_iss, 's18_stranger', 'S18 Stranger',      'stranger@s18.test', true);
  u_admin    := marketplace.sync_verified_identity(c_iss, 's18_admin',    'S18 Reviewer',      'admin@s18.test',    true);

  -- -------------------------------------------------------------------------
  -- Fixture: a landing organization on a paid plan with an active landing and a published job, and a private
  -- hauling business (no consent to discovery) whose owner invites a driver.
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 's18_land');
  o_land := marketplace.create_organization('S18 Landing Co', 's18-landing', 'OR', false);
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_land, 'basic', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_s18', 'sub_s18', false, 7, false);
  perform pg_temp.as_jwt('authenticated', 's18_land');
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_land, 'S18 Landing', 'active', 'Near Sisters, OR', marketplace.make_public_point(-121.5, 44.3), 'OR')
  returning id into l_one;
  v_job := marketplace.publish_job_posting(
    l_one, 'S18 Fir Haul', array['log_truck'], 3, 'Fir sawlogs', 'Suite 19 haul.', 'per_ton', 525, null,
    3, current_date + 10, 8, 3.0, 9, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);

  perform pg_temp.as_jwt('authenticated', 's18_haul');
  o_haul := marketplace.create_organization('S18 Private Hauling', 's18-hauling', 'OR', true);
  insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
  values (o_haul, u_drv, 'driver', false, 'invited')
  returning id into m_drv;

  -- HF-05: an invitee reads the organization that invited them and who invited them, before accepting.
  perform pg_temp.as_jwt('authenticated', 's18_drv');
  perform pg_temp.ok(exists (select 1 from marketplace.organizations where id = o_haul),
    'HF-05: an invitee reads the private organization that invited them');
  perform pg_temp.ok(exists (select 1 from marketplace.app_users where id = u_haul),
    'HF-05: ... and the person who invited them');
  update marketplace.organization_memberships set status = 'active' where id = m_drv;

  -- -------------------------------------------------------------------------
  -- HF-03: a landing's decline is final for that job
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 's18_haul');
  select interest_id into v_eoi from marketplace.submit_expression_of_interest(o_haul, v_job, 1);
  perform pg_temp.as_jwt('authenticated', 's18_land');
  perform marketplace.respond_to_interest(v_eoi, 'declined', null, gen_random_uuid(), 'Fully booked this month');

  perform pg_temp.as_jwt('authenticated', 's18_drv');
  perform pg_temp.fails(format('select marketplace.withdraw_interest(%L::uuid)', v_eoi),
    '23514', 'closed this inquiry', 'HF-03: a driver of the hauling business cannot withdraw a declined inquiry');
  perform pg_temp.as_jwt('authenticated', 's18_haul');
  perform pg_temp.fails(format('select marketplace.withdraw_interest(%L::uuid)', v_eoi),
    '23514', 'closed this inquiry', 'HF-03: ... nor can its owner');
  perform pg_temp.fails(format('select * from marketplace.submit_expression_of_interest(%L::uuid, %L::uuid, 2)', o_haul, v_job),
    '23514', 'closed this inquiry', 'HF-03: sending interest in the same job again is refused');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'declined' and withdrawn_at is null from marketplace.expressions_of_interest where id = v_eoi)
    and (select count(*) = 1 from marketplace.expressions_of_interest where job_id = v_job and hauler_org_id = o_haul)
    and not exists (select 1 from marketplace.audit_events where entity_id = v_eoi and action in ('interest.withdrawn', 'interest.renewed')),
    'HF-03: the inquiry stays declined: never withdrawn, renewed or duplicated');
  perform pg_temp.as_jwt('authenticated', 's18_land');
  perform pg_temp.fails(format($q$select marketplace.respond_to_interest(%L::uuid, 'replied', null, gen_random_uuid(), 'Back on?')$q$, v_eoi),
    '23514', 'inquiry is closed', 'HF-03: the landing''s conversation stays closed');

  -- -------------------------------------------------------------------------
  -- HF-05: no directory enumeration of people or organizations
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 's18_stranger');
  perform pg_temp.fails('select created_by from marketplace.organizations limit 1', '42501', 'permission denied',
    'HF-05: who created an organization is not client-readable');
  perform pg_temp.ok(not exists (select 1 from marketplace.organizations where id = o_haul),
    'HF-05: a stranger cannot read a private hauling business');
  perform pg_temp.ok(exists (select 1 from marketplace.organizations where id = o_land),
    'HF-05: ... but reads an organization that runs an active landing');
  perform pg_temp.ok((select count(*) from marketplace.app_users) = 1
    and exists (select 1 from marketplace.app_users where id = u_stranger),
    'HF-05: a stranger lists no one but themselves');

  perform pg_temp.as_jwt('anon');
  perform pg_temp.ok(not exists (select 1 from marketplace.organizations where id = o_haul)
    and exists (select 1 from marketplace.organizations where id = o_land),
    'HF-05: anonymous discovery lists only organizations with a public presence');
  perform pg_temp.ok(exists (select 1 from marketplace.landings where id = l_one),
    'HF-05: anonymous discovery still lists the active landing (its organization check passes)');

  perform pg_temp.as_jwt('authenticated', 's18_drv');
  perform pg_temp.ok(exists (select 1 from marketplace.app_users where id = u_haul)
    and exists (select 1 from marketplace.organizations where id = o_haul),
    'HF-05: a member reads a colleague and their own organization');
  perform pg_temp.ok(exists (select 1 from marketplace.app_users where id = u_land),
    'HF-05: the hauling side reads the landing member who wrote on its inquiry');
  perform pg_temp.ok(not exists (select 1 from marketplace.app_users where id = u_stranger),
    'HF-05: ... but not a stranger');

  perform pg_temp.as_jwt('authenticated', 's18_land');
  perform pg_temp.ok(exists (select 1 from marketplace.app_users where id = u_haul)
    and exists (select 1 from marketplace.organizations where id = o_haul),
    'HF-05: the landing desk reads the person who sent it an inquiry, and that private business');
  perform pg_temp.ok(not exists (select 1 from marketplace.app_users where id = u_drv)
    and not exists (select 1 from marketplace.app_users where id = u_stranger),
    'HF-05: ... but no one else in that business, and no stranger');
  update marketplace.organizations set legal_name = 'S18 Landing LLC' where id = o_land;
  perform pg_temp.ok((select legal_name = 'S18 Landing LLC' from marketplace.organizations where id = o_land),
    'HF-05: an owner still reads their own organization''s legal name');

  -- -------------------------------------------------------------------------
  -- HF-06: editing a verified qualification returns it to self-reported
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 's18_haul');
  insert into marketplace.user_qualifications (user_id, kind, label, expires_on)
  values (u_haul, 'cdl', 'Class A CDL', current_date + 300)
  returning id into v_q;
  insert into marketplace.user_qualifications (user_id, kind, label)
  values (u_haul, 'endorsement', 'Doubles endorsement')
  returning id into v_q2;
  perform pg_temp.as_jwt('harness');
  update marketplace.user_qualifications set verification_status = 'verified', reviewed_by = u_admin, reviewed_at = now() where id = v_q;
  update marketplace.user_qualifications set verification_status = 'rejected', reviewed_by = u_admin, reviewed_at = now() where id = v_q2;

  perform pg_temp.as_jwt('authenticated', 's18_haul');
  update marketplace.user_qualifications set label = label where id = v_q;
  perform pg_temp.ok((select verification_status = 'verified' from marketplace.user_qualifications where id = v_q),
    'HF-06: an update that changes nothing keeps the verification');
  update marketplace.user_qualifications set expires_on = current_date + 900 where id = v_q;
  perform pg_temp.ok((select verification_status = 'self_reported' and reviewed_at is null from marketplace.user_qualifications where id = v_q),
    'HF-06: editing a verified qualification returns it to self-reported');
  update marketplace.user_qualifications set label = 'Doubles and triples endorsement' where id = v_q2;
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select reviewed_by is null from marketplace.user_qualifications where id = v_q)
    and exists (select 1 from marketplace.audit_events
                where entity_id = v_q and action = 'qualification.verification_reset' and actor_user_id = u_haul
                  and metadata -> 'changed' = '["expires_on"]'::jsonb),
    'HF-06: ... clears the reviewer and is audited with the changed column (not its value)');
  perform pg_temp.ok((select verification_status = 'rejected' and reviewed_by = u_admin from marketplace.user_qualifications where id = v_q2),
    'HF-06: editing a rejected qualification does not clear the rejection');

  -- -------------------------------------------------------------------------
  -- HF-16: the reporter does not read who reviewed the report
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 's18_stranger');
  insert into marketplace.abuse_reports (target_kind, target_id, reason, details)
  values ('job_posting', v_job, 'spam', 'Suite 19 report')
  returning id into v_report;
  perform pg_temp.as_jwt('harness');
  update marketplace.abuse_reports
  set status = 'actioned', reviewed_by = u_admin, reviewed_at = now(), resolution_note = 'Listing removed'
  where id = v_report;
  perform pg_temp.as_jwt('authenticated', 's18_stranger');
  perform pg_temp.fails('select reviewed_by from marketplace.abuse_reports limit 1', '42501', 'permission denied',
    'HF-16: the reporter cannot read who reviewed the report');
  perform pg_temp.ok((select status = 'actioned' and resolution_note = 'Listing removed' and reviewed_at is not null
                      from marketplace.abuse_reports where id = v_report),
    'HF-16: ... but reads its status and outcome');

  -- -------------------------------------------------------------------------
  -- HF-17: the boost estimate counts only hauling businesses that consented to discovery
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('harness');
  insert into marketplace.availability_reports
    (org_id, equipment_code, available_count, area_center, area_label, radius_miles, available_from, available_until, reported_by)
  values (o_haul, 'log_truck', 2, extensions.st_GeogFromText('SRID=4326;POINT(-121.5 44.3)'), 'Near Sisters', 50,
          current_date, current_date + 10, u_haul);
  perform pg_temp.as_jwt('authenticated', 's18_land');
  select * into v_est from marketplace.estimate_boost_audience(v_job);
  perform pg_temp.ok(v_est.opted_in_haulers = 0 and v_est.active_availability_reports = 0,
    'HF-17: availability from a hauling business that did not consent to discovery is not counted');
  perform pg_temp.as_jwt('authenticated', 's18_haul');
  update marketplace.hauler_profiles
  set is_public = true, service_center = extensions.st_GeogFromText('SRID=4326;POINT(-121.4 44.2)')
  where org_id = o_haul;
  perform pg_temp.as_jwt('authenticated', 's18_land');
  select * into v_est from marketplace.estimate_boost_audience(v_job);
  perform pg_temp.ok(v_est.opted_in_haulers = 1 and v_est.active_availability_reports = 1,
    'HF-17: ... and is counted once the business consents');

  -- HF-05 after consent: the business is listed; its people still are not.
  perform pg_temp.as_jwt('authenticated', 's18_stranger');
  perform pg_temp.ok(exists (select 1 from marketplace.organizations where id = o_haul),
    'HF-05: a hauling business that consented to discovery is listed');
  perform pg_temp.ok(not exists (select 1 from marketplace.app_users where id = u_haul),
    'HF-05: ... its people still are not');

  -- -------------------------------------------------------------------------
  -- HF-15 (single session): the last active owner cannot leave or step down
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 's18_haul');
  insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
  values (o_haul, u_own2, 'owner', false, 'invited')
  returning id into m_own2;
  perform pg_temp.as_jwt('authenticated', 's18_own2');
  update marketplace.organization_memberships set status = 'active' where id = m_own2;
  update marketplace.organization_memberships set status = 'removed' where id = m_own2;
  perform pg_temp.ok((select status = 'removed' from marketplace.organization_memberships where id = m_own2),
    'HF-15: an owner can leave while another owner remains');
  perform pg_temp.as_jwt('authenticated', 's18_haul');
  perform pg_temp.fails(format($q$update marketplace.organization_memberships set status = 'removed' where org_id = %L::uuid and user_id = %L::uuid$q$, o_haul, u_haul),
    '23514', 'at least one active owner', 'HF-15: the last active owner cannot leave');
  perform pg_temp.fails(format($q$update marketplace.organization_memberships set role = 'manager' where org_id = %L::uuid and user_id = %L::uuid$q$, o_haul, u_haul),
    '23514', 'at least one active owner', 'HF-15: ... or step down');

  -- -------------------------------------------------------------------------
  -- HF-18: new functions created by the migration role are not executable by PUBLIC
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(exists (
      select 1 from pg_default_acl d
      where d.defaclrole = (select oid from pg_roles where rolname = current_user)
        and d.defaclnamespace = 0 and d.defaclobjtype = 'f'
        and not exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = 0)),
    'HF-18: the migration role''s global default for functions withholds EXECUTE from PUBLIC');
  execute $q$create function marketplace.s18_default_acl_probe() returns integer language sql as 'select 1'$q$;
  perform pg_temp.ok(not has_function_privilege('public', 'marketplace.s18_default_acl_probe()', 'EXECUTE')
    and not has_function_privilege('anon', 'marketplace.s18_default_acl_probe()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'marketplace.s18_default_acl_probe()', 'EXECUTE')
    and not has_function_privilege('service_role', 'marketplace.s18_default_acl_probe()', 'EXECUTE'),
    'HF-18: a function the migration role creates without any grant is not executable by PUBLIC or any API role');

  raise notice 'ALL REVIEW-106 HARDENING (HF-03, HF-05, HF-06, HF-15, HF-16, HF-17, HF-18) TESTS PASSED.';
end
$$;

rollback;
