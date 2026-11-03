# LogLoads — Production Environment Contract

> **Status:** Revised 2026-11-01 for the load-board decision. This is the human-readable companion to
> [`ops/production-env-contract.json`](../ops/production-env-contract.json), which is the machine-readable
> source. It does not change code or runtime validation. Local setup and provider guidance live in
> [`ENVIRONMENT.md`](./ENVIRONMENT.md).
>
> Values live in Doppler and Vercel. Never commit values. The Supabase service-role key and all secrets stay
> server-only.
>
> *What changed in this revision:*
> - The `percentage_v1` billing rules are reclassified as **historical**.
> - The required rate-limit HMAC secret is recorded.
> - The V2 preview flag is added.
>
> The technical fail-closed rules are unchanged from `15892b7`.

## 1. Required to boot and serve production

| Variable | Secret | Absent behavior |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | no | Production Stripe checkout/portal creation fails closed |
| `LOGLOADS_SESSION_SECRET` | yes | Session signing fails closed |
| `SUPABASE_URL` | no | Canonical-state reads fail closed |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Canonical-state reads fail closed |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | no | Real public auth is unavailable |
| `CLERK_SECRET_KEY` | yes | Server session verification is unavailable |
| `LOGLOADS_RATE_LIMIT_HMAC_SECRET` | yes | `requestClientKey()` throws (`apps/web/lib/rate-limit-client-key.ts`), so rate-limited routes fail. Listed as `required: true` in the JSON contract. |

- The distributed store (`rate-limit-config.ts`) falls back to the service-role key for **its own** key
  material. That fallback does **not** remove the caller-key requirement, so do not treat it as permission to
  omit the dedicated secret.
- `LOGLOADS_RATE_LIMIT_KEY_PREFIX` namespaces buckets per environment.
- `LOGLOADS_STATE_FILE` is a non-production convenience. It is neither required nor authoritative on Vercel.

## 2. Credential review (legacy pilot gate)

| Variable | Secret | Absent behavior |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Every submitted driver credential stays pending, so no driver can accept a pilot load |

This gate belongs to the **legacy pilot's** assignment eligibility. It is not a requirement for browsing V2
jobs or expressing interest.

- `CREDENTIAL_REVIEW_MODEL` may override the pinned `claude-opus-5` default. Changing the model needs a
  controlled re-verification of structured output, document reading, latency, and refusal behavior.
- `/api/health` reports `integrations.credentialReview=false` while the key is absent.
- Before removing the key, inspect the fail-closed behavior of any legacy screen that is still active.

## 3. Controlled bootstrap

### Canonical state

`LOGLOADS_ALLOW_STATE_BOOTSTRAP=true` permits creating the singleton canonical row when it is absent. Use it
only after an operator proves the table is intentionally empty, and remove it immediately afterwards. Without
it, production fails closed instead of silently replacing missing data with seed data.

### Founder platform access

The step-by-step procedure is in [`ACTIVATION_CLERK.md`](./ACTIVATION_CLERK.md) §3.

- `LOGLOADS_PLATFORM_ADMIN_CLERK_IDS` must canonicalize to exactly one real Clerk `user_...` ID. The seeded
  `clerk-admin-1` placeholder, a wildcard, multiple IDs, or a malformed entry fails closed.
- `LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256` is the exact lowercase SHA-256 of
  `logloads-platform-admin-scope-v1`, one newline, and that ID. It is compared byte-for-byte.
- `LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP=enabled`, together with a strict future
  `LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT`, permits a one-time claim at `/admin/bootstrap`.

After a verified claim, set the gate to `disabled` and remove the expiry. Keep the persistent ID and digest:
they remain required for ongoing admin authority.

## 4. Feature-gated variables

| Group | Variables |
|---|---|
| Marketplace V2 preview | `LOGLOADS_MARKETPLACE_V2`. Exactly `enabled` turns on `/v2`, which is always off when `VERCEL_ENV=production`. **Must be unset in Production.** Do not set it on hosted Preview without an approved, isolated preview ([`DEPLOYMENT.md`](./DEPLOYMENT.md) §4). Listed, unset, in `.env.example`. Not yet in the JSON contract (#111). |
| Maps | `NEXT_PUBLIC_CARTO_BASEMAP_KEY` — preferred: authenticated CARTO Basemaps on MapLibre. Browser-visible; restrict it by origin. The legacy `NEXT_PUBLIC_MAPBOX_TOKEN` is used only when no CARTO key is set; keyless CARTO when neither is. |
| Billing provider | `STRIPE_SECRET_KEY`, `LOGLOADS_STRIPE_EXPECTED_LIVEMODE`, `LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` |
| Historical Dispatch Pro catalog | `STRIPE_PRICE_DISPATCH` — read-only reconciliation, no new enrollment |
| Historical Network recurring catalog | `STRIPE_PRICE_NETWORK_PILOT`, `STRIPE_PRICE_NETWORK_25`, `STRIPE_PRICE_NETWORK_50`, `STRIPE_PRICE_NETWORK_100` |
| Historical Network overage catalog | `STRIPE_PRICE_NETWORK_PILOT_OVERAGE`, `STRIPE_PRICE_NETWORK_25_OVERAGE`, `STRIPE_PRICE_NETWORK_50_OVERAGE`, `STRIPE_PRICE_NETWORK_100_OVERAGE` |
| Internal billing verification | `STRIPE_PRICE_INTERNAL_BILLING_TEST`, `LOGLOADS_INTERNAL_BILLING_SMOKE`, `LOGLOADS_INTERNAL_BILLING_SMOKE_ALLOWED_USER_IDS`, `LOGLOADS_INTERNAL_BILLING_SMOKE_ALLOWED_ORGANIZATION_IDS` |
| Founder platform access | Persistent `LOGLOADS_PLATFORM_ADMIN_CLERK_IDS` and `LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256`; temporary, claim-only `LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP` and `LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT` |
| Historical percentage enrollment | `LOGLOADS_PERCENTAGE_ENROLLMENT`, `LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS`, `LOGLOADS_PERCENTAGE_EXPECTED_ORGANIZATION_SCOPE_SHA256` — **disabled / blank** |
| Historical collection switches | `LOGLOADS_FEE_COLLECTION`, `LOGLOADS_SUBSCRIPTION_COLLECTION`, `LOGLOADS_SUBSCRIPTION_ALLOWED_ORGANIZATION_IDS`, `LOGLOADS_DISPATCH_SELF_SERVE` — **disabled / blank** |
| Credential review | `ANTHROPIC_API_KEY`; optional pinned override `CREDENTIAL_REVIEW_MODEL` (§2) |
| Private media | `LOGLOADS_MEDIA_STORAGE=supabase`, `LOGLOADS_MEDIA_BUCKET`, `LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF`, and the preferred `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — or the compatibility alias `NEXT_PUBLIC_SUPABASE_ANON_KEY`; the preferred name wins when both exist |
| Email | `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_REPLY_TO`, `SUPPORT_EMAIL`, `LOGLOADS_CONTACT_EMAIL` |
| Analytics | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` |
| Errors | `SENTRY_DSN` |

## 5. Commercial gates — historical, dark for all new activity

**Current model.** Blueprint v1.0 is the current commercial model:

| Plan | Price |
|---|---|
| Basic | $149 |
| Pro | $299 |
| Regional | $499 |

Plus boosts and the founding offer. It is **not implemented by any variable in this document** and is not
active. Its activation will need new, separately reviewed variables and a new Stripe catalog
([`ACTIVATION_STRIPE.md`](./ACTIVATION_STRIPE.md)). **Never repurpose the gates below to activate it.**

**The `percentage_v1` model (2026-08-01 to 2026-11-01) is historical.** So are `legacy_percentage` and
`subscription_v1`. The gates that governed them stay `disabled`, and their allowlists and assertions stay
blank. They still protect existing records:

- **`LOGLOADS_FEE_COLLECTION`.** When it is absent, invalid, or disabled, the app may maintain historical
  fee, invoice, and reconciliation records but creates no provider charge. It applies to `percentage_v1`
  invoices and to invoices preserved from frozen `legacy_percentage` assignments, and the billing-model
  snapshot keeps those ledgers distinct. Provider credentials, webhooks, deployed code, accepted terms, and
  catalog objects never switch it on.
- **Percentage enrollment.** Enrollment requires `LOGLOADS_PERCENTAGE_ENROLLMENT=enabled`, the exact
  organization ID in the allowlist, and a matching SHA-256 scope assertion. A wildcard `*` is not recognized.
  Enrollment does not enable collection, and collection does not enroll anyone. **Do not enroll anyone:** the
  model is superseded.
- **Subscription gates.** `LOGLOADS_SUBSCRIPTION_COLLECTION` and `LOGLOADS_DISPATCH_SELF_SERVE` stay
  `disabled`, and `LOGLOADS_SUBSCRIPTION_ALLOWED_ORGANIZATION_IDS` stays empty. These closed gates keep signed
  reconciliation for obligations accepted under the 2026-07-28 decision. They never create a customer,
  Checkout session, subscription, usage, overage, or charge.
- **One obligation per movement.** A physical movement produced at most one obligation: one `percentage_v1`,
  one preserved `legacy_percentage`, or one historical `subscription_v1`. No new obligation may be created.

### Stripe mode and tenancy

`LOGLOADS_STRIPE_EXPECTED_LIVEMODE` is mandatory and independent of whether a key is present: `live` in
production, `test` in controlled runtimes. All of the following must agree with it or fail closed:

- key prefixes;
- signed event `livemode`;
- catalog objects;
- portal and card operations;
- invoices;
- the smoke check.

`LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID` is a server-side tenancy assertion. These callers check
`GET /v1/account` against it and fail closed on a mismatch:

- Checkout;
- webhooks;
- scheduled collection;
- the catalog provisioner;
- the lifecycle verifier.

No error or tool output includes either account ID.

### Internal $1 smoke

A one-off provider invoice, never a subscription. It requires all of:

- `LOGLOADS_INTERNAL_BILLING_SMOKE=enabled`;
- the owner's canonical user ID in the user allowlist;
- the exact internal organization ID in the organization allowlist;
- `STRIPE_PRICE_INTERNAL_BILLING_TEST`;
- an unused smoke record;
- an explicit confirmation phrase.

Leave all of these unset outside one founder-authorized run. Internal tests are excluded from commercial
metrics.

### Historical catalog variables

Every historical catalog variable holds only a pre-created `price_...` ID. Requests never create Products or
Prices. The catalog exists only to reconcile prior obligations.

### Health route

The public health route reports only:

- coarse billing readiness;
- gate state;
- a boolean for the enrollment-scope match.

It never reveals keys, price or customer IDs, digests, or webhook material.

## 6. Private media rules

Private media is active only when all of the following hold:

- `LOGLOADS_MEDIA_STORAGE` is exactly `supabase`;
- `SUPABASE_URL` is HTTPS on `*.supabase.co`;
- its project reference equals `LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF`;
- the service-role key and a browser key from the same project are present;
- the bucket name is valid.

The production bucket is private, limited to 10,000,000 bytes, and accepts JPEG, PNG, and WebP.

**Upload and delivery path:**

1. The browser gets a short-lived token for one generated object path and uploads with upsert disabled.
2. The server reads the object back and validates its size, type, and dimensions before committing.
3. Delivery uses five-minute signed URLs, issued after authorization.

If any part of the configuration is wrong, `/api/health` reports `integrations.media=false` and every media
path fails closed with a retryable unavailable response.

Legacy pilot route packs that require a trip document cannot reach `completed` while media is unavailable.

**Cloudinary.** Cloudinary has no active adapter, dependency, or fallback. Historical
`provider: "cloudinary"` references stay parseable only so retained snapshots remain readable; forced legacy
delivery fails unavailable. Every `CLOUDINARY_*` and `LOGLOADS_CLOUDINARY_*` variable must stay unset.

## 7. Must not be set in production

- `LOGLOADS_ENABLE_DEV_LOGIN` — credential-free development sign-in.
- `LOGLOADS_RATE_LIMIT_TEST_MODE` — the local Playwright bypass.
- `LOGLOADS_MARKETPLACE_V2` — the code ignores it in production anyway. Keep it unset so intent is clear.
- Any `CLOUDINARY_*` or `LOGLOADS_CLOUDINARY_*` variable.
- `SUPABASE_ANON_KEY` as an operating-state credential. `operating_state` is service-role only.

`DATABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_PROJECT_REF` are tooling and integration placeholders.
Runtime canonical state does not read them.

`.env.example` also lists `NEXT_PUBLIC_MAP_PROVIDER`, `NOTIFICATION_PROVIDER`,
`NEXT_PUBLIC_NOTIFICATION_PROVIDER`, and `VERCEL_TOKEN`. No application code reads any of them at `4c9518e`, and
each is annotated as such in `.env.example`. Removing them is left to the implementation owner (#111).

## 8. Email identity

- `LOGLOADS_EMAIL_FROM` and `LOGLOADS_EMAIL_REPLY_TO` are supported compatibility fallbacks. Production uses
  `RESEND_FROM` and `RESEND_REPLY_TO`.
- Historical billing notifications form an outbox. Queued rows are sent only when the matching historical
  collection gate is enabled **and** Resend is configured, so with the gates disabled they stay queued.
- Before every send, the cron worker revalidates:
  - the billing entity;
  - the active profile;
  - the `manage_billing` membership.

  It retries failed or stale claims up to five times, using the notification ID as the idempotency key.

## 9. Reconciliation rule

Any environment-variable change must be reconciled across all of these together:

- the `process.env` readers;
- `.env.example`;
- `ops/production-env-contract.json`;
- this document and [`ENVIRONMENT.md`](./ENVIRONMENT.md);
- Vercel/Doppler ownership.

Verify the secret classification, the absent and fail-closed behavior, and log redaction. Documentation
alone never proves a variable is implemented.
