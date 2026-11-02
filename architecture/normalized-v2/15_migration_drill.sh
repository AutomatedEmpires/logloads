#!/usr/bin/env bash
# =============================================================================
# LogLoads normalized-v2 — 15 migration sequencing, rollback and recovery drill
#
# NON-ACTIVE PROTOTYPE TEST HARNESS. Disposable PostgreSQL only (the guarded CI service or the guarded
# Supabase CLI local stack); same fail-closed target checks as 08/10.
#
# Strategy under test (forward-only migrations, each applied atomically, backup before applying):
#   1. Every file applies inside ONE transaction (psql --single-transaction); no file contains its own
#      transaction control or non-transactional DDL.
#   2. A failure anywhere — injected after the last statement of 06 -> 11 -> 12 applied as one batch —
#      leaves the schema and data exactly as before (catalog + full data fingerprints unchanged).
#   3. Out-of-order and repeated application are REFUSED atomically by the migration ledger, with a live
#      V2-published job present: catalog and every table's content stay identical, and the V2 job is never
#      reinterpreted as a legacy import (D-1/D-2/D-3). Idempotent re-application is no longer accepted.
#   4. Recovery: a pg_dump of the marketplace schema taken before 06 restores to exactly the pre-06
#      fingerprint — in place and, on the plain PostgreSQL target, into a brand-new database (D-7) —
#      after which the forward migrations apply cleanly again and the ledger reconciles.
#
# Fingerprints (D-8): catalog = relations with kind, RLS, owner and ACL; column types, defaults and column
# ACLs; constraints; index definitions; function bodies, config, owner and ACL; policies; triggers. Data =
# an md5 of every row of every marketplace table (so is_legacy_import, updated_at, confirmations and ledgers
# are all covered). NULL ACLs compare as their documented default and CHECK text is compared without
# parentheses (the deparser regroups AND chains after a restore).
# =============================================================================
set -euo pipefail

DB_URL="${LOGLOADS_DISPOSABLE_DB_URL:-}"
[[ -n "$DB_URL" ]] || { echo "ERROR: Missing LOGLOADS_DISPOSABLE_DB_URL." >&2; exit 1; }
[[ "$DB_URL" =~ ^postgres(ql)?://([^@/]+@)?(127\.0\.0\.1|localhost)(:[0-9]+)?/[A-Za-z0-9_]+$ ]] \
  || { echo "ERROR: Refusing to run: LOGLOADS_DISPOSABLE_DB_URL must be a local URL with a plain database name." >&2; exit 1; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
TARGET_URL="$DB_URL"
q() { printf '%s\n' "$1" | psql "$TARGET_URL" -X -q -t -A -v ON_ERROR_STOP=1; }
x() { printf '%s\n' "$1" | psql "$TARGET_URL" -X -q -v ON_ERROR_STOP=1 >/dev/null; }
fail() { echo "ERROR: $*" >&2; exit 1; }
ok() { echo "  ok: $*"; }
apply1() { psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$1" >/dev/null; }
# Expects a refusal whose message matches $2; prints the first error line.
refused() {
  if psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$1" >/dev/null 2>"$TMP/refused.log"; then
    fail "$(basename "$1") applied but must be refused ($2)"
  fi
  grep -q "$2" "$TMP/refused.log" || fail "$(basename "$1") failed for an unexpected reason: $(head -c 300 "$TMP/refused.log")"
}

[[ "$(q "select current_database();")" == "${LOGLOADS_DISPOSABLE_DB_NAME:-logloads_test}" ]] || fail "Refusing to run: unexpected database."
PLATFORM=""
if [[ "${LOGLOADS_DB_ENV:-}" == "supabase-local-ci" ]]; then
  PLATFORM=",'auth','storage','realtime','_realtime','vault','graphql','graphql_public','extensions','pgbouncer','supabase_functions','supabase_migrations'"
fi
FOREIGN="$(q "select coalesce(string_agg(format('%I.%I', n.nspname, c.relname), ', '), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema','pg_toast','marketplace','topology','tiger','tiger_data'${PLATFORM})
  and not (n.nspname in ('public','extensions') and c.relname = 'spatial_ref_sys');")"
[[ -z "$FOREIGN" ]] || fail "Refusing to run: foreign tables present: $FOREIGN"
[[ "$(q "select coalesce(shobj_description(oid, 'pg_database'), '') from pg_database where datname = current_database();")" == logloads-ci-disposable:* ]] \
  || fail "Refusing to run: database is not stamped as a CI disposable database."
command -v pg_dump >/dev/null && command -v pg_restore >/dev/null || fail "pg_dump / pg_restore not on PATH"

CATALOG_SQL="select md5(string_agg(x, '|' order by x)) from (
  select 'rel:' || c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' || pg_get_userbyid(c.relowner) || ':' ||
         coalesce((select string_agg(a, ',' order by a) from unnest(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's'::\"char\" else 'r'::\"char\" end, c.relowner))::text[]) a), '')
  from pg_class c where c.relnamespace = 'marketplace'::regnamespace and c.relkind in ('r','p','v','S','i')
  union all
  select 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '')
  from information_schema.columns where table_schema = 'marketplace'
  union all
  select 'colacl:' || c.relname || '.' || a.attname || ':' || (select string_agg(g, ',' order by g) from unnest(a.attacl::text[]) g)
  from pg_attribute a join pg_class c on c.oid = a.attrelid
  where c.relnamespace = 'marketplace'::regnamespace and a.attnum > 0 and not a.attisdropped and a.attacl is not null
  union all
  select 'con:' || cl.relname || ':' || co.conname || ':' || regexp_replace(pg_get_constraintdef(co.oid), '[()]', '', 'g')
  from pg_constraint co join pg_class cl on cl.oid = co.conrelid where co.connamespace = 'marketplace'::regnamespace
  union all
  select 'idx:' || indexname || ':' || indexdef from pg_indexes where schemaname = 'marketplace'
  union all
  select 'fn:' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || md5(p.prosrc) || ':' || p.prosecdef::text || ':' ||
         coalesce(array_to_string(p.proconfig, ','), '') || ':' || pg_get_userbyid(p.proowner) || ':' ||
         coalesce((select string_agg(a, ',' order by a) from unnest(coalesce(p.proacl, acldefault('f'::\"char\", p.proowner))::text[]) a), '')
  from pg_proc p where p.pronamespace = 'marketplace'::regnamespace
  union all
  select 'pol:' || tablename || '.' || policyname || ':' || cmd || ':' || array_to_string(roles, ',') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '')
  from pg_policies where schemaname = 'marketplace'
  union all
  select 'trg:' || c.relname || ':' || t.tgname || ':' || t.tgenabled::text
  from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'marketplace'::regnamespace and not t.tgisinternal
) s(x);"
# One entry per marketplace table: the md5 of all of its rows (or 'empty').
data_entries_sql() {
  local parts
  parts="$(q "select string_agg(format('select %L || '':'' || coalesce((select md5(string_agg(t::text, ''|'' order by t::text)) from marketplace.%I t), ''empty'')', c.relname, c.relname), ' union all ' order by c.relname)
              from pg_class c where c.relnamespace = 'marketplace'::regnamespace and c.relkind in ('r','p');")"
  [[ -n "$parts" ]] || fail "no marketplace tables to fingerprint"
  printf '%s' "$parts"
}
rows() {
  q "$(sed -e 's/^select md5(string_agg(x, .|. order by x)) from (/select x from (/' -e 's/^) s(x);$/) s(x) order by x;/' <<<"$CATALOG_SQL")"
  q "select x from ($(data_entries_sql)) s(x) order by x;"
}
# Fails loudly if either half cannot be computed, so a comparison can never pass vacuously.
fp() {
  local c d
  c="$(q "$CATALOG_SQL")" || fail "catalog fingerprint query failed"
  d="$(q "select md5(string_agg(x, '|' order by x)) from ($(data_entries_sql)) s(x);")" || fail "data fingerprint query failed"
  [[ "$c" =~ ^[0-9a-f]{32}$ && "$d" =~ ^[0-9a-f]{32}$ ]] || fail "fingerprint incomplete (catalog='$c' data='$d')"
  printf '%s %s' "$c" "$d"
}
show_diff() { # show_diff <before rows file> <label>
  rows > "$TMP/rows_now.txt"
  echo "  entries that differ ($2; < before, > now):"
  diff "$1" "$TMP/rows_now.txt" | grep -E '^[<>]' | cut -c1-220 | head -40 || true
}

echo "[1/7] Sequencing: no file controls its own transaction or uses non-transactional DDL..."
for f in 01_schema.sql 02_access.sql 03_entitlements.sql 06_v2_contract_alignment.sql 11_v2_phase3_policy.sql 12_v2_billing_events.sql; do
  # (PL/pgSQL block ends are `end;` / `end if;` and its `begin` carries no semicolon, so they do not match.)
  ! grep -Eiq '^[[:space:]]*(begin|commit|rollback|start[[:space:]]+transaction)[[:space:]]*;' "$SCRIPT_DIR/$f" \
    || fail "$f contains transaction control and cannot be applied atomically"
  ! grep -Eiq '(create|drop)[[:space:]]+(unique[[:space:]]+)?index[[:space:]]+concurrently|^[[:space:]]*vacuum|alter[[:space:]]+system|alter[[:space:]]+type[[:space:]].*add[[:space:]]+value' "$SCRIPT_DIR/$f" \
    || fail "$f contains a statement that cannot run inside a transaction"
done
ok "01, 02, 03, 06, 11, 12 contain no transaction control and no non-transactional DDL"

echo "[2/7] Baseline 01 -> 02 -> 03, each in one transaction, with data..."
x "drop schema if exists marketplace cascade;"
for f in 01_schema.sql 02_access.sql 03_entitlements.sql; do apply1 "$SCRIPT_DIR/$f"; done
ok "baseline applied file by file with --single-transaction"
x "
insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true);
do \$\$
declare v_org uuid; v_land uuid;
begin
  perform set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
  set local role service_role;
  perform marketplace.sync_verified_identity('https://clerk.logloads.test', 'drill_owner', 'Drill Owner', 'drill@d.test', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', 'drill_owner',
    'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;
  v_org := marketplace.create_organization('Drill Timber', 'drill-timber', 'OR', true);
  perform set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
  set local role service_role;
  perform marketplace.open_subscription_cycle(v_org, 'basic', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_d', 'sub_d', false, 7, false);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', 'drill_owner',
    'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (v_org, 'Drill Landing', 'active', 'Near Detroit, OR', extensions.st_GeogFromText('SRID=4326;POINT(-122.15 44.73)'), 'OR')
  returning id into v_land;
  insert into marketplace.job_postings (org_id, landing_id, title, pay_amount_cents, pay_unit, trucks_requested, status)
  values (v_org, v_land, 'Drill Active Job', 9500, 'per_ton', 2, 'active');
  reset role;
end
\$\$;"
FP0="$(fp)"
rows > "$TMP/rows0.txt"
ok "pre-V2 fingerprint recorded (${FP0:0:12}…)"

echo "[3/7] Backup before migrating (pg_dump of the marketplace schema); out-of-order application refused..."
pg_dump "$DB_URL" --schema=marketplace --format=custom --file="$TMP/pre_v2.dump"
[[ -s "$TMP/pre_v2.dump" ]] || fail "backup is empty"
ok "pre-migration backup written ($(wc -c < "$TMP/pre_v2.dump") bytes)"
refused "$SCRIPT_DIR/11_v2_phase3_policy.sql" "requires migration 06"
refused "$SCRIPT_DIR/12_v2_billing_events.sql" "requires migration 11"
[[ "$(fp)" == "$FP0" ]] || { show_diff "$TMP/rows0.txt" "after refused out-of-order runs"; fail "a refused out-of-order migration changed something"; }
ok "11 and 12 before 06 are refused; nothing changed"

echo "[4/7] Rollback: a failure after the last statement of 06 -> 11 -> 12 leaves nothing behind..."
{ cat "$SCRIPT_DIR/06_v2_contract_alignment.sql" "$SCRIPT_DIR/11_v2_phase3_policy.sql" "$SCRIPT_DIR/12_v2_billing_events.sql"
  echo "select 1 / 0; -- injected failure"; } > "$TMP/batch_with_failure.sql"
if psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$TMP/batch_with_failure.sql" >/dev/null 2>"$TMP/err.log"; then
  fail "the injected failure did not abort the batch"
fi
grep -q "division by zero" "$TMP/err.log" || fail "the batch failed for an unexpected reason: $(head -c 300 "$TMP/err.log")"
[[ "$(fp)" == "$FP0" ]] || { show_diff "$TMP/rows0.txt" "after the failed batch"; fail "a failed migration batch left partial schema or data changes"; }
[[ "$(q "select to_regclass('marketplace.job_publication_attestations') is null and to_regclass('marketplace.billing_provider_events') is null and to_regclass('marketplace.schema_migrations') is null;")" == "t" ]] \
  || fail "V2 objects survived the rolled-back batch"
ok "the failed batch rolled back completely (fingerprint identical, no V2 objects, no ledger)"
{ cat "$SCRIPT_DIR/06_v2_contract_alignment.sql"; echo "select 1 / 0; -- injected failure"; } > "$TMP/06_with_failure.sql"
if psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$TMP/06_with_failure.sql" >/dev/null 2>&1; then fail "06 with an injected failure succeeded"; fi
[[ "$(fp)" == "$FP0" ]] || fail "a failed 06 left partial changes"
ok "a failure at the end of 06 alone also rolls back completely"

echo "[5/7] Forward: 06, 11, 12 each in one transaction; then a live V2-published job..."
for f in 06_v2_contract_alignment.sql 11_v2_phase3_policy.sql 12_v2_billing_events.sql; do apply1 "$SCRIPT_DIR/$f"; done
[[ "$(q "select string_agg(version, ',' order by applied_at, version) from marketplace.schema_migrations;")" == "06,11,12" ]] || fail "ledger does not record 06, 11, 12 in order"
[[ "$(q "select bool_and(c.relrowsecurity) from pg_class c where c.relnamespace = 'marketplace'::regnamespace and c.relkind in ('r','p');")" == "t" ]] || fail "RLS missing after forward migration"
ok "06, 11, 12 applied atomically and recorded in order; RLS on every table"
x "
do \$\$
declare v_org uuid; v_land uuid; v_job uuid;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', 'drill_owner',
    'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;
  v_org := marketplace.create_organization('Drill V2 Timber', 'drill-v2-timber', 'OR', false);
  perform set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
  set local role service_role;
  perform marketplace.open_subscription_cycle(v_org, 'basic', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_d2', 'sub_d2', false, 7, false);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', 'drill_owner',
    'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (v_org, 'Drill V2 Landing', 'active', 'Near Sweet Home, OR', marketplace.make_public_point(-122.7, 44.4), 'OR')
  returning id into v_land;
  v_job := marketplace.publish_job_posting(
    v_land, 'Drill V2 Published Job', array['log_truck'], 3,
    'Douglas-fir sawlogs', 'Drill haul.', 'per_ton', 525, null,
    3, current_date + 10, 8, 3.0, 9, 30.0, 'Sweet Home Mill, OR', 28, null, null, array['ppe'], true);
  reset role;
end
\$\$;"
[[ "$(q "select count(*) from marketplace.job_postings where title = 'Drill V2 Published Job' and status = 'active' and not is_legacy_import and last_confirmed_by is not null;")" == "1" ]] \
  || fail "the V2 job was not published as a non-legacy, attested posting"
FP1="$(fp)"
rows > "$TMP/rows1.txt"
ok "a V2-published, attested job is live (fingerprint ${FP1:0:12}…)"

echo "[6/7] Re-running any applied migration is refused atomically and changes nothing (D-1/D-2/D-3)..."
refused "$SCRIPT_DIR/06_v2_contract_alignment.sql" "already applied"
refused "$SCRIPT_DIR/11_v2_phase3_policy.sql" "already applied"
refused "$SCRIPT_DIR/12_v2_billing_events.sql" "already applied"
[[ "$(fp)" == "$FP1" ]] || { show_diff "$TMP/rows1.txt" "after refused re-runs"; fail "a refused re-run changed the catalog or data"; }
[[ "$(q "select is_legacy_import::text from marketplace.job_postings where title = 'Drill V2 Published Job';")" == "false" ]] \
  || fail "D-1: the V2-published job was reinterpreted as a legacy import"
ok "06, 11 and 12 re-runs refused; catalog and every table identical; the V2 job is still a V2 posting"

echo "[7/7] Recovery: restore the pre-migration backup, then migrate forward again..."
x "drop schema marketplace cascade;"
pg_restore --dbname="$DB_URL" --single-transaction --exit-on-error "$TMP/pre_v2.dump"
[[ "$(fp)" == "$FP0" ]] || { show_diff "$TMP/rows0.txt" "after an in-place restore"; fail "restoring the backup did not reproduce the pre-migration schema and data"; }
ok "backup restored in place to exactly the pre-migration fingerprint"
if [[ "${LOGLOADS_DB_ENV:-}" == "ci-disposable" ]]; then
  # D-7: a recovery point must work without the original database. A brand-new database in this guarded
  # disposable cluster gets only what an operator provisions (the extensions schema), then the dump.
  FRESH="logloads_drill_restore_${GITHUB_RUN_ID:-local}_${LOGLOADS_CI_ITERATION:-0}"
  [[ "$FRESH" =~ ^[A-Za-z0-9_]+$ ]] || fail "unexpected fresh database name"
  x "create database ${FRESH} template template0;"
  FRESH_URL="${DB_URL%/*}/${FRESH}"
  printf '%s\n' "create schema extensions; create extension postgis with schema extensions; create extension btree_gist with schema extensions;" \
    | psql "$FRESH_URL" -X -q -v ON_ERROR_STOP=1 >/dev/null
  pg_restore --dbname="$FRESH_URL" --single-transaction --exit-on-error "$TMP/pre_v2.dump"
  TARGET_URL="$FRESH_URL"
  FRESH_FP="$(fp)"
  TARGET_URL="$DB_URL"
  x "drop database ${FRESH};"
  [[ "$FRESH_FP" == "$FP0" ]] || fail "restoring the backup into a fresh database did not reproduce the pre-migration fingerprint"
  ok "backup restored into a brand-new database to exactly the pre-migration fingerprint"
else
  ok "fresh-database restore runs on the plain PostgreSQL target (this target cannot create databases with PostGIS)"
fi
for f in 06_v2_contract_alignment.sql 11_v2_phase3_policy.sql 12_v2_billing_events.sql; do apply1 "$SCRIPT_DIR/$f"; done
[[ "$(q "select count(*) from marketplace.job_postings where title = 'Drill Active Job' and is_legacy_import;")" == "1" ]] || fail "forward migration after restore lost data"
[[ "$(q "select string_agg(version, ',' order by applied_at, version) from marketplace.schema_migrations;")" == "06,11,12" ]] || fail "ledger did not reconcile after restore"
ok "forward migration after restore succeeded; existing data carried through; the ledger reconciles"
x "drop schema if exists marketplace cascade;"

if [[ "${LOGLOADS_DB_ENV:-}" == "ci-disposable" ]]; then
  echo "[D-5] 01 never drops PostGIS on a database that is not stamped disposable, or that has dependents..."
  PROBE="logloads_d5_probe_${GITHUB_RUN_ID:-local}_${LOGLOADS_CI_ITERATION:-0}"
  [[ "$PROBE" =~ ^[A-Za-z0-9_]+$ ]] || fail "unexpected probe database name"
  x "create database ${PROBE} template template0;"
  PROBE_URL="${DB_URL%/*}/${PROBE}"
  printf '%s\n' "create extension postgis; create table public.user_sites (id integer primary key, site geometry); insert into public.user_sites values (1, 'SRID=4326;POINT(-122.7 44.4)');" \
    | psql "$PROBE_URL" -X -q -v ON_ERROR_STOP=1 >/dev/null
  probe_intact() {
    [[ "$(printf '%s\n' "select n.nspname || ':' || (select count(*) from public.user_sites) from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'postgis';" \
          | psql "$PROBE_URL" -X -q -t -A -v ON_ERROR_STOP=1)" == "public:1" ]] || fail "D-5: PostGIS or the user's geometry data did not survive ($1)"
  }
  if psql "$PROBE_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$SCRIPT_DIR/01_schema.sql" >/dev/null 2>"$TMP/d5a.log"; then
    fail "D-5: 01 ran on an unstamped database with PostGIS outside extensions"
  fi
  grep -q "not stamped disposable" "$TMP/d5a.log" || fail "D-5: unexpected failure on the unstamped database: $(head -c 300 "$TMP/d5a.log")"
  probe_intact "unstamped"
  ok "unstamped database: 01 refused; PostGIS and the user's geometry column untouched"
  printf '%s\n' "comment on database ${PROBE} is 'logloads-ci-disposable:d5-probe';" | psql "$PROBE_URL" -X -q -v ON_ERROR_STOP=1 >/dev/null
  if psql "$PROBE_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$SCRIPT_DIR/01_schema.sql" >/dev/null 2>"$TMP/d5b.log"; then
    fail "D-5: 01 dropped PostGIS although a user column depends on it"
  fi
  grep -q "depend on it" "$TMP/d5b.log" && grep -q "user_sites" "$TMP/d5b.log" \
    || fail "D-5: unexpected failure with a dependent column: $(head -c 300 "$TMP/d5b.log")"
  probe_intact "stamped, with a dependent column"
  ok "stamped database with a dependent column: 01 refused and named it; nothing dropped"
  x "drop database ${PROBE};"
fi
echo "MIGRATION DRILL PASSED."
