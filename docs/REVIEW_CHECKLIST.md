# Review Checklist

## Backend rules
- Domain changes are centralized in `packages/core`.
- Services own lifecycle transitions and validation rules.
- UI and route handlers do not bypass the service layer.
- Migrations and seeds are deterministic and reviewable.

## Quality gate
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm build` passes.
- `pnpm validate` passes.
- `pnpm db:check` passes or is clearly skipped because Supabase CLI is unavailable.

## Safety
- No secrets were committed.
- New env vars were documented.
- Known limitations are documented in the PR.