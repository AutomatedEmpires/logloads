# LogLoads — Production Environment Contract

Machine-readable source: [`ops/production-env-contract.json`](../ops/production-env-contract.json).
Values live in Doppler and Vercel. Never commit values; the Supabase service-role
key and all secret/key values remain server-only.

## Required to boot and serve production

| Variable | Secret | Absent behavior |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | no | production Stripe checkout/portal creation fails closed |
| `LOGLOADS_SESSION_SECRET` | yes | session signing fails closed |
| `SUPABASE_URL` | no | canonical-state reads fail closed |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | canonical-state reads fail closed |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | no | real public auth is unavailable |
| `CLERK_SECRET_KEY` | yes | server session verification is unavailable |

`LOGLOADS_STATE_FILE` is a non-production convenience only. It is neither required
nor authoritative on Vercel.

## Required to accept real hauling work

| Variable | Secret | Absent behavior |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | every submitted driver credential stays pending, so no driver can accept any load |

Credential review is a binding safety gate, not an optional assistant feature.
`CREDENTIAL_REVIEW_MODEL` may override the pinned `claude-opus-5` default, but
changing the model requires a controlled re-verification of structured output,
document reading, latency, and refusal behavior. `/api/health` reports
`integrations.credentialReview=false` while the provider key is absent.

## Controlled bootstrap

`LOGLOADS_ALLOW_STATE_BOOTSTRAP=true` permits creation of the singleton canonical
row if it is absent. It must be used only after an operator proves the table is
intentionally empty, and removed immediately afterward. Without it, production
fails closed rather than silently replacing missing production data with seed data.

## Feature-gated

| Group | Variables |
|---|---|
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_DISPATCH` |
| Credential review | `ANTHROPIC_API_KEY`; optional pinned override `CREDENTIAL_REVIEW_MODEL` |
| Private media | `LOGLOADS_MEDIA_STORAGE=supabase`, `LOGLOADS_MEDIA_BUCKET`, `LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| Email | `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_REPLY_TO`, `SUPPORT_EMAIL`, `LOGLOADS_CONTACT_EMAIL` |
| Analytics | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` |
| Errors | `SENTRY_DSN` |
| Maps | `NEXT_PUBLIC_MAPBOX_TOKEN` (keyless MapLibre fallback when absent) |

Private media is active only when `LOGLOADS_MEDIA_STORAGE` is exactly `supabase`;
the configured Supabase URL is HTTPS on `*.supabase.co`; its project reference
exactly matches `LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF`; the server-only service
role and browser publishable key are present; and the bucket name is valid. The
production bucket is private, limited to 10 MiB, and accepts JPEG, PNG, and WebP.

The browser receives a short-lived token for one object, uploads directly to that
private bucket, and then the server reads the object back and validates its image
type and dimensions before committing the credential, equipment photo, or trip
document. Authenticated delivery uses short-lived signed URLs. If any part of the
configuration is missing or mismatched, `/api/health` reports
`integrations.media=false` and every media path fails closed with a retryable
unavailable response.

Trip documents are delivery proof, so a Route Pack that requires one cannot
reach `completed` while media is unavailable. Before production cutover, verify
the exact deployment SHA, `integrations.media=true`, and a synthetic signed
upload → server read-back → authenticated delivery round trip.

The previous Cloudinary adapter remains only as dormant compatibility code. It is
not an activation path for LogLoads: every `CLOUDINARY_*` and
`LOGLOADS_CLOUDINARY_*` variable must remain unset in LogLoads environments.
Known foreign Cloudinary tenants are still denied in code as a second boundary.

## Must not be set in production

- `LOGLOADS_ENABLE_DEV_LOGIN` — credential-free development sign-in.
- Any `CLOUDINARY_*` or `LOGLOADS_CLOUDINARY_*` variable — Cloudinary is not a
  LogLoads production provider.
- `SUPABASE_ANON_KEY` as an operating-state credential — `operating_state` is
  explicitly service-role only.

`DATABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_PROJECT_REF` remain
tooling/integration placeholders; runtime canonical state does not read them.

`LOGLOADS_EMAIL_FROM` and `LOGLOADS_EMAIL_REPLY_TO` remain supported compatibility
fallbacks. Production uses the scoped `RESEND_FROM` and `RESEND_REPLY_TO` names.
