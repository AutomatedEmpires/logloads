#!/usr/bin/env bash
# =============================================================================
# LogLoads normalized-v2 — 10 migration-path test for 06_v2_contract_alignment.sql
#
# NON-ACTIVE PROTOTYPE TEST HARNESS. Disposable PostgreSQL only; same fail-closed target checks as 05/08.
# Applies 06 on top of a baseline that already holds an active job (created the baseline way, before
# V2-DEC-03 existed) and proves 06 does not fabricate an availability confirmation for it: the row
# becomes an audited legacy import, keeps exactly the confirmation it had, and gets no attestation.
# =============================================================================
set -euo pipefail

DB_URL="${LOGLOADS_DISPOSABLE_DB_URL:-}"
[[ -n "$DB_URL" ]] || { echo "ERROR: Missing LOGLOADS_DISPOSABLE_DB_URL." >&2; exit 1; }
[[ "$DB_URL" =~ ^postgres(ql)?://([^@/]+@)?(127\.0\.0\.1|localhost)(:[0-9]+)?/[A-Za-z0-9_]+$ ]] \
  || { echo "ERROR: Refusing to run: LOGLOADS_DISPOSABLE_DB_URL must be a local URL with a plain database name." >&2; exit 1; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
q() { printf '%s\n' "$1" | psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1; }
x() { printf '%s\n' "$1" | psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 >/dev/null; }
fail() { echo "ERROR: $*" >&2; exit 1; }
expect_eq() { [[ "$2" == "$3" ]] || fail "$1: expected '$3', got '$2'"; }

[[ "$(q "select current_database();")" == "${LOGLOADS_DISPOSABLE_DB_NAME:-logloads_test}" ]] || fail "Refusing to run: unexpected database."
FOREIGN="$(q "select coalesce(string_agg(format('%I.%I', n.nspname, c.relname), ', '), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema','pg_toast','marketplace','topology','tiger','tiger_data')
  and not (n.nspname in ('public','extensions') and c.relname = 'spatial_ref_sys');")"
[[ -z "$FOREIGN" ]] || fail "Refusing to run: foreign tables present: $FOREIGN"
MARK="$(q "select coalesce(shobj_description(oid, 'pg_database'), '') from pg_database where datname = current_database();")"
[[ "$MARK" == logloads-ci-disposable:* || "${LOGLOADS_LOCAL_DISPOSABLE_CONFIRM:-}" == "drop-marketplace-schema" ]] \
  || fail "Refusing to run: database is not stamped as a CI disposable database."

echo "[1/3] Building the baseline schema (01 -> 02 -> 03) with a pre-V2 active job..."
x "drop schema if exists marketplace cascade;"
for f in 01_schema.sql 02_access.sql 03_entitlements.sql; do psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/$f" >/dev/null; done
x "
insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true);
do \$\$
declare v_org uuid; v_land uuid;
begin
  perform set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
  set local role service_role;
  perform marketplace.sync_verified_identity('https://clerk.logloads.test', 'mig_owner', 'Mig Owner', 'mig@m.test', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', 'mig_owner',
    'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;
  v_org := marketplace.create_organization('Mig Timber', 'mig-timber', 'OR', false);
  perform set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
  set local role service_role;
  perform marketplace.open_subscription_cycle(v_org, 'basic', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_m', 'sub_m', false, 7, false);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', 'mig_owner',
    'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (v_org, 'Mig Landing', 'active', 'Near Oakridge, OR', extensions.st_GeogFromText('SRID=4326;POINT(-122.5 43.7)'), 'OR')
  returning id into v_land;
  insert into marketplace.job_postings (org_id, landing_id, title, pay_amount_cents, pay_unit, trucks_requested, status)
  values (v_org, v_land, 'Pre-V2 Active Job', 9000, 'per_ton', 3, 'active');
  reset role;
end
\$\$;"
JOB="$(q "select id from marketplace.job_postings where title = 'Pre-V2 Active Job';")"
BEFORE="$(q "select coalesce(last_confirmed_at::text, 'null') from marketplace.job_postings where id = '${JOB}'::uuid;")"
echo "  pre-V2 job ${JOB}: last_confirmed_at before 06 = ${BEFORE}"

echo "[2/3] Applying 06_v2_contract_alignment.sql on top of existing data..."
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/06_v2_contract_alignment.sql" >/dev/null

echo "[3/3] Asserting the pre-V2 job was not given a fabricated confirmation..."
expect_eq "pre-V2 job marked as a legacy import" "$(q "select is_legacy_import from marketplace.job_postings where id = '${JOB}'::uuid;")" "t"
expect_eq "audited legacy-import record" "$(q "select count(*) from marketplace.legacy_job_imports where job_id = '${JOB}'::uuid and reason ilike '%never explicitly attested%';")" "1"
expect_eq "no attestation invented" "$(q "select count(*) from marketplace.job_publication_attestations where job_id = '${JOB}'::uuid;")" "0"
expect_eq "confirmation unchanged by the migration" "$(q "select coalesce(last_confirmed_at::text, 'null') from marketplace.job_postings where id = '${JOB}'::uuid;")" "$BEFORE"
expect_eq "no confirmer invented" "$(q "select coalesce(last_confirmed_by::text, 'null') from marketplace.job_postings where id = '${JOB}'::uuid;")" \
  "$(q "select case when '${BEFORE}' = 'null' then 'null' else coalesce(last_confirmed_by::text, 'null') end from marketplace.job_postings where id = '${JOB}'::uuid;")"
x "drop schema if exists marketplace cascade;"
echo "MIGRATION PATH TEST PASSED."
