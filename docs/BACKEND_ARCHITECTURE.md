# LogLoads — Backend Architecture

> **Status:** Revised 2026-11-01. Code facts are from commit `4c9518e`.
>
> **Governing sources:**
> - [`DECISIONS.md`](./DECISIONS.md)
> - [`product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md`](./product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md)
> - [`product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md`](./product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md)
> - [`product/TRANSITION_PLAN.md`](./product/TRANSITION_PLAN.md)
> - `architecture/normalized-v2/ARCHITECTURE.md` — a non-active prototype, uncommitted at this revision.

## 1. Product boundary

LogLoads is a timber-hauling **load board and business-introduction marketplace**:

- Landing organizations publish hauling opportunities and discover self-reported truck capacity.
- Haulers and fleets use the core marketplace free, forever.
- Parties exchange interest and replies, then arrange the actual transportation off-platform.

New work must not introduce any of these:

- dispatch, slot reservations, or trip execution/completion;
- scale-ticket accounting or freight settlement;
- per-load charges, or a percentage of hauling compensation.

## 2. What runs today — CURRENT pilot persistence

| Layer | Current role | Constraints |
|---|---|---|
| `packages/contracts` | Zod schemas, permissions, domain contracts, `membership.ts` (plan/boost/founder rules), `marketplace-v2.ts` (V2 views/inputs) | V2 types must not inherit dispatch or pay semantics |
| `packages/db` | Canonical state types, `snapshot.ts` repository, `seed-data.ts`, migration contract tests | Production uses one versioned `public.operating_state` JSON row |
| `packages/services` | Service-layer authorization and transitions | Legacy `loads`, `assignments`, `trips`, and billing code is retained but out of V2 scope |
| `apps/web/lib/services.ts` | `readState` / `mutateState` with optimistic compare-and-swap and replay | Whole-document writes, not row storage |
| `apps/web/lib/session.ts` | Clerk identity when configured; tightly restricted loopback dev sessions otherwise | Never trust client-provided actor or membership claims |
| `apps/web/lib/network.ts` | Viewer-scoped, redacted network projection (public points rounded to 0.02°) | Private access data never enters public output |
| `apps/web/lib/rate-limit*.ts` | HMAC caller keys; memory store in non-production; Supabase shared RPC in production | Fails closed in production. `LOGLOADS_RATE_LIMIT_HMAC_SECRET` is required by the caller-key path. |
| `apps/web/lib/media*.ts` | Private Supabase Storage: signed upload, server read-back, authorized short-lived delivery | No public private-media bucket |
| `apps/web/lib/map-runtime.ts`, `carto-basemap.ts` | MapLibre with authenticated CARTO when `NEXT_PUBLIC_CARTO_BASEMAP_KEY` is set; legacy Mapbox only without a CARTO key; keyless CARTO otherwise | Maps are lazy-loaded; text results never depend on them |

### V2 preview (CURRENT, preview only)

`/v2` is a feature-flagged Next.js surface:

- **Gate.** Enabled only by `LOGLOADS_MARKETPLACE_V2=enabled`, and never when `VERCEL_ENV=production`. The
  code would allow hosted Preview deployments; policy is local development only until an isolated preview is
  approved.
- **Types.** `packages/contracts/src/marketplace-v2.ts` defines its views and inputs.
- **Inquiry transitions.** `packages/services/src/marketplace-interest.ts` manages them.
- **Persistence port.** `apps/web/lib/marketplace-v2/port.ts`. `pilot-adapter.ts` maps pilot postings into
  V2-safe job views and stores inquiries in the additive `marketplaceInterests` collection, through canonical
  state.

This is a working preview, **not** native V2 publishing and not relational persistence.

The inquiry path runs advertisement → interest → response. It **never** dispatches and never creates fees.

As of `4c9518e`:

- **Explicit capabilities.** V2 authorizes with capabilities from
  `packages/contracts/src/marketplace-permissions.ts`. `packages/services/src/marketplace-access.ts` maps pilot
  roles into those capabilities and is meant to be deleted at cutover. The legacy `request_assignment` and
  `publish_load` checks no longer apply.
- **Equipment-backed interest.** Haulers can attach per-configuration counts from their own equipment profile,
  labelled self-reported.
- **Native job authoring is validation plus preview only.** The draft schema
  (`packages/contracts/src/marketplace-job-draft.ts`) mirrors the `job_postings` columns and CHECKs. The port
  exposes `publishJob` and `reconfirmJob`, but the pilot adapter reports `supportsPublishing: false`. No job is
  persisted, and no new JSON job model exists.
- **Honest listing semantics.** `lastModifiedAt`, `lastConfirmedAt`, and `expiresAt` are separate fields. No
  pilot job is ever labelled confirmed.

## 3. Approved normalized V2 target — TARGET, not deployed

Gemini's prototype is under `architecture/normalized-v2/`. At this revision it exists only as **uncommitted
files** in the primary checkout.

| File | Content |
|---|---|
| `01_schema.sql` | A `marketplace` relational schema of **32 tables** (count confirmed from the file) |
| `02_access.sql` | RLS, trusted identity resolution, grants, triggers |
| `03_entitlements.sql` | Versioned plans, invitation accounting, promotions, boosts |
| `04_tests.sql` | Integration and RLS tests |
| `05_concurrency_test.{sh,ps1}` | Multi-session race tests |
| `ARCHITECTURE.md` | Prototype reference |

The prototype's own status line says it is statically checked only. **It has not been executed against
PostgreSQL.** Static checks prove neither DDL validity, nor concurrency behavior, nor Clerk-to-Supabase token
verification. Do not move it into `supabase/migrations/` until all of these are done:

- CI execution ([`RUNNERS.md`](./RUNNERS.md) §3);
- the security proofs in [`SECURITY.md`](./SECURITY.md) §5;
- a reviewed `MarketplaceV2Port` normalized adapter.

## 4. Target storage and authorization boundaries

- **Identity and roles.** One identity can hold memberships in several organizations. Organization roles and
  platform-admin roles are separate.
- **Seats.** Free hauler/fleet roles never consume paid landing seats, even in a company that does both
  kinds of business.
- **Landing data.** The public approximate area is separate from restricted exact coordinates, gate codes,
  road directions, and private contacts. Disclosure is deliberate and audited; an inquiry alone never
  reveals them.
- **Tenant scoping.** Landings, jobs, inquiries, invitations, boosts, and entitlements are tenant-scoped,
  with RLS as defense in depth. Service-role paths bypass RLS and keep explicit service-layer authorization.
- **Token verification.** Clerk token signatures are verified at the Supabase API boundary. SQL claim
  inspection is not cryptographic verification.
- **Historical data.** Historical commercial and dispatch data stays available for retention, audit, and
  reconciliation. It is never transformed into V2 revenue or transaction records.

## 5. Commercial rules (fixed by Blueprint v1.0; not active)

**Landing plans — Basic / Pro / Regional:**

| | Basic | Pro | Regional |
|---|---:|---:|---:|
| Monthly price | $149 | $299 | $499 |
| Active landings | 1 | 3 | Unlimited |
| Seats (owner included) | 2 | 5 | 10 |
| Targeted invitations per cycle | 3 | 10 | 30 |

- Invitations do not roll over.
- Postings and inbound inquiries are unlimited on every plan.
- Haulers and fleets are free forever.

**Boosts (one job):** $99 for 7 days, $149 for 14 days, $199 for 28 days; approximately 100 miles.

**Founding offer:** 50% off for 6 paid cycles, for the first 10 qualifying landing organizations per launched
state.

The code source for these numbers is `packages/contracts/src/membership.ts`. **There is no checkout and no
charge** until the gates in [`ACTIVATION_STRIPE.md`](./ACTIVATION_STRIPE.md) pass.

## 6. Integration sequence and release criteria

1. Finish V2 semantics. Truthful freshness fields, equipment-backed interest, explicit capabilities, and a
   job-authoring preview landed in `4c9518e`. Still to do: persisted publishing and reconfirmation, and the
   audited private-detail disclosure.
2. Execute the normalized SQL in CI on a disposable database. Resolve the RLS, seat, downgrade, JWT, and
   invitation-race risks.
3. Implement a reviewed normalized `MarketplaceV2Port` adapter. Prove public jobs → inquiry → reply without
   private-data leakage.
4. Rehearse a synthetic migration from `operating_state`, preserving ID lineage and quarantining invalid
   records. Never mutate production as a rehearsal.
5. Enforce plan and invitation rules on the server. Use test-mode Stripe only after terms and legal review.
   Keep the pilot and its rollback path until evidence authorizes retirement
   ([`DEPLOYMENT.md`](./DEPLOYMENT.md) §5).
