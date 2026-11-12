#!/usr/bin/env bash
# =============================================================================
# Runs one normalized-v2 validation stage against the guarded disposable database
# and performs independent post-stage checks. Usage: run-stage.sh <stage number, 1..32>
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
    check "LE-02: the founding-cycle counter is not executable by any API role" "select not has_function_privilege('service_role', 'marketplace.count_founding_cycles_from_ledger(uuid, text)', 'EXECUTE') and not has_function_privilege('authenticated', 'marketplace.count_founding_cycles_from_ledger(uuid, text)', 'EXECUTE') and not has_function_privilege('anon', 'marketplace.count_founding_cycles_from_ledger(uuid, text)', 'EXECUTE');"
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
    check "LE-09: enabled identity issuers must pin an audience" "select exists (select 1 from pg_constraint where conname = 'trusted_identity_issuers_audience_pinned_chk' and convalidated);"
    check "LE-06: the audit actor column is not client-readable" "select not has_column_privilege('authenticated', 'marketplace.audit_events', 'actor_user_id', 'SELECT') and has_column_privilege('authenticated', 'marketplace.audit_events', 'reason', 'SELECT');"
    check "LE-07/LE-08/LE-10/B-9: the access-hardening triggers are installed" "select count(*) = 3 from pg_trigger where not tgisinternal and tgname in ('org_identity_guard', 'invitation_dedupe_floor', 'interest_message_cap');"
    check "LE-05: the moderation-hold duplicate guard is installed on job_postings" "select exists (select 1 from pg_trigger t where t.tgrelid = 'marketplace.job_postings'::regclass and t.tgname = 'job_hold_duplicate_guard' and t.tgenabled = 'O');"
    check "B-2: can_view_user_qualifications executable by authenticated only" "select has_function_privilege('authenticated', 'marketplace.can_view_user_qualifications(uuid)', 'EXECUTE') and not has_function_privilege('anon', 'marketplace.can_view_user_qualifications(uuid)', 'EXECUTE') and not has_function_privilege('service_role', 'marketplace.can_view_user_qualifications(uuid)', 'EXECUTE');"
    ;;
  17)
    run_sql "$DIR/17_v2_identity_membership_tests.sql"
    grep -q "ALL IDENTITY, MEMBERSHIP AND QUALIFICATION (B-1, B-2, B-5) TESTS PASSED" "$LOG" || { echo "STAGE 17: suite did not reach its final PASS notice" >&2; exit 1; }
    check "suite rolled back (no test organizations left)" "select count(*) = 0 from marketplace.organizations;"
    PASSES="$(grep -cE "NOTICE:  00000: PASS: " "$LOG" || true)"
    echo "  executed assertions reporting PASS: $PASSES" | tee -a "$LOG" | tee -a "$SUMMARY"
    [[ "$PASSES" -ge 50 ]] || { echo "STAGE 17: only $PASSES PASS notices; expected at least 50" >&2; exit 1; }
    ;;
  18)
    run_migration "$DIR/18_v2_review_106_hardening.sql"
    aligned_privilege_checks "'job_publication_attestations','legacy_job_imports','job_moderation_holds','billing_provider_events','schema_migrations'"
    check "D-1/D-2: the migration ledger records 06, 11, 12, 16, 18 in order" "select string_agg(version, ',' order by applied_at, version) = '06,11,12,16,18' from marketplace.schema_migrations;"
    check "HF-05: organizations.created_by is not client-readable; the rest of the organization still is" "select not has_column_privilege('authenticated', 'marketplace.organizations', 'created_by', 'SELECT') and has_column_privilege('authenticated', 'marketplace.organizations', 'legal_name', 'SELECT') and not has_column_privilege('anon', 'marketplace.organizations', 'created_by', 'SELECT');"
    check "HF-05: app_users and organizations reads go through the visibility helpers" "select count(*) = 3 from pg_policies where schemaname = 'marketplace' and ((tablename = 'app_users' and policyname = 'app_users_read' and qual like '%can_view_app_user%') or (tablename = 'organizations' and policyname = 'organizations_read' and qual like '%can_view_organization%') or (tablename = 'organizations' and policyname = 'organizations_public' and qual like '%org_has_public_presence%'));"
    check "HF-05: the visibility helpers are executable by the roles their policies serve, and by no other" "select has_function_privilege('authenticated', 'marketplace.can_view_app_user(uuid)', 'EXECUTE') and not has_function_privilege('anon', 'marketplace.can_view_app_user(uuid)', 'EXECUTE') and has_function_privilege('authenticated', 'marketplace.can_view_organization(uuid)', 'EXECUTE') and not has_function_privilege('anon', 'marketplace.can_view_organization(uuid)', 'EXECUTE') and has_function_privilege('anon', 'marketplace.org_has_public_presence(uuid)', 'EXECUTE') and not has_function_privilege('service_role', 'marketplace.org_has_public_presence(uuid)', 'EXECUTE');"
    check "HF-06: the qualification verification-reset trigger is installed" "select exists (select 1 from pg_trigger t where t.tgrelid = 'marketplace.user_qualifications'::regclass and t.tgname = 'qualification_verification_reset' and t.tgenabled = 'O');"
    check "HF-16: abuse_reports.reviewed_by is not client-readable; the report's outcome still is" "select not has_column_privilege('authenticated', 'marketplace.abuse_reports', 'reviewed_by', 'SELECT') and has_column_privilege('authenticated', 'marketplace.abuse_reports', 'resolution_note', 'SELECT');"
    check "HF-18: the migration role's global default for functions withholds EXECUTE from PUBLIC" "select exists (select 1 from pg_default_acl d where d.defaclrole = (select oid from pg_roles where rolname = current_user) and d.defaclnamespace = 0 and d.defaclobjtype = 'f' and not exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = 0));"
    check "withdraw_interest and estimate_boost_audience keep their grants (authenticated only)" "select has_function_privilege('authenticated', 'marketplace.withdraw_interest(uuid)', 'EXECUTE') and not has_function_privilege('anon', 'marketplace.withdraw_interest(uuid)', 'EXECUTE') and not has_function_privilege('service_role', 'marketplace.withdraw_interest(uuid)', 'EXECUTE') and has_function_privilege('authenticated', 'marketplace.estimate_boost_audience(uuid, text)', 'EXECUTE') and not has_function_privilege('anon', 'marketplace.estimate_boost_audience(uuid, text)', 'EXECUTE');"
    ;;
  19)
    run_sql "$DIR/19_v2_review_106_tests.sql"
    grep -q "ALL REVIEW-106 HARDENING (HF-03, HF-05, HF-06, HF-15, HF-16, HF-17, HF-18) TESTS PASSED" "$LOG" || { echo "STAGE 19: suite did not reach its final PASS notice" >&2; exit 1; }
    check "suite rolled back (no test organizations left)" "select count(*) = 0 from marketplace.organizations;"
    check "suite rolled back (the default-privileges probe function is gone)" "select to_regprocedure('marketplace.s18_default_acl_probe()') is null;"
    PASSES="$(grep -cE "NOTICE:  00000: PASS: " "$LOG" || true)"
    echo "  executed assertions reporting PASS: $PASSES" | tee -a "$LOG" | tee -a "$SUMMARY"
    [[ "$PASSES" -ge 34 ]] || { echo "STAGE 19: only $PASSES PASS notices; expected at least 34" >&2; exit 1; }
    ;;
  20)
    echo "== bash $DIR/20_v2_review_106_concurrency_test.sh" | tee "$LOG"
    started=$SECONDS
    set +e
    timeout --kill-after=30s 300s bash "$DIR/20_v2_review_106_concurrency_test.sh" 2>&1 | tee -a "$LOG"
    rc=${PIPESTATUS[0]}
    set -e
    echo "== exit $rc after $((SECONDS - started))s" | tee -a "$LOG"
    [[ "$rc" == "0" ]] || exit "$rc"
    grep -q "ALL REVIEW-106 CONCURRENCY TESTS PASSED" "$LOG" || { echo "STAGE 20: runner did not report completion" >&2; exit 1; }
    { echo "### Stage 20 review-106 concurrency (HF-15)"; echo '```'; grep -E "^\[|ok:|overlap" "$LOG" || true; echo '```'; } >> "$SUMMARY"
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
  21)
    run_sql "$DIR/21_v2_auth_claims_membership_tests.sql"
    grep -q "ALL IDENTITY-CLAIM AND MEMBERSHIP-REVOCATION (#112 DATABASE LAYER) TESTS PASSED" "$LOG" || { echo "STAGE 21: suite did not reach its final PASS notice" >&2; exit 1; }
    check "suite rolled back (no test organizations left)" "select count(*) = 0 from marketplace.organizations where slug like 's21-%';"
    check "suite rolled back (no extra trusted issuer left)" "select not exists (select 1 from marketplace.trusted_identity_issuers where issuer = 'https://clerk-other.logloads.test');"
    PASSES="$(grep -cE "NOTICE:  00000: PASS: " "$LOG" || true)"
    echo "  executed assertions reporting PASS: $PASSES" | tee -a "$LOG" | tee -a "$SUMMARY"
    [[ "$PASSES" -ge 48 ]] || { echo "STAGE 21: only $PASSES PASS notices; expected at least 48" >&2; exit 1; }
    ;;
  22)
    [[ "${LOGLOADS_DB_ENV:-}" == "supabase-local-ci" ]] || { echo "stage 22 runs only on the Supabase local stack" >&2; exit 2; }
    echo "== bash $DIR/22_clerk_auth_harness_local.sh" | tee "$LOG"
    set +e
    timeout --kill-after=30s 300s bash "$DIR/22_clerk_auth_harness_local.sh" 2>&1 | tee -a "$LOG"
    rc=${PIPESTATUS[0]}
    set -e
    [[ "$rc" == "0" ]] || exit "$rc"
    grep -q "AUTH HARNESS LOCAL-STACK RUNS PASSED" "$LOG" || { echo "STAGE 22: harness did not report completion" >&2; exit 1; }
    { echo "### Stage 22 #112 auth harness on the local stack (locally signed tokens through the gateway)"; echo '```'; grep -E "^\[run|^\| |^verify-clerk-supabase-auth: (PASS|FAIL)|^  ok" "$LOG" || true; echo '```'; } >> "$SUMMARY"
    ;;
  23)
    # Which marketplace functions 23 changes, by source: exactly the three it redefines (no billing function).
    FN_BEFORE="$LOG_DIR/stage23-functions-before.txt"; FN_AFTER="$LOG_DIR/stage23-functions-after.txt"
    FN_SQL="select p.oid::regprocedure::text || '|' || md5(p.prosrc) || '|' || coalesce(array_to_string(p.proacl, ','), '') from pg_proc p where p.pronamespace = 'marketplace'::regnamespace order by 1;"
    q "$FN_SQL" > "$FN_BEFORE"
    run_migration "$DIR/23_v2_round2_hardening.sql"
    q "$FN_SQL" > "$FN_AFTER"
    aligned_privilege_checks "'job_publication_attestations','legacy_job_imports','job_moderation_holds','billing_provider_events','schema_migrations'"
    check "D-1/D-2: the migration ledger records 06, 11, 12, 16, 18, 23 in order" "select string_agg(version, ',' order by applied_at, version) = '06,11,12,16,18,23' from marketplace.schema_migrations;"
    [[ "$(wc -l < "$FN_BEFORE")" == "$(wc -l < "$FN_AFTER")" ]] || { echo "POST-STAGE CHECK FAILED: 23 added or dropped a marketplace function" | tee -a "$LOG" >&2; exit 1; }
    CHANGED="$({ diff "$FN_BEFORE" "$FN_AFTER" || true; } | sed -nE 's/^> ([^|]+)\|.*$/\1/p' | LC_ALL=C sort | paste -sd, -)"
    EXPECTED_CHANGED="marketplace.can_view_app_user(uuid),marketplace.can_view_organization(uuid),marketplace.tg_membership_guard()"
    [[ "$CHANGED" == "$EXPECTED_CHANGED" ]] || { echo "POST-STAGE CHECK FAILED: 23 changed [$CHANGED], expected [$EXPECTED_CHANGED]" | tee -a "$LOG" >&2; exit 1; }
    echo "  check ok: R2-1: 23 changes only can_view_app_user, can_view_organization and tg_membership_guard; every billing function (and every grant) is unchanged" | tee -a "$LOG"
    check "R2-1: billing's owner-seat trigger (tg_ensure_owner_landing_seat) is still installed" "select exists (select 1 from pg_trigger t where t.tgrelid = 'marketplace.organization_subscriptions'::regclass and t.tgname = 'ensure_owner_landing_seat_on_sub' and t.tgenabled = 'O');"
    check "R2-2/R2-3: the visibility helpers keep their grants (authenticated only)" "select has_function_privilege('authenticated', 'marketplace.can_view_app_user(uuid)', 'EXECUTE') and not has_function_privilege('anon', 'marketplace.can_view_app_user(uuid)', 'EXECUTE') and not has_function_privilege('service_role', 'marketplace.can_view_app_user(uuid)', 'EXECUTE') and has_function_privilege('authenticated', 'marketplace.can_view_organization(uuid)', 'EXECUTE') and not has_function_privilege('anon', 'marketplace.can_view_organization(uuid)', 'EXECUTE') and not has_function_privilege('service_role', 'marketplace.can_view_organization(uuid)', 'EXECUTE');"
    check "R2-4: the qualification's verification status and reviewer are not client-writable" "select not has_column_privilege('authenticated', 'marketplace.user_qualifications', 'verification_status', 'UPDATE') and not has_column_privilege('authenticated', 'marketplace.user_qualifications', 'reviewed_by', 'UPDATE') and not has_column_privilege('authenticated', 'marketplace.user_qualifications', 'reviewed_at', 'UPDATE') and not has_column_privilege('authenticated', 'marketplace.user_qualifications', 'verification_status', 'INSERT');"
    check "R2-4: the re-verification path is documented on the HF-06 trigger function" "select coalesce(obj_description('marketplace.tg_qualification_verification_reset()'::regprocedure, 'pg_proc'), '') ~ 'There is no exemption';"
    ;;
  24)
    run_sql "$DIR/24_v2_round2_hardening_tests.sql"
    grep -q "ALL ROUND-2 HARDENING (R2-1, R2-2, R2-3, R2-4) TESTS PASSED" "$LOG" || { echo "STAGE 24: suite did not reach its final PASS notice" >&2; exit 1; }
    check "suite rolled back (no test organizations left)" "select count(*) = 0 from marketplace.organizations where slug like 's23-%';"
    PASSES="$(grep -cE "NOTICE:  00000: PASS: " "$LOG" || true)"
    echo "  executed assertions reporting PASS: $PASSES" | tee -a "$LOG" | tee -a "$SUMMARY"
    [[ "$PASSES" -ge 35 ]] || { echo "STAGE 24: only $PASSES PASS notices; expected at least 35" >&2; exit 1; }
    ;;
  25)
    echo "== bash $DIR/25_v2_round2_concurrency_test.sh" | tee "$LOG"
    started=$SECONDS
    set +e
    timeout --kill-after=30s 300s bash "$DIR/25_v2_round2_concurrency_test.sh" 2>&1 | tee -a "$LOG"
    rc=${PIPESTATUS[0]}
    set -e
    echo "== exit $rc after $((SECONDS - started))s" | tee -a "$LOG"
    [[ "$rc" == "0" ]] || exit "$rc"
    grep -q "ALL ROUND-2 CONCURRENCY TESTS PASSED" "$LOG" || { echo "STAGE 25: runner did not report completion" >&2; exit 1; }
    { echo "### Stage 25 round-2 concurrency (R2-1: owner exit against billing, two exits, open exit)"; echo '```'; grep -E "^\[|ok:|overlap|outcome:" "$LOG" || true; echo '```'; } >> "$SUMMARY"
    ;;
  26)
    # Which marketplace functions 26 adds and changes, by source and by grant: exactly the 23 it creates and the ten it
    # redefines, and no grant on any existing function changes.
    FN_SRC_SQL="select p.oid::regprocedure::text || '|' || md5(p.prosrc) from pg_proc p where p.pronamespace = 'marketplace'::regnamespace order by 1;"
    FN_ACL_SQL="select p.oid::regprocedure::text || '|' || coalesce(array_to_string(p.proacl, ','), '') from pg_proc p where p.pronamespace = 'marketplace'::regnamespace order by 1;"
    q "$FN_SRC_SQL" | LC_ALL=C sort > "$LOG_DIR/stage26-src-before.txt"; q "$FN_ACL_SQL" | LC_ALL=C sort > "$LOG_DIR/stage26-acl-before.txt"
    run_migration "$DIR/26_v2_team_seats_saved_jobs_outbox.sql"
    q "$FN_SRC_SQL" | LC_ALL=C sort > "$LOG_DIR/stage26-src-after.txt"; q "$FN_ACL_SQL" | LC_ALL=C sort > "$LOG_DIR/stage26-acl-after.txt"
    aligned_privilege_checks "'job_publication_attestations','legacy_job_imports','job_moderation_holds','billing_provider_events','schema_migrations'"
    check "D-1/D-2: the migration ledger records 06, 11, 12, 16, 18, 23, 26 in order" "select string_agg(version, ',' order by applied_at, version) = '06,11,12,16,18,23,26' from marketplace.schema_migrations;"
    REMOVED="$(LC_ALL=C comm -23 <(cut -d'|' -f1 "$LOG_DIR/stage26-src-before.txt") <(cut -d'|' -f1 "$LOG_DIR/stage26-src-after.txt") | paste -sd, -)"
    [[ -z "$REMOVED" ]] || { echo "POST-STAGE CHECK FAILED: 26 dropped [$REMOVED]" | tee -a "$LOG" >&2; exit 1; }
    ADDED="$(LC_ALL=C comm -13 <(cut -d'|' -f1 "$LOG_DIR/stage26-src-before.txt") <(cut -d'|' -f1 "$LOG_DIR/stage26-src-after.txt") | paste -sd, -)"
    EXPECTED_ADDED="marketplace.accept_team_invitation(uuid),marketplace.claim_email_notifications(integer,interval),marketplace.complete_email_notification(uuid,uuid,text,text,text,interval),marketplace.decline_team_invitation(uuid),marketplace.enqueue_job_alerts(uuid,uuid[]),marketplace.enqueue_notification(text,text,uuid,uuid,text,text,uuid,text,jsonb),marketplace.enqueue_team_invitation_email(uuid),marketplace.invite_team_member(uuid,text,text,boolean,interval,uuid[]),marketplace.job_scope_allows(uuid),marketplace.landing_scope_allows(uuid,uuid),marketplace.list_my_team_invitations(),marketplace.list_saved_jobs(uuid),marketplace.list_team_invitations(uuid),marketplace.mark_notifications_read(uuid[]),marketplace.notification_recipient_allowed(uuid,uuid,text,text,text,uuid),marketplace.record_email_provider_event(text,text,timestamp with time zone),marketplace.resend_team_invitation(uuid,interval),marketplace.revoke_team_invitation(uuid),marketplace.set_membership_landing_scope(uuid,uuid[]),marketplace.tg_interest_message_notify(),marketplace.tg_landing_scope_guard(),marketplace.tg_saved_job_guard(),marketplace.user_landing_scope_allows(uuid,uuid,uuid)"
    [[ "$ADDED" == "$EXPECTED_ADDED" ]] || { echo "POST-STAGE CHECK FAILED: 26 added [$ADDED], expected [$EXPECTED_ADDED]" | tee -a "$LOG" >&2; exit 1; }
    echo "  check ok: 26 adds exactly its 23 functions" | tee -a "$LOG"
    CHANGED="$(LC_ALL=C join -t'|' "$LOG_DIR/stage26-src-before.txt" "$LOG_DIR/stage26-src-after.txt" | awk -F'|' '$2 != $3 {print $1}' | paste -sd, -)"
    EXPECTED_CHANGED="marketplace.apply_subscription_cycle(uuid,text,text,timestamp with time zone,timestamp with time zone,text,text,boolean,integer,boolean,text,boolean),marketplace.can_access_interest(uuid,text),marketplace.can_read_job_posting(uuid),marketplace.can_view_app_user(uuid),marketplace.can_view_landing_private(uuid),marketplace.can_view_organization(uuid),marketplace.has_live_inquiry_from_hauler(uuid),marketplace.list_authoring_landings(uuid),marketplace.list_marketplace_interests(uuid,text,uuid),marketplace.tg_membership_guard()"
    [[ "$CHANGED" == "$EXPECTED_CHANGED" ]] || { echo "POST-STAGE CHECK FAILED: 26 changed [$CHANGED], expected [$EXPECTED_CHANGED]" | tee -a "$LOG" >&2; exit 1; }
    echo "  check ok: 26 redefines exactly tg_membership_guard, apply_subscription_cycle (the downgrade seat check), and the scope-aware readers can_read_job_posting, can_view_landing_private, can_access_interest, has_live_inquiry_from_hauler, can_view_organization, can_view_app_user, list_authoring_landings and list_marketplace_interests" | tee -a "$LOG"
    ACL_CHANGED="$(LC_ALL=C join -t'|' "$LOG_DIR/stage26-acl-before.txt" "$LOG_DIR/stage26-acl-after.txt" | awk -F'|' '$2 != $3 {print $1}' | paste -sd, -)"
    [[ -z "$ACL_CHANGED" ]] || { echo "POST-STAGE CHECK FAILED: 26 changed the grants of [$ACL_CHANGED]" | tee -a "$LOG" >&2; exit 1; }
    echo "  check ok: no existing function's grants changed" | tee -a "$LOG"
    check "26: the new tables carry no grant to PUBLIC, anon or service_role, and no UPDATE grant" "select not exists (select 1 from information_schema.role_table_grants where table_schema = 'marketplace' and table_name in ('team_invitations','team_invitation_landings','membership_landing_scopes','saved_jobs','notification_outbox') and (grantee in ('PUBLIC','anon','service_role') or (grantee = 'authenticated' and privilege_type = 'UPDATE')));"
    check "26-A: the invitation functions are executable by authenticated only" "select bool_and(has_function_privilege('authenticated', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE') and not has_function_privilege('service_role', f, 'EXECUTE')) from unnest(array['marketplace.invite_team_member(uuid, text, text, boolean, interval, uuid[])', 'marketplace.resend_team_invitation(uuid, interval)', 'marketplace.revoke_team_invitation(uuid)', 'marketplace.accept_team_invitation(uuid)', 'marketplace.decline_team_invitation(uuid)', 'marketplace.list_my_team_invitations()', 'marketplace.list_team_invitations(uuid)', 'marketplace.set_membership_landing_scope(uuid, uuid[])', 'marketplace.list_saved_jobs(uuid)', 'marketplace.mark_notifications_read(uuid[])']::regprocedure[]) f;"
    check "26-D: the job-alert and email-worker functions are executable by service_role only" "select bool_and(has_function_privilege('service_role', f, 'EXECUTE') and not has_function_privilege('authenticated', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE')) from unnest(array['marketplace.enqueue_job_alerts(uuid, uuid[])', 'marketplace.claim_email_notifications(integer, interval)', 'marketplace.complete_email_notification(uuid, uuid, text, text, text, interval)', 'marketplace.record_email_provider_event(text, text, timestamptz)']::regprocedure[]) f;"
    check "26: the internal helpers and trigger functions are executable by no API role" "select bool_and(not has_function_privilege('authenticated', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE') and not has_function_privilege('service_role', f, 'EXECUTE')) from unnest(array['marketplace.user_landing_scope_allows(uuid, uuid, uuid)', 'marketplace.notification_recipient_allowed(uuid, uuid, text, text, text, uuid)', 'marketplace.enqueue_notification(text, text, uuid, uuid, text, text, uuid, text, jsonb)', 'marketplace.enqueue_team_invitation_email(uuid)', 'marketplace.tg_landing_scope_guard()', 'marketplace.tg_saved_job_guard()', 'marketplace.tg_interest_message_notify()']::regprocedure[]) f;"
    check "26-B: the landing-scope guard is installed on its seven tables" "select count(distinct c.relname) = 7 from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'marketplace'::regnamespace and t.tgname = 'landing_scope_guard' and t.tgenabled = 'O' and c.relname in ('landings','landing_private_details','job_postings','job_posting_equipment','targeted_invitations','expressions_of_interest','interest_messages');"
    check "26-B: the five restrictive landing-scope read policies are installed" "select count(*) = 5 from pg_policies where schemaname = 'marketplace' and permissive = 'RESTRICTIVE' and cmd = 'SELECT' and policyname in ('landings_landing_scope','job_postings_landing_scope','interests_landing_scope','invitations_landing_scope','job_boosts_landing_scope');"
    check "26-D: the outbox's address, provider id, claim and failure text are not client-readable; its notice fields are" "select not has_column_privilege('authenticated', 'marketplace.notification_outbox', 'recipient_email', 'SELECT') and not has_column_privilege('authenticated', 'marketplace.notification_outbox', 'provider_message_id', 'SELECT') and not has_column_privilege('authenticated', 'marketplace.notification_outbox', 'claim_token', 'SELECT') and not has_column_privilege('authenticated', 'marketplace.notification_outbox', 'last_failure', 'SELECT') and has_column_privilege('authenticated', 'marketplace.notification_outbox', 'payload', 'SELECT') and has_column_privilege('authenticated', 'marketplace.notification_outbox', 'status', 'SELECT');"
    check "26-A: the seat guard (tg_membership_guard) and the downgrade check (apply_subscription_cycle) count pending invitations" "select bool_and(prosrc like '%marketplace.team_invitations%') from pg_proc where oid in ('marketplace.tg_membership_guard()'::regprocedure, 'marketplace.apply_subscription_cycle(uuid, text, text, timestamptz, timestamptz, text, text, boolean, integer, boolean, text, boolean)'::regprocedure);"
    check "R4: the subscription-cycle core is still executable by no API role" "select not has_function_privilege('service_role', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace' and p.proname = 'apply_subscription_cycle';"
    {
      echo "### Stage 26 inventory"
      echo '```'
      q "select 'tables=' || count(*) from pg_tables where schemaname = 'marketplace';"
      q "select 'functions=' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace';"
      q "select 'policies=' || count(*) || ' (restrictive ' || count(*) filter (where permissive = 'RESTRICTIVE') || ')' from pg_policies where schemaname = 'marketplace';"
      q "select 'functions executable by service_role: ' || coalesce(string_agg(p.proname, ', ' order by p.proname), '(none)') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace' and has_function_privilege('service_role', p.oid, 'EXECUTE');"
      echo '```'
    } | tee -a "$LOG" | tee -a "$SUMMARY"
    ;;
  27)
    run_sql "$DIR/27_v2_team_seats_saved_jobs_outbox_tests.sql"
    grep -q "ALL SEAT INVITATION, LANDING SCOPE, SAVED JOB AND NOTIFICATION OUTBOX (26-A..26-D) TESTS PASSED" "$LOG" || { echo "STAGE 27: suite did not reach its final PASS notice" >&2; exit 1; }
    check "suite rolled back (no test organizations left)" "select count(*) = 0 from marketplace.organizations where slug like 's26-%';"
    PASSES="$(grep -cE "NOTICE:  00000: PASS: " "$LOG" || true)"
    echo "  executed assertions reporting PASS: $PASSES" | tee -a "$LOG" | tee -a "$SUMMARY"
    [[ "$PASSES" -ge 150 ]] || { echo "STAGE 27: only $PASSES PASS notices; expected at least 150" >&2; exit 1; }
    # Regression: the earlier suites, which ran before 26, run again on the 26 schema. (24 pins the ledger at 23; its
    # rules are re-run through 17, 19 and 21, and 27 checks the ledger.)
    while IFS='|' read -r SUITE NOTICE; do
      RLOG="$LOG_DIR/stage27-rerun-${SUITE%%_*}.log"
      echo "== psql -X -v ON_ERROR_STOP=1 -f $SUITE (again, on the 26 schema)" | tee "$RLOG"
      psql "$LOGLOADS_DISPOSABLE_DB_URL" -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -f "$DIR/$SUITE" >> "$RLOG" 2>&1 \
        || { echo "STAGE 27: $SUITE failed on the 26 schema (see $RLOG)" | tee -a "$LOG" >&2; tail -n 30 "$RLOG" >&2; exit 1; }
      grep -qF "$NOTICE" "$RLOG" || { echo "STAGE 27: $SUITE did not reach its final PASS notice on the 26 schema" | tee -a "$LOG" >&2; exit 1; }
      echo "  check ok: $SUITE passes again on the 26 schema" | tee -a "$LOG" | tee -a "$SUMMARY"
    done <<'SUITES'
04_tests.sql|PASS: All normalized-v2 integration
07_v2_contract_tests.sql|ALL V2 CONTRACT ALIGNMENT & FOUNDER DECISION (V2-DEC-01..03) TESTS PASSED
09_v2_integration_audit_tests.sql|ALL V2 INTEGRATION AUDIT TESTS PASSED
13_v2_phase3_tests.sql|ALL PHASE 3 POLICY (F1-F5) AND BILLING-ORDERING TESTS PASSED
21_v2_auth_claims_membership_tests.sql|ALL IDENTITY-CLAIM AND MEMBERSHIP-REVOCATION (#112 DATABASE LAYER) TESTS PASSED
17_v2_identity_membership_tests.sql|ALL IDENTITY, MEMBERSHIP AND QUALIFICATION (B-1, B-2, B-5) TESTS PASSED
19_v2_review_106_tests.sql|ALL REVIEW-106 HARDENING (HF-03, HF-05, HF-06, HF-15, HF-16, HF-17, HF-18) TESTS PASSED
SUITES
    check "the re-run suites rolled back (no test organizations left)" "select count(*) = 0 from marketplace.organizations;"
    ;;
  28)
    echo "== bash $DIR/28_v2_team_seats_outbox_concurrency_test.sh" | tee "$LOG"
    started=$SECONDS
    set +e
    timeout --kill-after=30s 300s bash "$DIR/28_v2_team_seats_outbox_concurrency_test.sh" 2>&1 | tee -a "$LOG"
    rc=${PIPESTATUS[0]}
    set -e
    echo "== exit $rc after $((SECONDS - started))s" | tee -a "$LOG"
    [[ "$rc" == "0" ]] || exit "$rc"
    grep -q "ALL TEAM SEAT AND OUTBOX CONCURRENCY TESTS PASSED" "$LOG" || { echo "STAGE 28: runner did not report completion" >&2; exit 1; }
    { echo "### Stage 28 seat invitations and outbox concurrency (last seat, invitation against membership, accept against revoke, two workers, invitation against downgrade)"; echo '```'; grep -E "^\[|ok:|overlap" "$LOG" || true; echo '```'; } >> "$SUMMARY"
    ;;
  29)
    # Which marketplace functions 29 changes, by source and by grant: exactly the four it redefines. It adds and drops
    # none, and no grant changes.
    FN_SRC_SQL="select p.oid::regprocedure::text || '|' || md5(p.prosrc) from pg_proc p where p.pronamespace = 'marketplace'::regnamespace order by 1;"
    FN_ACL_SQL="select p.oid::regprocedure::text || '|' || coalesce(array_to_string(p.proacl, ','), '') from pg_proc p where p.pronamespace = 'marketplace'::regnamespace order by 1;"
    q "$FN_SRC_SQL" | LC_ALL=C sort > "$LOG_DIR/stage29-src-before.txt"; q "$FN_ACL_SQL" | LC_ALL=C sort > "$LOG_DIR/stage29-acl-before.txt"
    run_migration "$DIR/29_v2_landing_scope_hardening.sql"
    q "$FN_SRC_SQL" | LC_ALL=C sort > "$LOG_DIR/stage29-src-after.txt"; q "$FN_ACL_SQL" | LC_ALL=C sort > "$LOG_DIR/stage29-acl-after.txt"
    aligned_privilege_checks "'job_publication_attestations','legacy_job_imports','job_moderation_holds','billing_provider_events','schema_migrations'"
    check "D-1/D-2: the migration ledger records 06, 11, 12, 16, 18, 23, 26, 29 in order" "select string_agg(version, ',' order by applied_at, version) = '06,11,12,16,18,23,26,29' from marketplace.schema_migrations;"
    REMOVED="$(LC_ALL=C comm -23 <(cut -d'|' -f1 "$LOG_DIR/stage29-src-before.txt") <(cut -d'|' -f1 "$LOG_DIR/stage29-src-after.txt") | paste -sd, -)"
    ADDED="$(LC_ALL=C comm -13 <(cut -d'|' -f1 "$LOG_DIR/stage29-src-before.txt") <(cut -d'|' -f1 "$LOG_DIR/stage29-src-after.txt") | paste -sd, -)"
    [[ -z "$REMOVED$ADDED" ]] || { echo "POST-STAGE CHECK FAILED: 29 dropped [$REMOVED] and added [$ADDED]; it should do neither" | tee -a "$LOG" >&2; exit 1; }
    echo "  check ok: 29 adds and drops no function" | tee -a "$LOG"
    CHANGED="$(LC_ALL=C join -t'|' "$LOG_DIR/stage29-src-before.txt" "$LOG_DIR/stage29-src-after.txt" | awk -F'|' '$2 != $3 {print $1}' | paste -sd, -)"
    EXPECTED_CHANGED="marketplace.count_eligible_invitation_recipients(uuid,integer,interval),marketplace.estimate_boost_audience(uuid,text),marketplace.respond_to_interest(uuid,text,boolean,uuid,text),marketplace.tg_landing_scope_guard()"
    [[ "$CHANGED" == "$EXPECTED_CHANGED" ]] || { echo "POST-STAGE CHECK FAILED: 29 changed [$CHANGED], expected [$EXPECTED_CHANGED]" | tee -a "$LOG" >&2; exit 1; }
    echo "  check ok: 29 redefines exactly tg_landing_scope_guard and respond_to_interest (29-P2), and count_eligible_invitation_recipients and estimate_boost_audience (29-P3)" | tee -a "$LOG"
    ACL_CHANGED="$(LC_ALL=C join -t'|' "$LOG_DIR/stage29-acl-before.txt" "$LOG_DIR/stage29-acl-after.txt" | awk -F'|' '$2 != $3 {print $1}' | paste -sd, -)"
    [[ -z "$ACL_CHANGED" ]] || { echo "POST-STAGE CHECK FAILED: 29 changed the grants of [$ACL_CHANGED]" | tee -a "$LOG" >&2; exit 1; }
    echo "  check ok: no function's grants changed" | tee -a "$LOG"
    check "29-P2: the guard limits a landing-side response by a member of the hauling business, and respond_to_interest checks the job's landing" "select (select prosrc like '%v_landing_response%' from pg_proc where oid = 'marketplace.tg_landing_scope_guard()'::regprocedure) and (select prosrc like '%marketplace.job_scope_allows(v_row.job_id)%' from pg_proc where oid = 'marketplace.respond_to_interest(uuid, text, boolean, uuid, text)'::regprocedure);"
    check "29-P3: both audience counts check the job's landing" "select bool_and(prosrc like '%marketplace.job_scope_allows(p_job_id)%') and count(*) = 2 from pg_proc where oid in ('marketplace.count_eligible_invitation_recipients(uuid, integer, interval)'::regprocedure, 'marketplace.estimate_boost_audience(uuid, text)'::regprocedure);"
    check "29: respond_to_interest and the audience counts stay executable by authenticated only; the guard's trigger function by no API role" "select bool_and(has_function_privilege('authenticated', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE') and not has_function_privilege('service_role', f, 'EXECUTE')) and not has_function_privilege('authenticated', 'marketplace.tg_landing_scope_guard()', 'EXECUTE') and not has_function_privilege('anon', 'marketplace.tg_landing_scope_guard()', 'EXECUTE') and not has_function_privilege('service_role', 'marketplace.tg_landing_scope_guard()', 'EXECUTE') from unnest(array['marketplace.respond_to_interest(uuid, text, boolean, uuid, text)', 'marketplace.count_eligible_invitation_recipients(uuid, integer, interval)', 'marketplace.estimate_boost_audience(uuid, text)']::regprocedure[]) f;"
    check "26-B: the landing-scope guard is still installed on its seven tables" "select count(distinct c.relname) = 7 from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'marketplace'::regnamespace and t.tgname = 'landing_scope_guard' and t.tgenabled = 'O' and t.tgfoid = 'marketplace.tg_landing_scope_guard()'::regprocedure;"
    ;;
  30)
    run_sql "$DIR/30_v2_landing_scope_hardening_tests.sql"
    grep -q "ALL LANDING-SCOPE HARDENING (29-P2, 29-P3) TESTS PASSED" "$LOG" || { echo "STAGE 30: suite did not reach its final PASS notice" >&2; exit 1; }
    check "suite rolled back (no test organizations left)" "select count(*) = 0 from marketplace.organizations where slug like 's29-%';"
    PASSES="$(grep -cE "NOTICE:  00000: PASS: " "$LOG" || true)"
    echo "  executed assertions reporting PASS: $PASSES" | tee -a "$LOG" | tee -a "$SUMMARY"
    [[ "$PASSES" -ge 41 ]] || { echo "STAGE 30: only $PASSES PASS notices; expected at least 41" >&2; exit 1; }
    # Regression: the earlier suites run again on the 29 schema, 27 (26-B, which 29 changes) included. 24 pins the
    # ledger at 23 and is not re-run; its rules run again through 17, 19 and 21.
    while IFS='|' read -r SUITE NOTICE; do
      RLOG="$LOG_DIR/stage30-rerun-${SUITE%%_*}.log"
      echo "== psql -X -v ON_ERROR_STOP=1 -f $SUITE (again, on the 29 schema)" | tee "$RLOG"
      psql "$LOGLOADS_DISPOSABLE_DB_URL" -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -f "$DIR/$SUITE" >> "$RLOG" 2>&1 \
        || { echo "STAGE 30: $SUITE failed on the 29 schema (see $RLOG)" | tee -a "$LOG" >&2; tail -n 30 "$RLOG" >&2; exit 1; }
      grep -qF "$NOTICE" "$RLOG" || { echo "STAGE 30: $SUITE did not reach its final PASS notice on the 29 schema" | tee -a "$LOG" >&2; exit 1; }
      echo "  check ok: $SUITE passes again on the 29 schema" | tee -a "$LOG" | tee -a "$SUMMARY"
    done <<'SUITES'
04_tests.sql|PASS: All normalized-v2 integration
07_v2_contract_tests.sql|ALL V2 CONTRACT ALIGNMENT & FOUNDER DECISION (V2-DEC-01..03) TESTS PASSED
09_v2_integration_audit_tests.sql|ALL V2 INTEGRATION AUDIT TESTS PASSED
13_v2_phase3_tests.sql|ALL PHASE 3 POLICY (F1-F5) AND BILLING-ORDERING TESTS PASSED
21_v2_auth_claims_membership_tests.sql|ALL IDENTITY-CLAIM AND MEMBERSHIP-REVOCATION (#112 DATABASE LAYER) TESTS PASSED
17_v2_identity_membership_tests.sql|ALL IDENTITY, MEMBERSHIP AND QUALIFICATION (B-1, B-2, B-5) TESTS PASSED
19_v2_review_106_tests.sql|ALL REVIEW-106 HARDENING (HF-03, HF-05, HF-06, HF-15, HF-16, HF-17, HF-18) TESTS PASSED
27_v2_team_seats_saved_jobs_outbox_tests.sql|ALL SEAT INVITATION, LANDING SCOPE, SAVED JOB AND NOTIFICATION OUTBOX (26-A..26-D) TESTS PASSED
SUITES
    check "the re-run suites rolled back (no test organizations left)" "select count(*) = 0 from marketplace.organizations;"
    ;;
  31)
    # What 31 changes, by function source, function grant, table and policy: it redefines exactly eight functions, adds
    # exactly five functions and two tables, replaces three policies, and changes no grant of an existing function.
    FN_SRC_SQL="select p.oid::regprocedure::text || '|' || md5(p.prosrc) from pg_proc p where p.pronamespace = 'marketplace'::regnamespace order by 1;"
    FN_ACL_SQL="select p.oid::regprocedure::text || '|' || coalesce(array_to_string(p.proacl, ','), '') from pg_proc p where p.pronamespace = 'marketplace'::regnamespace order by 1;"
    TABLES_SQL="select c.relname from pg_class c where c.relnamespace = 'marketplace'::regnamespace and c.relkind in ('r','p') order by 1;"
    POLICY_SQL="select tablename || '.' || policyname || '|' || md5(coalesce(qual, '') || '|' || coalesce(with_check, '') || '|' || cmd || '|' || array_to_string(roles, ',')) from pg_policies where schemaname = 'marketplace' order by 1;"
    q "$FN_SRC_SQL" | LC_ALL=C sort > "$LOG_DIR/stage31-src-before.txt"; q "$FN_ACL_SQL" | LC_ALL=C sort > "$LOG_DIR/stage31-acl-before.txt"
    q "$TABLES_SQL" | LC_ALL=C sort > "$LOG_DIR/stage31-tables-before.txt"; q "$POLICY_SQL" | LC_ALL=C sort > "$LOG_DIR/stage31-policies-before.txt"
    run_migration "$DIR/31_v2_reply_gate_reconfirmation_unsubscribe.sql"
    q "$FN_SRC_SQL" | LC_ALL=C sort > "$LOG_DIR/stage31-src-after.txt"; q "$FN_ACL_SQL" | LC_ALL=C sort > "$LOG_DIR/stage31-acl-after.txt"
    q "$TABLES_SQL" | LC_ALL=C sort > "$LOG_DIR/stage31-tables-after.txt"; q "$POLICY_SQL" | LC_ALL=C sort > "$LOG_DIR/stage31-policies-after.txt"
    aligned_privilege_checks "'job_publication_attestations','legacy_job_imports','job_moderation_holds','billing_provider_events','schema_migrations','notification_unsubscribe_keys','notification_unsubscribe_uses'"
    check "D-1/D-2: the migration ledger records 06, 11, 12, 16, 18, 23, 26, 29, 31 in order" "select string_agg(version, ',' order by applied_at, version) = '06,11,12,16,18,23,26,29,31' from marketplace.schema_migrations;"
    # Function names only: the argument list is printed with or without the extensions schema, by search_path.
    REMOVED="$(LC_ALL=C comm -23 <(cut -d'|' -f1 "$LOG_DIR/stage31-src-before.txt") <(cut -d'|' -f1 "$LOG_DIR/stage31-src-after.txt") | sed 's/(.*//' | paste -sd, -)"
    ADDED="$(LC_ALL=C comm -13 <(cut -d'|' -f1 "$LOG_DIR/stage31-src-before.txt") <(cut -d'|' -f1 "$LOG_DIR/stage31-src-after.txt") | sed 's/(.*//' | paste -sd, -)"
    EXPECTED_ADDED="marketplace.hmac_sha256,marketplace.issue_unsubscribe_token,marketplace.job_confirmation_current,marketplace.job_takes_new_interest,marketplace.unsubscribe_with_token"
    [[ -z "$REMOVED" && "$ADDED" == "$EXPECTED_ADDED" ]] || { echo "POST-STAGE CHECK FAILED: 31 dropped [$REMOVED] and added [$ADDED]; expected none dropped and [$EXPECTED_ADDED] added" | tee -a "$LOG" >&2; exit 1; }
    echo "  check ok: 31 drops no function and adds exactly job_confirmation_current and job_takes_new_interest (31-R) and hmac_sha256, issue_unsubscribe_token, unsubscribe_with_token (31-U)" | tee -a "$LOG"
    CHANGED="$(LC_ALL=C join -t'|' "$LOG_DIR/stage31-src-before.txt" "$LOG_DIR/stage31-src-after.txt" | awk -F'|' '$2 != $3 {print $1}' | sed 's/(.*//' | paste -sd, -)"
    EXPECTED_CHANGED="marketplace.can_view_landing_private,marketplace.list_marketplace_jobs,marketplace.reactivate_job_posting,marketplace.reconfirm_job_posting,marketplace.respond_to_interest,marketplace.search_job_postings,marketplace.set_job_posting_status,marketplace.submit_expression_of_interest"
    [[ "$CHANGED" == "$EXPECTED_CHANGED" ]] || { echo "POST-STAGE CHECK FAILED: 31 changed [$CHANGED], expected [$EXPECTED_CHANGED]" | tee -a "$LOG" >&2; exit 1; }
    echo "  check ok: 31 redefines exactly can_view_landing_private and respond_to_interest (31-P1), list_marketplace_jobs, search_job_postings and submit_expression_of_interest (31-R), and reconfirm_job_posting, set_job_posting_status and reactivate_job_posting (31-O)" | tee -a "$LOG"
    ACL_CHANGED="$(LC_ALL=C join -t'|' "$LOG_DIR/stage31-acl-before.txt" "$LOG_DIR/stage31-acl-after.txt" | awk -F'|' '$2 != $3 {print $1}' | paste -sd, -)"
    [[ -z "$ACL_CHANGED" ]] || { echo "POST-STAGE CHECK FAILED: 31 changed the grants of [$ACL_CHANGED]" | tee -a "$LOG" >&2; exit 1; }
    echo "  check ok: no existing function's grants changed" | tee -a "$LOG"
    TABLES_DIFF="$(LC_ALL=C comm -3 "$LOG_DIR/stage31-tables-before.txt" "$LOG_DIR/stage31-tables-after.txt" | tr -d '\t' | paste -sd, -)"
    [[ "$TABLES_DIFF" == "notification_unsubscribe_keys,notification_unsubscribe_uses" ]] || { echo "POST-STAGE CHECK FAILED: 31 changed the table list by [$TABLES_DIFF]" | tee -a "$LOG" >&2; exit 1; }
    echo "  check ok: 31 adds exactly the tables notification_unsubscribe_keys and notification_unsubscribe_uses" | tee -a "$LOG"
    POLICY_DIFF="$(LC_ALL=C comm -3 <(cut -d'|' -f1 "$LOG_DIR/stage31-policies-before.txt") <(cut -d'|' -f1 "$LOG_DIR/stage31-policies-after.txt") | tr -d '\t' | paste -sd, -)"
    POLICY_CHANGED="$(LC_ALL=C join -t'|' "$LOG_DIR/stage31-policies-before.txt" "$LOG_DIR/stage31-policies-after.txt" | awk -F'|' '$2 != $3 {print $1}' | paste -sd, -)"
    [[ -z "$POLICY_DIFF" && "$POLICY_CHANGED" == "expressions_of_interest.interests_hauler_insert,promotion_redemptions.promotion_redemptions_read,promotions.promotions_read" ]] || { echo "POST-STAGE CHECK FAILED: 31 added or dropped policies [$POLICY_DIFF] and changed [$POLICY_CHANGED]" | tee -a "$LOG" >&2; exit 1; }
    echo "  check ok: 31 adds and drops no policy and changes exactly interests_hauler_insert (31-R) and promotion_redemptions_read and promotions_read (31-F)" | tee -a "$LOG"
    check "31-P1: can_view_landing_private asks for a replied inquiry, and respond_to_interest refuses sharing before a reply" "select (select prosrc like '%e.status = ''replied''%' and prosrc not like '%not in (''withdrawn'', ''declined'')%' from pg_proc where oid = 'marketplace.can_view_landing_private(uuid)'::regprocedure) and (select prosrc like '%Reply to this inquiry before sharing%' from pg_proc where oid = 'marketplace.respond_to_interest(uuid, text, boolean, uuid, text)'::regprocedure);"
    check "31-R: both lists and new interest use the one day-14 rule" "select bool_and(p.prosrc like '%marketplace.job_confirmation_current(%') and count(*) = 3 from pg_proc p where p.pronamespace = 'marketplace'::regnamespace and p.proname in ('list_marketplace_jobs', 'search_job_postings', 'submit_expression_of_interest');"
    check "31-R: a direct INSERT of an inquiry is held to the same rule (interests_hauler_insert asks job_takes_new_interest, authenticated only)" "select (select with_check like '%job_takes_new_interest(job_id)%' from pg_policies where schemaname = 'marketplace' and tablename = 'expressions_of_interest' and policyname = 'interests_hauler_insert') and has_function_privilege('authenticated', 'marketplace.job_takes_new_interest(uuid)', 'EXECUTE') and not has_function_privilege('anon', 'marketplace.job_takes_new_interest(uuid)', 'EXECUTE') and not has_function_privilege('service_role', 'marketplace.job_takes_new_interest(uuid)', 'EXECUTE');"
    check "31-O: the three lifecycle functions answer another business's job as not found" "select bool_and(p.prosrc like '%if not found or not marketplace.has_org_role(v_job.org_id, array[''owner'', ''manager'', ''staff'', ''driver'']) then%') and count(*) = 3 from pg_proc p where p.pronamespace = 'marketplace'::regnamespace and p.proname in ('reconfirm_job_posting', 'set_job_posting_status', 'reactivate_job_posting');"
    check "31-U: unsubscribe_with_token is executable by anon only, issue_unsubscribe_token by service_role only, the helpers by no API role" "select has_function_privilege('anon', 'marketplace.unsubscribe_with_token(text)', 'EXECUTE') and not has_function_privilege('authenticated', 'marketplace.unsubscribe_with_token(text)', 'EXECUTE') and not has_function_privilege('service_role', 'marketplace.unsubscribe_with_token(text)', 'EXECUTE') and has_function_privilege('service_role', 'marketplace.issue_unsubscribe_token(uuid, uuid, text, text, interval)', 'EXECUTE') and not has_function_privilege('authenticated', 'marketplace.issue_unsubscribe_token(uuid, uuid, text, text, interval)', 'EXECUTE') and not has_function_privilege('anon', 'marketplace.issue_unsubscribe_token(uuid, uuid, text, text, interval)', 'EXECUTE') and (select bool_and(not has_function_privilege(r, f, 'EXECUTE')) from unnest(array['marketplace.hmac_sha256(bytea, bytea)', 'marketplace.job_confirmation_current(timestamptz)']::regprocedure[]) f, unnest(array['anon', 'authenticated', 'service_role']) r);"
    check "31-U: unsubscribe_with_token is the only volatile marketplace function anon can execute" "select count(*) = 1 and bool_and(p.proname = 'unsubscribe_with_token') from pg_proc p where p.pronamespace = 'marketplace'::regnamespace and p.provolatile = 'v' and has_function_privilege('anon', p.oid, 'EXECUTE');"
    check "31-U: the key and used-token tables have no policy, and 31 stored no key and no token" "select not exists (select 1 from pg_policies where schemaname = 'marketplace' and tablename like 'notification_unsubscribe_%') and (select count(*) from marketplace.notification_unsubscribe_keys) + (select count(*) from marketplace.notification_unsubscribe_uses) = 0;"
    ;;
  32)
    run_sql "$DIR/32_v2_reply_gate_reconfirmation_unsubscribe_tests.sql"
    grep -q "ALL REPLY GATE, RECONFIRMATION, UNSUBSCRIBE, FOUNDING OFFER AND NOT-FOUND (31-P1, 31-R, 31-U, 31-F, 31-O) TESTS PASSED" "$LOG" || { echo "STAGE 32: suite did not reach its final PASS notice" >&2; exit 1; }
    check "suite rolled back (no test organizations, signing keys or used tokens left)" "select (select count(*) from marketplace.organizations where slug like 's31-%') + (select count(*) from marketplace.notification_unsubscribe_keys) + (select count(*) from marketplace.notification_unsubscribe_uses) = 0;"
    PASSES="$(grep -cE "NOTICE:  00000: PASS: " "$LOG" || true)"
    echo "  executed assertions reporting PASS: $PASSES" | tee -a "$LOG" | tee -a "$SUMMARY"
    [[ "$PASSES" -ge 97 ]] || { echo "STAGE 32: only $PASSES PASS notices; expected at least 97" >&2; exit 1; }
    # Regression: the earlier suites run again on the 31 schema, 30 (29's suite, whose sharing steps 31-P1 changes)
    # included. 24 pins the ledger at 23 and is not re-run; its rules run again through 17, 19 and 21.
    while IFS='|' read -r SUITE NOTICE; do
      RLOG="$LOG_DIR/stage32-rerun-${SUITE%%_*}.log"
      echo "== psql -X -v ON_ERROR_STOP=1 -f $SUITE (again, on the 31 schema)" | tee "$RLOG"
      psql "$LOGLOADS_DISPOSABLE_DB_URL" -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -f "$DIR/$SUITE" >> "$RLOG" 2>&1 \
        || { echo "STAGE 32: $SUITE failed on the 31 schema (see $RLOG)" | tee -a "$LOG" >&2; tail -n 30 "$RLOG" >&2; exit 1; }
      grep -qF "$NOTICE" "$RLOG" || { echo "STAGE 32: $SUITE did not reach its final PASS notice on the 31 schema" | tee -a "$LOG" >&2; exit 1; }
      echo "  check ok: $SUITE passes again on the 31 schema" | tee -a "$LOG" | tee -a "$SUMMARY"
    done <<'SUITES'
04_tests.sql|PASS: All normalized-v2 integration
07_v2_contract_tests.sql|ALL V2 CONTRACT ALIGNMENT & FOUNDER DECISION (V2-DEC-01..03) TESTS PASSED
09_v2_integration_audit_tests.sql|ALL V2 INTEGRATION AUDIT TESTS PASSED
13_v2_phase3_tests.sql|ALL PHASE 3 POLICY (F1-F5) AND BILLING-ORDERING TESTS PASSED
21_v2_auth_claims_membership_tests.sql|ALL IDENTITY-CLAIM AND MEMBERSHIP-REVOCATION (#112 DATABASE LAYER) TESTS PASSED
17_v2_identity_membership_tests.sql|ALL IDENTITY, MEMBERSHIP AND QUALIFICATION (B-1, B-2, B-5) TESTS PASSED
19_v2_review_106_tests.sql|ALL REVIEW-106 HARDENING (HF-03, HF-05, HF-06, HF-15, HF-16, HF-17, HF-18) TESTS PASSED
27_v2_team_seats_saved_jobs_outbox_tests.sql|ALL SEAT INVITATION, LANDING SCOPE, SAVED JOB AND NOTIFICATION OUTBOX (26-A..26-D) TESTS PASSED
30_v2_landing_scope_hardening_tests.sql|ALL LANDING-SCOPE HARDENING (29-P2, 29-P3) TESTS PASSED
SUITES
    check "the re-run suites rolled back (no test organizations left)" "select count(*) = 0 from marketplace.organizations;"
    ;;
  *) echo "unknown stage $STAGE" >&2; exit 2 ;;
esac

echo "STAGE $STAGE PASSED" | tee -a "$LOG"
echo "- Stage $STAGE: **PASS**" >> "$SUMMARY"
