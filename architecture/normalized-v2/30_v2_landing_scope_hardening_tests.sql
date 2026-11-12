-- =============================================================================
-- LogLoads normalized-v2 — 30 regression suite for 29 (landing-scope hardening from the review of #241; #263, #264)
--
-- NON-ACTIVE PROTOTYPE TEST SUITE. Disposable PostgreSQL only. Run after
-- 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23 -> 26 -> 29. Wraps everything in BEGIN ... ROLLBACK.
-- Negative tests require the expected SQLSTATE AND a matching message or constraint name.
-- Each attack in the review is asserted as the attacker first, then by its effect. On a database without 29 the first
-- attack succeeds and the suite stops there. Each of 29's four changes is needed by at least one assertion: with any
-- one of them put back to its 26 definition, the suite fails.
-- The landing shares its private details with a reply or after one, never with 'viewed' alone: 31 (31-P1) refuses
-- that, and this suite also runs on the 31 schema (stage 32).
-- Run as the role that applied 29 (the table owner, which the fixture uses for service steps and for a write that
-- stands in for any SECURITY DEFINER path).
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
  u_own uuid; u_dual uuid; u_lmgr uuid; u_wide uuid; u_haul2 uuid;
  o_land uuid; o_dual uuid; o_haul2 uuid;
  l_a uuid; l_b uuid;
  j_a uuid; j_b uuid; j_b2 uuid; j_b3 uuid; j_b4 uuid; j_bp uuid; d_b uuid;
  e_a uuid; e_b uuid; e_b2 uuid; e_b3 uuid; e_w uuid; e_d uuid;
  v_inv uuid; m_dual uuid; m_lmgr uuid; m_wide uuid; v_created boolean;
begin
  perform pg_temp.as_jwt('service_role');
  u_own   := marketplace.sync_verified_identity(c_iss, 's29_own',   'S29 Landing Owner',      'own@s29.test',   true);
  u_dual  := marketplace.sync_verified_identity(c_iss, 's29_dual',  'S29 Foreman and Hauler', 'dual@s29.test',  true);
  u_lmgr  := marketplace.sync_verified_identity(c_iss, 's29_lmgr',  'S29 Manager A',          'lmgr@s29.test',  true);
  u_wide  := marketplace.sync_verified_identity(c_iss, 's29_wide',  'S29 Office Staff',       'wide@s29.test',  true);
  u_haul2 := marketplace.sync_verified_identity(c_iss, 's29_haul2', 'S29 Other Hauler',       'haul2@s29.test', true);

  -- -------------------------------------------------------------------------
  -- Fixture: a Pro landing organization with active landings A and B and private details for both; a job at A, four
  -- jobs at B, and a draft and a paused job at B. The owner gives Landing Operator seats to staff limited to landing A
  -- who also owns a hauling business (the review's attacker), to a manager limited to A, and to staff for every
  -- landing. The attacker's hauling business inquires on jobs at A and B; a second hauling business has a withdrawn
  -- inquiry and a declined one at B.
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 's29_own');
  o_land := marketplace.create_organization('S29 Landing Co', 's29-landing', 'OR', false);
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_land, 'pro', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_s29', 'sub_s29', false, 7, false);
  perform pg_temp.as_jwt('authenticated', 's29_own');
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_land, 'S29 Landing A', 'active', 'Near Sisters, OR', marketplace.make_public_point(-121.5, 44.3), 'OR') returning id into l_a;
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_land, 'S29 Landing B', 'active', 'Near Bend, OR', marketplace.make_public_point(-121.3, 44.1), 'OR') returning id into l_b;
  insert into marketplace.landing_private_details (landing_id, org_id, directions) values (l_a, o_land, 'A: gate code 2911 at the scale house');
  insert into marketplace.landing_private_details (landing_id, org_id, directions) values (l_b, o_land, 'B: gate code 4417 past the cattle guard');
  j_a  := marketplace.publish_job_posting(l_a, 'S29 Fir Haul A', array['log_truck'], 3, 'Fir sawlogs', 'Suite 30 haul A.', 'per_ton', 525, null,
    3, current_date + 10, 8, 3.0, 9, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  j_b  := marketplace.publish_job_posting(l_b, 'S29 Pine Haul B', array['log_truck'], 2, 'Pine sawlogs', 'Suite 30 haul B.', 'per_ton', 480, null,
    2, current_date + 12, 8, 3.0, 6, 30.0, 'Prineville Mill, OR', 35, null, null, array['ppe'], true);
  j_b2 := marketplace.publish_job_posting(l_b, 'S29 Hemlock Haul B', array['log_truck'], 2, 'Hemlock', 'Suite 30 haul B two.', 'per_load', 90000, null,
    2, current_date + 14, 8, 3.0, 6, 30.0, 'Prineville Mill, OR', 35, null, null, array['ppe'], true);
  j_b3 := marketplace.publish_job_posting(l_b, 'S29 Cedar Haul B', array['log_truck'], 1, 'Cedar', 'Suite 30 haul B three.', 'per_ton', 500, null,
    1, current_date + 14, 8, 3.0, 6, 30.0, 'Prineville Mill, OR', 35, null, null, array['ppe'], true);
  j_b4 := marketplace.publish_job_posting(l_b, 'S29 Spruce Haul B', array['log_truck'], 1, 'Spruce', 'Suite 30 haul B four.', 'per_ton', 505, null,
    1, current_date + 14, 8, 3.0, 6, 30.0, 'Prineville Mill, OR', 35, null, null, array['ppe'], true);
  j_bp := marketplace.publish_job_posting(l_b, 'S29 Larch Haul B', array['log_truck'], 1, 'Larch', 'Suite 30 paused at B.', 'per_ton', 510, null,
    1, current_date + 14, 8, 3.0, 6, 30.0, 'Prineville Mill, OR', 35, null, null, array['ppe'], true);
  perform marketplace.set_job_posting_status(j_bp, 'paused');
  d_b := marketplace.save_job_posting_draft(l_b, 'S29 Draft at B');

  v_inv := marketplace.invite_team_member(o_land, 'dual@s29.test', 'staff', true, interval '7 days', array[l_a]);
  perform pg_temp.as_jwt('authenticated', 's29_dual');
  m_dual := marketplace.accept_team_invitation(v_inv);
  perform pg_temp.as_jwt('authenticated', 's29_own');
  v_inv := marketplace.invite_team_member(o_land, 'lmgr@s29.test', 'manager', true, interval '7 days', array[l_a]);
  perform pg_temp.as_jwt('authenticated', 's29_lmgr');
  m_lmgr := marketplace.accept_team_invitation(v_inv);
  perform pg_temp.as_jwt('authenticated', 's29_own');
  v_inv := marketplace.invite_team_member(o_land, 'wide@s29.test', 'staff', true, interval '7 days');
  perform pg_temp.as_jwt('authenticated', 's29_wide');
  m_wide := marketplace.accept_team_invitation(v_inv);

  perform pg_temp.as_jwt('authenticated', 's29_dual');
  o_dual := marketplace.create_organization('S29 Dual Hauling', 's29-dual-hauling', 'OR', true);
  select interest_id into e_a  from marketplace.submit_expression_of_interest(o_dual, j_a, 1);
  select interest_id into e_b  from marketplace.submit_expression_of_interest(o_dual, j_b, 1);
  select interest_id into e_b2 from marketplace.submit_expression_of_interest(o_dual, j_b2, 1);
  select interest_id into e_b3 from marketplace.submit_expression_of_interest(o_dual, j_b3, 1);
  perform pg_temp.as_jwt('authenticated', 's29_haul2');
  o_haul2 := marketplace.create_organization('S29 Other Hauling', 's29-other-hauling', 'OR', true);
  select interest_id into e_w from marketplace.submit_expression_of_interest(o_haul2, j_b4, 1);
  perform marketplace.withdraw_interest(e_w);
  select interest_id into e_d from marketplace.submit_expression_of_interest(o_haul2, j_b2, 1);
  perform pg_temp.as_jwt('authenticated', 's29_own');
  perform marketplace.respond_to_interest(e_b3, 'viewed');
  perform marketplace.respond_to_interest(e_d, 'declined');

  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select array_agg(landing_id) = array[l_a] from marketplace.membership_landing_scopes where membership_id = m_dual)
                     and (select array_agg(landing_id) = array[l_a] from marketplace.membership_landing_scopes where membership_id = m_lmgr)
                     and not exists (select 1 from marketplace.membership_landing_scopes where membership_id = m_wide)
                     and exists (select 1 from marketplace.organization_memberships
                                 where org_id = o_dual and user_id = u_dual and role = 'owner' and status = 'active'),
    'fixture: the attacker is staff limited to landing A and owns the hauling business that inquired at landing B; a manager is limited to A; other staff work every landing');
  perform pg_temp.ok(pg_temp.count_as('s29_dual', format('select count(*) from marketplace.landing_private_details where landing_id = %L', l_a)) = 1
                     and pg_temp.count_as('s29_dual', format('select count(*) from marketplace.landing_private_details where landing_id = %L', l_b)) = 0,
    'fixture: ... so the attacker reads landing A''s private details and not landing B''s');

  -- =========================================================================
  -- 29-P2: respond_to_interest, as the limited member who also belongs to the inquiring hauling business
  -- =========================================================================
  perform pg_temp.as_jwt('authenticated', 's29_dual');
  perform pg_temp.fails(format('select marketplace.respond_to_interest(%L::uuid, %L, true)', e_b, 'viewed'),
    '42501', 'not one of the landings you are assigned to',
    '29-P2: staff limited to landing A who also owns the inquiring hauling business cannot mark an inquiry at landing B viewed and share landing B''s private details (the review''s attack)');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'submitted' and responded_at is null and private_details_shared_at is null and private_details_shared_by is null
                      from marketplace.expressions_of_interest where id = e_b),
    '29-P2: ... the inquiry is unchanged');
  perform pg_temp.ok(pg_temp.count_as('s29_dual', format('select count(*) from marketplace.landing_private_details where landing_id = %L', l_b)) = 0,
    '29-P2: ... and the hauling business still cannot read landing B''s private details (can_view_landing_private)');
  perform pg_temp.as_jwt('authenticated', 's29_dual');
  perform pg_temp.fails(format('select marketplace.respond_to_interest(%L::uuid, %L)', e_b2, 'declined'),
    '42501', 'not one of the landings', '29-P2: ... cannot decline an inquiry at landing B without a reply (no message for the message guard to stop)');
  perform pg_temp.fails(format('select marketplace.respond_to_interest(%L::uuid, %L)', e_b, 'viewed'),
    '42501', 'not one of the landings', '29-P2: ... cannot mark one viewed without sharing');
  perform pg_temp.fails(format('select marketplace.respond_to_interest(%L::uuid, %L, null, %L::uuid, %L)', e_b, 'replied', gen_random_uuid(), 'We can load you at B'),
    '42501', 'not one of the landings', '29-P2: ... cannot reply on one');
  perform pg_temp.fails(format('select marketplace.respond_to_interest(%L::uuid, %L, true)', e_b3, 'viewed'),
    '42501', 'not one of the landings', '29-P2: ... cannot share landing B''s private details on an inquiry the owner already viewed');
  perform pg_temp.fails(format('select marketplace.respond_to_interest(%L::uuid, %L)', e_b3, 'viewed'),
    '42501', 'not one of the landings', '29-P2: ... and a response that would change nothing is refused too, not accepted');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select bool_and(private_details_shared_at is null and private_details_shared_by is null and responded_at is null
                                      and status = case when id = e_b3 then 'viewed' else 'submitted' end)
                      from marketplace.expressions_of_interest where id in (e_b, e_b2, e_b3))
                     and not exists (select 1 from marketplace.interest_messages where interest_id in (e_b, e_b2, e_b3)),
    '29-P2: ... none of the inquiries at landing B changed, and no message was written');

  perform pg_temp.as_jwt('authenticated', 's29_own');
  perform marketplace.respond_to_interest(e_b3, 'replied', true, gen_random_uuid(), 'Come by B on Monday; the gate details are shared here.');
  perform pg_temp.as_jwt('authenticated', 's29_dual');
  perform pg_temp.fails(format('select marketplace.respond_to_interest(%L::uuid, %L, false)', e_b3, 'viewed'),
    '42501', 'not one of the landings', '29-P2: ... cannot revoke the private details the owner shared on an inquiry at landing B');

  -- 29-P2 on any path: the table owner's role with the attacker's verified claims stands in for any SECURITY DEFINER
  -- function acting for them, so these exercise landing_scope_guard alone.
  perform pg_temp.claims_only('s29_dual');
  perform pg_temp.fails(format('update marketplace.expressions_of_interest set private_details_shared_at = now(), private_details_shared_by = %L where id = %L', u_dual, e_b),
    '42501', 'not one of the landings', '29-P2 (landing_scope_guard): on any path, the attacker cannot share landing B''s private details on an inquiry');
  perform pg_temp.fails(format($q$update marketplace.expressions_of_interest set status = 'declined', responded_at = now() where id = %L$q$, e_b2),
    '42501', 'not one of the landings', '29-P2 (landing_scope_guard): ... nor decline an inquiry at landing B');
  perform pg_temp.fails(format($q$update marketplace.expressions_of_interest set status = 'viewed' where id = %L$q$, e_b),
    '42501', 'not one of the landings', '29-P2 (landing_scope_guard): ... nor mark one viewed');
  perform pg_temp.fails(format($q$update marketplace.expressions_of_interest set responded_at = now() - interval '1 hour' where id = %L$q$, e_b3),
    '42501', 'not one of the landings', '29-P2 (landing_scope_guard): ... nor change the response time on one');
  perform pg_temp.fails(format('update marketplace.expressions_of_interest set private_details_shared_at = null, private_details_shared_by = null where id = %L', e_b3),
    '42501', 'not one of the landings', '29-P2 (landing_scope_guard): ... nor revoke the owner''s sharing');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'replied' and private_details_shared_at is not null and private_details_shared_by = u_own
                      from marketplace.expressions_of_interest where id = e_b3)
                     and (select status = 'submitted' and responded_at is null and private_details_shared_at is null
                          from marketplace.expressions_of_interest where id = e_b)
                     and (select status = 'submitted' and responded_at is null from marketplace.expressions_of_interest where id = e_b2),
    '29-P2: ... the inquiries at landing B are as the owner left them');

  -- =========================================================================
  -- 29-P2: respond_to_interest's own check. A member limited to landing A learns nothing about an inquiry at B.
  -- =========================================================================
  perform pg_temp.as_jwt('authenticated', 's29_lmgr');
  perform pg_temp.fails(format('select marketplace.respond_to_interest(%L::uuid, %L)', e_w, 'viewed'),
    '42501', 'not one of the landings', '29-P2: a manager limited to landing A is refused a withdrawn inquiry at landing B for its landing, not told it was withdrawn');
  perform pg_temp.fails(format('select marketplace.respond_to_interest(%L::uuid, %L)', e_d, 'declined'),
    '42501', 'not one of the landings', '29-P2: ... a repeated decline of a declined inquiry at landing B is refused, not accepted');
  perform pg_temp.fails(format('select marketplace.respond_to_interest(%L::uuid, %L, null, %L::uuid, %L)', e_d, 'replied', gen_random_uuid(), 'Reopen?'),
    '42501', 'not one of the landings', '29-P2: ... and a reply to it is refused for its landing, not because it is closed');

  -- =========================================================================
  -- 29-P2: everything in scope, and every hauler-side action, still works
  -- =========================================================================
  perform pg_temp.as_jwt('authenticated', 's29_dual');
  perform marketplace.respond_to_interest(e_a, 'viewed');
  perform pg_temp.as_jwt('authenticated', 's29_lmgr');
  perform marketplace.respond_to_interest(e_a, 'replied', null, gen_random_uuid(), 'Load at A on Monday');
  perform pg_temp.as_jwt('authenticated', 's29_dual');
  perform marketplace.respond_to_interest(e_a, 'viewed', true);
  perform pg_temp.as_jwt('authenticated', 's29_wide');
  perform marketplace.respond_to_interest(e_b2, 'declined');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'replied' and responded_at is not null and private_details_shared_by = u_dual
                      from marketplace.expressions_of_interest where id = e_a),
    '29-P2: at landing A the attacker still views an inquiry, the limited manager replies, and the attacker then shares A''s details');
  perform pg_temp.ok((select status = 'declined' and responded_at is not null from marketplace.expressions_of_interest where id = e_b2),
    '29-P2: ... and staff for every landing still decline an inquiry at landing B');

  perform pg_temp.as_jwt('authenticated', 's29_dual');
  select created into v_created from marketplace.submit_expression_of_interest(o_dual, j_b, 2, '[]'::jsonb, null, null, 'Two trucks from Monday');
  update marketplace.expressions_of_interest set contact_preference = 'phone' where id = e_b;
  perform marketplace.post_hauler_interest_reply(e_b, gen_random_uuid(), 'Can start Monday');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_created is false
                     and (select trucks_offered = 2 and message = 'Two trucks from Monday' and contact_preference = 'phone' and status = 'submitted'
                          from marketplace.expressions_of_interest where id = e_b)
                     and (select count(*) = 1 from marketplace.interest_messages where interest_id = e_b and author_side = 'hauler'),
    '29-P2: for the hauling business, the same person still updates its inquiry at landing B, edits it directly and replies on it');
  perform pg_temp.as_jwt('authenticated', 's29_dual');
  perform marketplace.withdraw_interest(e_b3);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'withdrawn' and withdrawn_at is not null and private_details_shared_at is null and private_details_shared_by is null
                      from marketplace.expressions_of_interest where id = e_b3),
    '29-P2: ... withdraws an inquiry at landing B, which clears the details the owner shared');
  perform pg_temp.as_jwt('authenticated', 's29_dual');
  select created into v_created from marketplace.submit_expression_of_interest(o_dual, j_b3, 1);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_created is false
                     and (select status = 'submitted' and withdrawn_at is null from marketplace.expressions_of_interest where id = e_b3),
    '29-P2: ... and sends it again');

  -- =========================================================================
  -- 29-P3: the audience counts follow the landing scope
  -- =========================================================================
  perform pg_temp.as_jwt('authenticated', 's29_dual');
  perform pg_temp.fails(format('select marketplace.count_eligible_invitation_recipients(%L::uuid)', j_b),
    '42501', 'not authorized for this job', '29-P3: staff limited to landing A cannot count eligible invitation recipients for a job at landing B');
  perform pg_temp.fails(format('select marketplace.count_eligible_invitation_recipients(%L::uuid)', d_b),
    '42501', 'not authorized for this job', '29-P3: ... nor for a draft at landing B, which row security hides from them');
  perform pg_temp.fails(format('select marketplace.count_eligible_invitation_recipients(%L::uuid)', j_bp),
    '42501', 'not authorized for this job', '29-P3: ... nor for a paused job at landing B');
  perform pg_temp.fails(format('select * from marketplace.estimate_boost_audience(%L::uuid)', j_b),
    '42501', 'not authorized for this job', '29-P3: ... cannot estimate a boost audience for a job at landing B');
  perform pg_temp.fails(format('select * from marketplace.estimate_boost_audience(%L::uuid)', d_b),
    '42501', 'not authorized for this job', '29-P3: ... nor for the draft');
  perform pg_temp.fails(format('select * from marketplace.estimate_boost_audience(%L::uuid, %L)', j_bp, 'quick'),
    '42501', 'not authorized for this job', '29-P3: ... nor for the paused job');
  perform pg_temp.as_jwt('authenticated', 's29_lmgr');
  perform pg_temp.fails(format('select marketplace.count_eligible_invitation_recipients(%L::uuid)', j_b2),
    '42501', 'not authorized for this job', '29-P3: a manager limited to landing A cannot count recipients for a job at landing B either');
  perform pg_temp.fails(format('select * from marketplace.estimate_boost_audience(%L::uuid)', d_b),
    '42501', 'not authorized for this job', '29-P3: ... nor estimate a boost audience for one');

  perform pg_temp.as_jwt('authenticated', 's29_dual');
  perform pg_temp.ok(marketplace.count_eligible_invitation_recipients(j_a) >= 0
                     and (select count(*) = 1 from marketplace.estimate_boost_audience(j_a)),
    '29-P3: the limited member still reads both for a job at landing A');
  perform pg_temp.as_jwt('authenticated', 's29_wide');
  perform pg_temp.ok(marketplace.count_eligible_invitation_recipients(d_b) >= 0
                     and marketplace.count_eligible_invitation_recipients(j_bp) >= 0
                     and (select count(*) = 1 from marketplace.estimate_boost_audience(j_b))
                     and (select count(*) = 1 from marketplace.estimate_boost_audience(d_b)),
    '29-P3: staff for every landing still read both for jobs, drafts and paused jobs at landing B');
  perform pg_temp.as_jwt('authenticated', 's29_own');
  perform pg_temp.ok(marketplace.count_eligible_invitation_recipients(j_b) >= 0
                     and (select count(*) = 1 from marketplace.estimate_boost_audience(j_bp)),
    '29-P3: ... and so does the owner');

  -- =========================================================================
  -- Privileges and wiring
  -- =========================================================================
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(bool_and(has_function_privilege('authenticated', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE')
                              and not has_function_privilege('service_role', f, 'EXECUTE')),
    'privileges: respond_to_interest, count_eligible_invitation_recipients and estimate_boost_audience stay executable by authenticated only')
  from unnest(array['marketplace.respond_to_interest(uuid, text, boolean, uuid, text)',
                    'marketplace.count_eligible_invitation_recipients(uuid, integer, interval)',
                    'marketplace.estimate_boost_audience(uuid, text)']::regprocedure[]) f;
  perform pg_temp.ok(not has_function_privilege('authenticated', 'marketplace.tg_landing_scope_guard()', 'EXECUTE')
                     and not has_function_privilege('anon', 'marketplace.tg_landing_scope_guard()', 'EXECUTE')
                     and not has_function_privilege('service_role', 'marketplace.tg_landing_scope_guard()', 'EXECUTE'),
    'privileges: the guard''s trigger function stays executable by no API role');
  perform pg_temp.ok((select count(distinct c.relname) = 7 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                      where c.relnamespace = 'marketplace'::regnamespace and t.tgname = 'landing_scope_guard' and t.tgenabled = 'O'
                        and t.tgfoid = 'marketplace.tg_landing_scope_guard()'::regprocedure),
    'wiring: landing_scope_guard still runs the redefined function on its seven tables');

  -- -------------------------------------------------------------------------
  -- Ledger
  -- -------------------------------------------------------------------------
  perform pg_temp.ok((select string_agg(version, ',' order by applied_at, version) from marketplace.schema_migrations)
                       in ('06,11,12,16,18,23,26,29', '06,11,12,16,18,23,26,29,31'),
    'the migration ledger records 06, 11, 12, 16, 18, 23, 26, 29 in order (and 31 after them, when stage 32 runs this suite again)');

  raise notice 'ALL LANDING-SCOPE HARDENING (29-P2, 29-P3) TESTS PASSED.';
end
$$;

rollback;
