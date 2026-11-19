#!/usr/bin/env bash
# =============================================================================
# Two races on the 44 schema (#403). The schema from stage 44 is already applied. This script does not drop it.
#   R1: two landings share a phone with the same hauler at once, when one more landing fills the pause. Both replies
#       are stored; one share is kept and opens the pause, the other share is withheld. No error reaches either landing.
#   R2: a moderator clears the pause while another dismisses its report in the queue. Neither deadlocks; the pauses
#       end closed and the report is dismissed once.
# Disposable loopback PostgreSQL only.
# =============================================================================
set -euo pipefail

DB_URL="${LOGLOADS_DISPOSABLE_DB_URL:-}"
[[ -n "$DB_URL" ]] || { echo "ERROR: Missing LOGLOADS_DISPOSABLE_DB_URL." >&2; exit 1; }
[[ "$DB_URL" =~ ^postgres(ql)?://([^@/]+@)?(127\.0\.0\.1|localhost)(:[0-9]+)?/[A-Za-z0-9_]+$ ]] \
  || { echo "ERROR: Refusing to run: the database URL is not a loopback disposable target." >&2; exit 1; }

TMP="$(mktemp -d)"
WORKER_TIMEOUT_S=25
fail() { echo "ERROR: $*" >&2; exit 1; }

psql_scalar() { psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 -c "$1"; }
psql_file() { psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }

cleanup() {
  local rc=$?
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -c "
do \$\$
declare j uuid;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', 's45_own',
    'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;
  for j in select id from marketplace.job_postings where title like 'S45 %' and status = 'active' loop
    perform marketplace.set_job_posting_status(j, 'paused');
  end loop;
  reset role;
  delete from marketplace.hauler_reveal_pauses p
  using marketplace.abuse_reports r
  where p.report_id = r.id and r.reason = 'unsafe_disclosure'
    and (r.target_id in (select o.id from marketplace.organizations o where o.slug like 's45-%')
         or r.target_id in (select u.id from marketplace.app_users u where u.display_name like 'S45 %'));
  delete from marketplace.abuse_reports r
  where r.reason = 'unsafe_disclosure'
    and (r.target_id in (select o.id from marketplace.organizations o where o.slug like 's45-%')
         or r.target_id in (select u.id from marketplace.app_users u where u.display_name like 'S45 %'));
end
\$\$;" >/dev/null || { echo "ERROR: race fixture cleanup failed" >&2; rc=1; }
  rm -rf "$TMP"
  exit "$rc"
}
trap cleanup EXIT

cat > "$TMP/fixture.sql" <<'SQL'
insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true) on conflict (issuer) do nothing;

do $$
declare
  c_iss constant text := 'https://clerk.logloads.test';
  c_body constant text := 'Trucks can start Monday';
  o_land uuid; o_haul uuid; l uuid; j uuid; e uuid; i integer; u_mod1 uuid; u_mod2 uuid;
  j_ids uuid[] := array[]::uuid[]; e_ids uuid[] := array[]::uuid[];
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  perform marketplace.sync_verified_identity(c_iss, 's45_own', 'S45 Landing Owner', 'own@s45.test', true);
  perform marketplace.sync_verified_identity(c_iss, 's45_haul', 'S45 Hauler Owner', 'haul@s45.test', true);
  u_mod1 := marketplace.sync_verified_identity(c_iss, 's45_mod1', 'S45 Moderator One', 'mod1@s45.test', true);
  u_mod2 := marketplace.sync_verified_identity(c_iss, 's45_mod2', 'S45 Moderator Two', 'mod2@s45.test', true);
  reset role;
  insert into marketplace.platform_admins (user_id, admin_role, note) values
    (u_mod1, 'moderator', 'race 45'), (u_mod2, 'moderator', 'race 45')
  on conflict (user_id) do nothing;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'iss', c_iss, 'sub', 's45_own', 'aud', 'logloads-app',
    'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;
  o_land := marketplace.create_organization('S45 Landing Co', 's45-landing', 'OR', false);
  reset role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  perform marketplace.open_subscription_cycle(o_land, 'regional', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_s45', 'sub_s45', false, 7, false);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'iss', c_iss, 'sub', 's45_own', 'aud', 'logloads-app',
    'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;
  for i in 1..6 loop
    insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
    values (o_land, 'S45 Landing ' || i, 'active', 'Near Sisters, OR', marketplace.make_public_point(-121.10 - (i * 0.01), 44.00), 'OR')
    returning id into l;
    insert into marketplace.landing_private_details (landing_id, org_id, exact_point, directions, gate_instructions, site_contact_name, site_contact_phone)
    values (
      l, o_land,
      extensions.st_setsrid(extensions.st_makepoint(-121.10 - (i * 0.01), 44.00), 4326)::extensions.geography,
      'County road', 'Locked gate', 'S45 Foreman', '+1541555045' || i::text
    );
    j := marketplace.publish_job_posting(l, 'S45 Haul ' || i, array['log_truck'], 1, 'Fir sawlogs', 'Race haul.', 'per_ton', 500, null,
      1, current_date + 10, 8, 3.0, 6, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
    j_ids := array_append(j_ids, j);
  end loop;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'iss', c_iss, 'sub', 's45_haul', 'aud', 'logloads-app',
    'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;
  o_haul := marketplace.create_organization('S45 Hauling', 's45-hauling', 'OR', true);
  for i in 1..6 loop
    select interest_id into e from marketplace.submit_expression_of_interest(o_haul, j_ids[i], 1);
    e_ids := array_append(e_ids, e);
  end loop;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'iss', c_iss, 'sub', 's45_own', 'aud', 'logloads-app',
    'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;
  for i in 1..4 loop
    perform marketplace.respond_to_interest(e_ids[i], 'replied', true, null, c_body);
  end loop;
end
$$;
SQL
psql_file "$TMP/fixture.sql"

E5="$(psql_scalar "select e.id from marketplace.expressions_of_interest e join marketplace.job_postings j on j.id = e.job_id where j.title = 'S45 Haul 5';")"
E6="$(psql_scalar "select e.id from marketplace.expressions_of_interest e join marketplace.job_postings j on j.id = e.job_id where j.title = 'S45 Haul 6';")"
[[ -n "$E5" && -n "$E6" && "$E5" != "$E6" ]] || fail "race fixture did not leave two unshared inquiries"

claims_for() {
  printf '%s' "select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', '$1',
  'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
set local role authenticated;"
}

worker_sql() {
  printf '%s\n' "begin;
select pg_sleep_until('$1'::timestamptz);
select 'T_START ' || extract(epoch from clock_timestamp());
select pg_sleep(0.3);
$2
select 'T_END ' || extract(epoch from clock_timestamp());
commit;"
}

run_parallel_psql() {
  local out_a="$TMP/out_a.log" out_b="$TMP/out_b.log" rc_a=0 rc_b=0
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
  PARALLEL_OUT_A="$(cat "$out_a")"; PARALLEL_OUT_B="$(cat "$out_b")"
  for rc in "$rc_a" "$rc_b"; do
    [[ "$rc" -ne 124 && "$rc" -ne 137 ]] || fail "a worker exceeded ${WORKER_TIMEOUT_S}s (blocked lock or hang)"
  done
  ! grep -q "40P01" <<<"$PARALLEL_OUT_A$PARALLEL_OUT_B" || fail "a worker hit a deadlock (SQLSTATE 40P01)"
}

marker() { grep -oE "^$2 [0-9.]+" <<<"$1" | head -1 | cut -d' ' -f2 || true; }
sqlstate_of() { sed -nE 's/^.*ERROR:  ([0-9A-Z]{5}): .*$/\1/p' <<<"$1" | head -1; }

assert_overlap() {
  local label="$1" sa sb ea eb
  sa="$(marker "$PARALLEL_OUT_A" T_START)"; sb="$(marker "$PARALLEL_OUT_B" T_START)"
  ea="$(marker "$PARALLEL_OUT_A" T_END)"; eb="$(marker "$PARALLEL_OUT_B" T_END)"
  [[ -n "$sa" && -n "$sb" ]] || fail "$label: a worker never passed the barrier"
  awk -v sa="$sa" -v sb="$sb" -v ea="$ea" -v eb="$eb" -v bar="$BARRIER_EPOCH" -v label="$label" 'BEGIN {
    if (sa + 0.005 < bar || sb + 0.005 < bar) { printf "%s: a worker started before the barrier\n", label; exit 1 }
    last = (sa > sb) ? sa : sb
    if (!((ea != "" && ea + 0 > last) || (eb != "" && eb + 0 > last))) { printf "%s: no overlap\n", label; exit 1 }
    printf "  overlap ok: %s\n", label
  }' || fail "$label: overlap not demonstrated"
}

new_barrier() {
  BARRIER="$(psql_scalar "select (clock_timestamp() + interval '1500 milliseconds')::text;")"
  BARRIER_EPOCH="$(psql_scalar "select extract(epoch from '${BARRIER}'::timestamptz);")"
}

# R1 ------------------------------------------------------------------------------------------------------------------
share_sql() {
  printf '%s\n' "$(claims_for s45_own)
select marketplace.respond_to_interest('$1'::uuid, 'replied', true, null, 'Trucks can start Monday');
select 'RESULT ok';"
}

new_barrier
run_parallel_psql "$(worker_sql "$BARRIER" "$(share_sql "$E5")")" "$(worker_sql "$BARRIER" "$(share_sql "$E6")")"
assert_overlap "R1: two landings sharing the threshold release"

[[ "$PARALLEL_OUT_A" == *"RESULT ok"* && "$PARALLEL_OUT_B" == *"RESULT ok"* ]] \
  || fail "R1: expected both replies to succeed, got states $(sqlstate_of "$PARALLEL_OUT_A")/$(sqlstate_of "$PARALLEL_OUT_B")"

STORED="$(psql_scalar "select count(distinct j.landing_id) from marketplace.expressions_of_interest e join marketplace.job_postings j on j.id = e.job_id join marketplace.organizations o on o.id = e.hauler_org_id where o.slug = 's45-hauling' and e.private_details_shared_at is not null;")"
REPLIED="$(psql_scalar "select count(*) from marketplace.expressions_of_interest where id in ('$E5', '$E6') and status = 'replied';")"
LEDGER="$(psql_scalar "select count(*) from marketplace.phone_reveal_events r join marketplace.organizations o on o.id = r.hauler_org_id where o.slug = 's45-hauling';")"
OPEN="$(psql_scalar "select count(*) from marketplace.hauler_reveal_pauses p join marketplace.organizations o on o.id = p.hauler_org_id where o.slug = 's45-hauling' and p.cleared_at is null;")"
[[ "$STORED" == "5" && "$REPLIED" == "2" && "$LEDGER" == "5" && "$OPEN" == "1" ]] \
  || fail "R1: expected 5 shared landings, 2 replies, 5 ledger rows and 1 open business pause, got stored=$STORED replied=$REPLIED ledger=$LEDGER open=$OPEN"
echo "  ok: R1 both replies stored, one share kept and one withheld, one business pause"

# R2 ------------------------------------------------------------------------------------------------------------------
PAUSE="$(psql_scalar "select p.id from marketplace.hauler_reveal_pauses p join marketplace.organizations o on o.id = p.hauler_org_id where o.slug = 's45-hauling' and p.cleared_at is null;")"
REPORT="$(psql_scalar "select report_id from marketplace.hauler_reveal_pauses where id = '$PAUSE';")"
[[ -n "$PAUSE" && -n "$REPORT" ]] || fail "R2: no open pause to race on"

clear_sql() {
  printf '%s\n' "$(claims_for s45_mod1)
select marketplace.admin_clear_reveal_pause('$PAUSE'::uuid, 'Race clear by staff');
select 'RESULT ok';"
}
dismiss_sql() {
  printf '%s\n' "$(claims_for s45_mod2)
select marketplace.admin_resolve_report('$REPORT'::uuid, 'dismissed', 'Race dismissal in the queue');
select 'RESULT ok';"
}

new_barrier
run_parallel_psql "$(worker_sql "$BARRIER" "$(clear_sql)")" "$(worker_sql "$BARRIER" "$(dismiss_sql)")"
assert_overlap "R2: a staff clear and a queue dismissal of the same pause"

STATE_A="$(sqlstate_of "$PARALLEL_OUT_A")"
[[ "$PARALLEL_OUT_B" == *"RESULT ok"* ]] || fail "R2: the queue dismissal failed with $(sqlstate_of "$PARALLEL_OUT_B")"
[[ "$PARALLEL_OUT_A" == *"RESULT ok"* || "$STATE_A" == "P0002" ]] \
  || fail "R2: the clear failed with $STATE_A (only success, or 'not found' after the queue closed it, is allowed)"

STILL_OPEN="$(psql_scalar "select count(*) from marketplace.hauler_reveal_pauses where report_id = '$REPORT' and cleared_at is null;")"
STATUS="$(psql_scalar "select status from marketplace.abuse_reports where id = '$REPORT';")"
DISMISSALS="$(psql_scalar "select count(*) from marketplace.audit_events where action = 'abuse_report.dismissed' and entity_id = '$REPORT';")"
[[ "$STILL_OPEN" == "0" && "$STATUS" == "dismissed" && "$DISMISSALS" == "1" ]] \
  || fail "R2: expected every pause closed and the report dismissed once, got open=$STILL_OPEN status=$STATUS dismissals=$DISMISSALS"
echo "  ok: R2 no deadlock; the pauses are closed and the report is dismissed once"

echo "ALL REVEAL LEDGER RACES PASSED"
