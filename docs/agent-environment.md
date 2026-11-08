# LogLoads — Agent Environment Map (names only)

> **Status:** IMPLEMENTED names, read from `ops/production-env-contract.json` at `work/logloads-repair`
> f78a5b3f1ab90cb715bd2fb741459c7ba196245b. Doppler presence is a dated observation (2026-11-08, names only); values
> were never read. Scope: which variable unblocks which kind of agent work.
>
> The contract is the authority. `.env.example` lists the same names and `tools/integration-readiness-contract.test.mjs`
> keeps them in agreement with the code. If this page disagrees with the contract, the contract wins. Local setup is in
> `docs/ENVIRONMENT.md`; provider setup is in `docs/INTEGRATIONS.md`.

## 1. Short answer

- **Local development, lint, typecheck, unit tests, the CI end-to-end suites and the production build need no Doppler
  secret.** Nothing below blocks that work today.
- **Hosted Preview, staging and Production are blocked.** Doppler `stg` and `prd` hold no application names yet (§9).
  Provisioning them is a founder step: new provider projects and credentials.
- Never print, paste or commit a value. Check presence with `doppler secrets --only-names`.

## 2. Doppler project and configs

All names live in Doppler project `logloads`.

| Config | Target | Synced to |
|---|---|---|
| `dev` | local | nothing; never synced |
| `stg` | preview, staging | Vercel Preview |
| `prd` | production | Vercel Production |
| `dev_personal`, `ops` | not used by the product docs | nothing |

GitHub Actions repository secrets (§4) never belong in Doppler or Vercel.

## 3. Local development

Written by `pnpm setup:local` into `apps/web/.env.local`, not stored in Doppler:

- `NEXT_PUBLIC_APP_URL`, `LOGLOADS_SESSION_SECRET`, `LOGLOADS_RATE_LIMIT_HMAC_SECRET`

Local-only switches. Each must be unset on every hosted target:

- `LOGLOADS_STATE_FILE`, `LOGLOADS_ENABLE_DEV_LOGIN`, `LOGLOADS_DEMO_MODE`, `LOGLOADS_RATE_LIMIT_TEST_MODE`

V2 preview, Doppler `dev`: `LOGLOADS_MARKETPLACE_V2`. For the normalized adapter, set these in the local env file
locally (Doppler `stg` holds them only for the staging proof): `LOGLOADS_MARKETPLACE_V2_ADAPTER`, `LOGLOADS_NORMALIZED_DATABASE_URL`, `LOGLOADS_NORMALIZED_IDENTITY_ISSUER`,
`LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE`, `LOGLOADS_NORMALIZED_IDENTITY_SYNC_DATABASE_URL`.

Optional provider keys, Doppler `dev`. Without them local work uses the JSON store and seeded sign-in:

- Clerk development instance: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`,
  `NEXT_PUBLIC_CLERK_SIGN_UP_URL`, `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`,
  `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL`
- Maps: `NEXT_PUBLIC_CARTO_BASEMAP_KEY`
- Stripe test mode, dark until billing is authorized: see §7

Dev-only tooling, Doppler `dev`: `LOGLOADS_SUPABASE_DEV_PROJECT_REFS`, `LOGLOADS_AUTH_HARNESS_CLERK_USER_IDS`.

## 4. Tests and CI

No Doppler config is needed. `apps/web/tests/playwright.config.mjs` and `apps/web/tests/design-system.config.mjs`
set synthetic values for `NEXT_PUBLIC_APP_URL`, `LOGLOADS_SESSION_SECRET`, `LOGLOADS_RATE_LIMIT_HMAC_SECRET`,
`LOGLOADS_RATE_LIMIT_TEST_MODE`, `LOGLOADS_ENABLE_DEV_LOGIN`, `LOGLOADS_DEMO_MODE`, `LOGLOADS_STATE_FILE` and
`LOGLOADS_MARKETPLACE_V2`.

- Test harness: `CI`, `DS_E2E_PORT`, `DS_E2E_CHANNEL`, `DS_E2E_SERVER`, `LOGLOADS_E2E_STAMP`
- Set by the CI workflows for disposable databases: `LOGLOADS_DISPOSABLE_DB_URL`, `LOGLOADS_DB_ENV`,
  `LOGLOADS_ADAPTER_CONTRACT`, `LOGLOADS_SUPABASE_JWT_SECRET`
- Operating-state rehearsal tool only: `LOGLOADS_REHEARSAL_SUPABASE_URL`, `LOGLOADS_REHEARSAL_SERVICE_ROLE_KEY`
- Operator smoke against a deployment: `SMOKE_BASE`, `SMOKE_EXPECT_FEE_COLLECTION`,
  `SMOKE_EXPECT_PERCENTAGE_ENROLLMENT`, and `VERCEL_AUTOMATION_BYPASS_SECRET` (owner shell) for a protected Preview
- GitHub Actions repository secrets, read only by `.github/workflows/pr-agent-dispatch.yml`: `CODEX_AGENT_WEBHOOK_URL`,
  `CODEX_AGENT_WEBHOOK_TOKEN`, `CLAUDE_AGENT_WEBHOOK_URL`, `CLAUDE_AGENT_WEBHOOK_TOKEN`, `SENTRY_AGENT_WEBHOOK_URL`,
  `SENTRY_AGENT_WEBHOOK_TOKEN`, `GIT_AGENT_WEBHOOK_URL`, `GIT_AGENT_WEBHOOK_TOKEN`

## 5. Build

`pnpm --filter @logloads/web build` needs no name; CI builds with none set.

Browser-visible names are inlined at build time, so a hosted build reads them from the Vercel environment that Doppler
`stg` or `prd` syncs: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, the four Clerk URL names in §3,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`,
`NEXT_PUBLIC_CARTO_BASEMAP_KEY`, `NEXT_PUBLIC_MAPBOX_TOKEN` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
`apps/web/next.config.ts` also reads the Clerk, PostHog and Mapbox names for its content security policy.

Set by Vercel, Next.js or GitHub. Never set them by hand: `NODE_ENV`, `NEXT_RUNTIME`, `NEXT_PHASE`, `VERCEL`, `VERCEL_ENV`,
`VERCEL_URL`, `VERCEL_GIT_COMMIT_SHA`, `NOW_BUILDER`, `GITHUB_SHA`, `GITHUB_ACTIONS`, `GITHUB_STEP_SUMMARY`.

## 6. Preview, staging and Production

**Required on Preview, staging and Production.** `pnpm integrations:check` fails without them:

- Sessions: `LOGLOADS_SESSION_SECRET`
- Supabase API: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Private media: `LOGLOADS_MEDIA_STORAGE`, `LOGLOADS_MEDIA_BUCKET`, `LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF`, and
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or the legacy alias `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
- Rate limiting: `LOGLOADS_RATE_LIMIT_HMAC_SECRET`
- Identity: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`

**Production also requires** `NEXT_PUBLIC_APP_URL` (a Preview falls back to `VERCEL_URL`), `CRON_SECRET`,
`LOGLOADS_PLATFORM_ADMIN_CLERK_IDS` and `LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256`. The contract stores the last
two in `stg` as well. Production also needs explicit founder authorization.

**Written into `stg` and `prd` by `tools/provision-supabase-project.mjs`** when absent: `LOGLOADS_SESSION_SECRET`,
`LOGLOADS_RATE_LIMIT_HMAC_SECRET`, `CRON_SECRET`, `LOGLOADS_RATE_LIMIT_KEY_PREFIX`, `LOGLOADS_STRIPE_EXPECTED_LIVEMODE`,
the Supabase names above, and these gates, every one disabled: `LOGLOADS_FEE_COLLECTION`,
`LOGLOADS_PERCENTAGE_ENROLLMENT`, `LOGLOADS_SUBSCRIPTION_COLLECTION`, `LOGLOADS_DISPATCH_SELF_SERVE`,
`LOGLOADS_INTERNAL_BILLING_SMOKE`, `LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP`.

**Database tooling, not read by the app** (`stg`, `prd`): `DATABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`.

**Staging only, never Production:** `LOGLOADS_MARKETPLACE_V2` and the five normalized-adapter names in §3, for the
normalized V2 proof against an isolated Supabase project.

**Must be unset in Production:** every name in §3 under local-only switches, V2 preview and dev-only tooling, plus
`SUPABASE_ACCESS_TOKEN`.

## 7. Optional integrations

Each is off when its names are absent.

- Email, `stg` and `prd`: `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_REPLY_TO`, `SUPPORT_EMAIL`, `LOGLOADS_CONTACT_EMAIL`,
  and the compatibility names `LOGLOADS_EMAIL_FROM`, `LOGLOADS_EMAIL_REPLY_TO`
- Analytics, `prd`: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`
- Server errors, `prd`: `SENTRY_DSN`
- Maps, `dev`, `stg` and `prd`: `NEXT_PUBLIC_CARTO_BASEMAP_KEY`; legacy fallback `NEXT_PUBLIC_MAPBOX_TOKEN`
- Legacy credential review and assistant, `stg` and `prd`: `ANTHROPIC_API_KEY`, `CREDENTIAL_REVIEW_MODEL`,
  `ASSISTANT_MODEL`. Billed per use; leave unset unless the founder decides otherwise
- Stripe, dark until a founder billing authorization, `dev`, `stg` and `prd`: `STRIPE_SECRET_KEY`,
  `STRIPE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID`

## 8. Names that stay unset or blank

- Historical Stripe catalog. Never provision for new activity: `STRIPE_PRICE_DISPATCH`, `STRIPE_PRICE_NETWORK_PILOT`,
  `STRIPE_PRICE_NETWORK_PILOT_OVERAGE`, `STRIPE_PRICE_NETWORK_25`, `STRIPE_PRICE_NETWORK_25_OVERAGE`,
  `STRIPE_PRICE_NETWORK_50`, `STRIPE_PRICE_NETWORK_50_OVERAGE`, `STRIPE_PRICE_NETWORK_100`,
  `STRIPE_PRICE_NETWORK_100_OVERAGE`, `STRIPE_PORTAL_CONFIGURATION_NETWORK`, `STRIPE_PRICE_INTERNAL_BILLING_TEST`
- Gate allowlists: `LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS`,
  `LOGLOADS_PERCENTAGE_EXPECTED_ORGANIZATION_SCOPE_SHA256`, `LOGLOADS_SUBSCRIPTION_ALLOWED_ORGANIZATION_IDS`,
  `LOGLOADS_INTERNAL_BILLING_SMOKE_ALLOWED_USER_IDS`, `LOGLOADS_INTERNAL_BILLING_SMOKE_ALLOWED_ORGANIZATION_IDS`
- One-time windows, removed right after use: `LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT`,
  `LOGLOADS_ALLOW_STATE_BOOTSTRAP`
- Unused reader, not provisioned: `SUPABASE_ANON_KEY`
- Operator tooling, never read by the running app: `DOPPLER_TOKEN` (CI or server secret store only), `DOPPLER_CLI`,
  `SUPABASE_CLI`, and `SUPABASE_ACCESS_TOKEN` (an account-wide management token; the contract homes it in `dev` or the
  owner's shell)

## 9. Missing today

Observed 2026-11-08 with `doppler secrets --only-names --project logloads --config <config>`:

| Config | Names present |
|---|---|
| `dev`, `dev_personal`, `stg`, `ops` | only Doppler's built-in `DOPPLER_CONFIG`, `DOPPLER_ENVIRONMENT`, `DOPPLER_PROJECT` |
| `prd` | the built-in names, plus `SUPABASE_ACCESS_TOKEN` |

What that blocks:

- **Local, tests, build:** nothing is missing.
- **Preview and staging:** every required name in §6 is missing from `stg`. It clears when the founder creates a staging
  Supabase project and a Clerk development instance, then runs the provisioning steps in `docs/INTEGRATIONS.md` §2.
- **Production:** every required name in §6 is missing from `prd`, and Production needs founder authorization anyway.
- **Misplaced:** `SUPABASE_ACCESS_TOKEN` sits in `prd`, which syncs to Vercel Production. The contract says it must not
  live in a synced config. Moving it is a founder decision: the contract names `dev` or the owner's shell, while
  AE-Control's Doppler policy proposes a separate `ops` config. Do not move or rotate it without approval.

**Contract inconsistency to resolve:** the `ANTHROPIC_API_KEY` variable entry says `required: true` for `stg` and
`prd`, but its `anthropic` integration has an empty `required_in`, and `docs/INTEGRATIONS.md` §11 calls it optional.
`pnpm integrations:check` follows the integration, so it does not fail when the key is absent.

## 10. Checking without printing values

```powershell
doppler secrets --only-names --project logloads --config stg
doppler run --project logloads --config stg -- pnpm integrations:check --target staging
pnpm integrations:check --target local --env-file apps/web/.env.local
```

The readiness check prints names and booleans, never values. It was not run for this page.
