create extension if not exists pgcrypto;
create extension if not exists postgis;

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null,
  status text not null default 'active',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (company_id, profile_id)
);

insert into public.organization_memberships (company_id, profile_id, role, status)
select profiles.company_id, profiles.id,
  case profiles.role
    when 'driver' then 'driver'
    when 'owner_operator' then 'owner'
    when 'dispatcher' then 'dispatcher'
    when 'loader' then 'landing_manager'
    when 'logging_company_admin' then 'admin'
    when 'mill_manager' then 'destination_manager'
    else 'viewer'
  end,
  'active'
from public.profiles
where profiles.company_id is not null
on conflict (company_id, profile_id) do nothing;

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invited_email text not null,
  invited_role text not null,
  status text not null default 'created',
  invited_by_profile_id uuid not null references public.profiles(id) on delete cascade,
  accepted_by_profile_id uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.private_network_relationships (
  id uuid primary key default gen_random_uuid(),
  owner_company_id uuid not null references public.companies(id) on delete cascade,
  partner_company_id uuid not null references public.companies(id) on delete cascade,
  status text not null default 'invited',
  visibility_scope text not null default 'private_loads',
  preferred boolean not null default false,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint private_network_not_self check (owner_company_id <> partner_company_id),
  unique (owner_company_id, partner_company_id)
);

create table if not exists public.equipment_combinations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  truck_profile_id uuid not null references public.truck_profiles(id) on delete cascade,
  trailer_profile_id uuid references public.trailer_profiles(id) on delete set null,
  assigned_driver_profile_id uuid references public.driver_profiles(id) on delete set null,
  label text not null,
  truck_types text[] not null default '{}',
  trailer_types text[] not null default '{}',
  capability_tags text[] not null default '{}',
  product_length_min_feet numeric(8,2),
  product_length_max_feet numeric(8,2),
  max_payload_tons numeric(10,2) not null,
  status text not null default 'available',
  home_region text not null,
  last_verified_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.rich_landing_details (
  id uuid primary key default gen_random_uuid(),
  landing_id uuid not null unique references public.landings(id) on delete cascade,
  controlled_by_company_id uuid not null references public.companies(id) on delete cascade,
  public_approximate_area text not null,
  entrance geography(point, 4326) not null,
  exact_location_visibility text not null default 'assigned_only',
  private_road_notes text,
  gate_instructions text,
  loading_equipment text[] not null default '{}',
  turnaround_constraints text[] not null default '{}',
  staging_instructions text,
  communication_instructions text,
  last_verified_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.destination_facilities (
  id uuid primary key default gen_random_uuid(),
  mill_id uuid not null unique references public.mills(id) on delete cascade,
  facility_type text not null default 'mill',
  managed_by_company_id uuid references public.companies(id) on delete set null,
  record_status text not null default 'community_suggested',
  truck_entrance geography(point, 4326) not null,
  receiving_hours text not null,
  product_restrictions text[] not null default '{}',
  check_in_process text not null,
  scale_process text not null,
  unloading_instructions text not null,
  current_status text not null default 'open',
  current_notice text,
  last_verified_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.opportunity_capacities (
  id uuid primary key default gen_random_uuid(),
  load_posting_id uuid not null unique references public.load_postings(id) on delete cascade,
  visibility_mode text not null default 'open_network',
  allocation_mode text not null default 'request_approval',
  total_truckloads integer not null check (total_truckloads > 0),
  committed_truckloads integer not null default 0 check (committed_truckloads >= 0),
  completed_truckloads integer not null default 0 check (completed_truckloads >= 0),
  remaining_truckloads integer not null default 0 check (remaining_truckloads >= 0),
  accepted_terms_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint opportunity_capacity_committed_check check (committed_truckloads <= total_truckloads),
  constraint opportunity_capacity_completed_check check (completed_truckloads <= committed_truckloads)
);

create table if not exists public.route_packs (
  id uuid primary key default gen_random_uuid(),
  load_posting_id uuid not null unique references public.load_postings(id) on delete cascade,
  landing_id uuid not null references public.landings(id) on delete cascade,
  destination_mill_id uuid not null references public.mills(id) on delete cascade,
  haul_route_id uuid not null references public.haul_routes(id) on delete cascade,
  visibility text not null default 'assigned_only',
  cacheable_offline boolean not null default true,
  calculated_route_summary text not null,
  local_instructions jsonb not null default '[]'::jsonb,
  current_road_condition text not null,
  last_verified_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique references public.assignments(id) on delete cascade,
  load_posting_id uuid not null references public.load_postings(id) on delete cascade,
  route_pack_id uuid references public.route_packs(id) on delete set null,
  driver_profile_id uuid not null references public.driver_profiles(id) on delete cascade,
  equipment_combination_id uuid references public.equipment_combinations(id) on delete set null,
  status text not null default 'assigned',
  location_visibility text not null default 'active_trip_participants',
  location_sharing_started_at timestamptz,
  location_sharing_ends_at timestamptz,
  last_synced_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.trip_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  type text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  source text not null,
  occurred_at timestamptz not null,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.trip_documents (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  type text not null,
  storage_provider text not null,
  storage_key text not null,
  filename text not null,
  content_type text not null,
  uploaded_by_profile_id uuid not null references public.profiles(id) on delete cascade,
  uploaded_at timestamptz not null default timezone('utc', now()),
  processing_status text not null default 'uploaded',
  audit_metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.verification_records (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id uuid not null,
  verification_type text not null,
  status text not null default 'pending',
  source text not null,
  evidence_summary text not null,
  reviewer_profile_id uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  expires_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product text not null,
  status text not null default 'trialing',
  features text[] not null default '{}',
  active_truck_limit integer,
  active_landing_limit integer,
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_ends_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.direct_offers (
  id uuid primary key default gen_random_uuid(),
  load_posting_id uuid not null references public.load_postings(id) on delete cascade,
  offered_by_company_id uuid not null references public.companies(id) on delete cascade,
  offered_to_company_id uuid not null references public.companies(id) on delete cascade,
  status text not null default 'draft',
  offered_truckloads integer not null check (offered_truckloads > 0),
  terms_snapshot jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  responded_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.future_availability (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  equipment_combination_id uuid not null references public.equipment_combinations(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'available',
  visible_to_relationship_ids uuid[] not null default '{}',
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint future_availability_range_check check (ends_at > starts_at)
);

create table if not exists public.operational_notices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  related_load_posting_id uuid references public.load_postings(id) on delete cascade,
  related_landing_id uuid references public.landings(id) on delete cascade,
  related_destination_mill_id uuid references public.mills(id) on delete cascade,
  severity text not null default 'info',
  title text not null,
  body text not null,
  effective_at timestamptz not null,
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists organization_memberships_profile_idx on public.organization_memberships (profile_id);
create index if not exists private_network_owner_partner_idx on public.private_network_relationships (owner_company_id, partner_company_id, status);
create index if not exists opportunity_capacities_load_idx on public.opportunity_capacities (load_posting_id);
create index if not exists route_packs_load_idx on public.route_packs (load_posting_id);
create index if not exists trips_assignment_idx on public.trips (assignment_id);
create index if not exists trip_events_trip_idx on public.trip_events (trip_id, occurred_at);
create index if not exists direct_offers_target_idx on public.direct_offers (offered_to_company_id, status);
create index if not exists future_availability_company_idx on public.future_availability (company_id, starts_at);

create or replace function public.current_clerk_user_id()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'sub', '')
$$;

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select profiles.id
  from public.profiles
  where profiles.clerk_user_id = public.current_clerk_user_id()
    and profiles.is_active = true
  limit 1
$$;

create or replace function public.is_org_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_memberships memberships
    where memberships.company_id = p_company_id
      and memberships.profile_id = public.current_profile_id()
      and memberships.status = 'active'
  )
$$;

create or replace function public.org_role_can(p_company_id uuid, p_actions text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with role_actions as (
    select case memberships.role
      when 'owner' then array['view_network','manage_members','manage_billing','manage_trucks','manage_drivers','publish_load','assign_capacity','manage_landing','manage_destination','request_assignment','progress_trip','send_operational_notice','view_private_location','view_audit_log']
      when 'admin' then array['view_network','manage_members','manage_trucks','manage_drivers','publish_load','assign_capacity','manage_landing','manage_destination','request_assignment','progress_trip','send_operational_notice','view_private_location','view_audit_log']
      when 'dispatcher' then array['view_network','manage_trucks','manage_drivers','assign_capacity','request_assignment','progress_trip','send_operational_notice','view_private_location']
      when 'driver' then array['view_network','request_assignment','progress_trip','view_private_location']
      when 'fleet_manager' then array['view_network','manage_trucks','manage_drivers','assign_capacity','request_assignment','progress_trip','send_operational_notice','view_private_location']
      when 'landing_manager' then array['view_network','publish_load','assign_capacity','manage_landing','send_operational_notice','view_private_location']
      when 'destination_manager' then array['view_network','manage_destination','send_operational_notice','view_private_location']
      when 'billing' then array['view_network','manage_billing']
      else array['view_network']
    end as actions
    from public.organization_memberships memberships
    where memberships.company_id = p_company_id
      and memberships.profile_id = public.current_profile_id()
      and memberships.status = 'active'
  )
  select exists (select 1 from role_actions where actions && p_actions)
$$;

create or replace function public.orgs_have_active_relationship(p_first_company_id uuid, p_second_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.private_network_relationships relationships
    where relationships.status = 'active'
      and (
        (relationships.owner_company_id = p_first_company_id and relationships.partner_company_id = p_second_company_id) or
        (relationships.owner_company_id = p_second_company_id and relationships.partner_company_id = p_first_company_id)
      )
  )
$$;

create or replace function public.load_visible_to_org(p_load_posting_id uuid, p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.load_postings loads
    left join public.opportunity_capacities capacities on capacities.load_posting_id = loads.id
    where loads.id = p_load_posting_id
      and loads.archived_at is null
      and (
        loads.company_id = p_company_id
        or coalesce(capacities.visibility_mode, 'open_network') in ('open_network', 'verified_network')
        or exists (
          select 1 from public.direct_offers offers
          where offers.load_posting_id = loads.id
            and offers.offered_to_company_id = p_company_id
            and offers.status in ('sent', 'accepted')
        )
        or (
          coalesce(capacities.visibility_mode, 'open_network') = 'private_network'
          and public.orgs_have_active_relationship(loads.company_id, p_company_id)
        )
      )
  )
$$;

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.load_postings enable row level security;
alter table public.truck_slots enable row level security;
alter table public.assignments enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.private_network_relationships enable row level security;
alter table public.equipment_combinations enable row level security;
alter table public.rich_landing_details enable row level security;
alter table public.destination_facilities enable row level security;
alter table public.opportunity_capacities enable row level security;
alter table public.route_packs enable row level security;
alter table public.trips enable row level security;
alter table public.trip_events enable row level security;
alter table public.trip_documents enable row level security;
alter table public.verification_records enable row level security;
alter table public.entitlements enable row level security;
alter table public.direct_offers enable row level security;
alter table public.future_availability enable row level security;
alter table public.operational_notices enable row level security;

drop policy if exists profiles_self_or_org_select on public.profiles;
create policy profiles_self_or_org_select on public.profiles
  for select using (id = public.current_profile_id() or (company_id is not null and public.is_org_member(company_id)));

drop policy if exists companies_member_or_network_select on public.companies;
create policy companies_member_or_network_select on public.companies
  for select using (
    public.is_org_member(id)
    or exists (
      select 1 from public.private_network_relationships relationships
      where relationships.status = 'active'
        and (relationships.owner_company_id = companies.id or relationships.partner_company_id = companies.id)
        and (public.is_org_member(relationships.owner_company_id) or public.is_org_member(relationships.partner_company_id))
    )
  );

drop policy if exists memberships_member_select on public.organization_memberships;
create policy memberships_member_select on public.organization_memberships
  for select using (profile_id = public.current_profile_id() or public.is_org_member(company_id));

drop policy if exists memberships_admin_write on public.organization_memberships;
create policy memberships_admin_write on public.organization_memberships
  for all using (public.org_role_can(company_id, array['manage_members']))
  with check (public.org_role_can(company_id, array['manage_members']));

drop policy if exists invitations_admin_access on public.organization_invitations;
create policy invitations_admin_access on public.organization_invitations
  for all using (public.org_role_can(company_id, array['manage_members']))
  with check (public.org_role_can(company_id, array['manage_members']));

drop policy if exists private_network_participant_select on public.private_network_relationships;
create policy private_network_participant_select on public.private_network_relationships
  for select using (public.is_org_member(owner_company_id) or public.is_org_member(partner_company_id));

drop policy if exists private_network_owner_write on public.private_network_relationships;
create policy private_network_owner_write on public.private_network_relationships
  for all using (public.org_role_can(owner_company_id, array['manage_members','publish_load']))
  with check (public.org_role_can(owner_company_id, array['manage_members','publish_load']));

drop policy if exists load_postings_visible_select on public.load_postings;
create policy load_postings_visible_select on public.load_postings
  for select using (
    public.is_org_member(company_id)
    or exists (
      select 1 from public.organization_memberships memberships
      where memberships.profile_id = public.current_profile_id()
        and public.load_visible_to_org(load_postings.id, memberships.company_id)
    )
  );

drop policy if exists load_postings_owner_write on public.load_postings;
create policy load_postings_owner_write on public.load_postings
  for all using (public.org_role_can(company_id, array['publish_load']))
  with check (public.org_role_can(company_id, array['publish_load']));

drop policy if exists truck_slots_visible_select on public.truck_slots;
create policy truck_slots_visible_select on public.truck_slots
  for select using (exists (
    select 1 from public.load_postings loads
    join public.organization_memberships memberships on memberships.profile_id = public.current_profile_id()
    where loads.id = truck_slots.load_posting_id
      and public.load_visible_to_org(loads.id, memberships.company_id)
  ));

drop policy if exists assignments_participant_select on public.assignments;
create policy assignments_participant_select on public.assignments
  for select using (exists (
    select 1
    from public.load_postings loads
    join public.driver_profiles drivers on drivers.id = assignments.driver_profile_id
    where loads.id = assignments.load_posting_id
      and (public.is_org_member(loads.company_id) or public.is_org_member(drivers.company_id))
  ));

drop policy if exists equipment_visible_select on public.equipment_combinations;
create policy equipment_visible_select on public.equipment_combinations
  for select using (
    public.is_org_member(company_id)
    or exists (
      select 1 from public.private_network_relationships relationships
      where relationships.status = 'active'
        and relationships.visibility_scope in ('availability', 'all_operational')
        and relationships.owner_company_id = equipment_combinations.company_id
        and public.is_org_member(relationships.partner_company_id)
    )
  );

drop policy if exists equipment_owner_write on public.equipment_combinations;
create policy equipment_owner_write on public.equipment_combinations
  for all using (public.org_role_can(company_id, array['manage_trucks','manage_drivers']))
  with check (public.org_role_can(company_id, array['manage_trucks','manage_drivers']));

drop policy if exists details_member_or_private_select on public.rich_landing_details;
create policy details_member_or_private_select on public.rich_landing_details
  for select using (
    public.is_org_member(controlled_by_company_id)
    or exact_location_visibility = 'public'
    or exists (
      select 1 from public.organization_memberships memberships
      where memberships.profile_id = public.current_profile_id()
        and public.orgs_have_active_relationship(controlled_by_company_id, memberships.company_id)
    )
  );

drop policy if exists destination_facilities_select on public.destination_facilities;
create policy destination_facilities_select on public.destination_facilities for select using (true);

drop policy if exists capacities_visible_select on public.opportunity_capacities;
create policy capacities_visible_select on public.opportunity_capacities
  for select using (exists (
    select 1 from public.organization_memberships memberships
    where memberships.profile_id = public.current_profile_id()
      and public.load_visible_to_org(opportunity_capacities.load_posting_id, memberships.company_id)
  ));

drop policy if exists route_packs_visible_select on public.route_packs;
create policy route_packs_visible_select on public.route_packs
  for select using (exists (
    select 1
    from public.load_postings loads
    join public.organization_memberships memberships on memberships.profile_id = public.current_profile_id()
    where loads.id = route_packs.load_posting_id
      and (
        (route_packs.visibility in ('organization','private_network') and public.load_visible_to_org(loads.id, memberships.company_id))
        or exists (
          select 1 from public.assignments assignments
          join public.driver_profiles drivers on drivers.id = assignments.driver_profile_id
          where assignments.load_posting_id = loads.id
            and assignments.status in ('accepted','checked_in','loading','hauled','completed')
            and (memberships.company_id = loads.company_id or memberships.company_id = drivers.company_id)
        )
      )
  ));

drop policy if exists trips_participant_select on public.trips;
create policy trips_participant_select on public.trips
  for select using (exists (
    select 1
    from public.assignments assignments
    join public.load_postings loads on loads.id = assignments.load_posting_id
    join public.driver_profiles drivers on drivers.id = assignments.driver_profile_id
    where assignments.id = trips.assignment_id
      and (public.is_org_member(loads.company_id) or public.is_org_member(drivers.company_id))
  ));

drop policy if exists trip_events_participant_select on public.trip_events;
create policy trip_events_participant_select on public.trip_events
  for select using (exists (select 1 from public.trips where trips.id = trip_events.trip_id));

drop policy if exists trip_documents_participant_select on public.trip_documents;
create policy trip_documents_participant_select on public.trip_documents
  for select using (exists (select 1 from public.trips where trips.id = trip_documents.trip_id));

drop policy if exists entitlements_member_select on public.entitlements;
create policy entitlements_member_select on public.entitlements
  for select using (public.org_role_can(company_id, array['manage_billing','view_network']));

drop policy if exists direct_offers_participant_select on public.direct_offers;
create policy direct_offers_participant_select on public.direct_offers
  for select using (public.is_org_member(offered_by_company_id) or public.is_org_member(offered_to_company_id));

drop policy if exists future_availability_visible_select on public.future_availability;
create policy future_availability_visible_select on public.future_availability
  for select using (
    public.is_org_member(company_id)
    or exists (
      select 1 from public.private_network_relationships relationships
      where relationships.id = any(future_availability.visible_to_relationship_ids)
        and (public.is_org_member(relationships.owner_company_id) or public.is_org_member(relationships.partner_company_id))
    )
  );

drop policy if exists operational_notices_visible_select on public.operational_notices;
create policy operational_notices_visible_select on public.operational_notices
  for select using (
    public.is_org_member(company_id)
    or related_load_posting_id is null
    or exists (
      select 1 from public.organization_memberships memberships
      where memberships.profile_id = public.current_profile_id()
        and public.load_visible_to_org(operational_notices.related_load_posting_id, memberships.company_id)
    )
  );

drop policy if exists verification_records_member_select on public.verification_records;
create policy verification_records_member_select on public.verification_records
  for select using (subject_type in ('destination','landing') or exists (
    select 1 from public.organization_memberships memberships
    where memberships.profile_id = public.current_profile_id()
      and memberships.company_id = verification_records.subject_id
  ));

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
set search_path = public
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
      updated_at = timezone('utc', now())
  where id = p_truck_slot_id;

  update public.opportunity_capacities
  set committed_truckloads = committed_truckloads + 1,
      remaining_truckloads = greatest(0, remaining_truckloads - 1),
      updated_at = timezone('utc', now())
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
    timezone('utc', now()),
    p_dispatcher_notes
  ) returning * into v_assignment;

  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, metadata)
  values (
    v_actor_profile_id,
    'assignment',
    v_assignment.id,
    'capacity_requested',
    jsonb_build_object('companyId', p_company_id, 'loadPostingId', p_load_posting_id)
  );

  return v_assignment;
end;
$$;

drop trigger if exists organization_memberships_set_updated_at on public.organization_memberships;
create trigger organization_memberships_set_updated_at before update on public.organization_memberships for each row execute procedure public.set_updated_at();
drop trigger if exists organization_invitations_set_updated_at on public.organization_invitations;
create trigger organization_invitations_set_updated_at before update on public.organization_invitations for each row execute procedure public.set_updated_at();
drop trigger if exists private_network_relationships_set_updated_at on public.private_network_relationships;
create trigger private_network_relationships_set_updated_at before update on public.private_network_relationships for each row execute procedure public.set_updated_at();
drop trigger if exists equipment_combinations_set_updated_at on public.equipment_combinations;
create trigger equipment_combinations_set_updated_at before update on public.equipment_combinations for each row execute procedure public.set_updated_at();
drop trigger if exists rich_landing_details_set_updated_at on public.rich_landing_details;
create trigger rich_landing_details_set_updated_at before update on public.rich_landing_details for each row execute procedure public.set_updated_at();
drop trigger if exists destination_facilities_set_updated_at on public.destination_facilities;
create trigger destination_facilities_set_updated_at before update on public.destination_facilities for each row execute procedure public.set_updated_at();
drop trigger if exists opportunity_capacities_set_updated_at on public.opportunity_capacities;
create trigger opportunity_capacities_set_updated_at before update on public.opportunity_capacities for each row execute procedure public.set_updated_at();
drop trigger if exists route_packs_set_updated_at on public.route_packs;
create trigger route_packs_set_updated_at before update on public.route_packs for each row execute procedure public.set_updated_at();
drop trigger if exists trips_set_updated_at on public.trips;
create trigger trips_set_updated_at before update on public.trips for each row execute procedure public.set_updated_at();
drop trigger if exists verification_records_set_updated_at on public.verification_records;
create trigger verification_records_set_updated_at before update on public.verification_records for each row execute procedure public.set_updated_at();
drop trigger if exists entitlements_set_updated_at on public.entitlements;
create trigger entitlements_set_updated_at before update on public.entitlements for each row execute procedure public.set_updated_at();
drop trigger if exists direct_offers_set_updated_at on public.direct_offers;
create trigger direct_offers_set_updated_at before update on public.direct_offers for each row execute procedure public.set_updated_at();
drop trigger if exists future_availability_set_updated_at on public.future_availability;
create trigger future_availability_set_updated_at before update on public.future_availability for each row execute procedure public.set_updated_at();

comment on table public.private_network_relationships is 'Directed trusted operating graph for private timber load and capacity visibility.';
comment on table public.opportunity_capacities is 'Truckload capacity ledger for each load posting, separate from appointment slots.';
comment on table public.route_packs is 'Assignment-scoped operating route truth with provenance-rich local instructions.';
comment on table public.trips is 'Executed haul trips derived from accepted assignments, with location-sharing policy state.';
comment on function public.request_capacity(uuid, uuid, uuid, uuid, uuid, uuid, text) is 'Transactionally requests capacity, locks the selected slot, prevents duplicate active requests, and updates opportunity capacity.';
