# LogLoads — Third-Party Providers

Every external service LogLoads uses, verified against the code on 2026-10-11.
"Gate" is what turns an integration on; anything without its variable stays inert
or fails closed, as noted. Variable details: [ENV_CONTRACT.md](./ENV_CONTRACT.md).
Values live in Doppler and Vercel, never in git.

The provider spine is locked (`AGENTS.md` §7): db = Supabase, private media =
Supabase Storage, auth = Clerk. Don't swap or add providers without a dated
decision in [DECISIONS.md](./DECISIONS.md).

## Runtime: production depends on these

| Provider | What it does for LogLoads | Gate | Where in code |
|---|---|---|---|
| **Vercel** | Hosting (Node runtime). Merging `main` deploys `logloads.com`; PRs get Preview deployments. Runs the daily billing cron (`vercel.json` → `/api/billing/cron`, 05:15 UTC). | Git integration; `VERCEL_*` system vars are injected | `vercel.json`, `apps/web/lib/app-url.ts`, `/api/health` |
| **Supabase — Postgres** | Canonical data: the versioned `public.operating_state` document (compare-and-swap writes). Also the shared rate-limit windows (`consume_rate_limit` RPC). | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (production fails closed without them) | `packages/db/src/snapshot.ts`, `apps/web/lib/rate-limit-supabase.ts`, `supabase/migrations/` |
| **Supabase — Storage** | The only private-media store: credential documents, equipment photos, trip proof. Private bucket, one-object signed uploads, short-lived reads. | `LOGLOADS_MEDIA_STORAGE=supabase`, `LOGLOADS_MEDIA_BUCKET`, `LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `apps/web/lib/media.ts`, `media-config.ts`, `signed-upload-client.ts` |
| **Clerk** | Identity (sign-in/sign-up). Authorization comes from LogLoads memberships, not Clerk. | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY`; without them, non-production uses dev sessions | `apps/web/middleware.ts`, `apps/web/lib/session.ts`, `docs/ACTIVATION_CLERK.md` |
| **Anthropic (Claude API)** | **Required** AI review of driver credential documents: without it no credential clears, so no driver can accept work. Optionally rephrases in-app assistant answers. | `ANTHROPIC_API_KEY`; `CREDENTIAL_REVIEW_MODEL` (default `claude-opus-5`), `ASSISTANT_MODEL` (default `claude-haiku-4-5-20251001`) | `apps/web/lib/credential-reviewer.ts`, `assistant-llm.ts` |
| **Stripe** | Host 5% platform-fee invoices and payment-method setup (SetupIntent), plus read-only reconciliation of historical subscriptions. Never touches driver pay; Connect is out of scope. | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID`, `LOGLOADS_STRIPE_EXPECTED_LIVEMODE`. **Collection is dark** behind `LOGLOADS_FEE_COLLECTION=disabled` | `apps/web/lib/billing.ts`, `subscription-stripe.ts`, `app/api/billing/*`, `components/v3/BillingSettings.tsx`, `docs/ACTIVATION_STRIPE.md` |
| **Resend** | Transactional email (contact routing, billing notices). Plain REST calls, no SDK. If no key is set, sending is skipped and the in-app record remains the source of truth. | `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_REPLY_TO`, `LOGLOADS_CONTACT_EMAIL` | `apps/web/lib/notify.ts`, `billing-notification-email.ts`, `docs/ACTIVATION_RESEND.md` |
| **Sentry** | Server error tracking. Not loaded at all when no DSN is set. PII off. | `SENTRY_DSN` | `apps/web/instrumentation.ts`, `docs/OBSERVABILITY.md` |
| **PostHog** | Product analytics: browser SDK plus server-side capture over REST. | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (`us.i.posthog.com`) | `apps/web/components/analytics/AnalyticsProvider.tsx`, `apps/web/lib/analytics.ts` |
| **Mapbox** | Primary map tiles (`outdoors-v12`) for the map-first driver UI. | `NEXT_PUBLIC_MAPBOX_TOKEN` | `apps/web/lib/map-runtime.ts`, `components/v3/RealMap.tsx` |
| **CARTO basemaps (via MapLibre)** | Fallback map style (Positron) when no Mapbox token is set. | Automatic when `NEXT_PUBLIC_MAPBOX_TOKEN` is absent | `apps/web/lib/map-runtime.ts` |
| **Open-Meteo** | Live weather at the landing. Keyless. | Always on; degrades gracefully | `apps/web/lib/weather-provider.ts`, `/api/weather` |

### Licensing risks to resolve before real commercial traffic

- **Open-Meteo:** the free, keyless API may only be used for non-commercial
  purposes ([terms](https://open-meteo.com/en/terms)). A paying LogLoads needs
  Open-Meteo's commercial API plan (keyed endpoint) or a different weather provider.
- **CARTO basemaps:** commercial use requires a CARTO commercial/Enterprise
  license ([FAQ](https://docs.carto.com/faqs/carto-basemaps)). Setting
  `NEXT_PUBLIC_MAPBOX_TOKEN` in production keeps CARTO out of the path entirely,
  and Mapbox is the locked map provider anyway. Confirm production has the token.

## Build-time and passive

| Provider | Role |
|---|---|
| **Google Fonts** | `next/font` downloads Archivo and Inter at build time and serves them self-hosted. Browsers never call Google. |
| **Google Maps** | Outbound "Directions" deep links only (`components/v3/LoadMap.tsx`). No API or key. |
| **MapLibre GL / Mapbox GL / react-map-gl** | Open-source rendering libraries, not services. `maplibre-gl` 4.x has an open critical advisory, fixed in 6.x, which needs a `react-map-gl` 8 migration. |

## Operations, CI, and developer tooling

| Provider | Role |
|---|---|
| **Doppler** | Source of truth for secret values (`doppler run -- pnpm dev`). The app never calls it. |
| **GitHub** | Repo, Actions CI (reusable workflows from `AutomatedEmpires/.github`), CodeQL, dependency review, Dependabot, issue/PR agent routing. Workflows: `.github/workflows/`. |
| **Agent dispatch webhooks** | `pr-agent-dispatch.yml` forwards `/agent`, `/review`, `/git-agent` PR commands to Codex, Claude, Sentry, and Git agents through CI secrets (`*_AGENT_WEBHOOK_URL`/`_TOKEN`). Missing secrets post a "not configured" note. |
| **Supabase CLI + Docker** | Local and CI migration reset (`pnpm db:check`) and the e2e stack. |
| **Playwright** | e2e journeys and the founder-demo captures. |
| **npm registry** | Package installs. `release.yml` passes `NPM_TOKEN` to the shared release workflow. |

## Business accounts, not code integrations

- **GoDaddy:** registrar for `logloads.com`.
- **Notion:** product source of truth (AutomatedEmpires → Ventures → LogLoads).
- **Facebook / Instagram (`logloads`):** social profiles, linked from the public footer.

## Retired or never used

| Provider | Status |
|---|---|
| Cloudinary | Retired 2026-07-29. Guardrails refuse any code path, and any `CLOUDINARY_*` variable disables media. |
| Fly.io / Docker image | Pre-cutover rollback host. Manifest and Dockerfile removed 2026-10-11; Vercel Instant Rollback replaces it. |
| OpenAI | Never wired. The name stays only on the founder-demo env blocklist. |
| Redis / Vercel KV / Upstash | Not used. Rate limits live in Supabase (decision 2026-07-12). |
| Notification provider (SMS/push) | Never chosen. Placeholder variables removed from `.env.example`. |
