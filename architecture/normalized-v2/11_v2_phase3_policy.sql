-- =============================================================================
-- LogLoads normalized-v2 — 11 Phase 3 policy items F1–F4 and moderation holds
--
-- NON-ACTIVE PROTOTYPE. Not an approved migration. Applied after 06_v2_contract_alignment.sql.
-- Run order: 01 -> 02 -> 03 -> 06 -> 11 -> 12.
--
-- APPROVAL STATUS (see PHASE3_REVIEW.md §2). Only V2-DEC-01..03 (2026-11-01) and Blueprint v1.0 are recorded
-- founder approvals. F1, F2, F3 and the moderation hold are implemented AS DIRECTED by the Phase 3 directive
-- and are NOT ratified founder policy; F4 is supported by approved V2-DEC-02 ("incomplete drafts may be saved
-- only as status = 'draft'"). Each item is isolated here so it can be changed if the founder rules otherwise.
--
--   F1  Hauler profiles are private by default; public discovery requires explicit, recorded consent
--       by an owner or manager of the hauling business. Profiles that are public without recorded
--       consent (the pre-V2 default) are made private, audited, without touching their confirmation.
--   F2  A legacy posting must state valid pay (V2-DEC-02) before it can be reconfirmed or put back on
--       the marketplace. Once a legacy posting has been attested under V2 it is held to V2-DEC-02.
--   F3  Re-activating a paused (or filled / closed / expired) posting requires a fresh availability
--       attestation written in the same transaction (marketplace.reactivate_job_posting). Moderated
--       postings carry a moderation hold that only a moderator can release.
--   F4  Drafts may be incomplete, including missing truck demand; publication enforces it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Migration-order guard (D-1/D-2): requires 06, refuses a repeat. Runs before any change.
--    Apply exactly once, in one transaction: psql -v ON_ERROR_STOP=1 --single-transaction -f 11_v2_phase3_policy.sql
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_advisory_xact_lock(hashtextextended('marketplace.schema_migrations', 0));
  -- Two statements: PL/pgSQL plans each condition whole, so the ledger is referenced only once it exists.
  if to_regclass('marketplace.schema_migrations') is null then
    raise exception 'migration 11 requires migration 06 to be applied first' using errcode = '55000';
  end if;
  if not exists (select 1 from marketplace.schema_migrations where version = '06') then
    raise exception 'migration 11 requires migration 06 to be applied first' using errcode = '55000';
  end if;
  if exists (select 1 from marketplace.schema_migrations where version = '11') then
    raise exception 'migration 11 is already applied (%); re-running it is refused and nothing was changed',
      (select applied_at from marketplace.schema_migrations where version = '11')
      using errcode = '55000', hint = 'Migrations are forward-only.';
  end if;
  if to_regclass('marketplace.job_moderation_holds') is not null then
    raise exception 'migration 11 appears to be applied already (marketplace.job_moderation_holds exists) but is not recorded; refusing to re-run'
      using errcode = '55000';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- F1. Private by default; explicit, recorded consent to public discovery.
-- -----------------------------------------------------------------------------
alter table marketplace.hauler_profiles
  alter column is_public set default false,
  add column if not exists public_listing_consent_at timestamptz,
  add column if not exists public_listing_consent_by uuid references marketplace.app_users (id);

-- Pre-V2 profiles were public by default, so being public records no consent. Make them private.
-- hauler_profile_guard is suspended for this one statement: it stamps last_confirmed_at on every
-- update, which would fabricate a hauler confirmation (the same class of defect as Phase 2 C1).
alter table marketplace.hauler_profiles disable trigger hauler_profile_guard;
do $$
declare r record;
begin
  for r in
    update marketplace.hauler_profiles
    set is_public = false
    where is_public and public_listing_consent_at is null
    returning org_id
  loop
    perform marketplace.write_audit(
      'hauler.public_listing_withdrawn', 'hauler_profiles', r.org_id, r.org_id,
      'F1: public by the pre-V2 default, with no recorded consent to public discovery',
      jsonb_build_object('migration', '11_v2_phase3_policy'));
  end loop;
end
$$;
alter table marketplace.hauler_profiles enable trigger hauler_profile_guard;

alter table marketplace.hauler_profiles
  drop constraint if exists hauler_profiles_public_consent_chk,
  add constraint hauler_profiles_public_consent_chk check (
    not is_public or (public_listing_consent_at is not null and public_listing_consent_by is not null)
  );

-- Consent is recorded by the server, never supplied by the client (the consent columns carry no
-- client grants). Only an active owner or manager of the hauling business can give it.
create or replace function marketplace.tg_hauler_public_consent()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_user uuid := marketplace.current_user_id();
begin
  if new.is_public and (tg_op = 'INSERT' or not old.is_public) then
    if v_user is null or not exists (
      select 1 from marketplace.organization_memberships m
      where m.org_id = new.org_id and m.user_id = v_user
        and m.status = 'active' and m.role in ('owner', 'manager')
    ) then
      raise exception 'Public discovery needs explicit consent from an owner or manager of the hauling business'
        using errcode = '42501';
    end if;
    new.public_listing_consent_at := clock_timestamp();
    new.public_listing_consent_by := v_user;
    perform marketplace.write_audit(
      'hauler.public_listing_consented', 'hauler_profiles', new.org_id, new.org_id, null, '{}'::jsonb);
  elsif not new.is_public then
    new.public_listing_consent_at := null;
    new.public_listing_consent_by := null;
    if tg_op = 'UPDATE' and old.is_public then
      perform marketplace.write_audit(
        'hauler.public_listing_withdrawn', 'hauler_profiles', new.org_id, new.org_id, null, '{}'::jsonb);
    end if;
  else
    new.public_listing_consent_at := old.public_listing_consent_at;
    new.public_listing_consent_by := old.public_listing_consent_by;
  end if;
  return new;
end
$$;

drop trigger if exists hauler_public_consent on marketplace.hauler_profiles;
create trigger hauler_public_consent
  before insert or update on marketplace.hauler_profiles
  for each row execute function marketplace.tg_hauler_public_consent();

-- -----------------------------------------------------------------------------
-- F4. Drafts may omit truck demand; any published posting must state it.
-- -----------------------------------------------------------------------------
alter table marketplace.job_postings
  drop constraint if exists job_postings_truck_demand_chk,
  add constraint job_postings_truck_demand_chk check (
    (status = 'draft' or trucks_requested is not null or trucks_per_day is not null)
    and (trucks_per_day is null or trucks_requested is null or trucks_per_day <= trucks_requested)
  );

-- `save_job_posting_draft` no longer invents a truck count of 1 for an incomplete draft.
create or replace function marketplace.save_job_posting_draft(
  p_landing_id uuid,
  p_title text,
  p_equipment_codes text[] default '{}',
  p_trucks_requested integer default null,
  p_product text default null,
  p_description text default null,
  p_pay_unit text default null,
  p_pay_amount_cents bigint default null,
  p_pay_note text default null,
  p_trucks_per_day integer default null,
  p_work_starts_on date default null,
  p_duration_days integer default null,
  p_est_loads_per_truck_per_day numeric default null,
  p_est_daily_loads integer default null,
  p_est_tons_per_load numeric default null,
  p_destination_label text default null,
  p_est_one_way_miles integer default null,
  p_public_road_notes text default null,
  p_schedule_note text default null,
  p_public_access_requirements text[] default '{}',
  p_draft_job_id uuid default null
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_user       uuid := marketplace.current_user_id();
  v_landing    marketplace.landings;
  v_caps       text[];
  v_uniq_equip text[];
  v_ends_on    date;
  v_job_id     uuid;
begin
  select * into v_landing from marketplace.landings where id = p_landing_id;
  if not found then
    raise exception 'Choose one of your organization''s landings' using errcode = 'P0002';
  end if;

  select a.capabilities into v_caps
  from marketplace.get_viewer_marketplace_access(v_landing.org_id) a;

  if not ('job.publish' = any (coalesce(v_caps, array[]::text[]))) then
    raise exception 'Your role cannot author jobs for this organization' using errcode = '42501';
  end if;

  select array_agg(distinct btrim(c) order by btrim(c))
  into v_uniq_equip
  from unnest(coalesce(p_equipment_codes, array[]::text[])) as c
  where btrim(c) <> '';

  if p_work_starts_on is not null and p_duration_days is not null then
    v_ends_on := p_work_starts_on + (p_duration_days - 1);
  end if;

  if p_draft_job_id is not null then
    update marketplace.job_postings
    set landing_id = v_landing.id,
        title = btrim(p_title),
        description = nullif(btrim(p_description), ''),
        product = nullif(btrim(p_product), ''),
        destination_label = nullif(btrim(p_destination_label), ''),
        est_one_way_miles = p_est_one_way_miles,
        est_daily_loads = p_est_daily_loads,
        est_loads_per_truck_per_day = p_est_loads_per_truck_per_day,
        est_tons_per_load = p_est_tons_per_load,
        pay_amount_cents = p_pay_amount_cents,
        pay_unit = nullif(btrim(p_pay_unit), ''),
        pay_note = nullif(btrim(p_pay_note), ''),
        public_road_notes = nullif(btrim(p_public_road_notes), ''),
        schedule_note = nullif(btrim(p_schedule_note), ''),
        public_access_requirements = coalesce(p_public_access_requirements, '{}'),
        trucks_requested = p_trucks_requested,
        trucks_per_day = p_trucks_per_day,
        work_starts_on = p_work_starts_on,
        duration_days = p_duration_days,
        work_ends_on = v_ends_on
    where id = p_draft_job_id
      and org_id = v_landing.org_id
      and status = 'draft'
    returning id into v_job_id;

    if not found then
      raise exception 'Draft job posting not found or already published' using errcode = 'P0002';
    end if;

    delete from marketplace.job_posting_equipment where job_id = v_job_id;
  else
    insert into marketplace.job_postings (
      org_id, landing_id, title, description, product, destination_label,
      est_one_way_miles, est_daily_loads, est_loads_per_truck_per_day, est_tons_per_load,
      pay_amount_cents, pay_unit, pay_note, public_road_notes,
      schedule_note, public_access_requirements,
      trucks_requested, trucks_per_day, work_starts_on, duration_days, work_ends_on,
      status, created_by
    )
    values (
      v_landing.org_id, v_landing.id, btrim(p_title), nullif(btrim(p_description), ''), nullif(btrim(p_product), ''),
      nullif(btrim(p_destination_label), ''),
      p_est_one_way_miles, p_est_daily_loads, p_est_loads_per_truck_per_day, p_est_tons_per_load,
      p_pay_amount_cents, nullif(btrim(p_pay_unit), ''), nullif(btrim(p_pay_note), ''), nullif(btrim(p_public_road_notes), ''),
      nullif(btrim(p_schedule_note), ''), coalesce(p_public_access_requirements, '{}'),
      p_trucks_requested, p_trucks_per_day, p_work_starts_on, p_duration_days, v_ends_on,
      'draft', v_user
    )
    returning id into v_job_id;
  end if;

  if v_uniq_equip is not null and cardinality(v_uniq_equip) > 0 then
    insert into marketplace.job_posting_equipment (job_id, equipment_code)
    select v_job_id, code from unnest(v_uniq_equip) as code;
  end if;

  perform marketplace.write_audit(
    'job_posting.draft_saved', 'job_postings', v_job_id, v_landing.org_id,
    null, jsonb_build_object('landing_id', v_landing.id));

  return v_job_id;
end
$$;

-- -----------------------------------------------------------------------------
-- F2 / F3. Fresh attestation for re-activation; pay required for legacy postings; moderation holds.
-- -----------------------------------------------------------------------------

-- Every attestation written to the (ungranted) ledger records its transaction. When a posting leaves
-- active the guard clears that stamp, so re-activation requires an attestation made after it left active
-- and in the same transaction as the re-activation — an earlier attestation never carries over.
alter table marketplace.job_publication_attestations
  add column if not exists last_attested_xact xid8;

create or replace function marketplace.tg_attestation_stamp_xact()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
begin
  -- Stamp only real attestations (a new ledger row, or a new reconfirmation time). The job guard clears the
  -- stamp when a posting leaves active, so only an attestation made AFTER that can re-activate it.
  if tg_op = 'INSERT' or new.reconfirmed_at is distinct from old.reconfirmed_at then
    new.last_attested_xact := pg_current_xact_id();
  end if;
  return new;
end
$$;

drop trigger if exists attestation_stamp_xact on marketplace.job_publication_attestations;
create trigger attestation_stamp_xact
  before insert or update on marketplace.job_publication_attestations
  for each row execute function marketplace.tg_attestation_stamp_xact();

-- Moderation holds: a moderator's takedown must not be reversible by the posting's owner.
-- Ungranted (written only by moderator RPCs); the guard trigger consults it.
create table if not exists marketplace.job_moderation_holds (
  job_id    uuid primary key references marketplace.job_postings (id) on delete cascade,
  org_id    uuid not null references marketplace.organizations (id),
  held_at   timestamptz not null default clock_timestamp(),
  held_by   uuid references marketplace.app_users (id),
  reason    text not null check (char_length(btrim(reason)) between 5 and 500)
);
alter table marketplace.job_moderation_holds enable row level security;

-- V2-DEC-02 pay validity as one reusable rule (same as job_postings_compensation_chk for published rows).
create or replace function marketplace.job_pay_is_valid(p_pay_unit text, p_pay_amount_cents bigint, p_pay_note text)
returns boolean language sql immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_pay_unit is null then false
    when p_pay_unit = 'negotiable' then p_pay_amount_cents is null and char_length(btrim(coalesce(p_pay_note, ''))) >= 3
    else p_pay_amount_cents is not null and p_pay_amount_cents > 0
  end
$$;

create or replace function marketplace.tg_job_guard()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_plan     marketplace.subscription_plans;
  v_members  integer;
  v_landings integer;
  v_att      marketplace.job_publication_attestations;
begin
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then
    raise exception 'job postings cannot move between organizations' using errcode = '42501';
  end if;

  -- Compute `work_ends_on` from `work_starts_on` + `duration_days` when `duration_days` is provided
  -- and `work_ends_on` was omitted (`draftEndsOn` in `marketplace-job-draft.ts`).
  if new.work_starts_on is not null and new.duration_days is not null and new.work_ends_on is null then
    new.work_ends_on := new.work_starts_on + (new.duration_days - 1);
  end if;

  -- Verify `is_legacy_import` cannot be forged without an entry in `marketplace.legacy_job_imports`.
  if new.is_legacy_import then
    if not exists (
      select 1 from marketplace.legacy_job_imports li
      where li.job_id = new.id and li.org_id = new.org_id
    ) then
      raise exception 'is_legacy_import can only be set by the audited admin_import_legacy_job_posting migration path'
        using errcode = '42501';
    end if;
  end if;

  -- The attestation ledger row (if any). Read before the pay rules: a legacy posting that has been
  -- attested under V2 is held to V2-DEC-02 like any other V2 posting.
  select * into v_att
  from marketplace.job_publication_attestations a
  where a.job_id = new.id and a.org_id = new.org_id;

  -- F3 / F2: putting a published posting back on the marketplace (paused, filled, closed or expired ->
  -- active) needs a FRESH availability attestation written in this same transaction
  -- (marketplace.reactivate_job_posting). A moderation hold blocks it entirely until a moderator releases it.
  if tg_op = 'UPDATE' and new.status = 'active' and old.status not in ('active', 'draft') then
    if exists (select 1 from marketplace.job_moderation_holds h where h.job_id = new.id) then
      raise exception 'This posting is on a moderation hold and cannot be re-activated'
        using errcode = '42501';
    end if;
    if v_att.job_id is null or v_att.last_attested_xact is distinct from pg_current_xact_id() then
      raise exception 'Re-activating a job posting requires a fresh availability attestation (marketplace.reactivate_job_posting with p_attest_available = true)'
        using errcode = '23514';
    end if;
  end if;

  -- Leaving active invalidates any earlier attestation for re-activation purposes (see attestation_stamp_xact).
  if tg_op = 'UPDATE' and old.status = 'active' and new.status <> 'active' then
    update marketplace.job_publication_attestations a
    set last_attested_xact = null
    where a.job_id = new.id;
  end if;

  -- Draft semantics (`V2-DEC-02` & `V2-DEC-03`):
  --   * Drafts never have `published_at`, `last_confirmed_at`, or `last_confirmed_by`.
  --   * Once published (`old.status <> 'draft'`), a job cannot be reverted back to `'draft'`.
  if new.status = 'draft' then
    if tg_op = 'UPDATE' and old.status <> 'draft' then
      raise exception 'published job postings cannot revert to draft status; pause or close the posting instead'
        using errcode = '23514';
    end if;
    new.published_at := null;
    new.last_confirmed_at := null;
    new.last_confirmed_by := null;
    return new;
  end if;

  -- Active / published compensation enforcement (`V2-DEC-02`):
  --   No session variable (`app.allow_unquoted_active_jobs`) can bypass this check.
  if not new.is_legacy_import
     or v_att.job_id is not null
     or (new.status = 'active' and tg_op = 'UPDATE' and not old.is_legacy_import) then
    if new.pay_unit is null then
      raise exception 'Published job postings must state a positive pay rate with a pay basis or Negotiable with an explanatory note'
        using errcode = '23514',
              hint = 'Provide pay_amount_cents > 0 with a pay_unit, or set pay_unit = ''negotiable'' with a 3+ character pay_note.';
    elsif new.pay_unit = 'negotiable' then
      if new.pay_amount_cents is not null then
        raise exception 'Negotiable pay cannot be paired with a fixed pay_amount_cents'
          using errcode = '23514';
      end if;
      if new.pay_note is null or char_length(btrim(new.pay_note)) < 3 then
        raise exception 'Negotiable pay requires a meaningful explanatory pay_note (at least 3 non-whitespace characters)'
          using errcode = '23514';
      end if;
    else
      if new.pay_amount_cents is null or new.pay_amount_cents <= 0 then
        raise exception 'Pay unit % requires a positive pay_amount_cents (> 0)', new.pay_unit
          using errcode = '23514';
      end if;
    end if;
  end if;

  -- Explicit availability attestation enforcement (`V2-DEC-03`). The ledger (read above) is consulted for
  -- legacy rows too, so an explicit reconfirmation or re-activation of a legacy posting is reflected on the row.
  if not new.is_legacy_import then
    if v_att.job_id is null then
      raise exception 'Active job postings require explicit availability attestation via marketplace.publish_job_posting (p_attest_available = true)'
        using errcode = '23514';
    end if;
  end if;

  if new.status = 'active' and (tg_op = 'INSERT' or old.status <> 'active') then
    if not exists (select 1 from marketplace.landings l where l.id = new.landing_id and l.status = 'active') then
      raise exception 'job postings can only be active at an active landing' using errcode = '23514';
    end if;
    v_plan := marketplace.org_entitled_plan(new.org_id);
    if not exists (select 1 from marketplace.organizations o where o.id = new.org_id and o.status = 'active')
       or v_plan.id is null then
      raise exception 'an active landing subscription is required to publish' using errcode = '23514';
    end if;
    select count(*) into v_members
    from marketplace.organization_memberships m
    where m.org_id = new.org_id and m.status in ('invited', 'active') and m.landing_workspace_seat;
    if v_members > v_plan.max_team_members then
      raise exception 'organization has % paid landing seats which exceeds plan % limit of %; resolve seat conflict before publishing',
        v_members, v_plan.name, v_plan.max_team_members
        using errcode = '23514', hint = 'Remove or convert excess landing seats to fleet-only, or upgrade your subscription.';
    end if;
    if v_plan.max_active_landings is not null then
      select count(*) into v_landings
      from marketplace.landings l
      where l.org_id = new.org_id and l.status = 'active';
      if v_landings > v_plan.max_active_landings then
        raise exception 'organization has % active landings which exceeds plan % limit of %; resolve landing conflict before publishing',
          v_landings, v_plan.name, v_plan.max_active_landings
          using errcode = '23514', hint = 'Deactivate excess landings or upgrade your subscription.';
      end if;
    end if;

    if not new.is_legacy_import then
      if tg_op = 'INSERT' or old.status = 'draft' then
        new.published_at := v_att.attested_at;
        new.last_confirmed_at := v_att.reconfirmed_at;
        new.last_confirmed_by := v_att.reconfirmed_by;
      else
        new.published_at := old.published_at;
        new.last_confirmed_at := v_att.reconfirmed_at;
        new.last_confirmed_by := v_att.reconfirmed_by;
      end if;
    else
      new.published_at := coalesce(new.published_at, clock_timestamp());
      if v_att.job_id is not null then
        new.last_confirmed_at := v_att.reconfirmed_at;
        new.last_confirmed_by := v_att.reconfirmed_by;
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    -- Preserve `published_at`; and sync `last_confirmed_at` / `last_confirmed_by` strictly
    -- from the ungranted `job_publication_attestations` ledger so ordinary edits never
    -- refresh confirmation and direct UPDATEs cannot spoof `last_confirmed_at`.
    new.published_at := old.published_at;
    if not new.is_legacy_import or v_att.job_id is not null then
      new.last_confirmed_at := v_att.reconfirmed_at;
      new.last_confirmed_by := v_att.reconfirmed_by;
    else
      new.last_confirmed_at := old.last_confirmed_at;
      new.last_confirmed_by := old.last_confirmed_by;
    end if;
  end if;

  return new;
end
$$;

create or replace function marketplace.reconfirm_job_posting(p_job_id uuid)
returns timestamptz
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_user         uuid := marketplace.current_user_id();
  v_job          marketplace.job_postings;
  v_caps         text[];
  v_confirmed_at timestamptz;
  v_seq          bigint;
begin
  select * into v_job from marketplace.job_postings where id = p_job_id for update;
  if not found then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;

  select a.capabilities into v_caps
  from marketplace.get_viewer_marketplace_access(v_job.org_id) a;

  if not ('job.publish' = any (coalesce(v_caps, array[]::text[]))) then
    raise exception 'Your role cannot confirm jobs for this organization' using errcode = '42501';
  end if;

  if v_job.status <> 'active' or (v_job.expires_at is not null and v_job.expires_at <= now()) then
    raise exception 'Only active job postings can be confirmed available' using errcode = '23514';
  end if;

  -- F2: a legacy posting must state valid pay (V2-DEC-02) before it can be reconfirmed.
  if v_job.is_legacy_import and not marketplace.job_pay_is_valid(v_job.pay_unit, v_job.pay_amount_cents, v_job.pay_note) then
    raise exception 'Add pay to this legacy posting (a positive rate with a pay basis, or Negotiable with a note) before reconfirming it'
      using errcode = '23514';
  end if;

  v_confirmed_at := greatest(
    clock_timestamp(),
    coalesce(v_job.last_confirmed_at + interval '1 microsecond', clock_timestamp())
  );

  insert into marketplace.job_publication_attestations (
    job_id, org_id, attested_by, attested_at, reconfirmed_at, reconfirmed_by, confirmation_seq
  )
  values (
    p_job_id, v_job.org_id, v_user, coalesce(v_job.published_at, v_confirmed_at), v_confirmed_at, v_user, 1
  )
  on conflict (job_id) do update
    set reconfirmed_at = v_confirmed_at,
        reconfirmed_by = v_user,
        confirmation_seq = marketplace.job_publication_attestations.confirmation_seq + 1
  returning confirmation_seq into v_seq;

  update marketplace.job_postings
  set last_confirmed_at = v_confirmed_at,
      last_confirmed_by = v_user
  where id = p_job_id;

  perform marketplace.write_audit(
    'job_posting.reconfirmed', 'job_postings', p_job_id, v_job.org_id,
    'Explicit availability reconfirmation',
    jsonb_build_object(
      'confirmed_by_user_id', v_user,
      'confirmed_at', to_char(v_confirmed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'confirmation_seq', v_seq
    )
  );
  return v_confirmed_at;
end
$$;

create or replace function marketplace.set_job_posting_status(p_job_id uuid, p_status text)
returns void
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_job  marketplace.job_postings;
  v_caps text[];
begin
  if p_status not in ('active', 'paused', 'filled', 'closed', 'expired') then
    raise exception 'Invalid job status: %', p_status using errcode = '22023';
  end if;

  select * into v_job from marketplace.job_postings where id = p_job_id for update;
  if not found then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;

  select a.capabilities into v_caps
  from marketplace.get_viewer_marketplace_access(v_job.org_id) a;

  if not ('job.publish' = any (coalesce(v_caps, array[]::text[]))) then
    raise exception 'Your role cannot update jobs for this organization' using errcode = '42501';
  end if;

  if v_job.status = 'draft' then
    raise exception 'Draft job postings must be published via publish_job_posting with explicit availability attestation'
      using errcode = '23514';
  end if;

  -- F3: re-activation is not a plain status change; it needs a fresh availability attestation.
  if p_status = 'active' and v_job.status <> 'active' then
    raise exception 'Re-activating a job posting requires a fresh availability attestation (marketplace.reactivate_job_posting with p_attest_available = true)'
      using errcode = '23514';
  end if;

  update marketplace.job_postings
  set status = p_status,
      expires_at = case when p_status = 'expired' then coalesce(least(expires_at, now()), now()) else expires_at end
  where id = p_job_id;

  perform marketplace.write_audit(
    'job_posting.status_changed', 'job_postings', p_job_id, v_job.org_id,
    null, jsonb_build_object('from_status', v_job.status, 'to_status', p_status));
end
$$;

-- F3: the only path from paused / filled / closed / expired back to active. The caller states, now,
-- that the opportunity is available; the attestation is written in this transaction and the guard
-- trigger verifies that. Legacy postings must state valid pay first (F2). Moderation holds block it.
create or replace function marketplace.reactivate_job_posting(
  p_job_id uuid,
  p_attest_available boolean default null
) returns timestamptz
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_user         uuid := marketplace.current_user_id();
  v_job          marketplace.job_postings;
  v_caps         text[];
  v_confirmed_at timestamptz;
  v_seq          bigint;
begin
  if p_attest_available is not true then
    raise exception 'Explicit availability attestation (p_attest_available = true) is required to put a job posting back on the marketplace'
      using errcode = '23514',
            hint = 'Confirm that this hauling opportunity is currently available.';
  end if;

  select * into v_job from marketplace.job_postings where id = p_job_id for update;
  if not found then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;

  select a.capabilities into v_caps
  from marketplace.get_viewer_marketplace_access(v_job.org_id) a;
  if not ('job.publish' = any (coalesce(v_caps, array[]::text[]))) then
    raise exception 'Your role cannot re-activate jobs for this organization' using errcode = '42501';
  end if;

  if v_job.status = 'draft' then
    raise exception 'Drafts are published with publish_job_posting' using errcode = '23514';
  end if;
  if v_job.status = 'active' then
    raise exception 'This posting is already active; reconfirm it instead' using errcode = '23514';
  end if;
  if exists (select 1 from marketplace.job_moderation_holds h where h.job_id = p_job_id) then
    raise exception 'This posting is on a moderation hold and cannot be re-activated' using errcode = '42501';
  end if;
  if v_job.expires_at is not null and v_job.expires_at <= now() then
    raise exception 'This posting has passed its expiry; publish a new posting' using errcode = '23514';
  end if;
  if not marketplace.job_pay_is_valid(v_job.pay_unit, v_job.pay_amount_cents, v_job.pay_note) then
    raise exception 'Add pay to this posting (a positive rate with a pay basis, or Negotiable with a note) before putting it back on the marketplace'
      using errcode = '23514';
  end if;

  v_confirmed_at := greatest(
    clock_timestamp(),
    coalesce(v_job.last_confirmed_at + interval '1 microsecond', clock_timestamp())
  );

  insert into marketplace.job_publication_attestations (
    job_id, org_id, attested_by, attested_at, reconfirmed_at, reconfirmed_by, confirmation_seq
  )
  values (p_job_id, v_job.org_id, v_user, v_confirmed_at, v_confirmed_at, v_user, 1)
  on conflict (job_id) do update
    set reconfirmed_at = v_confirmed_at,
        reconfirmed_by = v_user,
        confirmation_seq = marketplace.job_publication_attestations.confirmation_seq + 1
  returning confirmation_seq into v_seq;

  update marketplace.job_postings set status = 'active' where id = p_job_id;

  perform marketplace.write_audit(
    'job_posting.reactivated', 'job_postings', p_job_id, v_job.org_id,
    'Explicit availability attestation on re-activation',
    jsonb_build_object(
      'from_status', v_job.status,
      'legacy_import', v_job.is_legacy_import,
      'confirmed_by_user_id', v_user,
      'confirmed_at', to_char(v_confirmed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'confirmation_seq', v_seq
    ));
  return v_confirmed_at;
end
$$;

-- Moderation now leaves a hold the owner cannot lift (03 only changed the status, which the owner
-- could immediately undo with set_job_posting_status).
create or replace function marketplace.admin_moderate_job_posting(
  p_job_id uuid, p_status text, p_reason text
) returns void language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare v_org uuid;
begin
  if not marketplace.is_platform_admin(array['moderator']) then
    raise exception 'platform moderator required' using errcode = '42501';
  end if;
  if p_status not in ('paused', 'closed', 'expired')
     or p_reason is null or char_length(btrim(p_reason)) < 5 then
    raise exception 'valid moderation status and reason required' using errcode = '22023';
  end if;
  update marketplace.job_postings set status = p_status where id = p_job_id returning org_id into v_org;
  if v_org is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  insert into marketplace.job_moderation_holds (job_id, org_id, held_by, reason)
  values (p_job_id, v_org, marketplace.current_user_id(), btrim(p_reason))
  on conflict (job_id) do update
    set held_at = clock_timestamp(), held_by = excluded.held_by, reason = excluded.reason;
  perform marketplace.write_audit(
    'job_posting.moderated', 'job_postings', p_job_id, v_org,
    p_reason, jsonb_build_object('status', p_status, 'hold', true), true);
end
$$;

create or replace function marketplace.admin_release_job_moderation_hold(p_job_id uuid, p_reason text)
returns void language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare v_org uuid;
begin
  if not marketplace.is_platform_admin(array['moderator']) then
    raise exception 'platform moderator required' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then
    raise exception 'an audit reason is required' using errcode = '22023';
  end if;
  delete from marketplace.job_moderation_holds where job_id = p_job_id returning org_id into v_org;
  if v_org is null then
    raise exception 'No moderation hold on this posting' using errcode = 'P0002';
  end if;
  perform marketplace.write_audit(
    'job_posting.moderation_released', 'job_postings', p_job_id, v_org, p_reason, '{}'::jsonb, true);
end
$$;

-- -----------------------------------------------------------------------------
-- S5 (found on the Supabase stack). 02 runs `grant execute on all functions in schema extensions to public,
-- anon, authenticated, service_role`. On plain PostgreSQL the migration role owns those functions and PUBLIC
-- can execute them anyway, so it changes nothing. On Supabase the extension functions belong to the platform
-- (supabase_admin) and the migration role holds grant option, so the statement re-opened functions an
-- extension deliberately restricts (e.g. pg_stat_statements_reset) to anon and authenticated. Undo exactly
-- that footprint: EXECUTE grants made by the migration role on functions it does not own. The platform's own
-- grants (grantor = owner) are untouched.
-- -----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select distinct p.oid::regprocedure as fn,
           case when a.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end as grantee
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(p.proacl) a
    where n.nspname = 'extensions'
      and p.proowner <> (select oid from pg_roles where rolname = current_user)
      and a.grantor = (select oid from pg_roles where rolname = current_user)
      and a.privilege_type = 'EXECUTE'
      and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'))
  loop
    execute format('revoke execute on function %s from %s', r.fn, r.grantee);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- Privileges. New functions are not executable by PUBLIC; user-facing RPCs go to authenticated only.
-- (CREATE OR REPLACE keeps the existing grants of redefined functions.)
-- -----------------------------------------------------------------------------
revoke all on function
  marketplace.tg_hauler_public_consent(),
  marketplace.tg_attestation_stamp_xact(),
  marketplace.job_pay_is_valid(text, bigint, text),
  marketplace.reactivate_job_posting(uuid, boolean),
  marketplace.admin_release_job_moderation_hold(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function
  marketplace.reactivate_job_posting(uuid, boolean),
  marketplace.admin_release_job_moderation_hold(uuid, text)
  to authenticated;
-- -----------------------------------------------------------------------------
-- Record this migration (D-1/D-2).
-- -----------------------------------------------------------------------------
insert into marketplace.schema_migrations (version, name) values ('11', '11_v2_phase3_policy');
