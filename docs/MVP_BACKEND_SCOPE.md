# LogLoads — V2 Backend MVP Scope

> **Status:** Revised 2026-11-01 for the approved load-board marketplace. This replaces the earlier MVP scope,
> which centered on loads, dispatch assignments, trips, and percentage-fee billing. That version is
> retrievable with `git show 15892b7:docs/MVP_BACKEND_SCOPE.md`.
>
> Sequencing: [`product/TRANSITION_PLAN.md`](./product/TRANSITION_PLAN.md).

## MVP user outcome

- A real landing company creates and publishes an honest hauling opportunity.
- An anonymous visitor or a free hauler discovers it.
- An authorized hauling business expresses interest.
- An authorized landing representative replies.
- The parties arrange any hauling themselves.

## Implemented as a development preview (CURRENT at `4c9518e`)

- `/v2` text-first discovery, job detail, and the nonbinding interest/reply flow, behind
  `LOGLOADS_MARKETPLACE_V2=enabled` (never when `VERCEL_ENV=production`).
- Typed V2 contracts:
  - `marketplace-v2.ts` — honest freshness fields and distinct volume fields;
  - `marketplace-job-draft.ts` — the authoring draft;
  - `marketplace-permissions.ts` — explicit capabilities.
- Service-layer inquiry rules:
  - capability checks via `marketplace-access.ts`;
  - one live interest per job and hauler business;
  - optional equipment-backed counts from the hauler's own profile;
  - replay-safe replies, audit events, and per-user rate limits.

  Backed by the pilot `marketplaceInterests` collection.
- `MarketplaceV2Port` and the pilot adapter.
- A job-authoring preview at `/v2/landing/jobs`: validation and preview only (`supportsPublishing: false`).

Nothing here amounts to a production V2 launch or normalized persistence.

## Still required before any real customer use

1. **Persisted** native publish and reconfirm. Drafting and validation exist; persistence waits for a
   normalized adapter. The pilot adapter deliberately writes no legacy load or slot records.
2. Free hauler/fleet onboarding, equipment inventory management in V2, and self-reported time/region
   availability. Equipment-backed interest already reads the existing profile.
3. Cross-tenant capability parity proven against the normalized RLS role sets. Deliberate, audited
   private-site disclosure and revocation.
4. Normalized PostgreSQL/PostGIS:
   - DDL executed in CI;
   - RLS and Clerk verified;
   - multi-session invitation and entitlement tests green;
   - adapter integration and a migration rehearsal on **synthetic** data.

   See [`RUNNERS.md`](./RUNNERS.md) and [`SECURITY.md`](./SECURITY.md) §5.
5. A responsive, low-data job list with fallbacks when maps or weather fail. CARTO/OpenStreetMap attribution.
   Approximate points only.
6. Organization verification, moderation and reporting, basic support, and auditable status changes.
7. V2 analytics events with privacy rules ([`OBSERVABILITY.md`](./OBSERVABILITY.md)).
8. A paid launch, later, only after all of: verified Basic/Pro/Regional entitlements, test-mode Stripe,
   published terms, legal review, billing recovery, audience/boost safeguards, and explicit authorization
   ([`ACTIVATION_STRIPE.md`](./ACTIVATION_STRIPE.md)).

## Not part of the V2 product

- dispatch, and the trip/assignment lifecycle;
- hauling payment status, escrow, or a percentage of the haul;
- scale tickets, GPS tracking, route optimization;
- driver payroll, settlement, freight brokerage.

Legacy code and financial records stay on a disabled historical compatibility path. They are not V2
acceptance criteria.

## Gates

A local or preview demo is not a launch. The evidence required:

- reproducible tests;
- negative RLS and tenant tests;
- no sensitive site leakage;
- an accessible mobile experience;
- provider-safe logs;
- consistent business rules;
- a documented rollback.

`pnpm db:check` resets the local Supabase database: run it only against a disposable stack. No production
migration and no paid activation happen without separate human approval.
