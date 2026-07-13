# LogLoads — Agent Operating Standards

This file is binding for human and automated contributors. Read it before changing code or documentation. Notion and dated product decisions hold product/vision truth; this repository holds implementation truth. Use issues, PRs, and repo docs as durable handoff artifacts.

## 1. App purpose

LogLoads is logistics/forestry/load-coordination software: a regional timber operating network that connects load opportunities with drivers, fleets, and landing hosts. Its operating loop is Plan → Publish → Match → Commit → Coordinate → Haul → Confirm → Repeat. It is coordination software and marketplace visibility, not a freight broker, carrier, or handler of hauling funds.

The repository is a pnpm/Turborepo monorepo. Domain contracts belong in `packages/contracts`, state access in `packages/db`, business transitions in `packages/services`, reusable UI and the semantic Phosphor icon registry in `packages/ui`, and web surfaces in `apps/web`. UI and route files must not bypass those boundaries.

## 2. Business vision

Build a trusted regional operating network that makes forestry capacity, load status, routes, assignments, and exceptions easier to coordinate without exposing sensitive operational details. Partner lead generation is allowed: agents may build a lawful prospect pipeline for fleets, mills, landing hosts, and other partners. A prospect is not a platform member, accepted load, endorsement, or brokered shipment.

Do not cross from software/lead generation into arranging transportation for compensation, representing LogLoads as a broker or carrier, or holding/moving freight money. Those activities require an approved legal entity, operating authority, contracts, insurance, tax treatment, and payment model.

## 3. Current rollout status

Snapshot 2026-07-12: **blocked · security-risk**. Supabase-canonical source and strong exact-main CI/deployment provenance exist, but that does not establish a safe live rollout. No production, money, or transfer-readiness claim is authorized.

Future agents must refresh the portfolio rollout records, repository PRs, and current branch before relying on this snapshot. Provider configuration names or a provider-hosted `READY` artifact are not proof of functional runtime, rollback, data authority, or live operations.

## 4. Branch naming rules

- Start from current `main`; never push directly to `main`.
- Agent work: `agent/<scope>-<short-description>`.
- Product work: `feat/<lane>/<slug>`, `fix/<lane>/<slug>`, `docs/<lane>/<slug>`, or `chore/<lane>/<slug>`, all kebab-case.
- Use one issue/slice, one owner, one branch, and one clearly owned artifact set. Before editing, run `git status -sb`, record the branch/HEAD, inspect open PRs, and confirm that another agent does not own the same files.
- Open a small PR against `main`. The builder is not the sole approver. Do not merge, force-push, rewrite history, delete branches, or overwrite another agent's work.

## 5. Required checks before PR

Use Node `24.16.0` and pnpm `10.12.4` as pinned by the repository.

```text
pnpm install --frozen-lockfile
pnpm validate
pnpm test:e2e
git diff --check
```

Run `pnpm db:check` when database contracts change and the local Supabase CLI/Docker prerequisites are available. Do not point validation at production or run live migrations. For docs-only changes, `git diff --check` plus a focused Markdown/link review is the minimum; state which application checks were not run and why. The PR description must list exact commands and results.

## 6. Forbidden actions

- Do not deploy, promote, change production aliases, touch DNS, mutate provider settings, rotate credentials, or edit secrets.
- Do not run live SQL, migrations, seed/reset/purge operations, storage changes, or destructive cleanup.
- Do not create freight-payment, brokerage, carrier, settlement, escrow, factoring, or hauling-fund features without explicit legal/entity/payment approval.
- Do not present partner leads as contracted partners, platform users, verified carriers, or available capacity.
- Do not accept client-supplied actor IDs, place service-role credentials in the browser, bypass RLS/service authorization, or expose gates, private roads, exact access points, facility instructions, or other sensitive coordinates before assignment.
- Do not add alternate providers, icon systems, duplicate domain contracts, direct DB access from UI, unrelated redesigns, or schema-breaking changes without a dated decision and approval.
- Do not merge PRs, delete branches, send real email, charge/refund money, or alter production auth.

## 7. Provider no-touch zones

Unless a task carries explicit founder/provider-owner approval, all write operations are out of scope for Doppler, Vercel, Supabase/Postgres/PostGIS, Clerk, Stripe, Resend and email/DNS, Mapbox, Cloudinary, PostHog, Sentry, and the shared production rate-limit store. This includes dashboard, CLI, API, webhook, environment, domain, billing, RBAC, project, token, migration, and deployment writes.

Read-only inspection is permitted only when the task explicitly scopes it. Record identifiers and non-sensitive evidence, never secrets or customer/operator data. Provider/live migrations remain controlled cutovers, not ordinary implementation steps.

## 8. Data, money, email, and auth guardrails

### Data

- Production data, backups, restore authority, retention, and migration windows are no-touch until an accountable data owner approves them.
- UI/API surfaces call `packages/services`; services own transitions and repository access. RLS and server-side authorization are mandatory.
- Redact sensitive forestry/logistics access details until assignment and least-privilege authorization. Use synthetic/local fixtures for tests.

### Money

- Fleet/host subscription concepts do not authorize live billing.
- No Stripe Connect, freight payments, brokerage money, carrier funds, payouts, refunds, or financial custody until the legal/entity/payment model is explicitly approved.
- Partner lead generation is allowed only while it remains prospecting, not compensated arranging of transportation.

### Email

- Resend is venture-scoped and key-gated. Do not activate domains, aliases, senders, webhooks, or sends.
- If the key is absent, skipped delivery and the in-app record must be reported honestly; never claim an email was delivered without evidence.

### Auth

- Clerk identifies users; application memberships and server-side rules determine authorization. Client checks are advisory only.
- Never enable development login paths in production, change production Clerk, or accept identity/role claims from the client.

## 9. Design notes

Preserve a map-first, mobile-first operational experience with distinct Driver, Fleet, Host, and Admin cockpits. Exact location and access details unlock only when operationally necessary. Favor direct status language, high-contrast accessible controls, resilient field use, and clear exception states over decorative complexity.

Use `<Icon name="domain.action" />` through the semantic Phosphor registry in `packages/ui`; do not import competing icon libraries or ad hoc SVGs in feature code. `LogLoads` and `logloads.com` are locked; `LogBoard` is retired. Do not redesign the app as part of unrelated work.

## 10. Current known PRs and blockers

Snapshot 2026-07-12: no open PRs were found. Refresh with GitHub before beginning a lane.

Known blockers include live-data authority and backup/restore/upgrade policy, distributed production rate limiting and fail-open dependency review, security advisories, provider activation, functional rollback, and independent venture email. Freight-payment/brokerage work remains blocked on legal/entity/payment approval. Treat a blocker as an honest no-go; do not route around it with a temporary live mutation.

## 11. Output format for future agents

Every handoff or final report must include:

1. branch, HEAD SHA, issue/acceptance criteria, and source-of-truth citation;
2. concise scope and exact files changed;
3. commands run with pass/fail/skipped results and reasons;
4. data, money, email, auth, provider, deployment, and DNS impact—normally `none`;
5. screenshots and accessibility notes for UI work;
6. assumptions, remaining risks/blockers, approvals required, and rollback implications; and
7. PR URL and state, or a clear statement that no PR was created.
