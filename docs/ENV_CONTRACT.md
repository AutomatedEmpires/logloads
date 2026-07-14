# LogLoads — Production Environment Contract

Machine-readable source: [`ops/production-env-contract.json`](../ops/production-env-contract.json).
Values live in Doppler and Vercel. Never commit values; the Supabase service-role
key and all secret/key values remain server-only.

## Required to boot and serve production

| Variable | Secret | Absent behavior |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | no | absolute URLs and Stripe return URLs use a local fallback |
| `LOGLOADS_SESSION_SECRET` | yes | session signing fails closed |
| `SUPABASE_URL` | no | canonical-state reads fail closed |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | canonical-state reads fail closed |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | no | real public auth is unavailable |
| `CLERK_SECRET_KEY` | yes | server session verification is unavailable |

`LOGLOADS_STATE_FILE` is a non-production convenience only. It is neither required
nor authoritative on Vercel.

## Controlled bootstrap

`LOGLOADS_ALLOW_STATE_BOOTSTRAP=true` permits creation of the singleton canonical
row if it is absent. It must be used only after an operator proves the table is
intentionally empty, and removed immediately afterward. Without it, production
fails closed rather than silently replacing missing production data with seed data.

## Feature-gated

| Group | Variables |
|---|---|
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_DISPATCH` |
| Private media | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |
| Email | `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_REPLY_TO`, `SUPPORT_EMAIL`, `LOGLOADS_CONTACT_EMAIL` |
| Analytics | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` |
| Errors | `SENTRY_DSN` |
| Maps | `NEXT_PUBLIC_MAPBOX_TOKEN` (keyless MapLibre fallback when absent) |

## Must not be set in production

- `LOGLOADS_ENABLE_DEV_LOGIN` — credential-free development sign-in.
- `SUPABASE_ANON_KEY` as an operating-state credential — `operating_state` is
  explicitly service-role only.

`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `DATABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_PROJECT_REF` remain tooling/integration placeholders; runtime canonical
state does not read them.

`LOGLOADS_EMAIL_FROM` and `LOGLOADS_EMAIL_REPLY_TO` remain supported compatibility
fallbacks. Production uses the scoped `RESEND_FROM` and `RESEND_REPLY_TO` names.
