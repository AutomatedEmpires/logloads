# LogLoads

**The operating network for moving timber.** Timber needs trucks. Trucks need work. LogLoads connects the operation — one product with four authenticated cockpits: Driver, Fleet, Host (landing operations), and Admin.

- **Name + domain are LOCKED:** LogLoads · logloads.com (GoDaddy). "LogBoard" is the retired placeholder — do not reintroduce.
- **Product truth lives in Notion** (AutomatedEmpires — Ventures → LogLoads Source of Truth). This repo is implementation truth; binding architecture decisions live in [`docs/DECISIONS.md`](./docs/DECISIONS.md).

## The operating loop

Plan → Publish → Match → Commit → Coordinate → Haul → Confirm → Repeat.

Hosts publish timber movement with capacity, schedule, and visibility control (private network first, open network when needed). Drivers and fleets see work that fits their actual equipment, request capacity, and — once committed — unlock Route Packs, exact access, live trip state, and document history. Sensitive operational detail (gate instructions, private roads, exact coordinates) stays redacted server-side until assignment.

## Product and commercial authority

**Current: [LogLoads Product, Membership & Monetization Blueprint v1.0](./docs/product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md) (2026-11-01).**
LogLoads is becoming a specialized timber-hauling load board: landing organizations
advertise long-lived hauling opportunities and find self-reported truck capacity;
haulers find work free forever. Landing plans are Basic $149 / Pro $299 / Regional
$499 per month with 3 / 10 / 30 targeted invitations per cycle, plus optional
$99 / $149 / $199 job boosts. There are no per-load, per-truck or percentage fees.
The transition is in progress — see [`docs/product/TRANSITION_PLAN.md`](./docs/product/TRANSITION_PLAN.md).
Nothing in the new model is purchasable yet, and the running app still contains the
pilot's dispatch-oriented cockpits described below until they are replaced.

### Historical commercial models (preserved for existing obligations)

Until 2026-11-01 the newest decision was `percentage_v1` (2026-08-01): LogLoads billed
the host a separate platform fee equal to **5% of the host-stated driver pay**
after a load completes. The driver remains owed the full stated amount directly
by the host; LogLoads never receives, deducts, escrows, or distributes driver
funds. Posting has no charge, there is no monthly minimum, and drivers and fleet
workspaces are free.

`legacy_percentage` is retained only for obligations already frozen under that
legacy model. Fleet Free is the current no-cost dispatch workspace. The
2026-07-28 `subscription_v1` catalog and Dispatch Pro self-serve paths are
historical/read-only: preserve and reconcile any previously accepted obligation,
but create no new subscription enrollment. The sole current
commercial collection gate is `LOGLOADS_FEE_COLLECTION`, which defaults to
`disabled`. New host agreement acceptance is independently dark behind
`LOGLOADS_PERCENTAGE_ENROLLMENT` and an exact organization allowlist; the
historical subscription and self-serve gates remain disabled.
See [`docs/DECISIONS.md`](./docs/DECISIONS.md) for authority and
[`docs/SUBSCRIPTION_BILLING_V1.md`](./docs/SUBSCRIPTION_BILLING_V1.md) for the
preserved historical subscription contract.

## Stack (AutomatedEmpires family standard)

- Runtime: Node 24.16.0 · pnpm 10.12.4 · Turborepo monorepo
- Auth: Clerk (dev sessions until keys are provisioned — see `docs/ENVIRONMENT.md`) · DB: Supabase Postgres (+ PostGIS; versioned `operating_state` is the transitional canonical store) · Maps: Mapbox (keyless MapLibre fallback)
- Secrets: Doppler · Hosting: Vercel · Media: private Supabase Storage · Observability: PostHog + Sentry · Email: Resend
- Icons: Phosphor through `@logloads/ui` semantic icon registry (`<Icon name="domain.action" />`)

## Getting started

Windows 11 (PowerShell or Git Bash) and macOS/Linux use the same steps:

```bash
fnm use            # or `nvm use` — Node 24.16.0 from .nvmrc
corepack enable    # pnpm 10.12.4 from package.json "packageManager"
pnpm install --frozen-lockfile
pnpm setup:local   # one time: writes git-ignored apps/web/.env.local with local-only secrets
pnpm dev           # http://localhost:3002 (bound to 127.0.0.1 only)
```

`pnpm setup:local` never overwrites existing values, never prints secrets, refuses to run on CI/Vercel, and adds no provider credentials, so local development uses the JSON store and seeded sign-in rather than any hosted project. Do not run `next build` while `pnpm dev` is using `apps/web/.next`; build from a separate git worktree.

Local sign-in (no Clerk keys): use the email of a seeded account — `hank@northpine.example` (driver), `dispatch@northpine.example` (fleet), `cole@summit.example` (host), `admin@logloads.example` (admin) — or create a real account through `/onboarding`. When using only the local JSON fallback, delete `apps/web/.data/logloads-state.json` to reset it; never delete a canonical Supabase row as a development reset.

Validation gate: `pnpm validate` (lint, typecheck, unit tests, build, fresh local Supabase migration reset, guardrails), then `pnpm test:e2e` for the production-build journey suite. The E2E wrapper reads the isolated local Supabase status without printing credentials; run `pnpm guardrails` first if the stack is not already active.

See [`AGENTS.md`](./AGENTS.md) for the operating contract every agent (human or AI) must follow before touching this repo.
