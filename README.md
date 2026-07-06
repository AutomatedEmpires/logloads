# LogLoads

**The timber truck operating network.** A regional load-board / marketplace that connects timber & log-truck capacity with available loads.

- **Name + domain are LOCKED:** LogLoads · logloads.com (GoDaddy). "LogBoard" is the retired placeholder — do not reintroduce.
- **Product truth lives in Notion** (AutomatedEmpires — Ventures → LogLoads Source of Truth). This repo is implementation truth.

## Stack (AutomatedEmpires family standard)

- Runtime: Node 24.16.0 · pnpm 10.12.4 · Turborepo monorepo
- Auth: Clerk · DB: Supabase Postgres (+ PostGIS) · Maps: Mapbox
- Secrets: Doppler · Hosting: Vercel · Media: Cloudinary · Observability: PostHog + Sentry · Email: Resend
- Icons: Phosphor through `@logloads/ui` semantic icon registry (`<Icon name="domain.action" />`)

## Getting started

```bash
nvm use            # Node 24.16.0
corepack enable
pnpm install
doppler run -- pnpm dev
```

See [`AGENTS.md`](./AGENTS.md) for the operating contract every agent (human or AI) must follow before touching this repo.
