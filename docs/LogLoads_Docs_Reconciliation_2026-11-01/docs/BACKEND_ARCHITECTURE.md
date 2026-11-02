# LogLoads — Backend Architecture

> **Status:** Current implementation vs approved target, 2026-11-01. Governing sources: `docs/DECISIONS.md`, `docs/product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md`, `docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md`, and `architecture/normalized-v2/ARCHITECTURE.md` (non-active prototype).

## Product boundary

LogLoads is a timber-hauling **job/load-board and business-introduction marketplace**. Landing organizations publish hauling opportunities and discover self-reported truck capacity; haulers and fleets use core marketplace capabilities free forever. Users exchange inquiries and replies; the businesses arrange actual transportation off-platform. New work must not introduce dispatch, truck-slot reservations, trip execution/completion, scale-ticket accounting, freight settlement, a charge per load, or a percentage of hauling compensation.

## What runs today — pilot persistence

| Layer | Current role | Constraints |
|---|---|---|
| `packages/contracts` | Zod schemas, permissions, domain contracts, `membership.ts`, `marketplace-v2.ts` | New V2 types cannot silently inherit legacy dispatch/pay semantics |
| `packages/db` | Canonical state type, migrations, seed fixtures, Supabase repository | Production currently uses one versioned `public.operating_state` JSON row |
| `packages/services` | Service-layer authorization and state transitions | Legacy `loads`, `assignments`, `trips`, billing code is retained but not V2 product scope |
| `apps/web/lib/services.ts` | `readState`/`mutateState` with optimistic CAS and retry | Current whole-document write path; not normalized row storage |
| `apps/web/lib/session.ts` | Clerk-backed identity when configured, tightly restricted local dev sessions otherwise | Never trust client-provided actor IDs or membership claims |
| `apps/web/lib/network.ts` | Viewer-scoped/redacted legacy network projection | Private access data must not leak into V2 public output |
| `apps/web/lib/rate-limit-*` | HMAC caller keys, local memory/test path, production Supabase shared RPC | Production fails closed; `LOGLOADS_RATE_LIMIT_HMAC_SECRET` required by caller-key path |
| `apps/web/lib/media.ts` | Private Supabase Storage upload and authorized read | No public private-media bucket; preserve authorization before signing |

**Current V2 preview:** `/v2` is a development-only, feature-flagged Next.js UI. `packages/contracts/src/marketplace-v2.ts` defines its view/input types; `packages/services/src/marketplace-interest.ts` manages inquiry transitions; `apps/web/lib/marketplace-v2/port.ts` is the persistence interface; `pilot-adapter.ts` converts existing pilot postings into V2-safe job views and stores inquiries in `marketplaceInterests` through canonical state. This is a working preview, **not yet native V2 publishing or relational persistence**.

The inquiry path is advertisement → interest → response, **never** dispatch or fee creation. Legacy `request_assignment`/`publish_load` authorization checks in the V2 service are a temporary bridge; replace them with explicit marketplace permissions when those contracts are approved.

## Approved normalized V2 target — not yet deployed

Gemini's prototype is isolated under `architecture/normalized-v2/`:

- `01_schema.sql` — proposed `marketplace` relational domain (32 tables as reported).
- `02_access.sql` — RLS, trusted identity resolution, function grants, triggers.
- `03_entitlements.sql` — versioned plans, invitation accounting, promotions and boosts.
- `04_tests.sql` — proposed executable PostgreSQL tests.
- `ARCHITECTURE.md` — prototype reference.

The SQL has **not been proven executable or secure** from the supplied agent reports. Static checks do not validate PostgreSQL DDL, concurrency behavior, or Clerk-to-Supabase token verification. Do not incorporate into operational migrations until disposable PostgreSQL/PostGIS, RLS and concurrent-session tests succeed and the app port has a reviewed normalized adapter.

## Target storage and authorization boundaries

- Single identity can hold memberships in multiple organizations; organization roles and platform-admin roles are distinct.
- Free hauler/fleet equipment, availability and inquiries must not consume paid landing-seat entitlement merely because a company does both kinds of business. Paid landing access requires explicit scoped entitlement.
- Public approximate landing geography is distinct from restricted exact access coordinates, gate codes, road directions and private contacts.
- Sensitive site information requires deliberate, audited disclosure; an inquiry alone never reveals it.
- Landings, jobs, inquiries, invitations, boosts and financial entitlements require tenant-scoped foreign keys/RLS; app service authorization is defense in depth, not a substitute for RLS.
- Clerk token signature verification belongs to the trusted Supabase integration/API boundary. SQL claim inspection is not cryptographic verification.
- Historical commercial/dispatch data remains available for retention, audit and reconciliation; it is not silently transformed into V2 income or transaction records.

## Product/commercial fixed rules

Landing Basic/Pro/Regional: **$149/$299/$499 monthly**, **1/3/unlimited active landings**, **2/5/10 landing staff seats**, **3/10/30 targeted invitations per billing cycle**, no rollover. Unlimited legitimate job posts and inbound inquiries on all paid plans. Haulers and fleets free forever. One-job boosts: **$99/7 days**, **$149/14 days**, **$199/28 days**, approximately 100-mile coverage. Founding landing discount: 50% for the first six paid cycles, first ten qualified paying landing organizations per launched state. No live checkout/charges until explicit release gates.

## Integration sequence and release criteria

1. Finish V2 semantics: truthful last-confirmed timestamp, native job authoring, equipment-backed interest, explicit marketplace permissions.
2. Run normalized SQL in a verified disposable database; resolve RLS, seat, downgrade, JWT and invitation race risks.
3. Implement a reviewed `MarketplaceV2Port` adapter, prove public jobs → inquiry → reply without private-data leakage.
4. Build a synthetic migration mapping from `operating_state`; preserve UUID lineage and quarantines. Never mutate production as a rehearsal.
5. Enforce plan and invitation rules server-side, then test-mode Stripe only after terms and transport-law review. Preserve the pilot and rollback path until evidence authorizes retirement.
