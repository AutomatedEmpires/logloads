-- =============================================================================
-- LogLoads normalized-v2 — 26 seat invitations, staff-to-landing scope, saved jobs and a notification outbox (#237)
--
-- NON-ACTIVE PROTOTYPE. Not an approved migration. Applied after 23_v2_round2_hardening.sql.
-- Run order: 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23 -> 26 (19..22, 24, 25, 27 and 28 are test suites and
-- harnesses, not migrations). Apply exactly once, in one transaction: psql -v ON_ERROR_STOP=1 --single-transaction -f 26_...sql
-- 26 changes no stored row: it adds tables, functions, triggers and policies, redefines six functions, and adds one
-- unique constraint every existing row already satisfies (10 proves this on existing data).
--
-- Sources: UX functional spec v1.0 §2.3-§2.4 (seats include the owner; the owner invites), §4.11 (seats used, pending
-- invitations, assigned landing scope, resend, revoke, expiry), §6.6 (fleet staff are free, not paid seats), §8.7 and
-- §8.15 (accept or reject an invitation; assigned landing), §5.9 (saved postings, closure shown, delivery failures never
-- reported as delivered) and §8.19 (consented in-app and email notices for inquiry replies and saved-search matches).
-- Seat limits are read from subscription_plans.max_team_members (03, seeded from packages/contracts/src/membership.ts);
-- no number is restated here.
--
-- 26-A  Seat invitations by email. An owner invites an email address (team_invitations) as manager, staff or driver,
--       with or without a Landing Operator seat, optionally limited to some landings (team_invitation_landings).
--       A pending, unexpired invitation with a seat holds that seat: invite_team_member and tg_membership_guard
--       (redefined) both count it, under the organization-row lock the guard already takes, so neither path can
--       pass the plan's cap. The invitee accepts with the verified email address the invitation was sent to
--       (user_contacts, written only by sync_verified_identity), and the membership starts active and accepted
--       (B-1). Fleet staff without a seat are not capped by a plan (§6.6); 50 pending invitations per organization is
--       an abuse bound, not a plan limit. Revoke, resend (at most 5 sends), decline and lazy expiry are audited.
-- 26-B  Staff-to-landing scope. A manager or staff membership with a seat may be limited to some landings
--       (membership_landing_scopes, set only by an owner). No rows means every landing, as before. Owners are never
--       limited. The limit holds on every path: BEFORE triggers refuse writes to an out-of-scope landing, its jobs,
--       their equipment, inquiries, landing replies and targeted invitations (they fire inside SECURITY DEFINER
--       functions too); RESTRICTIVE select policies hide out-of-scope private rows (public rows stay public); and the
--       SECURITY DEFINER readers that bypass row security check it (can_read_job_posting, and through it
--       list_marketplace_jobs and get_marketplace_job; can_view_landing_private; can_access_interest;
--       list_authoring_landings; list_marketplace_interests).
-- 26-C  Saved jobs. A member of a hauling business saves an open job (saved_jobs) and removes it; list_saved_jobs shows
--       each saved job as open, paused, closed or unavailable, with public listing fields only, never private details.
-- 26-D  Notification outbox (notification_outbox). Written only by this file's functions and triggers:
--       a team invitation email (transactional), an inquiry reply from the other side, and a saved-search job alert
--       (enqueued by the matching service). Consent (notification_preferences) and eligibility are checked when a
--       notice is queued and again when a worker claims it. In-app notices are delivered when written. Email moves
--       pending -> claimed -> sent -> delivered or bounced, or ends failed, suppressed or cancelled: an accepted API
--       request is `sent`, never `delivered`; only the provider's delivery event makes it delivered. Workers claim with
--       a lease (SKIP LOCKED), complete with the claim token, and retry with backoff up to 5 attempts.
--       Targeted invitations keep their own delivery records (invitation_deliveries), which reconcile the allowance.
--
-- Not in 26 (the recovered batch of #221, `backup/reconciliation-2026-11-04/schema26`): its six groups are not adopted.
-- G1 needs contracts, adapter and UI in one change; G2 and G4 follow #219; G3 contradicts HF-05's verified column grant
-- and needs an adapter security review; G5 and G6 rewrite stored rows and need data-mapping, rollback and concurrency
-- review. Each is a separate task; adopted later, they take a new stage number (29 or later).
--
-- New tables (5): team_invitations, team_invitation_landings, membership_landing_scopes, saved_jobs, notification_outbox.
-- New functions (23): user_landing_scope_allows, landing_scope_allows, job_scope_allows, notification_recipient_allowed,
-- enqueue_notification, enqueue_team_invitation_email, invite_team_member, resend_team_invitation,
-- revoke_team_invitation, accept_team_invitation, decline_team_invitation, list_my_team_invitations,
-- list_team_invitations, set_membership_landing_scope, list_saved_jobs, enqueue_job_alerts, claim_email_notifications,
-- complete_email_notification, record_email_provider_event, mark_notifications_read, and the trigger functions
-- tg_landing_scope_guard, tg_saved_job_guard and tg_interest_message_notify.
-- Redefined (CREATE OR REPLACE keeps each ACL): tg_membership_guard, can_read_job_posting, can_view_landing_private,
-- can_access_interest, list_authoring_landings, list_marketplace_interests. Migration 18 (HF-18) withholds EXECUTE from
-- PUBLIC on every function this role creates, so each grant below is explicit. Stage 26 in CI checks this exact set.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Migration-order guard: requires 23, refuses a repeat. Runs before any change.
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_advisory_xact_lock(hashtextextended('marketplace.schema_migrations', 0));
  -- Two statements: PL/pgSQL plans each condition whole, so the ledger is referenced only once it exists.
  if to_regclass('marketplace.schema_migrations') is null then
    raise exception 'migration 26 requires migration 23 to be applied first' using errcode = '55000';
  end if;
  if not exists (select 1 from marketplace.schema_migrations where version = '23') then
    raise exception 'migration 26 requires migration 23 to be applied first' using errcode = '55000';
  end if;
  if exists (select 1 from marketplace.schema_migrations where version = '26') then
    raise exception 'migration 26 is already applied (%); re-running it is refused and nothing was changed',
      (select applied_at from marketplace.schema_migrations where version = '26')
      using errcode = '55000', hint = 'Migrations are forward-only.';
  end if;
  if to_regclass('marketplace.team_invitations') is not null
     or to_regclass('marketplace.membership_landing_scopes') is not null
     or to_regclass('marketplace.saved_jobs') is not null
     or to_regclass('marketplace.notification_outbox') is not null then
    raise exception 'migration 26 appears to be applied already (one of its tables exists) but is not recorded; refusing to re-run'
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
    perform set_config('logloads.migration_refused', '26', false);
  end if;
end
$$;
-- The refusal needs no session state (a pooler may run this statement on another backend); see 06.
do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    raise exception 'migration 26 must be applied in one transaction (psql --single-transaction); nothing was changed'
      using errcode = '25P01', hint = 'This session (or pooled backend) was made read-only to stop the rest of the file.';
  end if;
  if coalesce(current_setting('logloads.migration_refused', true), '') <> '' then
    raise exception 'migration 26 refused: this session was made read-only by an earlier non-atomic attempt (migration %); reconnect and apply it with psql --single-transaction',
      current_setting('logloads.migration_refused')
      using errcode = '25P01';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------

-- Target for tenant-consistent composite foreign keys (id is already the primary key, so every row satisfies it).
alter table marketplace.organization_memberships
  add constraint organization_memberships_id_org_key unique (id, org_id);

-- 26-A. An invitation to an email address. The address is the one the person signs in with; it is not contact data
-- the organization may reuse, and it never reaches the audit log.
create table marketplace.team_invitations (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references marketplace.organizations (id),
  invited_email           text not null check (invited_email = lower(btrim(invited_email))
                                               and char_length(invited_email) between 3 and 254
                                               and position('@' in invited_email) > 1
                                               and invited_email !~ '[[:space:]]'),
  role                    text not null check (role in ('manager', 'staff', 'driver')),
  landing_workspace_seat  boolean not null,
  status                  text not null default 'pending'
                          check (status in ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  invited_by              uuid not null references marketplace.app_users (id),
  send_count              smallint not null default 1 check (send_count between 1 and 5),
  last_sent_at            timestamptz not null default now(),
  expires_at              timestamptz not null,
  resolved_at             timestamptz,
  resolved_by             uuid references marketplace.app_users (id),
  membership_id           uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (id, org_id),
  -- Deferred: accept_team_invitation marks the invitation accepted (so it stops holding its seat) before the
  -- membership row exists, in the same transaction.
  constraint team_invitations_membership_fk foreign key (membership_id, org_id)
    references marketplace.organization_memberships (id, org_id) deferrable initially deferred,
  check (role <> 'driver' or not landing_workspace_seat),
  check (expires_at > created_at),
  check ((status = 'pending') = (resolved_at is null)),
  check ((status = 'accepted') = (membership_id is not null))
);
create unique index team_invitations_pending_uq on marketplace.team_invitations (org_id, invited_email) where status = 'pending';
create index team_invitations_email_idx on marketplace.team_invitations (invited_email) where status = 'pending';
create index team_invitations_org_idx on marketplace.team_invitations (org_id, created_at desc);

comment on table marketplace.team_invitations is
  '26-A: an owner''s invitation to an email address. A pending, unexpired invitation with a Landing Operator seat holds that seat (invite_team_member and tg_membership_guard count it). Accepted only by the person whose verified email is invited_email. Written only by the 26-A functions.';

create table marketplace.team_invitation_landings (
  invitation_id  uuid not null,
  org_id         uuid not null,
  landing_id     uuid not null,
  primary key (invitation_id, landing_id),
  foreign key (invitation_id, org_id) references marketplace.team_invitations (id, org_id),
  foreign key (landing_id, org_id) references marketplace.landings (id, org_id)
);

-- 26-B. The landings a manager or staff membership is limited to. No row for a membership: every landing.
create table marketplace.membership_landing_scopes (
  membership_id  uuid not null,
  org_id         uuid not null,
  landing_id     uuid not null,
  granted_by     uuid references marketplace.app_users (id),
  granted_at     timestamptz not null default now(),
  primary key (membership_id, landing_id),
  foreign key (membership_id, org_id) references marketplace.organization_memberships (id, org_id),
  foreign key (landing_id, org_id) references marketplace.landings (id, org_id)
);
create index membership_landing_scopes_landing_idx on marketplace.membership_landing_scopes (landing_id);

comment on table marketplace.membership_landing_scopes is
  '26-B: a manager or staff membership with a Landing Operator seat limited to these landings. No rows: every landing of the organization. Owners are never limited. Written only by set_membership_landing_scope and accept_team_invitation.';

-- 26-C. A job saved by one person for one hauling business they belong to. Ids only: no listing text is copied.
create table marketplace.saved_jobs (
  user_id   uuid not null references marketplace.app_users (id) default marketplace.current_user_id(),
  org_id    uuid not null references marketplace.organizations (id),
  job_id    uuid not null references marketplace.job_postings (id),
  saved_at  timestamptz not null default now(),
  primary key (user_id, org_id, job_id)
);
create index saved_jobs_job_idx on marketplace.saved_jobs (job_id);

-- 26-D. One notice to one recipient on one channel.
create table marketplace.notification_outbox (
  id                   uuid primary key default gen_random_uuid(),
  category             text not null check (category in ('team_invitation', 'inquiry_reply', 'job_alert')),
  channel              text not null check (channel in ('in_app', 'email')),
  recipient_user_id    uuid references marketplace.app_users (id),
  recipient_org_id     uuid references marketplace.organizations (id),
  -- Only a team invitation is addressed to an email (the invitee may have no account yet).
  recipient_email      text check (recipient_email is null
                                   or (recipient_email = lower(btrim(recipient_email))
                                       and char_length(recipient_email) between 3 and 254
                                       and position('@' in recipient_email) > 1)),
  subject_table        text not null check (subject_table in ('team_invitations', 'expressions_of_interest', 'saved_searches')),
  subject_id           uuid not null,
  dedupe_key           text not null unique check (char_length(dedupe_key) between 1 and 300),
  payload              jsonb not null default '{}'
                       check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 4096),
  status               text not null default 'pending'
                       check (status in ('pending', 'claimed', 'sent', 'delivered', 'failed', 'bounced', 'suppressed', 'cancelled')),
  attempt_count        smallint not null default 0 check (attempt_count between 0 and 10),
  available_at         timestamptz not null default now(),
  claim_token          uuid,
  claimed_at           timestamptz,
  claim_expires_at     timestamptz,
  provider_message_id  text check (char_length(provider_message_id) between 1 and 200),
  last_failure         text check (char_length(last_failure) <= 500),
  sent_at              timestamptz,
  delivered_at         timestamptz,
  read_at              timestamptz,
  resolved_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check ((recipient_email is not null) = (category = 'team_invitation')),
  check (category = 'team_invitation' or (recipient_user_id is not null and recipient_org_id is not null)),
  check (category <> 'team_invitation' or (channel = 'email' and recipient_user_id is null)),
  check ((status = 'claimed') = (claim_token is not null)),
  check (claim_token is null or (claimed_at is not null and claim_expires_at is not null)),
  check (status <> 'sent' or (sent_at is not null and provider_message_id is not null)),
  check (status <> 'delivered' or delivered_at is not null),
  check (channel = 'email' or status = 'delivered'),
  check (read_at is null or channel = 'in_app')
);
create index notification_outbox_due_idx on marketplace.notification_outbox (available_at, created_at)
  where channel = 'email' and status in ('pending', 'claimed');
create index notification_outbox_recipient_idx on marketplace.notification_outbox (recipient_user_id, created_at desc);
create index notification_outbox_subject_idx on marketplace.notification_outbox (subject_table, subject_id);
create unique index notification_outbox_provider_message_uq on marketplace.notification_outbox (provider_message_id)
  where provider_message_id is not null;

comment on table marketplace.notification_outbox is
  '26-D: consented notices. Written only by 26''s functions and triggers. Email: pending -> claimed -> sent (the provider accepted it) -> delivered (the provider confirmed delivery) or bounced; otherwise failed, suppressed (no consent, no verified address) or cancelled (no longer relevant). In-app rows are delivered when written. The recipient reads their own rows (not the address, provider id or failure text).';

create trigger set_updated_at before update on marketplace.team_invitations
  for each row execute function marketplace.tg_set_updated_at();
create trigger set_updated_at before update on marketplace.notification_outbox
  for each row execute function marketplace.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. 26-B helpers: whether a person's membership lets them act on a landing
-- -----------------------------------------------------------------------------

-- True unless p_user holds an active, non-owner membership of p_org that is limited to landings and p_landing is not
-- one of them. A NULL p_landing (a landing not yet created) is in no scope. A NULL p_user (a service or migration
-- path) is never limited. Used inside SECURITY DEFINER functions only.
create function marketplace.user_landing_scope_allows(p_user uuid, p_org uuid, p_landing uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select p_user is null or not exists (
    select 1
    from marketplace.organization_memberships m
    where m.org_id = p_org
      and m.user_id = p_user
      and m.status = 'active'
      and m.role <> 'owner'
      and exists (select 1 from marketplace.membership_landing_scopes s where s.membership_id = m.id)
      and not exists (select 1 from marketplace.membership_landing_scopes s
                      where s.membership_id = m.id and s.landing_id = p_landing))
$$;

create function marketplace.landing_scope_allows(p_org uuid, p_landing uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select marketplace.user_landing_scope_allows(marketplace.current_user_id(), p_org, p_landing)
$$;

create function marketplace.job_scope_allows(p_job uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select coalesce((select marketplace.user_landing_scope_allows(marketplace.current_user_id(), j.org_id, j.landing_id)
                   from marketplace.job_postings j where j.id = p_job), true)
$$;

comment on function marketplace.landing_scope_allows(uuid, uuid) is
  '26-B: false when the caller is a manager or staff member of p_org limited to other landings (membership_landing_scopes); true for everyone else, including owners, other organizations and anyone without a membership.';

-- -----------------------------------------------------------------------------
-- 3. Redefinitions. Each is the current definition, verbatim, with the lines marked "26" added.
-- -----------------------------------------------------------------------------

-- 26-A: 23's membership guard; a pending, unexpired seat invitation now holds its seat in the count.
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
      -- 26-A: a pending, unexpired seat invitation holds its seat. accept_team_invitation marks its invitation
      -- accepted before inserting the membership, so an acceptance is never counted twice.
      v_count := v_count + (select count(*)::integer from marketplace.team_invitations ti
                            where ti.org_id = new.org_id and ti.status = 'pending'
                              and ti.expires_at > now() and ti.landing_workspace_seat);
      if v_count >= v_plan.max_team_members then
        raise exception 'plan % allows % team member(s) in the Landing Operator workspace', v_plan.name, v_plan.max_team_members
          using errcode = '23514',
                hint = 'Remove or convert a landing seat to fleet-only (landing_workspace_seat = false), revoke a pending invitation, or upgrade your subscription.';
      end if;
    end if;
  end if;
  return new;
end
$$;

-- 26-B: the owning desk reads a non-public job only on a landing in its scope.
create or replace function marketplace.can_read_job_posting(p_job uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select marketplace.job_is_publicly_visible(p_job)
      or marketplace.is_platform_admin()
      or exists (
        select 1 from marketplace.job_postings j
        where j.id = p_job
          and j.org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true))
          and marketplace.landing_scope_allows(j.org_id, j.landing_id) -- 26-B
      )
      or exists (
        select 1 from marketplace.expressions_of_interest e
        where e.job_id = p_job
          and e.hauler_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
      )
      or exists (
        select 1 from marketplace.targeted_invitations i
        where i.job_id = p_job
          and i.recipient_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
      )
$$;

-- 26-B: the landing's own desk reads its private details only for a landing in its scope.
create or replace function marketplace.can_view_landing_private(p_landing uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select exists (
    select 1 from marketplace.landings l
    where l.id = p_landing and marketplace.has_org_role(l.org_id, array['owner', 'manager', 'staff'], true)
      and marketplace.landing_scope_allows(l.org_id, l.id) -- 26-B
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

-- 26-B: the landing side reads and writes an inquiry only for a job on a landing in its scope.
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
           or (e.job_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true))
               and marketplace.job_scope_allows(e.job_id)) -- 26-B
        ))
        or (p_write_side = 'hauler' and e.status not in ('withdrawn', 'declined')
            and e.hauler_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver'])))
        or (p_write_side = 'landing' and e.status not in ('withdrawn', 'declined')
            and e.job_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true))
            and marketplace.job_scope_allows(e.job_id)) -- 26-B
      )
  )
$$;

-- 26-B: a limited member authors jobs only on the landings in their scope.
create or replace function marketplace.list_authoring_landings(p_org_id uuid)
returns table (id uuid, name text, area_label text, state_code character)
language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_caps text[];
begin
  select a.capabilities into v_caps
  from marketplace.get_viewer_marketplace_access(p_org_id) a;

  if not ('job.publish' = any (coalesce(v_caps, array[]::text[]))) then
    raise exception 'Your role cannot publish jobs for this organization' using errcode = '42501';
  end if;

  return query
  select l.id, l.name, l.public_area_label as area_label, l.state_code
  from marketplace.landings l
  where l.org_id = p_org_id and l.status = 'active'
    and marketplace.landing_scope_allows(l.org_id, l.id) -- 26-B
  order by l.name asc;
end
$$;

-- 26-B: the landing inbox lists only inquiries on jobs at landings in the caller's scope.
create or replace function marketplace.list_marketplace_interests(p_org_id uuid, p_side text, p_job_id uuid default null)
returns table (id uuid, job_id uuid, job_slug text, job_title text, job_status text, job_accepting_interest boolean,
               landing_org_id uuid, landing_org_name text, hauler_org_id uuid, hauler_org_name text, hauler_org_type text,
               submitted_by_user_id uuid, submitted_by_name text, trucks_offered integer, equipment jsonb,
               available_from date, available_until date, message text, contact_preference text, status text,
               replies jsonb, created_at timestamp with time zone, updated_at timestamp with time zone,
               responded_at timestamp with time zone, withdrawn_at timestamp with time zone)
language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_caps text[];
begin
  select a.capabilities into v_caps
  from marketplace.get_viewer_marketplace_access(p_org_id) a;

  if p_side = 'hauler' then
    if not ('interest.reply' = any (coalesce(v_caps, array[]::text[]))) then
      raise exception 'Your role cannot act on inquiries for this business' using errcode = '42501';
    end if;
  elsif p_side = 'landing' then
    if not ('inquiry.respond' = any (coalesce(v_caps, array[]::text[]))) then
      raise exception 'Inquiry not found' using errcode = '42501';
    end if;
  else
    raise exception 'p_side must be hauler or landing' using errcode = '22023';
  end if;

  return query
  select
    e.id,
    e.job_id,
    e.job_id::text as job_slug,
    coalesce(j.title, 'Job no longer listed') as job_title,
    case
      when j.id is null or j.status = 'draft' then 'closed'
      when j.status = 'active' and j.expires_at is not null and j.expires_at <= now() then 'expired'
      else j.status
    end as job_status,
    (j.id is not null and j.status = 'active' and (j.expires_at is null or j.expires_at > now())) as job_accepting_interest,
    e.job_org_id as landing_org_id,
    coalesce(lo.display_name, 'Landing organization') as landing_org_name,
    e.hauler_org_id,
    coalesce(ho.display_name, 'Hauling business') as hauler_org_name,
    case
      when coalesce((select sum(eu.unit_count) from marketplace.equipment_units eu where eu.org_id = e.hauler_org_id and eu.is_active), 0) > 1
        then 'fleet'
      else 'carrier'
    end as hauler_org_type,
    e.submitted_by as submitted_by_user_id,
    coalesce(su.display_name, 'LogLoads member') as submitted_by_name,
    e.trucks_offered,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'configurationKey', eq.configuration_key,
          'label', eq.label,
          'count', eq.unit_count
        ) order by eq.sort_order, eq.configuration_key
      )
      from marketplace.expression_of_interest_equipment eq
      where eq.interest_id = e.id
    ), '[]'::jsonb) as equipment,
    e.available_from,
    e.available_until,
    e.message,
    e.contact_preference,
    e.status,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'authorUserId', m.author_user_id,
          'authorName', coalesce(au.display_name, 'LogLoads member'),
          'authorSide', m.author_side,
          'body', m.body,
          'createdAt', to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ) order by m.created_at, m.id
      )
      from marketplace.interest_messages m
      left join marketplace.app_users au on au.id = m.author_user_id
      where m.interest_id = e.id
    ), '[]'::jsonb) as replies,
    e.created_at,
    e.updated_at,
    e.responded_at,
    e.withdrawn_at
  from marketplace.expressions_of_interest e
  left join marketplace.job_postings j on j.id = e.job_id
  left join marketplace.organizations lo on lo.id = e.job_org_id
  left join marketplace.organizations ho on ho.id = e.hauler_org_id
  left join marketplace.app_users su on su.id = e.submitted_by
  where ((p_side = 'hauler' and e.hauler_org_id = p_org_id)
         or (p_side = 'landing' and e.job_org_id = p_org_id
             and marketplace.job_scope_allows(e.job_id))) -- 26-B
    and (p_job_id is null or e.job_id = p_job_id)
  order by
    case when p_side = 'hauler' then e.updated_at else e.created_at end desc,
    e.id;
end
$$;

-- -----------------------------------------------------------------------------
-- 4. 26-B enforcement on writes. Fires inside SECURITY DEFINER functions too, so publish, draft, status, reply,
--    respond and invitation functions are all held to the scope. Nothing is limited when no user is acting.
-- -----------------------------------------------------------------------------
create function marketplace.tg_landing_scope_guard()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_user    uuid := marketplace.current_user_id();
  v_ok      boolean := true;
  v_job     uuid;
  v_hauler  uuid;
begin
  if v_user is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_table_name = 'landings' then
    if tg_op = 'INSERT' then
      v_ok := marketplace.user_landing_scope_allows(v_user, new.org_id, null);
    else
      v_ok := marketplace.user_landing_scope_allows(v_user, old.org_id, old.id);
    end if;
  elsif tg_table_name = 'landing_private_details' then
    v_ok := marketplace.user_landing_scope_allows(v_user, new.org_id, new.landing_id)
            and (tg_op = 'INSERT' or marketplace.user_landing_scope_allows(v_user, old.org_id, old.landing_id));
  elsif tg_table_name = 'job_postings' then
    v_ok := marketplace.user_landing_scope_allows(v_user, new.org_id, new.landing_id)
            and (tg_op = 'INSERT' or marketplace.user_landing_scope_allows(v_user, old.org_id, old.landing_id));
  elsif tg_table_name = 'job_posting_equipment' then
    v_job := case when tg_op = 'DELETE' then old.job_id else new.job_id end;
  elsif tg_table_name = 'targeted_invitations' then
    v_job := new.job_id;
  elsif tg_table_name = 'expressions_of_interest' then
    -- The hauling business edits and withdraws its own inquiry; only the landing side is limited.
    v_hauler := new.hauler_org_id;
    v_job := new.job_id;
  elsif tg_table_name = 'interest_messages' then
    if new.author_side = 'landing' then
      select e.job_id into v_job from marketplace.expressions_of_interest e where e.id = new.interest_id;
    end if;
  end if;

  if v_job is not null and (v_hauler is null or not exists (
        select 1 from marketplace.organization_memberships m
        where m.org_id = v_hauler and m.user_id = v_user and m.status = 'active')) then
    v_ok := v_ok and coalesce((select marketplace.user_landing_scope_allows(v_user, j.org_id, j.landing_id)
                               from marketplace.job_postings j where j.id = v_job), true);
  end if;

  if not v_ok then
    raise exception 'This landing is not one of the landings you are assigned to' using errcode = '42501',
      hint = 'An owner of the organization can change which landings you work on.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger landing_scope_guard before insert or update on marketplace.landings
  for each row execute function marketplace.tg_landing_scope_guard();
create trigger landing_scope_guard before insert or update on marketplace.landing_private_details
  for each row execute function marketplace.tg_landing_scope_guard();
create trigger landing_scope_guard before insert or update on marketplace.job_postings
  for each row execute function marketplace.tg_landing_scope_guard();
create trigger landing_scope_guard before insert or delete on marketplace.job_posting_equipment
  for each row execute function marketplace.tg_landing_scope_guard();
create trigger landing_scope_guard before insert on marketplace.targeted_invitations
  for each row execute function marketplace.tg_landing_scope_guard();
create trigger landing_scope_guard before update on marketplace.expressions_of_interest
  for each row execute function marketplace.tg_landing_scope_guard();
create trigger landing_scope_guard before insert on marketplace.interest_messages
  for each row execute function marketplace.tg_landing_scope_guard();

-- 26-B enforcement on reads: RESTRICTIVE policies are ANDed with every permissive one. A public row stays readable to
-- everyone who could read it before; an out-of-scope private row is hidden from a limited member.
create policy landings_landing_scope on marketplace.landings as restrictive for select to authenticated
  using (status = 'active' or marketplace.landing_scope_allows(org_id, id));
create policy job_postings_landing_scope on marketplace.job_postings as restrictive for select to authenticated
  using (marketplace.landing_scope_allows(org_id, landing_id) or marketplace.job_is_publicly_visible(id));
create policy interests_landing_scope on marketplace.expressions_of_interest as restrictive for select to authenticated
  using (hauler_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
         or marketplace.job_scope_allows(job_id));
create policy invitations_landing_scope on marketplace.targeted_invitations as restrictive for select to authenticated
  using (recipient_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
         or marketplace.job_scope_allows(job_id));
create policy job_boosts_landing_scope on marketplace.job_boosts as restrictive for select to authenticated
  using (marketplace.job_scope_allows(job_id));

-- -----------------------------------------------------------------------------
-- 5. 26-D outbox core: who may receive a notice, and the one way a notice is written
-- -----------------------------------------------------------------------------

-- Whether a notice may go (or still go) to this recipient. A team invitation: while it is pending and unexpired. Any
-- other notice: the person opted in for that business, category and channel, is an active member of the active
-- business, and is still entitled to the subject (an inquiry's landing side needs a seat and the job's landing in
-- scope; a job alert needs the person's own saved job search with alerts on).
create function marketplace.notification_recipient_allowed(p_user uuid, p_org uuid, p_category text, p_channel text,
                                                           p_subject_table text, p_subject_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select case
    when p_category = 'team_invitation' then
      p_user is null and p_channel = 'email' and p_subject_table = 'team_invitations'
      and exists (select 1 from marketplace.team_invitations ti
                  join marketplace.organizations o on o.id = ti.org_id and o.status = 'active'
                  where ti.id = p_subject_id and ti.status = 'pending' and ti.expires_at > now())
    else
      p_user is not null and p_org is not null
      and exists (select 1 from marketplace.notification_preferences np
                  where np.user_id = p_user and np.org_id = p_org and np.category = p_category
                    and np.channel = p_channel and np.enabled)
      and exists (
        select 1
        from marketplace.organization_memberships m
        join marketplace.organizations o on o.id = m.org_id and o.status = 'active'
        join marketplace.app_users u on u.id = m.user_id and u.status = 'active'
        where m.org_id = p_org and m.user_id = p_user and m.status = 'active'
          and case
            when p_category = 'inquiry_reply' and p_subject_table = 'expressions_of_interest' then
              exists (select 1
                      from marketplace.expressions_of_interest e
                      join marketplace.job_postings j on j.id = e.job_id
                      where e.id = p_subject_id
                        and (e.hauler_org_id = p_org
                             or (e.job_org_id = p_org
                                 and m.landing_workspace_seat
                                 and m.role in ('owner', 'manager', 'staff')
                                 and marketplace.user_landing_scope_allows(p_user, p_org, j.landing_id))))
            when p_category = 'job_alert' and p_subject_table = 'saved_searches' then
              exists (select 1 from marketplace.saved_searches s
                      where s.id = p_subject_id and s.owner_user_id = p_user and s.org_id = p_org
                        and s.kind = 'jobs' and s.alerts_enabled)
            else false
          end)
  end
$$;

-- The only insert into the outbox. Idempotent on dedupe_key. An in-app notice is delivered when written.
create function marketplace.enqueue_notification(p_category text, p_channel text, p_user uuid, p_org uuid, p_email text,
                                                 p_subject_table text, p_subject_id uuid, p_dedupe_key text, p_payload jsonb)
returns uuid language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into marketplace.notification_outbox (category, channel, recipient_user_id, recipient_org_id, recipient_email,
                                               subject_table, subject_id, dedupe_key, payload, status, delivered_at)
  values (p_category, p_channel, p_user, p_org, p_email, p_subject_table, p_subject_id, p_dedupe_key,
          coalesce(p_payload, '{}'::jsonb),
          case when p_channel = 'in_app' then 'delivered' else 'pending' end,
          case when p_channel = 'in_app' then now() end)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end
$$;

-- The team invitation email for the invitation's current send. Names, never ids or the invitee's address, in the
-- payload; the address travels in recipient_email, which only the worker functions read.
create function marketplace.enqueue_team_invitation_email(p_invitation uuid)
returns uuid language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  r record;
begin
  select ti.id, ti.org_id, ti.invited_email, ti.role, ti.landing_workspace_seat, ti.expires_at, ti.send_count,
         o.display_name as org_name, u.display_name as inviter_name,
         (select count(*) from marketplace.team_invitation_landings til where til.invitation_id = ti.id) as landing_count,
         coalesce((select array_agg(x.name order by x.name)
                   from (select l.name from marketplace.team_invitation_landings til
                         join marketplace.landings l on l.id = til.landing_id
                         where til.invitation_id = ti.id order by l.name limit 10) x), '{}'::text[]) as landing_names
  into r
  from marketplace.team_invitations ti
  join marketplace.organizations o on o.id = ti.org_id
  join marketplace.app_users u on u.id = ti.invited_by
  where ti.id = p_invitation and ti.status = 'pending';
  if not found then
    return null;
  end if;
  return marketplace.enqueue_notification(
    'team_invitation', 'email', null, null, r.invited_email, 'team_invitations', r.id,
    format('team_invitation:%s:%s', r.id, r.send_count),
    jsonb_build_object('invitation_id', r.id, 'organization_name', r.org_name, 'invited_by_name', r.inviter_name,
                       'role', r.role, 'landing_workspace_seat', r.landing_workspace_seat,
                       'landing_count', r.landing_count, 'landing_names', to_jsonb(r.landing_names),
                       'expires_at', r.expires_at));
end
$$;

-- -----------------------------------------------------------------------------
-- 6. 26-A seat invitations
-- -----------------------------------------------------------------------------
create function marketplace.invite_team_member(p_org_id uuid, p_email text, p_role text, p_landing_workspace_seat boolean,
                                               p_valid_for interval, p_landing_ids uuid[] default '{}')
returns uuid language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_actor    uuid := marketplace.current_user_id();
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_landings uuid[] := array(select distinct x from unnest(coalesce(p_landing_ids, '{}'::uuid[])) x where x is not null);
  v_org      marketplace.organizations;
  v_plan     marketplace.subscription_plans;
  v_count    integer;
  v_id       uuid;
  v_expires  timestamptz;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not marketplace.has_org_role(p_org_id, array['owner']) then
    raise exception 'Only an owner of this organization can invite team members' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('manager', 'staff', 'driver') then
    raise exception 'Invite a manager, staff member or driver; ownership changes hands only through a separate, guarded transfer'
      using errcode = '22023';
  end if;
  if p_landing_workspace_seat is null then
    raise exception 'Say whether the person needs a Landing Operator seat' using errcode = '22023';
  end if;
  if p_role = 'driver' and p_landing_workspace_seat then
    raise exception 'A driver never holds a Landing Operator seat' using errcode = '22023';
  end if;
  if char_length(v_email) not between 3 and 254 or position('@' in v_email) <= 1 or v_email ~ '[[:space:]]' then
    raise exception 'Enter the email address the person signs in with' using errcode = '22023';
  end if;
  if p_valid_for is null or p_valid_for < interval '1 hour' or p_valid_for > interval '30 days' then
    raise exception 'An invitation stays open between 1 hour and 30 days' using errcode = '22023';
  end if;
  if cardinality(v_landings) > 0 then
    if not p_landing_workspace_seat or p_role not in ('manager', 'staff') then
      raise exception 'Only a manager or staff member with a Landing Operator seat can be limited to landings'
        using errcode = '22023';
    end if;
    if exists (select 1 from unnest(v_landings) x
               where not exists (select 1 from marketplace.landings l
                                 where l.id = x and l.org_id = p_org_id and l.status <> 'archived')) then
      raise exception 'Choose landings of this organization that are not archived' using errcode = '22023';
    end if;
  end if;

  -- An earlier invitation to this address that ran out no longer holds a seat; it is closed first. Invitation rows are
  -- locked before the organization row, the order accept_team_invitation uses.
  update marketplace.team_invitations
  set status = 'expired', resolved_at = now()
  where org_id = p_org_id and invited_email = v_email and status = 'pending' and expires_at <= now();

  -- Take turns with other invitations and with tg_membership_guard, which locks this row FOR UPDATE before it counts
  -- seats. FOR NO KEY UPDATE conflicts with both and not with foreign-key checks on the organization.
  select * into v_org from marketplace.organizations o where o.id = p_org_id for no key update;
  if v_org.status <> 'active' then
    raise exception 'This organization is not active' using errcode = '55000';
  end if;

  if exists (select 1 from marketplace.team_invitations
             where org_id = p_org_id and invited_email = v_email and status = 'pending') then
    raise exception 'An invitation to this address is already pending; resend it instead' using errcode = '23505';
  end if;
  if exists (select 1 from marketplace.user_contacts c
             join marketplace.organization_memberships m on m.user_id = c.user_id and m.org_id = p_org_id and m.status <> 'removed'
             where c.email = v_email and c.email_verified_at is not null) then
    raise exception 'The person who signs in with this address is already a member of this organization, or invited to it'
      using errcode = '23505';
  end if;

  select count(*) into v_count from marketplace.team_invitations
  where org_id = p_org_id and status = 'pending' and expires_at > now();
  if v_count >= 50 then
    raise exception 'This organization has 50 pending invitations; revoke some or wait for replies' using errcode = '23514';
  end if;

  if p_landing_workspace_seat then
    v_plan := marketplace.org_entitled_plan(p_org_id);
    if v_plan.id is not null then
      select (select count(*) from marketplace.organization_memberships m
              where m.org_id = p_org_id and m.status in ('invited', 'active') and m.landing_workspace_seat)
           + (select count(*) from marketplace.team_invitations ti
              where ti.org_id = p_org_id and ti.status = 'pending' and ti.expires_at > now() and ti.landing_workspace_seat)
      into v_count;
      if v_count >= v_plan.max_team_members then
        raise exception 'plan % allows % team member(s) in the Landing Operator workspace', v_plan.name, v_plan.max_team_members
          using errcode = '23514',
                hint = 'Pending invitations hold a seat. Revoke one, remove or convert a landing seat to fleet-only, or upgrade your subscription.';
      end if;
    end if;
  end if;

  v_expires := now() + p_valid_for;
  insert into marketplace.team_invitations (org_id, invited_email, role, landing_workspace_seat, invited_by, expires_at)
  values (p_org_id, v_email, p_role, p_landing_workspace_seat, v_actor, v_expires)
  returning id into v_id;
  insert into marketplace.team_invitation_landings (invitation_id, org_id, landing_id)
  select v_id, p_org_id, x from unnest(v_landings) x;

  perform marketplace.enqueue_team_invitation_email(v_id);
  perform marketplace.write_audit('team_invitation.created', 'team_invitations', v_id, p_org_id, null,
    jsonb_build_object('role', p_role, 'landing_workspace_seat', p_landing_workspace_seat,
                       'landing_count', cardinality(v_landings), 'expires_at', v_expires));
  return v_id;
end
$$;

create function marketplace.resend_team_invitation(p_invitation_id uuid, p_valid_for interval default null)
returns timestamptz language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_inv marketplace.team_invitations;
begin
  select * into v_inv from marketplace.team_invitations where id = p_invitation_id for update;
  if not found or not marketplace.has_org_role(v_inv.org_id, array['owner']) then
    raise exception 'Invitation not found' using errcode = '42501';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'This invitation is no longer open (%)', v_inv.status using errcode = '55000';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'This invitation has expired; send a new one' using errcode = '55000';
  end if;
  if v_inv.send_count >= 5 then
    raise exception 'This invitation has been sent 5 times; revoke it and send a new one if it is still needed' using errcode = '23514';
  end if;
  if p_valid_for is not null and (p_valid_for < interval '1 hour' or p_valid_for > interval '30 days') then
    raise exception 'An invitation stays open between 1 hour and 30 days' using errcode = '22023';
  end if;

  update marketplace.team_invitations
  set send_count = send_count + 1,
      last_sent_at = now(),
      expires_at = greatest(expires_at, coalesce(now() + p_valid_for, expires_at))
  where id = v_inv.id
  returning * into v_inv;

  perform marketplace.enqueue_team_invitation_email(v_inv.id);
  perform marketplace.write_audit('team_invitation.resent', 'team_invitations', v_inv.id, v_inv.org_id, null,
    jsonb_build_object('send_count', v_inv.send_count, 'expires_at', v_inv.expires_at));
  return v_inv.expires_at;
end
$$;

create function marketplace.revoke_team_invitation(p_invitation_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_inv marketplace.team_invitations;
begin
  select * into v_inv from marketplace.team_invitations where id = p_invitation_id for update;
  if not found or not marketplace.has_org_role(v_inv.org_id, array['owner']) then
    raise exception 'Invitation not found' using errcode = '42501';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'This invitation is no longer open (%)', v_inv.status using errcode = '55000';
  end if;
  update marketplace.team_invitations
  set status = 'revoked', resolved_at = now(), resolved_by = marketplace.current_user_id()
  where id = v_inv.id;
  update marketplace.notification_outbox
  set status = 'cancelled', resolved_at = now(), last_failure = 'the invitation was revoked'
  where subject_table = 'team_invitations' and subject_id = v_inv.id and status = 'pending';
  perform marketplace.write_audit('team_invitation.revoked', 'team_invitations', v_inv.id, v_inv.org_id);
end
$$;

-- The invitee, signed in with the invited address (verified), accepts. Returns the new membership.
create function marketplace.accept_team_invitation(p_invitation_id uuid)
returns uuid language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_actor uuid := marketplace.current_user_id();
  v_inv   marketplace.team_invitations;
  v_mid   uuid := gen_random_uuid();
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_inv from marketplace.team_invitations where id = p_invitation_id for update;
  if not found or not exists (select 1 from marketplace.user_contacts c
                              where c.user_id = v_actor and c.email = v_inv.invited_email and c.email_verified_at is not null) then
    raise exception 'No invitation was sent to your verified email address with this id' using errcode = '42501';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'This invitation is no longer open (%)', v_inv.status using errcode = '55000';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'This invitation has expired; ask the organization to send a new one' using errcode = '55000';
  end if;
  if not exists (select 1 from marketplace.organizations o where o.id = v_inv.org_id and o.status = 'active') then
    raise exception 'This organization is not active' using errcode = '55000';
  end if;
  if exists (select 1 from marketplace.organization_memberships m
             where m.org_id = v_inv.org_id and m.user_id = v_actor and m.status <> 'removed') then
    raise exception 'You are already a member of this organization, or invited to it' using errcode = '23505';
  end if;

  -- The invitation stops holding its seat before the membership takes it (the guard counts pending invitations).
  update marketplace.team_invitations
  set status = 'accepted', resolved_at = now(), resolved_by = v_actor, membership_id = v_mid
  where id = v_inv.id;
  -- Active and accepted at once: the invited person is the one acting (B-1). The seat cap is checked by the guard.
  insert into marketplace.organization_memberships (id, org_id, user_id, role, landing_workspace_seat, status, invited_by)
  values (v_mid, v_inv.org_id, v_actor, v_inv.role, v_inv.landing_workspace_seat, 'active', v_inv.invited_by);
  -- Every landing named on the invitation, archived ones too, so an archived landing never widens the scope.
  insert into marketplace.membership_landing_scopes (membership_id, org_id, landing_id, granted_by)
  select v_mid, v_inv.org_id, til.landing_id, v_inv.invited_by
  from marketplace.team_invitation_landings til where til.invitation_id = v_inv.id;

  update marketplace.notification_outbox
  set status = 'cancelled', resolved_at = now(), last_failure = 'the invitation was accepted'
  where subject_table = 'team_invitations' and subject_id = v_inv.id and status = 'pending';
  perform marketplace.write_audit('team_invitation.accepted', 'team_invitations', v_inv.id, v_inv.org_id, null,
    jsonb_build_object('membership_id', v_mid, 'role', v_inv.role, 'landing_workspace_seat', v_inv.landing_workspace_seat));
  return v_mid;
end
$$;

create function marketplace.decline_team_invitation(p_invitation_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_actor uuid := marketplace.current_user_id();
  v_inv   marketplace.team_invitations;
begin
  select * into v_inv from marketplace.team_invitations where id = p_invitation_id for update;
  if v_actor is null or not found or not exists (
       select 1 from marketplace.user_contacts c
       where c.user_id = v_actor and c.email = v_inv.invited_email and c.email_verified_at is not null) then
    raise exception 'No invitation was sent to your verified email address with this id' using errcode = '42501';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'This invitation is no longer open (%)', v_inv.status using errcode = '55000';
  end if;
  update marketplace.team_invitations
  set status = 'declined', resolved_at = now(), resolved_by = v_actor
  where id = v_inv.id;
  update marketplace.notification_outbox
  set status = 'cancelled', resolved_at = now(), last_failure = 'the invitation was declined'
  where subject_table = 'team_invitations' and subject_id = v_inv.id and status = 'pending';
  perform marketplace.write_audit('team_invitation.declined', 'team_invitations', v_inv.id, v_inv.org_id);
end
$$;

-- The caller's open invitations, found by their verified email address. The invitee is not a member yet, so this is
-- how they read who invited them and to what.
create function marketplace.list_my_team_invitations()
returns table (invitation_id uuid, organization_id uuid, organization_name text, role text, landing_workspace_seat boolean,
               landing_names text[], invited_by_name text, expires_at timestamptz)
language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select ti.id, ti.org_id, o.display_name, ti.role, ti.landing_workspace_seat,
         coalesce((select array_agg(l.name order by l.name)
                   from marketplace.team_invitation_landings til
                   join marketplace.landings l on l.id = til.landing_id
                   where til.invitation_id = ti.id), '{}'::text[]),
         u.display_name, ti.expires_at
  from marketplace.user_contacts c
  join marketplace.team_invitations ti on ti.invited_email = c.email and ti.status = 'pending' and ti.expires_at > now()
  join marketplace.organizations o on o.id = ti.org_id and o.status = 'active'
  join marketplace.app_users u on u.id = ti.invited_by
  where c.user_id = marketplace.current_user_id() and c.email_verified_at is not null
  order by ti.created_at desc, ti.id
$$;

-- The team page's invitations (§4.11), for the organization's owners: an expired one shows as expired, and the
-- latest email's real state is shown (sent is not delivered).
create function marketplace.list_team_invitations(p_org_id uuid)
returns table (invitation_id uuid, invited_email text, role text, landing_workspace_seat boolean, landing_ids uuid[],
               status text, invited_by uuid, invited_by_name text, send_count smallint, last_sent_at timestamptz,
               expires_at timestamptz, resolved_at timestamptz, membership_id uuid, email_status text,
               created_at timestamptz)
language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
#variable_conflict use_column
begin
  if not marketplace.has_org_role(p_org_id, array['owner']) then
    raise exception 'Only an owner of this organization can see its invitations' using errcode = '42501';
  end if;
  return query
  select ti.id, ti.invited_email, ti.role, ti.landing_workspace_seat,
         coalesce((select array_agg(til.landing_id order by til.landing_id)
                   from marketplace.team_invitation_landings til where til.invitation_id = ti.id), '{}'::uuid[]),
         case when ti.status = 'pending' and ti.expires_at <= now() then 'expired' else ti.status end,
         ti.invited_by, u.display_name, ti.send_count, ti.last_sent_at, ti.expires_at, ti.resolved_at, ti.membership_id,
         (select n.status from marketplace.notification_outbox n
          where n.subject_table = 'team_invitations' and n.subject_id = ti.id
          order by n.created_at desc, n.dedupe_key desc limit 1),
         ti.created_at
  from marketplace.team_invitations ti
  join marketplace.app_users u on u.id = ti.invited_by
  where ti.org_id = p_org_id
  order by ti.created_at desc, ti.id;
end
$$;

-- -----------------------------------------------------------------------------
-- 7. 26-B: an owner sets the landings a manager or staff membership works on (an empty list: every landing)
-- -----------------------------------------------------------------------------
create function marketplace.set_membership_landing_scope(p_membership_id uuid, p_landing_ids uuid[])
returns integer language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_m        marketplace.organization_memberships;
  v_landings uuid[] := array(select distinct x from unnest(coalesce(p_landing_ids, '{}'::uuid[])) x where x is not null);
  v_before   integer;
begin
  select * into v_m from marketplace.organization_memberships where id = p_membership_id;
  if not found or not marketplace.has_org_role(v_m.org_id, array['owner']) then
    raise exception 'Membership not found' using errcode = '42501';
  end if;
  if v_m.status = 'removed' then
    raise exception 'This person has left the organization' using errcode = '55000';
  end if;
  if cardinality(v_landings) > 0 then
    if v_m.role not in ('manager', 'staff') or not v_m.landing_workspace_seat then
      raise exception 'Only a manager or staff member with a Landing Operator seat can be limited to landings; owners always see every landing'
        using errcode = '22023';
    end if;
    if exists (select 1 from unnest(v_landings) x
               where not exists (select 1 from marketplace.landings l
                                 where l.id = x and l.org_id = v_m.org_id and l.status <> 'archived')) then
      raise exception 'Choose landings of this organization that are not archived' using errcode = '22023';
    end if;
  end if;

  -- One change at a time per membership.
  perform pg_advisory_xact_lock(hashtextextended('marketplace.landing_scope:' || v_m.id::text, 0));
  select count(*) into v_before from marketplace.membership_landing_scopes where membership_id = v_m.id;
  delete from marketplace.membership_landing_scopes where membership_id = v_m.id;
  insert into marketplace.membership_landing_scopes (membership_id, org_id, landing_id, granted_by)
  select v_m.id, v_m.org_id, x, marketplace.current_user_id() from unnest(v_landings) x;
  perform marketplace.write_audit('membership.landing_scope_changed', 'organization_memberships', v_m.id, v_m.org_id, null,
    jsonb_build_object('before_count', v_before, 'after_count', cardinality(v_landings),
                       'landing_ids', to_jsonb(v_landings)));
  return cardinality(v_landings);
end
$$;

-- -----------------------------------------------------------------------------
-- 8. 26-C saved jobs
-- -----------------------------------------------------------------------------
create function marketplace.tg_saved_job_guard()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
begin
  if not exists (select 1 from marketplace.hauler_profiles h where h.org_id = new.org_id) then
    raise exception 'Switch to a hauling business to save jobs' using errcode = '42501';
  end if;
  if exists (select 1 from marketplace.job_postings j where j.id = new.job_id and j.org_id = new.org_id) then
    raise exception 'You cannot save your own organization''s job' using errcode = '23514';
  end if;
  if not marketplace.job_is_publicly_visible(new.job_id) then
    raise exception 'Only an open job can be saved' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger saved_job_guard before insert on marketplace.saved_jobs
  for each row execute function marketplace.tg_saved_job_guard();

-- The caller's saved jobs for one hauling business. A job that closed, paused or was taken down stays on the list
-- with that state (§5.9); public listing fields only, and none at all for a job that is unavailable (taken down by
-- a moderator, or its business is no longer active).
create function marketplace.list_saved_jobs(p_org_id uuid)
returns table (job_id uuid, saved_at timestamptz, availability text, title text, poster_name text, pay_amount_cents bigint,
               pay_unit text, pay_note text, origin_label text, origin_state_code character, starts_on date, ends_on date,
               trucks_total integer, last_confirmed_at timestamptz, last_modified_at timestamptz)
language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
#variable_conflict use_column
begin
  if not exists (select 1 from marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']) x where x = p_org_id) then
    raise exception 'Saved jobs are not available for this business' using errcode = '42501';
  end if;
  return query
  with s as (
    select sj.job_id, sj.saved_at, j.title, o.display_name as poster_name, j.pay_amount_cents, j.pay_unit, j.pay_note,
           l.public_area_label, l.state_code, j.work_starts_on, j.work_ends_on, j.trucks_requested,
           j.last_confirmed_at, j.updated_at,
           case
             when j.id is null or o.status <> 'active'
                  or exists (select 1 from marketplace.job_moderation_holds h where h.job_id = j.id) then 'unavailable'
             when marketplace.job_is_publicly_visible(j.id) then 'open'
             when j.status in ('filled', 'closed', 'expired') or (j.expires_at is not null and j.expires_at <= now()) then 'closed'
             else 'paused'
           end as availability
    from marketplace.saved_jobs sj
    left join marketplace.job_postings j on j.id = sj.job_id
    left join marketplace.landings l on l.id = j.landing_id
    left join marketplace.organizations o on o.id = j.org_id
    where sj.user_id = marketplace.current_user_id() and sj.org_id = p_org_id
  )
  select s.job_id, s.saved_at, s.availability,
         case when s.availability <> 'unavailable' then s.title end,
         case when s.availability <> 'unavailable' then s.poster_name end,
         case when s.availability <> 'unavailable' then s.pay_amount_cents end,
         case when s.availability <> 'unavailable' then s.pay_unit end,
         case when s.availability <> 'unavailable' then s.pay_note end,
         case when s.availability <> 'unavailable' then s.public_area_label end,
         case when s.availability <> 'unavailable' then s.state_code end,
         case when s.availability <> 'unavailable' then s.work_starts_on end,
         case when s.availability <> 'unavailable' then s.work_ends_on end,
         case when s.availability <> 'unavailable' then s.trucks_requested end,
         case when s.availability <> 'unavailable' then s.last_confirmed_at end,
         case when s.availability <> 'unavailable' then s.updated_at end
  from s
  order by s.saved_at desc, s.job_id;
end
$$;

-- -----------------------------------------------------------------------------
-- 9. 26-D producers
-- -----------------------------------------------------------------------------

-- A message on an inquiry notifies the other side's opted-in members (never its author). A landing-side recipient
-- needs a seat and the job's landing in scope (26-B), so a limited member hears only about their own landings.
create function marketplace.tg_interest_message_notify()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  e        marketplace.expressions_of_interest;
  v_title  text;
  v_to_org uuid;
  v_from   text;
  r        record;
begin
  select * into e from marketplace.expressions_of_interest where id = new.interest_id;
  if not found then
    return null;
  end if;
  select j.title into v_title from marketplace.job_postings j where j.id = e.job_id;
  v_to_org := case when new.author_side = 'landing' then e.hauler_org_id else e.job_org_id end;
  select o.display_name into v_from from marketplace.organizations o
  where o.id = case when new.author_side = 'landing' then e.job_org_id else e.hauler_org_id end;
  for r in
    select np.user_id, np.channel
    from marketplace.notification_preferences np
    where np.org_id = v_to_org and np.category = 'inquiry_reply' and np.enabled
      and np.user_id <> new.author_user_id
    order by np.user_id, np.channel
  loop
    if marketplace.notification_recipient_allowed(r.user_id, v_to_org, 'inquiry_reply', r.channel,
                                                  'expressions_of_interest', e.id) then
      perform marketplace.enqueue_notification(
        'inquiry_reply', r.channel, r.user_id, v_to_org, null, 'expressions_of_interest', e.id,
        format('inquiry_reply:%s:%s:%s', new.id, r.user_id, r.channel),
        jsonb_build_object('interest_id', e.id, 'job_id', e.job_id, 'job_title', v_title, 'message_id', new.id,
                           'from_side', new.author_side, 'from_organization_name', v_from));
    end if;
  end loop;
  return null;
end
$$;

create trigger interest_message_notify after insert on marketplace.interest_messages
  for each row execute function marketplace.tg_interest_message_notify();

-- The job-alert matcher (a service) hands over jobs that match one saved job search. Each job alerts a search once
-- per channel, ever; closed or private jobs and the business's own jobs are skipped. Returns the notices queued.
create function marketplace.enqueue_job_alerts(p_saved_search_id uuid, p_job_ids uuid[])
returns integer language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_search marketplace.saved_searches;
  v_jobs   uuid[] := array(select distinct x from unnest(coalesce(p_job_ids, '{}'::uuid[])) x where x is not null);
  v_job    record;
  v_ch     text;
  v_id     uuid;
  v_n      integer := 0;
begin
  if cardinality(v_jobs) not between 1 and 50 then
    raise exception 'Pass between 1 and 50 matching jobs' using errcode = '22023';
  end if;
  select * into v_search from marketplace.saved_searches where id = p_saved_search_id for update;
  if not found then
    raise exception 'Saved search not found' using errcode = 'P0002';
  end if;
  if v_search.kind <> 'jobs' then
    raise exception 'Only a saved job search sends job alerts' using errcode = '22023';
  end if;
  for v_job in
    select j.id, j.title, o.display_name as poster_name, l.public_area_label, l.state_code, j.pay_amount_cents, j.pay_unit
    from unnest(v_jobs) x
    join marketplace.job_postings j on j.id = x
    join marketplace.landings l on l.id = j.landing_id
    join marketplace.organizations o on o.id = j.org_id
    where j.org_id <> v_search.org_id and marketplace.job_is_publicly_visible(j.id)
    order by j.id
  loop
    foreach v_ch in array array['email', 'in_app'] loop
      if marketplace.notification_recipient_allowed(v_search.owner_user_id, v_search.org_id, 'job_alert', v_ch,
                                                    'saved_searches', v_search.id) then
        v_id := marketplace.enqueue_notification(
          'job_alert', v_ch, v_search.owner_user_id, v_search.org_id, null, 'saved_searches', v_search.id,
          format('job_alert:%s:%s:%s', v_search.id, v_job.id, v_ch),
          jsonb_build_object('saved_search_id', v_search.id, 'saved_search_name', v_search.name, 'job_id', v_job.id,
                             'job_title', v_job.title, 'poster_name', v_job.poster_name,
                             'origin_label', v_job.public_area_label, 'origin_state_code', v_job.state_code,
                             'pay_amount_cents', v_job.pay_amount_cents, 'pay_unit', v_job.pay_unit));
        if v_id is not null then
          v_n := v_n + 1;
        end if;
      end if;
    end loop;
  end loop;
  if v_n > 0 then
    update marketplace.saved_searches set last_alerted_at = now() where id = v_search.id;
  end if;
  return v_n;
end
$$;

-- -----------------------------------------------------------------------------
-- 10. 26-D email worker protocol (service role) and the recipient's read marker
-- -----------------------------------------------------------------------------

-- Claims up to p_limit due emails for p_lease. A notice that is no longer wanted is closed instead of claimed
-- (cancelled when its subject closed, suppressed when consent or a verified address is missing), and one whose lease
-- ran out after its last attempt fails. Each claimed row returns the address to send to and a fresh claim token.
create function marketplace.claim_email_notifications(p_limit integer, p_lease interval)
returns table (notification_id uuid, claim_token uuid, category text, recipient_user_id uuid, recipient_org_id uuid,
               delivery_address text, payload jsonb, attempt_count smallint)
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  r       marketplace.notification_outbox;
  v_close text;
  v_why   text;
  v_addr  text;
  v_token uuid;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Claim between 1 and 100 notifications at a time' using errcode = '22023';
  end if;
  if p_lease is null or p_lease < interval '30 seconds' or p_lease > interval '15 minutes' then
    raise exception 'A claim lease lasts between 30 seconds and 15 minutes' using errcode = '22023';
  end if;
  for r in
    select o.*
    from marketplace.notification_outbox o
    where o.channel = 'email'
      and ((o.status = 'pending' and o.available_at <= now())
           or (o.status = 'claimed' and o.claim_expires_at <= now()))
    order by o.available_at, o.created_at, o.id
    limit p_limit
    for update skip locked
  loop
    v_close := null; v_why := null; v_addr := null;
    if r.attempt_count >= 5 then
      v_close := 'failed'; v_why := coalesce(r.last_failure, 'no result was reported for the last attempt');
    elsif not marketplace.notification_recipient_allowed(r.recipient_user_id, r.recipient_org_id, r.category, 'email',
                                                         r.subject_table, r.subject_id) then
      if r.category = 'team_invitation' then
        v_close := 'cancelled'; v_why := 'the invitation is no longer open';
      else
        v_close := 'suppressed'; v_why := 'the recipient is no longer opted in or entitled';
      end if;
    elsif r.category = 'job_alert' and not marketplace.job_is_publicly_visible((r.payload ->> 'job_id')::uuid) then
      v_close := 'cancelled'; v_why := 'the job is no longer open';
    else
      if r.category = 'team_invitation' then
        v_addr := r.recipient_email;
      else
        select c.email into v_addr from marketplace.user_contacts c
        where c.user_id = r.recipient_user_id and c.email_verified_at is not null;
      end if;
      if v_addr is null then
        v_close := 'suppressed'; v_why := 'the recipient has no verified email address';
      end if;
    end if;

    if v_close is not null then
      update marketplace.notification_outbox o
      set status = v_close, claim_token = null, claim_expires_at = null, resolved_at = now(), last_failure = v_why
      where o.id = r.id;
      continue;
    end if;

    v_token := gen_random_uuid();
    update marketplace.notification_outbox o
    set status = 'claimed', claim_token = v_token, claimed_at = now(), claim_expires_at = now() + p_lease,
        attempt_count = o.attempt_count + 1
    where o.id = r.id;
    notification_id := r.id;
    claim_token := v_token;
    category := r.category;
    recipient_user_id := r.recipient_user_id;
    recipient_org_id := r.recipient_org_id;
    delivery_address := v_addr;
    payload := r.payload;
    attempt_count := r.attempt_count + 1;
    return next;
  end loop;
end
$$;

-- The worker reports one claimed email: sent (the provider accepted it; its message id is required), retry (back to
-- pending after a backoff, or failed after the 5th attempt), failed, or suppressed (for example a test-recipient
-- guard). Only the current claim token is accepted, so a worker whose lease ran out cannot overwrite a later claim.
create function marketplace.complete_email_notification(p_notification_id uuid, p_claim_token uuid, p_outcome text,
                                                        p_provider_message_id text default null,
                                                        p_failure text default null, p_retry_after interval default null)
returns text language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  r         marketplace.notification_outbox;
  v_ref     text := nullif(btrim(coalesce(p_provider_message_id, '')), '');
  v_failure text := left(nullif(btrim(coalesce(p_failure, '')), ''), 500);
  v_delay   interval;
begin
  select * into r from marketplace.notification_outbox o where o.id = p_notification_id for update;
  if not found or r.status <> 'claimed' or r.claim_token is distinct from p_claim_token then
    raise exception 'This notification is not claimed with that token (it was completed, or its lease ran out and it was claimed again)'
      using errcode = '55000';
  end if;
  if p_outcome = 'sent' then
    if v_ref is null or char_length(v_ref) > 200 then
      raise exception 'A sent email needs the provider''s message id' using errcode = '22023';
    end if;
    update marketplace.notification_outbox o
    set status = 'sent', sent_at = now(), provider_message_id = v_ref, claim_token = null, claim_expires_at = null,
        last_failure = null
    where o.id = r.id;
    return 'sent';
  end if;
  if p_outcome not in ('retry', 'failed', 'suppressed') then
    raise exception 'The outcome is sent, retry, failed or suppressed' using errcode = '22023';
  end if;
  if v_failure is null then
    raise exception 'Say why the email was not sent' using errcode = '22023';
  end if;
  if p_outcome = 'retry' and r.attempt_count < 5 then
    v_delay := least(greatest(coalesce(p_retry_after, interval '1 minute' * power(2, greatest(r.attempt_count - 1, 0))),
                              interval '30 seconds'), interval '1 day');
    update marketplace.notification_outbox o
    set status = 'pending', available_at = now() + v_delay, claim_token = null, claim_expires_at = null,
        last_failure = v_failure
    where o.id = r.id;
    return 'pending';
  end if;
  update marketplace.notification_outbox o
  set status = case when p_outcome = 'suppressed' then 'suppressed' else 'failed' end,
      claim_token = null, claim_expires_at = null, resolved_at = now(), last_failure = v_failure
  where o.id = r.id;
  return case when p_outcome = 'suppressed' then 'suppressed' else 'failed' end;
end
$$;

-- The provider's webhook: delivered (only a sent email becomes delivered) or bounced (a sent or delivered email).
-- Returns the number of notices changed; a repeat or an unknown message id changes nothing.
create function marketplace.record_email_provider_event(p_provider_message_id text, p_event text,
                                                        p_occurred_at timestamptz default null)
returns integer language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_n integer;
begin
  if p_event = 'delivered' then
    update marketplace.notification_outbox o
    set status = 'delivered', delivered_at = coalesce(p_occurred_at, now())
    where o.provider_message_id = p_provider_message_id and o.status = 'sent';
  elsif p_event = 'bounced' then
    update marketplace.notification_outbox o
    set status = 'bounced', resolved_at = coalesce(p_occurred_at, now()), last_failure = 'the provider reported a bounce'
    where o.provider_message_id = p_provider_message_id and o.status in ('sent', 'delivered');
  else
    raise exception 'The event is delivered or bounced' using errcode = '22023';
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

create function marketplace.mark_notifications_read(p_notification_ids uuid[])
returns integer language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_n integer;
begin
  if cardinality(coalesce(p_notification_ids, '{}'::uuid[])) > 200 then
    raise exception 'Mark at most 200 notifications at a time' using errcode = '22023';
  end if;
  update marketplace.notification_outbox o
  set read_at = now()
  where o.id = any (p_notification_ids)
    and o.recipient_user_id = marketplace.current_user_id()
    and o.channel = 'in_app'
    and o.read_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- -----------------------------------------------------------------------------
-- 11. Row-level security and grants for the new tables
-- -----------------------------------------------------------------------------
alter table marketplace.team_invitations enable row level security;
alter table marketplace.team_invitation_landings enable row level security;
alter table marketplace.membership_landing_scopes enable row level security;
alter table marketplace.saved_jobs enable row level security;
alter table marketplace.notification_outbox enable row level security;

create policy team_invitations_read on marketplace.team_invitations for select to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner'])) or marketplace.is_platform_admin(array['support']));
create policy team_invitation_landings_read on marketplace.team_invitation_landings for select to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner'])) or marketplace.is_platform_admin(array['support']));
create policy membership_landing_scopes_read on marketplace.membership_landing_scopes for select to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner', 'manager']))
         or membership_id in (select m.id from marketplace.organization_memberships m
                              where m.user_id = (select marketplace.current_user_id()))
         or marketplace.is_platform_admin(array['support']));
create policy saved_jobs_read on marketplace.saved_jobs for select to authenticated
  using (user_id = (select marketplace.current_user_id())
         and org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver'])));
create policy saved_jobs_insert on marketplace.saved_jobs for insert to authenticated
  with check (user_id = (select marketplace.current_user_id())
              and org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver'])));
create policy saved_jobs_delete on marketplace.saved_jobs for delete to authenticated
  using (user_id = (select marketplace.current_user_id()));
create policy notification_outbox_recipient_read on marketplace.notification_outbox for select to authenticated
  using (recipient_user_id = (select marketplace.current_user_id())
         and recipient_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver'])));

revoke all on marketplace.team_invitations, marketplace.team_invitation_landings, marketplace.membership_landing_scopes,
              marketplace.saved_jobs, marketplace.notification_outbox
  from public, anon, authenticated, service_role;
grant select on marketplace.team_invitations, marketplace.team_invitation_landings,
                marketplace.membership_landing_scopes, marketplace.saved_jobs
  to authenticated;
grant insert (org_id, job_id), delete on marketplace.saved_jobs to authenticated;
-- The recipient's own notices, without the address, the provider's message id, the claim or the failure text.
grant select (id, category, channel, recipient_org_id, subject_table, subject_id, payload, status, created_at, sent_at,
              delivered_at, read_at)
  on marketplace.notification_outbox to authenticated;

-- -----------------------------------------------------------------------------
-- 12. Function grants (none by default: HF-18)
-- -----------------------------------------------------------------------------
revoke all on function
  marketplace.user_landing_scope_allows(uuid, uuid, uuid),
  marketplace.landing_scope_allows(uuid, uuid),
  marketplace.job_scope_allows(uuid),
  marketplace.notification_recipient_allowed(uuid, uuid, text, text, text, uuid),
  marketplace.enqueue_notification(text, text, uuid, uuid, text, text, uuid, text, jsonb),
  marketplace.enqueue_team_invitation_email(uuid),
  marketplace.invite_team_member(uuid, text, text, boolean, interval, uuid[]),
  marketplace.resend_team_invitation(uuid, interval),
  marketplace.revoke_team_invitation(uuid),
  marketplace.accept_team_invitation(uuid),
  marketplace.decline_team_invitation(uuid),
  marketplace.list_my_team_invitations(),
  marketplace.list_team_invitations(uuid),
  marketplace.set_membership_landing_scope(uuid, uuid[]),
  marketplace.tg_landing_scope_guard(),
  marketplace.tg_saved_job_guard(),
  marketplace.list_saved_jobs(uuid),
  marketplace.tg_interest_message_notify(),
  marketplace.enqueue_job_alerts(uuid, uuid[]),
  marketplace.claim_email_notifications(integer, interval),
  marketplace.complete_email_notification(uuid, uuid, text, text, text, interval),
  marketplace.record_email_provider_event(text, text, timestamptz),
  marketplace.mark_notifications_read(uuid[])
  from public, anon, authenticated, service_role;

-- Signed-in people (each function checks who may act). landing_scope_allows and job_scope_allows serve 26-B's policies.
grant execute on function
  marketplace.landing_scope_allows(uuid, uuid),
  marketplace.job_scope_allows(uuid),
  marketplace.invite_team_member(uuid, text, text, boolean, interval, uuid[]),
  marketplace.resend_team_invitation(uuid, interval),
  marketplace.revoke_team_invitation(uuid),
  marketplace.accept_team_invitation(uuid),
  marketplace.decline_team_invitation(uuid),
  marketplace.list_my_team_invitations(),
  marketplace.list_team_invitations(uuid),
  marketplace.set_membership_landing_scope(uuid, uuid[]),
  marketplace.list_saved_jobs(uuid),
  marketplace.mark_notifications_read(uuid[])
  to authenticated;

-- The job-alert matcher and the email worker run with the service role.
grant execute on function
  marketplace.enqueue_job_alerts(uuid, uuid[]),
  marketplace.claim_email_notifications(integer, interval),
  marketplace.complete_email_notification(uuid, uuid, text, text, text, interval),
  marketplace.record_email_provider_event(text, text, timestamptz)
  to service_role;

-- -----------------------------------------------------------------------------
-- Record this migration.
-- -----------------------------------------------------------------------------
insert into marketplace.schema_migrations (version, name) values ('26', '26_v2_team_seats_saved_jobs_outbox');
