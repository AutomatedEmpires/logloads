-- Additive relational mirror for driver economics, authenticated media
-- references, and immutable assignment terms. Canonical application writes
-- remain server-only through operating_state during the transitional service
-- layer; these columns keep the durable schema ready for normalized writes.

alter table public.driver_profiles
  add column if not exists home_base_lat double precision,
  add column if not exists home_base_lng double precision,
  add column if not exists preferred_fuel_price_cents_per_gallon integer,
  add column if not exists operating_radius_miles numeric(8,2),
  add column if not exists profile_photo jsonb;

alter table public.truck_profiles
  add column if not exists fuel_economy_mpg numeric(5,2),
  add column if not exists photo jsonb;

alter table public.trailer_profiles
  add column if not exists photo jsonb;

alter table public.assignments
  add column if not exists terms_snapshot jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'driver_profiles_home_base_lat_valid'
      and conrelid = 'public.driver_profiles'::regclass
  ) then
    alter table public.driver_profiles
      add constraint driver_profiles_home_base_lat_valid
      check (home_base_lat is null or home_base_lat between -90 and 90);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'driver_profiles_home_base_lng_valid'
      and conrelid = 'public.driver_profiles'::regclass
  ) then
    alter table public.driver_profiles
      add constraint driver_profiles_home_base_lng_valid
      check (home_base_lng is null or home_base_lng between -180 and 180);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'driver_profiles_fuel_price_valid'
      and conrelid = 'public.driver_profiles'::regclass
  ) then
    alter table public.driver_profiles
      add constraint driver_profiles_fuel_price_valid
      check (preferred_fuel_price_cents_per_gallon is null or preferred_fuel_price_cents_per_gallon between 100 and 1000);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'driver_profiles_operating_radius_valid'
      and conrelid = 'public.driver_profiles'::regclass
  ) then
    alter table public.driver_profiles
      add constraint driver_profiles_operating_radius_valid
      check (operating_radius_miles is null or operating_radius_miles > 0);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'truck_profiles_fuel_economy_valid'
      and conrelid = 'public.truck_profiles'::regclass
  ) then
    alter table public.truck_profiles
      add constraint truck_profiles_fuel_economy_valid
      check (fuel_economy_mpg is null or fuel_economy_mpg between 3 and 15);
  end if;
end
$$;

comment on column public.driver_profiles.profile_photo is
  'Authenticated Cloudinary media reference only; never an unsigned upload URL.';
comment on column public.truck_profiles.photo is
  'Authenticated Cloudinary media reference for the truck profile.';
comment on column public.trailer_profiles.photo is
  'Authenticated Cloudinary media reference for the trailer profile.';
comment on column public.assignments.terms_snapshot is
  'Immutable commercial terms captured on host approval. Host-fee collection remains disabled until separately approved.';
