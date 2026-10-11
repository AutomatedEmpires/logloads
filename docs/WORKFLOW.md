# LogLoads — Working in this repo

How to take a change from branch to merge. `AGENTS.md` is the binding contract;
this is the practical checklist.

## Sequence

1. Read `AGENTS.md`, then [HANDOFF.md](./HANDOFF.md) for current state and open work.
2. Branch from `main` (`agent/<scope>-<slug>`, `feat/…`, `fix/…`, `docs/…`, `chore/…`).
3. Put each change where it belongs:
   - domain contracts, enums, Zod schemas, permissions and state machines → `packages/contracts`
   - business transitions and authorization → `packages/services`
   - persistence, seed and snapshot → `packages/db`; SQL → `supabase/`
   - UI primitives and the semantic icon registry → `packages/ui`
   - routes and cockpits → `apps/web`. Route handlers stay thin and never bypass services.
4. Add tests where the invariant lives, including a negative control: a test that
   fails if the guard is removed.
5. Record runtime, provider or architecture changes as a dated entry in
   [DECISIONS.md](./DECISIONS.md).
6. Run the gate below, then open a small PR with the exact commands and results
   (template: `.github/pull_request_template.md`).

## Validation gate

```bash
pnpm install --frozen-lockfile
pnpm validate      # lint, typecheck, unit tests, build, db:assert, guardrails, deadcode
pnpm test:e2e      # production-build journeys; needs the local Supabase stack
git diff --check
```

| Command | What it proves |
|---|---|
| `pnpm lint` | ESLint across packages, plus `actionlint` on workflows |
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `pnpm test` | Vitest in every package, plus `node --test tools/*.test.mjs` |
| `pnpm build` | Production Next.js build |
| `pnpm db:check` / `db:assert` | Fresh Supabase migration reset (Supabase CLI and Docker). May skip locally without them; CI never skips |
| `pnpm guardrails` | Repo-specific bans: secrets, retired providers, driver-payment money paths and similar (`tools/check-guardrails.mjs`) |
| `pnpm deadcode` | knip: no unused files, exports or dependencies (`knip.json`). Tag intentional unused exports with `@public` and say why |

Gotchas:
- e2e runs `next start` against the existing build, so rebuild first or you are
  testing old UI. Kill any stale server on `:3002`.
- Run a fresh `pnpm db:assert` before e2e. Some specs consume seeded state and
  fail on a second run.
- Service tests use unshifted June-2026 seed fixtures. Time-sensitive checks take
  an injectable clock.
- Under heavy CPU load, Vitest workers can time out and give false reds. Re-run
  in isolation.

## Review checklist

- Domain change centralized in `packages/contracts`; services own the transition.
- Authorization derives from the server session, never from client-supplied ids.
- Private route/access detail stays redacted until an assignment grants it.
- No secrets; new env vars added to `.env.example`, `ops/production-env-contract.json`
  and [ENV_CONTRACT.md](./ENV_CONTRACT.md).
- UI uses `packages/ui` primitives and `<Icon name="domain.action" />`; copy claims
  only what the code enforces.
- Known limitations are stated in the PR.

## CI workflows (`.github/workflows/`)

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | push to `main`, PRs, merge queue | Shared family CI, then migration reset, guardrails, production build, Playwright e2e |
| `pr-review.yml` | PRs | `pnpm validate` with the pinned Supabase CLI; writes a summary |
| `database-check.yml` | PRs, manual | `pnpm db:check` from an empty PostgreSQL 17 ledger |
| `dependency-review.yml` | PRs | Dependency risk review |
| `codeql.yml` | push/PR to `main`, Mondays 05:23 UTC | Shared CodeQL scan |
| `release.yml` | push to `main` | Shared release workflow (changesets) |
| `pr-agent-router.yml` / `pr-agent-dispatch.yml` | PR comments / repository dispatch | Route `/agent`, `/review`, `/git-agent` commands to agent webhooks |
| `agent-build-task-router.yml` | issues titled `[build]` | Apply routing labels from the build-task form |
| `agent-handoff.yml` | manual | Print repo status and validation commands |

Runners are GitHub-hosted Ubuntu: they provide Docker for the Supabase stack and
browsers. Self-hosted runners are only worth it for private-network resources or
heavy matrices; if added, document the host and keep registration tokens out of git.

## Merge rules

`main` is protected: PRs only, green checks, up-to-date branch, and resolved
review conversations (`required_conversation_resolution`). Force-push and
deletion are blocked. Merging `main` deploys production. Squash-merge; never
self-merge.
