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

# Privilege invariants every aligned migration stage must leave behind. $1: quoted list of ungranted ledgers.
aligned_privilege_checks() {
  check "RLS enabled on every marketplace table" "select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'marketplace' and c.relkind in ('r','p');"
  check "no marketplace function executable by PUBLIC" "select not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace' and has_function_privilege('public', p.oid, 'EXECUTE'));"
  check "every SECURITY DEFINER function pins search_path" "select not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%'));"
  check "ledgers ($1) carry no client grants" "select not exists (select 1 from information_schema.role_table_grants where table_schema = 'marketplace' and table_name in ($1) and grantee in ('PUBLIC','anon','authenticated','service_role'));"
  check "anon holds no write privileges" "select not exists (select 1 from information_schema.role_table_grants where table_schema = 'marketplace' and grantee = 'anon' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE'));"
  check "no marketplace function reads an application session setting (only request.jwt.claims / role)" "select not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace' and p.prosrc ~* 'current_setting[[:space:]]*[(][[:space:]]*''(?!(request[.]jwt[.]claims|role)'')');"
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

# Migration files are applied exactly as an operator must apply them: one transaction per file, so a failure
# leaves nothing behind (each file's migration-ledger guard refuses repeats and wrong order before changing anything).
run_migration() {
  local file="$1"
  echo "== psql -X -v ON_ERROR_STOP=1 --single-transaction -f $file" | tee "$LOG"
  local started=$SECONDS
  psql "$LOGLOADS_DISPOSABLE_DB_URL" -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose --single-transaction -f "$file" 2>&1 | tee -a "$LOG"
  local rc=${PIPESTATUS[0]}
  echo "== exit $rc after $((SECONDS - started))s" | tee -a "$LOG"
  return "$rc"
}

case "$STAGE" in
  1)
    run_migration "$DIR/01_schema.sql"
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
    run_migration "$DIR/02_access.sql"
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
    run_migration "$DIR/03_entitlements.sql"
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
  6)
    run_migration "$DIR/06_v2_contract_alignment.sql"
    check "RLS enabled on every marketplace table" "select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'marketplace' and c.relkind in ('r','p');"
    check "no marketplace function executable by PUBLIC" "select not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace' and has_function_privilege('public', p.oid, 'EXECUTE'));"
    check "every SECURITY DEFINER function pins search_path" "select not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%'));"
    check "D-1/D-2: the migration ledger records 06" "select exists (select 1 from marketplace.schema_migrations where version = '06');"
    check "E7: superseded baseline pay / published_at checks were dropped" "select not exists (select 1 from pg_constraint c where c.conrelid = 'marketplace.job_postings'::regclass and c.contype = 'c' and c.conname not in ('job_postings_compensation_chk', 'job_postings_attestation_chk') and (regexp_replace(lower(pg_get_constraintdef(c.oid)), '[()]|::text', '', 'g') like '%pay_unit is null and pay_amount_cents is null%' or regexp_replace(lower(pg_get_constraintdef(c.oid)), '[()]|::text', '', 'g') like '%status = ''draft'' or published_at is not null%'));"
    check "attestation and legacy-import ledgers carry no client grants" "select not exists (select 1 from information_schema.role_table_grants where table_schema = 'marketplace' and table_name in ('job_publication_attestations','legacy_job_imports','schema_migrations') and grantee in ('PUBLIC','anon','authenticated','service_role'));"
    check "anon holds no write privileges" "select not exists (select 1 from information_schema.role_table_grants where table_schema = 'marketplace' and grantee = 'anon' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE'));"
    # Comment-proof: no marketplace function may read a session setting except the JWT claims and the
    # built-in role GUC (which a client cannot set to a role it is not a member of).
    check "no marketplace function reads an application session setting (only request.jwt.claims / role)" "select not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace' and p.prosrc ~* 'current_setting[[:space:]]*[(][[:space:]]*''(?!(request[.]jwt[.]claims|role)'')');"
    q "select 'functions reading session settings: ' || coalesce(string_agg(distinct p.proname, ', '), '(none besides request.jwt.claims)') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace' and p.prosrc ~* 'current_setting';" | tee -a "$LOG"
    {
      echo "### Stage 6 alignment inventory"
      echo '```'
      q "select 'tables=' || count(*) from pg_tables where schemaname = 'marketplace';"
      q "select 'functions=' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace';"
      q "select 'security_definer_functions=' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace' and p.prosecdef;"
      q "select 'policies=' || count(*) from pg_policies where schemaname = 'marketplace';"
      q "select 'functions executable by anon: ' || coalesce(string_agg(p.proname, ', ' order by p.proname), '(none)') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace' and has_function_privilege('anon', p.oid, 'EXECUTE');"
      q "select 'functions executable by service_role: ' || coalesce(string_agg(p.proname, ', ' order by p.proname), '(none)') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace' and has_function_privilege('service_role', p.oid, 'EXECUTE');"
      echo '```'
    } | tee -a "$LOG" | tee -a "$SUMMARY"
    ;;
  7)
    run_sql "$DIR/07_v2_contract_tests.sql"
    grep -q "ALL V2 CONTRACT ALIGNMENT & FOUNDER DECISION (V2-DEC-01..03) TESTS PASSED" "$LOG" || { echo "STAGE 7: suite did not reach its final PASS notice" >&2; exit 1; }
    check "suite rolled back (no test organizations left)" "select count(*) = 0 from marketplace.organizations;"
    PASSES="$(grep -cE "NOTICE:  00000: PASS: " "$LOG" || true)"
    echo "  executed assertions reporting PASS: $PASSES" | tee -a "$LOG" | tee -a "$SUMMARY"
    [[ "$PASSES" -ge "${LOGLOADS_MIN_STAGE7_ASSERTIONS:-50}" ]] || { echo "STAGE 7: only $PASSES PASS notices; expected at least ${LOGLOADS_MIN_STAGE7_ASSERTIONS:-50}" >&2; exit 1; }
    ;;
  8)
    echo "== bash $DIR/08_v2_contract_concurrency_test.sh" | tee "$LOG"
    started=$SECONDS
    set +e
    timeout --kill-after=30s 600s bash "$DIR/08_v2_contract_concurrency_test.sh" 2>&1 | tee -a "$LOG"
    rc=${PIPESTATUS[0]}
    set -e
    echo "== exit $rc after $((SECONDS - started))s" | tee -a "$LOG"
    [[ "$rc" == "0" ]] || exit "$rc"
    grep -q "ALL ALIGNED-SCHEMA CONCURRENCY TESTS PASSED" "$LOG" || { echo "STAGE 8: runner did not report completion" >&2; exit 1; }
    { echo "### Stage 8 aligned-schema concurrency"; echo '```'; grep -E "^\[|PASS|overlap|skew" "$LOG" || true; echo '```'; } >> "$SUMMARY"
    ;;
  9)
    run_sql "$DIR/09_v2_integration_audit_tests.sql"
    grep -q "ALL V2 INTEGRATION AUDIT TESTS PASSED" "$LOG" || { echo "STAGE 9: suite did not reach its final PASS notice" >&2; exit 1; }
    check "suite rolled back (no test organizations left)" "select count(*) = 0 from marketplace.organizations;"
    PASSES="$(grep -cE "NOTICE:  00000: PASS: " "$LOG" || true)"
    echo "  executed assertions reporting PASS: $PASSES" | tee -a "$LOG" | tee -a "$SUMMARY"
    ;;
  10)
    echo "== bash $DIR/10_v2_migration_path_test.sh" | tee "$LOG"
    set +e
    timeout --kill-after=30s 300s bash "$DIR/10_v2_migration_path_test.sh" 2>&1 | tee -a "$LOG"
    rc=${PIPESTATUS[0]}
    set -e
    [[ "$rc" == "0" ]] || exit "$rc"
    grep -q "MIGRATION PATH TEST PASSED" "$LOG" || { echo "STAGE 10: test did not report completion" >&2; exit 1; }
    ;;
  11)
    run_migration "$DIR/11_v2_phase3_policy.sql"
    aligned_privilege_checks "'job_publication_attestations','legacy_job_imports','job_moderation_holds','schema_migrations'"
    check "F1: no public hauler profile without recorded consent" "select not exists (select 1 from marketplace.hauler_profiles where is_public and public_listing_consent_at is null);"
    check "F1: consent columns are not client-writable" "select not has_column_privilege('authenticated', 'marketplace.hauler_profiles', 'public_listing_consent_at', 'UPDATE') and not has_column_privilege('authenticated', 'marketplace.hauler_profiles', 'public_listing_consent_by', 'INSERT');"
    check "S5: no EXECUTE grant by the migration role on extension functions it does not own" "select not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace cross join lateral aclexplode(p.proacl) a where n.nspname = 'extensions' and p.proowner <> (select oid from pg_roles where rolname = current_user) and a.grantor = (select oid from pg_roles where rolname = current_user) and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon','authenticated','service_role')));"
    check "S5: pg_stat_statements_reset (if installed) is not executable by anon or authenticated" "select not exists (select 1 from pg_proc p where p.proname = 'pg_stat_statements_reset' and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')));"
    check "F3: reactivate_job_posting executable by authenticated only" "select has_function_privilege('authenticated', 'marketplace.reactivate_job_posting(uuid, boolean)', 'EXECUTE') and not has_function_privilege('anon', 'marketplace.reactivate_job_posting(uuid, boolean)', 'EXECUTE') and not has_function_privilege('service_role', 'marketplace.reactivate_job_posting(uuid, boolean)', 'EXECUTE');"
    ;;
  12)
    run_migration "$DIR/12_v2_billing_events.sql"
    aligned_privilege_checks "'job_publication_attestations','legacy_job_imports','job_moderation_holds','billing_provider_events','schema_migrations'"
    check "R4: apply_billing_provider_event executable by service_role only" "select has_function_privilege('service_role', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace' and p.proname = 'apply_billing_provider_event';"
    check "R4: the subscription-cycle core is not executable by any API role" "select not has_function_privilege('service_role', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace' and p.proname = 'apply_subscription_cycle';"
    check "E-1: the deferred-replay core is not executable by any API role" "select not has_function_privilege('service_role', 'marketplace.replay_deferred_billing_event(uuid)', 'EXECUTE') and not has_function_privilege('authenticated', 'marketplace.replay_deferred_billing_event(uuid)', 'EXECUTE') and not has_function_privilege('anon', 'marketplace.replay_deferred_billing_event(uuid)', 'EXECUTE');"
    check "H1: the deferred-supersede core is not executable by any API role" "select not has_function_privilege('service_role', 'marketplace.supersede_deferred_billing_events(uuid, text, timestamptz)', 'EXECUTE') and not has_function_privilege('authenticated', 'marketplace.supersede_deferred_billing_events(uuid, text, timestamptz)', 'EXECUTE') and not has_function_privilege('anon', 'marketplace.supersede_deferred_billing_events(uuid, text, timestamptz)', 'EXECUTE');"
    check "D-1/D-2: the migration ledger records 06, 11, 12 in order" "select string_agg(version, ',' order by applied_at, version) = '06,11,12' from marketplace.schema_migrations;"
    check "R4: one apply_billing_provider_event and one open_subscription_cycle (no stray overloads)" "select count(*) filter (where p.proname = 'apply_billing_provider_event') = 1 and count(*) filter (where p.proname = 'open_subscription_cycle') = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace';"
    {
      echo "### Stage 12 Phase 3 inventory"
      echo '```'
      q "select 'tables=' || count(*) from pg_tables where schemaname = 'marketplace';"
      q "select 'functions=' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace';"
      q "select 'security_definer_functions=' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace' and p.prosecdef;"
      q "select 'policies=' || count(*) from pg_policies where schemaname = 'marketplace';"
      q "select 'function owners: ' || string_agg(distinct pg_get_userbyid(p.proowner), ', ') || ' (superuser: ' || bool_or(r.rolsuper)::text || ', bypassrls: ' || bool_or(r.rolbypassrls)::text || ')' from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner where n.nspname = 'marketplace';"
      q "select 'functions executable by anon: ' || coalesce(string_agg(p.proname, ', ' order by p.proname), '(none)') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace' and has_function_privilege('anon', p.oid, 'EXECUTE');"
      q "select 'functions executable by service_role: ' || coalesce(string_agg(p.proname, ', ' order by p.proname), '(none)') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace' and has_function_privilege('service_role', p.oid, 'EXECUTE');"
      echo '```'
    } | tee -a "$LOG" | tee -a "$SUMMARY"
    ;;
  16)
    run_migration "$DIR/16_v2_identity_membership_hardening.sql"
    aligned_privilege_checks "'job_publication_attestations','legacy_job_imports','job_moderation_holds','billing_provider_events','schema_migrations'"
    check "D-1/D-2: the migration ledger records 06, 11, 12, 16 in order" "select string_agg(version, ',' order by applied_at, version) = '06,11,12,16' from marketplace.schema_migrations;"
    check "B-1: every active membership carries an acceptance" "select not exists (select 1 from marketplace.organization_memberships where status = 'active' and accepted_at is null);"
    check "B-1: accepted_at is not client-writable" "select not has_column_privilege('authenticated', 'marketplace.organization_memberships', 'accepted_at', 'UPDATE') and not has_column_privilege('authenticated', 'marketplace.organization_memberships', 'accepted_at', 'INSERT');"
    check "B-2: can_view_user_qualifications executable by authenticated only" "select has_function_privilege('authenticated', 'marketplace.can_view_user_qualifications(uuid)', 'EXECUTE') and not has_function_privilege('anon', 'marketplace.can_view_user_qualifications(uuid)', 'EXECUTE') and not has_function_privilege('service_role', 'marketplace.can_view_user_qualifications(uuid)', 'EXECUTE');"
    ;;
  17)
    run_sql "$DIR/17_v2_identity_membership_tests.sql"
    grep -q "ALL IDENTITY, MEMBERSHIP AND QUALIFICATION (B-1, B-2, B-5) TESTS PASSED" "$LOG" || { echo "STAGE 17: suite did not reach its final PASS notice" >&2; exit 1; }
    check "suite rolled back (no test organizations left)" "select count(*) = 0 from marketplace.organizations;"
    PASSES="$(grep -cE "NOTICE:  00000: PASS: " "$LOG" || true)"
    echo "  executed assertions reporting PASS: $PASSES" | tee -a "$LOG" | tee -a "$SUMMARY"
    [[ "$PASSES" -ge 18 ]] || { echo "STAGE 17: only $PASSES PASS notices; expected at least 18" >&2; exit 1; }
    ;;
  13)
    run_sql "$DIR/13_v2_phase3_tests.sql"
    grep -q "ALL PHASE 3 POLICY (F1-F5) AND BILLING-ORDERING TESTS PASSED" "$LOG" || { echo "STAGE 13: suite did not reach its final PASS notice" >&2; exit 1; }
    check "suite rolled back (no test organizations left)" "select count(*) = 0 from marketplace.organizations;"
    PASSES="$(grep -cE "NOTICE:  00000: PASS: " "$LOG" || true)"
    echo "  executed assertions reporting PASS: $PASSES" | tee -a "$LOG" | tee -a "$SUMMARY"
    [[ "$PASSES" -ge 80 ]] || { echo "STAGE 13: only $PASSES PASS notices; expected at least 80" >&2; exit 1; }
    ;;
  14)
    [[ "${LOGLOADS_DB_ENV:-}" == "supabase-local-ci" ]] || { echo "stage 14 runs only on the Supabase local stack" >&2; exit 2; }
    echo "== bash $DIR/14_supabase_api_tests.sh" | tee "$LOG"
    set +e
    timeout --kill-after=30s 300s bash "$DIR/14_supabase_api_tests.sh" 2>&1 | tee -a "$LOG"
    rc=${PIPESTATUS[0]}
    set -e
    [[ "$rc" == "0" ]] || exit "$rc"
    grep -q "ALL SUPABASE API TESTS PASSED" "$LOG" || { echo "STAGE 14: suite did not report completion" >&2; exit 1; }
    { echo "### Stage 14 Supabase API (PostgREST + JWT)"; echo '```'; grep -E "^  (PASS|ok)" "$LOG" || true; echo '```'; } >> "$SUMMARY"
    ;;
  15)
    echo "== bash $DIR/15_migration_drill.sh" | tee "$LOG"
    set +e
    timeout --kill-after=30s 420s bash "$DIR/15_migration_drill.sh" 2>&1 | tee -a "$LOG"
    rc=${PIPESTATUS[0]}
    set -e
    [[ "$rc" == "0" ]] || exit "$rc"
    grep -q "MIGRATION DRILL PASSED" "$LOG" || { echo "STAGE 15: drill did not report completion" >&2; exit 1; }
    { echo "### Stage 15 migration sequencing / rollback / recovery drill"; echo '```'; grep -E "^\[|^  ok" "$LOG" || true; echo '```'; } >> "$SUMMARY"
    ;;
  *) echo "unknown stage $STAGE" >&2; exit 2 ;;
esac

echo "STAGE $STAGE PASSED" | tee -a "$LOG"
echo "- Stage $STAGE: **PASS**" >> "$SUMMARY"
