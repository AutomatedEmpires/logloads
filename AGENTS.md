# LogLoads — Agent Operating Contract

> **Binding contract for every agent (human or AI: Copilot or Claude) that touches this repo. Read it fully before doing anything.**
> Aligned to the Explore&Earn (E&E) doctrine. LogLoads is one of the AutomatedEmpires apps; E&E is the reference implementation.

## 0 · Prime doctrine
**Notion decides. GitHub builds. Figma shows. Everything else runs.**

- **Notion** = product & vision truth (what we build and why). The locked LogLoads canon (AutomatedEmpires — Ventures → LogLoads Source of Truth) is authoritative; this repo implements it and does not redefine it.
- **This repo** = implementation truth (how it is actually built).
- Product/vision conflict → Notion decides. Implementation conflict → this repo decides.

## 1 · What LogLoads is
The **timber truck operating network**: a regional load-board / marketplace connecting timber & log-truck capacity with available loads. Map-first, mobile-first. Name + domain are **LOCKED** (LogLoads · logloads.com); "LogBoard" is the retired placeholder. See `README.md`, `docs/`, and the Notion canon for the spec.

**Positioning guardrail:** LogLoads is coordination software + marketplace visibility — **not** a payment handler or freight broker. Keep features inside that line unless the founder explicitly moves it.

## 2 · The machine (where this is built)
All AutomatedEmpires apps are built on ONE machine. Assume exactly:
- Windows 11 ARM64 (Snapdragon X Elite) → WSL2 Ubuntu 24.04 → VS Code
- Working path: `/home/jackson/automatedempires/ventures/logloads`
- 16 GB RAM. **One agent at a time** — do not assume parallel heavy builds or long-running watchers.

## 3 · Runtime (pinned — do not drift)
- Node **24.16.0** (`.nvmrc`)
- pnpm **10.12.4** (`packageManager` in `package.json`)
- **Turborepo monorepo** (`apps/*`, `packages/*`). LogLoads is multi-surface (web now; public site, ops/admin, and a driver surface expected), so it is a monorepo from the start — unlike Sweepza's intentional flat-app exception.
- Any version or shape change requires a new dated decision in `docs/DECISIONS.md`.

## 4 · Integration spine (cross-app standard)
Shared providers across all AutomatedEmpires apps. Do not introduce alternates without a dated decision.

| Concern | Provider |
|---|---|
| Secrets | Doppler |
| Hosting | Vercel |
| Database | Supabase Postgres (+ PostGIS for regions/geolocation) |
| **Auth** | **Clerk** (standardized across all apps; Supabase RLS is keyed on Clerk identity) |
| **Maps** | **Mapbox** (cross-app standard) — *core surface for LogLoads* |
| Payments | Stripe (subscription/coordination only; Connect N/A until positioning changes) |
| Media | Cloudinary |
| Observability | PostHog + Sentry |
| Email | Resend |
| Icons | Streamline — **formal style** (Core / Sharp / Ultimate); specific style TBD (founder to pick) |
| Language | TypeScript end-to-end |
| Surfaces | Web: Next.js |

**Icon policy (per-app):** LogLoads and BidSpace use a more formal Streamline style (specific style still to be chosen by the founder); Sweepza and Explore&Earn use Streamline Freehand (Pro). One Streamline style per app, applied consistently — never mix styles within an app, and no Lucide / Heroicons / Font Awesome / Material.

## 5 · Repo layout
- `apps/` — web (Next.js); additional surfaces (public site, ops/admin, driver) land here
- `packages/` — shared UI, domain logic, db schema/migrations
- `docs/` — canonical, deduped spec (DECISIONS first; ARCHITECTURE, DATA-MODEL, API, ROADMAP, GTM as they land)

## 6 · Core rule (no exceptions)
No one codes from vague ideas. Every slice moves through:

**Spec → Acceptance Criteria → Branch → Implementation → PR → Review → CI → Merge → Deploy → Notion status update.**

- One feature branch per slice: `feat/<lane>/<slug>`.
- Open a PR against `main`. Reference the issue and its acceptance criteria.
- Nothing merges to `main` without a PR + at least one independent review + green CI. The builder is not the sole approver. Active coding agents: **Claude** (primary builder + reviewer) and **Copilot** (secondary, scoped builder). **Codex was retired 2026-06-06.**
- Squash-merge only. Merged branches are auto-deleted.

## 7 · Security & access (server-enforced)
- Roles are enforced via Supabase **RLS** keyed on Clerk identity. Client-side role checks are advisory only.
- **Never commit secrets.** Values live in Doppler; CI uses GitHub Actions secrets and Vercel env.

## 8 · Quality bar
- TypeScript strict. Mobile-first. Accessible (semantic HTML, labels, focus states, color-contrast).
- SEO: per-route metadata, Open Graph, canonical URLs, semantic headings.
- CI (typecheck + lint + build) must pass. Add tests for non-trivial logic.

## 9 · GitHub management
- Work on lane/feature branches → small PRs → review → merge. Never push straight to `main`.
- CI (`.github/workflows/ci.yml`) runs typecheck + lint + build on every PR; keep it green.
- Communicate through durable artifacts: issues, PRs, and `docs/` are the memory.
- Respect founder gates: anything money-moving, legally binding, destructive, or schema-breaking waits for explicit founder sign-off.

## 10 · Cross-app alignment
E&E is the reference. LogLoads, BidSpace, Sweepza, and E&E share the same doctrine, machine, runtime, and integration spine so an agent moving between repos reads one contract. Differences are product scope only — never workflow.
