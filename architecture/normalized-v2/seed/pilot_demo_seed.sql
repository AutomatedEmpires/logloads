-- =============================================================================
-- LogLoads normalized-v2 — synthetic pilot demo seed (#200)
--
-- SYNTHETIC DATA ONLY. Disposable databases and the staging project; never production. Every person, business,
-- landing, job and phone number here is invented, mirrors packages/db/src/seed-data.ts, and must never be presented
-- as real activity. Load it with the owner tool, which applies the guards first:
--
--   node tools/normalized-store.mjs seed --expected-project-ref <ref> --apply
--
-- (it runs: psql -X -v ON_ERROR_STOP=1 --single-transaction -v issuer=<issuer> -v audience=<audience> -f <this file>)
--
-- Requires the full migration chain (01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23) and an EMPTY marketplace
-- store: it refuses, with nothing changed, when any organization exists or the seed was loaded before. It runs as
-- the migration role in ONE transaction, and checks its own result before it commits.
--
-- Ids. People, businesses, memberships, landings and jobs keep the pilot seed's ids, and each person is linked to
-- their pilot Clerk user id under the adapter's issuer (`identity_links`). The V2 pages pass the pilot session's
-- organization id and Clerk user id, so the normalized adapter resolves the same people and businesses the pilot
-- store does. Equipment units and availability reports get new ids (nothing correlates on them).
--
-- How each record is written:
--   * people, businesses, memberships, landings and job drafts: inserted by the migration role with the pilot ids,
--     under every trigger the schema installs (membership acceptance, seat and plan rules, coordinate snapping);
--   * contacts: marketplace.sync_verified_identity, as service_role;
--   * plans: marketplace.open_subscription_cycle, as service_role;
--   * private landing details, equipment, availability and public discovery consent: as a member of that business,
--     through row-level security and the column grants;
--   * jobs: marketplace.publish_job_posting (attested, as the landing desk), then set_job_posting_status for the
--     filled and closed ones.
--
-- Contents (for the V2 pages and the DS-05 cases, apps/web/tests/design-system.spec.ts):
--   North Pine Logging     landing desk + hauling business; Oak Landing; open jobs "Oak saw-log morning run" and
--                          "Oak chip shuttle", closed "Oak recovery load"; trucks listed. Dana Dispatch (staff, landing
--                          seat), Lee Loader (manager), drivers Hank Hauler, Maya Mills, Riley Rivers.
--   Summit Ridge Timber    landing business; Blue River Landing; open "Blue River high-grade campaign", filled "Blue
--                          River pulp contingency". Cole Cedar (owner), Dana Dispatch (staff), driver Taylor Timber.
--   New River Hauling      hauling business with no trucks listed. Morgan Newfleet (owner).
--   Granite Creek Hauling  hauling business, public profile, two "Log truck + Bunk / short-log" units and one
--                          "Log truck + Pole trailer", one availability report. Avery Granite (owner).
-- No inquiry is seeded, as in the pilot seed: DS-05 sends New River Hauling's interest itself.
-- Dates are relative to the day the seed runs.
-- =============================================================================

\set ON_ERROR_STOP on
-- The labels below contain a middle dot; read this file as UTF-8 whatever the client's locale.
\encoding UTF8

\if :{?issuer}
\else
  \set issuer ''
\endif
\if :{?audience}
\else
  \set audience ''
\endif

-- Transaction-local settings, read by the blocks below (psql variables do not reach inside DO bodies).
select set_config('logloads_seed.issuer', :'issuer', true) as seed_issuer,
       set_config('logloads_seed.audience', :'audience', true) as seed_audience,
       set_config('logloads_seed.xact', txid_current()::text, true) as seed_xact \gset

-- -----------------------------------------------------------------------------
-- 0. Preconditions. Nothing is written until every one holds.
-- -----------------------------------------------------------------------------
do $$
declare
  v_iss    text := current_setting('logloads_seed.issuer', true);
  v_aud    text := current_setting('logloads_seed.audience', true);
  v_ledger text;
  v_row    record;
begin
  -- One transaction (psql --single-transaction): in autocommit the setting above is already gone.
  if coalesce(current_setting('logloads_seed.xact', true), '') <> txid_current()::text then
    raise exception 'the seed must be loaded in one transaction (psql --single-transaction); nothing was changed'
      using errcode = '25P01';
  end if;
  if char_length(coalesce(v_iss, '')) not between 8 and 300 or char_length(coalesce(v_aud, '')) not between 1 and 200 then
    raise exception 'the seed needs -v issuer=<issuer> (8 to 300 characters) and -v audience=<audience> (1 to 200)'
      using errcode = '22023',
            hint = 'They are LOGLOADS_NORMALIZED_IDENTITY_ISSUER and LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE; tools/normalized-store.mjs passes them.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('marketplace.seed', 0));

  if to_regclass('marketplace.schema_migrations') is null then
    raise exception 'the seed needs the normalized schema: apply the migration chain first' using errcode = '55000';
  end if;
  select string_agg(version, ',' order by applied_at, version) into v_ledger from marketplace.schema_migrations;
  if v_ledger is distinct from '06,11,12,16,18,23,26,29' then
    raise exception 'the seed is written for the migration ledger 06,11,12,16,18,23,26,29; this database records %', coalesce(v_ledger, '(nothing)')
      using errcode = '55000';
  end if;

  if exists (select 1 from marketplace.audit_events where action = 'seed.pilot_demo_loaded') then
    raise exception 'the pilot demo seed is already loaded; nothing was changed' using errcode = '55000';
  end if;
  if exists (select 1 from marketplace.organizations) then
    raise exception 'the seed loads only into an empty marketplace store; this one holds % organization(s). Nothing was changed',
      (select count(*) from marketplace.organizations)
      using errcode = '55000';
  end if;
  if exists (select 1 from marketplace.app_users where id in (
       '22222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222223',
       '22222222-2222-4222-8222-222222222224', '22222222-2222-4222-8222-222222222225', '22222222-2222-4222-8222-222222222226',
       '22222222-2222-4222-8222-222222222227', '22222222-2222-4222-8222-222222222228', '22222222-2222-4222-8222-222222222231'))
     or exists (select 1 from marketplace.identity_links where issuer = v_iss and subject like 'clerk-%') then
    raise exception 'a seeded person or identity link already exists; nothing was changed' using errcode = '55000';
  end if;

  -- The adapter's issuer: registered by `tools/normalized-store.mjs schema`, or here when absent.
  insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
  values (v_iss, 'LogLoads web server (normalized adapter)', v_aud, true)
  on conflict (issuer) do nothing;
  select i.enabled, i.expected_audience into v_row from marketplace.trusted_identity_issuers i where i.issuer = v_iss;
  if not coalesce(v_row.enabled, false) or v_row.expected_audience is distinct from v_aud then
    raise exception 'the trusted issuer row for the seed issuer is disabled or pins another audience; nothing was changed'
      using errcode = '55000';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 1. People (pilot ids), their Clerk links, and verified contacts.
-- -----------------------------------------------------------------------------
insert into marketplace.app_users (id, display_name) values
  ('22222222-2222-4222-8222-222222222221', 'Hank Hauler'),
  ('22222222-2222-4222-8222-222222222222', 'Maya Mills'),
  ('22222222-2222-4222-8222-222222222223', 'Cole Cedar'),
  ('22222222-2222-4222-8222-222222222224', 'Dana Dispatch'),
  ('22222222-2222-4222-8222-222222222225', 'Lee Loader'),
  ('22222222-2222-4222-8222-222222222226', 'Riley Rivers'),
  ('22222222-2222-4222-8222-222222222227', 'Morgan Newfleet'),
  ('22222222-2222-4222-8222-222222222228', 'Taylor Timber'),
  ('22222222-2222-4222-8222-222222222231', 'Avery Granite');

insert into marketplace.identity_links (issuer, subject, user_id)
select current_setting('logloads_seed.issuer'), p.subject, p.user_id::uuid
from (values
  ('clerk-driver-1', '22222222-2222-4222-8222-222222222221'),
  ('clerk-driver-2', '22222222-2222-4222-8222-222222222222'),
  ('clerk-driver-3', '22222222-2222-4222-8222-222222222223'),
  ('clerk-dispatch-1', '22222222-2222-4222-8222-222222222224'),
  ('clerk-loader-1', '22222222-2222-4222-8222-222222222225'),
  ('clerk-driver-4', '22222222-2222-4222-8222-222222222226'),
  ('clerk-empty-fleet-1', '22222222-2222-4222-8222-222222222227'),
  ('clerk-driver-5', '22222222-2222-4222-8222-222222222228'),
  ('clerk-equipped-fleet-1', '22222222-2222-4222-8222-222222222231')
) as p(subject, user_id);

do $$
declare
  v_iss text := current_setting('logloads_seed.issuer');
  r     record;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  for r in
    select * from (values
      ('clerk-driver-1', 'Hank Hauler', 'hank@northpine.example'),
      ('clerk-driver-2', 'Maya Mills', 'maya@northpine.example'),
      ('clerk-driver-3', 'Cole Cedar', 'cole@summit.example'),
      ('clerk-dispatch-1', 'Dana Dispatch', 'dispatch@northpine.example'),
      ('clerk-loader-1', 'Lee Loader', 'loader@northpine.example'),
      ('clerk-driver-4', 'Riley Rivers', 'riley@northpine.example'),
      ('clerk-empty-fleet-1', 'Morgan Newfleet', 'emptyfleet@logloads.example'),
      ('clerk-driver-5', 'Taylor Timber', 'taylor@summit.example'),
      ('clerk-equipped-fleet-1', 'Avery Granite', 'avery@granitecreek.example')
    ) as p(subject, display_name, email)
  loop
    -- The link exists, so this keeps the pilot id and records the (synthetic, .example) verified address.
    perform marketplace.sync_verified_identity(v_iss, r.subject, r.display_name, r.email, true);
  end loop;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

-- -----------------------------------------------------------------------------
-- 2. Businesses (pilot ids). Verified exactly where the pilot seed holds a verification record.
-- -----------------------------------------------------------------------------
insert into marketplace.organizations (id, display_name, legal_name, slug, home_state, verification_status, verified_at, created_by) values
  ('33333333-3333-4333-8333-333333333331', 'North Pine Logging', 'North Pine Logging LLC', 'north-pine-logging', 'OR', 'verified', now(), '22222222-2222-4222-8222-222222222224'),
  ('33333333-3333-4333-8333-333333333332', 'Summit Ridge Timber', 'Summit Ridge Timber Inc.', 'summit-ridge-timber', 'OR', 'verified', now(), '22222222-2222-4222-8222-222222222223'),
  ('33333333-3333-4333-8333-333333333334', 'New River Hauling', 'New River Hauling LLC', 'new-river-hauling', 'OR', 'pending', null, '22222222-2222-4222-8222-222222222227'),
  ('33333333-3333-4333-8333-333333333335', 'Granite Creek Hauling', 'Granite Creek Hauling LLC', 'granite-creek-hauling', 'OR', 'pending', null, '22222222-2222-4222-8222-222222222231');

-- Hauling businesses (the pilot's "fleet" type). Private until an owner consents to public discovery (F1, below).
insert into marketplace.hauler_profiles (org_id, headline, base_area_label, service_center, service_radius_miles, operating_states, is_public) values
  ('33333333-3333-4333-8333-333333333331', 'Saw-log and chip hauling in the Cascade foothills', 'Oakridge, OR',
   extensions.st_GeogFromText('SRID=4326;POINT(-122.46 43.75)'), 80, '{OR}', false),
  ('33333333-3333-4333-8333-333333333334', null, 'Cascade Foothills, OR', null, null, '{OR}', false),
  ('33333333-3333-4333-8333-333333333335', 'Bunk and pole trailer setups for saw-log hauls', 'Springfield, OR',
   extensions.st_GeogFromText('SRID=4326;POINT(-123.02 44.05)'), 75, '{OR}', false);

-- Memberships (pilot ids), translated the way packages/services/src/marketplace-access.ts translates pilot roles:
-- dispatcher -> staff, landing_manager -> manager, driver -> driver, owner -> owner. Written by the migration role,
-- so each one is recorded as accepted (B-1).
insert into marketplace.organization_memberships (id, org_id, user_id, role, landing_workspace_seat, status) values
  ('16161616-1616-4616-8616-161616161611', '33333333-3333-4333-8333-333333333331', '22222222-2222-4222-8222-222222222224', 'staff', true, 'active'),
  ('16161616-1616-4616-8616-161616161612', '33333333-3333-4333-8333-333333333331', '22222222-2222-4222-8222-222222222221', 'driver', false, 'active'),
  ('16161616-1616-4616-8616-161616161613', '33333333-3333-4333-8333-333333333331', '22222222-2222-4222-8222-222222222222', 'driver', false, 'active'),
  ('16161616-1616-4616-8616-161616161614', '33333333-3333-4333-8333-333333333331', '22222222-2222-4222-8222-222222222225', 'manager', true, 'active'),
  ('16161616-1616-4616-8616-161616161615', '33333333-3333-4333-8333-333333333332', '22222222-2222-4222-8222-222222222223', 'owner', true, 'active'),
  ('16161616-1616-4616-8616-161616161616', '33333333-3333-4333-8333-333333333332', '22222222-2222-4222-8222-222222222224', 'staff', true, 'active'),
  ('16161616-1616-4616-8616-161616161617', '33333333-3333-4333-8333-333333333331', '22222222-2222-4222-8222-222222222226', 'driver', false, 'active'),
  ('16161616-1616-4616-8616-161616161618', '33333333-3333-4333-8333-333333333334', '22222222-2222-4222-8222-222222222227', 'owner', false, 'active'),
  ('16161616-1616-4616-8616-161616161619', '33333333-3333-4333-8333-333333333332', '22222222-2222-4222-8222-222222222228', 'driver', false, 'active'),
  ('16161616-1616-4616-8616-161616161631', '33333333-3333-4333-8333-333333333335', '22222222-2222-4222-8222-222222222231', 'owner', false, 'active');

-- -----------------------------------------------------------------------------
-- 3. Landing plans for the two landing businesses (synthetic provider references, as in the pilot seed).
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  perform marketplace.open_subscription_cycle('33333333-3333-4333-8333-333333333331', 'basic', 'active',
    now() - interval '1 hour', now() + interval '30 days', 'cus_seed_north_pine', 'sub_seed_north_pine', false, 7, false);
  perform marketplace.open_subscription_cycle('33333333-3333-4333-8333-333333333332', 'basic', 'active',
    now() - interval '1 hour', now() + interval '30 days', 'cus_seed_summit_ridge', 'sub_seed_summit_ridge', false, 7, false);
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

-- -----------------------------------------------------------------------------
-- 4. Landings (pilot ids). The public point is snapped to the 0.1-degree grid by the landing guard; the exact
--    entrance, directions, gate and site contact are private details, written by the landing's own manager/owner.
-- -----------------------------------------------------------------------------
insert into marketplace.landings (id, org_id, name, status, public_area_label, public_point, state_code, county, created_by) values
  ('66666666-6666-4666-8666-666666666661', '33333333-3333-4333-8333-333333333331', 'Oak Landing', 'active', 'Oakridge, OR',
   extensions.st_GeogFromText('SRID=4326;POINT(-122.4617 43.7471)'), 'OR', 'Lane', '22222222-2222-4222-8222-222222222225'),
  ('66666666-6666-4666-8666-666666666662', '33333333-3333-4333-8333-333333333332', 'Blue River Landing', 'active', 'Blue River, OR',
   extensions.st_GeogFromText('SRID=4326;POINT(-122.0898 44.1926)'), 'OR', 'Lane', '22222222-2222-4222-8222-222222222223');

do $$
declare
  v_iss  text := current_setting('logloads_seed.issuer');
  v_aud  text := current_setting('logloads_seed.audience');
  v_base jsonb := jsonb_build_object('role', 'authenticated', 'iss', v_iss, 'aud', v_aud, 'exp', extract(epoch from now())::bigint + 900);
begin
  -- Lee Loader, North Pine Logging's landing manager.
  perform set_config('request.jwt.claims', (v_base || jsonb_build_object('sub', 'clerk-loader-1'))::text, true);
  set local role authenticated;
  insert into marketplace.landing_private_details (landing_id, org_id, exact_point, directions, gate_instructions, site_contact_name, site_contact_phone)
  values ('66666666-6666-4666-8666-666666666661', '33333333-3333-4333-8333-333333333331',
          extensions.st_GeogFromText('SRID=4326;POINT(-122.4628 43.7463)'),
          'Take the timber road entrance after the single-lane bridge. Stage on the gravel apron west of the loader, nose out.',
          'The gate code rotates daily; the loader reads it out on radio channel 4 when you arrive.',
          'Lee Loader', '+15555550142');
  -- North Pine Logging's trucks (pilot equipment combinations NP-101, NP-202, NP-220).
  insert into marketplace.equipment_units (org_id, equipment_code, paired_trailer_code, unit_label, operational_status, unit_count) values
    ('33333333-3333-4333-8333-333333333331', 'log_truck', 'pole_trailer', 'NP-101 with pole trailer', 'available', 1),
    ('33333333-3333-4333-8333-333333333331', 'chip_truck', 'chip_van', 'NP-202 chip van', 'committed', 1),
    ('33333333-3333-4333-8333-333333333331', 'log_truck', 'bunk_trailer', 'NP-220 mountain bunk', 'available', 1);
  reset role;

  -- Cole Cedar, Summit Ridge Timber's owner.
  perform set_config('request.jwt.claims', (v_base || jsonb_build_object('sub', 'clerk-driver-3'))::text, true);
  set local role authenticated;
  insert into marketplace.landing_private_details (landing_id, org_id, exact_point, directions, gate_instructions, site_contact_name, site_contact_phone)
  values ('66666666-6666-4666-8666-666666666662', '33333333-3333-4333-8333-333333333332',
          extensions.st_GeogFromText('SRID=4326;POINT(-122.0925 44.1919)'),
          'High-grade switchback after mile 18. Hold at the lower landing until radio clearance on VHF channel 7.',
          'Summit dispatch confirms the gate status at the morning check-in.',
          'Cole Cedar', '+15555550163');
  reset role;

  -- Avery Granite, Granite Creek Hauling's owner: trucks (GC-11, GC-12, GC-21), an availability report, and consent
  -- to public discovery (the consent trigger records who gave it and when).
  perform set_config('request.jwt.claims', (v_base || jsonb_build_object('sub', 'clerk-equipped-fleet-1'))::text, true);
  set local role authenticated;
  insert into marketplace.equipment_units (org_id, equipment_code, paired_trailer_code, unit_label, operational_status, unit_count) values
    ('33333333-3333-4333-8333-333333333335', 'log_truck', 'bunk_trailer', 'GC-11 with bunk trailer', 'available', 1),
    ('33333333-3333-4333-8333-333333333335', 'log_truck', 'bunk_trailer', 'GC-12 with bunk trailer', 'available', 1),
    ('33333333-3333-4333-8333-333333333335', 'log_truck', 'pole_trailer', 'GC-21 with pole trailer', 'available', 1);
  insert into marketplace.availability_reports (org_id, equipment_code, available_count, area_center, area_label, radius_miles,
                                                available_from, available_until, note)
  values ('33333333-3333-4333-8333-333333333335', 'log_truck', 3, extensions.st_GeogFromText('SRID=4326;POINT(-123.02 44.05)'),
          'Springfield, OR', 75, current_date, current_date + 30, 'Two bunk setups and one pole trailer, weekdays.');
  update marketplace.hauler_profiles
  set is_public = true,
      description = 'Three log trucks: two with bunk trailers and one with a pole trailer, based near Springfield, OR.'
  where org_id = '33333333-3333-4333-8333-333333333335';
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

-- -----------------------------------------------------------------------------
-- 5. Jobs (pilot load-posting ids). Each starts as a draft row with the pilot id and is published through
--    marketplace.publish_job_posting by the landing desk, with the availability attestation (V2-DEC-03).
-- -----------------------------------------------------------------------------
insert into marketplace.job_postings (id, org_id, landing_id, title, status, created_by) values
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', '33333333-3333-4333-8333-333333333331', '66666666-6666-4666-8666-666666666661',
   'Oak saw-log morning run', 'draft', '22222222-2222-4222-8222-222222222224'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2', '33333333-3333-4333-8333-333333333331', '66666666-6666-4666-8666-666666666661',
   'Oak chip shuttle', 'draft', '22222222-2222-4222-8222-222222222224'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc5', '33333333-3333-4333-8333-333333333331', '66666666-6666-4666-8666-666666666661',
   'Oak recovery load', 'draft', '22222222-2222-4222-8222-222222222224'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3', '33333333-3333-4333-8333-333333333332', '66666666-6666-4666-8666-666666666662',
   'Blue River high-grade campaign', 'draft', '22222222-2222-4222-8222-222222222223'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc4', '33333333-3333-4333-8333-333333333332', '66666666-6666-4666-8666-666666666662',
   'Blue River pulp contingency', 'draft', '22222222-2222-4222-8222-222222222223');

do $$
declare
  v_iss  text := current_setting('logloads_seed.issuer');
  v_aud  text := current_setting('logloads_seed.audience');
  v_base jsonb := jsonb_build_object('role', 'authenticated', 'iss', v_iss, 'aud', v_aud, 'exp', extract(epoch from now())::bigint + 900);
  v_id   uuid;
begin
  -- The public board lists the most recently confirmed job first. Publishing Summit Ridge Timber first, then North
  -- Pine Logging's closed job, then its two open jobs, puts "Oak saw-log morning run" first, as on the pilot board.
  -- The pauses keep the confirmation times apart at the millisecond precision the app sorts with.

  -- Cole Cedar at Summit Ridge Timber.
  perform set_config('request.jwt.claims', (v_base || jsonb_build_object('sub', 'clerk-driver-3'))::text, true);
  set local role authenticated;
  v_id := marketplace.publish_job_posting(
    p_landing_id => '66666666-6666-4666-8666-666666666662', p_title => 'Blue River pulp contingency',
    p_equipment_codes => array['log_truck', 'bunk_trailer'], p_trucks_requested => 1,
    p_product => 'Pulpwood', p_description => 'A one-day pulpwood contingency load from Blue River Landing.',
    p_pay_unit => 'flat_rate', p_pay_amount_cents => 210000, p_trucks_per_day => 1,
    p_work_starts_on => current_date + 2, p_duration_days => 1, p_est_tons_per_load => 27,
    p_destination_label => 'River Pulp · Eugene, OR', p_est_one_way_miles => 61,
    p_public_road_notes => 'Temporary one-lane control at the county bridge.',
    p_attest_available => true, p_draft_job_id => 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4');
  perform marketplace.set_job_posting_status(v_id, 'filled');
  perform pg_sleep(0.02);
  perform marketplace.publish_job_posting(
    p_landing_id => '66666666-6666-4666-8666-666666666662', p_title => 'Blue River high-grade campaign',
    p_equipment_codes => array['log_truck', 'bunk_trailer'], p_trucks_requested => 4,
    p_product => 'Saw logs', p_description => 'A nine-day high-grade saw-log campaign from Blue River Landing.',
    p_pay_unit => 'per_load', p_pay_amount_cents => 52500, p_trucks_per_day => 4,
    p_work_starts_on => current_date + 5, p_duration_days => 9,
    p_est_loads_per_truck_per_day => 2, p_est_daily_loads => 8, p_est_tons_per_load => 29,
    p_destination_label => 'Cascade Mill · Springfield, OR', p_est_one_way_miles => 68,
    p_public_road_notes => 'Grade increases sharply after mile 18; chains may be required.',
    p_public_access_requirements => array['Chains carried when the road is restricted'],
    p_attest_available => true, p_draft_job_id => 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3');
  reset role;

  -- Dana Dispatch at North Pine Logging's landing desk.
  perform set_config('request.jwt.claims', (v_base || jsonb_build_object('sub', 'clerk-dispatch-1'))::text, true);
  set local role authenticated;
  v_id := marketplace.publish_job_posting(
    p_landing_id => '66666666-6666-4666-8666-666666666661', p_title => 'Oak recovery load',
    p_equipment_codes => array['log_truck', 'pole_trailer'], p_trucks_requested => 1,
    p_product => 'Mixed logs', p_description => 'One recovery load of mixed logs from Oak Landing.',
    p_pay_unit => 'per_load', p_pay_amount_cents => 48000, p_trucks_per_day => 1,
    p_work_starts_on => current_date + 4, p_duration_days => 1, p_est_tons_per_load => 26,
    p_destination_label => 'Cascade Mill · Springfield, OR', p_est_one_way_miles => 54,
    p_public_road_notes => 'Single-lane bridge before the landing entrance.',
    p_attest_available => true, p_draft_job_id => 'cccccccc-cccc-4ccc-8ccc-ccccccccccc5');
  perform marketplace.set_job_posting_status(v_id, 'closed');
  perform pg_sleep(0.02);
  perform marketplace.publish_job_posting(
    p_landing_id => '66666666-6666-4666-8666-666666666661', p_title => 'Oak chip shuttle',
    p_equipment_codes => array['chip_truck', 'chip_van'], p_trucks_requested => 2,
    p_product => 'Chips', p_description => 'A two-week chip shuttle from Oak Landing to the pulp mill in Eugene.',
    p_pay_unit => 'per_ton', p_pay_amount_cents => 6200, p_trucks_per_day => 2,
    p_work_starts_on => current_date + 7, p_duration_days => 14,
    p_est_loads_per_truck_per_day => 3, p_est_daily_loads => 6, p_est_tons_per_load => 30,
    p_destination_label => 'River Pulp · Eugene, OR', p_est_one_way_miles => 48,
    p_public_road_notes => 'Fog is common before 9 a.m.', p_schedule_note => 'Monday, Wednesday and Friday.',
    p_attest_available => true, p_draft_job_id => 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2');
  perform pg_sleep(0.02);
  perform marketplace.publish_job_posting(
    p_landing_id => '66666666-6666-4666-8666-666666666661', p_title => 'Oak saw-log morning run',
    p_equipment_codes => array['log_truck', 'pole_trailer'], p_trucks_requested => 3,
    p_product => 'Saw logs', p_description => 'Morning saw-log runs from Oak Landing to the mill in Springfield.',
    p_pay_unit => 'per_load', p_pay_amount_cents => 52500, p_trucks_per_day => 3,
    p_work_starts_on => current_date + 3, p_duration_days => 5,
    p_est_loads_per_truck_per_day => 2, p_est_daily_loads => 6, p_est_tons_per_load => 28,
    p_destination_label => 'Cascade Mill · Springfield, OR', p_est_one_way_miles => 54,
    p_public_road_notes => 'Single-lane bridge before the landing entrance.', p_schedule_note => 'Loads start at first light.',
    p_public_access_requirements => array['Radio on the landing channel'],
    p_attest_available => true, p_draft_job_id => 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1');
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

-- -----------------------------------------------------------------------------
-- 6. The seed checks its own result through the schema's functions, then records itself. Any failure rolls the
--    whole seed back.
-- -----------------------------------------------------------------------------
do $$
declare
  v_iss    text := current_setting('logloads_seed.issuer');
  v_aud    text := current_setting('logloads_seed.audience');
  v_base   jsonb := jsonb_build_object('role', 'authenticated', 'iss', v_iss, 'aud', v_aud, 'exp', extract(epoch from now())::bigint + 900);
  v_open   text;
  v_all    integer;
  v_caps   text[];
  v_equip  text;
  v_user   uuid;
  r        record;
begin
  -- Anonymous discovery shows exactly the three open jobs, by their pilot ids.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  select string_agg(t.job_id::text, ',' order by t.ordinality) into v_open
  from marketplace.list_marketplace_jobs() with ordinality as t;
  select count(*) into v_all from marketplace.list_marketplace_jobs(p_accepting_only => false);
  reset role;
  if v_open is distinct from 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1,cccccccc-cccc-4ccc-8ccc-ccccccccccc2,cccccccc-cccc-4ccc-8ccc-ccccccccccc3'
     or v_all <> 3 then
    raise exception 'seed check: anonymous discovery lists [%] in that order (% in all), expected the three open seeded jobs, newest first', v_open, v_all;
  end if;

  -- Every seeded person resolves through their pilot Clerk id to their pilot profile id.
  for r in
    select * from (values
      ('clerk-driver-1', '22222222-2222-4222-8222-222222222221'), ('clerk-driver-2', '22222222-2222-4222-8222-222222222222'),
      ('clerk-driver-3', '22222222-2222-4222-8222-222222222223'), ('clerk-dispatch-1', '22222222-2222-4222-8222-222222222224'),
      ('clerk-loader-1', '22222222-2222-4222-8222-222222222225'), ('clerk-driver-4', '22222222-2222-4222-8222-222222222226'),
      ('clerk-empty-fleet-1', '22222222-2222-4222-8222-222222222227'), ('clerk-driver-5', '22222222-2222-4222-8222-222222222228'),
      ('clerk-equipped-fleet-1', '22222222-2222-4222-8222-222222222231')
    ) as p(subject, user_id)
  loop
    perform set_config('request.jwt.claims', (v_base || jsonb_build_object('sub', r.subject))::text, true);
    set local role authenticated;
    v_user := marketplace.current_user_id();
    reset role;
    if v_user is distinct from r.user_id::uuid then
      raise exception 'seed check: % resolves to %, expected %', r.subject, v_user, r.user_id;
    end if;
  end loop;

  -- The capabilities the V2 pages and DS-05 rely on.
  for r in
    select * from (values
      ('clerk-dispatch-1', '33333333-3333-4333-8333-333333333331', 'job.publish,inquiry.respond,interest.express'),
      ('clerk-dispatch-1', '33333333-3333-4333-8333-333333333332', 'job.publish,inquiry.respond'),
      ('clerk-driver-3', '33333333-3333-4333-8333-333333333332', 'job.publish,landing.manage,inquiry.respond'),
      ('clerk-driver-2', '33333333-3333-4333-8333-333333333331', 'interest.express'),
      ('clerk-empty-fleet-1', '33333333-3333-4333-8333-333333333334', 'interest.express,equipment.manage'),
      ('clerk-equipped-fleet-1', '33333333-3333-4333-8333-333333333335', 'interest.express,equipment.manage')
    ) as p(subject, org_id, needs)
  loop
    perform set_config('request.jwt.claims', (v_base || jsonb_build_object('sub', r.subject))::text, true);
    set local role authenticated;
    select a.capabilities into v_caps from marketplace.get_viewer_marketplace_access(r.org_id::uuid) a;
    reset role;
    if not (string_to_array(r.needs, ',') <@ coalesce(v_caps, array[]::text[])) then
      raise exception 'seed check: % at % has [%], needs [%]', r.subject, r.org_id, array_to_string(v_caps, ','), r.needs;
    end if;
  end loop;
  -- A driver holds no landing seat (DS-05's dual-membership case starts from Maya Mills as a North Pine driver).
  perform set_config('request.jwt.claims', (v_base || jsonb_build_object('sub', 'clerk-driver-2'))::text, true);
  set local role authenticated;
  select a.capabilities into v_caps from marketplace.get_viewer_marketplace_access('33333333-3333-4333-8333-333333333331') a;
  reset role;
  if 'job.publish' = any (v_caps) then
    raise exception 'seed check: a North Pine Logging driver can publish';
  end if;

  -- Granite Creek Hauling's interest form offers its two setups, most units first (DS-05 GRANITE_CREEK).
  perform set_config('request.jwt.claims', (v_base || jsonb_build_object('sub', 'clerk-equipped-fleet-1'))::text, true);
  set local role authenticated;
  select string_agg(o.label || ' x' || o.units_listed, '; ' order by o.units_listed desc, o.label) into v_equip
  from marketplace.list_hauler_equipment_options('33333333-3333-4333-8333-333333333335') o;
  reset role;
  if v_equip is distinct from 'Log truck + Bunk / short-log x2; Log truck + Pole trailer x1' then
    raise exception 'seed check: Granite Creek Hauling offers [%]', v_equip;
  end if;
  perform set_config('request.jwt.claims', '', true);

  if (select count(*) from marketplace.landing_private_details) <> 2
     or exists (select 1 from marketplace.hauler_profiles where is_public and org_id <> '33333333-3333-4333-8333-333333333335')
     or not exists (select 1 from marketplace.hauler_profiles where is_public and public_listing_consent_by = '22222222-2222-4222-8222-222222222231')
     or (select count(*) from marketplace.expressions_of_interest) <> 0
     or (select count(*) from marketplace.organization_memberships where status = 'active' and accepted_at is not null) <> 10
     or (select string_agg(status, ',' order by id) from marketplace.job_postings) <> 'active,active,active,filled,closed' then
    raise exception 'seed check: private details, public profiles, inquiries, memberships or job states are not as seeded';
  end if;

  perform marketplace.write_audit('seed.pilot_demo_loaded', 'organizations', null, null,
    'Synthetic pilot demo seed (architecture/normalized-v2/seed/pilot_demo_seed.sql); not real activity',
    jsonb_build_object('seed', 'pilot_demo', 'version', 1, 'organizations', 4, 'people', 9, 'jobs', 5));
end
$$;

select 'seed|loaded: 4 businesses, 9 people, 2 landings, 5 jobs (3 open), 6 trucks, 1 availability report' as result;
