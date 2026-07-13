# LogLoads — Venture Operating Contract

This contract binds human and automated contributors. Read it before changing the repository. Notion and dated product decisions hold product/vision truth; this repository holds implementation truth. Issues, pull requests, decisions, and repository documentation are durable memory.

## 1. Venture thesis, user, and destination

**Thesis:** forestry hauling loses time and trust when loads, truck capacity, route access, assignments, and exceptions are coordinated across calls, texts, spreadsheets, and private knowledge. LogLoads can become the field-first operating network that makes that work visible to the right participant at the right time.

Primary daily users are drivers, fleet coordinators, and landing/host operators. The primary buyers are fleet and host organizations paying for coordination, visibility, and operational control—not transportation arranged by LogLoads. The product destination is one mobile-first network with distinct Driver, Fleet, Host, and Admin cockpits around the loop **Plan → Publish → Match → Commit → Coordinate → Haul → Confirm → Repeat**.

LogLoads is software and partner lead generation. It is **not** a freight broker, motor carrier, payment processor, employer, or dispatch-for-hire service. It must not arrange transportation for compensation, take custody of hauling funds, promise carrier availability, or imply that a prospect is a contracted or verified network member.

The repository is a pnpm/Turborepo monorepo. Domain contracts belong in `packages/contracts`, canonical persistence in `packages/db`, business transitions in `packages/services`, shared UI and semantic Phosphor icons in `packages/ui`, and product surfaces in `apps/web`. UI and route handlers do not bypass those boundaries.

## 2. Current stage and operating posture

LogLoads is pre-customer: the portfolio currently has **zero real users and zero real customers**. Seeded accounts, provider projects, green CI, a preview, or a populated development/canonical state are not adoption, revenue, or production-readiness evidence.

Do not protect an imaginary installed base. Agents should change weak flows, copy, schemas, and architecture when evidence supports a better result; use synthetic data and protected previews to learn quickly. Continue to protect credentials, provider state, private access data, live infrastructure, and legal boundaries because those risks exist even with no customers.

Current implementation reality is a Supabase-canonical, versioned `operating_state` document with optimistic compare-and-swap; normalized relational repositories remain a later scaling step. Exact route/access detail is assignment-gated. The shared Redis REST rate-limit adapter has landed on `main`, but production enforcement still requires approved credentials/configuration and exact-deployment proof.

## 3. Execution doctrine and authority

Ship meaningful, tested improvements instead of producing repeated audits, inventories, or plans that leave the product unchanged. Investigate enough to choose a safe slice, implement it, exercise the real user path, and leave a reviewable artifact. Prefer a small end-to-end improvement over a wide unfinished scaffold.

Without additional founder approval, an agent may perform reversible, non-destructive work inside an assigned lane, including:

- application code, tests, UI, copy, documentation, refactors, accessibility, performance, observability, security hardening, dependency updates, and CI fixes;
- local branches and small PRs; protected previews and preview-only configuration;
- local, isolated, or development migrations; test fixtures, synthetic partner/load data, and disposable preview data;
- sandbox/test-mode payment architecture and flows that cannot create real charges or payouts;
- internal email delivery tests to controlled team-owned recipients, clearly marked as tests;
- development auth, provider stubs, feature flags, and integration work using least-privilege non-production credentials; and
- lawful partner prospect research and a source-cited lead pipeline for fleets, mills, landing hosts, and related operators.

An existing plan is not sacred. If repository evidence disproves it, document the conflict, update the durable decision, and ship the smallest coherent correction. Never misstate a simulated, skipped, preview-only, or fixture-backed result as live proof.

## 4. True hard stops

Stop and obtain the required accountable human action only for:

- a paid plan upgrade;
- a domain purchase or DNS cutover;
- live money, a real charge, refund, payout, transfer, or freight-payment movement;
- destructive deletion of a provider project/resource;
- a destructive production database migration or production-data purge;
- credential rotation or revocation;
- account, organization, repository, or asset ownership transfer;
- a public launch announcement;
- a public ad buy, campaign send, or paid acquisition campaign;
- a legal or regulatory filing; or
- an action that requires MFA when the accountable person is unavailable.

Do not broaden this list into generic founder gating. Normal code review, reversible preview work, test-mode integrations, internal tests, and additive local/dev migrations proceed through the repository workflow. If a live-provider or additive production-data operation is explicitly assigned and does not hit a hard stop, it still needs exact scope, least privilege, backup/rollback evidence, independent review, and a recorded result; ordinary product work does not silently imply a live mutation.

## 5. Priorities

Work in roughly this order unless a current issue or incident proves otherwise:

1. Complete the load-coordination loop: publish, discover, request, approve, assign, route, update trip state, handle exceptions, and confirm.
2. Make Driver, Fleet, Host, and Admin cockpits useful in the field, with direct status language, accessible touch targets, degraded-connectivity tolerance, and obvious next actions.
3. Preserve controlled visibility: public load summaries may be redacted, while exact coordinates, gates, private roads, facility instructions, contacts, and route packs unlock only for authorized assignments.
4. Build a lawful, evidence-cited partner pipeline and onboarding path; keep prospects clearly separate from members, capacity, endorsements, or contracted relationships.
5. Keep Supabase the canonical authority, with server-side authorization, RLS, deterministic migrations, compare-and-swap safety, and no UI-to-database shortcuts.
6. Activate and prove the Redis-compatible shared limiter in an isolated/protected deployment when credentials exist; verify shared enforcement, pseudonymized keys, environment separation, and fail-closed outage behavior before public multi-instance traffic.
7. Resolve security, dependency, CI, rollback, observability, and accessibility defects that block a trustworthy product path.

## 6. Low-value and prohibited product work

- Do not substitute another audit, status dashboard, architecture rewrite, or speculative roadmap for an implementable slice.
- Do not create generic trucking-SaaS visuals or copy that erases forestry, landing, equipment, road-access, and field constraints.
- Do not build brokerage, dispatch-for-hire, carrier, settlement, escrow, factoring, fuel-card, freight-payment, or hauling-fund features. No freight payments until the legal entity, operating authority, contracts, insurance, tax treatment, support model, and payment model are approved in a dated decision.
- Do not present partner leads as signed partners, users, verified carriers, or available capacity.
- Do not add route optimization, realtime infrastructure, alternate providers, competing icon systems, duplicate domain contracts, or schema-breaking abstractions without an acceptance criterion that needs them.
- Do not redesign unrelated surfaces, optimize for hypothetical scale, or polish empty admin screens ahead of the core field loop.

## 7. Provider, data, legal, money, email, and auth boundaries

### Providers and deployment

The intended spine is Doppler, Vercel, Supabase/Postgres/PostGIS, Clerk, Mapbox with the documented MapLibre fallback, Cloudinary, PostHog, Sentry, Resend, Stripe for possible software subscriptions only, and a provider-neutral Redis REST shared limiter. Do not introduce substitutes casually.

Never print, commit, paste into PRs, or expose secrets/private provider URLs. Keep server credentials server-only. A preview must use isolated data or an isolated project/row and must not mutation-test production. A deployed artifact, provider status label, or green health endpoint is evidence only for what it actually proves.

### Data and access

- Supabase is canonical; the local JSON snapshot is development-only.
- Resolve actor identity from the server session. Never trust client-supplied actor IDs, roles, organization IDs, or assignment claims.
- Preserve service-layer authorization, RLS, versioned writes, conflict replay, and the no-runtime-delete posture.
- Use synthetic fixtures by default. Access production data only when an explicitly scoped, least-privilege task requires it; redact personal, commercial, and operational details from logs and artifacts.
- Keep gate instructions, private roads, exact access points, facility instructions, contacts, and sensitive coordinates redacted until least-privilege assignment rules permit them.

### Legal and money

Partner prospecting is allowed; compensated transportation arrangement is not. Do not claim LogLoads is the shipper, broker, carrier, dispatcher, employer, insurer, payment custodian, or guarantor. Sandbox subscription UX is allowed, but real subscriptions and every freight-money path remain blocked by the live-money hard stop and the unresolved legal/payment model.

### Email and auth

Internal Resend tests to controlled recipients are allowed in non-production. Public sends, imported recipient lists, and domain/DNS activation are not ordinary testing; never claim delivery without evidence. Clerk proves identity, while application memberships and server-side rules grant authorization. Development login must remain impossible in real production.

## 8. Design and product language

Preserve a map-first, mobile-first field experience and distinct role cockpits. Favor clear load state, capacity, equipment fit, schedule, route access, exceptions, and next actions over decorative complexity. Use `<Icon name="domain.action" />` through the semantic Phosphor registry. `LogLoads` and `logloads.com` are locked; `LogBoard` is retired.

Copy may describe coordination software, network visibility, partner discovery, and operational records. It may not promise brokerage, dispatch services, guaranteed loads/capacity, verified carriers without evidence, freight payment, or regulatory coverage LogLoads does not possess.

## 9. Branch, ownership, and PR rules

- Begin by recording `git status -sb`, branch, HEAD, base, open PRs, issue/acceptance criteria, and owned files. Confirm that no other agent owns the same artifact.
- Never push directly to `main`. Use `agent/<scope>-<short-description>` for agent work, or `feat/<lane>/<slug>`, `fix/<lane>/<slug>`, `docs/<lane>/<slug>`, and `chore/<lane>/<slug>`, all kebab-case.
- One coherent slice, one owner, one branch, and one artifact set. Preserve unrelated user work and do not overwrite another lane.
- Keep PRs small. Do not force-push, rewrite shared history, delete an unmerged branch, bypass required checks, or self-merge. A designated maintainer or approved automation merges after independent review.
- Rebase or merge the current base only when needed and without broadening the PR diff. A docs PR must remain docs-only.

## 10. Verification and definition of done

Use Node `24.16.0` and pnpm `10.12.4`. Root scripts currently define:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm guardrails
pnpm validate
pnpm test:e2e
git diff --check
```

`pnpm validate` runs lint, typecheck, unit tests, build, database assertion, and guardrails. Run `pnpm db:check` for database-contract work when the local Supabase CLI/Docker prerequisites exist; CI must not silently skip it. Use `pnpm test:e2e` for affected production-build journeys. Docs-only work requires `git diff --check` plus focused Markdown/link and factual review; report application checks as not run because no executable code changed.

A change is done only when it:

- satisfies an explicit user/venture acceptance criterion through a meaningful path;
- has focused regression coverage and the proportionate repository checks pass;
- preserves authorization, private-route redaction, canonical-data, and provider boundaries;
- includes screenshots and keyboard/mobile/accessibility evidence for UI work;
- documents new contracts, environment variables, migrations, and rollback behavior;
- uses honest preview/test/synthetic labels and makes no unsupported user, partner, delivery, payment, or production claim; and
- leaves a small reviewable PR with exact commands, impacts, risks, and remaining blockers.

## 11. Current PRs and blockers

Refreshed 2026-07-13 UTC: draft PR **#23**, `docs: add agent operating standards`, is the only open PR and owns `AGENTS.md` on `agent/docs-operating-standards`. Its checks were green before this contract revision; refresh them after any push. PR #22, the shared production rate-limiter implementation, is merged to `main`; this docs branch is one commit behind that base at this snapshot.

Current blockers are operational proof and adoption, not permission to keep auditing: zero real users/customers; no validated partner pipeline or field usage; Redis REST credentials/provider activation and shared-deployment proof; exact-SHA protected preview and rollback proof; controlled live migration/provider cutover; production auth/email readiness; and the legal/entity/payment model for any freight-money concept. Refresh GitHub, provider-safe evidence, and dated decisions before relying on this list.

## 12. Future-agent output format

Every handoff or final report must include:

1. branch, HEAD, base, issue/acceptance criteria, and governing decision/spec;
2. outcome achieved for which user, not merely activities performed;
3. exact files changed and concise scope;
4. commands run with pass/fail/skipped results and reasons;
5. test data and environment used, with preview/sandbox/synthetic labeling;
6. data, money, email, auth, provider, deployment, DNS, legal, and security impact—`none` where applicable;
7. screenshots and accessibility notes for UI work;
8. assumptions, remaining risks/blockers, approvals or hard-stop actions required, and rollback implications; and
9. PR URL and state, or a clear statement that no PR was created.
