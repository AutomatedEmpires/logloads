# LogLoads — Agent Operating Contract

> **Binding contract for every agent (human or AI: Copilot, Claude, Codex) that touches this repo. Read it fully before doing anything.**
> Aligned to the Explore&Earn (E&E) doctrine. LogLoads is one of the AutomatedEmpires apps; E&E is the reference implementation.

## 0 · Prime doctrine
**Notion decides and builds. GitHub reviews and ships. Figma shows. Everything else runs.**

- **Notion** = product & vision truth (what we build and why), and where the bulk of the build — specs, architecture, data models, copy — is authored before code moves. The locked LogLoads canon (AutomatedEmpires — Ventures → LogLoads Source of Truth) is authoritative; this repo implements it and does not redefine it.
- **This repo** = implementation truth (how it is actually built); GitHub validates, reviews, and ships what Notion produced.
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
- Nothing merges to `main` without a PR + at least one independent review + green CI. The builder is not the sole approver.
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

## 11 · Canonical schema names (do not drift)
**The schema is locked. These 20 table names are the only valid ones.** Single source of truth: the Notion **LogLoads MVP Pack — Build-Ready Consolidation** (Section 5: Schema Objects), mirrored in GitHub Issue #5. If code, a PR, or a doc uses any other name for these concepts, it is wrong and must be corrected before merge.

**Canonical tables (20):**
`users`, `organizations`, `organization_members`, `driver_profiles`, `truck_profiles`, `outfit_profiles`, `haul_opportunities`, `haul_private_details`, `truck_slots`, `slot_requests`, `assignments`, `standby_assignments`, `availability_signals`, `operational_updates`, `notifications`, `reminders`, `verification_records`, `reliability_events`, `saved_items`, `audit_log`.

**Banned / retired names (never reintroduce):**
- `load_postings`, `LoadPosting`, `loads` → use `haul_opportunities`
- `slot_assignments` → use `assignments`
- `messages`, `message_threads`, `message_events`, generic messaging tables → out of MVP scope; coordination is via `operational_updates` / `notifications`
- `haul_locations`, `destinations` → exact landing lives in `haul_private_details`; do not model separate location tables
- `reviews`, `reviews_private_notes`, public star-rating tables → not in MVP (reputation is `reliability_events`)
- `billing_accounts`, `subscriptions` → billing is Stripe-side only in MVP; no money-moving tables

**Naming rules:**
- Tables are `snake_case`, plural. Columns are `snake_case`.
- The core posting object is always `haul_opportunities` (reusable job context); date-specific capacity is `truck_slots`; the request→fulfillment loop is `slot_requests` → `assignments` (+ `standby_assignments`).
- Adding, renaming, or removing a canonical table requires a dated decision in `docs/DECISIONS.md` AND an update to Issue #5 / the MVP Pack. Code may not lead schema.

**CI lint (intent):** add a check that fails the build if any banned identifier above appears in `packages/**` schema/migration files or in `apps/**` types. Treat a hit as a hard error, not a warning. (Tracked in Issue #13.)
