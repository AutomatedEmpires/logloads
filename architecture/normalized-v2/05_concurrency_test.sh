#!/usr/bin/env bash
# =============================================================================
# LogLoads normalized-v2 — 05 genuine multi-session concurrency test suite (Linux/CI)
#
# NON-ACTIVE PROTOTYPE TEST HARNESS. Do not run against production.
# Requires a disposable local PostgreSQL 15+ / 17 instance (with PostGIS + btree_gist)
# and `psql` on PATH. Fails closed unless the target is a local, disposable database
# (see "Target safety" below) — a localhost URL alone is not accepted as proof.
#
# Usage (Ubuntu / GitHub Actions CI):
#   export LOGLOADS_DISPOSABLE_DB_URL="postgresql://postgres:postgres@127.0.0.1:5432/logloads_test"
#   bash architecture/normalized-v2/05_concurrency_test.sh
# Local disposable use additionally requires LOGLOADS_LOCAL_DISPOSABLE_CONFIRM=drop-marketplace-schema.
#
# Exercises genuine two-connection races using parallel `psql` background jobs
# released simultaneously via `pg_sleep_until(barrier_ts)`:
#   Race 1: Simultaneous consumption of the final invitation credit (1 unit left)
#   Race 2: Simultaneous multi-channel / duplicate delivery failure callbacks
#   Race 3: Stale reservation reaper vs. concurrent delivery callback
#   Race 4: Simultaneous billing-cycle webhook calls for the same period & promo
#   Race 5 (supplementary): Simultaneous mid-cycle plan change that truncates the open period
#
# Every race proves the two transactions overlapped (each worker reports when it passed the
# barrier and when it reached COMMIT), checks expected SQLSTATEs, rejects deadlocks and
# timeouts, and asserts the final persisted state.
# =============================================================================

set -euo pipefail

DB_URL="${LOGLOADS_DISPOSABLE_DB_URL:-}"
if [[ -z "$DB_URL" ]]; then
  echo "ERROR: Missing LOGLOADS_DISPOSABLE_DB_URL. Set it to a disposable local PostgreSQL URL (127.0.0.1 or localhost)." >&2
  exit 1
fi

if [[ ! "$DB_URL" =~ ^postgres(ql)?://([^@/]+@)?(127\.0\.0\.1|localhost)(:[0-9]+)?/[A-Za-z0-9_]+$ ]]; then
  echo "ERROR: Refusing to run: LOGLOADS_DISPOSABLE_DB_URL must point to 127.0.0.1 or localhost with a plain database name and no query parameters." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: Missing prerequisite: psql is not installed or not on PATH." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
WORKER_TIMEOUT_S="${LOGLOADS_CONCURRENCY_WORKER_TIMEOUT_S:-90}"

psql_scalar() {
  local sql="$1"
  printf '%s\n' "$sql" | psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1
}

psql_exec() {
  local sql="$1"
  printf '%s\n' "$sql" | psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 >/dev/null
}

fail() {
  echo "ERROR: $*" >&2
  if [[ -n "${PARALLEL_OUT_A+x}" ]]; then
    echo "Session A (rc=${PARALLEL_RC_A:-?}): ${PARALLEL_OUT_A}" >&2
    echo "Session B (rc=${PARALLEL_RC_B:-?}): ${PARALLEL_OUT_B}" >&2
  fi
  exit 1
}

# -----------------------------------------------------------------------------
# Target safety: everything below drops and recreates the `marketplace` schema.
# -----------------------------------------------------------------------------
TARGET_DB="$(psql_scalar "select current_database();")"
[[ "$TARGET_DB" == "${LOGLOADS_DISPOSABLE_DB_NAME:-logloads_test}" ]] \
  || { echo "ERROR: Refusing to run: connected database '$TARGET_DB' is not the expected disposable database." >&2; exit 1; }
FOREIGN_TABLES="$(psql_scalar "
select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p')
  and n.nspname not in ('pg_catalog','information_schema','pg_toast','marketplace','topology','tiger','tiger_data')
  and not (n.nspname = 'public' and c.relname = 'spatial_ref_sys');")"
[[ "$FOREIGN_TABLES" == "0" ]] \
  || { echo "ERROR: Refusing to run: database contains $FOREIGN_TABLES table(s) outside the disposable marketplace schema." >&2; exit 1; }
DB_MARKER="$(psql_scalar "select coalesce(shobj_description(oid, 'pg_database'), '') from pg_database where datname = current_database();")"
if [[ "$DB_MARKER" != logloads-ci-disposable:* && "${LOGLOADS_LOCAL_DISPOSABLE_CONFIRM:-}" != "drop-marketplace-schema" ]]; then
  echo "ERROR: Refusing to run: database is not stamped as a CI disposable database. For a local disposable database set LOGLOADS_LOCAL_DISPOSABLE_CONFIRM=drop-marketplace-schema." >&2
  exit 1
fi

# -----------------------------------------------------------------------------
# Parallel workers and evidence helpers
# -----------------------------------------------------------------------------
# Each worker SQL must print `T_START <epoch>` right after the barrier and `T_END <epoch>`
# right before COMMIT (see worker_sql). VERBOSITY=verbose makes errors carry SQLSTATE codes.
run_parallel_psql() {
  local sql_a="$1"
  local sql_b="$2"
  local out_a="$TMP_DIR/out_a.log"
  local out_b="$TMP_DIR/out_b.log"
  local rc_a=0
  local rc_b=0

  set +e
  (printf '%s\n' "$sql_a" | timeout --kill-after=10s "${WORKER_TIMEOUT_S}s" \
     psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 -v VERBOSITY=verbose >"$out_a" 2>&1) &
  local pid_a=$!
  (printf '%s\n' "$sql_b" | timeout --kill-after=10s "${WORKER_TIMEOUT_S}s" \
     psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 -v VERBOSITY=verbose >"$out_b" 2>&1) &
  local pid_b=$!

  wait "$pid_a"; rc_a=$?
  wait "$pid_b"; rc_b=$?
  set -e

  PARALLEL_RC_A=$rc_a
  PARALLEL_RC_B=$rc_b
  PARALLEL_OUT_A="$(cat "$out_a")"
  PARALLEL_OUT_B="$(cat "$out_b")"

  for rc in "$rc_a" "$rc_b"; do
    if [[ "$rc" -eq 124 || "$rc" -eq 137 ]]; then
      fail "a worker exceeded ${WORKER_TIMEOUT_S}s (blocked lock or hang)"
    fi
  done
  if grep -q "40P01" <<<"$PARALLEL_OUT_A$PARALLEL_OUT_B"; then
    fail "a worker hit a deadlock (SQLSTATE 40P01)"
  fi
}

# worker_sql <barrier> <body> -> one worker transaction with timing markers.
worker_sql() {
  local barrier="$1"
  local body="$2"
  printf '%s\n' "begin;
select pg_sleep_until('${barrier}'::timestamptz);
select 'T_START ' || extract(epoch from clock_timestamp());
${body}
select 'T_END ' || extract(epoch from clock_timestamp());
commit;"
}

new_barrier() {
  BARRIER="$(psql_scalar "select (clock_timestamp() + interval '1500 milliseconds')::text;")"
  BARRIER_EPOCH="$(psql_scalar "select extract(epoch from '${BARRIER}'::timestamptz);")"
}

marker() { grep -oE "^$2 [0-9.]+" <<<"$1" | head -1 | cut -d' ' -f2 || true; }
sqlstate_of() { grep -oE "ERROR:  [0-9A-Z]{5}:" <<<"$1" | head -1 | grep -oE "[0-9A-Z]{5}" || true; }

# Both workers passed the barrier, and at least one transaction was still open (had not reached
# COMMIT) when the later worker started: the two transactions genuinely overlapped in time.
assert_overlap() {
  local label="$1"
  local sa sb ea eb
  sa="$(marker "$PARALLEL_OUT_A" T_START)"
  sb="$(marker "$PARALLEL_OUT_B" T_START)"
  ea="$(marker "$PARALLEL_OUT_A" T_END)"
  eb="$(marker "$PARALLEL_OUT_B" T_END)"
  [[ -n "$sa" && -n "$sb" ]] || fail "$label: a worker never passed the barrier"
  awk -v sa="$sa" -v sb="$sb" -v ea="$ea" -v eb="$eb" -v bar="$BARRIER_EPOCH" -v label="$label" 'BEGIN {
    if (sa + 0.005 < bar || sb + 0.005 < bar) { printf "%s: a worker started before the barrier\n", label; exit 1 }
    last = (sa > sb) ? sa : sb
    skew = sa - sb; if (skew < 0) skew = -skew
    open_a = (ea != "" && ea + 0 > last); open_b = (eb != "" && eb + 0 > last)
    if (!open_a && !open_b) { printf "%s: no overlap - the later worker started after every transaction reached COMMIT\n", label; exit 1 }
    printf "  overlap ok: %s start skew %.2f ms; a transaction was still open when the later worker started\n", label, skew * 1000
  }' || fail "$label: overlap not demonstrated"
}

expect_eq() { [[ "$2" == "$3" ]] || fail "$1: expected '$3', got '$2'"; }

echo "[0/6] Resetting disposable marketplace schema and loading 01..03..."
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

CONC_ORG_ID="$(psql_scalar "select id from marketplace.organizations where slug = 'conc-timber';")"
JOB_ID="$(psql_scalar "select id from marketplace.job_postings limit 1;")"
REFUND_ACTIONS="'invitation.failed_refunded', 'invitation.reservation_expired'"

# =============================================================================
# Race 1: Simultaneous consumption of the final invitation credit (1 unit left)
# =============================================================================
echo "[1/6] Race 1: Two sessions racing for the final (3rd of 3) invitation credit..."
psql_exec "update marketplace.entitlement_periods set invitations_committed = 2;"
new_barrier

claims_for() { # JWT claims for an authenticated test user
  printf '%s' "select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', '$1',
  'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
set local role authenticated;"
}

RACE1_A="$(worker_sql "$BARRIER" "$(claims_for conc_land_owner)
select marketplace.reserve_targeted_invitation('${JOB_ID}'::uuid,
  (select id from marketplace.organizations where slug = 'conc-haul-1'), 'Session A final credit');")"
RACE1_B="$(worker_sql "$BARRIER" "$(claims_for conc_land_mgr)
select marketplace.reserve_targeted_invitation('${JOB_ID}'::uuid,
  (select id from marketplace.organizations where slug = 'conc-haul-2'), 'Session B final credit');")"

run_parallel_psql "$RACE1_A" "$RACE1_B"
R1_SUCCESSES=0
R1_FAILURES=0
[[ $PARALLEL_RC_A -eq 0 ]] && R1_SUCCESSES=$((R1_SUCCESSES + 1)) || R1_FAILURES=$((R1_FAILURES + 1))
[[ $PARALLEL_RC_B -eq 0 ]] && R1_SUCCESSES=$((R1_SUCCESSES + 1)) || R1_FAILURES=$((R1_FAILURES + 1))
COMMITTED_AFTER_R1="$(psql_scalar "select invitations_committed from marketplace.entitlement_periods limit 1;")"
if [[ $R1_SUCCESSES -ne 1 || $R1_FAILURES -ne 1 || "$COMMITTED_AFTER_R1" != "3" ]]; then
  fail "Race 1: expected 1 success, 1 failure, and invitations_committed = 3; got successes=$R1_SUCCESSES, failures=$R1_FAILURES, committed=$COMMITTED_AFTER_R1"
fi
if [[ $PARALLEL_RC_A -ne 0 ]]; then R1_LOSER_OUT="$PARALLEL_OUT_A"; else R1_LOSER_OUT="$PARALLEL_OUT_B"; fi
expect_eq "Race 1 losing session SQLSTATE (allowance exhausted = check_violation)" "$(sqlstate_of "$R1_LOSER_OUT")" "23514"
expect_eq "Race 1 persisted invitations" "$(psql_scalar "select count(*) from marketplace.targeted_invitations;")" "1"
expect_eq "Race 1 reserved invitations" "$(psql_scalar "select count(*) from marketplace.targeted_invitations where status = 'reserved';")" "1"
assert_overlap "Race 1"
echo "  PASS: Exactly 1 session claimed the final credit (loser 23514); 1 invitation persisted; invitations_committed = 3."

# =============================================================================
# Race 2: Simultaneous multi-channel failure callbacks on the same invitation
# =============================================================================
echo "[2/6] Race 2: Two worker sessions resolving multi-channel failures simultaneously..."
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
[[ -n "$DEL_1" && -n "$DEL_2" && "$DEL_1" != "$DEL_2" ]] || fail "Race 2 setup: expected two distinct delivery channels"
new_barrier

SERVICE_ROLE="select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
set local role service_role;"
RACE2_A="$(worker_sql "$BARRIER" "${SERVICE_ROLE}
select marketplace.resolve_invitation_delivery('${DEL_1}'::uuid, 'failed', null, 'channel_1_failed');")"
RACE2_B="$(worker_sql "$BARRIER" "${SERVICE_ROLE}
select marketplace.resolve_invitation_delivery('${DEL_2}'::uuid, 'bounced', null, 'channel_2_bounced');")"

run_parallel_psql "$RACE2_A" "$RACE2_B"
R2_SUCCESSES=0
[[ $PARALLEL_RC_A -eq 0 ]] && R2_SUCCESSES=$((R2_SUCCESSES + 1))
[[ $PARALLEL_RC_B -eq 0 ]] && R2_SUCCESSES=$((R2_SUCCESSES + 1))
COMMITTED_AFTER_R2="$(psql_scalar "select invitations_committed from marketplace.entitlement_periods limit 1;")"
if [[ $R2_SUCCESSES -ne 2 || "$COMMITTED_AFTER_R2" != "2" ]]; then
  fail "Race 2: expected both callbacks to succeed without deadlock and refund 1 credit (3 -> 2); got successes=$R2_SUCCESSES, committed=$COMMITTED_AFTER_R2"
fi
expect_eq "Race 2 invitation status" "$(psql_scalar "select status from marketplace.targeted_invitations where id = '${INV_ID}'::uuid;")" "failed"
expect_eq "Race 2 deliveries resolved as failed/bounced" "$(psql_scalar "select string_agg(status, ',' order by channel) from marketplace.invitation_deliveries where invitation_id = '${INV_ID}'::uuid;")" "failed,bounced"
expect_eq "Race 2 refund audit events for the invitation" "$(psql_scalar "select count(*) from marketplace.audit_events where entity_id = '${INV_ID}'::uuid and action in (${REFUND_ACTIONS});")" "1"
assert_overlap "Race 2"
echo "  PASS: Zero deadlocks; invitation failed; exactly 1 refund event; invitations_committed 3 -> 2."

# =============================================================================
# Race 3: Stale reservation reaper vs. concurrent delivery failure callback
# =============================================================================
echo "[3/6] Race 3: expire_stale_invitation_reservations vs. resolve_invitation_delivery..."
psql_exec "
begin;
$(claims_for conc_land_owner)
select marketplace.reserve_targeted_invitation('${JOB_ID}'::uuid,
  (select id from marketplace.organizations where slug = 'conc-haul-2'), 'Stale reservation race');
commit;
"
COMMITTED_BEFORE_R3="$(psql_scalar "select invitations_committed from marketplace.entitlement_periods limit 1;")"
expect_eq "Race 3 setup: committed after the new reservation" "$COMMITTED_BEFORE_R3" "3"
psql_exec "update marketplace.targeted_invitations set created_at = now() - interval '20 minutes' where status = 'reserved';"
STALE_INV_ID="$(psql_scalar "select id from marketplace.targeted_invitations where status = 'reserved' limit 1;")"
STALE_DEL_ID="$(psql_scalar "select id from marketplace.invitation_deliveries where invitation_id = '${STALE_INV_ID}'::uuid order by channel limit 1;")"
[[ -n "$STALE_INV_ID" && -n "$STALE_DEL_ID" ]] || fail "Race 3 setup: stale reservation not found"
new_barrier

RACE3_A="$(worker_sql "$BARRIER" "${SERVICE_ROLE}
select marketplace.expire_stale_invitation_reservations(interval '15 minutes');")"
RACE3_B="$(worker_sql "$BARRIER" "${SERVICE_ROLE}
select marketplace.resolve_invitation_delivery('${STALE_DEL_ID}'::uuid, 'failed', null, 'late_webhook_failure');")"

run_parallel_psql "$RACE3_A" "$RACE3_B"
R3_SUCCESSES=0
[[ $PARALLEL_RC_A -eq 0 ]] && R3_SUCCESSES=$((R3_SUCCESSES + 1))
[[ $PARALLEL_RC_B -eq 0 ]] && R3_SUCCESSES=$((R3_SUCCESSES + 1))
COMMITTED_AFTER_R3="$(psql_scalar "select invitations_committed from marketplace.entitlement_periods limit 1;")"
if [[ $R3_SUCCESSES -ne 2 || "$COMMITTED_AFTER_R3" != "2" ]]; then
  fail "Race 3: expected both workers to succeed and refund exactly once (3 -> 2); got successes=$R3_SUCCESSES, committed=$COMMITTED_AFTER_R3"
fi
expect_eq "Race 3 invitation status" "$(psql_scalar "select status from marketplace.targeted_invitations where id = '${STALE_INV_ID}'::uuid;")" "failed"
expect_eq "Race 3 refund audit events for the invitation" "$(psql_scalar "select count(*) from marketplace.audit_events where entity_id = '${STALE_INV_ID}'::uuid and action in (${REFUND_ACTIONS});")" "1"
expect_eq "Race 3 deliveries left pending/sent" "$(psql_scalar "select count(*) from marketplace.invitation_deliveries where invitation_id = '${STALE_INV_ID}'::uuid and status in ('pending', 'sent');")" "0"
R3_PATH="$(psql_scalar "select action from marketplace.audit_events where entity_id = '${STALE_INV_ID}'::uuid and action in (${REFUND_ACTIONS});")"
assert_overlap "Race 3"
echo "  PASS: Reaper and late webhook serialized; invitation failed; exactly 1 refund (via ${R3_PATH}); 3 -> 2."

# =============================================================================
# Race 4: Concurrent billing-cycle creation & founding promotion cycle counter
# =============================================================================
echo "[4/6] Race 4: Simultaneous open_subscription_cycle calls for same period..."
psql_exec "
insert into marketplace.promotions
  (code, program, state_code, percent_off, billing_cycles, max_redemptions, starts_at, status)
values ('founding_or_conc', 'founding_landing', 'OR', 50.00, 6, 10, now() - interval '1 day', 'active');

-- One transaction: transaction-local JWT claims (set_config(..., true)) and SET LOCAL ROLE
-- must stay in effect for both admin calls.
begin;
$(claims_for conc_admin)
select marketplace.admin_set_org_verification('${CONC_ORG_ID}'::uuid, 'verified', 'Concurrency test verification');
select marketplace.admin_grant_founding_promotion('founding_or_conc', '${CONC_ORG_ID}'::uuid, 'Concurrency promo grant');
commit;
"

# Billing workers receive the org id from the webhook payload; service_role has no table grants,
# so the harness resolves ids up front instead of sub-selecting inside the worker transaction.
NEXT_START="$(psql_scalar "select (now() + interval '30 days')::timestamptz::text;")"
NEXT_END="$(psql_scalar "select (now() + interval '60 days')::timestamptz::text;")"
new_barrier

RACE4_SQL="$(worker_sql "$BARRIER" "${SERVICE_ROLE}
select marketplace.open_subscription_cycle('${CONC_ORG_ID}'::uuid,
  'basic', 'active', '${NEXT_START}'::timestamptz, '${NEXT_END}'::timestamptz,
  'cus_conc', 'sub_conc', false, 7, false);")"

run_parallel_psql "$RACE4_SQL" "$RACE4_SQL"
R4_SUCCESSES=0
[[ $PARALLEL_RC_A -eq 0 ]] && R4_SUCCESSES=$((R4_SUCCESSES + 1))
[[ $PARALLEL_RC_B -eq 0 ]] && R4_SUCCESSES=$((R4_SUCCESSES + 1))
CYCLES_APPLIED="$(psql_scalar "select cycles_applied from marketplace.promotion_redemptions where org_id = '${CONC_ORG_ID}'::uuid;")"
PERIOD_COUNT="$(psql_scalar "select count(*) from marketplace.entitlement_periods where period_start = '${NEXT_START}'::timestamptz;")"
if [[ $R4_SUCCESSES -ne 2 || "$CYCLES_APPLIED" != "1" || "$PERIOD_COUNT" != "1" ]]; then
  fail "Race 4: expected 2 successes, 1 entitlement_periods row, and cycles_applied = 1; got successes=$R4_SUCCESSES, periods=$PERIOD_COUNT, cycles_applied=$CYCLES_APPLIED"
fi
expect_eq "Race 4 promotion redemptions for the org" "$(psql_scalar "select count(*) from marketplace.promotion_redemptions where org_id = '${CONC_ORG_ID}'::uuid;")" "1"
expect_eq "Race 4 subscriptions for the org" "$(psql_scalar "select count(*) from marketplace.organization_subscriptions where org_id = '${CONC_ORG_ID}'::uuid;")" "1"
expect_eq "Race 4 overlapping entitlement periods" "$(psql_scalar "
select count(*) from marketplace.entitlement_periods a join marketplace.entitlement_periods b
  on a.org_id = b.org_id and a.id < b.id
 and tstzrange(a.period_start, a.period_end, '[)') && tstzrange(b.period_start, b.period_end, '[)')
where a.org_id = '${CONC_ORG_ID}'::uuid;")" "0"
assert_overlap "Race 4"
echo "  PASS: Duplicate concurrent cycle webhooks created 1 period row, 1 redemption, cycles_applied = 1, no overlaps."

# =============================================================================
# Race 5 (supplementary): concurrent mid-cycle plan change truncating the open period
# =============================================================================
echo "[5/6] Race 5: Simultaneous mid-cycle plan change (basic -> pro) inside the open period..."
CUR_PERIOD_ID="$(psql_scalar "select id from marketplace.entitlement_periods where org_id = '${CONC_ORG_ID}'::uuid and now() >= period_start and now() < period_end;")"
[[ -n "$CUR_PERIOD_ID" ]] || fail "Race 5 setup: no open entitlement period"
MID_START="$(psql_scalar "select (now() + interval '10 days')::timestamptz::text;")"
CYCLES_BEFORE_R5="$CYCLES_APPLIED"
new_barrier

RACE5_SQL="$(worker_sql "$BARRIER" "${SERVICE_ROLE}
select marketplace.open_subscription_cycle('${CONC_ORG_ID}'::uuid,
  'pro', 'active', '${MID_START}'::timestamptz, '${NEXT_START}'::timestamptz,
  'cus_conc', 'sub_conc', false, 7, false);")"

run_parallel_psql "$RACE5_SQL" "$RACE5_SQL"
[[ $PARALLEL_RC_A -eq 0 && $PARALLEL_RC_B -eq 0 ]] || fail "Race 5: expected both mid-cycle calls to succeed"
expect_eq "Race 5 periods starting at the change" "$(psql_scalar "select count(*) from marketplace.entitlement_periods where org_id = '${CONC_ORG_ID}'::uuid and period_start = '${MID_START}'::timestamptz;")" "1"
expect_eq "Race 5 previous period truncated to the change" "$(psql_scalar "select period_end = '${MID_START}'::timestamptz from marketplace.entitlement_periods where id = '${CUR_PERIOD_ID}'::uuid;")" "t"
expect_eq "Race 5 overlapping entitlement periods" "$(psql_scalar "
select count(*) from marketplace.entitlement_periods a join marketplace.entitlement_periods b
  on a.org_id = b.org_id and a.id < b.id
 and tstzrange(a.period_start, a.period_end, '[)') && tstzrange(b.period_start, b.period_end, '[)')
where a.org_id = '${CONC_ORG_ID}'::uuid;")" "0"
expect_eq "Race 5 invalid periods (end <= start)" "$(psql_scalar "select count(*) from marketplace.entitlement_periods where org_id = '${CONC_ORG_ID}'::uuid and period_end <= period_start;")" "0"
CYCLES_AFTER_R5="$(psql_scalar "select cycles_applied from marketplace.promotion_redemptions where org_id = '${CONC_ORG_ID}'::uuid;")"
(( CYCLES_AFTER_R5 - CYCLES_BEFORE_R5 >= 0 && CYCLES_AFTER_R5 - CYCLES_BEFORE_R5 <= 1 )) \
  || fail "Race 5: duplicate mid-cycle calls advanced the founding promotion by $((CYCLES_AFTER_R5 - CYCLES_BEFORE_R5)) cycles"
assert_overlap "Race 5"
echo "  PASS: One mid-cycle period; previous period truncated exactly at the change; no overlaps; promotion cycles ${CYCLES_BEFORE_R5} -> ${CYCLES_AFTER_R5} (advanced at most once)."

echo "[6/6] Cleaning up disposable marketplace schema..."
psql_exec "drop schema if exists marketplace cascade;"
echo "ALL 4 MULTI-SESSION CONCURRENCY TESTS PASSED (plus supplementary Race 5)."
