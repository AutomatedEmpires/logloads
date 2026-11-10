#!/usr/bin/env bash
# =============================================================================
# LogLoads normalized-v2 — 28 multi-session races for 26 (seat invitations and the notification outbox, #237)
#
# NON-ACTIVE PROTOTYPE TEST HARNESS. Disposable PostgreSQL only; same fail-closed target checks as 08/10/20/25.
# Builds its own disposable schema (01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23 -> 26, each in one transaction).
#
# Each landing organization below is on Pro (5 seats including the owner) with 4 seats taken (two owners and two
# invited members), so one seat is left.
# Race R1: the two owners each invite a different address to the last seat at the same time. The first invitation
#   holds the organization row (FOR NO KEY UPDATE) until it commits; the second waits, then counts the first and is
#   refused (23514). One invitation, never two.
# Race R2a: an owner adds a member by user id (tg_membership_guard, which locks the organization row FOR UPDATE) while
#   the other owner invites an address to the same last seat. The invitation waits and is refused.
# Race R2b: the same two writes the other way round. The membership waits, counts the pending invitation, and is
#   refused: a pending invitation holds its seat against every path.
# Race R3a: the invitee accepts while an owner revokes the same invitation. The revoke waits for the invitation row,
#   then finds it accepted and is refused (55000). R3b: revoke first; the acceptance waits and is refused; no
#   membership is created.
# Race R4: two email workers claim at the same time. The first holds its claim open; the second skips the rows the
#   first locked (SKIP LOCKED) without waiting. Every email is claimed exactly once.
# Race R5a: an owner invites an address to a seat while a direct downgrade to Basic runs on the same organization
#   (Pro, 2 seats taken). The downgrade (apply_subscription_cycle, FOR UPDATE on the organization row) waits for the
#   invitation, then counts it and is refused: it would strand the invitation. R5b: the downgrade first; the
#   invitation waits, then finds Basic full and is refused.
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

# --- Target safety (the rules of 08, 10, 20 and 25) ---------------------------
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
marker() { grep -oE "^$2 [0-9.]+" <<<"$1" | head -1 | cut -d' ' -f2 || true; }
sqlstate_of() { sed -nE 's/^.*ERROR:  ([0-9A-Z]{5}): .*$/\1/p' <<<"$1" | head -1; }
expect_eq() { [[ "$2" == "$3" ]] || fail "$1: expected '$3', got '$2'"; echo "  ok: $1"; }
uid_of() { q "select l.user_id from marketplace.identity_links l where l.subject = '$1';"; }
org_of() { q "select id from marketplace.organizations where slug = '$1';"; }

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
echo "[0/6] Building the disposable schema (01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23 -> 26, each atomic)..."
x "drop schema if exists marketplace cascade;"
for f in 01_schema.sql 02_access.sql 03_entitlements.sql 06_v2_contract_alignment.sql 11_v2_phase3_policy.sql \
         12_v2_billing_events.sql 16_v2_identity_membership_hardening.sql 18_v2_review_106_hardening.sql \
         23_v2_round2_hardening.sql 26_v2_team_seats_saved_jobs_outbox.sql; do
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$SCRIPT_DIR/$f" >/dev/null
done
expect_eq "the ledger records 06, 11, 12, 16, 18, 23, 26" "$(q "select string_agg(version, ',' order by applied_at, version) from marketplace.schema_migrations;")" "06,11,12,16,18,23,26"

# Three Pro landing organizations (r28-r1, r28-r2a, r28-r2b), each with two active owners and two invited seated
# members (4 of 5 seats); a hauling business (r28-r3) with two open invitations; and a hauling business (r28-r4).
x "
insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true) on conflict (issuer) do nothing;
do \$\$
declare
  v_iss constant text := 'https://clerk.logloads.test';
  r record; v_org uuid; v_second uuid; v_f1 uuid; v_f2 uuid; v_m uuid; i integer;
begin
  for r in select * from (values ('r28-r1', 'r28_1a', 'r28_1b'), ('r28-r2a', 'r28_2a', 'r28_2b'),
                                 ('r28-r2b', 'r28_3a', 'r28_3b')) t(slug, first_sub, second_sub)
  loop
    perform set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
    set local role service_role;
    perform marketplace.sync_verified_identity(v_iss, r.first_sub, 'Owner ' || r.first_sub, r.first_sub || '@r28.test', true);
    v_second := marketplace.sync_verified_identity(v_iss, r.second_sub, 'Owner ' || r.second_sub, r.second_sub || '@r28.test', true);
    v_f1 := marketplace.sync_verified_identity(v_iss, r.first_sub || '_f1', 'Filler one ' || r.slug, r.first_sub || '_f1@r28.test', true);
    v_f2 := marketplace.sync_verified_identity(v_iss, r.first_sub || '_f2', 'Filler two ' || r.slug, r.first_sub || '_f2@r28.test', true);
    perform marketplace.sync_verified_identity(v_iss, r.first_sub || '_x', 'Extra ' || r.slug, r.first_sub || '_x@r28.test', true);
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', v_iss, 'sub', r.first_sub,
      'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
    set local role authenticated;
    v_org := marketplace.create_organization('R28 ' || r.slug, r.slug, 'OR', false);
    perform set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
    set local role service_role;
    perform marketplace.open_subscription_cycle(v_org, 'pro', 'active', now() - interval '1 hour', now() + interval '29 days',
      'cus_' || r.first_sub, 'sub_' || r.first_sub, false, 7, false);
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', v_iss, 'sub', r.first_sub,
      'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
    set local role authenticated;
    insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
    values (v_org, v_second, 'owner', true, 'invited') returning id into v_m;
    insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
    values (v_org, v_f1, 'staff', true, 'invited'), (v_org, v_f2, 'staff', true, 'invited');
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', v_iss, 'sub', r.second_sub,
      'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
    update marketplace.organization_memberships set status = 'active' where id = v_m;
    reset role;
  end loop;

  perform set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
  set local role service_role;
  perform marketplace.sync_verified_identity(v_iss, 'r28_3o', 'R28 Hauling Owner', 'r28_3o@r28.test', true);
  perform marketplace.sync_verified_identity(v_iss, 'r28_inv_a', 'R28 Invitee A', 'inv_a@r28.test', true);
  perform marketplace.sync_verified_identity(v_iss, 'r28_inv_b', 'R28 Invitee B', 'inv_b@r28.test', true);
  perform marketplace.sync_verified_identity(v_iss, 'r28_4o', 'R28 Fleet Owner', 'r28_4o@r28.test', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', v_iss, 'sub', 'r28_3o',
    'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;
  v_org := marketplace.create_organization('R28 Hauling', 'r28-r3', 'OR', true);
  perform marketplace.invite_team_member(v_org, 'inv_a@r28.test', 'staff', false, interval '7 days');
  perform marketplace.invite_team_member(v_org, 'inv_b@r28.test', 'staff', false, interval '7 days');
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', v_iss, 'sub', 'r28_4o',
    'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
  v_org := marketplace.create_organization('R28 Fleet', 'r28-r4', 'OR', true);
  reset role;
end
\$\$;"
for slug in r28-r1 r28-r2a r28-r2b; do
  expect_eq "fixture: ${slug} holds 4 of the Pro plan's 5 seats and no pending invitation" \
    "$(q "select count(*) filter (where m.status in ('invited', 'active') and m.landing_workspace_seat)::text || ' ' ||
               (select max_team_members from marketplace.org_entitled_plan(o.id))::text || ' ' ||
               (select count(*) from marketplace.team_invitations ti where ti.org_id = o.id)::text
          from marketplace.organizations o join marketplace.organization_memberships m on m.org_id = o.id
          where o.slug = '${slug}' group by o.id;")" "4 5 0"
done
seats_of() { # seats_of <org id>: seated members plus pending, unexpired seat invitations
  q "select (select count(*) from marketplace.organization_memberships m where m.org_id = '$1'::uuid and m.status in ('invited', 'active') and m.landing_workspace_seat)
          + (select count(*) from marketplace.team_invitations ti where ti.org_id = '$1'::uuid and ti.status = 'pending' and ti.expires_at > now() and ti.landing_workspace_seat);"
}

# =============================================================================
# R1: two owners invite two addresses to the last seat at the same time
# =============================================================================
echo "[1/6] R1: two owners invite different addresses to the organization's last seat at the same time..."
ORG="$(org_of r28-r1)"
barriers
SQL_A="$(holder_sql "$BARRIER" "$(claims_for r28_1a)" "select marketplace.invite_team_member('${ORG}'::uuid, 'first@r28.test', 'staff', true, interval '7 days') is not null;")"
SQL_B="$(waiter_sql "$BARRIER_B" "$(claims_for r28_1b)" "perform marketplace.invite_team_member('${ORG}'::uuid, 'second@r28.test', 'staff', true, interval '7 days')")"
race R1
expect_eq "R1: the first invitation committed" "$RC_A" "0"
expect_eq "R1: the second session ran to the end" "$RC_B" "0"
overlap_waited R1
refused_with R1 23514 "allows 5 team member"
expect_eq "R1: exactly one pending invitation, to the first address" \
  "$(q "select count(*)::text || ' ' || min(invited_email) from marketplace.team_invitations where org_id = '${ORG}'::uuid and status = 'pending';")" "1 first@r28.test"
expect_eq "R1: the organization holds exactly its 5 seats" "$(seats_of "$ORG")" "5"

# =============================================================================
# R2a: a membership by user id, then an invitation, for the last seat
# =============================================================================
echo "[2/6] R2a: an owner adds a seated member by user id while the other owner invites an address to the same seat..."
ORG="$(org_of r28-r2a)"; UX="$(uid_of r28_2a_x)"
[[ -n "$ORG" && -n "$UX" ]] || fail "R2a: fixture setup incomplete"
barriers
SQL_A="$(holder_sql "$BARRIER" "$(claims_for r28_2a)" "insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status) values ('${ORG}'::uuid, '${UX}'::uuid, 'staff', true, 'invited');")"
SQL_B="$(waiter_sql "$BARRIER_B" "$(claims_for r28_2b)" "perform marketplace.invite_team_member('${ORG}'::uuid, 'late@r28.test', 'staff', true, interval '7 days')")"
race R2a
expect_eq "R2a: the membership committed" "$RC_A" "0"
expect_eq "R2a: the second session ran to the end" "$RC_B" "0"
overlap_waited R2a
refused_with R2a 23514 "allows 5 team member"
expect_eq "R2a: no invitation was created, and the organization holds exactly its 5 seats" \
  "$(q "select count(*) from marketplace.team_invitations where org_id = '${ORG}'::uuid;") $(seats_of "$ORG")" "0 5"

# =============================================================================
# R2b: an invitation, then a membership by user id, for the last seat
# =============================================================================
echo "[3/6] R2b: an owner invites an address to the last seat while the other owner adds a seated member by user id..."
ORG="$(org_of r28-r2b)"; UX="$(uid_of r28_3a_x)"
[[ -n "$ORG" && -n "$UX" ]] || fail "R2b: fixture setup incomplete"
barriers
SQL_A="$(holder_sql "$BARRIER" "$(claims_for r28_3a)" "select marketplace.invite_team_member('${ORG}'::uuid, 'held@r28.test', 'staff', true, interval '7 days') is not null;")"
SQL_B="$(waiter_sql "$BARRIER_B" "$(claims_for r28_3b)" "insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status) values ('${ORG}'::uuid, '${UX}'::uuid, 'staff', true, 'invited')")"
race R2b
expect_eq "R2b: the invitation committed" "$RC_A" "0"
expect_eq "R2b: the second session ran to the end" "$RC_B" "0"
overlap_waited R2b
refused_with R2b 23514 "allows 5 team member"
expect_eq "R2b: the membership was not created; the pending invitation holds the last seat" \
  "$(q "select count(*) from marketplace.organization_memberships where org_id = '${ORG}'::uuid and user_id = '${UX}'::uuid;") $(seats_of "$ORG")" "0 5"

# =============================================================================
# R3: accept against revoke, both ways round
# =============================================================================
echo "[4/6] R3: the invitee accepts while an owner revokes the same invitation (and the other way round)..."
ORG="$(org_of r28-r3)"
INV_A="$(q "select id from marketplace.team_invitations where org_id = '${ORG}'::uuid and invited_email = 'inv_a@r28.test';")"
INV_B="$(q "select id from marketplace.team_invitations where org_id = '${ORG}'::uuid and invited_email = 'inv_b@r28.test';")"
[[ -n "$ORG" && -n "$INV_A" && -n "$INV_B" ]] || fail "R3: fixture setup incomplete"
barriers
SQL_A="$(holder_sql "$BARRIER" "$(claims_for r28_inv_a)" "select marketplace.accept_team_invitation('${INV_A}'::uuid) is not null;")"
SQL_B="$(waiter_sql "$BARRIER_B" "$(claims_for r28_3o)" "perform marketplace.revoke_team_invitation('${INV_A}'::uuid)")"
race R3a
expect_eq "R3a: the acceptance committed" "$RC_A" "0"
expect_eq "R3a: the revoking session ran to the end" "$RC_B" "0"
overlap_waited R3a
refused_with R3a 55000 "no longer open \\(accepted\\)"
expect_eq "R3a: the invitation is accepted and its membership is active" \
  "$(q "select ti.status || ' ' || m.status || ' ' || m.role from marketplace.team_invitations ti join marketplace.organization_memberships m on m.id = ti.membership_id where ti.id = '${INV_A}'::uuid;")" "accepted active staff"
barriers
SQL_A="$(holder_sql "$BARRIER" "$(claims_for r28_3o)" "select marketplace.revoke_team_invitation('${INV_B}'::uuid);")"
SQL_B="$(waiter_sql "$BARRIER_B" "$(claims_for r28_inv_b)" "perform marketplace.accept_team_invitation('${INV_B}'::uuid)")"
race R3b
expect_eq "R3b: the revoke committed" "$RC_A" "0"
expect_eq "R3b: the accepting session ran to the end" "$RC_B" "0"
overlap_waited R3b
refused_with R3b 55000 "no longer open \\(revoked\\)"
expect_eq "R3b: the invitation is revoked and no membership was created" \
  "$(q "select ti.status || ' ' || (select count(*) from marketplace.organization_memberships m join marketplace.identity_links l on l.user_id = m.user_id where m.org_id = ti.org_id and l.subject = 'r28_inv_b')::text from marketplace.team_invitations ti where ti.id = '${INV_B}'::uuid;")" "revoked 0"

# =============================================================================
# R4: two email workers claim at the same time
# =============================================================================
echo "[5/6] R4: two email workers claim from the same queue at the same time..."
ORG="$(org_of r28-r4)"
# Only this race's emails are due: every earlier one is closed first (the harness owns the table).
x "update marketplace.notification_outbox set status = 'cancelled', resolved_at = now(), last_failure = 'closed before race R4' where status = 'pending';"
x "
do \$\$
declare i integer;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', 'r28_4o',
    'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;
  for i in 1..20 loop
    perform marketplace.invite_team_member('${ORG}'::uuid, format('w%s@r28.test', lpad(i::text, 2, '0')), 'driver', false, interval '7 days');
  end loop;
  reset role;
end
\$\$;"
expect_eq "R4: 20 emails are due" "$(q "select count(*) from marketplace.notification_outbox where status = 'pending' and channel = 'email' and available_at <= now();")" "20"
barriers
SQL_A="begin;
select pg_sleep_until('${BARRIER}'::timestamptz);
$(service_claims)
select 'CLAIMED ' || c.notification_id || ' ' || c.claim_token from marketplace.claim_email_notifications(12, interval '5 minutes') c;
select 'T_DONE ' || extract(epoch from clock_timestamp());
select pg_sleep(2.5);
select 'T_END ' || extract(epoch from clock_timestamp());
commit;"
SQL_B="begin;
select pg_sleep_until('${BARRIER_B}'::timestamptz);
select 'T_START ' || extract(epoch from clock_timestamp());
$(service_claims)
select 'CLAIMED ' || c.notification_id || ' ' || c.claim_token from marketplace.claim_email_notifications(12, interval '5 minutes') c;
select 'T_FINISHED ' || extract(epoch from clock_timestamp());
commit;"
race R4
expect_eq "R4: worker A committed" "$RC_A" "0"
expect_eq "R4: worker B committed" "$RC_B" "0"
A_DONE="$(marker "$OUT_A" T_DONE)"; A_END="$(marker "$OUT_A" T_END)"; B_START="$(marker "$OUT_B" T_START)"; B_DONE="$(marker "$OUT_B" T_FINISHED)"
[[ -n "$A_DONE" && -n "$A_END" && -n "$B_START" && -n "$B_DONE" ]] || fail "R4: a worker did not report its timestamps"
awk -v ad="$A_DONE" -v ae="$A_END" -v bs="$B_START" -v bd="$B_DONE" 'BEGIN {
  if (!(bs > ad)) { print "R4: worker B started before worker A had claimed"; exit 1 }
  if (!(bd < ae)) { print "R4: worker B finished only after worker A committed (it waited instead of skipping)"; exit 1 }
  printf "  overlap ok: B claimed %.0f ms after A, and finished %.0f ms before A committed, without waiting\n", (bs - ad) * 1000, (ae - bd) * 1000
}' || fail "R4: overlap not demonstrated"
grep -oE '^CLAIMED [0-9a-f-]+' <<<"$OUT_A" | cut -d' ' -f2 | LC_ALL=C sort > "$TMP_DIR/claimed_a.txt"
grep -oE '^CLAIMED [0-9a-f-]+' <<<"$OUT_B" | cut -d' ' -f2 | LC_ALL=C sort > "$TMP_DIR/claimed_b.txt"
expect_eq "R4: worker A claimed 12" "$(wc -l < "$TMP_DIR/claimed_a.txt" | tr -d ' ')" "12"
expect_eq "R4: worker B claimed the other 8" "$(wc -l < "$TMP_DIR/claimed_b.txt" | tr -d ' ')" "8"
expect_eq "R4: no email was claimed by both workers" "$(LC_ALL=C comm -12 "$TMP_DIR/claimed_a.txt" "$TMP_DIR/claimed_b.txt" | wc -l | tr -d ' ')" "0"
expect_eq "R4: all 20 emails are claimed once each (one attempt, one live token)" \
  "$(q "select count(*)::text || ' ' || count(distinct claim_token)::text || ' ' || bool_and(attempt_count = 1)::text from marketplace.notification_outbox where status = 'claimed';")" "20 20 true"

# =============================================================================
# R5: an invitation against a direct downgrade, both ways round
# =============================================================================
echo "[6/6] R5: an owner invites an address to a seat while a direct downgrade to Basic runs (and the other way round)..."
P_START="$(q "select (date_trunc('second', now()) - interval '1 hour')::text;")"
P_END="$(q "select (date_trunc('second', now()) + interval '29 days')::text;")"
# Two Pro landing organizations, each with its owner and one invited seated member: 2 seats, exactly Basic's limit.
x "
do \$\$
declare
  v_iss constant text := 'https://clerk.logloads.test';
  r record; v_org uuid; v_f uuid;
begin
  for r in select * from (values ('r28-r5a', 'r28_5a'), ('r28-r5b', 'r28_5b')) t(slug, sub) loop
    perform set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
    set local role service_role;
    perform marketplace.sync_verified_identity(v_iss, r.sub, 'Owner ' || r.sub, r.sub || '@r28.test', true);
    v_f := marketplace.sync_verified_identity(v_iss, r.sub || '_f', 'Member ' || r.sub, r.sub || '_f@r28.test', true);
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', v_iss, 'sub', r.sub,
      'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
    set local role authenticated;
    v_org := marketplace.create_organization('R28 ' || r.slug, r.slug, 'OR', false);
    perform set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
    set local role service_role;
    perform marketplace.open_subscription_cycle(v_org, 'pro', 'active', '${P_START}'::timestamptz, '${P_END}'::timestamptz,
      'cus_' || r.sub, 'sub_' || r.sub, false, 7, false);
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', v_iss, 'sub', r.sub,
      'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
    set local role authenticated;
    insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
    values (v_org, v_f, 'staff', true, 'invited');
    reset role;
  end loop;
end
\$\$;"
plan_of() { q "select p.code from marketplace.organization_subscriptions s join marketplace.subscription_plans p on p.id = s.plan_id where s.org_id = '$1'::uuid and s.status <> 'canceled';"; }
downgrade_sql() { # downgrade_sql <org id> <subscription suffix>: the call, for "select ...;" or "perform ...;"
  printf '%s' "marketplace.open_subscription_cycle('$1'::uuid, 'basic', 'active', '${P_START}'::timestamptz, '${P_END}'::timestamptz, 'cus_$2', 'sub_$2', false, 7, false)"
}
ORG="$(org_of r28-r5a)"
[[ -n "$ORG" ]] || fail "R5a: fixture setup incomplete"
expect_eq "R5a: fixture: Pro, 2 seats taken" "$(plan_of "$ORG") $(seats_of "$ORG")" "pro 2"
barriers
SQL_A="$(holder_sql "$BARRIER" "$(claims_for r28_5a)" "select marketplace.invite_team_member('${ORG}'::uuid, 'third@r28.test', 'staff', true, interval '7 days') is not null;")"
SQL_B="$(waiter_sql "$BARRIER_B" "$(service_claims)" "perform $(downgrade_sql "$ORG" r28_5a)")"
race R5a
expect_eq "R5a: the invitation committed" "$RC_A" "0"
expect_eq "R5a: the downgrading session ran to the end" "$RC_B" "0"
overlap_waited R5a
refused_with R5a 23514 "pending seat invitation"
expect_eq "R5a: the organization is still on Pro, holding 3 seats (2 members, 1 invitation)" "$(plan_of "$ORG") $(seats_of "$ORG")" "pro 3"
ORG="$(org_of r28-r5b)"
[[ -n "$ORG" ]] || fail "R5b: fixture setup incomplete"
barriers
SQL_A="$(holder_sql "$BARRIER" "$(service_claims)" "select $(downgrade_sql "$ORG" r28_5b) is not null;")"
SQL_B="$(waiter_sql "$BARRIER_B" "$(claims_for r28_5b)" "perform marketplace.invite_team_member('${ORG}'::uuid, 'third@r28.test', 'staff', true, interval '7 days')")"
race R5b
expect_eq "R5b: the downgrade committed" "$RC_A" "0"
expect_eq "R5b: the inviting session ran to the end" "$RC_B" "0"
overlap_waited R5b
refused_with R5b 23514 "allows 2 team member"
expect_eq "R5b: the organization is on Basic with its 2 seats and no invitation"   "$(plan_of "$ORG") $(seats_of "$ORG") $(q "select count(*) from marketplace.team_invitations where org_id = '${ORG}'::uuid;")" "basic 2 0"

echo "Cleaning up..."
x "drop schema if exists marketplace cascade;"
echo "ALL TEAM SEAT AND OUTBOX CONCURRENCY TESTS PASSED."
