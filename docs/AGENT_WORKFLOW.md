# LogLoads — Agent Coordination

> **Status:** APPROVED process, revised 2026-11-02 (founder directive: Project Board #10 deferred).
> - **The source of truth for task state is GitHub Issues** in `AutomatedEmpires/logloads`, together with their
>   pull requests.
> - Project Board #10 is **optional and currently deferred**. No agent needs it, configures it, or troubleshoots
>   access to it. Its retained setup plan is in closed #101.
> - No Markdown file keeps task status. This one defines the process only.
> - Product requirements remain governed by the Blueprint ([`README.md`](./README.md) §1).

## 1. Where to find, report and submit work

| You need to… | Do this |
|---|---|
| See every task | Run the tracker command below. It prints one line per open `agent-task` issue — priority, issue number, status, owner — parsed from the issue headers in §2. |
| Find your assignment | Pipe the tracker through `grep "— Codex"`, using your owner name. No issue, no work: ask the coordinator (Claude Agent 2) to create one. |
| Report progress | Comment on **your issue**, using the format in §5. |
| Report a blocker | Set the issue's header to `Status: Blocked — <what> (<who can clear it>)`, and comment with the evidence. |
| Submit work for review | Open a PR that links the issue (`Refs #NNN`). Set the header to `Status: In Review — PR #NNN`, and comment with the SHA, the commands you ran, and their results. |
| Find out what is blocking everything | Run the tracker and read the `P0` lines whose status is `Blocked`. |

**Tracker command** (read-only; GitHub's text search is too fuzzy to filter on headers):

```bash
gh issue list --repo AutomatedEmpires/logloads --label agent-task --state open --limit 100 --json number,body --jq '.[] | (.body | ((capture("[*][*]Agent owner:[*][*] (?<o>[^\n]+)") // {o:"?"}) + (capture("[*][*]Priority:[*][*] (?<p>P[0-2])") // {p:"?"}) + (capture("[*][*]Status:[*][*] (?<s>[^\n]+)") // {s:"?"}))) as $h | "\($h.p) #\(.number) \($h.s | split(" — ")[0]) — \($h.o)"' | sort -k1,1 -k2,2V
```

A `?` in the output means an issue's header is malformed. Fix the header.

Before editing files:

- read the issue's **Owned files** and **Prohibited overlap**;
- run `git status`, and check the branch and HEAD;
- never stage, reset, clean, stash or rebase over another agent's files or worktree.

## 2. The issue header is the task record

Every `agent-task` issue begins with these lines. They are the **only** place its state lives:

```text
**Agent owner:** <one primary owner>   (collaborators may be named after it)
**Priority:** P0 | P1 | P2
**Status:** Backlog | Ready | In Progress | Blocked | In Review | Done   (optional "— reason")
```

The body below the header holds:

- the **Objective**;
- the **Branch / worktree**;
- the **Owned files** and the **Prohibited overlap**;
- the **Acceptance criteria and required evidence**;
- the **Dependencies** — linked issues or PRs;
- what is **Out of scope**.

The template is `.github/ISSUE_TEMPLATE/agent_task.yml`.

**Who may edit the header:** the owner, the coordinator, or the founder. When you change the Status, also post a
comment saying why. The comment thread is the history; the header is the current state.

| Field | Values |
|---|---|
| **Priority** | P0 — production risk or integration blocker · P1 — current milestone · P2 — later |
| **Agent owner** | Claude Agent 1 (database integration) · Claude Agent 2 (docs / coordination) · Claude Agent 3 — UX · Codex (V2 frontend) · Gemini (SQL author, standby) · Claude Security Auditor · Claude QA (Playwright) · Claude Product (public copy) · Claude Research (market validation) · Claude Adapter (normalized adapter) · Founder |

**Labels** describe the subject only. Status and priority are **not** labels, so there is never a second,
conflicting copy:

- every agent task carries `agent-task`;
- one or more lane labels: `lane:database` · `lane:v2-frontend` · `lane:docs` · `lane:security` · `lane:qa` ·
  `lane:product-copy` · `lane:integration` · `lane:coordination` · `lane:research`.

## 3. How status moves

| Move | Who may make it | Required |
|---|---|---|
| → Ready | Coordinator or founder | Issue fields complete; dependencies known |
| → In Progress | Owner | A first comment naming the branch and worktree |
| → Blocked | Owner | A comment stating the blocker and who can clear it |
| → In Review | Owner | A PR link, commit SHA, and exact commands with pass/fail/skip results |
| → **Done** | **A reviewer other than the owner** (founder, integration owner or coordinator) | Every acceptance criterion met, **with evidence linked**: run URL, SHA, test output. Close the issue as *completed*. "Agent says done" is not evidence. |

There is no separate VERIFIED status. Done **means** verified. If a claim is only partly verified, the issue stays
In Review and the remainder is recorded as UNVERIFIED.

Work that is abandoned or superseded is closed as **Not planned**, with a comment explaining why.

## 4. Pull requests

- Every PR links its issue, lists the commands it ran with their results, and states its boundaries.
- Required checks must be green, or the founder must accept a known failure **explicitly**. Never disable or
  weaken a test to get a merge through.
- **An agent merges only its own task PR, only into `work/logloads-repair`, and only with AE-Control's
  `ae.py merge`**, after the required checks and the AE-Control review gate pass
  ([founder decision, 2026-11-08](https://github.com/AutomatedEmpires/AE-Control/issues/6#issuecomment-6723859431)).
  Any other merge, including any merge to `main`, needs explicit founder authorization. Stacked PRs are merged in
  order, using **merge commits**.

## 5. Comments are the handoff

Post a comment whenever one of these happens:

- you start;
- you hit a blocker;
- you push or open a PR;
- tests run;
- you hand off.

Skip empty "still working" comments. Use this shape:

```text
STATE: In Progress | Blocked | In Review
DID: <one or two lines>
EVIDENCE: <SHA> · <PR URL> · <run URL> · <command → result>
NEXT / BLOCKER: <what, who>
BOUNDARIES: data/money/email/deploy/provider impact — or "none"
```

- A new session resumes from the issue thread, never from private conversation history.
- Never post secrets, tokens, backup contents or private landing data.
- Decisions belong in [`DECISIONS.md`](./DECISIONS.md), not only in an issue thread.

## 6. Coordination rules

- One owner per file at a time. If you need another lane's file, comment on that lane's issue; do not edit it.
- A defect you find outside your lane becomes a **new issue** with exact evidence (path, line, SHA). Do not fix it.
- Hard stops still apply ([`../AGENTS.md`](../AGENTS.md)). Explicit founder authorization is required for:
  - any merge to `main`;
  - any deploy;
  - any production data or provider change;
  - any live billing or email.
- The coordinator triages new issues, closes duplicates, and keeps every issue header accurate. The coordinator
  does not do other lanes' work.

## 7. Where things live

| Path | Owner lane |
|---|---|
| `packages/contracts`, `packages/services`, `packages/db`, `supabase/`, `.github/workflows/` | Integration (Claude Agent 1), unless an issue assigns otherwise |
| `architecture/normalized-v2/` | Claude Agent 1, the single editor. Gemini proposes changes in issues. |
| `apps/web/app/v2`, `apps/web/lib/marketplace-v2` | Codex (V2 frontend) |
| `apps/web/app/pricing`, `apps/web/app/terms` | Claude Product |
| `apps/web/tests/*.spec.ts`, Playwright configuration | Claude QA |
| `docs/product/ux-v2/**` (V2 UX specification and design tickets) | Claude Agent 3 — UX |
| `docs/` (except `product/` content), `README.md`, `AGENTS.md`, `CLAUDE.md`, issue templates, the documentation side of `.env.example` | Claude Agent 2 (founder grant, 2026-11-02) |
| `ops/production-env-contract.json`, and any runtime-affecting environment change | The implementation owner. Claude Agent 2 proposes. |

When a code change alters a documented behavior, update the matching document in the same PR, or open a
`lane:docs` issue.
