# LogLoads — API and Marketplace Interaction Contracts

> **Status:** Existing pilot HTTP endpoints and development-only V2 server actions are separate. This document lists representative current routes from the supplied repository inventory; verify route handlers and implementation before treating any entry as a public external API guarantee. The authoritative V2 type boundary is `packages/contracts/src/marketplace-v2.ts`.

## 1. V2 application experience — CURRENT development-only

`LOGLOADS_MARKETPLACE_V2=enabled` exposes `/v2` pages in a local non-production environment; `VERCEL_ENV=production` prevents exposure. Observed routes include `/v2/work`, job details, `/v2/inquiries`, and `/v2/landing/inquiries`. The user interactions are currently wired using **Next.js server actions**, not a separately standardized `/api/v2/*` REST API.

| User operation | App boundary / owner | Current backing |
|---|---|---|
| List/search job ads | `MarketplaceV2Port.listJobs`, read adapter | Existing public-redacted pilot network view |
| Read job | `getJob` | Public-safe adapter and read model |
| Express interest | `expressInterest` | Service-layer organization authority; `marketplaceInterests` in pilot canonical state |
| Read own inquiry | `interestForJob`, `listHaulerInterests` | Organization-scoped service reads |
| Withdraw/hauler follow-up | `withdrawInterest`, `postHaulerReply` | Service-layer mutation and CAS commit |
| Landing inquiry queue/response | `listLandingInterests`, `respondToInterest` | Organization-scoped service reads/mutations |

New V2 code must not import private gate coordinates or access instructions into the public job response, pass client-provided actor identity to services, generate assignment/trip/fee records, or claim that a communication represents a haul contract. Rate-limit and guard server actions; ensure idempotency when users double-submit or retry after network loss.

### V2 contract semantics

- An opportunity is an advertisement: `active`, `paused`, `filled`, `closed`, `expired` are view statuses, not hauling progress. A closed/expired job cannot receive new interest.
- Job summary includes poster, general location, equipment, pay amount and basis if provided, start/duration, trucks requested, estimated haul details where known, and truthful *last confirmed* metadata. Do not map `updatedAt` to `lastConfirmedAt` without explicit confirmation.
- Inquiry includes hauler organization, offered truck count, availability date, contact preference and optional message; one business/job pair is idempotent, can be withdrawn and may be updated while allowed.
- Landing and hauler participants may view only their own inquiry threads; safe denial should not reveal other tenants' record existence.
- Record `interest_messages`/reply IDs for retries and audits. Receiving/replying to inbound interest does not use monthly outbound targeted-invitation quota.
- The V2 normalized adapter is **not implemented just because** SQL `marketplace.search_job_postings` or `respond_to_interest` exists in the prototype. Those SQL functions have not been executed against a verified database.

## 2. Existing HTTP routes — LEGACY/PILOT, not new V2 goals

| Route family | Example paths | Status and policy |
|---|---|---|
| Health/session | `GET /api/health`, `GET /api/auth/session` | Existing status; never return sensitive session secrets or provider details |
| Public load/network | `GET /api/loads`, `/api/loads/:loadId`, `/api/network` | Pilot-oriented output; public data must be redacted |
| Legacy publication | `POST /api/loads` | Old `publish_load` capability, not native V2 job authoring |
| Equipment/availability | `/api/availability`, `/api/future-availability` | Legacy service paths; adapt thoughtfully for free hauler profiles |
| Slots/direct offers/assignments/trips | `/api/truck-slots`, `/api/direct-offers`, `/api/assignments/*`, `/api/trips/*`, `/api/route-packs/*` | **RETIRED DIRECTION**; keep historical/guarded behavior for compatibility only, do not extend into V2 |
| Media | `/api/media/signature`, `/api/media/asset` | Current private Supabase Storage; require object/organization authorization |
| Weather | `/api/weather` | Existing conditional weather integration; time-stamp sourced data and degrade gracefully |
| Notifications/support | `/api/notices`, `/api/support-requests` | Current routes if still present; verify caller authorization |
| Billing | `/api/billing/*`, including payment-method, subscription, webhook and cron | Historically oriented; do not authorize new fee/subscription charges without newly approved V2 commercial implementation |
| Admin | `/api/admin/*` | Admin roles are separate from business roles, with audit and scope checks |

The table is **not an exhaustive OpenAPI specification**. Historical API paths may remain necessary to read or reconcile old records; absence from V2 navigation does not grant permission to delete history.

## 3. HTTP and security invariants

- Authenticate via the current trusted session path (Clerk or safe local dev sessions). Resolve the actor and permitted organization on the server, not from submitted IDs.
- Validate inputs in shared Zod contracts and service-level rules; RLS must independently restrict normalized storage once live.
- Use appropriate `401` (anonymous), `403` (permission), `404` (safe non-existence), `409` (conflict), `422` (validation), `429` (rate-limited) and `503` (required dependency unavailable); inspect actual route behavior before guaranteeing any exact status.
- For current JSON store, mutation success follows confirmed CAS commit, not local mutation alone. For relational V2, writes must be atomic, tenant-scoped and retry/idempotency safe.
- Private sites, raw tokens, media access details, sensitive message bodies and Stripe provider identifiers are never public job payloads.
- No live money or fee path, no dispatch/trip/assignment creation by V2 endpoints.

## 4. Next API contract work

Document a normalized adapter method map and only expose new HTTP endpoints when a real browser/mobile/customer integration requires them. Add request/response examples, pagination, filtering, rate limits and idempotency identifiers based on implemented code—not fabricated endpoints. Test RLS/Clerk authorization with real tokens and multi-tenant negative scenarios before releasing V2 routes publicly.
