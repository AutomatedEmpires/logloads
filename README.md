# LogLoads

**A timber-hauling load board.** Landing operators advertise genuine hauling jobs. Haulers and fleets discover
them, free, and express interest. The businesses then arrange the work directly.

LogLoads is **not** a dispatch, freight-brokerage, or freight-settlement platform. It charges no per-load fee and
no commission.

- **Name and domain are LOCKED:** LogLoads · logloads.com. "LogBoard" is retired; do not reintroduce it.
- **Product authority:** the
  [Product, Membership & Monetization Blueprint v1.0](./docs/product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md)
  (2026-11-01). Dated founder decisions are in [`docs/DECISIONS.md`](./docs/DECISIONS.md). The documentation map,
  current-state summary and status vocabulary are in [`docs/README.md`](./docs/README.md).
- **Work coordination:** GitHub Issues labelled `agent-task` are the task tracker, with pull requests as the
  evidence. Process: [`docs/AGENT_WORKFLOW.md`](./docs/AGENT_WORKFLOW.md). Rules for agents:
  [`AGENTS.md`](./AGENTS.md).

## Commercial model

- **Haulers and fleets:** free forever.
- **Landing operators:** the approved membership model in the Blueprint (§3–§8), which **replaces percentage-fee
  enrollment**. It consists of Basic, Pro and Regional subscriptions, targeted invitations, optional boosts, and a
  founding offer. The single code source for its numbers is `packages/contracts/src/membership.ts`.
- **Nothing is purchasable yet.** Production billing is not authorized
  ([`docs/ACTIVATION_STRIPE.md`](./docs/ACTIVATION_STRIPE.md)).
- **Legacy billing:** the deployed app still contains the pilot's dispatch cockpits and the historical
  `percentage_v1` / `legacy_percentage` / `subscription_v1` billing code. That code is kept only so existing records
  and any obligations stay intact and readable. Every collection and enrollment gate stays `disabled`
  ([`docs/SUBSCRIPTION_BILLING_V1.md`](./docs/SUBSCRIPTION_BILLING_V1.md),
  [`docs/ENV_CONTRACT.md`](./docs/ENV_CONTRACT.md) §5).

## Stack

- **Runtime:** Node 24.16.0, pnpm 10.12.4, Turborepo monorepo.
- **Auth:** Clerk; dev sessions until keys are configured.
- **Database:** Supabase Postgres with PostGIS. The versioned `operating_state` row is the running store.
  - The normalized V2 schema is **under integration verification**. It is verified in CI on disposable PostgreSQL
    17.
  - It also passes on a local Supabase stack. It is not verified on a hosted Supabase project or with real Clerk
    tokens, not connected to the app, and not authorized for production ([`docs/CI.md`](./docs/CI.md) §3).
- **Maps:** MapLibre with **CARTO Basemaps** (preferred). Legacy Mapbox is used only when no CARTO key is set.
- **Services:** Doppler, Vercel, private Supabase Storage, PostHog, Sentry, Resend.
- **Icons:** Phosphor, through the `@logloads/ui` icon registry (`<Icon name="domain.action" />`).

## Getting started

Windows 11 (PowerShell or Git Bash) and macOS/Linux use the same steps:

```bash
fnm use            # or `nvm use` — Node 24.16.0 from .nvmrc
corepack enable    # pnpm 10.12.4 from package.json "packageManager"
pnpm install --frozen-lockfile
pnpm setup:local   # one time: writes git-ignored apps/web/.env.local with local-only secrets
pnpm dev           # http://localhost:3002 (bound to 127.0.0.1 only)
```

[`docs/ENVIRONMENT.md`](./docs/ENVIRONMENT.md) covers seeded sign-in accounts, local state reset, and the V2
preview flag. Do not run `next build` while `pnpm dev` is using `apps/web/.next`.

**Validation:** run `pnpm validate`, then `pnpm test:e2e`.

- The database step skips locally without the Supabase CLI and Docker. Report that as **skipped**, not passed.
- CI and verification evidence: [`docs/CI.md`](./docs/CI.md).
- **No agent merges or deploys without explicit founder authorization.** Merging `main` deploys production.
