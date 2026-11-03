# LogLoads — Local Environment

> **Status:** IMPLEMENTED behavior, last verified 2026-11-02 against `4c9518e`. Scope: local development only.
> Production variables and their fail-closed rules are in [`ENV_CONTRACT.md`](./ENV_CONTRACT.md). Deployment is
> in [`DEPLOYMENT.md`](./DEPLOYMENT.md). CI is in [`CI.md`](./CI.md).

## 1. Toolchain and first run

- Native Windows 11 checkout (Cursor). WSL, Docker Desktop and local PostgreSQL are **not** needed and must not
  be installed for ordinary work.
- Node **24.16.0** (`.nvmrc`, via fnm or nvm). pnpm **10.12.4** via Corepack. In PowerShell, use `pnpm.cmd` if the
  execution policy blocks `pnpm.ps1`.
- Non-interactive shells may not load fnm. Check `node -v` before trusting any result.

```powershell
node -v; pnpm --version
pnpm install --frozen-lockfile
pnpm setup:local     # one time: writes git-ignored apps/web/.env.local
pnpm dev             # 127.0.0.1:3002 only; open http://localhost:3002
```

- `pnpm --filter @logloads/web dev:webpack` is an alternative dev server, also on loopback port 3002.
- Never run a production build into `apps/web/.next` while `pnpm dev` is using it. Build from a separate worktree
  instead, and delete it afterwards.

## 2. `apps/web/.env.local`

`tools/setup-local-env.mjs` fills only empty values. It refuses to run in CI or on Vercel, and never prints
secrets. It writes:

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:3002
LOGLOADS_SESSION_SECRET=<generated>
LOGLOADS_RATE_LIMIT_HMAC_SECRET=<generated>
```

- `NEXT_PUBLIC_APP_URL` must be a loopback origin, or seeded sign-in stays off.
- `LOGLOADS_RATE_LIMIT_HMAC_SECRET` is required: `requestClientKey()` throws without it
  (`apps/web/lib/rate-limit-client-key.ts`).
- It writes **no** provider credentials, so local development uses the JSON store and seeded sign-in.
- Do not point local development at a hosted Supabase project unless an issue explicitly scopes it.

## 3. Sign-in

- **Without Clerk keys**, use a seeded email address:
  - `hank@northpine.example`
  - `dispatch@northpine.example`
  - `cole@summit.example`
  - `admin@logloads.example`

  This only works on loopback and outside production.
- `LOGLOADS_ENABLE_DEV_LOGIN=true` is a development and test switch. **Never** set it on Production or on a
  public Preview.
- With Clerk keys (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`), Clerk resolves identity
  ([`ACTIVATION_CLERK.md`](./ACTIVATION_CLERK.md)).

## 4. Local state

- The JSON fallback is `LOGLOADS_STATE_FILE`, default `apps/web/.data/logloads-state.json`. Deleting it resets
  **local** state only.
- Never treat a hosted `operating_state` row or a backup file as disposable.
- Seed data is synthetic. Never present it as real activity.

## 5. Local Supabase (optional)

`supabase/config.toml` configures the local stack:

| Setting | Value |
|---|---|
| Project | `logloads-local` |
| Database | PostgreSQL 17 on `localhost:55322` |
| API | `127.0.0.1:55321` |

- `pnpm db:check` runs `supabase db reset --local`, which **destroys local database data**. Without the Supabase
  CLI and Docker it skips and exits 0 — that is not a pass.
- The normalized-v2 SQL is not run locally. It runs in CI ([`CI.md`](./CI.md) §3).

## 6. Feature flags and maps

**V2 preview.** `LOGLOADS_MARKETPLACE_V2=enabled` turns on `/v2`.

- It is always off when `VERCEL_ENV=production`.
- When disabled, `/v2` returns `notFound()`. The layout is always `noindex`.
- Keep it to local development until an isolated hosted preview is approved
  ([`DEPLOYMENT.md`](./DEPLOYMENT.md) §4).

**Maps.** `apps/web/lib/map-runtime.ts` chooses a provider in this order:

1. offline demo;
2. keyed CARTO on MapLibre, when `NEXT_PUBLIC_CARTO_BASEMAP_KEY` is set;
3. legacy Mapbox, only when there is no CARTO key and `NEXT_PUBLIC_MAPBOX_TOKEN` is set;
4. keyless CARTO.

Further map rules:

- `carto-basemap.ts` sends the key only to HTTPS `*.basemaps.cartocdn.com`.
- A CARTO key is browser-visible. Restrict it by origin (`http://localhost:3002`, `http://127.0.0.1:3002`) and
  keep dev and prod keys separate.
- Never paste a key into issues, chat or screenshots.
- The founder-reported 5M requests/month allowance is **UNVERIFIED**.

## 7. Known `.env.example` drift (tracked as an issue)

- Missing: `NEXT_PUBLIC_CARTO_BASEMAP_KEY`, `LOGLOADS_MARKETPLACE_V2`.
- Listed but read by no code at `4c9518e`: `NEXT_PUBLIC_MAP_PROVIDER`, `NOTIFICATION_PROVIDER`,
  `NEXT_PUBLIC_NOTIFICATION_PROVIDER`, `VERCEL_TOKEN`.
