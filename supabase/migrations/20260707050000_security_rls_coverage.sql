-- ============================================================================
-- SECURITY REMEDIATION (applied live to project fdzohbiiyzgvjzfsjyxo 2026-07-07)
--
-- Root cause reconciled: the foundation migration (20260604190000) predated the
-- RLS design and created 19 tables with no RLS. Phase-2 (20260706090000) enabled
-- RLS on 21 tables but only 5 of the foundation tables, leaving 14 foundation
-- tables uncovered. This migration closes that gap and locks the durability
-- mirror to the service role.
-- ============================================================================

-- --- 1. operating_state: server-only durability mirror. Service role only. ----
drop policy if exists "operating_state_rw" on public.operating_state;
revoke all on public.operating_state from anon, authenticated;

comment on table public.operating_state is
  'Server-only durability mirror. Written/read exclusively with the service-role key; never anon/authenticated. Holds the full operating-state snapshot.';

-- --- 2. Enable RLS on the 14 uncovered foundation tables ----------------------
alter table public.driver_profiles enable row level security;
alter table public.dispatcher_profiles enable row level security;
alter table public.loader_profiles enable row level security;
alter table public.truck_profiles enable row level security;
alter table public.trailer_profiles enable row level security;
alter table public.landings enable row level security;
alter table public.mills enable row level security;
alter table public.haul_routes enable row level security;
alter table public.rates enable row level security;
alter table public.availability_windows enable row level security;
alter table public.notifications enable row level security;
alter table public.message_threads enable row level security;
alter table public.message_events enable row level security;
alter table public.audit_events enable row level security;

-- --- Minimal, correct SELECT policies (writes go through service_role / DEFINER RPCs) ---
drop policy if exists driver_profiles_self_or_org_select on public.driver_profiles;
create policy driver_profiles_self_or_org_select on public.driver_profiles
  for select using (
    profile_id = public.current_profile_id()
    or (company_id is not null and public.is_org_member(company_id))
  );

drop policy if exists dispatcher_profiles_self_or_org_select on public.dispatcher_profiles;
create policy dispatcher_profiles_self_or_org_select on public.dispatcher_profiles
  for select using (
    profile_id = public.current_profile_id() or public.is_org_member(company_id)
  );

drop policy if exists loader_profiles_self_or_org_select on public.loader_profiles;
create policy loader_profiles_self_or_org_select on public.loader_profiles
  for select using (
    profile_id = public.current_profile_id() or public.is_org_member(company_id)
  );

drop policy if exists truck_profiles_owner_or_org_select on public.truck_profiles;
create policy truck_profiles_owner_or_org_select on public.truck_profiles
  for select using (
    owner_profile_id = public.current_profile_id()
    or (company_id is not null and public.is_org_member(company_id))
  );

drop policy if exists trailer_profiles_owner_select on public.trailer_profiles;
create policy trailer_profiles_owner_select on public.trailer_profiles
  for select using (owner_profile_id = public.current_profile_id());

drop policy if exists landings_org_select on public.landings;
create policy landings_org_select on public.landings
  for select using (company_id is not null and public.is_org_member(company_id));

drop policy if exists mills_public_select on public.mills;
create policy mills_public_select on public.mills
  for select using (true);

drop policy if exists haul_routes_org_select on public.haul_routes;
create policy haul_routes_org_select on public.haul_routes
  for select using (public.is_org_member(company_id));

drop policy if exists rates_org_select on public.rates;
create policy rates_org_select on public.rates
  for select using (public.is_org_member(company_id));

drop policy if exists availability_windows_participant_select on public.availability_windows;
create policy availability_windows_participant_select on public.availability_windows
  for select using (exists (
    select 1 from public.driver_profiles drivers
    where drivers.id = availability_windows.driver_profile_id
      and (
        drivers.profile_id = public.current_profile_id()
        or (drivers.company_id is not null and public.is_org_member(drivers.company_id))
      )
  ));

drop policy if exists notifications_owner_select on public.notifications;
create policy notifications_owner_select on public.notifications
  for select using (user_id = public.current_profile_id());

drop policy if exists message_threads_participant_select on public.message_threads;
create policy message_threads_participant_select on public.message_threads
  for select using (public.current_profile_id() = any(participant_user_ids));

drop policy if exists message_events_participant_select on public.message_events;
create policy message_events_participant_select on public.message_events
  for select using (exists (
    select 1 from public.message_threads threads
    where threads.id = message_events.thread_id
      and public.current_profile_id() = any(threads.participant_user_ids)
  ));

drop policy if exists audit_events_actor_select on public.audit_events;
create policy audit_events_actor_select on public.audit_events
  for select using (actor_user_id = public.current_profile_id());

-- --- 3. Function hardening ----------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.timezone('utc', pg_catalog.now());
  return new;
end;
$$;

create or replace function public.current_clerk_user_id()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'sub', '')
$$;

-- Postgres grants EXECUTE to PUBLIC by default; revoke there, then re-grant only
-- where a role genuinely needs it. authenticated retains EXECUTE on the internal
-- RLS helpers (required for policy evaluation under a Clerk JWT); anon does not.
revoke execute on function public.current_profile_id() from public;
grant execute on function public.current_profile_id() to authenticated, service_role;
revoke execute on function public.current_clerk_user_id() from public;
grant execute on function public.current_clerk_user_id() to authenticated, service_role;
revoke execute on function public.is_org_member(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;
revoke execute on function public.org_role_can(uuid, text[]) from public;
grant execute on function public.org_role_can(uuid, text[]) to authenticated, service_role;
revoke execute on function public.load_visible_to_org(uuid, uuid) from public;
grant execute on function public.load_visible_to_org(uuid, uuid) to authenticated, service_role;
revoke execute on function public.orgs_have_active_relationship(uuid, uuid) from public;
grant execute on function public.orgs_have_active_relationship(uuid, uuid) to authenticated, service_role;

-- Mutating RPC: server-side (service role) only.
revoke execute on function public.request_capacity(uuid, uuid, uuid, uuid, uuid, uuid, text) from public;
grant execute on function public.request_capacity(uuid, uuid, uuid, uuid, uuid, uuid, text) to service_role;

-- ============================================================================
-- ACCEPTED EXCEPTIONS (documented, not fixable without disproportionate risk):
--   * public.spatial_ref_sys — PostGIS system table, extension-owned, cannot take
--     RLS. Contains only public coordinate-reference definitions (no app data/PII).
--   * postgis installed in public schema — moving it risks breaking geography
--     columns; not a data-exposure vector.
--   * st_estimatedextent(...) — PostGIS extension functions callable via REST;
--     extension-owned (not revocable), geometry-extent estimators only.
-- ============================================================================
