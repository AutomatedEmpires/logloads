-- =============================================================================
-- LogLoads normalized-v2 — 02 access (helpers, integrity triggers, RLS, grants)
-- NON-ACTIVE PROTOTYPE. See 01_schema.sql header.
--
-- Trust model:
--   * The only identity input is verified JWT claims (`request.jwt.claims`),
--     resolved through marketplace.current_user_id(). Client-supplied user,
--     org, or role values are never trusted; policies derive them.
--   * Organization roles (organization_memberships) and platform staff
--     privileges (platform_admins) are separate tables and separate helpers.
--   * Cross-table checks inside RLS policies use narrow SECURITY DEFINER
--     helpers with fixed search_path so PostgreSQL never hits recursive RLS
--     evaluation (e.g. job_postings <-> expressions_of_interest).
--   * No table is granted to service_role. Server workers get EXECUTE on a
--     short list of SECURITY DEFINER functions (03_entitlements.sql).
-- =============================================================================

-- Plain-PostgreSQL / CI bootstrap: these roles already exist on Supabase.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin noinherit nobypassrls', r);
    end if;
    execute format('grant %I to %I', r, current_user);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- Helpers (all STABLE; SECURITY DEFINER so policies never recurse through RLS)
-- -----------------------------------------------------------------------------

-- Single place that decides whether a subscription row grants plan entitlements
-- right now:
--   * `trialing` / `active` require `now() < current_period_end`.
--   * `past_due` requires an explicit bounded grace window (`now() < grace_ends_at`).
create function marketplace.subscription_is_entitling(
  p_status text,
  p_period_end timestamptz default 'infinity'::timestamptz,
  p_grace_ends_at timestamptz default null
)
returns boolean language sql stable
set search_path = pg_catalog, pg_temp
as $$
  select (p_status in ('trialing', 'active') and now() < p_period_end)
      or (p_status = 'past_due' and p_grace_ends_at is not null and now() < p_grace_ends_at)
$$;

-- When p_require_landing_seat = true, only memberships holding a paid Landing
-- Operator workspace seat (`landing_workspace_seat = true`) qualify. Free
-- fleet-only drivers and fleet-only staff (`landing_workspace_seat = false`)
-- retain full Hauler/Fleet workspace access (`p_require_landing_seat = false`)
-- without consuming a paid landing seat or gaining Landing Operator access.
create function marketplace.my_org_ids(p_roles text[], p_require_landing_seat boolean default false)
returns setof uuid language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select m.org_id
  from marketplace.organization_memberships m
  join marketplace.organizations o on o.id = m.org_id and o.status = 'active'
  where m.user_id = marketplace.current_user_id()
    and m.status = 'active'
    and m.role = any (p_roles)
    and (not p_require_landing_seat or m.landing_workspace_seat)
$$;

create function marketplace.has_org_role(p_org uuid, p_roles text[], p_require_landing_seat boolean default false)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$ select exists (select 1 from marketplace.my_org_ids(p_roles, p_require_landing_seat) x where x = p_org) $$;

-- NULL p_roles = any active staff role; superadmin satisfies every role.
create function marketplace.is_platform_admin(p_roles text[] default null)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select exists (
    select 1 from marketplace.platform_admins a
    where a.user_id = marketplace.current_user_id()
      and a.revoked_at is null
      and (p_roles is null or a.admin_role = 'superadmin' or a.admin_role = any (p_roles))
  )
$$;

-- Internal: the plan row currently entitling an org (NULL when none or expired).
create function marketplace.org_entitled_plan(p_org uuid)
returns marketplace.subscription_plans language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select p.*
  from marketplace.organization_subscriptions s
  join marketplace.subscription_plans p on p.id = s.plan_id
  where s.org_id = p_org
    and marketplace.subscription_is_entitling(s.status, s.current_period_end, s.grace_ends_at)
  limit 1
$$;

-- Callers must hold a Landing Operator seat on p_org (no plan enumeration).
create function marketplace.org_has_feature(p_org uuid, p_feature text)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select marketplace.has_org_role(p_org, array['owner', 'manager', 'staff'], true)
     and coalesce(p_feature = any ((marketplace.org_entitled_plan(p_org)).features), false)
$$;

-- True when the caller holds a paid Landing Operator seat at an entitled org (directory access).
create function marketplace.current_user_has_landing_access()
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select exists (
    select 1 from marketplace.organization_subscriptions s
    where s.org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true))
      and marketplace.subscription_is_entitling(s.status, s.current_period_end, s.grace_ends_at)
  )
$$;

-- Non-recursive visibility helpers used by RLS policies where cross-table
-- checks would otherwise cycle (job_postings <-> expressions_of_interest <-> interest_messages).
create function marketplace.job_is_publicly_visible(p_job uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select exists (
    select 1
    from marketplace.job_postings j
    join marketplace.landings l on l.id = j.landing_id and l.status = 'active'
    join marketplace.organizations o on o.id = j.org_id and o.status = 'active'
    where j.id = p_job
      and j.status = 'active'
      and (j.expires_at is null or j.expires_at > now())
  )
$$;

create function marketplace.can_read_job_posting(p_job uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select marketplace.job_is_publicly_visible(p_job)
      or marketplace.is_platform_admin()
      or exists (
        select 1 from marketplace.job_postings j
        where j.id = p_job
          and j.org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true))
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

create function marketplace.can_access_interest(p_interest uuid, p_write_side text default null)
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
           or marketplace.is_platform_admin()
        ))
        or (p_write_side = 'hauler' and e.status <> 'withdrawn'
            and e.hauler_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver'])))
        or (p_write_side = 'landing' and e.status <> 'withdrawn'
            and e.job_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true)))
      )
  )
$$;

-- Private landing access: the landing's own desk staff (`landing_workspace_seat = true`),
-- or a hauler org whose interest on a live job at that landing was explicitly shared.
-- Platform admins are deliberately absent (see admin_read_landing_private).
create function marketplace.can_view_landing_private(p_landing uuid)
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
      and e.status <> 'withdrawn'
      and e.private_details_shared_at is not null
      and e.hauler_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
  )
$$;

-- Public points are snapped to the center of a coarse 0.1° (~11 km / ~7 mi)
-- grid cell (`floor(coord / 0.1) * 0.1 + 0.05`) so exact gate or spur-road
-- coordinates are never stored on public rows, even if input lies on a 0.1° line.
create function marketplace.approximate_point(p extensions.geography)
returns extensions.geography language sql immutable
set search_path = pg_catalog, extensions, pg_temp
as $$
  select case
    when p is null then null
    else extensions.st_setsrid(
      extensions.st_makepoint(
        floor(extensions.st_x(p::extensions.geometry) / 0.1) * 0.1 + 0.05,
        floor(extensions.st_y(p::extensions.geometry) / 0.1) * 0.1 + 0.05
      ),
      4326
    )::extensions.geography
  end
$$;

-- Internal audit writer used by workflow functions.
create function marketplace.write_audit(
  p_action text, p_entity_table text, p_entity_id uuid, p_org_id uuid,
  p_reason text default null, p_metadata jsonb default '{}', p_as_admin boolean default false
) returns void language sql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  insert into marketplace.audit_events (actor_user_id, actor_kind, org_id, action, entity_table, entity_id, reason, metadata)
  values (
    marketplace.current_user_id(),
    case when p_as_admin then 'platform_admin'
         when marketplace.current_user_id() is null then 'system'
         else 'user' end,
    p_org_id, p_action, p_entity_table, p_entity_id, p_reason, coalesce(p_metadata, '{}')
  )
$$;

-- -----------------------------------------------------------------------------
-- Integrity triggers
-- -----------------------------------------------------------------------------

create function marketplace.tg_set_updated_at()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp
as $$ begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'app_users', 'user_contacts', 'organizations', 'organization_memberships', 'notification_preferences',
    'hauler_profiles', 'user_qualifications', 'equipment_units', 'landings', 'landing_private_details',
    'job_postings', 'job_templates', 'saved_searches', 'expressions_of_interest',
    'organization_subscriptions', 'entitlement_periods', 'invitation_deliveries', 'job_boosts'
  ] loop
    execute format(
      'create trigger set_updated_at before update on marketplace.%I
         for each row execute function marketplace.tg_set_updated_at()', t);
  end loop;
end
$$;

-- Landing activation is the only place the active-landing limit is enforced.
-- Locking the organization row serializes concurrent activations per org.
create function marketplace.tg_landing_guard()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_plan    marketplace.subscription_plans;
  v_active  integer;
  v_members integer;
begin
  new.public_point := marketplace.approximate_point(new.public_point);
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then
    raise exception 'landings cannot move between organizations' using errcode = '42501';
  end if;
  if new.status = 'active' and (tg_op = 'INSERT' or old.status <> 'active') then
    perform 1 from marketplace.organizations o where o.id = new.org_id and o.status = 'active' for update;
    if not found then
      raise exception 'organization is not active' using errcode = '42501';
    end if;
    v_plan := marketplace.org_entitled_plan(new.org_id);
    if v_plan.id is null then
      raise exception 'an active landing subscription is required to activate a landing' using errcode = '23514';
    end if;
    select count(*) into v_members
    from marketplace.organization_memberships m
    where m.org_id = new.org_id and m.status in ('invited', 'active') and m.landing_workspace_seat;
    if v_members > v_plan.max_team_members then
      raise exception 'organization has % paid landing seats which exceeds plan % limit of %; resolve seat conflict before activating landings',
        v_members, v_plan.name, v_plan.max_team_members
        using errcode = '23514', hint = 'Remove or convert excess landing seats to fleet-only, or upgrade your subscription.';
    end if;
    if v_plan.max_active_landings is not null then
      select count(*) into v_active
      from marketplace.landings l
      where l.org_id = new.org_id and l.status = 'active' and l.id <> new.id;
      if v_active >= v_plan.max_active_landings then
        raise exception 'plan % allows % active landing(s)', v_plan.name, v_plan.max_active_landings
          using errcode = '23514', hint = 'Deactivate another landing or change plan.';
      end if;
    end if;
    new.activated_at := now();
  end if;
  return new;
end
$$;
create trigger landing_guard before insert or update on marketplace.landings
  for each row execute function marketplace.tg_landing_guard();

-- Deactivating a landing pauses its active postings (and therefore its boosts).
create function marketplace.tg_landing_after()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
begin
  if old.status = 'active' and new.status <> 'active' then
    update marketplace.job_postings set status = 'paused'
    where landing_id = new.id and status = 'active';
  end if;
  return null;
end
$$;
create trigger landing_after after update of status on marketplace.landings
  for each row execute function marketplace.tg_landing_after();

-- Postings are unlimited; they require an active landing, an entitled org,
-- no unresolved downgrade seat/landing limit conflict, and transparent pay
-- terms (Item 9) unless `app.allow_unquoted_active_jobs = 'true'` is explicitly set.
create function marketplace.tg_job_guard()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_plan     marketplace.subscription_plans;
  v_members  integer;
  v_landings integer;
begin
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then
    raise exception 'job postings cannot move between organizations' using errcode = '42501';
  end if;
  if new.status = 'active'
     and new.pay_unit is null
     and coalesce(current_setting('app.allow_unquoted_active_jobs', true), 'false') <> 'true' then
    raise exception 'published job postings must state a pay rate and pay unit (or pay_unit = negotiable with pay_note); omitting pay on active postings requires explicit founder policy approval (app.allow_unquoted_active_jobs)'
      using errcode = '23514', hint = 'Provide pay_amount_cents + pay_unit, or set pay_unit = ''negotiable'' with a pay_note.';
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
    new.published_at := coalesce(new.published_at, now());
    new.last_confirmed_at := now();
  elsif tg_op = 'UPDATE' and new.status = 'active'
    and (new.pay_amount_cents, new.pay_unit, new.trucks_requested, new.work_starts_on, new.work_ends_on, new.last_confirmed_at)
        is distinct from
        (old.pay_amount_cents, old.pay_unit, old.trucks_requested, old.work_starts_on, old.work_ends_on, old.last_confirmed_at) then
    new.last_confirmed_at := now(); -- reconfirmation is always server-timestamped
  end if;
  return new;
end
$$;
create trigger job_guard before insert or update on marketplace.job_postings
  for each row execute function marketplace.tg_job_guard();

-- Membership rules: consent to join, self-service limits, last-owner
-- protection, and paid Landing Operator workspace seat limits (Item 2):
--   * Free fleet-only drivers (`role = 'driver', landing_workspace_seat = false`)
--     and fleet-only staff (`role in ('manager', 'staff'), landing_workspace_seat = false`)
--     never consume paid landing seats and are blocked by RLS from all
--     Landing Operator actions.
--   * Paid landing workspace seats (`landing_workspace_seat = true`) are capped
--     at `v_plan.max_team_members` (2 Basic / 5 Pro / 10 Regional).
create function marketplace.tg_membership_guard()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_actor uuid := marketplace.current_user_id();
  v_plan  marketplace.subscription_plans;
  v_count integer;
begin
  if new.role = 'driver' then
    new.landing_workspace_seat := false;
  elsif new.role = 'owner' then
    new.landing_workspace_seat := true;
  end if;

  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id or new.user_id <> old.user_id then
      raise exception 'membership identity is immutable' using errcode = '42501';
    end if;
    if old.status = 'invited' and new.status = 'active' and v_actor is distinct from new.user_id and v_actor is not null then
      raise exception 'only the invited person can accept a membership' using errcode = '42501';
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
create trigger membership_guard before insert or update on marketplace.organization_memberships
  for each row execute function marketplace.tg_membership_guard();

create function marketplace.tg_hauler_profile_guard()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then
    raise exception 'hauler profiles cannot move between organizations' using errcode = '42501';
  end if;
  new.service_center := marketplace.approximate_point(new.service_center);
  if new.accepts_targeted_invitations and (tg_op = 'INSERT' or not old.accepts_targeted_invitations) then
    new.invitation_consent_at := now();
    new.invitation_consent_by := marketplace.current_user_id();
  end if;
  if tg_op = 'UPDATE' then
    new.last_confirmed_at := now();
  end if;
  return new;
end
$$;
create trigger hauler_profile_guard before insert or update on marketplace.hauler_profiles
  for each row execute function marketplace.tg_hauler_profile_guard();

create function marketplace.tg_availability_guard()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
begin
  new.area_center := marketplace.approximate_point(new.area_center);
  if tg_op = 'UPDATE' then
    new.reported_at := now(); -- every edit is a fresh self-report
  end if;
  return new;
end
$$;
create trigger availability_guard before insert or update on marketplace.availability_reports
  for each row execute function marketplace.tg_availability_guard();

-- A landing-side reply moves the inquiry to "replied". Never metered.
create function marketplace.tg_interest_message_after()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
begin
  if new.author_side = 'landing' then
    update marketplace.expressions_of_interest
    set status = case when status in ('submitted', 'viewed') then 'replied' else status end,
        responded_at = coalesce(responded_at, now())
    where id = new.interest_id and status <> 'withdrawn';
  end if;
  return null;
end
$$;
create trigger interest_message_after after insert on marketplace.interest_messages
  for each row execute function marketplace.tg_interest_message_after();

create function marketplace.tg_audit_append_only()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp
as $$ begin raise exception 'audit_events is append-only' using errcode = '42501'; end $$;
create trigger audit_append_only before update or delete on marketplace.audit_events
  for each row execute function marketplace.tg_audit_append_only();
create trigger audit_no_truncate before truncate on marketplace.audit_events
  for each statement execute function marketplace.tg_audit_append_only();

-- -----------------------------------------------------------------------------
-- Row-level security. Role sets used below:
--   ALL  = owner, manager, staff, driver   DESK = owner, manager, staff
--   MGR  = owner, manager                  OWNER = owner
-- `x in (select marketplace.my_org_ids(...))` is evaluated once per statement.
-- -----------------------------------------------------------------------------

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'marketplace' loop
    execute format('alter table marketplace.%I enable row level security', t);
  end loop;
end
$$;

-- Users & identity -------------------------------------------------------------
create policy app_users_read on marketplace.app_users for select to authenticated
  using (status = 'active' or id = (select marketplace.current_user_id()) or marketplace.is_platform_admin());
create policy app_users_self_update on marketplace.app_users for update to authenticated
  using (id = (select marketplace.current_user_id())) with check (id = (select marketplace.current_user_id()));

create policy identity_links_self on marketplace.identity_links for select to authenticated
  using (user_id = (select marketplace.current_user_id()));

create policy user_contacts_self_or_support on marketplace.user_contacts for select to authenticated
  using (user_id = (select marketplace.current_user_id()) or marketplace.is_platform_admin(array['support']));

create policy platform_admins_self_or_super on marketplace.platform_admins for select to authenticated
  using (user_id = (select marketplace.current_user_id()) or marketplace.is_platform_admin(array['superadmin']));

-- Organizations & membership ---------------------------------------------------
create policy organizations_public on marketplace.organizations for select to anon using (status = 'active');
create policy organizations_read on marketplace.organizations for select to authenticated
  using (status = 'active'
         or id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
         or marketplace.is_platform_admin());
create policy organizations_owner_update on marketplace.organizations for update to authenticated
  using (id in (select marketplace.my_org_ids(array['owner'])))
  with check (id in (select marketplace.my_org_ids(array['owner'])));

create policy memberships_read on marketplace.organization_memberships for select to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
         or user_id = (select marketplace.current_user_id())
         or marketplace.is_platform_admin());
create policy memberships_owner_invite on marketplace.organization_memberships for insert to authenticated
  with check (org_id in (select marketplace.my_org_ids(array['owner'])) and status = 'invited');
create policy memberships_owner_update on marketplace.organization_memberships for update to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner'])))
  with check (org_id in (select marketplace.my_org_ids(array['owner'])));
create policy memberships_self_update on marketplace.organization_memberships for update to authenticated
  using (user_id = (select marketplace.current_user_id()))
  with check (user_id = (select marketplace.current_user_id()));

create policy notification_preferences_self on marketplace.notification_preferences for all to authenticated
  using (user_id = (select marketplace.current_user_id())
         and org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver'])))
  with check (user_id = (select marketplace.current_user_id())
              and org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver'])));

-- Hauler side ------------------------------------------------------------------
create policy hauler_profiles_read on marketplace.hauler_profiles for select to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
         or (is_public and marketplace.current_user_has_landing_access())
         or marketplace.is_platform_admin());
create policy hauler_profiles_insert on marketplace.hauler_profiles for insert to authenticated
  with check (org_id in (select marketplace.my_org_ids(array['owner', 'manager'])));
create policy hauler_profiles_update on marketplace.hauler_profiles for update to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner', 'manager'])))
  with check (org_id in (select marketplace.my_org_ids(array['owner', 'manager'])));

create policy user_qualifications_read on marketplace.user_qualifications for select to authenticated
  using (user_id = (select marketplace.current_user_id())
         or marketplace.current_user_has_landing_access()
         or marketplace.is_platform_admin());
create policy user_qualifications_self_insert on marketplace.user_qualifications for insert to authenticated
  with check (user_id = (select marketplace.current_user_id()));
create policy user_qualifications_self_update on marketplace.user_qualifications for update to authenticated
  using (user_id = (select marketplace.current_user_id())) with check (user_id = (select marketplace.current_user_id()));

create policy equipment_types_read on marketplace.equipment_types for select to anon, authenticated using (true);

create policy equipment_units_read on marketplace.equipment_units for select to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
         or marketplace.is_platform_admin()
         or (marketplace.current_user_has_landing_access()
             and exists (select 1 from marketplace.hauler_profiles h
                         join marketplace.organizations o on o.id = h.org_id and o.status = 'active'
                         where h.org_id = equipment_units.org_id and h.is_public)));
create policy equipment_units_insert on marketplace.equipment_units for insert to authenticated
  with check (org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'])));
create policy equipment_units_update on marketplace.equipment_units for update to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'])))
  with check (org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'])));

create policy availability_read on marketplace.availability_reports for select to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
         or marketplace.is_platform_admin()
         or (withdrawn_at is null and available_until >= current_date
             and marketplace.current_user_has_landing_access()
             and exists (select 1 from marketplace.hauler_profiles h
                         join marketplace.organizations o on o.id = h.org_id and o.status = 'active'
                         where h.org_id = availability_reports.org_id and h.is_public)));
create policy availability_insert on marketplace.availability_reports for insert to authenticated
  with check (org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
              and reported_by = (select marketplace.current_user_id()));
create policy availability_update on marketplace.availability_reports for update to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff']))
         or (reported_by = (select marketplace.current_user_id())
             and org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))))
  with check (org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver'])));

-- Landing side -----------------------------------------------------------------
-- NOTE (Item 7): `landings_public`, `job_postings_public`, `organizations_public`,
-- `job_equipment_public`, `plans_public`, and `boost_products_public` are RLS
-- `FOR SELECT TO anon` policies on the base tables (paired with column-level
-- `GRANT SELECT (...) TO anon`), NOT SQL `CREATE VIEW` objects (`0 views` exist).
-- All Landing Operator workspace policies require `my_org_ids(..., true)` so
-- free fleet-only staff (`landing_workspace_seat = false`) cannot access them.
create policy landings_public on marketplace.landings for select to anon
  using (status = 'active' and exists (select 1 from marketplace.organizations o where o.id = org_id and o.status = 'active'));
create policy landings_read on marketplace.landings for select to authenticated
  using ((status = 'active' and exists (select 1 from marketplace.organizations o where o.id = org_id and o.status = 'active'))
         or org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true))
         or marketplace.is_platform_admin());
create policy landings_insert on marketplace.landings for insert to authenticated
  with check (org_id in (select marketplace.my_org_ids(array['owner', 'manager'], true)));
create policy landings_update on marketplace.landings for update to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner', 'manager'], true)))
  with check (org_id in (select marketplace.my_org_ids(array['owner', 'manager'], true)));

create policy landing_private_read on marketplace.landing_private_details for select to authenticated
  using (marketplace.can_view_landing_private(landing_id));
create policy landing_private_insert on marketplace.landing_private_details for insert to authenticated
  with check (org_id in (select marketplace.my_org_ids(array['owner', 'manager'], true)));
create policy landing_private_update on marketplace.landing_private_details for update to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner', 'manager'], true)))
  with check (org_id in (select marketplace.my_org_ids(array['owner', 'manager'], true)));

create policy job_postings_public on marketplace.job_postings for select to anon
  using (marketplace.job_is_publicly_visible(id));
create policy job_postings_read on marketplace.job_postings for select to authenticated
  using (marketplace.can_read_job_posting(id));
create policy job_postings_insert on marketplace.job_postings for insert to authenticated
  with check (org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true)));
create policy job_postings_update on marketplace.job_postings for update to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true)))
  with check (org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true)));

create policy job_equipment_public on marketplace.job_posting_equipment for select to anon
  using (marketplace.job_is_publicly_visible(job_id));
create policy job_equipment_read on marketplace.job_posting_equipment for select to authenticated
  using (marketplace.can_read_job_posting(job_id));
create policy job_equipment_write on marketplace.job_posting_equipment for insert to authenticated
  with check (exists (select 1 from marketplace.job_postings j
                      where j.id = job_id and j.org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true))));
create policy job_equipment_remove on marketplace.job_posting_equipment for delete to authenticated
  using (exists (select 1 from marketplace.job_postings j
                 where j.id = job_id and j.org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true))));

-- Feature flags match LANDING_PLAN_FEATURES in packages/contracts/src/membership.ts:
--   posting_templates, advanced_hauler_search, availability_alerts.
create policy job_templates_read on marketplace.job_templates for select to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true)));
create policy job_templates_insert on marketplace.job_templates for insert to authenticated
  with check (org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true))
              and marketplace.org_has_feature(org_id, 'posting_templates'));
create policy job_templates_update on marketplace.job_templates for update to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true)))
  with check (marketplace.org_has_feature(org_id, 'posting_templates'));

create policy saved_searches_own on marketplace.saved_searches for all to authenticated
  using (owner_user_id = (select marketplace.current_user_id())
         and org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver'])))
  with check (owner_user_id = (select marketplace.current_user_id())
              and (
                (kind = 'jobs' and org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver'])))
                or (kind = 'trucks'
                    and org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true))
                    and marketplace.org_has_feature(org_id, 'advanced_hauler_search')
                    and (not alerts_enabled or marketplace.org_has_feature(org_id, 'availability_alerts')))
              ));

-- Inquiries ----------------------------------------------------------------------
create policy interests_read on marketplace.expressions_of_interest for select to authenticated
  using (hauler_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
         or job_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true))
         or marketplace.is_platform_admin());
create policy interests_hauler_insert on marketplace.expressions_of_interest for insert to authenticated
  with check (hauler_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
              and submitted_by = (select marketplace.current_user_id())
              and status = 'submitted'
              and exists (select 1 from marketplace.hauler_profiles h
                          join marketplace.organizations o on o.id = h.org_id and o.status = 'active'
                          where h.org_id = expressions_of_interest.hauler_org_id and h.is_public)
              and marketplace.job_is_publicly_visible(job_id));
create policy interests_hauler_edit on marketplace.expressions_of_interest for update to authenticated
  using (hauler_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver'])) and status <> 'withdrawn')
  with check (hauler_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver'])));

create policy interest_messages_read on marketplace.interest_messages for select to authenticated
  using (marketplace.can_access_interest(interest_id, null));
create policy interest_messages_insert on marketplace.interest_messages for insert to authenticated
  with check (author_user_id = (select marketplace.current_user_id())
              and marketplace.can_access_interest(interest_id, author_side));

-- Commercial records (read-only to clients; written by 03 functions) -------------
create policy plans_public on marketplace.subscription_plans for select to anon using (status = 'active');
create policy plans_read on marketplace.subscription_plans for select to authenticated
  using (status = 'active' or marketplace.is_platform_admin(array['billing']));
create policy boost_products_public on marketplace.boost_products for select to anon using (status = 'active');
create policy boost_products_read on marketplace.boost_products for select to authenticated
  using (status = 'active' or marketplace.is_platform_admin(array['billing']));
create policy promotions_read on marketplace.promotions for select to authenticated
  using (status = 'active' or marketplace.is_platform_admin(array['billing']));
create policy promotion_redemptions_read on marketplace.promotion_redemptions for select to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner'])) or marketplace.is_platform_admin(array['billing']));
create policy subscriptions_read on marketplace.organization_subscriptions for select to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner'])) or marketplace.is_platform_admin(array['billing']));
create policy entitlement_periods_read on marketplace.entitlement_periods for select to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner', 'manager'], true)) or marketplace.is_platform_admin(array['billing']));
create policy invitations_read on marketplace.targeted_invitations for select to authenticated
  using (sender_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true))
         or recipient_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']))
         or marketplace.is_platform_admin(array['support', 'billing']));
create policy invitation_deliveries_read on marketplace.invitation_deliveries for select to authenticated
  using (recipient_user_id = (select marketplace.current_user_id()) or marketplace.is_platform_admin(array['support']));
create policy job_boosts_read on marketplace.job_boosts for select to authenticated
  using (org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true))
         or marketplace.is_platform_admin(array['billing', 'support']));

-- Trust & audit ------------------------------------------------------------------
create policy abuse_reports_read on marketplace.abuse_reports for select to authenticated
  using (reporter_user_id = (select marketplace.current_user_id()) or marketplace.is_platform_admin(array['moderator', 'support']));
create policy abuse_reports_insert on marketplace.abuse_reports for insert to authenticated
  with check (reporter_user_id = (select marketplace.current_user_id()));
create policy audit_events_read on marketplace.audit_events for select to authenticated
  using (marketplace.is_platform_admin() or org_id in (select marketplace.my_org_ids(array['owner'])));
-- trusted_identity_issuers: RLS on, no policy, no grant => no client access.

-- -----------------------------------------------------------------------------
-- Grants: deny by default, then column-scoped grants. Columns maintained by
-- triggers/functions (status stamps, consent, verification, quotas) are never
-- client-writable.
-- -----------------------------------------------------------------------------

revoke all on schema marketplace from public;
grant usage on schema extensions to public, anon, authenticated, service_role;
grant execute on all functions in schema extensions to public, anon, authenticated, service_role;
grant usage on schema marketplace to anon, authenticated, service_role;
revoke all on all tables in schema marketplace from public, anon, authenticated, service_role;
revoke all on all sequences in schema marketplace from public, anon, authenticated, service_role;
revoke execute on all functions in schema marketplace from public, anon, authenticated, service_role;
alter default privileges in schema marketplace revoke execute on functions from public;

grant execute on function
  marketplace.contains_sensitive_access_pattern(text),
  marketplace.job_is_publicly_visible(uuid)
  to anon, authenticated;

grant execute on function
  marketplace.current_user_id(),
  marketplace.my_org_ids(text[], boolean),
  marketplace.has_org_role(uuid, text[], boolean),
  marketplace.is_platform_admin(text[]),
  marketplace.org_has_feature(uuid, text),
  marketplace.current_user_has_landing_access(),
  marketplace.can_read_job_posting(uuid),
  marketplace.can_access_interest(uuid, text),
  marketplace.can_view_landing_private(uuid)
  to authenticated;

-- Anonymous public browse: active landings (approximate points), active jobs, plan catalog.
grant select (id, display_name, slug, home_state, verification_status, status) on marketplace.organizations to anon;
grant select (id, org_id, name, status, public_area_label, public_point, state_code, county) on marketplace.landings to anon;
grant select (id, org_id, landing_id, title, description, product, destination_label, est_one_way_miles,
              est_daily_loads, est_tons_per_load, pay_amount_cents, pay_unit, pay_note, public_road_notes,
              trucks_requested, work_starts_on, work_ends_on, status, published_at, last_confirmed_at,
              expires_at) on marketplace.job_postings to anon;
grant select on marketplace.job_posting_equipment, marketplace.equipment_types,
                marketplace.subscription_plans, marketplace.boost_products to anon;

-- Authenticated.
grant select (id, display_name, avatar_path, bio, status, created_at) on marketplace.app_users to authenticated;
grant update (display_name, avatar_path, bio) on marketplace.app_users to authenticated;
grant select on marketplace.identity_links, marketplace.user_contacts, marketplace.platform_admins to authenticated;

grant select on marketplace.organizations to authenticated;
grant update (display_name, legal_name, slug, home_state) on marketplace.organizations to authenticated;
grant select on marketplace.organization_memberships to authenticated;
grant insert (org_id, user_id, role, landing_workspace_seat, status) on marketplace.organization_memberships to authenticated;
grant update (role, landing_workspace_seat, status) on marketplace.organization_memberships to authenticated;
grant select, insert, update on marketplace.notification_preferences to authenticated;

grant select on marketplace.hauler_profiles to authenticated;
grant insert (org_id, headline, description, base_area_label, service_center, service_radius_miles, operating_states,
              is_public, accepts_targeted_invitations, max_invitations_per_week) on marketplace.hauler_profiles to authenticated;
grant update (headline, description, base_area_label, service_center, service_radius_miles, operating_states,
              is_public, accepts_targeted_invitations, max_invitations_per_week) on marketplace.hauler_profiles to authenticated;
grant select (id, user_id, kind, label, issuing_region, expires_on, verification_status, reviewed_at, created_at, updated_at)
  on marketplace.user_qualifications to authenticated;
grant insert (user_id, kind, label, issuing_region, expires_on, evidence_path) on marketplace.user_qualifications to authenticated;
grant update (label, issuing_region, expires_on, evidence_path) on marketplace.user_qualifications to authenticated;
grant select on marketplace.equipment_types to authenticated;
grant select on marketplace.equipment_units to authenticated;
grant insert (org_id, equipment_code, unit_label, make, model, model_year, axle_count, capacity_note, photo_path, is_active)
  on marketplace.equipment_units to authenticated;
grant update (equipment_code, unit_label, make, model, model_year, axle_count, capacity_note, photo_path, is_active)
  on marketplace.equipment_units to authenticated;
grant select on marketplace.availability_reports to authenticated;
grant insert (org_id, equipment_code, available_count, area_center, area_label, radius_miles, available_from, available_until, note)
  on marketplace.availability_reports to authenticated;
grant update (available_count, area_center, area_label, radius_miles, available_from, available_until, note, withdrawn_at)
  on marketplace.availability_reports to authenticated;

grant select on marketplace.landings to authenticated;
grant insert (org_id, name, status, public_area_label, public_point, state_code, county) on marketplace.landings to authenticated;
grant update (name, status, public_area_label, public_point, state_code, county) on marketplace.landings to authenticated;
grant select on marketplace.landing_private_details to authenticated;
grant insert (landing_id, org_id, exact_point, directions, gate_instructions, site_contact_name, site_contact_phone)
  on marketplace.landing_private_details to authenticated;
grant update (exact_point, directions, gate_instructions, site_contact_name, site_contact_phone)
  on marketplace.landing_private_details to authenticated;
grant select on marketplace.job_postings to authenticated;
grant insert (org_id, landing_id, title, description, product, destination_label, est_one_way_miles,
              est_daily_loads, est_tons_per_load, pay_amount_cents, pay_unit, pay_note, public_road_notes,
              trucks_requested, work_starts_on, work_ends_on, status) on marketplace.job_postings to authenticated;
grant update (title, description, product, destination_label, est_one_way_miles,
              est_daily_loads, est_tons_per_load, pay_amount_cents, pay_unit, pay_note, public_road_notes,
              trucks_requested, work_starts_on, work_ends_on, status, last_confirmed_at) on marketplace.job_postings to authenticated;
grant select, insert, delete on marketplace.job_posting_equipment to authenticated;
grant select on marketplace.job_templates to authenticated;
grant insert (org_id, name, template) on marketplace.job_templates to authenticated;
grant update (name, template) on marketplace.job_templates to authenticated;
grant select, delete on marketplace.saved_searches to authenticated;
grant insert (org_id, kind, name, criteria, alerts_enabled) on marketplace.saved_searches to authenticated;
grant update (name, criteria, alerts_enabled) on marketplace.saved_searches to authenticated;

grant select on marketplace.expressions_of_interest to authenticated;
grant insert (job_id, job_org_id, hauler_org_id, trucks_offered, available_from, available_until, message, contact_preference)
  on marketplace.expressions_of_interest to authenticated;
grant update (trucks_offered, available_from, available_until, message, contact_preference) on marketplace.expressions_of_interest to authenticated;
grant select on marketplace.interest_messages to authenticated;
grant insert (interest_id, author_side, body) on marketplace.interest_messages to authenticated;

grant select on marketplace.subscription_plans, marketplace.boost_products, marketplace.promotions,
                marketplace.promotion_redemptions, marketplace.organization_subscriptions, marketplace.entitlement_periods,
                marketplace.targeted_invitations, marketplace.invitation_deliveries, marketplace.job_boosts,
                marketplace.audit_events to authenticated;
grant select on marketplace.abuse_reports to authenticated;
grant insert (target_kind, target_id, reason, details) on marketplace.abuse_reports to authenticated;
