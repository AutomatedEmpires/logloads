# LogLoads Environment

## Local development
- Use Node `24.16.0` from `.nvmrc` and pnpm `10.12.4`.
- Run `corepack enable` once per shell.
- Install with `pnpm install`.
- Run the full local gate with `pnpm validate`.

## Local Supabase
- Default local Postgres URL: `postgresql://postgres:postgres@localhost:54322/postgres`
- Local config file: `supabase/config.toml`
- Migration folder: `supabase/migrations/`
- Seed folder: `supabase/seed/`
- Validation command: `pnpm db:check`
- If Supabase CLI is not installed, `pnpm db:check` skips cleanly and prints the manual command.

## Linked Supabase project
- Required variables:
  - `SUPABASE_PROJECT_REF`
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
- These values belong in Doppler, GitHub Actions secrets, or Vercel env, not in git.

## GitHub Actions
- Required workflow-time env/secrets depend on the workflow:
  - `GITHUB_TOKEN` is provided automatically by GitHub Actions.
  - Dependency review uses the default GitHub token.
  - Future deployment workflows should read Vercel and Supabase secrets from repo/org secrets.

## Vercel / deployment
- Required variables for the web app:
  - `NEXT_PUBLIC_APP_URL`
  - `NEXT_PUBLIC_MAP_PROVIDER`
  - `NEXT_PUBLIC_MAPBOX_TOKEN`
  - `NEXT_PUBLIC_NOTIFICATION_PROVIDER`
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
- Optional server-only variables:
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `VERCEL_TOKEN`
  - `SENTRY_DSN`
  - `RESEND_API_KEY`

## Sessions and identity
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` activate Clerk (production auth provider).
- `LOGLOADS_SESSION_SECRET` signs sessions; REQUIRED in production.
- `LOGLOADS_ENABLE_DEV_LOGIN=true` allows email dev sign-in in production-like builds without Clerk (never set in real production).
- Without Clerk keys, non-production environments use dev sessions automatically through the same session resolution path.

## Operating state
- `LOGLOADS_STATE_FILE` overrides the snapshot path (default `apps/web/.data/logloads-state.json`).
- Delete the snapshot file to reset local state to the date-shifted seed.

## Maps
- `NEXT_PUBLIC_MAPBOX_TOKEN` activates Mapbox (locked provider). Without it, the map renders real geography through the MapLibre + Carto fallback.

## Placeholders and future providers
- Notification provider placeholder: `NOTIFICATION_PROVIDER=placeholder`
- Do not commit secrets while provider choice is still fluid.