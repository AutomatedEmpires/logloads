# Backend Architecture

## What is real now
- `packages/contracts`: canonical enums, schemas, helper functions, matching rules, permissions, and state machines.
- `packages/db`: Supabase client scaffold, deterministic seed data, SQL migration/seed files, and a JSON snapshot layer (`snapshot.ts`) providing single-node durability for the in-memory operating state.
- `packages/services`: typed load, slot, availability, assignment, route, notification, account-provisioning, messaging, equipment, and admin-review services.
- `apps/web/lib/session.ts`: session identity — Clerk when configured, HMAC-signed dev sessions otherwise; cockpit guards (`requireCockpitActor`) map memberships to `/driver`, `/fleet`, `/host`, `/admin`.
- `apps/web/lib/network.ts` (`buildNetworkView`): the per-viewer read model. Scopes trucks/trips/messages/activity to the viewer's organization and redacts sensitive operational data (route packs, gate instructions, exact coordinates) until the viewer owns the load or holds an active assignment.
- `apps/web/lib/cockpit-actions.ts`: server actions used by cockpit UIs; every mutation resolves the session actor, calls the service layer, persists a snapshot, and revalidates.
- `apps/web/app/api/*`: thin authenticated route handlers delegating to the service layer.

## What is placeholder
- Supabase runtime integration is scaffolded but not wired to a live project; durability is the JSON snapshot (`.data/logloads-state.json`).
- External notification delivery (Resend) is not wired; notifications are in-app records.
- Stripe checkout activates only when Stripe keys are configured; until then billing surfaces show honest "activation pending" states.

## What is intentionally not built yet
- Managed transaction mode (freight money movement) — disabled by decision.
- Realtime transport (polling/refresh only).
- Route optimization.

## Package boundaries
- `packages/contracts`: contracts and shared rules
- `packages/db`: persistence, snapshots, and seed/migration scaffolding
- `packages/services`: business operations and rule enforcement
- `apps/web`: transport + presentation; reaches services only through `lib/services.ts`
