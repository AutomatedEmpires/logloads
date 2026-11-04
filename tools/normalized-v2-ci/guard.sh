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
# Two disposable targets: the PostGIS service container (ci-disposable) or the Supabase CLI local
# stack started inside this job (supabase-local-ci). Anything else is refused.
TARGET="${LOGLOADS_DB_ENV:-}"
[[ "$TARGET" == "ci-disposable" || "$TARGET" == "supabase-local-ci" ]] \
  || fail "LOGLOADS_DB_ENV must be 'ci-disposable' or 'supabase-local-ci'"
[[ -z "${SUPABASE_ACCESS_TOKEN:-}" && -z "${SUPABASE_DB_PASSWORD:-}" ]] || fail "a Supabase access token or database password is present"
[[ -n "${GITHUB_RUN_ID:-}" && -n "${GITHUB_RUN_ATTEMPT:-}" ]] || fail "missing GitHub run identity"

# --- 2. Connection string: exact disposable shape, no overrides ---------------
DB_URL="${LOGLOADS_DISPOSABLE_DB_URL:-}"
[[ -n "$DB_URL" ]] || fail "LOGLOADS_DISPOSABLE_DB_URL is not set"
if [[ "$TARGET" == "ci-disposable" ]]; then
  EXPECTED_DB="logloads_test"
  [[ "$DB_URL" =~ ^postgresql://postgres:[A-Za-z0-9_-]+@127\.0\.0\.1:5432/logloads_test$ ]] \
    || fail "LOGLOADS_DISPOSABLE_DB_URL must be exactly postgresql://postgres:<ci-password>@127.0.0.1:5432/logloads_test (no query parameters)"
else
  EXPECTED_DB="postgres"
  [[ "$DB_URL" == "postgresql://postgres:postgres@127.0.0.1:54322/postgres" ]] \
    || fail "LOGLOADS_DISPOSABLE_DB_URL must be exactly the Supabase CLI local stack URL on 127.0.0.1:54322"
  # The database must be the container this job's CLI project started — not anything else on the port.
  CONTAINER="supabase_db_${LOGLOADS_SUPABASE_PROJECT_ID:?LOGLOADS_SUPABASE_PROJECT_ID is required}"
  command -v docker >/dev/null || fail "docker is not available to verify the local stack"
  [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" == "true" ]] || fail "$CONTAINER is not running"
  # Supabase's own PostgreSQL 17 image, from any registry the pinned CLI pulls it from. The CLI tries Supabase's
  # public ECR first, then falls back to Supabase's GitHub Container Registry and then Docker Hub (for example when
  # ECR rate-limits the runner). Any other registry or namespace is refused, and so is any tag that is not a plain
  # numeric 17.x release (no suffix, no digest).
  SUPABASE_PG17_IMAGE_RE='^(public\.ecr\.aws/supabase|ghcr\.io/supabase|(docker\.io/)?supabase)/postgres:17(\.[0-9]+)+$'
  [[ "$(docker inspect -f '{{.Config.Image}}' "$CONTAINER")" =~ $SUPABASE_PG17_IMAGE_RE ]] \
    || fail "$CONTAINER is not a Supabase PostgreSQL 17 image"
  docker port "$CONTAINER" 5432/tcp | grep -qE ':54322$' || fail "$CONTAINER does not publish port 54322"
  AGE_S=$(( $(date +%s) - $(date -d "$(docker inspect -f '{{.State.StartedAt}}' "$CONTAINER")" +%s) ))
  (( AGE_S < 2400 )) || fail "$CONTAINER started ${AGE_S}s ago; expected a stack started by this job"
fi

# libpq environment variables that could redirect or re-target a connection.
for var in PGHOST PGHOSTADDR PGPORT PGDATABASE PGSERVICE PGSERVICEFILE PGSSLMODE PGREQUIREAUTH PGTARGETSESSIONATTRS; do
  [[ -z "${!var:-}" ]] || fail "$var must not be set in the disposable test environment"
done
case "$DB_URL" in
  *supabase*|*amazonaws*|*neon.tech*|*render.com*|*azure*|*googleapis*) fail "connection string names a hosted provider" ;;
esac

q() { printf '%s\n' "$1" | psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1; }

# --- 3. Server identity -------------------------------------------------------
[[ "$(q 'select current_database();')" == "$EXPECTED_DB" ]] || fail "connected database is not $EXPECTED_DB"
[[ "$(q 'show server_version_num;')" =~ ^17[0-9]{4}$ ]] || fail "server is not PostgreSQL 17"
UPTIME_S="$(q "select floor(extract(epoch from now() - pg_postmaster_start_time()))::int;")"
SYSID="$(q 'select system_identifier from pg_control_system();')"
MARKER="logloads-ci-disposable:${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}:${GITHUB_JOB:-job}:${LOGLOADS_CI_ITERATION:-0}"

if [[ "$MODE" == "provision" ]]; then
  # A freshly started service container: postmaster started minutes ago.
  (( UPTIME_S < 900 )) || fail "server has been up ${UPTIME_S}s; expected a freshly started CI service"
  # Empty database: no application schemas or user tables yet. PostGIS image schemas are allowed, and on the
  # Supabase stack its own platform schemas (which hold the platform's tables, never ours).
  ALLOWED_SCHEMAS="'pg_catalog','information_schema','public','topology','tiger','tiger_data','pg_toast'"
  if [[ "$TARGET" == "supabase-local-ci" ]]; then
    ALLOWED_SCHEMAS="$ALLOWED_SCHEMAS,'auth','storage','realtime','_realtime','vault','graphql','graphql_public','extensions','pgbouncer','supabase_functions','supabase_migrations'"
  fi
  USER_TABLES="$(q "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where c.relkind in ('r','p') and n.nspname not in (${ALLOWED_SCHEMAS});")"
  PUBLIC_TABLES="$(q "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where c.relkind in ('r','p') and n.nspname = 'public' and c.relname <> 'spatial_ref_sys';")"
  [[ "$USER_TABLES" == "0" && "$PUBLIC_TABLES" == "0" ]] || fail "database is not empty (tables: schemas=$USER_TABLES public=$PUBLIC_TABLES)"
  if [[ "$TARGET" == "supabase-local-ci" ]]; then
    # The stack bootstrap creates an EMPTY marketplace schema so PostgREST can expose it.
    OBJECTS="$(q "select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'marketplace')
                       + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketplace');")"
    [[ "$OBJECTS" == "0" ]] || fail "marketplace schema is not empty ($OBJECTS objects)"
  else
    [[ "$(q "select count(*) from pg_namespace where nspname = 'marketplace';")" == "0" ]] || fail "marketplace schema already exists"
  fi
  EXISTING="$(q "select coalesce(shobj_description(oid, 'pg_database'), '') from pg_database where datname = current_database();")"
  # initdb gives the `postgres` database PostgreSQL's stock comment; on the Supabase stack that exact text (and
  # nothing else) is replaced by the marker. Any other comment means the database was used before: refuse.
  if [[ "$TARGET" == "supabase-local-ci" && "$EXISTING" == "default administrative connection database" ]]; then
    EXISTING=""
  fi
  [[ -z "$EXISTING" ]] || fail "database already carries a comment/marker"
  q "comment on database ${EXPECTED_DB} is '${MARKER}';" >/dev/null
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
