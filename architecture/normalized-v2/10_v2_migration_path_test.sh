#!/usr/bin/env bash
# =============================================================================
# LogLoads normalized-v2 — 10 migration-path test for 06 -> 11 -> 12 on existing data
#
# NON-ACTIVE PROTOTYPE TEST HARNESS. Disposable PostgreSQL only; same fail-closed target checks as 05/08.
# Builds a baseline (01 -> 02 -> 03) holding data created the baseline way, then applies the V2 migrations
# and proves none of them fabricates anything:
#   06  an active pre-V2 job becomes an audited legacy import with exactly the confirmation it had and no
#       attestation; re-snapping coordinates does not refresh a hauler's confirmation or an availability
#       report's time (E6);
#   11  a hauler profile that was public only by the pre-V2 default becomes private, audited (F1), still
#       without touching its confirmation;
#   12  an existing subscription keeps its state, carries no invented provider-event history, and accepts
#       provider events afterwards (R4).
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
expect_eq() { [[ "$2" == "$3" ]] || fail "$1: expected '$3', got '$2'"; echo "  ok: $1"; }

[[ "$(q "select current_database();")" == "${LOGLOADS_DISPOSABLE_DB_NAME:-logloads_test}" ]] || fail "Refusing to run: unexpected database."
# On the guarded Supabase CLI local stack the platform's own schemas hold tables; they are never touched.
PLATFORM=""
if [[ "${LOGLOADS_DB_ENV:-}" == "supabase-local-ci" ]]; then
  PLATFORM=",'auth','storage','realtime','_realtime','vault','graphql','graphql_public','extensions','pgbouncer','supabase_functions','supabase_migrations'"
fi
FOREIGN="$(q "select coalesce(string_agg(format('%I.%I', n.nspname, c.relname), ', '), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema','pg_toast','marketplace','topology','tiger','tiger_data'${PLATFORM})
  and not (n.nspname in ('public','extensions') and c.relname = 'spatial_ref_sys');")"
[[ -z "$FOREIGN" ]] || fail "Refusing to run: foreign tables present: $FOREIGN"
MARK="$(q "select coalesce(shobj_description(oid, 'pg_database'), '') from pg_database where datname = current_database();")"
[[ "$MARK" == logloads-ci-disposable:* || "${LOGLOADS_LOCAL_DISPOSABLE_CONFIRM:-}" == "drop-marketplace-schema" ]] \
  || fail "Refusing to run: database is not stamped as a CI disposable database."

echo "[1/5] Building the baseline schema (01 -> 02 -> 03) with pre-V2 data..."
x "drop schema if exists marketplace cascade;"
for f in 01_schema.sql 02_access.sql 03_entitlements.sql; do psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/$f" >/dev/null; done
x "
insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true);
do \$\$
declare v_org uuid; v_haul uuid; v_land uuid;
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
  -- A pre-V2 hauling business: public by the baseline default, off-grid service centre, one availability report.
  v_haul := marketplace.create_organization('Mig Hauling', 'mig-hauling', 'OR', true);
  update marketplace.hauler_profiles
  set headline = 'Pre-V2 fleet', service_center = extensions.st_GeogFromText('SRID=4326;POINT(-122.73 44.46)')
  where org_id = v_haul;
  insert into marketplace.availability_reports
    (org_id, equipment_code, available_count, area_center, area_label, radius_miles, available_from, available_until)
  values (v_haul, 'log_truck', 2, extensions.st_GeogFromText('SRID=4326;POINT(-122.73 44.46)'), 'Lowell', 50, current_date, current_date + 10);
  reset role;
end
\$\$;"
# Backdate the hauler's own confirmation and report (their guard triggers would stamp now()), so any
# migration refresh of those times is visible.
x "alter table marketplace.hauler_profiles disable trigger hauler_profile_guard;
   alter table marketplace.availability_reports disable trigger availability_guard;
   update marketplace.hauler_profiles set last_confirmed_at = now() - interval '9 days'
   where org_id = (select id from marketplace.organizations where slug = 'mig-hauling');
   update marketplace.availability_reports set reported_at = now() - interval '4 days'
   where org_id = (select id from marketplace.organizations where slug = 'mig-hauling');
   alter table marketplace.hauler_profiles enable trigger hauler_profile_guard;
   alter table marketplace.availability_reports enable trigger availability_guard;"
JOB="$(q "select id from marketplace.job_postings where title = 'Pre-V2 Active Job';")"
HAUL="$(q "select id from marketplace.organizations where slug = 'mig-hauling';")"
BEFORE="$(q "select coalesce(last_confirmed_at::text, 'null') from marketplace.job_postings where id = '${JOB}'::uuid;")"
HAUL_CONFIRMED="$(q "select last_confirmed_at::text from marketplace.hauler_profiles where org_id = '${HAUL}'::uuid;")"
REPORTED="$(q "select reported_at::text from marketplace.availability_reports where org_id = '${HAUL}'::uuid;")"
expect_eq "baseline hauler profile is public by the pre-V2 default" "$(q "select is_public from marketplace.hauler_profiles where org_id = '${HAUL}'::uuid;")" "t"
echo "  pre-V2 job ${JOB}: last_confirmed_at = ${BEFORE}; hauler confirmed ${HAUL_CONFIRMED}; report ${REPORTED}"

echo "[2/5] Applying 06_v2_contract_alignment.sql on top of existing data..."
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/06_v2_contract_alignment.sql" >/dev/null

echo "[3/5] Asserting 06 fabricated nothing..."
expect_eq "pre-V2 job marked as a legacy import" "$(q "select is_legacy_import from marketplace.job_postings where id = '${JOB}'::uuid;")" "t"
expect_eq "audited legacy-import record" "$(q "select count(*) from marketplace.legacy_job_imports where job_id = '${JOB}'::uuid and reason ilike '%never explicitly attested%';")" "1"
expect_eq "no attestation invented" "$(q "select count(*) from marketplace.job_publication_attestations where job_id = '${JOB}'::uuid;")" "0"
expect_eq "confirmation unchanged by the migration" "$(q "select coalesce(last_confirmed_at::text, 'null') from marketplace.job_postings where id = '${JOB}'::uuid;")" "$BEFORE"
expect_eq "no confirmer invented" "$(q "select coalesce(last_confirmed_by::text, 'null') from marketplace.job_postings where id = '${JOB}'::uuid;")" \
  "$(q "select case when '${BEFORE}' = 'null' then 'null' else coalesce(last_confirmed_by::text, 'null') end from marketplace.job_postings where id = '${JOB}'::uuid;")"
expect_eq "E6: re-snap kept the hauler's own confirmation time" "$(q "select last_confirmed_at::text from marketplace.hauler_profiles where org_id = '${HAUL}'::uuid;")" "$HAUL_CONFIRMED"
expect_eq "E6: re-snap kept the availability report time" "$(q "select reported_at::text from marketplace.availability_reports where org_id = '${HAUL}'::uuid;")" "$REPORTED"
expect_eq "E6: service centre and report area re-snapped to the 0.10-degree grid" \
  "$(q "select round(extensions.st_y(h.service_center::extensions.geometry)::numeric, 6) || ' ' || round(extensions.st_x(a.area_center::extensions.geometry)::numeric, 6)
        from marketplace.hauler_profiles h join marketplace.availability_reports a on a.org_id = h.org_id where h.org_id = '${HAUL}'::uuid;")" "44.500000 -122.700000"

echo "[4/5] Applying 11_v2_founder_decisions.sql and 12_v2_billing_events.sql on top of existing data..."
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/11_v2_founder_decisions.sql" >/dev/null
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/12_v2_billing_events.sql" >/dev/null

echo "[5/5] Asserting 11 and 12 fabricated nothing and existing data still works..."
expect_eq "F1: a profile public only by the pre-V2 default is now private" \
  "$(q "select is_public::text || ' ' || coalesce(public_listing_consent_at::text, 'null') from marketplace.hauler_profiles where org_id = '${HAUL}'::uuid;")" "false null"
expect_eq "F1: the change is audited" "$(q "select count(*) from marketplace.audit_events where entity_id = '${HAUL}'::uuid and action = 'hauler.public_listing_withdrawn';")" "1"
expect_eq "F1: making it private did not refresh the hauler's confirmation" "$(q "select last_confirmed_at::text from marketplace.hauler_profiles where org_id = '${HAUL}'::uuid;")" "$HAUL_CONFIRMED"
expect_eq "legacy job still unattested and unconfirmed after 11/12" \
  "$(q "select is_legacy_import::text || ' ' || coalesce(last_confirmed_at::text, 'null') from marketplace.job_postings where id = '${JOB}'::uuid;")" "true ${BEFORE}"
expect_eq "R4: the existing subscription carries no invented provider-event history" \
  "$(q "select coalesce(last_provider_event_id, 'null') || ' ' || provider_sync_required from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_m';")" "null false"
ORG="$(q "select org_id from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_m';")"
P_START="$(q "select current_period_start::text from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_m';")"
P_END="$(q "select current_period_end::text from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_m';")"
EVENT_RESULT="$(q "
begin;
select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);
set local role service_role;
select r.result from marketplace.apply_billing_provider_event('stripe', 'evt_mig_1', 'customer.subscription.updated', now(),
  '${ORG}'::uuid, 'sub_m', 'cus_m', 'pro', 'active', '${P_START}'::timestamptz, '${P_END}'::timestamptz,
  false, 'subscription_update', repeat('b', 64), false) r;
commit;" | grep -E '^[a-z_]+$' | head -1)"
expect_eq "R4: a provider event for the migrated subscription applies" "$EVENT_RESULT" "applied"
expect_eq "R4: ... and changes the plan" "$(q "select p.code from marketplace.organization_subscriptions s join marketplace.subscription_plans p on p.id = s.plan_id where s.provider_subscription_ref = 'sub_m';")" "pro"
x "drop schema if exists marketplace cascade;"
echo "MIGRATION PATH TEST PASSED."
