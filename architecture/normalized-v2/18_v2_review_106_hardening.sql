-- =============================================================================
-- LogLoads normalized-v2 — 18 hardening from the #106 security review (issue #187)
--
-- NON-ACTIVE PROTOTYPE. Not an approved migration. Applied after 16_v2_identity_membership_hardening.sql.
-- Run order: 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18.
-- Apply exactly once, in one transaction: psql -v ON_ERROR_STOP=1 --single-transaction -f 18_...sql
--
-- Fixes (issue #187; the rows marked for this schema):
--   HF-03  A landing's decline is final for that job. withdraw_interest refused nothing, so a declined inquiry
--          could be withdrawn and then renewed by submit_expression_of_interest (which refuses only `declined`),
--          putting it back in the landing's inbox. A declined inquiry can no longer be withdrawn.
--   HF-05  No directory enumeration. app_users rows are readable only by the person, people who share an
--          organization with them, the other side of an inquiry or invitation, and platform staff (02 let any
--          signed-in user list every active user). Organizations are readable only when they have a public
--          presence (an active landing, or a hauling business that consented to discovery, F1), by their own
--          members and invitees, by the other side of an inquiry or invitation, and by platform staff (02 let
--          anyone list every active organization). organizations.created_by is no longer client-readable.
--   HF-06  Editing a verified qualification returns it to self-reported (audited), as LE-08 does for an
--          organization's legal name.
--   HF-15  The last-owner check locks the organization first, so two owners leaving at once cannot leave
--          the organization with no owner.
--   HF-16  The reporter of an abuse report no longer reads which staff member reviewed it (B-8/LE-06).
--   HF-17  estimate_boost_audience counts availability only from hauling businesses that consented to public
--          discovery (F1), as its hauler count already did.
--   HF-18  New functions created by the migration role no longer get EXECUTE for PUBLIC. 02's per-schema
--          ALTER DEFAULT PRIVILEGES ... REVOKE did nothing (a per-schema entry can only add to the global
--          default). The explicit per-function revokes stay.
--
-- DEPLOYMENT NOTE (HF-18): read before applying this file to a shared database.
--   * The default-privilege change is database-wide for the role that applies this file (on Supabase, `postgres`).
--     It is not limited to `marketplace`: every function that role creates afterwards, in any schema, gets no
--     EXECUTE for PUBLIC. That includes later supabase/migrations files and Dashboard SQL run as `postgres`.
--   * On Supabase, the per-schema defaults for `postgres` in `public` and `storage` still add their grants to the
--     API roles. Any other schema needs an explicit GRANT EXECUTE, and so does any other role, for example
--     supabase_auth_admin for an Auth hook. A helper called from an RLS policy fails with "permission denied for
--     function" without one.
--   * Extensions that Supabase installs belong to supabase_admin, and trigger functions need no EXECUTE when they
--     fire, so neither is affected.
--   * Dropping the `marketplace` schema does not undo it. To revert it, run
--     ALTER DEFAULT PRIVILEGES FOR ROLE <that role> GRANT EXECUTE ON FUNCTIONS TO PUBLIC.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Migration-order guard: requires 16, refuses a repeat. Runs before any change.
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_advisory_xact_lock(hashtextextended('marketplace.schema_migrations', 0));
  -- Two statements: PL/pgSQL plans each condition whole, so the ledger is referenced only once it exists.
  if to_regclass('marketplace.schema_migrations') is null then
    raise exception 'migration 18 requires migration 16 to be applied first' using errcode = '55000';
  end if;
  if not exists (select 1 from marketplace.schema_migrations where version = '16') then
    raise exception 'migration 18 requires migration 16 to be applied first' using errcode = '55000';
  end if;
  if exists (select 1 from marketplace.schema_migrations where version = '18') then
    raise exception 'migration 18 is already applied (%); re-running it is refused and nothing was changed',
      (select applied_at from marketplace.schema_migrations where version = '18')
      using errcode = '55000', hint = 'Migrations are forward-only.';
  end if;
  if to_regprocedure('marketplace.can_view_user_qualifications(uuid)') is null
     or to_regprocedure('marketplace.audit_event_actor(bigint)') is null then
    raise exception 'migration 18 requires the current 16 (B-2 and LE-06); this database applied an earlier 16'
      using errcode = '55000';
  end if;
  if to_regprocedure('marketplace.can_view_app_user(uuid)') is not null then
    raise exception 'migration 18 appears to be applied already (marketplace.can_view_app_user exists) but is not recorded; refusing to re-run'
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
    perform set_config('logloads.migration_refused', '18', false);
  end if;
end
$$;
-- The refusal needs no session state (a pooler may run this statement on another backend); see 06.
do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    raise exception 'migration 18 must be applied in one transaction (psql --single-transaction); nothing was changed'
      using errcode = '25P01', hint = 'This session (or pooled backend) was made read-only to stop the rest of the file.';
  end if;
  if coalesce(current_setting('logloads.migration_refused', true), '') <> '' then
    raise exception 'migration 18 refused: this session was made read-only by an earlier non-atomic attempt (migration %); reconnect and apply it with psql --single-transaction',
      current_setting('logloads.migration_refused')
      using errcode = '25P01';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- HF-03. A decline is final for that job.
-- 03's function, with the declined refusal. Unchanged rules are kept verbatim. submit_expression_of_interest
-- (06) already refuses a declined inquiry, so the inquiry stays declined and out of the landing's open inbox.
-- -----------------------------------------------------------------------------
create or replace function marketplace.withdraw_interest(p_interest_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare v_row marketplace.expressions_of_interest;
begin
  select * into v_row from marketplace.expressions_of_interest where id = p_interest_id for update;
  if not found or not marketplace.has_org_role(v_row.hauler_org_id, array['owner', 'manager', 'staff', 'driver']) then
    raise exception 'not authorized for this inquiry' using errcode = '42501';
  end if;
  if v_row.status = 'withdrawn' then
    return;
  end if;
  if v_row.status = 'declined' then
    raise exception 'The landing has closed this inquiry' using errcode = '23514',
      hint = 'A declined inquiry stays closed; it cannot be withdrawn and sent again.';
  end if;
  update marketplace.expressions_of_interest
  set status = 'withdrawn',
      withdrawn_at = now(),
      private_details_shared_at = null,
      private_details_shared_by = null
  where id = p_interest_id;
  perform marketplace.write_audit('interest.withdrawn', 'expressions_of_interest', p_interest_id, v_row.hauler_org_id);
end
$$;

-- -----------------------------------------------------------------------------
-- HF-05. No directory enumeration of people or organizations.
-- The V2 contract reads people and organizations only through SECURITY DEFINER functions (INTERFACE_CONTRACT
-- §0), which these policies do not affect. The helpers below are SECURITY DEFINER so the policies that call them
-- never re-enter another table's policies (landings_public / landings_read read organizations under RLS).
-- -----------------------------------------------------------------------------

-- Publicly discoverable: an active organization that runs an active landing, or a hauling business that
-- consented to public discovery (F1). Exactly the organizations whose landings, jobs or profile are public.
create or replace function marketplace.org_has_public_presence(p_org uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select exists (
    select 1 from marketplace.organizations o
    where o.id = p_org
      and o.status = 'active'
      and (exists (select 1 from marketplace.landings l where l.org_id = o.id and l.status = 'active')
           or exists (select 1 from marketplace.hauler_profiles h
                      where h.org_id = o.id and h.is_public and h.public_listing_consent_at is not null))
  )
$$;

-- A signed-in person also reads an organization they belong to or were invited to (any membership row,
-- so an invitee sees who invited them), and the other side of an inquiry or a targeted invitation.
create or replace function marketplace.can_view_organization(p_org uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select marketplace.org_has_public_presence(p_org)
      or exists (select 1 from marketplace.organization_memberships m
                 where m.org_id = p_org and m.user_id = marketplace.current_user_id())
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

-- A person's profile row is readable by people who share an organization with them (any of their memberships
-- in an organization the caller is an active member of), by the person who invited them, and by the other side
-- of an inquiry (its sender, the landing member who shared access details, message authors) or of a targeted
-- invitation (its sender). Self and platform staff are handled by the policy.
create or replace function marketplace.can_view_app_user(p_user uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select exists (select 1 from marketplace.organization_memberships m
                 where m.user_id = p_user
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

drop policy if exists app_users_read on marketplace.app_users;
create policy app_users_read on marketplace.app_users for select to authenticated
  using (id = (select marketplace.current_user_id())
         or marketplace.is_platform_admin()
         or (status = 'active' and marketplace.can_view_app_user(id)));

drop policy if exists organizations_public on marketplace.organizations;
create policy organizations_public on marketplace.organizations for select to anon
  using (marketplace.org_has_public_presence(id));

drop policy if exists organizations_read on marketplace.organizations;
create policy organizations_read on marketplace.organizations for select to authenticated
  using (id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
         or marketplace.is_platform_admin()
         or marketplace.can_view_organization(id));

-- Who created an organization is not client-readable (16 granted the column). Owners see the creator of their
-- own organization through audit_event_actor ('organization.created').
revoke select (created_by) on marketplace.organizations from authenticated;

-- -----------------------------------------------------------------------------
-- HF-06. Editing a verified qualification returns it to self-reported (audited), mirroring LE-08.
-- A rejected qualification stays rejected when edited: clearing it would erase the reviewer's verdict.
-- The audit row names the changed columns, never their values (evidence_path is a private Storage key).
-- -----------------------------------------------------------------------------
create or replace function marketplace.tg_qualification_verification_reset()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_changed text[];
begin
  if old.verification_status = 'verified' and new.verification_status = 'verified' then
    v_changed := array_remove(array[
      case when new.user_id is distinct from old.user_id then 'user_id' end,
      case when new.kind is distinct from old.kind then 'kind' end,
      case when new.label is distinct from old.label then 'label' end,
      case when new.issuing_region is distinct from old.issuing_region then 'issuing_region' end,
      case when new.expires_on is distinct from old.expires_on then 'expires_on' end,
      case when new.evidence_path is distinct from old.evidence_path then 'evidence_path' end
    ], null);
    if cardinality(v_changed) > 0 then
      new.verification_status := 'self_reported';
      new.reviewed_by := null;
      new.reviewed_at := null;
      perform marketplace.write_audit(
        'qualification.verification_reset', 'user_qualifications', new.id, null,
        'the qualification changed after verification',
        jsonb_build_object('changed', to_jsonb(v_changed)));
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists qualification_verification_reset on marketplace.user_qualifications;
create trigger qualification_verification_reset
  before update on marketplace.user_qualifications
  for each row execute function marketplace.tg_qualification_verification_reset();

-- -----------------------------------------------------------------------------
-- HF-15. 16's membership guard, with the organization row locked before the last-owner check. Two owners leaving
-- (or stepping down) at the same time now take turns, so the second sees the first one's change and is refused.
-- Unchanged rules are kept verbatim.
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
      perform 1 from marketplace.organizations o where o.id = old.org_id for update;
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
-- HF-16. The reporter reads their report's status and outcome, not the reviewer's identity (B-8/LE-06).
-- -----------------------------------------------------------------------------
revoke select on marketplace.abuse_reports from authenticated;
grant select (id, reporter_user_id, target_kind, target_id, reason, details, status, reviewed_at, resolution_note, created_at)
  on marketplace.abuse_reports to authenticated;

-- -----------------------------------------------------------------------------
-- HF-17. 03's estimate, with both counts limited to hauling businesses that consented to public discovery (F1)
-- and are active. Availability from a private business is no longer counted, so a landing cannot locate one by
-- moving its public point and re-reading the count. Unchanged rules are kept verbatim.
-- -----------------------------------------------------------------------------
create or replace function marketplace.estimate_boost_audience(p_job_id uuid, p_product_code text default 'quick')
returns table (radius_miles integer, opted_in_haulers integer, active_availability_reports integer)
language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_org    uuid;
  v_point  extensions.geography;
  v_radius integer;
  v_m      double precision;
begin
  select j.org_id, l.public_point into v_org, v_point
  from marketplace.job_postings j join marketplace.landings l on l.id = j.landing_id
  where j.id = p_job_id;
  if v_org is null or not marketplace.has_org_role(v_org, array['owner', 'manager', 'staff'], true) then
    raise exception 'not authorized for this job' using errcode = '42501';
  end if;
  select coalesce(bp.radius_miles, 100) into v_radius
  from marketplace.boost_products bp where bp.code = p_product_code and bp.status = 'active';
  v_radius := coalesce(v_radius, 100);
  v_m := v_radius::double precision * 1609.344 + 8000.0;

  return query
  select v_radius,
    (select count(*)::integer from marketplace.hauler_profiles h
     join marketplace.organizations o on o.id = h.org_id and o.status = 'active'
     where h.is_public and h.public_listing_consent_at is not null and h.service_center is not null
       and extensions.st_dwithin(h.service_center, v_point, v_m)),
    (select count(*)::integer from marketplace.availability_reports ar
     join marketplace.hauler_profiles h on h.org_id = ar.org_id and h.is_public and h.public_listing_consent_at is not null
     join marketplace.organizations o on o.id = ar.org_id and o.status = 'active'
     where ar.withdrawn_at is null and ar.available_until >= current_date
       and extensions.st_dwithin(ar.area_center, v_point, v_m));
end
$$;

-- -----------------------------------------------------------------------------
-- HF-18 (D-11). Functions the migration role creates from now on carry no EXECUTE for PUBLIC, in any schema.
-- Without IN SCHEMA this changes the role's global default, which is the only default a REVOKE can narrow.
-- It covers every function this role creates in this database (not only in marketplace); anything that relied on
-- PUBLIC execute of a new function must grant it explicitly. Every marketplace function keeps its explicit revoke.
-- -----------------------------------------------------------------------------
alter default privileges for role current_user revoke execute on functions from public;

-- -----------------------------------------------------------------------------
-- Grants. withdraw_interest, estimate_boost_audience and tg_membership_guard keep their existing grants
-- (CREATE OR REPLACE keeps the ACL).
-- -----------------------------------------------------------------------------
revoke all on function
  marketplace.org_has_public_presence(uuid),
  marketplace.can_view_organization(uuid),
  marketplace.can_view_app_user(uuid),
  marketplace.tg_qualification_verification_reset()
  from public, anon, authenticated, service_role;
grant execute on function marketplace.org_has_public_presence(uuid) to anon, authenticated;
grant execute on function
  marketplace.can_view_organization(uuid),
  marketplace.can_view_app_user(uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Record this migration.
-- -----------------------------------------------------------------------------
insert into marketplace.schema_migrations (version, name) values ('18', '18_v2_review_106_hardening');
