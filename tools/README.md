# tools/

Repo scripts. Each `*.test.mjs` runs under `pnpm test:tools`. Anything that can
reach a provider is dry-run by default or refuses live credentials unless it is
given an explicit flag.

## Everyday

| Script | Run with | What it does |
|---|---|---|
| `check-guardrails.mjs` | `pnpm guardrails` | Enforces repo bans: secrets, retired providers (Cloudinary), driver-payment money paths (`transfer_data`, `application_fee_amount`) and similar |
| `db-check.sh` | `pnpm db:check` / `pnpm db:assert` | Fresh local Supabase migration reset. Skips locally without the CLI; fails in CI |
| `run-e2e.mjs` + `e2e-readiness.mjs` | `pnpm test:e2e` | Waits for the local Supabase stack and canonical row, then runs Playwright without printing credentials |
| `screenshot.mjs` | `pnpm screenshot [outDir] [routes…]` | Mobile and desktop screenshots of a running app (`SHOT_BASE`, `SHOT_VIEWPORTS`), for UI evidence in PRs |

## Demo and pilot

| Script | Run with | What it does |
|---|---|---|
| `founder-demo.mjs` (+ `founder-demo-policy.mjs`) | `pnpm demo` | Disposable loopback demo: synthetic dates, every provider disabled, temp state file deleted on exit |
| `capture-pilot-surfaces.mjs` | `pnpm demo:capture-pilot` | Regenerates the synthetic Pilot Center captures in `apps/web/public/pilot/` |

## Operations runbooks (see docs/RECOVERY.md and docs/DEPLOYMENT.md)

| Script | Run with | What it does |
|---|---|---|
| `operating-state-backup.mjs` (+ `-policy.mjs`) | `pnpm state:backup backup --out backups` · `verify <file>` · `restore <file> --i-understand-this-overwrites-production` | Point-in-time backup, verification and restore of `public.operating_state`. Backups are production personal data |
| `production-smoke.mjs` | `SMOKE_BASE=<url> SMOKE_EXPECT_FEE_COLLECTION=disabled SMOKE_EXPECT_PERCENTAGE_ENROLLMENT=disabled pnpm smoke` | Post-deploy proof against a live URL: health, public surfaces, auth protection, money-gate state |
| `verify-billing.mjs` | `node tools/verify-billing.mjs [org-name]` | Read-only aggregate view of percentage-v1 fee state in the canonical document |

## Stripe: historical subscription reconciliation

New subscription enrollment is forbidden (`AGENTS.md` §7). These remain only to
inspect or reconcile obligations accepted under `subscription_v1`.

| Script | Run with | What it does |
|---|---|---|
| `stripe-catalog.mjs` | (library) | Catalog definitions and safety assertions shared by the scripts below |
| `provision-stripe-catalog.mjs` | `pnpm --filter @logloads/web stripe:catalog` | Prints the catalog. `--apply` needs an `sk_test_` key, and `--allow-live` too for live mode |
| `verify-stripe-subscriptions.mjs` + `stripe-test-clock.mjs` | `pnpm --filter @logloads/web stripe:verify-subscriptions` | Test-clock lifecycle verification. Test keys only |
