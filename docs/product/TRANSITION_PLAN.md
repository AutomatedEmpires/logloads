# LogLoads transition plan — pilot cockpits → Blueprint v1.0 load board

> **Status:** APPROVED engineering sequence (TARGET work). Status notes were last updated 2026-11-02; see the
> addendum at the end.

Authority: [`LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md`](./LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md) and `docs/DECISIONS.md` (2026-11-01).
This plan sequences engineering work. It does not authorize deploys, production migrations, live billing, or
retirement of financial records — each of those still needs explicit approval.

## Principles

1. **Keep the running app working.** New load-board flows are built alongside the pilot cockpits and switched over per
   surface. Do not rebuild pilot screens that are scheduled for replacement.
2. **Rules before storage.** Product rules (plans, entitlements, invitations, boosts, founder offer) live as pure, tested
   contracts in `packages/contracts` so every later phase enforces the same numbers.
3. **One relational design.** The normalized Supabase schema is coordinated with the separately prepared schema
   prototype. No competing schema is written here; this plan defines the entities and data mapping it must satisfy.
4. **Preserve history.** Percentage-fee, legacy and subscription_v1 records, invoices, webhooks and guardrails stay
   parseable and gated off until an evidence-backed, authorized retirement.

## Capability map

### Retain and adapt (maps to Blueprint §12.2 entities)

| Existing capability (code) | Becomes | Adaptation |
|---|---|---|
| Clerk + server sessions (`apps/web/lib/session.ts`, `api-actor.ts`), dev sign-in | Users / memberships | Keep server-side identity; add seat limits per plan |
| `organizations`, `organizationMemberships`, `organizationInvitations` (`services/accounts`, `team`, `invitations`, `organization-access`) | Organizations, team seats | One org type for paying landing operators, one for free hauler businesses; seats 2/5/10 |
| Organization review status, `verificationRecords`, platform admin (`services/admin`, `platform-admin`, `verification`) | Business verification, admin console | Scope "verified" to business identity only (§10.2) |
| `driverProfiles`, `truckProfiles`, `trailerProfiles`, `equipmentCombinations` (`services/driver-profile`, `equipment`, `equipment-unit-numbers`) | Hauler business profile + equipment | Merge driver/fleet into one hauler-company model (§2.1, §2.4) |
| `availabilityWindows`, `futureAvailability` (`services/availability`) | Availability records | Counts by equipment type, service area, window, visible timestamp; never inferred (§5.1) |
| `driverCredentials`, `credentialReviews` (`services/driver-credentials`) | Optional credentials | Label as unverified unless actually checked |
| `landings`, `richLandingDetails`, `mills`, `destinationFacilities` (`services/host-workspace`) | Landings (public approx + private detail), destinations | Active/inactive landing state for 1/3/unlimited limits (§3.3) |
| `loadPostings`, `opportunityCapacities` (`services/loads`, part of `operating-network`) | Job postings | Long-lived opportunity: pay + pay unit, trucks requested (unmetered), duration, status draft/active/paused/filled/expired, last-confirmed date (§10.1) |
| Public `/loads`, redacted network view (`apps/web/lib/network.ts`) | Public search + job pages | Keep server-side redaction of private access data |
| `RealMap`/`LoadMap` (Mapbox + MapLibre/CARTO), `/api/weather` | Maps and weather | Lazy map, source/time on weather, CARTO API key (§5.1, §12.4) |
| `messageThreads`, `messageEvents` (`services/messaging`) | Expressions of interest + replies | Interest = hauler-initiated thread with capacity/dates; unlimited, unmetered |
| `notifications`, `operationalNotices` | Job alerts, invitation delivery | Opt-in, frequency controls, unsubscribe (§6.3, §10.5) |
| `supportRequests`, `auditEvents`, Supabase rate limiting, private media storage | Trust, moderation, audit | Add listing/abuse reports and moderation actions |
| Stripe port, webhook verification, idempotency, account verification (`apps/web/lib/billing.ts`, `subscription-stripe.ts`) | Membership + boost billing infrastructure | Reuse plumbing; new products only after Phase C gates |

### Retire later (stop extending; preserve records until authorized removal)

| Pilot capability | Why it leaves | Records to preserve |
|---|---|---|
| Truck slots, direct offers, assignment approval as dispatch, route packs, trips, trip events/documents/inspections/reviews, haul completion, residual settlement, scheduling (`services/truck-slots`, `assignments`, `route-packs`, `haul-completion`, `residual-settlement`, `trip-reviews`, parts of `operating-network`; APIs `truck-slots`, `trips`, `trip-documents`, `route-packs`, `direct-offers`, `assignments`) | Blueprint §1.3 / §12.5: no dispatch, trip tracking or settlement | Trip documents and history already created; audit events |
| Percentage fee accrual and host invoicing (`platform-fees`, `percentage-billing`, fee cron, payment-method setup for fees) | No per-load or percentage fees | All `platformFeeEvents`, `hostInvoices`, `hostBillingProfiles`, frozen terms, Stripe ids |
| `subscription_v1` / Dispatch Pro (`subscription-billing`, legacy reconciliation, portal) | Replaced by Basic/Pro/Regional | All subscription, usage, adjustment and invoice records (see `docs/SUBSCRIPTION_BILLING_V1.md`) |
| Driver Schedule, Host Live/Work and similar dispatch cockpit screens; `/pilot` showroom | Describe the superseded product | None beyond audit history |

Removal of any financial module requires the production-proof checklist in the 2026-11-01 audit (zero open obligations
in canonical state and in Stripe) and explicit authorization.

## Sequence (dependency-aware)

| Step | Work | Depends on | Can start | Gate to finish |
|---|---|---|---|---|
| 0 | Blueprint in repo; decision entry; **membership rules contract** (`packages/contracts/src/membership.ts`) | — | **Done in this change** | Unit tests encode §3, §6, §7, §8 numbers |
| 1 | Relational schema alignment: map the prototype's tables to §12.2 entities and to existing `operating_state` collections (ids preserved, quarantine for invalid rows) | Prototype files present: `01_schema.sql`, `02_access.sql`, `03_entitlements.sql`, `04_tests.sql`, `05_concurrency_test.ps1` (`01`–`05` **verified on disposable PostgreSQL 17 at `ec4bb66`** on `test/normalized-v2-postgres17-ci`, not yet merged — see [`../CI.md`](../CI.md) §3; `06`–`10` verified in CI on draft PR #123, unreviewed) | **In progress by the prototype owner** — see "Schema prototype alignment" | Mapping reviewed; no competing schema |
| 2 | Phase A foundation: local/preview migrations, RLS with trusted Clerk claims, read adapters, shadow sync + parity checks | 1 | After 1 | Cross-tenant denial tests; reproducible local setup; no production data touched |
| 3 | Phase B free marketplace on the new model, behind a flag next to the pilot: job posting v2 (create/publish/reconfirm), public search + filters, hauler business profile with equipment + timestamped availability, express interest + replies | 2 (2a: contracts-only UI work may start on the JSON store if the prototype is delayed) | **2a implemented** behind the flag (see "Step 3 slice"); full step after 2 | Real data only; mobile/low-bandwidth; private-location protection |
| 4 | Phase C paid membership: entitlement enforcement from step 0 contracts (landings, seats), Stripe test-mode products, checkout disclosures | 2, published terms | After 2 | Accurate entitlements; reconciliation; counsel review before live sale |
| 5 | Phase D proactive recruiting: consent, targeted invitations (allowance, dedupe, eligible-audience count), alerts, saved search | 3, 4 | After 4 | No overspend; delivery validation; low-density handling |
| 6 | Phase E boosts: 7/14/28-day purchases, ~100-mile targeting, Sponsored labelling, measured analytics | 3, 4 | After 4 | Real audience; no guarantees; caps per view |
| 7 | Phase F founder rollout: per-state cohorts (10 orgs), 50% for 6 cycles, founding hauler badge (first 1,000) | 4 | After 4 | Eligibility controls; correct six-cycle discount; transparent renewal |
| R | Retirement track: switch surfaces to the new flows, then hide pilot dispatch screens behind flags, then (authorized) remove code | 3 for each surface | Per surface | Records preserved; production proof for financial modules |

### Schema prototype alignment

The normalized-v2 prototype lives at `architecture/normalized-v2/` (non-active, `marketplace` schema, not a migration;
owned by its separate author — do not edit it from this track). It already matches the blueprint on: one organization
model for landing and hauling businesses, owner/manager/staff/driver roles (drivers never consume a paid seat), public vs
private landing details, long-lived job postings with unmetered `trucks_requested`, unlimited expressions of interest,
self-reported timestamped availability, per-cycle `entitlement_periods` (new row per cycle = no rollover), targeted
invitations with consent and delivery attempts, 24-hour-unit boosts with frozen terms and a 100-mile default, generic
promotions for the founding offer, abuse reports and an append-only audit log.

The step 0 contract (`packages/contracts/src/membership.ts`) is aligned to it: plan/boost/promotion numbers are the
blueprint baseline used to seed and verify the prototype's versioned rows (runtime reads the active rows); reserved +
delivered invitations count against the allowance; `Number.POSITIVE_INFINITY` as the dedupe window reproduces the
prototype's one-live-invitation-per-job-and-recipient rule.

Items to settle with the prototype owner before step 2:

- **Dedupe semantics:** the prototype forbids re-inviting the same business to the same job for the job's life (unless
  the invitation failed); Blueprint §6.3 speaks of a "defined deduplication window". Pick one rule.
- **Recipient frequency:** the prototype adds `max_invitations_per_week` per hauler (default 5); confirm the default.
- **Mapping:** `operating_state` collections → `marketplace` tables (organizations, memberships, equipment, landings,
  postings, interest threads); historical billing/trip collections stay in the legacy store (not mapped).
- **Identity:** the prototype trusts Clerk via allowlisted JWT issuers and `identity_links`; the app currently resolves
  identity server-side with the service role. Step 2 decides how requests carry the Clerk JWT to PostgREST.

### Step 3 slice on the pilot store (implemented and hardened 2026-11-01)

**Status: implemented** behind `LOGLOADS_MARKETPLACE_V2=enabled` (development only, `/v2`; never on `VERCEL_ENV=production`).
A landing's posting appears in a text-first discovery list with an optional CARTO map; a hauling business expresses
nonbinding interest (optionally per equipment configuration from its own profile, self-reported); the landing reviews,
replies or declines; the hauler sees the reply. **PostgreSQL integration remains unverified** — everything here runs on
the pilot `operating_state` document.

Boundary for the normalized adapter:

- Contracts: `packages/contracts/src/marketplace-v2.ts` (views, statuses mirroring `expressions_of_interest`, pay units
  and equipment codes mirroring `job_postings.pay_unit` and the seeded `equipment_types`), `marketplace-job-draft.ts`
  (authoring draft mirroring `job_postings` columns and CHECKs, incl. `contains_sensitive_access_pattern`), and
  `marketplace-permissions.ts` (capabilities restating the RLS role sets — no second role system).
- Rules: `packages/services/src/marketplace-interest.ts` (capability checks, one live interest per job and hauler
  business, equipment resolved against the hauler's own profile, replay-safe replies, audit events);
  `marketplace-access.ts` translates pilot roles into normalized memberships (side-limited; deleted at cutover).
  Interest persistence is the additive `marketplaceInterests` collection.
- Port: `apps/web/lib/marketplace-v2/port.ts`; `pilot-adapter.ts` implements discovery and inquiries. **Native job
  publishing and reconfirmation are UI + validation + preview only** (`supportsPublishing: false`): they are not
  forced into legacy load/slot records and no second JSON job model was created; they persist once a normalized adapter
  implements `publishJob` / `reconfirmJob` against `job_postings`.

Data semantics: pilot `updatedAt` is shown only as "last edited"; the pilot has no confirmation action, so no pilot job
is ever labelled confirmed (`lastConfirmedAt` null). Pilot pay is a per-load amount; pilot capacity counts truckloads,
so "trucks for the job" is unknown and only "trucks per day" is shown.

Items for the prototype owner:

- `job_postings` has `trucks_requested` (total) and `est_daily_loads` (whole job) but no **trucks per day** or **loads per
  truck per day** column; the V2 contract carries both as optional poster estimates.
- No table for the **equipment configurations offered in an interest** (`expressions_of_interest` has only
  `trucks_offered`); the V2 contract snapshots configuration, label and count per line.
- Public point snapping is 0.1° in `approximate_point`; the pilot public view snaps to 0.02°. Pick one for V2.
- Interest insert requires a public `hauler_profiles` row; the pilot treats any carrier/fleet organization as a hauler.

### Parallel tracks (independent of the schema)

- **Security:** MapLibre 6 (worker loading fixed before landing), Zod 4 (only after a read-only production ID scan proves
  validation compatibility), security headers, Sentry scrubbing, health endpoint minimization.
- **Maps:** CARTO Basemaps on MapLibre is integrated as the preferred basemap (`NEXT_PUBLIC_CARTO_BASEMAP_KEY`;
  authenticated style/tile/glyph/sprite requests, OSM + CARTO attribution, lazy loading, text fallback). The account
  owner reports an entitlement of **5 million basemap requests per month**; confirm scope, origin restrictions and
  usage in the CARTO dashboard, and use separate development and production keys. No production variable is set.
- **Environment discipline:** per-batch storage log (`logloads-audit/storage-check.sh`); builds in temporary worktrees,
  deleted after use.

## Open decisions (Blueprint §16.2 and engineering)

- Location of the schema prototype (blocks step 1).
- Listing reconfirmation interval and stale/expiry policy; invitation "delivered" semantics and dedupe window
  (the step 0 contract takes the window as a required parameter rather than inventing one).
- Proration, failed-payment grace, taxes, refunds, cancellation timing; founding-offer verification process.
- Qualified transportation-law review before monetized invitations or boosts.
- `tools/check-guardrails.mjs` bans the retired copy pattern `$499/mo` in `apps/web`; the Regional plan is $499/month,
  so the new pricing surface must update that guardrail deliberately (keep banning the retired Dispatch Pro copy).

## Status addendum — 2026-11-01 documentation reconciliation

*Append-only status notes. The plan text above is not edited. They record repository evidence at commit `4c9518e`
plus the observed state of the primary checkout. They do not change sequencing or product decisions.*

### Schema prototype

- The "Location of the schema prototype (blocks step 1)" open decision is answered: `architecture/normalized-v2/`.
  The step 1 row already says so.
- *Updated 2026-11-02:* `01`–`05` are committed on `test/normalized-v2-postgres17-ci`, with CI fixes. At
  `ec4bb66` they are **VERIFIED** on disposable PostgreSQL 17 ([`../CI.md`](../CI.md) §3).
- Still open:
  - that branch is not merged into `work/logloads-repair`;
  - the `06`–`10` alignment is VERIFIED in CI ([`../CI.md`](../CI.md) §3) but sits on draft PR #123, which is unreviewed;
  - nothing is connected to the application.

### CARTO allowance

The 5M requests/month figure in "Parallel tracks" is the account owner's report. It is **unverified** — see the
dashboard check listed there. An earlier revision of this plan cited a public "1M tile requests/month from
2026-12-01" free-tier limit. `4c9518e` replaced it. If both figures are real, they describe different things: a
public tier versus this account's entitlement.

### Missing tool

`logloads-audit/storage-check.sh`, cited under "Environment discipline", does not exist in this repository.

### Historical contracts referenced above

`docs/SUBSCRIPTION_BILLING_V1.md` carries a superseded notice. The security record and the `percentage_v1`
Stripe runbook remain in `docs/archive/` as evidence. The handoffs, marketplace specification and old pilot contract
are recoverable from tag `archive/docs-history-20261102` ([`../archive/README.md`](../archive/README.md)).
