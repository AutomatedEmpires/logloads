# Review Checklist

## Backend rules
- Domain changes are centralized in `packages/contracts`.
- Services own lifecycle transitions and validation rules.
- UI and route handlers do not bypass the service layer.
- Migrations and seeds are deterministic and reviewable.

## Quality gate
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm build` passes.
- `pnpm validate` passes.
- `pnpm db:check` passes locally when Supabase CLI/Docker are available; CI must never skip it.

## Safety
- No secrets were committed.
- New env vars were documented.
- Known limitations are documented in the PR.
