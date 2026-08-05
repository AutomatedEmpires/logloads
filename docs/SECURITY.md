# LogLoads — Security Record

Authoritative record of the database security posture. Verified against the live
Supabase project `fdzohbiiyzgvjzfsjyxo` on 2026-07-08. The next agent should not
have to rediscover any of this.

## Status: SECURITY VERIFIED

- 36 public tables · **35 RLS-enabled** · 1 documented PostGIS exception
- `operating_state` (the only data-bearing table): **service-role only**
- Anonymous read/write denied (proven from outside with the live anon key)
- PII access denied · sensitive RPCs no longer anonymous · function search_paths pinned
- Supabase security advisor: **zero application-table ERRORs**

## Distributed abuse controls

- Sign-in, contact, onboarding, and authenticated mutation routes consume shared,
  atomic fixed-window limits through the existing Supabase Postgres stack.
- Migration `20260713053327_shared_rate_limit_windows.sql` adds an RLS-enabled table and `SECURITY INVOKER` RPC with service-role-only grants. The atomic upsert serializes concurrent consumes for the same bucket/key; bounded `FOR UPDATE SKIP LOCKED` cleanup removes only expired counter rows.
- Store keys contain HMAC-SHA-256 digests rather than raw IPs, actor IDs, or emails. A dedicated secret is preferred, with the existing server-only Supabase service-role key as the safe fallback; secret material never enters the RPC body.
- Rotating the effective HMAC secret resets active rate-limit buckets. Old keyed buckets expire and are removed by bounded cleanup during later requests.
- Only Vercel's platform-overwritten forwarding header is trusted in production. Generic forwarding headers are ignored outside that trust boundary, and missing/invalid platform values share one fail-safe bucket.
- Production fails closed if Supabase credentials or the RPC are absent or unavailable. The
  memory implementation is restricted to development and the explicit local E2E
  harness.
- Code and tests are complete; migration approval/application, optional dedicated
  HMAC secret placement, and exact-SHA multi-instance/outage proof remain public-cutover gates. No KV/Redis provider is required.

## External API refusal boundary

- Service-layer business preconditions throw `DomainRefusalError`. The shared
  HTTP mapper returns one constant `409` body and records only a fixed,
  identifier-free refusal event in server logs.
- Assignment, availability, load, truck-slot, route-pack, driver-media, and trip-
  document paths preserve that typed boundary. Media adapters do not rewrap
  domain errors with record-specific messages.
- Unknown application errors remain sanitized `500` responses; typed domain
  failures never expose cross-tenant record identifiers or existence details.

## Billing payment-method mutation boundary

- `GET /api/billing/payment-method` remains a read-only status surface for an
  actor with `manage_billing`, even when the organization cannot start card
  setup. Read access does not imply permission to mutate provider state.
- `POST /api/billing/payment-method` requires `manage_billing`. The server
  recomputes eligibility from canonical billing state and the server-owned
  rollout configuration; client input cannot grant commercial authority.
- A current `percentage_v1` organization is eligible only after accepting the
  exact current agreement and immutable terms and receiving exact organization
  rollout authorization. Preserved provider-bound historical subscriptions,
  explicit `legacy_percentage` accounts, and accrued or otherwise unsettled fee
  or invoice obligations remain serviceable so an existing obligation is not
  orphaned.
- Duplicate profiles, accounts, subscriptions, provider mismatches, and
  cross-organization records fail closed. An ineligible request is refused
  before Stripe customer lookup or creation and before SetupIntent creation;
  the billing service enforces the same rule as the route. A preserved
  provider-bound Stripe customer is reused, and a profile/subscription customer
  mismatch is refused rather than repaired implicitly.
- Card setup is non-activating: it does not accept terms, enroll a host, enable
  collection, create a fee, charge a card, or move driver compensation.
  Percentage enrollment and fee collection remain independent, default-dark
  gates.

## Platform-admin authority boundary

- `profiles.role = admin` is historical identity data, not authorization. Every
  Clerk-backed platform-admin session must match exactly one server-configured
  Clerk user id and the independently configured SHA-256 of the versioned scope
  material. Malformed, padded, duplicate, multiple, missing, or mismatched
  values fail closed.
- The one-time claim additionally requires a verified Clerk primary email,
  same-origin bounded JSON with a fixed confirmation, client and identity rate
  limits, an exact `enabled` gate, and a strict future ISO expiry. The canonical
  mutation can bind only the fixed active, organization-less, membership-less
  seed administrator and writes one sanitized audit event.
- The temporary gate has no part in ongoing authority. It is removed after the
  claim; the exact persistent identity and scope digest remain required. Contact
  inquiry notifications are filtered by current platform-admin authority so
  removing that scope also removes access to historical inquiry PII on the next
  request.

## Membership revocation and private-response boundary

- Organization reads and mutations require an active user, a non-archived exact
  organization, and one unambiguous active membership. Driver reads and writes
  additionally require one driver profile owned by that organization; request
  paths also require the driver to be available. An unrelated membership or
  historical driver row cannot restore access.
- Suspension/removal preserve operating records but make the driver and every
  current/future availability record unavailable. Reactivation does not change
  availability. Last-owner, self-removal, self-suspension, duplicate membership,
  duplicate driver-profile, and non-grantable-role cases fail closed inside one
  atomic state mutation.
- Authenticated private JSON, signatures, Route Packs, trip activity, and media
  responses carry `Cache-Control: private, no-store`, including refusals and
  failures. A browser therefore cannot reuse private content after revocation;
  the next read must pass current authorization. Public load discovery remains a
  separately redacted public surface.

## How the RLS discrepancy arose (reconciled, proven)

Two earlier reports appeared to conflict; both were true subsets of the same reality:

- The **foundation migration** (`20260604190000_backend_foundation.sql`) predated the
  RLS design and created 19 tables with **no RLS**.
- **Phase 2** (`20260706090000_operating_network_phase2.sql`) enabled RLS on 21 tables
  but only **5 of the foundation tables** (profiles, companies, load_postings,
  truck_slots, assignments), leaving **14 foundation tables uncovered**.
- Report A ("~21 protected") = the phase-2 set. Report B ("15 disabled") = the 14
  uncovered tables + PostGIS `spatial_ref_sys`.
- **Not a regression, not stale, not an unapplied migration — an original coverage gap.**

## The real exposure that was found and closed (was CRITICAL)

`public.operating_state` — the full-state JSON blob (then a durability mirror, now
the transitional canonical store) holding
all PII — had a policy (`operating_state_rw`) granting **anon** full read/write. The
publishable anon key could have exfiltrated or overwritten the entire operating state.

Fixed in `20260707050000_security_rls_coverage.sql`: permissive policy dropped, anon
and authenticated grants revoked. The table is now RLS-enabled with **no policy**, so
PostgREST denies everyone except the service role (which bypasses RLS). The app
repository requires `SUPABASE_SERVICE_ROLE_KEY` (`packages/db/src/snapshot.ts`).
The repo-local 2026-07-10 convergence migration further makes service-role grants
explicit (`SELECT`, `INSERT`, `UPDATE` only); that additive migration still requires
live application and verification.

Empirically verified from outside with the live anon key:
- `GET /rest/v1/operating_state` → `permission denied for table operating_state`
- `POST /rest/v1/operating_state` → `permission denied`
- `GET /rest/v1/driver_profiles` (PII) → `permission denied`
- `POST /rest/v1/rpc/request_capacity` → not callable; `is_org_member` → `permission denied`

## 36-table inventory

**RLS-enabled with policies (21 application tables):** assignments, companies,
destination_facilities, direct_offers, entitlements, equipment_combinations,
future_availability, load_postings, operational_notices, opportunity_capacities,
organization_invitations, organization_memberships, private_network_relationships,
profiles, rich_landing_details, route_packs, trip_documents, trip_events, trips,
truck_slots, verification_records.

**RLS-enabled with policies (added 2026-07-08, migration `20260707050000`, 14 tables):**
driver_profiles, dispatcher_profiles, loader_profiles, truck_profiles,
trailer_profiles, landings, mills, haul_routes, rates, availability_windows,
notifications, message_threads, message_events, audit_events.

**RLS-enabled, NO policy (deny-all but service role) — intentional:** operating_state;
`rate_limit_windows` joins this category after its pending migration is applied.

**RLS exempt (1):** `spatial_ref_sys` — PostGIS system table, extension-owned, cannot
take RLS. Contains only public coordinate-reference definitions (SRIDs); no app data
or PII. This is the single accepted `rls_disabled_in_public` advisor ERROR.

## Policy design principles

- SELECT policies are member/owner-scoped via the `current_profile_id()` and
  `is_org_member()` SECURITY DEFINER helpers.
- Writes are NOT granted to anon/authenticated on these tables; they flow through the
  service role (server-side) or SECURITY DEFINER RPCs. This matches the phase-2 pattern.
- `mills` and `destination_facilities` are intentionally public-readable (shared
  destination reference data).

## Function / RPC execution restrictions

- Internal RLS helpers (`current_profile_id`, `current_clerk_user_id`, `is_org_member`,
  `org_role_can`, `load_visible_to_org`, `orgs_have_active_relationship`): EXECUTE
  revoked from PUBLIC; granted to `authenticated` (required for RLS evaluation under a
  Clerk JWT) and `service_role`. **anon cannot execute them.**
- `request_capacity` (mutating RPC): EXECUTE revoked from PUBLIC; granted to
  `service_role` only. Not callable by anon or authenticated over REST.
- `consume_rate_limit` (mutating RPC, pending migration): `SECURITY INVOKER`, empty
  `search_path`, EXECUTE revoked from PUBLIC/anon/authenticated and granted only to
  `service_role`.
- `set_updated_at` and `current_clerk_user_id`: `search_path` pinned (was mutable).

## Accepted advisor exceptions (documented, not defects)

| Advisor finding | Level | Why accepted |
|---|---|---|
| `spatial_ref_sys` RLS disabled | ERROR | PostGIS extension-owned system table; public SRID reference data only; cannot enable RLS |
| `postgis` extension in `public` schema | WARN | Moving it risks breaking geography columns; not a data-exposure vector |
| `st_estimatedextent(...)` executable by anon/authenticated | WARN | PostGIS extension functions (geometry-extent estimators); extension-owned, not revocable |
| `current_profile_id`/`is_org_member`/etc. executable by `authenticated` | WARN | REQUIRED — RLS policies cannot evaluate without it |
| `operating_state` RLS enabled, no policy | INFO | Intentional deny-all-but-service-role |

## Future note (when normalized Postgres tables become the read path)

RLS tables currently fail-closed for anon (`permission denied for function
current_profile_id`). Correct today: the Next server reads the canonical whole-state
row via service role; anon never queries PostgREST. If open-network loads are ever
served directly to anon via PostgREST, revisit those specific policies/grants.

## Repo ↔ live ledger reconciliation

The live project was bootstrapped and secured via the Supabase MCP `apply_migration`,
which timestamps ledger entries at apply time. The repo `supabase/migrations/*.sql`
files are the **idempotent source of truth** (CREATE IF NOT EXISTS / DROP POLICY IF
EXISTS / CREATE OR REPLACE / enable-RLS-is-a-no-op-if-enabled). A fresh environment
applies them in filename order; re-applying against the live project is safe. See
`docs/DEPLOYMENT.md` for the migration order.
