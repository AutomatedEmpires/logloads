# Copilot Instructions

## Repo rules
- Read `AGENTS.md` before large changes.
- Never commit secrets or real environment values.
- Run `pnpm validate` before proposing merge-ready work.
- Keep business logic in `packages/services`.
- Keep shared types, enums, Zod schemas, and lifecycle rules in `packages/core`.
- Keep database clients, migrations, and seed data in `packages/db` and `supabase/`.
- Route handlers may call services, but they must not implement business rules directly.
- Update backend docs whenever schema, API, or automation changes.

## PR quality bar
- Include verification commands and results.
- Mention known limitations explicitly.
- Keep scope tight and avoid speculative UI work when backend contracts are still changing.