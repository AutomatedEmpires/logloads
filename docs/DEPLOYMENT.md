# LogLoads — Production Deployment Contract

Single-node deployment contract for the current architecture. Everything here is
prepared; the only remaining founder action is **approve/create the paid host**.
After that, deployment is mechanical.

## Architecture constraint (why single-node)

The operating engine is an in-memory state held on `globalThis`, mutated single-writer,
persisted to a local JSON snapshot and mirrored to Supabase. **It must run as exactly
one process/instance.** Two instances fork state. Scale vertically. Horizontal scaling
requires making Postgres the canonical store — deliberately **out of scope** for first
launch (see `docs/DECISIONS.md`).

## Deployment contract

| Property | Value |
|---|---|
| Build | `Dockerfile` (repo root), multi-stage, Node 24.16.0-slim, `pnpm --filter @logloads/web build` |
| Runtime command | `pnpm --filter @logloads/web start` (`next start -H 127.0.0.1 -p 3002`) |
| Internal port | **3002** |
| Health check path | `GET /api/health` → `200` when healthy, `503` when engine degraded |
| Persistent volume | REQUIRED, mounted at `/data`; `LOGLOADS_STATE_FILE=/data/logloads-state.json` |
| Instances | **exactly 1** (single-writer). Never autoscale > 1. |
| Memory | 512 MB floor; **1 GB recommended** (Next.js server + in-memory state + Playwright-free runtime). State grows ~17 KB per few accounts; comfortably fits RAM for launch scale. |
| CPU | 1 shared vCPU sufficient for launch; the per-request `buildNetworkView` is O(loads × trucks) — revisit if either grows into the thousands. |
| Restart policy | `on-failure` / `always`; state survives restart via the `/data` volume + Supabase mirror. |
| SSL | terminated at the host/edge (Fly/Railway provide it); app serves plain HTTP internally. |

## Environment + secrets

See `ops/production-env-contract.json` (machine-readable) and `docs/ENV_CONTRACT.md`.
Minimum to boot safely in production:

- `LOGLOADS_SESSION_SECRET` (**required** — app throws without it in prod)
- `LOGLOADS_STATE_FILE=/data/logloads-state.json`
- `NEXT_PUBLIC_APP_URL=https://logloads.com`
- `NODE_ENV=production` (set by the image)

Everything else is feature-gated and activates when its keys are present (Clerk,
Stripe, Resend, PostHog, Sentry, Supabase mirror). The app boots and is healthy
without any of them — it degrades honestly (dev-session auth off in prod means the
cockpits require Clerk; see the Clerk runbook).

Secrets are stored in **Doppler (logloads project)** and injected into the host's
secret store. Never in the image, never in `NEXT_PUBLIC_` for anything secret. The
Supabase **service-role** key is server-only.

## First-boot behavior

1. `LOGLOADS_SESSION_SECRET` is read (throws if missing in prod).
2. State is loaded: disk snapshot at `LOGLOADS_STATE_FILE` if present; otherwise the
   Supabase mirror (`operating_state`) if `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
   are set; otherwise the date-shifted seed.
3. On the very first production boot with an empty volume and an empty mirror, the app
   starts from **seed data**. For a clean production launch, either accept the seed
   (demo orgs/loads) or clear it — see "Reset to empty" below.

## Migration order (fresh environment)

Apply `supabase/migrations/*.sql` in filename order:

1. `20260604190000_backend_foundation.sql`
2. `20260706090000_operating_network_phase2.sql` (PostGIS, RLS, `request_capacity` RPC)
3. `20260706210000_operating_state_mirror.sql`
4. `20260707050000_security_rls_coverage.sql` (RLS coverage + mirror lockdown + fn hardening)

The **live project `fdzohbiiyzgvjzfsjyxo` already has all four applied.** The files are
idempotent; re-applying is safe. The live ledger was written by the Supabase MCP
(apply-time timestamps), so ledger versions differ from filenames — this is expected;
the SQL is the source of truth.

## Backup / restore

- **Primary store:** the `/data` volume JSON snapshot. Back it up with the host's
  volume snapshot feature (Fly volumes support scheduled snapshots).
- **Mirror:** the Supabase `operating_state` row (service-role only). It is a single
  row overwritten on each mutation — it is a *latest-state* mirror, **not** point-in-time
  history. For point-in-time recovery, enable Supabase PITR (paid) or snapshot the `/data`
  volume on a schedule.
- **Restore:** drop a known-good `logloads-state.json` onto the `/data` volume and
  restart; OR clear the volume and let the app restore from the Supabase mirror at boot.

## Reset to empty (clean production launch)

Before public launch, to start with no demo data: stop the node, remove
`/data/logloads-state.json`, and clear the mirror row
(`delete from public.operating_state;` via service role), then boot. The app will seed
— to launch truly empty, seed can be disabled by shipping an empty snapshot file. (The
seed is convenient for demos; the founder chooses.)

## Rollback

- **Code:** redeploy the previous image tag (Fly/Railway keep image history) or
  `git revert` + redeploy. The app is stateless-per-deploy; state lives on the volume.
- **Migration:** migrations are additive/idempotent; there is no destructive down-migration.
  A bad schema change would be corrected by a new forward migration.

## Preferred host: Fly.io (manifest committed as `fly.toml`)

Fly is the best fit: first-class **persistent volumes**, single-machine pinning,
Docker-native, edge SSL, health checks. `fly.toml` is committed with the exact
contract above. Activation:

```bash
fly launch --no-deploy            # or `fly apps create logloads`
fly volumes create logloads_data --size 1 --region sjc   # 1 GB persistent volume
fly secrets set LOGLOADS_SESSION_SECRET=... NEXT_PUBLIC_APP_URL=https://logloads.com \
  SUPABASE_URL=https://fdzohbiiyzgvjzfsjyxo.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=... CLERK_SECRET_KEY=... ...   # from Doppler
fly deploy
fly status                        # confirm 1 machine, health check passing
```

Then attach the domain:

```bash
fly certs add logloads.com
fly certs add www.logloads.com
# add the A/AAAA (apex) and CNAME (www) records fly prints, at the DNS provider
fly certs show logloads.com       # verify issued
```

**Railway alternative:** deploys the same Dockerfile; add a volume mounted at `/data`,
set the same env, expose port 3002, health path `/api/health`. Config via dashboard or
`railway.json`.

## Post-deploy proof

Run `node tools/production-smoke.mjs` against the deployed URL (see the script header).
It proves health, auth, onboarding, the operating loop, messaging, and — where keys
exist — billing/email/analytics/errors. See also the billing proof in
`docs/ACTIVATION_STRIPE.md` and `tools/verify-billing.mjs`.

## Founder gate (this phase)

> **Approve/create the Fly.io app + 1 GB volume (or the chosen equivalent host).**
> Everything else — build, run command, port, health, volume path, env inventory,
> migration order, backup/restore, rollback — is defined above and in `fly.toml`.
