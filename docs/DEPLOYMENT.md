# LogLoads — Deployment Contract

## Current target

The transitional runtime is now compatible with Vercel/serverless execution:
Supabase `public.operating_state` is canonical, each request awaits remote state,
and each mutation uses a conditional `version` update with deterministic retry.
The process-global service object is only a request cache; local disk is never
production authority.

This repository change does **not** itself apply the migration or cut traffic.
`fly.toml` and the Docker image remain rollback/reference artifacts until an
exact-SHA Vercel preview and production rollback gate are approved.

## Runtime contract

| Property | Value |
|---|---|
| Preferred host | Vercel, Node runtime |
| Runtime | Node 24.16.0, pnpm 10.12.4 |
| Health | `GET /api/health`; `200` only after canonical state loads |
| Canonical data | Supabase `public.operating_state`, row `id=primary` |
| Concurrency | optimistic compare-and-swap on monotonic `version`; four attempts |
| Local fallback | JSON snapshot only when `NODE_ENV != production` |
| Production disk/volume | not required and not authoritative |

The full-state JSON document is a bounded transitional design. Relational tables
remain the long-term scaling path, but no material service rewrite is required for
the first Supabase-canonical deployment.

Sign-in, contact, onboarding, and authenticated API mutation limits use the
provider-neutral `RateLimitStore` contract. Production selects the included
Redis-compatible REST adapter with `LOGLOADS_RATE_LIMIT_REST_URL` and
`LOGLOADS_RATE_LIMIT_REST_TOKEN`. Each request executes one atomic fixed-window
increment shared by all instances. Missing, partial, unavailable, or invalid
external configuration fails closed; process memory is never an implicit
production fallback.

## Required production environment

- `NEXT_PUBLIC_APP_URL=https://logloads.com`
- `LOGLOADS_SESSION_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `LOGLOADS_RATE_LIMIT_REST_URL` (Redis REST command endpoint)
- `LOGLOADS_RATE_LIMIT_REST_TOKEN` (server-only bearer credential)

Optional provider variables are catalogued in
[`ops/production-env-contract.json`](../ops/production-env-contract.json).
Production fails closed if either canonical Supabase variable is absent.

`LOGLOADS_ALLOW_STATE_BOOTSTRAP=true` is a one-time recovery/provisioning switch.
Use it only after proving `operating_state` is intentionally empty, then remove it.
The established live project already has a row and should not need this switch.

## Migration order

Apply `supabase/migrations/*.sql` in filename order. The new convergence migration is:

5. `20260711034301_canonical_operating_state.sql`

It is additive: it adds `schema_version` and `version`, backfills only a missing
`tripReviews` array, preserves all existing JSON, enables RLS, revokes broad grants,
and explicitly grants only `SELECT`, `INSERT`, and `UPDATE` to `service_role`. It
contains no `SECURITY DEFINER` function and no delete path.

The migration is committed locally but has not been applied to a live provider in
this pass. A fresh PostgreSQL 17 `supabase db reset` and catalog privilege check
passed locally on 2026-07-10.

## Preview and cutover gates

1. Back up the existing `operating_state` row through an approved secret-safe path.
2. Validate all migrations from empty local Supabase and upgrade a copy of the
   current row; verify `tripReviews`, `schema_version=2`, and the existing payload.
3. Deploy an exact commit SHA to Vercel Preview with an isolated preview database
   or isolated preview row/project. Never mutation-test against the production row.
4. Run `pnpm validate`, Playwright, and `tools/production-smoke.mjs` against preview.
5. Prove two concurrent writers preserve independent changes and a forced cold
   start loads Supabase before serving health or product data.
6. Confirm Doppler → Vercel production variables and exact deployment provenance.
7. On the exact Preview SHA, prove two instances share sign-in, contact,
   onboarding, and mutation buckets; verify 429 `Retry-After` behavior and that a
   simulated store outage fails closed with 503. Confirm
   `LOGLOADS_RATE_LIMIT_TEST_MODE` is absent.
8. Apply the additive migration, deploy the canonical-aware SHA, then smoke test.
9. Cut DNS only after the preview and rollback gates are green.

Do not run the old mirror writer concurrently after step 7: it predates versioned
compare-and-swap and could bypass the new concurrency contract.

## Rollback

- Preserve the pre-cutover row backup and the immediately preceding canonical-aware
  deployment SHA.
- Code rollback is safe only to a canonical-aware SHA. Rolling back to the legacy
  fire-and-forget mirror requires maintenance mode because it can overwrite a newer
  state document.
- The database migration is forward-only and additive; leave the columns/grants in
  place and correct defects with a new migration.
- If a write-path defect is found, stop mutations, capture the current row, compare
  versions, restore only with explicit production approval, and redeploy the known
  good canonical-aware SHA.

## Provenance cleanup

- `main` must contain the converged CI/release automation and the canonical-state
  implementation before any production deploy.
- Vercel must build from the reviewed Git commit, never a dashboard-only upload.
- `fly.toml` and `Dockerfile` are retained as explicit legacy-host rollback/reference
  artifacts; they are not production truth after Vercel cutover.
- `/api/health` exposes `VERCEL_GIT_COMMIT_SHA` (or `GITHUB_SHA`) for exact-SHA proof.
