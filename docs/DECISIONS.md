# LogLoads — Decision Log

Append-only. Newest at top. Every runtime / provider / architecture change needs a dated entry.

## 2026-07-06 — Launch deployment model: single-writer node + persistent volume + snapshot mirror
- The in-memory operating engine is single-writer by design; multi-instance serverless (Vercel lambdas) would fork state regardless of snapshot storage. LAUNCH TARGET: one Node server (Fly.io / Railway / VM / Docker) with a persistent volume for `.data/`. `Dockerfile` at repo root is the deploy artifact (`LOGLOADS_STATE_FILE=/data/logloads-state.json`, volume at `/data`). Scale vertically until the async Supabase data layer lands; Vercel stays reserved for that milestone.
- Snapshot durability is two-tier: local disk is primary; a Supabase-backed mirror (`operating_state` table, migration `20260706210000_operating_state_mirror.sql`) is written on every persisted mutation and restored ONLY when a fresh node boots without a disk snapshot. Activates via `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (or a server-only anon key).
- 2026-07-07 UPDATE: Supabase org upgraded by the founder; project **`logloads` (ref `fdzohbiiyzgvjzfsjyxo`, us-west-1, $10/mo)** provisioned. All three migrations applied (foundation, operating-network phase2 with PostGIS + RLS + `request_capacity` RPC, operating_state mirror). Mirror write and fresh-node restore verified live end-to-end. Reset local state to seed: delete the disk snapshot AND the `operating_state` row.
- Auth for launch: Clerk keys remain the external blocker; the code path is complete (middleware, components, provisioning by clerkUserId). Public launch requires Clerk — the email-only dev sign-in has no credential check and stays disabled in production unless `LOGLOADS_ENABLE_DEV_LOGIN=true` is set deliberately (staging only).
- Email: Resend delivery is key-gated (`RESEND_API_KEY`); contact inquiries email `LOGLOADS_CONTACT_EMAIL` (default founder inbox) while the in-app record stays the source of truth.
- Abuse controls: in-memory sliding-window rate limits (correct for single-writer) on sign-in (10/min/IP), contact (5/hr/IP), and all authenticated API mutations (120/min/actor).
- Maps: maplibre-gl pinned to v4 (react-map-gl v7 peer range); v5 broke Marker rendering at runtime (`pixelsToGLUnits` TypeError, verified in-browser).

## 2026-07-06 — V3 production reconstruction: one product, multiple cockpits
- Product architecture LOCKED: public site + four authenticated cockpits (`/driver/*`, `/fleet/*`, `/host/*`, `/admin/*`). Public role toggles and demo actor switching are banned; the guardrails scanner enforces this (`tools/check-guardrails.mjs`).
- Identity: roles come from the session → profile → organization membership chain (`apps/web/lib/session.ts`). Clerk is the production provider (keys pending); until keys exist, a server-signed dev session (HMAC cookie, disabled in production unless `LOGLOADS_ENABLE_DEV_LOGIN=true`) drives local and E2E auth through the same resolution path. `V3_ACTORS`, `devActorUserId`, and `LOGLOADS_ENABLE_DEMO_ACTORS` are removed and banned.
- Onboarding provisions real records (profile, organization, membership, driver profile, equipment combination, plan entitlement) through `packages/services/src/accounts.ts`.
- Sensitive-data law: `buildNetworkView` redacts server-side. Route Packs, gate instructions, private road notes, exact coordinates and facility processes unlock only for the publishing organization or actively assigned haulers; everyone else gets approximate coordinates (~2-decimal) and `access.unlocked=false`. Numeric compatibility scores are never serialized to clients.
- Persistence (interim): single-node JSON snapshot of the in-memory operating state (`packages/db/src/snapshot.ts`, `.data/logloads-state.json`, debounced write after each mutation). Supabase migration of the service layer remains the next infrastructure milestone; migrations stay authoritative for the SQL model.
- Maps: Mapbox remains the locked provider (`NEXT_PUBLIC_MAPBOX_TOKEN`); without a token the map renders real geography through MapLibre + Carto basemap as a dev fallback. The decorative CSS map is retired.
- Copy law enforced by guardrails: no "operating graph", "audit trail", "entitlements", "compatibility engine", "network trucks", "purpose-limited", or numeric match scores in product copy.
- Billing: subscriptions only, Stripe-checkout code path activates when Stripe keys exist; billing surfaces state plan truth ("billing activation pending") rather than fake upgrade screens. Managed transaction mode stays disabled.
- Supersedes CLAUDE.md's "Do not build broad UI before the domain and API contracts are stable" — the domain layer is stable; the V3 mandate directs full product-surface construction.

## 2026-06-04 — Repo bootstrapped to AutomatedEmpires family standard
- Name LOCKED: **LogLoads**; domain **logloads.com** (GoDaddy). "LogBoard" retired — do not reintroduce.
- Runtime pinned: Node 24.16.0, pnpm 10.12.4, **Turborepo monorepo** (multi-surface; not the Sweepza flat exception).
- Integration spine adopted: Doppler · Vercel · Supabase Postgres (+ PostGIS) · Clerk · Mapbox · Stripe · Cloudinary · PostHog + Sentry · Resend.
- Auth = Clerk; Supabase RLS keyed on the Clerk user identity.
- Maps = Mapbox (core surface — LogLoads is map-first).
- Icons: Phosphor through `@logloads/ui` semantic icon registry; feature code uses `<Icon name="domain.action" />`.
- Positioning guardrail: coordination software + marketplace visibility, NOT a payment handler or freight broker. Stripe scoped to subscriptions; Stripe Connect N/A until/unless that changes.

### Known follow-up (CI)
- `.github/workflows/ci.yml` could **not** be committed by the scaffolding agent because the GitHub app currently lacks the `workflows` permission. The intended workflow runs `pnpm typecheck && pnpm lint && pnpm build` on Node 24.16.0 / pnpm 10.12.4 with `node-version-file: .nvmrc`. Add it manually (or grant the app `workflows` scope and re-run) so CI matches BidSpace + Sweepza.
