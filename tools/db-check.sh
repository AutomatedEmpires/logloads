#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI not installed; skipping migration check."
  echo "Install Supabase CLI and run 'supabase db reset --local' from ${repo_root} to validate migrations locally."
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not available; skipping local Supabase migration check."
  echo "Install Docker and rerun 'supabase db reset --local' from ${repo_root} to validate migrations locally."
  exit 0
fi

cd "$repo_root"
supabase db reset --local --debug
