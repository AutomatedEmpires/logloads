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
| Billing provider | `STRIPE_SECRET_KEY`, `LOGLOADS_STRIPE_EXPECTED_LIVEMODE`, `LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` |
| Historical Dispatch Pro catalog | `STRIPE_PRICE_DISPATCH` (read-only reconciliation; no new enrollment) |
| Historical Network recurring catalog | `STRIPE_PRICE_NETWORK_PILOT`, `STRIPE_PRICE_NETWORK_25`, `STRIPE_PRICE_NETWORK_50`, `STRIPE_PRICE_NETWORK_100` |
| Historical Network overage catalog | `STRIPE_PRICE_NETWORK_PILOT_OVERAGE`, `STRIPE_PRICE_NETWORK_25_OVERAGE`, `STRIPE_PRICE_NETWORK_50_OVERAGE`, `STRIPE_PRICE_NETWORK_100_OVERAGE` |
| Internal billing verification | `STRIPE_PRICE_INTERNAL_BILLING_TEST`, `LOGLOADS_INTERNAL_BILLING_SMOKE`, `LOGLOADS_INTERNAL_BILLING_SMOKE_ALLOWED_USER_IDS`, `LOGLOADS_INTERNAL_BILLING_SMOKE_ALLOWED_ORGANIZATION_IDS` |
| Current percentage enrollment | `LOGLOADS_PERCENTAGE_ENROLLMENT`, the exact `LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS`, and its private `LOGLOADS_PERCENTAGE_EXPECTED_ORGANIZATION_SCOPE_SHA256` assertion; all default dark and none authorizes collection |
| Collection switches | `LOGLOADS_FEE_COLLECTION` is the sole current provider-charge gate for `percentage_v1` and preserved legacy fee invoices; `LOGLOADS_SUBSCRIPTION_COLLECTION`, `LOGLOADS_SUBSCRIPTION_ALLOWED_ORGANIZATION_IDS`, and `LOGLOADS_DISPATCH_SELF_SERVE` are disabled historical controls only |
| Credential review | `ANTHROPIC_API_KEY`; optional pinned override `CREDENTIAL_REVIEW_MODEL` |
| Private media | `LOGLOADS_MEDIA_STORAGE=supabase`, `LOGLOADS_MEDIA_BUCKET`, `LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF`, and preferred `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or supported compatibility alias `NEXT_PUBLIC_SUPABASE_ANON_KEY`; the preferred name wins if both exist) |
| Email | `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_REPLY_TO`, `SUPPORT_EMAIL`, `LOGLOADS_CONTACT_EMAIL` |
| Analytics | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` |
| Errors | `SENTRY_DSN` |
| Maps | `NEXT_PUBLIC_MAPBOX_TOKEN` (keyless MapLibre fallback when absent) |

## Billing activation boundaries

The founder's current model is `percentage_v1`. `LOGLOADS_FEE_COLLECTION` is
the sole current commercial collection gate and defaults to `disabled`. When it
is absent, invalid, or disabled, the app may maintain canonical percentage fee,
invoice, and reconciliation records, but it must create no provider charge.
Provider credentials, webhooks, deployed code, accepted terms, or historical
catalog objects do not turn the switch on.

New host agreement acceptance has a separate, fail-closed boundary. It requires
`LOGLOADS_PERCENTAGE_ENROLLMENT=enabled` and the authenticated host's exact
organization id in `LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS`. The SHA-256
of the sorted, normalized exact scope must also match
`LOGLOADS_PERCENTAGE_EXPECTED_ORGANIZATION_SCOPE_SHA256`; a missing, malformed,
or drifting assertion refuses every agreement. The wildcard `*` is not
recognized. Keep the gate disabled, allowlist blank, and expected assertion
blank until a dated counsel-approved operating posture and exact pilot
authorization exist. Enrollment does not enable provider collection, and the
collection switch does not enroll an organization.

`LOGLOADS_SUBSCRIPTION_COLLECTION` and `LOGLOADS_DISPATCH_SELF_SERVE` are
historical safety gates and must remain `disabled` for new activity.
`LOGLOADS_SUBSCRIPTION_ALLOWED_ORGANIZATION_IDS` remains empty; the former `*`
general-availability sentinel is not valid under the current decision. These
disabled controls do not discard signed reconciliation for an obligation that
was accepted and created while the 2026-07-28 subscription-v1 decision governed,
but they may not create a new customer, Checkout, subscription, plan change,
usage event, overage, or charge.

`LOGLOADS_STRIPE_EXPECTED_LIVEMODE` is mandatory and independent of key
presence. Production must set it to `live`; controlled local and test runtimes
set it to `test`. Secret and publishable key prefixes, signed event `livemode`,
catalog objects, portal/card operations, legacy invoices, subscription invoices,
and the internal smoke must agree with that assertion or fail closed.

`LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID` is a server-side tenancy assertion, not a
display value. Checkout, subscription webhooks, scheduled usage collection, the
catalog provisioner, and the lifecycle verifier call Stripe's account endpoint
and fail closed unless the authenticated account is the configured LogLoads
account. Error responses and tool output never include either account id.

`LOGLOADS_FEE_COLLECTION` applies to current `percentage_v1` invoices and to
preserved invoices created from frozen `legacy_percentage` assignments. The
billing-model snapshot must keep those ledgers distinct. A physical movement may
produce one `percentage_v1`, one preserved `legacy_percentage`, or one historical
subscription-v1 obligation, never more than one.

The internal verification path is a one-off $1 provider invoice, not a
subscription or public entitlement. It requires all of:

- `LOGLOADS_INTERNAL_BILLING_SMOKE=enabled`;
- the authenticated platform owner's canonical user id in
  `LOGLOADS_INTERNAL_BILLING_SMOKE_ALLOWED_USER_IDS`;
- the exact controlled internal organization id in
  `LOGLOADS_INTERNAL_BILLING_SMOKE_ALLOWED_ORGANIZATION_IDS`;
- `STRIPE_PRICE_INTERNAL_BILLING_TEST` bound to the hidden one-time Price;
- an unused canonical smoke record and explicit confirmation phrase.

Leave the smoke switch and both allowlists unset outside one founder-authorized
run. Internal billing tests are tagged and excluded from commercial MRR and ARR.

Every historical catalog variable contains only a pre-created `price_...`
identifier. Ordinary customer requests never create Products or Prices and never
substitute an inline amount. The catalog is retained for prior-obligation
reconciliation only and is not a commercial menu under `percentage_v1`.

The public health route reports only coarse billing readiness, current gate
state, and a boolean that says whether the private expected enrollment-scope
assertion matches. It does not publish the organization count, scope digest,
historical catalog posture, smoke controls, provider-account posture, keys,
Price ids, customer ids, or webhook material.

Private media is active only when `LOGLOADS_MEDIA_STORAGE` is exactly `supabase`;
the configured Supabase URL is HTTPS on `*.supabase.co`; its project reference
exactly matches `LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF`; the server-only service
role and either the preferred browser publishable key or its compatibility alias
are present; and the bucket name is valid. The production bucket is private,
limited to 10,000,000 bytes, and accepts JPEG, PNG, and WebP.

The preferred browser credential name is
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; `NEXT_PUBLIC_SUPABASE_ANON_KEY` remains
a compatibility alias and does not need to be configured alongside it. If both
exist, the publishable-key value is authoritative. The service-role key remains
server-only. Whichever browser key is used must belong to the same project named
by `SUPABASE_URL`.

The browser receives a short-lived token for one generated object path, uploads
directly to that private bucket with upsert disabled, and then the server reads
the object back and validates its byte count, image type, and dimensions before
committing the credential, equipment photo, or trip document. Authenticated
delivery uses five-minute signed URLs after application authorization. If any
part of the configuration is missing or mismatched, `/api/health` reports
`integrations.media=false` and every media path fails closed with a retryable
unavailable response.

Trip documents are delivery proof, so a Route Pack that requires one cannot
reach `completed` while media is unavailable. Before production cutover, verify
the exact deployment SHA, `integrations.media=true`, and a synthetic signed
upload → server read-back → authenticated delivery round trip.

Cloudinary has no active adapter, dependency, environment contract, or fallback
in LogLoads. Historical `provider: "cloudinary"` media references and
`storageProvider: "cloudinary"` trip-document metadata remain parseable only so
retained snapshots do not become structurally unreadable. Their filename, type,
and workflow metadata remains readable, but current upload, verification, and
delivery paths neither create nor activate those provider values; a forced
legacy-object delivery fails unavailable. Every `CLOUDINARY_*` and
`LOGLOADS_CLOUDINARY_*` variable must remain unset in LogLoads environments.

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
When current fee collection is enabled, billing-email delivery runs only when
both `RESEND_API_KEY` and a From identity are configured. Canonical billing
notifications remain queued when delivery is disabled. The cron worker
revalidates the related billing entity, active profile, and active
`manage_billing` membership before every send, then retries failed or stale
claims up to five times with the notification ID as the provider idempotency
key. Host-invoice notifications follow `LOGLOADS_FEE_COLLECTION`; preserved
subscription notifications remain separately gated by the historical
subscription-collection switch and are not released by fee collection alone.
