# LogLoads — Deployment and Migration Contract

> **Status:** Revised 2026-11-03 for the fresh start. It covers the pilot runtime (§1–§3, §6), the V2 preview
> (§4), and the not-yet-approved normalized cutover (§5). Every earlier provider project, the Vercel project
> included, was deleted; [`INTEGRATIONS.md`](./INTEGRATIONS.md) is the runbook for recreating them.
>
> **This is not authorization to deploy.** `main` may auto-deploy to Vercel Production, so review and founder
> approval must come before any merge. The pre-revision text is retrievable with
> `git show 15892b7:docs/DEPLOYMENT.md`.

## 1. Present runtime (IMPLEMENTED)

| Property | Value |
|---|---|
| Host | Vercel, Node runtime. Project Root Directory `apps/web`; `apps/web/vercel.json` holds the cron, because Vercel reads `vercel.json` from the Root Directory ([`INTEGRATIONS.md`](./INTEGRATIONS.md) §5) |
| Toolchain | Node 24.16.0, pnpm 10.12.4 |
| Health | `GET /api/health` returns `200` only after canonical state loads, and exposes `VERCEL_GIT_COMMIT_SHA` (or `GITHUB_SHA`) for exact-SHA proof |
| Canonical data | Supabase `public.operating_state`, row `id=primary` |
| Concurrency | Optimistic compare-and-swap on a monotonic `version`, with deterministic replay |
| Local fallback | JSON snapshot only when `NODE_ENV != production`. Production fails closed when Supabase state is unavailable. |
| Disk/volume | Not required and not authoritative |

### Rate limiting

Shared limits use the service-role-only `consume_rate_limit` RPC with HMAC-derived keys. Missing, partial, or
unavailable configuration fails closed. **`LOGLOADS_RATE_LIMIT_HMAC_SECRET` is required.** The store falls
back to the service-role key for its own key material, but `requestClientKey()` throws without the dedicated
secret (`apps/web/lib/rate-limit-client-key.ts`).

*Correction:* the previous revision of this document called the secret "optional but recommended", which was
wrong.

### Legacy surfaces and hosting

- The pilot surfaces — `/driver`, `/fleet`, `/host`, `/admin`, `/pilot`, and the historical billing routes —
  still exist. Their commercial gates are disabled. They are not the V2 end state.
- `fly.toml` and `Dockerfile` are legacy-host rollback and reference artifacts only.

## 2. Environment responsibilities

| Category | Variables (IMPLEMENTED) | Target / change requirement |
|---|---|---|
| Application | `NEXT_PUBLIC_APP_URL=https://logloads.com`, `LOGLOADS_SESSION_SECRET` | No dev-login switch in production |
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-only) | Normalized integration needs reviewed grants, claims, and RLS |
| Clerk | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Environment-specific; Supabase third-party auth only after [`ACTIVATION_CLERK.md`](./ACTIVATION_CLERK.md) §4 |
| Abuse limits | `LOGLOADS_RATE_LIMIT_HMAC_SECRET` (required), `LOGLOADS_RATE_LIMIT_KEY_PREFIX` | Prove shared buckets across instances on the exact SHA |
| Maps | `NEXT_PUBLIC_CARTO_BASEMAP_KEY` (preferred; browser-visible, restrict by origin); legacy `NEXT_PUBLIC_MAPBOX_TOKEN` only when no CARTO key; keyless CARTO when neither | Verify the account-reported 5M requests/month entitlement and key restrictions in the CARTO account |
| Email | `RESEND_API_KEY` and identities | Production key only after authorization ([`ACTIVATION_RESEND.md`](./ACTIVATION_RESEND.md)) |
| Billing | Stripe credentials; historical collection gates **disabled** | New-model billing does not exist yet ([`ACTIVATION_STRIPE.md`](./ACTIVATION_STRIPE.md)) |

Exact rules: [`ENV_CONTRACT.md`](./ENV_CONTRACT.md) and `ops/production-env-contract.json`. Local workflow:
[`ENVIRONMENT.md`](./ENVIRONMENT.md). Provider setup and the Doppler config of each variable:
[`INTEGRATIONS.md`](./INTEGRATIONS.md). Where they disagree, inspect the code and correct every representation
together. Documentation does not change runtime validation.

Before and after each deployment, check the environment and compare it with the deployment:

```bash
doppler run --project logloads --config stg -- pnpm integrations:check --target staging --strict --health-url https://<origin>
```

`LOGLOADS_ALLOW_STATE_BOOTSTRAP=true` is a one-time provisioning switch. Use it only after proving
`operating_state` is intentionally empty (`pnpm supabase:post-provision state` under `doppler run`), then remove
it ([`INTEGRATIONS.md`](./INTEGRATIONS.md) §2.5). The established project should never need it.

## 3. Pilot migration ledger (IMPLEMENTED)

Apply `supabase/migrations/*.sql` in filename order. At `15892b7` there are 11 files:

| File | Notes |
|---|---|
| `20260604190000_backend_foundation.sql` | |
| `20260706090000_operating_network_phase2.sql` | |
| `20260706210000_operating_state_mirror.sql` | |
| `20260707050000_security_rls_coverage.sql` | Closed the anon-RW exposure — [`SECURITY.md`](./SECURITY.md) §1 |
| `20260711034301_canonical_operating_state.sql` | Additive: `schema_version` and `version`; service-role `SELECT`/`INSERT`/`UPDATE` only; no `SECURITY DEFINER`, no delete path |
| `20260713053327_shared_rate_limit_windows.sql` | Additive: counter table plus service-role-only RPC; bounded cleanup of expired rows only |
| `20260714051526_production_activation_profile_economics_media.sql` | |
| `20260716120000_dispatcher_publish_load.sql` | |
| `20260721232000_support_requests_state.sql` | |
| `20260726090000_revoke_public_relational_grants.sql` | |
| `20260808230214_admin_manage_billing_permission.sql` | |

CI applies the full ledger from empty on PostgreSQL 17 ([`CI.md`](./CI.md)). On a hosted project the ledger
is applied with one command, a dry run unless `--apply` is given
([`INTEGRATIONS.md`](./INTEGRATIONS.md) §2.3):

```bash
doppler run --project logloads --config stg -- pnpm supabase:post-provision migrations --apply
```

The fresh-start projects start empty, so the whole ledger applies. Whether a given project has every file is
not recorded in the repository: the dry run lists the pending ones, read-only.

Migrations are forward-only. Correct a defect with a new migration.

**`architecture/normalized-v2/` is not part of this ledger.** Never copy it into `supabase/migrations/`
without the §5 gates.

## 4. Readiness gates for a hosted V2 preview

`/v2` is disabled when `VERCEL_ENV=production`, but the code allows hosted Preview deployments when the flag
is set. Do not set `LOGLOADS_MARKETPLACE_V2` on a hosted Preview until all of these hold:

1. The exact branch SHA and its CI results are recorded. The preview uses an **isolated** Supabase project
   or row. It never shares a writable production `operating_state`. The fresh-start `logloads-staging` project
   behind Doppler `stg` is such a project ([`INTEGRATIONS.md`](./INTEGRATIONS.md) §2); the flag itself lives only
   in `dev` and `stg`, never in `prd`.
2. Private coordinates, gate directions, contacts, and inquiries are shown to be unreachable for other
   tenants and anonymous clients.
3. Hauler discover → interest → landing reply works at mobile and desktop widths. That includes a disabled
   map or weather and the closed-job case.
4. Payments, outbound email, and marketing stay inactive. No fictional customers or jobs are presented as
   real.
5. Evidence and failures are recorded in the PR, not only a green health response.

## 5. Normalized database cutover — NOT approved

1. **Execute the schema and tests in CI.**
   - `01`–`05` on a disposable PostgreSQL 17/PostGIS: **VERIFIED** at `ec4bb66` ([`CI.md`](./CI.md) §3).
   - `06`–`10` alignment: **VERIFIED in CI** on draft PR #123; the verified head is recorded in [`CI.md`](./CI.md) §3.
   - Still required:
     - review and merge of PR #123, and merge of the CI branch;
     - verified Clerk tokens through a configured **development** Supabase project
       ([`SECURITY.md`](./SECURITY.md) §4–§5).
2. Reconcile the schema with `MarketplaceV2Port` and the native job, inquiry, membership, equipment, and
   public/private separation.
3. Prove a synthetic migration from the current JSON snapshot. Keep stable IDs, quarantine invalid rows, and
   keep fee, trip, invoice, and webhook history in a read-only legacy store.
4. Validate:
   - read parity;
   - retention evidence;
   - a tested backup **and** restore ([`RECOVERY.md`](./RECOVERY.md) §9);
   - a dual-write or change-freeze strategy;
   - rollback;
   - cold starts.

   No rollback may re-enable a writer that overwrites newer state.
5. Get an independent review and explicit production authorization. Then migrate and deploy only the
   approved scope and exact SHA. If invariants fail, stop and restore.

`pnpm db:check` runs `supabase db reset --local`. Never point it at a populated or production-equivalent
stack. A local skip is not SQL validation.

## 6. Pilot cutover gates, rollback, and provenance (IMPLEMENTED procedure)

Before deploying a change that touches canonical-state handling:

1. Back up and verify the `operating_state` row with an authorized operator ([`RECOVERY.md`](./RECOVERY.md)).
2. Validate all migrations from an empty local Supabase. Upgrade a *copy* of the current row.
3. Deploy the exact SHA to a Preview backed by an isolated database. Never mutation-test against the
   production row.
4. Run `pnpm validate` and Playwright, then the smoke test with money-state assertions:

   ```bash
   SMOKE_BASE=<preview-url> SMOKE_EXPECT_FEE_COLLECTION=disabled \
     SMOKE_EXPECT_PERCENTAGE_ENROLLMENT=disabled node tools/production-smoke.mjs
   ```

5. Prove the concurrency contract:
   - two concurrent writers preserve independent changes;
   - a cold start loads Supabase before serving.
6. Prove shared rate-limit behavior on the exact Preview SHA:
   - two instances share buckets;
   - a `429` carries `Retry-After`;
   - an RPC outage returns `503`;
   - `LOGLOADS_RATE_LIMIT_TEST_MODE` is absent.
7. Confirm the Doppler → Vercel variables (`pnpm integrations:check --health-url <preview-url>` under
   `doppler run`, §2) and the deployment provenance. Vercel must build from a reviewed Git commit, never a
   dashboard upload.

**Rollback:**

- Keep the pre-change row backup and the previous canonical-aware SHA.
- Roll code back only to a canonical-aware SHA. The pre-canonical "mirror" writer predates compare-and-swap
  and needs maintenance mode, because it can overwrite newer state.
- On a write-path defect: stop mutations, capture the row, compare versions, restore only with explicit
  approval, and redeploy the known-good SHA.

The historical July 2026 cutover sequence, including DNS, is in Git history and the archived handoffs. It is
evidence, not an instruction for V2.
