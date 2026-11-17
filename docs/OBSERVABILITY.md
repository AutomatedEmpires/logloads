# LogLoads — Observability and Marketplace Event Taxonomy

> **Status:** Revised 2026-11-01; §1 privacy posture and §3 revised 2026-11-11 (#330).
> - §1–§2 describe the existing instrumentation, IMPLEMENTED in code at `15892b7`.
> - §3 points to the V2 product events in [`analytics/event-plan.md`](./analytics/event-plan.md). Their call sites
>   are IMPLEMENTED (#330). No event reaches PostHog until `NEXT_PUBLIC_POSTHOG_KEY` is set, and delivery is
>   UNVERIFIED (§4).
>
> Production health on 2026-08-05 reported analytics and error tracking as configured. That is a
> **historical** observation: it proves environment presence then, not event delivery now.

## 1. PostHog (IMPLEMENTED)

PostHog is env-gated (`NEXT_PUBLIC_POSTHOG_KEY` / `_HOST`) and inert without a key. Two capture sides:

- **Client:** `apps/web/components/analytics/AnalyticsProvider.tsx`.
- **Server:** `apps/web/lib/analytics.ts` → `captureServerEvent`.

`person_profiles: "identified_only"` — anonymous pageviews create no person profiles.

### Privacy posture (verified in code)

- The client sends a manual, path-only `$pageview` and the two browser product events of the
  [event plan](./analytics/event-plan.md) (§2, rule 6). Query strings and fragments are removed before capture, and a
  global send hook (`sanitizePostHogEvent`) strips them again as defense in depth.
- A browser that sends Do Not Track or Global Privacy Control never loads PostHog (#330).
- On message, sign-in, sign-up, verification, consent and one-tap routes, the send hook lets through only a
  pageview at the route's root, with no id or token from the path, and drops every other event (legal review
  §6.5, P0 item 12; `SENSITIVE_ROUTES` in `apps/web/lib/analytics-pageview.ts`).
- These are all disabled:
  - autocapture and rage clicks;
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

## 3. V2 marketplace events

The V2 product events, their properties, privacy rules, flow metrics and call sites are defined in
[`analytics/event-plan.md`](./analytics/event-plan.md). That plan replaces the proposed table that used to be here.

- **Catalogue:** plan §3, version 1. Six server events (`job_published`, `interest_submitted`, `interest_replied`,
  `availability_reconfirmed`, `job_reconfirmed`, `job_stopped`) and two browser events (`share_link_opened`,
  `flow_timed`).
- **Call sites:** plan §6. Each server event is sent once, after the write it describes commits, from inside
  `after()`, so the response never waits for PostHog and a PostHog failure never fails the action.
- **Not in version 1:** the earlier proposals `job_viewed`, `job_search_used`, `interest_withdrawn`,
  `invitation_delivered`, `boost_exposure` and `job_reported`. Adding one needs a new catalogue entry in the plan
  and in `apps/web/lib/analytics/events.ts`.

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
