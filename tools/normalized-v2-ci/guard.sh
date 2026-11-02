#!/usr/bin/env bash
# =============================================================================
# Fail-closed disposable-database guard for the normalized-v2 CI suite.
#
#   guard.sh provision   — run once, right after the CI service starts: proves the
#                          target is a brand-new, empty, local PostgreSQL 17 cluster,
#                          then stamps it with a per-run marker and records the
#                          cluster's system identifier.
#   guard.sh verify      — run before every destructive stage: re-proves the target
#                          is the same stamped cluster.
#
# A localhost URL alone is NOT accepted as proof of disposability. Every check must
# pass or the script exits non-zero before any SQL that could create or drop objects.
# Nothing here prints the connection password.
# =============================================================================
set -euo pipefail

MODE="${1:-}"
STATE_DIR="${RUNNER_TEMP:-/tmp}/normalized-v2-ci"
MARKER_FILE="$STATE_DIR/system_identifier"

fail() { echo "GUARD REFUSED: $*" >&2; exit 2; }

[[ "$MODE" == "provision" || "$MODE" == "verify" ]] || fail "usage: guard.sh provision|verify"

# --- 1. Execution environment -------------------------------------------------
[[ "${GITHUB_ACTIONS:-}" == "true" ]] || fail "not running on GitHub Actions"
[[ "${LOGLOADS_DB_ENV:-}" == "ci-disposable" ]] || fail "LOGLOADS_DB_ENV must be 'ci-disposable'"
[[ -n "${GITHUB_RUN_ID:-}" && -n "${GITHUB_RUN_ATTEMPT:-}" ]] || fail "missing GitHub run identity"

# --- 2. Connection string: exact disposable shape, no overrides ---------------
DB_URL="${LOGLOADS_DISPOSABLE_DB_URL:-}"
[[ -n "$DB_URL" ]] || fail "LOGLOADS_DISPOSABLE_DB_URL is not set"
[[ "$DB_URL" =~ ^postgresql://postgres:[A-Za-z0-9_-]+@127\.0\.0\.1:5432/logloads_test$ ]] \
  || fail "LOGLOADS_DISPOSABLE_DB_URL must be exactly postgresql://postgres:<ci-password>@127.0.0.1:5432/logloads_test (no query parameters)"

# libpq environment variables that could redirect or re-target a connection.
for var in PGHOST PGHOSTADDR PGPORT PGDATABASE PGSERVICE PGSERVICEFILE PGSSLMODE PGREQUIREAUTH PGTARGETSESSIONATTRS; do
  [[ -z "${!var:-}" ]] || fail "$var must not be set in the disposable test environment"
done
case "$DB_URL" in
  *supabase*|*amazonaws*|*neon.tech*|*render.com*|*azure*|*googleapis*) fail "connection string names a hosted provider" ;;
esac

q() { printf '%s\n' "$1" | psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1; }

# --- 3. Server identity -------------------------------------------------------
[[ "$(q 'select current_database();')" == "logloads_test" ]] || fail "connected database is not logloads_test"
[[ "$(q 'show server_version_num;')" =~ ^17[0-9]{4}$ ]] || fail "server is not PostgreSQL 17"
UPTIME_S="$(q "select floor(extract(epoch from now() - pg_postmaster_start_time()))::int;")"
SYSID="$(q 'select system_identifier from pg_control_system();')"
MARKER="logloads-ci-disposable:${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}:${GITHUB_JOB:-job}:${LOGLOADS_CI_ITERATION:-0}"

if [[ "$MODE" == "provision" ]]; then
  # A freshly started service container: postmaster started minutes ago.
  (( UPTIME_S < 900 )) || fail "server has been up ${UPTIME_S}s; expected a freshly started CI service"
  # Empty database: no application schemas or user tables yet (PostGIS image schemas allowed).
  USER_TABLES="$(q "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema','public','topology','tiger','tiger_data','pg_toast');")"
  PUBLIC_TABLES="$(q "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where c.relkind in ('r','p') and n.nspname = 'public' and c.relname <> 'spatial_ref_sys';")"
  [[ "$USER_TABLES" == "0" && "$PUBLIC_TABLES" == "0" ]] || fail "database is not empty (tables: schemas=$USER_TABLES public=$PUBLIC_TABLES)"
  [[ "$(q "select count(*) from pg_namespace where nspname = 'marketplace';")" == "0" ]] || fail "marketplace schema already exists"
  EXISTING="$(q "select coalesce(shobj_description(oid, 'pg_database'), '') from pg_database where datname = current_database();")"
  [[ -z "$EXISTING" ]] || fail "database already carries a comment/marker"
  q "comment on database logloads_test is '${MARKER}';" >/dev/null
  mkdir -p "$STATE_DIR"
  printf '%s\n' "$SYSID" > "$MARKER_FILE"
  echo "GUARD: provisioned fresh disposable cluster (uptime ${UPTIME_S}s, PostgreSQL $(q 'show server_version;'))"
  exit 0
fi

# verify
[[ -f "$MARKER_FILE" ]] || fail "no provisioning record; run 'guard.sh provision' first"
[[ "$SYSID" == "$(cat "$MARKER_FILE")" ]] || fail "cluster system identifier changed since provisioning"
ACTUAL_MARKER="$(q "select coalesce(shobj_description(oid, 'pg_database'), '') from pg_database where datname = current_database();")"
[[ "$ACTUAL_MARKER" == "$MARKER" ]] || fail "disposable marker missing or different"
echo "GUARD: verified disposable cluster marker for run ${GITHUB_RUN_ID} attempt ${GITHUB_RUN_ATTEMPT}"
