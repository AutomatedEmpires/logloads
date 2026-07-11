create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  role text not null,
  full_name text not null,
  phone text not null,
  email text,
  company_id uuid,
  verification_status text not null default 'pending',
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  legal_name text not null,
  display_name text not null,
  verification_status text not null default 'pending',
  primary_region text not null,
  contact_name text not null,
  contact_phone text not null,
  contact_email text,
  notes text,
  archived_at timestamptz,
  owner_profile_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles
  add constraint profiles_company_id_fkey
  foreign key (company_id) references public.companies(id) on delete set null;

alter table public.companies
  add constraint companies_owner_profile_id_fkey
  foreign key (owner_profile_id) references public.profiles(id) on delete set null;

create table if not exists public.driver_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  availability_status text not null default 'available',
  license_number text not null,
  years_experience integer not null default 0,
  home_base text not null,
  equipment_preferences text[] not null default '{}',
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.dispatcher_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  dispatch_region text not null,
  contact_name text not null,
  contact_phone text not null,
  contact_email text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.loader_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  landing_id uuid,
  contact_name text not null,
  contact_phone text not null,
  contact_email text,
  shift_notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.truck_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  truck_type text not null,
  unit_number text not null,
  make text not null,
  model text not null,
  plate_number text not null,
  vin text,
  axle_count integer not null,
  max_payload_tons numeric(10,2) not null,
  equipment_tags text[] not null default '{}',
  road_access_capabilities text[] not null default '{}',
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.trailer_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  truck_id uuid references public.truck_profiles(id) on delete set null,
  trailer_type text not null,
  unit_number text not null,
  capacity_tons numeric(10,2) not null,
  equipment_tags text[] not null default '{}',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.landings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  loader_profile_id uuid references public.loader_profiles(id) on delete set null,
  name text not null,
  address_line_1 text not null,
  city text not null,
  state text not null,
  postal_code text not null,
  latitude numeric(9,6) not null,
  longitude numeric(9,6) not null,
  contact_name text not null,
  contact_phone text not null,
  contact_email text,
  slot_window_minutes integer,
  access_notes text,
  road_condition text,
  weather_notes text,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.mills (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  mill_code text not null unique,
  name text not null,
  address_line_1 text not null,
  city text not null,
  state text not null,
  postal_code text not null,
  latitude numeric(9,6) not null,
  longitude numeric(9,6) not null,
  contact_name text not null,
  contact_phone text not null,
  contact_email text,
  slot_window_minutes integer,
  access_notes text,
  road_condition text,
  weather_notes text,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.haul_routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  landing_id uuid not null references public.landings(id) on delete cascade,
  mill_id uuid not null references public.mills(id) on delete cascade,
  route_name text not null,
  estimated_distance_miles numeric(10,2) not null,
  estimated_run_time_minutes integer not null,
  road_condition text not null,
  map_polyline text,
  road_notes text,
  weather_notes text,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  rate_type text not null,
  amount_cents integer not null,
  currency text not null default 'USD',
  fuel_surcharge_cents integer not null default 0,
  notes text,
  effective_date date not null,
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.load_postings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  dispatcher_profile_id uuid not null references public.dispatcher_profiles(id) on delete cascade,
  loader_profile_id uuid references public.loader_profiles(id) on delete set null,
  pickup_landing_id uuid not null references public.landings(id) on delete cascade,
  dropoff_mill_id uuid not null references public.mills(id) on delete cascade,
  route_id uuid not null references public.haul_routes(id) on delete cascade,
  rate_id uuid not null references public.rates(id) on delete cascade,
  title text not null,
  load_type text not null,
  status text not null,
  schedule_type text not null,
  load_date date,
  campaign_start_date date,
  campaign_end_date date,
  recurring_frequency text,
  recurring_days_of_week integer[] not null default '{}',
  recurring_until_date date,
  daily_truck_count_needed integer not null,
  estimated_tons_per_load numeric(10,2),
  equipment_requirements text[] not null default '{}',
  access_requirements text[] not null default '{}',
  road_condition text not null,
  weather_notes text,
  dispatcher_contact_name text not null,
  dispatcher_contact_phone text not null,
  dispatcher_contact_email text,
  loader_contact_name text,
  loader_contact_phone text,
  loader_contact_email text,
  cancellation_reason text,
  archived_at timestamptz,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.truck_slots (
  id uuid primary key default gen_random_uuid(),
  load_posting_id uuid not null references public.load_postings(id) on delete cascade,
  landing_id uuid not null references public.landings(id) on delete cascade,
  loader_profile_id uuid references public.loader_profiles(id) on delete set null,
  slot_date date not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  capacity integer not null,
  reserved_count integer not null default 0,
  status text not null,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.availability_windows (
  id uuid primary key default gen_random_uuid(),
  driver_profile_id uuid not null references public.driver_profiles(id) on delete cascade,
  truck_profile_id uuid references public.truck_profiles(id) on delete set null,
  status text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  preferred_route_ids uuid[] not null default '{}',
  notes text,
  recurring_frequency text,
  recurring_days_of_week integer[] not null default '{}',
  recurring_until_date date,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  load_posting_id uuid not null references public.load_postings(id) on delete cascade,
  truck_slot_id uuid not null references public.truck_slots(id) on delete cascade,
  driver_profile_id uuid not null references public.driver_profiles(id) on delete cascade,
  truck_profile_id uuid not null references public.truck_profiles(id) on delete cascade,
  trailer_profile_id uuid references public.trailer_profiles(id) on delete set null,
  status text not null,
  requested_at timestamptz not null,
  assigned_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  dispatcher_notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  related_entity_type text,
  related_entity_id uuid,
  read_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.message_threads (
  id uuid primary key default gen_random_uuid(),
  load_posting_id uuid references public.load_postings(id) on delete set null,
  assignment_id uuid references public.assignments(id) on delete set null,
  subject text,
  participant_user_ids uuid[] not null,
  last_message_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.message_events (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  author_user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id) on delete set null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists load_postings_status_idx on public.load_postings (status);
create index if not exists load_postings_load_date_idx on public.load_postings (load_date);
create index if not exists truck_slots_slot_date_idx on public.truck_slots (slot_date);
create index if not exists assignments_status_idx on public.assignments (status);
create index if not exists availability_windows_driver_profile_id_idx on public.availability_windows (driver_profile_id);
create index if not exists notifications_user_id_idx on public.notifications (user_id);
create index if not exists audit_events_entity_idx on public.audit_events (entity_type, entity_id);

comment on table public.load_postings is 'First-pass load coordination records for one-off, recurring, and campaign timber hauls.';
comment on column public.landings.latitude is 'Geospatial-ready landing latitude stored until PostGIS shapes are added.';
comment on column public.mills.longitude is 'Geospatial-ready mill longitude stored until PostGIS shapes are added.';
comment on column public.availability_windows.preferred_route_ids is 'Preferred haul route ids for matching without running routing optimization.';

create trigger profiles_set_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
create trigger companies_set_updated_at before update on public.companies for each row execute procedure public.set_updated_at();
create trigger driver_profiles_set_updated_at before update on public.driver_profiles for each row execute procedure public.set_updated_at();
create trigger dispatcher_profiles_set_updated_at before update on public.dispatcher_profiles for each row execute procedure public.set_updated_at();
create trigger loader_profiles_set_updated_at before update on public.loader_profiles for each row execute procedure public.set_updated_at();
create trigger truck_profiles_set_updated_at before update on public.truck_profiles for each row execute procedure public.set_updated_at();
create trigger trailer_profiles_set_updated_at before update on public.trailer_profiles for each row execute procedure public.set_updated_at();
create trigger landings_set_updated_at before update on public.landings for each row execute procedure public.set_updated_at();
create trigger mills_set_updated_at before update on public.mills for each row execute procedure public.set_updated_at();
create trigger haul_routes_set_updated_at before update on public.haul_routes for each row execute procedure public.set_updated_at();
create trigger rates_set_updated_at before update on public.rates for each row execute procedure public.set_updated_at();
create trigger load_postings_set_updated_at before update on public.load_postings for each row execute procedure public.set_updated_at();
create trigger truck_slots_set_updated_at before update on public.truck_slots for each row execute procedure public.set_updated_at();
create trigger availability_windows_set_updated_at before update on public.availability_windows for each row execute procedure public.set_updated_at();
create trigger assignments_set_updated_at before update on public.assignments for each row execute procedure public.set_updated_at();
create trigger notifications_set_updated_at before update on public.notifications for each row execute procedure public.set_updated_at();
create trigger message_threads_set_updated_at before update on public.message_threads for each row execute procedure public.set_updated_at();
create trigger message_events_set_updated_at before update on public.message_events for each row execute procedure public.set_updated_at();