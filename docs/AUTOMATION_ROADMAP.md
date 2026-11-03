# LogLoads — Automation and CI Roadmap

> **Status:** Revised 2026-11-01.
> - The current workflow inventory, with triggers and steps, lives in [`RUNNERS.md`](./RUNNERS.md) §2. It was
>   read from `.github/workflows/` at `15892b7`.
> - This document covers how agents contribute through CI, the money and deployment gates, and the backlog.
>
> Workflow run results and branch-protection settings were **not** inspected. Verify them on GitHub.

## 1. Current automation (summary)

- **`ci.yml`:**
  - the organization reusable CI;
  - `extended-validation` — pinned Supabase CLI, `pnpm db:assert` on PostgreSQL 17, guardrails, production
    build, Playwright.
- **`database-check.yml`:** the pilot migration ledger from empty. Fails, never skips, in CI.
- **Review and security:** `codeql.yml`, `dependency-review.yml`, `pr-review.yml`.
- **Release:** `release.yml`, on push to `main`.
- **Agent workflows:** `agent-handoff.yml` (manual) and three agent-routing workflows.

The pilot ledger in `supabase/migrations/` is tested. **Gemini's `architecture/normalized-v2/` SQL is not
executed by any workflow.** The intended job is specified in [`RUNNERS.md`](./RUNNERS.md) §3. Parsing or
counting SQL objects is not adequate proof.

## 2. Agent contribution path

1. Read [`AGENTS.md`](../AGENTS.md), [`DECISIONS.md`](./DECISIONS.md), the Blueprint, the UX spec, and the
   relevant contracts.
2. Check the branch, HEAD, Git status, open PRs, and other agents' ownership
   ([`AGENT_WORKFLOW.md`](./AGENT_WORKFLOW.md)).
3. Make one coherent, reversible change per lane. Link issues and PRs where they exist. Notion-to-GitHub
   automation is a proposal, not an established requirement.
4. Run proportionate lint, typecheck, tests, and build. Database-affecting changes need executed checks on a
   disposable environment. Mark skips accurately.
5. Get independent PR review, plus the branch's actual status checks. **Never merge or push to `main` on an
   agent's own authority** — merging `main` can deploy production and trigger a release.

## 3. Deployment and money gates

- Previews use isolated data.
- No workflow may silently activate billing, send public email, migrate production records, rotate
  credentials, or buy services.
- Basic/Pro/Regional and boosts are adopted requirements, **not live products**.
- The historical percentage and subscription gates stay disabled ([`ENV_CONTRACT.md`](./ENV_CONTRACT.md) §5).

## 4. Backlog — not implemented merely because listed

- A normalized-v2 SQL job on `postgis/postgis:17-3.5`: DDL, `04_tests.sql`, and `05_concurrency_test.sh`
  ([`RUNNERS.md`](./RUNNERS.md) §3).
- Contract-drift tests comparing the `membership.ts` plan, boost, and promotion values to the prototype's
  seed rows.
- `/v2` tests:
  - public redaction;
  - hauler interest;
  - landing response;
  - closed-job refusal;
  - mobile text-only fallback.
- A deliberate guardrail update so the new $499/month Regional copy can ship, while the retired Dispatch Pro
  copy stays banned.
- Migration parity and rollback rehearsals on synthetic copies before any cutover proposal.
- A decision on whether to schedule `operating_state` backups ([`RECOVERY.md`](./RECOVERY.md) §8).
- Record CI run URLs, SHAs, and failure artifacts in handoffs.

## 5. Branch protection

An earlier revision of this document asserted that `main` requires PRs, a passing `validate`, up-to-date
branches, and force-push protection. Treat that as an **expectation** until it is verified in GitHub's
repository rules. A document saying so does not make the policy enforced.
