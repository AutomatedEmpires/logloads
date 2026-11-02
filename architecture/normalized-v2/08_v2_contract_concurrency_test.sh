#!/usr/bin/env bash
# =============================================================================
# LogLoads normalized-v2 — 08 aligned-schema multi-session concurrency suite (Linux/CI)
#
# NON-ACTIVE PROTOTYPE TEST HARNESS. Do not run against production.
# Builds its own disposable aligned schema (01 -> 02 -> 03 -> 06 -> 11 -> 12) so the objects under test are
# the aligned ones (05 tests the baseline only). Same target safety as 05: a localhost
# URL alone is not proof; the database must be the expected disposable one, hold no foreign tables,
# and carry the CI marker (or LOGLOADS_LOCAL_DISPOSABLE_CONFIRM=drop-marketplace-schema locally).
#
# Races (two independent psql sessions released together by pg_sleep_until):
#   A1  identical concurrent publish_job_posting calls       -> one job, one attestation, same id
#   A2  identical concurrent first submit_expression_of_interest -> one inquiry, created once
#   A3  concurrent reconfirm_job_posting calls                -> both counted, confirmation advances,
#                                                               last_modified_at untouched
#   A4  the same landing reply (same reply id) sent twice      -> exactly one message
#   A5  the same draft published twice concurrently            -> one success, clean P0002 loser,
#                                                               one attestation, draft fully promoted
#   A8  the same paused job re-activated twice concurrently     -> one attested re-activation, clean
#                                                               23514 loser, confirmation_seq + 1 (F3)
#   A6  the same provider webhook delivered twice concurrently  -> applied once, duplicate once, one
#                                                               ledger row with delivery_count 2 (R4)
#   A7  renewals for periods N+1 and N+2 delivered concurrently -> final state is N+2 whatever the order;
#                                                               each applied renewal opened one period (R4)
# Every race proves overlap (T_START after the barrier, T_END before COMMIT), rejects deadlocks and
# timeouts, checks SQLSTATEs and asserts the persisted state.
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

psql_scalar() { printf '%s\n' "$1" | psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1; }
psql_exec() { printf '%s\n' "$1" | psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 >/dev/null; }

fail() {
  echo "ERROR: $*" >&2
  if [[ -n "${PARALLEL_OUT_A+x}" ]]; then
    echo "Session A (rc=${PARALLEL_RC_A:-?}): ${PARALLEL_OUT_A}" >&2
    echo "Session B (rc=${PARALLEL_RC_B:-?}): ${PARALLEL_OUT_B}" >&2
  fi
  exit 1
}

# --- Target safety (identical rules to 05) -----------------------------------
# On the Supabase CLI local stack (guarded and stamped by tools/normalized-v2-ci/guard.sh) the platform's own
# schemas hold tables; they are not ours and are never touched.
SUPABASE_PLATFORM_SCHEMAS=""
if [[ "${LOGLOADS_DB_ENV:-}" == "supabase-local-ci" ]]; then
  SUPABASE_PLATFORM_SCHEMAS=",'auth','storage','realtime','_realtime','vault','graphql','graphql_public','extensions','pgbouncer','supabase_functions','supabase_migrations'"
fi
[[ "$(psql_scalar "select current_database();")" == "${LOGLOADS_DISPOSABLE_DB_NAME:-logloads_test}" ]] \
  || { echo "ERROR: Refusing to run: unexpected database." >&2; exit 1; }
FOREIGN_TABLES="$(psql_scalar "
select coalesce(string_agg(format('%I.%I', n.nspname, c.relname), ', '), '')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p')
  and n.nspname not in ('pg_catalog','information_schema','pg_toast','marketplace','topology','tiger','tiger_data'${SUPABASE_PLATFORM_SCHEMAS})
  and not (n.nspname in ('public', 'extensions') and c.relname = 'spatial_ref_sys');")"
[[ -z "$FOREIGN_TABLES" ]] || { echo "ERROR: Refusing to run: foreign tables present: $FOREIGN_TABLES" >&2; exit 1; }
DB_MARKER="$(psql_scalar "select coalesce(shobj_description(oid, 'pg_database'), '') from pg_database where datname = current_database();")"
if [[ "$DB_MARKER" != logloads-ci-disposable:* && "${LOGLOADS_LOCAL_DISPOSABLE_CONFIRM:-}" != "drop-marketplace-schema" ]]; then
  echo "ERROR: Refusing to run: database is not stamped as a CI disposable database." >&2
  exit 1
fi

# --- Workers and evidence ----------------------------------------------------
run_parallel_psql() {
  local out_a="$TMP_DIR/out_a.log" out_b="$TMP_DIR/out_b.log" rc_a=0 rc_b=0
  set +e
  (printf '%s\n' "$1" | timeout --kill-after=10s "${WORKER_TIMEOUT_S}s" \
     psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 -v VERBOSITY=verbose >"$out_a" 2>&1) &
  local pid_a=$!
  (printf '%s\n' "$2" | timeout --kill-after=10s "${WORKER_TIMEOUT_S}s" \
     psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 -v VERBOSITY=verbose >"$out_b" 2>&1) &
  local pid_b=$!
  wait "$pid_a"; rc_a=$?
  wait "$pid_b"; rc_b=$?
  set -e
  PARALLEL_RC_A=$rc_a; PARALLEL_RC_B=$rc_b
  PARALLEL_OUT_A="$(cat "$out_a")"; PARALLEL_OUT_B="$(cat "$out_b")"
  for rc in "$rc_a" "$rc_b"; do
    [[ "$rc" -ne 124 && "$rc" -ne 137 ]] || fail "a worker exceeded ${WORKER_TIMEOUT_S}s (blocked lock or hang)"
  done
  ! grep -q "40P01" <<<"$PARALLEL_OUT_A$PARALLEL_OUT_B" || fail "a worker hit a deadlock (SQLSTATE 40P01)"
}

worker_sql() {
  printf '%s\n' "begin;
select pg_sleep_until('$1'::timestamptz);
select 'T_START ' || extract(epoch from clock_timestamp());
$2
select 'T_END ' || extract(epoch from clock_timestamp());
commit;"
}

new_barrier() {
  BARRIER="$(psql_scalar "select (clock_timestamp() + interval '1500 milliseconds')::text;")"
  BARRIER_EPOCH="$(psql_scalar "select extract(epoch from '${BARRIER}'::timestamptz);")"
}

marker() { grep -oE "^$2 [0-9.]+" <<<"$1" | head -1 | cut -d' ' -f2 || true; }
sqlstate_of() { sed -nE 's/^.*ERROR:  ([0-9A-Z]{5}): .*$/\1/p' <<<"$1" | head -1; }
result_line() { grep -oE "^RESULT [^ ]+( [^ ]+)?" <<<"$1" | head -1 | cut -d' ' -f2- || true; }

assert_overlap() {
  local label="$1" sa sb ea eb
  sa="$(marker "$PARALLEL_OUT_A" T_START)"; sb="$(marker "$PARALLEL_OUT_B" T_START)"
  ea="$(marker "$PARALLEL_OUT_A" T_END)"; eb="$(marker "$PARALLEL_OUT_B" T_END)"
  [[ -n "$sa" && -n "$sb" ]] || fail "$label: a worker never passed the barrier"
  awk -v sa="$sa" -v sb="$sb" -v ea="$ea" -v eb="$eb" -v bar="$BARRIER_EPOCH" -v label="$label" 'BEGIN {
    if (sa + 0.005 < bar || sb + 0.005 < bar) { printf "%s: a worker started before the barrier\n", label; exit 1 }
    last = (sa > sb) ? sa : sb; skew = sa - sb; if (skew < 0) skew = -skew
    if (!((ea != "" && ea + 0 > last) || (eb != "" && eb + 0 > last))) { printf "%s: no overlap\n", label; exit 1 }
    printf "  overlap ok: %s start skew %.2f ms; a transaction was still open when the later worker started\n", label, skew * 1000
  }' || fail "$label: overlap not demonstrated"
}

expect_eq() { [[ "$2" == "$3" ]] || fail "$1: expected '$3', got '$2'"; }

claims_for() {
  printf '%s' "select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', '$1',
  'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
set local role authenticated;"
}

# --- Build the aligned schema and a committed fixture ------------------------
echo "[0/9] Building the disposable aligned schema (01 -> 02 -> 03 -> 06 -> 11 -> 12)..."
psql_exec "drop schema if exists marketplace cascade;"
for f in 01_schema.sql 02_access.sql 03_entitlements.sql 06_v2_contract_alignment.sql 11_v2_founder_decisions.sql 12_v2_billing_events.sql; do
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/$f" >/dev/null
done
[[ "$(psql_scalar "select to_regclass('marketplace.job_publication_attestations') is not null and to_regclass('marketplace.billing_provider_events') is not null;")" == "t" ]] \
  || fail "aligned schema missing: attestation or billing event ledger not created"

psql_exec "
insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true) on conflict (issuer) do nothing;
do \$\$
declare
  v_iss constant text := 'https://clerk.logloads.test';
  v_org_land uuid; v_org_haul uuid;
begin
  perform set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
  set local role service_role;
  perform marketplace.sync_verified_identity(v_iss, 'v2c_land_owner', 'Land Owner', 'land@v2c.test', true);
  perform marketplace.sync_verified_identity(v_iss, 'v2c_haul_owner', 'Haul Owner', 'haul@v2c.test', true);
  reset role;

  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', v_iss, 'sub', 'v2c_land_owner',
    'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;
  v_org_land := marketplace.create_organization('V2C Timber', 'v2c-timber', 'OR', false);

  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', v_iss, 'sub', 'v2c_haul_owner',
    'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
  v_org_haul := marketplace.create_organization('V2C Hauling', 'v2c-hauling', 'OR', true);
  insert into marketplace.equipment_units (org_id, equipment_code, unit_label, unit_count)
  values (v_org_haul, 'log_truck', 'V2C fleet', 3);

  perform set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
  set local role service_role;
  perform marketplace.open_subscription_cycle(v_org_land, 'basic', 'active', now() - interval '1 hour',
    now() + interval '29 days', 'cus_v2c', 'sub_v2c', false, 7, false);

  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', v_iss, 'sub', 'v2c_land_owner',
    'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (v_org_land, 'V2C Landing', 'active', 'Near Sweet Home, OR',
          extensions.st_GeogFromText('SRID=4326;POINT(-122.7 44.4)'), 'OR');
  reset role;
end
\$\$;
"
LAND_ORG="$(psql_scalar "select id from marketplace.organizations where slug = 'v2c-timber';")"
HAUL_ORG="$(psql_scalar "select id from marketplace.organizations where slug = 'v2c-hauling';")"
LANDING="$(psql_scalar "select id from marketplace.landings where org_id = '${LAND_ORG}'::uuid;")"
[[ -n "$LAND_ORG" && -n "$HAUL_ORG" && -n "$LANDING" ]] || fail "fixture setup incomplete"

PUBLISH_CALL="select 'RESULT ' || marketplace.publish_job_posting(
  p_landing_id => '${LANDING}'::uuid, p_title => 'Concurrent Sawlog Run', p_equipment_codes => array['log_truck'],
  p_trucks_requested => 4, p_pay_unit => 'per_ton', p_pay_amount_cents => 8500, p_attest_available => true);"

# =============================================================================
# A1: identical concurrent publications
# =============================================================================
echo "[1/9] A1: two sessions publish the identical job at the same landing..."
new_barrier
A1="$(worker_sql "$BARRIER" "$(claims_for v2c_land_owner)
${PUBLISH_CALL}")"
run_parallel_psql "$A1" "$A1"
[[ $PARALLEL_RC_A -eq 0 && $PARALLEL_RC_B -eq 0 ]] || fail "A1: both identical publish calls must succeed (idempotent)"
ID_A="$(result_line "$PARALLEL_OUT_A")"; ID_B="$(result_line "$PARALLEL_OUT_B")"
expect_eq "A1 both calls return the same job id" "$ID_A" "$ID_B"
expect_eq "A1 active jobs with that title" "$(psql_scalar "select count(*) from marketplace.job_postings where title = 'Concurrent Sawlog Run' and status = 'active';")" "1"
expect_eq "A1 attestation rows for the job" "$(psql_scalar "select count(*) from marketplace.job_publication_attestations where job_id = '${ID_A}'::uuid;")" "1"
expect_eq "A1 publish audit events" "$(psql_scalar "select count(*) from marketplace.audit_events where entity_id = '${ID_A}'::uuid and action = 'job_posting.published';")" "1"
assert_overlap "A1"
JOB_ID="$ID_A"
echo "  PASS: one active job, one attestation, one audit event; both sessions got ${JOB_ID}."

# =============================================================================
# A2: identical concurrent first inquiries
# =============================================================================
echo "[2/9] A2: two sessions submit the same first inquiry for the same hauler and job..."
new_barrier
A2="$(worker_sql "$BARRIER" "$(claims_for v2c_haul_owner)
select 'RESULT ' || s.interest_id || ' ' || s.created from marketplace.submit_expression_of_interest(
  p_hauler_org_id => '${HAUL_ORG}'::uuid, p_job_id => '${JOB_ID}'::uuid,
  p_equipment => '[{\"configurationKey\": \"log_truck\", \"count\": 2}]'::jsonb, p_message => 'Two trucks Monday') s;")"
run_parallel_psql "$A2" "$A2"
[[ $PARALLEL_RC_A -eq 0 && $PARALLEL_RC_B -eq 0 ]] \
  || fail "A2: both identical first submissions must succeed idempotently (loser SQLSTATE $(sqlstate_of "$PARALLEL_OUT_A$PARALLEL_OUT_B"))"
R_A="$(result_line "$PARALLEL_OUT_A")"; R_B="$(result_line "$PARALLEL_OUT_B")"
expect_eq "A2 both calls return the same inquiry" "${R_A%% *}" "${R_B%% *}"
expect_eq "A2 'created' reported exactly once" "$(printf '%s\n%s\n' "${R_A##* }" "${R_B##* }" | sort | tr '\n' ',')" "false,true,"
INTEREST_ID="${R_A%% *}"
expect_eq "A2 inquiries for the hauler and job" "$(psql_scalar "select count(*) from marketplace.expressions_of_interest where job_id = '${JOB_ID}'::uuid and hauler_org_id = '${HAUL_ORG}'::uuid;")" "1"
expect_eq "A2 equipment lines" "$(psql_scalar "select string_agg(configuration_key || ':' || unit_count, ',') from marketplace.expression_of_interest_equipment where interest_id = '${INTEREST_ID}'::uuid;")" "log_truck:2"
expect_eq "A2 trucks_offered equals the equipment sum" "$(psql_scalar "select trucks_offered from marketplace.expressions_of_interest where id = '${INTEREST_ID}'::uuid;")" "2"
assert_overlap "A2"
echo "  PASS: one inquiry, created once, equipment consistent (2 x log_truck)."

# =============================================================================
# A3: concurrent reconfirmations
# =============================================================================
echo "[3/9] A3: two sessions reconfirm the same job concurrently..."
BEFORE="$(psql_scalar "select confirmation_seq || ' ' || extract(epoch from reconfirmed_at) from marketplace.job_publication_attestations where job_id = '${JOB_ID}'::uuid;")"
MODIFIED_BEFORE="$(psql_scalar "select updated_at from marketplace.job_postings where id = '${JOB_ID}'::uuid;")"
new_barrier
A3="$(worker_sql "$BARRIER" "$(claims_for v2c_land_owner)
select 'RESULT ' || marketplace.reconfirm_job_posting('${JOB_ID}'::uuid);")"
run_parallel_psql "$A3" "$A3"
[[ $PARALLEL_RC_A -eq 0 && $PARALLEL_RC_B -eq 0 ]] || fail "A3: both reconfirmations must succeed"
expect_eq "A3 confirmation_seq advanced by two" "$(psql_scalar "select confirmation_seq from marketplace.job_publication_attestations where job_id = '${JOB_ID}'::uuid;")" "$(( ${BEFORE%% *} + 2 ))"
expect_eq "A3 job last_confirmed_at equals the ledger" "$(psql_scalar "select j.last_confirmed_at = a.reconfirmed_at from marketplace.job_postings j join marketplace.job_publication_attestations a on a.job_id = j.id where j.id = '${JOB_ID}'::uuid;")" "t"
expect_eq "A3 confirmation strictly advanced" "$(psql_scalar "select extract(epoch from reconfirmed_at) > ${BEFORE##* } from marketplace.job_publication_attestations where job_id = '${JOB_ID}'::uuid;")" "t"
expect_eq "A3 last_modified_at untouched" "$(psql_scalar "select updated_at = '${MODIFIED_BEFORE}'::timestamptz from marketplace.job_postings where id = '${JOB_ID}'::uuid;")" "t"
expect_eq "A3 reconfirmation audit events" "$(psql_scalar "select count(*) from marketplace.audit_events where entity_id = '${JOB_ID}'::uuid and action = 'job_posting.reconfirmed';")" "2"
assert_overlap "A3"
echo "  PASS: both reconfirmations recorded (seq +2), confirmation advanced, last_modified_at unchanged."

# =============================================================================
# A4: the same landing reply sent twice concurrently
# =============================================================================
echo "[4/9] A4: the landing sends the same reply (same reply id) from two sessions..."
REPLY_ID="$(psql_scalar "select gen_random_uuid();")"
new_barrier
A4="$(worker_sql "$BARRIER" "$(claims_for v2c_land_owner)
select marketplace.respond_to_interest('${INTEREST_ID}'::uuid, 'replied', null, '${REPLY_ID}'::uuid, 'Can you start Tuesday?');")"
run_parallel_psql "$A4" "$A4"
[[ $PARALLEL_RC_A -eq 0 && $PARALLEL_RC_B -eq 0 ]] \
  || fail "A4: a replayed reply must be idempotent (loser SQLSTATE $(sqlstate_of "$PARALLEL_OUT_A$PARALLEL_OUT_B"))"
expect_eq "A4 messages with the reply id" "$(psql_scalar "select count(*) from marketplace.interest_messages where id = '${REPLY_ID}'::uuid;")" "1"
expect_eq "A4 inquiry status" "$(psql_scalar "select status from marketplace.expressions_of_interest where id = '${INTEREST_ID}'::uuid;")" "replied"
assert_overlap "A4"
echo "  PASS: exactly one message for the reply id; inquiry 'replied'."

# =============================================================================
# A5: the same draft published twice concurrently
# =============================================================================
echo "[5/9] A5: two sessions publish the same saved draft..."
DRAFT_ID="$(psql_scalar "
begin;
$(claims_for v2c_land_owner)
select marketplace.save_job_posting_draft(p_landing_id => '${LANDING}'::uuid, p_title => 'Draft Pulp Run',
  p_equipment_codes => array['log_truck'], p_trucks_requested => 2);
commit;" | grep -E '^[0-9a-f-]{36}$' | head -1)"
[[ -n "$DRAFT_ID" ]] || fail "A5 setup: draft not saved"
expect_eq "A5 setup: draft has no confirmation" "$(psql_scalar "select status || ' ' || coalesce(last_confirmed_at::text, 'null') from marketplace.job_postings where id = '${DRAFT_ID}'::uuid;")" "draft null"
new_barrier
A5="$(worker_sql "$BARRIER" "$(claims_for v2c_land_owner)
select 'RESULT ' || marketplace.publish_job_posting(
  p_landing_id => '${LANDING}'::uuid, p_title => 'Draft Pulp Run', p_equipment_codes => array['log_truck'],
  p_trucks_requested => 2, p_pay_unit => 'per_load', p_pay_amount_cents => 42000, p_attest_available => true,
  p_draft_job_id => '${DRAFT_ID}'::uuid);")"
run_parallel_psql "$A5" "$A5"
A5_OK=0
[[ $PARALLEL_RC_A -eq 0 ]] && A5_OK=$((A5_OK + 1)); [[ $PARALLEL_RC_B -eq 0 ]] && A5_OK=$((A5_OK + 1))
expect_eq "A5 successful publications of the draft" "$A5_OK" "1"
if [[ $PARALLEL_RC_A -ne 0 ]]; then A5_LOSER="$PARALLEL_OUT_A"; else A5_LOSER="$PARALLEL_OUT_B"; fi
expect_eq "A5 losing session SQLSTATE (draft already published)" "$(sqlstate_of "$A5_LOSER")" "P0002"
expect_eq "A5 draft promoted with attestation" "$(psql_scalar "select status || ' ' || (last_confirmed_at is not null) || ' ' || (published_at is not null) from marketplace.job_postings where id = '${DRAFT_ID}'::uuid;")" "active true true"
expect_eq "A5 attestation rows for the draft" "$(psql_scalar "select count(*) from marketplace.job_publication_attestations where job_id = '${DRAFT_ID}'::uuid;")" "1"
assert_overlap "A5"
echo "  PASS: one publication of the draft (loser P0002), one attestation, draft fully promoted."

# =============================================================================
# A8: the same paused job re-activated twice concurrently (F3)
# =============================================================================
echo "[6/9] A8: two sessions re-activate the same paused job with an attestation..."
psql_exec "
begin;
$(claims_for v2c_land_owner)
select marketplace.set_job_posting_status('${JOB_ID}'::uuid, 'paused');
commit;"
SEQ_BEFORE="$(psql_scalar "select confirmation_seq from marketplace.job_publication_attestations where job_id = '${JOB_ID}'::uuid;")"
new_barrier
A8="$(worker_sql "$BARRIER" "$(claims_for v2c_land_owner)
select 'RESULT ' || marketplace.reactivate_job_posting('${JOB_ID}'::uuid, true);")"
run_parallel_psql "$A8" "$A8"
A8_OK=0
[[ $PARALLEL_RC_A -eq 0 ]] && A8_OK=$((A8_OK + 1)); [[ $PARALLEL_RC_B -eq 0 ]] && A8_OK=$((A8_OK + 1))
expect_eq "A8 successful re-activations" "$A8_OK" "1"
if [[ $PARALLEL_RC_A -ne 0 ]]; then A8_LOSER="$PARALLEL_OUT_A"; else A8_LOSER="$PARALLEL_OUT_B"; fi
expect_eq "A8 losing session SQLSTATE" "$(sqlstate_of "$A8_LOSER")" "23514"
grep -q "already active" <<<"$A8_LOSER" || fail "A8: the losing session failed for an unexpected reason"
expect_eq "A8 job status" "$(psql_scalar "select status from marketplace.job_postings where id = '${JOB_ID}'::uuid;")" "active"
expect_eq "A8 confirmation_seq advanced once" "$(psql_scalar "select confirmation_seq from marketplace.job_publication_attestations where job_id = '${JOB_ID}'::uuid;")" "$(( SEQ_BEFORE + 1 ))"
expect_eq "A8 re-activation audit events" "$(psql_scalar "select count(*) from marketplace.audit_events where entity_id = '${JOB_ID}'::uuid and action = 'job_posting.reactivated';")" "1"
assert_overlap "A8"
echo "  PASS: one attested re-activation (loser 23514 'already active'), confirmation_seq +1."

# --- Billing fixture: the landing org's live subscription (opened by the worker RPC above) ---------
SUB_REF="sub_v2c"
P1_START="$(psql_scalar "select current_period_start from marketplace.organization_subscriptions where provider_subscription_ref = '${SUB_REF}';")"
P1_END="$(psql_scalar "select current_period_end from marketplace.organization_subscriptions where provider_subscription_ref = '${SUB_REF}';")"
[[ -n "$P1_START" && -n "$P1_END" ]] || fail "billing fixture: subscription not found"
DIGEST_A="$(printf 'a%.0s' $(seq 1 64))"
event_call() { # event_call <event id> <type> <created> <status> <period start> <period end> <billing reason>
  printf '%s' "select 'RESULT ' || r.result from marketplace.apply_billing_provider_event(
  'stripe', '$1', '$2', '$3'::timestamptz, '${LAND_ORG}'::uuid, '${SUB_REF}', 'cus_v2c', 'basic', '$4',
  '$5'::timestamptz, '$6'::timestamptz, false, '$7', '${DIGEST_A}', false) r;"
}
SERVICE_CLAIMS="select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
set local role service_role;"

# =============================================================================
# A6: the same provider webhook delivered twice concurrently (R4)
# =============================================================================
echo "[7/9] A6: the same provider event is delivered by two sessions at once..."
new_barrier
A6="$(worker_sql "$BARRIER" "${SERVICE_CLAIMS}
$(event_call evt_conc_dup customer.subscription.updated "${P1_START}" active "${P1_START}" "${P1_END}" subscription_update)")"
run_parallel_psql "$A6" "$A6"
[[ $PARALLEL_RC_A -eq 0 && $PARALLEL_RC_B -eq 0 ]] || fail "A6: both deliveries must succeed (loser SQLSTATE $(sqlstate_of "$PARALLEL_OUT_A$PARALLEL_OUT_B"))"
expect_eq "A6 outcomes" "$(printf '%s\n%s\n' "$(result_line "$PARALLEL_OUT_A")" "$(result_line "$PARALLEL_OUT_B")" | sort | tr '\n' ',')" "applied,duplicate,"
expect_eq "A6 ledger rows / delivery count" "$(psql_scalar "select count(*) || '/' || max(delivery_count) from marketplace.billing_provider_events where provider_event_id = 'evt_conc_dup';")" "1/2"
expect_eq "A6 audit events for the delivery" "$(psql_scalar "select count(*) from marketplace.audit_events a join marketplace.billing_provider_events e on e.id = a.entity_id where e.provider_event_id = 'evt_conc_dup';")" "1"
assert_overlap "A6"
echo "  PASS: applied once, duplicate once; one ledger row with delivery_count 2 and one audit event."

# =============================================================================
# A7: renewals for two consecutive later periods delivered concurrently (R4)
# =============================================================================
echo "[8/9] A7: renewals for periods N+1 and N+2 arrive concurrently, in either order..."
P2_START="$P1_END"
P2_END="$(psql_scalar "select ('${P1_END}'::timestamptz + interval '30 days')::text;")"
P3_END="$(psql_scalar "select ('${P1_END}'::timestamptz + interval '60 days')::text;")"
new_barrier
A7_A="$(worker_sql "$BARRIER" "${SERVICE_CLAIMS}
$(event_call evt_conc_p2 invoice.paid "${P2_START}" active "${P2_START}" "${P2_END}" subscription_cycle)")"
A7_B="$(worker_sql "$BARRIER" "${SERVICE_CLAIMS}
$(event_call evt_conc_p3 invoice.paid "${P2_END}" active "${P2_END}" "${P3_END}" subscription_cycle)")"
run_parallel_psql "$A7_A" "$A7_B"
[[ $PARALLEL_RC_A -eq 0 && $PARALLEL_RC_B -eq 0 ]] || fail "A7: both deliveries must be processed (SQLSTATE $(sqlstate_of "$PARALLEL_OUT_A$PARALLEL_OUT_B"))"
OUT_P2="$(result_line "$PARALLEL_OUT_A")"; OUT_P3="$(result_line "$PARALLEL_OUT_B")"
expect_eq "A7 the later renewal is applied" "$OUT_P3" "applied"
[[ "$OUT_P2" == "applied" || "$OUT_P2" == "ignored_stale" ]] || fail "A7: unexpected outcome for the N+1 renewal: $OUT_P2"
expect_eq "A7 final billing period is N+2" "$(psql_scalar "select current_period_start = '${P2_END}'::timestamptz from marketplace.organization_subscriptions where provider_subscription_ref = '${SUB_REF}';")" "t"
APPLIED=1; [[ "$OUT_P2" == "applied" ]] && APPLIED=2
expect_eq "A7 entitlement periods opened by the applied renewals" "$(psql_scalar "select count(*) from marketplace.entitlement_periods where org_id = '${LAND_ORG}'::uuid and period_start in ('${P2_START}'::timestamptz, '${P2_END}'::timestamptz);")" "$APPLIED"
expect_eq "A7 overlapping entitlement periods" "$(psql_scalar "
select count(*) from marketplace.entitlement_periods a join marketplace.entitlement_periods b
  on a.org_id = b.org_id and a.id < b.id
 and tstzrange(a.period_start, a.period_end, '[)') && tstzrange(b.period_start, b.period_end, '[)')
where a.org_id = '${LAND_ORG}'::uuid;")" "0"
assert_overlap "A7"
echo "  PASS: final period N+2 (N+1 renewal ${OUT_P2}); ${APPLIED} period(s) opened, no overlaps."

echo "[9/9] Cleaning up disposable marketplace schema..."
psql_exec "drop schema if exists marketplace cascade;"
echo "ALL ALIGNED-SCHEMA CONCURRENCY TESTS PASSED."
