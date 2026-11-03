# =============================================================================
# LogLoads normalized-v2 — 05 genuine multi-session concurrency test suite
#
# NON-ACTIVE PROTOTYPE TEST HARNESS. Do not run against production.
# Requires a disposable local PostgreSQL 15+ instance (with PostGIS + btree_gist)
# and `psql` on PATH. Refuses to run unless $env:LOGLOADS_DISPOSABLE_DB_URL
# points to `127.0.0.1` or `localhost`.
#
# Usage:
#   $env:LOGLOADS_DISPOSABLE_DB_URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres"
#   pwsh -File architecture/normalized-v2/05_concurrency_test.ps1
#
# Exercises 4 genuine two-connection races using parallel `psql` jobs released
# simultaneously via `pg_sleep_until(barrier_ts)`:
#   Race 1: Simultaneous consumption of the final invitation credit (1 unit left)
#   Race 2: Simultaneous multi-channel / duplicate delivery failure callbacks
#   Race 3: Stale reservation reaper vs. concurrent delivery callback
#   Race 4: Simultaneous billing-cycle webhook calls for the same period & promo
# =============================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$DbUrl = $env:LOGLOADS_DISPOSABLE_DB_URL
if ([string]::IsNullOrWhiteSpace($DbUrl)) {
  Write-Error "Missing LOGLOADS_DISPOSABLE_DB_URL. Set it to a verified local disposable PostgreSQL URL (127.0.0.1 / localhost)."
  exit 1
}

if ($DbUrl -notmatch '^postgres(ql)?://[^@]+@(127\.0\.0\.1|localhost)(:[0-9]+)?/') {
  Write-Error "Refusing to run: LOGLOADS_DISPOSABLE_DB_URL must point to 127.0.0.1 or localhost (disposable local database only)."
  exit 1
}

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  Write-Error "Missing prerequisite: psql is not installed or not on PATH."
  exit 1
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Invoke-PsqlSql([string]$Sql) {
  $out = $Sql | & psql $DbUrl -X -q -t -A -v ON_ERROR_STOP=1 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "psql failed: $($out -join "`n")"
  }
  return ($out -join "`n").Trim()
}

Write-Host "[0/5] Resetting disposable `marketplace` schema and loading 01..03..."
Invoke-PsqlSql "drop schema if exists marketplace cascade;" | Out-Null
& psql $DbUrl -X -q -v ON_ERROR_STOP=1 -f (Join-Path $ScriptDir '01_schema.sql') | Out-Null
& psql $DbUrl -X -q -v ON_ERROR_STOP=1 -f (Join-Path $ScriptDir '02_access.sql') | Out-Null
& psql $DbUrl -X -q -v ON_ERROR_STOP=1 -f (Join-Path $ScriptDir '03_entitlements.sql') | Out-Null

# Seed baseline fixture for multi-session races (committed so parallel sessions see it).
$FixtureSql = @"
insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true)
on conflict (issuer) do nothing;

do `$`$
declare
  v_issuer constant text := 'https://clerk.logloads.test';
  v_u_land   uuid;
  v_u_mgr    uuid;
  v_u_haul1  uuid;
  v_u_haul2  uuid;
  v_u_admin  uuid;
  v_org_land uuid;
  v_org_h1   uuid;
  v_org_h2   uuid;
  v_land_id  uuid;
  v_job_id   uuid;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  v_u_land  := marketplace.sync_verified_identity(v_issuer, 'conc_land_owner', 'Owner A', 'owner@conc.test', true);
  v_u_mgr   := marketplace.sync_verified_identity(v_issuer, 'conc_land_mgr',   'Manager A', 'mgr@conc.test', true);
  v_u_haul1 := marketplace.sync_verified_identity(v_issuer, 'conc_haul_1',     'Hauler 1', 'h1@conc.test', true);
  v_u_haul2 := marketplace.sync_verified_identity(v_issuer, 'conc_haul_2',     'Hauler 2', 'h2@conc.test', true);
  v_u_admin := marketplace.sync_verified_identity(v_issuer, 'conc_admin',      'Admin',    'admin@conc.test', true);
  reset role;

  insert into marketplace.platform_admins (user_id, admin_role, note)
  values (v_u_admin, 'superadmin', 'Concurrency test admin');

  perform set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'iss', v_issuer, 'sub', 'conc_land_owner', 'aud', 'logloads-app',
    'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;
  v_org_land := marketplace.create_organization('Concurrency Timber', 'conc-timber', 'OR', false);

  perform set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'iss', v_issuer, 'sub', 'conc_haul_1', 'aud', 'logloads-app',
    'exp', extract(epoch from now())::bigint + 3600)::text, true);
  v_org_h1 := marketplace.create_organization('Haul One', 'conc-haul-1', 'OR', true);
  update marketplace.hauler_profiles
  set service_center = extensions.st_GeogFromText('SRID=4326;POINT(-122.68 44.42)'),
      service_radius_miles = 100, accepts_targeted_invitations = true
  where org_id = v_org_h1;
  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled)
  values
    (v_u_haul1, v_org_h1, 'targeted_invitation', 'in_app', true),
    (v_u_haul1, v_org_h1, 'targeted_invitation', 'email',  true);
  insert into marketplace.equipment_units (org_id, equipment_code, unit_label)
  values (v_org_h1, 'log_truck', 'H1-1');

  perform set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'iss', v_issuer, 'sub', 'conc_haul_2', 'aud', 'logloads-app',
    'exp', extract(epoch from now())::bigint + 3600)::text, true);
  v_org_h2 := marketplace.create_organization('Haul Two', 'conc-haul-2', 'OR', true);
  update marketplace.hauler_profiles
  set service_center = extensions.st_GeogFromText('SRID=4326;POINT(-122.69 44.41)'),
      service_radius_miles = 100, accepts_targeted_invitations = true
  where org_id = v_org_h2;
  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled)
  values (v_u_haul2, v_org_h2, 'targeted_invitation', 'in_app', true);
  insert into marketplace.equipment_units (org_id, equipment_code, unit_label)
  values (v_org_h2, 'log_truck', 'H2-1');

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  perform marketplace.open_subscription_cycle(
    v_org_land, 'basic', 'active', now() - interval '1 hour', now() + interval '29 days',
    'cus_conc', 'sub_conc', false, 7, false
  );

  perform set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'iss', v_issuer, 'sub', 'conc_land_owner', 'aud', 'logloads-app',
    'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;
  insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
  values (v_org_land, v_u_mgr, 'manager', true, 'invited');

  perform set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'iss', v_issuer, 'sub', 'conc_land_mgr', 'aud', 'logloads-app',
    'exp', extract(epoch from now())::bigint + 3600)::text, true);
  update marketplace.organization_memberships set status = 'active'
  where org_id = v_org_land and user_id = v_u_mgr;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'iss', v_issuer, 'sub', 'conc_land_owner', 'aud', 'logloads-app',
    'exp', extract(epoch from now())::bigint + 3600)::text, true);
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (v_org_land, 'Concurrency Landing', 'active', 'Near Sweet Home, OR',
          extensions.st_GeogFromText('SRID=4326;POINT(-122.70 44.40)'), 'OR')
  returning id into v_land_id;

  insert into marketplace.job_postings
    (org_id, landing_id, title, pay_amount_cents, pay_unit, trucks_requested, status)
  values
    (v_org_land, v_land_id, 'Concurrency Sawlog Job', 8500, 'per_ton', 10, 'active')
  returning id into v_job_id;

  insert into marketplace.job_posting_equipment (job_id, equipment_code)
  values (v_job_id, 'log_truck');
  reset role;
end
`$`$;
"@
Invoke-PsqlSql $FixtureSql | Out-Null

function Run-ParallelPsql([string]$SqlA, [string]$SqlB) {
  $JobA = Start-Job -ScriptBlock {
    param($Url, $Query)
    $out = $Query | & psql $Url -X -q -t -A -v ON_ERROR_STOP=1 2>&1
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($out -join "`n").Trim() }
  } -ArgumentList $DbUrl, $SqlA

  $JobB = Start-Job -ScriptBlock {
    param($Url, $Query)
    $out = $Query | & psql $Url -X -q -t -A -v ON_ERROR_STOP=1 2>&1
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($out -join "`n").Trim() }
  } -ArgumentList $DbUrl, $SqlB

  Wait-Job $JobA, $JobB | Out-Null
  $ResA = Receive-Job $JobA
  $ResB = Receive-Job $JobB
  Remove-Job $JobA, $JobB
  return @($ResA, $ResB)
}

# =============================================================================
# Race 1: Simultaneous consumption of the final invitation credit (1 unit left)
# =============================================================================
Write-Host "[1/5] Race 1: Two sessions racing for the final (3rd of 3) invitation credit..."
Invoke-PsqlSql "update marketplace.entitlement_periods set invitations_committed = 2;" | Out-Null
$Barrier = Invoke-PsqlSql "select (clock_timestamp() + interval '1500 milliseconds')::text;"

$Race1A = @"
begin;
select pg_sleep_until('$Barrier'::timestamptz);
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', 'conc_land_owner',
  'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
set local role authenticated;
select marketplace.reserve_targeted_invitation(
  (select id from marketplace.job_postings limit 1),
  (select id from marketplace.organizations where slug = 'conc-haul-1'),
  'Session A final credit'
);
commit;
"@

$Race1B = @"
begin;
select pg_sleep_until('$Barrier'::timestamptz);
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', 'conc_land_mgr',
  'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
set local role authenticated;
select marketplace.reserve_targeted_invitation(
  (select id from marketplace.job_postings limit 1),
  (select id from marketplace.organizations where slug = 'conc-haul-2'),
  'Session B final credit'
);
commit;
"@

$R1 = Run-ParallelPsql $Race1A $Race1B
$R1Successes = @($R1 | Where-Object { $_.ExitCode -eq 0 }).Count
$R1Failures  = @($R1 | Where-Object { $_.ExitCode -ne 0 }).Count
$CommittedAfterR1 = [int](Invoke-PsqlSql "select invitations_committed from marketplace.entitlement_periods limit 1;")

if ($R1Successes -ne 1 -or $R1Failures -ne 1 -or $CommittedAfterR1 -ne 3) {
  throw "Race 1 FAILED: expected 1 success, 1 failure, and invitations_committed = 3; got successes=$R1Successes, failures=$R1Failures, committed=$CommittedAfterR1"
}
Write-Host "  PASS: Exactly 1 session claimed the final credit; invitations_committed = 3."

# =============================================================================
# Race 2: Simultaneous multi-channel failure callbacks on the same invitation
# =============================================================================
Write-Host "[2/5] Race 2: Two worker sessions resolving multi-channel failures simultaneously..."
$InvId = Invoke-PsqlSql "select id from marketplace.targeted_invitations where status = 'reserved' limit 1;"
# Ensure both channels exist for this invitation so two callbacks race on the same parent invitation.
Invoke-PsqlSql @"
insert into marketplace.invitation_deliveries (invitation_id, channel, recipient_user_id)
select '$InvId'::uuid, 'email', m.user_id
from marketplace.targeted_invitations ti
join marketplace.organization_memberships m on m.org_id = ti.recipient_org_id
where ti.id = '$InvId'::uuid
on conflict do nothing;
"@ | Out-Null

$DelIds = (Invoke-PsqlSql "select id from marketplace.invitation_deliveries where invitation_id = '$InvId'::uuid order by channel;") -split "`n"
$Del1 = $DelIds[0].Trim()
$Del2 = $DelIds[1].Trim()
$Barrier = Invoke-PsqlSql "select (clock_timestamp() + interval '1500 milliseconds')::text;"

$Race2A = @"
begin;
select pg_sleep_until('$Barrier'::timestamptz);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select marketplace.resolve_invitation_delivery('$Del1'::uuid, 'failed', null, 'channel_1_failed');
commit;
"@

$Race2B = @"
begin;
select pg_sleep_until('$Barrier'::timestamptz);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select marketplace.resolve_invitation_delivery('$Del2'::uuid, 'bounced', null, 'channel_2_bounced');
commit;
"@

$R2 = Run-ParallelPsql $Race2A $Race2B
$R2Successes = @($R2 | Where-Object { $_.ExitCode -eq 0 }).Count
$CommittedAfterR2 = [int](Invoke-PsqlSql "select invitations_committed from marketplace.entitlement_periods limit 1;")

if ($R2Successes -ne 2 -or $CommittedAfterR2 -ne 2) {
  throw "Race 2 FAILED: expected both callbacks to succeed without deadlock and refund exactly 1 credit (3 -> 2); got successes=$R2Successes, committed=$CommittedAfterR2"
}
Write-Host "  PASS: Zero deadlocks and credit refunded once (invitations_committed: 3 -> 2)."

# =============================================================================
# Race 3: Stale reservation reaper vs. concurrent delivery failure callback
# =============================================================================
Write-Host "[3/5] Race 3: expire_stale_invitation_reservations vs. resolve_invitation_delivery..."
$NewInvSql = @"
begin;
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', 'conc_land_owner',
  'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
set local role authenticated;
select marketplace.reserve_targeted_invitation(
  (select id from marketplace.job_postings limit 1),
  (select id from marketplace.organizations where slug = 'conc-haul-2'),
  'Stale reservation race'
);
commit;
"@
Invoke-PsqlSql $NewInvSql | Out-Null
Invoke-PsqlSql "update marketplace.targeted_invitations set created_at = now() - interval '20 minutes' where status = 'reserved';" | Out-Null
$StaleDelId = Invoke-PsqlSql @"
select d.id from marketplace.invitation_deliveries d
join marketplace.targeted_invitations ti on ti.id = d.invitation_id
where ti.status = 'reserved' limit 1;
"@
$Barrier = Invoke-PsqlSql "select (clock_timestamp() + interval '1500 milliseconds')::text;"

$Race3A = @"
begin;
select pg_sleep_until('$Barrier'::timestamptz);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select marketplace.expire_stale_invitation_reservations(interval '15 minutes');
commit;
"@

$Race3B = @"
begin;
select pg_sleep_until('$Barrier'::timestamptz);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select marketplace.resolve_invitation_delivery('$StaleDelId'::uuid, 'failed', null, 'late_webhook_failure');
commit;
"@

$R3 = Run-ParallelPsql $Race3A $Race3B
$R3Successes = @($R3 | Where-Object { $_.ExitCode -eq 0 }).Count
$CommittedAfterR3 = [int](Invoke-PsqlSql "select invitations_committed from marketplace.entitlement_periods limit 1;")

if ($R3Successes -ne 2 -or $CommittedAfterR3 -ne 2) {
  throw "Race 3 FAILED: expected both workers to succeed and refund at most once (3 -> 2); got successes=$R3Successes, committed=$CommittedAfterR3"
}
Write-Host "  PASS: Stale reaper and late webhook serialized cleanly; refunded once (3 -> 2)."

# =============================================================================
# Race 4: Concurrent billing-cycle creation & founding promotion cycle counter
# =============================================================================
Write-Host "[4/5] Race 4: Simultaneous open_subscription_cycle calls for same period..."
Invoke-PsqlSql @"
insert into marketplace.promotions
  (code, program, state_code, percent_off, billing_cycles, max_redemptions, starts_at, status)
values ('founding_or_conc', 'founding_landing', 'OR', 50.00, 6, 10, now() - interval '1 day', 'active');

select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', 'conc_admin',
  'aud', 'logloads-app', 'exp', extract(epoch from now())::bigint + 3600)::text, true);
set role authenticated;
select marketplace.admin_set_org_verification(
  (select id from marketplace.organizations where slug = 'conc-timber'), 'verified', 'Concurrency test verification'
);
select marketplace.admin_grant_founding_promotion(
  'founding_or_conc', (select id from marketplace.organizations where slug = 'conc-timber'), 'Concurrency promo grant'
);
reset role;
"@ | Out-Null

$NextStart = Invoke-PsqlSql "select (now() + interval '30 days')::timestamptz::text;"
$NextEnd   = Invoke-PsqlSql "select (now() + interval '60 days')::timestamptz::text;"
$Barrier   = Invoke-PsqlSql "select (clock_timestamp() + interval '1500 milliseconds')::text;"

$Race4Sql = @"
begin;
select pg_sleep_until('$Barrier'::timestamptz);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select marketplace.open_subscription_cycle(
  (select id from marketplace.organizations where slug = 'conc-timber'),
  'basic', 'active', '$NextStart'::timestamptz, '$NextEnd'::timestamptz,
  'cus_conc', 'sub_conc', false, 7, false
);
commit;
"@

$R4 = Run-ParallelPsql $Race4Sql $Race4Sql
$R4Successes = @($R4 | Where-Object { $_.ExitCode -eq 0 }).Count
$CyclesApplied = [int](Invoke-PsqlSql "select cycles_applied from marketplace.promotion_redemptions limit 1;")
$PeriodCount   = [int](Invoke-PsqlSql "select count(*) from marketplace.entitlement_periods where period_start = '$NextStart'::timestamptz;")

if ($R4Successes -ne 2 -or $CyclesApplied -ne 1 -or $PeriodCount -ne 1) {
  throw "Race 4 FAILED: expected 2 successes, 1 entitlement_periods row, and cycles_applied = 1; got successes=$R4Successes, periods=$PeriodCount, cycles_applied=$CyclesApplied"
}
Write-Host "  PASS: Duplicate concurrent cycle webhooks created 1 period row and incremented cycles_applied once."

Write-Host "[5/5] Cleaning up disposable `marketplace` schema..."
Invoke-PsqlSql "drop schema if exists marketplace cascade;" | Out-Null
Write-Host "ALL 4 MULTI-SESSION CONCURRENCY TESTS PASSED."

