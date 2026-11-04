# LogLoads — Observability and Marketplace Event Taxonomy

> **Status:** Current instrumentation with proposed V2 events explicitly distinguished. Last known legacy provider-status observation: August 2026; it is not proof of current event delivery or production health.

## Existing instrumentation

**PostHog:** The legacy client provider and `apps/web/lib/analytics.ts` implement constrained, manual collection. Historically documented events include `$pageview`, `account_created`, `onboarding_completed`, `capacity_requested`, `capacity_approved`, `capacity_declined`, `trip_progressed`, and `message_sent`. The capacity/trip events belong to pilot dispatch flows; **do not extend them as V2 success metrics.** Preserve any historical events for comparison, but do not imply that new V2 event names already fire.

Privacy invariants: event IDs use opaque actor/entity IDs, not email, phone, exact coordinates, message bodies, access instructions, URLs with query strings, session tokens or commercial confidential fields. Disable uncontrolled client autocapture, session recording, console capture and other unsolicited collection unless a separately approved privacy design exists. Check the implementation before claiming these flags are still in effect.

**Sentry:** `apps/web/instrumentation.ts` conditionally integrates `@sentry/nextjs` when configured. Retain `sendDefaultPii: false`, avoid request bodies/headers and private site data, and verify whether source-map upload, ingestion and alert routing actually work. A configured DSN is not proof that errors are reaching the intended project.

## Proposed V2 marketplace event taxonomy — TARGET, not yet proven emitted

| Event | When to emit once | Safe properties (examples) | Why |
|---|---|---|---|
| `job_published` | A real posting transition commits | `jobId`, `orgId`, product class, state | Public supply created |
| `job_reconfirmed` | Poster explicitly confirms active terms | `jobId`, confirmation timestamp | Freshness reliability |
| `job_viewed` | Consent-compatible, deduplicated detail view | `jobId`, page surface | Discovery funnel (not fake views) |
| `job_search_used` | Search applies filters | normalized non-sensitive filter class, result count | Fit/coverage diagnostics |
| `interest_submitted` | Unique or renewed inquiry commits | job/hauler opaque IDs, whether renewed | Core marketplace conversion |
| `interest_replied` | Authorized landing response commits | inquiry opaque ID, response category | Time to meaningful response |
| `interest_withdrawn` | Valid hauler withdrawal commits | inquiry opaque ID | Honest activity outcomes |
| `availability_reconfirmed` | Hauler publishes fresh self-report | org ID, equipment category | Freshness and regional supply |
| `invitation_delivered` | A delivery is verified | invitation opaque ID, channel category | Plan allowance reconciliation |
| `boost_exposure` | Actual eligible sponsored impression | boost/job opaque ID | Evidence-backed promotion value |
| `job_reported` | Moderation report commits | opaque report ID, reason class | Trust and safety |

These are *recommendations*, not implemented API guarantees. Do not silently log message content, gate codes, sensitive coordinates, private equipment photos, payment details, or business contacts. Do not label a delivered email or job view as successful based only on a function call or checkout attempt.

## Health, monitoring and runbooks

- Verify `/api/health` responds for the exact SHA; a green health response is *not* proof of Clerk authorization, SQL RLS, Stripe billing, Resend delivery or real customers.
- Controlled tests should prove error ingestion in the LogLoads Sentry project, safe PII scrubbing, and PostHog receipt of a known non-sensitive event.
- Monitor user-facing V2 error categories: closed-job conflict, membership denial, map/weather unavailable, Supabase outage, rate limiting, and idempotent inquiry retry.
- For subscriptions and boosts (later) monitor reconciliation, webhook dedupe, quota exhaustion and refund/expiry errors without leaking price IDs/customer IDs in public views.
- Measure healthy marketplace signals: legitimate recently confirmed job posts, self-reported capacity, inquiries, first response time, regional coverage and return visits. Never treat completed hauls, assigned trucks or platform-billed load revenue as V2 KPIs.

## Verification record template

Record UTC time, environment, exact commit SHA, provider project (redacted), test actor/fixture, event name, actual provider receipt/result, privacy review, failures and cleanup performed. Do not leave diagnostic public routes deployed.
