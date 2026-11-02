-- =============================================================================
-- LogLoads normalized-v2 — 03 entitlements (catalog seed, workflows, queries)
-- NON-ACTIVE PROTOTYPE. See 01_schema.sql header.
--
-- Why functions here:
--   * Multi-table operations that must be atomic and concurrency-safe
--     (invitations, founding cohort slots, billing-cycle resets, boost
--     activation, private-location unlock, audited admin actions).
--   * Every function has a single explicit caller class via GRANT EXECUTE:
--     either `authenticated` (with role checks inside) or `service_role`
--     (narrow server-worker entry points — no raw table access).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Reference catalog seed (data, not code constants — insert a new version row
-- to change a price, allowance, or feature set without rewriting history).
-- Codes and feature identifiers match `packages/contracts/src/membership.ts`.
-- -----------------------------------------------------------------------------

insert into marketplace.equipment_types (code, category, label, sort_order) values
  ('log_truck',     'truck',      'Log truck',            10),
  ('self_loader',   'truck',      'Self-loader log truck',20),
  ('chip_truck',    'truck',      'Chip truck',           30),
  ('lowboy_tractor','truck',      'Lowboy / heavy haul',  40),
  ('pole_trailer',  'trailer',    'Pole trailer',        110),
  ('bunk_trailer',  'trailer',    'Bunk / short-log',    120),
  ('mule_train',    'trailer',    'Mule train',          130),
  ('chip_van',      'trailer',    'Chip van',            140),
  ('lowboy_trailer','trailer',    'Lowboy trailer',      150),
  ('onboard_scales','attachment', 'On-board scales',     210),
  ('central_tire',  'attachment', 'Central tire inflation', 220)
on conflict (code) do nothing;

insert into marketplace.subscription_plans
  (code, version, name, status, monthly_price_cents, max_active_landings, max_team_members, monthly_invitations,
   past_due_grace_days, invitation_dedupe_days, invitation_reservation_timeout_minutes, features)
values
  ('basic', 1, 'Basic', 'active', 14900, 1, 2, 3, 7, 30, 15,
   array[]::text[]),
  ('pro', 1, 'Pro', 'active', 29900, 3, 5, 10, 7, 30, 15,
   array['advanced_hauler_search', 'availability_alerts', 'posting_templates', 'multi_landing_inbox']),
  ('regional', 1, 'Regional', 'active', 49900, null, 10, 30, 7, 30, 15,
   array['advanced_hauler_search', 'availability_alerts', 'posting_templates', 'multi_landing_inbox',
         'regional_capacity_overview', 'advanced_team_workflows', 'priority_support'])
on conflict (code, version) do nothing;

insert into marketplace.boost_products
  (code, version, name, duration_days, price_cents, radius_miles, status)
values
  ('quick',    1, 'Quick Boost',    7,  9900, 100, 'active'),
  ('extended', 1, 'Extended Boost', 14, 14900, 100, 'active'),
  ('campaign', 1, 'Campaign Boost', 28, 19900, 100, 'active')
on conflict (code, version) do nothing;

-- -----------------------------------------------------------------------------
-- Account & inquiry actions (granted to `authenticated`)
-- -----------------------------------------------------------------------------

-- Create an organization and make the caller its first active owner.
-- Setting p_enable_hauler = true also creates the free hauler profile.
create function marketplace.create_organization(
  p_display_name text, p_slug text, p_home_state char(2) default null, p_enable_hauler boolean default false
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_user uuid := marketplace.current_user_id();
  v_org  uuid;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  insert into marketplace.organizations (display_name, slug, home_state, created_by)
  values (p_display_name, p_slug, p_home_state, v_user)
  returning id into v_org;

  insert into marketplace.organization_memberships (org_id, user_id, role, status, invited_by)
  values (v_org, v_user, 'owner', 'active', v_user);

  if p_enable_hauler then
    insert into marketplace.hauler_profiles (org_id) values (v_org);
  end if;

  perform marketplace.write_audit('organization.created', 'organizations', v_org, v_org);
  return v_org;
end
$$;

-- Landing staff (`landing_workspace_seat = true`) update inquiry status and
-- optionally share exact gate/access details with that interested hauler.
-- Never touches invitation allowances.
create function marketplace.respond_to_interest(
  p_interest_id uuid, p_status text, p_share_private_details boolean default null
) returns void
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_user uuid := marketplace.current_user_id();
  v_row  marketplace.expressions_of_interest;
begin
  if p_status not in ('viewed', 'replied', 'declined') then
    raise exception 'invalid landing response status: %', p_status using errcode = '22023';
  end if;
  select * into v_row from marketplace.expressions_of_interest where id = p_interest_id for update;
  if not found or not marketplace.has_org_role(v_row.job_org_id, array['owner', 'manager', 'staff'], true) then
    raise exception 'not authorized for this inquiry' using errcode = '42501';
  end if;
  if v_row.status = 'withdrawn' then
    raise exception 'inquiry was withdrawn by the hauler' using errcode = '23514';
  end if;

  update marketplace.expressions_of_interest
  set status = p_status,
      responded_at = coalesce(responded_at, now()),
      private_details_shared_at = case
        when p_share_private_details is true  then coalesce(private_details_shared_at, now())
        when p_share_private_details is false then null
        else private_details_shared_at end,
      private_details_shared_by = case
        when p_share_private_details is true  then coalesce(private_details_shared_by, v_user)
        when p_share_private_details is false then null
        else private_details_shared_by end
  where id = p_interest_id;

  if p_share_private_details is not null then
    perform marketplace.write_audit(
      case when p_share_private_details then 'landing_private.shared' else 'landing_private.revoked' end,
      'expressions_of_interest', p_interest_id, v_row.job_org_id,
      null, jsonb_build_object('hauler_org_id', v_row.hauler_org_id, 'job_id', v_row.job_id));
  end if;
end
$$;

-- Hauler org withdraws its expression of interest, immediately revoking any
-- shared private landing access for that inquiry.
create function marketplace.withdraw_interest(p_interest_id uuid)
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
  update marketplace.expressions_of_interest
  set status = 'withdrawn',
      withdrawn_at = now(),
      private_details_shared_at = null,
      private_details_shared_by = null
  where id = p_interest_id;
  perform marketplace.write_audit('interest.withdrawn', 'expressions_of_interest', p_interest_id, v_row.hauler_org_id);
end
$$;

-- Recipient hauler acknowledges or declines a targeted invitation.
create function marketplace.respond_to_invitation(p_invitation_id uuid, p_response text)
returns void language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare v_inv marketplace.targeted_invitations;
begin
  if p_response not in ('viewed', 'interested', 'declined') then
    raise exception 'invalid invitation response: %', p_response using errcode = '22023';
  end if;
  select * into v_inv from marketplace.targeted_invitations where id = p_invitation_id for update;
  if not found or not marketplace.has_org_role(v_inv.recipient_org_id, array['owner', 'manager', 'staff', 'driver']) then
    raise exception 'not authorized for this invitation' using errcode = '42501';
  end if;
  update marketplace.targeted_invitations
  set recipient_response = p_response, responded_at = now()
  where id = p_invitation_id;
end
$$;

-- -----------------------------------------------------------------------------
-- Low-density market protection & targeted invitation quota accounting
-- -----------------------------------------------------------------------------

-- Predicate shared by audience count and reservation: active hauler org,
-- public profile, explicit opt-in, at least one user with an enabled delivery
-- channel, not under its weekly frequency cap, not invited within the
-- deduplication window (`p_dedupe_window`, defaulting to the sender plan's
-- provisional `invitation_dedupe_days` column), and either a current
-- availability report near the landing or matching equipment within declared
-- service radius.
-- Spatial note (Item 5): because both `landings.public_point` and hauler
-- `area_center` / `service_center` are snapped to 0.1° cell centers (max ~4.9 mi
-- shift per endpoint), ST_DWithin includes an 8,000 m (~5 mi) quantization
-- tolerance buffer so coarse snapping never silently excludes boundary matches.
create function marketplace.eligible_invitation_recipients(
  p_job_id uuid,
  p_radius_miles integer default 100,
  p_dedupe_window interval default null
)
returns setof uuid
language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  with job_ctx as (
    select j.id as job_id, j.org_id as sender_org_id, l.public_point,
           coalesce(nullif(p_radius_miles, 0), 100)::double precision * 1609.344 as radius_m,
           coalesce(
             p_dedupe_window,
             coalesce((marketplace.org_entitled_plan(j.org_id)).invitation_dedupe_days, 30) * interval '1 day'
           ) as dedupe_window,
           array(select e.equipment_code from marketplace.job_posting_equipment e where e.job_id = j.id) as req_codes
    from marketplace.job_postings j
    join marketplace.landings l on l.id = j.landing_id
    join marketplace.organizations o on o.id = j.org_id and o.status = 'active'
    where j.id = p_job_id
      and j.status = 'active'
      and (j.expires_at is null or j.expires_at > now())
      and l.status = 'active'
  )
  select h.org_id
  from job_ctx c
  join marketplace.hauler_profiles h on h.is_public and h.accepts_targeted_invitations
  join marketplace.organizations o on o.id = h.org_id and o.status = 'active'
  where h.org_id <> c.sender_org_id
    and not exists (
      select 1 from marketplace.targeted_invitations ti
      where ti.job_id = c.job_id
        and ti.recipient_org_id = h.org_id
        and (
          ti.status = 'reserved'
          or (ti.status = 'delivered'
              and (c.dedupe_window is null or ti.created_at >= now() - c.dedupe_window))
        ))
    and not exists (
      select 1 from marketplace.expressions_of_interest e
      where e.job_id = c.job_id and e.hauler_org_id = h.org_id and e.status <> 'withdrawn')
    and (
      select count(*) from marketplace.targeted_invitations ti
      where ti.recipient_org_id = h.org_id
        and ti.status in ('reserved', 'delivered')
        and ti.created_at >= now() - interval '7 days'
    ) < h.max_invitations_per_week
    and exists (
      select 1 from marketplace.organization_memberships m
      join marketplace.app_users u on u.id = m.user_id and u.status = 'active'
      join marketplace.notification_preferences np
        on np.user_id = m.user_id and np.org_id = m.org_id
       and np.category = 'targeted_invitation' and np.enabled
      where m.org_id = h.org_id and m.status = 'active')
    and (
      exists (
        select 1 from marketplace.availability_reports ar
        where ar.org_id = h.org_id
          and ar.withdrawn_at is null
          and ar.available_until >= current_date
          and (cardinality(c.req_codes) = 0 or ar.equipment_code = any (c.req_codes))
          and extensions.st_dwithin(
                ar.area_center, c.public_point,
                least(c.radius_m, ar.radius_miles::double precision * 1609.344) + 8000.0))
      or (
        h.service_center is not null
        and extensions.st_dwithin(
              h.service_center, c.public_point,
              least(c.radius_m, coalesce(h.service_radius_miles, 100)::double precision * 1609.344) + 8000.0)
        and (cardinality(c.req_codes) = 0 or exists (
              select 1 from marketplace.equipment_units eu
              where eu.org_id = h.org_id and eu.is_active and eu.equipment_code = any (c.req_codes))))
    )
$$;

-- Shown before sending so a low-density area never masquerades as a large pool.
create function marketplace.count_eligible_invitation_recipients(
  p_job_id uuid,
  p_radius_miles integer default 100,
  p_dedupe_window interval default null
)
returns integer language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare v_org uuid;
begin
  select org_id into v_org from marketplace.job_postings where id = p_job_id;
  if v_org is null or not marketplace.has_org_role(v_org, array['owner', 'manager', 'staff'], true) then
    raise exception 'not authorized for this job' using errcode = '42501';
  end if;
  return (select count(*)::integer from marketplace.eligible_invitation_recipients(p_job_id, p_radius_miles, p_dedupe_window));
end
$$;

-- Concurrency-safe reservation:
--   1. Advisory xact lock on recipient_org_id serializes the weekly cap and
--      rolling deduplication check.
--   2. Rejects sending while the sender organization has an unresolved downgrade
--      seat or landing conflict (Item 1).
--   3. Conditional UPDATE on entitlement_periods (`invitations_committed < invitation_allowance`).
--      PostgreSQL takes a row lock and re-evaluates the WHERE clause against
--      the post-commit tuple, so two simultaneous callers with 1 unit left
--      serialize and the second sees 0 rows updated.
--   4. Partial unique indexes `targeted_invitations_reserved_uq` and
--      `targeted_invitations_period_dedupe_uq` enforce hard uniqueness in-flight
--      and within the billing period, while allowing long-lived postings
--      to re-invite after `p_dedupe_window` in a future billing period.
--   5. Delivery rows are queued for opted-in channels; if the async sender
--      later reports every channel failed (or the reservation times out via
--      `expire_stale_invitation_reservations`), the reserved unit is released.
create function marketplace.reserve_targeted_invitation(
  p_job_id uuid,
  p_recipient_org_id uuid,
  p_note text default null,
  p_dedupe_window interval default null
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_user      uuid := marketplace.current_user_id();
  v_job       marketplace.job_postings;
  v_plan      marketplace.subscription_plans;
  v_seats     integer;
  v_landings  integer;
  v_period_id uuid;
  v_inv_id    uuid;
  v_queued    integer;
begin
  select * into v_job from marketplace.job_postings where id = p_job_id;
  if not found or v_job.status <> 'active' or (v_job.expires_at is not null and v_job.expires_at <= now()) then
    raise exception 'job posting must be active to send invitations' using errcode = '23514';
  end if;
  if not marketplace.has_org_role(v_job.org_id, array['owner', 'manager'], true) then
    raise exception 'only organization owners or managers with a Landing Operator seat may send targeted invitations' using errcode = '42501';
  end if;

  v_plan := marketplace.org_entitled_plan(v_job.org_id);
  if v_plan.id is null then
    raise exception 'no active billing-cycle entitlement period for organization' using errcode = '23514';
  end if;

  select count(*) into v_seats
  from marketplace.organization_memberships m
  where m.org_id = v_job.org_id and m.status in ('invited', 'active') and m.landing_workspace_seat;
  if v_seats > v_plan.max_team_members then
    raise exception 'organization has % paid landing seats which exceeds plan % limit of %; resolve seat conflict before sending invitations',
      v_seats, v_plan.name, v_plan.max_team_members
      using errcode = '23514', hint = 'Remove or convert excess landing seats to fleet-only, or upgrade your subscription.';
  end if;

  if v_plan.max_active_landings is not null then
    select count(*) into v_landings
    from marketplace.landings l
    where l.org_id = v_job.org_id and l.status = 'active';
    if v_landings > v_plan.max_active_landings then
      raise exception 'organization has % active landings which exceeds plan % limit of %; resolve landing conflict before sending invitations',
        v_landings, v_plan.name, v_plan.max_active_landings
        using errcode = '23514', hint = 'Deactivate excess landings or upgrade your subscription.';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_recipient_org_id::text, 20261101));

  if not exists (
    select 1 from marketplace.eligible_invitation_recipients(p_job_id, 500, p_dedupe_window) r where r = p_recipient_org_id
  ) then
    raise exception 'recipient organization is not currently eligible or opted in for this job' using errcode = '23514';
  end if;

  update marketplace.entitlement_periods ep
  set invitations_committed = ep.invitations_committed + 1
  from marketplace.organization_subscriptions s
  where ep.org_id = v_job.org_id
    and ep.subscription_id = s.id
    and marketplace.subscription_is_entitling(s.status, s.current_period_end, s.grace_ends_at)
    and now() >= ep.period_start and now() < ep.period_end
    and ep.invitations_committed < ep.invitation_allowance
  returning ep.id into v_period_id;

  if v_period_id is null then
    if exists (
      select 1 from marketplace.entitlement_periods ep
      join marketplace.organization_subscriptions s on s.id = ep.subscription_id
      where ep.org_id = v_job.org_id
        and marketplace.subscription_is_entitling(s.status, s.current_period_end, s.grace_ends_at)
        and now() >= ep.period_start and now() < ep.period_end
    ) then
      raise exception 'monthly targeted invitation allowance exhausted (no overage or rollover)' using errcode = '23514';
    else
      raise exception 'no active billing-cycle entitlement period for organization' using errcode = '23514';
    end if;
  end if;

  insert into marketplace.targeted_invitations
    (job_id, sender_org_id, recipient_org_id, sent_by, entitlement_period_id, status, note)
  values
    (p_job_id, v_job.org_id, p_recipient_org_id, v_user, v_period_id, 'reserved', p_note)
  returning id into v_inv_id;

  insert into marketplace.invitation_deliveries (invitation_id, channel, recipient_user_id)
  select v_inv_id, np.channel, m.user_id
  from marketplace.organization_memberships m
  join marketplace.app_users u on u.id = m.user_id and u.status = 'active'
  join marketplace.notification_preferences np
    on np.user_id = m.user_id and np.org_id = m.org_id
   and np.category = 'targeted_invitation' and np.enabled
  where m.org_id = p_recipient_org_id and m.status = 'active';

  get diagnostics v_queued = row_count;
  if v_queued = 0 then
    raise exception 'recipient has no active delivery channels' using errcode = '23514';
  end if;

  perform marketplace.write_audit(
    'invitation.reserved', 'targeted_invitations', v_inv_id, v_job.org_id,
    null, jsonb_build_object('job_id', p_job_id, 'recipient_org_id', p_recipient_org_id, 'period_id', v_period_id));
  return v_inv_id;
end
$$;

-- Called by the delivery worker (`service_role`).
-- Lock order (Risk 3 fix): lock parent `targeted_invitations` FIRST, then
-- child `invitation_deliveries`, so concurrent multi-channel callbacks can
-- never deadlock. Quota release is guarded by `WHERE id = v_inv.id AND status = 'reserved'`
-- so an invitation can transition out of `reserved` and refund at most once.
create function marketplace.resolve_invitation_delivery(
  p_delivery_id uuid, p_status text, p_provider_message_ref text default null, p_detail text default null
) returns void
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_inv_id uuid;
  v_inv    marketplace.targeted_invitations;
begin
  if p_status not in ('sent', 'delivered', 'failed', 'bounced') then
    raise exception 'invalid delivery status: %', p_status using errcode = '22023';
  end if;
  select invitation_id into v_inv_id from marketplace.invitation_deliveries where id = p_delivery_id;
  if v_inv_id is null then
    raise exception 'delivery % not found', p_delivery_id using errcode = 'P0002';
  end if;

  select * into v_inv from marketplace.targeted_invitations where id = v_inv_id for update;
  perform 1 from marketplace.invitation_deliveries where id = p_delivery_id for update;

  update marketplace.invitation_deliveries
  set status = p_status,
      provider_message_ref = coalesce(p_provider_message_ref, provider_message_ref),
      detail = coalesce(p_detail, detail)
  where id = p_delivery_id;

  if v_inv.status <> 'reserved' then
    return;
  end if;

  if p_status = 'delivered' then
    update marketplace.targeted_invitations
    set status = 'delivered', delivered_at = now(), resolved_at = now()
    where id = v_inv.id and status = 'reserved';
    if found then
      perform marketplace.write_audit('invitation.delivered', 'targeted_invitations', v_inv.id, v_inv.sender_org_id);
    end if;
  elsif not exists (
    select 1 from marketplace.invitation_deliveries d
    where d.invitation_id = v_inv.id and d.status in ('pending', 'sent', 'delivered')
  ) then
    update marketplace.targeted_invitations
    set status = 'failed', resolved_at = now(), failure_reason = coalesce(p_detail, 'all_channels_failed')
    where id = v_inv.id and status = 'reserved';

    if found then
      update marketplace.entitlement_periods
      set invitations_committed = greatest(invitations_committed - 1, 0)
      where id = v_inv.entitlement_period_id;

      perform marketplace.write_audit(
        'invitation.failed_refunded', 'targeted_invitations', v_inv.id, v_inv.sender_org_id,
        p_detail, jsonb_build_object('period_id', v_inv.entitlement_period_id));
    end if;
  end if;
end
$$;

-- Recover stuck reservations (`service_role` scheduled worker). Any invitation
-- still in `status = 'reserved'` older than `p_max_age` (defaulting to the
-- sender plan's provisional `invitation_reservation_timeout_minutes` column,
-- 15 minutes) with no delivered channel is marked `failed` and its reserved
-- allowance unit is returned to its originating `entitlement_periods` row.
create function marketplace.expire_stale_invitation_reservations(
  p_max_age interval default null
) returns integer
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_inv      marketplace.targeted_invitations;
  v_released integer := 0;
begin
  if p_max_age is not null and p_max_age <= interval '0 seconds' then
    raise exception 'p_max_age must be a positive interval' using errcode = '22023';
  end if;

  for v_inv in
    select ti.*
    from marketplace.targeted_invitations ti
    left join marketplace.entitlement_periods ep on ep.id = ti.entitlement_period_id
    left join marketplace.subscription_plans sp on sp.id = ep.plan_id
    where ti.status = 'reserved'
      and ti.created_at <= now() - coalesce(
        p_max_age,
        coalesce(sp.invitation_reservation_timeout_minutes, 15) * interval '1 minute'
      )
    order by ti.created_at
    for update of ti skip locked
  loop
    if exists (
      select 1 from marketplace.invitation_deliveries d
      where d.invitation_id = v_inv.id and d.status = 'delivered'
    ) then
      update marketplace.targeted_invitations
      set status = 'delivered', delivered_at = now(), resolved_at = now()
      where id = v_inv.id and status = 'reserved';
    else
      update marketplace.invitation_deliveries
      set status = 'failed', detail = coalesce(detail, 'reservation_timeout')
      where invitation_id = v_inv.id and status in ('pending', 'sent');

      update marketplace.targeted_invitations
      set status = 'failed', resolved_at = now(), failure_reason = 'reservation_timeout'
      where id = v_inv.id and status = 'reserved';

      if found then
        update marketplace.entitlement_periods
        set invitations_committed = greatest(invitations_committed - 1, 0)
        where id = v_inv.entitlement_period_id;

        perform marketplace.write_audit(
          'invitation.reservation_expired', 'targeted_invitations', v_inv.id, v_inv.sender_org_id,
          'reservation_timeout', jsonb_build_object('period_id', v_inv.entitlement_period_id));
        v_released := v_released + 1;
      end if;
    end if;
  end loop;

  return v_released;
end
$$;

-- -----------------------------------------------------------------------------
-- Subscriptions, billing-cycle resets (no rollover), boosts, founding offers
-- -----------------------------------------------------------------------------

-- Called by the billing worker on verified subscription lifecycle events.
--   * Creates the matching entitlement_periods row with invitations_committed = 0;
--     previous periods are untouched and never rolled forward.
--   * Sets an explicit bounded grace window (`grace_ends_at`) when `p_status = 'past_due'`,
--     defaulting `p_grace_days` to the plan's provisional `past_due_grace_days` (7 days).
--   * Downgrade policy (Items 1 & 2):
--     - Never automatically suspends or removes organization members.
--     - Counts only paid Landing Operator seats (`landing_workspace_seat = true`);
--       free fleet-only drivers and staff (`landing_workspace_seat = false`) never
--       count against `max_team_members`.
--     - When `p_allow_over_limit = false` (default for interactive plan changes),
--       raises an explicit `23514` exception if paid landing seats exceed
--       `max_team_members` or active landings exceed `max_active_landings`,
--       requiring an explicit owner resolution first.
--     - When `p_allow_over_limit = true` (external Stripe renewal webhook),
--       preserves existing member access and landing records, records the conflict
--       in `audit_events` and `get_org_entitlement_state`, and blocks only new
--       landing activations, job publications, and invitations until resolved.
create function marketplace.open_subscription_cycle(
  p_org_id uuid, p_plan_code text, p_status text,
  p_period_start timestamptz, p_period_end timestamptz,
  p_provider_customer_ref text default null, p_provider_subscription_ref text default null,
  p_cancel_at_period_end boolean default false,
  p_grace_days integer default null,
  p_allow_over_limit boolean default false
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_plan            marketplace.subscription_plans;
  v_sub             marketplace.organization_subscriptions;
  v_sub_id          uuid;
  v_period_id       uuid;
  v_promo_id        uuid;
  v_grace_days      integer;
  v_past_due_since  timestamptz;
  v_grace_ends_at   timestamptz;
  v_paid_seats      integer := 0;
  v_active_landings integer := 0;
  v_is_new_period   boolean := false;
begin
  perform 1 from marketplace.organizations where id = p_org_id for update;
  select * into v_plan from marketplace.subscription_plans
  where code = p_plan_code and status = 'active' limit 1;
  if not found then
    raise exception 'unknown active subscription plan: %', p_plan_code using errcode = 'P0002';
  end if;

  v_grace_days := coalesce(p_grace_days, v_plan.past_due_grace_days);
  if v_grace_days < 0 or v_grace_days > 60 then
    raise exception 'p_grace_days must be between 0 and 60' using errcode = '22023';
  end if;

  select count(*) into v_paid_seats
  from marketplace.organization_memberships
  where org_id = p_org_id and status in ('invited', 'active') and landing_workspace_seat;

  select count(*) into v_active_landings
  from marketplace.landings
  where org_id = p_org_id and status = 'active';

  if marketplace.subscription_is_entitling(p_status, p_period_end,
       case when p_status = 'past_due' then now() + greatest(v_grace_days, 1) * interval '24 hours' end)
     and not p_allow_over_limit then
    if v_paid_seats > v_plan.max_team_members then
      raise exception 'organization has % paid landing workspace seats which exceeds plan % limit of %; explicitly remove or convert excess seats to fleet-only before downgrading',
        v_paid_seats, v_plan.name, v_plan.max_team_members
        using errcode = '23514',
              hint = 'Update excess members to landing_workspace_seat = false or status = ''removed'' before changing plans.';
    end if;
    if v_plan.max_active_landings is not null and v_active_landings > v_plan.max_active_landings then
      raise exception 'organization has % active landings which exceeds plan % limit of %; explicitly deactivate excess landings before downgrading',
        v_active_landings, v_plan.name, v_plan.max_active_landings
        using errcode = '23514',
              hint = 'Deactivate excess landings before changing plans.';
    end if;
  end if;

  select * into v_sub from marketplace.organization_subscriptions
  where org_id = p_org_id and status <> 'canceled' for update;

  if p_status = 'past_due' then
    v_past_due_since := coalesce(v_sub.past_due_since, now());
    v_grace_ends_at  := v_past_due_since + greatest(v_grace_days, 1) * interval '24 hours';
  end if;

  if p_status in ('trialing', 'active') then
    select pr.id into v_promo_id
    from marketplace.promotion_redemptions pr
    join marketplace.promotions p on p.id = pr.promotion_id
    where pr.org_id = p_org_id and pr.status in ('granted', 'applied')
      and pr.cycles_applied < p.billing_cycles
    limit 1
    for update;
  end if;

  if v_sub.id is null then
    insert into marketplace.organization_subscriptions
      (org_id, plan_id, status, current_period_start, current_period_end,
       past_due_since, grace_ends_at, cancel_at_period_end,
       promotion_redemption_id, provider, provider_customer_ref, provider_subscription_ref)
    values
      (p_org_id, v_plan.id, p_status, p_period_start, p_period_end,
       v_past_due_since, v_grace_ends_at, p_cancel_at_period_end,
       v_promo_id, case when p_provider_subscription_ref is not null then 'stripe' end,
       p_provider_customer_ref, p_provider_subscription_ref)
    returning id into v_sub_id;
  else
    v_sub_id := v_sub.id;
    update marketplace.organization_subscriptions
    set plan_id = v_plan.id,
        status = p_status,
        current_period_start = p_period_start,
        current_period_end = p_period_end,
        past_due_since = v_past_due_since,
        grace_ends_at = v_grace_ends_at,
        cancel_at_period_end = p_cancel_at_period_end,
        promotion_redemption_id = coalesce(v_promo_id, promotion_redemption_id),
        provider_customer_ref = coalesce(p_provider_customer_ref, provider_customer_ref),
        provider_subscription_ref = coalesce(p_provider_subscription_ref, provider_subscription_ref),
        canceled_at = case when p_status = 'canceled' then now() else canceled_at end
    where id = v_sub_id;
  end if;

  if marketplace.subscription_is_entitling(p_status, p_period_end, v_grace_ends_at) then
    -- Truncate any earlier overlapping period for this org so mid-cycle plan upgrades
    -- or timestamp adjustments across separate transactions never violate the GiST exclusion constraint.
    update marketplace.entitlement_periods
    set period_end = p_period_start
    where org_id = p_org_id
      and period_start < p_period_start
      and period_end > p_period_start;

    v_is_new_period := not exists (
      select 1 from marketplace.entitlement_periods
      where subscription_id = v_sub_id and period_start = p_period_start
    );

    insert into marketplace.entitlement_periods
      (org_id, subscription_id, plan_id, period_start, period_end, invitation_allowance, invitations_committed)
    values
      (p_org_id, v_sub_id, v_plan.id, p_period_start, p_period_end, v_plan.monthly_invitations, 0)
    on conflict (subscription_id, period_start) do update
      set plan_id = excluded.plan_id,
          period_end = excluded.period_end,
          invitation_allowance = greatest(excluded.invitation_allowance, marketplace.entitlement_periods.invitations_committed)
    returning id into v_period_id;

    if v_is_new_period and v_promo_id is not null and p_status = 'active' then
      update marketplace.promotion_redemptions pr
      set cycles_applied = pr.cycles_applied + 1,
          status = case when pr.cycles_applied + 1 >= p.billing_cycles then 'exhausted' else 'applied' end
      from marketplace.promotions p
      where pr.id = v_promo_id and p.id = pr.promotion_id;
    end if;
  else
    -- Only when a subscription ceases to be entitling altogether (e.g. canceled
    -- or expired past grace) are active landings deactivated.
    update marketplace.landings set status = 'inactive' where org_id = p_org_id and status = 'active';
  end if;

  perform marketplace.write_audit(
    'subscription.cycle_opened', 'organization_subscriptions', v_sub_id, p_org_id,
    null, jsonb_build_object(
      'plan', p_plan_code,
      'status', p_status,
      'period_id', v_period_id,
      'grace_ends_at', v_grace_ends_at,
      'paid_landing_seats', v_paid_seats,
      'max_team_members', v_plan.max_team_members,
      'seat_conflict', (v_paid_seats > v_plan.max_team_members),
      'active_landings', v_active_landings,
      'max_active_landings', v_plan.max_active_landings,
      'landing_conflict', (v_plan.max_active_landings is not null and v_active_landings > v_plan.max_active_landings)
    ));
  return v_sub_id;
end
$$;

-- Returns an organization's current subscription, quota, and downgrade-conflict
-- posture so the UI and tests can surface recoverable seat/landing conflicts
-- without ever silently suspending employee accounts.
create function marketplace.get_org_entitlement_state(p_org_id uuid)
returns table (
  plan_code text,
  subscription_status text,
  active_landings integer,
  max_active_landings integer,
  landing_conflict boolean,
  paid_landing_seats integer,
  max_team_members integer,
  fleet_only_members integer,
  seat_conflict boolean,
  invitations_remaining integer,
  period_end timestamptz,
  grace_ends_at timestamptz
)
language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_sub   marketplace.organization_subscriptions;
  v_plan  marketplace.subscription_plans;
  v_rem   integer := 0;
begin
  if not marketplace.has_org_role(p_org_id, array['owner', 'manager', 'staff', 'driver'])
     and not marketplace.is_platform_admin(array['billing', 'support']) then
    raise exception 'not authorized for this organization' using errcode = '42501';
  end if;

  select * into v_sub
  from marketplace.organization_subscriptions s
  where s.org_id = p_org_id and s.status <> 'canceled'
  limit 1;

  v_plan := marketplace.org_entitled_plan(p_org_id);

  if v_plan.id is not null then
    select greatest(ep.invitation_allowance - ep.invitations_committed, 0) into v_rem
    from marketplace.entitlement_periods ep
    where ep.org_id = p_org_id
      and ep.subscription_id = v_sub.id
      and now() >= ep.period_start and now() < ep.period_end
    limit 1;
  end if;

  return query
  with counts as (
    select
      (select count(*)::integer from marketplace.landings l where l.org_id = p_org_id and l.status = 'active') as active_landings,
      (select count(*)::integer from marketplace.organization_memberships m
       where m.org_id = p_org_id and m.status in ('invited', 'active') and m.landing_workspace_seat) as paid_seats,
      (select count(*)::integer from marketplace.organization_memberships m
       where m.org_id = p_org_id and m.status in ('invited', 'active') and not m.landing_workspace_seat) as fleet_seats
  )
  select
    v_plan.code,
    v_sub.status,
    c.active_landings,
    v_plan.max_active_landings,
    (v_plan.id is not null and v_plan.max_active_landings is not null and c.active_landings > v_plan.max_active_landings),
    c.paid_seats,
    v_plan.max_team_members,
    c.fleet_seats,
    (v_plan.id is not null and c.paid_seats > v_plan.max_team_members),
    coalesce(v_rem, 0),
    v_sub.current_period_end,
    v_sub.grace_ends_at
  from counts c;
end
$$;

-- Market-density summary shown before boost checkout.
create function marketplace.estimate_boost_audience(p_job_id uuid, p_product_code text default 'quick')
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
     where h.is_public and h.service_center is not null
       and extensions.st_dwithin(h.service_center, v_point, v_m)),
    (select count(*)::integer from marketplace.availability_reports ar
     where ar.withdrawn_at is null and ar.available_until >= current_date
       and extensions.st_dwithin(ar.area_center, v_point, v_m));
end
$$;

-- Activate a paid job boost after payment confirmation. Freezes product terms
-- and the landing's coarse public point; never touches invitations.
-- All three paid landing tiers (Basic, Pro, Regional) are boost-eligible when
-- currently entitled; p_purchased_by must be an active owner/manager holding a
-- Landing Operator workspace seat.
create function marketplace.activate_job_boost(
  p_job_id uuid, p_product_code text, p_purchased_by uuid,
  p_provider_payment_ref text default null, p_starts_at timestamptz default now()
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_job     marketplace.job_postings;
  v_landing marketplace.landings;
  v_prod    marketplace.boost_products;
  v_id      uuid;
begin
  select * into v_job from marketplace.job_postings where id = p_job_id;
  if not found or v_job.status <> 'active' or (v_job.expires_at is not null and v_job.expires_at <= now()) then
    raise exception 'only active job postings may be boosted' using errcode = '23514';
  end if;
  select * into v_landing from marketplace.landings where id = v_job.landing_id and status = 'active';
  if not found then
    raise exception 'landing is not active' using errcode = '23514';
  end if;
  if (marketplace.org_entitled_plan(v_job.org_id)).id is null then
    raise exception 'organization does not have an active landing subscription' using errcode = '23514';
  end if;
  if not exists (
    select 1 from marketplace.organization_memberships m
    where m.org_id = v_job.org_id and m.user_id = p_purchased_by
      and m.status = 'active' and m.role in ('owner', 'manager') and m.landing_workspace_seat
  ) then
    raise exception 'purchaser must be an active owner or manager of the job organization' using errcode = '42501';
  end if;
  select * into v_prod from marketplace.boost_products where code = p_product_code and status = 'active';
  if not found then
    raise exception 'unknown active boost product: %', p_product_code using errcode = 'P0002';
  end if;

  insert into marketplace.job_boosts
    (job_id, org_id, product_id, duration_days, price_cents, currency, radius_miles,
     center_point, status, starts_at, ends_at, purchased_by, provider_payment_ref)
  values
    (v_job.id, v_job.org_id, v_prod.id, v_prod.duration_days, v_prod.price_cents, v_prod.currency, v_prod.radius_miles,
     v_landing.public_point, 'active', p_starts_at, p_starts_at + v_prod.duration_days * interval '24 hours',
     p_purchased_by, p_provider_payment_ref)
  returning id into v_id;

  perform marketplace.write_audit(
    'boost.activated', 'job_boosts', v_id, v_job.org_id,
    null, jsonb_build_object('job_id', p_job_id, 'product', p_product_code, 'ends_at', p_starts_at + v_prod.duration_days * interval '24 hours'));
  return v_id;
end
$$;

-- Founding-operator promotion: locks the promotion row so the per-state cap
-- (10 orgs) cannot be exceeded concurrently, requires a verified organization
-- in the matching state, and relies on UNIQUE (program, org_id) to block an
-- org from claiming a second founding offer in another state.
create function marketplace.admin_grant_founding_promotion(
  p_promotion_code text, p_org_id uuid, p_reason text
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_promo marketplace.promotions;
  v_org   marketplace.organizations;
  v_used  integer;
  v_id    uuid;
begin
  if not marketplace.is_platform_admin(array['billing']) then
    raise exception 'platform billing admin required' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then
    raise exception 'an audit reason is required' using errcode = '22023';
  end if;
  select * into v_promo from marketplace.promotions
  where code = p_promotion_code and status = 'active' for update;
  if not found or now() < v_promo.starts_at or (v_promo.ends_at is not null and now() >= v_promo.ends_at) then
    raise exception 'promotion % is not currently open', p_promotion_code using errcode = '23514';
  end if;
  select * into v_org from marketplace.organizations where id = p_org_id;
  if not found or v_org.status <> 'active' or v_org.verification_status <> 'verified' then
    raise exception 'organization must be active and business-verified' using errcode = '23514';
  end if;
  if v_promo.state_code is not null and v_org.home_state is distinct from v_promo.state_code then
    raise exception 'organization home_state (%) does not match promotion state (%)', v_org.home_state, v_promo.state_code
      using errcode = '23514';
  end if;

  if v_promo.max_redemptions is not null then
    select count(*) into v_used from marketplace.promotion_redemptions
    where promotion_id = v_promo.id and status <> 'revoked';
    if v_used >= v_promo.max_redemptions then
      raise exception 'promotion % has reached its limit of % organizations', p_promotion_code, v_promo.max_redemptions
        using errcode = '23514';
    end if;
  end if;

  insert into marketplace.promotion_redemptions (promotion_id, program, org_id, granted_by)
  values (v_promo.id, v_promo.program, p_org_id, marketplace.current_user_id())
  returning id into v_id;

  perform marketplace.write_audit(
    'promotion.granted', 'promotion_redemptions', v_id, p_org_id, p_reason,
    jsonb_build_object('promotion_code', p_promotion_code, 'state', v_promo.state_code), true);
  return v_id;
end
$$;

-- Founding Hauler recognition badge (Blueprint §8.2, FOUNDING_HAULER_BADGE_LIMIT = 1000).
-- Recognition only; hauler access is already free forever.
create function marketplace.admin_grant_founding_hauler_badge(
  p_org_id uuid, p_reason text
) returns smallint
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_existing smallint;
  v_next     smallint;
begin
  if not marketplace.is_platform_admin(array['moderator', 'support', 'billing']) then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then
    raise exception 'an audit reason is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(20261101, 1000);

  select founding_hauler_number into v_existing
  from marketplace.hauler_profiles where org_id = p_org_id for update;
  if not found then
    raise exception 'organization does not have a hauler profile' using errcode = 'P0002';
  end if;
  if v_existing is not null then
    return v_existing;
  end if;

  select coalesce(max(founding_hauler_number), 0) + 1 into v_next
  from marketplace.hauler_profiles;
  if v_next > 1000 then
    raise exception 'founding hauler badge limit (1000) reached' using errcode = '23514';
  end if;

  update marketplace.hauler_profiles
  set founding_hauler_number = v_next, founding_hauler_granted_at = now()
  where org_id = p_org_id;

  perform marketplace.write_audit(
    'hauler.founding_badge_granted', 'hauler_profiles', p_org_id, p_org_id, p_reason,
    jsonb_build_object('badge_number', v_next), true);
  return v_next;
end
$$;

-- -----------------------------------------------------------------------------
-- Audited platform-admin operations (no silent admin access to sensitive data)
-- -----------------------------------------------------------------------------

create function marketplace.admin_set_org_verification(
  p_org_id uuid, p_status text, p_reason text
) returns void language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
begin
  if not marketplace.is_platform_admin(array['moderator', 'support']) then
    raise exception 'platform moderator or support admin required' using errcode = '42501';
  end if;
  if p_status not in ('unverified', 'pending', 'verified', 'rejected')
     or p_reason is null or char_length(btrim(p_reason)) < 5 then
    raise exception 'valid status and audit reason required' using errcode = '22023';
  end if;
  update marketplace.organizations
  set verification_status = p_status,
      verified_at = case when p_status = 'verified' then now() end,
      verified_by = case when p_status = 'verified' then marketplace.current_user_id() end
  where id = p_org_id;
  perform marketplace.write_audit(
    'organization.verification_set', 'organizations', p_org_id, p_org_id,
    p_reason, jsonb_build_object('verification_status', p_status), true);
end
$$;

create function marketplace.admin_moderate_job_posting(
  p_job_id uuid, p_status text, p_reason text
) returns void language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare v_org uuid;
begin
  if not marketplace.is_platform_admin(array['moderator']) then
    raise exception 'platform moderator required' using errcode = '42501';
  end if;
  if p_status not in ('paused', 'closed', 'expired')
     or p_reason is null or char_length(btrim(p_reason)) < 5 then
    raise exception 'valid moderation status and reason required' using errcode = '22023';
  end if;
  update marketplace.job_postings set status = p_status where id = p_job_id returning org_id into v_org;
  perform marketplace.write_audit(
    'job_posting.moderated', 'job_postings', p_job_id, v_org,
    p_reason, jsonb_build_object('status', p_status), true);
end
$$;

-- Break-glass read of private landing access details: requires support role,
-- a non-empty reason, and writes an audit event in the same transaction.
create function marketplace.admin_read_landing_private(p_landing_id uuid, p_reason text)
returns setof marketplace.landing_private_details
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare v_org uuid;
begin
  if not marketplace.is_platform_admin(array['support']) then
    raise exception 'platform support admin required' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a support ticket / reason (>= 10 chars) is required' using errcode = '22023';
  end if;
  select org_id into v_org from marketplace.landings where id = p_landing_id;
  perform marketplace.write_audit('landing_private.admin_viewed', 'landing_private_details', p_landing_id, v_org, p_reason, '{}', true);
  return query select * from marketplace.landing_private_details where landing_id = p_landing_id;
end
$$;

-- -----------------------------------------------------------------------------
-- Discovery query: honest sponsored flags, user filters never bypassed,
-- sponsored slots capped so organic listings always remain visible.
-- Never reads landing_private_details.
-- Spatial note (Item 5): snaps `p_point` to its 0.1° cell center before
-- computing whole-mile `distance_miles` (preventing sub-cell triangulation) and
-- adds an 8,000 m (~5 mi) quantization buffer to `ST_DWithin` radius checks so
-- 0.1° snapping never silently drops jobs or 100-mile boosts near the boundary.
-- -----------------------------------------------------------------------------

create function marketplace.search_job_postings(
  p_point extensions.geography default null,
  p_radius_miles integer default 100,
  p_equipment_codes text[] default null,
  p_pay_unit text default null,
  p_query text default null,
  p_max_sponsored integer default 2,
  p_limit integer default 50
) returns table (
  job_id uuid, org_id uuid, org_name text, org_verified boolean,
  landing_id uuid, landing_name text, public_area_label text, state_code char(2),
  public_point extensions.geography, distance_miles numeric,
  title text, product text, destination_label text, est_one_way_miles integer,
  pay_amount_cents bigint, pay_unit text, trucks_requested integer,
  work_starts_on date, work_ends_on date, last_confirmed_at timestamptz,
  is_sponsored boolean
)
language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  with search_origin as (
    select marketplace.approximate_point(p_point) as snapped_point
  ),
  matching as (
    select j.id as job_id, j.org_id, o.display_name as org_name,
           (o.verification_status = 'verified') as org_verified,
           l.id as landing_id, l.name as landing_name, l.public_area_label, l.state_code, l.public_point,
           case when so.snapped_point is not null
                then round((extensions.st_distance(l.public_point, so.snapped_point) / 1609.344)::numeric, 0)
           end as distance_miles,
           j.title, j.product, j.destination_label, j.est_one_way_miles,
           j.pay_amount_cents, j.pay_unit, j.trucks_requested,
           j.work_starts_on, j.work_ends_on, j.last_confirmed_at,
           exists (
             select 1 from marketplace.job_boosts b
             where b.job_id = j.id and b.status = 'active'
               and now() >= b.starts_at and now() < b.ends_at
               and (so.snapped_point is null
                    or extensions.st_dwithin(
                         b.center_point, so.snapped_point,
                         b.radius_miles::double precision * 1609.344 + 8000.0))
           ) as raw_sponsored
    from search_origin so
    cross join marketplace.job_postings j
    join marketplace.landings l on l.id = j.landing_id and l.status = 'active'
    join marketplace.organizations o on o.id = j.org_id and o.status = 'active'
    where j.status = 'active'
      and (j.expires_at is null or j.expires_at > now())
      and (so.snapped_point is null
           or extensions.st_dwithin(
                l.public_point, so.snapped_point,
                least(greatest(coalesce(p_radius_miles, 100), 5), 500)::double precision * 1609.344 + 8000.0))
      and (p_pay_unit is null or j.pay_unit = p_pay_unit)
      and (p_query is null or btrim(p_query) = ''
           or j.search_document @@ websearch_to_tsquery('english'::regconfig, p_query))
      and (p_equipment_codes is null or cardinality(p_equipment_codes) = 0
           or exists (select 1 from marketplace.job_posting_equipment e
                      where e.job_id = j.id and e.equipment_code = any (p_equipment_codes)))
  ),
  ranked as (
    select m.*,
           case when m.raw_sponsored then
             row_number() over (
               partition by m.raw_sponsored
               order by m.distance_miles asc nulls last, m.last_confirmed_at desc)
           end as sponsored_rank
    from matching m
  )
  select r.job_id, r.org_id, r.org_name, r.org_verified,
         r.landing_id, r.landing_name, r.public_area_label, r.state_code,
         r.public_point, r.distance_miles,
         r.title, r.product, r.destination_label, r.est_one_way_miles,
         r.pay_amount_cents, r.pay_unit, r.trucks_requested,
         r.work_starts_on, r.work_ends_on, r.last_confirmed_at,
         (r.raw_sponsored and r.sponsored_rank <= greatest(coalesce(p_max_sponsored, 2), 0)) as is_sponsored
  from ranked r
  order by (r.raw_sponsored and r.sponsored_rank <= greatest(coalesce(p_max_sponsored, 2), 0)) desc,
           r.distance_miles asc nulls last,
           r.last_confirmed_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

-- -----------------------------------------------------------------------------
-- Identity sync for the server auth bridge (`service_role` only)
-- -----------------------------------------------------------------------------

create function marketplace.sync_verified_identity(
  p_issuer text, p_subject text, p_display_name text,
  p_email text default null, p_email_verified boolean default false
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare v_user uuid;
begin
  if not exists (select 1 from marketplace.trusted_identity_issuers where issuer = p_issuer and enabled) then
    raise exception 'untrusted identity issuer: %', p_issuer using errcode = '42501';
  end if;
  select user_id into v_user from marketplace.identity_links where issuer = p_issuer and subject = p_subject;
  if v_user is null then
    insert into marketplace.app_users (display_name) values (coalesce(nullif(btrim(p_display_name), ''), 'LogLoads User'))
    returning id into v_user;
    insert into marketplace.identity_links (issuer, subject, user_id) values (p_issuer, p_subject, v_user);
  else
    update marketplace.app_users set display_name = coalesce(nullif(btrim(p_display_name), ''), display_name)
    where id = v_user;
  end if;
  if p_email is not null then
    insert into marketplace.user_contacts (user_id, email, email_verified_at)
    values (v_user, lower(btrim(p_email)), case when p_email_verified then now() end)
    on conflict (user_id) do update
      set email = excluded.email,
          email_verified_at = coalesce(excluded.email_verified_at, marketplace.user_contacts.email_verified_at);
  end if;
  return v_user;
end
$$;

-- -----------------------------------------------------------------------------
-- Function grants (explicitly revoke PUBLIC on all 03 functions first)
-- -----------------------------------------------------------------------------

revoke all on function
  marketplace.create_organization(text, text, char, boolean),
  marketplace.respond_to_interest(uuid, text, boolean),
  marketplace.withdraw_interest(uuid),
  marketplace.respond_to_invitation(uuid, text),
  marketplace.eligible_invitation_recipients(uuid, integer, interval),
  marketplace.count_eligible_invitation_recipients(uuid, integer, interval),
  marketplace.reserve_targeted_invitation(uuid, uuid, text, interval),
  marketplace.resolve_invitation_delivery(uuid, text, text, text),
  marketplace.expire_stale_invitation_reservations(interval),
  marketplace.open_subscription_cycle(uuid, text, text, timestamptz, timestamptz, text, text, boolean, integer, boolean),
  marketplace.get_org_entitlement_state(uuid),
  marketplace.estimate_boost_audience(uuid, text),
  marketplace.activate_job_boost(uuid, text, uuid, text, timestamptz),
  marketplace.admin_grant_founding_promotion(text, uuid, text),
  marketplace.admin_grant_founding_hauler_badge(uuid, text),
  marketplace.admin_set_org_verification(uuid, text, text),
  marketplace.admin_moderate_job_posting(uuid, text, text),
  marketplace.admin_read_landing_private(uuid, text),
  marketplace.search_job_postings(extensions.geography, integer, text[], text, text, integer, integer),
  marketplace.sync_verified_identity(text, text, text, text, boolean)
  from public, anon, authenticated, service_role;

grant execute on function
  marketplace.search_job_postings(extensions.geography, integer, text[], text, text, integer, integer)
  to anon, authenticated;

grant execute on function
  marketplace.create_organization(text, text, char, boolean),
  marketplace.respond_to_interest(uuid, text, boolean),
  marketplace.withdraw_interest(uuid),
  marketplace.respond_to_invitation(uuid, text),
  marketplace.count_eligible_invitation_recipients(uuid, integer, interval),
  marketplace.reserve_targeted_invitation(uuid, uuid, text, interval),
  marketplace.get_org_entitlement_state(uuid),
  marketplace.estimate_boost_audience(uuid, text),
  marketplace.admin_grant_founding_promotion(text, uuid, text),
  marketplace.admin_grant_founding_hauler_badge(uuid, text),
  marketplace.admin_set_org_verification(uuid, text, text),
  marketplace.admin_moderate_job_posting(uuid, text, text),
  marketplace.admin_read_landing_private(uuid, text)
  to authenticated;

-- Narrow server-worker surface: identity sync, billing webhook handler,
-- boost payment confirmation, invitation delivery callback, and stuck-reservation reaper.
grant execute on function
  marketplace.sync_verified_identity(text, text, text, text, boolean),
  marketplace.open_subscription_cycle(uuid, text, text, timestamptz, timestamptz, text, text, boolean, integer, boolean),
  marketplace.activate_job_boost(uuid, text, uuid, text, timestamptz),
  marketplace.resolve_invitation_delivery(uuid, text, text, text),
  marketplace.expire_stale_invitation_reservations(interval)
  to service_role;
