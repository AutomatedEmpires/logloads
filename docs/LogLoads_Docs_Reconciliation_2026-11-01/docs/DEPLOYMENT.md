# LogLoads — Deployment and Migration Contract

> **Status:** Current pilot runtime plus separately gated V2 release strategy. Updated November 1, 2026. This is not authorization to deploy. `main` may be connected to an automatic Vercel production deployment, so review and approval must precede any merge.

## Present runtime (do not confuse with target)

- The existing deployed pilot uses Vercel/Next.js, Node 24, pnpm 10.12, Clerk identity when configured, and a single versioned Supabase `public.operating_state` row as canonical business persistence.
- `apps/web/lib/services.ts` refreshes and conditionally commits the JSON state with optimistic `version` compare-and-swap and replay. Non-production may use a local JSON fallback; production must fail closed when Supabase state is unavailable.
- Production shared rate limiting uses the Supabase `consume_rate_limit` RPC with HMAC-derived keys. The caller-key function requires `LOGLOADS_RATE_LIMIT_HMAC_SECRET` even though the store has a service-role-key fallback; provision the dedicated HMAC secret in real environments.
- Existing historical `/driver`, `/fleet`, `/host`, `/admin` routes and financial reconciliation may still exist as disabled/historical pilot paths. They are not the approved V2 end-state.
- `/v2` remains development-only under `LOGLOADS_MARKETPLACE_V2=enabled`; `VERCEL_ENV=production` disables it. It currently derives posting views from pilot state and adds `marketplaceInterests`. It is **not** a production-ready normalized application.
- `fly.toml` and Docker-specific hosting files are legacy/rollback references, not a reason to change the approved Vercel deployment configuration.

## Target architecture

The accepted destination is normalized tenant-scoped PostgreSQL/PostGIS in Supabase, secure Clerk third-party auth integration, and a `MarketplaceV2Port` normalized adapter. Gemini's `architecture/normalized-v2/` files are *prototype SQL*, not deployed migration history. Do not imply the old SQL mirror has become operational merely because scripts exist.

## Environment and provider responsibilities

| Category | Current environment | Target or change requirement |
|---|---|---|
| Application | `NEXT_PUBLIC_APP_URL`, `LOGLOADS_SESSION_SECRET` | Correct domain, no dev-login switch in real production |
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Server-only credentials; normalized integration requires reviewed grants, claims and RLS |
| Clerk | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Verified, environment-specific issuer/JWKS and identity link mapping |
| Abuse limits | `LOGLOADS_RATE_LIMIT_HMAC_SECRET` | Dedicated high-entropy server-only key; shared RPC proved across instances |
| Maps | Existing Mapbox token / MapLibre fallback as implemented | MapLibre + CARTO Basemaps target; key variable only after code confirms its naming; reported 5M monthly entitlement is account-specific |
| Email | `RESEND_API_KEY` if authorized | Verified LogLoads sender and intentional delivery; no invented delivery guarantees |
| Billing | Existing Stripe credentials/disabled historical collection flags | New Basic/Pro/Regional and boosts remain off pending terms, counsel, test-mode proof and explicit launch approval |

Detailed actual variable scopes are in `docs/ENV_CONTRACT.md`, `docs/ENVIRONMENT.md`, `.env.example` and the machine-readable `ops/production-env-contract.json`. Where they disagree, **inspect the deployed code and correct all representations together**; documentation does not automatically change runtime validation.

## Readiness gates for V2 preview

1. Verify exact branch/commit SHA and CI results. Use isolated Vercel Preview and isolated preview data; never share a writable production `operating_state` row.
2. Prove private coordinates, gate directions, contacts and inquiries cannot be exposed to other tenants or anonymous clients.
3. Exercise hauler discover → express interest → landing reply at mobile and desktop widths, including disabled map/weather and closed-job cases.
4. Keep payments and outbound marketing inactive, with no fictional real customers or jobs.
5. Record failures and evidence in a PR, not merely a green health response.

## Normalized database cutover — not yet approved

1. **Execute** proposed SQL 01/02/03 and integration tests 04 in a disposable PostgreSQL 17+/PostGIS environment. Include concurrent separate-session entitlement tests, authenticated/anonymous RLS denial and verified Clerk token behavior.
2. Reconcile target schema with the actual `MarketplaceV2Port`: job authoring, search/detail, inquiry, reply, withdraw, memberships, equipment and the public/private separation.
3. Prove a synthetic migration from the current JSON snapshot; map stable identities, handle invalid historic records without data loss, and preserve fee/trip/invoice/webhook history in a read-only legacy system.
4. Validate read parity, financial and data retention evidence, backups (including tested restore), dual-write/change-freeze strategy if needed, rollback and cold starts. No rollback may re-enable an obsolete writer that overwrites newer state.
5. Independently review the release, obtain explicit production authorization, then migrate/deploy only the approved scope and exact SHA. Stop and restore service using the planned recovery procedure if invariants fail.

**Important:** `pnpm db:check` currently invokes `supabase db reset --local`; it resets the selected *local* migration ledger and test data. Do not point it at a populated or production-equivalent project. A local skip without prerequisites does not count as SQL validation.

## Monitoring and rollback

Before cutover, record current production SHA, verified backup, security and money gates, incident owner and rollback SHA. After cutover, verify tenant boundaries, fresh jobs, responses, rate-limit errors, email delivery only when intended, and monitoring. Never infer real payment processing or customer adoption from configured provider keys.

Historical deployment steps and timestamps in prior versions were evidence for the 2026 pilot, not automatically correct for V2; preserve important records in existing Git history and dated decisions.
