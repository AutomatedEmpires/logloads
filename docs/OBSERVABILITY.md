# LogLoads — Observability

Analytics (PostHog) and error tracking (Sentry) are wired and env-gated. Both are inert
with no keys and activate the moment their key is set. The only remaining external steps
are providing the LogLoads project keys.

## PostHog — event inventory

Client (`components/analytics/AnalyticsProvider.tsx`) and server
(`lib/analytics.ts` → `captureServerEvent`) capture. `person_profiles: "identified_only"`
— anonymous pageviews do not create person profiles.

| Event | Source | distinct_id | Properties | PII/secrets? |
|---|---|---|---|---|
| `$pageview` | client | device id | `$current_url` (path) | none — cockpit paths carry only UUIDs |
| `account_created` | server (onboarding) | profile UUID | `path`, `accountType` | none |
| `capacity_requested` | server (driver/fleet) | profile UUID | `loadPostingId` | none (UUID) |
| `capacity_approved` | server (host) | profile UUID | `assignmentId` | none |
| `capacity_declined` | server (host) | profile UUID | `assignmentId` | none |
| `trip_progressed` | server (driver/dispatch) | profile UUID | `tripId`, `nextStatus` | none |
| `message_sent` | server | profile UUID | `threadId` | none — **body is never captured** |

**Taxonomy rules honored:**
- `distinct_id` is the stable profile **UUID**, not email/name/phone.
- Properties are UUIDs and enum statuses only — **no PII, no secrets, no message content**.
- Event names are stable snake_case operating verbs.

**Founder step:** create a dedicated **LogLoads** PostHog project, set
`NEXT_PUBLIC_POSTHOG_KEY` (and `NEXT_PUBLIC_POSTHOG_HOST` if not US cloud).

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

**Founder step:** create a dedicated **LogLoads** Sentry project, set `SENTRY_DSN`.

**Verify after activation:** `curl /api/health` → `integrations.errorTracking: true`;
trigger a safe test error on a throwaway route (or temporarily add `/api/_sentry-test`)
and confirm it appears in the Sentry issues stream, then remove the test route.
