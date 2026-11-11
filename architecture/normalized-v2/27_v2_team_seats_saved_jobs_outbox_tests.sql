-- =============================================================================
-- LogLoads normalized-v2 — 27 regression suite for 26 (seat invitations, staff-to-landing scope, saved jobs,
-- notification outbox; #237)
--
-- NON-ACTIVE PROTOTYPE TEST SUITE. Disposable PostgreSQL only. Run after
-- 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23 -> 26; stage 30 runs it again after 29. Wraps everything in
-- BEGIN ... ROLLBACK.
-- Negative tests require the expected SQLSTATE AND a matching message or constraint name.
-- Races (two owners inviting for the last seat, an invitation against a direct membership, accept against revoke,
-- two email workers claiming at once) need two sessions: 28_v2_team_seats_outbox_concurrency_test.sh.
-- Run as the role that applied 26 (the table owner, which the fixture uses for staff and service steps).
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

-- The person's verified claims, but the table owner's role: a stand-in for a SECURITY DEFINER function acting for them.
create function pg_temp.claims_only(p_sub text) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', p_sub, 'aud', 'logloads-app',
    'exp', extract(epoch from now())::bigint + 3600)::text, true);
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

-- A count read through row-level security as the presented identity.
create function pg_temp.count_as(p_sub text, p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform pg_temp.as_jwt('authenticated', p_sub);
  execute p_sql into v;
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
  u_own uuid; u_bown uuid; u_mgr uuid; u_stf2 uuid; u_staff uuid; u_wide uuid; u_lmgr uuid; u_other uuid; u_unv uuid;
  u_haul uuid; u_hdrv uuid; u_dec uuid; u_late uuid; u_str uuid; u_admin uuid; u_h3 uuid; u_pown uuid; u_p1 uuid; u_p2 uuid;
  o_land uuid; o_basic uuid; o_haul uuid; o_haul2 uuid; o_haul3 uuid; o_pro2 uuid; v_p1 uuid; v_p2 uuid; m_p1 uuid; e_h3 uuid;
  l_a uuid; l_b uuid; l_c uuid;
  j_a uuid; j_b uuid; j_b2 uuid; j_s1 uuid; j_s2 uuid; j_s3 uuid; j_x uuid; j_staff uuid; d_b uuid;
  e_a uuid; e_b uuid;
  m_hdrv uuid; m_mgr uuid; m_staff uuid; m_wide uuid; m_lmgr uuid; m_own uuid; m_late uuid;
  v_inv1 uuid; v_inv2 uuid; v_inv2b uuid; v_inv3 uuid; v_crew uuid; v_dec uuid; v_unv uuid; v_late uuid; v_late2 uuid;
  v_inv_staff uuid; v_inv_wide uuid; v_inv_lmgr uuid;
  v_exp timestamptz; v_exp2 timestamptz; v_n integer; v_txt text; v_ep uuid; v_ss uuid; v_in uuid; v_em uuid;
  n_haul uuid; t_haul uuid; n_crew uuid; t_crew uuid; n_s2b uuid; t_s2b uuid; n_unv uuid; t_unv uuid; t_unv2 uuid;
  n_jx uuid; r record;
begin
  perform pg_temp.as_jwt('service_role');
  u_own   := marketplace.sync_verified_identity(c_iss, 's26_own',   'S26 Landing Owner', 'own@s26.test',   true);
  u_bown  := marketplace.sync_verified_identity(c_iss, 's26_bown',  'S26 Basic Owner',   'bown@s26.test',  true);
  u_mgr   := marketplace.sync_verified_identity(c_iss, 's26_mgr',   'S26 Manager',       'mgr@s26.test',   true);
  u_stf2  := marketplace.sync_verified_identity(c_iss, 's26_stf2',  'S26 Staff Two',     'staff2@s26.test', true);
  u_staff := marketplace.sync_verified_identity(c_iss, 's26_staff', 'S26 Foreman A',     'staff@s26.test', true);
  u_wide  := marketplace.sync_verified_identity(c_iss, 's26_wide',  'S26 Office Staff',  'wide@s26.test',  true);
  u_lmgr  := marketplace.sync_verified_identity(c_iss, 's26_lmgr',  'S26 Manager A',     'lmgr@s26.test',  true);
  u_other := marketplace.sync_verified_identity(c_iss, 's26_other', 'S26 Other Person',  'other@s26.test', true);
  u_unv   := marketplace.sync_verified_identity(c_iss, 's26_unv',   'S26 Unverified',    'unv@s26.test',   false);
  u_haul  := marketplace.sync_verified_identity(c_iss, 's26_haul',  'S26 Hauling Owner', 'haul@s26.test',  true);
  u_hdrv  := marketplace.sync_verified_identity(c_iss, 's26_hdrv',  'S26 Driver',        'hdrv@s26.test',  true);
  u_dec   := marketplace.sync_verified_identity(c_iss, 's26_dec',   'S26 Decliner',      'dec@s26.test',   true);
  u_late  := marketplace.sync_verified_identity(c_iss, 's26_late',  'S26 Late Invitee',  'late@s26.test',  true);
  u_str   := marketplace.sync_verified_identity(c_iss, 's26_str',   'S26 Stranger',      'str@s26.test',   true);
  u_admin := marketplace.sync_verified_identity(c_iss, 's26_admin', 'S26 Moderator',     'admin@s26.test', true);
  u_h3    := marketplace.sync_verified_identity(c_iss, 's26_h3',    'S26 Private Hauler', 'h3@s26.test',   true);
  u_pown  := marketplace.sync_verified_identity(c_iss, 's26_pown',  'S26 Pro Owner',     'pown@s26.test',  true);
  u_p1    := marketplace.sync_verified_identity(c_iss, 's26_p1',    'S26 Pro Invitee 1', 'p1@s26.test',    true);
  u_p2    := marketplace.sync_verified_identity(c_iss, 's26_p2',    'S26 Pro Invitee 2', 'p2@s26.test',    true);

  -- -------------------------------------------------------------------------
  -- Fixture: a Pro landing organization (5 seats, 3 active landings) with landings A and B active and C inactive,
  -- jobs at A and B, a draft at B and private details for A and B; a Basic landing organization (2 seats); and a
  -- hauling business with a driver that has inquired on the jobs at A and B.
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('harness');
  insert into marketplace.platform_admins (user_id, admin_role) values (u_admin, 'moderator');

  perform pg_temp.as_jwt('authenticated', 's26_own');
  o_land := marketplace.create_organization('S26 Landing Co', 's26-landing', 'OR', false);
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_land, 'pro', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_s26', 'sub_s26', false, 7, false);
  perform pg_temp.as_jwt('authenticated', 's26_own');
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_land, 'S26 Landing A', 'active', 'Near Sisters, OR', marketplace.make_public_point(-121.5, 44.3), 'OR') returning id into l_a;
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_land, 'S26 Landing B', 'active', 'Near Bend, OR', marketplace.make_public_point(-121.3, 44.1), 'OR') returning id into l_b;
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_land, 'S26 Landing C', 'inactive', 'Near Redmond, OR', marketplace.make_public_point(-121.2, 44.3), 'OR') returning id into l_c;
  insert into marketplace.landing_private_details (landing_id, org_id, directions) values (l_a, o_land, 'A: second spur past the scale house');
  insert into marketplace.landing_private_details (landing_id, org_id, directions) values (l_b, o_land, 'B: north spur after the cattle guard');
  m_own := (select id from marketplace.organization_memberships where org_id = o_land and user_id = u_own);
  j_a := marketplace.publish_job_posting(l_a, 'S26 Fir Haul A', array['log_truck'], 3, 'Fir sawlogs', 'Suite 27 haul A.', 'per_ton', 525, null,
    3, current_date + 10, 8, 3.0, 9, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  j_b := marketplace.publish_job_posting(l_b, 'S26 Pine Haul B', array['log_truck'], 2, 'Pine sawlogs', 'Suite 27 haul B.', 'per_ton', 480, null,
    2, current_date + 12, 8, 3.0, 6, 30.0, 'Prineville Mill, OR', 35, null, null, array['ppe'], true);
  j_b2 := marketplace.publish_job_posting(l_b, 'S26 Hemlock Haul B', array['log_truck'], 2, 'Hemlock', 'Suite 27 haul B two.', 'per_load', 90000, null,
    2, current_date + 14, 8, 3.0, 6, 30.0, 'Prineville Mill, OR', 35, null, null, array['ppe'], true);
  j_s1 := marketplace.publish_job_posting(l_a, 'S26 Saved Job One', array['log_truck'], 1, 'Fir', 'Saved one.', 'per_ton', 500, null,
    1, current_date + 10, 8, 3.0, 3, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  j_s2 := marketplace.publish_job_posting(l_a, 'S26 Saved Job Two', array['log_truck'], 1, 'Fir', 'Saved two.', 'per_ton', 510, null,
    1, current_date + 10, 8, 3.0, 3, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  j_s3 := marketplace.publish_job_posting(l_a, 'S26 Saved Job Three', array['log_truck'], 1, 'Fir', 'Saved three.', 'per_ton', 520, null,
    1, current_date + 10, 8, 3.0, 3, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  j_x := marketplace.publish_job_posting(l_a, 'S26 Alert Job', array['log_truck'], 1, 'Fir', 'Alert job.', 'per_ton', 530, null,
    1, current_date + 10, 8, 3.0, 3, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  d_b := marketplace.save_job_posting_draft(l_b, 'S26 Draft at B');

  perform pg_temp.as_jwt('authenticated', 's26_bown');
  o_basic := marketplace.create_organization('S26 Basic Co', 's26-basic', 'OR', false);
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_basic, 'basic', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_s26b', 'sub_s26b', false, 7, false);

  perform pg_temp.as_jwt('authenticated', 's26_haul');
  o_haul := marketplace.create_organization('S26 Hauling', 's26-hauling', 'OR', true);
  insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
  values (o_haul, u_hdrv, 'driver', false, 'invited') returning id into m_hdrv;
  perform pg_temp.as_jwt('authenticated', 's26_hdrv');
  update marketplace.organization_memberships set status = 'active' where id = m_hdrv;
  perform pg_temp.as_jwt('authenticated', 's26_haul');
  select interest_id into e_a from marketplace.submit_expression_of_interest(o_haul, j_a, 1);
  select interest_id into e_b from marketplace.submit_expression_of_interest(o_haul, j_b, 1);
  perform pg_temp.as_jwt('authenticated', 's26_str');
  o_haul2 := marketplace.create_organization('S26 Other Hauling', 's26-other-hauling', 'OR', true);
  -- A private hauling business whose only inquiry is on a job at landing B, and whose owner lists a qualification.
  perform pg_temp.as_jwt('authenticated', 's26_h3');
  o_haul3 := marketplace.create_organization('S26 Private Hauling Three', 's26-hauling-three', 'OR', true);
  insert into marketplace.user_qualifications (user_id, kind, label) values (u_h3, 'cdl', 'Class A CDL');
  select interest_id into e_h3 from marketplace.submit_expression_of_interest(o_haul3, j_b2, 1);
  -- A second Pro organization for the downgrade checks.
  perform pg_temp.as_jwt('authenticated', 's26_pown');
  o_pro2 := marketplace.create_organization('S26 Pro Two', 's26-pro-two', 'OR', false);
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_pro2, 'pro', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_s26p', 'sub_s26p', false, 7, false);

  -- =========================================================================
  -- 26-A seat invitations (Basic: 2 seats including the owner)
  -- =========================================================================
  perform pg_temp.as_jwt('authenticated', 's26_bown');
  v_inv1 := marketplace.invite_team_member(o_basic, '  MGR@s26.test ', 'manager', true, interval '7 days');
  perform pg_temp.ok((select invited_email = 'mgr@s26.test' and status = 'pending' and role = 'manager' and landing_workspace_seat
                             and invited_by = u_bown and send_count = 1 and expires_at > now() + interval '6 days'
                      from marketplace.team_invitations where id = v_inv1),
    '26-A: an owner invites an email address (stored normalized) as a manager with a Landing Operator seat');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select count(*) = 1 from marketplace.notification_outbox
                      where subject_id = v_inv1 and category = 'team_invitation' and channel = 'email' and status = 'pending'
                        and recipient_email = 'mgr@s26.test' and recipient_user_id is null
                        and dedupe_key = 'team_invitation:' || v_inv1 || ':1'
                        and payload ->> 'organization_name' = 'S26 Basic Co' and payload ->> 'invited_by_name' = 'S26 Basic Owner'
                        and position('@' in payload::text) = 0),
    '26-A/26-D: the invitation queues one email to the address; the payload names the business and the inviter and holds no address');
  perform pg_temp.ok((select count(*) = 1 from marketplace.audit_events
                      where entity_id = v_inv1 and action = 'team_invitation.created' and org_id = o_basic
                        and position('@' in metadata::text) = 0),
    '26-A: the invitation is audited, without the address');

  perform pg_temp.as_jwt('authenticated', 's26_bown');
  perform pg_temp.fails(format('select marketplace.invite_team_member(%L::uuid, %L, %L, true, interval %L)', o_basic, 'staff2@s26.test', 'staff', '7 days'),
    '23514', 'allows 2 team member', '26-A: the pending invitation holds the Basic plan''s second seat (2 including the owner)');
  perform pg_temp.fails(format($q$insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status) values (%L::uuid, %L::uuid, 'staff', true, 'invited')$q$, o_basic, u_str),
    '23514', 'allows 2 team member', '26-A: ... and tg_membership_guard counts it: a direct invitation by user id cannot take that seat');
  v_crew := marketplace.invite_team_member(o_basic, 'crew@s26.test', 'staff', false, interval '7 days');
  perform pg_temp.ok(v_crew is not null, '26-A: staff without a Landing Operator seat take no plan seat and can still be invited');
  perform pg_temp.fails(format('select marketplace.invite_team_member(%L::uuid, %L, %L, false, interval %L)', o_basic, 'mgr@s26.test', 'staff', '7 days'),
    '23505', 'already pending', '26-A: a second pending invitation to the same address is refused (resend instead)');
  perform pg_temp.fails(format('select marketplace.invite_team_member(%L::uuid, %L, %L, false, interval %L)', o_basic, 'x1@s26.test', 'owner', '7 days'),
    '22023', 'ownership changes hands', '26-A: an owner cannot be invited (ownership moves only through a guarded transfer)');
  perform pg_temp.fails(format('select marketplace.invite_team_member(%L::uuid, %L, %L, true, interval %L)', o_basic, 'x2@s26.test', 'driver', '7 days'),
    '22023', 'driver never holds', '26-A: a driver is never invited to a Landing Operator seat');
  perform pg_temp.fails(format('select marketplace.invite_team_member(%L::uuid, %L, %L, false, interval %L)', o_basic, 'not an address', 'staff', '7 days'),
    '22023', 'email address', '26-A: the address must be an email address');
  perform pg_temp.fails(format('select marketplace.invite_team_member(%L::uuid, %L, %L, false, interval %L)', o_basic, 'x3@s26.test', 'staff', '10 minutes'),
    '22023', 'between 1 hour and 30 days', '26-A: an invitation stays open for at least 1 hour');
  perform pg_temp.fails(format('select marketplace.invite_team_member(%L::uuid, %L, %L, false, interval %L)', o_basic, 'x4@s26.test', 'staff', '31 days'),
    '22023', 'between 1 hour and 30 days', '26-A: ... and at most 30 days');
  perform pg_temp.fails(format('select marketplace.invite_team_member(%L::uuid, %L, %L, false, interval %L, array[%L::uuid])', o_basic, 'x5@s26.test', 'staff', '7 days', l_a),
    '22023', 'Only a manager or staff member with a Landing Operator seat', '26-A: only a seat holder can be limited to landings');
  perform pg_temp.as_jwt('authenticated', 's26_own');
  perform pg_temp.fails(format('select marketplace.invite_team_member(%L::uuid, %L, %L, true, interval %L, array[%L::uuid])', o_land, 'x6@s26.test', 'staff', '7 days', gen_random_uuid()),
    '22023', 'Choose landings of this organization', '26-A: an invitation names only landings of the inviting organization');
  perform pg_temp.as_jwt('authenticated', 's26_str');
  perform pg_temp.fails(format('select marketplace.invite_team_member(%L::uuid, %L, %L, false, interval %L)', o_basic, 'x7@s26.test', 'staff', '7 days'),
    '42501', 'Only an owner', '26-A: a stranger cannot invite to the organization');

  -- The wrong person.
  perform pg_temp.as_jwt('authenticated', 's26_other');
  perform pg_temp.ok((select count(*) = 0 from marketplace.list_my_team_invitations()),
    '26-A: a person with another verified address sees no invitation');
  perform pg_temp.fails(format('select marketplace.accept_team_invitation(%L::uuid)', v_inv1),
    '42501', 'verified email address', '26-A: ... and cannot accept one sent to someone else');
  perform pg_temp.fails(format('select marketplace.decline_team_invitation(%L::uuid)', v_inv1),
    '42501', 'verified email address', '26-A: ... nor decline it');
  perform pg_temp.ok(pg_temp.count_as('s26_other', format('select count(*) from marketplace.team_invitations where id = %L', v_inv1)) = 0,
    '26-A: ... nor read it');

  -- The invitee, before accepting.
  perform pg_temp.as_jwt('authenticated', 's26_mgr');
  perform pg_temp.ok((select organization_id = o_basic and organization_name = 'S26 Basic Co' and invited_by_name = 'S26 Basic Owner'
                             and role = 'manager' and landing_workspace_seat
                      from marketplace.list_my_team_invitations() where invitation_id = v_inv1),
    '26-A: the invitee finds the invitation by their verified address and reads who invited them, and to what');
  perform pg_temp.ok(pg_temp.count_as('s26_mgr', format('select count(*) from marketplace.team_invitations where id = %L', v_inv1)) = 0
                     and pg_temp.count_as('s26_bown', format('select count(*) from marketplace.team_invitations where id = %L', v_inv1)) = 1,
    '26-A: the table itself is read by the organization''s owners only');

  -- Revoke frees the seat; an expired invitation holds none.
  perform pg_temp.as_jwt('authenticated', 's26_str');
  perform pg_temp.fails(format('select marketplace.revoke_team_invitation(%L::uuid)', v_inv1),
    '42501', 'Invitation not found', '26-A: a stranger cannot revoke an invitation');
  perform pg_temp.as_jwt('authenticated', 's26_bown');
  perform marketplace.revoke_team_invitation(v_inv1);
  perform pg_temp.ok((select status = 'revoked' and resolved_by = u_bown and resolved_at is not null from marketplace.team_invitations where id = v_inv1),
    '26-A: the owner revokes the invitation');
  perform pg_temp.fails(format('select marketplace.revoke_team_invitation(%L::uuid)', v_inv1),
    '55000', 'no longer open', '26-A: a revoked invitation cannot be revoked again');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'cancelled' from marketplace.notification_outbox where subject_id = v_inv1),
    '26-A/26-D: revoking cancels its queued email');
  perform pg_temp.as_jwt('authenticated', 's26_mgr');
  perform pg_temp.fails(format('select marketplace.accept_team_invitation(%L::uuid)', v_inv1),
    '55000', 'no longer open \(revoked\)', '26-A: a revoked invitation cannot be accepted');
  perform pg_temp.as_jwt('authenticated', 's26_bown');
  v_inv2 := marketplace.invite_team_member(o_basic, 'staff2@s26.test', 'staff', true, interval '2 days');
  perform pg_temp.ok(v_inv2 is not null, '26-A: the revoked invitation''s seat is free again');
  perform pg_temp.as_jwt('harness');
  update marketplace.team_invitations set created_at = now() - interval '3 days', expires_at = now() - interval '1 second' where id = v_inv2;
  perform pg_temp.as_jwt('authenticated', 's26_bown');
  v_inv3 := marketplace.invite_team_member(o_basic, 'mgr@s26.test', 'manager', true, interval '7 days');
  perform pg_temp.ok(v_inv3 is not null, '26-A: an expired invitation holds no seat');
  perform pg_temp.ok((select status = 'expired' from marketplace.list_team_invitations(o_basic) where invitation_id = v_inv2)
                     and (select status = 'revoked' from marketplace.list_team_invitations(o_basic) where invitation_id = v_inv1)
                     and (select status = 'pending' and email_status = 'pending' and invited_email = 'mgr@s26.test'
                          from marketplace.list_team_invitations(o_basic) where invitation_id = v_inv3),
    '26-A: the owner''s list shows an expired invitation as expired, and the email''s real state (pending, not delivered)');
  perform pg_temp.as_jwt('authenticated', 's26_stf2');
  perform pg_temp.fails(format('select marketplace.accept_team_invitation(%L::uuid)', v_inv2),
    '55000', 'expired', '26-A: an expired invitation cannot be accepted');
  perform pg_temp.as_jwt('authenticated', 's26_bown');
  v_inv2b := marketplace.invite_team_member(o_basic, 'staff2@s26.test', 'staff', false, interval '7 days');
  perform pg_temp.ok((select status = 'expired' and resolved_at is not null from marketplace.team_invitations where id = v_inv2)
                     and (select status = 'pending' from marketplace.team_invitations where id = v_inv2b),
    '26-A: inviting the address again closes the expired invitation and opens a new one');

  -- Resend.
  v_exp := (select expires_at from marketplace.team_invitations where id = v_inv3);
  v_exp2 := marketplace.resend_team_invitation(v_inv3, interval '1 day');
  perform pg_temp.ok(v_exp2 = v_exp and (select send_count = 2 from marketplace.team_invitations where id = v_inv3),
    '26-A: resending counts the send and never shortens the expiry');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select count(*) = 2 from marketplace.notification_outbox where subject_id = v_inv3 and status = 'pending')
                     and exists (select 1 from marketplace.notification_outbox where dedupe_key = 'team_invitation:' || v_inv3 || ':2'),
    '26-A/26-D: each send queues its own email');
  perform pg_temp.as_jwt('authenticated', 's26_bown');
  perform marketplace.resend_team_invitation(v_inv3);
  perform marketplace.resend_team_invitation(v_inv3);
  perform marketplace.resend_team_invitation(v_inv3, interval '10 days');
  perform pg_temp.ok((select send_count = 5 and expires_at > now() + interval '9 days' from marketplace.team_invitations where id = v_inv3),
    '26-A: a resend may extend the expiry');
  perform pg_temp.fails(format('select marketplace.resend_team_invitation(%L::uuid)', v_inv3),
    '23514', 'sent 5 times', '26-A: an invitation is sent at most 5 times');

  -- Accept.
  perform pg_temp.as_jwt('authenticated', 's26_mgr');
  m_mgr := marketplace.accept_team_invitation(v_inv3);
  perform pg_temp.ok((select org_id = o_basic and user_id = u_mgr and role = 'manager' and landing_workspace_seat and status = 'active'
                             and accepted_at is not null and invited_by = u_bown
                      from marketplace.organization_memberships where id = m_mgr),
    '26-A: accepting creates an active, accepted manager membership with its seat, recorded as invited by the owner');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'accepted' and membership_id = m_mgr and resolved_by = u_mgr from marketplace.team_invitations where id = v_inv3),
    '26-A: the invitation records the acceptance and the membership');
  perform pg_temp.ok(pg_temp.count_as('s26_mgr', format('select count(*) from marketplace.team_invitations where id = %L', v_inv3)) = 0,
    '26-A: a manager does not read the invitation list (owners only)');
  perform pg_temp.as_jwt('authenticated', 's26_mgr');
  perform pg_temp.ok((select role = 'manager' and landing_workspace_seat from marketplace.get_viewer_marketplace_access(o_basic)),
    '26-A: the new manager works in the organization at once');
  perform pg_temp.fails(format('select marketplace.accept_team_invitation(%L::uuid)', v_inv3),
    '55000', 'no longer open', '26-A: an invitation is accepted once');
  perform pg_temp.fails(format('select marketplace.invite_team_member(%L::uuid, %L, %L, false, interval %L)', o_basic, 'x8@s26.test', 'staff', '7 days'),
    '42501', 'Only an owner', '26-A: a manager cannot invite (the owner controls seat invitations, §2.4)');
  perform pg_temp.fails(format('select * from marketplace.list_team_invitations(%L::uuid)', o_basic),
    '42501', 'Only an owner', '26-A: ... nor read the invitation list');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select count(*) filter (where status = 'cancelled') = 5 and count(*) filter (where status = 'pending') = 0
                      from marketplace.notification_outbox where subject_id = v_inv3),
    '26-A/26-D: accepting cancels every queued email for the invitation');
  perform pg_temp.ok((select count(*) = 2 from marketplace.organization_memberships
                      where org_id = o_basic and status in ('invited', 'active') and landing_workspace_seat),
    '26-A: the Basic plan now holds 2 seated members, the owner included');
  perform pg_temp.as_jwt('authenticated', 's26_bown');
  perform pg_temp.fails(format('select marketplace.invite_team_member(%L::uuid, %L, %L, true, interval %L)', o_basic, 'x9@s26.test', 'staff', '7 days'),
    '23514', 'allows 2 team member', '26-A: a full plan refuses another seated invitation');

  -- A hauling business: free staff, a decline, an unverified address, an expiry, a current member.
  perform pg_temp.as_jwt('authenticated', 's26_haul');
  v_dec := marketplace.invite_team_member(o_haul, 'dec@s26.test', 'driver', false, interval '7 days');
  v_unv := marketplace.invite_team_member(o_haul, 'unv@s26.test', 'driver', false, interval '7 days');
  v_late := marketplace.invite_team_member(o_haul, 'late@s26.test', 'driver', false, interval '1 hour');
  perform pg_temp.fails(format('select marketplace.invite_team_member(%L::uuid, %L, %L, false, interval %L)', o_haul, 'hdrv@s26.test', 'driver', '7 days'),
    '23505', 'already a member', '26-A: the address of a current member is refused');
  perform pg_temp.as_jwt('authenticated', 's26_dec');
  perform marketplace.decline_team_invitation(v_dec);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'declined' and resolved_by = u_dec from marketplace.team_invitations where id = v_dec)
                     and (select status = 'cancelled' from marketplace.notification_outbox where subject_id = v_dec),
    '26-A: the invitee declines; the queued email is cancelled');
  perform pg_temp.as_jwt('authenticated', 's26_dec');
  perform pg_temp.fails(format('select marketplace.accept_team_invitation(%L::uuid)', v_dec),
    '55000', 'no longer open \(declined\)', '26-A: a declined invitation cannot be accepted');
  perform pg_temp.as_jwt('authenticated', 's26_unv');
  perform pg_temp.fails(format('select marketplace.accept_team_invitation(%L::uuid)', v_unv),
    '42501', 'verified email address', '26-A: an unverified address cannot accept (only sync_verified_identity writes verified addresses)');
  perform pg_temp.as_jwt('harness');
  update marketplace.team_invitations set created_at = now() - interval '2 hours', expires_at = now() - interval '1 second' where id = v_late;
  perform pg_temp.as_jwt('authenticated', 's26_late');
  perform pg_temp.fails(format('select marketplace.accept_team_invitation(%L::uuid)', v_late),
    '55000', 'expired', '26-A: an invitation past its expiry cannot be accepted');
  perform pg_temp.as_jwt('authenticated', 's26_haul');
  v_late2 := marketplace.invite_team_member(o_haul, 'late@s26.test', 'driver', false, interval '7 days');
  perform pg_temp.as_jwt('authenticated', 's26_late');
  m_late := marketplace.accept_team_invitation(v_late2);
  perform pg_temp.ok((select role = 'driver' and not landing_workspace_seat and status = 'active' from marketplace.organization_memberships where id = m_late),
    '26-A: a free driver joins a hauling business by invitation');

  -- A plan change does not strand pending seat invitations (Pro, 5 seats: the owner and two invitations hold 3).
  perform pg_temp.as_jwt('authenticated', 's26_pown');
  v_p1 := marketplace.invite_team_member(o_pro2, 'p1@s26.test', 'staff', true, interval '7 days');
  v_p2 := marketplace.invite_team_member(o_pro2, 'p2@s26.test', 'staff', true, interval '7 days');
  perform pg_temp.as_jwt('service_role');
  perform pg_temp.fails(format('select marketplace.open_subscription_cycle(%L::uuid, %L, %L, now() - interval %L, now() + interval %L, %L, %L, false, 7, false)',
      o_pro2, 'basic', 'active', '1 hour', '29 days', 'cus_s26p', 'sub_s26p'),
    '23514', '2 pending seat invitation', '26-A: a direct downgrade to Basic (2 seats) is refused while the owner and two pending invitations hold 3');
  perform marketplace.open_subscription_cycle(o_pro2, 'basic', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_s26p', 'sub_s26p', false, 7, true);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select (metadata ->> 'pending_seat_invitations')::int = 2 and (metadata ->> 'paid_landing_seats')::int = 1
                             and metadata ->> 'plan' = 'basic'
                      from marketplace.audit_events where org_id = o_pro2 and action = 'subscription.cycle_opened' order by id desc limit 1),
    '26-A: a provider-driven change (p_allow_over_limit) is recorded, with the pending invitations in the audit');
  perform pg_temp.as_jwt('authenticated', 's26_pown');
  perform pg_temp.ok((select plan_code = 'basic' and paid_landing_seats = 1 and not seat_conflict from marketplace.get_org_entitlement_state(o_pro2)),
    '26-A: seat_conflict still counts seated members only, so pending invitations never block publishing');
  perform pg_temp.ok((select bool_and(seat_available = false) and count(*) = 2 from marketplace.list_team_invitations(o_pro2) where status = 'pending'),
    '26-A: the team list shows that the plan has no room for the pending invitations');
  perform pg_temp.as_jwt('authenticated', 's26_p1');
  perform pg_temp.fails(format('select marketplace.accept_team_invitation(%L::uuid)', v_p1),
    '23514', 'allows 2 team member', '26-A: ... and neither can be accepted while both are pending');
  perform pg_temp.as_jwt('authenticated', 's26_pown');
  perform marketplace.revoke_team_invitation(v_p2);
  perform pg_temp.ok((select seat_available from marketplace.list_team_invitations(o_pro2) where invitation_id = v_p1),
    '26-A: revoking one leaves room for the other');
  perform pg_temp.as_jwt('authenticated', 's26_p1');
  m_p1 := marketplace.accept_team_invitation(v_p1);
  perform pg_temp.ok(m_p1 is not null, '26-A: ... which is then accepted, filling Basic''s 2 seats');

  -- =========================================================================
  -- 26-B staff-to-landing scope (Pro organization)
  -- =========================================================================
  perform pg_temp.as_jwt('authenticated', 's26_own');
  v_inv_staff := marketplace.invite_team_member(o_land, 'staff@s26.test', 'staff', true, interval '7 days', array[l_a]);
  v_inv_wide  := marketplace.invite_team_member(o_land, 'wide@s26.test', 'staff', true, interval '7 days');
  v_inv_lmgr  := marketplace.invite_team_member(o_land, 'lmgr@s26.test', 'manager', true, interval '7 days');
  perform pg_temp.as_jwt('authenticated', 's26_staff');
  m_staff := marketplace.accept_team_invitation(v_inv_staff);
  perform pg_temp.as_jwt('authenticated', 's26_wide');
  m_wide := marketplace.accept_team_invitation(v_inv_wide);
  perform pg_temp.as_jwt('authenticated', 's26_lmgr');
  m_lmgr := marketplace.accept_team_invitation(v_inv_lmgr);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select array_agg(landing_id) = array[l_a] and bool_and(granted_by = u_own) from marketplace.membership_landing_scopes where membership_id = m_staff),
    '26-A/26-B: the landings named on the invitation become the member''s scope when they accept');
  perform pg_temp.as_jwt('authenticated', 's26_own');
  perform pg_temp.ok(marketplace.set_membership_landing_scope(m_lmgr, array[l_a]) = 1,
    '26-B: an owner limits a manager to landing A');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select count(*) = 1 from marketplace.audit_events where entity_id = m_lmgr and action = 'membership.landing_scope_changed'
                        and (metadata ->> 'after_count')::int = 1),
    '26-B: the scope change is audited');
  perform pg_temp.ok(pg_temp.count_as('s26_staff', format('select count(*) from marketplace.membership_landing_scopes where membership_id = %L', m_staff)) = 1
                     and pg_temp.count_as('s26_wide', format('select count(*) from marketplace.membership_landing_scopes where membership_id = %L', m_staff)) = 0
                     and pg_temp.count_as('s26_lmgr', format('select count(*) from marketplace.membership_landing_scopes where membership_id = %L', m_staff)) = 1,
    '26-B: a member reads their own scope, and owners and managers read everyone''s; other staff do not');

  -- Reads.
  perform pg_temp.ok(pg_temp.count_as('s26_staff', format('select count(*) from marketplace.landings where id in (%L, %L)', l_a, l_b)) = 2,
    '26-B: a limited member still reads every active (public) landing');
  perform pg_temp.ok(pg_temp.count_as('s26_staff', format('select count(*) from marketplace.landings where id = %L', l_c)) = 0
                     and pg_temp.count_as('s26_wide', format('select count(*) from marketplace.landings where id = %L', l_c)) = 1
                     and pg_temp.count_as('s26_own', format('select count(*) from marketplace.landings where id = %L', l_c)) = 1,
    '26-B: ... but not an inactive landing outside their scope, which org-wide staff and the owner read');
  perform pg_temp.ok(pg_temp.count_as('s26_staff', format('select count(*) from marketplace.job_postings where id = %L', d_b)) = 0
                     and pg_temp.count_as('s26_wide', format('select count(*) from marketplace.job_postings where id = %L', d_b)) = 1,
    '26-B: a draft at landing B is hidden from staff limited to A');
  perform pg_temp.ok(pg_temp.count_as('s26_staff', format('select count(*) from marketplace.landing_private_details where landing_id = %L', l_a)) = 1
                     and pg_temp.count_as('s26_staff', format('select count(*) from marketplace.landing_private_details where landing_id = %L', l_b)) = 0
                     and pg_temp.count_as('s26_wide', format('select count(*) from marketplace.landing_private_details where landing_id in (%L, %L)', l_a, l_b)) = 2,
    '26-B: private access details: landing A only for the limited member, both for org-wide staff');
  perform pg_temp.ok(pg_temp.count_as('s26_staff', format('select count(*) from marketplace.expressions_of_interest where id in (%L, %L)', e_a, e_b)) = 1
                     and pg_temp.count_as('s26_wide', format('select count(*) from marketplace.expressions_of_interest where id in (%L, %L)', e_a, e_b)) = 2,
    '26-B: inquiries: only the job at landing A for the limited member');
  perform pg_temp.ok(pg_temp.count_as('s26_staff', format('select count(*) from marketplace.list_marketplace_interests(%L::uuid, %L)', o_land, 'landing')) = 1
                     and pg_temp.count_as('s26_wide', format('select count(*) from marketplace.list_marketplace_interests(%L::uuid, %L)', o_land, 'landing')) = 3,
    '26-B: the landing inbox (list_marketplace_interests) lists only in-scope inquiries');
  perform pg_temp.as_jwt('authenticated', 's26_staff');
  perform pg_temp.ok((select array_agg(id) = array[l_a] from marketplace.list_authoring_landings(o_land)),
    '26-B: list_authoring_landings offers only landing A to the limited member');
  perform pg_temp.as_jwt('authenticated', 's26_wide');
  perform pg_temp.ok((select count(*) = 2 from marketplace.list_authoring_landings(o_land)),
    '26-B: ... and both active landings to org-wide staff');
  perform pg_temp.ok(pg_temp.count_as('s26_own', format('select count(*) from marketplace.job_postings where id = %L', d_b)) = 1,
    '26-B: owners are never limited');
  perform pg_temp.ok(pg_temp.count_as('s26_staff', format('select count(*) from marketplace.hauler_profiles where org_id = %L', o_haul3)) = 0
                     and pg_temp.count_as('s26_wide', format('select count(*) from marketplace.hauler_profiles where org_id = %L', o_haul3)) = 1,
    '26-B: a private hauling business that inquired only at landing B: its profile is hidden from the limited member (has_live_inquiry_from_hauler)');
  perform pg_temp.ok(pg_temp.count_as('s26_staff', format('select count(*) from marketplace.user_qualifications where user_id = %L', u_h3)) = 0
                     and pg_temp.count_as('s26_wide', format('select count(*) from marketplace.user_qualifications where user_id = %L', u_h3)) = 1,
    '26-B: ... and so are its people''s qualifications (can_view_user_qualifications)');
  perform pg_temp.ok(pg_temp.count_as('s26_staff', format('select count(*) from marketplace.organizations where id = %L', o_haul3)) = 0
                     and pg_temp.count_as('s26_wide', format('select count(*) from marketplace.organizations where id = %L', o_haul3)) = 1,
    '26-B: ... its organization row (can_view_organization)');
  perform pg_temp.ok(pg_temp.count_as('s26_staff', format('select count(*) from marketplace.app_users where id = %L', u_h3)) = 0
                     and pg_temp.count_as('s26_wide', format('select count(*) from marketplace.app_users where id = %L', u_h3)) = 1,
    '26-B: ... and the person who inquired (can_view_app_user)');
  perform pg_temp.ok(pg_temp.count_as('s26_staff', format('select count(*) from marketplace.hauler_profiles where org_id = %L', o_haul)) = 1,
    '26-B: a hauling business that also inquired at landing A stays readable to the limited member');

  -- Writes (inside SECURITY DEFINER functions as well as direct).
  perform pg_temp.as_jwt('authenticated', 's26_staff');
  perform pg_temp.fails(format($q$select marketplace.publish_job_posting(%L::uuid, 'S26 Staff Job B', array['log_truck'], 1, 'Fir', 'Staff at B.', 'per_ton', 500, null, 1, current_date + 10, 8, 3.0, 3, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true)$q$, l_b),
    '42501', 'not one of the landings you are assigned to', '26-B: a limited member cannot publish at landing B (publish_job_posting)');
  j_staff := marketplace.publish_job_posting(l_a, 'S26 Staff Job A', array['log_truck'], 1, 'Fir', 'Staff at A.', 'per_ton', 500, null,
    1, current_date + 10, 8, 3.0, 3, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  perform pg_temp.ok(j_staff is not null, '26-B: ... and publishes at landing A');
  perform pg_temp.fails(format('select marketplace.save_job_posting_draft(%L::uuid, %L)', l_b, 'S26 Staff Draft B'),
    '42501', 'not one of the landings', '26-B: ... cannot save a draft at landing B');
  perform pg_temp.fails(format($q$update marketplace.job_postings set public_road_notes = 'Graded last week' where id = %L$q$, j_b2),
    '42501', 'not one of the landings', '26-B: ... cannot edit a public job at landing B directly');
  perform pg_temp.fails(format('select marketplace.set_job_posting_status(%L::uuid, %L)', j_b2, 'paused'),
    '42501', 'not one of the landings', '26-B: ... cannot pause it (set_job_posting_status)');
  perform pg_temp.fails(format($q$insert into marketplace.job_posting_equipment (job_id, equipment_code) values (%L, 'self_loader')$q$, j_b2),
    '42501', 'not one of the landings', '26-B: ... cannot change its equipment');
  perform pg_temp.fails(format('select marketplace.respond_to_interest(%L::uuid, %L)', e_b, 'viewed'),
    '42501', 'not one of the landings', '26-B: ... cannot respond to an inquiry on a job at landing B');
  perform pg_temp.fails(format($q$insert into marketplace.interest_messages (interest_id, author_side, body) values (%L, 'landing', 'Hello from staff')$q$, e_b),
    '42501', 'not one of the landings|row-level security', '26-B: ... nor write on it directly');
  perform marketplace.respond_to_interest(e_a, 'replied', null, gen_random_uuid(), 'Staff can load you at A Monday');
  perform pg_temp.ok((select status = 'replied' from marketplace.expressions_of_interest where id = e_a),
    '26-B: ... and replies to the inquiry at landing A');
  perform pg_temp.as_jwt('harness');
  v_ep := (select id from marketplace.entitlement_periods where org_id = o_land order by period_start desc limit 1);
  perform pg_temp.claims_only('s26_staff');
  perform pg_temp.fails(format($q$insert into marketplace.targeted_invitations (job_id, sender_org_id, recipient_org_id, sent_by, entitlement_period_id) values (%L, %L, %L, %L, %L)$q$, j_b2, o_land, o_haul, u_staff, v_ep),
    '42501', 'not one of the landings', '26-B: a targeted invitation for a job at landing B is refused for the limited member, on any path');
  perform pg_temp.as_jwt('authenticated', 's26_lmgr');
  perform pg_temp.fails(format($q$insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code) values (%L, 'S26 Landing D', 'inactive', 'Near Madras, OR', marketplace.make_public_point(-121.1, 44.6), 'OR')$q$, o_land),
    '42501', 'not one of the landings', '26-B: a limited manager cannot add a landing');
  perform pg_temp.fails(format($q$update marketplace.landings set county = 'Deschutes' where id = %L$q$, l_b),
    '42501', 'not one of the landings', '26-B: ... cannot edit landing B');
  perform pg_temp.fails(format($q$insert into marketplace.landing_private_details (landing_id, org_id, directions) values (%L, %L, 'C: gate at the quarry')$q$, l_c, o_land),
    '42501', 'not one of the landings', '26-B: ... cannot write private details of landing C');
  update marketplace.landings set county = 'Deschutes' where id = l_a;
  update marketplace.landing_private_details set directions = 'A: first spur past the scale house' where landing_id = l_a;
  perform pg_temp.ok((select county = 'Deschutes' from marketplace.landings where id = l_a)
                     and (select directions like 'A: first spur%' from marketplace.landing_private_details where landing_id = l_a),
    '26-B: ... and maintains landing A and its private details');

  -- Hiding a job: a paused job at B is no longer public; only in-scope desks read it.
  perform pg_temp.as_jwt('authenticated', 's26_haul');
  perform marketplace.post_hauler_interest_reply(e_b, gen_random_uuid(), 'Two trucks free for the Pine haul');
  perform pg_temp.as_jwt('authenticated', 's26_own');
  perform marketplace.respond_to_interest(e_b, 'replied', null, gen_random_uuid(), 'Thanks, we will call');
  perform marketplace.set_job_posting_status(j_b, 'paused');
  perform pg_temp.ok(pg_temp.count_as('s26_staff', format('select count(*) from marketplace.get_marketplace_job(%L::uuid)', j_b)) = 0
                     and pg_temp.count_as('s26_wide', format('select count(*) from marketplace.get_marketplace_job(%L::uuid)', j_b)) = 1,
    '26-B: a paused job at landing B: get_marketplace_job (through can_read_job_posting) shows it to org-wide staff only');
  perform pg_temp.ok(pg_temp.count_as('s26_staff', format('select count(*) from marketplace.list_marketplace_jobs(null, null, null, false, %L::uuid) where job_id = %L', o_land, j_b)) = 0
                     and pg_temp.count_as('s26_wide', format('select count(*) from marketplace.list_marketplace_jobs(null, null, null, false, %L::uuid) where job_id = %L', o_land, j_b)) = 1,
    '26-B: ... and so does the desk''s job list (list_marketplace_jobs)');
  perform pg_temp.ok(pg_temp.count_as('s26_staff', format('select count(*) from marketplace.interest_messages where interest_id = %L', e_b)) = 0
                     and pg_temp.count_as('s26_wide', format('select count(*) from marketplace.interest_messages where interest_id = %L', e_b)) = 2,
    '26-B: the messages on the inquiry at landing B are hidden from the limited member');

  -- Who sets a scope.
  perform pg_temp.as_jwt('authenticated', 's26_lmgr');
  perform pg_temp.fails(format('select marketplace.set_membership_landing_scope(%L::uuid, array[%L::uuid])', m_staff, l_a),
    '42501', 'Membership not found', '26-B: a manager cannot change anyone''s scope (owners only)');
  perform pg_temp.as_jwt('authenticated', 's26_own');
  perform pg_temp.fails(format('select marketplace.set_membership_landing_scope(%L::uuid, array[%L::uuid])', m_own, l_a),
    '22023', 'owners always see every landing', '26-B: an owner cannot be limited');
  perform pg_temp.fails(format('select marketplace.set_membership_landing_scope(%L::uuid, array[%L::uuid])', m_staff, gen_random_uuid()),
    '22023', 'Choose landings of this organization', '26-B: a scope names only the organization''s landings');
  perform pg_temp.fails(format('select marketplace.set_membership_landing_scope(%L::uuid, array[%L::uuid])', m_mgr, l_a),
    '42501', 'Membership not found', '26-B: an owner of one organization cannot set scope in another');
  perform pg_temp.ok(marketplace.set_membership_landing_scope(m_staff, '{}') = 0,
    '26-B: an empty list returns the member to every landing');
  perform pg_temp.ok(pg_temp.count_as('s26_staff', format('select count(*) from marketplace.job_postings where id = %L', d_b)) = 1
                     and pg_temp.count_as('s26_staff', format('select count(*) from marketplace.expressions_of_interest where id = %L', e_b)) = 1,
    '26-B: ... and at once reads landing B''s draft and inquiry');
  perform pg_temp.ok(pg_temp.count_as('s26_staff', format('select count(*) from marketplace.hauler_profiles where org_id = %L', o_haul3)) = 1,
    '26-B: ... and the business that inquired there');
  perform pg_temp.as_jwt('authenticated', 's26_own');
  perform marketplace.set_membership_landing_scope(m_staff, array[l_a, l_a]);
  perform pg_temp.ok(pg_temp.count_as('s26_staff', format('select count(*) from marketplace.job_postings where id = %L', d_b)) = 0,
    '26-B: limiting the member again hides it again');

  -- Landing-side notices follow the scope.
  perform pg_temp.as_jwt('authenticated', 's26_own');
  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled) values (u_own, o_land, 'inquiry_reply', 'in_app', true);
  perform pg_temp.as_jwt('authenticated', 's26_staff');
  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled) values (u_staff, o_land, 'inquiry_reply', 'in_app', true);
  perform pg_temp.as_jwt('authenticated', 's26_wide');
  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled) values (u_wide, o_land, 'inquiry_reply', 'in_app', true);
  perform pg_temp.as_jwt('authenticated', 's26_haul');
  perform marketplace.post_hauler_interest_reply(e_b, gen_random_uuid(), 'Still have two trucks for B');
  perform marketplace.post_hauler_interest_reply(e_a, gen_random_uuid(), 'Monday works for A');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select count(*) from marketplace.notification_outbox where category = 'inquiry_reply' and subject_id = e_b and recipient_user_id = u_wide) = 1
                     and (select count(*) from marketplace.notification_outbox where category = 'inquiry_reply' and subject_id = e_b and recipient_user_id = u_own) = 1
                     and (select count(*) from marketplace.notification_outbox where category = 'inquiry_reply' and subject_id = e_b and recipient_user_id = u_staff) = 0,
    '26-B/26-D: a hauler''s reply on landing B notifies the opted-in owner and org-wide staff, not staff limited to A');
  perform pg_temp.ok((select count(*) from marketplace.notification_outbox
                      where category = 'inquiry_reply' and subject_id = e_a and recipient_org_id = o_land
                        and channel = 'in_app' and status = 'delivered' and delivered_at is not null) = 3,
    '26-B/26-D: ... and a reply on landing A notifies all three, in-app notices delivered when written');

  -- =========================================================================
  -- 26-C saved jobs
  -- =========================================================================
  perform pg_temp.as_jwt('authenticated', 's26_haul');
  insert into marketplace.saved_jobs (org_id, job_id) values (o_haul, j_a), (o_haul, j_s1), (o_haul, j_s2), (o_haul, j_s3);
  perform pg_temp.ok((select count(*) = 4 and bool_and(user_id = u_haul) from marketplace.saved_jobs),
    '26-C: a hauling business member saves open jobs, as themselves');
  perform pg_temp.fails(format('insert into marketplace.saved_jobs (org_id, job_id) values (%L, %L)', o_haul, j_a),
    '23505', 'saved_jobs_pkey', '26-C: a job is saved once');
  perform pg_temp.fails(format('insert into marketplace.saved_jobs (org_id, job_id) values (%L, %L)', o_haul, d_b),
    '23514', 'Only an open job', '26-C: a draft cannot be saved');
  perform pg_temp.fails(format('insert into marketplace.saved_jobs (org_id, job_id) values (%L, %L)', o_haul, j_b),
    '23514', 'Only an open job', '26-C: ... nor a paused job');
  perform pg_temp.fails(format('insert into marketplace.saved_jobs (org_id, job_id) values (%L, %L)', o_haul2, j_a),
    '42501', 'row-level security', '26-C: ... nor for a hauling business the person does not belong to');
  perform pg_temp.fails(format('insert into marketplace.saved_jobs (user_id, org_id, job_id) values (%L, %L, %L)', u_hdrv, o_haul, j_x),
    '42501', 'permission denied', '26-C: the saver is always the signed-in person (user_id is not writable)');
  perform pg_temp.as_jwt('authenticated', 's26_own');
  perform pg_temp.fails(format('insert into marketplace.saved_jobs (org_id, job_id) values (%L, %L)', o_land, j_a),
    '42501', 'Switch to a hauling business', '26-C: a landing organization has no saved jobs');
  perform pg_temp.ok(pg_temp.count_as('s26_hdrv', 'select count(*) from marketplace.saved_jobs') = 0,
    '26-C: a colleague does not see another person''s saved jobs');
  perform pg_temp.as_jwt('authenticated', 's26_hdrv');
  insert into marketplace.saved_jobs (org_id, job_id) values (o_haul, j_a);
  perform pg_temp.as_jwt('authenticated', 's26_haul');
  perform pg_temp.ok((select count(*) = 4 and bool_and(availability = 'open' and title is not null and poster_name = 'S26 Landing Co')
                      from marketplace.list_saved_jobs(o_haul)),
    '26-C: list_saved_jobs shows the person''s own saved jobs, open, with public listing fields');
  perform pg_temp.as_jwt('authenticated', 's26_own');
  perform marketplace.set_job_posting_status(j_s1, 'paused');
  perform marketplace.set_job_posting_status(j_s2, 'closed');
  perform pg_temp.as_jwt('authenticated', 's26_admin');
  perform marketplace.admin_moderate_job_posting(j_s3, 'closed', 'Pay claim could not be verified');
  perform pg_temp.as_jwt('authenticated', 's26_haul');
  perform pg_temp.ok((select availability = 'paused' and title = 'S26 Saved Job One' from marketplace.list_saved_jobs(o_haul) where job_id = j_s1),
    '26-C: a paused saved job shows as paused');
  perform pg_temp.ok((select availability = 'closed' and title = 'S26 Saved Job Two' from marketplace.list_saved_jobs(o_haul) where job_id = j_s2),
    '26-C: a closed saved job shows its closure (§5.9)');
  perform pg_temp.ok((select availability = 'unavailable' and title is null and pay_amount_cents is null and origin_label is null
                      from marketplace.list_saved_jobs(o_haul) where job_id = j_s3),
    '26-C: a job taken down by a moderator shows as unavailable, with no listing details');
  delete from marketplace.saved_jobs where job_id = j_s1;
  perform pg_temp.ok((select count(*) = 3 from marketplace.list_saved_jobs(o_haul)), '26-C: the person removes a saved job');
  perform pg_temp.as_jwt('authenticated', 's26_hdrv');
  delete from marketplace.saved_jobs where user_id = u_haul;
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select count(*) = 3 from marketplace.saved_jobs where user_id = u_haul),
    '26-C: a colleague cannot remove them');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'marketplace.saved_jobs', 'UPDATE')
                     and not has_table_privilege('anon', 'marketplace.saved_jobs', 'SELECT'),
    '26-C: saved jobs are never updated in place, and anonymous visitors have none');

  -- =========================================================================
  -- 26-D notification outbox
  -- =========================================================================
  perform pg_temp.as_jwt('authenticated', 's26_haul');
  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled)
  values (u_haul, o_haul, 'inquiry_reply', 'email', true), (u_haul, o_haul, 'inquiry_reply', 'in_app', true),
         (u_haul, o_haul, 'job_alert', 'email', true), (u_haul, o_haul, 'job_alert', 'in_app', true);
  perform pg_temp.as_jwt('authenticated', 's26_hdrv');
  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled)
  values (u_hdrv, o_haul, 'inquiry_reply', 'email', true);
  perform pg_temp.as_jwt('authenticated', 's26_own');
  perform marketplace.respond_to_interest(e_a, 'replied', null, gen_random_uuid(), 'Owner here: Monday 6am at A');
  perform pg_temp.as_jwt('authenticated', 's26_haul');
  perform pg_temp.ok((select count(*) = 2 from marketplace.notification_outbox where category = 'inquiry_reply' and subject_id = e_a),
    '26-D: the landing''s reply notifies the opted-in hauler on both channels they chose');
  v_in := (select id from marketplace.notification_outbox where category = 'inquiry_reply' and subject_id = e_a and channel = 'in_app');
  v_em := (select id from marketplace.notification_outbox where category = 'inquiry_reply' and subject_id = e_a and channel = 'email');
  perform pg_temp.ok((select status = 'delivered' from marketplace.notification_outbox where id = v_in)
                     and (select status = 'pending' from marketplace.notification_outbox where id = v_em),
    '26-D: the in-app notice is delivered; the email is pending, not delivered');
  perform pg_temp.ok((select payload ->> 'job_title' = 'S26 Fir Haul A' and payload ->> 'from_side' = 'landing'
                             and payload ->> 'from_organization_name' = 'S26 Landing Co'
                             and position('Monday 6am' in payload::text) = 0
                      from marketplace.notification_outbox where id = v_in),
    '26-D: the notice names the job and the sender, and never copies the message text');
  perform pg_temp.fails('select recipient_email from marketplace.notification_outbox limit 1',
    '42501', 'permission denied', '26-D: the recipient cannot read the address column');
  perform pg_temp.fails('select provider_message_id from marketplace.notification_outbox limit 1',
    '42501', 'permission denied', '26-D: ... nor the provider''s message id');
  perform pg_temp.ok(pg_temp.count_as('s26_hdrv', format('select count(*) from marketplace.notification_outbox where subject_id = %L', e_a)) = 1
                     and pg_temp.count_as('s26_own', format('select count(*) from marketplace.notification_outbox where subject_id = %L and recipient_org_id = %L', e_a, o_haul)) = 0,
    '26-D: each person reads only their own notices (the driver its email; the author none)');
  perform pg_temp.as_jwt('authenticated', 's26_hdrv');
  perform pg_temp.ok(marketplace.mark_notifications_read(array[v_in]) = 0, '26-D: a person cannot mark someone else''s notice read');
  perform pg_temp.as_jwt('authenticated', 's26_haul');
  v_n := marketplace.mark_notifications_read(array[v_in, v_em]);
  perform pg_temp.ok(v_n = 1 and (select read_at is not null from marketplace.notification_outbox where id = v_in),
    '26-D: the recipient marks their in-app notice read (email has no read marker)');
  perform pg_temp.as_jwt('authenticated', 's26_hdrv');
  update marketplace.notification_preferences set enabled = false where user_id = u_hdrv and org_id = o_haul and category = 'inquiry_reply';

  -- The email worker.
  perform pg_temp.as_jwt('authenticated', 's26_haul');
  perform pg_temp.fails('select * from marketplace.claim_email_notifications(10, interval ''1 minute'')',
    '42501', 'permission denied', '26-D: a signed-in person cannot claim emails');
  perform pg_temp.as_jwt('service_role');
  perform pg_temp.fails('select * from marketplace.claim_email_notifications(0, interval ''1 minute'')',
    '22023', 'between 1 and 100', '26-D: a claim takes 1 to 100 emails');
  perform pg_temp.fails('select * from marketplace.claim_email_notifications(10, interval ''5 seconds'')',
    '22023', 'between 30 seconds and 15 minutes', '26-D: ... with a bounded lease');
  for r in select * from marketplace.claim_email_notifications(100, interval '5 minutes') loop
    if r.notification_id = v_em then
      n_haul := r.notification_id; t_haul := r.claim_token;
      v_txt := r.delivery_address || ':' || r.attempt_count;
    elsif r.category = 'team_invitation' and r.delivery_address = 'crew@s26.test' then
      n_crew := r.notification_id; t_crew := r.claim_token;
    elsif r.category = 'team_invitation' and r.delivery_address = 'staff2@s26.test' then
      n_s2b := r.notification_id; t_s2b := r.claim_token;
    elsif r.category = 'team_invitation' and r.delivery_address = 'unv@s26.test' then
      n_unv := r.notification_id; t_unv := r.claim_token;
    end if;
  end loop;
  perform pg_temp.ok(v_txt = 'haul@s26.test:1', '26-D: the worker claims the hauler''s email with their verified address (attempt 1)');
  perform pg_temp.ok(n_crew is not null and n_s2b is not null and n_unv is not null,
    '26-D: ... and the open invitations'' emails, addressed to the invited addresses');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'suppressed' and last_failure ~ 'no longer opted in' from marketplace.notification_outbox
                      where subject_id = e_a and recipient_user_id = u_hdrv),
    '26-D: an email whose recipient withdrew consent is suppressed when claimed, never sent');
  perform pg_temp.ok((select status = 'cancelled' and last_failure ~ 'no longer open' from marketplace.notification_outbox where subject_id = v_inv2),
    '26-D: an expired invitation''s email is cancelled when claimed');
  perform pg_temp.ok((select count(*) = 0 from marketplace.notification_outbox where channel = 'email' and status = 'pending' and available_at <= now()),
    '26-D: every due email was claimed or closed');
  perform pg_temp.as_jwt('service_role');
  perform pg_temp.fails(format('select marketplace.complete_email_notification(%L::uuid, %L::uuid, %L, %L)', n_haul, gen_random_uuid(), 'sent', 'msg-s26-1'),
    '55000', 'not claimed with that token', '26-D: a completion needs the current claim token');
  perform pg_temp.fails(format('select marketplace.complete_email_notification(%L::uuid, %L::uuid, %L)', n_haul, t_haul, 'sent'),
    '22023', 'message id', '26-D: a sent email needs the provider''s message id');
  perform pg_temp.fails(format('select marketplace.complete_email_notification(%L::uuid, %L::uuid, %L, %L)', n_haul, t_haul, 'delivered', 'msg-s26-1'),
    '22023', 'outcome is sent, retry, failed or suppressed', '26-D: a worker cannot report delivery (only the provider''s event can)');
  perform pg_temp.ok(marketplace.complete_email_notification(n_haul, t_haul, 'sent', 'msg-s26-1') = 'sent',
    '26-D: the worker records the email as sent');
  perform pg_temp.fails(format('select marketplace.complete_email_notification(%L::uuid, %L::uuid, %L, %L)', n_haul, t_haul, 'sent', 'msg-s26-1'),
    '55000', 'not claimed with that token', '26-D: ... once');
  perform pg_temp.as_jwt('authenticated', 's26_haul');
  perform pg_temp.ok((select status = 'sent' and delivered_at is null from marketplace.notification_outbox where id = n_haul),
    '26-D: the recipient sees sent, not delivered');
  perform pg_temp.as_jwt('service_role');
  v_n := marketplace.record_email_provider_event('msg-s26-1', 'delivered');
  perform pg_temp.ok(v_n = 1 and marketplace.record_email_provider_event('msg-s26-1', 'delivered') = 0,
    '26-D: the provider''s delivery event makes it delivered, once');
  perform pg_temp.as_jwt('authenticated', 's26_haul');
  perform pg_temp.ok((select status = 'delivered' and delivered_at is not null from marketplace.notification_outbox where id = n_haul),
    '26-D: ... and the recipient sees delivered');
  perform pg_temp.as_jwt('service_role');
  perform pg_temp.ok(marketplace.record_email_provider_event('msg-s26-1', 'bounced') = 1
                     and marketplace.record_email_provider_event('no-such-message', 'bounced') = 0,
    '26-D: a later bounce is recorded; an unknown message id changes nothing');
  perform pg_temp.fails('select marketplace.record_email_provider_event(''msg-s26-1'', ''opened'')',
    '22023', 'delivered or bounced', '26-D: only delivery and bounce events are recorded');
  perform pg_temp.as_jwt('authenticated', 's26_haul');
  perform pg_temp.ok((select status = 'bounced' from marketplace.notification_outbox where id = n_haul),
    '26-D: a bounced email is shown as bounced, never as delivered');

  perform pg_temp.as_jwt('service_role');
  perform pg_temp.fails(format('select marketplace.complete_email_notification(%L::uuid, %L::uuid, %L)', n_s2b, t_s2b, 'retry'),
    '22023', 'Say why', '26-D: a retry says why the attempt failed');
  perform pg_temp.ok(marketplace.complete_email_notification(n_s2b, t_s2b, 'suppressed', null, 'test-recipient guard') = 'suppressed',
    '26-D: the worker may suppress an email (for example a test-recipient guard)');
  perform pg_temp.ok(marketplace.complete_email_notification(n_crew, t_crew, 'retry', null, 'provider timeout') = 'pending',
    '26-D: a failed attempt goes back to pending');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select available_at > now() and claim_token is null and last_failure = 'provider timeout' from marketplace.notification_outbox where id = n_crew),
    '26-D: ... after a backoff');
  perform pg_temp.as_jwt('service_role');
  perform pg_temp.ok((select count(*) = 0 from marketplace.claim_email_notifications(100, interval '5 minutes') c where c.notification_id = n_crew),
    '26-D: ... so it is not claimed again before then');
  perform pg_temp.as_jwt('harness');
  update marketplace.notification_outbox set attempt_count = 4, available_at = now() - interval '1 second' where id = n_crew;
  perform pg_temp.as_jwt('service_role');
  select c.claim_token into t_crew from marketplace.claim_email_notifications(100, interval '5 minutes') c where c.notification_id = n_crew;
  perform pg_temp.ok(marketplace.complete_email_notification(n_crew, t_crew, 'retry', null, 'provider timeout again') = 'failed',
    '26-D: a failed fifth attempt is final');

  -- A lease that runs out: the email is claimed again, and the first worker's token no longer counts.
  perform pg_temp.as_jwt('harness');
  update marketplace.notification_outbox set claim_expires_at = now() - interval '1 second' where id = n_unv;
  perform pg_temp.as_jwt('service_role');
  select c.claim_token into t_unv2 from marketplace.claim_email_notifications(100, interval '5 minutes') c where c.notification_id = n_unv;
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(t_unv2 is not null and t_unv2 <> t_unv and (select attempt_count = 2 from marketplace.notification_outbox where id = n_unv),
    '26-D: an email whose lease ran out is claimed again with a new token (attempt 2)');
  perform pg_temp.ok(not has_table_privilege('service_role', 'marketplace.notification_outbox', 'SELECT'),
    '26-D: the worker reaches the outbox only through its functions (no table grant)');
  perform pg_temp.as_jwt('service_role');
  perform pg_temp.fails(format('select marketplace.complete_email_notification(%L::uuid, %L::uuid, %L, %L)', n_unv, t_unv, 'sent', 'msg-s26-late'),
    '55000', 'not claimed with that token', '26-D: ... and the first worker cannot complete it');
  perform pg_temp.as_jwt('harness');
  update marketplace.notification_outbox set attempt_count = 5, claim_expires_at = now() - interval '1 second' where id = n_unv;
  perform pg_temp.as_jwt('service_role');
  perform pg_temp.ok((select count(*) = 0 from marketplace.claim_email_notifications(100, interval '5 minutes') c where c.notification_id = n_unv),
    '26-D: after its last attempt''s lease runs out it is not claimed again');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'failed' and resolved_at is not null from marketplace.notification_outbox where id = n_unv),
    '26-D: ... it fails');

  -- Job alerts from a saved job search.
  perform pg_temp.as_jwt('authenticated', 's26_haul');
  insert into marketplace.saved_searches (org_id, kind, name, criteria, alerts_enabled)
  values (o_haul, 'jobs', 'S26 Fir alerts', '{"equipment": "log_truck"}'::jsonb, true) returning id into v_ss;
  perform pg_temp.fails(format('select marketplace.enqueue_job_alerts(%L::uuid, array[%L::uuid])', v_ss, j_a),
    '42501', 'permission denied', '26-D: only the matching service queues job alerts');
  perform pg_temp.as_jwt('service_role');
  perform pg_temp.fails(format('select marketplace.enqueue_job_alerts(%L::uuid, %L::uuid[])', v_ss, '{}'),
    '22023', 'between 1 and 50', '26-D: a job alert names 1 to 50 jobs');
  perform pg_temp.ok(marketplace.enqueue_job_alerts(v_ss, array[j_a, d_b, j_b]) = 2,
    '26-D: one open job alerts on both chosen channels; the draft and the paused job are skipped');
  perform pg_temp.ok(marketplace.enqueue_job_alerts(v_ss, array[j_a]) = 0,
    '26-D: a job alerts a saved search once');
  perform pg_temp.ok(marketplace.enqueue_job_alerts(v_ss, array[j_x]) = 2, '26-D: a new matching job alerts');
  perform pg_temp.as_jwt('authenticated', 's26_haul');
  perform pg_temp.ok((select last_alerted_at is not null from marketplace.saved_searches where id = v_ss)
                     and (select count(*) = 2 from marketplace.notification_outbox
                          where category = 'job_alert' and channel = 'in_app' and payload ->> 'saved_search_name' = 'S26 Fir alerts'),
    '26-D: the search records the alert, and the hauler reads the in-app alerts');
  n_jx := (select id from marketplace.notification_outbox where category = 'job_alert' and channel = 'email' and payload ->> 'job_id' = j_x::text);
  perform pg_temp.as_jwt('authenticated', 's26_own');
  perform marketplace.set_job_posting_status(j_x, 'closed');
  perform pg_temp.as_jwt('service_role');
  perform pg_temp.ok((select count(*) = 0 from marketplace.claim_email_notifications(100, interval '5 minutes') c where c.notification_id = n_jx),
    '26-D: an alert for a job that closed before it was sent is not claimed');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'cancelled' and last_failure ~ 'job is no longer open' from marketplace.notification_outbox where id = n_jx),
    '26-D: ... it is cancelled');
  perform pg_temp.as_jwt('authenticated', 's26_haul');
  update marketplace.saved_searches set alerts_enabled = false where id = v_ss;
  perform pg_temp.as_jwt('service_role');
  perform pg_temp.ok(marketplace.enqueue_job_alerts(v_ss, array[j_staff]) = 0,
    '26-D: a saved search with alerts off queues nothing');

  -- =========================================================================
  -- 26-C: a person who leaves loses their saved jobs view
  -- =========================================================================
  perform pg_temp.as_jwt('authenticated', 's26_hdrv');
  update marketplace.organization_memberships set status = 'removed' where id = m_hdrv;
  perform pg_temp.ok(pg_temp.count_as('s26_hdrv', 'select count(*) from marketplace.saved_jobs') = 0,
    '26-C: a person who left the business no longer reads what they saved for it');
  perform pg_temp.as_jwt('authenticated', 's26_hdrv');
  perform pg_temp.fails(format('select * from marketplace.list_saved_jobs(%L::uuid)', o_haul),
    '42501', 'not available for this business', '26-C: ... nor lists it');

  -- =========================================================================
  -- Privileges
  -- =========================================================================
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select bool_and(c.relrowsecurity) from pg_class c
                      where c.oid in ('marketplace.team_invitations'::regclass, 'marketplace.team_invitation_landings'::regclass,
                                      'marketplace.membership_landing_scopes'::regclass, 'marketplace.saved_jobs'::regclass,
                                      'marketplace.notification_outbox'::regclass)),
    'privileges: row-level security is on for every new table');
  perform pg_temp.ok(not exists (select 1 from information_schema.role_table_grants
                                 where table_schema = 'marketplace'
                                   and table_name in ('team_invitations', 'team_invitation_landings', 'membership_landing_scopes',
                                                      'saved_jobs', 'notification_outbox')
                                   and (grantee in ('PUBLIC', 'anon', 'service_role')
                                        or (grantee = 'authenticated' and privilege_type not in ('SELECT', 'DELETE', 'INSERT')))),
    'privileges: no grant on the new tables to PUBLIC, anon or service_role, and no UPDATE for anyone');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'marketplace.team_invitations', 'INSERT')
                     and not has_table_privilege('authenticated', 'marketplace.membership_landing_scopes', 'INSERT')
                     and not has_table_privilege('authenticated', 'marketplace.notification_outbox', 'INSERT')
                     and not has_table_privilege('authenticated', 'marketplace.notification_outbox', 'DELETE'),
    'privileges: invitations, scopes and notices are written only by 26''s functions');
  perform pg_temp.ok(has_function_privilege('authenticated', 'marketplace.accept_team_invitation(uuid)', 'EXECUTE')
                     and not has_function_privilege('anon', 'marketplace.accept_team_invitation(uuid)', 'EXECUTE')
                     and not has_function_privilege('service_role', 'marketplace.invite_team_member(uuid, text, text, boolean, interval, uuid[])', 'EXECUTE')
                     and has_function_privilege('service_role', 'marketplace.claim_email_notifications(integer, interval)', 'EXECUTE')
                     and not has_function_privilege('authenticated', 'marketplace.complete_email_notification(uuid, uuid, text, text, text, interval)', 'EXECUTE')
                     and not has_function_privilege('authenticated', 'marketplace.enqueue_notification(text, text, uuid, uuid, text, text, uuid, text, jsonb)', 'EXECUTE')
                     and not has_function_privilege('service_role', 'marketplace.enqueue_notification(text, text, uuid, uuid, text, text, uuid, text, jsonb)', 'EXECUTE')
                     and not has_function_privilege('authenticated', 'marketplace.user_landing_scope_allows(uuid, uuid, uuid)', 'EXECUTE'),
    'privileges: people call the invitation functions, the service role the worker functions, and nobody the internals');

  -- -------------------------------------------------------------------------
  -- Ledger
  -- -------------------------------------------------------------------------
  -- Stage 30 runs this suite again on the 29 schema, whose ledger adds 29.
  perform pg_temp.ok((select string_agg(version, ',' order by applied_at, version) from marketplace.schema_migrations)
                       in ('06,11,12,16,18,23,26', '06,11,12,16,18,23,26,29'),
    'the migration ledger records 06, 11, 12, 16, 18, 23, 26 in order (and 29 after them, when stage 30 runs this suite again)');

  raise notice 'ALL SEAT INVITATION, LANDING SCOPE, SAVED JOB AND NOTIFICATION OUTBOX (26-A..26-D) TESTS PASSED.';
end
$$;

rollback;
