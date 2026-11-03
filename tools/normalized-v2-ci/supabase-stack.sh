#!/usr/bin/env bash
# =============================================================================
# Starts / stops the disposable Supabase local stack used by the normalized-v2 Supabase job.
#
#   supabase-stack.sh start  — creates a throwaway CLI project under $RUNNER_TEMP (never the
#                              repository's supabase/ directory), pins PostgreSQL 17, exposes the
#                              `marketplace` schema through PostgREST, starts only the database,
#                              PostgREST and the API gateway, and exports the stack's generated
#                              local API URL / keys to later steps (masked in logs).
#   supabase-stack.sh stop   — stops the stack and deletes its volumes.
#
# Refuses to run outside GitHub Actions. Uses no Supabase access token and links no project.
# =============================================================================
set -euo pipefail
MODE="${1:-}"
[[ "${GITHUB_ACTIONS:-}" == "true" ]] || { echo "refusing: not running on GitHub Actions" >&2; exit 2; }
[[ "${LOGLOADS_DB_ENV:-}" == "supabase-local-ci" ]] || { echo "refusing: LOGLOADS_DB_ENV must be supabase-local-ci" >&2; exit 2; }
[[ -z "${SUPABASE_ACCESS_TOKEN:-}" && -z "${SUPABASE_DB_PASSWORD:-}" ]] || { echo "refusing: a Supabase access token or DB password is present" >&2; exit 2; }
PROJECT_ID="${LOGLOADS_SUPABASE_PROJECT_ID:?}"
WORK="${RUNNER_TEMP:?}/supabase-stack"

case "$MODE" in
  start)
    rm -rf "$WORK"; mkdir -p "$WORK"; cd "$WORK"
    supabase init --force >/dev/null
    CFG="supabase/config.toml"
    [[ -f "$CFG" ]] || { echo "supabase init produced no config.toml" >&2; exit 1; }
    # Project id names the containers (supabase_db_<id>) the guard later verifies.
    sed -i -E "s/^project_id = .*/project_id = \"${PROJECT_ID}\"/" "$CFG"
    # PostgreSQL 17, the marketplace schema exposed through PostgREST, unneeded services off.
    sed -i -E '/^\[db\]/,/^\[/ s/^major_version = .*/major_version = 17/' "$CFG"
    sed -i -E '/^\[api\]/,/^\[/ s/^schemas = .*/schemas = ["public", "graphql_public", "marketplace"]/' "$CFG"
    for section in studio inbucket storage realtime edge_runtime analytics; do
      sed -i -E "/^\[${section}\]/,/^\[/ s/^enabled = true/enabled = false/" "$CFG"
    done
    echo "== effective stack configuration"
    grep -nE '^(project_id|major_version|schemas|extra_search_path|max_rows) ' "$CFG" || true
    grep -nE '^\[(db|api|studio|inbucket|storage|realtime|edge_runtime|analytics)\]' -A1 "$CFG" | grep -E 'enabled|\[' || true

    # PostgREST refuses to become healthy while an exposed schema is missing. A real project must also create
    # a schema before exposing it, so the stack starts with an EMPTY marketplace schema (the guard verifies it
    # holds no objects); 01_schema.sql then populates it with `create schema if not exists`.
    mkdir -p supabase/migrations
    cat > supabase/migrations/00000000000000_empty_marketplace_schema.sql <<'SQL'
-- CI stack bootstrap: empty schema so PostgREST can expose it. Populated by 01_schema.sql.
create schema if not exists marketplace;
SQL

    # Auth (gotrue) stays: the CLI only reports the API keys and JWT secret when it runs, as a real project would.
    supabase start -x realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor

    STATUS_JSON="$(supabase status -o json 2>/dev/null)"
    get() { printf '%s' "$STATUS_JSON" | jq -r --arg k "$1" '.[$k] // empty'; }
    API_URL="$(get API_URL)"; ANON="$(get ANON_KEY)"; SERVICE="$(get SERVICE_ROLE_KEY)"; JWT_SECRET="$(get JWT_SECRET)"
    # Fallback: the secret PostgREST itself verifies JWTs with (its container environment).
    if [[ -z "$JWT_SECRET" ]]; then
      JWT_SECRET="$(docker inspect "supabase_rest_${PROJECT_ID}" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^PGRST_JWT_SECRET=//p' | head -1)"
    fi
    for v in "$ANON" "$SERVICE" "$JWT_SECRET"; do [[ -n "$v" ]] && echo "::add-mask::$v"; done
    echo "status keys reported by the CLI: $(printf '%s' "$STATUS_JSON" | jq -r 'keys | join(", ")')"
    [[ "$API_URL" =~ ^http://127\.0\.0\.1:[0-9]+$ ]] || { echo "unexpected API URL shape" >&2; exit 1; }
    [[ -n "$ANON" && -n "$JWT_SECRET" ]] || { echo "stack did not report an anon key and JWT secret" >&2; exit 1; }
    {
      echo "LOGLOADS_SUPABASE_API_URL=$API_URL"
      echo "LOGLOADS_SUPABASE_ANON_KEY=$ANON"
      echo "LOGLOADS_SUPABASE_SERVICE_ROLE_KEY=$SERVICE"
      echo "LOGLOADS_SUPABASE_JWT_SECRET=$JWT_SECRET"
    } >> "$GITHUB_ENV"
    echo "stack started: API ${API_URL}, database container supabase_db_${PROJECT_ID}"
    ;;
  stop)
    [[ -d "$WORK" ]] || exit 0
    cd "$WORK"
    supabase stop --no-backup || true
    ;;
  *) echo "usage: supabase-stack.sh start|stop" >&2; exit 2 ;;
esac
