# MVP Backend Scope

## Included now
- Canonical logistics domain model
- Service-layer state transitions and server-enforced actor boundaries
- SQL schema, RLS coverage, migrations, and deterministic bootstrap data
- API contracts for loads, slots, assignments, availability, trips, messaging, billing state, and health
- Transitional Supabase-canonical `operating_state` with schema versioning and optimistic concurrency
- CI coverage for lint, typecheck, unit tests, production build, fresh migration ledger, and production-path browser journeys

## Deferred intentionally
- Applying the canonical-state convergence migration to the live project (requires the preview/backup/rollback cutover gates)
- Normalizing the transitional JSON document into relational repository adapters
- Realtime messaging transport
- Freight-money or broker workflows (out of product scope; Stripe remains subscriptions only)

## Next backend milestones
1. Prove an isolated exact-SHA preview, canonical-row upgrade, and rollback path.
2. Apply the additive migration and deploy only after the cutover gates pass.
3. Replace full-document compare-and-swap with relational repository adapters as scale requires.
4. Add realtime transport without weakening service-layer authorization.
