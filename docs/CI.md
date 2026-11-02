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

**Known failing gate (#107).** `extended-validation` has failed on every PR since 2026-09-09.

- The last green run was 2026-08-10 on `main` @ `40f4416`.
- Each failure is 2 failed / 118 passed / 22 skipped: `tests/posting.spec.ts:69`, on both mobile and desktop.
- **Cause, identified by code trace:** the test hardcodes a recurring window of 2026-08-03 → 2026-08-28. Once
  that window passed, the load's discovery reason became `expired`, and the driver board shows only `available`
  loads.
- The fix belongs to QA. Until it lands, no PR has a fully green required-check set.

## 3. Normalized V2 database CI

**Workflow:** `.github/workflows/normalized-v2-ci.yml`. It exists only on `test/normalized-v2-postgres17-ci`
and is not merged.

- **Triggers:** pushes to that branch, PRs touching `architecture/normalized-v2/**`, and manual runs.
- **Jobs:** a 3-way matrix. Each job gets a fresh `postgis/postgis:17-3.5` service container (pinned digest) and
  a fail-closed disposable-database guard (`tools/normalized-v2-ci/guard.sh`).
- **Baseline stages, in order:**
  1. `01_schema.sql`
  2. `02_access.sql`
  3. `03_entitlements.sql`
  4. `04_tests.sql`
  5. `05_concurrency_test.sh`
- **Alignment track** (on PR #123): `06_v2_contract_alignment.sql`, `07_v2_contract_tests.sql`,
  `08_v2_contract_concurrency_test.sh`, `09_v2_integration_audit_tests.sql`, `10_v2_migration_path_test.sh`, and
  from `67b4777` onwards `11_v2_founder_decisions.sql` and `12_v2_billing_events.sql`.

  The comments in stages 11–12 label rules F1–F5 and "V2-DEC-01/02" as founder decisions. **None of these is
  recorded in `DECISIONS.md` yet** (#114). A passing stage proves only that the SQL behaves as written. It does not
  approve the policy.

### Evidence register

Normalized V2 readiness has **five separate levels**. A level is complete only when it has its own evidence. A
lower level never implies a higher one.

| Level | Status | Evidence |
|---|---|---|
| **1. PostgreSQL 17 verification** (disposable CI databases, simulated JWT claims) | **VERIFIED** — see the run table below | Actions runs |
| **2. Supabase-specific verification** (real Clerk tokens through Supabase third-party auth; project settings, grants and Data API exposure on a real Supabase project) | **PARTIAL.** A **local** Supabase stack — database, auth, PostgREST and the API gateway, started by the pinned Supabase CLI — passed on 2 fresh stacks at `67b4777` (PR #123; runs `41506515086` push and `41506523544` PR). Its first attempt at `24313c0` had failed on a Docker registry pull limit.<br>Still **UNVERIFIED**: a **hosted** Supabase project's settings, and **real Clerk-signed tokens** through third-party auth. Those need the founder's development provider setup. | #112, #104 |
| **3. Application integration** (normalized `MarketplaceV2Port` adapter; persistent publish → discover → interest → respond loop) | **UNVERIFIED** — adapter not built | #139, #140 |
| **4. Staging readiness** (isolated hosted preview, migration rehearsal on synthetic data, backup and restore, rollback) | **UNVERIFIED** | `DEPLOYMENT.md` §4–§5, #113 |
| **5. Production authorization** (migration, activation, billing) | **NOT AUTHORIZED** | `DECISIONS.md`; founder only |

**Level 1 runs:**

| Item | Status | Evidence |
|---|---|---|
| Baseline `01`–`05` at `ec4bb6623cbdfd7b78b51f9bc5fec50144cdc328` | **VERIFIED.** All five stages passed in 12 fresh-database jobs across 4 runs: `41407713008`, `41407871065` and `41407882803` (all at `174b8ec`), then `41407969571` (at `ec4bb66`), on 2026-11-02. | [Run 41407969571](https://github.com/AutomatedEmpires/logloads/actions/runs/41407969571) |
| Baseline + V2 contract alignment `06`–`12`, **latest verified head `67b47775207f3bbee200002b4e5b9bb7e880b27f`** (draft PR #123 → `test/normalized-v2-postgres17-ci`) | **VERIFIED in CI; not yet reviewed or merged.** Gemini authored 06/07. Claude Agent 1 integrated them and added stages 08–12.<br>At `67b4777` each run has **8 jobs**: 3 baseline (stages 1–5), 3 alignment (including stages 6, 11 and 12) and 2 local Supabase stacks. Runs `41506515086` (push) and `41506523544` (PR): **16 of 16 jobs green**.<br>Earlier green heads: `5d7d4de` (12/12), `fab4b0a` and `510b05a`. `24313c0` was red, on the registry pull limit only. | [Run 41506523544](https://github.com/AutomatedEmpires/logloads/actions/runs/41506523544) |

**What the baseline proves:**

- the DDL executes;
- grants and RLS policies behave as tested;
- claim inspection works, using simulated `request.jwt.claims`;
- the four invitation and entitlement concurrency races serialize correctly.

**What it does not prove:**

- that Supabase verifies real Clerk-signed tokens;
- that live Supabase project settings are correct;
- that the application works against this schema;
- migration correctness on real data. Stage 10 tests a synthetic migration path only;
- production readiness.

These limits apply equally to the alignment stages.

## 4. Rules for reporting results

- Cite a run URL and SHA, and record it here. A green result on a different SHA does not carry over.
- Report **passed**, **failed**, **skipped** and **not run** separately. Static parsing or a count of SQL
  objects is not execution.
- Disposable-database jobs must never connect to a linked or production project. They need no repository
  secrets.
- Merging to `main` deploys production and triggers a release. Agents never merge.

## 5. Backlog

These items are tracked as GitHub issues ([`AGENT_WORKFLOW.md`](./AGENT_WORKFLOW.md)):

- Review and merge draft PR #123, then integrate the CI branch into `work/logloads-repair`.
- Add a real Clerk token test.
- Implement a documentation-check script (spec in the docs-check issue).
- Add contract-drift tests between `membership.ts` and the seed rows.
