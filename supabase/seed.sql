-- seed.sql — PNW (Inland NW) demo scenario. Not run by CI; applied via
-- `supabase db reset`. Fixed UUIDs keep local demos repeatable.

insert into users (id, clerk_user_id, full_name, email, phone, primary_role) values
  ('11111111-1111-1111-1111-111111111111','demo_clerk_outfit','Marla Boone','marla@priestriverlogging.test','+12085550101','outfit'),
  ('22222222-2222-2222-2222-222222222222','demo_clerk_driver','Dale Whitaker','dale@example.test','+12085550102','driver'),
  ('33333333-3333-3333-3333-333333333333','demo_clerk_loader','Russ Tilden','russ@priestriverlogging.test','+12085550103','loader');

insert into organizations (id, name, organization_type, operating_region, verification_status, subscription_status, created_by) values
  ('a0000000-0000-0000-0000-000000000001','Priest River Logging Co.','outfit','Inland Northwest','verified','active','11111111-1111-1111-1111-111111111111');

insert into organization_members (organization_id, user_id, role, status, invited_by) values
  ('a0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','owner','active',null),
  ('a0000000-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333','loader','active','11111111-1111-1111-1111-111111111111');

insert into outfit_profiles (organization_id, public_name, description, contact_phone, contact_email, operating_regions, verification_status, profile_completion_score) values
  ('a0000000-0000-0000-0000-000000000001','Priest River Logging Co.','Family logging outfit working the Priest River and Colville areas.','+12085550101','dispatch@priestriverlogging.test','{Inland Northwest,North Idaho}','verified',90);

insert into driver_profiles (id, user_id, home_base_label, home_base_lat, home_base_lng, operating_radius_miles, availability_status, preferred_regions, verification_status, profile_completion_score) values
  ('d0000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','Sandpoint, ID',48.2766,-116.5535,120,'available_now','{North Idaho,Eastern Washington}','verified',85);

insert into truck_profiles (id, driver_profile_id, truck_name, truck_type, trailer_type, active_status, verification_status) values
  ('70000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Old Blue','long_logger','tri-axle log trailer','active','verified');

insert into haul_opportunities (id, organization_id, title, status, visibility, approximate_landing_label, approximate_landing_lat, approximate_landing_lng, destination_label, destination_lat, destination_lng, truck_type_required, pay_model, pay_visibility, rate_min, rate_max, duration_estimate, road_notes, created_by) values
  ('40000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Priest River landing -> Colville mill','active','public','Priest River area, ID',48.18,-116.91,'Colville, WA mill',48.5466,-117.9050,'long_logger','per_load','range_visible',280,340,'~2 weeks','Forest road, washboard last 4 miles; chains in AM.','11111111-1111-1111-1111-111111111111');

insert into haul_private_details (haul_id, exact_landing_label, exact_landing_lat, exact_landing_lng, gate_access_notes, road_access_notes, sensitive_instructions) values
  ('40000000-0000-0000-0000-000000000001','Landing 3, NF-1342 spur',48.1873,-116.9241,'Locked gate; code 4417.','Stay right at the fork; bridge weight limit posted.','Call loader before entering; active falling on the west side.');

insert into truck_slots (id, haul_id, slot_date, start_window, end_window, trucks_needed, trucks_confirmed, standby_needed, status, created_by) values
  ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',current_date,'05:30','15:00',2,1,1,'partially_filled','11111111-1111-1111-1111-111111111111'),
  ('50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001',current_date + 1,'05:30','15:00',3,0,0,'open','11111111-1111-1111-1111-111111111111'),
  ('50000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001',current_date + 2,'06:00','15:00',2,0,1,'standby_open','11111111-1111-1111-1111-111111111111');

insert into slot_requests (id, slot_id, driver_profile_id, truck_profile_id, status, request_note, reviewed_by, reviewed_at) values
  ('60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','accepted','Can start at 5:30, based in Sandpoint.','11111111-1111-1111-1111-111111111111',now());

insert into assignments (id, slot_id, haul_id, organization_id, driver_profile_id, truck_profile_id, status, confirmed_by, confirmed_at) values
  ('80000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','confirmed','11111111-1111-1111-1111-111111111111',now());

insert into standby_assignments (slot_id, driver_profile_id, truck_profile_id, status, priority_order, created_by) values
  ('50000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','offered',1,'11111111-1111-1111-1111-111111111111');

insert into operational_updates (object_type, object_id, update_type, severity, message, created_by) values
  ('truck_slot','50000000-0000-0000-0000-000000000001','start_time_change','important','Loader window moved to 6:00 AM -- fog on the hill.','33333333-3333-3333-3333-333333333333');

insert into reminders (user_id, object_type, object_id, remind_at, reminder_type, status) values
  ('22222222-2222-2222-2222-222222222222','assignment','80000000-0000-0000-0000-000000000001',now() + interval '12 hours','job_day_before','scheduled');

insert into verification_records (subject_type, subject_id, verification_type, status, submitted_by, submitted_at) values
  ('driver','d0000000-0000-0000-0000-000000000001','cdl','approved','22222222-2222-2222-2222-222222222222',now());

insert into reliability_events (subject_type, subject_id, event_type, severity, source_object_type, source_object_id, disputed_status) values
  ('driver','d0000000-0000-0000-0000-000000000001','completed','positive','assignment','80000000-0000-0000-0000-000000000001','none');
