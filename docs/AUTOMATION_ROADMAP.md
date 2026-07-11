# Automation Roadmap

## Current workflows
- `ci.yml`: reusable family CI plus pinned Supabase migration reset, production web build, and stateful Playwright journeys.
- `database-check.yml`: installs Supabase CLI 2.101.0 and proves the migrations from an empty local PostgreSQL 17 ledger.
- `dependency-review.yml`: checks dependency risk on PRs.
- `agent-handoff.yml`: manual workflow that prints repo status and validation commands.
- `pr-review.yml`: installs the pinned Supabase CLI, validates PR branches, and writes a lightweight summary.

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
