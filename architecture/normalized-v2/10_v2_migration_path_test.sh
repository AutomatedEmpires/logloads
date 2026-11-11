#!/usr/bin/env bash
# =============================================================================
# LogLoads normalized-v2 — 10 migration-path test for 06 -> 11 -> 12 -> 16 -> 18 -> 23 -> 26 -> 29 on existing data
#
# NON-ACTIVE PROTOTYPE TEST HARNESS. Disposable PostgreSQL only; same fail-closed target checks as 05/08.
# Builds a baseline (01 -> 02 -> 03) holding data created the baseline way — including the states the
# independent review showed 06 aborted on (D-4) — applies each V2 migration atomically
# (psql --single-transaction), and proves none of them fabricates or silently rewrites anything:
#   06  every pre-V2 non-draft job (priced or unpriced, D-4d) becomes an audited legacy import with exactly
#       the confirmation it had, no attestation and no invented confirmer; a draft carrying pre-V2
#       publication/confirmation timestamps keeps them in the audit log and is cleared (D-4c); a withdrawn
#       plus re-submitted inquiry pair is kept, the extra row pointing at the kept thread (D-4a); a reply
#       longer than V2's 2000-character limit is kept (D-4b); re-snapping coordinates refreshes no
#       confirmation, report time or last-modified time (E6, D-6); and 06 refuses to run twice (D-1/D-2);
#   11  a hauler profile that was public only by the pre-V2 default becomes private, audited (F1), still
#       without touching its confirmation;
#   12  an existing subscription keeps its state, carries no invented provider-event history, and accepts
#       provider events afterwards (R4);
#   18  changes no stored row (its fixes are rules, policies and grants), and existing data still works;
#   23  changes no stored row either (it redefines a trigger and two visibility helpers, and comments one function);
#   26  changes no stored row either (it adds tables, functions, triggers and policies, redefines six functions, and adds a
#       unique constraint every membership already satisfies);
#   29  changes no stored row either (it redefines four functions: the landing-scope guard, respond_to_interest and the
#       two audience counts).
# =============================================================================
set -euo pipefail

DB_URL="${LOGLOADS_DISPOSABLE_DB_URL:-}"
[[ -n "$DB_URL" ]] || { echo "ERROR: Missing LOGLOADS_DISPOSABLE_DB_URL." >&2; exit 1; }
[[ "$DB_URL" =~ ^postgres(ql)?://([^@/]+@)?(127\.0\.0\.1|localhost)(:[0-9]+)?/[A-Za-z0-9_]+$ ]] \
  || { echo "ERROR: Refusing to run: LOGLOADS_DISPOSABLE_DB_URL must be a local URL with a plain database name." >&2; exit 1; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
q() { printf '%s\n' "$1" | psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1; }
x() { printf '%s\n' "$1" | psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 >/dev/null; }
apply1() { psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$1" >/dev/null; }
fail() { echo "ERROR: $*" >&2; exit 1; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# md5 of every row of every marketplace table, one entry per table. $1 (optional): tables to leave out, comma-separated.
all_data() {
  local parts
  parts="$(q "select string_agg(format('select %L || '':'' || coalesce((select md5(string_agg(t::text, ''|'' order by t::text)) from marketplace.%I t), ''empty'')', c.relname, c.relname), ' union all ')
              from pg_class c where c.relnamespace = 'marketplace'::regnamespace and c.relkind in ('r','p') and c.relname <> all (string_to_array('${1:-}', ','));")"
  q "select md5(string_agg(x, '|' order by x)) from (${parts}) s(x);"
}
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
# D-10: the disposable stamp written by guard.sh is required; there is no environment-variable bypass. A local
# disposable database must be stamped deliberately (comment on database ... is 'logloads-ci-disposable:local').
MARK="$(q "select coalesce(shobj_description(oid, 'pg_database'), '') from pg_database where datname = current_database();")"
[[ "$MARK" == logloads-ci-disposable:* ]] || fail "Refusing to run: database is not stamped as a CI disposable database."
if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  bash "$SCRIPT_DIR/../../tools/normalized-v2-ci/guard.sh" verify >/dev/null \
    || fail "Refusing to run: the per-run disposable guard did not verify this cluster."
fi

echo "[1/6] Building the baseline schema (01 -> 02 -> 03, each atomic) with pre-V2 data..."
x "drop schema if exists marketplace cascade;"
for f in 01_schema.sql 02_access.sql 03_entitlements.sql; do apply1 "$SCRIPT_DIR/$f"; done
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
  -- Off the 0.10-degree grid, so 06's re-snap genuinely moves it.
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (v_org, 'Mig Landing', 'active', 'Near Oakridge, OR', extensions.st_GeogFromText('SRID=4326;POINT(-122.537 43.712)'), 'OR')
  returning id into v_land;
  insert into marketplace.job_postings (org_id, landing_id, title, pay_amount_cents, pay_unit, trucks_requested, status)
  values (v_org, v_land, 'Pre-V2 Active Job', 9000, 'per_ton', 3, 'active');
  -- D-4d: an active job without stated pay, published under the baseline's explicit founder-policy switch.
  perform set_config('app.allow_unquoted_active_jobs', 'true', true);
  insert into marketplace.job_postings (org_id, landing_id, title, trucks_requested, status)
  values (v_org, v_land, 'Pre-V2 Unquoted Job', 2, 'active');
  perform set_config('app.allow_unquoted_active_jobs', 'false', true);
  insert into marketplace.job_postings (org_id, landing_id, title, trucks_requested, status)
  values (v_org, v_land, 'Pre-V2 Draft', 1, 'draft');
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
# Baseline states written directly (the harness owns the schema), then every timestamp the migrations must not
# touch is backdated with the stamping triggers suspended, so any migration refresh is visible.
x "
-- D-4c: a draft carrying a publication time (it was once live) and a client-written confirmation.
update marketplace.job_postings set published_at = now() - interval '8 days', last_confirmed_at = now() - interval '6 days'
where title = 'Pre-V2 Draft';
-- D-4a: on the priced job, a withdrawn inquiry and the live re-submission the baseline allowed after it; on
-- the unquoted job, two withdrawn inquiries and no live one.
insert into marketplace.expressions_of_interest (job_id, job_org_id, hauler_org_id, submitted_by, trucks_offered, status, withdrawn_at, created_at)
select j.id, j.org_id, h.id, h.created_by, 1, 'withdrawn', now() - interval '5 days', now() - interval '6 days'
from marketplace.job_postings j, marketplace.organizations h where j.title = 'Pre-V2 Active Job' and h.slug = 'mig-hauling';
insert into marketplace.expressions_of_interest (job_id, job_org_id, hauler_org_id, submitted_by, trucks_offered, status, created_at)
select j.id, j.org_id, h.id, h.created_by, 2, 'submitted', now() - interval '4 days'
from marketplace.job_postings j, marketplace.organizations h where j.title = 'Pre-V2 Active Job' and h.slug = 'mig-hauling';
insert into marketplace.expressions_of_interest (job_id, job_org_id, hauler_org_id, submitted_by, trucks_offered, status, withdrawn_at, created_at)
select j.id, j.org_id, h.id, h.created_by, 1, 'withdrawn', now() - interval '6 days', now() - interval '7 days'
from marketplace.job_postings j, marketplace.organizations h where j.title = 'Pre-V2 Unquoted Job' and h.slug = 'mig-hauling';
insert into marketplace.expressions_of_interest (job_id, job_org_id, hauler_org_id, submitted_by, trucks_offered, status, withdrawn_at, created_at)
select j.id, j.org_id, h.id, h.created_by, 1, 'withdrawn', now() - interval '2 days', now() - interval '3 days'
from marketplace.job_postings j, marketplace.organizations h where j.title = 'Pre-V2 Unquoted Job' and h.slug = 'mig-hauling';
-- D-4b: a 3000-character hauler message (the baseline allowed 4000).
insert into marketplace.interest_messages (interest_id, author_user_id, author_side, body)
select e.id, e.submitted_by, 'hauler', repeat('m', 3000)
from marketplace.expressions_of_interest e where e.status = 'submitted';

alter table marketplace.job_postings disable trigger job_guard;
alter table marketplace.job_postings disable trigger set_updated_at;
update marketplace.job_postings set updated_at = now() - interval '20 days';
alter table marketplace.job_postings enable trigger set_updated_at;
alter table marketplace.job_postings enable trigger job_guard;
alter table marketplace.landings disable trigger landing_guard;
alter table marketplace.landings disable trigger set_updated_at;
update marketplace.landings set updated_at = now() - interval '20 days';
alter table marketplace.landings enable trigger set_updated_at;
alter table marketplace.landings enable trigger landing_guard;
alter table marketplace.expressions_of_interest disable trigger set_updated_at;
update marketplace.expressions_of_interest set updated_at = now() - interval '20 days';
alter table marketplace.expressions_of_interest enable trigger set_updated_at;
alter table marketplace.hauler_profiles disable trigger hauler_profile_guard;
alter table marketplace.hauler_profiles disable trigger set_updated_at;
update marketplace.hauler_profiles set last_confirmed_at = now() - interval '9 days', updated_at = now() - interval '20 days'
where org_id = (select id from marketplace.organizations where slug = 'mig-hauling');
alter table marketplace.hauler_profiles enable trigger set_updated_at;
alter table marketplace.hauler_profiles enable trigger hauler_profile_guard;
alter table marketplace.availability_reports disable trigger availability_guard;
update marketplace.availability_reports set reported_at = now() - interval '4 days'
where org_id = (select id from marketplace.organizations where slug = 'mig-hauling');
alter table marketplace.availability_reports enable trigger availability_guard;"

JOB="$(q "select id from marketplace.job_postings where title = 'Pre-V2 Active Job';")"
UNQUOTED="$(q "select id from marketplace.job_postings where title = 'Pre-V2 Unquoted Job';")"
DRAFT="$(q "select id from marketplace.job_postings where title = 'Pre-V2 Draft';")"
HAUL="$(q "select id from marketplace.organizations where slug = 'mig-hauling';")"
BEFORE="$(q "select coalesce(last_confirmed_at::text, 'null') from marketplace.job_postings where id = '${JOB}'::uuid;")"
UNQUOTED_BEFORE="$(q "select coalesce(last_confirmed_at::text, 'null') from marketplace.job_postings where id = '${UNQUOTED}'::uuid;")"
DRAFT_PUBLISHED="$(q "select published_at::text from marketplace.job_postings where id = '${DRAFT}'::uuid;")"
DRAFT_CONFIRMED="$(q "select last_confirmed_at::text from marketplace.job_postings where id = '${DRAFT}'::uuid;")"
HAUL_CONFIRMED="$(q "select last_confirmed_at::text from marketplace.hauler_profiles where org_id = '${HAUL}'::uuid;")"
REPORTED="$(q "select reported_at::text from marketplace.availability_reports where org_id = '${HAUL}'::uuid;")"
MODIFIED="$(q "select string_agg(t || ':' || updated_at::text, ',' order by t) from (
  select 'job:' || id::text as t, updated_at from marketplace.job_postings
  union all select 'landing:' || id::text, updated_at from marketplace.landings
  union all select 'interest:' || id::text, updated_at from marketplace.expressions_of_interest
  union all select 'hauler:' || org_id::text, updated_at from marketplace.hauler_profiles) s;")"
expect_eq "baseline hauler profile is public by the pre-V2 default" "$(q "select is_public from marketplace.hauler_profiles where org_id = '${HAUL}'::uuid;")" "t"
expect_eq "baseline holds an unpriced active job" "$(q "select status || ' ' || coalesce(pay_unit, 'null') from marketplace.job_postings where id = '${UNQUOTED}'::uuid;")" "active null"
expect_eq "baseline holds two inquiry rows for each of two (job, hauler) pairs" "$(q "select count(*) from marketplace.expressions_of_interest;")" "4"
echo "  pre-V2 job ${JOB}: last_confirmed_at = ${BEFORE}; hauler confirmed ${HAUL_CONFIRMED}; report ${REPORTED}"

echo "[2/6] Applying 06_v2_contract_alignment.sql (one transaction) on top of existing data..."
apply1 "$SCRIPT_DIR/06_v2_contract_alignment.sql"

echo "[3/6] Asserting 06 migrated every supported state and fabricated nothing..."
expect_eq "pre-V2 job marked as a legacy import" "$(q "select is_legacy_import from marketplace.job_postings where id = '${JOB}'::uuid;")" "t"
expect_eq "D-4d: the unpriced active job is a legacy import, still active, still unpriced" \
  "$(q "select is_legacy_import::text || ' ' || status || ' ' || coalesce(pay_unit, 'null') from marketplace.job_postings where id = '${UNQUOTED}'::uuid;")" "true active null"
expect_eq "audited legacy-import records (both non-draft jobs, not the draft)" \
  "$(q "select count(*) from marketplace.legacy_job_imports where reason ilike '%never explicitly attested%';")" "2"
expect_eq "no attestation invented" "$(q "select count(*) from marketplace.job_publication_attestations;")" "0"
expect_eq "confirmation unchanged by the migration" "$(q "select coalesce(last_confirmed_at::text, 'null') from marketplace.job_postings where id = '${JOB}'::uuid;")" "$BEFORE"
expect_eq "unpriced job's confirmation unchanged" "$(q "select coalesce(last_confirmed_at::text, 'null') from marketplace.job_postings where id = '${UNQUOTED}'::uuid;")" "$UNQUOTED_BEFORE"
# The column is new in 06: any value would have been invented.
expect_eq "no confirmer invented (last_confirmed_by stays null on every legacy row)" \
  "$(q "select count(*) from marketplace.job_postings where last_confirmed_by is not null;")" "0"
expect_eq "D-4c: the draft keeps no publication or confirmation time" \
  "$(q "select coalesce(published_at::text, 'null') || ' ' || coalesce(last_confirmed_at::text, 'null') || ' ' || is_legacy_import::text from marketplace.job_postings where id = '${DRAFT}'::uuid;")" "null null false"
expect_eq "D-4c: ... and the audit log holds exactly the values it carried" \
  "$(q "select count(*) from marketplace.audit_events where action = 'job.migration_draft_timestamps_cleared' and entity_id = '${DRAFT}'::uuid
        and (metadata ->> 'published_at')::timestamptz = '${DRAFT_PUBLISHED}'::timestamptz
        and (metadata ->> 'last_confirmed_at')::timestamptz = '${DRAFT_CONFIRMED}'::timestamptz;")" "1"
expect_eq "D-4a: every inquiry row is kept" "$(q "select count(*) from marketplace.expressions_of_interest;")" "4"
expect_eq "D-4a: the withdrawn row points at the live re-submission it preceded" \
  "$(q "select count(*) from marketplace.expressions_of_interest w join marketplace.expressions_of_interest k on k.id = w.superseded_by
        where w.job_id = '${JOB}'::uuid and w.status = 'withdrawn' and k.status = 'submitted' and k.superseded_by is null;")" "1"
expect_eq "D-4a: with no live row, the most recent withdrawn thread is kept" \
  "$(q "select count(*) from marketplace.expressions_of_interest w join marketplace.expressions_of_interest k on k.id = w.superseded_by
        where w.job_id = '${UNQUOTED}'::uuid and k.created_at > w.created_at and k.superseded_by is null;")" "1"
expect_eq "D-4a: one thread per (job, hauler) is enforced on every row that is not superseded" \
  "$(q "select count(*) from pg_indexes where schemaname = 'marketplace' and indexname = 'expressions_of_interest_job_hauler_uq'
        and indexdef ~* 'unique' and indexdef ~* 'superseded_by is null';")" "1"
expect_eq "D-4b: the 3000-character baseline reply is kept unchanged" \
  "$(q "select count(*) from marketplace.interest_messages where char_length(body) = 3000;")" "1"
if x "insert into marketplace.interest_messages (interest_id, author_user_id, author_side, body)
      select e.id, e.submitted_by, 'hauler', repeat('n', 2001) from marketplace.expressions_of_interest e where e.status = 'submitted';" 2>"$TMP/long.log"; then
  fail "D-4b: a new 2001-character reply was accepted"
fi
grep -q "interest_messages_body_check" "$TMP/long.log" || fail "D-4b: unexpected failure for a long reply: $(head -c 300 "$TMP/long.log")"
echo "  ok: D-4b: a new reply over 2000 characters is refused"
expect_eq "D-4b: the 2000-character rule is enforced on new replies (not validated against history)" \
  "$(q "select convalidated::text from pg_constraint where conname = 'interest_messages_body_check';")" "false"
expect_eq "E6: re-snap kept the hauler's own confirmation time" "$(q "select last_confirmed_at::text from marketplace.hauler_profiles where org_id = '${HAUL}'::uuid;")" "$HAUL_CONFIRMED"
expect_eq "E6: re-snap kept the availability report time" "$(q "select reported_at::text from marketplace.availability_reports where org_id = '${HAUL}'::uuid;")" "$REPORTED"
expect_eq "D-6: no last-modified time changed (jobs, landing, inquiries, hauler profile)" \
  "$(q "select string_agg(t || ':' || updated_at::text, ',' order by t) from (
          select 'job:' || id::text as t, updated_at from marketplace.job_postings
          union all select 'landing:' || id::text, updated_at from marketplace.landings
          union all select 'interest:' || id::text, updated_at from marketplace.expressions_of_interest
          union all select 'hauler:' || org_id::text, updated_at from marketplace.hauler_profiles) s;")" "$MODIFIED"
expect_eq "E6: landing, service centre and report area lie on the 0.10-degree grid" \
  "$(q "select bool_and(abs(v * 10 - round(v * 10)) < 1e-9)::text from (
          select extensions.st_y(l.public_point::extensions.geometry) from marketplace.landings l
          union all select extensions.st_x(l.public_point::extensions.geometry) from marketplace.landings l
          union all select extensions.st_y(h.service_center::extensions.geometry) from marketplace.hauler_profiles h where h.org_id = '${HAUL}'::uuid
          union all select extensions.st_x(h.service_center::extensions.geometry) from marketplace.hauler_profiles h where h.org_id = '${HAUL}'::uuid
          union all select extensions.st_y(a.area_center::extensions.geometry) from marketplace.availability_reports a where a.org_id = '${HAUL}'::uuid
          union all select extensions.st_x(a.area_center::extensions.geometry) from marketplace.availability_reports a where a.org_id = '${HAUL}'::uuid) s(v);")" "true"
expect_eq "06 is recorded in the migration ledger" "$(q "select string_agg(version, ',' order by version) from marketplace.schema_migrations;")" "06"

echo "[4/6] Re-running 06 and running 12 before 11 are refused without changing anything (D-1/D-2)..."
STATE="$(all_data)"
if apply1 "$SCRIPT_DIR/06_v2_contract_alignment.sql" 2>"$TMP/rerun06.log"; then fail "re-running 06 was not refused"; fi
grep -q "already applied" "$TMP/rerun06.log" || fail "re-running 06 failed for an unexpected reason: $(head -c 300 "$TMP/rerun06.log")"
if apply1 "$SCRIPT_DIR/12_v2_billing_events.sql" 2>"$TMP/early12.log"; then fail "12 applied before 11"; fi
grep -q "requires migration 11" "$TMP/early12.log" || fail "12 before 11 failed for an unexpected reason: $(head -c 300 "$TMP/early12.log")"
expect_eq "every table unchanged by the refused runs" "$(all_data)" "$STATE"
expect_eq "ledger unchanged by the refused runs" "$(q "select string_agg(version, ',' order by version) from marketplace.schema_migrations;")" "06"

echo "[5/6] Applying 11_v2_phase3_policy.sql, 12_v2_billing_events.sql, 16_v2_identity_membership_hardening.sql, 18_v2_review_106_hardening.sql, 23_v2_round2_hardening.sql, 26_v2_team_seats_saved_jobs_outbox.sql and 29_v2_landing_scope_hardening.sql (each one transaction) on top of existing data..."
apply1 "$SCRIPT_DIR/11_v2_phase3_policy.sql"
apply1 "$SCRIPT_DIR/12_v2_billing_events.sql"
MEMBERS_MODIFIED="$(q "select string_agg(id::text || ':' || updated_at::text, ',' order by id) from marketplace.organization_memberships;")"
apply1 "$SCRIPT_DIR/16_v2_identity_membership_hardening.sql"
BEFORE_18="$(all_data schema_migrations)"
apply1 "$SCRIPT_DIR/18_v2_review_106_hardening.sql"
AFTER_18="$(all_data schema_migrations)"
apply1 "$SCRIPT_DIR/23_v2_round2_hardening.sql"
AFTER_23="$(all_data schema_migrations)"
apply1 "$SCRIPT_DIR/26_v2_team_seats_saved_jobs_outbox.sql"
AFTER_26="$(all_data schema_migrations,team_invitations,team_invitation_landings,membership_landing_scopes,saved_jobs,notification_outbox)"
BEFORE_29="$(all_data schema_migrations)"
apply1 "$SCRIPT_DIR/29_v2_landing_scope_hardening.sql"
AFTER_29="$(all_data schema_migrations)"

echo "[6/6] Asserting 11 and 12 fabricated nothing and existing data still works..."
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
expect_eq "B-1: 16 records every existing active membership as accepted" "$(q "select count(*) from marketplace.organization_memberships where status = 'active' and accepted_at is null;")" "0"
expect_eq "B-1: ... without changing any membership's last-modified time" "$(q "select string_agg(id::text || ':' || updated_at::text, ',' order by id) from marketplace.organization_memberships;")" "$MEMBERS_MODIFIED"
expect_eq "18 changes no stored row in any marketplace table (the ledger aside)" "$AFTER_18" "$BEFORE_18"
expect_eq "23 changes no stored row in any marketplace table (the ledger aside)" "$AFTER_23" "$AFTER_18"
expect_eq "26 changes no stored row in any marketplace table (the ledger aside)" "$AFTER_26" "$AFTER_23"
expect_eq "26's new tables start empty" "$(q "select (select count(*) from marketplace.team_invitations) + (select count(*) from marketplace.team_invitation_landings) + (select count(*) from marketplace.membership_landing_scopes) + (select count(*) from marketplace.saved_jobs) + (select count(*) from marketplace.notification_outbox);")" "0"
expect_eq "29 changes no stored row in any marketplace table (the ledger aside)" "$AFTER_29" "$BEFORE_29"
expect_eq "the ledger records 06, 11, 12, 16, 18, 23, 26 and 29 in order" "$(q "select string_agg(version, ',' order by applied_at, version) from marketplace.schema_migrations;")" "06,11,12,16,18,23,26,29"
x "drop schema if exists marketplace cascade;"
echo "MIGRATION PATH TEST PASSED."
