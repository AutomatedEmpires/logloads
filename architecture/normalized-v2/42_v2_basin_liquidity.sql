-- =============================================================================
-- LogLoads normalized-v2 — 42 per-basin liquidity board (#326)
--
-- NON-ACTIVE PROTOTYPE. Not an approved migration. Applied after 40_v2_reveal_pause.sql.
-- Run order: 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23 -> 26 -> 29 -> 31 -> 33 -> 35 -> 38 -> 40 -> 42
-- (the odd stages and 10, 15, 39, 41, 43 are tests, not migrations). Apply exactly once, in one transaction:
-- psql -v ON_ERROR_STOP=1 --single-transaction -f 42_v2_basin_liquidity.sql
--
-- One staff read: a row per basin (38) with the counts the liquidity board shows. LogLoads staff read it to
-- judge whether a basin has enough work and enough trucks. Any active platform admin may call it; anyone
-- else is refused (42501). It only reads, so it is stable and not audited, like list_basins and
-- basin_readiness.
--
-- It returns counts only: no organization, person, job, landing or point, and no basin boundary. The page
-- derives the shares (inquiries per job, share answered, stale share) from these counts.
--
-- The whole board is one statement. Each active landing's basin is derived once, and jobs and inquiries
-- join to that, so the read does not repeat per basin. It uses the existing indexes
-- (landings_public_point_gix, basins_boundary_gix, job_postings_landing_idx, expressions_of_interest_live_uq,
-- availability_reports_org_idx).
--
-- 42 adds one function. It adds no table, no index and no trigger, and changes no stored row.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Migration-order guard: requires 40, refuses a repeat. Runs before any change.
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_advisory_xact_lock(hashtextextended('marketplace.schema_migrations', 0));
  if to_regclass('marketplace.schema_migrations') is null then
    raise exception 'migration 42 requires migration 40 to be applied first' using errcode = '55000';
  end if;
  if not exists (select 1 from marketplace.schema_migrations where version = '40') then
    raise exception 'migration 42 requires migration 40 to be applied first' using errcode = '55000';
  end if;
  if exists (select 1 from marketplace.schema_migrations where version = '42') then
    raise exception 'migration 42 is already applied (%); re-running it is refused and nothing was changed',
      (select applied_at from marketplace.schema_migrations where version = '42')
      using errcode = '55000', hint = 'Migrations are forward-only.';
  end if;
  if to_regprocedure('marketplace.basin_liquidity_board()') is not null then
    raise exception 'migration 42 appears to be applied already (its objects exist) but is not recorded; refusing to re-run'
      using errcode = '55000';
  end if;
  perform set_config('logloads.migration_xact', txid_current()::text, true);
end
$$;

do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    perform set_config('default_transaction_read_only', 'on', false);
    perform set_config('logloads.migration_refused', '42', false);
  end if;
end
$$;

do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    raise exception 'migration 42 must be applied in one transaction (psql --single-transaction); nothing was changed'
      using errcode = '25P01', hint = 'This session (or pooled backend) was made read-only to stop the rest of the file.';
  end if;
  if coalesce(current_setting('logloads.migration_refused', true), '') <> '' then
    raise exception 'migration 42 refused: this session was made read-only by an earlier non-atomic attempt (migration %); reconnect and apply it with psql --single-transaction',
      current_setting('logloads.migration_refused')
      using errcode = '25P01';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- The board. Definitions, each the same as basin_readiness (38) where that function has one:
--   verified_landings   active landings of active, verified businesses, in the basin.
--   active_jobs         active, unexpired jobs at those active landings of active businesses. Stale jobs count.
--   jobs_confirmed      the active jobs confirmed in the last 14 days (job_confirmation_current).
--                       active_jobs - jobs_confirmed is the stale count.
--   haulers_available   active hauling businesses with a standing availability report made in the last
--                       14 days whose point falls in the basin. A county-only basin matches no point.
--   interests           inquiries on the active jobs that were not withdrawn.
--   interests_answered  those the landing has responded to (responded_at is set once, on the first response).
--   median_first_reply_minutes
--                       the median whole minutes from an inquiry to that first response; null with none.
-- -----------------------------------------------------------------------------
create function marketplace.basin_liquidity_board()
returns table (
  basin_id uuid,
  name text,
  state_code char(2),
  status text,
  verified_landings integer,
  active_jobs integer,
  jobs_confirmed integer,
  haulers_available integer,
  interests integer,
  interests_answered integer,
  median_first_reply_minutes integer
)
language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
#variable_conflict use_column
begin
  if not marketplace.is_platform_admin() then
    raise exception 'platform admin required' using errcode = '42501';
  end if;

  return query
    with landing_basin as materialized (
      -- Each active landing of an active business, with its basin, derived once.
      select l.id as landing_id,
             l.org_id as landing_org_id,
             marketplace.basin_for_landing(l.id) as in_basin,
             (o.verification_status = 'verified') as is_verified
      from marketplace.landings l
      join marketplace.organizations o on o.id = l.org_id and o.status = 'active'
      where l.status = 'active'
    ),
    landing_counts as (
      select lb.in_basin, count(*) filter (where lb.is_verified) as n_verified
      from landing_basin lb
      where lb.in_basin is not null
      group by lb.in_basin
    ),
    basin_job as materialized (
      select j.id as job_id,
             lb.in_basin,
             marketplace.job_confirmation_current(j.last_confirmed_at) as is_current
      from marketplace.job_postings j
      join landing_basin lb on lb.landing_id = j.landing_id and lb.landing_org_id = j.org_id
      where j.status = 'active'
        and (j.expires_at is null or j.expires_at > now())
        and lb.in_basin is not null
    ),
    job_counts as (
      select bj.in_basin, count(*) as n_active, count(*) filter (where bj.is_current) as n_confirmed
      from basin_job bj
      group by bj.in_basin
    ),
    inquiry_counts as (
      select bj.in_basin,
             count(*) as n_interests,
             count(*) filter (where e.responded_at is not null) as n_answered,
             percentile_cont(0.5) within group (
               order by (greatest(extract(epoch from (e.responded_at - e.created_at)), 0) / 60.0)::double precision
             ) filter (where e.responded_at is not null) as median_minutes
      from marketplace.expressions_of_interest e
      join basin_job bj on bj.job_id = e.job_id
      where e.status <> 'withdrawn'
      group by bj.in_basin
    ),
    hauler_counts as (
      select hb.in_basin, count(distinct hb.hauler_org_id) as n_haulers
      from (
        select ar.org_id as hauler_org_id, marketplace.basin_for_point(ar.area_center) as in_basin
        from marketplace.availability_reports ar
        join marketplace.organizations o on o.id = ar.org_id and o.status = 'active'
        join marketplace.hauler_profiles h on h.org_id = ar.org_id
        where ar.withdrawn_at is null
          and ar.reported_at > now() - interval '336 hours'
          and ar.available_until >= current_date
      ) hb
      where hb.in_basin is not null
      group by hb.in_basin
    )
    select b.id,
           b.name,
           b.state_code,
           b.status,
           coalesce(lc.n_verified, 0)::integer,
           coalesce(jc.n_active, 0)::integer,
           coalesce(jc.n_confirmed, 0)::integer,
           coalesce(hc.n_haulers, 0)::integer,
           coalesce(ic.n_interests, 0)::integer,
           coalesce(ic.n_answered, 0)::integer,
           floor(ic.median_minutes)::integer
    from marketplace.basins b
    left join landing_counts lc on lc.in_basin = b.id
    left join job_counts jc on jc.in_basin = b.id
    left join inquiry_counts ic on ic.in_basin = b.id
    left join hauler_counts hc on hc.in_basin = b.id
    order by b.state_code, lower(b.name), b.id;
end
$$;

comment on function marketplace.basin_liquidity_board() is
  '42 (#326): platform staff read one row of counts per basin for the liquidity board. Counts only. Anyone else is refused.';

-- -----------------------------------------------------------------------------
-- Grants. Authenticated only; the function itself refuses anyone who is not a platform admin.
-- -----------------------------------------------------------------------------
revoke all on function marketplace.basin_liquidity_board()
  from public, anon, authenticated, service_role;

grant execute on function marketplace.basin_liquidity_board() to authenticated;

insert into marketplace.schema_migrations (version, name) values ('42', '42_v2_basin_liquidity');
