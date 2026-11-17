-- =============================================================================
-- LogLoads normalized-v2 — 13 Phase 3 regression suite: policy items F1–F5 (as directed; see PHASE3_REVIEW.md §2), moderation holds,
-- and billing webhook ordering (R4).
--
-- NON-ACTIVE PROTOTYPE TEST SUITE. Disposable PostgreSQL only. Run after
-- 01 -> 02 -> 03 -> 06 -> 11 -> 12. Wraps everything in BEGIN ... ROLLBACK.
-- Negative tests require the expected SQLSTATE AND a matching constraint name or message, and check
-- that nothing was written. (Concurrent delivery and re-activation races are in 08; the migration of
-- existing data in 10.)
-- =============================================================================

begin;

create function pg_temp.as_jwt(p_role text, p_sub text default null) returns void language plpgsql as $$
begin
  if p_role = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  elsif p_role = 'service_role' then
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

create function pg_temp.n(p_table text) returns bigint language plpgsql security definer as $$
declare v bigint;
begin
  execute format('select count(*) from marketplace.%I', p_table) into v;
  return v;
end
$$;

-- One provider webhook delivery (caller must be service_role). Returns the outcome; the digest is derived
-- from the event id unless a different payload is simulated.
create function pg_temp.evt(
  p_id text, p_type text, p_created timestamptz, p_org uuid, p_sub text, p_plan text, p_status text,
  p_ps timestamptz, p_pe timestamptz, p_reason text default null, p_cancel boolean default false,
  p_payload text default null, p_recon boolean default false
) returns text language plpgsql as $$
declare v text;
begin
  select r.result into v from marketplace.apply_billing_provider_event(
    'stripe', p_id, p_type, p_created, p_org, p_sub, 'cus_' || p_sub, p_plan, p_status, p_ps, p_pe,
    p_cancel, p_reason, encode(sha256(convert_to(coalesce(p_payload, p_id), 'UTF8')), 'hex'), p_recon) r;
  return v;
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
  u_land uuid; u_haul uuid; u_drv uuid; u_admin uuid; u_bill uuid;
  o_land uuid; o_haul uuid; o_bare uuid; o_bill uuid; o_bill2 uuid;
  o_bill3 uuid; o_bill4 uuid; o_bill5 uuid; o_bill6 uuid; o_bill7 uuid; o_bill8 uuid; o_bill9 uuid; o_bill10 uuid; o_e2 uuid; o_e2b uuid; o_e3 uuid; o_e3b uuid; o_e4 uuid; o_e5 uuid;
  l_land uuid; l_bill uuid;
  j_a uuid; j_b uuid; j_legacy uuid; v_draft uuid; v_draft2 uuid;
  v_n bigint; v_n2 bigint; v_ts timestamptz; v_ts2 timestamptz; v_seq bigint;
  t0 timestamptz := date_trunc('second', now()) - interval '1 day';
  v_out text;
  r record;
begin
  -- -------------------------------------------------------------------------
  -- Fixture
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('service_role');
  u_land  := marketplace.sync_verified_identity(c_iss, 'p3_land',  'Lou Landing', 'lou@p3.test', true);
  u_haul  := marketplace.sync_verified_identity(c_iss, 'p3_haul',  'Hana Hauler', 'hana@p3.test', true);
  u_drv   := marketplace.sync_verified_identity(c_iss, 'p3_drv',   'Dex Driver',  'dex@p3.test',  true);
  u_admin := marketplace.sync_verified_identity(c_iss, 'p3_admin', 'Ari Admin',   'ari@p3.test',  true);
  u_bill  := marketplace.sync_verified_identity(c_iss, 'p3_bill',  'Bea Billing', 'bea@p3.test',  true);
  perform pg_temp.as_jwt('harness');
  insert into marketplace.platform_admins (user_id, admin_role, note) values (u_admin, 'superadmin', 'phase 3 suite');

  perform pg_temp.as_jwt('authenticated', 'p3_land');
  o_land := marketplace.create_organization('P3 Timber', 'p3-timber', 'OR', false);
  o_bare := marketplace.create_organization('P3 Bare Org', 'p3-bare', 'OR', false);
  perform pg_temp.as_jwt('authenticated', 'p3_haul');
  o_haul := marketplace.create_organization('P3 Hauling', 'p3-hauling', 'OR', true);
  insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
  values (o_haul, u_drv, 'driver', false, 'invited');
  perform pg_temp.as_jwt('authenticated', 'p3_drv');
  update marketplace.organization_memberships set status = 'active' where org_id = o_haul and user_id = u_drv;
  perform pg_temp.as_jwt('authenticated', 'p3_bill');
  o_bill  := marketplace.create_organization('P3 Billing Timber', 'p3-billing', 'OR', false);
  o_bill2 := marketplace.create_organization('P3 Billing Timber Two', 'p3-billing-two', 'OR', false);

  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_land, 'pro', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_p3', 'sub_p3', false, 7, false);

  perform pg_temp.as_jwt('authenticated', 'p3_land');
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_land, 'P3 Landing', 'active', 'Near Mapleton, OR', extensions.st_GeogFromText('SRID=4326;POINT(-123.85 44.03)'), 'OR')
  returning id into l_land;

  -- -------------------------------------------------------------------------
  -- F1: hauler profiles private by default; explicit, recorded consent to public discovery
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select not is_public and public_listing_consent_at is null from marketplace.hauler_profiles where org_id = o_haul),
    'F1: a new hauling business starts private, with no consent recorded');
  insert into marketplace.hauler_profiles (org_id) values (o_bare);
  perform pg_temp.ok((select not is_public from marketplace.hauler_profiles where org_id = o_bare),
    'F1: the table default is private (a profile inserted without is_public is not discoverable)');
  perform pg_temp.fails(format('update marketplace.hauler_profiles set is_public = true where org_id = %L', o_bare), '42501', 'explicit consent',
    'F1: a session with no user (migration / service) cannot make a profile public');

  perform pg_temp.as_jwt('authenticated', 'p3_drv');
  update marketplace.hauler_profiles set is_public = true where org_id = o_haul;
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select not is_public from marketplace.hauler_profiles where org_id = o_haul),
    'F1: a driver of the business cannot consent on its behalf (row not updatable by a driver)');

  perform pg_temp.as_jwt('authenticated', 'p3_haul');
  perform pg_temp.fails(format($q$update marketplace.hauler_profiles set public_listing_consent_at = now() - interval '1 year' where org_id = %L$q$, o_haul),
    '42501', 'permission denied', 'F1: a client cannot write or backdate the consent record');
  update marketplace.hauler_profiles set is_public = true where org_id = o_haul;
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select is_public and public_listing_consent_by = u_haul and public_listing_consent_at is not null
                      from marketplace.hauler_profiles where org_id = o_haul)
    and exists (select 1 from marketplace.audit_events where entity_id = o_haul and action = 'hauler.public_listing_consented' and actor_user_id = u_haul),
    'F1: the owner''s opt-in is recorded with who and when, and audited');
  perform pg_temp.as_jwt('authenticated', 'p3_land');
  perform pg_temp.ok(exists (select 1 from marketplace.hauler_profiles where org_id = o_haul),
    'F1: once consented, a landing desk can discover the profile');

  perform pg_temp.as_jwt('authenticated', 'p3_haul');
  update marketplace.hauler_profiles set is_public = false where org_id = o_haul;
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select not is_public and public_listing_consent_at is null and public_listing_consent_by is null
                      from marketplace.hauler_profiles where org_id = o_haul)
    and exists (select 1 from marketplace.audit_events where entity_id = o_haul and action = 'hauler.public_listing_withdrawn'),
    'F1: withdrawing consent clears it and is audited');
  perform pg_temp.as_jwt('authenticated', 'p3_land');
  perform pg_temp.ok(not exists (select 1 from marketplace.hauler_profiles where org_id = o_haul),
    'F1: a withdrawn profile is no longer discoverable by a landing desk without an inquiry');

  -- -------------------------------------------------------------------------
  -- F4: incomplete drafts; publication enforces completeness
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 'p3_land');
  v_draft := marketplace.save_job_posting_draft(p_landing_id => l_land, p_title => 'Incomplete sort haul');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'draft' and trucks_requested is null and trucks_per_day is null and pay_unit is null
                      from marketplace.job_postings where id = v_draft),
    'F4: a draft can be saved with no truck demand, pay or equipment, and no truck count is invented');
  perform pg_temp.as_jwt('authenticated', 'p3_land');
  v_draft := marketplace.save_job_posting_draft(p_landing_id => l_land, p_title => 'Incomplete sort haul', p_trucks_per_day => 2, p_draft_job_id => v_draft);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select trucks_requested is null and trucks_per_day = 2 from marketplace.job_postings where id = v_draft),
    'F4: updating a draft keeps an omitted truck total empty');
  perform pg_temp.as_jwt('authenticated', 'p3_land');
  v_n2 := pg_temp.n('job_publication_attestations');
  perform pg_temp.fails(format($q$select marketplace.publish_job_posting(p_landing_id => %L, p_title => 'Incomplete sort haul', p_equipment_codes => array['log_truck'],
    p_trucks_requested => null, p_pay_unit => 'per_ton', p_pay_amount_cents => 900, p_attest_available => true, p_draft_job_id => %L)$q$, l_land, v_draft),
    '23514', 'how many trucks', 'F4: publishing a draft without truck demand is refused');
  perform pg_temp.fails(format($q$select marketplace.publish_job_posting(p_landing_id => %L, p_title => 'Incomplete sort haul', p_equipment_codes => array[]::text[],
    p_trucks_requested => 2, p_pay_unit => 'per_ton', p_pay_amount_cents => 900, p_attest_available => true, p_draft_job_id => %L)$q$, l_land, v_draft),
    '23514', 'equipment', 'F4: publishing a draft without equipment is refused');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'draft' from marketplace.job_postings where id = v_draft) and pg_temp.n('job_publication_attestations') = v_n2,
    'F4: refused publications leave the draft a draft with no attestation');
  perform pg_temp.as_jwt('authenticated', 'p3_admin');
  perform pg_temp.fails(format($q$select marketplace.admin_import_legacy_job_posting(%L, %L, 'Legacy without demand', array['log_truck'], 'Pilot batch without trucks')$q$, o_land, l_land),
    '23514', 'job_postings_truck_demand_chk', 'F4: a published (legacy) posting still must state truck demand');
  perform pg_temp.as_jwt('authenticated', 'p3_land');
  perform marketplace.publish_job_posting(p_landing_id => l_land, p_title => 'Incomplete sort haul', p_equipment_codes => array['log_truck'],
    p_trucks_requested => 4, p_trucks_per_day => 2, p_pay_unit => 'per_ton', p_pay_amount_cents => 900, p_attest_available => true, p_draft_job_id => v_draft);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'active' and trucks_requested = 4 from marketplace.job_postings where id = v_draft),
    'F4: the completed draft publishes');

  -- -------------------------------------------------------------------------
  -- F3: re-activation needs a fresh availability attestation
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 'p3_land');
  j_a := marketplace.publish_job_posting(p_landing_id => l_land, p_title => 'P3 Sawlog Run', p_equipment_codes => array['log_truck'],
    p_trucks_requested => 3, p_pay_unit => 'per_load', p_pay_amount_cents => 45000, p_attest_available => true);
  perform marketplace.set_job_posting_status(j_a, 'paused');
  perform pg_temp.as_jwt('harness');
  select last_confirmed_at, confirmation_seq into v_ts, v_seq
  from marketplace.job_postings j join marketplace.job_publication_attestations a on a.job_id = j.id where j.id = j_a;
  perform pg_temp.as_jwt('authenticated', 'p3_land');
  perform pg_temp.fails(format('select marketplace.set_job_posting_status(%L, %L)', j_a, 'active'), '23514', 'fresh availability attestation',
    'F3: a paused job cannot be re-activated by a plain status change (even in the transaction that published it)');
  perform pg_temp.fails(format($q$update marketplace.job_postings set status = 'active' where id = %L$q$, j_a), '23514', 'fresh availability attestation',
    'F3: ... nor by a direct UPDATE');
  perform pg_temp.fails(format('select marketplace.reactivate_job_posting(%L)', j_a), '23514', 'attestation',
    'F3: re-activation without an attestation is refused');
  perform pg_temp.fails(format('select marketplace.reactivate_job_posting(%L, false)', j_a), '23514', 'attestation',
    'F3: re-activation with attestation = false is refused');
  perform pg_temp.as_jwt('authenticated', 'p3_drv');
  -- From 31 (31-O) another business's job reads exactly as a job that does not exist; stage 32 runs this suite again.
  perform pg_temp.fails(format('select marketplace.reactivate_job_posting(%L, true)', j_a),
    case when to_regprocedure('marketplace.job_confirmation_current(timestamptz)') is null then '42501' else 'P0002' end,
    case when to_regprocedure('marketplace.job_confirmation_current(timestamptz)') is null then '' else '^Job not found$' end,
    'F3: a hauling driver cannot re-activate a landing''s job');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select j.status = 'paused' and j.last_confirmed_at = v_ts and a.confirmation_seq = v_seq
                      from marketplace.job_postings j join marketplace.job_publication_attestations a on a.job_id = j.id where j.id = j_a),
    'F3: refused re-activations change nothing');
  perform pg_temp.as_jwt('authenticated', 'p3_land');
  v_ts2 := marketplace.reactivate_job_posting(j_a, true);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select j.status = 'active' and j.last_confirmed_at = v_ts2 and v_ts2 > v_ts and j.last_confirmed_by = u_land
                             and a.confirmation_seq = v_seq + 1
                      from marketplace.job_postings j join marketplace.job_publication_attestations a on a.job_id = j.id where j.id = j_a)
    and exists (select 1 from marketplace.audit_events where entity_id = j_a and action = 'job_posting.reactivated' and actor_user_id = u_land),
    'F3: attested re-activation records a new confirmation by the user and is audited');
  perform pg_temp.as_jwt('authenticated', 'p3_land');
  perform pg_temp.fails(format('select marketplace.reactivate_job_posting(%L, true)', j_a), '23514', 'already active',
    'F3: re-activating an active job is refused (reconfirm instead)');
  perform marketplace.set_job_posting_status(j_a, 'expired');
  perform pg_temp.fails(format('select marketplace.reactivate_job_posting(%L, true)', j_a), '23514', 'passed its expiry',
    'F3: an expired posting is not re-activated; it is re-published');

  -- -------------------------------------------------------------------------
  -- Moderation holds (a takedown the owner cannot undo)
  -- -------------------------------------------------------------------------
  j_b := marketplace.publish_job_posting(p_landing_id => l_land, p_title => 'P3 Pulp Run', p_equipment_codes => array['log_truck'],
    p_trucks_requested => 2, p_pay_unit => 'per_ton', p_pay_amount_cents => 1100, p_attest_available => true);
  perform pg_temp.as_jwt('authenticated', 'p3_admin');
  perform marketplace.admin_moderate_job_posting(j_b, 'paused', 'Reported misleading pay');
  perform pg_temp.as_jwt('authenticated', 'p3_land');
  perform pg_temp.fails(format('select marketplace.reactivate_job_posting(%L, true)', j_b), '42501', 'moderation hold',
    'moderation: the owner cannot re-activate a moderated posting, even with an attestation');
  perform pg_temp.fails(format($q$update marketplace.job_postings set status = 'active' where id = %L$q$, j_b), '42501', 'moderation hold',
    'moderation: ... nor by a direct UPDATE');
  perform pg_temp.fails(format('delete from marketplace.job_moderation_holds where job_id = %L', j_b), '42501', 'permission denied',
    'moderation: the owner cannot remove the hold');
  perform pg_temp.fails(format($q$select marketplace.admin_release_job_moderation_hold(%L, 'Owner says fixed')$q$, j_b), '42501', 'moderator',
    'moderation: only a moderator releases a hold');
  perform pg_temp.as_jwt('authenticated', 'p3_admin');
  perform marketplace.admin_release_job_moderation_hold(j_b, 'Pay corrected after review');
  perform pg_temp.as_jwt('authenticated', 'p3_land');
  perform marketplace.reactivate_job_posting(j_b, true);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'active' from marketplace.job_postings where id = j_b)
    and exists (select 1 from marketplace.audit_events where entity_id = j_b and action = 'job_posting.moderation_released'),
    'moderation: after an audited release the owner re-activates with an attestation');

  -- -------------------------------------------------------------------------
  -- F2: legacy postings need valid pay before reconfirmation or re-activation
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 'p3_admin');
  j_legacy := marketplace.admin_import_legacy_job_posting(o_land, l_land, 'P3 legacy haul', array['log_truck'], 'Pilot migration batch 3',
    p_trucks_per_day => 2);
  perform pg_temp.as_jwt('authenticated', 'p3_land');
  v_n2 := pg_temp.n('job_publication_attestations');
  perform pg_temp.fails(format('select marketplace.reconfirm_job_posting(%L)', j_legacy), '23514', 'add pay',
    'F2: an unpriced legacy posting cannot be reconfirmed');
  perform marketplace.set_job_posting_status(j_legacy, 'paused');
  perform pg_temp.fails(format('select marketplace.reactivate_job_posting(%L, true)', j_legacy), '23514', 'add pay',
    'F2: an unpriced legacy posting cannot be put back on the marketplace');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.n('job_publication_attestations') = v_n2
    and (select status = 'paused' and last_confirmed_at is null from marketplace.job_postings where id = j_legacy),
    'F2: refusals wrote no attestation and no confirmation');
  perform pg_temp.as_jwt('authenticated', 'p3_land');
  perform pg_temp.fails(format($q$update marketplace.job_postings set pay_unit = 'per_ton' where id = %L$q$, j_legacy), '23514', 'job_postings_compensation_chk',
    'F2: half-stated pay (a basis without an amount) is refused');
  update marketplace.job_postings set pay_unit = 'per_ton', pay_amount_cents = 9200 where id = j_legacy;
  v_ts := marketplace.reactivate_job_posting(j_legacy, true);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'active' and last_confirmed_at = v_ts and last_confirmed_by = u_land and is_legacy_import
                      from marketplace.job_postings where id = j_legacy)
    and (select attested_by = u_land from marketplace.job_publication_attestations where job_id = j_legacy),
    'F2: with valid pay and an attestation the legacy posting returns, confirmed by the user');
  perform pg_temp.as_jwt('anon');
  perform pg_temp.ok(exists (select 1 from marketplace.get_marketplace_job(j_legacy) g where g.pay_amount_cents = 9200),
    'F2: the restored legacy posting is publicly visible with its stated pay');
  perform pg_temp.as_jwt('authenticated', 'p3_land');
  perform pg_temp.fails(format($q$update marketplace.job_postings set pay_unit = null, pay_amount_cents = null where id = %L$q$, j_legacy), '23514', 'positive pay rate',
    'F2: once attested under V2, a legacy posting is held to V2-DEC-02 (pay cannot be removed)');
  v_ts2 := marketplace.reconfirm_job_posting(j_legacy);
  perform pg_temp.ok(v_ts2 > v_ts, 'F2: a priced legacy posting reconfirms normally');

  -- -------------------------------------------------------------------------
  -- F5: founding-discount cycles are consumed only by new paid billing cycles
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('harness');
  insert into marketplace.promotions (code, program, state_code, percent_off, billing_cycles, max_redemptions, starts_at, status)
  values ('founding_or_p3', 'founding_landing', 'OR', 50.00, 6, 10, now() - interval '2 days', 'active');
  perform pg_temp.as_jwt('authenticated', 'p3_admin');
  perform marketplace.admin_set_org_verification(o_bill, 'verified', 'OR SOS registry check');
  perform marketplace.admin_set_org_verification(o_bill2, 'verified', 'OR SOS registry check');
  perform marketplace.admin_grant_founding_promotion('founding_or_p3', o_bill, 'Founding OR cohort');
  perform marketplace.admin_grant_founding_promotion('founding_or_p3', o_bill2, 'Founding OR cohort');

  -- Direct worker path: a period that starts inside the open period is a plan change, not a new cycle.
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_bill2, 'basic', 'active', t0, t0 + interval '30 days', 'cus_b2', 'sub_b2', false, 7, false);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select cycles_applied from marketplace.promotion_redemptions where org_id = o_bill2) = 1, 'F5: the first paid cycle consumes discount cycle 1');
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_bill2, 'pro', 'active', t0 + interval '10 days', t0 + interval '30 days', 'cus_b2', 'sub_b2', false, 7, false);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select cycles_applied from marketplace.promotion_redemptions where org_id = o_bill2) = 1,
    'F5: a mid-cycle upgrade (split of the open period) consumes no discount cycle');
  perform pg_temp.ok((select (marketplace.org_entitled_plan(o_bill2)).code) = 'pro', 'F5: ... and the upgrade takes effect');
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_bill2, 'pro', 'active', t0 + interval '30 days', t0 + interval '60 days', 'cus_b2', 'sub_b2', false, 7, false);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select cycles_applied from marketplace.promotion_redemptions where org_id = o_bill2) = 2, 'F5: the next renewal consumes discount cycle 2');
  perform pg_temp.as_jwt('service_role');
  perform pg_temp.fails(format($q$select marketplace.open_subscription_cycle(%L, 'pro', 'active', %L, %L, 'cus_b2', 'sub_b2', false, 7, false)$q$,
      o_bill2, t0, t0 + interval '30 days'),
    '23514', 'earlier billing period', 'R4: the direct worker RPC refuses to rewind a live subscription to an earlier period');

  -- -------------------------------------------------------------------------
  -- R4: provider events — idempotency, ordering, terminal states, audit
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('evt_p3_01', 'customer.subscription.created', t0 + interval '1 second', o_bill, 'sub_b1', 'basic', 'active',
                       t0, t0 + interval '30 days', 'subscription_create');
  perform pg_temp.ok(v_out = 'applied', 'R4: the first event for a provider subscription applies');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select cycles_applied from marketplace.promotion_redemptions where org_id = o_bill) = 0
    and (select (marketplace.org_entitled_plan(o_bill)).code) = 'basic',
    'R4/F5 (LE-02): the created subscription entitles Basic; creation alone consumes no discount cycle');
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('evt_p3_01p', 'invoice.paid', t0 + interval '2 seconds', o_bill, 'sub_b1', 'basic', 'active',
                       t0, t0 + interval '30 days', 'subscription_create');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_out = 'applied' and (select cycles_applied from marketplace.promotion_redemptions where org_id = o_bill) = 1,
    'R4/F5 (LE-02): the first invoice.paid consumes discount cycle 1');
  v_n := pg_temp.n('entitlement_periods');

  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('evt_p3_01', 'customer.subscription.created', t0 + interval '1 second', o_bill, 'sub_b1', 'basic', 'active',
                       t0, t0 + interval '30 days', 'subscription_create');
  perform pg_temp.ok(v_out = 'duplicate', 'R4: a redelivered event is a duplicate');
  v_out := pg_temp.evt('evt_p3_01', 'customer.subscription.created', t0 + interval '1 second', o_bill, 'sub_b1', 'pro', 'active',
                       t0, t0 + interval '30 days', 'subscription_create', false, 'tampered payload');
  perform pg_temp.ok(v_out = 'duplicate', 'R4: a redelivery of a processed id with a different payload is not applied');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select delivery_count = 3 and payload_conflict and outcome = 'applied' from marketplace.billing_provider_events where provider_event_id = 'evt_p3_01')
    and (select cycles_applied from marketplace.promotion_redemptions where org_id = o_bill) = 1
    and pg_temp.n('entitlement_periods') = v_n
    and (select (marketplace.org_entitled_plan(o_bill)).code) = 'basic',
    'R4: duplicates are counted and flagged, change no state, and never consume a discount cycle');

  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('evt_p3_02', 'customer.subscription.updated', t0 + interval '5 days', o_bill, 'sub_b1', 'pro', 'active',
                       t0, t0 + interval '30 days', 'subscription_update');
  perform pg_temp.ok(v_out = 'applied', 'R4: a mid-cycle upgrade within the current period applies');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select (marketplace.org_entitled_plan(o_bill)).code) = 'pro'
    and (select cycles_applied from marketplace.promotion_redemptions where org_id = o_bill) = 1,
    'F5: the upgrade preserves the remaining founding discount (still 1 of 6 consumed)');

  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('evt_p3_03', 'invoice.paid', t0 + interval '30 days', o_bill, 'sub_b1', 'pro', 'active',
                       t0 + interval '30 days', t0 + interval '60 days', 'subscription_cycle');
  perform pg_temp.ok(v_out = 'applied', 'R4: a renewal opening the next period applies');
  v_out := pg_temp.evt('evt_p3_02b', 'invoice.payment_failed', t0 + interval '10 days', o_bill, 'sub_b1', 'pro', 'past_due',
                       t0, t0 + interval '30 days');
  perform pg_temp.ok(v_out = 'ignored_stale', 'R4: a delayed event for the previous period is ignored after the renewal');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'active' and current_period_start = t0 + interval '30 days' from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_b1')
    and (select cycles_applied from marketplace.promotion_redemptions where org_id = o_bill) = 2
    and (select outcome_reason ~ 'earlier billing period' from marketplace.billing_provider_events where provider_event_id = 'evt_p3_02b'),
    'R4: renewal N+1 is never rewound by a late event for period N; discount cycle 2 consumed once');

  -- Payment failure and recovery within one period, with a late older event in between.
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('evt_p3_04', 'invoice.payment_failed', t0 + interval '40 days', o_bill, 'sub_b1', 'pro', 'past_due',
                       t0 + interval '30 days', t0 + interval '60 days');
  perform pg_temp.ok(v_out = 'applied', 'R4: a payment failure in the current period applies');
  v_out := pg_temp.evt('evt_p3_05', 'customer.subscription.updated', t0 + interval '35 days', o_bill, 'sub_b1', 'pro', 'active',
                       t0 + interval '30 days', t0 + interval '60 days');
  perform pg_temp.ok(v_out = 'ignored_stale', 'R4: an older event of the same period arriving late is ignored');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'past_due' and grace_ends_at is not null from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_b1'),
    'R4: the newer past_due state stands, with its grace window');
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('evt_p3_06', 'invoice.paid', t0 + interval '41 days', o_bill, 'sub_b1', 'pro', 'active',
                       t0 + interval '30 days', t0 + interval '60 days');
  perform pg_temp.ok(v_out = 'applied', 'R4: payment recovery applies');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'active' and past_due_since is null from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_b1')
    and (select cycles_applied from marketplace.promotion_redemptions where org_id = o_bill) = 2,
    'R4: recovery clears past_due and consumes no discount cycle');

  -- An exact tie between different states is not guessed.
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('evt_p3_07', 'invoice.payment_failed', t0 + interval '41 days', o_bill, 'sub_b1', 'pro', 'past_due',
                       t0 + interval '30 days', t0 + interval '60 days');
  perform pg_temp.ok(v_out = 'deferred_tie', 'R4: a different state with the same provider timestamp is deferred');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'active' and provider_sync_required from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_b1'),
    'R4: the deferred tie changes nothing and flags the subscription for reconciliation');
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('evt_p3_07', 'invoice.payment_failed', t0 + interval '41 days', o_bill, 'sub_b1', 'pro', 'past_due',
                       t0 + interval '30 days', t0 + interval '60 days');
  perform pg_temp.ok(v_out = 'duplicate', 'R4: a deferred event is final for its id (redelivery is a duplicate)');
  v_out := pg_temp.evt('recon_p3_01', 'logloads.reconciliation', t0 + interval '41 days', o_bill, 'sub_b1', 'pro', 'active',
                       t0 + interval '30 days', t0 + interval '60 days', null, false, null, true);
  perform pg_temp.ok(v_out = 'applied', 'R4: a reconciliation snapshot fetched from the provider resolves the tie');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'active' and not provider_sync_required from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_b1'),
    'R4: reconciliation clears the flag');

  -- Downgrade, scheduled cancellation, cancellation, and events after cancellation.
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('evt_p3_08', 'customer.subscription.updated', t0 + interval '45 days', o_bill, 'sub_b1', 'basic', 'active',
                       t0 + interval '30 days', t0 + interval '60 days', 'subscription_update');
  perform pg_temp.ok(v_out = 'applied', 'R4: a mid-cycle downgrade applies');
  v_out := pg_temp.evt('evt_p3_09', 'customer.subscription.updated', t0 + interval '50 days', o_bill, 'sub_b1', 'basic', 'active',
                       t0 + interval '30 days', t0 + interval '60 days', null, true);
  perform pg_temp.ok(v_out = 'applied', 'R4: scheduling cancellation at period end applies');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select plan_id = (select id from marketplace.subscription_plans where code = 'basic') and cancel_at_period_end
                      from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_b1')
    and (select cycles_applied from marketplace.promotion_redemptions where org_id = o_bill) = 2,
    'R4/F5: downgrade and cancel-at-period-end recorded; no discount cycle consumed');
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('evt_p3_10', 'customer.subscription.deleted', t0 + interval '60 days', o_bill, 'sub_b1', 'basic', 'canceled',
                       t0 + interval '30 days', t0 + interval '60 days');
  perform pg_temp.ok(v_out = 'applied', 'R4: cancellation applies');
  v_out := pg_temp.evt('evt_p3_11', 'invoice.paid', t0 + interval '59 days', o_bill, 'sub_b1', 'basic', 'active',
                       t0 + interval '60 days', t0 + interval '90 days', 'subscription_cycle');
  perform pg_temp.ok(v_out = 'ignored_terminal', 'R4: a delayed renewal after cancellation is ignored (cancellation is terminal)');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'canceled' from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_b1')
    and (marketplace.org_entitled_plan(o_bill)).id is null
    and (select cycles_applied from marketplace.promotion_redemptions where org_id = o_bill) = 2,
    'R4: the canceled subscription stays canceled; no entitlement and no discount cycle from the late event');

  -- Resubscription is a new provider subscription; events for other subscriptions never override it.
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('evt_p3_12', 'customer.subscription.created', t0 + interval '70 days', o_bill, 'sub_b1_new', 'basic', 'active',
                       t0 + interval '70 days', t0 + interval '100 days', 'subscription_create');
  perform pg_temp.ok(v_out = 'applied', 'R4: a resubscription (new provider subscription) applies');
  v_out := pg_temp.evt('evt_p3_12p', 'invoice.paid', t0 + interval '70 days' + interval '1 second', o_bill, 'sub_b1_new', 'basic', 'active',
                       t0 + interval '70 days', t0 + interval '100 days', 'subscription_create');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select cycles_applied from marketplace.promotion_redemptions where org_id = o_bill) = 3,
    'F5: the resubscription''s first paid cycle consumes the next discount cycle (3 of 6)');
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('evt_p3_13', 'customer.subscription.updated', t0 + interval '71 days', o_bill, 'sub_b1', 'pro', 'active',
                       t0 + interval '60 days', t0 + interval '90 days');
  perform pg_temp.ok(v_out = 'ignored_terminal', 'R4: an event for the old canceled subscription is ignored');
  v_out := pg_temp.evt('evt_p3_14', 'customer.subscription.created', t0 + interval '72 days', o_bill, 'sub_b1_rogue', 'pro', 'active',
                       t0 + interval '72 days', t0 + interval '102 days', 'subscription_create');
  perform pg_temp.ok(v_out = 'deferred_conflict', 'R4: a second live provider subscription is not applied over the current one');
  v_out := pg_temp.evt('evt_p3_15', 'customer.subscription.updated', t0 + interval '73 days', o_bill2, 'sub_b1_new', 'pro', 'active',
                       t0 + interval '70 days', t0 + interval '100 days');
  perform pg_temp.ok(v_out = 'rejected', 'R4: an event naming another organization for a known subscription is rejected');
  v_out := pg_temp.evt('evt_p3_16', 'customer.subscription.updated', t0 + interval '74 days', o_bill, 'sub_b1_new', 'platinum', 'active',
                       t0 + interval '70 days', t0 + interval '100 days');
  perform pg_temp.ok(v_out = 'failed', 'R4: an event that cannot be applied is recorded as failed, not lost');
  v_out := pg_temp.evt('evt_p3_16', 'customer.subscription.updated', t0 + interval '74 days', o_bill, 'sub_b1_new', 'platinum', 'active',
                       t0 + interval '70 days', t0 + interval '100 days');
  perform pg_temp.ok(v_out = 'failed', 'R4: a failed event is retried on redelivery (not treated as a duplicate)');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select plan_id = (select id from marketplace.subscription_plans where code = 'basic') and provider_sync_required
                      from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_b1_new')
    and (select delivery_count = 2 and outcome_reason ~ 'apply failed' from marketplace.billing_provider_events where provider_event_id = 'evt_p3_16')
    and not exists (select 1 from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_b1_rogue'),
    'R4: the live subscription is unchanged by the conflicting, rejected and failed events');

  -- Malformed input is refused outright and records nothing.
  perform pg_temp.as_jwt('service_role');
  v_n := pg_temp.n('billing_provider_events');
  perform pg_temp.fails(format($q$select * from marketplace.apply_billing_provider_event('stripe', 'evt_bad', 'invoice.paid', now(), %L, 'sub_b1_new', null,
      'basic', 'active', now(), now() + interval '30 days', false, null, 'not-a-digest')$q$, o_bill),
    '22023', 'SHA-256', 'R4: an event without a payload digest is refused');
  perform pg_temp.fails(format($q$select * from marketplace.apply_billing_provider_event('paypal', 'evt_bad2', 'invoice.paid', now(), %L, 'sub_b1_new', null,
      'basic', 'active', now(), now() + interval '30 days', false, null, repeat('a', 64))$q$, o_bill),
    '22023', 'unsupported billing provider', 'R4: an unknown provider is refused');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(pg_temp.n('billing_provider_events') = v_n, 'R4: refused input recorded nothing');

  -- Audit trail: every processed (non-duplicate) delivery has exactly one audit event.
  perform pg_temp.ok(
    (select count(*) from marketplace.billing_provider_events where org_id in (o_bill, o_bill2))
      + (select count(*) from marketplace.billing_provider_events where provider_event_id = 'evt_p3_16')  -- the retried failure
    = (select count(*) from marketplace.audit_events where action like 'billing.event\_%' and org_id in (o_bill, o_bill2)),
    'R4: one audit event per processed delivery (duplicates are counted on the ledger row instead)');

  -- Who can reach the billing surface.
  perform pg_temp.as_jwt('authenticated', 'p3_bill');
  perform pg_temp.fails(format($q$select * from marketplace.apply_billing_provider_event('stripe', 'evt_user', 'invoice.paid', now(), %L, 'sub_b1_new', null,
      'regional', 'active', now(), now() + interval '30 days', false, null, repeat('a', 64))$q$, o_bill),
    '42501', 'permission denied', 'R4: an authenticated user cannot submit provider events');
  perform pg_temp.fails('select count(*) from marketplace.billing_provider_events', '42501', 'permission denied',
    'R4: an authenticated user cannot read the provider event ledger');
  perform pg_temp.fails(format('select * from marketplace.admin_list_billing_provider_events(%L)', o_bill), '42501', 'billing or support admin',
    'R4: an organization owner cannot list provider events through the admin RPC');
  perform pg_temp.as_jwt('anon');
  perform pg_temp.fails(format($q$select * from marketplace.apply_billing_provider_event('stripe', 'evt_anon', 'invoice.paid', now(), %L, 'sub_b1_new', null,
      'regional', 'active', now(), now() + interval '30 days', false, null, repeat('a', 64))$q$, o_bill),
    '42501', 'permission denied', 'R4: anon cannot submit provider events');
  perform pg_temp.as_jwt('service_role');
  perform pg_temp.fails('select count(*) from marketplace.billing_provider_events', '42501', 'permission denied',
    'R4: service_role has no direct access to the ledger (it writes only through the RPC)');
  perform pg_temp.as_jwt('authenticated', 'p3_admin');
  perform pg_temp.ok((select count(*) from marketplace.admin_list_billing_provider_events(o_bill)) >= 15,
    'R4: a billing/support admin can review received events and their outcomes');

  -- -------------------------------------------------------------------------
  -- E-1: a replacement subscription deferred while the previous one was live is replayed when the
  -- previous one is canceled, exactly once; it never fails on the entitlement-period exclusion.
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 'p3_bill');
  o_bill3 := marketplace.create_organization('E1 Replacement Timber', 'e1-replacement', 'OR', false);
  o_bill4 := marketplace.create_organization('E1 Overlap Timber', 'e1-overlap', 'OR', false);
  o_bill5 := marketplace.create_organization('E1 Ambiguous Timber', 'e1-ambiguous', 'OR', false);
  perform pg_temp.as_jwt('service_role');

  -- Common case: the replacement starts inside the previous subscription's period.
  v_out := pg_temp.evt('e1_01', 'customer.subscription.created', t0, o_bill3, 'sub_e1_a', 'basic', 'active',
                       t0, t0 + interval '30 days', 'subscription_create');
  perform pg_temp.ok(v_out = 'applied', 'E-1: the first subscription applies');
  v_out := pg_temp.evt('e1_02', 'customer.subscription.created', t0 + interval '10 days', o_bill3, 'sub_e1_b', 'pro', 'active',
                       t0 + interval '10 days', t0 + interval '40 days', 'subscription_create');
  perform pg_temp.ok(v_out = 'deferred_conflict', 'E-1: a replacement arriving while the first is live is deferred');
  v_out := pg_temp.evt('e1_03', 'customer.subscription.deleted', t0 + interval '11 days', o_bill3, 'sub_e1_a', 'basic', 'canceled',
                       t0, t0 + interval '30 days');
  perform pg_temp.ok(v_out = 'applied', 'E-1: canceling the first subscription applies');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'active' and plan_id = (select id from marketplace.subscription_plans where code = 'pro')
                             and last_provider_event_id = 'e1_02' and not provider_sync_required
                      from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_e1_b')
    and ((marketplace.org_entitled_plan(o_bill3)).code = 'pro'),
    'E-1: the deferred replacement was applied when the first subscription ended (entitled to its plan)');
  perform pg_temp.ok((select outcome = 'applied' and outcome_reason ~ 'replayed' and subscription_id is not null
                      from marketplace.billing_provider_events where provider_event_id = 'e1_02')
    and (select outcome_reason ~ 'replayed deferred event e1_02' from marketplace.billing_provider_events where provider_event_id = 'e1_03')
    and (select count(*) = 1 from marketplace.audit_events where org_id = o_bill3 and action = 'billing.deferred_replayed'),
    'E-1: the ledger records the replay once, on the deferred event, and the cancellation names it');
  perform pg_temp.ok((select count(*) = 2 from marketplace.entitlement_periods where org_id = o_bill3)
    and not exists (select 1 from marketplace.entitlement_periods a join marketplace.entitlement_periods b
                    on a.org_id = b.org_id and a.id < b.id
                    and tstzrange(a.period_start, a.period_end, '[)') && tstzrange(b.period_start, b.period_end, '[)')
                    where a.org_id = o_bill3),
    'E-1: one allowance period per subscription, without overlap');
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('e1_02', 'customer.subscription.created', t0 + interval '10 days', o_bill3, 'sub_e1_b', 'pro', 'active',
                       t0 + interval '10 days', t0 + interval '40 days', 'subscription_create');
  perform pg_temp.ok(v_out = 'duplicate', 'E-1: a redelivery of the replayed event is a duplicate, not a second application');
  v_out := pg_temp.evt('e1_04', 'customer.subscription.updated', t0 + interval '12 days', o_bill3, 'sub_e1_b', 'pro', 'active',
                       t0 + interval '10 days', t0 + interval '40 days', null, true);
  perform pg_temp.ok(v_out = 'applied', 'E-1: later events of the replacement are ordered normally');

  -- Overlap case: the replacement's billing period starts before the previous subscription's period.
  v_out := pg_temp.evt('e1_11', 'customer.subscription.created', t0 + interval '5 days', o_bill4, 'sub_e1_c', 'basic', 'active',
                       t0 + interval '5 days', t0 + interval '35 days', 'subscription_create');
  perform pg_temp.ok(v_out = 'applied', 'E-1: the previous subscription applies');
  v_out := pg_temp.evt('e1_12', 'customer.subscription.created', t0 + interval '6 days', o_bill4, 'sub_e1_d', 'pro', 'active',
                       t0, t0 + interval '30 days', 'subscription_create');
  perform pg_temp.ok(v_out = 'deferred_conflict', 'E-1: an earlier-period replacement is deferred while the previous one is live');
  v_out := pg_temp.evt('e1_13', 'customer.subscription.deleted', t0 + interval '7 days', o_bill4, 'sub_e1_c', 'basic', 'canceled',
                       t0 + interval '5 days', t0 + interval '35 days');
  perform pg_temp.ok(v_out = 'applied', 'E-1: canceling the previous subscription applies (the replay cannot fail it)');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'active' from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_e1_d')
    and (select outcome = 'applied' from marketplace.billing_provider_events where provider_event_id = 'e1_12')
    and exists (select 1 from marketplace.audit_events where org_id = o_bill4 and action = 'subscription.period_overlap_skipped'),
    'E-1: the replacement is live; with no room for an allowance period this cycle, that is recorded instead of failing');
  perform pg_temp.ok(not exists (select 1 from marketplace.entitlement_periods ep join marketplace.organization_subscriptions s on s.id = ep.subscription_id
                                 where s.provider_subscription_ref = 'sub_e1_d'),
    'E-1: ... and no allowance period was opened for it in the covered cycle (fail closed)');
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('e1_14', 'invoice.paid', t0 + interval '30 days', o_bill4, 'sub_e1_d', 'pro', 'active',
                       t0 + interval '30 days', t0 + interval '60 days', 'subscription_cycle');
  perform pg_temp.ok(v_out = 'applied', 'E-1: the replacement''s renewal applies (no permanent exclusion failure)');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(exists (select 1 from marketplace.entitlement_periods ep join marketplace.organization_subscriptions s on s.id = ep.subscription_id
                             where s.provider_subscription_ref = 'sub_e1_d' and ep.period_start = t0 + interval '30 days'),
    'E-1: the renewal opened the replacement''s allowance period');

  -- Ambiguity is never guessed: two different pending replacements wait for reconciliation.
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('e1_21', 'customer.subscription.created', t0, o_bill5, 'sub_e1_e', 'basic', 'active',
                       t0, t0 + interval '30 days', 'subscription_create');
  v_out := pg_temp.evt('e1_22', 'customer.subscription.created', t0 + interval '2 days', o_bill5, 'sub_e1_f', 'pro', 'active',
                       t0 + interval '2 days', t0 + interval '32 days', 'subscription_create');
  v_out := pg_temp.evt('e1_23', 'customer.subscription.created', t0 + interval '3 days', o_bill5, 'sub_e1_g', 'regional', 'active',
                       t0 + interval '3 days', t0 + interval '33 days', 'subscription_create');
  v_out := pg_temp.evt('e1_24', 'customer.subscription.deleted', t0 + interval '4 days', o_bill5, 'sub_e1_e', 'basic', 'canceled',
                       t0, t0 + interval '30 days');
  perform pg_temp.ok(v_out = 'applied', 'E-1: the cancellation applies');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(not exists (select 1 from marketplace.organization_subscriptions where provider_subscription_ref in ('sub_e1_f', 'sub_e1_g'))
    and (select count(*) = 2 from marketplace.billing_provider_events where org_id = o_bill5 and outcome = 'deferred_conflict')
    and exists (select 1 from marketplace.audit_events where org_id = o_bill5 and action = 'billing.deferred_replay_ambiguous'),
    'E-1: two different pending replacements are left deferred for reconciliation, and that is recorded');
  perform pg_temp.as_jwt('authenticated', 'p3_admin');

  -- -------------------------------------------------------------------------
  -- H1 (second review): the replay never revives a replacement the provider canceled, one superseded by
  -- another subscription going live, an abandoned 'incomplete' one, or a snapshot whose period ended.
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 'p3_bill');
  o_bill6 := marketplace.create_organization('H1 Canceled Replacement', 'h1-canceled', 'OR', false);
  o_bill7 := marketplace.create_organization('H1 Superseded Replacement', 'h1-superseded', 'OR', false);
  o_bill8 := marketplace.create_organization('H1 Incomplete Replacement', 'h1-incomplete', 'OR', false);
  o_bill9 := marketplace.create_organization('H1 Snapshots', 'h1-snapshots', 'OR', false);
  perform pg_temp.as_jwt('service_role');

  -- (a) A replacement canceled while deferred stays dead, and the organization is not locked out.
  v_out := pg_temp.evt('h1_01', 'customer.subscription.created', t0, o_bill6, 'sub_h1_a', 'basic', 'active',
                       t0, t0 + interval '30 days', 'subscription_create');
  v_out := pg_temp.evt('h1_02', 'customer.subscription.created', t0 + interval '5 days', o_bill6, 'sub_h1_r', 'pro', 'active',
                       t0 + interval '5 days', t0 + interval '35 days', 'subscription_create');
  perform pg_temp.ok(v_out = 'deferred_conflict', 'H1: the replacement is deferred while the first subscription is live');
  v_out := pg_temp.evt('h1_03', 'customer.subscription.deleted', t0 + interval '6 days', o_bill6, 'sub_h1_r', 'pro', 'canceled',
                       t0 + interval '5 days', t0 + interval '35 days');
  perform pg_temp.ok(v_out = 'ignored_superseded', 'H1: the replacement''s cancellation arrives while it is deferred');
  v_out := pg_temp.evt('h1_04', 'customer.subscription.deleted', t0 + interval '7 days', o_bill6, 'sub_h1_a', 'basic', 'canceled',
                       t0, t0 + interval '30 days');
  perform pg_temp.ok(v_out = 'applied', 'H1: canceling the first subscription applies');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(not exists (select 1 from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_h1_r')
    and (select outcome = 'ignored_terminal' from marketplace.billing_provider_events where provider_event_id = 'h1_02')
    and (marketplace.org_entitled_plan(o_bill6)).id is null,
    'H1: a replacement the provider canceled is not brought back (its deferred event is terminal; no entitlement)');
  perform pg_temp.ok(exists (select 1 from marketplace.audit_events where org_id = o_bill6 and action = 'billing.deferred_terminal'),
    'H1: closing a canceled replacement''s deferred events is audited');
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('h1_05', 'customer.subscription.created', t0 + interval '8 days', o_bill6, 'sub_h1_t', 'pro', 'active',
                       t0 + interval '8 days', t0 + interval '38 days', 'subscription_create');
  perform pg_temp.ok(v_out = 'applied', 'H1: a later real subscription applies (no lock-out)');

  -- (b) A reconciliation that picks one of two pending replacements supersedes the other for good.
  v_out := pg_temp.evt('h1_11', 'customer.subscription.created', t0, o_bill7, 'sub_h1_s', 'basic', 'active',
                       t0, t0 + interval '30 days', 'subscription_create');
  v_out := pg_temp.evt('h1_12', 'customer.subscription.created', t0 + interval '2 days', o_bill7, 'sub_h1_b', 'pro', 'active',
                       t0 + interval '2 days', t0 + interval '32 days', 'subscription_create');
  v_out := pg_temp.evt('h1_13', 'customer.subscription.created', t0 + interval '3 days', o_bill7, 'sub_h1_c', 'regional', 'active',
                       t0 + interval '3 days', t0 + interval '33 days', 'subscription_create');
  v_out := pg_temp.evt('h1_14', 'customer.subscription.deleted', t0 + interval '4 days', o_bill7, 'sub_h1_s', 'basic', 'canceled',
                       t0, t0 + interval '30 days');
  v_out := pg_temp.evt('h1_15', 'logloads.reconciliation', t0 + interval '5 days', o_bill7, 'sub_h1_c', 'regional', 'active',
                       t0 + interval '3 days', t0 + interval '33 days', null, false, null, true);
  perform pg_temp.ok(v_out = 'applied', 'H1: reconciliation applies one of the two pending replacements');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select outcome = 'deferred_conflict' from marketplace.billing_provider_events where provider_event_id = 'h1_12')
    and (select outcome = 'ignored_stale' from marketplace.billing_provider_events where provider_event_id = 'h1_13')
    and (select provider_sync_required from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_h1_c'),
    'H1: reconciling one subscription is no evidence about the other: it stays pending and the live one is flagged');
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('h1_16', 'customer.subscription.deleted', t0 + interval '6 days', o_bill7, 'sub_h1_c', 'regional', 'canceled',
                       t0 + interval '3 days', t0 + interval '33 days');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_out = 'applied'
    and (select status = 'active' from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_h1_b')
    and ((marketplace.org_entitled_plan(o_bill7)).code = 'pro'),
    'H1: when the reconciled subscription ends, the still-pending one (current period, no cancel) is replayed');

  -- (c) An 'incomplete' replacement is not replayed (it may be abandoned); its own next event applies it.
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('h1_21', 'customer.subscription.created', t0, o_bill8, 'sub_h1_i0', 'basic', 'active',
                       t0, t0 + interval '30 days', 'subscription_create');
  v_out := pg_temp.evt('h1_22', 'customer.subscription.created', t0 + interval '2 days', o_bill8, 'sub_h1_i', 'pro', 'incomplete',
                       t0 + interval '2 days', t0 + interval '32 days', 'subscription_create');
  v_out := pg_temp.evt('h1_23', 'customer.subscription.deleted', t0 + interval '3 days', o_bill8, 'sub_h1_i0', 'basic', 'canceled',
                       t0, t0 + interval '30 days');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(not exists (select 1 from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_h1_i')
    and (select outcome = 'deferred_conflict' from marketplace.billing_provider_events where provider_event_id = 'h1_22'),
    'H1: an incomplete replacement is not replayed into a live subscription');
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('h1_24', 'customer.subscription.updated', t0 + interval '4 days', o_bill8, 'sub_h1_i', 'pro', 'active',
                       t0 + interval '2 days', t0 + interval '32 days', 'subscription_update');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_out = 'applied'
    and (select outcome = 'ignored_stale' from marketplace.billing_provider_events where provider_event_id = 'h1_22'),
    'H1: ... its own next event applies it, and the incomplete snapshot is then stale');

  -- (d) Several snapshots of one replacement: the latest is replayed as a creation; an expired one is stale.
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('h1_31', 'customer.subscription.created', t0, o_bill9, 'sub_h1_d0', 'basic', 'active',
                       t0, t0 + interval '30 days', 'subscription_create');
  v_out := pg_temp.evt('h1_32', 'customer.subscription.created', t0 + interval '1 day', o_bill9, 'sub_h1_d', 'basic', 'active',
                       t0 + interval '1 day', t0 + interval '31 days', 'subscription_create');
  v_out := pg_temp.evt('h1_33', 'customer.subscription.updated', t0 + interval '2 days', o_bill9, 'sub_h1_d', 'pro', 'active',
                       t0 + interval '1 day', t0 + interval '31 days', 'subscription_update');
  v_out := pg_temp.evt('h1_35', 'customer.subscription.created', t0 + interval '36 hours', o_bill9, 'sub_h1_x', 'basic', 'active',
                       t0 - interval '60 days', t0 - interval '30 days', 'subscription_create');
  perform pg_temp.ok(v_out = 'deferred_conflict', 'H1 setup: an expired snapshot of another subscription is also deferred');
  v_out := pg_temp.evt('h1_34', 'customer.subscription.deleted', t0 + interval '3 days', o_bill9, 'sub_h1_d0', 'basic', 'canceled',
                       t0, t0 + interval '30 days');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select p.code = 'pro' and s.status = 'active' and s.last_provider_event_id = 'h1_33'
                      from marketplace.organization_subscriptions s join marketplace.subscription_plans p on p.id = s.plan_id
                      where s.provider_subscription_ref = 'sub_h1_d')
    and (select outcome = 'ignored_stale' from marketplace.billing_provider_events where provider_event_id = 'h1_32')
    and (select outcome = 'ignored_stale' from marketplace.billing_provider_events where provider_event_id = 'h1_35')
    and not exists (select 1 from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_h1_x'),
    'H1: the latest snapshot is replayed, older ones are stale, and a snapshot whose period ended is never applied');
  perform pg_temp.ok(exists (select 1 from marketplace.audit_events where org_id = o_bill9 and action = 'billing.deferred_expired'),
    'H1: closing an expired deferred snapshot is audited');
  perform pg_temp.ok((select metadata ->> 'billing_reason' = 'subscription_create'
                      from marketplace.audit_events
                      where org_id = o_bill9 and action = 'subscription.cycle_opened'
                      order by id desc limit 1),
    'H1/L2: a replayed subscription''s first cycle is opened as a creation, whatever the latest snapshot''s reason');

  -- (e) Third review: a ROUTINE first event of one pending replacement does not discard another the
  -- customer may be keeping; it flags reconciliation, and the other stays replayable.
  perform pg_temp.as_jwt('authenticated', 'p3_bill');
  o_bill10 := marketplace.create_organization('H1 Double Subscription', 'h1-double', 'OR', false);
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('h1_41', 'customer.subscription.created', t0, o_bill10, 'sub_h1_o', 'basic', 'active',
                       t0, t0 + interval '30 days', 'subscription_create');
  v_out := pg_temp.evt('h1_42', 'customer.subscription.created', t0 + interval '2 days', o_bill10, 'sub_h1_b2', 'pro', 'active',
                       t0 + interval '2 days', t0 + interval '32 days', 'subscription_create');
  v_out := pg_temp.evt('h1_43', 'customer.subscription.created', t0 + interval '3 days', o_bill10, 'sub_h1_c2', 'regional', 'active',
                       t0 + interval '3 days', t0 + interval '33 days', 'subscription_create');
  v_out := pg_temp.evt('h1_44', 'customer.subscription.deleted', t0 + interval '4 days', o_bill10, 'sub_h1_o', 'basic', 'canceled',
                       t0, t0 + interval '30 days');
  v_out := pg_temp.evt('h1_45', 'customer.subscription.updated', t0 + interval '5 days', o_bill10, 'sub_h1_b2', 'pro', 'active',
                       t0 + interval '2 days', t0 + interval '32 days', 'subscription_update');
  perform pg_temp.ok(v_out = 'applied', 'H1(e): a routine event applies one of two pending replacements');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select outcome = 'deferred_conflict' from marketplace.billing_provider_events where provider_event_id = 'h1_43')
    and (select outcome = 'ignored_stale' from marketplace.billing_provider_events where provider_event_id = 'h1_42')
    and (select provider_sync_required from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_h1_b2'),
    'H1(e): the other replacement is NOT discarded; the live one is flagged for reconciliation');
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('h1_46', 'customer.subscription.deleted', t0 + interval '6 days', o_bill10, 'sub_h1_b2', 'pro', 'canceled',
                       t0 + interval '2 days', t0 + interval '32 days');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_out = 'applied'
    and (select status = 'active' from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_h1_c2')
    and (select outcome = 'applied' from marketplace.billing_provider_events where provider_event_id = 'h1_43')
    and ((marketplace.org_entitled_plan(o_bill10)).code = 'regional'),
    'H1(e): when the customer cancels that one and keeps the other, the other is replayed (entitled)');
  perform pg_temp.as_jwt('authenticated', 'p3_admin');
  perform pg_temp.as_jwt('authenticated', 'p3_admin');

  -- -------------------------------------------------------------------------
  -- E-3: a manually administered subscription is never overwritten by a routine provider event.
  -- E-4: a failed event is retried only with its original payload.
  -- E-5: different-payload duplicates are audited; Stripe statuses without an internal state are recorded.
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 'p3_bill');
  o_e3 := marketplace.create_organization('E3 Manual Subscription', 'e3-manual', 'OR', false);
  o_e4 := marketplace.create_organization('E4 Payload Discipline', 'e4-payload', 'OR', false);
  o_e5 := marketplace.create_organization('E5 Provider Statuses', 'e5-statuses', 'OR', false);
  perform pg_temp.as_jwt('service_role');

  -- E-3
  perform marketplace.open_subscription_cycle(o_e3, 'pro', 'active', t0, t0 + interval '30 days', null, null, false, 7, false);
  v_out := pg_temp.evt('e3_01', 'customer.subscription.deleted', t0 + interval '1 day', o_e3, 'sub_e3_x', 'basic', 'canceled',
                       t0, t0 + interval '30 days');
  perform pg_temp.ok(v_out = 'ignored_superseded', 'E-3: a cancel of an unrelated provider subscription does not cancel the manual subscription');
  v_out := pg_temp.evt('e3_02', 'customer.subscription.created', t0 + interval '2 days', o_e3, 'sub_e3_y', 'basic', 'active',
                       t0 + interval '2 days', t0 + interval '32 days', 'subscription_create');
  perform pg_temp.ok(v_out = 'deferred_conflict', 'E-3: a routine provider event does not take over the manual subscription');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select s.status = 'active' and p.code = 'pro' and s.provider_subscription_ref is null and s.provider_sync_required
                      from marketplace.organization_subscriptions s join marketplace.subscription_plans p on p.id = s.plan_id
                      where s.org_id = o_e3 and s.status <> 'canceled'),
    'E-3: ... the manual subscription is unchanged and flagged for reconciliation');
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('e3_03', 'logloads.reconciliation', t0 + interval '3 days', o_e3, 'sub_e3_y', 'basic', 'active',
                       t0 + interval '2 days', t0 + interval '32 days', null, false, null, true);
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_out = 'applied'
    and (select s.provider_subscription_ref = 'sub_e3_y' and p.code = 'basic'
         from marketplace.organization_subscriptions s join marketplace.subscription_plans p on p.id = s.plan_id
         where s.org_id = o_e3 and s.status <> 'canceled'),
    'E-3: a reconciliation snapshot lets the provider subscription take over');
  perform pg_temp.as_jwt('authenticated', 'p3_bill');
  o_e3b := marketplace.create_organization('E3 Lapsed Manual', 'e3-lapsed-manual', 'OR', false);
  perform pg_temp.as_jwt('service_role');
  perform marketplace.open_subscription_cycle(o_e3b, 'pro', 'active', now() - interval '40 days', now() - interval '10 days', null, null, false, 7, false);
  v_out := pg_temp.evt('e3b_01', 'customer.subscription.created', t0, o_e3b, 'sub_e3b', 'basic', 'active',
                       t0, t0 + interval '30 days', 'subscription_create');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_out = 'applied'
    and (select count(*) = 1 from marketplace.organization_subscriptions where org_id = o_e3b and status <> 'canceled' and provider_subscription_ref = 'sub_e3b')
    and (select count(*) = 1 from marketplace.organization_subscriptions where org_id = o_e3b and status = 'canceled' and provider_subscription_ref is null)
    and exists (select 1 from marketplace.audit_events where org_id = o_e3b and action = 'subscription.manual_superseded')
    and ((marketplace.org_entitled_plan(o_e3b)).code = 'basic'),
    'E-3 (final review): a lapsed manual subscription hands over to a paying provider subscription (audited)');

  -- E-4
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('e4_01', 'customer.subscription.created', t0, o_e4, 'sub_e4', 'platinum', 'active',
                       t0, t0 + interval '30 days', 'subscription_create');
  perform pg_temp.ok(v_out = 'failed', 'E-4 setup: an event that cannot be applied is recorded as failed');
  v_out := pg_temp.evt('e4_01', 'customer.subscription.created', t0, o_e4, 'sub_e4', 'basic', 'active',
                       t0, t0 + interval '30 days', 'subscription_create', false, 'a different payload');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_out = 'rejected'
    and not exists (select 1 from marketplace.organization_subscriptions where org_id = o_e4)
    and (select outcome = 'failed' and payload_conflict from marketplace.billing_provider_events where provider_event_id = 'e4_01'),
    'E-4: a failed event redelivered with a different payload is not applied (it stays failed and is flagged)');
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('e4_01', 'customer.subscription.created', t0, o_e4, 'sub_e4', 'platinum', 'active',
                       t0, t0 + interval '30 days', 'subscription_create');
  perform pg_temp.ok(v_out = 'failed', 'E-4: ... and is still retried with its original payload');

  -- E-5: different-payload duplicate is audited.
  v_out := pg_temp.evt('e5_01', 'customer.subscription.created', t0, o_e5, 'sub_e5', 'basic', 'incomplete',
                       t0, t0 + interval '30 days', 'subscription_create');
  perform pg_temp.ok(v_out = 'applied', 'E-5 setup: an incomplete first event applies');
  v_out := pg_temp.evt('e5_01', 'customer.subscription.created', t0, o_e5, 'sub_e5', 'basic', 'incomplete',
                       t0, t0 + interval '30 days', 'subscription_create', false, 'tampered');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_out = 'duplicate'
    and exists (select 1 from marketplace.audit_events a join marketplace.billing_provider_events e on e.id = a.entity_id
                where a.action = 'billing.payload_conflict' and e.provider_event_id = 'e5_01'),
    'E-5: a duplicate with a different payload is audited');

  -- E-5: incomplete_expired is recorded with the provider's status and is terminal.
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('e5_02', 'customer.subscription.updated', t0 + interval '1 day', o_e5, 'sub_e5', 'basic', 'incomplete_expired',
                       t0, t0 + interval '30 days');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_out = 'applied'
    and (select status = 'canceled' from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_e5')
    and (select subscription_status = 'incomplete_expired' from marketplace.billing_provider_events where provider_event_id = 'e5_02'),
    'E-5: incomplete_expired is recorded as such and ends the subscription (no longer refused with no record)');
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('e5_03', 'customer.subscription.created', t0 + interval '2 days', o_e5, 'sub_e5_b', 'pro', 'active',
                       t0 + interval '2 days', t0 + interval '32 days', 'subscription_create');
  perform pg_temp.ok(v_out = 'applied', 'E-5: an expired incomplete subscription does not block a new one');

  -- E-5: unpaid / paused are recorded and flagged, not applied (F7 pending).
  v_out := pg_temp.evt('e5_04', 'customer.subscription.updated', t0 + interval '3 days', o_e5, 'sub_e5_b', 'pro', 'unpaid',
                       t0 + interval '2 days', t0 + interval '32 days');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_out = 'applied'
    and (select status = 'unpaid' from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_e5_b')
    and (marketplace.org_entitled_plan(o_e5)).id is null
    and (select subscription_status = 'unpaid' from marketplace.billing_provider_events where provider_event_id = 'e5_04'),
    'E-5/F7 (LE-04): unpaid is recorded and applied as a non-entitling status');
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('e5_05', 'customer.subscription.updated', t0 + interval '4 days', o_e5, 'sub_e5_b', 'pro', 'paused',
                       t0 + interval '2 days', t0 + interval '32 days');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_out = 'applied' and (select status = 'paused' from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_e5_b')
    and (marketplace.org_entitled_plan(o_e5)).id is null,
    'F7 (LE-04): paused is applied and suspends the paid entitlement');
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('e5_06', 'invoice.paid', t0 + interval '5 days', o_e5, 'sub_e5_b', 'pro', 'active',
                       t0 + interval '2 days', t0 + interval '32 days');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_out = 'applied' and ((marketplace.org_entitled_plan(o_e5)).code = 'pro'),
    'F7 (LE-04): payment restores the entitlement');

  -- -------------------------------------------------------------------------
  -- E-2 / F5 (LE-02): a founding-discount cycle is consumed once per billing period, on payment evidence.
  -- -------------------------------------------------------------------------
  perform pg_temp.as_jwt('authenticated', 'p3_bill');
  o_e2 := marketplace.create_organization('E2 Paid Cycles', 'e2-paid-cycles', 'OR', false);
  perform pg_temp.as_jwt('authenticated', 'p3_admin');
  perform marketplace.admin_set_org_verification(o_e2, 'verified', 'OR SOS registry check');
  perform marketplace.admin_grant_founding_promotion('founding_or_p3', o_e2, 'Founding OR cohort');
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('e2_01', 'customer.subscription.created', t0, o_e2, 'sub_e2', 'basic', 'active',
                       t0, t0 + interval '30 days', 'subscription_create');
  v_out := pg_temp.evt('e2_02', 'customer.subscription.updated', t0 + interval '30 days', o_e2, 'sub_e2', 'basic', 'active',
                       t0 + interval '30 days', t0 + interval '60 days', 'subscription_cycle');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select cycles_applied from marketplace.promotion_redemptions where org_id = o_e2) = 0,
    'E-2: neither creation nor an unpaid renewal consumes a discount cycle');
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('e2_03', 'invoice.payment_failed', t0 + interval '31 days', o_e2, 'sub_e2', 'basic', 'past_due',
                       t0 + interval '30 days', t0 + interval '60 days');
  v_out := pg_temp.evt('e2_04', 'invoice.paid', t0 + interval '33 days', o_e2, 'sub_e2', 'basic', 'active',
                       t0 + interval '30 days', t0 + interval '60 days');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select cycles_applied from marketplace.promotion_redemptions where org_id = o_e2) = 1,
    'E-2: a period that started past_due counts once it is paid');
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('e2_05', 'invoice.paid', t0 + interval '34 days', o_e2, 'sub_e2', 'basic', 'active',
                       t0 + interval '30 days', t0 + interval '60 days');
  v_out := pg_temp.evt('e2_06', 'invoice.payment_succeeded', t0 + interval '29 days', o_e2, 'sub_e2', 'basic', 'active',
                       t0, t0 + interval '30 days');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_out = 'ignored_stale'
    and (select cycles_applied = 2 and cardinality(counted_period_ends) = 2 from marketplace.promotion_redemptions where org_id = o_e2),
    'E-2: a second payment event for a counted period does not count again; a late payment for the earlier period still counts');
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('e2_07', 'invoice.paid', t0 + interval '60 days', o_e2, 'sub_e2', 'pro', 'active',
                       t0 + interval '60 days', t0 + interval '90 days', 'subscription_update');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok(v_out = 'applied' and (select cycles_applied = 2 from marketplace.promotion_redemptions where org_id = o_e2),
    'E-2 (final review): a plan-change payment that starts a new period is not a new founding cycle');

  -- M5: a payment that was deferred and applied later (replay) still counts.
  perform pg_temp.as_jwt('authenticated', 'p3_bill');
  o_e2b := marketplace.create_organization('E2 Deferred Payment', 'e2-deferred-payment', 'OR', false);
  perform pg_temp.as_jwt('authenticated', 'p3_admin');
  perform marketplace.admin_set_org_verification(o_e2b, 'verified', 'OR SOS registry check');
  perform marketplace.admin_grant_founding_promotion('founding_or_p3', o_e2b, 'Founding OR cohort');
  perform pg_temp.as_jwt('service_role');
  v_out := pg_temp.evt('e2b_01', 'customer.subscription.created', t0, o_e2b, 'sub_e2b_s', 'basic', 'active',
                       t0, t0 + interval '30 days', 'subscription_create');
  v_out := pg_temp.evt('e2b_02', 'customer.subscription.created', t0 + interval '2 days', o_e2b, 'sub_e2b_r', 'pro', 'active',
                       t0 + interval '2 days', t0 + interval '32 days', 'subscription_create');
  v_out := pg_temp.evt('e2b_03', 'invoice.paid', t0 + interval '3 days', o_e2b, 'sub_e2b_r', 'pro', 'active',
                       t0 + interval '2 days', t0 + interval '32 days', 'subscription_create');
  perform pg_temp.ok(v_out = 'deferred_conflict', 'E-2 setup: the replacement''s payment is deferred while the first subscription is live');
  v_out := pg_temp.evt('e2b_04', 'customer.subscription.deleted', t0 + interval '4 days', o_e2b, 'sub_e2b_s', 'basic', 'canceled',
                       t0, t0 + interval '30 days');
  perform pg_temp.as_jwt('harness');
  perform pg_temp.ok((select status = 'active' from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_e2b_r')
    and (select cycles_applied = 1 from marketplace.promotion_redemptions where org_id = o_e2b),
    'E-2 (final review): a deferred payment counts once the replacement is applied by the replay');
  perform pg_temp.as_jwt('authenticated', 'p3_admin');

  raise notice 'ALL PHASE 3 POLICY (F1-F5) AND BILLING-ORDERING TESTS PASSED.';
end
$$;

rollback;
