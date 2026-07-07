# LogLoads — Decision Log

Append-only. Newest at top. Every runtime / provider / architecture change needs a dated entry.

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
