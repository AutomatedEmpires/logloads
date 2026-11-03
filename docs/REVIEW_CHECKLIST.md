# Engineering Review Checklist

> **Status:** APPROVED review gate, revised 2026-11-02. Use it for every PR and agent handoff. Mark each item **pass**,
> **fail**, **N/A** (with a reason), or **not run**. A skipped or unrun check is never reported as passing.
>
> Authority: [`AGENTS.md`](../AGENTS.md); [`DECISIONS.md`](./DECISIONS.md);
> [`product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md`](./product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md);
> [`product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md`](./product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md).

## 1. Product conformity

- [ ] The change serves the load-board loop: publish → discover → express interest → reply. It adds no
      dispatch, slots, assignments, trips, completion, settlement, scale tickets, per-load or percentage
      fees, or freight-payment handling (Blueprint §1.3, §12.5).
- [ ] Plan values match the Blueprint and `packages/contracts/src/membership.ts` exactly:
      - Basic / Pro / Regional: $149 / $299 / $499 per month;
      - active landings: 1 / 3 / unlimited;
      - seats, owner included: 2 / 5 / 10;
      - invitations per cycle: 3 / 10 / 30, with no rollover;
      - boosts: $99 / 7 days, $149 / 14 days, $199 / 28 days;
      - founding offer: 50% off for 6 cycles, first 10 qualifying landing organizations per launched state.

      There is no second copy of these numbers.
- [ ] Haulers and fleets stay free. No hauler paywall, paid fleet tier, or Dispatch Pro path.
- [ ] Screens and flows follow the UX spec. Items the spec labels as recommendations are not shipped as
      approved scope without a decision.
- [ ] Any change to pricing, plans, entitlements, or scope cites a new Blueprint version and a dated
      decision. An agent never changes them silently.

## 2. Current versus target honesty

- [ ] Docs, PR text, and UI copy use the six status labels in [`README.md`](./README.md) §2:
      APPROVED / IMPLEMENTED / VERIFIED / TARGET / HISTORICAL / UNVERIFIED.
- [ ] Every VERIFIED claim links its evidence, recorded in [`CI.md`](./CI.md) §3 for test runs. A passing SQL
      suite is not presented as live-Supabase or Clerk proof.
- [ ] Nothing describes the `/v2` preview, the normalized-v2 prototype, Stripe test objects, or seeded data
      as live, launched, or customer-ready.
- [ ] Code that still runs on `public.operating_state` is not described as relational or RLS-protected.

## 3. Tenant isolation and RLS

- [ ] Identity comes from the server session (`apps/web/lib/session.ts`). No client-supplied actor, role, or
      organization ID is trusted.
- [ ] Every protected operation checks the current organization membership and role on the server. A
      multi-organization user cannot reach another context's data.
- [ ] Service-role code paths are treated as bypassing RLS. Their authorization is explicit in the service
      layer.
- [ ] Normalized-schema changes include cross-tenant **negative** tests, executed on a disposable database. A
      policy's existence is not proof.
- [ ] Simulated JWT claims are not presented as verified Clerk tokens ([`SECURITY.md`](./SECURITY.md) §4).

## 4. Private landing access

- [ ] Public lists, details, maps, RPCs, logs, and errors expose only the approximate area. No exact
      coordinates, gate codes, access roads, private contacts, or credential media.
- [ ] Expressing interest discloses nothing. Disclosure happens only through an explicit, audited landing
      action scoped to one inquiry or organization.
- [ ] Platform admins cannot browse private details without a logged support reason.

## 5. Membership and paid entitlements

- [ ] Limits are enforced on the server. The UI only reflects them.
- [ ] Seat counting matches the contract: drivers and free hauler/fleet roles never consume paid landing
      seats.
- [ ] A downgrade never silently suspends members or deletes landings. Excess is resolved explicitly.
- [ ] Inbound interest, replies, postings, and truck counts stay unmetered.

## 6. Invitation quotas and concurrency

- [ ] Reservation, delivery, failure, release, and expiry are atomic. Two simultaneous sends cannot overspend
      the last credit, and a failure refunds at most once.
- [ ] No rollover between cycles. Ordinary inquiries never debit the allowance.
- [ ] Recipients are opted-in hauler businesses only. Deduplication and per-recipient frequency rules are
      applied and tested.
- [ ] Concurrency claims rest on real multi-session tests ([`CI.md`](./CI.md) §3), not
      single-session assertions.

## 7. Mobile, accessibility and low bandwidth

- [ ] The changed journey works at phone width with adequate touch targets and full keyboard operation. It
      has visible labels, errors, and contrast.
- [ ] Results are text-first and usable with the map disabled or failing. Maps and weather load lazily and
      fail gracefully.
- [ ] Measured on the actual changed path. A successful build is not UX evidence.

## 8. Tests and verification evidence

- [ ] State-machine or service-rule changes add or update tests (`CLAUDE.md`).
- [ ] The PR body lists the exact commands run, with pass/fail/skip counts and the environment. For example:
      `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm guardrails`, `pnpm validate`,
      `pnpm test:e2e`, `git diff --check`.
- [ ] `pnpm validate` / `pnpm db:assert` skipped locally for lack of Docker or the Supabase CLI is reported as
      **skipped**. CI must run it.
- [ ] Documentation-only changes: `git diff --check` passes, local links resolve, and current-behavior claims
      were checked against code.

## 9. Historical financial preservation

- [ ] `percentage_v1`, `legacy_percentage`, and `subscription_v1` records — fee events, invoices, frozen
      terms, provider IDs, and webhook/idempotency records — remain intact and parseable.
- [ ] No change creates a new percentage, per-load, Dispatch Pro, or `subscription_v1` obligation.
- [ ] `LOGLOADS_FEE_COLLECTION`, `LOGLOADS_PERCENTAGE_ENROLLMENT`, `LOGLOADS_SUBSCRIPTION_COLLECTION`, and
      `LOGLOADS_DISPATCH_SELF_SERVE` remain default-disabled. None is repurposed for the new model.
- [ ] New-model billing, when built, has its own gates and its own Stripe catalog.

## 10. No unauthorized production operations

- [ ] No merge to `main`, no deploy, and no production migration, restore, or data mutation without explicit
      founder authorization.
- [ ] No live charge, subscription activation, boost sale, provider configuration change, DNS change,
      credential rotation, or bulk email.
- [ ] `pnpm db:check` and any `supabase db reset` ran only against disposable stacks.
- [ ] No secrets, tokens, backup files, or real personal data in the diff, logs, screenshots, or PR text.
- [ ] New environment variables are documented in `.env.example`, `ops/production-env-contract.json`,
      [`ENV_CONTRACT.md`](./ENV_CONTRACT.md), and [`ENVIRONMENT.md`](./ENVIRONMENT.md) together.

## 11. Agent ownership and Git safety

- [ ] The work has a GitHub issue on Project Board #10, and the PR links it. Lanes are respected
      ([`AGENT_WORKFLOW.md`](./AGENT_WORKFLOW.md) §7). No agent edits or stages another lane's unfinished files.
- [ ] `git status` was inspected first. Untracked files from other agents are left untouched. Nothing was
      reset, cleaned, stashed, or rebased over someone else's work.
- [ ] One coherent change set. No force push, history rewrite, bypassed hook, or self-merge.
- [ ] The handoff reports branch, HEAD, changed paths, commands with results, boundaries touched (or
      *none*), remaining risks, and the commit SHA ([`AGENTS.md`](../AGENTS.md) §12).
