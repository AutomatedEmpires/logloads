-- =============================================================================
-- LogLoads normalized-v2 — 16 identity, membership and qualification hardening (B-1, B-2, B-5)
--
-- NON-ACTIVE PROTOTYPE. Not an approved migration. Applied after 12_v2_billing_events.sql.
-- Run order: 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16.
-- Apply exactly once, in one transaction: psql -v ON_ERROR_STOP=1 --single-transaction -f 16_...sql
--
-- Fixes from INDEPENDENT_REVIEW_FINDINGS.md §2:
--   B-1  A membership becomes active only with the member's own acceptance. An owner could move an
--        invitation invited -> suspended -> active without the invited person. `accepted_at` records the
--        member's acceptance (not client-writable); activation by anyone else requires it, and an active
--        membership must carry it.
--   B-5  sync_verified_identity stores only a provider-verified email. An unverified address never claims,
--        replaces or blocks an address; a verified owner releases an unverified copy held by another
--        account (pre-V2 data); a changed address never inherits the previous one's verification.
--   B-2  A landing desk reads a person's qualifications only when that person is an active member of a
--        hauling business that consented to public discovery (F1) or has a live inquiry with the desk's
--        organization — not every user's. (Scope is partly policy; this is the least-privilege default.)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Migration-order guard: requires 12, refuses a repeat. Runs before any change.
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_advisory_xact_lock(hashtextextended('marketplace.schema_migrations', 0));
  -- Two statements: PL/pgSQL plans each condition whole, so the ledger is referenced only once it exists.
  if to_regclass('marketplace.schema_migrations') is null then
    raise exception 'migration 16 requires migration 12 to be applied first' using errcode = '55000';
  end if;
  if not exists (select 1 from marketplace.schema_migrations where version = '12') then
    raise exception 'migration 16 requires migration 12 to be applied first' using errcode = '55000';
  end if;
  if exists (select 1 from marketplace.schema_migrations where version = '16') then
    raise exception 'migration 16 is already applied (%); re-running it is refused and nothing was changed',
      (select applied_at from marketplace.schema_migrations where version = '16')
      using errcode = '55000', hint = 'Migrations are forward-only.';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'marketplace' and table_name = 'organization_memberships' and column_name = 'accepted_at') then
    raise exception 'migration 16 appears to be applied already (organization_memberships.accepted_at exists) but is not recorded; refusing to re-run'
      using errcode = '55000';
  end if;
  -- M1: remember this transaction; the next statement refuses if it is not the same one.
  perform set_config('logloads.migration_xact', txid_current()::text, true);
end
$$;

-- M1: a migration file must run as ONE transaction (psql --single-transaction); see 06.
do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    -- Without ON_ERROR_STOP psql would carry on statement by statement after a refusal, so the rest of
    -- this session is made read-only first (every later write fails), then the next statement refuses.
    perform set_config('default_transaction_read_only', 'on', false);
    perform set_config('logloads.migration_refused', '16', false);
  end if;
end
$$;
-- The refusal needs no session state (a pooler may run this statement on another backend); see 06.
do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    raise exception 'migration 16 must be applied in one transaction (psql --single-transaction); nothing was changed'
      using errcode = '25P01', hint = 'This session (or pooled backend) was made read-only to stop the rest of the file.';
  end if;
  if coalesce(current_setting('logloads.migration_refused', true), '') <> '' then
    raise exception 'migration 16 refused: this session was made read-only by an earlier non-atomic attempt (migration %); reconnect and apply it with psql --single-transaction',
      current_setting('logloads.migration_refused')
      using errcode = '25P01';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- B-1. Acceptance is the member's own act.
-- -----------------------------------------------------------------------------
alter table marketplace.organization_memberships
  add column accepted_at timestamptz;

-- Existing members predate this rule. An active or suspended membership was accepted, or reached that state
-- by the B-1 path; the baseline cannot tell them apart, so both are recorded as accepted at creation rather
-- than locking existing members out (audited). Invitations stay unaccepted; removed rows stay as they are.
alter table marketplace.organization_memberships disable trigger membership_guard;
alter table marketplace.organization_memberships disable trigger set_updated_at;
update marketplace.organization_memberships
set accepted_at = created_at
where status in ('active', 'suspended') and accepted_at is null;
alter table marketplace.organization_memberships enable trigger set_updated_at;
alter table marketplace.organization_memberships enable trigger membership_guard;
do $$
declare v_rows integer;
begin
  select count(*) into v_rows from marketplace.organization_memberships where accepted_at is not null;
  if v_rows > 0 then
    perform marketplace.write_audit(
      'membership.acceptance_backfilled', 'organization_memberships', null, null,
      'B-1: existing active and suspended memberships recorded as accepted at creation',
      jsonb_build_object('migration', '16_v2_identity_membership_hardening', 'rows', v_rows));
  end if;
end
$$;

alter table marketplace.organization_memberships
  add constraint organization_memberships_active_accepted_chk check (status <> 'active' or accepted_at is not null);

-- 06's guard, with acceptance tracked. Unchanged rules are kept verbatim.
create or replace function marketplace.tg_membership_guard()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_actor        uuid := marketplace.current_user_id();
  v_plan         marketplace.subscription_plans;
  v_has_landings boolean;
  v_count        integer;
begin
  if new.role = 'driver' then
    new.landing_workspace_seat := false;
  elsif new.role = 'owner' then
    v_plan := marketplace.org_entitled_plan(new.org_id);
    select exists (select 1 from marketplace.landings l where l.org_id = new.org_id)
    into v_has_landings;
    if v_plan.id is not null or v_has_landings or not exists (
      select 1 from marketplace.hauler_profiles h where h.org_id = new.org_id
    ) then
      new.landing_workspace_seat := coalesce(new.landing_workspace_seat, true);
      if v_plan.id is not null or v_has_landings then
        new.landing_workspace_seat := true;
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' then
    -- B-1: a membership starts as an invitation unless the person adds themselves (an organization's
    -- creator) or no user is acting (a migration or service path).
    new.accepted_at := null;
    if new.status = 'active' then
      if v_actor is null or v_actor = new.user_id then
        new.accepted_at := clock_timestamp();
      else
        raise exception 'a membership starts as an invitation; only the invited person can accept it'
          using errcode = '42501';
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id or new.user_id <> old.user_id then
      raise exception 'membership identity is immutable' using errcode = '42501';
    end if;
    new.accepted_at := old.accepted_at;
    if old.status = 'invited' and new.status = 'active' and v_actor is distinct from new.user_id and v_actor is not null then
      raise exception 'only the invited person can accept a membership' using errcode = '42501';
    end if;
    -- B-1: becoming active by any other route needs an earlier acceptance by the member.
    if new.status = 'active' and old.status <> 'active' then
      if v_actor is null or (old.status = 'invited' and v_actor = new.user_id) then
        new.accepted_at := coalesce(old.accepted_at, clock_timestamp());
      elsif old.accepted_at is null then
        raise exception 'only the invited person can accept a membership' using errcode = '42501',
          hint = 'A membership that was never accepted cannot be activated by someone else, including via suspension.';
      end if;
    end if;
    if v_actor = old.user_id and not marketplace.has_org_role(old.org_id, array['owner']) then
      if new.role <> old.role
         or new.landing_workspace_seat <> old.landing_workspace_seat
         or not ((old.status = 'invited' and new.status = 'active') or new.status = 'removed') then
        raise exception 'members may only accept an invitation or leave' using errcode = '42501';
      end if;
    end if;
    if old.role = 'owner' and old.status = 'active' and (new.role <> 'owner' or new.status <> 'active')
       and not exists (
         select 1 from marketplace.organization_memberships m
         where m.org_id = old.org_id and m.role = 'owner' and m.status = 'active' and m.id <> old.id) then
      raise exception 'an organization needs at least one active owner' using errcode = '23514';
    end if;
    if new.status = 'removed' and old.status <> 'removed' then
      new.ended_at := now();
    end if;
  end if;

  if new.status in ('invited', 'active')
     and new.landing_workspace_seat
     and (tg_op = 'INSERT' or old.status not in ('invited', 'active') or not old.landing_workspace_seat) then
    perform 1 from marketplace.organizations o where o.id = new.org_id for update;
    v_plan := marketplace.org_entitled_plan(new.org_id);
    if v_plan.id is not null then
      select count(*) into v_count
      from marketplace.organization_memberships m
      where m.org_id = new.org_id
        and m.status in ('invited', 'active')
        and m.landing_workspace_seat
        and m.id <> new.id;
      if v_count >= v_plan.max_team_members then
        raise exception 'plan % allows % team member(s) in the Landing Operator workspace', v_plan.name, v_plan.max_team_members
          using errcode = '23514',
                hint = 'Remove or convert a landing seat to fleet-only (landing_workspace_seat = false), or upgrade your subscription.';
      end if;
    end if;
  end if;
  return new;
end
$$;

-- -----------------------------------------------------------------------------
-- B-5. Only provider-verified email addresses are stored.
-- -----------------------------------------------------------------------------
create or replace function marketplace.sync_verified_identity(
  p_issuer text, p_subject text, p_display_name text,
  p_email text default null, p_email_verified boolean default false
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_user     uuid;
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_released uuid;
begin
  if not exists (select 1 from marketplace.trusted_identity_issuers where issuer = p_issuer and enabled) then
    raise exception 'untrusted identity issuer: %', p_issuer using errcode = '42501';
  end if;
  select user_id into v_user from marketplace.identity_links where issuer = p_issuer and subject = p_subject;
  if v_user is null then
    insert into marketplace.app_users (display_name) values (coalesce(nullif(btrim(p_display_name), ''), 'LogLoads User'))
    returning id into v_user;
    insert into marketplace.identity_links (issuer, subject, user_id) values (p_issuer, p_subject, v_user);
  else
    update marketplace.app_users set display_name = coalesce(nullif(btrim(p_display_name), ''), display_name)
    where id = v_user;
  end if;

  -- An unverified address is never written: it cannot claim an address another person will verify, and it
  -- cannot replace (or inherit the verification of) the address already on file.
  if v_email <> '' and coalesce(p_email_verified, false) then
    -- A verified owner takes the address back from an unverified copy held by another account.
    for v_released in
      update marketplace.user_contacts c
      set email = null, email_verified_at = null
      where c.email = v_email and c.user_id <> v_user and c.email_verified_at is null
      returning c.user_id
    loop
      perform marketplace.write_audit(
        'identity.unverified_email_released', 'user_contacts', v_released, null,
        'B-5: a verified owner claimed an address held unverified by another account', '{}'::jsonb);
    end loop;

    insert into marketplace.user_contacts (user_id, email, email_verified_at)
    values (v_user, v_email, clock_timestamp())
    on conflict (user_id) do update
      set email = excluded.email,
          email_verified_at = case
            when marketplace.user_contacts.email = excluded.email
              then coalesce(marketplace.user_contacts.email_verified_at, excluded.email_verified_at)
            else excluded.email_verified_at
          end;
  end if;
  return v_user;
end
$$;

-- -----------------------------------------------------------------------------
-- B-2. Qualifications follow the F1 consent model.
-- -----------------------------------------------------------------------------
create or replace function marketplace.can_view_user_qualifications(p_user uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select marketplace.current_user_has_landing_access()
     and exists (
       select 1
       from marketplace.organization_memberships m
       join marketplace.hauler_profiles h on h.org_id = m.org_id
       join marketplace.organizations o on o.id = m.org_id and o.status = 'active'
       where m.user_id = p_user
         and m.status = 'active'
         and ((h.is_public and h.public_listing_consent_at is not null)
              or marketplace.has_live_inquiry_from_hauler(m.org_id))
     )
$$;

drop policy if exists user_qualifications_read on marketplace.user_qualifications;
create policy user_qualifications_read on marketplace.user_qualifications for select to authenticated
  using (user_id = (select marketplace.current_user_id())
         or marketplace.can_view_user_qualifications(user_id)
         or marketplace.is_platform_admin());

-- -----------------------------------------------------------------------------
-- Grants. accepted_at gets no client grant (02 grants memberships column by column).
-- -----------------------------------------------------------------------------
revoke all on function marketplace.can_view_user_qualifications(uuid) from public, anon, authenticated, service_role;
grant execute on function marketplace.can_view_user_qualifications(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- LE-09 (A-1, decision under the founder's delegation): every enabled identity issuer pins an audience,
-- so a token minted for another application on the same issuer never resolves a LogLoads user.
-- -----------------------------------------------------------------------------
alter table marketplace.trusted_identity_issuers
  add constraint trusted_identity_issuers_audience_pinned_chk
    check (not enabled or expected_audience is not null);

-- -----------------------------------------------------------------------------
-- LE-05 (C-1/C-3): a moderation hold also blocks publishing substantially identical content - the same
-- organization, the same landing and the same normalized title - while the hold is active. The owner sees
-- the hold's reason (never the moderator's identity, LE-06); a correction goes through a moderator release.
-- -----------------------------------------------------------------------------
create or replace function marketplace.normalize_listing_title(p_title text)
returns text language sql immutable
set search_path = pg_catalog, pg_temp
as $$
  select lower(regexp_replace(btrim(coalesce(p_title, '')), '[[:space:]]+', ' ', 'g'))
$$;

create or replace function marketplace.tg_job_hold_duplicate_guard()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_reason text;
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status <> 'active') then
    select h.reason into v_reason
    from marketplace.job_moderation_holds h
    join marketplace.job_postings j on j.id = h.job_id
    where h.org_id = new.org_id
      and j.id <> new.id
      and j.landing_id = new.landing_id
      and marketplace.normalize_listing_title(j.title) = marketplace.normalize_listing_title(new.title)
    limit 1;
    if found then
      raise exception 'This posting repeats a job that is on a moderation hold (reason: %). Ask LogLoads to review the hold instead of posting it again.', v_reason
        using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists job_hold_duplicate_guard on marketplace.job_postings;
create trigger job_hold_duplicate_guard
  before insert or update on marketplace.job_postings
  for each row execute function marketplace.tg_job_hold_duplicate_guard();

revoke all on function
  marketplace.normalize_listing_title(text),
  marketplace.tg_job_hold_duplicate_guard()
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- LE-07 (B-3, decision under the founder's delegation): platform staff read memberships and inquiries only
-- with the support role (superadmin satisfies every role). Message CONTENT is never readable by staff through
-- row-level security; it is read only through admin_read_interest_thread, which requires a reason and is audited.
-- -----------------------------------------------------------------------------
drop policy if exists memberships_read on marketplace.organization_memberships;
create policy memberships_read on marketplace.organization_memberships for select to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
         or user_id = (select marketplace.current_user_id())
         or marketplace.is_platform_admin(array['support']));

drop policy if exists interests_read on marketplace.expressions_of_interest;
create policy interests_read on marketplace.expressions_of_interest for select to authenticated
  using (hauler_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
         or job_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true))
         or marketplace.is_platform_admin(array['support']));

-- 06's helper without the platform-admin read branch (interest_messages_read uses it).
create or replace function marketplace.can_access_interest(p_interest uuid, p_write_side text default null)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select exists (
    select 1
    from marketplace.expressions_of_interest e
    where e.id = p_interest
      and (
        (p_write_side is null and (
           e.hauler_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
           or e.job_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true))
        ))
        or (p_write_side = 'hauler' and e.status not in ('withdrawn', 'declined')
            and e.hauler_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver'])))
        or (p_write_side = 'landing' and e.status not in ('withdrawn', 'declined')
            and e.job_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true)))
      )
  )
$$;

create or replace function marketplace.admin_read_interest_thread(p_interest_id uuid, p_reason text)
returns table (message_id uuid, message_author_side text, message_body text, message_created_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_org uuid;
begin
  if not marketplace.is_platform_admin(array['support']) then
    raise exception 'a support administrator is required to read an inquiry thread' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then
    raise exception 'a reason (at least 5 characters) is required to read an inquiry thread' using errcode = '22023';
  end if;
  select e.job_org_id into v_org from marketplace.expressions_of_interest e where e.id = p_interest_id;
  if v_org is null then
    raise exception 'Inquiry not found' using errcode = 'P0002';
  end if;
  perform marketplace.write_audit(
    'admin.interest_thread_read', 'expressions_of_interest', p_interest_id, v_org, btrim(p_reason), '{}'::jsonb, true);
  return query
    select m.id, m.author_side, m.body, m.created_at
    from marketplace.interest_messages m
    where m.interest_id = p_interest_id
    order by m.created_at, m.id;
end
$$;

-- -----------------------------------------------------------------------------
-- LE-06 (B-8): organizations read their audit trail, including a moderation action's reason and time, but not
-- the identity of the platform staff member who acted. The actor column is no longer directly readable;
-- audit_event_actor returns it to platform staff, and to the organization's owners for non-staff actions.
-- -----------------------------------------------------------------------------
revoke select on marketplace.audit_events from authenticated;
grant select (id, occurred_at, actor_kind, org_id, action, entity_table, entity_id, reason, metadata)
  on marketplace.audit_events to authenticated;

create or replace function marketplace.audit_event_actor(p_event_id bigint)
returns uuid language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select a.actor_user_id
  from marketplace.audit_events a
  where a.id = p_event_id
    and (marketplace.is_platform_admin()
         or (a.actor_kind <> 'platform_admin'
             and a.org_id in (select marketplace.my_org_ids(array['owner']))))
$$;

-- -----------------------------------------------------------------------------
-- LE-08 (B-4): verification attests to a legal identity. Changing a verified organization's legal name returns
-- it to pending review (audited); display-name and slug changes keep verification and are audited.
-- -----------------------------------------------------------------------------
create or replace function marketplace.tg_org_identity_guard()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
begin
  if old.verification_status = 'verified' and new.verification_status = 'verified'
     and new.legal_name is distinct from old.legal_name then
    new.verification_status := 'pending';
    new.verified_at := null;
    new.verified_by := null;
    perform marketplace.write_audit(
      'organization.verification_reset', 'organizations', new.id, new.id,
      'the legal name changed after verification',
      jsonb_build_object('previous_legal_name', old.legal_name, 'legal_name', new.legal_name));
  elsif (new.display_name, new.slug) is distinct from (old.display_name, old.slug) then
    perform marketplace.write_audit(
      'organization.identity_changed', 'organizations', new.id, new.id, null,
      jsonb_build_object('previous_display_name', old.display_name, 'previous_slug', old.slug));
  end if;
  return new;
end
$$;

drop trigger if exists org_identity_guard on marketplace.organizations;
create trigger org_identity_guard
  before update on marketplace.organizations
  for each row execute function marketplace.tg_org_identity_guard();

-- -----------------------------------------------------------------------------
-- LE-10 (I-1): the invitation dedupe window cannot be shortened by a caller. Whatever window was passed to the
-- reservation functions, a new invitation for the same job and business is refused while an earlier one is
-- reserved, or was delivered within the sending plan's window (default 30 days).
-- -----------------------------------------------------------------------------
create or replace function marketplace.tg_invitation_dedupe_floor()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_days integer;
begin
  v_days := coalesce((marketplace.org_entitled_plan(new.sender_org_id)).invitation_dedupe_days, 30);
  if exists (
    select 1 from marketplace.targeted_invitations ti
    where ti.job_id = new.job_id
      and ti.recipient_org_id = new.recipient_org_id
      and ti.id <> new.id
      and (ti.status = 'reserved'
           or (ti.status = 'delivered' and ti.created_at >= now() - v_days * interval '1 day'))
  ) then
    raise exception 'this business was already invited to this job within the % day dedupe window', v_days
      using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists invitation_dedupe_floor on marketplace.targeted_invitations;
create trigger invitation_dedupe_floor
  before insert on marketplace.targeted_invitations
  for each row execute function marketplace.tg_invitation_dedupe_floor();

-- -----------------------------------------------------------------------------
-- B-7: a declined inquiry no longer opens the landing's private details (02 excluded only withdrawn ones).
-- -----------------------------------------------------------------------------
create or replace function marketplace.can_view_landing_private(p_landing uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select exists (
    select 1 from marketplace.landings l
    where l.id = p_landing and marketplace.has_org_role(l.org_id, array['owner', 'manager', 'staff'], true)
  ) or exists (
    select 1
    from marketplace.expressions_of_interest e
    join marketplace.job_postings j on j.id = e.job_id
    where j.landing_id = p_landing
      and j.status in ('active', 'paused')
      and e.status not in ('withdrawn', 'declined')
      and e.private_details_shared_at is not null
      and e.hauler_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
  )
$$;

-- -----------------------------------------------------------------------------
-- B-9: the 200-message limit per inquiry (enforced by the reply functions) also binds direct inserts.
-- -----------------------------------------------------------------------------
create or replace function marketplace.tg_interest_message_cap()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
begin
  perform 1 from marketplace.expressions_of_interest e where e.id = new.interest_id for update;
  if (select count(*) from marketplace.interest_messages m where m.interest_id = new.interest_id) >= 200 then
    raise exception 'This conversation has reached its 200-message limit' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists interest_message_cap on marketplace.interest_messages;
create trigger interest_message_cap
  before insert on marketplace.interest_messages
  for each row execute function marketplace.tg_interest_message_cap();

revoke all on function
  marketplace.admin_read_interest_thread(uuid, text),
  marketplace.audit_event_actor(bigint),
  marketplace.tg_org_identity_guard(),
  marketplace.tg_invitation_dedupe_floor(),
  marketplace.tg_interest_message_cap()
  from public, anon, authenticated, service_role;
grant execute on function
  marketplace.admin_read_interest_thread(uuid, text),
  marketplace.audit_event_actor(bigint)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Record this migration.
-- -----------------------------------------------------------------------------
insert into marketplace.schema_migrations (version, name) values ('16', '16_v2_identity_membership_hardening');
