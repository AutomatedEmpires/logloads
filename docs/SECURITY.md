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
