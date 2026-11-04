-- =============================================================================
-- LogLoads normalized-v2 — 24 regression suite for 23 (hardening round 2, follow-ups from the PR #194 review, #187)
--
-- NON-ACTIVE PROTOTYPE TEST SUITE. Disposable PostgreSQL only. Run after
-- 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23. Wraps everything in BEGIN ... ROLLBACK.
-- Negative tests require the expected SQLSTATE AND a matching message or constraint name.
-- R2-1's races (an owner exit against billing, two owners leaving at once) need two sessions:
-- 25_v2_round2_concurrency_test.sh. This suite covers the single-session rules.
-- Run as the role that applied 23 (the table owner, which the fixture uses for staff and service steps).
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

-- Whether the presented identity reads the organization / the person through row-level security.
create function pg_temp.sees_org(p_sub text, p_org uuid) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform pg_temp.as_jwt('authenticated', p_sub);
  select exists (select 1 from marketplace.organizations where id = p_org) into v;
  return v;
end
$$;

create function pg_temp.sees_user(p_sub text, p_user uuid) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform pg_temp.as_jwt('authenticated', p_sub);
  select exists (select 1 from marketplace.app_users where id = p_user) into v;
  return v;
end
$$;

-- 18 (HF-18) withholds EXECUTE from PUBLIC on functions this role creates; the helpers run after SET ROLE.
grant execute on all functions in schema pg_temp to public;

insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true) on conflict (issuer) do nothing;

do $$
declare
  c_iss constant text := 'https://clerk.logloads.test';
  u_own uuid; u_own2 uuid; u_drv uuid; u_inv uuid; u_dec uuid; u_late uuid; u_str uuid; u_land uuid; u_admin uuid;
  o_haul uuid; o_land uuid; m_drv uuid; m_inv uuid; m_dec uuid; m_own2 uuid; m_late uuid;
  v_q uuid; v_expires date;
begin
  perform pg_temp.as_jwt('service_role');
  u_own   := marketplace.sync_verified_identity(c_iss, 's23_own',   'S23 Hauling Owner', 'own@s23.test',   true);
  u_own2  := marketplace.sync_verified_identity(c_iss, 's23_own2',  'S23 Second Owner',  'own2@s23.test',  true);
  u_drv   := marketplace.sync_verified_identity(c_iss, 's23_drv',   'S23 Driver',        'drv@s23.test',   true);
  u_inv   := marketplace.sync_verified_identity(c_iss, 's23_inv',   'S23 Invitee',       'inv@s23.test',   true);
  u_dec   := marketplace.sync_verified_identity(c_iss, 's23_dec',   'S23 Decliner',      'dec@s23.test',   true);
  u_late  := marketplace.sync_verified_identity(c_iss, 's23_late',  'S23 Late Invitee',  'late@s23.test',  true);
  u_str   := marketplace.sync_verified_identity(c_iss, 's23_str',   'S23 Stranger',      'str@s23.test',   true);
  u_land  := marketplace.sync_verified_identity(c_iss, 's23_land',  'S23 Landing Owner', 'land@s23.test',  true);
  u_admin := marketplace.sync_verified_identity(c_iss, 's23_admin', 'S23 Reviewer',      'admin@s23.test', true);

  -- -------------------------------------------------------------------------
  -- Fixture: a private hauling business (no landing, no consent to discovery) that invites a driver, an invitee
  -- and a person who will decline; and a landing organization with an active landing (a public presence).
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 's23_land');
  o_land := marketplace.create_organization('S23 Landing Co', 's23-landing', 'OR', false);
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_land, 'basic', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_s23', 'sub_s23', false, 7, false);
  perform pg_temp.as_jwt('authenticated', 's23_land');
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_land, 'S23 Landing', 'active', 'Near Sisters, OR', marketplace.make_public_point(-121.5, 44.3), 'OR');

  perform pg_temp.as_jwt('authenticated', 's23_own');
  o_haul := marketplace.create_organization('S23 Private Hauling', 's23-hauling', 'OR', true);
  insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
  values (o_haul, u_drv, 'driver', false, 'invited') returning id into m_drv;
  insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
  values (o_haul, u_inv, 'driver', false, 'invited') returning id into m_inv;
  insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
  values (o_haul, u_dec, 'driver', false, 'invited') returning id into m_dec;
  perform pg_temp.as_jwt('authenticated', 's23_drv');
  update marketplace.organization_memberships set status = 'active' where id = m_drv;

  -- -------------------------------------------------------------------------
  -- R2-3: a pending invitation exposes no profile; the invitation flow still works
  -- -------------------------------------------------------------------------
  perform pg_temp.ok(not pg_temp.sees_user('s23_own', u_inv),
    'R2-3: an owner cannot read the profile of a person they invited who has not accepted');
  perform pg_temp.ok(not pg_temp.sees_user('s23_drv', u_inv),
    'R2-3: ... nor can a colleague in the inviting organization');
  perform pg_temp.as_jwt('authenticated', 's23_own');
  perform pg_temp.ok(exists (select 1 from marketplace.organization_memberships where id = m_inv and status = 'invited' and user_id = u_inv),
    'R2-3: the owner still reads the pending invitation row it wrote');
  perform pg_temp.ok(pg_temp.sees_user('s23_own', u_drv) and pg_temp.sees_user('s23_drv', u_own),
    'R2-3: colleagues who accepted read each other (positive control)');
  perform pg_temp.ok(pg_temp.sees_org('s23_inv', o_haul),
    'R2-2/R2-3: the invitee reads the private organization that invited them, before accepting');
  perform pg_temp.ok(pg_temp.sees_user('s23_inv', u_own),
    'R2-3: ... and the person who invited them');
  perform pg_temp.ok(not pg_temp.sees_user('s23_inv', u_drv),
    'R2-3: ... but not the organization''s other members until they accept');
  perform pg_temp.ok(not pg_temp.sees_user('s23_str', u_inv) and not pg_temp.sees_org('s23_str', o_haul),
    'R2-3: a stranger reads neither the invitee nor the private organization');

  -- A declined invitation (left without accepting) opens nothing, in either direction.
  perform pg_temp.as_jwt('authenticated', 's23_dec');
  update marketplace.organization_memberships set status = 'removed' where id = m_dec;
  perform pg_temp.ok(not pg_temp.sees_org('s23_dec', o_haul),
    'R2-2: a person who declined an invitation no longer reads the private organization');
  perform pg_temp.ok(not pg_temp.sees_user('s23_own', u_dec),
    'R2-3: ... and the organization never reads the profile of the person who declined');
  perform pg_temp.ok(pg_temp.sees_org('s23_dec', o_land),
    'R2-2: public visibility is unaffected: they still read an organization that runs an active landing');

  -- Acceptance opens the profile.
  perform pg_temp.as_jwt('authenticated', 's23_inv');
  update marketplace.organization_memberships set status = 'active' where id = m_inv;
  perform pg_temp.ok(pg_temp.sees_user('s23_own', u_inv) and pg_temp.sees_user('s23_drv', u_inv),
    'R2-3: once the invitee accepts, the organization reads their profile');
  perform pg_temp.ok(pg_temp.sees_user('s23_inv', u_drv),
    'R2-3: ... and they read their new colleagues');

  -- -------------------------------------------------------------------------
  -- R2-2: only an active membership (or a pending invitation) in an active organization opens it
  -- -------------------------------------------------------------------------
  perform pg_temp.ok(pg_temp.sees_org('s23_drv', o_haul), 'R2-2: an active member reads their private organization (positive control)');
  perform pg_temp.as_jwt('authenticated', 's23_own');
  update marketplace.organization_memberships set status = 'suspended' where id = m_drv;
  perform pg_temp.ok(not pg_temp.sees_org('s23_drv', o_haul),
    'R2-2: a suspended member no longer reads the private organization');
  perform pg_temp.ok(pg_temp.sees_user('s23_own', u_drv),
    'R2-3: the organization still reads a suspended member who had accepted');
  perform pg_temp.as_jwt('authenticated', 's23_own');
  update marketplace.organization_memberships set status = 'active' where id = m_drv;
  perform pg_temp.ok(pg_temp.sees_org('s23_drv', o_haul), 'R2-2: reinstating the member restores the read');
  perform pg_temp.as_jwt('authenticated', 's23_drv');
  update marketplace.organization_memberships set status = 'removed' where id = m_drv;
  perform pg_temp.ok(not pg_temp.sees_org('s23_drv', o_haul),
    'R2-2: a member who left no longer reads the private organization');
  perform pg_temp.ok(pg_temp.sees_user('s23_own', u_drv),
    'R2-3: the organization still reads a former colleague who had accepted (its history)');
  perform pg_temp.ok(not pg_temp.sees_user('s23_drv', u_inv),
    'R2-3: ... but the former member no longer reads the organization''s people');

  -- -------------------------------------------------------------------------
  -- R2-1 (single session): HF-15's last-owner rule is unchanged under the new lock. Which lock an exit takes, and
  -- that it no longer deadlocks with billing, is proved with two sessions in 25 (so a run of the chain with the fix
  -- removed still reaches 25 and shows the deadlock there).
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 's23_own');
  insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
  values (o_haul, u_own2, 'owner', false, 'invited') returning id into m_own2;
  perform pg_temp.as_jwt('authenticated', 's23_own2');
  update marketplace.organization_memberships set status = 'active' where id = m_own2;
  update marketplace.organization_memberships set status = 'removed' where id = m_own2;
  perform pg_temp.ok((select status = 'removed' and ended_at is not null from marketplace.organization_memberships where id = m_own2),
    'R2-1/HF-15: an owner can leave while another owner remains');
  perform pg_temp.as_jwt('authenticated', 's23_own');
  perform pg_temp.fails(format($q$update marketplace.organization_memberships set status = 'removed' where org_id = %L::uuid and user_id = %L::uuid$q$, o_haul, u_own),
    '23514', 'at least one active owner', 'R2-1/HF-15: the last active owner still cannot leave');
  perform pg_temp.fails(format($q$update marketplace.organization_memberships set role = 'manager' where org_id = %L::uuid and user_id = %L::uuid$q$, o_haul, u_own),
    '23514', 'at least one active owner', 'R2-1/HF-15: ... or step down');

  -- -------------------------------------------------------------------------
  -- R2-2: a suspended organization is not readable through a membership or an invitation
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 's23_own');
  insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
  values (o_haul, u_late, 'driver', false, 'invited') returning id into m_late;
  perform pg_temp.ok(pg_temp.sees_org('s23_late', o_haul) and pg_temp.sees_org('s23_own', o_haul),
    'R2-2: before suspension, the owner and a pending invitee read the organization (positive control)');
  perform pg_temp.as_jwt('harness');
  update marketplace.organizations set status = 'suspended' where id = o_haul;
  perform pg_temp.ok(not pg_temp.sees_org('s23_own', o_haul) and not pg_temp.sees_org('s23_inv', o_haul),
    'R2-2: members of a suspended organization no longer read it');
  perform pg_temp.ok(not pg_temp.sees_org('s23_late', o_haul),
    'R2-2: ... nor does a pending invitee of it');
  perform pg_temp.ok(pg_temp.sees_org('s23_own', o_land) and pg_temp.sees_org('s23_str', o_land),
    'R2-2: an organization with an active landing stays publicly readable');
  perform pg_temp.as_jwt('anon');
  perform pg_temp.ok(exists (select 1 from marketplace.organizations where id = o_land)
                     and not exists (select 1 from marketplace.organizations where id = o_haul),
    'R2-2: anonymous discovery is unchanged (public presence only)');
  perform pg_temp.as_jwt('harness');
  update marketplace.organizations set status = 'active' where id = o_haul;
  perform pg_temp.ok(pg_temp.sees_org('s23_own', o_haul) and pg_temp.sees_org('s23_late', o_haul),
    'R2-2: reactivating the organization restores the reads');

  -- -------------------------------------------------------------------------
  -- R2-4: HF-06 has no exemption; the documented two-statement re-verification works
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 's23_own');
  insert into marketplace.user_qualifications (user_id, kind, label, expires_on)
  values (u_own, 'cdl', 'Class A CDL', current_date + 30)
  returning id into v_q;
  perform pg_temp.ok(not has_column_privilege('authenticated', 'marketplace.user_qualifications', 'verification_status', 'UPDATE')
                     and not has_column_privilege('authenticated', 'marketplace.user_qualifications', 'reviewed_by', 'UPDATE')
                     and not has_column_privilege('authenticated', 'marketplace.user_qualifications', 'reviewed_at', 'UPDATE'),
    'R2-4: clients cannot write the verification status or the reviewer (only a staff function can re-verify)');

  -- Stand-in for a staff SECURITY DEFINER function (the table owner, as such a function would run).
  perform pg_temp.as_jwt('harness');
  update marketplace.user_qualifications set verification_status = 'verified', reviewed_by = u_admin, reviewed_at = now() where id = v_q;
  v_expires := current_date + 395;
  update marketplace.user_qualifications
  set expires_on = v_expires, verification_status = 'verified', reviewed_by = u_admin, reviewed_at = clock_timestamp()
  where id = v_q;
  perform pg_temp.ok((select verification_status = 'self_reported' and reviewed_by is null and reviewed_at is null
                      from marketplace.user_qualifications where id = v_q),
    'R2-4: a single update that edits a verified qualification and re-asserts verified is still reset (no exemption)');
  update marketplace.user_qualifications set verification_status = 'verified', reviewed_by = u_admin, reviewed_at = now() where id = v_q;
  -- The documented path: the edit first (reset, audited), then the verification.
  update marketplace.user_qualifications set expires_on = v_expires + 30 where id = v_q;
  update marketplace.user_qualifications set verification_status = 'verified', reviewed_by = u_admin, reviewed_at = clock_timestamp() where id = v_q;
  perform pg_temp.ok((select verification_status = 'verified' and expires_on = v_expires + 30 and reviewed_by = u_admin
                      from marketplace.user_qualifications where id = v_q),
    'R2-4: editing first and verifying in a second statement re-verifies the qualification with its new expiry');
  perform pg_temp.ok((select count(*) = 2 from marketplace.audit_events
                      where entity_id = v_q and action = 'qualification.verification_reset'
                        and metadata -> 'changed' = '["expires_on"]'::jsonb),
    'R2-4: ... and each edit of the verified row is audited as a reset');
  perform pg_temp.ok(coalesce(obj_description('marketplace.tg_qualification_verification_reset()'::regprocedure, 'pg_proc'), '')
                       ~ 'There is no exemption.*two statements',
    'R2-4: the re-verification path is documented on the trigger function');

  -- -------------------------------------------------------------------------
  -- Ledger
  -- -------------------------------------------------------------------------
  perform pg_temp.ok((select string_agg(version, ',' order by applied_at, version) from marketplace.schema_migrations) = '06,11,12,16,18,23',
    'the migration ledger records 06, 11, 12, 16, 18, 23 in order');

  raise notice 'ALL ROUND-2 HARDENING (R2-1, R2-2, R2-3, R2-4) TESTS PASSED.';
end
$$;

rollback;
