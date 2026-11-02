# Claude Guidance

Read `AGENTS.md` first. This file is a short execution reminder for Claude-specific or generic LLM runs.

## Before any work
- Find your `agent-task` GitHub issue (the tracker command is in `docs/AGENT_WORKFLOW.md` §1). No issue, no work.
  Report progress and blockers on the issue, and submit work as a PR that links it. Project Board #10 is deferred.
- Work on your own branch in your own Git worktree. Check `git status` and the branch first. Never stage, reset or
  clean another agent's files.
- Product authority: `docs/README.md` §1. Never change pricing, plans or scope without a new dated decision.

## Non-negotiables
- Never commit secrets.
- Keep backend logic in `packages/services`.
- Keep domain contracts in `packages/contracts`.
- Keep migrations and seed changes in `packages/db` plus `supabase/`.
- Do not bypass the service layer from `apps/web`.
- Cockpit identity comes from the session (`apps/web/lib/session.ts`). Never reintroduce hardcoded or
  client-supplied actor IDs.
- Add or update tests whenever state machines or service rules change.
- Run `pnpm validate` before opening or updating a PR. Report a skipped database step as **skipped**.
- Put exact verification commands and results in the PR body and on the issue.
- Never merge a PR, deploy, or touch production data, billing or providers without explicit founder
  authorization.

## Preferred workflow
1. Read the smallest local surface that controls the task.
2. Make the smallest plausible edit.
3. Run the narrowest validation that can falsify the edit.
4. Expand only after the local slice passes.
