# MVP Backend Scope

## Included in this scaffold
- Canonical logistics domain model
- Initial service layer and state transitions
- Initial SQL schema and seed scaffolding
- First API contract routes for loads, slots, assignments, availability, and health
- CI and repo automation for lint, typecheck, test, and build

## Deferred intentionally
- Clerk auth and role-aware access control
- Live Supabase persistence wiring
- Realtime messaging transport
- Map provider integration beyond placeholders
- Payments or broker-like workflows

## Next backend milestones
1. Replace in-memory service state with repository adapters over Supabase.
2. Add auth-aware request context and RLS-aligned access checks.
3. Expand slot, rate, and notification flows with persistence.
4. Add integration tests against local Supabase once CLI/container conventions are finalized.