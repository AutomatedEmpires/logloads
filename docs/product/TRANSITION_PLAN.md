# LogLoads transition plan — pilot cockpits → Blueprint v1.0 load board

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
| 1 | Relational schema alignment: map the prototype's tables to §12.2 entities and to existing `operating_state` collections (ids preserved, quarantine for invalid rows) | Schema prototype location | **Blocked** — prototype not found in this repository or workspace | Mapping reviewed; no competing schema |
| 2 | Phase A foundation: local/preview migrations, RLS with trusted Clerk claims, read adapters, shadow sync + parity checks | 1 | After 1 | Cross-tenant denial tests; reproducible local setup; no production data touched |
| 3 | Phase B free marketplace on the new model, behind a flag next to the pilot: job posting v2 (create/publish/reconfirm), public search + filters, hauler business profile with equipment + timestamped availability, express interest + replies | 2 (2a: contracts-only UI work may start on the JSON store if the prototype is delayed) | After 2 | Real data only; mobile/low-bandwidth; private-location protection |
| 4 | Phase C paid membership: entitlement enforcement from step 0 contracts (landings, seats), Stripe test-mode products, checkout disclosures | 2, published terms | After 2 | Accurate entitlements; reconciliation; counsel review before live sale |
| 5 | Phase D proactive recruiting: consent, targeted invitations (allowance, dedupe, eligible-audience count), alerts, saved search | 3, 4 | After 4 | No overspend; delivery validation; low-density handling |
| 6 | Phase E boosts: 7/14/28-day purchases, ~100-mile targeting, Sponsored labelling, measured analytics | 3, 4 | After 4 | Real audience; no guarantees; caps per view |
| 7 | Phase F founder rollout: per-state cohorts (10 orgs), 50% for 6 cycles, founding hauler badge (first 1,000) | 4 | After 4 | Eligibility controls; correct six-cycle discount; transparent renewal |
| R | Retirement track: switch surfaces to the new flows, then hide pilot dispatch screens behind flags, then (authorized) remove code | 3 for each surface | Per surface | Records preserved; production proof for financial modules |

### Parallel tracks (independent of the schema)

- **Security:** MapLibre 6 (worker loading fixed before landing), Zod 4 (only after a read-only production ID scan proves
  validation compatibility), security headers, Sentry scrubbing, health endpoint minimization.
- **Maps:** CARTO API key from the existing entitlement (separate dev/prod keys) once credentials are available; free
  commercial limit 1M tile requests/month from 2026-12-01; keep OSM + CARTO attribution.
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
