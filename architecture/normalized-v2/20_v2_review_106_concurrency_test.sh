#!/usr/bin/env bash
# =============================================================================
# LogLoads normalized-v2 — 20 multi-session race for 18 (HF-15, issue #187)
#
# NON-ACTIVE PROTOTYPE TEST HARNESS. Disposable PostgreSQL only; same fail-closed target checks as 08/10.
# Builds its own disposable schema (01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18, each in one transaction).
#
# Race R1: the two active owners of one organization leave at the same time.
#   Session A removes its own membership and keeps its transaction open; session B starts its own removal while A
#   is still open. Before 18, B's last-owner check could not see A's uncommitted exit, both committed, and the
#   organization was left with no owner. With 18, B waits for A's lock on the organization row, then sees A's
#   committed exit and is refused (23514). The organization keeps exactly one active owner.
# The race proves ordering from the sessions' own clocks (B started after A held the lock and before A committed),
# rejects deadlocks and timeouts, checks the SQLSTATE and message, and asserts the persisted state.
# =============================================================================
set -euo pipefail

DB_URL="${LOGLOADS_DISPOSABLE_DB_URL:-}"
[[ -n "$DB_URL" ]] || { echo "ERROR: Missing LOGLOADS_DISPOSABLE_DB_URL." >&2; exit 1; }
[[ "$DB_URL" =~ ^postgres(ql)?://([^@/]+@)?(127\.0\.0\.1|localhost)(:[0-9]+)?/[A-Za-z0-9_]+$ ]] \
  || { echo "ERROR: Refusing to run: LOGLOADS_DISPOSABLE_DB_URL must be a local URL with a plain database name." >&2; exit 1; }
command -v psql >/dev/null 2>&1 || { echo "ERROR: psql is not on PATH." >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
WORKER_TIMEOUT_S="${LOGLOADS_CONCURRENCY_WORKER_TIMEOUT_S:-90}"

q() { printf '%s\n' "$1" | psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1; }
x() { printf '%s\n' "$1" | psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 >/dev/null; }

fail() {
  echo "ERROR: $*" >&2
  if [[ -n "${OUT_A+x}" ]]; then
    echo "Session A (rc=${RC_A:-?}): ${OUT_A}" >&2
    echo "Session B (rc=${RC_B:-?}): ${OUT_B}" >&2
  fi
  exit 1
}

# --- Target safety (the rules of 08 and 10) ------------------------------------
PLATFORM=""
if [[ "${LOGLOADS_DB_ENV:-}" == "supabase-local-ci" ]]; then
  PLATFORM=",'auth','storage','realtime','_realtime','vault','graphql','graphql_public','extensions','pgbouncer','supabase_functions','supabase_migrations'"
fi
[[ "$(q "select current_database();")" == "${LOGLOADS_DISPOSABLE_DB_NAME:-logloads_test}" ]] || fail "Refusing to run: unexpected database."
FOREIGN="$(q "select coalesce(string_agg(format('%I.%I', n.nspname, c.relname), ', '), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema','pg_toast','marketplace','topology','tiger','tiger_data'${PLATFORM})
  and not (n.nspname in ('public','extensions') and c.relname = 'spatial_ref_sys');")"
[[ -z "$FOREIGN" ]] || fail "Refusing to run: foreign tables present: $FOREIGN"
MARK="$(q "select coalesce(shobj_description(oid, 'pg_database'), '') from pg_database where datname = current_database();")"
if [[ "$MARK" != logloads-ci-disposable:* && "${LOGLOADS_LOCAL_DISPOSABLE_CONFIRM:-}" != "drop-marketplace-schema" ]]; then
  fail "Refusing to run: database is not stamped as a CI disposable database."
fi
if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  bash "$SCRIPT_DIR/../../tools/normalized-v2-ci/guard.sh" verify >/dev/null \
    || fail "Refusing to run: the per-run disposable guard did not verify this cluster."
fi

claims_for() {
  printf '%s' "select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', '$1',
  'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
set local role authenticated;"
}
marker() { grep -oE "^$2 [0-9.]+" <<<"$1" | head -1 | cut -d' ' -f2 || true; }
sqlstate_of() { sed -nE 's/^.*ERROR:  ([0-9A-Z]{5}): .*$/\1/p' <<<"$1" | head -1; }
expect_eq() { [[ "$2" == "$3" ]] || fail "$1: expected '$3', got '$2'"; echo "  ok: $1"; }

# --- Build the schema and a committed fixture -----------------------------------
echo "[0/2] Building the disposable schema (01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18, each atomic)..."
x "drop schema if exists marketplace cascade;"
for f in 01_schema.sql 02_access.sql 03_entitlements.sql 06_v2_contract_alignment.sql 11_v2_phase3_policy.sql \
         12_v2_billing_events.sql 16_v2_identity_membership_hardening.sql 18_v2_review_106_hardening.sql; do
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$SCRIPT_DIR/$f" >/dev/null
done
expect_eq "the ledger records 06, 11, 12, 16, 18" "$(q "select string_agg(version, ',' order by applied_at, version) from marketplace.schema_migrations;")" "06,11,12,16,18"

x "
insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true) on conflict (issuer) do nothing;
do \$\$
declare
  v_iss constant text := 'https://clerk.logloads.test';
  v_org uuid; v_b uuid; v_m uuid;
begin
  perform set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
  set local role service_role;
  perform marketplace.sync_verified_identity(v_iss, 'r20_owner_a', 'Owner A', 'a@r20.test', true);
  v_b := marketplace.sync_verified_identity(v_iss, 'r20_owner_b', 'Owner B', 'b@r20.test', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', v_iss, 'sub', 'r20_owner_a',
    'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;
  v_org := marketplace.create_organization('R20 Hauling', 'r20-hauling', 'OR', true);
  insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
  values (v_org, v_b, 'owner', false, 'invited')
  returning id into v_m;
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', v_iss, 'sub', 'r20_owner_b',
    'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
  update marketplace.organization_memberships set status = 'active' where id = v_m;
  reset role;
end
\$\$;"
ORG="$(q "select id from marketplace.organizations where slug = 'r20-hauling';")"
UA="$(q "select l.user_id from marketplace.identity_links l where l.subject = 'r20_owner_a';")"
UB="$(q "select l.user_id from marketplace.identity_links l where l.subject = 'r20_owner_b';")"
[[ -n "$ORG" && -n "$UA" && -n "$UB" ]] || fail "fixture setup incomplete"
expect_eq "fixture: the organization has two active owners" \
  "$(q "select count(*) from marketplace.organization_memberships where org_id = '${ORG}'::uuid and role = 'owner' and status = 'active';")" "2"

# =============================================================================
# R1: both owners leave at the same time
# =============================================================================
echo "[1/2] R1: the two owners of one organization leave at the same time..."
BARRIER="$(q "select (clock_timestamp() + interval '1500 milliseconds')::text;")"
BARRIER_B="$(q "select ('${BARRIER}'::timestamptz + interval '700 milliseconds')::text;")"
SQL_A="begin;
select pg_sleep_until('${BARRIER}'::timestamptz);
$(claims_for r20_owner_a)
update marketplace.organization_memberships set status = 'removed' where org_id = '${ORG}'::uuid and user_id = '${UA}'::uuid;
select 'T_UPDATED ' || extract(epoch from clock_timestamp());
select pg_sleep(2.5);
select 'T_END ' || extract(epoch from clock_timestamp());
commit;"
SQL_B="begin;
select pg_sleep_until('${BARRIER_B}'::timestamptz);
select 'T_START ' || extract(epoch from clock_timestamp());
$(claims_for r20_owner_b)
update marketplace.organization_memberships set status = 'removed' where org_id = '${ORG}'::uuid and user_id = '${UB}'::uuid;
select 'T_UPDATED ' || extract(epoch from clock_timestamp());
commit;"

set +e
(printf '%s\n' "$SQL_A" | timeout --kill-after=10s "${WORKER_TIMEOUT_S}s" \
   psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 -v VERBOSITY=verbose >"$TMP_DIR/a.log" 2>&1) &
PID_A=$!
(printf '%s\n' "$SQL_B" | timeout --kill-after=10s "${WORKER_TIMEOUT_S}s" \
   psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 -v VERBOSITY=verbose >"$TMP_DIR/b.log" 2>&1) &
PID_B=$!
wait "$PID_A"; RC_A=$?
wait "$PID_B"; RC_B=$?
set -e
OUT_A="$(cat "$TMP_DIR/a.log")"; OUT_B="$(cat "$TMP_DIR/b.log")"
for rc in "$RC_A" "$RC_B"; do
  [[ "$rc" -ne 124 && "$rc" -ne 137 ]] || fail "a worker exceeded ${WORKER_TIMEOUT_S}s (blocked lock or hang)"
done
! grep -q "40P01" <<<"$OUT_A$OUT_B" || fail "a worker hit a deadlock (SQLSTATE 40P01)"

A_UPDATED="$(marker "$OUT_A" T_UPDATED)"; A_END="$(marker "$OUT_A" T_END)"; B_START="$(marker "$OUT_B" T_START)"
[[ -n "$A_UPDATED" && -n "$A_END" && -n "$B_START" ]] || fail "R1: a worker did not report its timestamps"
awk -v au="$A_UPDATED" -v ae="$A_END" -v bs="$B_START" 'BEGIN {
  if (!(bs > au)) { print "R1: session B started before session A had removed itself"; exit 1 }
  if (!(bs < ae)) { print "R1: session B started after session A committed (no overlap)"; exit 1 }
  printf "  overlap ok: B started %.0f ms after A removed itself and %.0f ms before A committed\n", (bs - au) * 1000, (ae - bs) * 1000
}' || fail "R1: overlap not demonstrated"
expect_eq "R1: session A (the first exit) committed" "$RC_A" "0"
[[ "$RC_B" -ne 0 ]] || fail "R1: session B's exit was accepted; the organization was left without an owner"
expect_eq "R1: session B was refused with 23514" "$(sqlstate_of "$OUT_B")" "23514"
grep -q "at least one active owner" <<<"$OUT_B" || fail "R1: session B failed for an unexpected reason"
echo "  ok: R1: session B was refused by the last-owner rule"
[[ -z "$(marker "$OUT_B" T_UPDATED)" ]] || fail "R1: session B reported a completed update"

echo "[2/2] R1: asserting the persisted state..."
expect_eq "R1: exactly one active owner remains" \
  "$(q "select count(*) from marketplace.organization_memberships where org_id = '${ORG}'::uuid and role = 'owner' and status = 'active';")" "1"
expect_eq "R1: ... and it is owner B" \
  "$(q "select user_id from marketplace.organization_memberships where org_id = '${ORG}'::uuid and role = 'owner' and status = 'active';")" "$UB"
expect_eq "R1: owner A's exit is recorded" \
  "$(q "select status || ' ' || (ended_at is not null)::text from marketplace.organization_memberships where org_id = '${ORG}'::uuid and user_id = '${UA}'::uuid;")" "removed true"

x "drop schema if exists marketplace cascade;"
echo "ALL REVIEW-106 CONCURRENCY TESTS PASSED."
