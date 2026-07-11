# LogLoads

**The operating network for moving timber.** Timber needs trucks. Trucks need work. LogLoads connects the operation — one product with four authenticated cockpits: Driver, Fleet, Host (landing operations), and Admin.

- **Name + domain are LOCKED:** LogLoads · logloads.com (GoDaddy). "LogBoard" is the retired placeholder — do not reintroduce.
- **Product truth lives in Notion** (AutomatedEmpires — Ventures → LogLoads Source of Truth). This repo is implementation truth; binding architecture decisions live in [`docs/DECISIONS.md`](./docs/DECISIONS.md).

## The operating loop

Plan → Publish → Match → Commit → Coordinate → Haul → Confirm → Repeat.

Hosts publish timber movement with capacity, schedule, and visibility control (private network first, open network when needed). Drivers and fleets see work that fits their actual equipment, request capacity, and — once committed — unlock Route Packs, exact access, live trip state, and document history. Sensitive operational detail (gate instructions, private roads, exact coordinates) stays redacted server-side until assignment.

## Stack (AutomatedEmpires family standard)

- Runtime: Node 24.16.0 · pnpm 10.12.4 · Turborepo monorepo
- Auth: Clerk (dev sessions until keys are provisioned — see `docs/ENVIRONMENT.md`) · DB: Supabase Postgres (+ PostGIS; versioned `operating_state` is the transitional canonical store) · Maps: Mapbox (keyless MapLibre fallback)
- Secrets: Doppler · Hosting: Vercel · Media: Cloudinary · Observability: PostHog + Sentry · Email: Resend
- Icons: Phosphor through `@logloads/ui` semantic icon registry (`<Icon name="domain.action" />`)

## Getting started

```bash
nvm use            # Node 24.16.0
corepack enable
pnpm install
pnpm dev           # http://localhost:3002 (doppler run -- pnpm dev once secrets exist)
```

Local sign-in (no Clerk keys): use the email of a seeded account — `hank@northpine.example` (driver), `dispatch@northpine.example` (fleet), `cole@summit.example` (host), `admin@logloads.example` (admin) — or create a real account through `/onboarding`. When using only the local JSON fallback, delete `apps/web/.data/logloads-state.json` to reset it; never delete a canonical Supabase row as a development reset.

Validation gate: `pnpm validate` (lint, typecheck, unit tests, build, fresh local Supabase migration reset, guardrails), then `pnpm test:e2e` for the production-build journey suite. The E2E wrapper reads the isolated local Supabase status without printing credentials; run `pnpm guardrails` first if the stack is not already active.

See [`AGENTS.md`](./AGENTS.md) for the operating contract every agent (human or AI) must follow before touching this repo.
