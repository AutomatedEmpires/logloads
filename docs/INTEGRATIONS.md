# LogLoads — Fresh-Start Integration Runbook

> **Status:** Written 2026-11-03 for the fresh start. Every earlier LogLoads provider project (Supabase, Clerk,
> Stripe, Resend, PostHog, Sentry, Vercel) was deleted, so every key is new. The tools named here exist in the
> repository and are unit-tested offline; none of them has been run against a provider yet.
>
> This runbook authorizes nothing by itself. Steps marked **Owner:** are done by the founder in a provider
> dashboard or with the founder's credentials. Production steps also need the founder's explicit
> authorization ([`DEPLOYMENT.md`](./DEPLOYMENT.md), [`ACTIVATION_STRIPE.md`](./ACTIVATION_STRIPE.md) §5).

## 0. How to use this runbook

**Order.** Do staging end to end first, then production only when it is authorized:

1. Doppler (§1)
2. Supabase staging project, migrations, bucket (§2.1–§2.4). **If the normalized-V2 proof (step 6) may ever run
   on this project, apply its schema (§15.1–§15.2) after §2.2 and before the migrations in §2.3.** The reverse
   order cannot be repaired later without an owner decision (§15.1). §15.1 needs the Clerk development instance's
   issuer, so create that instance (§3) first.
3. Clerk development instance (§3)
4. Vercel project, Doppler sync, first Preview, canonical-state bootstrap (§5, §2.5)
5. Optional, all dark by default: Stripe test mode (§6), Resend (§7), PostHog (§8), Sentry (§9), maps (§10)
6. Optional, staging only: the normalized store (V2) proof (§15). Its schema step comes before §2.3 (step 2).
7. Production (§13), with the founder's authorization

**Verify after every step** with the readiness check. It reads the environment, prints only variable names and
verdicts, never values, and takes its variable lists from `ops/production-env-contract.json`:

```bash
doppler run --project logloads --config stg -- pnpm integrations:check --target staging          # report
doppler run --project logloads --config stg -- pnpm integrations:check --target staging --strict # exit 1 until ready
pnpm integrations:check --list                                                                   # every variable, by integration and Doppler config
```

Each integration is reported as **READY**, **NOT READY** (with the missing names), **INVALID** (a consistency check
failed: wrong project ref, test key on production, a secret under `NEXT_PUBLIC_`, …) or **OFF** (deliberately
inactive and optional for that target). §12 lists every verification command.

**Never paste a value** into an issue, a chat, a commit, a screenshot or a command line that is logged. Use
`doppler secrets set NAME --project logloads --config <config>`; with only a name it prompts for the value.

**Free tiers.** Every step fits each provider's free plan. Limits below are as of this writing; check the
provider's pricing page. This runbook never needs a paid upgrade.

## 1. Doppler

Doppler holds every value. Configs map to targets:

| Doppler config | `--target` | Vercel environment | Notes |
|---|---|---|---|
| `dev` | `local` | none (never synced) | Optional local provider keys. Local development normally needs none: `pnpm setup:local` writes `apps/web/.env.local`. |
| `stg` | `preview`, `staging` | Preview | Synced to Vercel Preview. Staging has its own Supabase project. |
| `prd` | `production` | Production | Synced to Vercel Production. Live keys only after explicit authorization. |

1. **Owner:** confirm the project `logloads` has the configs `dev`, `stg` and `prd` (free Developer plan).
2. **Owner:** install the Doppler CLI, then `doppler login` and, in the repository root, `doppler setup`
   (project `logloads`, config `dev`). If the CLI is not on `PATH`, set `DOPPLER_CLI` to its full path for the
   tools below.
3. Verify: `doppler run --project logloads --config stg -- pnpm integrations:check --target staging` lists what
   is still missing.

**Session and rate-limit secrets** (`LOGLOADS_SESSION_SECRET`, `LOGLOADS_RATE_LIMIT_HMAC_SECRET`) and
`CRON_SECRET` are generated into `stg` and `prd` by the provisioning tool in §2.2 when they are absent. It also
writes the dark defaults: `LOGLOADS_FEE_COLLECTION`, `LOGLOADS_PERCENTAGE_ENROLLMENT`,
`LOGLOADS_SUBSCRIPTION_COLLECTION`, `LOGLOADS_DISPATCH_SELF_SERVE` and `LOGLOADS_INTERNAL_BILLING_SMOKE` all
`disabled`, `LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP=disabled`, `LOGLOADS_RATE_LIMIT_KEY_PREFIX=logloads:<config>`, and
`LOGLOADS_STRIPE_EXPECTED_LIVEMODE` (`test`, or `live` for `prd`). It never replaces a value that already exists.

## 2. Supabase

One Supabase project per hosted environment: `logloads-staging` (`stg`) and, when authorized,
`logloads-production` (`prd`). The free plan allows two active projects per organization, which is exactly
these two. Local development uses the JSON store or the local stack (`supabase/config.toml`), never a hosted
project ([`ENVIRONMENT.md`](./ENVIRONMENT.md) §2).

Free-plan limits to know: a project pauses after a week without activity (restore it from the dashboard), and
the database (500 MB) and file storage (1 GB) are small. The private bucket's 10 MB per-file limit fits.

### 2.1 Organization and management token

1. **Owner:** create (or reuse) a Supabase organization on the free plan.
2. **Owner:** create a personal access token (Account → Access Tokens). It can manage every project in the
   account, so keep it out of `stg` and `prd` (they sync to Vercel). Store it in the unsynced `dev` config for
   the provisioning run only:

   ```bash
   doppler secrets set SUPABASE_ACCESS_TOKEN --project logloads --config dev
   ```

   The readiness check marks `SUPABASE_ACCESS_TOKEN` INVALID on any hosted target.

### 2.2 Create the project and write its settings (one command)

`tools/provision-supabase-project.mjs` creates the project through the Management API, waits until it is
healthy, and writes its settings into Doppler without printing any value. It is a **dry run by default**.

```bash
# Plan (read-only preflight: organization, existing project, Doppler names):
doppler run --project logloads --config dev -- pnpm supabase:provision --name logloads-staging --region us-east-1 --doppler-config stg
# Owner: act.
doppler run --project logloads --config dev -- pnpm supabase:provision --name logloads-staging --region us-east-1 --doppler-config stg --apply
```

What `--apply` does, in order:

1. Generates the database password and saves it to Doppler as `SUPABASE_DB_PASSWORD` **before** creating the
   project, so it cannot be lost.
2. Creates the project in `us-east-1` (Vercel's default function region is Washington, D.C., so latency stays
   low) on the organization's plan, and waits for `ACTIVE_HEALTHY`. An existing project with the same name is
   reused only when its password is already in Doppler; a config that already points at another project is
   never repointed.
3. Writes `SUPABASE_URL`, `LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF`, `SUPABASE_SERVICE_ROLE_KEY` (the legacy
   `service_role` JWT, which the app sends as `Authorization: Bearer`) and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   to `stg`, and the tooling values `DATABASE_URL` (session pooler, port 5432) and `SUPABASE_PROJECT_REF`.
4. Generates the secrets and writes the dark defaults listed in §1, only where absent.

Options: `--organization <slug>` when the token sees several organizations; `--tooling-config <config>` to keep
`SUPABASE_DB_PASSWORD`, `DATABASE_URL` and `SUPABASE_PROJECT_REF` out of the config that syncs to Vercel (for
example a Doppler branch config `stg_tooling`, created first with `doppler configs create stg_tooling --project
logloads`; a branch config inherits every `stg` value and is not synced). Without it they sit in `stg` and reach
Vercel, where the app never reads them.
`prd` is refused unless `--allow-production` is given.

**Owner:** afterwards, delete the token from `dev` (`doppler secrets delete SUPABASE_ACCESS_TOKEN --project
logloads --config dev`) and revoke it in Supabase.

Verify: `doppler run --project logloads --config stg -- pnpm integrations:check --target staging` shows
`supabase-api`, `supabase-storage` and `supabase-db` READY.

### 2.3 Apply the migrations

`supabase db push` applies `supabase/migrations/*.sql` in order (the pilot ledger,
[`DEPLOYMENT.md`](./DEPLOYMENT.md) §3). It does not apply `supabase/seed/` or `architecture/normalized-v2/`.
**If the normalized-V2 proof may run on this project, deploy the normalized store first (§15.1, §15.2).** These
migrations install PostGIS in `public` when it is missing, and the normalized schema needs it in `extensions`.
**Owner:** install the Supabase CLI (or set `SUPABASE_CLI` to its path), then:

```bash
doppler run --project logloads --config stg -- pnpm supabase:post-provision migrations          # dry run: lists pending files
doppler run --project logloads --config stg -- pnpm supabase:post-provision migrations --apply  # Owner: apply
```

Use `--config stg_tooling` instead if you chose a tooling config in §2.2. The CLI's output is re-printed with the
connection string redacted. The connection string is passed to the CLI on its command line, which is visible to
other processes on your machine while it runs.

### 2.4 Create the private media bucket

The bucket `logloads-private-media` must be private, limited to 10,000,000 bytes, and accept JPEG, PNG and WebP
only ([`ENV_CONTRACT.md`](./ENV_CONTRACT.md) §6). Before this kit it was created by hand in the dashboard.

```bash
doppler run --project logloads --config stg -- pnpm supabase:post-provision bucket          # verify (read-only)
doppler run --project logloads --config stg -- pnpm supabase:post-provision bucket --apply  # Owner: create or align
```

### 2.5 Bootstrap the canonical state (once, after the first deployment)

A fresh project has the `operating_state` table but no canonical row, so `/api/health` answers `503` and every
page fails closed. The app creates the row itself, from its synthetic seed (which includes the seed admin
profile the founder later claims), on the first request after `LOGLOADS_ALLOW_STATE_BOOTSTRAP=true` is deployed.
This is deliberate: without the flag, production never silently replaces missing data with seed data.

1. Prove the row is intentionally absent:
   `doppler run --project logloads --config stg -- pnpm supabase:post-provision state` prints "canonical row is
   absent".
2. **Owner:** `doppler secrets set LOGLOADS_ALLOW_STATE_BOOTSTRAP --project logloads --config stg` (value `true`),
   let Doppler sync, and redeploy the staging Preview (Vercel → Deployments → Redeploy).
3. Make the first request and verify in one command:
   `doppler run --project logloads --config stg -- pnpm integrations:check --target staging --health-url https://<staging-origin>`.
4. **Owner:** delete the flag (`doppler secrets delete LOGLOADS_ALLOW_STATE_BOOTSTRAP --project logloads --config stg`)
   and redeploy. The readiness check warns while it is set.
5. `pnpm supabase:post-provision state` (under `doppler run`) now prints "canonical row present (version 0 …)".
   Back it up with `tools/operating-state-backup.mjs` ([`RECOVERY.md`](./RECOVERY.md)).

The seed is synthetic. Never present it as real activity. On production this step is a production operation.

### 2.6 Project settings

- **Auth:** Clerk is the identity provider; Supabase Auth is unused. **Owner:** in Authentication → Sign In /
  Providers, turn off "Allow new users to sign up", because the publishable key is browser-visible.
- **Clerk third-party auth:** not configured today. The pilot never sends Clerk tokens to Supabase. It becomes
  relevant only for the normalized-V2 proof, on the staging project first
  ([`ACTIVATION_CLERK.md`](./ACTIVATION_CLERK.md) §4). When that is scheduled, **Owner:** Clerk → Integrations → Supabase →
  activate and copy the Clerk domain; Supabase → Authentication → Sign In / Providers → Third-party auth → Clerk →
  paste the domain. The one-command check is `tools/verify-clerk-supabase-auth.mjs`
  ([`SECURITY.md`](./SECURITY.md) §5.1); **Owner:** it reads `LOGLOADS_SUPABASE_DEV_PROJECT_REFS` (the project refs
  it may touch) and `LOGLOADS_AUTH_HARNESS_CLERK_USER_IDS` (two development-instance test users) from `dev` only.
- **Data API:** **Owner:** keep it enabled with the `public` schema exposed. The app reads `operating_state` and calls
  `consume_rate_limit` through it with the service-role key.
- Confirm everything with `doppler run --project logloads --config stg -- pnpm supabase:post-provision check`.

## 3. Clerk

One Clerk application, **LogLoads**, with its development instance for `dev`/`stg` and its production instance
for `prd`. Clerk's free plan covers both. LogLoads keeps organizations and roles itself, so Clerk Organizations,
Clerk roles and webhooks are not needed ([`ACTIVATION_CLERK.md`](./ACTIVATION_CLERK.md) §2).

1. **Owner:** create the application with email sign-in (add social providers later if wanted; a production
   social provider needs its own OAuth credentials).
2. **Owner:** store the development instance keys in `stg` (and in `dev` if you want Clerk locally):
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (`pk_test_…`) and `CLERK_SECRET_KEY` (`sk_test_…`).
3. **Owner:** store the paths so Clerk's own links stay on the app's pages:
   `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`,
   `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/onboarding`,
   `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/onboarding`. They are browser-visible, so changing them needs
   a rebuild.
4. **Origins and redirects.** A development instance accepts any origin (`localhost`, `*.vercel.app`), so no
   allowed-origin or redirect entry is needed for staging. The app's sign-in and sign-up pages redirect to their
   own paths on the same origin, so the redirect-URL allowlist stays empty.
5. **Production (§13). Owner:** the production instance needs the domain `logloads.com` and the DNS records Clerk lists
   under Domains. Its keys (`pk_live_…`, `sk_live_…`) go only in `prd`. Do not add staging or preview origins to
   the production instance.
6. **Owner:** founder platform admin. After Clerk works, follow [`ACTIVATION_CLERK.md`](./ACTIVATION_CLERK.md) §3 to set
   `LOGLOADS_PLATFORM_ADMIN_CLERK_IDS`, `LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256`, and for one claim window
   `LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP` with `LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT`. The readiness check
   recomputes the digest and fails on a mismatch, without printing either value.

Verify: the readiness check shows `clerk` READY and refuses a `pk_live_` key on staging or a `pk_test_` key on
production, and mismatched test/live pairs. After deployment, `/api/health` reports `integrations.auth: "clerk"`.

## 4. Local development

Local work needs no provider: `pnpm setup:local` writes `NEXT_PUBLIC_APP_URL` and the two local secrets into the
git-ignored `apps/web/.env.local`, and the app uses the JSON store and seeded sign-in
([`ENVIRONMENT.md`](./ENVIRONMENT.md)). Check it with
`pnpm integrations:check --target local --env-file apps/web/.env.local`.

Optional local keys go in `dev`: Clerk development keys, a dev CARTO key, Stripe test keys, and
`LOGLOADS_MARKETPLACE_V2=enabled` for the `/v2` preview. Run with `doppler run --project logloads --config dev -- pnpm dev`.

## 5. Vercel

1. **Owner:** on the free Hobby plan, import the GitHub repository `AutomatedEmpires/logloads` as a new project.
   Vercel's terms limit Hobby to non-commercial use; check them before a commercial production launch.
2. **Owner:** project settings:

   | Setting | Value |
   |---|---|
   | Root Directory | `apps/web`, with "Include files outside the root directory in the Build Step" on |
   | Framework Preset | Next.js |
   | Build Command | the default Vercel proposes for this Turborepo (`turbo run build`) |
   | Output Directory | default |
   | Install Command | default (pnpm, from the root lockfile and the `packageManager` field) |
   | Node.js Version | 24.x (also required by `engines` in `package.json`) |
   | Production Branch | `main` (merges to `main` deploy production) |

   Vercel reads `vercel.json` from the Root Directory, so the cron lives in `apps/web/vercel.json` (it was at the
   repository root, where Vercel never read it). If the build log shows a pnpm version other than 10.12.4,
   add `ENABLE_EXPERIMENTAL_COREPACK=1` to the Vercel project.
3. **Owner:** Doppler → project `logloads` → Integrations → Vercel: sync `stg` to **Preview** and `prd` to
   **Production**. Do not sync `dev`. Vercel applies variables at build time and inlines every `NEXT_PUBLIC_`
   value into the browser bundle, so **redeploy after each change**.
4. **Preview protection:** keep Settings → Deployment Protection → Vercel Authentication on (the default, it
   protects Preview deployments). For scripted checks of a protected Preview, enable Protection Bypass for
   Automation and export its secret as `VERCEL_AUTOMATION_BYPASS_SECRET` in your shell only; the readiness probe
   sends it.
5. **V2 flag. Owner:** set `LOGLOADS_MARKETPLACE_V2=enabled` only in `stg`, and only when the
   [`DEPLOYMENT.md`](./DEPLOYMENT.md) §4 gates hold. Never in `prd`: the readiness check marks it INVALID there
   (the code also ignores it when `VERCEL_ENV=production`). The V2 store stays the pilot store unless the
   normalized-V2 proof is scheduled on staging: then `LOGLOADS_MARKETPLACE_V2_ADAPTER=normalized`,
   `LOGLOADS_NORMALIZED_DATABASE_URL` (a restricted login role, secret), `LOGLOADS_NORMALIZED_IDENTITY_ISSUER` and
   `LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE` go in `stg` only ([`SECURITY.md`](./SECURITY.md) §4.1), after the
   store is deployed (§15), with the optional `LOGLOADS_NORMALIZED_IDENTITY_SYNC_DATABASE_URL` (a second restricted
   login role, secret) to link first sign-ins. Never in `prd`; the readiness check marks them INVALID there.
6. **Cron:** `apps/web/vercel.json` schedules `/api/billing/cron` daily at 05:15 UTC (Hobby allows daily jobs,
   run within the hour). Vercel runs crons on Production deployments only and sends `CRON_SECRET` as a bearer
   token. The route stays dark while the historical gates are disabled.
7. **App origin. Owner:** set `NEXT_PUBLIC_APP_URL=https://logloads.com` in `prd` only when the domain is attached.
   Preview deployments may leave it unset (`VERCEL_URL` is used). For a stable staging URL, use the branch alias
   Vercel assigns to the staging branch.

Verify: `doppler run --project logloads --config stg -- pnpm integrations:check --target staging --health-url https://<preview-origin>`
compares the deployment's `/api/health` with the environment, and probes the cron route without credentials (a
`401` proves `CRON_SECRET` is configured).

## 6. Stripe

Billing stays **dark**: no Blueprint plan or boost exists in code, and the historical gates stay `disabled`
([`ACTIVATION_STRIPE.md`](./ACTIVATION_STRIPE.md)). Stripe is optional on every target; with no Stripe
credential the readiness check reports it OFF and `/api/health` reports `billing: "misconfigured"`.

1. **Owner:** create the Stripe account and work in test mode (no monthly fee).
2. **Owner:** store in `stg` (and `dev` if wanted): `STRIPE_SECRET_KEY` (`sk_test_…`; restricted `rk_` keys are refused by
   the runtime mode check), `STRIPE_PUBLISHABLE_KEY` (`pk_test_…`), `LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID` (the
   `acct_…` id from Settings → Business → Account details) and `LOGLOADS_STRIPE_EXPECTED_LIVEMODE=test`.
3. **Webhook, only when a test-mode billing exercise is scheduled. Owner:** Developers → Webhooks → Add endpoint
   `https://<staging-origin>/api/billing/webhook` with the events the app handles
   (`HANDLED_BILLING_EVENT_TYPES` in `apps/web/lib/billing.ts`): `charge.refunded`,
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.deleted`,
   `customer.subscription.updated`, `invoice.payment_failed`, `invoice.payment_succeeded`,
   `payment_method.detached`, `refund.updated`, `setup_intent.succeeded`. Store the signing secret (`whsec_…`) as
   `STRIPE_WEBHOOK_SECRET`. A protected Preview refuses Stripe's deliveries unless the endpoint URL carries
   Vercel's automation bypass parameter.
4. **Catalog: there is no catalog step. Never run `tools/provision-stripe-catalog.mjs` with `--apply`**, on
   any account or mode. That tool creates only the **historical** subscription catalog, which
   [`ACTIVATION_STRIPE.md`](./ACTIVATION_STRIPE.md) §2 forbids provisioning. Its dry run (no `--apply`) only
   prints that catalog and makes no provider call; its closing note suggests re-running with `--apply`, so ignore
   that note. A fresh account has no historical obligation to reconcile, so leave every `STRIPE_PRICE_*` and
   `STRIPE_PORTAL_CONFIGURATION_NETWORK` unset. The Blueprint catalog needs its own reviewed change.
5. **Production. Owner:** live keys, `LOGLOADS_STRIPE_EXPECTED_LIVEMODE=live` and a live webhook only after explicit
   founder authorization ([`ACTIVATION_STRIPE.md`](./ACTIVATION_STRIPE.md) §5).

Verify: the readiness check compares each key's test/live prefix with `LOGLOADS_STRIPE_EXPECTED_LIVEMODE` and the
target, and checks the `whsec_` and `acct_` shapes. The runtime also checks the account against `GET /v1/account`.

## 7. Resend

Optional; without `RESEND_API_KEY` email is skipped and in-app records stay the source of truth
([`ACTIVATION_RESEND.md`](./ACTIVATION_RESEND.md)). The free plan allows one domain and a small daily volume.

1. **Owner:** create the account, add the domain `logloads.com`, and add the DNS records Resend shows (SPF and
   bounce MX on the `send` subdomain, the DKIM TXT record). Wait until it shows Verified.
2. **Owner:** create one API key per environment with **Sending access** restricted to `logloads.com`. Store it
   as `RESEND_API_KEY` in `stg` (controlled test recipients only); the production key only after authorization.
3. **Owner:** store the identities in `stg` and `prd`: `RESEND_FROM="LogLoads <notifications@logloads.com>"`,
   `RESEND_REPLY_TO=support@logloads.com`, `SUPPORT_EMAIL=support@logloads.com`,
   `LOGLOADS_CONTACT_EMAIL=support@logloads.com`.

Verify: the readiness check needs a `re_` key and a From identity, and warns when the sender is not
`@logloads.com`. Delivery itself is proven only by Resend's event log ([`ACTIVATION_RESEND.md`](./ACTIVATION_RESEND.md) §3).

## 8. PostHog

Optional; inert without a key ([`OBSERVABILITY.md`](./OBSERVABILITY.md) §1). The free plan includes a generous
monthly event allowance.

1. **Owner:** create one PostHog Cloud project for LogLoads (US or EU region).
2. **Owner:** store its **project** API key (`phc_…`) as `NEXT_PUBLIC_POSTHOG_KEY` in `prd`, and set
   `NEXT_PUBLIC_POSTHOG_HOST` to the project's ingestion host (`https://us.i.posthog.com` or
   `https://eu.i.posthog.com`). Never a personal API key (`phx_…`): the value ships to every browser, and the
   readiness check marks it INVALID. Leave PostHog unset in `dev` and `stg` so test traffic stays out.

## 9. Sentry

Optional; Sentry is never imported without a DSN ([`OBSERVABILITY.md`](./OBSERVABILITY.md) §2).

1. **Owner:** on the free Developer plan, create a project with platform Next.js.
2. **Owner:** store its DSN (Project Settings → Client Keys) as `SENTRY_DSN` in `prd`. Events are tagged with `NODE_ENV`,
   which is `production` on every Vercel deployment, so use a separate Sentry project if you also want staging
   errors.
3. **Source-map token: not needed.** The build does not upload source maps (`next.config.ts` is not wrapped with
   `withSentryConfig`), so no Sentry auth token is read. Do not create one until a reviewed change adds the
   upload.

## 10. Maps

No setup is required: without keys the map uses keyless CARTO on MapLibre. A CARTO key is optional, browser-visible,
and its allowance is unverified (#114). **Owner**, if you create one: restrict it by origin, keep separate dev and prod
keys, and store it as `NEXT_PUBLIC_CARTO_BASEMAP_KEY`. The legacy `NEXT_PUBLIC_MAPBOX_TOKEN` is used only without
a CARTO key; the readiness check refuses a secret (`sk.`) Mapbox token.

## 11. Anthropic

Optional and outside the fresh-start scope. `ANTHROPIC_API_KEY` powers the legacy pilot's credential review
(without it every credential stays pending, so pilot drivers cannot accept work) and the optional assistant
rephrasing. V2 browsing and interest do not need it. The Anthropic API is billed per use, so leave it unset
unless the founder decides otherwise.

## 12. Verify

| What | Command | Proves |
|---|---|---|
| Environment readiness | `doppler run --project logloads --config stg -- pnpm integrations:check --target staging --strict` | Every required integration has its variables, and the consistency checks pass (exit 1 otherwise) |
| Deployment matches Doppler | add `--health-url https://<origin>` | `/api/health` agrees with the environment, the canonical state loaded, and the cron route has `CRON_SECRET` |
| Supabase post-provision | `doppler run --project logloads --config stg -- pnpm supabase:post-provision check` | Migrations applied (table and rate-limit RPC present), canonical row present, bucket matches the contract |
| Health document | `curl -fsS https://<origin>/api/health` | Coarse booleans and the deployed commit, never values |
| Normalized store (staging only) | `doppler run --project logloads --config stg -- pnpm normalized:store status --expected-project-ref <ref>` | The V2 schema is current, the issuer row and the adapter's login role are safe, and the adapter can log in (§15) |
| Smoke | `SMOKE_BASE=https://<origin> SMOKE_EXPECT_FEE_COLLECTION=disabled SMOKE_EXPECT_PERCENTAGE_ENROLLMENT=disabled node tools/production-smoke.mjs` | Public pages, cockpit protection, wiring |

About the smoke (`tools/production-smoke.mjs`): it needs a Playwright browser (`pnpm exec playwright install chromium`),
it cannot pass Vercel Authentication on a protected Preview, and its "percentage billing configuration" check
fails while Stripe is dark (`/api/health` reports `billing: "misconfigured"`). Record that failure as expected
until Stripe is configured; every other check must pass.

The readiness check also flags, by name only: unknown provider-prefixed names (typos), retired Cloudinary
names, removed placeholders, GitHub Actions secrets in an app environment, and a Doppler config that does not
match `--target`.

## 13. Production (only with the founder's authorization)

1. **Owner:** Supabase: `doppler run --project logloads --config dev -- pnpm supabase:provision --name logloads-production --region us-east-1 --doppler-config prd --allow-production --apply`,
   then §2.3, §2.4 and §2.6 with `--config prd`.
2. **Owner:** Clerk production instance and DNS (§3.5); keys in `prd`.
3. **Owner:** Vercel: attach `logloads.com`, set `NEXT_PUBLIC_APP_URL=https://logloads.com` in `prd`, redeploy.
4. **Owner:** bootstrap the canonical state (§2.5 with `prd`), then claim founder access
   ([`ACTIVATION_CLERK.md`](./ACTIVATION_CLERK.md) §3).
5. `doppler run --project logloads --config prd -- pnpm integrations:check --target production --strict --health-url https://logloads.com`,
   then the smoke (§12).

Stripe live mode and a production Resend key need separate, explicit authorization.

## 14. Where each variable lives

Generated from `ops/production-env-contract.json` (`doppler_configs`). `pnpm integrations:check --list` prints
the same list with every variable, including the ones set by Vercel or CI.

| Integration | Variable | dev | stg | prd | Kind |
|---|---|---|---|---|---|
| app | `NEXT_PUBLIC_APP_URL` | — | yes | yes | public |
| app | `LOGLOADS_MARKETPLACE_V2` | yes | yes | **never** | public |
| app | `LOGLOADS_MARKETPLACE_V2_ADAPTER` | — | normalized-V2 proof only | **never** | public |
| app | `LOGLOADS_NORMALIZED_DATABASE_URL` | — | normalized-V2 proof only | **never** | secret |
| app | `LOGLOADS_NORMALIZED_IDENTITY_ISSUER` | — | normalized-V2 proof only | **never** | public |
| app | `LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE` | — | normalized-V2 proof only | **never** | public |
| app | `LOGLOADS_NORMALIZED_IDENTITY_SYNC_DATABASE_URL` | — | normalized-V2 proof only (optional) | **never** | secret |
| session | `LOGLOADS_SESSION_SECRET` | — | yes | yes | secret |
| supabase-api | `SUPABASE_URL` | — | yes | yes | public |
| supabase-api | `SUPABASE_SERVICE_ROLE_KEY` | — | yes | yes | secret |
| supabase-api | `LOGLOADS_ALLOW_STATE_BOOTSTRAP` | — | once | once | public |
| supabase-storage | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | — | yes | yes | public |
| supabase-storage | `LOGLOADS_MEDIA_STORAGE` | — | yes | yes | public |
| supabase-storage | `LOGLOADS_MEDIA_BUCKET` | — | yes | yes | public |
| supabase-storage | `LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF` | — | yes | yes | public |
| supabase-db | `DATABASE_URL` | — | yes (or tooling config) | yes (or tooling config) | secret |
| supabase-db | `SUPABASE_PROJECT_REF` | — | yes (or tooling config) | yes (or tooling config) | public |
| supabase-db | `SUPABASE_DB_PASSWORD` | — | yes (or tooling config) | yes (or tooling config) | secret |
| supabase-db | `SUPABASE_ACCESS_TOKEN` | provisioning run only | **never** | **never** | secret |
| rate-limit | `LOGLOADS_RATE_LIMIT_HMAC_SECRET` | — | yes | yes | secret |
| rate-limit | `LOGLOADS_RATE_LIMIT_KEY_PREFIX` | — | yes | yes | public |
| clerk | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | optional | yes | yes | public |
| clerk | `CLERK_SECRET_KEY` | optional | yes | yes | secret |
| clerk | `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | optional | yes | yes | public |
| clerk | `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | optional | yes | yes | public |
| clerk | `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | optional | yes | yes | public |
| clerk | `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | optional | yes | yes | public |
| platform-admin | `LOGLOADS_PLATFORM_ADMIN_CLERK_IDS` | — | yes | yes | secret |
| platform-admin | `LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256` | — | yes | yes | secret |
| platform-admin | `LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP` | — | yes | yes | public |
| platform-admin | `LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT` | — | claim window | claim window | public |
| stripe | `STRIPE_SECRET_KEY` | optional | optional | after authorization | secret |
| stripe | `STRIPE_PUBLISHABLE_KEY` | optional | optional | after authorization | public |
| stripe | `STRIPE_WEBHOOK_SECRET` | optional | optional | after authorization | secret |
| stripe | `LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID` | optional | optional | after authorization | secret |
| stripe | `LOGLOADS_STRIPE_EXPECTED_LIVEMODE` | `test` | `test` | `live` | public |
| billing-gates | `LOGLOADS_FEE_COLLECTION` | — | `disabled` | `disabled` | public |
| billing-gates | `LOGLOADS_PERCENTAGE_ENROLLMENT` | — | `disabled` | `disabled` | public |
| billing-gates | `LOGLOADS_SUBSCRIPTION_COLLECTION` | — | `disabled` | `disabled` | public |
| billing-gates | `LOGLOADS_DISPATCH_SELF_SERVE` | — | `disabled` | `disabled` | public |
| billing-gates | `LOGLOADS_INTERNAL_BILLING_SMOKE` | — | `disabled` | `disabled` | public |
| cron | `CRON_SECRET` | — | yes | yes | secret |
| resend | `RESEND_API_KEY` | — | optional | after authorization | secret |
| resend | `RESEND_FROM` | — | yes | yes | public |
| resend | `RESEND_REPLY_TO` | — | yes | yes | public |
| resend | `SUPPORT_EMAIL` | — | yes | yes | public |
| resend | `LOGLOADS_CONTACT_EMAIL` | — | yes | yes | public |
| posthog | `NEXT_PUBLIC_POSTHOG_KEY` | — | — | optional | public |
| posthog | `NEXT_PUBLIC_POSTHOG_HOST` | — | — | optional | public |
| sentry | `SENTRY_DSN` | — | — | optional | secret |
| maps | `NEXT_PUBLIC_CARTO_BASEMAP_KEY` | optional | optional | optional | public |
| anthropic | `ANTHROPIC_API_KEY` | — | optional | optional | secret |
| test | `LOGLOADS_SUPABASE_DEV_PROJECT_REFS` | auth harness only | **never** | **never** | public |
| test | `LOGLOADS_AUTH_HARNESS_CLERK_USER_IDS` | auth harness only | **never** | **never** | public |

**Must stay unset** on hosted targets: `LOGLOADS_ENABLE_DEV_LOGIN`, `LOGLOADS_DEMO_MODE`, `LOGLOADS_STATE_FILE`,
`LOGLOADS_RATE_LIMIT_TEST_MODE`, `SUPABASE_ACCESS_TOKEN`, `LOGLOADS_SUPABASE_DEV_PROJECT_REFS`,
`LOGLOADS_AUTH_HARNESS_CLERK_USER_IDS`; everywhere: `LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS`,
`LOGLOADS_PERCENTAGE_EXPECTED_ORGANIZATION_SCOPE_SHA256`, `LOGLOADS_SUBSCRIPTION_ALLOWED_ORGANIZATION_IDS`; in
production: `LOGLOADS_MARKETPLACE_V2`, `LOGLOADS_MARKETPLACE_V2_ADAPTER` and `LOGLOADS_NORMALIZED_*`. The historical catalog ids (`STRIPE_PRICE_*`,
`STRIPE_PORTAL_CONFIGURATION_NETWORK`) and the smoke allowlists stay unset on a fresh start.

## 15. Normalized store (V2) on staging

Optional, and for the staging normalized-V2 proof only (#200, #140). The pilot `operating_state` store stays the
source of truth for everything else, and production never uses the normalized store: `VERCEL_ENV=production`
always selects the pilot adapter. Nothing here migrates pilot data. This deploys an empty normalized store and, if
you choose, the synthetic demo seed.

`tools/normalized-store.mjs` (`pnpm normalized:store`) applies the normalized schema (`architecture/normalized-v2/`)
to one database, the way CI applies it, and creates the adapter's login role ([`SECURITY.md`](./SECURITY.md) §4.1).
It is a **dry run by default**. It refuses anything that looks like production, needs the project named on the
command line, and never prints a value. CI runs the same commands on disposable databases: the "Seeded normalized
store" jobs of `.github/workflows/normalized-adapter-ci.yml`, on plain PostgreSQL 17 and on a Supabase local stack.

### 15.1 Before you start

1. **Owner:** the staging project exists and `stg` (or its tooling branch) holds `DATABASE_URL`,
   `SUPABASE_PROJECT_REF` and `LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF` (§2.2). The tool applies the schema as the
   migration role in `DATABASE_URL`.
2. **Order.** On a fresh project, do §15.2 right after §2.2, **before** the pilot migrations (§2.3). The normalized
   schema installs PostGIS in the `extensions` schema and never moves an existing copy. The pilot migrations install
   it in `public` only when it is missing, so applied afterwards they use the copy in `extensions`. CI applies them in
   this order on a Supabase local stack and runs their checks (`supabase/verify/`). If the pilot migrations already
   ran, PostGIS is in `public`, the plan refuses and names the schema, and nothing is changed: moving PostGIS on a
   project that holds pilot tables is an owner decision.
3. **Owner:** install the PostgreSQL client, version 17 (`psql`; on Windows, the installer's command line tools are
   enough).
4. **Owner:** set the adapter's three values in `stg` only. `doppler secrets set <NAME> --project logloads --config stg`
   prompts for each value.

   | Variable | Value |
   |---|---|
   | `LOGLOADS_NORMALIZED_DATABASE_URL` | `postgresql://logloads_marketplace_adapter.<ref>:<password>@<pooler host>:6543/postgres?sslmode=require`. The pooler host is the one in `DATABASE_URL`; port 6543 is its transaction pooler, which the adapter is built for. The role name must start with `logloads_`. Use a new random password of at least 24 characters, for example from `openssl rand -hex 24`. Secret. The role does not exist yet: §15.2 creates it with this password. |
   | `LOGLOADS_NORMALIZED_IDENTITY_ISSUER` | The Clerk development instance's issuer: its Frontend API URL, `https://<slug>.clerk.accounts.dev`. |
   | `LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE` | A name for the identity this app asserts, for example `logloads-staging`. |

   Optional: `LOGLOADS_NORMALIZED_IDENTITY_SYNC_DATABASE_URL` lets a first Clerk sign-in link itself through
   `sync_verified_identity` (#213, [`SECURITY.md`](./SECURITY.md) §4.1). Its login role is a separate NOINHERIT role
   that may switch only to `service_role`. §15.2 does not create it; without it only the seeded people resolve.

`<ref>` below is the staging project reference (`SUPABASE_PROJECT_REF`). If you chose a tooling config in §2.2, use
`--config stg_tooling` instead of `--config stg`; it inherits the `stg` values.

### 15.2 Apply the schema

```bash
doppler run --project logloads --config stg -- pnpm normalized:store schema --expected-project-ref <ref>          # plan: nothing is changed
doppler run --project logloads --config stg -- pnpm normalized:store schema --expected-project-ref <ref> --apply  # Owner: apply
```

What `--apply` does, each step in one transaction:

1. It applies the pending migration files in CI's order: 01, 02, 03, 06, 11, 12, 16, 18, 23. Files already applied
   are skipped: the migration ledger `marketplace.schema_migrations` records 06 onward, and 01 to 03 are recognized
   by objects only they create. Re-running is a no-op. A failure rolls that file back and leaves the earlier files
   applied, so fix the cause and run the same command again.
2. It registers the issuer row the adapter asserts: `LOGLOADS_NORMALIZED_IDENTITY_ISSUER`, enabled, with
   `LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE` pinned.
3. It creates the login role from `LOGLOADS_NORMALIZED_DATABASE_URL`: NOINHERIT, no other attribute, a member of
   `anon` and `authenticated` only, with a 15-second statement timeout and a 60-second idle-in-transaction timeout.
   The password reaches the database as a SCRAM-SHA-256 verifier on psql's standard input, never on a command line
   and never in plaintext. An existing role is checked and kept. A role that is not safe is refused, never altered.
   After you change the password in Doppler, run the command again with `--reset-adapter-password`.
4. It verifies the result: the full ledger, RLS on every table, no function executable by `PUBLIC`, and every
   `SECURITY DEFINER` function's search path. Then it logs in as the adapter's role and runs public discovery.

It refuses, with exit code 2 and before connecting:

- any production signal: a `prd` Doppler config, `VERCEL_ENV=production`, the production origin in
  `NEXT_PUBLIC_APP_URL`, `LOGLOADS_STRIPE_EXPECTED_LIVEMODE=live`, or a live Stripe or Clerk key;
- a `--expected-project-ref` that differs from the project in either URL, from
  `LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF` or from `SUPABASE_PROJECT_REF`;
- `DATABASE_URL` on the transaction pooler, an adapter URL without `sslmode=require`, or a role name outside `logloads_`.

**Migration 18 changes a database-wide default.** Every function the migration role (`postgres`) creates later,
in any schema of the staging database, gets no `EXECUTE` for `PUBLIC`. Supabase's own defaults in `public` and
`storage` still grant the API roles, so the pilot's functions keep working; a function in any other schema needs an
explicit grant. Read the deployment note in `architecture/normalized-v2/ARCHITECTURE.md` §4 before the first
`--apply`. The tool prints the same warning while 18 is pending.

Do not add `marketplace` to the project's exposed Data API schemas for this: the adapter connects to the database
directly. Only the #112 harness needs it exposed, on the development project ([`SECURITY.md`](./SECURITY.md) §5.1).

### 15.3 Load the synthetic seed (staging only, never production)

```bash
doppler run --project logloads --config stg -- pnpm normalized:store seed --expected-project-ref <ref>          # plan
doppler run --project logloads --config stg -- pnpm normalized:store seed --expected-project-ref <ref> --apply  # Owner: load
```

The seed, `architecture/normalized-v2/seed/pilot_demo_seed.sql`, mirrors the pilot demo seed
(`packages/db/src/seed-data.ts`) and keeps its ids:

- **North Pine Logging**: Oak Landing; the open jobs "Oak saw-log morning run" and "Oak chip shuttle", and one
  closed job; three trucks.
- **Summit Ridge Timber**: Blue River Landing; the open job "Blue River high-grade campaign", and one filled job.
- **New River Hauling**: a hauling business with no trucks listed.
- **Granite Creek Hauling**: a public hauling profile, two "Log truck + Bunk / short-log" units and one
  "Log truck + Pole trailer", and one availability report.

Each landing has private details (the exact entrance, directions, the gate, a site contact) that no public page
shows. Each person is linked to their pilot Clerk user id (`clerk-…`) under your issuer. No inquiry is seeded.
Dates are relative to the day you load it: the jobs start within a week, and the two landing plans run for 30 days.

The seed loads only into an empty store, and only once. It runs in one transaction and checks its own result before
it commits. Nothing unloads it, so a seeded store stays a demo store. The data is synthetic: never present it as
real activity.

### 15.4 Point staging at it

1. **Owner:** in `stg`, set `LOGLOADS_MARKETPLACE_V2_ADAPTER=normalized`, with `LOGLOADS_MARKETPLACE_V2=enabled` (only
   when the [`DEPLOYMENT.md`](./DEPLOYMENT.md) §4 gates hold, §5) and the three values from §15.1. Never in `prd`.
2. **Owner:** let Doppler sync, then redeploy the staging Preview (Vercel → Deployments → Redeploy).

To switch back, delete `LOGLOADS_MARKETPLACE_V2_ADAPTER` from `stg` and redeploy: the pilot adapter is the default.

### 15.5 Verify

| What | Command | Proves |
|---|---|---|
| Store and login role | `doppler run --project logloads --config stg -- pnpm normalized:store status --expected-project-ref <ref>` | The ledger and the RLS and function checks, the issuer row, the role's safety, and a login as the adapter. It ends with "ready for the adapter" and exit code 0. |
| Environment and deployment | `doppler run --project logloads --config stg -- pnpm integrations:check --target staging --health-url https://<staging-origin>` | The adapter's variables are set only where the contract allows, and the deployment answers |
| Health | `curl -fsS https://<staging-origin>/api/health` | `status: "ok"` and the deployed commit. It does not name the V2 store. |
| Page, **Owner** | Open `https://<staging-origin>/v2/work` in a browser, signed out | The seed's three open jobs, newest first: "Oak saw-log morning run", "Oak chip shuttle", "Blue River high-grade campaign". The pilot seed publishes only North Pine Logging's job, so Summit Ridge Timber's job shows that the normalized store answered. A job page shows "Oakridge, OR" or "Blue River, OR", and never a gate, directions or an exact location. |

**What staging does not prove yet.** Signed-in V2 pages need the session's person and business in the normalized
store. The seed links only the seeded people's pilot Clerk ids, and on staging people sign in with real Clerk
accounts: seeded sign-in (`LOGLOADS_ENABLE_DEV_LOGIN`) is never enabled on a hosted target. So while the normalized
adapter is selected, the signed-in V2 pages refuse a staging account. The signed-in flows are proven in CI on the
seeded store (`apps/web/lib/marketplace-v2/normalized-seed.contract.test.ts`), and can be tried locally (§15.6).
#213 (in progress) covers this. With the normalized adapter selected, the session's memberships and active business
will come from the normalized store. A Clerk user's first sign-in will be linked there through the schema's own
`sync_verified_identity`. Moving existing pilot data across stays cutover work (#200).

### 15.6 A disposable local stack

Do not use the repository's own stack. `supabase start` in this checkout applies the pilot migrations as it starts,
so PostGIS lands in `public`, and `schema --apply` refuses with nothing changed (§15.1). Use an empty stack, as CI
does (`tools/normalized-v2-ci/supabase-stack.sh`): a separate Supabase CLI project in an empty folder outside this
repository, on the CLI's default ports (database on 54322), named `local`. The normalized store needs none of the
pilot tables, because the adapter connects only to `LOGLOADS_NORMALIZED_DATABASE_URL`. The app's seeded sign-in
then reaches the seeded people through the normalized adapter, for example `dispatch@northpine.example` (North Pine
Logging's landing desk) or `emptyfleet@logloads.example` (New River Hauling). Add these lines to the git-ignored
`apps/web/.env.local`, with a throwaway password of at least 24 characters (the stack is disposable):

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
LOGLOADS_NORMALIZED_DATABASE_URL=postgresql://logloads_marketplace_adapter:<password>@127.0.0.1:54322/postgres
LOGLOADS_NORMALIZED_IDENTITY_ISSUER=https://clerk.local-stack.test
LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE=logloads-local
LOGLOADS_MARKETPLACE_V2=enabled
LOGLOADS_MARKETPLACE_V2_ADAPTER=normalized
```

Then, with `<stack folder>` an empty folder outside this repository:

```bash
cd <stack folder> && supabase init && supabase start && cd -
node --env-file=apps/web/.env.local tools/normalized-store.mjs schema --expected-project-ref local --apply
node --env-file=apps/web/.env.local tools/normalized-store.mjs seed --expected-project-ref local --apply
pnpm dev
```

`supabase stop --no-backup`, run in `<stack folder>`, discards the stack. Remove `LOGLOADS_MARKETPLACE_V2_ADAPTER` to return to the pilot
adapter.
