# LogLoads — CI and Verification Evidence

> **Status:** Last verified 2026-11-03. Workflows are read from `.github/workflows/` on
> `work/logloads-repair`, which has carried `normalized-v2-ci.yml` since PR #123 merged (`1d79678`). Run results
> come from the GitHub Actions API.
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
| `database-check.yml` | PR, manual | `pnpm db:check` on the pilot ledger `supabase/migrations/`. In CI it fails rather than skips. Then rehearses an operating-state backup, wipe and restore on that disposable stack ([`RECOVERY.md`](./RECOVERY.md) §7.1). |
| `normalized-v2-ci.yml` | PR touching `architecture/normalized-v2/**`, `tools/normalized-v2-ci/**` or the workflow; manual | The normalized-v2 prototype on disposable databases (§3) |
| `codeql.yml`, `dependency-review.yml`, `pr-review.yml` | PR, `main`, weekly | Security and review |
| `release.yml` | push `main` | Organization reusable release |
| `agent-handoff.yml`, `agent-build-task-router.yml`, `pr-agent-router.yml`, `pr-agent-dispatch.yml` | manual, issues, comments, dispatch | Agent routing. Their output is context, never approval. |

**Locally**, `pnpm db:check` and `pnpm db:assert` print a skip and exit 0 when the Supabase CLI or Docker is
missing. A local skip is **not** a pass.

### Application E2E gate (`extended-validation`) — separate from database verification

`extended-validation` is the **application** gate: a production build plus Playwright against the pilot app. Its
result says nothing about the normalized-v2 SQL, which has its own workflow (§3), and the reverse is also true.
A PR can be green in one and red in the other.

| Failure | Status | Evidence |
|---|---|---|
| `posting.spec.ts:69`, mobile and desktop (#107) | **Fix ready, not merged.** The test hardcoded a recurring window of 2026-08-03 → 2026-08-28. Once that window expired, the load stopped appearing on the driver board. Failing on every PR since 2026-09-09; last green 2026-08-10 on `main` @ `40f4416`. | **PR #143** @ `a50b325`: run [41504359311](https://github.com/AutomatedEmpires/logloads/actions/runs/41504359311) green on both attempts — 119 passed, 1 flaky; then 120 passed, 0 flaky. |
| `invitations.spec.ts:113`, mobile (#149) | **Open, intermittent.** "Casey Crew" was not visible in the team list within 5 s. It passed on retry in #143's attempt 1, but **failed outright** in PR #123's run 41506524217. | #149 |

Until #143 merges into `work/logloads-repair`, **every PR's `extended-validation` fails** for reasons unrelated to
its own diff. That includes the docs PRs #100, #115 and #142, and the database PR #123. Read each PR's status
per workflow, never as one combined colour.

## 3. Normalized V2 database CI

**Workflow:** `.github/workflows/normalized-v2-ci.yml`, on `work/logloads-repair` since PR #123 merged on
2026-11-03 (squash `1d79678`). Dispatch it on any branch with `gh workflow run normalized-v2-ci.yml --ref <branch>`.

- **Triggers:** PRs touching `architecture/normalized-v2/**`, `tools/normalized-v2-ci/**` or the workflow
  itself; pushes to the two historical test branches; manual runs.
- **Jobs (8 per run):** 3 baseline and 3 alignment jobs, each on a fresh `postgis/postgis:17-3.5` service
  container (pinned digest) behind a fail-closed disposable-database guard (`tools/normalized-v2-ci/guard.sh`),
  and 2 jobs on a disposable Supabase CLI local stack (`tools/normalized-v2-ci/supabase-stack.sh`).
- **Baseline stages, in order:**
  1. `01_schema.sql`
  2. `02_access.sql`
  3. `03_entitlements.sql`
  4. `04_tests.sql`
  5. `05_concurrency_test.sh`
- **Alignment chain:** `01`, `02`, `03`, `06_v2_contract_alignment.sql`, `11_v2_phase3_policy.sql`,
  `12_v2_billing_events.sql`, `16_v2_identity_membership_hardening.sql`, then the suites `04_tests.sql`,
  `07_v2_contract_tests.sql`, `09_v2_integration_audit_tests.sql`, `13_v2_phase3_tests.sql`,
  `17_v2_identity_membership_tests.sql`, `08_v2_contract_concurrency_test.sh`, `10_v2_migration_path_test.sh` and
  `15_migration_drill.sh`.
- **Supabase local stack:** the same chain and suites as the non-superuser migration role, plus
  `14_supabase_api_tests.sh` (PostgREST and JWT, with Supabase's real roles).

  **Policy status of these stages** (`DECISIONS.md` 2026-11-02, "Recorded approvals"):
  - **Approved:** V2-DEC-01, V2-DEC-02 and V2-DEC-03.
  - **Recommendations only:** F1–F5, pending #114.
  - **Open:** F2a, F6 and F7.

  A passing stage proves only that the SQL behaves as written. It never approves the policy.

**PR #123 merged** into `work/logloads-repair` on 2026-11-03 (squash `1d79678`). Its final head
`1dfe0bcc3fd97eac5d5d7c759cccd00cba044b19` passed the Normalized V2 Database CI in run
[41566184416](https://github.com/AutomatedEmpires/logloads/actions/runs/41566184416): **8 of 8 jobs green**.
Merging the prototype and its CI does not approve the open policy items above, and nothing in
`architecture/normalized-v2/` is part of the pilot migration ledger ([`DEPLOYMENT.md`](./DEPLOYMENT.md) §3).

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
| Baseline + V2 alignment `06`–`17`, **merged head `1dfe0bcc3fd97eac5d5d7c759cccd00cba044b19`** (PR #123, squash `1d79678` on `work/logloads-repair`) | **VERIFIED in CI and merged.** Gemini authored 06/07. Claude Agent 1 integrated them and added the later stages.<br>Each run has **8 jobs**: 3 baseline (stages 1–5), 3 alignment and 2 local Supabase stacks. Run `41566184416` (PR, final head): **8 of 8 jobs green**.<br>Earlier green heads include `67b4777` (16/16 over runs `41506515086` and `41506523544`), `5d7d4de` (12/12), `fab4b0a` and `510b05a`. `24313c0` was red, on the registry pull limit only. | [Run 41566184416](https://github.com/AutomatedEmpires/logloads/actions/runs/41566184416) |

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

- Add a real Clerk token test.
- Implement a documentation-check script (spec in the docs-check issue).
- Add contract-drift tests between `membership.ts` and the seed rows.
