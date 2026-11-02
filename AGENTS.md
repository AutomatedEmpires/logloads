<!--
LogLoads venture operating contract — revised 2026-11-01.
Replaces the superseded dispatch/percentage-v1 directives in the previous AGENTS.md.
This file is an agent governance and implementation contract, not evidence that planned
features, migrations, integrations, subscriptions, or legal permissions are live.
-->

# LogLoads — Venture Operating Contract

**Status:** Current operating instructions for human contributors and coding agents.  
**Product decision:** November 1, 2026 — LogLoads Product, Membership & Monetization Blueprint v1.0.  
**Execution environment:** Windows 11, Cursor, Node.js 24.16.0, pnpm 10.12.4.  
**Current task:** Repair and transition the existing LogLoads application into a focused timber-hauling load board, preserving security and historical records.

Read this document before editing the repository. Work in small, independently verifiable slices. **Approved product decisions must not be silently changed by an agent.** Code, historical documents, or an older branch do not override the founder's current product model.

## 0. Source of authority and local workflow

### Before any work: the coordination system

- **Find your issue first.** GitHub Issues labelled `agent-task` are the **authoritative task tracker**. Each issue's header states its owner, priority and status. No issue, no work.
- Project Board #10 is optional and deferred (founder decision, 2026-11-02). Do not configure it or troubleshoot access to it.
- The process is in `docs/AGENT_WORKFLOW.md`: the tracker command, issue fields, statuses, the handoff comment format, and the Done gate.
- **Issues are the persistent communication channel between agents.** Post progress, blockers, commit SHAs, PR URLs, and test results on the issue, never only in a private chat.
- **PRs and CI runs are the implementation evidence.** An issue reaches Done only when a reviewer other than the owner confirms the linked evidence.
- The documentation map and the status vocabulary (APPROVED / IMPLEMENTED / VERIFIED / TARGET / HISTORICAL / UNVERIFIED) are in `docs/README.md`. Verification evidence is recorded in `docs/CI.md` §3.

### Product and technical authority

Use these sources in the following order for their respective purposes:

1. **The founder's latest explicit, dated decision** — governs approved product scope, pricing, and commercialization. Record changes in `docs/DECISIONS.md`; do not unilaterally change the business model.
2. **`docs/product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md`** — authoritative November 1 commercial and product specification, including plan limits, invitations, boosts, and marketplace boundaries. The source is *LogLoads Product and Monetization Blueprint v1.0*.
3. **`docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md`** — the founder-supplied UX and functional specification. It is a verbatim conversion of `LogLoads_User_Experience_and_Functional_Product_Specification_v1.0.docx`, and its source hash is recorded in the file header. Its screen definitions, interaction flows, and priorities govern experience design. Its *recommended* enhancements are not automatically approved implementation tasks. Changes are made only by a new version.
4. **`docs/product/TRANSITION_PLAN.md`** — sequencing and retain/adapt/retire mapping. It is an implementation plan, not authority to execute destructive migrations, activate live billing, or override product decisions.
5. **This `AGENTS.md`** — agent permissions, technical boundaries, collaboration, validation, and reporting.
6. **Other repository documentation, decisions, PRs, and historical records** — useful for understanding the existing system, but may describe superseded pilot functionality.

Security controls, legal requirements, production restrictions, and preserved historical financial obligations remain binding even when old product features are retired. If sources conflict, report the specific conflict and follow the current founder decision *without weakening a safety control*. A proposed product change requires founder approval and a new dated decision or specification version.

### Supported local workflow

- **Working copy:** Native Windows 11 checkout in Cursor. The former recovered WSL clone and `ae start` / `ae finish` lease commands are retired for this repository. Do not reintroduce WSL, Docker, or a separate control plane merely to run ordinary development tasks.
- **Toolchain:** Node.js **24.16.0** (`.nvmrc`, managed by fnm or equivalent); pnpm **10.12.4** via Corepack. In Windows PowerShell, use `pnpm.cmd` if execution policy blocks `pnpm.ps1`.
- **Setup:** `pnpm install --frozen-lockfile`, then `pnpm setup:local`, subject to `docs/ENVIRONMENT.md`. Local secrets belong in ignored environment files. Confirm that the selected Node version is active in each agent shell before troubleshooting tooling.
- **Development server:** `pnpm dev` must listen on **`127.0.0.1:3002` only**. Never expose seeded development authentication to LAN or public interfaces. Do not run a production build into `apps/web/.next` while an active dev server uses that directory; use an isolated build location/worktree or stop the server with the owner's knowledge.
- **Parallel agents:** Each concurrently active agent works on **its own branch in its own Git worktree**, and edits only the files its issue owns. Never edit, stage, reset, or clean another agent's worktree or untracked files. Avoid duplicate dependency installations and build caches on the 512 GB laptop. Remove a finished worktree only after its branch is pushed and its owner agrees.
- **Deployment:** The existing `main` deployment path may trigger Vercel production automatically. Never merge, push to `main`, or deploy without explicit authorization.
- **Portfolio references:** `github.com/AutomatedEmpires/ae-control` and its `POLICY.md` may contain useful portfolio standards, but the old WSL/`ae` leasing workflow is not active for this checkout. Do not import contradictory instructions from older policy documents.

---

## 1. Venture thesis, users, and product boundary

### 1.1 What LogLoads is

**LogLoads is a specialized timber-hauling load board.** Businesses seeking log trucks advertise genuine hauling opportunities and discover willing hauling companies; independent owner-operators and fleets find transparent work, display their equipment and self-reported availability, and express interest. The parties arrange their transportation relationship directly.

The core customer journey is:

**Publish → Discover or Notify → Express Interest → Communicate → Arrange Work Independently → Return When New Capacity or Work Is Needed.**

The application helps participants find each other and make informed decisions. It does **not** become the operating system for the transportation agreement after contact is made.

### 1.2 The four workspaces, one identity architecture

1. **Landing Operator (paid):** A business authorized to recruit log trucks, such as a logging contractor, landing operator, mill, or other legitimate poster. It manages physical landing locations, job postings, inbound inquiries, outgoing targeted invitations, optional paid boosts, team members, and its subscription.
2. **Independent Hauler (free forever):** A one-truck owner-operator or other hauling business that searches jobs, reviews compensation and requirements, manages equipment/availability, and expresses interest.
3. **Fleet (free forever):** An expanded **hauler-organization workspace**, not a separate paid membership. It supports multiple trucks, equipment types, availability counts, authorized staff, and interest on behalf of several trucks. No dispatch, trip accounting, or driver tracking is required.
4. **Platform Admin (internal):** Explicitly authorized LogLoads staff for verification, moderation, support, billing visibility, entitlement administration, promotions, marketplace-health monitoring, and audited security functions.

**One login may belong to multiple organizations.** A person may manage a landing business and a separate hauling business, switching organization context deliberately. A person, hauling business, fleet, physical landing, and individual truck are distinct entities. Organization roles do not confer platform-admin powers.

### 1.3 The approved revenue model (definition: Blueprint §3–§8)

**Haulers and fleets remain free forever.** No required hauler subscription, per-load charge, per-truck-hired charge, percentage of pay, or freight-payment processing.

The paid side is a set of landing subscriptions:

- **Basic, Pro, Regional:** $149 / $299 / $499 per month.
- **Active landings:** 1 / 3 / unlimited.
- **Team members, including the owner:** 2 / 5 / 10.
- **Targeted invitations:** 3 / 10 / 30 per billing cycle, with no rollover.
- **Optional one-job boosts:** $99 / $149 / $199.
- **Founding offer:** 50% off for 6 cycles, for the first 10 qualifying landings per launched state.

The **authoritative definitions** are the Blueprint (`docs/product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md`). In code, the numbers live only in `packages/contracts/src/membership.ts`. Do not restate plan tables elsewhere. **None of this is purchasable yet** (§7.5).

Plan differences must reflect valuable platform capabilities. They must never suppress essential safety, pay, job, or contact information.

**Active landing rule:** Count active, real recruiting locations, not archived/saved locations, destinations, individual routes, listings, or truck quantities. Unlimited does not authorize spam, duplicates, fictitious locations, or misuse.

**Unlimited rule:** Genuine postings, inquiries, replies, and truck requirements are unmetered, subject to reasonable abuse, security, and rate-limiting protections; do not invent hidden per-truck charges or restrict incoming inquiries by tier.

### 1.4 Targeted invitations

An invitation is a **proactive, job-specific notice** to one distinct eligible, opted-in hauling business. It is **not** a hired truck, a completed load, a freight assignment, or a guarantee of a response.

- Allowances per §1.3. No rollover, carryover, or automatic paid overage.
- Ordinary inbound expressions of interest, replies, profile views, and organic discovery **never** consume invitations.
- Target only hauler businesses with appropriate notification consent and equipment/geographic fit. Self-reported availability is not inferred from login activity or device location.
- Deduplicate appropriately. Prevent simultaneous sends from overspending the same allowance. Define and test reservation, success/failure reconciliation, retry, cooldown, and expiry behavior before activation.
- Count an invitation only according to a published and technically verifiable delivery rule; do not charge for failed delivery under the approved design.
- **Additional invitation packages are deferred.** Do not sell them until enough qualifying hauler businesses are reachable in the relevant markets and commercial terms are approved.
- Avoid unsolicited blasts, noisy repeated notifications, or claims that an eligible business is committed to work.

### 1.5 Paid job boosts

Boosts promote **one legitimate job posting** as clearly marked **Sponsored** content, without guaranteeing impressions, applicants, or booked trucks. The durations and prices are in Blueprint §7.1: 7, 14 or 28 consecutive days.

The intended promotion radius is approximately **100 miles from the job's public landing area**, subject to relevant filters and privacy rules. Show clearly labeled placement in eligible job results, discovery, and map views, with measured performance when available. A boost does not automatically send targeted invitations, alter their allowance, or create freight-related fees. Do not allow misleading sponsored dominance or sell exposure where meaningful local audience cannot be supported. Boosts are not automatically recurring products.

### 1.6 Founding-member program

- The landing-operator offer is defined in Blueprint §8.1. Eligibility and verification must be enforced, and duplicate business accounts cannot consume multiple grants. The definition of a "launched state" is still an open founder decision (#114).
- Haulers are **free forever**; the first 1,000 qualifying early haulers may receive recognition/early feature participation rather than a fake six-month free offer.
- Founding promotions require accurate public terms and controlled activation. They are **not automatically live** because the schema, documentation, or test product exists.

### 1.7 Explicit non-goals

Do not build or extend freight brokerage operations, carrier services, dispatch-for-hire, authoritative driver scheduling, truck assignment management, per-trip tracking, scale-ticket accounting, completed-load verification, detention/fuel accounting, settlements, factoring, escrow, wallets, fuel cards, driver-pay movement, or a percentage-based transportation fee engine.

The old software may contain these capabilities. Preserve legacy records and security invariants until retirement is approved, but **do not use them as new-product acceptance criteria**.

## 2. Current implementation versus approved target

### 2.1 Existing application — factual implementation state

LogLoads is a pnpm/Turborepo application with Next.js, Clerk, Supabase, business services, shared UI, and supporting integrations. As documented in the existing repository, much of its operational state is currently stored in a versioned JSON document in **`public.operating_state`**, read and written through server-side service-role operations and optimistic compare-and-swap. Local JSON state supports development.

That is **legacy implementation reality**, not the new target. Service-role access bypasses RLS, so existing tenant isolation relies heavily on application authorization. Maintain those protections while the legacy code remains reachable. Do not claim that merely adding RLS to a new schema secures the old JSON document.

### 2.2 Approved persistence direction

Move toward normalized Supabase PostgreSQL tables and secure tenant isolation, using a carefully reviewed schema and application adapter. Preserve stable IDs where feasible, validate data mappings, and quarantine malformed historical records rather than silently dropping or rewriting them.

The normalized schema under **`architecture/normalized-v2/`** covers PostGIS, Clerk identity mapping, membership grants, private landing details, entitlement logic, and audit functions. Gemini authored it, and Claude Agent 1 is its single editor and verifier. Its status is in `docs/CI.md` §3, the only evidence register; never quote test counts elsewhere:

| Stage | Status |
|---|---|
| **1. PostgreSQL 17 execution in CI** | VERIFIED: the baseline and the contract-alignment stages, on disposable databases |
| **2. Supabase-specific behaviour** — real Clerk tokens, project settings | UNVERIFIED |
| **3. Application integration** — a normalized adapter | UNVERIFIED; not built |
| **4. Staging readiness** | UNVERIFIED |
| **5. Production** | NOT AUTHORIZED |

The schema is still under integration verification. It is not an active migration, not a verified live RLS boundary, and not permission to touch any hosted project.

Before adoption, prove trusted JWT verification through Supabase, cross-tenant denials on the real request path, and application compatibility in a disposable, permitted environment.

### 2.3 Repository module boundaries

- `packages/contracts`: domain types and pure business rules, including the new membership rules.
- `packages/db`: canonical persistence, migrations, and adapters.
- `packages/services`: business operations, authorization, and transitions.
- `packages/ui`: shared UI primitives, tokens, and semantic Phosphor icons.
- `apps/web`: pages, routes, UI composition, and thin request handlers.

Do not bypass business services or authorization from a UI component or route handler. Avoid parallel definitions of plan limits or invitation accounting; align TypeScript contracts, SQL entitlements, and the product blueprint.

### 2.4 Migration principles

- Keep the existing deployed system and historical records recoverable while developing V2 behind a flag or isolated route.
- Build the new load-board workflow with stable, narrow domain/read-model interfaces; use a replaceable persistence adapter while normalized storage is being validated.
- No production database migration, cutover, data purge, or historical financial retirement without a separate explicit approval, backup, verification, and rollback plan.
- Do not operate the old and new persistence paths as independent sources of truth for the same live record without a tested consistency strategy.
- Do not create a competing normalized schema when another agent already owns the prototype.

## 3. Execution doctrine and contributor authority

Agents are expected to **implement useful changes**, not perform endless audits. Inspect just enough to choose a safe change, implement it, test the affected user journey, and leave a reviewable artifact.

Within the assigned ownership lane, agents may perform reversible, non-destructive work such as source edits, tests, focused refactors, UX improvements, documentation, security patches, accessibility and performance work, and local/isolated development fixtures. Preview/test integrations must use non-production credentials and data.

**No agent may change founder-approved product pricing, account types, entitlements, or the non-dispatch business scope merely because a historical branch or code path disagrees.** Propose such changes, identify affected specifications, and await an explicit new decision.

### 3.1 Concurrent agent file ownership

The current lanes and path owners are defined once, in `docs/AGENT_WORKFLOW.md` §3 and §7. Each issue's "Owned files" and "Prohibited overlap" fields govern the task in front of you. In summary:

- **Claude Agent 1** — database integration; the single editor of `architecture/normalized-v2/`.
- **Claude Agent 2** — documentation, the root files and coordination.
- **Claude Agent 3** — V2 UX design.
- **Codex** — V2 frontend implementation.
- **Gemini** — SQL author, on standby.
- Security Auditor, QA, Product (public copy), Research, and Adapter agents, as each issue assigns.

Ownership is **current coordination**, not a permanent permission. A specific newer assignment may adjust ownership. Before editing, inspect `git status`, current branch, untracked files, and active agent ownership. Do not assume a clean checkout. Untracked files may be critical work from another agent.

### 3.2 Resource discipline

The local machine has a 512 GB SSD. Monitor C: free space and major development directories before/after heavy tasks. Investigate unexplained consumption exceeding **500 MB** per batch. Use existing Edge for browser tests; do not install Chrome, Docker, WSL, duplicate Node versions, or large Playwright browsers without an actual need and approval.

Use pnpm's existing store, prune only clearly obsolete caches or generated artifacts, and never indiscriminately delete shared stores, active caches, security sandboxes, user files, credentials, uncommitted worktrees, or Git data. Avoid redundant full builds and screenshots. Treat disk statistics as measurements, not proof of which process caused growth.

## 4. Human approvals and hard stops

Stop and obtain explicit accountable human authorization before:

- Paid plan upgrades, new paid cloud resources, or purchases.
- Domain purchase, DNS cutover, or production-domain changes.
- Production deployments or merges into auto-deploying `main`.
- Any live customer charge, refund, payout, subscription activation, marketplace boost sale, or other financial action.
- Any production database migration, production-state mutation, cutover, deletion, purge, or provider configuration change unless specifically scoped and authorized; destructive operations require additional backup/rollback review.
- Credential rotation, revocation, broadening provider access, or exposure of sensitive tokens.
- Account, organization, repository, asset, or domain ownership transfers.
- Public launch announcements, purchased ads, public marketing campaigns, or bulk promotional email.
- Legal/regulatory filings and actions requiring unavailable MFA or other accountable human intervention.

Ordinary **local** code changes, pure domain rules, synthetic tests, and disposable preview work do not require repeated permission within an already approved lane. A broad instruction to develop the product never implies permission to mutate live data, enable commercial collection, or deploy.

If one task is blocked by a hard stop, document it precisely and continue independent safe work.

## 5. Engineering priorities and implementation sequence

Prioritize useful user outcomes over internal surface area:

1. **Reconcile current specifications and the existing implementation.** Keep the commercial blueprint authoritative and the UX spec available; preserve historical obligations.
2. **Validate the normalized relational prototype** and its tenant/identity boundary in a permitted disposable database. Coordinate Gemini's schema with `packages/contracts/src/membership.ts`; no competing designs.
3. **Deliver the first real marketplace slice:** a landing creates a legitimate opportunity; a hauler discovers it; the hauler expresses interest; the landing reviews and replies; private data stays protected.
4. **Implement the free hauler and fleet experiences:** clear company profiles, equipment details, self-reported availability, saved jobs, normal notifications, and multi-truck expressions of interest.
5. **Implement landing subscription entitlements in test mode:** active landing limits, team limits, billing-cycle invitation allowances, organization context, and honest downgrade behavior.
6. **Build proactive recruiting:** consent-based targeted invitations, availability filters/alerts, rate limits, deduplication, and low-audience safeguards.
7. **Build fixed-duration sponsored boosts:** actual audience eligibility, labeled visibility, regional relevance, expiry, and measured performance.
8. **Build focused admin controls:** verification, moderation, audit trail, support, entitlements, founding-member eligibility, and marketplace health.
9. **Validate legal, privacy, customer, technical, and commercial activation gates** before launch, billing activation, or provider cutover.
10. **Retire old pilot functionality incrementally** after replacements, data preservation, and explicit approval; do not maintain an elaborate dispatch system just because it already exists.

Security, correctness, privacy, reliability, and vulnerability remediation apply across every step. A serious production-relevant defect can preempt the sequence.

## 6. User experience and functional contracts

The detailed UX specification is the screen-level source. The minimum expectations below guard against reintroducing the old product.

### 6.1 Public marketplace

- The home page must explain the two-sided load board plainly; avoid long decorative landing pages, fictitious reviews, invented listings, or invented marketplace statistics.
- Public job discovery is accessible without forced registration where safe. Search results are **text-first**, quick to load, and usable without a working map.
- Show pay amount **and pay basis** (for example, per load, per mile, per hour, or negotiable), product/log type, origin area, destination or destination area, estimated distance, equipment, start date, expected duration, estimated daily volume, truck demand, freshness, and other material requirements when provided.
- Distinguish poster-stated estimates from independently verified facts. Don't compute or promise earnings the system cannot support.
- Sponsored placements must be visibly labeled and must not silently hide relevant organic jobs.

### 6.2 Landing Operator workspace — paid

Keep a concise desktop sidebar and mobile-prioritized navigation:

- **Overview:** active landings, live postings, new inquiries, remaining invitation allowance, and clear next actions.
- **My Landings:** reusable physical location records, active/inactive state, public approximate location, restricted access instructions, contacts, typical equipment, and job association.
- **Job Postings:** create, edit, pause, reconfirm, expire, duplicate a legitimate template, and promote a job. Unlimited genuine posts within permitted active landings.
- **Inquiries:** review interested hauler businesses and declared truck counts, respond, request clarification, decline, and mark conversations closed. Do not require tracking contracts or completed loads.
- **Find Trucks:** browse hauler profiles; on eligible plans use saved equipment/geography searches and availability alerts; send quota-controlled targeted notices.
- **Team:** invite and manage named users; enforce 2/5/10 seats (including owner) and location-specific permissions as appropriate.
- **Billing and Promotions:** display the exact plan, recurring price, active landing and team allowances, invitation usage/reset, applicable founder discount, boost purchases, invoices, and truthful activation states.
- **Settings:** business profile, permissions, communications, and privacy preferences.

The landing should not have to count every truck hired, loads hauled, dispatch assignments, or invoices paid to haulers.

### 6.3 Independent Hauler workspace — free forever

- **Find Work:** fast list/search, optional lazy-loaded map, saved filters/jobs, and clear nearby opportunities.
- **Job Detail:** transparent rate/basis, distance and route context, equipment fit, landing weather, duration, estimated volume, and posting freshness; private details stay restricted.
- **Express Interest:** a short, nonbinding introduction with offered truck count, equipment, available dates, and optional note. Do not label it a transportation contract or assigned trip.
- **My Inquiries / Invitations:** statuses for messages and proactive notices, without implying a haul was booked or completed.
- **My Profile:** business identity, service region, truck/trailer details, useful photos, relevant qualifications with truthful verification labels.
- **Availability:** simple self-reported current/future capacity and freshness timestamp; no GPS surveillance or mandatory dispatch records.
- **Alerts and Settings:** consent-based job alerts, targeted invitation preferences, privacy controls, and unsubscribe/mute.

No paid tier, subscription prompt, fee deduction, or privileged job access is required for haulers.

### 6.4 Fleet workspace — a free hauler capability

A company with one truck uses the same base account as a company with ten. As equipment and membership complexity grows, reveal additional tools:

- Equipment inventory and specifications.
- Self-reported available capacity by configuration, date, and broad service region.
- Business-level profile, photos, and qualified contacts.
- Multi-truck interest responses on relevant job postings.
- Authorized free staff collaboration on equipment, inquiries, and profile maintenance.

**Do not** create paid Fleet/Dispatch Pro enrollment or resurrect trip schedules, electronic logs, maintenance systems, scale-ticket storage, load completion, settlements, or employee timesheets.

### 6.5 Internal Platform Admin

Provide least-privilege, auditable tools for business verification, abuse reports, job moderation, subscriptions/entitlements, founding promotions, boost inventory, invitation delivery issues, support, regional marketplace-health monitoring, and security audit review.

Public users, ordinary organization owners, and support staff must not inherit platform-admin privileges. Admins should not browse precise private landing details without an explicit, logged, authorized support reason.

### 6.6 Additional product-quality recommendations

Prioritize as implementation scope and customer feedback warrant: saved jobs and searches, clear pay-basis comparisons, last-confirmed posting timestamps, shortlisting, low-data mode, urgent but non-spam job visibility, useful road-condition links with source/time, transparent weather age, optional equipment photos, accessibility, and report-stale-listing tools.

These are **recommendations**, not blanket permission to expand the MVP. Do not implement speculative reputation algorithms, permanent driver location tracking, expensive route engines, or generic trucking SaaS modules without a specific acceptance criterion and approval.

## 7. Providers, data, security, legal, money, email, and identity

### 7.1 Provider boundaries

The intended stack is:

- **Application/deployment:** Next.js on Vercel, GitHub workflow.
- **Database/geospatial:** Supabase PostgreSQL/PostGIS, normalized tenant-isolated target; legacy `operating_state` remains until controlled replacement.
- **Private media:** Supabase Storage. Cloudinary is not the default active private-media provider.
- **Identity:** Clerk; app memberships and server-side permissions determine authorization. Supabase RLS requires a *verified* Clerk-to-Supabase trust path, not arbitrary JWT text or client-provided organization IDs.
- **Maps:** **MapLibre GL JS renderer + CARTO Basemaps** as the preferred basemap provider; PostGIS performs spatial filtering. It is implemented in `apps/web/lib/map-runtime.ts` and `carto-basemap.ts`, through `NEXT_PUBLIC_CARTO_BASEMAP_KEY`. The founder reports a CARTO allowance of **5 million requests/month**. This allowance **requires account verification**, covering scope, restrictions, terms and consumption, before anyone relies on it commercially (#114). Legacy Mapbox code is used only when no CARTO key is set, and is not the preferred implementation.
- **Weather:** Existing weather integration; show source and timestamp, use graceful failure, and avoid fetching weather for every search-result card.
- **Monitoring and communications:** PostHog, Sentry, Resend, subject to consent, data minimization, and appropriate configuration.
- **Billing for new model:** Stripe subscriptions and one-time boosts **after explicit activation**; historical billing integrations remain disabled/read-only as needed for valid old records.
- **Shared rate limiting:** Supabase-backed windows with HMAC-pseudonymized identifiers and tested failure behavior.

Do not add or substitute paid providers merely because they are available. Reuse existing free entitlements and student/developer benefits where lawful and compatible, without assuming those benefits or quotas are unlimited or permanent.

### 7.2 Credential handling

- Never print, commit, echo, screenshot, log, paste into a PR, or send actual private keys or credentials in chat.
- Secrets and service-role tokens remain server-side, in ignored local files or secure provider configuration; limit scopes and use separate development/test/production credentials.
- CARTO **browser-facing basemap keys may be visible in browser requests**. Treat them as public client credentials for exposure purposes; apply permitted origin/domain restrictions and usage monitoring. Never confuse them with secret Workspace credentials.
- Do not disclose exact private provider URLs, tenant data, gate instructions, identity tokens, or other sensitive information in logs or reports.
- Do not mutation-test production through a development connection or shared project; verify project identity and environment first.

### 7.3 Identity and tenant isolation

- Derive user identity from a validated server session or verified JWT accepted by the relevant trusted service; do not trust arbitrary request-body identities, roles, organization IDs, or active-organization claims.
- Check a user's **current organization membership and role** on every protected operation; cross-organization membership must not leak data between contexts.
- Use RLS on normalized tables as defense in depth, with minimum grants and audited privileged functions. Do not assume RLS protects calls made using service-role privileges.
- Preserve existing service-layer authorization, compare-and-swap correctness, guarded state changes, and no-unapproved-runtime-delete behavior until the new model replaces them.
- Use synthetic fixtures by default and redact real personal, commercial, and site-access data in artifacts.

### 7.4 Sensitive location and information disclosure

- Public browsing uses an approximate landing area; do not expose precise private coordinates, gate codes, private roads, sensitive facility instructions, protected contacts, or credential media.
- **Expressing interest alone does not unlock private details.** The landing organization must explicitly authorize sharing for the relevant inquiry/organization, using a narrowly scoped, audited action. Reject requests for other organizations' private data.
- Don't infer that a truck is on duty or geographically present simply because its owner was recently active on the site.
- Public company profiles can show information the business has agreed to publish, while private personal contact records remain protected.

### 7.5 Commercial activation and historical obligations

**Current approved model for future launch:** paid landing subscriptions and optional advertising boosts; free haulers/fleets. **It is not automatically activated by documentation, code, schema seeds, or Stripe test products.**

The old models — `percentage_v1`, `legacy_percentage`, `subscription_v1`, and Dispatch Pro — are **historical**, not valid new-enrollment options. Their existing events, invoices, frozen terms, Stripe identifiers, reconciliation and webhook/idempotency safeguards must remain recoverable and parseable until a separately authorized retirement.

- Do not generate new 5% fee obligations, per-load invoices, or percentage-based charges for new activity.
- Do not reinterpret old obligations as new subscriptions, erase them, or double-bill them.
- Maintain the existing disabled gates, including `LOGLOADS_FEE_COLLECTION`, `LOGLOADS_PERCENTAGE_ENROLLMENT`, `LOGLOADS_SUBSCRIPTION_COLLECTION`, and `LOGLOADS_DISPATCH_SELF_SERVE`, where they still protect legacy code. **Do not repurpose those gates to activate the new business model.**
- Historically frozen fee calculations and payment-status rules remain historical data-integrity constraints, **not instructions to build new trip-completion or driver-payment features**.
- Any Stripe subscriptions, promotions, founding discounts, tax treatment, proration, cancellations, refunds, failed-payment grace, invitation usage, or boosted placement activation needs documented terms, reconciliation, authorization and relevant tests before live use.
- No custody of freight funds, transfer to a hauler, wallet, escrow, or driver-pay deduction. Existing bans on `transfer_data`, nonzero `application_fee_amount`, and similar transfer-based trucking payment paths remain protective guardrails.

**Legal:** Neither a subscription nor a promotional-credit model itself determines whether an activity constitutes transportation brokerage or another regulated service. Obtain qualified transportation-law review of the *actual workflow* — especially targeted introductions, communication, and commodity/route specifics — before real commercial activation. Do not claim LogLoads is a licensed broker, carrier, insurer, dispatcher, payment guarantor, or legally exempt intermediary without verified authority.

### 7.6 Email and notifications

- Resend/internal delivery tests may target controlled recipients in non-production and must be accurately labeled.
- Public broadcasts, bulk imported recipients, and marketing campaigns require approval, lawful consent, unsubscribe controls, and provider compliance.
- Ordinary job alerts and targeted invitations require appropriate opt-in and limits; a successful API request does not alone prove delivery.
- Protect against duplicate invitations and abuse; apply regional audience safeguards before charging for outreach/boost features.

## 8. Design system, information quality, and field performance

LogLoads serves real users operating on phones, sometimes on weak rural connections. Prioritize **a readable list of authentic opportunities**, then optional maps and additional detail. Do not make map rendering a prerequisite for discovering a job.

- Mobile-first, responsive on phone/tablet/desktop; adequate touch targets, semantic forms, keyboard operation, accessible contrast and error states.
- Load only what the page needs. Use lazy-loaded MapLibre/CARTO views, compressed images, server-rendered core text, and request-efficient APIs.
- Offer graceful low-data and offline/error states where feasible. Do not block the application because mapping, weather, or third-party services are slow or unavailable.
- Use meaningful information hierarchy: pay amount and basis, equipment, location/region, destination, route context, work duration, truck demand, posting freshness, and action to express interest.
- Keep advertised pay and reported availability attributable to their source. Do not fabricate active jobs, testimonials, verification badges, reach claims, or recruitment performance.
- Preserve CARTO/OpenStreetMap and other required attribution. A sponsored boost must always be identified as Sponsored.
- Reuse `packages/ui` design tokens/primitives and the established semantic Phosphor icon registry; don't create competing component libraries or scattering of ungoverned colors.
- **`LogLoads` and `logloads.com`** remain the product/domain names. `LogBoard` is retired; the existing `logloads` social identity remains the working name.
- Do not make an obsolete Schedule cockpit, assignment dashboard, trip timeline, driver settlement, or completion confirmation part of the new UI.
- Measure mobile performance and accessibility on the actual changed path; do not mistake a successful build for a good user experience.

## 9. Branch, staging, ownership, review, and deployment

Before work, record the branch, HEAD, working tree, acceptance criteria, and file owner. Inspect both tracked and untracked files to avoid interfering with concurrent agents.

- **No direct push to `main`. No production merge or deploy without explicit founder approval.**
- The current integration branch is **`work/logloads-repair`**. Work reaches it **only through a reviewed PR** from the owner's own branch. No agent merges a PR, its own or another's, without explicit founder authorization, even when CI is green.
- Use scope branches such as `feat/<lane>/<slug>`, `fix/<lane>/<slug>`, `docs/<lane>/<slug>` and `test/<lane>/<slug>`, each in its own worktree (§0).
- Merge stacked PRs with **merge commits**. Squash or rebase merges break the PRs stacked on top.
- One coherent change set per owner. Never overwrite, `git clean` away, reset, stash, rebase over, or delete somebody else's in-progress work without coordination.
- No force pushes, history rewrites, bypassed checks, self-merges, unauthorized branch deletion, or accidental commits of secrets/build outputs.
- A completed **local deliverable** may be handed off without a push if the assignment forbids Git operations (for example Gemini's SQL prototype). Call it *uncommitted* until integrated. Work requiring a pushed artifact is complete only after confirming the remote commit SHA.
- Keep reviewable PRs small. The maintainer reviews and merges; agents do not merge just because CI passes.
- Historical billing/dispatch retirements, production migrations, and provider changes need independent review and explicit authorization beyond a normal code change.

## 10. Verification and definition of done

Use the repository's actual available scripts and Node 24.16.0/pnpm 10.12.4. Relevant existing commands include:

```text
pnpm install --frozen-lockfile
pnpm setup:local
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm guardrails
pnpm validate
pnpm test:e2e
pnpm db:check
git diff --check
```

`pnpm db:check` and `pnpm db:assert` **reset the local Supabase database**. Without the Supabase CLI and Docker they skip and exit 0, and a local skip is not a pass. Normalized-v2 SQL runs only in CI (`docs/CI.md`). Record test evidence on the issue, and record schema-level evidence in `docs/CI.md` §3.

Do not run every command indiscriminately on every small edit. Choose proportionate verification; `pnpm validate` and full builds can be costly. Use an isolated production-build directory/worktree when a dev server is running. Never silently skip a required check or present static inspection as execution.

- **Domain/entitlement changes:** test exact plan values, seat/landing limits, no invitation rollover, exhausted allowance, duplicate sends, and boundary cases.
- **Database/RLS changes:** execute on disposable PostgreSQL/Supabase with validated auth and cross-tenant denial tests before claiming database security; if execution is blocked, say so clearly. Do not require Docker installation merely to satisfy a report.
- **Security changes:** exercise the real service boundary, not only a helper, with negative and adversarial cases.
- **UX changes:** demonstrate the affected journey with meaningful data, keyboard/mobile accessibility, and no private-data leaks. Use installed Edge when possible.
- **Payment changes:** test-mode only until activation approval; verify idempotency, amount display, entitlement timing and no double-billing.
- **Documentation-only changes:** run `git diff --check` and verify references/consistency; do not claim code tests passed unless they were run.
- **Performance/resource changes:** record relevant payload/tile/image and disk measurements, including failed cases or regressions.

A deliverable is satisfactory only when its acceptance criteria are met, security/provider boundaries remain intact, changes and tests are clearly reported, and any remaining blocker is explicit. Do not claim skipped, mocked, synthetic, local, or preview behavior as production proof.

## 11. Production posture and activation blockers

Historical evidence in the old contract references a **July 29, 2026** provider snapshot of `logloads.com`, with Clerk, Supabase, Resend, Storage, PostHog, Sentry, and then-current billing components configured. That is a **historical snapshot**; it does not prove current production health, branch SHA, revenue, entitlement status, or authorization to sell the newly approved model.

As of the reviewed repository materials, LogLoads was described as pre-customer with **no confirmed real paying customers**; do not extrapolate this into an independently verified current statistic. Seeded demo accounts, synthetic jobs and fixture data are never real adoption evidence.

The approved November 1 product is an implementation target, **not a claim that V2 is live**. The deployed pilot may still expose old Driver/Fleet/Host/Admin cockpits and old percentage/subscription plumbing behind disabled controls.

Before any public or commercial activation, verify at minimum:

1. Exact production deployment SHA, provider identities, and environment separation.
2. Reviewed normalized schema, RLS enforcement, migration/rollback, privacy redaction, and valid accounts.
3. Real workflow from posting to discovery, expression of interest, reply, and explicit private-detail disclosure, without dispatch/settlement dependence.
4. Accurate Basic/Pro/Regional entitlements, team/landing limits, invitation accounting, and no rollover.
5. Verified CARTO entitlement/key restrictions and actual map resource loading; correct attribution and usage monitoring.
6. Published subscriptions, terms, renewal/cancellation/refund rules, taxes, founding discounts, and boost disclaimers.
7. Transportation-law review of actual outreach/advertising behavior; lawful notifications, consent, privacy and moderation.
8. Legitimate, permissioned early customers and verified regional supply density; no misleading launch or promotion claims.
9. Controlled Stripe billing/webhook/idempotency tests and a separately authorized live-money activation decision.
10. Production health, monitoring, accessibility, weak-network behavior, and incident/rollback procedures.

Do not enable legacy fee collection or self-service enrollment to work around new subscription activation. Avoid changing production state while attempting to prove test readiness.

## 12. Required agent handoff format

Every development handoff must report:

1. **Context:** governing product decision/spec, branch, HEAD, base, and files owned.
2. **Customer outcome:** what real workflow improved and for whom; not merely a list of tasks completed.
3. **Changes:** exact files added/updated/removed, with a concise reason for each logical batch.
4. **Evidence:** commands and tests executed; pass/fail/skipped with counts, environment, and synthetic/test/preview labeling.
5. **Boundaries:** explicit data, identity, money, email, mapping/provider, deployment, DNS, legal, and security impact; say *none* where applicable.
6. **UX proof:** screenshots only when useful; mobile/keyboard/accessibility observations, and any existing design regression.
7. **Resource use:** approximate disk change, temporary artifacts remaining, and whether cleanup was performed safely.
8. **Risks and next dependency:** blockers, unresolved founder decisions, migration/rollback implications, and production activation gates.
9. **Git state:** commits, remote SHA verification, PR URL/state, or clearly state that files remain uncommitted because the assignment prohibited staging/pushing.

Do not conceal failures or imply that a static schema prototype, green health endpoint, payment test, or seeded marketplace represents real customer readiness.

## 13. Change control and superseded instructions

This contract replaces the previous AGENTS.md's *active-product* directives requiring:

- `Plan → Publish → Match → Commit → Coordinate → Haul → Confirm → Repeat`.
- Truck assignment, route packs, trip updates, physical completion, driver-payment records, and schedules as V2 product requirements.
- `percentage_v1` as the new commercial model or the sole active future billing gate.
- Paid Fleet/Dispatch Pro functionality as an enrollment path.
- Mapbox as preferred new basemap provider, with MapLibre/CARTO only as an incidental fallback.
- Map-first rendering that blocks a fast, readable load list.
- Automatic release of private landing details on an obsolete *assignment* event.
- Mandatory extra Git worktrees for every small task. Concurrently active agents still use separate worktrees (§0).

The former functionality may remain in the **legacy codebase and preserved history** until carefully retired. It is not a development mandate.

**New business model or entitlement changes require a founder-approved revised specification and dated decision record.** Technical implementations may evolve to satisfy the agreed requirements, but cannot silently replace them.
