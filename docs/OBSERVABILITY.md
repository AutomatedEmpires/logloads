# LogLoads — Observability

Analytics (PostHog) and error tracking (Sentry) are wired and env-gated. Both are inert
with no keys. Production health on 2026-08-05 reported both integrations configured;
that proves environment presence, not event delivery, source-map upload, or alerting.

## PostHog — event inventory

Client (`components/analytics/AnalyticsProvider.tsx`) and server
(`lib/analytics.ts` → `captureServerEvent`) capture. `person_profiles: "identified_only"`
— anonymous pageviews do not create person profiles.

| Event | Source | distinct_id | Properties | PII/secrets? |
|---|---|---|---|---|
| `$pageview` | client | device id | `$current_url` (origin + pathname only) | query strings and fragments are always removed before capture |
| `account_created` | server (onboarding) | profile UUID | `path`, `accountType` | none |
| `onboarding_completed` | server (onboarding) | profile UUID | `path`, `accountType`, `organizationId`; invited joins also include `invitedRole` | none (UUID and enums only) |
| `capacity_requested` | server (driver/fleet) | profile UUID | `loadPostingId` | none (UUID) |
| `capacity_approved` | server (host) | profile UUID | `assignmentId` | none |
| `capacity_declined` | server (host) | profile UUID | `assignmentId` | none |
| `trip_progressed` | server (driver/dispatch) | profile UUID | `tripId`, `nextStatus` | none |
| `message_sent` | server | profile UUID | `threadId` | none — **body is never captured** |

**Taxonomy rules honored:**
- `distinct_id` is the stable profile **UUID**, not email/name/phone.
- Properties are UUIDs and enum statuses only — **no PII, no secrets, no message content**.
- Event names are stable snake_case operating verbs.
- Browser autocapture, exception/performance/dead-click/heatmap capture, session
  recording, console logs, surveys, tours, conversations, experiments, and
  remote feature/config loading are explicitly disabled. Campaign/referrer
  persistence is off. The only client event is the manual path-only pageview
  above; a global send hook also removes URL queries/fragments and drops
  extracted campaign/search terms as defense in depth.

**Production proof still required:** confirm the configured key belongs to the dedicated
**LogLoads** PostHog project, then observe `onboarding_completed` and the operating-loop
events in Live Events without any PII properties.

**Optional enhancement (not required):** call `posthog.identify(profileId)` client-side
after auth to link anonymous pageviews to the operating events. Deliberately omitted to
avoid attaching identity before it's needed.

**Verify after activation:** `curl /api/health` → `integrations.analytics: true`; run the
operating loop and confirm the events above land in PostHog Live Events.

## Sentry — server error tracking

`apps/web/instrumentation.ts`: initializes `@sentry/nextjs` **only** when `SENTRY_DSN`
is set and the runtime is `nodejs`; `onRequestError` forwards server errors. With no DSN
Sentry is never imported — the app is healthy without it (verified: build + E2E green
with no DSN).

**Privacy posture (verified in code):**
- `sendDefaultPii: false` — no IPs, cookies, headers, or request bodies attached (so the
  session cookie and form input can't leak into events).
- No manual `setUser`/`setContext` with PII anywhere.
- Service-role and other secrets are read from `process.env` and never placed in Sentry
  scope.

**Source maps:** not uploaded (next.config is intentionally not wrapped with
`withSentryConfig`, to keep the build decoupled from Sentry). Stack traces will be
minified. To get readable traces post-launch: wrap `next.config.ts` with
`withSentryConfig` and set `SENTRY_AUTH_TOKEN` at build. This is the one optional
enhancement; it is **not** required to receive errors.

**Production proof still required:** confirm the configured DSN belongs to the dedicated
**LogLoads** Sentry project, deliver a controlled test event, verify alert routing, and
record the result without retaining a public test route.

**Verify after activation:** `curl /api/health` → `integrations.errorTracking: true`;
trigger a safe test error on a throwaway route (or temporarily add `/api/_sentry-test`)
and confirm it appears in the Sentry issues stream, then remove the test route.
