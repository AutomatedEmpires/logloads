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
| Private media | `LOGLOADS_CLOUDINARY_TENANCY=dedicated`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — see activation sequence below |
| Email | `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_REPLY_TO`, `SUPPORT_EMAIL`, `LOGLOADS_CONTACT_EMAIL` |
| Analytics | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` |
| Errors | `SENTRY_DSN` |
| Maps | `NEXT_PUBLIC_MAPBOX_TOKEN` (keyless MapLibre fallback when absent) |

**Private media activates only with the exact non-secret tenancy marker and all
three trimmed, nonblank credentials. Every other nonblank `CLOUDINARY_*`
variable is forbidden and makes the configuration inactive, including SDK URL,
account, proxy, OAuth, private-CDN, secure-distribution, and future ambient
options.** Without that complete isolated configuration,
`/api/health` keeps its overall status tied to the operating engine but reports
`integrations.media=false`; upload signing, provider verification, photo
delivery, and trip-document delivery all return the same retryable unavailable
response before the Cloudinary SDK is loaded or a provider adapter is called.
After the gate passes, the pinned SDK singleton is fully reset before only the
three allowlisted values are applied. Trip documents are delivery proof,
so a haul whose Route Pack requires one cannot reach `completed` while media is
inactive. Treat dedicated media as required wherever hauling is live.

(Records written before uploads were wired still satisfy the completion gate,
which asks only for a document of an evidence type — but they carry no file and
are never offered for download. That residue is bounded to hauls already in
flight; no new record can be medialess.)

### Production-only Cloudinary activation

1. An accountable operator provisions or confirms a Cloudinary tenant owned for
   LogLoads alone and verifies its ownership boundary outside the application.
2. The operator replaces all three `CLOUDINARY_*` values in the LogLoads Doppler
   project and Vercel **Production** environment while leaving
   `LOGLOADS_CLOUDINARY_TENANCY` unset, and removes every other `CLOUDINARY_*`
   variable rather than retaining an SDK URL, proxy, token, or delivery-host
   override. Deploying in that state is safe:
   `integrations.media` stays false and media remains fail-closed.
3. On the exact intended production deployment, the operator rechecks that all
   three values resolve to the dedicated tenant, then sets the marker to exactly
   `dedicated` in Vercel Production and redeploys. Do not copy it into Preview or
   Development as a convenience.
4. Verify the deployed SHA, `integrations.media=true`, and an approved synthetic
   signed-upload → provider-read-back → authenticated-delivery round trip in the
   dedicated LogLoads namespace. If any evidence is uncertain, remove the marker
   and redeploy to return every media path to the 503 gate.

The marker is an **operator attestation, not cryptographic tenancy proof**. The
runtime can prove only that the exact marker and three nonblank values are
present; it cannot infer who owns the provider account or distinguish dedicated
credentials from confidently miswired ones. `integrations.media=true` therefore
means operator-attested dedicated activation, not independent provider-ownership
verification. Record the accountable operator and dated provider evidence at
activation without recording identifiers or secret values in the repository.

## Must not be set in production

- `LOGLOADS_ENABLE_DEV_LOGIN` — credential-free development sign-in.
- Any `CLOUDINARY_*` variable except `CLOUDINARY_CLOUD_NAME`,
  `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` — ambient SDK configuration
  disables media even when the dedicated-tenancy marker is present.
- `SUPABASE_ANON_KEY` as an operating-state credential — `operating_state` is
  explicitly service-role only.

`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `DATABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_PROJECT_REF` remain tooling/integration placeholders; runtime canonical
state does not read them.

`LOGLOADS_EMAIL_FROM` and `LOGLOADS_EMAIL_REPLY_TO` remain supported compatibility
fallbacks. Production uses the scoped `RESEND_FROM` and `RESEND_REPLY_TO` names.
