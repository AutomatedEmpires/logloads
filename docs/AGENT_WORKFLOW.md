# LogLoads — Agent Coordination

> **Status:** APPROVED process, revised 2026-11-02.
> - **Source of truth for tasks:** GitHub Issues in `AutomatedEmpires/logloads`, tracked on
>   [Project Board #10](https://github.com/users/AutomatedEmpires/projects/10).
> - No Markdown file keeps task status. This one defines the process only.
> - Product authority is unchanged: [`README.md`](./README.md) §1.

## 1. Before any work

1. Open the board. Find **your** issue, or ask the coordinator (Claude Agent 2) to create one. **No work starts
   without an issue.**
2. Read the issue's owned files and prohibited overlap.
3. Run `git status`, and check the branch and HEAD. Untracked files may belong to another agent: never stage,
   reset, clean, stash or rebase over them.
4. Read the smallest relevant source, plus the authority documents the issue cites.

## 2. Every task issue contains

These fields come from the template at `.github/ISSUE_TEMPLATE/agent_task.yml`:

- **Agent owner** — exactly one.
- **Objective** — the outcome, not a list of activities.
- **Priority**.
- **Branch / worktree**.
- **Owned files**.
- **Prohibited overlap**.
- **Acceptance criteria**, including the evidence required for Done.
- **Dependencies** — linked issues or PRs.
- **Out of scope**.

## 3. Board fields

| Field | Values |
|---|---|
| **Status** | Backlog → Ready → In Progress → Blocked → In Review → Done |
| **Priority** | P0 (production risk or blocker) · P1 (current milestone) · P2 (later) |
| **Agent Owner** | Claude Agent 1 (database integration) · Claude Agent 2 (docs / coordination) · Claude Agent 3 — UX · Codex (V2 frontend) · Gemini (SQL author, standby) · Claude Security Auditor · Claude QA (Playwright) · Claude Product (public copy) · Claude Research (market validation) · Claude Adapter (normalized adapter) · Founder |

A single-select field holds one owner. On a shared issue the board shows the primary owner, and the issue body
names the collaborators.

Lane labels describe the subject of an issue. Status and priority are **never** expressed as labels:

`lane:database` · `lane:v2-frontend` · `lane:docs` · `lane:security` · `lane:qa` · `lane:product-copy` ·
`lane:integration` · `lane:coordination` · `lane:research`

All agent issues also carry `agent-task`.

## 4. How status moves

| Move | Who may make it | Required |
|---|---|---|
| → Ready | Coordinator or founder | Issue fields complete; dependencies known |
| → In Progress | Owner | A first comment naming the branch and worktree |
| → Blocked | Owner | A comment stating the blocker and who can clear it |
| → In Review | Owner | A PR link, commit SHA, and exact commands with pass/fail/skip results |
| → **Done** | **A reviewer other than the owner** (founder, integration owner or coordinator) | Every acceptance criterion met, **with evidence linked**: run URL, SHA, test output. "Agent says done" is not evidence. |

There is no separate VERIFIED column. Done **means** verified. If a claim is only partly verified, the issue
stays In Review and the remainder is recorded as UNVERIFIED.

## 5. Comments are the handoff

Post a comment whenever one of these happens:

- you start;
- you hit a blocker;
- you push or open a PR;
- tests run;
- you hand off.

Use this shape:

```text
STATE: In Progress | Blocked | In Review
DID: <one or two lines>
EVIDENCE: <SHA> · <PR URL> · <run URL> · <command → result>
NEXT / BLOCKER: <what, who>
BOUNDARIES: data/money/email/deploy/provider impact — or "none"
```

- A new session resumes from the issue thread, never from private conversation history.
- Never post secrets, tokens, backup contents or private landing data.

## 6. Coordination rules

- One owner per file at a time. Need another lane's file? Comment on that lane's issue; do not edit it.
- A defect found outside your lane becomes a **new issue** with exact evidence (path, line, SHA). Do not fix it.
- Hard stops still apply ([`../AGENTS.md`](../AGENTS.md)): no merge to `main`, no deploy, no production data or
  provider change, no live billing or email, without explicit founder authorization.
- The coordinator triages new issues weekly, closes duplicates, and keeps the board fields filled in. The
  coordinator does not do other lanes' work.

## 7. Where things live

| Path | Owner lane |
|---|---|
| `packages/contracts`, `packages/services`, `packages/db`, `supabase/`, `.github/workflows/` | Integration (Claude Agent 1), unless an issue assigns otherwise |
| `architecture/normalized-v2/` | Gemini (schema) and Claude Agent 1 (CI fixes on the CI branch) |
| `apps/web/app/v2`, `apps/web/lib/marketplace-v2` | Codex (V2 frontend publishing) |
| `apps/web/app/pricing`, `apps/web/app/terms` | Claude Product |
| `apps/web/tests/*.spec.ts`, Playwright configuration | Claude QA |
| `docs/product/ux-v2/**` (V2 UX specification and design tickets) | Claude Agent 3 — UX |
| `docs/` (except `product/` content), issue templates, coordination | Claude Agent 2 |
| `README.md`, `AGENTS.md`, `CLAUDE.md`, `.env.example`, `ops/` | **Unassigned.** Awaiting a founder ownership grant (#109, #111). Nobody edits them until then. |

**Gemini** authors SQL only when an issue asks it to, by proposing changes in that issue. **Claude Agent 1** is
the single editor of `architecture/normalized-v2/`, so two agents never edit the same SQL at once.

When a code change alters a documented behavior, update the matching document in the same PR, or open a
`lane:docs` issue.
