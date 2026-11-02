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
#      leaves the schema and data byte-for-byte as before (catalog + data fingerprints unchanged).
#   3. Re-applying an already-applied migration is either idempotent or refused atomically; it never
#      leaves partial state.
#   4. Recovery: a pg_dump of the marketplace schema taken before 06 restores to exactly the pre-06
#      fingerprint, after which the forward migrations apply cleanly again.
# =============================================================================
set -euo pipefail

DB_URL="${LOGLOADS_DISPOSABLE_DB_URL:-}"
[[ -n "$DB_URL" ]] || { echo "ERROR: Missing LOGLOADS_DISPOSABLE_DB_URL." >&2; exit 1; }
[[ "$DB_URL" =~ ^postgres(ql)?://([^@/]+@)?(127\.0\.0\.1|localhost)(:[0-9]+)?/[A-Za-z0-9_]+$ ]] \
  || { echo "ERROR: Refusing to run: LOGLOADS_DISPOSABLE_DB_URL must be a local URL with a plain database name." >&2; exit 1; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
q() { printf '%s\n' "$1" | psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1; }
x() { printf '%s\n' "$1" | psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 >/dev/null; }
fail() { echo "ERROR: $*" >&2; exit 1; }
ok() { echo "  ok: $*"; }
apply1() { psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$1" >/dev/null; }

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

# Catalog fingerprint of the marketplace schema (names, definitions, function bodies, policies, triggers,
# grants) and a data fingerprint. Two dump/restore artefacts that are semantically identical are normalised:
# a NULL ACL is compared as its documented default (acldefault: owner holds all, nobody else anything), and
# CHECK expressions are compared without parentheses (the deparser regroups AND chains). ACL entries are
# sorted so replay order does not matter.
CATALOG_SQL="select md5(string_agg(x, '|' order by x)) from (
  select 'rel:' || c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' ||
         coalesce((select string_agg(a, ',' order by a) from unnest(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's'::\"char\" else 'r'::\"char\" end, c.relowner))::text[]) a), '')
  from pg_class c where c.relnamespace = 'marketplace'::regnamespace and c.relkind in ('r','p','v','S','i')
  union all
  select 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '')
  from information_schema.columns where table_schema = 'marketplace'
  union all
  select 'con:' || cl.relname || ':' || co.conname || ':' || regexp_replace(pg_get_constraintdef(co.oid), '[()]', '', 'g')
  from pg_constraint co join pg_class cl on cl.oid = co.conrelid where co.connamespace = 'marketplace'::regnamespace
  union all
  select 'fn:' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || md5(p.prosrc) || ':' || p.prosecdef::text || ':' ||
         coalesce(array_to_string(p.proconfig, ','), '') || ':' ||
         coalesce((select string_agg(a, ',' order by a) from unnest(coalesce(p.proacl, acldefault('f'::\"char\", p.proowner))::text[]) a), '')
  from pg_proc p where p.pronamespace = 'marketplace'::regnamespace
  union all
  select 'pol:' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '')
  from pg_policies where schemaname = 'marketplace'
  union all
  select 'trg:' || c.relname || ':' || t.tgname || ':' || t.tgenabled::text
  from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'marketplace'::regnamespace and not t.tgisinternal
) s(x);"
DATA_SQL="select md5(string_agg(x, '|' order by x)) from (
  select 'job:' || id || ':' || status || ':' || coalesce(last_confirmed_at::text, 'null') || ':' || coalesce(pay_amount_cents::text, 'null') from marketplace.job_postings
  union all select 'org:' || id || ':' || status from marketplace.organizations
  union all select 'sub:' || id || ':' || status || ':' || current_period_start from marketplace.organization_subscriptions
  union all select 'hauler:' || org_id || ':' || is_public || ':' || last_confirmed_at from marketplace.hauler_profiles
  union all select 'audit:' || count(*) from marketplace.audit_events
) s(x);"
# Fails loudly if either half cannot be computed, so a comparison can never pass vacuously.
# The same entries, one per line, so a mismatch can be shown precisely.
rows() {
  q "$(sed -e 's/^select md5(string_agg(x, .|. order by x)) from (/select x from (/' -e 's/^) s(x);$/) s(x) order by x;/' <<<"$CATALOG_SQL")"
  q "$(sed -e 's/^select md5(string_agg(x, .|. order by x)) from (/select x from (/' -e 's/^) s(x);$/) s(x) order by x;/' <<<"$DATA_SQL")"
}
fp() {
  local c d
  c="$(q "$CATALOG_SQL")" || fail "catalog fingerprint query failed"
  d="$(q "$DATA_SQL")" || fail "data fingerprint query failed"
  [[ "$c" =~ ^[0-9a-f]{32}$ && "$d" =~ ^[0-9a-f]{32}$ ]] || fail "fingerprint incomplete (catalog='$c' data='$d')"
  printf '%s %s' "$c" "$d"
}

echo "[1/6] Sequencing: no file controls its own transaction or uses non-transactional DDL..."
for f in 01_schema.sql 02_access.sql 03_entitlements.sql 06_v2_contract_alignment.sql 11_v2_phase3_policy.sql 12_v2_billing_events.sql; do
  # (PL/pgSQL block ends are `end;` / `end if;` and its `begin` carries no semicolon, so they do not match.)
  ! grep -Eiq '^[[:space:]]*(begin|commit|rollback|start[[:space:]]+transaction)[[:space:]]*;' "$SCRIPT_DIR/$f" \
    || fail "$f contains transaction control and cannot be applied atomically"
  ! grep -Eiq '(create|drop)[[:space:]]+(unique[[:space:]]+)?index[[:space:]]+concurrently|^[[:space:]]*vacuum|alter[[:space:]]+system|alter[[:space:]]+type[[:space:]].*add[[:space:]]+value' "$SCRIPT_DIR/$f" \
    || fail "$f contains a statement that cannot run inside a transaction"
done
ok "01, 02, 03, 06, 11, 12 contain no transaction control and no non-transactional DDL"

echo "[2/6] Baseline 01 -> 02 -> 03, each in one transaction, with data..."
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

echo "[3/6] Backup before migrating (pg_dump of the marketplace schema)..."
pg_dump "$DB_URL" --schema=marketplace --format=custom --file="$TMP/pre_v2.dump"
[[ -s "$TMP/pre_v2.dump" ]] || fail "backup is empty"
ok "pre-migration backup written ($(wc -c < "$TMP/pre_v2.dump") bytes)"

echo "[4/6] Rollback: a failure after the last statement of 06 -> 11 -> 12 leaves nothing behind..."
{ cat "$SCRIPT_DIR/06_v2_contract_alignment.sql" "$SCRIPT_DIR/11_v2_phase3_policy.sql" "$SCRIPT_DIR/12_v2_billing_events.sql"
  echo "select 1 / 0; -- injected failure"; } > "$TMP/batch_with_failure.sql"
if psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$TMP/batch_with_failure.sql" >/dev/null 2>"$TMP/err.log"; then
  fail "the injected failure did not abort the batch"
fi
grep -q "division by zero" "$TMP/err.log" || fail "the batch failed for an unexpected reason: $(head -c 300 "$TMP/err.log")"
[[ "$(fp)" == "$FP0" ]] || fail "a failed migration batch left partial schema or data changes"
[[ "$(q "select to_regclass('marketplace.job_publication_attestations') is null and to_regclass('marketplace.billing_provider_events') is null;")" == "t" ]] \
  || fail "V2 objects survived the rolled-back batch"
ok "the failed batch rolled back completely (fingerprint identical, no V2 objects)"
{ cat "$SCRIPT_DIR/06_v2_contract_alignment.sql"; echo "select 1 / 0; -- injected failure"; } > "$TMP/06_with_failure.sql"
if psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$TMP/06_with_failure.sql" >/dev/null 2>&1; then fail "06 with an injected failure succeeded"; fi
[[ "$(fp)" == "$FP0" ]] || fail "a failed 06 left partial changes"
ok "a failure at the end of 06 alone also rolls back completely"

echo "[5/6] Forward: 06, 11, 12 each in one transaction; re-runs never leave partial state..."
for f in 06_v2_contract_alignment.sql 11_v2_phase3_policy.sql 12_v2_billing_events.sql; do apply1 "$SCRIPT_DIR/$f"; done
FP1="$(fp)"
[[ "$FP1" != "$FP0" ]] || fail "forward migration changed nothing"
[[ "$(q "select bool_and(c.relrowsecurity) from pg_class c where c.relnamespace = 'marketplace'::regnamespace and c.relkind in ('r','p');")" == "t" ]] || fail "RLS missing after forward migration"
ok "06, 11, 12 applied atomically; RLS on every table"
for f in 06_v2_contract_alignment.sql 11_v2_phase3_policy.sql 12_v2_billing_events.sql; do
  if apply1 "$SCRIPT_DIR/$f" 2>"$TMP/rerun.log"; then
    RESULT="idempotent (re-applied cleanly)"
  else
    RESULT="refused atomically: $(grep -m1 -oE 'ERROR: .{0,90}' "$TMP/rerun.log" || echo error)"
  fi
  NOW_FP="$(fp)"; CATALOG_NOW="${NOW_FP%% *}"; DATA_NOW="${NOW_FP#* }"
  [[ "$DATA_NOW" == "${FP1#* }" ]] || fail "re-running $f changed data"
  if [[ "$RESULT" == refused* ]]; then [[ "$CATALOG_NOW $DATA_NOW" == "$FP1" ]] || fail "a refused re-run of $f left partial schema changes"; fi
  FP1="$CATALOG_NOW $DATA_NOW"
  ok "re-running $f: $RESULT; data unchanged"
done

echo "[6/6] Recovery: restore the pre-migration backup, then migrate forward again..."
x "drop schema marketplace cascade;"
pg_restore --dbname="$DB_URL" --single-transaction --exit-on-error "$TMP/pre_v2.dump"
if [[ "$(fp)" != "$FP0" ]]; then
  rows > "$TMP/rows_restored.txt"
  echo "  entries that differ after restore (< before, > restored):"
  diff "$TMP/rows0.txt" "$TMP/rows_restored.txt" | grep -E '^[<>]' | cut -c1-220 | head -40
  fail "restoring the backup did not reproduce the pre-migration schema and data"
fi
ok "backup restored to exactly the pre-migration fingerprint"
for f in 06_v2_contract_alignment.sql 11_v2_phase3_policy.sql 12_v2_billing_events.sql; do apply1 "$SCRIPT_DIR/$f"; done
[[ "$(q "select count(*) from marketplace.job_postings where title = 'Drill Active Job' and is_legacy_import;")" == "1" ]] || fail "forward migration after restore lost data"
ok "forward migration after restore succeeded; existing data carried through"
x "drop schema if exists marketplace cascade;"
echo "MIGRATION DRILL PASSED."
