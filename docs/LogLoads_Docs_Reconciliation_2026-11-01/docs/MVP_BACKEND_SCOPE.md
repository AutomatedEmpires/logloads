# LogLoads — Current V2 Backend MVP Scope

> **Status:** Revised 2026-11-01 for the approved timber-hauling marketplace. This supersedes the prior MVP scope centered on loads, dispatch assignments, trip and percentage-fee billing. See `docs/product/TRANSITION_PLAN.md` for sequencing.

## MVP user outcome

A real landing company can create/publish an honest hauling opportunity; an unauthenticated visitor and a free hauler can discover it; an authorized hauling business can express interest; an authorized landing representative can reply. Parties arrange any eventual hauling independently.

## Already implemented as development-only preview

- `/v2` text-first discovery, job detail and nonbinding interest/reply flow behind `LOGLOADS_MARKETPLACE_V2=enabled`.
- Typed V2 presentation/interest contracts in `packages/contracts/src/marketplace-v2.ts`.
- Service-layer inquiry validation, tenant membership checks, replay-safe replies and audit events, backed by current `marketplaceInterests` pilot collection.
- `MarketplaceV2Port` and pilot read adapter; no live V2 production launch or normalized persistent integration is implied.

## MVP still required before customer release

1. Native V2 landing registration and job draft/publish/reconfirm, with equipment, pay unit, duration, truck requirement and explicit freshness.
2. Free hauler/fleet onboarding, equipment inventory, self-reported time/region availability, and short equipment-backed inquiry.
3. Proven cross-tenant roles, explicit inquiry permissions, deliberate private-site disclosure and revocation.
4. Normalized Postgres/PostGIS DDL executed, RLS/Clerk verified, multi-session invitation and entitlement tests green; adapter integration and migration rehearsal on **synthetic** data.
5. Responsive low-data job list and fallback when maps/weather fail; accurate CARTO/OpenStreetMap attribution and redacted approximate points.
6. Organization verification/moderation/reporting, basic support and auditable status changes.
7. Later paid launch only after verified Basic/Pro/Regional entitlements, test-mode Stripe, terms, advertising-law assessment, billing recovery, qualified audience/boost safeguards and explicit authorization.

## Not part of V2 product

Dispatch, trip/assignment lifecycle, hauling payment status, escrow, percentage of the haul, scale tickets, GPS tracking, route optimization, driver payroll, settlement and freight brokerage. Legacy code/financial records may be retained in a disabled historical compatibility path but are not V2 acceptance criteria.

## Gates

A local/preview demo is not a production launch. Required evidence: reproducible tests, negative RLS/tenant tests, no sensitive site leakage, accessible mobile experience, provider-safe logs, full business-rule consistency and documented rollback. Never run `pnpm db:check` against any non-disposable database; it performs a local reset. No production migration or paid activation without separate human approval.
