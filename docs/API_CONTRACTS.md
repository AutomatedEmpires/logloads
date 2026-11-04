# LogLoads — API and Marketplace Interaction Contracts

> **Status:** Revised 2026-11-01. The route inventory and port methods are read from code at `4c9518e`.
> - The V2 preview uses **Next.js server actions**. It has no public REST API.
> - The `/api/*` routes belong to the legacy pilot.
>
> The authoritative V2 type boundary is `packages/contracts/src/marketplace-v2.ts`. This document is not an
> OpenAPI specification. Verify a handler before promising its behavior to an external consumer.

## 1. V2 marketplace — IMPLEMENTED development preview

`LOGLOADS_MARKETPLACE_V2=enabled` exposes `/v2`. `VERCEL_ENV=production` always disables it
(`apps/web/lib/marketplace-v2/flag.ts`). The pages are `/v2/work`, `/v2/work/[jobId]`, `/v2/inquiries`,
`/v2/landing/inquiries`, and the job-authoring pages `/v2/landing/jobs`, `/v2/landing/jobs/new`, and
`/v2/landing/jobs/preview`.

Pages call `MarketplaceV2Port` (`apps/web/lib/marketplace-v2/port.ts`). Two adapters implement it:

- `pilot-adapter.ts`, over the `operating_state` store. It is the default and sets `supportsPublishing: false`.
- `normalized-adapter.ts`, over the normalized-v2 `marketplace` schema's functions. It sets
  `supportsPublishing: true`. It is used only when `LOGLOADS_MARKETPLACE_V2_ADAPTER=normalized` is set outside
  production (`adapter.ts`). The identity path is in [`SECURITY.md`](./SECURITY.md) §4.1.

Every caller imports `pilotMarketplaceV2`, which routes to the selected adapter.

| Port method | Server action (`actions.ts`) | Pilot adapter (default) | Normalized adapter (`marketplace.*`) |
|---|---|---|---|
| `listJobs(filters)` | — (page read) | Redacted public network projection → `mapping.ts` | `list_marketplace_jobs`, as `anon` |
| `getJob(jobId)` | — (page read) | Same, single job | `get_marketplace_job`, as `anon` |
| `viewerAccess(viewer)` | — | V2 capabilities for the active workspace (`marketplace-access.ts`) | `get_viewer_marketplace_access` |
| `haulerEquipment(viewer)` | — | The viewer's own equipment configurations, self-reported | `list_hauler_equipment_options` |
| `authoringLandings(viewer)` | — | The viewer organization's landings, public labels only; requires `job.publish` | `list_authoring_landings` |
| `interestForJob(viewer, jobId)` | — | Organization-scoped read | `list_marketplace_interests` (hauler side, one job) |
| `listHaulerInterests(viewer)` | — | Organization-scoped read | `list_marketplace_interests` (hauler side) |
| `listLandingInterests(viewer)` | — | Organization-scoped read for the owning landing | `list_marketplace_interests` (landing side) |
| `expressInterest(viewer, input)` | `expressInterestAction` — limit 20/hour | `marketplace-interest.ts` → `marketplaceInterests` collection, CAS commit | `submit_expression_of_interest` |
| `withdrawInterest(viewer, id)` | `withdrawInterestAction` | Service mutation, CAS commit | `withdraw_interest`, own business only |
| `postHaulerReply(viewer, input)` | `haulerReplyAction` — 60/hour | Service mutation, CAS commit | `post_hauler_interest_reply`, own business only |
| `respondToInterest(viewer, input)` | `respondToInterestAction` — 120/hour | Service mutation, CAS commit | `respond_to_interest`, own landing only; never shares private details |
| `publishJob(viewer, draft, attestation)` | `publishJobAction` — `job.publish`; 20/hour | **Not persisted:** throws `MarketplaceOperationUnavailableError` | `publish_job_posting` with `p_attest_available => true`, at an own active landing |
| `reconfirmJob(viewer, jobId, attestation)` | `reconfirmJobAction` — `job.publish`; 120/hour | **Not persisted:** same | `reconfirm_job_posting`, own job only |

The viewer is always derived on the server — from `getSessionActor()` in actions and `resolveV2Viewer()` in
pages — together with its active organization. Form input never supplies the viewer.

### V2 contract semantics

- **Statuses describe advertisements, not hauling progress.** A job is `active`, `paused`, `filled`,
  `closed`, or `expired`. A closed or expired job accepts no new interest.
- **Job views** show:
  - the poster;
  - an approximate area only;
  - equipment codes;
  - pay amount and unit, or negotiable with a note;
  - start date and duration;
  - separate nullable values for trucks for the job, trucks per day, loads per truck per day, whole-job loads
    per day, and tons per load, each shown as "Not stated" when unknown;
  - `lastModifiedAt`, `lastConfirmedAt`, and `expiresAt` as separate fields. `lastConfirmedAt` stays `null`
    unless the poster explicitly confirmed. An edit is never a confirmation.
- **Interest** carries the offered truck count, optional per-configuration counts from the hauler's own
  equipment (capped at the units listed and labelled self-reported), an availability window, and an optional
  note. It is limited to one live interest per job and hauler business, and can be withdrawn. It is never a
  contract, assignment, or invitation debit.
- **Visibility.** Participants see only their own threads. Denials do not reveal whether another tenant's
  record exists.
- **Persistence.** The prototype SQL functions (`marketplace.search_job_postings`, `respond_to_interest`)
  are **not** wired to the app. A normalized adapter does not exist yet.

New V2 code must never:

- put private coordinates, access notes, or contacts into a public response;
- accept client-supplied identity;
- create assignment, trip, or fee records;
- describe a message as a hauling contract.

## 2. Legacy pilot HTTP routes — not V2 goals

| Family | Paths (`apps/web/app/api`) | Policy |
|---|---|---|
| Health / session | `GET /api/health`, `/api/auth/session` | Coarse status only. Health exposes the commit SHA for exact-SHA proof. |
| Public network | `/api/loads`, `/api/loads/[loadId]`, `/api/network` | Pilot projection. Public output is redacted. |
| Availability | `/api/availability`, `/api/future-availability` | Legacy. Adapt deliberately for hauler profiles. |
| Dispatch | `/api/truck-slots`, `/api/direct-offers`, `/api/assignments/request`, `/api/assignments/[id]/{approve,decline,cancel}`, `/api/trips/[tripId]/{events,documents}`, `/api/route-packs/[assignmentId]`, `/api/trip-documents/{signature,asset}` | **Retired direction.** Kept for compatibility and records. Do not extend. |
| Media / credentials | `/api/media/{signature,asset,featured-truck}`, `/api/credentials/signature` | Private Supabase Storage with organization authorization |
| Weather | `/api/weather` | Conditional provider. Time-stamped, degrades gracefully. |
| Notices / support | `/api/notices`, `/api/support-requests`, `/api/admin/support-requests/[requestId]` | Caller authorization required |
| Historical billing | `/api/billing/{payment-method,percentage-agreement,subscription-checkout,subscription-portal,invoices/[invoiceId]/charge,webhook,cron,internal-smoke}` | Historical-obligation reconciliation only. **Cannot authorize new fees or subscriptions.** All collection and enrollment gates stay disabled. |
| Admin | `/api/admin/bootstrap`, `/api/admin/billing/{actions,export}` | Platform-admin only and audited ([`ACTIVATION_CLERK.md`](./ACTIVATION_CLERK.md) §3) |

The pilot cockpits mostly use server actions (`apps/web/lib/cockpit-actions.ts`) that call the same
services. Absence from V2 navigation is not permission to delete a route that is still needed to read or
reconcile history.

## 3. Invariants for both surfaces (IMPLEMENTED)

- Route handlers and server actions call `packages/services`. Identity always resolves on the server
  (`apps/web/lib/api-actor.ts`, `session.ts`). Clients may choose only among the actor's own memberships.
  Guardrails ban client-supplied actor IDs.
- Validation uses the shared Zod contracts plus service rules.
- **Pilot HTTP errors:**
  - `401` unauthenticated;
  - `403` permission;
  - `422` invalid fields;
  - `409` sanitized domain conflict (`DomainRefusalError`, constant body);
  - `429` rate limit;
  - `503` safety dependency unavailable.

  Bodies are JSON `{ error }`. `429` and `503` include `Retry-After`.
- A mutation succeeds only after `mutateState` commits a conditional `version` update. A stale version
  reloads and replays; it never overwrites newer state.
- Historical obligations are append-only. One physical movement can have created at most one historical
  obligation (`percentage_v1`, `legacy_percentage`, or `subscription_v1`). **No route may create a new one**
  under the current decision.
- Private sites, raw tokens, media access, message bodies, and Stripe identifiers never appear in public
  payloads.

## 4. Next contract work (TARGET)

- Map `MarketplaceV2Port` methods to the normalized functions once the prototype executes
  ([`CI.md`](./CI.md) §3).
- Persist `publishJob` and `reconfirmJob` through a normalized adapter. Add an audited private-detail
  disclosure method to the port.
- Expose HTTP endpoints only when a real client needs them. Specify pagination, filters, rate limits, and
  idempotency from implemented code, not invented endpoints.
