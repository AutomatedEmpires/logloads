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

## Placeholders and future providers
- Map provider placeholder: `NEXT_PUBLIC_MAP_PROVIDER=placeholder`
- Notification provider placeholder: `NOTIFICATION_PROVIDER=placeholder`
- Do not commit secrets while provider choice is still fluid.