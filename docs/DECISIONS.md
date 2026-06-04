# LogLoads — Decision Log

Append-only. Newest at top. Every runtime / provider / architecture change needs a dated entry.

## 2026-06-04 — Repo bootstrapped to AutomatedEmpires family standard
- Name LOCKED: **LogLoads**; domain **logloads.com** (GoDaddy). "LogBoard" retired — do not reintroduce.
- Runtime pinned: Node 24.16.0, pnpm 10.12.4, **Turborepo monorepo** (multi-surface; not the Sweepza flat exception).
- Integration spine adopted: Doppler · Vercel · Supabase Postgres (+ PostGIS) · Clerk · Mapbox · Stripe · Cloudinary · PostHog + Sentry · Resend.
- Auth = Clerk; Supabase RLS keyed on the Clerk user identity.
- Maps = Mapbox (core surface — LogLoads is map-first).
- Icons: Streamline **formal** style (specific style TBD — founder to pick).
- Positioning guardrail: coordination software + marketplace visibility, NOT a payment handler or freight broker. Stripe scoped to subscriptions; Stripe Connect N/A until/unless that changes.

### Known follow-up (CI)
- `.github/workflows/ci.yml` could **not** be committed by the scaffolding agent because the GitHub app currently lacks the `workflows` permission. The intended workflow runs `pnpm typecheck && pnpm lint && pnpm build` on Node 24.16.0 / pnpm 10.12.4 with `node-version-file: .nvmrc`. Add it manually (or grant the app `workflows` scope and re-run) so CI matches BidSpace + Sweepza.
