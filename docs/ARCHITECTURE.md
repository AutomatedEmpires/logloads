# LogLoads — Architecture and Data Model

> **Status:** Last verified 2026-11-02. Code facts are from `work/logloads-repair` at `4c9518e`; the database
> baseline comes from `test/normalized-v2-postgres17-ci` at `ec4bb66`. The status labels are defined in
> [`README.md`](./README.md) §2.
>
> This document replaces `BACKEND_ARCHITECTURE.md`, `DATA_MODEL.md` and `MVP_BACKEND_SCOPE.md`. Their earlier
> text is at tag `archive/docs-history-20261102`.

## 1. Product boundary (APPROVED)

The product is a load board: landings post jobs; haulers discover them, express interest, and get replies. The
parties arrange transportation off-platform.

New work must never add dispatch, slots, trips, completion, scale tickets, settlement, per-load fees or
percentage fees (Blueprint §1.3, §12.5).

## 2. Running system (IMPLEMENTED)

| Layer | Role | Constraint |
|---|---|---|
| `packages/contracts` | Zod contracts: `membership.ts` (plans, boosts, founder offer), `marketplace-v2.ts`, `marketplace-job-draft.ts`, `marketplace-permissions.ts` | One source per rule |
| `packages/db` | `snapshot.ts` repository and read-time row schemas; `types.ts`; `seed-data.ts` | Production uses one versioned JSON row |
| `packages/services` | Authorization and state transitions | Legacy dispatch and billing services are kept only for records |
| `apps/web/lib/services.ts` | `readState` / `mutateState`: compare-and-swap on `version`, with replay | Whole-document writes |
| `apps/web/lib/session.ts` | Clerk identity, or a loopback-only dev session | Never trusts client-supplied identity |
| `apps/web/lib/network.ts` | Redacted public projection; public points rounded to 0.02° | No private access data in public output |
| `apps/web/lib/rate-limit*.ts` | HMAC keys plus a Supabase shared RPC | Fails closed in production |
| `apps/web/lib/media*.ts` | Private Supabase Storage | Server-side read-back before commit |
| `apps/web/lib/map-runtime.ts`, `carto-basemap.ts` | MapLibre with keyed CARTO; legacy Mapbox only when no CARTO key is set | Lazy-loaded; text never depends on the map |

**Canonical store:** `public.operating_state(id='primary', state, schema_version, version)`.

- The collections are described by `packages/db/src/types.ts` and `snapshot.ts`.
- `public.rate_limit_windows` holds rate-limit counters.
- The `marketplaceInterests` collection was added for V2.
- The same document still holds historical billing, trip and audit records. Backup and restore:
  [`RECOVERY.md`](./RECOVERY.md).
- The server reads and writes it with the service-role key. **RLS does not protect these paths.**

## 3. V2 load board (IMPLEMENTED, preview)

`/v2` is enabled only by `LOGLOADS_MARKETPLACE_V2=enabled`, and never when `VERCEL_ENV=production`
(`apps/web/lib/marketplace-v2/flag.ts`). Hosted Preview is technically allowed; policy forbids it until an
isolated preview is approved ([`DEPLOYMENT.md`](./DEPLOYMENT.md) §4).

| Concern | Where |
|---|---|
| Port | `apps/web/lib/marketplace-v2/port.ts`. Methods are listed in [`API_CONTRACTS.md`](./API_CONTRACTS.md) §1. |
| Adapter | `pilot-adapter.ts`, over `operating_state`. `supportsPublishing: false`. |
| Interest rules | `packages/services/src/marketplace-interest.ts`: one live interest per job and hauler business; equipment counts from the hauler's own profile; replay-safe replies; audit events |
| Capabilities | `marketplace-permissions.ts`, which restates the normalized role sets. `marketplace-access.ts` maps pilot roles onto them and is to be deleted at cutover. |
| Listing semantics | `lastModifiedAt`, `lastConfirmedAt` and `expiresAt` are separate; no pilot job is ever labelled confirmed. The volume fields are distinct and nullable, shown as "Not stated". |

**Not built:**

- persisted publish or reconfirm;
- an audited private-detail disclosure action;
- V2 hauler onboarding and availability screens;
- any V2 analytics.

Priorities and order: [`product/TRANSITION_PLAN.md`](./product/TRANSITION_PLAN.md).

## 4. Normalized V2 database

`architecture/normalized-v2/` holds Gemini's prototype. Its validated copy lives on branch
`test/normalized-v2-postgres17-ci`, including Claude Agent 1's SQL and test fixes; reference:
[ARCHITECTURE.md @ ec4bb66](https://github.com/AutomatedEmpires/logloads/blob/ec4bb6623cbdfd7b78b51f9bc5fec50144cdc328/architecture/normalized-v2/ARCHITECTURE.md).
That branch is not merged into `work/logloads-repair`.

| Claim | Status |
|---|---|
| `01`–`03` DDL applies cleanly; the `04` integration/RLS suite and `05` multi-session concurrency races pass on fresh PostgreSQL 17 + PostGIS | **VERIFIED** — [`CI.md`](./CI.md) §3 |
| Gemini's `06_v2_contract_alignment.sql` and `07_v2_contract_tests.sql` | **UNVERIFIED** — branch `test/normalized-v2-contract-alignment` |
| Real Clerk tokens verified by Supabase third-party auth | **UNVERIFIED** — the SQL tests use simulated claims ([`SECURITY.md`](./SECURITY.md) §4) |
| Connected to the application | **No.** No normalized adapter implements the port. |
| Applied to any hosted Supabase project | **No, and not authorized** |

### Proposed tables (32, from `01_schema.sql`)

| Domain | Tables |
|---|---|
| Identity / admin | `trusted_identity_issuers`, `app_users`, `identity_links`, `user_contacts`, `platform_admins` |
| Organizations | `organizations`, `organization_memberships`, `notification_preferences` |
| Haulers | `hauler_profiles`, `user_qualifications`, `equipment_types`, `equipment_units`, `availability_reports` |
| Landings / jobs | `landings`, `landing_private_details`, `job_postings`, `job_posting_equipment`, `job_templates`, `saved_searches` |
| Inquiry | `expressions_of_interest`, `interest_messages` |
| Billing policy | `subscription_plans`, `promotions`, `promotion_redemptions`, `organization_subscriptions`, `entitlement_periods` |
| Invitations | `targeted_invitations`, `invitation_deliveries` |
| Boosts | `boost_products`, `job_boosts` |
| Trust | `abuse_reports`, `audit_events` |

The known gaps between the schema and the V2 contract (trucks per day, interest equipment lines, point snapping)
are listed in [`product/TRANSITION_PLAN.md`](./product/TRANSITION_PLAN.md) "Items for the prototype owner".

## 5. Invariants (APPROVED; enforced on the server)

- **Tenancy and roles**
  - One login may belong to several organizations.
  - Organization roles never grant platform-admin powers.
  - Free hauler and fleet roles never consume paid landing seats.
- **Job content**
  - Jobs are advertisements.
  - Pay is a poster statement with a unit, or labelled negotiable.
  - Availability is self-reported and timestamped.
- **Private details**
  - Public views show an approximate area only.
  - Expressing interest discloses nothing; disclosure is an explicit, audited landing action.
- **Invitations**
  - Opt-in recipients only.
  - Deduplicated, with atomic allowance accounting.
  - No rollover; a failed delivery is refunded once.
  - Inbound interest and replies are never metered.
- **Plan numbers** come from `membership.ts` and nowhere else.

## 6. Migration mapping (TARGET)

| Pilot data | Target | Rule |
|---|---|---|
| Profiles, organizations, memberships | `app_users`, `identity_links`, organizations, memberships | Keep IDs. Never link identities by email alone. |
| Drivers, trucks, trailers | Hauler profiles, equipment units | Do not imply verified capacity |
| Landings, rich details | `landings` and `landing_private_details` | Redact precise locations |
| Load postings | `job_postings` | Map cautiously; slots and load events are not opportunities |
| `marketplaceInterests` | `expressions_of_interest` and `interest_messages` | Direct |
| Fee, subscription, invoice and trip records | **Read-only legacy store** | Never erase or reclassify them ([`SUBSCRIPTION_BILLING_V1.md`](./SUBSCRIPTION_BILLING_V1.md)) |

Cutover gates: [`DEPLOYMENT.md`](./DEPLOYMENT.md) §5. Recovery: [`RECOVERY.md`](./RECOVERY.md) §9.
