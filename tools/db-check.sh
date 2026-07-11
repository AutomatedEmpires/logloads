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

if ! command -v docker >/dev/null 2>&1; then
  if [[ "${CI:-}" == "true" ]]; then
    echo "Docker is required in CI; migration validation cannot be skipped."
    exit 1
  fi

  echo "Docker is not available; skipping local Supabase migration check."
  echo "Install Docker and rerun 'supabase db reset --local' from ${repo_root} to validate migrations locally."
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
