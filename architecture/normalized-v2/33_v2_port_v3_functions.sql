-- =============================================================================
-- LogLoads normalized-v2 — 33 the missing port v3 SQL: invitations, team removal, report resolution, admin target
-- checks, inquiry and job pages (#294, part B; from the #269 review, #250 and #280)
--
-- NON-ACTIVE PROTOTYPE. Not an approved migration. Applied after 31_v2_reply_gate_reconfirmation_unsubscribe.sql.
-- Run order: 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23 -> 26 -> 29 -> 31 -> 33 (19..22, 24, 25, 27, 28, 30,
-- 32 and 34 are test suites and harnesses, not migrations). Apply exactly once, in one transaction:
-- psql -v ON_ERROR_STOP=1 --single-transaction -f 33_...sql
-- 33 changes no stored row, no table, no policy and no trigger. It adds seven functions, redefines three
-- (CREATE OR REPLACE keeps each ACL) and replaces list_marketplace_interests by one with more arguments and the same
-- grant. Stage 33 in CI checks this exact set; 10 proves on existing data that no row changes.
--
-- Invitations (#250, and the #269 review of PR #282)
-- 33-I1  list_invitation_recipients(job, radius): the businesses a landing may invite for one of its jobs. The landing
--        picks every recipient; there is no hidden ranking (the list is in name order) and it returns public profile
--        fields only: never a person, a phone, an email, a point or a landing's private details. Same access as 29's
--        count: owner, manager or staff with a seat, and the job's landing in the caller's scope.
-- 33-I2  respond_to_invitation answered any invitation of the business, delivered or not, overwrote an earlier
--        answer, and wrote no audit row. Now, under the row lock it already took: only a delivered invitation can be
--        answered (one that is not delivered, another business's and a missing one all read 'Invitation not found');
--        an answer is recorded once (the same answer again changes nothing, 'viewed' never replaces an answer, a
--        different answer is refused); and each recorded response is audited.
-- Team (#249)
-- 33-T   remove_team_member(membership): an owner ends a member's access at once. Never the last active owner. It
--        clears the member's landing limits and is audited.
-- Admin (#255)
-- 33-A1  admin_set_org_verification and admin_read_landing_private wrote an audit row for an id that does not exist.
--        Both now refuse it ('... not found', P0002) and write nothing.
-- 33-A2  admin_resolve_report(report, status, reason): a moderator marks a report reviewing, actioned or dismissed.
--        A resolved report keeps its outcome. Audited.
-- Pages (#280)
-- 33-Q1  list_marketplace_interests takes a limit, a keyset cursor (the side's timestamp and the id of the last row),
--        a set of jobs, one inquiry, one queue, and can leave the messages out. Without the new arguments it returns
--        exactly what it returned before, except that job_accepting_interest now follows 31's day-14 rule.
--        count_marketplace_interests returns the per-tab counts. get_marketplace_interest returns one inquiry to
--        either of its two sides.
-- 33-Q2  list_marketplace_jobs_page is Find Work as pages: the filters the adapter applied in memory (equipment
--        setups, product, start date, distance from a typed place), the three sorts with the job id as the last key,
--        a keyset cursor and the total count. list_marketplace_jobs itself is unchanged.
--
-- Not in 33: a SQL function for editing a published job. #247 shipped editJob as a statement that runs as the person
-- under job_postings' row-level security, column grants and triggers; a SECURITY DEFINER copy of that rule would be a
-- second path to keep in step. A request key on reserve_targeted_invitation (optional in #250) is also not in 33.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Migration-order guard: requires 31, refuses a repeat. Runs before any change.
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_advisory_xact_lock(hashtextextended('marketplace.schema_migrations', 0));
  -- Two statements: PL/pgSQL plans each condition whole, so the ledger is referenced only once it exists.
  if to_regclass('marketplace.schema_migrations') is null then
    raise exception 'migration 33 requires migration 31 to be applied first' using errcode = '55000';
  end if;
  if not exists (select 1 from marketplace.schema_migrations where version = '31') then
    raise exception 'migration 33 requires migration 31 to be applied first' using errcode = '55000';
  end if;
  if exists (select 1 from marketplace.schema_migrations where version = '33') then
    raise exception 'migration 33 is already applied (%); re-running it is refused and nothing was changed',
      (select applied_at from marketplace.schema_migrations where version = '33')
      using errcode = '55000', hint = 'Migrations are forward-only.';
  end if;
  if to_regprocedure('marketplace.list_invitation_recipients(uuid, integer)') is not null
     or to_regprocedure('marketplace.remove_team_member(uuid)') is not null then
    raise exception 'migration 33 appears to be applied already (its functions exist) but is not recorded; refusing to re-run'
      using errcode = '55000';
  end if;
  -- M1: remember this transaction; the next statement refuses if it is not the same one.
  perform set_config('logloads.migration_xact', txid_current()::text, true);
end
$$;

-- M1: a migration file must run as ONE transaction (psql --single-transaction); see 06.
do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    -- Without ON_ERROR_STOP psql would carry on statement by statement after a refusal, so the rest of
    -- this session is made read-only first (every later write fails), then the next statement refuses.
    perform set_config('default_transaction_read_only', 'on', false);
    perform set_config('logloads.migration_refused', '33', false);
  end if;
end
$$;
-- The refusal needs no session state (a pooler may run this statement on another backend); see 06.
do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    raise exception 'migration 33 must be applied in one transaction (psql --single-transaction); nothing was changed'
      using errcode = '25P01', hint = 'This session (or pooled backend) was made read-only to stop the rest of the file.';
  end if;
  if coalesce(current_setting('logloads.migration_refused', true), '') <> '' then
    raise exception 'migration 33 refused: this session was made read-only by an earlier non-atomic attempt (migration %); reconnect and apply it with psql --single-transaction',
      current_setting('logloads.migration_refused')
      using errcode = '25P01';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 33-I1. The recipients a landing can choose for one of its jobs (#250; the row shape its adapter expects).
-- eligible_invitation_recipients (03) is the rule: active, public, opted in, reachable, under its weekly cap, outside
-- the plan's dedupe window, and near the landing by availability or by equipment and service radius.
-- -----------------------------------------------------------------------------
create function marketplace.list_invitation_recipients(p_job_id uuid, p_radius_miles integer default 100)
returns table (org_id uuid, business_name text, home_base text, equipment jsonb,
               availability_reported_at timestamptz, verified boolean, verified_at timestamptz)
language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare v_org uuid;
begin
  select j.org_id into v_org from marketplace.job_postings j where j.id = p_job_id;
  if v_org is null or not marketplace.has_org_role(v_org, array['owner', 'manager', 'staff'], true)
     or not marketplace.job_scope_allows(p_job_id) then
    raise exception 'not authorized for this job' using errcode = '42501';
  end if;
  return query
  select o.id, o.display_name, h.base_area_label,
         coalesce((select jsonb_agg(jsonb_build_object('label', t.label, 'units', u.units) order by t.sort_order, t.label)
                   from (select eu.equipment_code, sum(eu.unit_count)::integer as units
                         from marketplace.equipment_units eu
                         where eu.org_id = o.id and eu.is_active and eu.operational_status in ('available', 'committed')
                         group by eu.equipment_code) u
                   join marketplace.equipment_types t on t.code = u.equipment_code), '[]'::jsonb),
         (select max(ar.reported_at) from marketplace.availability_reports ar
          where ar.org_id = o.id and ar.withdrawn_at is null),
         o.verification_status = 'verified',
         o.verified_at
  from marketplace.eligible_invitation_recipients(p_job_id, p_radius_miles, null) as r(recipient_org_id)
  join marketplace.organizations o on o.id = r.recipient_org_id
  join marketplace.hauler_profiles h on h.org_id = r.recipient_org_id
  order by o.display_name, o.id
  limit 200;
end
$$;

-- -----------------------------------------------------------------------------
-- 33-I2. 03's respond_to_invitation: a delivered invitation only, an answer recorded once, each response audited.
-- -----------------------------------------------------------------------------
create or replace function marketplace.respond_to_invitation(p_invitation_id uuid, p_response text)
returns void language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare v_inv marketplace.targeted_invitations;
begin
  if p_response is null or p_response not in ('viewed', 'interested', 'declined') then
    raise exception 'invalid invitation response: %', p_response using errcode = '22023';
  end if;
  select * into v_inv from marketplace.targeted_invitations where id = p_invitation_id for update;
  -- 33: an invitation that does not exist, belongs to another business or was not delivered gets one answer.
  if not found or v_inv.status <> 'delivered'
     or not marketplace.has_org_role(v_inv.recipient_org_id, array['owner', 'manager', 'staff', 'driver']) then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;

  -- 33: recorded once, decided while this transaction holds the row. The same response again changes nothing;
  -- 'viewed' never replaces an answer; a different answer is refused.
  if v_inv.recipient_response = p_response then
    return;
  end if;
  if v_inv.recipient_response in ('interested', 'declined') then
    if p_response = 'viewed' then
      return;
    end if;
    raise exception 'This invitation was already answered' using errcode = '23514',
      hint = 'An answer to an invitation is recorded once.';
  end if;

  update marketplace.targeted_invitations
  set recipient_response = p_response, responded_at = now()
  where id = p_invitation_id;

  perform marketplace.write_audit(
    'invitation.' || p_response, 'targeted_invitations', p_invitation_id, v_inv.recipient_org_id,
    null, jsonb_build_object('job_id', v_inv.job_id, 'sender_org_id', v_inv.sender_org_id));
end
$$;

-- -----------------------------------------------------------------------------
-- 33-T. An owner removes a member (#249, UX spec §4.11). Access ends with the membership's status: every access
-- helper reads active memberships only. tg_membership_guard (26) stamps ended_at and keeps the last active owner.
-- -----------------------------------------------------------------------------
create function marketplace.remove_team_member(p_membership_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare v_m marketplace.organization_memberships;
begin
  select * into v_m from marketplace.organization_memberships where id = p_membership_id for update;
  -- Another business's membership reads as one that does not exist (as set_membership_landing_scope, 26).
  if not found or not marketplace.has_org_role(v_m.org_id, array['owner']) then
    raise exception 'Membership not found' using errcode = '42501';
  end if;
  if v_m.status = 'removed' then
    return;
  end if;
  if v_m.role = 'owner' and v_m.status = 'active' and not exists (
       select 1 from marketplace.organization_memberships m
       where m.org_id = v_m.org_id and m.role = 'owner' and m.status = 'active' and m.id <> v_m.id) then
    raise exception 'A business keeps at least one owner' using errcode = '23514',
      hint = 'Make another member an owner before removing this one.';
  end if;

  update marketplace.organization_memberships set status = 'removed' where id = v_m.id;
  delete from marketplace.membership_landing_scopes where membership_id = v_m.id;

  perform marketplace.write_audit(
    'membership.removed', 'organization_memberships', v_m.id, v_m.org_id, null,
    jsonb_build_object('user_id', v_m.user_id, 'role', v_m.role, 'previous_status', v_m.status,
                       'landing_workspace_seat', v_m.landing_workspace_seat));
end
$$;

-- -----------------------------------------------------------------------------
-- 33-A1. 03's two admin functions, refusing a target that does not exist before anything is written.
-- -----------------------------------------------------------------------------
create or replace function marketplace.admin_set_org_verification(
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
  -- 33: an unknown business changes nothing and is not audited.
  if not found then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;
  perform marketplace.write_audit(
    'organization.verification_set', 'organizations', p_org_id, p_org_id,
    p_reason, jsonb_build_object('verification_status', p_status), true);
end
$$;

create or replace function marketplace.admin_read_landing_private(p_landing_id uuid, p_reason text)
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
  -- 33: an unknown landing is refused and not audited.
  if not found then
    raise exception 'Landing not found' using errcode = 'P0002';
  end if;
  perform marketplace.write_audit('landing_private.admin_viewed', 'landing_private_details', p_landing_id, v_org, p_reason, '{}', true);
  return query select * from marketplace.landing_private_details where landing_id = p_landing_id;
end
$$;

-- -----------------------------------------------------------------------------
-- 33-A2. A moderator moves a report through review (#255, UX spec §7.3). abuse_reports has no client UPDATE grant.
-- -----------------------------------------------------------------------------
create function marketplace.admin_resolve_report(p_report_id uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_report marketplace.abuse_reports;
  v_note   text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not marketplace.is_platform_admin(array['moderator']) then
    raise exception 'platform moderator required' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('reviewing', 'actioned', 'dismissed') then
    raise exception 'a report is marked reviewing, actioned or dismissed' using errcode = '22023';
  end if;
  if char_length(v_note) > 1000 or (p_status in ('actioned', 'dismissed') and coalesce(char_length(v_note), 0) < 5) then
    raise exception 'resolving a report needs a note of 5 to 1000 characters' using errcode = '22023';
  end if;

  select * into v_report from marketplace.abuse_reports where id = p_report_id for update;
  if not found then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;
  -- A resolved report keeps its outcome; the same outcome again changes nothing.
  if v_report.status in ('actioned', 'dismissed') then
    if v_report.status = p_status then
      return;
    end if;
    raise exception 'This report is already resolved' using errcode = '23514';
  end if;

  update marketplace.abuse_reports
  set status = p_status,
      reviewed_by = marketplace.current_user_id(),
      reviewed_at = now(),
      resolution_note = coalesce(v_note, resolution_note)
  where id = p_report_id;

  perform marketplace.write_audit(
    'abuse_report.' || p_status, 'abuse_reports', p_report_id, null, left(v_note, 500),
    jsonb_build_object('from_status', v_report.status, 'target_kind', v_report.target_kind, 'target_id', v_report.target_id),
    true);
end
$$;

-- -----------------------------------------------------------------------------
-- 33-Q1. Inquiry pages (#280).
-- -----------------------------------------------------------------------------

-- The tab an inquiry is in, for one side (packages/contracts: landingInterestQueueFor, haulerInterestQueue).
-- Landing: submitted and viewed are New; replied is Replied ('responded'), or New again when the hauler wrote last;
-- declined and withdrawn are Closed. Hauler: active until the landing replies, then replied, then closed.
create function marketplace.interest_queue(p_side text, p_status text, p_interest_id uuid)
returns text language sql stable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_status in ('declined', 'withdrawn') then 'closed'
    when p_side = 'hauler' then case when p_status = 'replied' then 'replied' else 'active' end
    when p_status = 'replied' and coalesce((select m.author_side from marketplace.interest_messages m
                                            where m.interest_id = p_interest_id
                                            order by m.created_at desc, m.id desc limit 1), 'landing') <> 'hauler'
      then 'responded'
    else 'new'
  end
$$;

-- 26's list_marketplace_interests with the page arguments. The argument list changes, so the function is replaced;
-- its grant is restored below.
drop function marketplace.list_marketplace_interests(uuid, text, uuid);

create function marketplace.list_marketplace_interests(
  p_org_id uuid,
  p_side text,
  p_job_id uuid default null,
  p_limit integer default null,          -- 33: at most this many rows (1 to 200); null: all, as before
  p_after_at timestamptz default null,   -- 33: keyset cursor, the last row's updated_at (hauler) or created_at (landing)
  p_after_id uuid default null,          -- 33: ... and its id
  p_job_ids uuid[] default null,         -- 33: only inquiries on these jobs
  p_with_replies boolean default true,   -- 33: false leaves the messages out (replies is then an empty array)
  p_interest_id uuid default null,       -- 33: only this inquiry
  p_queue text default null              -- 33: only this tab (interest_queue)
)
returns table (id uuid, job_id uuid, job_slug text, job_title text, job_status text, job_accepting_interest boolean,
               landing_org_id uuid, landing_org_name text, hauler_org_id uuid, hauler_org_name text, hauler_org_type text,
               submitted_by_user_id uuid, submitted_by_name text, trucks_offered integer, equipment jsonb,
               available_from date, available_until date, message text, contact_preference text, status text,
               replies jsonb, created_at timestamp with time zone, updated_at timestamp with time zone,
               responded_at timestamp with time zone, withdrawn_at timestamp with time zone)
language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_caps text[];
begin
  select a.capabilities into v_caps
  from marketplace.get_viewer_marketplace_access(p_org_id) a;

  if p_side = 'hauler' then
    if not ('interest.reply' = any (coalesce(v_caps, array[]::text[]))) then
      raise exception 'Your role cannot act on inquiries for this business' using errcode = '42501';
    end if;
  elsif p_side = 'landing' then
    if not ('inquiry.respond' = any (coalesce(v_caps, array[]::text[]))) then
      raise exception 'Inquiry not found' using errcode = '42501';
    end if;
  else
    raise exception 'p_side must be hauler or landing' using errcode = '22023';
  end if;

  -- 33: the page arguments.
  if (p_after_at is null) <> (p_after_id is null) then
    raise exception 'a cursor needs both the time and the id of the last row' using errcode = '22023';
  end if;
  if p_queue is not null and p_queue <> all (case when p_side = 'hauler' then array['active', 'replied', 'closed']
                                                   else array['new', 'responded', 'closed'] end) then
    raise exception 'unknown inquiry queue for this side: %', p_queue using errcode = '22023';
  end if;

  return query
  select
    e.id,
    e.job_id,
    e.job_id::text as job_slug,
    coalesce(j.title, 'Job no longer listed') as job_title,
    case
      when j.id is null or j.status = 'draft' then 'closed'
      when j.status = 'active' and j.expires_at is not null and j.expires_at <= now() then 'expired'
      else j.status
    end as job_status,
    (j.id is not null and j.status = 'active' and (j.expires_at is null or j.expires_at > now())
     and marketplace.job_confirmation_current(j.last_confirmed_at)) as job_accepting_interest, -- 33: 31's day-14 rule
    e.job_org_id as landing_org_id,
    coalesce(lo.display_name, 'Landing organization') as landing_org_name,
    e.hauler_org_id,
    coalesce(ho.display_name, 'Hauling business') as hauler_org_name,
    case
      when coalesce((select sum(eu.unit_count) from marketplace.equipment_units eu where eu.org_id = e.hauler_org_id and eu.is_active), 0) > 1
        then 'fleet'
      else 'carrier'
    end as hauler_org_type,
    e.submitted_by as submitted_by_user_id,
    coalesce(su.display_name, 'LogLoads member') as submitted_by_name,
    e.trucks_offered,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'configurationKey', eq.configuration_key,
          'label', eq.label,
          'count', eq.unit_count
        ) order by eq.sort_order, eq.configuration_key
      )
      from marketplace.expression_of_interest_equipment eq
      where eq.interest_id = e.id
    ), '[]'::jsonb) as equipment,
    e.available_from,
    e.available_until,
    e.message,
    e.contact_preference,
    e.status,
    case when coalesce(p_with_replies, true) then coalesce(( -- 33
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'authorUserId', m.author_user_id,
          'authorName', coalesce(au.display_name, 'LogLoads member'),
          'authorSide', m.author_side,
          'body', m.body,
          'createdAt', to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ) order by m.created_at, m.id
      )
      from marketplace.interest_messages m
      left join marketplace.app_users au on au.id = m.author_user_id
      where m.interest_id = e.id
    ), '[]'::jsonb) else '[]'::jsonb end as replies, -- 33
    e.created_at,
    e.updated_at,
    e.responded_at,
    e.withdrawn_at
  from marketplace.expressions_of_interest e
  left join marketplace.job_postings j on j.id = e.job_id
  left join marketplace.organizations lo on lo.id = e.job_org_id
  left join marketplace.organizations ho on ho.id = e.hauler_org_id
  left join marketplace.app_users su on su.id = e.submitted_by
  where ((p_side = 'hauler' and e.hauler_org_id = p_org_id)
         or (p_side = 'landing' and e.job_org_id = p_org_id
             and marketplace.job_scope_allows(e.job_id))) -- 26-B
    and (p_job_id is null or e.job_id = p_job_id)
    and (p_job_ids is null or e.job_id = any (p_job_ids)) -- 33
    and (p_interest_id is null or e.id = p_interest_id) -- 33
    and (p_queue is null or marketplace.interest_queue(p_side, e.status, e.id) = p_queue) -- 33
    -- 33: after the cursor row in the order below (newest first, then id).
    and (p_after_at is null
         or case when p_side = 'hauler' then e.updated_at else e.created_at end < p_after_at
         or (case when p_side = 'hauler' then e.updated_at else e.created_at end = p_after_at and e.id > p_after_id))
  order by
    case when p_side = 'hauler' then e.updated_at else e.created_at end desc,
    e.id
  limit case when p_limit is null then null else least(greatest(p_limit, 1), 200) end; -- 33
end
$$;

-- Per-tab counts for one side, with the same access rule and landing scope as the list. Always three rows.
create function marketplace.count_marketplace_interests(p_org_id uuid, p_side text)
returns table (queue text, total bigint)
language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_caps text[];
begin
  select a.capabilities into v_caps
  from marketplace.get_viewer_marketplace_access(p_org_id) a;

  if p_side = 'hauler' then
    if not ('interest.reply' = any (coalesce(v_caps, array[]::text[]))) then
      raise exception 'Your role cannot act on inquiries for this business' using errcode = '42501';
    end if;
  elsif p_side = 'landing' then
    if not ('inquiry.respond' = any (coalesce(v_caps, array[]::text[]))) then
      raise exception 'Inquiry not found' using errcode = '42501';
    end if;
  else
    raise exception 'p_side must be hauler or landing' using errcode = '22023';
  end if;

  return query
  select q.queue, count(c.queue)
  from unnest(case when p_side = 'hauler' then array['active', 'replied', 'closed']
                   else array['new', 'responded', 'closed'] end) with ordinality as q(queue, position)
  left join (
    select marketplace.interest_queue(p_side, e.status, e.id) as queue
    from marketplace.expressions_of_interest e
    where (p_side = 'hauler' and e.hauler_org_id = p_org_id)
       or (p_side = 'landing' and e.job_org_id = p_org_id and marketplace.job_scope_allows(e.job_id))
  ) c on c.queue = q.queue
  group by q.queue, q.position
  order by q.position;
end
$$;

-- One inquiry, for either of its two sides. No row for anyone else, or for an id that does not exist.
create function marketplace.get_marketplace_interest(p_interest_id uuid)
returns table (id uuid, job_id uuid, job_slug text, job_title text, job_status text, job_accepting_interest boolean,
               landing_org_id uuid, landing_org_name text, hauler_org_id uuid, hauler_org_name text, hauler_org_type text,
               submitted_by_user_id uuid, submitted_by_name text, trucks_offered integer, equipment jsonb,
               available_from date, available_until date, message text, contact_preference text, status text,
               replies jsonb, created_at timestamp with time zone, updated_at timestamp with time zone,
               responded_at timestamp with time zone, withdrawn_at timestamp with time zone)
language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_hauler_org uuid;
  v_job_org    uuid;
  v_caps       text[];
begin
  select e.hauler_org_id, e.job_org_id into v_hauler_org, v_job_org
  from marketplace.expressions_of_interest e where e.id = p_interest_id;
  if not found then
    return;
  end if;

  -- The hauling business first: any of its people who may act on inquiries.
  if marketplace.has_org_role(v_hauler_org, array['owner', 'manager', 'staff', 'driver']) then
    select a.capabilities into v_caps from marketplace.get_viewer_marketplace_access(v_hauler_org) a;
    if 'interest.reply' = any (coalesce(v_caps, array[]::text[])) then
      return query select * from marketplace.list_marketplace_interests(v_hauler_org, 'hauler', p_interest_id => p_interest_id);
      return;
    end if;
  end if;
  -- Then the landing desk; the list applies the landing scope (26-B), so a limited member gets no row.
  if marketplace.has_org_role(v_job_org, array['owner', 'manager', 'staff'], true) then
    select a.capabilities into v_caps from marketplace.get_viewer_marketplace_access(v_job_org) a;
    if 'inquiry.respond' = any (coalesce(v_caps, array[]::text[])) then
      return query select * from marketplace.list_marketplace_interests(v_job_org, 'landing', p_interest_id => p_interest_id);
    end if;
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 33-Q2. Find Work as pages (#280). The two CTEs are 31's list_marketplace_jobs, verbatim, without its single-job
-- argument and with the filters the adapter applied in memory (packages/contracts: filterMarketplaceJobs); lines
-- marked "33" are new. The order is the contract's compareMarketplaceJobs, the job id last, so a cursor resumes
-- exactly: no job twice and none skipped.
--   newest   confirmed jobs first, latest confirmation first; then by last edit
--   nearest  by distance from the typed place (jobs without a public point last), then newest; without a place: newest
--   pay      by pay basis in the contract's fixed order, highest stated amount first within a basis; negotiable,
--            other and unstated pay last; then newest. Amounts on different bases are never compared.
-- The typed place arrives as latitude and longitude and is snapped to the 0.10 degree grid like every origin.
-- p_after is the page_cursor of the last row of the previous page. total_count counts the whole search, not the page.
-- Sponsored placement is not applied to pages (the contract's order has none), so `sponsored` is always false here.
-- -----------------------------------------------------------------------------
create function marketplace.list_marketplace_jobs_page(
  p_query text default null,
  p_equipment text default null,
  p_pay_unit text default null,
  p_accepting_only boolean default true,
  p_org_id uuid default null,
  p_lat numeric default null,
  p_lng numeric default null,
  p_radius_miles integer default null,
  p_product text default null,
  p_product_excluded text[] default null,
  p_starts_by date default null,
  p_equipment_setups jsonb default null,
  p_sort text default 'newest',
  p_after jsonb default null,
  p_limit integer default 50
) returns table (
  job_id uuid,
  slug text,
  title text,
  poster_organization_id uuid,
  poster_name text,
  poster_verified boolean,
  product text,
  description text,
  pay_amount_cents bigint,
  pay_unit text,
  pay_note text,
  equipment_codes text[],
  equipment_labels text[],
  origin_label text,
  origin_state_code char(2),
  origin_lat double precision,
  origin_lng double precision,
  destination_label text,
  est_one_way_miles integer,
  distance_miles numeric,
  starts_on date,
  ends_on date,
  duration_days integer,
  schedule_note text,
  trucks_total integer,
  trucks_per_day integer,
  estimated_loads_per_truck_per_day numeric,
  estimated_daily_loads integer,
  estimated_tons_per_load numeric,
  public_road_notes text,
  public_access_requirements text[],
  status text,
  accepting_interest boolean,
  last_modified_at timestamptz,
  last_confirmed_at timestamptz,
  expires_at timestamptz,
  sponsored boolean,
  total_count bigint,
  page_cursor jsonb
)
language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_origin  extensions.geography;
  v_sort    text := lower(btrim(coalesce(p_sort, 'newest')));
  v_limit   integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_product text := nullif(lower(btrim(coalesce(p_product, ''))), '');
  v_setups  jsonb;
  a_k0 integer; a_k1 numeric; a_k2 numeric; a_k3 integer; a_k4 numeric; a_title text; a_id uuid;
begin
  if v_sort not in ('newest', 'nearest', 'pay') then
    raise exception 'p_sort must be newest, nearest or pay' using errcode = '22023';
  end if;
  if p_lat is not null and p_lng is not null and p_lat between -90 and 90 and p_lng between -180 and 180 then
    v_origin := extensions.st_setsrid(extensions.st_makepoint(p_lng::double precision, p_lat::double precision), 4326)::extensions.geography;
  end if;
  if v_sort = 'nearest' and v_origin is null then
    v_sort := 'newest';
  end if;
  if p_equipment_setups is not null then
    if jsonb_typeof(p_equipment_setups) <> 'array' then
      raise exception 'p_equipment_setups must be an array of arrays of equipment codes' using errcode = '22023';
    end if;
    -- A setup with nothing in it compares with nothing (marketplaceEquipmentFit).
    select jsonb_agg(s) into v_setups
    from jsonb_array_elements(p_equipment_setups) s
    where jsonb_typeof(s) = 'array' and jsonb_array_length(s) > 0;
  end if;
  if p_after is not null then
    begin
      if jsonb_typeof(p_after) <> 'object' or (p_after ->> 's') is distinct from v_sort
         or jsonb_typeof(p_after -> 'k') <> 'array' or jsonb_array_length(p_after -> 'k') <> 5 then
        raise exception 'cursor shape' using errcode = '22023';
      end if;
      a_k0 := (p_after -> 'k' ->> 0)::integer;
      a_k1 := (p_after -> 'k' ->> 1)::numeric;
      a_k2 := (p_after -> 'k' ->> 2)::numeric;
      a_k3 := (p_after -> 'k' ->> 3)::integer;
      a_k4 := (p_after -> 'k' ->> 4)::numeric;
      a_title := p_after ->> 't';
      a_id := (p_after ->> 'i')::uuid;
      if a_k0 is null or a_k1 is null or a_k2 is null or a_k3 is null or a_k4 is null or a_title is null or a_id is null then
        raise exception 'cursor shape' using errcode = '22023';
      end if;
    exception when others then
      raise exception 'This page link does not match the search; start again from the first page' using errcode = '22023';
    end;
  end if;

  return query
  with search_origin as (
    select marketplace.approximate_point(v_origin) as snapped_point, -- 33: from p_lat and p_lng
           nullif(lower(btrim(coalesce(p_query, ''))), '') as q_norm,
           nullif(lower(btrim(coalesce(p_equipment, ''))), '') as eq_norm
  ),
  job_rows as (
    select
      j.id as job_id,
      j.id::text as slug,
      j.title,
      j.org_id as poster_organization_id,
      o.display_name as poster_name,
      (o.verification_status = 'verified') as poster_verified,
      j.product,
      j.description,
      j.pay_amount_cents,
      j.pay_unit,
      j.pay_note,
      coalesce(eq.codes, array[]::text[]) as equipment_codes,
      coalesce(eq.labels, array[]::text[]) as equipment_labels,
      l.public_area_label as origin_label,
      l.state_code as origin_state_code,
      case when l.public_point is not null
           then round(extensions.st_y(l.public_point::extensions.geometry)::numeric, 1)::double precision
      end as origin_lat,
      case when l.public_point is not null
           then round(extensions.st_x(l.public_point::extensions.geometry)::numeric, 1)::double precision
      end as origin_lng,
      j.destination_label,
      j.est_one_way_miles,
      case when so.snapped_point is not null and l.public_point is not null
           then round((extensions.st_distance(l.public_point, so.snapped_point) / 1609.344)::numeric, 0)
      end as distance_miles,
      j.work_starts_on as starts_on,
      j.work_ends_on as ends_on,
      j.duration_days,
      j.schedule_note,
      j.trucks_requested as trucks_total,
      j.trucks_per_day,
      j.est_loads_per_truck_per_day as estimated_loads_per_truck_per_day,
      j.est_daily_loads as estimated_daily_loads,
      j.est_tons_per_load as estimated_tons_per_load,
      j.public_road_notes,
      j.public_access_requirements,
      case
        when j.status = 'active' and j.expires_at is not null and j.expires_at <= now() then 'expired'
        else j.status
      end as eff_status,
      (j.status = 'active' and (j.expires_at is null or j.expires_at > now())
       and marketplace.job_confirmation_current(j.last_confirmed_at)) as accepting_interest, -- 31-R
      j.updated_at as last_modified_at,
      j.last_confirmed_at,
      j.expires_at,
      (
        j.status = 'active'
        and (j.expires_at is null or j.expires_at > now())
        and marketplace.job_confirmation_current(j.last_confirmed_at) -- 31-R
        and exists (
          select 1 from marketplace.job_boosts b
          where b.job_id = j.id and b.status = 'active'
            and now() >= b.starts_at and now() < b.ends_at
            and (so.snapped_point is null
                 or extensions.st_dwithin(
                      b.center_point, so.snapped_point,
                      b.radius_miles::double precision * 1609.344 + 8000.0))
        )
      ) as raw_sponsored,
      -- 33: the two sort keys the page order needs beside the columns above.
      case when so.snapped_point is not null and l.public_point is not null
           then extensions.st_distance(l.public_point, so.snapped_point)
      end as distance_m,
      case when j.pay_amount_cents is not null and j.pay_unit is not null and j.pay_unit not in ('negotiable', 'other')
           then coalesce(array_position(array['per_load', 'per_ton', 'per_mbf', 'per_cord', 'per_mile', 'per_hour', 'per_day', 'flat_rate'],
                                        j.pay_unit), 99)
      end as pay_rank
    from search_origin so
    cross join marketplace.job_postings j
    join marketplace.landings l on l.id = j.landing_id
    join marketplace.organizations o on o.id = j.org_id and o.status = 'active'
    left join lateral (
      select
        array_agg(et.code order by et.sort_order, et.code) as codes,
        array_agg(et.label order by et.sort_order, et.code) as labels
      from marketplace.job_posting_equipment jpe
      join marketplace.equipment_types et on et.code = jpe.equipment_code
      where jpe.job_id = j.id
    ) eq on true
    where j.status <> 'draft'
      -- Same visibility as job_postings RLS: anonymous callers see only publicly visible jobs; paused,
      -- filled, closed (including moderated) or expired jobs only to the owning desk, haulers with an
      -- inquiry, invitation recipients and platform admins.
      and marketplace.can_read_job_posting(j.id)
      -- 31-R: an active job that was not confirmed in the last 14 days (a legacy job never confirmed included) is
      -- off every list until its poster reconfirms it; its own landing desk and platform staff still see it.
      and (j.status <> 'active'
           or marketplace.job_confirmation_current(j.last_confirmed_at)
           or j.org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true))
           or marketplace.is_platform_admin())
      and (l.status = 'active' or (not coalesce(p_accepting_only, true) and l.status <> 'archived'))
      and (p_org_id is null or j.org_id = p_org_id)
      and (not coalesce(p_accepting_only, true)
           or (j.status = 'active' and l.status = 'active' and (j.expires_at is null or j.expires_at > now())
               and marketplace.job_confirmation_current(j.last_confirmed_at))) -- 31-R
      and (p_pay_unit is null or btrim(p_pay_unit) = '' or j.pay_unit = p_pay_unit)
      and (so.eq_norm is null
           or exists (
             select 1 from unnest(coalesce(eq.codes, array[]::text[])) c where lower(c) = so.eq_norm
           )
           or exists (
             select 1 from unnest(coalesce(eq.labels, array[]::text[])) lbl where lower(lbl) = so.eq_norm
           ))
      and (so.q_norm is null
           or position(so.q_norm in lower(j.title)) > 0
           or position(so.q_norm in lower(o.display_name)) > 0
           or position(so.q_norm in lower(coalesce(j.product, ''))) > 0
           or position(so.q_norm in lower(l.public_area_label)) > 0
           or position(so.q_norm in lower(coalesce(j.destination_label, ''))) > 0
           or exists (
             select 1 from unnest(coalesce(eq.labels, array[]::text[])) lbl
             where position(so.q_norm in lower(lbl)) > 0
           )
           or exists (
             select 1 from unnest(coalesce(eq.codes, array[]::text[])) c
             where position(so.q_norm in lower(c)) > 0
           )
           or j.search_document @@ websearch_to_tsquery('english'::regconfig, so.q_norm))
      and (so.snapped_point is null or p_radius_miles is null
           or (l.public_point is not null
               and extensions.st_dwithin(
                     l.public_point, so.snapped_point,
                     least(greatest(p_radius_miles, 5), 500)::double precision * 1609.344 + 8000.0)))
      -- 33: the filters the adapter applied in memory.
      and (v_product is null or lower(btrim(coalesce(j.product, ''))) = v_product)
      and (p_product_excluded is null
           or (btrim(coalesce(j.product, '')) <> ''
               and lower(btrim(j.product)) <> all (select lower(btrim(x)) from unnest(p_product_excluded) x where x is not null)))
      and (p_starts_by is null or (j.work_starts_on is not null and j.work_starts_on <= p_starts_by))
      -- One of the viewer's setups has every piece of equipment the job lists. A job that lists none, and a viewer
      -- with no setup, are not compared.
      and (v_setups is null
           or coalesce(cardinality(eq.codes), 0) = 0
           or exists (
             select 1 from jsonb_array_elements(v_setups) s
             where not exists (
               select 1 from unnest(eq.codes) c
               where not exists (select 1 from jsonb_array_elements_text(s) x where lower(btrim(x)) = lower(c)))))
  ),
  keyed as (
    select r.*,
           case v_sort when 'nearest' then (r.distance_m is null)::integer
                       when 'pay' then (r.pay_rank is null)::integer
                       else 0 end as k0,
           case v_sort when 'nearest' then coalesce(r.distance_m, 0)::numeric
                       when 'pay' then coalesce(r.pay_rank, 0)::numeric
                       else 0::numeric end as k1,
           case when v_sort = 'pay' and r.pay_rank is not null then -(r.pay_amount_cents::numeric) else 0::numeric end as k2,
           (r.last_confirmed_at is null)::integer as k3,
           -(extract(epoch from coalesce(r.last_confirmed_at, r.last_modified_at))::numeric) as k4
    from job_rows r
  ),
  counted as (
    select k.*, count(*) over () as matching from keyed k
  )
  select
    c.job_id, c.slug, c.title, c.poster_organization_id, c.poster_name, c.poster_verified,
    c.product, c.description, c.pay_amount_cents, c.pay_unit, c.pay_note,
    c.equipment_codes, c.equipment_labels,
    c.origin_label, c.origin_state_code, c.origin_lat, c.origin_lng,
    c.destination_label, c.est_one_way_miles, c.distance_miles,
    c.starts_on, c.ends_on, c.duration_days, c.schedule_note,
    c.trucks_total, c.trucks_per_day,
    c.estimated_loads_per_truck_per_day, c.estimated_daily_loads, c.estimated_tons_per_load,
    c.public_road_notes, c.public_access_requirements,
    c.eff_status as status, c.accepting_interest,
    c.last_modified_at, c.last_confirmed_at, c.expires_at,
    false as sponsored,
    c.matching as total_count,
    -- The key travels as text: a JSON number would lose the timestamp's microseconds in a JavaScript client.
    jsonb_build_object('s', v_sort, 'k', jsonb_build_array(c.k0::text, c.k1::text, c.k2::text, c.k3::text, c.k4::text),
                       't', c.title, 'i', c.job_id) as page_cursor
  from counted c
  where p_after is null
     or (c.k0, c.k1, c.k2, c.k3, c.k4, c.title collate "C", c.job_id) > (a_k0, a_k1, a_k2, a_k3, a_k4, a_title collate "C", a_id)
  order by c.k0, c.k1, c.k2, c.k3, c.k4, c.title collate "C", c.job_id
  limit v_limit;
end
$$;

-- -----------------------------------------------------------------------------
-- Function grants (none by default: HF-18). The three redefined functions keep their ACLs.
-- -----------------------------------------------------------------------------
revoke all on function
  marketplace.list_invitation_recipients(uuid, integer),
  marketplace.remove_team_member(uuid),
  marketplace.admin_resolve_report(uuid, text, text),
  marketplace.interest_queue(text, text, uuid),
  marketplace.list_marketplace_interests(uuid, text, uuid, integer, timestamptz, uuid, uuid[], boolean, uuid, text),
  marketplace.count_marketplace_interests(uuid, text),
  marketplace.get_marketplace_interest(uuid),
  marketplace.list_marketplace_jobs_page(text, text, text, boolean, uuid, numeric, numeric, integer, text, text[], date, jsonb, text, jsonb, integer)
  from public, anon, authenticated, service_role;

-- Signed-in people (each function checks who may act). list_marketplace_interests gets back the grant it had.
grant execute on function
  marketplace.list_invitation_recipients(uuid, integer),
  marketplace.remove_team_member(uuid),
  marketplace.admin_resolve_report(uuid, text, text),
  marketplace.list_marketplace_interests(uuid, text, uuid, integer, timestamptz, uuid, uuid[], boolean, uuid, text),
  marketplace.count_marketplace_interests(uuid, text),
  marketplace.get_marketplace_interest(uuid)
  to authenticated;

-- Public discovery, as list_marketplace_jobs: public-safe fields of jobs the caller may read.
grant execute on function
  marketplace.list_marketplace_jobs_page(text, text, text, boolean, uuid, numeric, numeric, integer, text, text[], date, jsonb, text, jsonb, integer)
  to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Record this migration.
-- -----------------------------------------------------------------------------
insert into marketplace.schema_migrations (version, name) values ('33', '33_v2_port_v3_functions');
