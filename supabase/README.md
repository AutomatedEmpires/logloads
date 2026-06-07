# Supabase — LogLoads database

Implementation of the **locked LogLoads schema**. The single schema authority is
Notion **“LogLoads MVP Pack — Build-Ready Consolidation” (Section 5)** and
**“LogLoads Canonical Schema Draft V0”**, mirrored in GitHub Issue #5. The
canonical table names are enforced by [`AGENTS.md` §11](../AGENTS.md) — do not
introduce names outside that list.

## Layout
- `migrations/20260607000000_init_core_schema.sql` — extensions, enum state
  machines, the **20 canonical tables**, foreign keys, indexes, `updated_at`
  triggers, and RLS enabled (deny-by-default) on every table.
- `seed.sql` — a repeatable PNW (Inland NW) demo scenario for local development.

## Auth (LOCKED)
Auth is **Clerk**, not Supabase Auth. `users.clerk_user_id` is the external
identity. Supabase **RLS is keyed on the Clerk JWT** — RLS **policies** are
intentionally **not** defined yet; they land with the auth slice (Issue #4).
Until then RLS is enabled with no policies (default deny) so nothing is publicly
readable.

## Intentional deviations from “Canonical Schema Draft V0” (canon-aligned)
1. **No `auth.users` reference.** The draft predates the Clerk decision
   (reaffirmed 2026-06-04). `users` is a standalone table keyed by
   `clerk_user_id`.
2. **Exact landing lives only in `haul_private_details`.** The draft listed
   `exact_landing_*` on `haul_opportunities`; the locked rule (MVP Pack §5/§6,
   Issue #5 acceptance) gates exact landing in the private table.
3. **PostGIS from day one.** Per Issue #5, `geography(Point,4326)` columns are
   added alongside the draft's numeric lat/lng for landing/destination/home-base
   geo.

## Applying locally
```bash
supabase start
supabase db reset   # runs migrations + seed.sql
```
