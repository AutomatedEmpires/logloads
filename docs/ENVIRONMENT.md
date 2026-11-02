# LogLoads — Environment & Provider Configuration

> **Updated:** November 1, 2026  
> **Purpose:** Development, testing, provider configuration, and deployment reference for the LogLoads timber-hauling marketplace.  
> **Authority:** `AGENTS.md`, `docs/DECISIONS.md`, `docs/product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md`, `docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md`, and `docs/product/TRANSITION_PLAN.md`.  
> **Accuracy convention:** **CURRENT** means observed in the checked-in `work/logloads-repair` code or documented existing runtime; **TARGET** means the approved architecture or a change still to be implemented; **CONDITIONAL** means dependent on the relevant service, environment, or code path. Do not represent TARGET configuration as already operational.

## 1. Environment principles and product boundaries

- LogLoads is a timber-hauling **load board and recruiting marketplace**, not a dispatch, trip-accounting, freight-settlement, or load-payment service.
- Hauler and fleet business workspaces remain free. Landing organizations use the adopted Basic, Pro, and Regional membership model when paid access is eventually activated. No paid plans, boosts, or outbound invitation purchases are live merely because environment variables or test artifacts exist.
- **CURRENT:** The deployed/pilot application's canonical operating data is stored in the versioned `public.operating_state` Supabase document. **TARGET:** A normalized, tenant-isolated PostgreSQL/PostGIS architecture under the isolated `architecture/normalized-v2/` prototype, once integration tests and an authorized migration plan pass.
- Current runtime behavior and target product architecture must be documented separately. No agent may silently switch providers, enable live billing, migrate production data, or deploy because a specification references the target.
- Never commit credentials, `.env.local`, provider service-role keys, session secrets, private access instructions, or production data snapshots.

## 2. Supported local workflow

**CURRENT:** Native Windows 11 working copy in Cursor. WSL is not required for ordinary development. Other operating systems may work, but Windows-specific tests do not by themselves establish cross-platform parity.

- Repository working copy: `C:\Users\Cole0\AutomatedEmpires\Projects\logloads` (machine-specific; do not hardcode into application code).
- Node.js: `24.16.0`, selected by `.nvmrc` using fnm or nvm.
- Package manager: pnpm `10.12.4`, defined in root `package.json`; Corepack may be used to provision it.
- Non-interactive terminals may not inherit fnm's shell initialization. Check `node -v` and `pnpm --version` before relying on build or test results.
- Install dependencies with `pnpm install --frozen-lockfile`.
- First-run local setup: `pnpm setup:local`.
- Launch local app with `pnpm dev`; the development server binds **`127.0.0.1:3002`**, not all network interfaces.
- Open in the browser at `http://localhost:3002` (or the loopback address configured consistently in the application).
- `pnpm --filter @logloads/web dev:webpack` is an alternate local server command that also binds loopback port 3002.
- Do not run a production build into `apps/web/.next` while an active development server uses that directory. Use an isolated build directory or a carefully managed separate worktree when necessary, and clean up generated artifacts afterward.
- Agents sharing the repository must coordinate file ownership, Git staging and commits; do not overwrite another agent's uncommitted files.

Typical first-run commands:

```powershell
node -v
pnpm --version
pnpm install --frozen-lockfile
pnpm setup:local
pnpm dev
```

Do not claim that `pnpm validate` passed merely because an underlying database check was **skipped** on a machine without Docker/Supabase CLI.

## 3. Local environment file and development login

**CURRENT:** `tools/setup-local-env.mjs` creates or completes the Git-ignored file `apps/web/.env.local` without overwriting existing nonempty values. It refuses CI/Vercel runtimes, generates random values locally, and does not print secret values.

It supplies only these settings:

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:3002
LOGLOADS_SESSION_SECRET=<randomly-generated-local-secret>
LOGLOADS_RATE_LIMIT_HMAC_SECRET=<randomly-generated-local-secret>
```

The placeholder strings above are explanatory, **not** credentials to paste. Use `pnpm setup:local` to generate actual secrets.

- `NEXT_PUBLIC_APP_URL` must point to an approved loopback origin for seeded development sign-in; the local server remains loopback-bound.
- `LOGLOADS_SESSION_SECRET` signs the application's local session implementation; production must use a separate production secret.
- `LOGLOADS_RATE_LIMIT_HMAC_SECRET` is required by the checked-in `apps/web/lib/rate-limit-client-key.ts` request-key derivation. Without it, rate-limited routes invoking `requestClientKey()` can throw an error.
- This setup deliberately does **not** write Clerk, Supabase, Stripe, CARTO, Mapbox, email, or other provider credentials.
- Do not configure a real production Supabase URL in local development unless an explicitly scoped, read-only or otherwise authorized task requires it. Use local JSON state or a disposable local database.
- On Windows, a Unix file mode such as `0600` is not a substitute for confirming Windows filesystem permissions when sharing machines.

### Clerk and development sessions

- **CURRENT:** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` configure Clerk where that integration is enabled. Clerk is the selected production identity provider.
- **CURRENT:** Local seeded sessions are a development convenience, **not** a production sign-in option. They depend on the applicable non-production and loopback authorization checks, not merely on the absence of Clerk keys.
- `LOGLOADS_ENABLE_DEV_LOGIN=true` is a developer/test switch and **must never be enabled on real production or public hosted Preview**.
- **TARGET:** Normalized Supabase table access will use validated Clerk-to-Supabase third-party authentication and explicit database authorization/RLS. Never trust client-supplied user IDs, organization IDs or role values as proof of access.
- **CURRENT:** Production auth still requires verification of the actual deployed environment; development success does not prove the production integration.

## 4. Local Supabase / PostgreSQL — optional test environment

**CURRENT repository configuration** (`supabase/config.toml`):

| Item | Local-only value |
|---|---|
| Project ID | `logloads-local` |
| PostgreSQL URL | `postgresql://postgres:postgres@localhost:55322/postgres` |
| API URL | `http://127.0.0.1:55321` |
| DB version configured | PostgreSQL 17 |
| Migration directory | `supabase/migrations/` |
| Canonical seed module | `packages/db/src/seed-data.ts` |
| Database test script | `pnpm db:check` |

These are configured **addresses, not proof that a database is currently running**. A local Supabase CLI installation and running Docker daemon are required by `tools/db-check.sh`.

**Safety-critical:** `pnpm db:check` invokes `supabase db reset --local`. This resets the **local** Supabase database, reapplies migrations and can discard local test data. It is not a production-safe or non-destructive inspection command. Confirm the selected stack is disposable before running it.

- If Docker or Supabase CLI is missing, the checked-in script may **skip** local DB validation with a success exit. CI is configured to fail rather than silently skip.
- `pnpm test:e2e` requires the appropriate local stack and a production build; do not treat a skipped run as a passing integration test.
- Local seed/bootstrap state must not be confused with real registered companies, customers or job postings.
- **TARGET:** `architecture/normalized-v2/01_schema.sql` through `04_tests.sql` remain **non-active prototype files** until executed, repaired and verified in an explicitly disposable PostgreSQL/PostGIS environment. Do not assume that running the existing `pnpm db:check` automatically tests these prototype files.
- Never apply the normalized prototype to the linked production Supabase project without an approved migration, backup, rollback plan, data-parity tests and an explicit authorization.

## 5. Linked Supabase project and secrets

The linked canonical Supabase deployment uses the relevant subset of:

- `SUPABASE_PROJECT_REF` — project identifier for administrative tooling when required.
- `SUPABASE_URL` — selected deployment's API endpoint.
- `SUPABASE_ANON_KEY` — legacy public client key only for flows that actually require it; new Supabase publishable keys may supersede it when the application is intentionally updated.
- `SUPABASE_SERVICE_ROLE_KEY` — **server-only privileged credential**; never prefix with `NEXT_PUBLIC_`, embed in browser code, expose to logs or put in the repository.

Store real credentials in approved environment-specific secret managers (e.g., configured Vercel environment settings, GitHub Actions secrets and/or Doppler). A local `.env.local` file is acceptable only for explicitly approved local/non-production credentials. Separate development, preview and production resources wherever practical.

**CURRENT:** When `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured, the pilot's `public.operating_state` remains canonical. Production does not use an anon key as authority for writes to that document.

## 6. Operating-state persistence (current pilot)

- **CURRENT:** `public.operating_state` is a versioned document, with optimistic compare-and-swap and replay/retry semantics for conflicting mutations.
- `LOGLOADS_STATE_FILE` selects the non-production JSON fallback. Default: `apps/web/.data/logloads-state.json`.
- Deleting the JSON fallback intentionally resets **local development state only**; never treat a production database or shared backup as a disposable development file.
- `LOGLOADS_ALLOW_STATE_BOOTSTRAP=true` allows a controlled initial remote row when canonical storage is empty. Do not enable this against an established production database.
- Existing historical dispatch, financial, invoice and audit records must remain retained and accessible under an explicit preservation strategy even though the V2 marketplace no longer creates those records.
- **TARGET:** Read adapters, parity checks and explicit cutover gates will migrate active marketplace functionality to normalized, tenant-isolated Supabase tables. A schema prototype is not a migration authorization.

## 7. Marketplace V2 preview (not production)

**CURRENT:** `LOGLOADS_MARKETPLACE_V2=enabled` enables isolated `/v2` development routes for job discovery, job detail, expressions of interest, hauler inquiries and the landing inbox. Other values disable the preview; `VERCEL_ENV=production` also disables it. The route guard is reported to return a `404` with `noindex` when disabled.

- The initial V2 UI reads redacted posting data from the pilot operating state and persists inquiry data to the additive `marketplaceInterests` collection.
- This is an interim preview adapter. It is **not** proof that normalized-v2 SQL, Clerk-to-Supabase authentication, or RLS has been integrated.
- The preview must not create new assignments, dispatch trips, settlement records, percentage-fee charges, boosts, subscriptions or paid targeted invitations.
- Do not set this flag on hosted Preview or Production without an explicitly approved, secured deployment plan, even if the code would technically permit some preview environments.
- Publish factual state labels; seeded or synthetic postings must not be presented as real customer activity.

## 8. Rate limiting and abuse protection

**CURRENT:** Rate limiting contains two distinct HMAC-related paths that should not be conflated:

1. **Caller-key derivation** (`apps/web/lib/rate-limit-client-key.ts`): `requestClientKey()` requires a configured `LOGLOADS_RATE_LIMIT_HMAC_SECRET`; there is no service-role fallback in this function.
2. **Distributed store-key configuration** (`apps/web/lib/rate-limit-config.ts`): when both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exist, the store's `keySecret` currently uses the dedicated HMAC secret **or falls back to the service-role key**. This does **not** override the caller-key requirement above.

Accordingly, configure a dedicated high-entropy `LOGLOADS_RATE_LIMIT_HMAC_SECRET` in every environment that runs protected routes. The separate store fallback is existing implementation behavior, **not** the recommended long-term secret-management policy.

Other current boundaries:

- Production distributes counters through the Supabase `consume_rate_limit` RPC, with atomic fixed-window updates shared across app instances when configured correctly.
- `LOGLOADS_RATE_LIMIT_KEY_PREFIX` optionally namespaces rate-limit buckets; its default is `logloads:rate-limit`.
- Raw client IPs and emails must not be persisted as limiter keys; use keyed digests.
- On Vercel, `x-vercel-forwarded-for` is the trusted platform-overwritten IP signal in the checked-in request-key logic. Off supported proxy trust boundaries, other client-supplied forwarding headers must not be trusted as verified IPs.
- If Supabase is absent in non-production, process-local memory limiting can be used. Partial Supabase credentials lead to an unavailable store; production must not quietly fall back to in-memory limiting.
- `LOGLOADS_RATE_LIMIT_TEST_MODE=true` is allowed only under the implementation's strict local test conditions and must never be enabled on public hosted deployments.
- Changing HMAC material can reset or fragment existing rate-limit buckets; rotate deliberately with deployment and operational awareness.
- Provider migration, multi-instance/outage testing and production HMAC configuration require explicit review. A green local test is not enough to claim distributed fail-closed behavior.

## 9. Maps and geography — CURRENT versus TARGET

### CURRENT checked-in behavior

- The existing app still documents `NEXT_PUBLIC_MAPBOX_TOKEN` as the trigger for Mapbox rendering, with MapLibre and public CARTO tiles used as a fallback where implemented.
- The presence of a CARTO account or key does **not** establish that the application already sends authorized CARTO basemap requests.
- Map rendering and map-provider configuration must be verified against the actual app code and network requests before describing an integration as complete.

### TARGET: approved LogLoads mapping stack

- **MapLibre GL JS** — preferred interactive map renderer.
- **CARTO Basemaps** — preferred basemap tile/style provider. The account holder reports an entitlement of **5,000,000 basemap requests per month**; verify billing scope, terms, and whether keys share that allowance in CARTO's dashboard.
- **Supabase/PostGIS** — geographic searches, proximity checks and tenant-authorized spatial queries.
- **Weather provider** — separately integrated conditions and forecasts; CARTO does not provide job-specific weather.
- **Routing/distance provider (if introduced)** — separate from basemap tiles. Straight-line radius must be labeled as such; do not present it as driving mileage.

### CARTO environment-variable convention (proposed until implemented)

For a browser-side CARTO Basemaps key, use the following **proposed** variable only after confirming it matches the actual map integration:

```dotenv
NEXT_PUBLIC_CARTO_BASEMAP_KEY=<CARTO_BROWSER_BASEMAP_KEY>
```

- The key value must live in an ignored local env file or the appropriate environment's secure configuration; do not paste it into repository files, issues or AI messages.
- A `NEXT_PUBLIC_` key is **visible to browser users** after bundling. Domain/referrer restrictions and provider-side usage monitoring, not secrecy alone, protect public basemap usage.
- Where supported, use separate development/production keys and only authorize the corresponding origins/domains. Development origins may include `http://localhost:3002` and `http://127.0.0.1:3002` in CARTO's accepted restriction syntax.
- The style, tile, glyph and sprite requests must work with the intended key configuration; verify in browser network traces without exposing raw credentials in logs or screenshots.
- Preserve CARTO and OpenStreetMap attribution as required by provider terms and chosen style.
- Lazy-load maps and imagery so text results remain useful under weak rural connections and tile requests stay proportional to actual map usage.
- Separate public approximate landing pins from private exact access information. Never derive or reveal gate codes or restricted road instructions through public map links.
- `NEXT_PUBLIC_MAP_PROVIDER` and `NEXT_PUBLIC_MAPBOX_TOKEN` remain **legacy/current-code configuration** until an approved MapLibre/CARTO switchover is implemented and tested. Do not remove them solely by editing this document.

## 10. Web deployment and Vercel

The environment-dependent variables below are a **configuration inventory**, not a claim that every listed variable is mandatory in all deployments:

| Variable | Scope | Status / purpose |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Browser-visible | Canonical application URL, per environment |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Browser-visible | Clerk client identity when enabled |
| `CLERK_SECRET_KEY` | Server-only | Clerk server authentication |
| `LOGLOADS_SESSION_SECRET` | Server-only | Session signing; required by production session paths |
| `LOGLOADS_RATE_LIMIT_HMAC_SECRET` | Server-only | Required for caller-key derivation on protected routes |
| `SUPABASE_URL` | Server/integration | Supabase endpoint for canonical application state |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only, privileged | Canonical state and current distributed rate-limiter RPC |
| `SUPABASE_ANON_KEY` | Client-public only when actually used | Legacy client API key; never substitute for service-role authority |
| `NEXT_PUBLIC_MAP_PROVIDER` | Browser-visible | Existing provider-selection behavior, pending CARTO migration |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Browser-visible | Existing Mapbox path, pending CARTO migration |
| `NEXT_PUBLIC_CARTO_BASEMAP_KEY` | Browser-visible | **Proposed** CARTO Basemaps integration variable; must be wired in code |
| `NEXT_PUBLIC_NOTIFICATION_PROVIDER` | Browser-visible | Existing notification UI configuration if required by its implementation |
| `SENTRY_DSN` | Depends on integration | Error monitoring; scope and environment must be reviewed |
| `RESEND_API_KEY` | Server-only | Email delivery if configured |
| `LOGLOADS_EMAIL_FROM` | Server-only | Sender address for configured mail flows |
| `LOGLOADS_EMAIL_REPLY_TO` | Server-only | Reply-to address; documented fallback `support@logloads.com` |
| `LOGLOADS_CONTACT_EMAIL` | Server-only | Contact address; documented fallback `support@logloads.com` |
| `VERCEL_TOKEN` | Server-only tooling | Optional administrative deployment automation |

Any `NEXT_PUBLIC_` value is client-exposed. Do not place service-role, Clerk secret, Stripe secret, Resend key or similar private credentials behind that prefix.

- Production deployments are managed through the authorized Vercel/GitHub workflow. Merging to the production branch may trigger deployment; do not merge or change production variables without authorization.
- Separate Vercel Development, Preview and Production environment settings. Do not use a shared production service-role key to test preview mutations.
- Never activate live Stripe purchases, paid invitation delivery or marketing sends simply because the environment has their credentials.
- Public domain changes, DNS switches, key rotation and paid-plan changes require explicit authorization.

## 11. GitHub Actions, checks and safe testing

- `GITHUB_TOKEN` is normally provided automatically by GitHub Actions. Additional provider credentials must come from the appropriate repository/organization secret or approved identity integration.
- Repo scripts currently include `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm guardrails`, `pnpm validate`, `pnpm db:check`, and `pnpm test:e2e`.
- **CURRENT root `pnpm validate`:** lint, typecheck, tests, build, `pnpm db:assert`, and guardrails. The DB step can skip locally without prerequisites, so report its actual status explicitly.
- Run test suites in proportion to code changes. Full builds should not collide with a running development server's output directory.
- Browser tests should use synthetic identities and records in an isolated environment. Never point destructive test paths at production.
- Distinguish: **passed**, **failed**, **skipped**, and **not run**. Database DDL static checks are not PostgreSQL execution; RLS policy presence is not authorization proof.
- For real integration readiness, verify Clerk JWT signature trust, RLS, tenant isolation, cross-session concurrency and private-location redaction against a disposable database.

## 12. Notifications, mail and other integrations

- `NOTIFICATION_PROVIDER=placeholder` documents a placeholder option where supported by the current application. Do not claim public email/SMS delivery works without provider and end-to-end proof.
- Existing notification provider configuration and future targeted invitation delivery are separate product capabilities.
- Targeted invitations are opt-in, distinct-hauler-business job notices subject to monthly allowance and anti-spam restrictions. Ordinary inquiries, replies and general alerts do not consume that allowance.
- No auto-billing, paid invitation packs or live boosts until the relevant product, legal and provider gates are satisfied.
- Stripe is for future LogLoads membership/boost billing and preservation/reconciliation of historical obligations, not freight payments or dispatch settlement.

## 13. Normalized V2 database prototype — activation gates

The existing `architecture/normalized-v2/` SQL prototype defines proposed account, membership, landing, job, hauler, availability, inquiry, invitation, boost and audit relationships. It remains **non-active**.

Before application adoption or production migration:

1. Reconcile the schema with `packages/contracts/src/membership.ts` and the approved UX/product specifications.
2. Execute SQL in order against an **explicitly disposable** PostgreSQL 15+ / PostGIS environment, not an existing production database.
3. Test all table grants, RLS policies, `SECURITY DEFINER` functions and cross-tenant boundaries with actual authenticated and anonymous roles.
4. Validate Supabase's supported Clerk third-party JWT trust boundary; local forged-claim simulation alone is insufficient.
5. Test invitations, delivery callbacks and billing-cycle initialization concurrently in independent transactions.
6. Preserve historical pilot financial/dispatch records, including retention and access paths, during the transition.
7. Obtain an authorized migration plan, backups, rollback design, release gates and explicit approval before production changes.

No agent should describe the schema as live or production-ready until those checks are complete.

## 14. Security, privacy and operational hard stops

- Never place Supabase service-role, Clerk secret, Stripe secret, Resend key, signing secret or private customer data in source control or browser-exposed variables.
- Do not reveal exact private landing locations, gate/access instructions or restricted contacts through public job details, public maps, unauthenticated RPCs or error logs.
- Do not infer actual truck availability from a user's recent login, app activity or geographic presence. Availability is self-reported and time-stamped.
- Do not create or promise executed hauling contracts, completed loads, trip records, settlement records or freight funds movement through LogLoads.
- Never run `supabase db reset` or any destructive command without confirming the target is isolated and disposable.
- Never enable paid subscriptions, boosts, fee collection, bulk notifications or live provider mutations without the required business authorization and published terms.
- For every agent handoff, report the branch/commit, changed files, test results, actual environment, unverified claims, live-provider impact and rollback implications.

---

**Maintainer note:** This file is a configuration and operating reference. It does not grant permission to mutate providers, switch live authentication, activate billing, deploy to production or alter the founder-approved product model. When code differs from target specifications, record the difference and execute a controlled implementation change rather than documenting the desired behavior as already live.
