# LogLoads — Security Posture

> **Status:** Last verified 2026-11-02. This document separates **historical evidence**, **implemented
> controls**, **target architecture**, and **unverified requirements**. The labels are defined in
> [`README.md`](./README.md) §2.
>
> **There is no blanket "SECURITY VERIFIED" status.** The July 2026 verification applied to one live Supabase
> project and the schema of that date. It does not extend to later code or to the V2 preview.
>
> The normalized-v2 baseline (`01`–`05`) is **VERIFIED in CI on disposable PostgreSQL 17**
> ([`CI.md`](./CI.md) §3). That proves the SQL-level behavior with simulated claims. It says **nothing** about
> live Supabase or real Clerk tokens (§4).
>
> The full original security record is preserved verbatim at
> [`archive/security/SECURITY_RECORD_2026-08-05.md`](./archive/security/SECURITY_RECORD_2026-08-05.md):
> first verified 2026-07-08, last revised 2026-08-05.

In this document, **IMPLEMENTED (code)** means present in the repository at `4c9518e`. This review did not
inspect the deployed production configuration.

## 1. Historical findings and verification evidence — July 2026 (HISTORICAL)

These results were observed against the live Supabase project on the stated dates. They remain important
evidence, and the controls they established are still in the migrations. They have **not** been re-verified
for this revision.

### 1.1 Critical exposure found and closed — anon read/write on `operating_state`

- `public.operating_state` (then a mirror, now the canonical store, holding all PII) had a policy,
  `operating_state_rw`, granting **anon** full read and write. The publishable anon key could have read or
  overwritten the entire operating state.
- Fixed in `supabase/migrations/20260707050000_security_rls_coverage.sql`: the permissive policy was dropped
  and anon/authenticated grants were revoked. The table is RLS-enabled with **no policy**, so PostgREST
  denies everyone except the service role.
- `20260711034301_canonical_operating_state.sql` makes the service-role grants explicit (`SELECT`, `INSERT`,
  `UPDATE` only; no delete path).
- Verified from outside with the live anon key on 2026-07-08: `GET` and `POST /rest/v1/operating_state` →
  permission denied; `GET /rest/v1/driver_profiles` → permission denied; `request_capacity` not callable;
  `is_org_member` → permission denied.

### 1.2 RLS coverage gap — reconciled

The foundation migration (`20260604190000`) created 19 tables without RLS. Phase 2 (`20260706090000`)
covered 21 tables, but only 5 of the foundation tables. Two apparently conflicting reports were both subsets of
the same original coverage gap. `20260707050000` closed it. The July inventory was 36 public tables: 35
RLS-enabled, plus the PostGIS `spatial_ref_sys` exception. The per-table list is in the archived record.

### 1.3 Accepted Supabase advisor exceptions (as of July 2026)

| Finding | Level | Reason accepted |
|---|---|---|
| `spatial_ref_sys` RLS disabled | ERROR | PostGIS extension-owned; public SRID reference data only |
| `postgis` extension in `public` | WARN | Moving it risks breaking geography columns |
| `st_estimatedextent(...)` executable by anon/authenticated | WARN | Extension-owned, not revocable |
| RLS helper functions executable by `authenticated` | WARN | Required for RLS evaluation |
| `operating_state` RLS enabled, no policy | INFO | Intentional deny-all-but-service-role |

### 1.4 Later hardening evidence

- **Shared rate limiting** (`20260713053327_shared_rate_limit_windows.sql`): on 2026-07-12, an isolated
  local PostgreSQL 17 accepted the migration. 12 concurrent sessions produced exactly the counts 1–12, and
  anon/authenticated execution was denied. Live application of the migration, and exact-SHA multi-instance
  and outage proof, were recorded as cutover gates. Their completion is not evidenced in the repository.
- `20260726090000_revoke_public_relational_grants.sql` and
  `20260808230214_admin_manage_billing_permission.sql` revoked further relational grants. Their live
  application status is not recorded here.

## 2. Current pilot canonical-state controls — IMPLEMENTED (code)

The deployed pilot keeps nearly all business data in one JSON document. **RLS does not protect application
reads or writes of that document,** because the server uses the service-role key, which bypasses RLS. Tenant
isolation for the pilot therefore depends on the service-layer authorization below. Keep it intact for as long
as the legacy code is reachable.

- **Storage boundary:** `operating_state` is service-role only. The repository layer requires
  `SUPABASE_SERVICE_ROLE_KEY` (`packages/db/src/snapshot.ts`). Writes are full-document compare-and-swap on a
  monotonic `version`. A malformed row is withheld from runtime state, not erased.
- **Identity:** `apps/web/lib/session.ts` resolves the actor from the Clerk session or from a tightly
  restricted loopback development session. Client-supplied actor, role, or organization IDs are never trusted.
- **Membership boundary:** reads and mutations require an active user, a non-archived exact organization, and
  one unambiguous active membership. Suspension and removal take effect on the next request. Last-owner,
  self-removal, duplicate-membership, and non-grantable-role cases fail closed.
- **Refusal boundary:** service-layer preconditions throw `DomainRefusalError`. The shared HTTP mapper
  returns one constant `409` body, and unknown errors return a sanitized `500`. No cross-tenant identifier or
  existence detail leaks.
- **Private responses:** authenticated private JSON, signatures, route packs, trip activity, and media carry
  `Cache-Control: private, no-store`, including refusals.
- **Rate limiting:** shared Supabase fixed windows via a service-role-only `SECURITY INVOKER` RPC with an
  empty `search_path`. Keys are HMAC-SHA-256 digests, never raw IPs, emails, or IDs. Production fails closed
  when the store is unavailable or partially configured. `requestClientKey()` throws when
  `LOGLOADS_RATE_LIMIT_HMAC_SECRET` is absent (`apps/web/lib/rate-limit-client-key.ts`), so that secret is
  operationally required ([`ENV_CONTRACT.md`](./ENV_CONTRACT.md)). On Vercel, only the platform-overwritten
  forwarding header is trusted.
- **Platform-admin authority:** `profiles.role = admin` is historical data, not authorization. Admin
  sessions must match exactly one server-configured Clerk user ID and the configured scope SHA-256. The
  one-time bootstrap claim is separately gated and expiring.
- **Private media:** active only when the Supabase URL, the expected project reference, the bucket, and the
  keys all validate. Uploads are read back and validated server-side. Delivery uses five-minute signed URLs
  after authorization. Cloudinary is not an active provider.
- **Historical commercial gates:** `LOGLOADS_FEE_COLLECTION`, `LOGLOADS_PERCENTAGE_ENROLLMENT`,
  `LOGLOADS_SUBSCRIPTION_COLLECTION`, and `LOGLOADS_DISPATCH_SELF_SERVE` default to disabled and fail closed.
  Card setup is non-activating. Stripe calls assert the expected account and live/test mode. These gates
  protect **historical** obligations only. They must not be repurposed to activate the new model
  ([`ACTIVATION_STRIPE.md`](./ACTIVATION_STRIPE.md)).
- **Write bounds on the shared document (#187, HF-02):** stored text fields have length caps in
  `packages/contracts`, and new load titles are capped at 140 characters. The API write routes read their JSON
  body through a 64 KiB cap (`apps/web/lib/request-body.ts`, `413`). Notice and trip-event writes have per-user
  limits that the API routes and the cockpit actions share (`apps/web/lib/write-limits.ts`). The snapshot
  writer refuses a write that would make the document larger than 8 MiB (`OPERATING_STATE_MAX_BYTES`); the
  client gets `507` with a fixed message, and the operator log gets the sizes.
- **Upload ownership (#187, HF-07):** every new attachment must be exactly `<prefix>/uploads/<uuid>` for the
  caller's own target. The rule is in `packages/contracts/src/upload-ids.ts`, and both the web routes and the
  services check it. Stored references, including seeded legacy ids, are read unchanged.

### 2.1 Response headers and the Content-Security-Policy plan

**IMPLEMENTED (code):** `apps/web/next.config.ts` sends baseline headers on every route. The enforced
`Content-Security-Policy` is `frame-ancestors 'none'`, with `X-Frame-Options: DENY`, `nosniff`,
`strict-origin-when-cross-origin` and a restrictive `Permissions-Policy`. The full policy is sent beside it as
`Content-Security-Policy-Report-Only`. The comment above `contentSecurityPolicyReportOnly` lists each allowed
origin and why it is there, and `apps/web/lib/security-headers.test.ts` reads the header.

- The report-only policy blocks nothing. It has no `report-uri` and no `report-to`, so no report leaves the
  browser. Violations appear only in the browser console. Chromium logs a report-only violation at the `info`
  level, not `error` (checked in Edge on 2026-11-03), so the existing Playwright checks for console errors do
  not catch them.
- `next.config.ts` headers are computed at build time. The Clerk, PostHog and Mapbox origins come from
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_MAPBOX_TOKEN` in the **build**
  environment, so a build made without them leaves those origins out.
- `script-src` keeps `'unsafe-inline'`, because a static header cannot carry a per-request nonce for the Next.js
  inline scripts. Until step 4 below, the policy constrains where scripts, connections, frames and forms may go,
  and blocks plugins and `<base>` rewrites. It does not stop an injected inline script.

**Enforcement plan (TARGET; each step is a separate, reviewed change):**

1. **Observe.** In a non-production preview with Clerk, Stripe test mode, the CARTO key and PostHog configured,
   walk the public pages, sign-in, every cockpit, the map, a photo and a document upload, card setup, and the V2
   pages. Record every `[Report Only]` console line and fix the allowlist or the code. Nothing leaves the
   browser, so this needs no report endpoint.
2. **Make violations fail CI.** Add a Playwright console listener to the smoke and DS-05 suites that fails on
   any message containing `Content Security Policy`, so a new origin cannot be added silently.
3. **Enforce the static policy.** Move the same string into the enforced `Content-Security-Policy` header,
   replacing the `frame-ancestors`-only value, and keep it in report-only for one release before dropping the
   duplicate. Confirm on the first production-like deploy that Clerk sign-in, Stripe card setup, uploads and
   the map still work.
4. **Nonces instead of `'unsafe-inline'` for scripts.** Generate a nonce per request in `apps/web/middleware.ts`,
   send `script-src 'self' 'nonce-…' 'strict-dynamic'` (Next.js applies the nonce to its own inline scripts),
   report-only first, then enforced. Measure the cost first: a nonce makes every page render dynamically.
   `style-src 'unsafe-inline'` stays for React `style` attributes, or moves to `style-src-attr`.
5. **Narrow the wildcards.** Allow the Supabase media project only on the pages that upload, instead of
   `*.supabase.co` everywhere. When PostHog is connected, decide whether its heatmap viewer may frame LogLoads
   (`frame-ancestors`; #187 follow-up 5).

If a first-party report collector is wanted later, it must be same-origin, rate-limited, store no page content
beyond the directive and blocked origin, and never forward reports to a third party.

## 3. Current V2 preview controls — IMPLEMENTED (code, development preview)

The `/v2` load-board preview (`apps/web/app/v2`, `apps/web/lib/marketplace-v2`) runs on the same pilot
store and inherits §2. In addition:

- **Exposure gate:** renders only when `LOGLOADS_MARKETPLACE_V2=enabled`, and never when
  `VERCEL_ENV=production` (`flag.ts`). When disabled, the layout returns `notFound()`. The layout is always
  `noindex, nofollow`. **Note:** the code permits hosted *Preview* deployments when the flag is set. Do not set
  it there without an approved, isolated preview plan ([`DEPLOYMENT.md`](./DEPLOYMENT.md) §4).
- **Identity:** server actions call `getSessionActor()`; signed-in pages use `resolveV2Viewer()`
  (`viewer.ts`). Both require an active organization. Viewer IDs never come from form input.
- **Authority:** explicit V2 capabilities, as of `4c9518e`:
  - **Hauler side:** `interest.express`, `interest.withdraw`, `interest.reply`, `equipment.manage`.
  - **Landing side:** `job.publish`, `landing.manage`, `inquiry.respond`.

  `packages/contracts/src/marketplace-permissions.ts` defines them, restating the normalized-v2 role sets
  (owner/manager/staff/driver plus landing seat). Drivers never gain landing capabilities.
  `packages/services/src/marketplace-access.ts` translates pilot roles into that membership. It is
  side-limited: billing, viewer, and destination-manager roles get nothing, and a landing seat requires
  operating a landing. The legacy `request_assignment` and `publish_load` checks no longer authorize V2
  actions.
- **Job authoring:** `/v2/landing/jobs` (and its `/new` and `/preview` pages) validates a draft against
  `marketplace-job-draft.ts`. That includes the sensitive-access-text rule, which mirrors
  `contains_sensitive_access_pattern`. Publish and reconfirm require `job.publish` and are rate limited per user
  (`marketplace-publish` 20/hour, `marketplace-reconfirm` 120/hour). The pilot adapter reports
  `supportsPublishing: false`, so **nothing is persisted on the pilot store**. Only the normalized adapter
  persists them, when deliberately selected outside production (§4.1).
- **Integrity:** one live interest per job and hauler business. Replies are replay-safe. Every transition
  writes an audit event inside the compare-and-swap mutation.
- **Abuse limits:** `checkRateLimit` per user (`apps/web/lib/marketplace-v2/actions.ts`):
  - interest submissions: 20/hour;
  - hauler follow-up replies: 60/hour;
  - landing responses: 120/hour.

  Both reply limits share the `marketplace-reply` bucket. Withdrawal has no separate limit.
- **Redaction:** reads come from the redacted public network projection (`apps/web/lib/network.ts`, which
  rounds public coordinates to 0.02°). `mapping.ts` maps only approximate points and never maps access notes,
  exact coordinates, or contacts into V2 views.

  **Open finding (#141):** the 0.02° grid is finer than the approved 0.10° public precision (**V2-DEC-01**,
  `DECISIONS.md` 2026-11-02). The pilot path's implementation is tracked in #141 (Codex, after #105).
- **Not yet present:** an explicit, audited private-detail disclosure action. Expressing interest alone
  unlocks nothing in V2. The pilot's assignment-triggered disclosure is legacy behavior and is not carried
  into V2.

## 4. Normalized-v2 RLS and Clerk authentication (TARGET; SQL baseline VERIFIED)

The schema is owned by Gemini. Its validated copy is on branch `test/normalized-v2-postgres17-ci` at
`ec4bb66`, which includes Claude Agent 1's fixes, for example the `job_postings` read policy that blocked
`INSERT … RETURNING`. It is not merged, not connected to the application, and not applied to any hosted
project. It designs:

- a `marketplace` schema of 32 tables, with RLS on every table and anon-readable public projections
  implemented as RLS policies, not views;
- `landing_private_details` with no anon grant or policy;
- identity resolution through `marketplace.current_user_id()`. It requires a non-empty `iss` matching an
  enabled `trusted_identity_issuers` row, a non-empty `sub`, an explicit `role = authenticated`, a numeric
  future `exp`, a valid `nbf` when present, and a pinned `aud` when configured. It then resolves
  `(issuer, sub)` through `identity_links` to an active `app_users` row;
- audited `SECURITY DEFINER` functions for invitations, entitlement cycles, and boosts, with row-locking
  designed for concurrency.

**Simulated claims are not verified tokens.** The prototype's SQL tests (`04_tests.sql`,
`05_concurrency_test.*`) use `set_config('request.jwt.claims', …)` with `SET LOCAL ROLE`. That exercises
*claim inspection and RLS policies only* (layer 2). Cryptographic verification of a Clerk-signed token — the
RS256 signature against Clerk's JWKS, issuer, and expiry — happens at Supabase's API gateway through the
third-party auth integration (layer 1). Only an end-to-end test that sends real Clerk tokens through a
configured Supabase project proves layer 1. A passing SQL suite never does.

**What the CI baseline does verify** (layer 2 only, on disposable PostgreSQL 17):

- DDL execution;
- grants and RLS denials for simulated anon, authenticated and service roles;
- claim inspection;
- the four multi-session invitation and entitlement races.

Evidence: [`CI.md`](./CI.md) §3. The `06`–`10` alignment stages are **VERIFIED in CI** on draft PR #123, which
is still unreviewed. The same layer-2-only limit applies to them.

**Service-role bypass still applies.** If the application reaches normalized tables with the service-role
key, RLS protects nothing on that path. A target design must either carry the verified user token to
PostgREST or keep explicit service-layer authorization.

### 4.1 Adapter identity path — decided 2026-11-03 (#139; IMPLEMENTED, development only)

The normalized `MarketplaceV2Port` adapter (`apps/web/lib/marketplace-v2/normalized-*.ts`) uses **explicit
service-layer authorization over the schema's functions, as the session's person**:

1. The server identifies the person from its own session (`getSessionActor()`; Clerk verifies the session
   token). The adapter refuses a viewer that is not the session's user.
2. It connects directly to PostgreSQL (postgres.js) as a **dedicated login role** that can do nothing by itself.
   It must be NOINHERIT, with no superuser, BYPASSRLS, CREATEROLE or replication attributes, and own neither the
   schema nor any table, function or type in it. It must not belong to `service_role`, to any role with superuser,
   BYPASSRLS or CREATEROLE, or to any other role that `anon` and `authenticated` do not already reach (for example
   `pg_write_all_data`), directly or through other roles (HF-22, #187). It may only switch to `anon` and
   `authenticated`. `createPostgresMarketplaceDb` checks the login role itself (`session_user`) on first use and
   refuses any other credential.
3. Each call is one transaction. It runs `set_config('role', 'authenticated', true)` and sets
   `request.jwt.claims` to the configured issuer, the session's Clerk user id and the pinned audience, with a
   60-second expiry. These are the settings PostgREST makes after verifying a token. `current_user_id()`, every
   function's role check and every RLS policy then apply to that person. Both settings are transaction-local, so
   no identity survives on a pooled connection. Public discovery runs as `anon`.
4. The adapter adds one check of its own. Every write is bound to the viewer's **active** business, so a
   person's other businesses are untouched, even ones they belong to. It calls only a fixed list of user
   functions (`MARKETPLACE_FUNCTIONS`). Those exclude worker, billing, admin and legacy-import functions.

**Session memberships and identity linking (#213).** With the normalized adapter selected, V2's session
(`apps/web/lib/marketplace-v2/v2-session.ts`) takes the person and their businesses from the normalized store, not
from the pilot account context. The read runs as the person, through the same identity-bound transaction:
`current_user_id()`, `memberships_read`, `organizations_read` and `get_viewer_marketplace_access` decide which active
memberships of active businesses are listed. The signed cookie's business selection counts only while it is one of
them. Every request reads them again, so a removed membership or a suspended business loses access on the next
request, and the switch action refuses a stale choice server-side. A first sign-in is linked through
`sync_verified_identity`, keyed to the Clerk user id from the server session, or to the dev profile's linked Clerk id
on the loopback bench. That function is granted to `service_role` only, and the adapter's login role can never become
`service_role`. Linking therefore uses a second, optional credential (`LOGLOADS_NORMALIZED_IDENTITY_SYNC_DATABASE_URL`):
a NOINHERIT login role that can switch only to `service_role`, owns nothing in the schema and calls only that one
function. `createPostgresIdentitySync` checks it on first use, and it stores an email only when Clerk verified it.
Without that credential nothing is written, and a sign-in the store has not linked yet has no business there. On this
store `/v2/start/hauler` creates the business through `create_organization` as the person, who becomes its owner,
and selects it. Legacy cockpits keep the pilot session.

**Why not the verified-token path yet.** Real Clerk tokens through Supabase third-party auth are not verified
(#112). Building on them now would rest the adapter on an unproven trust path, and local loopback development
sessions carry no Clerk token. This path is verifiable today on a disposable database
(`.github/workflows/normalized-adapter-ci.yml`).

**What it trusts.** The database trusts the server's assertion of identity. Anyone holding the adapter's
database credential can act as any user, but only as that user would through the API: never as `service_role`,
and never past RLS. That is narrower than the pilot's service-role key, which reads and writes everything. Keep
the credential server-side, like the service-role key. The asserted claims reuse the real Clerk issuer row. That
residual (HF-23) is accepted for now and tracked in #187 until #112 allows a separate issuer row for server-asserted
identity. When #112 is verified, a PostgREST transport that carries
the user's own token can replace `normalized-db.ts`. `normalized-mapping.ts` already consumes PostgREST-shaped JSON
and does not change.

**Selection.** `LOGLOADS_MARKETPLACE_V2_ADAPTER=normalized`, together with `LOGLOADS_NORMALIZED_DATABASE_URL`,
`LOGLOADS_NORMALIZED_IDENTITY_ISSUER` and `LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE`, selects the normalized adapter.
The default is the pilot adapter. `VERCEL_ENV=production` always selects the pilot adapter, and an incomplete
selection fails closed rather than falling back to the pilot store (`adapter.ts`). No hosted database has the
schema or the role. Provisioning them is a separate, approved step.

## 5. Unverified requirements (UNVERIFIED unless marked)

Do not claim the corresponding security property until the evidence exists. Record each result with its date,
SHA, environment, and command output.

| # | Requirement | Applies to |
|---|---|---|
| 1 | Re-run the anon/authenticated denial probes and the advisor review against the **current** production project, read-only. Record the date. | Pilot |
| 2 | Confirm that migrations `20260713053327`, `20260726090000`, and `20260808230214` are applied live, and that the ledger matches the repository. | Pilot |
| 3 | Exact-SHA multi-instance rate-limit proof and simulated store outage → `503` | Pilot |
| 4 | ~~Execute `01`–`05` on a disposable PostgreSQL 17/PostGIS in CI~~ — **VERIFIED** at `ec4bb66` ([`CI.md`](./CI.md) §3). `06`–`10` are VERIFIED in CI on draft PR #123 (head recorded in `CI.md` §3). Still open: review and merge of PR #123, and integration of the CI branch. | Normalized-v2 |
| 5 | Configure Supabase third-party auth for a **development** Clerk instance. Prove that forged, expired, wrong-issuer, and wrong-audience tokens are rejected at the gateway, and that valid tokens resolve to the right `app_users` row. Harness and runbook: §5.1. | Normalized-v2 |
| 6 | Cross-tenant denial matrix: anon, authenticated stranger, member of another org, removed member, multi-org user switching context, platform admin without a support reason | Normalized-v2 and V2 adapter |
| 7 | `SECURITY DEFINER` review: owners, `search_path`, grants, and exposure through the Data API | Normalized-v2 |
| 8 | Parity between the `marketplace-permissions.ts` capability sets (added in `4c9518e`, unit-tested) and the normalized RLS role sets, proven on an executed database. Rate limits on publish/reconfirm before persistence is enabled. | V2 and normalized-v2 |
| 9 | Audited private-detail disclosure and revocation, with tests proving interest alone discloses nothing | V2 |
| 10 | Invitation quota races (final credit, double failure callback, reaper versus callback, duplicate cycle webhook) under real concurrent sessions. **VERIFIED at the SQL level** by stage 5 ([`CI.md`](./CI.md) §3). Still open: the same behavior through the application and real webhooks. | Normalized-v2 |
| 11 | Migration rehearsal on synthetic data, with historical financial records preserved read-only | Cutover |

### 5.1 Verify Clerk → Supabase third-party auth (development)

**Status:** the harness is IMPLEMENTED. The live result is **UNVERIFIED** until the founder creates the
development providers below and runs it (#112). Development only: the harness refuses production keys and any
project that is not on its allowlist.

`tools/verify-clerk-supabase-auth.mjs` sends tokens through the Supabase API gateway and PostgREST, and checks
each #112 acceptance criterion:

- **AC1.** A valid token resolves its own `app_users` row and reads only its own tenant's rows.
- **AC2.** Five kinds of bad token are rejected at the gateway or resolve to no user: forged (payload edited
  after signing, foreign signing key, `alg: none`), expired, wrong issuer, wrong audience and missing role.
- **AC3.** A removed membership loses access on the next request, with the same still-valid token.

It prints a pass/fail table with no keys, tokens, user IDs, row IDs or project reference.

**What runs today without keys** (in `.github/workflows/normalized-v2-ci.yml`):

- **Stage 21** (`architecture/normalized-v2/21_v2_auth_claims_membership_tests.sql`) works at the database
  layer, with simulated claims. It adds the cases that 04 and 17 do not cover:
  - audience arrays and a missing audience;
  - `nbf` and a non-numeric `exp`;
  - a spoofed `role`;
  - blank and differently-cased subjects;
  - issuer spelling, and a subject presented under another trusted issuer;
  - a disabled issuer, and suspended or deactivated users;
  - tenant isolation for a valid token;
  - loss of access on the next statement after a suspension, a removal or an organization suspension.
- **Stage 22** (`architecture/normalized-v2/22_clerk_auth_harness_local.sh`) runs this harness with
  `--local-stack`, twice, on the disposable Supabase CLI stack. Locally signed tokens stand in for Clerk:
  - PostgREST rejects the forged and expired tokens;
  - the wrong-issuer, wrong-audience and missing-role tokens are validly signed, and resolve to no user;
  - the AC3 flow and the cleanup run as they would live.

Neither proves the one thing that needs the providers: that Supabase verifies **Clerk-signed** RS256 tokens
against Clerk's JWKS, and that Clerk's session claims match the issuer row.

**Owner steps (development providers only; never the production project or instance):**

1. **Clerk.** Create a development instance of the LogLoads Clerk application. Create two test users, and note
   their user IDs (`user_…`). Do not create Clerk Organizations: LogLoads organizations live in the database,
   and the harness creates its own two (`logloads-authcheck-a` and `-b`) as those users.
2. **Session token claims.** Under Sessions → Customize session token, add
   `{"role": "authenticated", "aud": "logloads-dev"}`. Clerk's "Connect with Supabase" setup adds the `role`
   claim on its own, but the audience must be added by hand. Every enabled trusted issuer pins an audience
   (LE-09), so a token without one never resolves a user.
3. **Two JWT templates**, for the wrong-audience and missing-role checks. Use the default signing key.
   - `logloads-authcheck-wrong-audience`, with claims
     `{"role": "authenticated", "aud": "logloads-authcheck-not-this-app"}`.
   - `logloads-authcheck-no-role`, with claims `{"aud": "logloads-dev"}` (the step 2 audience).

   Without them, those two checks report SKIP, and `--require` fails the run.
4. **Supabase.** Create a development project. Apply the normalized-v2 chain to it in the order the CI
   alignment job uses (01, 02, 03, 06, 11, 12, 16, then any later migration file there). Apply each file in one
   transaction: `psql <development connection string> -v ON_ERROR_STOP=1 --single-transaction -f <file>`.
   Then add `marketplace` to the exposed schemas in the project's Data API settings.
5. **Third-party auth.** In the project's Authentication settings, add Clerk under Third-Party Auth, with the
   development domain (`<slug>.clerk.accounts.dev`). Then register the issuer in the SQL editor:
   `insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled) values ('https://<slug>.clerk.accounts.dev', 'Clerk development', 'logloads-dev', true);`
6. **Environment.** Put these in the Doppler `dev` config, or in an env file outside the repository. Never
   commit them.

   | Variable | Value |
   |---|---|
   | `SUPABASE_URL` | The development project's URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Its publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | Its secret key, used only for the `sync_verified_identity` worker RPC |
   | `CLERK_SECRET_KEY` | The development instance's `sk_test_` key |
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Its `pk_test_` key (recommended: it lets the harness check the token issuer) |
   | `LOGLOADS_SUPABASE_DEV_PROJECT_REFS` | The development project's reference |
   | `LOGLOADS_AUTH_HARNESS_CLERK_USER_IDS` | `<user A id>,<user B id>` |

**The command:**

```bash
doppler run --config dev -- node tools/verify-clerk-supabase-auth.mjs --require
# or: node --env-file=<file outside the repo> tools/verify-clerk-supabase-auth.mjs --require
```

**A pass** is 11 PASS rows, ending with
`verify-clerk-supabase-auth: PASS: 11 passed, 0 failed or not run, 0 skipped (live).` The run takes about a
minute, because it waits for a 15-second token to expire. Expected evidence:

- forged tokens: "rejected at the gateway (HTTP 401 …)";
- the expired token: "accepted while valid; after expiry: rejected at the gateway";
- the wrong-issuer token: rejected at the gateway, because no trusted key signed it;
- the wrong-audience and missing-role tokens: "resolved to no user". Clerk signs them, so the gateway accepts
  them, and the database refuses them.

**Exit codes:** 0 is a pass, 1 is a failure, and 2 is a refusal. Without its environment the harness prints
`skipped: …` and exits 0, or 1 with `--require`.

**What it refuses (exit 2, nothing sent):**

- `sk_live_` or `pk_live_` keys, or a publishable key that does not name a `*.clerk.accounts.dev` frontend API;
- a Supabase URL that is not `https://<ref>.supabase.co`, or whose reference is not listed in
  `LOGLOADS_SUPABASE_DEV_PROJECT_REFS`;
- Supabase keys that belong to another project or role.

It also stops before any Supabase request if Clerk reports a production instance, or if a minted token's issuer
is not a development frontend API. Requests never follow a redirect.

**What it changes in the development project:**

- it links the two test users;
- on first use, it creates the two fixture organizations, with one equipment row each, and reuses them on later
  runs;
- each run adds one removed membership of user B in organization A.

Cleanup always leaves B without a live membership in A, and revokes the Clerk sessions the run created. A
membership left live by an interrupted run is removed at the next start.

**Troubleshooting.** A preflight message names the step to revisit:

- a missing `role` or `aud` claim: step 2;
- a template not found: step 3;
- the schema not reachable: step 4;
- an untrusted identity issuer: step 5.

If AC1 says "resolved to no user", the token's `aud` differs from the issuer row's `expected_audience`.

**After a pass:** post the run's output on #112, with the date and the commit SHA. It contains no keys,
tokens, user IDs, row IDs or project reference.

**Never post the output of a refused run** (exit code 2, a line starting `verify-clerk-supabase-auth: refused:`),
on #112 or anywhere else. A refusal can name the project reference it refused. Fix the configuration and run it
again.

The docs lane then records the result in [`CI.md`](./CI.md) §3 and in row 5 above. A pass is evidence for the
development environment only. It does not authorize enabling the integration anywhere else.

## 6. Handling rules

- Never put secrets, service-role keys, Clerk secrets, real tokens, backup files, or private landing details
  into Git, issues, PRs, logs, or chat.
- Security probes against production are read-only and need explicit authorization. Mutation testing uses
  disposable environments only.
- Report a suspected vulnerability privately to the founder. Do not open a public issue with exploit detail.
- When a control changes, update this document and add a dated entry to [`DECISIONS.md`](./DECISIONS.md) if
  it changes an architecture or provider boundary.
