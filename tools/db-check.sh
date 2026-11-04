#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v supabase >/dev/null 2>&1; then
  if [[ "${CI:-}" == "true" ]]; then
    echo "Supabase CLI is required in CI; migration validation cannot be skipped."
    exit 1
  fi

  echo "Supabase CLI not installed; skipping migration check."
  echo "Install Supabase CLI and run 'supabase db reset --local' from ${repo_root} to validate migrations locally."
  exit 0
fi

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  if [[ "${CI:-}" == "true" ]]; then
    echo "A reachable Docker daemon is required in CI; migration validation cannot be skipped."
    exit 1
  fi

  echo "Docker is not installed or its daemon is unreachable; skipping the local Supabase migration check."
  echo "Start Docker and rerun 'supabase db reset --local' from ${repo_root} to validate migrations locally."
  exit 0
fi

cd "$repo_root"

status_json="$(supabase status --output json 2>/dev/null || true)"

if ! grep -q '"API_URL"' <<<"$status_json"; then
  if grep -q '"DB_URL"' <<<"$status_json"; then
    echo "Replacing the database-only LogLoads stack with its isolated API stack."
    supabase stop --project-id logloads-local --no-backup >/dev/null 2>&1
  fi

  echo "Starting the isolated LogLoads Supabase stack for migration and E2E validation."
  if ! supabase start \
    --exclude edge-runtime,imgproxy,logflare,mailpit,realtime,storage-api,studio,supavisor,vector \
    --debug >/dev/null 2>&1; then
    echo "The isolated LogLoads Supabase stack failed to start."
    exit 1
  fi
fi

supabase db reset --local

# Behavioural checks against the freshly reset database (supabase/verify/*.sql). Each file runs as the migration
# role inside one transaction that it rolls back, so the stack is left exactly as the reset produced it. psql runs
# inside the stack's own database container, so no client needs to be installed on the host. On a failure the
# container's recent log is printed, because a lost connection otherwise reports no cause.
db_container="supabase_db_logloads-local"
shopt -s nullglob
for check in supabase/verify/*.sql; do
  echo "Running database check ${check}"
  if ! docker exec -i -e PGPASSWORD=postgres "$db_container" \
    psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres -f - <"$check"; then
    echo "Database check ${check} failed; recent database log:"
    docker logs --tail 40 "$db_container" 2>&1 || true
    exit 1
  fi
done
