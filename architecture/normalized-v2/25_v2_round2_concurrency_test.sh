#!/usr/bin/env bash
# =============================================================================
# LogLoads normalized-v2 — 25 multi-session races for 23 (R2-1, follow-up 1 of the PR #194 review, issue #187)
#
# NON-ACTIVE PROTOTYPE TEST HARNESS. Disposable PostgreSQL only; same fail-closed target checks as 08/10/20.
# Builds its own disposable schema (01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23, each in one transaction).
#
# Race R1: an owner exit against a billing write on the same organization (the deadlock R2-1 removes).
#   The organization is a hauling business with no plan, so its owners hold no landing seat. Session A, the leaving
#   owner, holds its membership row (as its exit UPDATE does when the guard fires: PostgreSQL locks the row before a
#   BEFORE ROW trigger runs; holding it first only fixes the order) and then removes itself. Session B opens the
#   organization's first subscription cycle (open_subscription_cycle): it locks the organization row, and its
#   subscription write fires tg_ensure_owner_landing_seat, which waits for A's row. Under 18, A's exit then waited for
#   the organization row: a cycle, and PostgreSQL aborted one side with 40P01. Under 23, A's exit takes only the
#   owner-exit advisory lock, commits, and B finishes. Both commit, no 40P01, and the result equals the serial order
#   "exit, then billing" run on a twin organization (subscription, period, seats, memberships and the billing audit).
#   With the fix removed (the guard waits for the organization row again), this race fails with 40P01.
# Race R2: the two active owners of one organization leave at the same time (HF-15 under 23's lock). The second exit
#   waits for the first, sees it, and is refused (23514); one owner remains.
# Race R3: while an owner exit is still open, another session locks the organization row with NOWAIT and succeeds,
#   and sees the exit's owner-exit advisory lock held: the exit holds the advisory lock, not the organization row.
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

# --- Target safety (the rules of 08, 10 and 20) --------------------------------
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

# --- Build the schema and a committed fixture -----------------------------------
echo "[0/4] Building the disposable schema (01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23, each atomic)..."
x "drop schema if exists marketplace cascade;"
for f in 01_schema.sql 02_access.sql 03_entitlements.sql 06_v2_contract_alignment.sql 11_v2_phase3_policy.sql \
         12_v2_billing_events.sql 16_v2_identity_membership_hardening.sql 18_v2_review_106_hardening.sql \
         23_v2_round2_hardening.sql; do
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$SCRIPT_DIR/$f" >/dev/null
done
expect_eq "the ledger records 06, 11, 12, 16, 18, 23" "$(q "select string_agg(version, ',' order by applied_at, version) from marketplace.schema_migrations;")" "06,11,12,16,18,23"

# Four hauling businesses with no plan and no landing, each with two active owners and no landing seats:
# r25-race (R1), r25-twin (R1's serial reference), r25-pair (R2), r25-open (R3).
x "
insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true) on conflict (issuer) do nothing;
do \$\$
declare
  v_iss constant text := 'https://clerk.logloads.test';
  r record; v_org uuid; v_second uuid; v_m uuid;
begin
  for r in select * from (values ('r25-race', 'r25_a', 'r25_b'), ('r25-twin', 'r25_a2', 'r25_b2'),
                                 ('r25-pair', 'r25_c', 'r25_d'), ('r25-open', 'r25_e', 'r25_f')) t(slug, first_sub, second_sub)
  loop
    perform set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
    set local role service_role;
    perform marketplace.sync_verified_identity(v_iss, r.first_sub, 'Owner ' || r.first_sub, r.first_sub || '@r25.test', true);
    v_second := marketplace.sync_verified_identity(v_iss, r.second_sub, 'Owner ' || r.second_sub, r.second_sub || '@r25.test', true);
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', v_iss, 'sub', r.first_sub,
      'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
    set local role authenticated;
    v_org := marketplace.create_organization('R25 ' || r.slug, r.slug, 'OR', true);
    insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
    values (v_org, v_second, 'owner', false, 'invited')
    returning id into v_m;
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', v_iss, 'sub', r.second_sub,
      'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
    update marketplace.organization_memberships set status = 'active' where id = v_m;
    reset role;
  end loop;
end
\$\$;"
for slug in r25-race r25-twin r25-pair r25-open; do
  expect_eq "fixture: ${slug} has two active owners, neither with a landing seat, and no subscription" \
    "$(q "select count(*) filter (where m.role = 'owner' and m.status = 'active' and not m.landing_workspace_seat)::text || ' ' ||
               (select count(*) from marketplace.organization_subscriptions s where s.org_id = o.id)::text
          from marketplace.organizations o join marketplace.organization_memberships m on m.org_id = o.id
          where o.slug = '${slug}' group by o.id;")" "2 0"
done

P_START="$(q "select (date_trunc('second', now()) - interval '1 hour')::text;")"
P_END="$(q "select (date_trunc('second', now()) + interval '29 days')::text;")"
billing_sql() { # billing_sql <org id> <provider ref suffix>
  printf '%s' "select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
set local role service_role;
select 'T_START ' || extract(epoch from clock_timestamp());
select marketplace.open_subscription_cycle('$1'::uuid, 'basic', 'active', '${P_START}'::timestamptz, '${P_END}'::timestamptz,
  'cus_$2', 'sub_$2', false, 7, false) is not null;
select 'T_DONE ' || extract(epoch from clock_timestamp());"
}
# Everything billing and the exit leave behind for one organization, without ids or timestamps.
outcome_of() {
  q "select concat_ws(' | ',
    (select string_agg(p.code || ':' || s.status || ':' || s.cancel_at_period_end::text || ':' || (s.current_period_end - s.current_period_start)::text
                       || ':' || coalesce(s.grace_ends_at::text, 'no-grace'), ',')
     from marketplace.organization_subscriptions s join marketplace.subscription_plans p on p.id = s.plan_id where s.org_id = o.id),
    (select string_agg(ep.invitation_allowance::text || ':' || ep.invitations_committed::text || ':' || (ep.period_end - ep.period_start)::text, ',')
     from marketplace.entitlement_periods ep where ep.org_id = o.id),
    (select string_agg(m.role || ':' || m.status || ':' || m.landing_workspace_seat::text || ':' || (m.ended_at is not null)::text, ','
                       order by m.status, m.role)
     from marketplace.organization_memberships m where m.org_id = o.id),
    (select string_agg((a.metadata - 'period_id')::text, ',' order by a.id)
     from marketplace.audit_events a where a.org_id = o.id and a.action like 'subscription.%'),
    (select count(*)::text from marketplace.landings l where l.org_id = o.id))
  from marketplace.organizations o where o.id = '$1'::uuid;"
}

# =============================================================================
# R1: an owner exit against a billing write on the same organization
# =============================================================================
echo "[1/4] R1: an owner without a landing seat leaves while the organization's first subscription cycle opens..."
ORG="$(org_of r25-race)"; UA="$(uid_of r25_a)"; UB="$(uid_of r25_b)"
[[ -n "$ORG" && -n "$UA" && -n "$UB" ]] || fail "R1: fixture setup incomplete"
BARRIER="$(q "select (clock_timestamp() + interval '1500 milliseconds')::text;")"
BARRIER_B="$(q "select ('${BARRIER}'::timestamptz + interval '700 milliseconds')::text;")"
BARRIER_EXIT="$(q "select ('${BARRIER}'::timestamptz + interval '2200 milliseconds')::text;")"
SQL_A="begin;
select pg_sleep_until('${BARRIER}'::timestamptz);
$(claims_for r25_a)
select 1 from marketplace.organization_memberships where org_id = '${ORG}'::uuid and user_id = '${UA}'::uuid for no key update;
select 'T_HELD ' || extract(epoch from clock_timestamp());
select pg_sleep_until('${BARRIER_EXIT}'::timestamptz);
select 'T_EXIT ' || extract(epoch from clock_timestamp());
update marketplace.organization_memberships set status = 'removed' where org_id = '${ORG}'::uuid and user_id = '${UA}'::uuid;
select 'T_UPDATED ' || extract(epoch from clock_timestamp());
commit;"
SQL_B="begin;
select pg_sleep_until('${BARRIER_B}'::timestamptz);
$(billing_sql "$ORG" r25race)
commit;"
race R1
A_HELD="$(marker "$OUT_A" T_HELD)"; A_EXIT="$(marker "$OUT_A" T_EXIT)"; A_UPDATED="$(marker "$OUT_A" T_UPDATED)"
B_START="$(marker "$OUT_B" T_START)"; B_DONE="$(marker "$OUT_B" T_DONE)"
[[ -n "$A_HELD" && -n "$A_EXIT" && -n "$A_UPDATED" && -n "$B_START" && -n "$B_DONE" ]] || fail "R1: a worker did not report its timestamps"
awk -v ah="$A_HELD" -v ae="$A_EXIT" -v au="$A_UPDATED" -v bs="$B_START" -v bd="$B_DONE" 'BEGIN {
  if (!(bs > ah)) { print "R1: billing started before the leaving owner held its membership row"; exit 1 }
  if (!(bs < ae)) { print "R1: billing started after the owner exit began (no overlap)"; exit 1 }
  if (!(bd > au)) { print "R1: billing finished before the owner exit (it never waited for the owner row)"; exit 1 }
  printf "  overlap ok: billing started %.0f ms after the owner row was held, %.0f ms before the exit, and waited %.0f ms\n", (bs - ah) * 1000, (ae - bs) * 1000, (bd - bs) * 1000
}' || fail "R1: overlap not demonstrated"
expect_eq "R1: the owner exit committed" "$RC_A" "0"
expect_eq "R1: the billing write committed" "$RC_B" "0"
expect_eq "R1: the leaving owner is removed (and was skipped by the seat update)" \
  "$(q "select role || ' ' || status || ' ' || landing_workspace_seat::text || ' ' || (ended_at is not null)::text from marketplace.organization_memberships where org_id = '${ORG}'::uuid and user_id = '${UA}'::uuid;")" \
  "owner removed false true"
expect_eq "R1: the remaining owner is active and received a landing seat from the new subscription" \
  "$(q "select role || ' ' || status || ' ' || landing_workspace_seat::text from marketplace.organization_memberships where org_id = '${ORG}'::uuid and user_id = '${UB}'::uuid;")" \
  "owner active true"
expect_eq "R1: exactly one live subscription, on the basic plan" \
  "$(q "select count(*)::text || ' ' || min(p.code) from marketplace.organization_subscriptions s join marketplace.subscription_plans p on p.id = s.plan_id where s.org_id = '${ORG}'::uuid and s.status = 'active';")" "1 basic"

echo "  R1: the same two writes in series on a twin organization (exit, then billing)..."
TWIN="$(org_of r25-twin)"; UA2="$(uid_of r25_a2)"
x "begin;
$(claims_for r25_a2)
update marketplace.organization_memberships set status = 'removed' where org_id = '${TWIN}'::uuid and user_id = '${UA2}'::uuid;
commit;"
x "begin;
$(billing_sql "$TWIN" r25twin)
commit;"
RACED="$(outcome_of "$ORG")"; SERIAL="$(outcome_of "$TWIN")"
[[ -n "$RACED" && "$RACED" == *basic:active* ]] || fail "R1: the raced outcome is incomplete: $RACED"
expect_eq "R1: billing's result under the race equals the serial result (subscription, period, seats, memberships, audit)" "$RACED" "$SERIAL"
echo "  outcome: $RACED"

# =============================================================================
# R2: both owners leave at the same time (HF-15 under 23's lock)
# =============================================================================
echo "[2/4] R2: the two owners of one organization leave at the same time..."
ORG="$(org_of r25-pair)"; UC="$(uid_of r25_c)"; UD="$(uid_of r25_d)"
BARRIER="$(q "select (clock_timestamp() + interval '1500 milliseconds')::text;")"
BARRIER_B="$(q "select ('${BARRIER}'::timestamptz + interval '700 milliseconds')::text;")"
SQL_A="begin;
select pg_sleep_until('${BARRIER}'::timestamptz);
$(claims_for r25_c)
update marketplace.organization_memberships set status = 'removed' where org_id = '${ORG}'::uuid and user_id = '${UC}'::uuid;
select 'T_UPDATED ' || extract(epoch from clock_timestamp());
select pg_sleep(2.5);
select 'T_END ' || extract(epoch from clock_timestamp());
commit;"
SQL_B="begin;
select pg_sleep_until('${BARRIER_B}'::timestamptz);
select 'T_START ' || extract(epoch from clock_timestamp());
$(claims_for r25_d)
update marketplace.organization_memberships set status = 'removed' where org_id = '${ORG}'::uuid and user_id = '${UD}'::uuid;
select 'T_UPDATED ' || extract(epoch from clock_timestamp());
commit;"
race R2
A_UPDATED="$(marker "$OUT_A" T_UPDATED)"; A_END="$(marker "$OUT_A" T_END)"; B_START="$(marker "$OUT_B" T_START)"
[[ -n "$A_UPDATED" && -n "$A_END" && -n "$B_START" ]] || fail "R2: a worker did not report its timestamps"
awk -v au="$A_UPDATED" -v ae="$A_END" -v bs="$B_START" 'BEGIN {
  if (!(bs > au)) { print "R2: session B started before session A had removed itself"; exit 1 }
  if (!(bs < ae)) { print "R2: session B started after session A committed (no overlap)"; exit 1 }
  printf "  overlap ok: B started %.0f ms after A removed itself and %.0f ms before A committed\n", (bs - au) * 1000, (ae - bs) * 1000
}' || fail "R2: overlap not demonstrated"
expect_eq "R2: session A (the first exit) committed" "$RC_A" "0"
[[ "$RC_B" -ne 0 ]] || fail "R2: session B's exit was accepted; the organization was left without an owner"
expect_eq "R2: session B was refused with 23514" "$(sqlstate_of "$OUT_B")" "23514"
grep -q "at least one active owner" <<<"$OUT_B" || fail "R2: session B failed for an unexpected reason"
echo "  ok: R2: session B was refused by the last-owner rule"
[[ -z "$(marker "$OUT_B" T_UPDATED)" ]] || fail "R2: session B reported a completed update"
expect_eq "R2: exactly one active owner remains, and it is owner D" \
  "$(q "select count(*)::text || ' ' || min(user_id::text) from marketplace.organization_memberships where org_id = '${ORG}'::uuid and role = 'owner' and status = 'active';")" "1 ${UD}"

# =============================================================================
# R3: an open owner exit holds the owner-exit advisory lock, not the organization row
# =============================================================================
echo "[3/4] R3: another session locks the organization row while an owner exit is still open..."
ORG="$(org_of r25-open)"; UE="$(uid_of r25_e)"
LOCK_KEY="$(q "select hashtextextended('marketplace.owner_exit:' || '${ORG}', 0);")"
BARRIER="$(q "select (clock_timestamp() + interval '1500 milliseconds')::text;")"
BARRIER_B="$(q "select ('${BARRIER}'::timestamptz + interval '700 milliseconds')::text;")"
SQL_A="begin;
select pg_sleep_until('${BARRIER}'::timestamptz);
$(claims_for r25_e)
update marketplace.organization_memberships set status = 'removed' where org_id = '${ORG}'::uuid and user_id = '${UE}'::uuid;
select 'T_UPDATED ' || extract(epoch from clock_timestamp());
select 'PID ' || pg_backend_pid();
select pg_sleep(2.5);
select 'T_END ' || extract(epoch from clock_timestamp());
commit;"
SQL_B="begin;
select pg_sleep_until('${BARRIER_B}'::timestamptz);
select 'T_START ' || extract(epoch from clock_timestamp());
select 'HOLDERS ' || coalesce(string_agg(l.pid::text, ','), 'none') from pg_locks l
  where l.locktype = 'advisory' and l.granted and l.mode = 'ExclusiveLock' and l.objsubid = 1
    and l.classid = ((${LOCK_KEY}::bigint >> 32) & 4294967295)::oid and l.objid = (${LOCK_KEY}::bigint & 4294967295)::oid;
select 1 from marketplace.organizations where id = '${ORG}'::uuid for update nowait;
select 'T_LOCKED ' || extract(epoch from clock_timestamp());
commit;"
race R3
A_UPDATED="$(marker "$OUT_A" T_UPDATED)"; A_END="$(marker "$OUT_A" T_END)"; B_START="$(marker "$OUT_B" T_START)"; B_LOCKED="$(marker "$OUT_B" T_LOCKED)"
A_PID="$(grep -oE '^PID [0-9]+' <<<"$OUT_A" | head -1 | cut -d' ' -f2 || true)"
HOLDERS="$(grep -oE '^HOLDERS [0-9a-z,]+' <<<"$OUT_B" | head -1 | cut -d' ' -f2 || true)"
expect_eq "R3: the owner exit committed" "$RC_A" "0"
[[ "$RC_B" -eq 0 && -n "$B_LOCKED" ]] || fail "R3: the organization row could not be locked while the owner exit was open ($(sqlstate_of "$OUT_B"))"
[[ -n "$A_UPDATED" && -n "$A_END" && -n "$B_START" ]] || fail "R3: a worker did not report its timestamps"
awk -v au="$A_UPDATED" -v ae="$A_END" -v bs="$B_START" -v bl="$B_LOCKED" 'BEGIN {
  if (!(bs > au)) { print "R3: the second session started before the owner exit"; exit 1 }
  if (!(bl < ae)) { print "R3: the organization row was locked only after the exit committed (no overlap)"; exit 1 }
  printf "  overlap ok: the organization row was locked %.0f ms after the exit and %.0f ms before it committed\n", (bl - au) * 1000, (ae - bl) * 1000
}' || fail "R3: overlap not demonstrated"
echo "  ok: R3: the organization row was free (FOR UPDATE NOWAIT succeeded) while the owner exit was open"
expect_eq "R3: the open exit held the organization's owner-exit advisory lock" "$HOLDERS" "$A_PID"

echo "[4/4] Cleaning up..."
x "drop schema if exists marketplace cascade;"
echo "ALL ROUND-2 CONCURRENCY TESTS PASSED."
