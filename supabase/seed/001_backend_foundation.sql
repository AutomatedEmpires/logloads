truncate table
  public.audit_events,
  public.message_events,
  public.message_threads,
  public.notifications,
  public.assignments,
  public.availability_windows,
  public.truck_slots,
  public.load_postings,
  public.rates,
  public.haul_routes,
  public.mills,
  public.landings,
  public.trailer_profiles,
  public.truck_profiles,
  public.loader_profiles,
  public.dispatcher_profiles,
  public.driver_profiles,
  public.companies,
  public.profiles
restart identity cascade;

insert into public.companies (id, slug, legal_name, display_name, verification_status, primary_region, contact_name, contact_phone, contact_email, notes)
values
  ('33333333-3333-4333-8333-333333333331', 'north-pine-logging', 'North Pine Logging LLC', 'North Pine Logging', 'verified', 'Cascade Foothills', 'Dana Dispatch', '555-2001', 'dispatch@northpine.example', 'Primary production crew covering weekday chip and saw-log runs.'),
  ('33333333-3333-4333-8333-333333333332', 'summit-ridge-timber', 'Summit Ridge Timber Inc.', 'Summit Ridge Timber', 'verified', 'Blue River Corridor', 'Cole Cedar', '555-1003', 'cole@summit.example', 'Owner-operator heavy outfit handling mixed terrain landings.');

insert into public.profiles (id, clerk_user_id, role, full_name, phone, email, company_id, verification_status, is_active)
values
  ('11111111-1111-4111-8111-111111111111', 'clerk-admin-1', 'admin', 'LogLoads Admin', '555-0001', 'admin@logloads.example', null, 'verified', true),
  ('22222222-2222-4222-8222-222222222221', 'clerk-driver-1', 'driver', 'Hank Hauler', '555-1001', 'hank@northpine.example', '33333333-3333-4333-8333-333333333331', 'verified', true),
  ('22222222-2222-4222-8222-222222222222', 'clerk-driver-2', 'driver', 'Maya Mills', '555-1002', 'maya@northpine.example', '33333333-3333-4333-8333-333333333331', 'verified', true),
  ('22222222-2222-4222-8222-222222222223', 'clerk-driver-3', 'owner_operator', 'Cole Cedar', '555-1003', 'cole@summit.example', '33333333-3333-4333-8333-333333333332', 'verified', true),
  ('22222222-2222-4222-8222-222222222224', 'clerk-dispatch-1', 'dispatcher', 'Dana Dispatch', '555-2001', 'dispatch@northpine.example', '33333333-3333-4333-8333-333333333331', 'verified', true),
  ('22222222-2222-4222-8222-222222222225', 'clerk-loader-1', 'loader', 'Lee Loader', '555-2002', 'loader@northpine.example', '33333333-3333-4333-8333-333333333331', 'verified', true);

insert into public.driver_profiles (id, profile_id, company_id, availability_status, license_number, years_experience, home_base, equipment_preferences, notes)
values
  ('44444444-4444-4444-8444-444444444441', '22222222-2222-4222-8222-222222222221', '33333333-3333-4333-8333-333333333331', 'available', 'CDL-A-9001', 11, 'Cascade Foothills', '{tridem,self-loader}', 'Prefers sunrise dispatch and chip loads.'),
  ('44444444-4444-4444-8444-444444444442', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333331', 'limited', 'CDL-A-9002', 7, 'Oak Landing', '{pole-trailer}', 'Unavailable after 16:00 on Fridays.'),
  ('44444444-4444-4444-8444-444444444443', '22222222-2222-4222-8222-222222222223', '33333333-3333-4333-8333-333333333332', 'available', 'CDL-A-9003', 14, 'Blue River', '{bunk-trailer,chains}', 'Comfortable with snowy high-grade routes.');

insert into public.dispatcher_profiles (id, profile_id, company_id, dispatch_region, contact_name, contact_phone, contact_email)
values
  ('55555555-5555-4555-8555-555555555551', '22222222-2222-4222-8222-222222222224', '33333333-3333-4333-8333-333333333331', 'Cascade Foothills', 'Dana Dispatch', '555-2001', 'dispatch@northpine.example');

insert into public.loader_profiles (id, profile_id, company_id, landing_id, contact_name, contact_phone, contact_email, shift_notes)
values
  ('55555555-5555-4555-8555-555555555552', '22222222-2222-4222-8222-222222222225', '33333333-3333-4333-8333-333333333331', null, 'Lee Loader', '555-2002', 'loader@northpine.example', 'Loader starts 05:30 weekdays.');