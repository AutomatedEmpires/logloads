# Automation Roadmap

## Current workflows
- `ci.yml`: lint, typecheck, test, build.
- `database-check.yml`: runs `pnpm db:check` and skips cleanly without Supabase CLI.
- `dependency-review.yml`: checks dependency risk on PRs.
- `agent-handoff.yml`: manual workflow that prints repo status and validation commands.
- `pr-review.yml`: validates PR branches and writes a lightweight summary.

## Future agent review flow
- Notion tasks should become GitHub issues.
- GitHub issues should become small feature branches.
- Branches should open PRs with exact verification output.
- CI and dependency review should pass before merge.

## Merge protection
- `main` requires pull requests.
- `validate` must pass.
- Branches must be up to date.
- Force pushes and deletions are blocked.