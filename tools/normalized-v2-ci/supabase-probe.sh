#!/usr/bin/env bash
# =============================================================================
# Read-only evidence probe for the disposable Supabase local stack started by CI.
# Prints the facts the normalized-v2 verification depends on: server and extension versions,
# the real attributes and memberships of Supabase's API roles, database ownership, and the
# PostgREST configuration. Never prints keys, secrets or passwords. Makes no changes.
# =============================================================================
set -euo pipefail
DB_URL="${LOGLOADS_DISPOSABLE_DB_URL:?}"
q() { printf '%s\n' "$1" | psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1; }

echo "== server"
q "select version();"
q "select 'current_user=' || current_user || ' session_user=' || session_user || ' database=' || current_database();"
q "select 'database owner=' || pg_get_userbyid(datdba) from pg_database where datname = current_database();"

echo "== roles (attributes)"
q "select rolname || ' super=' || rolsuper || ' bypassrls=' || rolbypassrls || ' login=' || rolcanlogin || ' inherit=' || rolinherit || ' createrole=' || rolcreaterole
   from pg_roles where rolname in ('postgres','supabase_admin','authenticator','anon','authenticated','service_role','supabase_auth_admin','supabase_storage_admin')
   order by 1;"

echo "== role memberships (member -> role, admin option, inherit, set)"
q "select pg_get_userbyid(m.member) || ' -> ' || pg_get_userbyid(m.roleid) || ' admin=' || m.admin_option || ' inherit=' || m.inherit_option || ' set=' || m.set_option
   from pg_auth_members m
   where pg_get_userbyid(m.roleid) in ('anon','authenticated','service_role','authenticator','postgres')
      or pg_get_userbyid(m.member) in ('anon','authenticated','service_role','authenticator','postgres')
   order by 1;"

echo "== role-level settings"
q "select coalesce(pg_get_userbyid(setrole), '*') || ': ' || array_to_string(setconfig, ', ') from pg_db_role_setting order by 1;" || true

echo "== extensions (installed)"
q "select extname || ' ' || extversion || ' in ' || extnamespace::regnamespace from pg_extension order by 1;"
echo "== extensions (available, relevant)"
q "select name || ' default=' || coalesce(default_version, '-') || ' installed=' || coalesce(installed_version, '-') from pg_available_extensions where name in ('postgis','btree_gist','pgcrypto','pg_net','pg_cron','pgsodium','supabase_vault','pg_graphql') order by 1;"
q "select 'supautils loaded: ' || (current_setting('shared_preload_libraries') ~ 'supautils')::text;"
q "select 'supautils.reserved_roles=' || coalesce(current_setting('supautils.reserved_roles', true), '(unset)');"
q "select 'supautils.privileged_extensions=' || coalesce(current_setting('supautils.privileged_extensions', true), '(unset)');"

echo "== schemas"
q "select string_agg(nspname, ', ' order by nspname) from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema';"
q "select 'tables in public: ' || count(*) from pg_tables where schemaname = 'public';"

echo "== permission probes (each rolled back)"
for stmt in \
  "comment on database postgres is 'probe'" \
  "create role logloads_probe_owner nologin" \
  "grant authenticated to postgres" \
  "set local role authenticated" \
  "set local role service_role" \
  "set local role anon" \
  "set local role authenticator" \
  "create extension if not exists postgis with schema extensions" \
  "create extension if not exists btree_gist with schema extensions"; do
  if out="$(printf 'begin;\n%s;\nrollback;\n' "$stmt" | psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 2>&1)"; then
    echo "  ok      : $stmt"
  else
    echo "  refused : $stmt -> $(printf '%s' "$out" | grep -m1 -E 'ERROR' || true)"
  fi
done

echo "== PostgREST (through the local API gateway)"
if [[ -n "${LOGLOADS_SUPABASE_API_URL:-}" && -n "${LOGLOADS_SUPABASE_ANON_KEY:-}" ]]; then
  code="$(curl -s -o /tmp/postgrest_root.json -w '%{http_code}' -H "apikey: ${LOGLOADS_SUPABASE_ANON_KEY}" "${LOGLOADS_SUPABASE_API_URL}/rest/v1/" || true)"
  echo "  GET /rest/v1/ -> HTTP ${code}"
  head -c 300 /tmp/postgrest_root.json 2>/dev/null | tr -d '\n' | sed 's/^/  body: /'; echo
fi
docker ps --format '  container {{.Names}}: {{.Image}} ({{.Status}})' | grep -i supabase || true
