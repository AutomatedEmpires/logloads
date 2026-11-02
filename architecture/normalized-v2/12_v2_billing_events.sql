-- =============================================================================
-- LogLoads normalized-v2 — 12 billing webhook ordering (R4) and founding-discount cycles (F5)
--
-- APPROVAL STATUS (see PHASE3_REVIEW.md §2). R4 was directed for implementation; its specific ordering rules
-- (cancellation terminal, forward-only periods, ties deferred to reconciliation) are engineering choices, not
-- ratified founder policy. F5 follows Blueprint v1.0 §8.1 ("first six paid billing cycles") and is not
-- separately ratified.
--
-- NON-ACTIVE PROTOTYPE. Not an approved migration. Applied after 11_v2_phase3_policy.sql.
-- Run order: 01 -> 02 -> 03 -> 06 -> 11 -> 12. Changes no historical financial record: it only adds
-- columns, a ledger table and functions, and redefines how future subscription events are applied.
--
-- R4  Provider webhooks can arrive late, twice, or out of order. Every delivery goes through
--     marketplace.apply_billing_provider_event, which:
--       * records each provider event once (unique provider + event id) with its delivery count and a
--         payload digest — duplicates are no-ops; a redelivery with a different payload is flagged;
--       * decides ordering from provider semantics, not timestamps alone:
--           - cancellation is terminal: a canceled provider subscription never becomes live again, so a
--             cancel always applies and any later-arriving older event for it is ignored;
--           - billing periods only move forward: an event for an earlier period than the applied one is
--             stale and ignored (renewal N+1 is never rewound by a delayed event for period N);
--           - within one billing period, the provider's event creation time orders events; an exact tie
--             between different states is not guessed — it is deferred and the subscription is flagged
--             for a reconciliation snapshot fetched from the provider;
--           - an event for a different provider subscription than the organization's live one is never
--             applied over it;
--       * records the outcome (applied / ignored / deferred / rejected / failed) and audits it. A failed
--         event is retried on its next delivery; every other outcome is final for that event id.
--     open_subscription_cycle (the 03 worker RPC) keeps its signature and additionally refuses to move a
--     live subscription to an earlier billing period.
-- F5  A founding-discount cycle is consumed only when a genuinely new paid billing cycle opens
--     (billing reason subscription_create / subscription_cycle, or — for direct calls — a period that does
--     not start inside the open period). A mid-cycle plan change preserves the remaining entitlement.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Migration-order guard (D-1/D-2): requires 11, refuses a repeat. Runs before any change.
--    Apply exactly once, in one transaction: psql -v ON_ERROR_STOP=1 --single-transaction -f 12_v2_billing_events.sql
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_advisory_xact_lock(hashtextextended('marketplace.schema_migrations', 0));
  -- Two statements: PL/pgSQL plans each condition whole, so the ledger is referenced only once it exists.
  if to_regclass('marketplace.schema_migrations') is null then
    raise exception 'migration 12 requires migration 11 to be applied first' using errcode = '55000';
  end if;
  if not exists (select 1 from marketplace.schema_migrations where version = '11') then
    raise exception 'migration 12 requires migration 11 to be applied first' using errcode = '55000';
  end if;
  if exists (select 1 from marketplace.schema_migrations where version = '12') then
    raise exception 'migration 12 is already applied (%); re-running it is refused and nothing was changed',
      (select applied_at from marketplace.schema_migrations where version = '12')
      using errcode = '55000', hint = 'Migrations are forward-only.';
  end if;
  if to_regclass('marketplace.billing_provider_events') is not null then
    raise exception 'migration 12 appears to be applied already (marketplace.billing_provider_events exists) but is not recorded; refusing to re-run'
      using errcode = '55000';
  end if;
  -- M1: remember this transaction; the next statement refuses if it is not the same one.
  perform set_config('logloads.migration_xact', txid_current()::text, true);
end
$$;

-- M1: a migration file must run as ONE transaction (psql --single-transaction). In autocommit mode the
-- guard above committed on its own, so its transaction-local marker is gone and this stops the file
-- before anything changes; inside one transaction (or a batch of files in one) the marker matches.
do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    -- Without ON_ERROR_STOP psql would carry on statement by statement after a refusal, so the rest of
    -- this session is made read-only first (every later write fails), then the next statement refuses.
    perform set_config('default_transaction_read_only', 'on', false);
    perform set_config('logloads.migration_refused', '12', false);
  end if;
end
$$;
do $$
begin
  if coalesce(current_setting('logloads.migration_refused', true), '') <> '' then
    raise exception 'migration % must be applied in one transaction (psql --single-transaction); nothing was changed and this session is now read-only',
      current_setting('logloads.migration_refused')
      using errcode = '25P01';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Provider event ledger (ungranted; written only by apply_billing_provider_event).
-- -----------------------------------------------------------------------------
create table if not exists marketplace.billing_provider_events (
  id                         uuid primary key default gen_random_uuid(),
  provider                   text not null check (provider in ('stripe')),
  provider_event_id          text not null check (char_length(provider_event_id) between 3 and 255),
  event_type                 text not null check (char_length(event_type) between 3 and 120),
  provider_created_at        timestamptz not null,
  provider_subscription_ref  text not null check (char_length(provider_subscription_ref) between 3 and 255),
  provider_customer_ref      text check (char_length(provider_customer_ref) <= 255),
  org_id                     uuid not null references marketplace.organizations (id),
  plan_code                  text not null,
  subscription_status        text not null
                             check (subscription_status in ('incomplete', 'trialing', 'active', 'past_due', 'canceled')),
  period_start               timestamptz not null,
  period_end                 timestamptz not null,
  cancel_at_period_end       boolean not null default false,
  billing_reason             text,
  is_reconciliation          boolean not null default false,
  payload_sha256             text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  payload_conflict           boolean not null default false,
  delivery_count             integer not null default 1 check (delivery_count >= 1),
  received_at                timestamptz not null default clock_timestamp(),
  last_delivery_at           timestamptz not null default clock_timestamp(),
  processed_at               timestamptz not null default clock_timestamp(),
  outcome                    text not null check (outcome in (
                               'applied', 'ignored_stale', 'ignored_terminal', 'ignored_superseded',
                               'ignored_no_change', 'deferred_tie', 'deferred_conflict', 'rejected', 'failed')),
  outcome_reason             text not null check (char_length(outcome_reason) <= 500),
  subscription_id            uuid references marketplace.organization_subscriptions (id),
  unique (provider, provider_event_id),
  check (period_end > period_start)
);
create index if not exists billing_provider_events_sub_idx
  on marketplace.billing_provider_events (provider, provider_subscription_ref, provider_created_at);
create index if not exists billing_provider_events_org_idx
  on marketplace.billing_provider_events (org_id, received_at desc);
alter table marketplace.billing_provider_events enable row level security;

-- Ordering state per provider subscription.
alter table marketplace.organization_subscriptions
  add column if not exists last_provider_event_id text,
  add column if not exists last_provider_event_at timestamptz,
  add column if not exists provider_sync_required boolean not null default false;

-- -----------------------------------------------------------------------------
-- Subscription-cycle core (03's open_subscription_cycle, plus the rewind guard and F5). Internal.
-- -----------------------------------------------------------------------------
create or replace function marketplace.apply_subscription_cycle(
  p_org_id uuid, p_plan_code text, p_status text,
  p_period_start timestamptz, p_period_end timestamptz,
  p_provider_customer_ref text default null, p_provider_subscription_ref text default null,
  p_cancel_at_period_end boolean default false,
  p_grace_days integer default null,
  p_allow_over_limit boolean default false,
  p_billing_reason text default null
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
  v_is_split        boolean := false;
  v_counts_cycle    boolean := false;
  v_alloc_start     timestamptz := p_period_start;
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

  if v_sub.id is not null and p_period_start < v_sub.current_period_start then
    if p_status = 'canceled' then
      p_period_start := v_sub.current_period_start;
      p_period_end   := v_sub.current_period_end;
    else
      raise exception 'refusing to move subscription % back to an earlier billing period (% < %)',
        v_sub.id, p_period_start, v_sub.current_period_start
        using errcode = '23514',
              hint = 'Deliver provider events through marketplace.apply_billing_provider_event, which records and ignores stale events.';
    end if;
  end if;

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
    -- E-1: a replacement provider subscription can start before a period of the organization's previous
    -- (now canceled) subscription. That period cannot be truncated to this start (it would end before it
    -- begins) and invitation records reference it, so this subscription's allowance period begins where
    -- the previous one ends. Only the org's other subscriptions are considered: one is live at a time.
    select greatest(p_period_start, coalesce(max(ep.period_end), p_period_start))
    into v_alloc_start
    from marketplace.entitlement_periods ep
    where ep.org_id = p_org_id
      and ep.subscription_id <> v_sub_id
      and ep.period_start >= p_period_start
      and ep.period_start < p_period_end;
  end if;

  if marketplace.subscription_is_entitling(p_status, p_period_end, v_grace_ends_at) and v_alloc_start >= p_period_end then
    -- No room before this billing period ends: no invitation allowance this cycle (fail closed), recorded.
    perform marketplace.write_audit(
      'subscription.period_overlap_skipped', 'organization_subscriptions', v_sub_id, p_org_id,
      'an earlier subscription''s period covers this billing period; no invitation allowance until the next cycle',
      jsonb_build_object('period_start', p_period_start, 'period_end', p_period_end, 'blocked_until', v_alloc_start));
  elsif marketplace.subscription_is_entitling(p_status, p_period_end, v_grace_ends_at) then
    v_is_split := exists (
      select 1 from marketplace.entitlement_periods ep
      where ep.subscription_id = v_sub_id
        and ep.period_start < v_alloc_start
        and ep.period_end > v_alloc_start
    );

    -- Truncate any earlier overlapping period for this org so mid-cycle plan upgrades
    -- or timestamp adjustments across separate transactions never violate the GiST exclusion constraint.
    update marketplace.entitlement_periods
    set period_end = v_alloc_start
    where org_id = p_org_id
      and period_start < v_alloc_start
      and period_end > v_alloc_start;

    v_is_new_period := not exists (
      select 1 from marketplace.entitlement_periods
      where subscription_id = v_sub_id and period_start = v_alloc_start
    );

    insert into marketplace.entitlement_periods
      (org_id, subscription_id, plan_id, period_start, period_end, invitation_allowance, invitations_committed)
    values
      (p_org_id, v_sub_id, v_plan.id, v_alloc_start, p_period_end, v_plan.monthly_invitations, 0)
    on conflict (subscription_id, period_start) do update
      set plan_id = excluded.plan_id,
          period_end = excluded.period_end,
          invitation_allowance = greatest(excluded.invitation_allowance, marketplace.entitlement_periods.invitations_committed)
    returning id into v_period_id;

    -- F5: a founding-discount cycle is consumed only by a genuinely new paid billing cycle — never by a
    -- plan change (a split of the open period, or a provider event whose billing reason is a plan update).
    v_counts_cycle := v_is_new_period and v_promo_id is not null and p_status = 'active'
                      and not v_is_split
                      and (p_billing_reason is null or p_billing_reason in ('subscription_create', 'subscription_cycle'));
    if v_counts_cycle then
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
      'landing_conflict', (v_plan.max_active_landings is not null and v_active_landings > v_plan.max_active_landings),
      'mid_cycle_change', v_is_split,
      'billing_reason', p_billing_reason,
      'counted_discount_cycle', v_counts_cycle
    ));
  return v_sub_id;
end
$$;

-- The 03 worker RPC keeps its signature and grants; it now runs the guarded core.
create or replace function marketplace.open_subscription_cycle(
  p_org_id uuid, p_plan_code text, p_status text,
  p_period_start timestamptz, p_period_end timestamptz,
  p_provider_customer_ref text default null, p_provider_subscription_ref text default null,
  p_cancel_at_period_end boolean default false,
  p_grace_days integer default null,
  p_allow_over_limit boolean default false
) returns uuid
language sql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select marketplace.apply_subscription_cycle(
    p_org_id, p_plan_code, p_status, p_period_start, p_period_end,
    p_provider_customer_ref, p_provider_subscription_ref, p_cancel_at_period_end,
    p_grace_days, p_allow_over_limit, null)
$$;

-- -----------------------------------------------------------------------------
-- H1 (second and third review). When a provider subscription goes live for an organization:
--   * its own deferred snapshots that are not newer than the applied event are stale (newer ones stay
--     deferred, and the subscription is flagged for a reconciliation snapshot);
--   * other subscriptions' deferred events are superseded ONLY on authoritative evidence (a reconciliation
--     snapshot fetched from the provider). A routine first event never discards them: the customer may be
--     keeping that other subscription. It flags the live one for reconciliation instead, and an entitling
--     pending replacement stays replayable if the live one ends.
-- Internal; no API role may execute it.
-- -----------------------------------------------------------------------------
create or replace function marketplace.supersede_deferred_billing_events(
  p_org_id uuid, p_live_ref text, p_applied_at timestamptz, p_authoritative boolean
) returns integer
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_stale   integer;
  v_other   integer := 0;
  v_pending boolean;
begin
  update marketplace.billing_provider_events e
  set outcome = 'ignored_stale',
      outcome_reason = 'an event of this provider subscription at least as recent was applied',
      processed_at = clock_timestamp()
  where e.org_id = p_org_id and e.outcome = 'deferred_conflict' and e.provider_subscription_ref = p_live_ref
    and e.provider_created_at <= p_applied_at;
  get diagnostics v_stale = row_count;

  if coalesce(p_authoritative, false) then
    update marketplace.billing_provider_events e
    set outcome = 'ignored_superseded',
        outcome_reason = left('superseded by a reconciliation snapshot of provider subscription ' || p_live_ref, 500),
        processed_at = clock_timestamp()
    where e.org_id = p_org_id and e.outcome = 'deferred_conflict' and e.provider_subscription_ref <> p_live_ref;
    get diagnostics v_other = row_count;
  end if;

  v_pending := exists (select 1 from marketplace.billing_provider_events e
                       where e.org_id = p_org_id and e.outcome = 'deferred_conflict');
  if v_pending then
    update marketplace.organization_subscriptions s
    set provider_sync_required = true
    where s.provider_subscription_ref = p_live_ref and s.org_id = p_org_id;
  end if;

  if v_stale > 0 or v_other > 0 or v_pending then
    perform marketplace.write_audit(
      'billing.deferred_resolved', 'organizations', p_org_id, p_org_id,
      'deferred provider events re-marked when a provider subscription went live',
      jsonb_build_object('live_subscription', p_live_ref, 'stale', v_stale, 'superseded', v_other,
                         'authoritative', coalesce(p_authoritative, false), 'still_pending', v_pending));
  end if;
  return v_stale + v_other;
end
$$;

-- -----------------------------------------------------------------------------
-- E-1. Deferred replacement replay (internal; no API role may execute it).
-- A replacement provider subscription whose first event arrives while the previous one is still live is
-- recorded as deferred_conflict. Once the organization has no live subscription (the previous one was
-- canceled), the latest deferred snapshot of that replacement is applied from the ledger, exactly once:
-- the ledger row becomes 'applied' and older deferred snapshots of the same subscription 'ignored_stale'.
-- Several different pending replacements are never guessed between; they wait for reconciliation.
-- The caller holds the organization row lock, which every billing write takes, so no other event for
-- this organization can interleave.
-- -----------------------------------------------------------------------------
create or replace function marketplace.replay_deferred_billing_event(p_org_id uuid)
returns text
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_refs   integer;
  v_evt    marketplace.billing_provider_events;
  v_sub_id uuid;
  v_reason text := 'replayed after the organization''s previous provider subscription ended';
  v_billing_reason text;
  v_marked integer;
begin
  if exists (select 1 from marketplace.organization_subscriptions s where s.org_id = p_org_id and s.status <> 'canceled') then
    return null;
  end if;

  -- Terminal evidence wins: a deferred replacement the provider canceled (its cancel was recorded as
  -- ignored_superseded while the previous subscription was live) is never brought back.
  update marketplace.billing_provider_events e
  set outcome = 'ignored_terminal',
      outcome_reason = 'the provider canceled this subscription while its events were deferred',
      processed_at = clock_timestamp()
  where e.org_id = p_org_id and e.outcome = 'deferred_conflict'
    and exists (select 1 from marketplace.billing_provider_events c
                where c.provider = e.provider and c.provider_subscription_ref = e.provider_subscription_ref
                  and c.subscription_status = 'canceled');
  get diagnostics v_marked = row_count;
  if v_marked > 0 then
    perform marketplace.write_audit('billing.deferred_terminal', 'organizations', p_org_id, p_org_id,
      'deferred events of a provider subscription the provider canceled were closed', jsonb_build_object('events', v_marked));
  end if;

  -- A deferred snapshot whose billing period has already ended describes nothing current.
  update marketplace.billing_provider_events e
  set outcome = 'ignored_stale',
      outcome_reason = 'the deferred snapshot''s billing period ended before it could be applied',
      processed_at = clock_timestamp()
  where e.org_id = p_org_id and e.outcome = 'deferred_conflict'
    and (select l.period_end from marketplace.billing_provider_events l
         where l.org_id = p_org_id and l.outcome = 'deferred_conflict'
           and l.provider_subscription_ref = e.provider_subscription_ref
         order by l.provider_created_at desc, l.received_at desc, l.id desc limit 1) <= now();
  get diagnostics v_marked = row_count;
  if v_marked > 0 then
    perform marketplace.write_audit('billing.deferred_expired', 'organizations', p_org_id, p_org_id,
      'deferred snapshots whose billing period had ended were closed', jsonb_build_object('events', v_marked));
  end if;

  -- Eligible: a provider subscription with no row yet whose LATEST deferred snapshot is entitling. An
  -- 'incomplete' snapshot may be abandoned (incomplete_expired), so it waits for its own next event.
  select count(*) into v_refs
  from (
    select distinct on (e.provider_subscription_ref) e.subscription_status
    from marketplace.billing_provider_events e
    where e.org_id = p_org_id and e.outcome = 'deferred_conflict'
      and not exists (select 1 from marketplace.organization_subscriptions s
                      where s.provider_subscription_ref = e.provider_subscription_ref)
    order by e.provider_subscription_ref, e.provider_created_at desc, e.received_at desc, e.id desc
  ) latest
  where latest.subscription_status in ('trialing', 'active', 'past_due');
  if v_refs = 0 then
    return null;
  elsif v_refs > 1 then
    perform marketplace.write_audit(
      'billing.deferred_replay_ambiguous', 'organizations', p_org_id, p_org_id,
      'several different deferred provider subscriptions are pending; submit a reconciliation snapshot',
      jsonb_build_object('pending_subscriptions', v_refs));
    return 'deferred replay skipped: ' || v_refs || ' different provider subscriptions are pending reconciliation';
  end if;

  select l.* into v_evt
  from (
    select distinct on (e.provider_subscription_ref) e.*
    from marketplace.billing_provider_events e
    where e.org_id = p_org_id and e.outcome = 'deferred_conflict'
      and not exists (select 1 from marketplace.organization_subscriptions s
                      where s.provider_subscription_ref = e.provider_subscription_ref)
    order by e.provider_subscription_ref, e.provider_created_at desc, e.received_at desc, e.id desc
  ) l
  where l.subscription_status in ('trialing', 'active', 'past_due');
  perform 1 from marketplace.billing_provider_events e where e.id = v_evt.id for update;

  -- The replay is this subscription's first application: the period it opens is new to LogLoads, so it is
  -- opened as a creation (F5) unless the snapshot itself is a renewal (which also counts as a new cycle).
  v_billing_reason := case when v_evt.billing_reason = 'subscription_cycle' then 'subscription_cycle' else 'subscription_create' end;

  begin
    v_sub_id := marketplace.apply_subscription_cycle(
      p_org_id, v_evt.plan_code, v_evt.subscription_status, v_evt.period_start, v_evt.period_end,
      v_evt.provider_customer_ref, v_evt.provider_subscription_ref, v_evt.cancel_at_period_end,
      null,
      true, -- external provider event: preserve members and landings (03 policy)
      v_billing_reason);
    update marketplace.organization_subscriptions s
    set last_provider_event_id = v_evt.provider_event_id,
        last_provider_event_at = v_evt.provider_created_at,
        provider_sync_required = false
    where s.id = v_sub_id;
  exception when others then
    if sqlstate like '40%' or sqlstate in ('55P03', '57014') then
      raise;
    end if;
    perform marketplace.write_audit(
      'billing.deferred_replay_failed', 'billing_provider_events', v_evt.id, p_org_id,
      left('replay failed (' || sqlstate || '): ' || sqlerrm, 500),
      jsonb_build_object('provider_event_id', v_evt.provider_event_id));
    return left('deferred replay of ' || v_evt.provider_event_id || ' failed (' || sqlstate || ')', 200);
  end;

  update marketplace.billing_provider_events e
  set outcome = 'applied', outcome_reason = v_reason, subscription_id = v_sub_id, processed_at = clock_timestamp()
  where e.id = v_evt.id;
  update marketplace.billing_provider_events e
  set outcome = 'ignored_stale',
      outcome_reason = 'superseded by the replay of a later deferred event for the same provider subscription',
      processed_at = clock_timestamp()
  where e.org_id = p_org_id
    and e.provider_subscription_ref = v_evt.provider_subscription_ref
    and e.outcome = 'deferred_conflict'
    and e.id <> v_evt.id;
  perform marketplace.supersede_deferred_billing_events(p_org_id, v_evt.provider_subscription_ref, v_evt.provider_created_at, false);

  perform marketplace.write_audit(
    'billing.deferred_replayed', 'billing_provider_events', v_evt.id, p_org_id, v_reason,
    jsonb_build_object(
      'provider_event_id', v_evt.provider_event_id,
      'provider_subscription_ref', v_evt.provider_subscription_ref,
      'status', v_evt.subscription_status,
      'plan', v_evt.plan_code,
      'period_start', v_evt.period_start));
  return left('replayed deferred event ' || v_evt.provider_event_id, 200);
end
$$;

-- -----------------------------------------------------------------------------
-- R4. The webhook entry point (service_role only). The handler passes the provider event id, type and
-- creation time, and the SUBSCRIPTION SNAPSHOT carried by (or fetched for) the event.
-- -----------------------------------------------------------------------------
create or replace function marketplace.apply_billing_provider_event(
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_provider_created_at timestamptz,
  p_org_id uuid,
  p_provider_subscription_ref text,
  p_provider_customer_ref text,
  p_plan_code text,
  p_status text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_cancel_at_period_end boolean default false,
  p_billing_reason text default null,
  p_payload_sha256 text default null,
  p_is_reconciliation boolean default false
) returns table (result text, result_reason text, applied_subscription_id uuid, ledger_event_id uuid)
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_evt     marketplace.billing_provider_events;
  v_sub     marketplace.organization_subscriptions;
  v_live    marketplace.organization_subscriptions;
  v_plan_id uuid;
  v_result  text;
  v_reason  text;
  v_sub_id  uuid;
  v_evt_id  uuid;
  v_apply   boolean := false;
  v_replay  text;
begin
  -- Input contract: malformed input is a handler bug and is refused outright (nothing recorded).
  if p_provider is distinct from 'stripe' then
    raise exception 'unsupported billing provider: %', p_provider using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_provider_event_id, ''))) < 3
     or char_length(btrim(coalesce(p_provider_subscription_ref, ''))) < 3
     or char_length(btrim(coalesce(p_event_type, ''))) < 3 then
    raise exception 'provider event id, event type and subscription reference are required' using errcode = '22023';
  end if;
  if p_provider_created_at is null or p_org_id is null or p_plan_code is null
     or p_period_start is null or p_period_end is null or p_period_end <= p_period_start then
    raise exception 'event creation time, organization, plan and a valid billing period are required' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('incomplete', 'trialing', 'active', 'past_due', 'canceled') then
    raise exception 'unknown subscription status: %', p_status using errcode = '22023';
  end if;
  if p_payload_sha256 is null or p_payload_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'a lowercase hex SHA-256 digest of the raw event payload is required' using errcode = '22023';
  end if;
  if p_billing_reason is not null
     and p_billing_reason not in ('subscription_create', 'subscription_cycle', 'subscription_update', 'subscription_threshold', 'manual') then
    raise exception 'unknown billing reason: %', p_billing_reason using errcode = '22023';
  end if;

  -- Serialize every event of one provider subscription, then every subscription change of the organization.
  perform pg_advisory_xact_lock(hashtextextended('marketplace.billing:' || p_provider || ':' || p_provider_subscription_ref, 0));
  perform 1 from marketplace.organizations o where o.id = p_org_id for update;
  if not found then
    raise exception 'unknown organization' using errcode = '22023';
  end if;

  -- Idempotency: one record per provider event id.
  select * into v_evt from marketplace.billing_provider_events e
  where e.provider = p_provider and e.provider_event_id = p_provider_event_id
  for update;
  if found then
    update marketplace.billing_provider_events e
    set delivery_count = e.delivery_count + 1,
        last_delivery_at = clock_timestamp(),
        payload_conflict = e.payload_conflict or e.payload_sha256 <> p_payload_sha256
    where e.id = v_evt.id;
    if v_evt.outcome <> 'failed' then
      return query select
        'duplicate'::text,
        case when v_evt.payload_sha256 <> p_payload_sha256
             then 'event id already processed (' || v_evt.outcome || '); this delivery carried a different payload and was not applied'
             else 'event id already processed (' || v_evt.outcome || ')' end,
        v_evt.subscription_id, v_evt.id;
      return;
    end if;
    v_evt_id := v_evt.id; -- a failed event is retried on redelivery
  end if;

  -- Ordering decision.
  select * into v_sub from marketplace.organization_subscriptions s
  where s.provider_subscription_ref = p_provider_subscription_ref
  for update;

  if found and v_sub.org_id <> p_org_id then
    v_result := 'rejected';
    v_reason := 'provider subscription belongs to a different organization';
  elsif found and v_sub.status = 'canceled' then
    v_result := 'ignored_terminal';
    v_reason := 'subscription is already canceled; canceled subscriptions are terminal';
  elsif found then
    select p.id into v_plan_id from marketplace.subscription_plans p where p.code = p_plan_code and p.status = 'active' limit 1;
    if p_status = 'canceled' then
      v_apply := true;  v_reason := 'cancellation is terminal and always applies';
    elsif p_period_start < v_sub.current_period_start then
      v_result := 'ignored_stale';
      v_reason := 'event describes an earlier billing period than the one applied';
    elsif p_period_start > v_sub.current_period_start then
      v_apply := true;  v_reason := 'event opens a later billing period';
    elsif v_sub.last_provider_event_at is null or p_provider_created_at > v_sub.last_provider_event_at then
      v_apply := true;  v_reason := 'newer event within the current billing period';
    elsif p_provider_created_at < v_sub.last_provider_event_at and not coalesce(p_is_reconciliation, false) then
      v_result := 'ignored_stale';
      v_reason := 'older event within the current billing period';
    elsif coalesce(p_is_reconciliation, false) then
      v_apply := true;  v_reason := 'reconciliation snapshot fetched from the provider';
    elsif v_sub.plan_id is not distinct from v_plan_id
          and v_sub.status = p_status
          and v_sub.current_period_end = p_period_end
          and v_sub.cancel_at_period_end = coalesce(p_cancel_at_period_end, false) then
      v_result := 'ignored_no_change';
      v_reason := 'same provider timestamp and identical state';
    else
      v_result := 'deferred_tie';
      v_reason := 'two different states share one provider timestamp; fetch the subscription from the provider and submit a reconciliation snapshot';
      update marketplace.organization_subscriptions s set provider_sync_required = true where s.id = v_sub.id;
    end if;
    v_sub_id := v_sub.id;
  else
    select * into v_live from marketplace.organization_subscriptions s
    where s.org_id = p_org_id and s.status <> 'canceled'
    for update;
    if found and v_live.provider_subscription_ref is not null then
      v_sub_id := v_live.id;
      if p_status = 'canceled' then
        v_result := 'ignored_superseded';
        v_reason := 'cancellation of a provider subscription the organization is not using';
      else
        v_result := 'deferred_conflict';
        v_reason := 'organization already has a different live provider subscription; reconcile before applying';
        update marketplace.organization_subscriptions s set provider_sync_required = true where s.id = v_live.id;
      end if;
    else
      -- First event seen for this provider subscription (a cancel is recorded too, so that delayed
      -- earlier events for it are later recognised as terminal and never re-entitle the organization).
      v_apply := true;  v_reason := 'first event for this provider subscription';
    end if;
  end if;

  if v_apply then
    begin
      v_sub_id := marketplace.apply_subscription_cycle(
        p_org_id, p_plan_code, p_status, p_period_start, p_period_end,
        p_provider_customer_ref, p_provider_subscription_ref, coalesce(p_cancel_at_period_end, false),
        null,
        true, -- external provider event: preserve members and landings, record any conflict (03 policy)
        p_billing_reason);
      update marketplace.organization_subscriptions s
      set last_provider_event_id = p_provider_event_id,
          last_provider_event_at = greatest(coalesce(s.last_provider_event_at, p_provider_created_at), p_provider_created_at),
          provider_sync_required = false
      where s.id = v_sub_id;
      v_result := 'applied';
    exception when others then
      -- Lock, deadlock, serialization and cancellation errors propagate so the transaction is retried.
      if sqlstate like '40%' or sqlstate in ('55P03', '57014') then
        raise;
      end if;
      v_result := 'failed';
      v_reason := left('apply failed (' || sqlstate || '): ' || sqlerrm, 500);
    end;
  end if;

  -- H1: a provider subscription applied for the first time resolves its own older deferred snapshots; it
  -- supersedes other subscriptions' deferred events only when it is a reconciliation snapshot.
  if v_result = 'applied' and v_sub.id is null and p_status <> 'canceled' then
    perform marketplace.supersede_deferred_billing_events(
      p_org_id, p_provider_subscription_ref, p_provider_created_at, coalesce(p_is_reconciliation, false));
  end if;

  -- E-1: when this event leaves the organization without a live subscription, a replacement that was
  -- deferred while the previous one was live is applied now instead of waiting for its next delivery.
  if v_result = 'applied' then
    v_replay := marketplace.replay_deferred_billing_event(p_org_id);
    if v_replay is not null then
      v_reason := left(v_reason || '; ' || v_replay, 500);
    end if;
  end if;

  if v_evt_id is null then
    insert into marketplace.billing_provider_events (
      provider, provider_event_id, event_type, provider_created_at, provider_subscription_ref, provider_customer_ref,
      org_id, plan_code, subscription_status, period_start, period_end, cancel_at_period_end, billing_reason,
      is_reconciliation, payload_sha256, outcome, outcome_reason, subscription_id
    ) values (
      p_provider, p_provider_event_id, btrim(p_event_type), p_provider_created_at, p_provider_subscription_ref, p_provider_customer_ref,
      p_org_id, p_plan_code, p_status, p_period_start, p_period_end, coalesce(p_cancel_at_period_end, false), p_billing_reason,
      coalesce(p_is_reconciliation, false), p_payload_sha256, v_result, v_reason, v_sub_id
    ) returning id into v_evt_id;
  else
    update marketplace.billing_provider_events e
    set event_type = btrim(p_event_type), provider_created_at = p_provider_created_at,
        provider_customer_ref = p_provider_customer_ref, plan_code = p_plan_code, subscription_status = p_status,
        period_start = p_period_start, period_end = p_period_end,
        cancel_at_period_end = coalesce(p_cancel_at_period_end, false), billing_reason = p_billing_reason,
        is_reconciliation = coalesce(p_is_reconciliation, false), payload_sha256 = p_payload_sha256,
        outcome = v_result, outcome_reason = v_reason, subscription_id = v_sub_id, processed_at = clock_timestamp()
    where e.id = v_evt_id;
  end if;

  perform marketplace.write_audit(
    'billing.event_' || v_result, 'billing_provider_events', v_evt_id, p_org_id, v_reason,
    jsonb_build_object(
      'provider_event_id', p_provider_event_id,
      'event_type', btrim(p_event_type),
      'provider_created_at', p_provider_created_at,
      'status', p_status,
      'plan', p_plan_code,
      'period_start', p_period_start,
      'billing_reason', p_billing_reason,
      'reconciliation', coalesce(p_is_reconciliation, false)));

  return query select v_result, v_reason, v_sub_id, v_evt_id;
end
$$;

-- Billing / support admins can review what was received and why it was or was not applied.
create or replace function marketplace.admin_list_billing_provider_events(p_org_id uuid, p_limit integer default 50)
returns table (
  ledger_event_id uuid, provider_event_id text, event_type text, provider_created_at timestamptz,
  received_at timestamptz, delivery_count integer, payload_conflict boolean, subscription_status text,
  plan_code text, period_start timestamptz, outcome text, outcome_reason text
)
language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
#variable_conflict use_column
begin
  if not marketplace.is_platform_admin(array['billing', 'support']) then
    raise exception 'platform billing or support admin required' using errcode = '42501';
  end if;
  return query
  select e.id, e.provider_event_id, e.event_type, e.provider_created_at, e.received_at, e.delivery_count,
         e.payload_conflict, e.subscription_status, e.plan_code, e.period_start, e.outcome, e.outcome_reason
  from marketplace.billing_provider_events e
  where e.org_id = p_org_id
  order by e.received_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 500);
end
$$;

-- -----------------------------------------------------------------------------
-- Privileges.
-- -----------------------------------------------------------------------------
revoke all on function
  marketplace.apply_subscription_cycle(uuid, text, text, timestamptz, timestamptz, text, text, boolean, integer, boolean, text),
  marketplace.replay_deferred_billing_event(uuid),
  marketplace.supersede_deferred_billing_events(uuid, text, timestamptz, boolean),
  marketplace.apply_billing_provider_event(text, text, text, timestamptz, uuid, text, text, text, text, timestamptz, timestamptz, boolean, text, text, boolean),
  marketplace.admin_list_billing_provider_events(uuid, integer)
  from public, anon, authenticated, service_role;

grant execute on function
  marketplace.apply_billing_provider_event(text, text, text, timestamptz, uuid, text, text, text, text, timestamptz, timestamptz, boolean, text, text, boolean)
  to service_role;

grant execute on function
  marketplace.admin_list_billing_provider_events(uuid, integer)
  to authenticated;
-- -----------------------------------------------------------------------------
-- Record this migration (D-1/D-2).
-- -----------------------------------------------------------------------------
insert into marketplace.schema_migrations (version, name) values ('12', '12_v2_billing_events');
