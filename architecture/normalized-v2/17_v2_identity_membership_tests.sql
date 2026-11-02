-- =============================================================================
-- LogLoads normalized-v2 — 17 regression suite for 16 (B-1, B-2, B-5)
--
-- NON-ACTIVE PROTOTYPE TEST SUITE. Disposable PostgreSQL only. Run after
-- 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16. Wraps everything in BEGIN ... ROLLBACK.
-- Negative tests require the expected SQLSTATE AND a matching message or constraint name.
-- =============================================================================

begin;

create function pg_temp.as_jwt(p_role text, p_sub text default null) returns void language plpgsql as $$
begin
  if p_role = 'service_role' then
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    execute 'set local role service_role';
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

insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true) on conflict (issuer) do nothing;

do $$
declare
  c_iss constant text := 'https://clerk.logloads.test';
  u_own uuid; u_inv uuid; u_inv2 uuid; u_land uuid; u_haul uuid; u_a uuid; u_b uuid; u_d uuid;
  o_haul uuid; o_land uuid; o_priv uuid;
  m_inv uuid; v_q uuid;
begin
  perform pg_temp.as_jwt('service_role');
  u_own  := marketplace.sync_verified_identity(c_iss, 's16_owner', 'S16 Owner',     'owner@s16.test', true);
  u_inv  := marketplace.sync_verified_identity(c_iss, 's16_inv',   'S16 Invitee',   'inv@s16.test',   true);
  u_inv2 := marketplace.sync_verified_identity(c_iss, 's16_inv2',  'S16 Invitee 2', 'inv2@s16.test',  true);
  u_land := marketplace.sync_verified_identity(c_iss, 's16_land',  'S16 Landing',   'land@s16.test',  true);
  u_haul := marketplace.sync_verified_identity(c_iss, 's16_haul',  'S16 Hauler',    'haul@s16.test',  true);

  -- -------------------------------------------------------------------------
  -- B-1: acceptance is the member's own act
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 's16_owner');
  o_haul := marketplace.create_organization('S16 Hauling', 's16-hauling', 'OR', true);
  perform pg_temp.ok((select status = 'active' and accepted_at is not null from marketplace.organization_memberships
                      where org_id = o_haul and user_id = u_own),
    'B-1: an organization''s creator is an accepted, active owner');
  insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
  values (o_haul, u_inv, 'driver', false, 'invited')
  returning id into m_inv;
  update marketplace.organization_memberships set status = 'suspended' where id = m_inv;
  perform pg_temp.fails(format('update marketplace.organization_memberships set status = %L where id = %L', 'active', m_inv),
    '42501', 'only the invited person', 'B-1: an owner cannot activate an invitation by way of suspension');
  perform pg_temp.ok((select status = 'suspended' and accepted_at is null from marketplace.organization_memberships where id = m_inv),
    'B-1: ... the membership stays suspended and unaccepted');
  perform pg_temp.fails(format('update marketplace.organization_memberships set accepted_at = now() where id = %L', m_inv),
    '42501', 'permission denied', 'B-1: accepted_at is not client-writable');
  perform pg_temp.fails(format('insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status) values (%L, %L, %L, false, %L)',
      o_haul, u_inv2, 'driver', 'active'),
    '42501', 'starts as an invitation|row-level security', 'B-1: an owner cannot add someone as an active member');

  update marketplace.organization_memberships set status = 'invited' where id = m_inv;
  perform pg_temp.as_jwt('authenticated', 's16_inv');
  update marketplace.organization_memberships set status = 'active' where id = m_inv;
  perform pg_temp.ok((select status = 'active' and accepted_at is not null from marketplace.organization_memberships where id = m_inv),
    'B-1: the invited person accepts, and the acceptance is recorded');
  perform pg_temp.as_jwt('authenticated', 's16_owner');
  update marketplace.organization_memberships set status = 'suspended' where id = m_inv;
  update marketplace.organization_memberships set status = 'active' where id = m_inv;
  perform pg_temp.ok((select status = 'active' from marketplace.organization_memberships where id = m_inv),
    'B-1: an owner can reinstate a suspended member who had accepted');

  -- -------------------------------------------------------------------------
  -- B-5: only provider-verified email addresses are stored
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('service_role');
  u_a := marketplace.sync_verified_identity(c_iss, 's16_a', 'S16 A', 'Shared@S16.test', false);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(not exists (select 1 from marketplace.user_contacts where user_id = u_a and email is not null),
    'B-5: an unverified address is not stored (it cannot pre-claim the address)');
  perform pg_temp.as_jwt('service_role');
  u_b := marketplace.sync_verified_identity(c_iss, 's16_b', 'S16 B', 'shared@s16.test', true);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select email = 'shared@s16.test' and email_verified_at is not null from marketplace.user_contacts where user_id = u_b),
    'B-5: the verified owner holds the address');

  -- An unverified copy written before 16 (pre-V2 data) is released when the verified owner arrives.
  insert into marketplace.user_contacts (user_id, email, email_verified_at) values (u_a, 'legacy@s16.test', null)
  on conflict (user_id) do update set email = excluded.email, email_verified_at = null;
  perform pg_temp.as_jwt('service_role');
  u_d := marketplace.sync_verified_identity(c_iss, 's16_d', 'S16 D', 'legacy@s16.test', true);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select email = 'legacy@s16.test' and email_verified_at is not null from marketplace.user_contacts where user_id = u_d)
    and (select email is null from marketplace.user_contacts where user_id = u_a)
    and exists (select 1 from marketplace.audit_events where action = 'identity.unverified_email_released' and entity_id = u_a),
    'B-5: a verified owner takes the address back from an unverified copy held by another account (audited)');

  -- An address change: an unverified new address neither replaces the verified one nor inherits its verification.
  perform pg_temp.as_jwt('service_role');
  perform marketplace.sync_verified_identity(c_iss, 's16_b', 'S16 B', 'changed@s16.test', false);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select email = 'shared@s16.test' and email_verified_at is not null from marketplace.user_contacts where user_id = u_b),
    'B-5: an unverified new address does not replace the verified one or inherit its verification');
  perform pg_temp.as_jwt('service_role');
  perform marketplace.sync_verified_identity(c_iss, 's16_b', 'S16 B', 'changed@s16.test', true);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select email = 'changed@s16.test' and email_verified_at is not null from marketplace.user_contacts where user_id = u_b),
    'B-5: a verified new address replaces the old one with its own verification');

  -- -------------------------------------------------------------------------
  -- B-2: qualifications follow the F1 consent model
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 's16_land');
  o_land := marketplace.create_organization('S16 Landing Co', 's16-landing', 'OR', false);
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_land, 'basic', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_s16', 'sub_s16', false, 7, false);
  perform pg_temp.as_jwt('authenticated', 's16_haul');
  o_priv := marketplace.create_organization('S16 Private Hauling', 's16-private', 'OR', true);
  insert into marketplace.user_qualifications (user_id, kind, label) values (u_haul, 'cdl', 'Class A CDL')
  returning id into v_q;
  perform pg_temp.ok(exists (select 1 from marketplace.user_qualifications where id = v_q),
    'B-2: a person reads their own qualifications');

  perform pg_temp.as_jwt('authenticated', 's16_land');
  perform pg_temp.ok(marketplace.current_user_has_landing_access(), 'B-2 setup: the landing desk has landing access');
  perform pg_temp.ok(not exists (select 1 from marketplace.user_qualifications where id = v_q),
    'B-2: a landing desk cannot read the qualifications of someone in a private hauling business with no inquiry');
  perform pg_temp.as_jwt('authenticated', 's16_inv2');
  perform pg_temp.ok(not exists (select 1 from marketplace.user_qualifications where id = v_q),
    'B-2: a user without landing access cannot read another person''s qualifications');

  perform pg_temp.as_jwt('authenticated', 's16_haul');
  update marketplace.hauler_profiles set is_public = true where org_id = o_priv;
  perform pg_temp.as_jwt('authenticated', 's16_land');
  perform pg_temp.ok(exists (select 1 from marketplace.user_qualifications where id = v_q),
    'B-2: ... and can once that hauling business consents to public discovery');
  perform pg_temp.as_jwt('authenticated', 's16_inv2');
  perform pg_temp.ok(not exists (select 1 from marketplace.user_qualifications where id = v_q),
    'B-2: consent opens qualifications to landing desks only, not to every user');

  raise notice 'ALL IDENTITY, MEMBERSHIP AND QUALIFICATION (B-1, B-2, B-5) TESTS PASSED.';
end
$$;

rollback;
