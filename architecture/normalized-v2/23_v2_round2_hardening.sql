-- =============================================================================
-- LogLoads normalized-v2 — 23 hardening round 2: follow-ups from the review of 18 (PR #194, issue #187)
--
-- NON-ACTIVE PROTOTYPE. Not an approved migration. Applied after 18_v2_review_106_hardening.sql.
-- Run order: 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23 (19..22 are test suites and harnesses, not migrations).
-- Apply exactly once, in one transaction: psql -v ON_ERROR_STOP=1 --single-transaction -f 23_...sql
--
-- Fixes:
--   R2-1  An owner exit and a billing write on the same organization could deadlock (40P01). The exit's UPDATE locks
--         the membership row before its BEFORE trigger runs, and 18's guard then waited for the organization row.
--         Billing (apply_subscription_cycle, which open_subscription_cycle calls, and apply_billing_provider_event)
--         locks the organization row first; its subscription write then fires tg_ensure_owner_landing_seat, which
--         updates every owner row without a landing seat, including the leaving owner's. Owner exits now take turns
--         on a per-organization advisory lock that billing never takes, so an exit never waits for billing while it
--         holds a row billing needs. No billing function changes (amounts, cycles, seat and landing gates).
--   R2-2  can_view_organization admitted any membership row: a removed or suspended member, or any member of a
--         suspended or closed organization, still read the organization. Its membership branch now counts only an
--         active membership or a pending invitation, in an active organization. Public visibility (an active landing,
--         or a hauling business that consented to discovery, F1) and the inquiry and invitation counterpart branches
--         are unchanged.
--   R2-3  An owner can insert an invitation for any user id, and the pending invitation made that person's profile
--         readable to the whole organization. A membership now exposes the person's profile to the organization only
--         once the person has accepted it (accepted_at, which only the person or a service path sets, B-1). Until
--         then the organization sees only the membership row it wrote itself. The invitee still reads the
--         organization and the person who invited them, so inviting and accepting work as before.
--   R2-4  HF-06's reset trigger is documented on the function: a future staff re-verification edits the fields
--         first and sets verified in a second statement. No exemption is added to the trigger.
--
-- Not changed here (ARCHITECTURE.md §4, "Lock order between memberships and billing"): a membership UPDATE that gives
-- a landing seat to an owner row that has none still waits for the organization row (the seat check must serialize
-- with billing's plan change), and one UPDATE statement that changes several memberships can still deadlock with a
-- concurrent owner exit. Both end in a retryable 40P01 with nothing lost.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Migration-order guard: requires 18, refuses a repeat. Runs before any change.
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_advisory_xact_lock(hashtextextended('marketplace.schema_migrations', 0));
  -- Two statements: PL/pgSQL plans each condition whole, so the ledger is referenced only once it exists.
  if to_regclass('marketplace.schema_migrations') is null then
    raise exception 'migration 23 requires migration 18 to be applied first' using errcode = '55000';
  end if;
  if not exists (select 1 from marketplace.schema_migrations where version = '18') then
    raise exception 'migration 23 requires migration 18 to be applied first' using errcode = '55000';
  end if;
  if exists (select 1 from marketplace.schema_migrations where version = '23') then
    raise exception 'migration 23 is already applied (%); re-running it is refused and nothing was changed',
      (select applied_at from marketplace.schema_migrations where version = '23')
      using errcode = '55000', hint = 'Migrations are forward-only.';
  end if;
  if to_regprocedure('marketplace.can_view_app_user(uuid)') is null
     or to_regprocedure('marketplace.can_view_organization(uuid)') is null
     or to_regprocedure('marketplace.tg_qualification_verification_reset()') is null then
    raise exception 'migration 23 requires the current 18 (HF-05 and HF-06); this database applied an earlier 18'
      using errcode = '55000';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p
             where p.oid = to_regprocedure('marketplace.tg_membership_guard()')
               and p.prosrc like '%marketplace.owner_exit:%') then
    raise exception 'migration 23 appears to be applied already (the owner-exit lock is installed) but is not recorded; refusing to re-run'
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
    perform set_config('logloads.migration_refused', '23', false);
  end if;
end
$$;
-- The refusal needs no session state (a pooler may run this statement on another backend); see 06.
do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    raise exception 'migration 23 must be applied in one transaction (psql --single-transaction); nothing was changed'
      using errcode = '25P01', hint = 'This session (or pooled backend) was made read-only to stop the rest of the file.';
  end if;
  if coalesce(current_setting('logloads.migration_refused', true), '') <> '' then
    raise exception 'migration 23 refused: this session was made read-only by an earlier non-atomic attempt (migration %); reconnect and apply it with psql --single-transaction',
      current_setting('logloads.migration_refused')
      using errcode = '25P01';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- R2-1. 18's membership guard, with owner exits taking turns on a per-organization advisory lock instead of the
-- organization row. Lock order before: exit = membership row -> organization row; billing = organization row ->
-- owner membership rows (tg_ensure_owner_landing_seat). After: an exit never waits for the organization row, and
-- billing never waits for the owner-exit lock, so the two cannot form a cycle. Two exits still take turns, and the
-- second still reads the first one's committed change (HF-15). Every other line is 18's, verbatim.
-- -----------------------------------------------------------------------------
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
    if old.role = 'owner' and old.status = 'active' and (new.role <> 'owner' or new.status <> 'active') then
      -- HF-15: one owner exit at a time per organization. The check below then reads the committed state
      -- (READ COMMITTED takes a new snapshot for each statement of this function).
      -- R2-1: the turn is a per-organization advisory lock that only owner exits take, not the organization row.
      -- This membership row is already locked when the trigger fires, and billing holds the organization row while
      -- tg_ensure_owner_landing_seat updates owner rows, so waiting here for the organization row could deadlock
      -- with billing (40P01).
      perform pg_advisory_xact_lock(hashtextextended('marketplace.owner_exit:' || old.org_id::text, 0));
      if not exists (
           select 1 from marketplace.organization_memberships m
           where m.org_id = old.org_id and m.role = 'owner' and m.status = 'active' and m.id <> old.id) then
        raise exception 'an organization needs at least one active owner' using errcode = '23514';
      end if;
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
-- R2-2. 18's organization visibility, with the membership branch limited to an active membership or a pending
-- invitation in an active organization. A pending invitation still opens the organization, so an invitee sees who
-- invited them before accepting; a declined invitation (removed, never accepted), a removal, a suspension of the
-- membership, and a suspended or closed organization no longer do. Active members of an active organization are also
-- covered by organizations_read's my_org_ids branch; platform staff by its is_platform_admin branch. The public and
-- counterpart branches are 18's, verbatim.
-- -----------------------------------------------------------------------------
create or replace function marketplace.can_view_organization(p_org uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select marketplace.org_has_public_presence(p_org)
      or exists (select 1 from marketplace.organization_memberships m
                 join marketplace.organizations o on o.id = m.org_id and o.status = 'active'
                 where m.org_id = p_org and m.user_id = marketplace.current_user_id()
                   and m.status in ('invited', 'active'))
      or exists (select 1 from marketplace.expressions_of_interest e
                 where (e.hauler_org_id = p_org
                        and e.job_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true)))
                    or (e.job_org_id = p_org
                        and e.hauler_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))))
      or exists (select 1 from marketplace.targeted_invitations ti
                 where (ti.recipient_org_id = p_org
                        and ti.sender_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true)))
                    or (ti.sender_org_id = p_org
                        and ti.recipient_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))))
$$;

-- -----------------------------------------------------------------------------
-- R2-3. 18's profile visibility, with the co-member branch limited to memberships the person accepted.
-- Decision: of the two options in the review (require an allowed discovery path for the invitee, or limit what an
-- invitation exposes), this takes the second at its narrowest: a pending or declined invitation exposes no profile
-- field at all. The schema has no invite-by-email path to require (app_users holds no email; user_contacts is
-- readable only by the person and support), and requiring one would change how invitations are created.
-- accepted_at is set only by the invited person or a service path (B-1, 16) and is kept through suspension and
-- removal, so a colleague who accepted and later left stays readable to the organization's history. The other
-- branches are 18's, verbatim: the invitee reads the person who invited them (invited_by is not client-writable,
-- it defaults to the inserting user), and counterparts read the people who wrote to them.
-- -----------------------------------------------------------------------------
create or replace function marketplace.can_view_app_user(p_user uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select exists (select 1 from marketplace.organization_memberships m
                 where m.user_id = p_user
                   and m.accepted_at is not null
                   and m.org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver'])))
      or exists (select 1 from marketplace.organization_memberships m
                 where m.user_id = marketplace.current_user_id() and m.invited_by = p_user)
      or exists (select 1 from marketplace.expressions_of_interest e
                 where (e.hauler_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
                        or e.job_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true)))
                   and (e.submitted_by = p_user
                        or e.private_details_shared_by = p_user
                        or exists (select 1 from marketplace.interest_messages im
                                   where im.interest_id = e.id and im.author_user_id = p_user)))
      or exists (select 1 from marketplace.targeted_invitations ti
                 where ti.sent_by = p_user
                   and ti.recipient_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver'])))
$$;

-- -----------------------------------------------------------------------------
-- R2-4. HF-06 has no exemption; the supported re-verification path is recorded on the trigger function itself.
-- Keyed on reviewed_at or a session setting, an exemption would make the reset depend on column grants staying narrow
-- (or on a setting a client can set), for a staff flow that does not exist yet.
-- -----------------------------------------------------------------------------
comment on function marketplace.tg_qualification_verification_reset() is
  'HF-06 (18): an edit to a verified qualification (user, kind, label, issuing region, expiry or evidence) returns it to self_reported, clears reviewed_by and reviewed_at, and writes qualification.verification_reset. There is no exemption. A staff re-verification (for example a renewed expiry date) runs in one SECURITY DEFINER staff function as two statements: first the edit, which resets the row and is audited; then verification_status = ''verified'' with reviewed_by and reviewed_at, which this trigger leaves alone because the row is no longer verified. Clients cannot write verification_status, reviewed_by or reviewed_at (column grants), so only such a function can re-verify. See ARCHITECTURE.md section 4 (R2-4).';

-- -----------------------------------------------------------------------------
-- Grants: unchanged. CREATE OR REPLACE keeps each function's ACL (tg_membership_guard: none; can_view_organization
-- and can_view_app_user: authenticated only), and 23 creates no new function.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- Record this migration.
-- -----------------------------------------------------------------------------
insert into marketplace.schema_migrations (version, name) values ('23', '23_v2_round2_hardening');
