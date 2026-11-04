# LogLoads — Automation and CI Roadmap

> **Status:** Current workflow reference, updated for the 2026-11-01 timber-hauling marketplace. **Current/target distinction:** Workflow names below come from the existing automation inventory; successful operation and required branch protection must be verified against GitHub before release. See `AGENTS.md` and `docs/DECISIONS.md`.

## Current automation inventory

| Workflow | Purpose | Required verification |
|---|---|---|
| `.github/workflows/ci.yml` | CI validation, application build and applicable browser tests | Confirm actual steps and status on the proposed commit |
| `database-check.yml` | Fresh local-Supabase migration checks | Confirm pinned Supabase CLI/PostgreSQL versions, no skipped DB gate in CI |
| `dependency-review.yml` | PR dependency review | Confirm GitHub dependency-review status on the PR |
| `pr-review.yml` | PR review/validation summary | Review runner permissions, checks and SHA provenance |
| `agent-handoff.yml` | Manually requested workflow summary | Treat output as context, never as deployment approval |

The legacy local `supabase/migrations` suite validates the existing pilot infrastructure. **It does not automatically execute Gemini's isolated `architecture/normalized-v2/01_schema.sql` through `04_tests.sql`.** Add separate, disposable PostgreSQL/PostGIS integration coverage only after the schema owner and repository integration owner agree on ownership and execution. Execute actual RLS tests with least-privilege roles and multi-session quota races. Merely parsing or counting SQL objects is not adequate proof.

## Agent contribution path

1. Read current `AGENTS.md`, `docs/DECISIONS.md`, the commercial blueprint, UX specification, and relevant source contracts.
2. Check branch/HEAD, Git status, current PRs, and other agents' file ownership before editing.
3. Claude owns application integration and commits; Gemini owns `architecture/normalized-v2/` until handoff; Codex handles specifically assigned reviews/tests. Do not stage files owned by another active agent.
4. Make one coherent, reversible change per lane. Use issue and PR links where available; Notion-to-GitHub automation is a proposal, not an established requirement.
5. Run proportionate lint, typecheck, tests and build. For any database-affecting change require a disposable environment with real executed checks. Mark skipped checks accurately.
6. Require independent PR review and the branch's actual status checks before merging. **Never merge or push directly to `main` on an agent's unilateral authority**; merging `main` can deploy production.

## Deployment and money gates

Protected previews must use isolated data. No workflow may silently activate billing, send public marketing email, migrate production records, rotate credentials or purchase services. The new Basic/Pro/Regional subscriptions and boosts are *adopted commercial requirements, not live products*. Keep historical percentage/subscription collection gates disabled for new enrollment.

## Backlog — not implemented merely because listed

- Add a dedicated normalized-v2 SQL integration job, including concurrency and security negative tests.
- Add contract-drift tests comparing TypeScript plan and boost catalogs to database seed rows.
- Add safe V2 `/v2` preview tests: public redaction, hauler inquiry, landing response, closed-job refusal and mobile text-only fallback.
- Add migration parity and rollback rehearsals against synthetic copies before proposing any production cutover.
- Record precise CI workflow URLs, commit SHAs and failure artifacts in handoffs.

## Branch protection check

The previous roadmap asserted that `main` requires PRs, `validate`, up-to-date branches and force-push protection. Treat that as a **configuration expectation** until verified from GitHub repository rules; do not assume policy is enforced because this document says so.
