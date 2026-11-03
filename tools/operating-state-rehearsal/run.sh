#!/usr/bin/env bash
# =============================================================================
# Rehearse an operating-state backup -> wipe -> restore on the repository's DISPOSABLE local Supabase stack.
#
#   pnpm db:check                                  # fresh stack, repository migrations applied
#   bash tools/operating-state-rehearsal/run.sh    # the rehearsal (rehearsal.mjs)
#
# Finds the stack with `supabase status`, which only ever reports the local stack named by supabase/config.toml,
# refuses anything but a loopback API URL, and clears every Supabase variable from the operator's shell so the
# rehearsal cannot reach any other project. Uses no access token and no repository secret. The local key is
# masked in GitHub Actions logs.
# =============================================================================
set -euo pipefail

refuse() {
  echo "operating-state rehearsal refused: $1" >&2
  exit 2
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

[[ -z "${SUPABASE_ACCESS_TOKEN:-}" && -z "${SUPABASE_DB_PASSWORD:-}" ]] ||
  refuse "a Supabase access token or database password is present; run in a shell without them"
command -v supabase >/dev/null 2>&1 || refuse "the Supabase CLI is required to find the local stack"

status_json="$(supabase status --output json 2>/dev/null || true)"

# The first non-empty field among the names given (the CLI has renamed some across versions).
field() {
  STATUS_JSON="$status_json" node -e '
    let status = {}
    try { status = JSON.parse(process.env.STATUS_JSON || "{}") } catch {}
    const value = process.argv.slice(1).map((name) => status[name]).find((v) => typeof v === "string" && v)
    process.stdout.write(value || "")
  ' "$@"
}

api_url="$(field API_URL PROJECT_URL)"
service_key="$(field SERVICE_ROLE_KEY SECRET_KEY)"

[[ -n "$service_key" ]] || refuse "the local stack reported no service-role key; start it with pnpm db:check"
if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  echo "::add-mask::$service_key"
fi
[[ "$api_url" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+$ ]] || refuse "the stack's API URL is not a loopback address"

while IFS= read -r name; do
  unset "$name"
done < <(compgen -e | grep -E '^(SUPABASE_|LOGLOADS_SUPABASE_)' || true)

export LOGLOADS_REHEARSAL_SUPABASE_URL="$api_url"
export LOGLOADS_REHEARSAL_SERVICE_ROLE_KEY="$service_key"

echo "rehearsing on the local stack at ${api_url} (project reference: local)"
exec pnpm exec vitest run --config tools/operating-state-rehearsal/vitest.config.mjs
