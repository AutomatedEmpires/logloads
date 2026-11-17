#!/usr/bin/env bash
# =============================================================================
# LogLoads normalized-v2 — 37 multi-session races for 31, 33 and 35 (the unsubscribe link, invitation answers and the
# signing-key rotation, #361)
#
# NON-ACTIVE PROTOTYPE TEST HARNESS. Disposable PostgreSQL only; same fail-closed target checks as 08/10/20/25/28.
# Builds its own disposable schema (01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23 -> 26 -> 29 -> 31 -> 33 -> 35,
# each in one transaction).
#
# Race R1: one unsubscribe token used twice at once. Session A uses the link, then the person turns the email back on,
#   and A holds its transaction open. Session B uses the same link meanwhile: its use record waits on A's, then finds
#   the token used and does nothing. A second use that got through would turn the email off again and audit it again.
#   The token works once: one use record, one audit row, and the email the person turned back on stays on.
# Race R2: two different answers to one delivered invitation at once. The hauling business's owner answers
#   "interested" and holds the invitation row (respond_to_invitation's FOR UPDATE); its driver answers "declined"
#   meanwhile, waits, then finds it answered and is refused (23514). One answer is recorded and audited, never two.
# Race R3: a key rotation while a token is being minted. The minting session holds the rotation lock (shared) until it
#   commits; the rotation waits for it, then retires that key after the token exists. The token, signed with the
#   retired key, still works (the grace window); the next token is signed with the new key.
# Each race proves ordering from the sessions' own clocks, rejects deadlocks and timeouts, and asserts persisted state.
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

# --- Target safety (the rules of 08, 10, 20, 25 and 28) -----------------------
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
service_claims() {
  printf '%s' "select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
set local role service_role;"
}
anon_claims() {
  printf '%s' "select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true);
set local role anon;"
}
marker() { grep -oE "^$2 [0-9.]+" <<<"$1" | head -1 | cut -d' ' -f2 || true; }
expect_eq() { [[ "$2" == "$3" ]] || fail "$1: expected '$3', got '$2'"; echo "  ok: $1"; }
uid_of() { q "select l.user_id from marketplace.identity_links l where l.subject = '$1';"; }
org_of() { q "select id from marketplace.organizations where slug = '$1';"; }
# The key id a token was signed with (the second field of its payload).
key_of() {
  q "select split_part(convert_from(decode(rpad(translate(split_part('$1', '.', 1), '-_', '+/'),
          (char_length(split_part('$1', '.', 1)) + 3) / 4 * 4, '='), 'base64'), 'UTF8'), '|', 2);"
}
pref_of() { # pref_of <user id> <org id> <category> <channel>
  q "select enabled from marketplace.notification_preferences where user_id = '$1'::uuid and org_id = '$2'::uuid and category = '$3' and channel = '$4';"
}

# Runs SQL_A and SQL_B as two concurrent psql sessions; sets OUT_A/OUT_B and RC_A/RC_B; rejects hangs and deadlocks.
race() {
  set +e
  (printf '%s\n' "$SQL_A" | timeout --kill-after=10s "${WORKER_TIMEOUT_S}s" \
     psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 -v VERBOSITY=verbose >"$TMP_DIR/a.log" 2>&1) &
  local pid_a=$!
  (printf '%s\n' "$SQL_B" | timeout --kill-after=10s "${WORKER_TIMEOUT_S}s" \
     psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 -v VERBOSITY=verbose >"$TMP_DIR/b.log" 2>&1) &
  local pid_b=$!
  wait "$pid_a"; RC_A=$?
  wait "$pid_b"; RC_B=$?
  set -e
  OUT_A="$(cat "$TMP_DIR/a.log")"; OUT_B="$(cat "$TMP_DIR/b.log")"
  for rc in "$RC_A" "$RC_B"; do
    [[ "$rc" -ne 124 && "$rc" -ne 137 ]] || fail "$1: a worker exceeded ${WORKER_TIMEOUT_S}s (blocked lock or hang)"
  done
  ! grep -q "40P01" <<<"$OUT_A$OUT_B" || fail "$1: a worker hit a deadlock (SQLSTATE 40P01)"
}

# B started while A still held its lock, and finished only after A committed (it waited).
overlap_waited() { # overlap_waited <label>
  local a_done a_end b_start b_done
  a_done="$(marker "$OUT_A" T_DONE)"; a_end="$(marker "$OUT_A" T_END)"
  b_start="$(marker "$OUT_B" T_START)"; b_done="$(marker "$OUT_B" T_FINISHED)"
  [[ -n "$a_done" && -n "$a_end" && -n "$b_start" && -n "$b_done" ]] || fail "$1: a worker did not report its timestamps"
  awk -v ad="$a_done" -v ae="$a_end" -v bs="$b_start" -v bd="$b_done" -v label="$1" 'BEGIN {
    if (!(bs > ad)) { print label ": session B started before session A had written"; exit 1 }
    if (!(bs < ae)) { print label ": session B started after session A committed (no overlap)"; exit 1 }
    if (!(bd >= ae)) { print label ": session B finished before session A committed (it never waited)"; exit 1 }
    printf "  overlap ok: B started %.0f ms after A wrote, %.0f ms before A committed, and waited %.0f ms\n", (bs - ad) * 1000, (ae - bs) * 1000, (bd - bs) * 1000
  }' || fail "$1: overlap not demonstrated"
}

# A session that writes, then holds its transaction open for 2.5 s. $1: the barrier, $2: the claims, $3: the write.
holder_sql() {
  printf '%s' "begin;
select pg_sleep_until('$1'::timestamptz);
$2
$3
select 'T_DONE ' || extract(epoch from clock_timestamp());
select pg_sleep(2.5);
select 'T_END ' || extract(epoch from clock_timestamp());
commit;"
}
# A session that starts later, writes, and reports when its write returned (T_FINISHED), even when it was refused.
waiter_sql() {
  printf '%s' "begin;
select pg_sleep_until('$1'::timestamptz);
select 'T_START ' || extract(epoch from clock_timestamp());
$2
do \$w\$
begin
  begin
    $3;
    raise notice 'WRITE_OK';
  exception when others then
    raise notice 'WRITE_REFUSED % %', sqlstate, sqlerrm;
  end;
end
\$w\$;
select 'T_FINISHED ' || extract(epoch from clock_timestamp());
commit;"
}
barriers() {
  BARRIER="$(q "select (clock_timestamp() + interval '1500 milliseconds')::text;")"
  BARRIER_B="$(q "select ('${BARRIER}'::timestamptz + interval '700 milliseconds')::text;")"
}
refused_with() { # refused_with <label> <sqlstate> <message regex>
  grep -qE "WRITE_REFUSED $2 .*($3)" <<<"$OUT_B" || fail "$1: session B was not refused with $2 /$3/"
  ! grep -q "WRITE_OK" <<<"$OUT_B" || fail "$1: session B's write succeeded"
  echo "  ok: $1: session B was refused with $2"
}

# --- Build the schema and a committed fixture -----------------------------------
echo "[0/3] Building the disposable schema (01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23 -> 26 -> 29 -> 31 -> 33 -> 35, each atomic)..."
x "drop schema if exists marketplace cascade;"
for f in 01_schema.sql 02_access.sql 03_entitlements.sql 06_v2_contract_alignment.sql 11_v2_phase3_policy.sql \
         12_v2_billing_events.sql 16_v2_identity_membership_hardening.sql 18_v2_review_106_hardening.sql \
         23_v2_round2_hardening.sql 26_v2_team_seats_saved_jobs_outbox.sql 29_v2_landing_scope_hardening.sql \
         31_v2_reply_gate_reconfirmation_unsubscribe.sql 33_v2_port_v3_functions.sql 35_v2_day14_direct_reads_unsubscribe_keys.sql; do
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$SCRIPT_DIR/$f" >/dev/null
done
expect_eq "the ledger records 06, 11, 12, 16, 18, 23, 26, 29, 31, 33, 35" "$(q "select string_agg(version, ',' order by applied_at, version) from marketplace.schema_migrations;")" "06,11,12,16,18,23,26,29,31,33,35"

# A Pro landing business with a landing and a job; a hauling business that can be invited (public, opted in,
# equipment, availability, an enabled channel) with an owner and a driver; the owner's email preferences are on.
x "
insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true) on conflict (issuer) do nothing;
do \$\$
declare
  v_iss constant text := 'https://clerk.logloads.test';
  u_haul uuid; u_hdrv uuid; v_land uuid; v_haul uuid; v_landing uuid; v_job uuid; v_inv uuid;
begin
  perform set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
  set local role service_role;
  perform marketplace.sync_verified_identity(v_iss, 'r37_own', 'R37 Landing Owner', 'own@r37.test', true);
  u_haul := marketplace.sync_verified_identity(v_iss, 'r37_haul', 'R37 Hauler Owner', 'haul@r37.test', true);
  u_hdrv := marketplace.sync_verified_identity(v_iss, 'r37_hdrv', 'R37 Hauler Driver', 'hdrv@r37.test', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', v_iss, 'sub', 'r37_own',
    'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;
  v_land := marketplace.create_organization('R37 Landing', 'r37-landing', 'OR', false);
  perform set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
  set local role service_role;
  perform marketplace.open_subscription_cycle(v_land, 'pro', 'active', now() - interval '1 hour', now() + interval '29 days',
    'cus_r37', 'sub_r37', false, 7, false);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', v_iss, 'sub', 'r37_own',
    'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (v_land, 'R37 Landing A', 'active', 'Near Sisters, OR', marketplace.make_public_point(-121.5, 44.3), 'OR') returning id into v_landing;
  v_job := marketplace.publish_job_posting(v_landing, 'R37 Fir Haul', array['log_truck'], 2, 'Fir', 'Harness 37 job.', 'per_ton', 500, null,
    2, current_date + 10, 8, 3.0, 6, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);

  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', v_iss, 'sub', 'r37_haul',
    'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
  v_haul := marketplace.create_organization('R37 Hauling', 'r37-hauling', 'OR', true);
  update marketplace.hauler_profiles
  set headline = 'R37 log fleet', base_area_label = 'Sisters, OR', is_public = true,
      service_center = extensions.st_geogfromtext('SRID=4326;POINT(-121.5 44.3)'), service_radius_miles = 120,
      operating_states = array['OR'], accepts_targeted_invitations = true, max_invitations_per_week = 5
  where org_id = v_haul;
  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled)
  values (u_haul, v_haul, 'targeted_invitation', 'in_app', true), (u_haul, v_haul, 'inquiry_reply', 'email', true),
         (u_haul, v_haul, 'job_alert', 'email', true);
  insert into marketplace.equipment_units (org_id, equipment_code, unit_label, unit_count) values (v_haul, 'log_truck', 'R37 Trucks', 2);
  insert into marketplace.availability_reports (org_id, equipment_code, available_count, area_center, area_label, radius_miles, available_from, available_until)
  values (v_haul, 'log_truck', 2, extensions.st_geogfromtext('SRID=4326;POINT(-121.5 44.3)'), 'Sisters', 100, current_date, current_date + 14);
  v_inv := marketplace.invite_team_member(v_haul, 'hdrv@r37.test', 'driver', false, interval '7 days');
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', v_iss, 'sub', 'r37_hdrv',
    'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
  perform marketplace.accept_team_invitation(v_inv);

  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', v_iss, 'sub', 'r37_own',
    'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
  perform marketplace.reserve_targeted_invitation(v_job, v_haul, 'Two trucks from Monday');
  reset role;
end
\$\$;"
LAND="$(org_of r37-landing)"; HAUL="$(org_of r37-hauling)"; U_HAUL="$(uid_of r37_haul)"
INV="$(q "select id from marketplace.targeted_invitations where sender_org_id = '${LAND}'::uuid and recipient_org_id = '${HAUL}'::uuid;")"
DELIVERY="$(q "select id from marketplace.invitation_deliveries where invitation_id = '${INV}'::uuid order by channel, id limit 1;")"
[[ -n "$LAND" && -n "$HAUL" && -n "$U_HAUL" && -n "$INV" && -n "$DELIVERY" ]] || fail "fixture setup incomplete"
x "
begin;
$(service_claims)
select marketplace.resolve_invitation_delivery('${DELIVERY}'::uuid, 'delivered', 'msg_r37');
commit;"
TOKEN="$(q "
begin;
$(service_claims)
select marketplace.issue_unsubscribe_token('${U_HAUL}'::uuid, '${HAUL}'::uuid, 'inquiry_reply', 'email');
commit;" | grep -E '^[A-Za-z0-9_-]+\.[0-9a-f]{64}$')"
[[ -n "$TOKEN" ]] || fail "fixture: no unsubscribe token was minted"
TOKEN_ID="$(q "select split_part(convert_from(decode(rpad(translate(split_part('${TOKEN}', '.', 1), '-_', '+/'),
                 (char_length(split_part('${TOKEN}', '.', 1)) + 3) / 4 * 4, '='), 'base64'), 'UTF8'), '|', 3);")"
expect_eq "fixture: the invitation is delivered and unanswered; the email preference is on; one key, no used token" \
  "$(q "select status || ' ' || recipient_response from marketplace.targeted_invitations where id = '${INV}'::uuid;") $(pref_of "$U_HAUL" "$HAUL" inquiry_reply email) $(q "select (select count(*) from marketplace.notification_unsubscribe_keys)::text || ' ' || (select count(*) from marketplace.notification_unsubscribe_uses)::text;")" \
  "delivered none t 1 0"

# =============================================================================
# R1: one unsubscribe token used twice at once
# =============================================================================
echo "[1/3] R1: one unsubscribe link is used twice at the same time..."
barriers
SQL_A="begin;
select pg_sleep_until('${BARRIER}'::timestamptz);
$(anon_claims)
select marketplace.unsubscribe_with_token('${TOKEN}');
$(claims_for r37_haul)
update marketplace.notification_preferences set enabled = true
where user_id = '${U_HAUL}'::uuid and org_id = '${HAUL}'::uuid and category = 'inquiry_reply' and channel = 'email';
select 'T_DONE ' || extract(epoch from clock_timestamp());
select pg_sleep(2.5);
select 'T_END ' || extract(epoch from clock_timestamp());
commit;"
SQL_B="begin;
select pg_sleep_until('${BARRIER_B}'::timestamptz);
select 'T_START ' || extract(epoch from clock_timestamp());
$(anon_claims)
select marketplace.unsubscribe_with_token('${TOKEN}');
select 'T_FINISHED ' || extract(epoch from clock_timestamp());
commit;"
race R1
expect_eq "R1: the first use committed" "$RC_A" "0"
expect_eq "R1: the second session ran to the end (the link never raises)" "$RC_B" "0"
overlap_waited R1
expect_eq "R1: the token is recorded as used once" "$(q "select count(*) from marketplace.notification_unsubscribe_uses where token_id = '${TOKEN_ID}'::uuid;")" "1"
expect_eq "R1: the unsubscribe is audited once" \
  "$(q "select count(*) from marketplace.audit_events where action = 'notification.unsubscribed' and metadata ->> 'token_id' = '${TOKEN_ID}';")" "1"
expect_eq "R1: the email the person turned back on stays on: the second use changed nothing" "$(pref_of "$U_HAUL" "$HAUL" inquiry_reply email)" "t"

# =============================================================================
# R2: two different answers to one invitation at once
# =============================================================================
echo "[2/3] R2: the hauling business's owner and driver answer one invitation differently at the same time..."
barriers
SQL_A="$(holder_sql "$BARRIER" "$(claims_for r37_haul)" "select marketplace.respond_to_invitation('${INV}'::uuid, 'interested');")"
SQL_B="$(waiter_sql "$BARRIER_B" "$(claims_for r37_hdrv)" "perform marketplace.respond_to_invitation('${INV}'::uuid, 'declined')")"
race R2
expect_eq "R2: the first answer committed" "$RC_A" "0"
expect_eq "R2: the second session ran to the end" "$RC_B" "0"
overlap_waited R2
refused_with R2 23514 "already answered"
expect_eq "R2: one answer is recorded: interested" \
  "$(q "select recipient_response || ' ' || (responded_at is not null)::text from marketplace.targeted_invitations where id = '${INV}'::uuid;")" "interested true"
expect_eq "R2: one answer is audited, and no decline" \
  "$(q "select count(*) filter (where action = 'invitation.interested')::text || ' ' || count(*) filter (where action = 'invitation.declined')::text from marketplace.audit_events where entity_id = '${INV}'::uuid;")" "1 0"

# =============================================================================
# R3: a key rotation while a token is being minted
# =============================================================================
echo "[3/3] R3: the signing key is rotated while the email worker is minting a token..."
OLD_KEY="$(q "select id from marketplace.notification_unsubscribe_keys where retired_at is null;")"
[[ -n "$OLD_KEY" ]] || fail "R3: no current key"
barriers
SQL_A="begin;
select pg_sleep_until('${BARRIER}'::timestamptz);
$(service_claims)
select 'TOKEN ' || marketplace.issue_unsubscribe_token('${U_HAUL}'::uuid, '${HAUL}'::uuid, 'job_alert', 'email');
select 'T_DONE ' || extract(epoch from clock_timestamp());
select pg_sleep(2.5);
select 'T_END ' || extract(epoch from clock_timestamp());
commit;"
SQL_B="begin;
select pg_sleep_until('${BARRIER_B}'::timestamptz);
select 'T_START ' || extract(epoch from clock_timestamp());
$(service_claims)
select 'NEW_KEY ' || marketplace.rotate_unsubscribe_key();
select 'T_FINISHED ' || extract(epoch from clock_timestamp());
commit;"
race R3
expect_eq "R3: the minting session committed" "$RC_A" "0"
expect_eq "R3: the rotation committed" "$RC_B" "0"
overlap_waited R3
MINTED="$(grep -oE '^TOKEN [A-Za-z0-9_-]+\.[0-9a-f]{64}$' <<<"$OUT_A" | cut -d' ' -f2)"
NEW_KEY="$(grep -oE '^NEW_KEY [0-9a-f-]{36}$' <<<"$OUT_B" | cut -d' ' -f2)"
[[ -n "$MINTED" && -n "$NEW_KEY" ]] || fail "R3: a session did not report its token or key"
expect_eq "R3: the token minted during the rotation is signed with the key the rotation retired" "$(key_of "$MINTED")" "$OLD_KEY"
A_END="$(marker "$OUT_A" T_END)"
RETIRED="$(q "select extract(epoch from retired_at) from marketplace.notification_unsubscribe_keys where id = '${OLD_KEY}'::uuid;")"
awk -v r="$RETIRED" -v e="$A_END" 'BEGIN { exit !(r >= e) }' || fail "R3: the key was retired (${RETIRED}) before the minting transaction finished (${A_END})"
echo "  ok: R3: the key was retired only after the minting transaction committed"
expect_eq "R3: the new key is the one current key" "$(q "select string_agg(id::text, ',') from marketplace.notification_unsubscribe_keys where retired_at is null;")" "$NEW_KEY"
x "
begin;
$(anon_claims)
select marketplace.unsubscribe_with_token('${MINTED}');
commit;"
expect_eq "R3: the token signed with the retired key still works (the grace window)" "$(pref_of "$U_HAUL" "$HAUL" job_alert email)" "f"
NEXT="$(q "
begin;
$(service_claims)
select marketplace.issue_unsubscribe_token('${U_HAUL}'::uuid, '${HAUL}'::uuid, 'inquiry_reply', 'email');
commit;" | grep -E '^[A-Za-z0-9_-]+\.[0-9a-f]{64}$')"
expect_eq "R3: the next token is signed with the new key" "$(key_of "$NEXT")" "$NEW_KEY"

echo "Cleaning up..."
x "drop schema if exists marketplace cascade;"
echo "ALL UNSUBSCRIBE, INVITATION ANSWER AND KEY ROTATION CONCURRENCY TESTS PASSED."
