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

project_id="logloads-local"
start_attempts=3

stack_reports_api() {
  local status
  status="$(supabase status --output json 2>/dev/null)" || return 1
  grep -q '"API_URL"' <<<"$status"
}

# Removes what a failed start left behind (containers, volumes and the network), so the next attempt starts from
# nothing and finds the stack's ports (553xx, supabase/config.toml) free. Only this project's stack is touched.
remove_stack() {
  local label="label=com.supabase.cli.project=${project_id}"
  supabase stop --project-id "$project_id" --no-backup >/dev/null 2>&1 || true
  docker ps -aq --filter "$label" | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker volume ls -q --filter "$label" | xargs -r docker volume rm -f >/dev/null 2>&1 || true
  docker network rm "supabase_network_${project_id}" >/dev/null 2>&1 || true
}

# The CLI's debug output stays out of the log while the start succeeds. After a failed attempt its tail is printed
# with anything shaped like a key masked, followed by the stack's containers and anything listening on its ports, so
# a pull failure, a port conflict or an unhealthy container can be told apart (#323).
report_start_failure() {
  local attempt="$1" output="$2"
  echo "::group::supabase start, attempt ${attempt} of ${start_attempts}: the last 60 lines of its output"
  tail -n 60 "$output" | sed -E \
    -e 's/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/[masked-jwt]/g' \
    -e 's/sb_(secret|publishable)_[A-Za-z0-9_-]+/sb_\1_[masked]/g' \
    -e 's/((PASSWORD|SECRET|TOKEN|KEY)[A-Za-z_]*["]?[=:] *["]?)[^ ,"]+/\1[masked]/Ig'
  echo "::endgroup::"
  echo "Stack containers after attempt ${attempt}:"
  docker ps -a --filter "label=com.supabase.cli.project=${project_id}" --format '  {{.Names}}  {{.Status}}' || true
  echo "Listening on the stack's ports (553xx):"
  ss -Hltn 2>/dev/null | grep -E ':553[0-9]{2}\b' || echo "  nothing"
}

status_json="$(supabase status --output json 2>/dev/null || true)"

if ! grep -q '"API_URL"' <<<"$status_json"; then
  if grep -q '"DB_URL"' <<<"$status_json"; then
    echo "Replacing the database-only LogLoads stack with its isolated API stack."
    supabase stop --project-id logloads-local --no-backup >/dev/null 2>&1
  fi

  # A fresh runner occasionally fails one start (an image pull or a container that is not healthy in time). The start
  # is retried a bounded number of times from a clean slate; the migrations and checks below are never retried.
  echo "Starting the isolated LogLoads Supabase stack for migration and E2E validation."
  start_output="$(mktemp)"
  started=false
  for attempt in $(seq 1 "$start_attempts"); do
    if supabase start \
      --exclude edge-runtime,imgproxy,logflare,mailpit,realtime,storage-api,studio,supavisor,vector \
      --debug >"$start_output" 2>&1 && stack_reports_api; then
      started=true
      break
    fi
    report_start_failure "$attempt" "$start_output"
    remove_stack
    if ((attempt < start_attempts)); then
      echo "Retrying the stack start in $((attempt * 15)) s."
      sleep $((attempt * 15))
    fi
  done
  rm -f "$start_output"

  if [[ "$started" != true ]]; then
    echo "The isolated LogLoads Supabase stack failed to start after ${start_attempts} attempts."
    exit 1
  fi
  if ((attempt > 1)); then
    echo "The isolated LogLoads Supabase stack started on attempt ${attempt} of ${start_attempts}."
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
