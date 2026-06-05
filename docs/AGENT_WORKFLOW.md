# Agent Workflow

## Operating sequence
1. Read `AGENTS.md` and the smallest local surface controlling the task.
2. Work on a feature branch.
3. Keep domain contracts in `packages/core`.
4. Keep DB and migration work in `packages/db` and `supabase/`.
5. Keep backend rules in `packages/services`.
6. Keep `apps/web` route handlers thin.
7. Run `pnpm validate` before updating a PR.
8. Include exact verification commands in the PR description.

## Handoff expectations
- Update `docs/BACKEND_ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and `docs/API_CONTRACTS.md` when the contract changes.
- Leave clear notes on anything skipped or placeholder.
- Never rely on hidden terminal state when another agent will pick up the branch.