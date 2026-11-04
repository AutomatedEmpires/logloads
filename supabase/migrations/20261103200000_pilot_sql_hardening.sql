-- ============================================================================
-- Pilot relational schema hardening (#187 HF-19, HF-20, HF-21; review #106).
--
-- Context, unchanged by this migration: the application reads and writes one
-- row of public.operating_state with the service-role key. No request path
-- reads or writes these relational tables as anon or authenticated, and the
-- helpers below are executable only by service_role (20260726090000). Every
-- change here is therefore hardening of latent paths; none alters what the
-- running product does. service_role keeps BYPASSRLS and its table grants, so
-- server-side reads of mills and destination_facilities are unaffected.
--
-- Additive: no data is rewritten or deleted. Each step is idempotent.
-- Behavioural checks: supabase/verify/20261103200000_pilot_sql_hardening.sql,
-- run by tools/db-check.sh after every local reset (the `migrations` CI check).
-- ============================================================================

-- --- HF-19a. A missing, empty or blank `sub` claim is no identity ------------
--
-- The previous body was coalesce(auth.jwt() ->> 'sub', ''), so a request with
-- no `sub` (a service-role call, for instance) resolved to '' and
-- current_profile_id() would match any profile whose clerk_user_id was ''.
-- Now such a claim yields NULL, and `clerk_user_id = NULL` matches nothing.
-- A present claim is returned exactly as sent (never trimmed), so identity
-- stays an exact match.
create or replace function public.current_clerk_user_id()
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when pg_catalog.btrim(claims.sub) = '' then null
    else claims.sub
  end
  from (select auth.jwt() ->> 'sub' as sub) as claims
$$;

-- The grants are unchanged (CREATE OR REPLACE keeps the ACL); restated so this
-- file alone shows the boundary.
revoke execute on function public.current_clerk_user_id() from public, anon, authenticated;
grant execute on function public.current_clerk_user_id() to service_role;

-- --- HF-19b. No profile can hold an empty or blank Clerk id -------------------
--
-- Every seeded and application-created profile carries a real Clerk id
-- (supabase/seed/001_backend_foundation.sql uses `clerk-…` ids). If a hosted
-- database ever held a blank one, adding the constraint fails and the
-- migration aborts, which is the intended outcome: that row needs a human
-- decision, not a silent rewrite.
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'profiles_clerk_user_id_not_blank'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_clerk_user_id_not_blank
      check (pg_catalog.btrim(clerk_user_id) <> '');
  end if;
end
$$;

-- --- HF-19c. Pin every SECURITY DEFINER helper to an empty search_path -------
--
-- These four were created with `set search_path = public`. Their bodies
-- already qualify every relation and function with `public.`, and built-ins
-- resolve through pg_catalog, which is always searched first.
alter function public.current_profile_id() set search_path = '';
alter function public.is_org_member(uuid) set search_path = '';
alter function public.orgs_have_active_relationship(uuid, uuid) set search_path = '';
alter function public.load_visible_to_org(uuid, uuid) set search_path = '';

-- --- HF-19d. request_capacity: the equipment must belong to the requester ----
--
-- The previous body checked the caller's role and the load's visibility, but
-- accepted any driver, truck or trailer id. It now mirrors the service rule
-- in packages/services/src/operating-network.ts (direct-offer acceptance): the
-- driver and the truck belong to p_company_id and are not archived, and a
-- trailer, when given, is attached to that truck. Same signature, same
-- return type; the search_path is now empty as well (HF-19c).
create or replace function public.request_capacity(
  p_company_id uuid,
  p_load_posting_id uuid,
  p_truck_slot_id uuid,
  p_driver_profile_id uuid,
  p_truck_profile_id uuid,
  p_trailer_profile_id uuid,
  p_dispatcher_notes text default null
)
returns public.assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_profile_id uuid := public.current_profile_id();
  v_slot public.truck_slots%rowtype;
  v_assignment public.assignments%rowtype;
begin
  if v_actor_profile_id is null then
    raise exception 'Authenticated profile is required';
  end if;

  if not public.org_role_can(p_company_id, array['request_assignment']) then
    raise exception 'Profile cannot request assignment for organization %', p_company_id;
  end if;

  if not public.load_visible_to_org(p_load_posting_id, p_company_id) then
    raise exception 'Load posting % is not visible to organization %', p_load_posting_id, p_company_id;
  end if;

  if not exists (
    select 1 from public.driver_profiles drivers
    where drivers.id = p_driver_profile_id
      and drivers.company_id = p_company_id
      and drivers.archived_at is null
  ) then
    raise exception 'Driver profile % does not belong to organization %', p_driver_profile_id, p_company_id;
  end if;

  if not exists (
    select 1 from public.truck_profiles trucks
    where trucks.id = p_truck_profile_id
      and trucks.company_id = p_company_id
      and trucks.archived_at is null
  ) then
    raise exception 'Truck profile % does not belong to organization %', p_truck_profile_id, p_company_id;
  end if;

  if p_trailer_profile_id is not null and not exists (
    select 1 from public.trailer_profiles trailers
    where trailers.id = p_trailer_profile_id
      and trailers.truck_id = p_truck_profile_id
  ) then
    raise exception 'Trailer profile % is not attached to truck profile %', p_trailer_profile_id, p_truck_profile_id;
  end if;

  select * into v_slot
  from public.truck_slots
  where id = p_truck_slot_id
    and load_posting_id = p_load_posting_id
  for update;

  if not found then
    raise exception 'Truck slot % was not found for load posting %', p_truck_slot_id, p_load_posting_id;
  end if;

  if v_slot.reserved_count >= v_slot.capacity then
    raise exception 'Truck slot % is already at capacity', p_truck_slot_id;
  end if;

  if exists (
    select 1 from public.assignments assignments
    where assignments.load_posting_id = p_load_posting_id
      and assignments.driver_profile_id = p_driver_profile_id
      and assignments.status in ('requested','offered','accepted','checked_in','loading','hauled')
  ) then
    raise exception 'Driver already has an active assignment request for this load';
  end if;

  update public.truck_slots
  set reserved_count = reserved_count + 1,
      status = case when status = 'open' then 'requested' else status end,
      updated_at = pg_catalog.timezone('utc', pg_catalog.now())
  where id = p_truck_slot_id;

  update public.opportunity_capacities
  set committed_truckloads = committed_truckloads + 1,
      remaining_truckloads = greatest(0, remaining_truckloads - 1),
      updated_at = pg_catalog.timezone('utc', pg_catalog.now())
  where load_posting_id = p_load_posting_id
    and remaining_truckloads > 0;

  if exists (select 1 from public.opportunity_capacities where load_posting_id = p_load_posting_id)
     and not found then
    raise exception 'No opportunity capacity remains for this load';
  end if;

  insert into public.assignments (
    load_posting_id,
    truck_slot_id,
    driver_profile_id,
    truck_profile_id,
    trailer_profile_id,
    status,
    requested_at,
    dispatcher_notes
  ) values (
    p_load_posting_id,
    p_truck_slot_id,
    p_driver_profile_id,
    p_truck_profile_id,
    p_trailer_profile_id,
    'requested',
    pg_catalog.timezone('utc', pg_catalog.now()),
    p_dispatcher_notes
  ) returning * into v_assignment;

  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, metadata)
  values (
    v_actor_profile_id,
    'assignment',
    v_assignment.id,
    'capacity_requested',
    pg_catalog.jsonb_build_object('companyId', p_company_id, 'loadPostingId', p_load_posting_id)
  );

  return v_assignment;
end;
$$;

revoke execute on function public.request_capacity(uuid, uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.request_capacity(uuid, uuid, uuid, uuid, uuid, uuid, text) to service_role;

-- --- HF-20. No anonymous reads of the relational schema -----------------------
--
-- mills_public_select and destination_facilities_select were `USING (true)`
-- with no TO clause, and anon still held SELECT, so the publishable key could
-- read every mill (contacts, access notes, exact coordinates) and every
-- destination facility. No anonymous reader exists: `git grep` finds no client
-- query of either table, the browser uses the anon key only for Storage
-- signed uploads, and public pages read the service layer's redacted view.
--
-- Replacement policies apply to authenticated only and follow the tenant rule
-- every other organization-owned table uses (landings_org_select): members of
-- the controlling organization. Shared platform destinations
-- (company_id / managed_by_company_id is null) are served only by the service
-- layer, which decides per viewer what to disclose.
drop policy if exists mills_public_select on public.mills;
drop policy if exists mills_member_select on public.mills;
create policy mills_member_select on public.mills
  for select
  to authenticated
  using (company_id is not null and public.is_org_member(company_id));
comment on policy mills_member_select on public.mills is
  'Members of the controlling organization only. Not public: rows hold contacts, access notes and exact coordinates. Shared platform mills are served through the service layer (service_role), never directly. Replaces mills_public_select (#187 HF-20).';

drop policy if exists destination_facilities_select on public.destination_facilities;
drop policy if exists destination_facilities_member_select on public.destination_facilities;
create policy destination_facilities_member_select on public.destination_facilities
  for select
  to authenticated
  using (managed_by_company_id is not null and public.is_org_member(managed_by_company_id));
comment on policy destination_facilities_member_select on public.destination_facilities is
  'Members of the managing organization only. Receiving and check-in details are disclosed per viewer by the service layer (service_role), never directly. Replaces destination_facilities_select (#187 HF-20).';

-- anon has no identity, so no row-level policy can admit it legitimately; the
-- only policies it ever passed were the two `USING (true)` ones above. Revoke
-- its SELECT on every table in the schema, enumerated from the catalog as in
-- 20260726090000 (same ownership guard, same exclusion of extension-owned
-- relations such as PostGIS's spatial_ref_sys). authenticated keeps SELECT,
-- which RLS filters.
do $$
declare
  target regclass;
  target_owner oid;
  skipped text[] := '{}';
begin
  for target, target_owner in
    select c.oid::regclass, c.relowner
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not exists (
        select 1
        from pg_catalog.pg_depend d
        where d.classid = 'pg_catalog.pg_class'::regclass
          and d.objid = c.oid
          and d.deptype = 'e'
      )
    order by c.oid::regclass::text
  loop
    if pg_catalog.pg_has_role(current_user, target_owner, 'usage') then
      execute pg_catalog.format('revoke select on table %s from anon', target);
    else
      skipped := skipped || target::text;
    end if;
  end loop;

  if pg_catalog.array_length(skipped, 1) is not null then
    raise exception 'not owned by %; anon SELECT left unchanged: %', current_user, skipped;
  end if;
end;
$$;

-- Future tables created by the migration role stop arriving anon-SELECTable.
-- Supabase's default ACL for this role is per schema (`IN SCHEMA public`), so
-- this per-schema revoke removes it (checked in supabase/verify).
alter default privileges in schema public
  revoke select on tables from anon;

-- --- HF-21. public.audit_events is append-only ---------------------------------
--
-- 1. The actor foreign key no longer rewrites history. ON DELETE SET NULL
--    erased the actor of every event when a profile was deleted; RESTRICT
--    refuses that delete instead. No code path deletes profiles: the
--    application keeps its users in operating_state and never writes this
--    table. A profile that must be erased is anonymized in place instead.
--    Every foreign key on actor_user_id is found from the catalog, so the
--    swap does not depend on the generated constraint name.
do $$
declare
  v_name name;
begin
  for v_name in
    select con.conname
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_attribute att
      on att.attrelid = con.conrelid
     and att.attnum = any (con.conkey)
    where con.conrelid = 'public.audit_events'::regclass
      and con.contype = 'f'
      and att.attname = 'actor_user_id'
  loop
    execute pg_catalog.format('alter table public.audit_events drop constraint %I', v_name);
  end loop;

  alter table public.audit_events
    add constraint audit_events_actor_user_id_fkey
    foreign key (actor_user_id) references public.profiles (id) on delete restrict;
end
$$;

-- 2. No role can change or remove an event once written, the table owner
--    included: a row trigger refuses every UPDATE and DELETE.
create or replace function public.audit_events_reject_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'public.audit_events is append-only; % is not allowed', tg_op
    using errcode = '42501';
end;
$$;

revoke execute on function public.audit_events_reject_change() from public, anon, authenticated, service_role;

drop trigger if exists audit_events_append_only on public.audit_events;
create trigger audit_events_append_only
  before update or delete on public.audit_events
  for each row execute function public.audit_events_reject_change();

-- 3. The API roles also lose the privileges that would change it. TRUNCATE
--    fires no row trigger, so it is revoked rather than trapped; only the
--    table owner keeps it, for local resets (the seed truncates this table).
--    service_role keeps SELECT and INSERT.
revoke update, delete, truncate on table public.audit_events from anon, authenticated, service_role;

comment on table public.audit_events is
  'Append-only audit log: a row trigger refuses UPDATE and DELETE for every role, API roles hold no UPDATE, DELETE or TRUNCATE, and the actor foreign key is ON DELETE RESTRICT (#187 HF-21).';
