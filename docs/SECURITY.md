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
  `contains_sensitive_access_pattern`. Publish and reconfirm require `job.publish`, but the pilot adapter
  reports `supportsPublishing: false`, so **nothing is persisted**. The publish and reconfirm actions apply no
  rate limit; add one before persistence is enabled.
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
PostgREST or keep explicit service-layer authorization. The choice is open (TRANSITION_PLAN, "Identity").

## 5. Unverified requirements (UNVERIFIED unless marked)

Do not claim the corresponding security property until the evidence exists. Record each result with its date,
SHA, environment, and command output.

| # | Requirement | Applies to |
|---|---|---|
| 1 | Re-run the anon/authenticated denial probes and the advisor review against the **current** production project, read-only. Record the date. | Pilot |
| 2 | Confirm that migrations `20260713053327`, `20260726090000`, and `20260808230214` are applied live, and that the ledger matches the repository. | Pilot |
| 3 | Exact-SHA multi-instance rate-limit proof and simulated store outage → `503` | Pilot |
| 4 | ~~Execute `01`–`05` on a disposable PostgreSQL 17/PostGIS in CI~~ — **VERIFIED** at `ec4bb66` ([`CI.md`](./CI.md) §3). `06`–`10` are VERIFIED in CI on draft PR #123 (head recorded in `CI.md` §3). Still open: review and merge of PR #123, and integration of the CI branch. | Normalized-v2 |
| 5 | Configure Supabase third-party auth for a **development** Clerk instance. Prove that forged, expired, wrong-issuer, and wrong-audience tokens are rejected at the gateway, and that valid tokens resolve to the right `app_users` row. | Normalized-v2 |
| 6 | Cross-tenant denial matrix: anon, authenticated stranger, member of another org, removed member, multi-org user switching context, platform admin without a support reason | Normalized-v2 and V2 adapter |
| 7 | `SECURITY DEFINER` review: owners, `search_path`, grants, and exposure through the Data API | Normalized-v2 |
| 8 | Parity between the `marketplace-permissions.ts` capability sets (added in `4c9518e`, unit-tested) and the normalized RLS role sets, proven on an executed database. Rate limits on publish/reconfirm before persistence is enabled. | V2 and normalized-v2 |
| 9 | Audited private-detail disclosure and revocation, with tests proving interest alone discloses nothing | V2 |
| 10 | Invitation quota races (final credit, double failure callback, reaper versus callback, duplicate cycle webhook) under real concurrent sessions. **VERIFIED at the SQL level** by stage 5 ([`CI.md`](./CI.md) §3). Still open: the same behavior through the application and real webhooks. | Normalized-v2 |
| 11 | Migration rehearsal on synthetic data, with historical financial records preserved read-only | Cutover |

## 6. Handling rules

- Never put secrets, service-role keys, Clerk secrets, real tokens, backup files, or private landing details
  into Git, issues, PRs, logs, or chat.
- Security probes against production are read-only and need explicit authorization. Mutation testing uses
  disposable environments only.
- Report a suspected vulnerability privately to the founder. Do not open a public issue with exploit detail.
- When a control changes, update this document and add a dated entry to [`DECISIONS.md`](./DECISIONS.md) if
  it changes an architecture or provider boundary.
