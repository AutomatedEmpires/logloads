# LogLoads Environment

## Local development
- Use Node `24.16.0` from `.nvmrc` and pnpm `10.12.4`.
- Run `corepack enable` once per shell.
- Install with `pnpm install`.
- Run the full local gate with `pnpm validate`.

## Local Supabase
- Dedicated local Postgres URL: `postgresql://postgres:postgres@localhost:55322/postgres`
- Dedicated local API URL: `http://127.0.0.1:55321`
- Local config file: `supabase/config.toml`
- Migration folder: `supabase/migrations/`
- Bootstrap seed state: `packages/db/src/seed-data.ts` (inserted only when the canonical row is intentionally empty and bootstrap is enabled)
- Validation command: `pnpm db:check`
- `pnpm db:check` starts the isolated API/database stack when needed and resets the PostgreSQL 17 migration ledger. It may skip locally when the CLI or Docker is absent, but CI fails rather than skipping.
- `pnpm test:e2e` requires that stack plus a production build. Its wrapper captures local service credentials in-process and never prints them.

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
  - `SUPABASE_SERVICE_ROLE_KEY`
- Optional server-only variables:
  - `VERCEL_TOKEN`
  - `SENTRY_DSN`
  - `RESEND_API_KEY`
  - `LOGLOADS_EMAIL_FROM`
  - `LOGLOADS_EMAIL_REPLY_TO` (defaults to `support@logloads.com`)
  - `LOGLOADS_CONTACT_EMAIL` (defaults to `support@logloads.com`)

## Sessions and identity
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` activate Clerk (production auth provider).
- `LOGLOADS_SESSION_SECRET` signs sessions; REQUIRED in production.
- `LOGLOADS_ENABLE_DEV_LOGIN=true` allows email dev sign-in in production-like builds without Clerk (never set in real production).
- Without Clerk keys, non-production environments use dev sessions automatically through the same session resolution path.

## Operating state
- Supabase `operating_state` is canonical whenever `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are present. Production requires both and never accepts the anon key for this row.
- Every request entry awaits the canonical row. Mutations compare `version`, replay on a conflict, and resolve only after the remote commit succeeds.
- `LOGLOADS_STATE_FILE` overrides the non-production fallback path (default `apps/web/.data/logloads-state.json`). Delete that file only to reset local development state.
- `LOGLOADS_ALLOW_STATE_BOOTSTRAP=true` allows one controlled insert when the remote row is intentionally empty. Leave it unset in established production and remove it immediately after a planned bootstrap.

## Maps
- `NEXT_PUBLIC_MAPBOX_TOKEN` activates Mapbox (locked provider). Without it, the map renders real geography through the MapLibre + Carto fallback.

## Placeholders and future providers
- Notification provider placeholder: `NOTIFICATION_PROVIDER=placeholder`
- Do not commit secrets while provider choice is still fluid.
