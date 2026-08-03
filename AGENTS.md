<!-- ae-control-plane v1 (2026-07-16). Machine operating contract; product docs follow below. -->
# Operating contract — Automated Empires control plane

- **Canonical clone (the ONLY writable copy):** WSL `Ubuntu-24.04-Recovered` → `/home/jackson/automatedempires/ventures/logloads`.
  Never clone this repository anywhere else on the machine. Parallel work uses controlled
  worktrees: `ae start logloads -t <task> -a <agent> --worktree`.
- **Sessions:** acquire the single-writer lease first (`ae start logloads -t <task> -a <agent>`);
  end with `ae finish logloads`. Work counts as done ONLY when pushed and remote-SHA-verified.
- **Deploys:** merging `main` auto-deploys production via Vercel.
- **Validate before merge:** `pnpm typecheck && pnpm guardrails` (CI must be green; squash merges).
- **Providers (fixed — never swap or cross-wire):** db=supabase, private-media=supabase-storage, auth=clerk.
- **LOCKED:** Follow the in-repo operating contract (merged PR #23)
- Full policy: `github.com/AutomatedEmpires/ae-control` → `POLICY.md`. Briefing: `ae info logloads`.

---

# LogLoads — Venture Operating Contract

This contract binds human and automated contributors. Read it before changing the repository. Notion and dated product decisions hold product/vision truth; this repository holds implementation truth. Issues, pull requests, decisions, and repository documentation are durable memory.

## 1. Venture thesis, user, and destination

**Thesis:** forestry hauling loses time and trust when loads, truck capacity, route access, assignments, and exceptions are coordinated across calls, texts, spreadsheets, and private knowledge. LogLoads can become the field-first operating network that makes that work visible to the right participant at the right time.

Primary daily users are drivers, fleet coordinators, and landing/host operators. The primary buyers are fleet and host organizations paying for coordination, visibility, and operational control—not transportation arranged by LogLoads. The product destination is one mobile-first network with distinct Driver, Fleet, Host, and Admin cockpits around the loop **Plan → Publish → Match → Commit → Coordinate → Haul → Confirm → Repeat**.

Dispatch Pro is software for an organization's established private capacity.
LogLoads Network is a separately versioned, percentage-fee-funded coordination
product whose legal operating posture is an explicit activation gate. Do not
claim that pricing decides whether LogLoads is a broker, carrier, bona fide
agent, dispatch service, employer, or technology provider. Until a dated
counsel-approved authority or commodity-and-route posture is recorded, Network
commercial enrollment stays dark. LogLoads never takes custody of hauling funds,
promises carrier availability, or presents a prospect as a contracted or
verified Network member.

The repository is a pnpm/Turborepo monorepo. Domain contracts belong in `packages/contracts`, canonical persistence in `packages/db`, business transitions in `packages/services`, shared UI and semantic Phosphor icons in `packages/ui`, and product surfaces in `apps/web`. UI and route handlers do not bypass those boundaries.

## 2. Current stage and operating posture

LogLoads is publicly deployed but still pre-customer: the portfolio currently has **zero confirmed real users and zero confirmed real customers**. Seeded accounts and a populated canonical state are not adoption or revenue evidence. Production claims must be tied to exact-deployment proof, health checks, smoke results, and provider-safe evidence.

Do not protect an imaginary installed base. Agents should change weak flows, copy, schemas, and architecture when evidence supports a better result; use synthetic data and protected previews to learn quickly. Continue to protect credentials, provider state, private access data, live infrastructure, and legal boundaries because those risks exist even with no customers.

Current implementation reality is a Supabase-canonical, versioned `operating_state` document with optimistic compare-and-swap; normalized relational repositories remain a later scaling step. Exact route/access detail is assignment-gated. Shared rate-limit windows are also persisted through Supabase so production enforcement works across instances without introducing a second data provider.

## 3. Execution doctrine and authority

Agents are expected to ship meaningful, tested improvements, not produce endless audits, inventories, or plans that leave the product unchanged. Investigate enough to choose a safe slice, implement it, exercise the real user path, and leave a reviewable artifact on a reversible branch. Prefer a small end-to-end improvement over a wide unfinished scaffold.

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
- buying or placing ads, starting or activating any public campaign, or sending a marketing broadcast;
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
6. Maintain and prove the Supabase-backed shared limiter; verify shared enforcement, HMAC-pseudonymized keys, environment separation, and fail-closed outage behavior before materially increasing public traffic.
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

The intended spine is Doppler, Vercel, Supabase/Postgres/PostGIS plus private Supabase Storage, Clerk, Mapbox with the documented MapLibre fallback, PostHog, Sentry, Resend, and Stripe for LogLoads platform-fee collection plus read-only reconciliation of historical software-subscription obligations. Shared rate limiting uses Supabase-backed windows. Supabase Storage is the sole active private-media provider; Cloudinary is retired runtime history, not a fallback. Do not introduce substitutes casually.

Never print, commit, paste into PRs, or expose secrets/private provider URLs. Keep server credentials server-only. A preview must use isolated data or an isolated project/row and must not mutation-test production. A deployed artifact, provider status label, or green health endpoint is evidence only for what it actually proves.

### Data and access

- Supabase is canonical; the local JSON snapshot is development-only.
- Private credential, equipment, and trip-proof media stays in the private
  LogLoads Supabase Storage bucket. Upload permission is object-scoped and
  short-lived; application authorization remains mandatory before either upload
  signing or authenticated delivery.
- Resolve actor identity from the server session. Never trust client-supplied actor IDs, roles, organization IDs, or assignment claims.
- Preserve service-layer authorization, RLS, versioned writes, conflict replay, and the no-runtime-delete posture.
- Use synthetic fixtures by default. Access production data only when an explicitly scoped, least-privilege task requires it; redact personal, commercial, and operational details from logs and artifacts.
- Keep gate instructions, private roads, exact access points, facility instructions, contacts, and sensitive coordinates redacted until least-privilege assignment rules permit them.

### Legal and money

Partner prospecting and dark/test-mode Network implementation are allowed.
Compensated transportation arrangement is not activated by repository code. Do
not claim LogLoads is the shipper, broker, carrier, dispatcher, employer,
insurer, payment custodian, or guarantor. A dated counsel-approved operating
posture is required before real Network enrollment.

**Operating model — founder-decided 2026-08-01 (`percentage_v1`). Supersedes the 2026-07-28 subscription-v1 decision for new commercial activity.**

- **Load value is the flat driver pay the host states.** The driver sees exactly that number. It replaces the rate card as the figure any driver-facing surface shows. Rate entities remain a company price-card, not per-load driver pay.
- **LogLoads charges the host an additional 5% platform fee.** For $1,000 of stated driver pay, the driver's direct host-to-driver obligation remains $1,000 and the host's separate LogLoads obligation is $50. The fee is never deducted from driver pay.
- **The fee becomes billable only after the physical load movement completes under the authoritative completion rules.** Posting, matching, requesting, private-fleet planning, cancellation before execution, and duplicate completion are not billable events. Percentage fees are invoiced to the host monthly in arrears.
- **There is no monthly minimum and no charge to post.** Drivers remain free forever. Do not reintroduce the rejected minimum or the subscription catalog as an enrollment option.
- **`percentage_v1` is the only model for newly accepted commercial activity.** `legacy_percentage` remains parseable and collectible only for assignments and obligations frozen while that legacy agreement was valid. `subscription_v1`, Dispatch Pro subscription enrollment, tier allowances, and overage products are historical/read-only: preserve and reconcile any obligation accepted while the 2026-07-28 decision governed, but create no new subscription customer, enrollment, or usage obligation.
- **One physical movement may produce exactly one commercial obligation.** Assignment-time terms freeze the applicable model and rate. Never rewrite a legacy or historical subscription record into `percentage_v1`, and never dual-bill a movement.
- **Strictly non-custodial, permanently.** LogLoads never holds, commingles, or moves driver funds — no wallet, no escrow, no balances. Driver pay is a direct host-to-driver obligation settled off-platform. The host marks payment sent, and **only the driver** may mark it received.
- **`LOGLOADS_FEE_COLLECTION` is the sole current commercial collection gate.** It defaults to `disabled`; enabling it is a separately authorized live-money action after the exact LogLoads Stripe account, accepted terms, legal posture, invoice lifecycle, rollback, and controlled charge/refund evidence are recorded. `LOGLOADS_SUBSCRIPTION_COLLECTION` and `LOGLOADS_DISPATCH_SELF_SERVE` remain `disabled` historical safety gates and must not be used to activate new work.
- **Current host enrollment is separately gated and exact.** `LOGLOADS_PERCENTAGE_ENROLLMENT` defaults to `disabled`, `LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS` defaults blank, and both a dated counsel-approved posture and exact pilot organization authorization are required before agreement acceptance. Enrollment never authorizes collection, collection never enrolls a host, and wildcard allowlisting is invalid.
- **`transfer_data` and `application_fee_amount` are permanently banned on any driver payment path** and are guardrail-enforced. Destination charges and separate charges-and-transfers route money through the platform balance, while a nonzero `application_fee_amount` silently deducts from driver pay. Stripe is used only for the host's separate LogLoads obligation and historical provider reconciliation.
- **Pricing is not a regulatory workaround.** Real Network enrollment requires a dated counsel-approved authority or commodity-and-route posture. Until then, build and test the full system in synthetic/test mode and keep collection and enrollment dark.

Provider products, Prices, webhooks, or historical subscription code do not authorize real money. No agent may create a real customer, fee invoice, charge, refund, subscription, or payout without explicit scoped authorization.

### Email and auth

Internal Resend tests to controlled recipients are allowed in non-production. Public sends, imported recipient lists, and domain/DNS activation are not ordinary testing; never claim delivery without evidence. Clerk proves identity, while application memberships and server-side rules grant authorization. Development login must remain impossible in real production.

## 8. Design and product language

Preserve a map-first, mobile-first field experience and distinct role cockpits. Driver navigation is **Map → Loads → Schedule → Profile** and must remain obvious from a phone. Every directed flow should answer, in plain language: what is available, what it pays, whether the driver and equipment match, whether the request was accepted, when it is scheduled, what is moving now, and what happens next.

Favor clear load state, capacity, truck/trailer/equipment fit, trip length, estimated fuel economics, timing, weather at the landing, route access, exceptions, and next actions over decorative complexity. Driver profiles should make photos, truck, trailer, equipment, availability, and fuel economy easy to maintain. Avoid internal implementation notes, audit language, generic SaaS dashboards, and dense forms in customer-facing surfaces.

The design system must be coherent across phone, tablet, and desktop, with phone behavior treated as the primary driver constraint. Reuse tokens and primitives from `packages/ui`; do not create page-local lookalike components. Use `<Icon name="domain.action" />` through the semantic Phosphor registry. `LogLoads` and `logloads.com` are locked; `LogBoard` is retired. The social identity is `logloads` on Facebook and Instagram.

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

## 11. Current production posture and blockers

Last provider snapshot, 2026-07-29 UTC: `logloads.com` was publicly deployed
from `main`; health reported Clerk auth, Supabase canonical state, the
then-current subscription billing integration, Resend email, Supabase Storage
media, PostHog analytics, and Sentry error tracking configured. The production
media bucket was private and restricted to JPG, PNG, and WebP objects no larger
than 10,000,000 bytes. That billing evidence predates the 2026-08-01 decision and
does not prove current percentage-v1 readiness, provider ownership, or authority
to charge. Re-verify the exact production SHA, `LOGLOADS_FEE_COLLECTION` state,
fee invoice/webhook behavior, and Stripe account before relying on it. Drivers
are free forever, and freight payments do not move through LogLoads.

**Decided and implemented does not mean activated.** Section 7's 2026-08-01
`percentage_v1` model is the newest commercial authority. Repository and provider
surfaces may still contain the superseded subscription-v1 catalog while the
recovery branch completes the transition; those paths are historical/read-only
and must not enroll new activity. Production must not collect a percentage fee
while `LOGLOADS_FEE_COLLECTION` is disabled, and public copy must not present a
subscription tier or Pilot organization as available or active.

The last verified production pass reported eight automated smoke checks passing, no failures, a signed Stripe webhook probe accepted, and no fresh runtime error or 5xx clusters. Remaining operational proof includes the authenticated request → approval → trip → message loop and forced cold-start recovery. Business blockers remain adoption, field validation, a credible partner pipeline, and the legal/entity/payment model for any host percentage or freight-money concept. Refresh GitHub, production health, provider-safe evidence, and dated decisions before relying on this snapshot.

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
