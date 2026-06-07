-- 20260607000000_init_core_schema.sql
-- LogLoads core schema (MVP).
--
-- SINGLE SCHEMA AUTHORITY: Notion "LogLoads MVP Pack — Build-Ready Consolidation"
-- (Section 5) + "LogLoads Canonical Schema Draft V0". Mirrored in GitHub Issue #5
-- and enforced by the canonical-names contract in AGENTS.md §11. These 20 tables
-- are the only valid ones. Do not introduce names outside that list.
--
-- AUTH (LOCKED): Auth is Clerk, NOT Supabase Auth. `users.clerk_user_id` is the
-- external identity; Supabase RLS is keyed on the Clerk JWT (Issue #4). Do NOT
-- reference auth.users.
--
-- EXACT LANDING (LOCKED): exact landing coordinates live ONLY in
-- `haul_private_details` and are gated until confirmation/invite (MVP Pack §5/§6,
-- Issue #5 acceptance). They must never be added to `haul_opportunities`.

begin;

create extension if not exists "pgcrypto";
create extension if not exists "postgis";

-- ---------------------------------------------------------------------------
-- Enum types (locked state machines + bounded vocabularies)
-- ---------------------------------------------------------------------------
create type primary_role as enum ('driver','outfit','loader','admin');
create type organization_type as enum ('outfit','dispatcher','fleet','mill_later','admin_internal');
create type org_member_role as enum ('owner','admin','dispatcher','loader','viewer');
create type availability_status as enum ('unavailable','available_now','available_tomorrow','available_next_week','looking_short_term','looking_long_term');
create type truck_type as enum ('long_logger','short_logger','self_loader','mule_train','chip_truck','other');
create type haul_status as enum ('draft','pending_verification','active','paused','completed','archived','removed');
create type haul_visibility as enum ('public','invite_only','private');
create type pay_model as enum ('per_load','per_ton','hourly','daily','negotiable','unknown');
create type pay_visibility as enum ('visible','range_visible','hidden_until_request','negotiable');
create type slot_status as enum ('draft','open','partially_filled','filled','standby_open','delayed','canceled','completed','archived');
create type slot_request_status as enum ('requested','under_review','question_asked','accepted','declined','waitlisted','canceled_by_driver','expired');
create type assignment_status as enum ('confirmed','driver_accepted','active_today','in_progress','completed','canceled_by_driver','canceled_by_outfit','no_show_reported','disputed','archived');
create type standby_status as enum ('offered','accepted','active_standby','promoted','released','expired','canceled');
create type operational_update_type as enum ('loader_delay','loader_down','road_issue','weather_hold','mill_delay','start_time_change','cancellation','general_note');
create type notification_priority as enum ('critical','important','marketplace','account');
create type saved_item_type as enum ('haul','assignment','outfit','driver','search_later');

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===========================================================================
-- 1. users  (Clerk identity — NOT Supabase Auth)
-- ===========================================================================
create table users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text unique not null,
  full_name text,
  email text,
  phone text,
  primary_role primary_role,
  account_status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column users.clerk_user_id is 'Clerk external identity. RLS is keyed on this via the Clerk JWT (Issue #4).';

-- ===========================================================================
-- 2. organizations
-- ===========================================================================
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  organization_type organization_type not null default 'outfit',
  operating_region text,
  verification_status text not null default 'unverified',
  subscription_status text not null default 'none',
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- 3. organization_members
-- ===========================================================================
create table organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role org_member_role not null default 'viewer',
  status text not null default 'active',
  invited_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

-- ===========================================================================
-- 4. driver_profiles
-- ===========================================================================
create table driver_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id) on delete cascade,
  home_base_label text,
  home_base_lat numeric,
  home_base_lng numeric,
  home_base_geo geography(Point,4326),
  operating_radius_miles integer,
  availability_status availability_status not null default 'unavailable',
  preferred_regions text[],
  verification_status text not null default 'unverified',
  profile_completion_score integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- 5. truck_profiles
-- ===========================================================================
create table truck_profiles (
  id uuid primary key default gen_random_uuid(),
  driver_profile_id uuid not null references driver_profiles(id) on delete cascade,
  truck_name text,
  truck_type truck_type,
  trailer_type text,
  configuration_notes text,
  photo_urls text[],
  active_status text not null default 'active',
  verification_status text not null default 'unverified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- 6. outfit_profiles
-- ===========================================================================
create table outfit_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references organizations(id) on delete cascade,
  public_name text,
  description text,
  contact_phone text,
  contact_email text,
  operating_regions text[],
  verification_status text not null default 'unverified',
  profile_completion_score integer not null default 0,
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- 7. haul_opportunities  (reusable job context — APPROXIMATE location only)
-- ===========================================================================
create table haul_opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  status haul_status not null default 'draft',
  visibility haul_visibility not null default 'public',
  approximate_landing_label text,
  approximate_landing_lat numeric,
  approximate_landing_lng numeric,
  approximate_landing_geo geography(Point,4326),
  destination_label text,
  destination_lat numeric,
  destination_lng numeric,
  destination_geo geography(Point,4326),
  truck_type_required truck_type,
  pay_model pay_model not null default 'unknown',
  pay_visibility pay_visibility not null default 'hidden_until_request',
  rate_min numeric,
  rate_max numeric,
  estimated_miles numeric,
  estimated_round_trip_minutes integer,
  duration_estimate text,
  road_notes text,
  loader_notes text,
  special_requirements text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- 8. haul_private_details  (EXACT landing — gated until confirmation/invite)
-- ===========================================================================
create table haul_private_details (
  id uuid primary key default gen_random_uuid(),
  haul_id uuid not null unique references haul_opportunities(id) on delete cascade,
  exact_landing_label text,
  exact_landing_lat numeric,
  exact_landing_lng numeric,
  exact_landing_geo geography(Point,4326),
  gate_access_notes text,
  road_access_notes text,
  sensitive_instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table haul_private_details is 'Exact landing + sensitive access. RLS-gated: visible only to confirmed/invited drivers (Issue #4).';

-- ===========================================================================
-- 9. truck_slots  (date-specific capacity on a haul)
-- ===========================================================================
create table truck_slots (
  id uuid primary key default gen_random_uuid(),
  haul_id uuid not null references haul_opportunities(id) on delete cascade,
  slot_date date not null,
  start_window time,
  end_window time,
  trucks_needed integer not null default 1,
  trucks_confirmed integer not null default 0,
  standby_needed integer not null default 0,
  status slot_status not null default 'draft',
  delay_reason text,
  cancellation_reason text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- 10. slot_requests  (driver asks for a slot)
-- ===========================================================================
create table slot_requests (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references truck_slots(id) on delete cascade,
  driver_profile_id uuid not null references driver_profiles(id) on delete cascade,
  truck_profile_id uuid references truck_profiles(id),
  status slot_request_status not null default 'requested',
  request_note text,
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slot_id, driver_profile_id)
);

-- ===========================================================================
-- 11. assignments  (confirmed driver <-> slot)
-- ===========================================================================
create table assignments (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references truck_slots(id) on delete cascade,
  haul_id uuid not null references haul_opportunities(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  driver_profile_id uuid not null references driver_profiles(id) on delete cascade,
  truck_profile_id uuid references truck_profiles(id),
  status assignment_status not null default 'confirmed',
  confirmed_by uuid references users(id),
  confirmed_at timestamptz not null default now(),
  driver_accepted_at timestamptz,
  canceled_by uuid references users(id),
  cancellation_reason text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- 12. standby_assignments  (backup driver <-> slot; not confirmed work)
-- ===========================================================================
create table standby_assignments (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references truck_slots(id) on delete cascade,
  driver_profile_id uuid not null references driver_profiles(id) on delete cascade,
  truck_profile_id uuid references truck_profiles(id),
  status standby_status not null default 'offered',
  priority_order integer,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- 13. availability_signals
-- ===========================================================================
create table availability_signals (
  id uuid primary key default gen_random_uuid(),
  driver_profile_id uuid not null references driver_profiles(id) on delete cascade,
  status availability_status not null default 'available_now',
  available_from timestamptz,
  available_until timestamptz,
  radius_miles integer,
  preferred_regions text[],
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- 14. operational_updates
-- ===========================================================================
create table operational_updates (
  id uuid primary key default gen_random_uuid(),
  object_type text not null,
  object_id uuid not null,
  update_type operational_update_type not null,
  severity text not null default 'important',
  message text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- ===========================================================================
-- 15. notifications
-- ===========================================================================
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  event_type text not null,
  priority notification_priority not null default 'marketplace',
  title text,
  body text,
  object_type text,
  object_id uuid,
  read_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

-- ===========================================================================
-- 16. reminders
-- ===========================================================================
create table reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  object_type text not null,
  object_id uuid not null,
  remind_at timestamptz not null,
  reminder_type text,
  status text not null default 'scheduled',
  created_at timestamptz not null default now()
);

-- ===========================================================================
-- 17. verification_records  (private; outfits see badges only)
-- ===========================================================================
create table verification_records (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id uuid not null,
  verification_type text not null,
  status text not null default 'submitted',
  document_url text,
  submitted_by uuid references users(id),
  reviewed_by uuid references users(id),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  expires_at timestamptz
);
comment on table verification_records is 'Private. Raw documents never exposed to outfits — proof badges/status only (MVP Pack §6).';

-- ===========================================================================
-- 18. reliability_events
-- ===========================================================================
create table reliability_events (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id uuid not null,
  event_type text not null,
  severity text,
  source_object_type text,
  source_object_id uuid,
  disputed_status text not null default 'none',
  admin_note text,
  created_at timestamptz not null default now()
);

-- ===========================================================================
-- 19. saved_items
-- ===========================================================================
create table saved_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  item_type saved_item_type not null,
  item_id uuid not null,
  note text,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, item_type, item_id)
);

-- ===========================================================================
-- 20. audit_log
-- ===========================================================================
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references users(id),
  action text not null,
  object_type text,
  object_id uuid,
  previous_state text,
  new_state text,
  reason text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger trg_users_updated before update on users for each row execute function set_updated_at();
create trigger trg_organizations_updated before update on organizations for each row execute function set_updated_at();
create trigger trg_driver_profiles_updated before update on driver_profiles for each row execute function set_updated_at();
create trigger trg_truck_profiles_updated before update on truck_profiles for each row execute function set_updated_at();
create trigger trg_outfit_profiles_updated before update on outfit_profiles for each row execute function set_updated_at();
create trigger trg_haul_opportunities_updated before update on haul_opportunities for each row execute function set_updated_at();
create trigger trg_haul_private_details_updated before update on haul_private_details for each row execute function set_updated_at();
create trigger trg_truck_slots_updated before update on truck_slots for each row execute function set_updated_at();
create trigger trg_slot_requests_updated before update on slot_requests for each row execute function set_updated_at();
create trigger trg_assignments_updated before update on assignments for each row execute function set_updated_at();
create trigger trg_standby_assignments_updated before update on standby_assignments for each row execute function set_updated_at();
create trigger trg_availability_signals_updated before update on availability_signals for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Indexes (foreign keys + common lookups + geo)
-- ---------------------------------------------------------------------------
create index idx_org_members_org on organization_members(organization_id);
create index idx_org_members_user on organization_members(user_id);
create index idx_truck_profiles_driver on truck_profiles(driver_profile_id);
create index idx_hauls_org on haul_opportunities(organization_id);
create index idx_hauls_status on haul_opportunities(status);
create index idx_hauls_approx_geo on haul_opportunities using gist(approximate_landing_geo);
create index idx_slots_haul on truck_slots(haul_id);
create index idx_slots_date on truck_slots(slot_date);
create index idx_slots_status on truck_slots(status);
create index idx_slot_requests_slot on slot_requests(slot_id);
create index idx_slot_requests_driver on slot_requests(driver_profile_id);
create index idx_slot_requests_status on slot_requests(status);
create index idx_assignments_slot on assignments(slot_id);
create index idx_assignments_driver on assignments(driver_profile_id);
create index idx_assignments_org on assignments(organization_id);
create index idx_assignments_status on assignments(status);
create index idx_standby_slot on standby_assignments(slot_id);
create index idx_standby_driver on standby_assignments(driver_profile_id);
create index idx_availability_driver on availability_signals(driver_profile_id);
create index idx_driver_home_geo on driver_profiles using gist(home_base_geo);
create index idx_op_updates_object on operational_updates(object_type, object_id);
create index idx_notifications_user on notifications(user_id, read_at);
create index idx_reminders_user on reminders(user_id, remind_at);
create index idx_verification_subject on verification_records(subject_type, subject_id);
create index idx_reliability_subject on reliability_events(subject_type, subject_id);
create index idx_saved_items_user on saved_items(user_id);
create index idx_audit_object on audit_log(object_type, object_id);
create index idx_audit_actor on audit_log(actor_id);

-- ---------------------------------------------------------------------------
-- Row Level Security: enabled on every table, NO policies yet (default deny).
-- Policies are keyed on the Clerk JWT and land with the auth slice (Issue #4).
-- ---------------------------------------------------------------------------
alter table users enable row level security;
alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table driver_profiles enable row level security;
alter table truck_profiles enable row level security;
alter table outfit_profiles enable row level security;
alter table haul_opportunities enable row level security;
alter table haul_private_details enable row level security;
alter table truck_slots enable row level security;
alter table slot_requests enable row level security;
alter table assignments enable row level security;
alter table standby_assignments enable row level security;
alter table availability_signals enable row level security;
alter table operational_updates enable row level security;
alter table notifications enable row level security;
alter table reminders enable row level security;
alter table verification_records enable row level security;
alter table reliability_events enable row level security;
alter table saved_items enable row level security;
alter table audit_log enable row level security;

commit;
