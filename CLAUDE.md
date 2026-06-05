# Claude Guidance

Read `AGENTS.md` first. This file is a shorter execution reminder for Claude-specific or generic LLM runs.

## Non-negotiables
- Never commit secrets.
- Run `pnpm validate` before opening or updating a PR.
- Keep backend logic in `packages/services`.
- Keep domain contracts in `packages/core`.
- Keep migrations and seed changes in `packages/db` plus `supabase/`.
- Do not bypass the service layer from `apps/web`.
- Do not build broad UI before the domain and API contracts are stable.
- Add or update tests whenever state machines or service rules change.
- Include exact verification commands in the PR body.

## Preferred workflow
1. Read the smallest local surface that controls the task.
2. Make the smallest plausible edit.
3. Run the narrowest validation that can falsify the edit.
4. Expand only after the local slice passes.