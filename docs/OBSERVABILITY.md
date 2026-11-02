# LogLoads — Observability and Marketplace Event Taxonomy

> **Status:** Revised 2026-11-01.
> - §1–§2 describe the existing instrumentation, IMPLEMENTED in code at `15892b7`.
> - §3 is the proposed V2 taxonomy (TARGET). **No V2 event is emitted today** — the `/v2` code calls no
>   analytics function.
>
> Production health on 2026-08-05 reported analytics and error tracking as configured. That is a
> **historical** observation: it proves environment presence then, not event delivery now.

## 1. PostHog (IMPLEMENTED)

PostHog is env-gated (`NEXT_PUBLIC_POSTHOG_KEY` / `_HOST`) and inert without a key. Two capture sides:

- **Client:** `apps/web/components/analytics/AnalyticsProvider.tsx`.
- **Server:** `apps/web/lib/analytics.ts` → `captureServerEvent`.

`person_profiles: "identified_only"` — anonymous pageviews create no person profiles.

### Privacy posture (verified in code)

- The only client event is a manual, path-only `$pageview`. Query strings and fragments are removed before
  capture, and a global send hook strips them again as defense in depth.
- These are all disabled:
  - autocapture;
  - exception, performance, dead-click, and heatmap capture;
  - session recording;
  - console logs;
  - surveys, tours, and conversations;
  - experiments and remote config;
  - campaign/referrer persistence.
- `distinct_id` is the profile UUID, never an email, name, or phone number.
- Properties are UUIDs and enums only — no PII, secrets, or message bodies.

### Server event inventory — legacy pilot

`captureServerEvent` is called with **46 distinct event names** at `15892b7`, plus 4 billing events through
`captureBillingEvent`. They describe the pilot's operating loop, including:

- dispatch: `capacity_requested`, `direct_offer_*`, `trip_progressed`, `haul_completion_submitted`,
  `driver_payment_*`, `route_pack_refreshed`;
- historical billing: `network_*`, `subscription_*`;
- general: `account_created`, `onboarding_completed`, `landing_created`, `load_published`, `message_sent`,
  `invitation_*`, `support_request_*`, `verification_submitted`.

The authoritative list is the code. Search for `captureServerEvent("`. The earlier 8-row table in this
document was a partial inventory.

**Rules for these events:**

- Preserve them for historical comparison.
- **Do not extend the dispatch, trip, payment, or billing events, and do not use them as V2 success metrics.**
  They measure the superseded product.

## 2. Sentry (IMPLEMENTED)

`apps/web/instrumentation.ts` initializes `@sentry/nextjs` **only** when `SENTRY_DSN` is set and the runtime
is `nodejs`. `onRequestError` forwards server errors. Without a DSN, Sentry is never imported.

- `sendDefaultPii: false` — no IPs, cookies, headers, or request bodies.
- No `setUser` / `setContext` with PII.
- Secrets never enter Sentry scope.
- **Source maps are not uploaded:** `next.config` is not wrapped with `withSentryConfig`, so stack traces are
  minified. Uploading source maps is an optional later change that needs `SENTRY_AUTH_TOKEN` at build time.

## 3. Proposed V2 marketplace events (TARGET — not emitted)

Emit each event once, when the underlying transition **commits**. Never emit on a click or a page load alone.

| Event | When | Safe properties | Why |
|---|---|---|---|
| `job_published` | A real posting publish commits | `jobId`, `orgId`, product class | Supply created |
| `job_reconfirmed` | Poster explicitly confirms the terms are still current | `jobId`, confirmation time | Freshness |
| `job_viewed` | Deduplicated, consent-compatible detail view | `jobId`, surface | Discovery funnel (no inflated views) |
| `job_search_used` | Search applies filters | Coarse filter class, result count | Coverage diagnostics |
| `interest_submitted` | Unique or renewed interest commits | Opaque job and hauler IDs, renewed flag | Core conversion |
| `interest_replied` | Landing response commits | Opaque interest ID, response category | Time to meaningful response |
| `interest_withdrawn` | Withdrawal commits | Opaque interest ID | Honest outcomes |
| `availability_reconfirmed` | Hauler publishes a fresh self-report | `orgId`, equipment category | Regional supply freshness |
| `invitation_delivered` | Delivery verified by the channel's defined rule | Opaque invitation ID, channel | Allowance reconciliation |
| `boost_exposure` | An eligible sponsored impression is served | Opaque boost and job IDs | Evidence-backed promotion value |
| `job_reported` | Moderation report commits | Opaque report ID, reason class | Trust and safety |

**Never capture any of these:**

- message content;
- gate codes or access notes;
- exact coordinates;
- private photos;
- payment details;
- contacts.

These events serve the pilot scorecard ([`PILOT_LAUNCH.md`](./PILOT_LAUNCH.md) §5) and Blueprint §13. Never
measure trucks hired, loads hauled, or revenue moved. The platform does not observe them.

## 4. Health and verification

- `GET /api/health` reports coarse booleans: `integrations.analytics` and `integrations.errorTracking`. It
  also reports the commit SHA. A green response is **not** proof of any of these:
  - event delivery;
  - Clerk authorization;
  - RLS;
  - billing;
  - email delivery;
  - real customers.
- **Proof of delivery still owed:**
  - Confirm the configured key and DSN belong to the dedicated **LogLoads** PostHog and Sentry projects.
  - Observe a known non-sensitive event in PostHog Live Events.
  - Deliver a controlled Sentry test event, verify alert routing, and remove any temporary test route.
- **Errors to monitor on the V2 path:**
  - closed-job conflicts;
  - membership denials;
  - map or weather unavailable;
  - Supabase outage;
  - rate limiting;
  - idempotent retries.
- **Verification record:** UTC time, environment, exact SHA, redacted provider project, synthetic actor,
  event, actual receipt, privacy review, and cleanup.
