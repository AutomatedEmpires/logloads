#!/usr/bin/env bash
# =============================================================================
# LogLoads normalized-v2 — 05 genuine multi-session concurrency test suite (Linux/CI)
#
# NON-ACTIVE PROTOTYPE TEST HARNESS. Do not run against production.
# Requires a disposable local PostgreSQL 15+ / 17 instance (with PostGIS + btree_gist)
# and `psql` on PATH. Refuses to run unless $LOGLOADS_DISPOSABLE_DB_URL points
# to `127.0.0.1` or `localhost`.
#
# Usage (Ubuntu / GitHub Actions CI):
#   export LOGLOADS_DISPOSABLE_DB_URL="postgresql://postgres:postgres@127.0.0.1:5432/logloads_test"
#   bash architecture/normalized-v2/05_concurrency_test.sh
#
# Exercises 4 genuine two-connection races using parallel `psql` background jobs
# released simultaneously via `pg_sleep_until(barrier_ts)`:
#   Race 1: Simultaneous consumption of the final invitation credit (1 unit left)
#   Race 2: Simultaneous multi-channel / duplicate delivery failure callbacks
#   Race 3: Stale reservation reaper vs. concurrent delivery callback
#   Race 4: Simultaneous billing-cycle webhook calls for the same period & promo
# =============================================================================

set -euo pipefail

DB_URL="${LOGLOADS_DISPOSABLE_DB_URL:-}"
if [[ -z "$DB_URL" ]]; then
  echo "ERROR: Missing LOGLOADS_DISPOSABLE_DB_URL. Set it to a disposable local PostgreSQL URL (127.0.0.1 or localhost)." >&2
  exit 1
fi

if [[ ! "$DB_URL" =~ ^postgres(ql)?://([^@/]+@)?(127\.0\.0\.1|localhost)(:[0-9]+)?/ ]]; then
  echo "ERROR: Refusing to run: LOGLOADS_DISPOSABLE_DB_URL must point to 127.0.0.1 or localhost (disposable local database only)." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: Missing prerequisite: psql is not installed or not on PATH." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

psql_scalar() {
  local sql="$1"
  printf '%s\n' "$sql" | psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1
}

psql_exec() {
  local sql="$1"
  printf '%s\n' "$sql" | psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 >/dev/null
}

run_parallel_psql() {
  local sql_a="$1"
  local sql_b="$2"
  local out_a="$TMP_DIR/out_a.log"
  local out_b="$TMP_DIR/out_b.log"
  local rc_a=0
  local rc_b=0

  set +e
  (printf '%s\n' "$sql_a" | psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 >"$out_a" 2>&1) &
  local pid_a=$!
  (printf '%s\n' "$sql_b" | psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 >"$out_b" 2>&1) &
  local pid_b=$!

  wait "$pid_a" || rc_a=$?
  wait "$pid_b" || rc_b=$?
  set -e

  PARALLEL_RC_A=$rc_a
  PARALLEL_RC_B=$rc_b
  PARALLEL_OUT_A="$(cat "$out_a")"
  PARALLEL_OUT_B="$(cat "$out_b")"
}

echo "[0/5] Resetting disposable marketplace schema and loading 01..03..."
psql_exec "drop schema if exists marketplace cascade;"
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/01_schema.sql" >/dev/null
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/02_access.sql" >/dev/null
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/03_entitlements.sql" >/dev/null

# Seed baseline fixture for multi-session races (committed so parallel sessions see it).
psql_exec "
insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true)
on conflict (issuer) do nothing;

do \$\$
declare
  v_issuer constant text := 'https://clerk.logloads.test';
  v_u_land   uuid;
  v_u_mgr    uuid;
  v_u_haul1  uuid;
  v_u_haul2  uuid;
  v_u_admin  uuid;
  v_org_land uuid;
  v_org_h1   uuid;
  v_org_h2   uuid;
  v_land_id  uuid;
  v_job_id   uuid;
begin
  perform set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
  set local role service_role;
  v_u_land  := marketplace.sync_verified_identity(v_issuer, 'conc_land_owner', 'Owner A', 'owner@conc.test', true);
  v_u_mgr   := marketplace.sync_verified_identity(v_issuer, 'conc_land_mgr',   'Manager A', 'mgr@conc.test', true);
  v_u_haul1 := marketplace.sync_verified_identity(v_issuer, 'conc_haul_1',     'Hauler 1', 'h1@conc.test', true);
  v_u_haul2 := marketplace.sync_verified_identity(v_issuer, 'conc_haul_2',     'Hauler 2', 'h2@conc.test', true);
  v_u_admin := marketplace.sync_verified_identity(v_issuer, 'conc_admin',      'Admin',    'admin@conc.test', true);
  reset role;

  insert into marketplace.platform_admins (user_id, admin_role, note)
  values (v_u_admin, 'superadmin', 'Concurrency test admin');

  perform set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'iss', v_issuer, 'sub', 'conc_land_owner', 'aud', 'logloads-app',
    'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;
  v_org_land := marketplace.create_organization('Concurrency Timber', 'conc-timber', 'OR', false);

  perform set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'iss', v_issuer, 'sub', 'conc_haul_1', 'aud', 'logloads-app',
    'exp', extract(epoch from now())::bigint + 3600)::text, true);
  v_org_h1 := marketplace.create_organization('Haul One', 'conc-haul-1', 'OR', true);
  update marketplace.hauler_profiles
  set service_center = extensions.st_GeogFromText('SRID=4326;POINT(-122.68 44.42)'),
      service_radius_miles = 100, accepts_targeted_invitations = true
  where org_id = v_org_h1;
  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled)
  values
    (v_u_haul1, v_org_h1, 'targeted_invitation', 'in_app', true),
    (v_u_haul1, v_org_h1, 'targeted_invitation', 'email',  true);
  insert into marketplace.equipment_units (org_id, equipment_code, unit_label)
  values (v_org_h1, 'log_truck', 'H1-1');

  perform set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'iss', v_issuer, 'sub', 'conc_haul_2', 'aud', 'logloads-app',
    'exp', extract(epoch from now())::bigint + 3600)::text, true);
  v_org_h2 := marketplace.create_organization('Haul Two', 'conc-haul-2', 'OR', true);
  update marketplace.hauler_profiles
  set service_center = extensions.st_GeogFromText('SRID=4326;POINT(-122.69 44.41)'),
      service_radius_miles = 100, accepts_targeted_invitations = true
  where org_id = v_org_h2;
  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled)
  values (v_u_haul2, v_org_h2, 'targeted_invitation', 'in_app', true);
  insert into marketplace.equipment_units (org_id, equipment_code, unit_label)
  values (v_org_h2, 'log_truck', 'H2-1');

  perform set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
  set local role service_role;
  perform marketplace.open_subscription_cycle(
    v_org_land, 'basic', 'active', now() - interval '1 hour', now() + interval '29 days',
    'cus_conc', 'sub_conc', false, 7, false
  );

  perform set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'iss', v_issuer, 'sub', 'conc_land_owner', 'aud', 'logloads-app',
    'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;
  insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
  values (v_org_land, v_u_mgr, 'manager', true, 'invited');

  perform set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'iss', v_issuer, 'sub', 'conc_land_mgr', 'aud', 'logloads-app',
    'exp', extract(epoch from now())::bigint + 3600)::text, true);
  update marketplace.organization_memberships set status = 'active'
  where org_id = v_org_land and user_id = v_u_mgr;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'iss', v_issuer, 'sub', 'conc_land_owner', 'aud', 'logloads-app',
    'exp', extract(epoch from now())::bigint + 3600)::text, true);
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (v_org_land, 'Concurrency Landing', 'active', 'Near Sweet Home, OR',
          extensions.st_GeogFromText('SRID=4326;POINT(-122.70 44.40)'), 'OR')
  returning id into v_land_id;

  insert into marketplace.job_postings
    (org_id, landing_id, title, pay_amount_cents, pay_unit, trucks_requested, status)
  values
    (v_org_land, v_land_id, 'Concurrency Sawlog Job', 8500, 'per_ton', 10, 'active')
  returning id into v_job_id;

  insert into marketplace.job_posting_equipment (job_id, equipment_code)
  values (v_job_id, 'log_truck');
  reset role;
end
\$\$;
"

# =============================================================================
# Race 1: Simultaneous consumption of the final invitation credit (1 unit left)
# =============================================================================
echo "[1/5] Race 1: Two sessions racing for the final (3rd of 3) invitation credit..."
psql_exec "update marketplace.entitlement_periods set invitations_committed = 2;"
BARRIER="$(psql_scalar "select (clock_timestamp() + interval '1200 milliseconds')::text;")"

RACE1_A="
begin;
select pg_sleep_until('${BARRIER}'::timestamptz);
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', 'conc_land_owner',
  'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
set local role authenticated;
select marketplace.reserve_targeted_invitation(
  (select id from marketplace.job_postings limit 1),
  (select id from marketplace.organizations where slug = 'conc-haul-1'),
  'Session A final credit'
);
commit;
"

RACE1_B="
begin;
select pg_sleep_until('${BARRIER}'::timestamptz);
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', 'conc_land_mgr',
  'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
set local role authenticated;
select marketplace.reserve_targeted_invitation(
  (select id from marketplace.job_postings limit 1),
  (select id from marketplace.organizations where slug = 'conc-haul-2'),
  'Session B final credit'
);
commit;
"

run_parallel_psql "$RACE1_A" "$RACE1_B"
R1_SUCCESSES=0
R1_FAILURES=0
[[ $PARALLEL_RC_A -eq 0 ]] && R1_SUCCESSES=$((R1_SUCCESSES + 1)) || R1_FAILURES=$((R1_FAILURES + 1))
[[ $PARALLEL_RC_B -eq 0 ]] && R1_SUCCESSES=$((R1_SUCCESSES + 1)) || R1_FAILURES=$((R1_FAILURES + 1))
COMMITTED_AFTER_R1="$(psql_scalar "select invitations_committed from marketplace.entitlement_periods limit 1;")"

if [[ $R1_SUCCESSES -ne 1 || $R1_FAILURES -ne 1 || "$COMMITTED_AFTER_R1" != "3" ]]; then
  echo "ERROR: Race 1 FAILED: expected 1 success, 1 failure, and invitations_committed = 3; got successes=$R1_SUCCESSES, failures=$R1_FAILURES, committed=$COMMITTED_AFTER_R1" >&2
  echo "Session A ($PARALLEL_RC_A): $PARALLEL_OUT_A" >&2
  echo "Session B ($PARALLEL_RC_B): $PARALLEL_OUT_B" >&2
  exit 1
fi
echo "  PASS: Exactly 1 session claimed the final credit; invitations_committed = 3."

# =============================================================================
# Race 2: Simultaneous multi-channel failure callbacks on the same invitation
# =============================================================================
echo "[2/5] Race 2: Two worker sessions resolving multi-channel failures simultaneously..."
INV_ID="$(psql_scalar "select id from marketplace.targeted_invitations where status = 'reserved' limit 1;")"
psql_exec "
insert into marketplace.invitation_deliveries (invitation_id, channel, recipient_user_id)
select '${INV_ID}'::uuid, 'email', m.user_id
from marketplace.targeted_invitations ti
join marketplace.organization_memberships m on m.org_id = ti.recipient_org_id
where ti.id = '${INV_ID}'::uuid
on conflict do nothing;
"

DEL_1="$(psql_scalar "select id from marketplace.invitation_deliveries where invitation_id = '${INV_ID}'::uuid order by channel limit 1;")"
DEL_2="$(psql_scalar "select id from marketplace.invitation_deliveries where invitation_id = '${INV_ID}'::uuid order by channel offset 1 limit 1;")"
BARRIER="$(psql_scalar "select (clock_timestamp() + interval '1200 milliseconds')::text;")"

RACE2_A="
begin;
select pg_sleep_until('${BARRIER}'::timestamptz);
select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
set local role service_role;
select marketplace.resolve_invitation_delivery('${DEL_1}'::uuid, 'failed', null, 'channel_1_failed');
commit;
"

RACE2_B="
begin;
select pg_sleep_until('${BARRIER}'::timestamptz);
select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
set local role service_role;
select marketplace.resolve_invitation_delivery('${DEL_2}'::uuid, 'bounced', null, 'channel_2_bounced');
commit;
"

run_parallel_psql "$RACE2_A" "$RACE2_B"
R2_SUCCESSES=0
[[ $PARALLEL_RC_A -eq 0 ]] && R2_SUCCESSES=$((R2_SUCCESSES + 1))
[[ $PARALLEL_RC_B -eq 0 ]] && R2_SUCCESSES=$((R2_SUCCESSES + 1))
COMMITTED_AFTER_R2="$(psql_scalar "select invitations_committed from marketplace.entitlement_periods limit 1;")"

if [[ $R2_SUCCESSES -ne 2 || "$COMMITTED_AFTER_R2" != "2" ]]; then
  echo "ERROR: Race 2 FAILED: expected both callbacks to succeed without deadlock and refund 1 credit (3 -> 2); got successes=$R2_SUCCESSES, committed=$COMMITTED_AFTER_R2" >&2
  echo "Session A ($PARALLEL_RC_A): $PARALLEL_OUT_A" >&2
  echo "Session B ($PARALLEL_RC_B): $PARALLEL_OUT_B" >&2
  exit 1
fi
echo "  PASS: Zero deadlocks and credit refunded once (invitations_committed: 3 -> 2)."

# =============================================================================
# Race 3: Stale reservation reaper vs. concurrent delivery failure callback
# =============================================================================
echo "[3/5] Race 3: expire_stale_invitation_reservations vs. resolve_invitation_delivery..."
psql_exec "
begin;
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', 'conc_land_owner',
  'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
set local role authenticated;
select marketplace.reserve_targeted_invitation(
  (select id from marketplace.job_postings limit 1),
  (select id from marketplace.organizations where slug = 'conc-haul-2'),
  'Stale reservation race'
);
commit;
"
psql_exec "update marketplace.targeted_invitations set created_at = now() - interval '20 minutes' where status = 'reserved';"
STALE_DEL_ID="$(psql_scalar "
select d.id from marketplace.invitation_deliveries d
join marketplace.targeted_invitations ti on ti.id = d.invitation_id
where ti.status = 'reserved' limit 1;
")"
BARRIER="$(psql_scalar "select (clock_timestamp() + interval '1200 milliseconds')::text;")"

RACE3_A="
begin;
select pg_sleep_until('${BARRIER}'::timestamptz);
select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
set local role service_role;
select marketplace.expire_stale_invitation_reservations(interval '15 minutes');
commit;
"

RACE3_B="
begin;
select pg_sleep_until('${BARRIER}'::timestamptz);
select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
set local role service_role;
select marketplace.resolve_invitation_delivery('${STALE_DEL_ID}'::uuid, 'failed', null, 'late_webhook_failure');
commit;
"

run_parallel_psql "$RACE3_A" "$RACE3_B"
R3_SUCCESSES=0
[[ $PARALLEL_RC_A -eq 0 ]] && R3_SUCCESSES=$((R3_SUCCESSES + 1))
[[ $PARALLEL_RC_B -eq 0 ]] && R3_SUCCESSES=$((R3_SUCCESSES + 1))
COMMITTED_AFTER_R3="$(psql_scalar "select invitations_committed from marketplace.entitlement_periods limit 1;")"

if [[ $R3_SUCCESSES -ne 2 || "$COMMITTED_AFTER_R3" != "2" ]]; then
  echo "ERROR: Race 3 FAILED: expected both workers to succeed and refund at most once (3 -> 2); got successes=$R3_SUCCESSES, committed=$COMMITTED_AFTER_R3" >&2
  echo "Session A ($PARALLEL_RC_A): $PARALLEL_OUT_A" >&2
  echo "Session B ($PARALLEL_RC_B): $PARALLEL_OUT_B" >&2
  exit 1
fi
echo "  PASS: Stale reaper and late webhook serialized cleanly; refunded once (3 -> 2)."

# =============================================================================
# Race 4: Concurrent billing-cycle creation & founding promotion cycle counter
# =============================================================================
echo "[4/5] Race 4: Simultaneous open_subscription_cycle calls for same period..."
psql_exec "
insert into marketplace.promotions
  (code, program, state_code, percent_off, billing_cycles, max_redemptions, starts_at, status)
values ('founding_or_conc', 'founding_landing', 'OR', 50.00, 6, 10, now() - interval '1 day', 'active');

-- One transaction: transaction-local JWT claims (set_config(..., true)) and SET LOCAL ROLE
-- must stay in effect for both admin calls.
begin;
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', 'conc_admin',
  'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
set local role authenticated;
select marketplace.admin_set_org_verification(
  (select id from marketplace.organizations where slug = 'conc-timber'), 'verified', 'Concurrency test verification'
);
select marketplace.admin_grant_founding_promotion(
  'founding_or_conc', (select id from marketplace.organizations where slug = 'conc-timber'), 'Concurrency promo grant'
);
commit;
"

# Billing workers receive the org id from the webhook payload; service_role has no table grants,
# so the harness resolves it up front instead of sub-selecting inside the worker transaction.
CONC_ORG_ID="$(psql_scalar "select id from marketplace.organizations where slug = 'conc-timber';")"
NEXT_START="$(psql_scalar "select (now() + interval '30 days')::timestamptz::text;")"
NEXT_END="$(psql_scalar "select (now() + interval '60 days')::timestamptz::text;")"
BARRIER="$(psql_scalar "select (clock_timestamp() + interval '1200 milliseconds')::text;")"

RACE4_SQL="
begin;
select pg_sleep_until('${BARRIER}'::timestamptz);
select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
set local role service_role;
select marketplace.open_subscription_cycle(
  '${CONC_ORG_ID}'::uuid,
  'basic', 'active', '${NEXT_START}'::timestamptz, '${NEXT_END}'::timestamptz,
  'cus_conc', 'sub_conc', false, 7, false
);
commit;
"

run_parallel_psql "$RACE4_SQL" "$RACE4_SQL"
R4_SUCCESSES=0
[[ $PARALLEL_RC_A -eq 0 ]] && R4_SUCCESSES=$((R4_SUCCESSES + 1))
[[ $PARALLEL_RC_B -eq 0 ]] && R4_SUCCESSES=$((R4_SUCCESSES + 1))
CYCLES_APPLIED="$(psql_scalar "select cycles_applied from marketplace.promotion_redemptions limit 1;")"
PERIOD_COUNT="$(psql_scalar "select count(*) from marketplace.entitlement_periods where period_start = '${NEXT_START}'::timestamptz;")"

if [[ $R4_SUCCESSES -ne 2 || "$CYCLES_APPLIED" != "1" || "$PERIOD_COUNT" != "1" ]]; then
  echo "ERROR: Race 4 FAILED: expected 2 successes, 1 entitlement_periods row, and cycles_applied = 1; got successes=$R4_SUCCESSES, periods=$PERIOD_COUNT, cycles_applied=$CYCLES_APPLIED" >&2
  echo "Session A ($PARALLEL_RC_A): $PARALLEL_OUT_A" >&2
  echo "Session B ($PARALLEL_RC_B): $PARALLEL_OUT_B" >&2
  exit 1
fi
echo "  PASS: Duplicate concurrent cycle webhooks created 1 period row and incremented cycles_applied once."

echo "[5/5] Cleaning up disposable marketplace schema..."
psql_exec "drop schema if exists marketplace cascade;"
echo "ALL 4 MULTI-SESSION CONCURRENCY TESTS PASSED."

