#!/usr/bin/env bash
# =============================================================================
# LogLoads normalized-v2 — 22 the #112 auth harness against the Supabase local stack (keyless)
#
# NON-ACTIVE PROTOTYPE TEST HARNESS. Runs ONLY against the disposable Supabase CLI local stack started by the CI
# job (LOGLOADS_DB_ENV=supabase-local-ci, guarded by tools/normalized-v2-ci/guard.sh). Run after
# 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16.
#
# Runs tools/verify-clerk-supabase-auth.mjs --local-stack --require: the same checks the owner runs live with real
# Clerk tokens, here with tokens signed by the stack's own JWT secret standing in for Clerk. Requests go through the
# stack's API gateway and PostgREST, the production request path. It runs twice, to prove the fixture is reused
# and the membership check repeats cleanly. No provider key is used or needed.
# =============================================================================
set -euo pipefail

[[ "${LOGLOADS_DB_ENV:-}" == "supabase-local-ci" ]] || { echo "ERROR: Supabase local stack only." >&2; exit 2; }
DB_URL="${LOGLOADS_DISPOSABLE_DB_URL:?}"
API="${LOGLOADS_SUPABASE_API_URL:?}"
[[ "$API" =~ ^http://127\.0\.0\.1:[0-9]+$ ]] || { echo "ERROR: API must be the local stack on 127.0.0.1." >&2; exit 2; }
[[ -n "${LOGLOADS_SUPABASE_ANON_KEY:-}" && -n "${LOGLOADS_SUPABASE_SERVICE_ROLE_KEY:-}" && -n "${LOGLOADS_SUPABASE_JWT_SECRET:-}" ]] \
  || { echo "ERROR: the local stack's keys and JWT secret are not exported." >&2; exit 2; }
[[ "$(printf 'select coalesce(shobj_description(oid, %s), %s) from pg_database where datname = current_database();' "'pg_database'" "''" \
     | psql "$DB_URL" -X -q -t -A)" == logloads-ci-disposable:* ]] || { echo "ERROR: database not stamped by the guard." >&2; exit 2; }
command -v node >/dev/null || { echo "ERROR: node is not installed in this job." >&2; exit 2; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

q() { printf '%s\n' "$1" | psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1; }

# The issuer the locally signed tokens name, as stage 14 registers it (idempotent).
q "insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
   values ('https://clerk.logloads.test', 'Clerk (CI)', 'logloads-app', true) on conflict (issuer) do nothing;" >/dev/null
q "notify pgrst, 'reload schema';" >/dev/null
for _ in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$API/rest/v1/equipment_types?select=code&limit=1" \
    -H "apikey: $LOGLOADS_SUPABASE_ANON_KEY" -H "Authorization: Bearer $LOGLOADS_SUPABASE_ANON_KEY" -H "Accept-Profile: marketplace")"
  [[ "$code" == "200" ]] && break
  sleep 1
done
[[ "$code" == "200" ]] || { echo "ERROR: PostgREST never exposed the marketplace schema (HTTP $code)." >&2; exit 1; }

harness() {
  SUPABASE_URL="$API" \
  NEXT_PUBLIC_SUPABASE_ANON_KEY="$LOGLOADS_SUPABASE_ANON_KEY" \
  SUPABASE_SERVICE_ROLE_KEY="$LOGLOADS_SUPABASE_SERVICE_ROLE_KEY" \
    node "$ROOT/tools/verify-clerk-supabase-auth.mjs" --local-stack --require
}

users_before="$(q "select count(*) from marketplace.app_users;")"
for attempt in 1 2; do
  echo "[run $attempt/2] tools/verify-clerk-supabase-auth.mjs --local-stack --require"
  harness
done

# Independent checks, straight from the database.
links="$(q "select count(*) from marketplace.identity_links where issuer = 'https://clerk.logloads.test' and subject in ('user_authcheck_a', 'user_authcheck_b');")"
[[ "$links" == "2" ]] || { echo "TEST FAILED: expected 2 linked test identities, found $links" >&2; exit 1; }
created="$(( $(q "select count(*) from marketplace.app_users;") - users_before ))"
(( created <= 2 )) || { echo "TEST FAILED: the runs created $created users; only the two test users may be created" >&2; exit 1; }
orgs="$(q "select count(*) from marketplace.organizations where slug in ('logloads-authcheck-a', 'logloads-authcheck-b');")"
[[ "$orgs" == "2" ]] || { echo "TEST FAILED: expected the 2 fixture organizations to be reused, found $orgs" >&2; exit 1; }
live="$(q "select count(*) from marketplace.organization_memberships m join marketplace.organizations o on o.id = m.org_id
           join marketplace.identity_links l on l.user_id = m.user_id
           where o.slug = 'logloads-authcheck-a' and l.subject = 'user_authcheck_b' and m.status <> 'removed';")"
[[ "$live" == "0" ]] || { echo "TEST FAILED: cleanup left $live live membership(s) of B in A" >&2; exit 1; }
removed="$(q "select count(*) from marketplace.organization_memberships m join marketplace.organizations o on o.id = m.org_id
              join marketplace.identity_links l on l.user_id = m.user_id
              where o.slug = 'logloads-authcheck-a' and l.subject = 'user_authcheck_b' and m.status = 'removed' and m.ended_at is not null;")"
[[ "$removed" == "2" ]] || { echo "TEST FAILED: expected one removed membership per run (2), found $removed" >&2; exit 1; }
echo "  ok: 2 linked identities, $created new user(s), 2 reused fixture organizations, no live membership of B in A, 2 removals recorded"

echo "AUTH HARNESS LOCAL-STACK RUNS PASSED."
