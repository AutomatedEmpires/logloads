# LogLoads — Agent Workflow and File Ownership

> **Authority:** `AGENTS.md` first for working protocol; `docs/DECISIONS.md` and the approved blueprint for product/commercial decisions. The UX spec governs screens and interactions. This is an execution quick-reference, not a new product decision.

## Before editing

1. Check `git status -sb`, branch, HEAD, current PRs, user-supplied modified files and existing agent ownership.
2. Read the smallest relevant source plus `docs/product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md`, `docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md`, and `docs/product/TRANSITION_PLAN.md` where applicable.
3. Confirm no overlapping writers. Claude's application/commit lane, Gemini's isolated `architecture/normalized-v2/` lane and Codex's assigned validation lane must not stage each other's unfinished work.
4. Define a small user outcome with checks and boundaries: no operational dispatch, no fees per haul, no new billing without approval.

## Implementation responsibilities

- `packages/contracts` — shared UI/domain input/output contracts, membership and authorization semantics.
- `packages/services` — business rules, authorization, idempotency and state transitions.
- `packages/db`, `supabase/` — deployed storage and reviewed migrations; do not copy prototype SQL here before tests and explicit integration approval.
- `architecture/normalized-v2/` — Gemini-owned non-active SQL prototype until accepted/handed off.
- `apps/web` — thin route handlers, server actions, UI, safe data adapters and presentation.
- `docs/` — truthful current/target descriptions; historical records remain designated archival evidence.

## Verification and publishing

Run targeted typecheck/unit/security checks, `pnpm guardrails`, and appropriate build/browser coverage. `pnpm validate` includes a database step that may *skip locally* without Supabase CLI/Docker; document any skip instead of calling the migration proof green. Use a disposable database for destructive local reset. Reproduce mobile/keyboard and redaction behavior for UI changes.

Only the integration owner stages and commits owned code. Report branch/HEAD, changed paths, commands and actual pass/fail/skip, provider or data mutations (including **none**), PR status, uncommitted other-agent files, risks and rollback. Never merge `main`, deploy, modify production state, send public campaigns, rotate credentials or activate live payments without separately scoped authorization.
