#!/usr/bin/env bash
# =============================================================================
# LogLoads normalized-v2 — 14 Supabase API tests (PostgREST + JWT + real Supabase roles)
#
# NON-ACTIVE PROTOTYPE TEST HARNESS. Runs ONLY against the disposable Supabase CLI local stack started by
# the CI job (LOGLOADS_DB_ENV=supabase-local-ci, guarded by tools/normalized-v2-ci/guard.sh). Requests go
# through the stack's API gateway and PostgREST, which authenticates as `authenticator` and switches to the
# role named by a verified JWT — the production request path. Tokens are signed with the stack's generated
# local JWT secret (never printed). Run after 01 -> 02 -> 03 -> 06 -> 11 -> 12.
#
# Proves: JWT signature/expiry are enforced by PostgREST; the token's role is limited to anon /
# authenticated / service_role; the database further requires a trusted issuer, audience and subject;
# real service_role (BYPASSRLS) still reaches no marketplace table and no user RPC; tenant isolation and
# privilege-escalation attempts fail; the V2 RPCs work end to end over HTTP; and the day-14 rule (35-R) holds for direct
# table reads over PostgREST: an active job confirmed 20 days ago is hidden from anon, a rival and a hauler, readable
# by its own desk, and back for everyone once reconfirmed.
# =============================================================================
set -euo pipefail

[[ "${LOGLOADS_DB_ENV:-}" == "supabase-local-ci" ]] || { echo "ERROR: Supabase local stack only." >&2; exit 2; }
DB_URL="${LOGLOADS_DISPOSABLE_DB_URL:?}"
API="${LOGLOADS_SUPABASE_API_URL:?}"
ANON_KEY="${LOGLOADS_SUPABASE_ANON_KEY:?}"
JWT_SECRET="${LOGLOADS_SUPABASE_JWT_SECRET:?}"
[[ "$API" =~ ^http://127\.0\.0\.1:[0-9]+$ ]] || { echo "ERROR: API must be the local stack on 127.0.0.1." >&2; exit 2; }
[[ "$(printf 'select coalesce(shobj_description(oid, %s), %s) from pg_database where datname = current_database();' "'pg_database'" "''" \
     | psql "$DB_URL" -X -q -t -A)" == logloads-ci-disposable:* ]] || { echo "ERROR: database not stamped by the guard." >&2; exit 2; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
q() { printf '%s\n' "$1" | psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1; }
fail() { echo "TEST FAILED: $*" >&2; echo "  last HTTP ${HTTP:-?}: $(head -c 400 "$TMP/body" 2>/dev/null)" >&2; exit 1; }
pass() { echo "  PASS: $*"; }

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt() { # jwt <payload json> [secret]
  local h p s
  h="$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)"
  p="$(printf '%s' "$1" | b64url)"
  s="$(printf '%s' "$h.$p" | openssl dgst -sha256 -hmac "${2:-$JWT_SECRET}" -binary | b64url)"
  printf '%s.%s.%s' "$h" "$p" "$s"
}
NOW="$(date +%s)"
clerk() { # clerk <sub> [iss] [aud] [exp]
  jwt "$(printf '{"role":"authenticated","iss":"%s","sub":"%s","aud":"%s","iat":%s,"exp":%s}' \
    "${2:-https://clerk.logloads.test}" "$1" "${3:-logloads-app}" "$NOW" "${4:-$((NOW + 900))}")"
}
role_token() { jwt "$(printf '{"role":"%s","iss":"supabase-demo","iat":%s,"exp":%s}' "$1" "$NOW" "$((NOW + 900))")"; }

# api <token|-> <METHOD> <path> [json body]   (token "-" = anon key only, as a browser without a session)
api() {
  local tok="$1" method="$2" path="$3" body="${4:-}" auth
  if [[ "$tok" == "-" ]]; then auth="$ANON_KEY"; else auth="$tok"; fi
  local args=(-s -o "$TMP/body" -w '%{http_code}' -X "$method" "$API/rest/v1/$path"
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $auth"
    -H "Accept-Profile: marketplace" -H "Content-Profile: marketplace" -H "Content-Type: application/json")
  [[ -n "$body" ]] && args+=(-d "$body")
  HTTP="$(curl "${args[@]}")"
  BODY="$(cat "$TMP/body")"
}
code() { jq -r '.code // empty' <<<"$BODY" 2>/dev/null || true; }
expect_ok() { [[ "$HTTP" =~ ^2 ]] || fail "$1 (expected 2xx)"; pass "$1"; }
expect_err() { # expect_err <label> <sqlstate/PGRST regex> [message regex]
  [[ ! "$HTTP" =~ ^2 ]] || fail "$1 (expected an error, got $HTTP)"
  [[ "$(code)" =~ ^($2)$ ]] || fail "$1 (expected code /$2/, got '$(code)')"
  if [[ -n "${3:-}" ]]; then grep -Eiq "$3" <<<"$BODY" || fail "$1 (message did not match /$3/)"; fi
  pass "$1 (HTTP $HTTP, $(code))"
}

# --- Fixture (committed through SQL as the migration role; identities via the service_role worker RPC) ---
echo "[1/7] Fixture: trusted issuer, two landing organizations, a hauler, published and paused jobs..."
q "insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
   values ('https://clerk.logloads.test', 'Clerk (CI)', 'logloads-app', true) on conflict (issuer) do nothing;" >/dev/null
q "
do \$\$
declare v_land uuid; v_rival uuid; v_haul uuid; l_land uuid; l_rival uuid;
  claims constant text := '{\"role\":\"service_role\"}';
begin
  perform set_config('request.jwt.claims', claims, true); set local role service_role;
  perform marketplace.sync_verified_identity('https://clerk.logloads.test', 'api_land',  'Api Landing', 'land@api.test', true);
  perform marketplace.sync_verified_identity('https://clerk.logloads.test', 'api_rival', 'Api Rival',   'rival@api.test', true);
  perform marketplace.sync_verified_identity('https://clerk.logloads.test', 'api_haul',  'Api Hauler',  'haul@api.test', true);
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('role','authenticated','iss','https://clerk.logloads.test','sub','api_land','aud','logloads-app','exp',extract(epoch from now())::bigint+600)::text, true);
  set local role authenticated;
  v_land := marketplace.create_organization('API Timber', 'api-timber', 'OR', false);
  perform set_config('request.jwt.claims', jsonb_build_object('role','authenticated','iss','https://clerk.logloads.test','sub','api_rival','aud','logloads-app','exp',extract(epoch from now())::bigint+600)::text, true);
  v_rival := marketplace.create_organization('API Rival Timber', 'api-rival', 'OR', false);
  perform set_config('request.jwt.claims', jsonb_build_object('role','authenticated','iss','https://clerk.logloads.test','sub','api_haul','aud','logloads-app','exp',extract(epoch from now())::bigint+600)::text, true);
  v_haul := marketplace.create_organization('API Hauling', 'api-hauling', 'OR', true);
  insert into marketplace.equipment_units (org_id, equipment_code, unit_label, unit_count) values (v_haul, 'log_truck', 'API trucks', 2);
  perform set_config('request.jwt.claims', claims, true); set local role service_role;
  perform marketplace.open_subscription_cycle(v_land, 'basic', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_api_l', 'sub_api_l', false, 7, false);
  perform marketplace.open_subscription_cycle(v_rival, 'basic', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_api_r', 'sub_api_r', false, 7, false);
  perform set_config('request.jwt.claims', jsonb_build_object('role','authenticated','iss','https://clerk.logloads.test','sub','api_land','aud','logloads-app','exp',extract(epoch from now())::bigint+600)::text, true);
  set local role authenticated;
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (v_land, 'API Landing', 'active', 'Near Vida, OR', extensions.st_GeogFromText('SRID=4326;POINT(-122.48765 44.15432)'), 'OR')
  returning id into l_land;
  insert into marketplace.landing_private_details (landing_id, org_id, exact_point, directions, gate_instructions)
  values (l_land, v_land, extensions.st_GeogFromText('SRID=4326;POINT(-122.48765 44.15432)'), 'Spur 12', 'Green gate');
  perform marketplace.publish_job_posting(p_landing_id => l_land, p_title => 'API Sawlog Run', p_equipment_codes => array['log_truck'],
    p_trucks_requested => 3, p_pay_unit => 'per_ton', p_pay_amount_cents => 9100, p_attest_available => true);
  perform marketplace.set_job_posting_status(
    marketplace.publish_job_posting(p_landing_id => l_land, p_title => 'API Paused Run', p_equipment_codes => array['log_truck'],
      p_trucks_requested => 2, p_pay_unit => 'per_load', p_pay_amount_cents => 48000, p_attest_available => true), 'paused');
  perform marketplace.publish_job_posting(p_landing_id => l_land, p_title => 'API Stale Run', p_equipment_codes => array['log_truck'],
    p_trucks_requested => 2, p_pay_unit => 'per_ton', p_pay_amount_cents => 8800, p_attest_available => true);
  reset role;
end
\$\$;" >/dev/null
# 35-R: the stale job's last confirmation is 20 days old (the job guard reads it from the attestation ledger).
q "update marketplace.job_publication_attestations set reconfirmed_at = now() - interval '20 days'
   where job_id = (select id from marketplace.job_postings where title = 'API Stale Run');
   update marketplace.job_postings set title = title where title = 'API Stale Run';" >/dev/null
LAND_ORG="$(q "select id from marketplace.organizations where slug = 'api-timber';")"
RIVAL_ORG="$(q "select id from marketplace.organizations where slug = 'api-rival';")"
HAUL_ORG="$(q "select id from marketplace.organizations where slug = 'api-hauling';")"
LANDING="$(q "select id from marketplace.landings where org_id = '${LAND_ORG}'::uuid;")"
JOB="$(q "select id from marketplace.job_postings where title = 'API Sawlog Run';")"
PAUSED="$(q "select id from marketplace.job_postings where title = 'API Paused Run';")"
STALE="$(q "select id from marketplace.job_postings where title = 'API Stale Run' and status = 'active' and last_confirmed_at < now() - interval '19 days';")"
[[ -n "$STALE" ]] || fail "fixture: the stale job was not aged to 20 days"
USERS_BEFORE="$(q "select count(*) from marketplace.app_users;")"

# PostgREST picks up the new schema (Supabase's DDL watch also notifies; poll until the RPC is visible).
q "notify pgrst, 'reload schema';" >/dev/null
for _ in $(seq 1 30); do
  api - POST rpc/list_marketplace_jobs '{}'
  [[ "$HTTP" == "200" ]] && break
  sleep 1
done
[[ "$HTTP" == "200" ]] || fail "PostgREST never exposed marketplace.list_marketplace_jobs"

T_LAND="$(clerk api_land)"; T_RIVAL="$(clerk api_rival)"; T_HAUL="$(clerk api_haul)"

echo "[2/7] Anonymous access (anon key only)..."
api - POST rpc/list_marketplace_jobs '{}'
expect_ok "anon can browse discovery"
[[ "$(jq -r --arg j "$JOB" '[.[] | select(.job_id == $j)] | length' <<<"$BODY")" == "1" ]] || fail "anon discovery lists the active job"
[[ "$(jq -r --arg j "$PAUSED" '[.[] | select(.job_id == $j)] | length' <<<"$BODY")" == "0" ]] || fail "anon discovery hides the paused job"
[[ "$(jq -r --arg j "$JOB" '.[] | select(.job_id == $j) | "\(.origin_lat) \(.origin_lng)"' <<<"$BODY")" == "44.2 -122.5" ]] || fail "anon sees only the 0.10-degree public point"
grep -q "Green gate\|Spur 12\|48765" <<<"$BODY" && fail "private landing details leaked into discovery"
pass "discovery lists the active job only, at the 0.10-degree point (44.2, -122.5), with no private details"
api - GET "job_postings?select=id,title,status"
expect_ok "anon can read granted job columns"
[[ "$(jq -r 'map(.status) | unique | join(",")' <<<"$BODY")" == "active" ]] || fail "RLS limits anon to active jobs"
pass "RLS limits anon table reads to publicly visible jobs"
rows() { [[ "$HTTP" == "200" ]] || fail "$1 (expected 200, got $HTTP)"; jq 'length' <<<"$BODY"; }
api - GET "job_postings?select=id&id=eq.$STALE"
[[ "$(rows "anon reads job_postings")" == "0" ]] || fail "anon read an active job confirmed 20 days ago (35-R)"
api - GET "job_posting_equipment?select=job_id&job_id=eq.$STALE"
[[ "$(rows "anon reads job_posting_equipment")" == "0" ]] || fail "anon read the equipment of a job past day 14 (35-R)"
api - GET "job_postings?select=id&id=eq.$JOB"
[[ "$(rows "anon reads the current job")" == "1" ]] || fail "anon must still read the current job"
pass "anon reads neither an active job confirmed 20 days ago nor its equipment, and still reads the current job (35-R)"
api "$T_RIVAL" GET "job_postings?select=id&id=eq.$STALE"
[[ "$(rows "a rival reads job_postings")" == "0" ]] || fail "a rival landing read another business's job past day 14 (35-R)"
api "$T_HAUL" GET "job_postings?select=id&id=eq.$STALE"
[[ "$(rows "a hauler reads job_postings")" == "0" ]] || fail "a hauler read a job past day 14 (35-R)"
api "$T_LAND" GET "job_postings?select=id,status&id=eq.$STALE"
[[ "$(rows "the desk reads job_postings")" == "1" && "$(jq -r '.[0].status' <<<"$BODY")" == "active" ]] || fail "the landing desk must still read its own active job past day 14 (35-R)"
pass "a rival landing and a hauler do not read it either; its own landing desk does, as active (35-R)"
api "$T_LAND" POST rpc/reconfirm_job_posting "{\"p_job_id\":\"$STALE\"}"
expect_ok "the owner reconfirms the stale job over HTTP"
api - GET "job_postings?select=id&id=eq.$STALE"
[[ "$(rows "anon reads job_postings after the reconfirmation")" == "1" ]] || fail "reconfirming did not restore the job to anon's direct reads (35-R)"
pass "reconfirming restores it to anon's direct reads at once (35-R)"
api - GET "landing_private_details?select=*"
expect_err "anon cannot read private landing details" "42501"
api - POST rpc/publish_job_posting "{\"p_landing_id\":\"$LANDING\",\"p_title\":\"Anon post\",\"p_equipment_codes\":[\"log_truck\"],\"p_trucks_requested\":1,\"p_pay_unit\":\"per_ton\",\"p_pay_amount_cents\":900,\"p_attest_available\":true}"
expect_err "anon cannot call a write RPC" "42501"

echo "[3/7] JWT verification by PostgREST..."
api "$(clerk api_land https://clerk.logloads.test logloads-app $((NOW - 60)))" POST rpc/get_viewer_marketplace_access "{\"p_org_id\":\"$LAND_ORG\"}"
expect_err "an expired token is refused before reaching the database" "PGRST30[0-9]" "expired"
api "$(jwt "$(printf '{"role":"authenticated","iss":"https://clerk.logloads.test","sub":"api_land","aud":"logloads-app","exp":%s}' $((NOW + 900)))" 'not-the-stack-secret-not-the-stack-secret')" \
  POST rpc/get_viewer_marketplace_access "{\"p_org_id\":\"$LAND_ORG\"}"
expect_err "a token signed with another key is refused" "PGRST30[0-9]"
api "$(role_token postgres)" POST rpc/list_marketplace_jobs '{}'
expect_err "a validly signed token naming role postgres cannot assume it" "42501|PGRST[0-9]+|22023" "role|permission"
api "$(role_token supabase_admin)" POST rpc/list_marketplace_jobs '{}'
expect_err "a validly signed token naming role supabase_admin cannot assume it" "42501|PGRST[0-9]+|22023" "role|permission"

echo "[4/7] Database-side claim requirements (trusted issuer, audience, subject)..."
api "$T_LAND" POST rpc/get_viewer_marketplace_access "{\"p_org_id\":\"$LAND_ORG\"}"
expect_ok "a trusted Clerk token for a member resolves the viewer"
grep -q '"job.publish"' <<<"$BODY" || fail "the landing owner holds job.publish"
pass "the landing owner's capabilities include job.publish"
api "$(clerk api_land https://evil.example.test)" POST rpc/get_viewer_marketplace_access "{\"p_org_id\":\"$LAND_ORG\"}"
expect_err "an untrusted issuer resolves no user" "42501"
api "$(clerk api_land https://clerk.logloads.test some-other-app)" POST rpc/get_viewer_marketplace_access "{\"p_org_id\":\"$LAND_ORG\"}"
expect_err "a token for another audience resolves no user" "42501"
api "$(clerk api_nobody)" POST rpc/get_viewer_marketplace_access "{\"p_org_id\":\"$LAND_ORG\"}"
expect_err "a trusted token for an unknown subject resolves no user" "42501"
[[ "$(q "select count(*) from marketplace.app_users;")" == "$USERS_BEFORE" ]] || fail "untrusted tokens must not create users"
pass "no user was created by untrusted, mis-addressed or unknown tokens"

echo "[5/7] V2 RPCs end to end over HTTP..."
api "$T_LAND" POST rpc/publish_job_posting "{\"p_landing_id\":\"$LANDING\",\"p_title\":\"HTTP Pulp Run\",\"p_equipment_codes\":[\"log_truck\"],\"p_trucks_requested\":2,\"p_pay_unit\":\"per_ton\",\"p_pay_amount_cents\":9900}"
expect_err "publishing without an attestation is refused (V2-DEC-03)" "23514" "attestation"
api "$T_LAND" POST rpc/publish_job_posting "{\"p_landing_id\":\"$LANDING\",\"p_title\":\"HTTP Pulp Run\",\"p_equipment_codes\":[\"log_truck\"],\"p_trucks_requested\":2,\"p_attest_available\":true}"
expect_err "publishing without pay is refused (V2-DEC-02)" "23514" "pay"
api "$T_LAND" POST rpc/publish_job_posting "{\"p_landing_id\":\"$LANDING\",\"p_title\":\"HTTP Pulp Run\",\"p_equipment_codes\":[\"log_truck\"],\"p_trucks_requested\":2,\"p_pay_unit\":\"per_ton\",\"p_pay_amount_cents\":9900,\"p_attest_available\":true}"
expect_ok "an attested, priced publication succeeds"
NEW_JOB="$(jq -r '.' <<<"$BODY")"
[[ "$(q "select j.last_confirmed_by = l.user_id from marketplace.job_postings j, marketplace.identity_links l
         where j.id = '${NEW_JOB}'::uuid and l.issuer = 'https://clerk.logloads.test' and l.subject = 'api_land';")" == "t" ]] \
  || fail "the publisher recorded must be the token's user"
pass "the recorded publisher is the user named by the token's subject"
api "$T_LAND" POST rpc/reconfirm_job_posting "{\"p_job_id\":\"$NEW_JOB\"}"
expect_ok "the owner reconfirms over HTTP"
api "$T_LAND" PATCH "job_postings?id=eq.$PAUSED" '{"status":"active"}'
expect_err "a direct PATCH cannot re-activate a paused job (F3)" "23514" "fresh availability attestation"
api "$T_LAND" POST rpc/reactivate_job_posting "{\"p_job_id\":\"$PAUSED\",\"p_attest_available\":true}"
expect_ok "attested re-activation over HTTP (F3)"
api "$T_HAUL" POST rpc/submit_expression_of_interest "{\"p_hauler_org_id\":\"$HAUL_ORG\",\"p_job_id\":\"$JOB\",\"p_equipment\":[{\"configurationKey\":\"log_truck\",\"count\":2}],\"p_message\":\"Two trucks\"}"
expect_ok "a hauler submits an inquiry over HTTP"
INTEREST="$(jq -r '.[0].interest_id' <<<"$BODY")"
api "$T_LAND" POST rpc/respond_to_interest "{\"p_interest_id\":\"$INTEREST\",\"p_status\":\"replied\",\"p_reply_id\":\"$(q 'select gen_random_uuid();')\"}"
expect_err "a reply without a message is refused (H3)" "23514" "needs a message"

echo "[6/7] Tenant isolation and privilege escalation..."
api "$T_RIVAL" POST rpc/reconfirm_job_posting "{\"p_job_id\":\"$JOB\"}"
expect_err "a rival landing cannot reconfirm another organization's job: it reads as not found (31-O)" "P0002" "Job not found"
api "$T_RIVAL" PATCH "job_postings?id=eq.$JOB" '{"title":"Hijacked"}'
[[ "$(q "select title from marketplace.job_postings where id = '${JOB}'::uuid;")" == "API Sawlog Run" ]] || fail "a rival PATCH changed another organization's job"
pass "a rival PATCH changes nothing (HTTP $HTTP; RLS filters the row)"
api "$T_RIVAL" GET "expressions_of_interest?select=id"
[[ "$HTTP" == "200" && "$(jq 'length' <<<"$BODY")" == "0" ]] || fail "a rival landing must see none of another organization's inquiries"
pass "a rival landing sees no inquiries of another organization"
api "$T_RIVAL" GET "landing_private_details?select=gate_instructions"
if [[ "$HTTP" =~ ^2 ]]; then [[ "$(jq 'length' <<<"$BODY")" == "0" ]] || fail "a rival read another organization's private landing details"; fi
pass "a rival cannot read another organization's private landing details (HTTP $HTTP)"
api "$T_LAND" POST "job_publication_attestations" "{\"job_id\":\"$JOB\",\"org_id\":\"$LAND_ORG\"}"
expect_err "a user cannot write the attestation ledger" "42501"
api "$T_LAND" PATCH "job_postings?id=eq.$JOB" '{"last_confirmed_at":"2030-01-01T00:00:00Z"}'
expect_err "a user cannot write last_confirmed_at" "42501"
api "$T_LAND" POST rpc/admin_import_legacy_job_posting "{\"p_org_id\":\"$LAND_ORG\",\"p_landing_id\":\"$LANDING\",\"p_title\":\"Escalation\",\"p_equipment_codes\":[\"log_truck\"],\"p_migration_reason\":\"try it\",\"p_trucks_per_day\":1}"
expect_err "a user cannot use the legacy import path" "42501"
CYCLE_ARGS="\"p_org_id\":\"$LAND_ORG\",\"p_plan_code\":\"regional\",\"p_status\":\"active\",\"p_period_start\":\"2026-01-01T00:00:00Z\",\"p_period_end\":\"2099-01-01T00:00:00Z\""
api "$T_LAND" POST rpc/write_audit "{\"p_action\":\"forged.event\",\"p_entity_table\":\"job_postings\",\"p_entity_id\":\"$JOB\",\"p_org_id\":\"$LAND_ORG\"}"
expect_err "authenticated cannot forge audit events (write_audit)" "42501|PGRST202"
api "$T_LAND" POST rpc/open_subscription_cycle "{$CYCLE_ARGS}"
expect_err "authenticated cannot open a subscription cycle (worker RPC)" "42501|PGRST202"
api "$T_LAND" POST rpc/apply_subscription_cycle "{$CYCLE_ARGS,\"p_provider_customer_ref\":null,\"p_provider_subscription_ref\":null,\"p_cancel_at_period_end\":false,\"p_grace_days\":null,\"p_allow_over_limit\":true,\"p_billing_reason\":null}"
expect_err "authenticated cannot call the internal subscription core" "42501|PGRST202"
api "$T_LAND" POST rpc/approximate_point '{"p":"SRID=4326;POINT(-122.48765 44.15432)"}'
expect_err "authenticated cannot call internal helpers (approximate_point)" "42501|PGRST202"
[[ "$(q "select (marketplace.org_entitled_plan('${LAND_ORG}'::uuid)).code;")" == "basic" ]] || fail "an escalation attempt changed the plan"
pass "escalation attempts changed nothing (plan still basic)"

echo "[7/7] Real service_role (BYPASSRLS) through the API..."
[[ "$(q "select rolbypassrls from pg_roles where rolname = 'service_role';")" == "t" ]] || fail "expected Supabase's service_role to have BYPASSRLS"
T_SERVICE="$(role_token service_role)"
api "$T_SERVICE" GET "job_postings?select=id"
expect_err "service_role (BYPASSRLS) still has no table privilege on marketplace tables" "42501"
api "$T_SERVICE" GET "landing_private_details?select=*"
expect_err "service_role cannot read private landing details" "42501"
api "$T_SERVICE" POST rpc/publish_job_posting "{\"p_landing_id\":\"$LANDING\",\"p_title\":\"Service post\",\"p_equipment_codes\":[\"log_truck\"],\"p_trucks_requested\":1,\"p_pay_unit\":\"per_ton\",\"p_pay_amount_cents\":900,\"p_attest_available\":true}"
expect_err "service_role holds no EXECUTE on user RPCs (the adapter must use the user's JWT)" "42501"
P_START="$(q "select to_char(current_period_start at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_api_l';")"
P_END="$(q "select to_char(current_period_end at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') from marketplace.organization_subscriptions where provider_subscription_ref = 'sub_api_l';")"
EVENT="{\"p_provider\":\"stripe\",\"p_provider_event_id\":\"evt_api_1\",\"p_event_type\":\"customer.subscription.updated\",\"p_provider_created_at\":\"$P_START\",\"p_org_id\":\"$LAND_ORG\",\"p_provider_subscription_ref\":\"sub_api_l\",\"p_provider_customer_ref\":\"cus_api_l\",\"p_plan_code\":\"pro\",\"p_status\":\"active\",\"p_period_start\":\"$P_START\",\"p_period_end\":\"$P_END\",\"p_cancel_at_period_end\":false,\"p_billing_reason\":\"subscription_update\",\"p_payload_sha256\":\"$(printf 'c%.0s' $(seq 1 64))\",\"p_is_reconciliation\":false}"
api "$T_SERVICE" POST rpc/apply_billing_provider_event "$EVENT"
expect_ok "the billing worker (service_role) applies a provider event"
[[ "$(jq -r '.[0].result' <<<"$BODY")" == "applied" ]] || fail "first delivery applies"
api "$T_SERVICE" POST rpc/apply_billing_provider_event "$EVENT"
[[ "$(jq -r '.[0].result' <<<"$BODY")" == "duplicate" ]] || fail "redelivery is a duplicate"
pass "a redelivered webhook is a duplicate over HTTP"
api "$T_LAND" POST rpc/apply_billing_provider_event "$EVENT"
expect_err "a user token cannot submit provider events" "42501"

echo "ALL SUPABASE API TESTS PASSED."
