# LogLoads

**The Timber Truck Operating Network.** Drivers, outfits, and loaders are connected through real-time hauls and lane matching.

- **Name + domain are LOCKED:** LogLoads · logloads.com (GoDaddy). "LogBoard" is the retired placeholder — do not reintroduce.
- **Product truth lives in Notion** (AutomatedEmpires — Ventures → LogLoads Source of Truth). This repo is implementation truth.

## Stack (AutomatedEmpires family standard)

- Runtime: Node 24.16.0 · pnpm 10.12.4 · Turborepo monorepo
- Auth: Clerk · DB: Supabase Postgres (+ PostGIS) · Maps: Mapbox
- Secrets: Doppler · Hosting: Vercel · Media: Cloudinary · Observability: PostHog + Sentry · Email: Resend
- Icons: Streamline (formal style — specific style TBD)

## Getting started

```bash
nvm use            # Node 24.16.0
corepack enable
pnpm install
doppler run -- pnpm dev
```

See [`AGENTS.md`](./AGENTS.md) for the operating contract every agent (human or AI) must follow before touching this repo.
