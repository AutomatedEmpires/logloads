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
  u_mod uuid; u_post uuid; o_post uuid; l_one uuid; l_two uuid; j_held uuid;
  u_billing uuid; u_support uuid; u_super uuid; v_job uuid; v_job2 uuid; v_eoi uuid; v_period uuid; j_rename uuid;
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

  -- -------------------------------------------------------------------------
  -- LE-09 (A-1): an enabled identity issuer must pin an audience
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('harness');
  perform pg_temp.fails($q$insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
      values ('https://unpinned.example.test', 'Unpinned', null, true)$q$,
    '23514', 'trusted_identity_issuers_audience_pinned_chk', 'A-1: an enabled issuer without an audience is refused');
  insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
  values ('https://disabled.example.test', 'Disabled', null, false);
  perform pg_temp.ok(exists (select 1 from marketplace.trusted_identity_issuers where issuer = 'https://disabled.example.test'),
    'A-1: a disabled issuer may omit the audience');

  -- -------------------------------------------------------------------------
  -- LE-05 (C-1): a held job cannot be republished as an identical new posting
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('service_role');
  u_mod  := marketplace.sync_verified_identity(c_iss, 's16_mod',  'S16 Moderator', 'mod@s16.test',  true);
  u_post := marketplace.sync_verified_identity(c_iss, 's16_post', 'S16 Poster',    'post@s16.test', true);
  perform pg_temp.as_jwt('harness');
  insert into marketplace.platform_admins (user_id, admin_role, note) values (u_mod, 'moderator', 'suite 17');
  perform pg_temp.as_jwt('authenticated', 's16_post');
  o_post := marketplace.create_organization('S16 Posting Co', 's16-posting', 'OR', false);
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_post, 'pro', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_s16p', 'sub_s16p', false, 7, false);
  perform pg_temp.as_jwt('authenticated', 's16_post');
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_post, 'S16 North Landing', 'active', 'Near Sisters, OR', marketplace.make_public_point(-121.5, 44.3), 'OR')
  returning id into l_one;
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_post, 'S16 South Landing', 'active', 'Near Bend, OR', marketplace.make_public_point(-121.3, 44.1), 'OR')
  returning id into l_two;
  j_held := marketplace.publish_job_posting(
    l_one, 'Spruce Haul to Mill', array['log_truck'], 3, 'Spruce sawlogs', 'Suite 17 haul.', 'per_ton', 525, null,
    3, current_date + 10, 8, 3.0, 9, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  perform pg_temp.as_jwt('authenticated', 's16_mod');
  perform marketplace.admin_moderate_job_posting(j_held, 'paused', 'Reported misleading pay');
  perform pg_temp.as_jwt('authenticated', 's16_post');
  perform pg_temp.fails(format($q$select marketplace.publish_job_posting(
      %L, '  spruce   HAUL to mill ', array['log_truck'], 3, 'Spruce sawlogs', 'Same job again.', 'per_ton', 525, null,
      3, current_date + 10, 8, 3.0, 9, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true)$q$, l_one),
    '23514', 'moderation hold \(reason: Reported misleading pay\)', 'C-1: the held job cannot be republished as an identical new posting (the owner sees the reason)');
  perform pg_temp.ok(marketplace.publish_job_posting(
      l_two, 'Spruce Haul to Mill', array['log_truck'], 3, 'Spruce sawlogs', 'Other landing.', 'per_ton', 525, null,
      3, current_date + 10, 8, 3.0, 9, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true) is not null,
    'C-1: the same title at a different landing is not blocked');
  perform pg_temp.ok(marketplace.publish_job_posting(
      l_one, 'Fir Haul to Mill', array['log_truck'], 3, 'Fir sawlogs', 'Different job.', 'per_ton', 525, null,
      3, current_date + 10, 8, 3.0, 9, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true) is not null,
    'C-1: a different posting at the same landing is not blocked');
  j_rename := marketplace.publish_job_posting(
      l_one, 'Spruce Haul to Mill 2', array['log_truck'], 3, 'Spruce sawlogs', 'Second haul.', 'per_ton', 525, null,
      3, current_date + 10, 8, 3.0, 9, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  perform pg_temp.fails(format($q$update marketplace.job_postings set title = 'Spruce-Haul to Mill!' where id = %L$q$, j_rename),
    '23514', 'moderation hold', 'C-1 (final review): a live posting cannot be renamed to a held title, punctuation aside');
  perform pg_temp.as_jwt('authenticated', 's16_mod');
  perform marketplace.admin_release_job_moderation_hold(j_held, 'Pay corrected after review');
  perform pg_temp.as_jwt('authenticated', 's16_post');
  perform pg_temp.ok(marketplace.publish_job_posting(
      l_one, 'Spruce Haul to Mill', array['log_truck'], 3, 'Spruce sawlogs', 'Corrected repost.', 'per_ton', 600, null,
      3, current_date + 10, 8, 3.0, 9, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true) is not null,
    'C-1: after a moderator releases the hold, the corrected posting can be published');

  -- -------------------------------------------------------------------------
  -- Setup for LE-06/07/08/10 and B-7/B-9: platform staff by role, an inquiry with one message
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('service_role');
  u_billing := marketplace.sync_verified_identity(c_iss, 's16_billing', 'S16 Billing Staff', 'billing@s16.test', true);
  u_support := marketplace.sync_verified_identity(c_iss, 's16_support', 'S16 Support Staff', 'support@s16.test', true);
  u_super   := marketplace.sync_verified_identity(c_iss, 's16_super',   'S16 Super Staff',   'super@s16.test',   true);
  perform pg_temp.as_jwt('harness');
  insert into marketplace.platform_admins (user_id, admin_role, note)
  values (u_billing, 'billing', 'suite 17'), (u_support, 'support', 'suite 17'), (u_super, 'superadmin', 'suite 17');
  select id into v_job from marketplace.job_postings where org_id = o_post and title = 'Fir Haul to Mill';
  insert into marketplace.expressions_of_interest (job_id, job_org_id, hauler_org_id, submitted_by, trucks_offered, status, message)
  values (v_job, o_post, o_priv, u_haul, 1, 'submitted', 'Opening note from the hauler')
  returning id into v_eoi;
  insert into marketplace.interest_messages (interest_id, author_user_id, author_side, body)
  values (v_eoi, u_haul, 'hauler', 'We can run two trucks Monday.');

  -- LE-07: staff read access by role; message content only through the audited function
  perform pg_temp.as_jwt('authenticated', 's16_billing');
  perform pg_temp.ok(not exists (select 1 from marketplace.expressions_of_interest where id = v_eoi)
    and not exists (select 1 from marketplace.organization_memberships where org_id = o_post),
    'LE-07: billing staff cannot read other organizations'' inquiries or memberships');
  perform pg_temp.as_jwt('authenticated', 's16_support');
  perform pg_temp.ok(not exists (select 1 from marketplace.expressions_of_interest where id = v_eoi)
    and exists (select 1 from marketplace.organization_memberships where org_id = o_post),
    'LE-07: support staff read memberships, but not inquiry rows (they carry the opening message)');
  perform pg_temp.ok(not exists (select 1 from marketplace.interest_messages where interest_id = v_eoi),
    'LE-07: support staff cannot read message content directly');
  perform pg_temp.ok((select count(*) from marketplace.admin_read_interest_thread(v_eoi, 'Investigating an abuse report')) = 2
    and exists (select 1 from marketplace.admin_read_interest_thread(v_eoi, 'Investigating an abuse report') t
                where t.message_body = 'Opening note from the hauler'),
    'LE-07: support staff read the whole thread, opening message included, through the audited function');
  perform pg_temp.fails(format($q$select * from marketplace.admin_read_interest_thread(%L, 'x')$q$, v_eoi),
    '22023', 'reason', 'LE-07: a thread read needs a reason');
  perform pg_temp.as_jwt('authenticated', 's16_mod');
  perform pg_temp.fails(format($q$select * from marketplace.admin_read_interest_thread(%L, 'Moderation check')$q$, v_eoi),
    '42501', 'support administrator', 'LE-07: moderators cannot read inquiry threads');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(exists (select 1 from marketplace.audit_events
                             where action = 'admin.interest_thread_read' and entity_id = v_eoi
                               and actor_kind = 'platform_admin' and actor_user_id = u_support and reason = 'Investigating an abuse report'),
    'LE-07: the staff read is audited with its reason');
  perform pg_temp.as_jwt('authenticated', 's16_haul');
  perform pg_temp.ok((select count(*) from marketplace.interest_messages where interest_id = v_eoi) = 1,
    'LE-07: the hauling business still reads its own thread');
  perform pg_temp.as_jwt('authenticated', 's16_post');
  perform pg_temp.ok((select count(*) from marketplace.interest_messages where interest_id = v_eoi) = 1,
    'LE-07: the landing desk still reads the thread on its job');

  -- B-9: the 200-message limit binds direct inserts
  perform pg_temp.as_jwt('harness');
  insert into marketplace.interest_messages (interest_id, author_user_id, author_side, body)
  select v_eoi, u_haul, 'hauler', 'message ' || g from generate_series(1, 199) g;
  perform pg_temp.as_jwt('authenticated', 's16_haul');
  perform pg_temp.fails(format($q$insert into marketplace.interest_messages (interest_id, author_side, body)
      values (%L, 'hauler', 'one more')$q$, v_eoi),
    '23514', '200-message limit', 'B-9: a direct insert past the 200-message limit is refused');
  perform pg_temp.as_jwt('authenticated', 's16_post');
  insert into marketplace.interest_messages (interest_id, author_side, body) values (v_eoi, 'landing', 'Closing this inquiry.');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select count(*) from marketplace.interest_messages where interest_id = v_eoi) = 201,
    'B-9 (final review): the landing side can still reply or decline at the limit');

  -- B-7: a declined inquiry no longer opens the landing's private details
  perform pg_temp.as_jwt('harness');
  update marketplace.expressions_of_interest
  set status = 'replied', responded_at = now(), private_details_shared_at = now(), private_details_shared_by = u_post
  where id = v_eoi;
  perform pg_temp.as_jwt('authenticated', 's16_haul');
  perform pg_temp.ok(marketplace.can_view_landing_private(l_one), 'B-7 setup: a shared, open inquiry opens the private details');
  perform pg_temp.as_jwt('harness');
  update marketplace.expressions_of_interest set status = 'declined' where id = v_eoi;
  perform pg_temp.as_jwt('authenticated', 's16_haul');
  perform pg_temp.ok(not marketplace.can_view_landing_private(l_one), 'B-7: once declined, the private details are closed');
  perform pg_temp.as_jwt('authenticated', 's16_post');
  perform pg_temp.ok(not marketplace.has_live_inquiry_from_hauler(o_priv),
    'B-2 (final review): a declined inquiry no longer counts as live for the landing desk');

  -- LE-06: an owner sees a moderation action's reason, not the moderator
  perform pg_temp.as_jwt('authenticated', 's16_post');
  perform pg_temp.ok(exists (select 1 from marketplace.audit_events
                             where entity_id = j_held and action = 'job_posting.moderated' and reason = 'Reported misleading pay'),
    'LE-06: the owner reads the moderation action and its reason');
  perform pg_temp.fails('select actor_user_id from marketplace.audit_events limit 1', '42501', 'permission denied',
    'LE-06: the actor column is not directly readable');
  perform pg_temp.fails('select verified_by from marketplace.organizations limit 1', '42501', 'permission denied',
    'LE-06 (final review): the staff member who verified an organization is not client-readable');
  perform pg_temp.fails('select granted_by from marketplace.promotion_redemptions limit 1', '42501', 'permission denied',
    'LE-06 (final review): the staff member who granted a promotion is not client-readable');
  perform pg_temp.ok(exists (select 1 from marketplace.organizations where id = o_post and verification_status is not null),
    'LE-06 (final review): the organization still reads its own verification status');
  perform pg_temp.ok(marketplace.audit_event_actor(
      (select max(id) from marketplace.audit_events where entity_id = j_held and action = 'job_posting.moderated')) is null,
    'LE-06: the owner cannot learn which moderator acted');
  perform pg_temp.ok(marketplace.audit_event_actor(
      (select max(id) from marketplace.audit_events where entity_id = o_post and action = 'organization.created')) = u_post,
    'LE-06: the owner still sees who in their own organization acted');
  perform pg_temp.as_jwt('authenticated', 's16_support');
  perform pg_temp.ok(marketplace.audit_event_actor(
      (select max(id) from marketplace.audit_events where entity_id = j_held and action = 'job_posting.moderated')) = u_mod,
    'LE-06: platform staff can see the acting moderator');

  -- LE-08: a legal-name change after verification returns the organization to pending review
  perform pg_temp.as_jwt('authenticated', 's16_super');
  perform marketplace.admin_set_org_verification(o_post, 'verified', 'OR SOS registry check');
  perform pg_temp.as_jwt('authenticated', 's16_post');
  update marketplace.organizations set display_name = 'S16 Posting Company' where id = o_post;
  perform pg_temp.ok((select verification_status = 'verified' from marketplace.organizations where id = o_post)
    and exists (select 1 from marketplace.audit_events where entity_id = o_post and action = 'organization.identity_changed'),
    'LE-08: a display-name change keeps verification and is audited');
  update marketplace.organizations set legal_name = 'S16 Posting LLC' where id = o_post;
  perform pg_temp.ok((select verification_status = 'pending' and verified_at is null from marketplace.organizations where id = o_post)
    and exists (select 1 from marketplace.audit_events where entity_id = o_post and action = 'organization.verification_reset'),
    'LE-08: a legal-name change after verification returns the organization to pending review (audited)');

  -- LE-10: the plan's dedupe window cannot be shortened by a caller
  perform pg_temp.as_jwt('harness');
  select id into v_job2 from marketplace.job_postings where org_id = o_post and title = 'Spruce Haul to Mill' and landing_id = l_two;
  select id into v_period from marketplace.entitlement_periods where org_id = o_post order by period_start desc limit 1;
  insert into marketplace.targeted_invitations
    (job_id, sender_org_id, recipient_org_id, sent_by, entitlement_period_id, status, created_at, delivered_at, resolved_at)
  values (v_job2, o_post, o_priv, u_post, v_period, 'delivered', now() - interval '2 days', now() - interval '2 days', now() - interval '2 days');
  perform pg_temp.fails(format($q$insert into marketplace.targeted_invitations
      (job_id, sender_org_id, recipient_org_id, sent_by, entitlement_period_id, status) values (%L, %L, %L, %L, %L, 'reserved')$q$,
      v_job2, o_post, o_priv, u_post, v_period),
    '23514', 'dedupe window', 'LE-10: a business invited 2 days ago cannot be invited again, whatever window a caller passes');

  raise notice 'ALL IDENTITY, MEMBERSHIP AND QUALIFICATION (B-1, B-2, B-5) TESTS PASSED.';
end
$$;

rollback;
