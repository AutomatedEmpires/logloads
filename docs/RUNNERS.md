# Runners and CI execution

> **Status:** Revised 2026-11-01. Section 2 is CURRENT: read from `.github/workflows/` at commit `15892b7`.
> Section 3 is TARGET: no workflow for it exists yet. This review did not inspect workflow run results. Check
> the GitHub Actions tab for the actual status of any commit.

## 1. Decision: GitHub-hosted runners only

- Use GitHub-hosted `ubuntu-latest` runners. They already provide Docker for the isolated Supabase stack, and
  they can run PostgreSQL/PostGIS service containers for the normalized-v2 tests.
- **Do not install WSL, Docker Desktop, or PostgreSQL on the founder's Windows laptop** to run database
  tests ([`AGENTS.md`](../AGENTS.md) §0, §3.2). Database execution belongs in CI or in a separately approved
  disposable cloud environment.
- No self-hosted runner exists or is planned. If one is ever requested: document the host, scope it to this
  repository, keep registration tokens out of Git, and agree on a removal procedure with the host owner.

## 2. Existing CI infrastructure — CURRENT

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` → job `ci` | push to `main`, pull requests, merge queue | Calls the organization reusable workflow `AutomatedEmpires/.github/.github/workflows/reusable-ci.yml@main` with `secrets: inherit`. Its steps are defined outside this repository. |
| `ci.yml` → job `extended-validation` | after `ci` | pnpm 10.12.4 and Node from `.nvmrc`; Supabase CLI 2.101.0; `pnpm db:assert` (`supabase db reset --local` on an isolated PostgreSQL 17 stack); `pnpm guardrails`; production build; Playwright Chromium; `pnpm test:e2e` |
| `database-check.yml` → `migrations` | pull requests, manual | Supabase CLI 2.101.0 and `pnpm db:check`. In CI, the script **fails** rather than skips when the CLI or Docker is missing (`tools/db-check.sh`). |
| `codeql.yml` | push/PR to `main`, weekly | Organization reusable CodeQL workflow |
| `dependency-review.yml` | pull requests | Dependency review |
| `pr-review.yml` | pull requests | PR review summary |
| `release.yml` | push to `main` | Organization reusable release workflow, pinned to a SHA |
| `agent-handoff.yml` | manual | Handoff summary. Context only, never deployment approval. |
| `agent-build-task-router.yml`, `pr-agent-router.yml`, `pr-agent-dispatch.yml` | issues, issue comments, repository dispatch | Agent routing and webhook dispatch |

What CI covers today:

- **Covered:** `supabase/migrations/*.sql` (the pilot ledger) applied from empty on PostgreSQL 17, plus the
  Playwright smoke against the local canonical API.
- **Not covered:** `architecture/normalized-v2/*.sql`. Those files are not in the repository's committed tree
  at this revision, and no workflow references them.
- **Credentials:** no workflow in this repository references a Supabase secret. The reusable `ci` job inherits
  repository secrets; which secrets exist is not visible from the repository.

**Local runs:** `pnpm db:check` and `pnpm db:assert` print a skip message and **exit 0** when the Supabase CLI
or Docker is missing. A local skip is not a passing database check. Report it as *skipped*
([`REVIEW_CHECKLIST.md`](./REVIEW_CHECKLIST.md)). `pnpm db:check` resets the local Supabase database. Never
point it at a populated stack.

## 3. Intended normalized-v2 PostgreSQL/PostGIS job — TARGET

The schema owner's `architecture/normalized-v2/ARCHITECTURE.md` §8 specifies how the prototype should run. A
workflow implementing it is the **integration owner's** task (Claude Session 1). The schema files stay
Gemini's. Agreed shape:

- **Runner:** `ubuntu-latest`, with a `postgis/postgis:17-3.5` (or `17-3.4`) service container on
  `127.0.0.1:5432` and `postgresql-client` installed. Alternatively, native `postgresql-17` and
  `postgresql-17-postgis-3` packages. `btree_gist` is required.
- **No Supabase stack required:** the scripts create the `anon`, `authenticated`, and `service_role` roles
  themselves.
- **Disposable target only:** `LOGLOADS_DISPOSABLE_DB_URL=postgresql://postgres:postgres@127.0.0.1:5432/logloads_test`.
  The concurrency scripts refuse any host other than `127.0.0.1` or `localhost`. No repository secret is
  needed, and none may be added for this job.
- **Steps, each with `psql -X -v ON_ERROR_STOP=1`:**
  1. Apply `01_schema.sql`, `02_access.sql`, and `03_entitlements.sql` from an empty database.
  2. Run `04_tests.sql`: integration, RLS, seat separation, downgrade, spatial, entitlements.
  3. Run `bash architecture/normalized-v2/05_concurrency_test.sh`: four two-session races — final invitation
     credit, double failure callback, reaper versus late callback, duplicate cycle webhook.
- **Artifacts:** keep the full `psql` output as a short-retention artifact. It contains only synthetic data.

### Rules for reporting results

- **Do not claim the normalized-v2 tests pass** until a real workflow run on a committed SHA has completed
  green. Cite the run URL and SHA.
- A green SQL suite proves DDL execution, RLS policies, and claim inspection with **simulated** JWT claims
  (`set_config('request.jwt.claims', …)`). It does **not** prove Clerk token signature verification at the
  Supabase gateway ([`SECURITY.md`](./SECURITY.md) §4). That needs a separate test against a configured
  Supabase project with a development Clerk instance.
- Static parsing, object counts, or a local "skipped" run are not execution evidence.
- The job must never connect to a linked or production Supabase project.

## 4. Before adding or changing a workflow

- `.github/workflows/` belongs to the integration owner. Documentation agents do not edit it.
- Pin third-party actions where the existing workflows do. Keep permissions minimal.
- `pnpm lint` runs `actionlint` on workflow files.
- Merging to `main` can trigger a production deployment and a release. A workflow change still needs normal
  review and founder approval to merge.
