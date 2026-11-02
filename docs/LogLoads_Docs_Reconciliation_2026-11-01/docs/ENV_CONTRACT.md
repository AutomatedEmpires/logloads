# LogLoads — Production Environment Contract

> **Status:** Revised for the 2026-11-01 marketplace decision. **This is the human-readable companion** to `ops/production-env-contract.json` and `.env.example`; it does not change code or environment validation. The machine-readable file remains the source for the *currently deployed* runtime until explicitly updated and verified. Never commit credential values.

## 1. Core runtime — current pilot

| Setting | Confidentiality | Current use / caveat |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Public | Canonical origin and redirects; use the exact deploy domain |
| `LOGLOADS_SESSION_SECRET` | Server secret | Signs sessions; required in real production |
| `SUPABASE_URL` | Connection URL (not a credential) | Canonical `public.operating_state` store endpoint |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server secret** | Pilot canonical-state access and rate-limit RPC; never send to browser |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Public | Clerk frontend configuration |
| `CLERK_SECRET_KEY` | **Server secret** | Clerk server verification |
| `LOGLOADS_RATE_LIMIT_HMAC_SECRET` | **Server secret** | **Operationally required:** current caller-key code throws without it; keep independent of service-role key |

`LOGLOADS_STATE_FILE` is a nonproduction local fallback only. `LOGLOADS_ALLOW_STATE_BOOTSTRAP=true` is a controlled one-time existing-pilot bootstrap, not normal deployment configuration. `LOGLOADS_ENABLE_DEV_LOGIN` and `LOGLOADS_RATE_LIMIT_TEST_MODE` must be absent from real production.

The legacy rate-limit store may use `SUPABASE_SERVICE_ROLE_KEY` as fallback HMAC material when its own secret is absent; the separate `requestClientKey()` path **does not**. Do not document the fallback as permission to omit `LOGLOADS_RATE_LIMIT_HMAC_SECRET` in production. The rate-limit RPC and client-origin verification remain production safety controls.

## 2. Provider settings — current behavior and approved target

| Provider | Variables | Status |
|---|---|---|
| Clerk | Public key + secret key above; admin bootstrap variables below | Current identity provider; normalized v2 Clerk→Supabase JWT verification **not yet activated** |
| Supabase Storage | `LOGLOADS_MEDIA_STORAGE=supabase`, bucket/ref verification and a supported public browser project key | Current private media; server checks object ownership and signs short access |
| Resend | `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_REPLY_TO`, `SUPPORT_EMAIL`, `LOGLOADS_CONTACT_EMAIL` | Existing email code is conditional on configuration. Public delivery requires explicit authorization and test evidence |
| PostHog | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | Optional/conditional analytics, verify actual delivery and privacy |
| Sentry | `SENTRY_DSN` | Optional server error reporting; verify DSN ownership and scrubbing |
| Mapping | `NEXT_PUBLIC_MAPBOX_TOKEN` in older code | **CURRENT compatibility**, not the selected V2 target |
| Mapping target | CARTO key via verified frontend-facing variable (proposed `NEXT_PUBLIC_CARTO_BASEMAP_KEY`) | **TARGET** MapLibre + CARTO, user's reported 5M basemap requests/month. Inspect implementation before naming a required variable |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `LOGLOADS_STRIPE_EXPECTED_LIVEMODE`, `LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID` plus documented public key | Historical integration exists; **no new paid subscriptions or boosts enabled** |

Public `NEXT_PUBLIC_*` values are bundled in the browser. A CARTO basemap key is public-facing in use even if loaded from `.env.local`; scope to allowed origins, monitor usage, and keep separate dev/production keys when supported. **Do not put a Supabase service-role key or Stripe secret into `NEXT_PUBLIC_*`.**

## 3. Controlled platform-admin bootstrap — existing pilot only

The current Clerk admin claim flow may require:

- `LOGLOADS_PLATFORM_ADMIN_CLERK_IDS` — exact allowed real Clerk identity (not a wildcard).
- `LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256` — matching exact identity-scope digest.
- `LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP=enabled` and `LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT` — transient claim-only gates.

After an authorized bootstrap, disable/remove the temporary claim gates. Any normalized-v2 `platform_admins` migration must independently prove access and cannot inherit privilege merely from stale claims or user-editable token metadata.

## 4. Historical commercial gates — permanently dark for new activity

The following describe the **superseded** fee/subscription implementation: `LOGLOADS_PERCENTAGE_ENROLLMENT`, `LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS`, `LOGLOADS_PERCENTAGE_EXPECTED_ORGANIZATION_SCOPE_SHA256`, `LOGLOADS_FEE_COLLECTION`, `LOGLOADS_SUBSCRIPTION_COLLECTION`, `LOGLOADS_SUBSCRIPTION_ALLOWED_ORGANIZATION_IDS`, and `LOGLOADS_DISPATCH_SELF_SERVE`.

- Keep enrollment, fee-collection and historical self-serve gates **disabled for new business**. Presence of a Stripe key, price, customer, webhook, or settled historical invoice does not change that.
- Keep distinct frozen historic models: `percentage_v1`, `legacy_percentage`, `subscription_v1` and their signed records; do not reclassify obligations as current membership revenue or delete provider identifiers.
- Internal $1 test-smoke flags and historical Stripe `STRIPE_PRICE_DISPATCH` / `STRIPE_PRICE_NETWORK_*` catalog values exist for controlled evidence/reconciliation only. Never present them as active subscription choices.
- Production Stripe mode/account assertions must agree with actual credentials and signed webhook events.

**Approved future commercial offer, not implemented by these gates:** Landing Basic $149, Pro $299, Regional $499 monthly; 1/3/unlimited active landing locations, 2/5/10 landing seats, 3/10/30 targeted invitations per cycle; optional 7/14/28-day one-job boosts at $99/$149/$199. Haulers/fleets always free. Founding landing offer 50% for six cycles to first ten qualified companies per launched state. New payment configuration, price IDs, idempotent webhooks and renewal/cancellation terms need their **own reviewed activation contract and founder consent**. Do not repurpose `LOGLOADS_FEE_COLLECTION` or historical price variables without explicit implementation and migration review.

## 5. Service-specific historic options

- `ANTHROPIC_API_KEY`, `CREDENTIAL_REVIEW_MODEL`: legacy driver-credential provider paths. They are **not** requirements to browse job ads, express interest, or employ haulers in V2. If legacy screens remain active, inspect their fail-closed behavior before removing keys.
- `LOGLOADS_MEDIA_BUCKET`, `LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or compatibility `NEXT_PUBLIC_SUPABASE_ANON_KEY`: existing private-media integration.
- `LOGLOADS_EMAIL_FROM`, `LOGLOADS_EMAIL_REPLY_TO`: compatibility aliases when canonical Resend identity variables are absent.
- `LOGLOADS_RATE_LIMIT_KEY_PREFIX`: environment-specific shared bucket prefix.

## 6. Prohibited / review-required settings

- Never enable dev login, e2e rate-limit bypass or test fixtures on real Production/hosted Preview.
- Never include an agent's local token, private Clerk JWT, service-role key, Stripe secret, Resend key or private-site access data in Git, Chat, issue bodies or logs.
- Cloudinary is not an active LogLoads private-media provider. Legacy Cloudinary references may remain parseable only for historical records. Keep `CLOUDINARY_*` and `LOGLOADS_CLOUDINARY_*` unset.
- Do not unilaterally change DNS, live provider state, secret rotation, production database, hosted email, live checkout, or payment collection.

## 7. Reconciliation checklist

Any environment-variable change must be reconciled across actual `process.env` readers, `.env.example`, `ops/production-env-contract.json`, `docs/ENVIRONMENT.md`, this document, Vercel/Doppler secret ownership and controlled preview smoke tests. Verify secret classification, absence/fail-closed behavior and safe log redaction. Documentation alone never proves an environment variable is implemented.
