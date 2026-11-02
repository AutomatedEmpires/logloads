#!/usr/bin/env bash
# =============================================================================
# Runs one normalized-v2 validation stage against the guarded disposable database
# and performs independent post-stage checks. Usage: run-stage.sh <1|2|3|4|5>
# Logs: $RUNNER_TEMP/normalized-v2-ci/logs/stage<N>.log (uploaded on failure).
# =============================================================================
set -euo pipefail

STAGE="${1:?stage number required}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIR="$ROOT/architecture/normalized-v2"
LOG_DIR="${RUNNER_TEMP:-/tmp}/normalized-v2-ci/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/stage${STAGE}.log"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

bash "$ROOT/tools/normalized-v2-ci/guard.sh" verify

q() { printf '%s\n' "$1" | psql "$LOGLOADS_DISPOSABLE_DB_URL" -X -q -t -A -v ON_ERROR_STOP=1; }
check() { # check <description> <sql returning 't'>
  local result
  result="$(q "$2")"
  if [[ "$result" != "t" ]]; then
    echo "POST-STAGE CHECK FAILED: $1 (got: $result)" | tee -a "$LOG" >&2
    exit 1
  fi
  echo "  check ok: $1" | tee -a "$LOG"
}

run_sql() {
  local file="$1"
  echo "== psql -X -v ON_ERROR_STOP=1 -f $file" | tee "$LOG"
  local started=$SECONDS
  # VERBOSITY=verbose prints SQLSTATE codes and source locations on error.
  psql "$LOGLOADS_DISPOSABLE_DB_URL" -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -f "$file" 2>&1 | tee -a "$LOG"
  local rc=${PIPESTATUS[0]}
  echo "== exit $rc after $((SECONDS - started))s" | tee -a "$LOG"
  return "$rc"
}

case "$STAGE" in
  1)
    run_sql "$DIR/01_schema.sql"
    check "postgis installed in schema extensions" "select exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'postgis' and n.nspname = 'extensions');"
    check "btree_gist installed in schema extensions" "select exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'btree_gist' and n.nspname = 'extensions');"
    check "no postgis-dependent extension left outside extensions" "select not exists (select 1 from pg_extension where extname in ('postgis_topology','postgis_tiger_geocoder','postgis_raster','postgis_sfcgal'));"
    check "postgis functional (geography distance)" "select extensions.st_distance(extensions.st_geogfromtext('SRID=4326;POINT(-122.7 44.4)'), extensions.st_geogfromtext('SRID=4326;POINT(-122.6 44.4)')) between 7000 and 9000;"
    check "marketplace tables created" "select count(*) > 0 from pg_tables where schemaname = 'marketplace';"
    {
      echo "### Stage 1 inventory"
      echo '```'
      q "select 'postgres ' || current_setting('server_version') || ' | ' || extensions.postgis_lib_version() || ' (postgis lib) | btree_gist ' || (select extversion from pg_extension where extname='btree_gist');"
      q "select 'tables=' || count(*) from pg_tables where schemaname = 'marketplace';"
      q "select contype::text || '=' || count(*) from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'marketplace' group by contype order by contype;"
      q "select 'indexes=' || count(*) from pg_indexes where schemaname = 'marketplace';"
      q "select 'functions=' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace';"
      q "select 'triggers=' || count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'marketplace' and not t.tgisinternal;"
      echo '```'
    } | tee -a "$LOG" | tee -a "$SUMMARY"
    ;;
  2)
    run_sql "$DIR/02_access.sql"
    check "RLS enabled on every marketplace table" "select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'marketplace' and c.relkind in ('r','p');"
    check "no table privileges granted to PUBLIC" "select not exists (select 1 from information_schema.role_table_grants where table_schema = 'marketplace' and grantee = 'PUBLIC');"
    check "anon holds no write privileges" "select not exists (select 1 from information_schema.role_table_grants where table_schema = 'marketplace' and grantee = 'anon' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE'));"
    {
      echo "### Stage 2 access inventory"
      echo '```'
      q "select 'policies=' || count(*) from pg_policies where schemaname = 'marketplace';"
      q "select 'security_definer_functions=' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace' and p.prosecdef;"
      q "select 'security_definer_without_search_path=' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%');"
      q "select rolname || ' bypassrls=' || rolbypassrls || ' login=' || rolcanlogin from pg_roles where rolname in ('anon','authenticated','service_role') order by 1;"
      echo '```'
    } | tee -a "$LOG" | tee -a "$SUMMARY"
    ;;
  3)
    run_sql "$DIR/03_entitlements.sql"
    check "open_subscription_cycle exists" "select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace' and p.proname = 'open_subscription_cycle');"
    check "RLS still enabled on every marketplace table" "select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'marketplace' and c.relkind in ('r','p');"
    ;;
  4)
    run_sql "$DIR/04_tests.sql"
    grep -q "PASS: All normalized-v2 integration" "$LOG" || { echo "STAGE 4: suite did not reach its final PASS notice" >&2; exit 1; }
    check "suite rolled back (no test organizations left)" "select count(*) = 0 from marketplace.organizations;"
    ;;
  5)
    echo "== bash $DIR/05_concurrency_test.sh" | tee "$LOG"
    started=$SECONDS
    set +e
    timeout --kill-after=30s 600s bash "$DIR/05_concurrency_test.sh" 2>&1 | tee -a "$LOG"
    rc=${PIPESTATUS[0]}
    set -e
    echo "== exit $rc after $((SECONDS - started))s" | tee -a "$LOG"
    [[ "$rc" == "0" ]] || exit "$rc"
    grep -q "ALL 4 MULTI-SESSION CONCURRENCY TESTS PASSED" "$LOG" || { echo "STAGE 5: runner did not report completion" >&2; exit 1; }
    { echo "### Stage 5 concurrency"; echo '```'; grep -E "^\[|PASS|RACE|overlap|skew" "$LOG" || true; echo '```'; } >> "$SUMMARY"
    ;;
  *) echo "unknown stage $STAGE" >&2; exit 2 ;;
esac

echo "STAGE $STAGE PASSED" | tee -a "$LOG"
echo "- Stage $STAGE: **PASS**" >> "$SUMMARY"
