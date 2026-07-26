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
| Private media | `LOGLOADS_CLOUDINARY_TENANCY=dedicated`, `LOGLOADS_CLOUDINARY_EXPECTED_CLOUD`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — see activation sequence below |
| Email | `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_REPLY_TO`, `SUPPORT_EMAIL`, `LOGLOADS_CONTACT_EMAIL` |
| Analytics | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` |
| Errors | `SENTRY_DSN` |
| Maps | `NEXT_PUBLIC_MAPBOX_TOKEN` (keyless MapLibre fallback when absent) |

**Private media activates only when all of the following hold: the exact
non-secret tenancy marker `dedicated`; a nonblank
`LOGLOADS_CLOUDINARY_EXPECTED_CLOUD` that exactly equals the trimmed
`CLOUDINARY_CLOUD_NAME`; all three trimmed, nonblank credentials; and no other
nonblank `CLOUDINARY_*` variable at all** — SDK URL, account, proxy, OAuth,
private-CDN, secure-distribution and future ambient options are each forbidden
and each make the configuration inactive. Without that complete isolated
configuration, `/api/health` keeps its overall status tied to the operating engine but reports
`integrations.media=false`; upload signing, provider verification, photo
delivery, and trip-document delivery all return the same retryable unavailable
response before the Cloudinary SDK is loaded or a provider adapter is called.
After the gate passes, the pinned SDK singleton is fully reset before only the
three allowlisted values are applied. Trip documents are delivery proof,
so a haul whose Route Pack requires one cannot reach `completed` while media is
inactive. Treat dedicated media as required wherever hauling is live.

### The foreign-tenant deny-list

`apps/web/lib/media-config.ts` refuses a fixed set of cloud names outright. It is
checked **first — before the tenancy marker, before the credentials, before
anything** — so configuring one of these accounts fails closed with an explicit
message even when every other variable claims the setup is correct, and even when
`LOGLOADS_CLOUDINARY_EXPECTED_CLOUD` has been set to the same wrong value. The
check applies to both the configured and the expected name, and is case- and
whitespace-insensitive.

| Denied cloud name | Actual owner | Why |
|---|---|---|
| `dwiwyt9vi` | Explore & Earn | The 2026-07-17 asset census found 1020 of 1020 stored assets were Explore & Earn's. This exact value sits in `apps/web/.env.local` today under a comment calling it "sandbox creds". |

Driver credential documents are a person's licence and insurance papers. The
failure this deny-list exists to prevent is not media breaking; it is media
**working**, reporting success at every step, while writing those documents into
another product's account. `DENIED_CLOUDINARY_CLOUD_NAMES` is exported so the
list is inspectable, and the refusal names the variable, the cloud and the owner.

(Records written before uploads were wired still satisfy the completion gate,
which asks only for a document of an evidence type — but they carry no file and
are never offered for download. That residue is bounded to hauls already in
flight; no new record can be medialess.)

### Production-only Cloudinary activation

**No dedicated LogLoads Cloudinary account exists yet.** Until one does, every
step below is blocked at step 1 and media is correctly, permanently off.

1. An accountable operator provisions a **new** Cloudinary account owned for
   LogLoads alone and verifies its ownership boundary outside the application.
   Reusing an existing Automated Empires account is not an option: the estate's
   only Cloudinary account is Explore & Earn's and is on the deny-list above.
2. The operator sets all three `CLOUDINARY_*` values in the LogLoads Doppler
   project and Vercel **Production** environment while leaving both
   `LOGLOADS_CLOUDINARY_TENANCY` and `LOGLOADS_CLOUDINARY_EXPECTED_CLOUD` unset,
   and removes every other `CLOUDINARY_*` variable rather than retaining an SDK
   URL, proxy, token, or delivery-host override. Deploying in that state is safe:
   `integrations.media` stays false and media remains fail-closed.
3. The operator reads the cloud name **off the provider's own dashboard**, not off
   the credential block just pasted, and sets it as
   `LOGLOADS_CLOUDINARY_EXPECTED_CLOUD` in Vercel Production. The value exists to
   be an independent second statement of which account this is; copying it from
   the same clipboard as `CLOUDINARY_CLOUD_NAME` reproduces any mistake in both
   and defeats the check. Media is still off at this point.
4. On the exact intended production deployment, the operator rechecks that all
   three credentials resolve to the dedicated tenant, then sets the marker to
   exactly `dedicated` in Vercel Production and redeploys. Do not copy it into
   Preview or Development as a convenience.
5. Verify the deployed SHA, `integrations.media=true`, and an approved synthetic
   signed-upload → provider-read-back → authenticated-delivery round trip in the
   dedicated LogLoads namespace. If any evidence is uncertain, remove the marker
   and redeploy to return every media path to the 503 gate.

### What the runtime does and does not prove

The runtime now **checks** three things it used to only record: that the cloud
name is not a known foreign account, that two independently supplied names agree,
and that no ambient SDK variable can redirect writes after the gate passes. A
single mispasted credential block, and the one specific commingling accident this
estate has actually been one line away from, are both refused by code.

It still cannot prove **ownership**. Cloudinary exposes no way to ask "does this
account belong to LogLoads", so a brand-new account belonging to someone else
entirely would pass every check. `integrations.media=true` therefore means
*checked-and-attested* dedicated activation, not independent provider-ownership
verification, and step 1 remains a human responsibility. Record the accountable
operator and dated provider evidence at activation without recording identifiers
or secret values in the repository.

## Must not be set in production

- `LOGLOADS_ENABLE_DEV_LOGIN` — credential-free development sign-in.
- Any `CLOUDINARY_*` variable except `CLOUDINARY_CLOUD_NAME`,
  `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` — ambient SDK configuration
  disables media even when the dedicated-tenancy marker is present.
- Any deny-listed cloud name (`dwiwyt9vi`) in `CLOUDINARY_CLOUD_NAME` or
  `LOGLOADS_CLOUDINARY_EXPECTED_CLOUD`, in any environment including local
  development. This one is enforced by code rather than by policy: it refuses
  ahead of every other check and cannot be overridden by the tenancy marker.
  `apps/web/.env.local` currently violates it.
- `SUPABASE_ANON_KEY` as an operating-state credential — `operating_state` is
  explicitly service-role only.

`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `DATABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_PROJECT_REF` remain tooling/integration placeholders; runtime canonical
state does not read them.

`LOGLOADS_EMAIL_FROM` and `LOGLOADS_EMAIL_REPLY_TO` remain supported compatibility
fallbacks. Production uses the scoped `RESEND_FROM` and `RESEND_REPLY_TO` names.
