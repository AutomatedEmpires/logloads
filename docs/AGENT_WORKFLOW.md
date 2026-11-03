# LogLoads — Agent Workflow and File Ownership

> **Status:** CURRENT quick reference, revised 2026-11-01.
>
> **Authority:**
> - [`AGENTS.md`](../AGENTS.md) — working protocol, hard stops, handoff format.
> - [`DECISIONS.md`](./DECISIONS.md) and the Blueprint — product and commercial decisions.
> - The UX spec — screens and interactions.
>
> This document makes no product decisions. For review gates, see
> [`REVIEW_CHECKLIST.md`](./REVIEW_CHECKLIST.md).

## Before editing

1. Check `git status -sb`, the branch, HEAD, open PRs, untracked files, and which agent owns what. Untracked
   files may be another agent's unfinished work.
2. Read the smallest relevant source, plus — where they apply:
   - [`product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md`](./product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md);
   - [`product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md`](./product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md);
   - [`product/TRANSITION_PLAN.md`](./product/TRANSITION_PLAN.md).
3. Confirm no other agent is writing the same files.
4. Define a small user outcome, with checks and boundaries:
   - no dispatch;
   - no per-haul fees;
   - no new billing without approval.

## Lanes (current coordination)

| Lane | Owns | Must not |
|---|---|---|
| Claude Session 1 — application integrator | `apps/`, `packages/`, `supabase/`, `.github/workflows/`, V2 slice, CI, Git integration onto `work/logloads-repair` | Stage Gemini's or Codex's unfinished files |
| Claude Session 2 — documentation | `docs/` only, on its own branch/worktree | Touch code, workflows, `architecture/normalized-v2/`, env files, or production |
| Gemini — normalized database | `architecture/normalized-v2/` | Edit existing migrations, touch live Supabase, or run shared Git operations |
| Codex — assigned tests / review | Its assigned regression tests and artifacts | Refactor source unapproved, or touch production |

A newer, explicit assignment can change these lanes.

## Where things live

| Path | Contents |
|---|---|
| `packages/contracts` | Shared domain contracts, membership rules, authorization semantics |
| `packages/services` | Business rules, authorization, idempotency, transitions |
| `packages/db`, `supabase/` | The deployed pilot storage and reviewed migrations. Do not copy prototype SQL here before CI execution and explicit integration approval. |
| `architecture/normalized-v2/` | Gemini's non-active SQL prototype, until accepted |
| `apps/web` | Thin route handlers, server actions, UI, data adapters |
| `docs/` | Truthful CURRENT / TARGET / HISTORICAL descriptions. Historical records live in [`archive/`](./archive/README.md). |

When a contract changes, update [`BACKEND_ARCHITECTURE.md`](./BACKEND_ARCHITECTURE.md),
[`DATA_MODEL.md`](./DATA_MODEL.md), and [`API_CONTRACTS.md`](./API_CONTRACTS.md) in the same change, or hand
the update to the documentation lane explicitly.

## Verification and publishing

- Run targeted typecheck, unit, and security checks, `pnpm guardrails`, and proportionate build or browser
  coverage.
- `pnpm validate` includes `pnpm db:assert`, which **skips locally** without the Supabase CLI and Docker.
  Report the skip; do not call it green.
- Run destructive resets only on disposable stacks.
- For UI changes, reproduce mobile, keyboard, and redaction behavior.

Each lane commits only its own files. The handoff reports the items in [`AGENTS.md`](../AGENTS.md) §12:

- branch and HEAD;
- changed paths;
- commands with real pass/fail/skip results;
- provider or data mutations, or **none**;
- PR status;
- other agents' uncommitted files left untouched;
- risks and rollback.

Never do any of the following without separately scoped authorization:

- merge to `main`;
- deploy;
- change production state;
- send campaigns;
- rotate credentials;
- activate payments.
