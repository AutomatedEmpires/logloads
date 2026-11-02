# LogLoads — CI and Verification Evidence

> **Status:** Last verified 2026-11-02. Workflows are read from `.github/workflows/` on
> `work/logloads-repair` (`4c9518e`) and `test/normalized-v2-postgres17-ci` (`ec4bb66`). Run results come from
> the GitHub Actions API.
>
> **This is the single place where test-run evidence is recorded.** Other documents link here instead of copying
> counts. This document replaces `RUNNERS.md` and `AUTOMATION_ROADMAP.md`; their text is at tag
> `archive/docs-history-20261102`.

## 1. Runners (APPROVED)

- **GitHub-hosted `ubuntu-latest` only.** No self-hosted runner exists.
- **Never install WSL, Docker Desktop or PostgreSQL on the founder's laptop** to run database tests. Database
  execution belongs in CI.
- Workflow files belong to Claude Agent 1 (integration and CI). Other agents propose changes through an issue.

## 2. Workflows on `work/logloads-repair` (IMPLEMENTED)

| Workflow | Trigger | Does |
|---|---|---|
| `ci.yml` | push `main`, PR, merge queue | Organization reusable CI (`secrets: inherit`), then `extended-validation`: Supabase CLI 2.101.0; `pnpm db:assert` (resets an isolated PostgreSQL 17 stack); guardrails; build; Playwright |
| `database-check.yml` | PR, manual | `pnpm db:check` on the pilot ledger `supabase/migrations/`. In CI it fails rather than skips. |
| `codeql.yml`, `dependency-review.yml`, `pr-review.yml` | PR, `main`, weekly | Security and review |
| `release.yml` | push `main` | Organization reusable release |
| `agent-handoff.yml`, `agent-build-task-router.yml`, `pr-agent-router.yml`, `pr-agent-dispatch.yml` | manual, issues, comments, dispatch | Agent routing. Their output is context, never approval. |

**Locally**, `pnpm db:check` and `pnpm db:assert` print a skip and exit 0 when the Supabase CLI or Docker is
missing. A local skip is **not** a pass.

## 3. Normalized V2 database CI

**Workflow:** `.github/workflows/normalized-v2-ci.yml`. It exists only on `test/normalized-v2-postgres17-ci`
and is not merged.

- **Triggers:** pushes to that branch, PRs touching `architecture/normalized-v2/**`, and manual runs.
- **Jobs:** a 3-way matrix. Each job gets a fresh `postgis/postgis:17-3.5` service container (pinned digest) and
  a fail-closed disposable-database guard (`tools/normalized-v2-ci/guard.sh`).
- **Stages, in order:**
  1. `01_schema.sql`
  2. `02_access.sql`
  3. `03_entitlements.sql`
  4. `04_tests.sql`
  5. `05_concurrency_test.sh`

### Evidence register

| Item | Status | Evidence |
|---|---|---|
| Baseline `01`–`05` at `ec4bb6623cbdfd7b78b51f9bc5fec50144cdc328` | **VERIFIED.** All five stages passed in 12 fresh-database jobs across 4 runs: `41407713008`, `41407871065` and `41407882803` (all at `174b8ec`), then `41407969571` (at `ec4bb66`), on 2026-11-02. | [Run 41407969571](https://github.com/AutomatedEmpires/logloads/actions/runs/41407969571) |
| Gemini's `06`/`07` alignment layer (branch `test/normalized-v2-contract-alignment`) | **UNVERIFIED.** As of 2026-11-02 16:15 UTC no run on this branch has passed; work is ongoing. Record its first green run here, with URL and SHA. | [Actions history for the branch](https://github.com/AutomatedEmpires/logloads/actions/workflows/normalized-v2-ci.yml?query=branch%3Atest%2Fnormalized-v2-contract-alignment) |

**What the baseline proves:**

- the DDL executes;
- grants and RLS policies behave as tested;
- claim inspection works, using simulated `request.jwt.claims`;
- the four invitation and entitlement concurrency races serialize correctly.

**What it does not prove:**

- that Supabase verifies real Clerk-signed tokens;
- that live Supabase project settings are correct;
- that the application works against this schema;
- migration correctness;
- production readiness.

## 4. Rules for reporting results

- Cite a run URL and SHA, and record it here. A green result on a different SHA does not carry over.
- Report **passed**, **failed**, **skipped** and **not run** separately. Static parsing or a count of SQL
  objects is not execution.
- Disposable-database jobs must never connect to a linked or production project. They need no repository
  secrets.
- Merging to `main` deploys production and triggers a release. Agents never merge.

## 5. Backlog

These items are tracked as GitHub issues ([`AGENT_WORKFLOW.md`](./AGENT_WORKFLOW.md)):

- Integrate the normalized-v2 CI branch.
- Verify `06`/`07`.
- Add a real Clerk token test.
- Implement a documentation-check script (spec in the docs-check issue).
- Add contract-drift tests between `membership.ts` and the seed rows.
