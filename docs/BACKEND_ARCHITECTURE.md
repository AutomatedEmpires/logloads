# Backend Architecture

## What is real now
- `packages/contracts`: canonical enums, schemas, helper functions, matching rules, permissions, and state machines.
- `packages/db`: Supabase clients, deterministic seed data, SQL migrations, local-development snapshots, and the versioned `operating_state` repository.
- `packages/services`: typed load, slot, availability, assignment, route, notification, account-provisioning, messaging, equipment, driver-profile economics/media, billing, and admin-review services. Approval validates its rate, route, equipment, slot, assignment snapshot, and trip before mutating assignment or slot state.
- `apps/web/lib/session.ts`: session identity — Clerk when configured, HMAC-signed dev sessions otherwise; cockpit guards (`requireCockpitActor`) map memberships to `/driver`, `/fleet`, `/host`, `/admin`.
- `apps/web/lib/network.ts` (`buildNetworkView`): the per-viewer read model. Scopes trucks/trips/messages/activity to the viewer's organization and redacts sensitive operational data (route packs, gate instructions, exact coordinates) until the viewer owns the load or holds an active assignment.
- `apps/web/lib/services.ts`: the transitional persistence boundary. Request entry points await a canonical Supabase refresh. Mutations run against a fresh draft, then compare-and-swap the whole document by `version`; a conflict reloads and deterministically replays the service mutation.
- `apps/web/lib/rate-limit-*`: provider-neutral abuse controls. Production calls the service-role-only Supabase `consume_rate_limit` RPC, whose atomic upsert shares one fixed window across Vercel instances; development uses process memory.
- `apps/web/lib/cockpit-actions.ts`: server actions used by cockpit UIs; every mutation resolves the session actor, commits through `mutateState`, and revalidates only after the canonical write succeeds.
- `apps/web/app/api/*`: thin authenticated route handlers delegating to the service layer.
- `apps/web/lib/media.ts`: Supabase Storage transport only. The service layer
  authorizes an immutable organization/driver-scoped object path before the
  server issues a one-object upload token. The browser uploads directly to the
  private bucket with upsert disabled; the server then downloads and validates
  the object before persisting its reference. Authorized reads use five-minute
  signed URLs and never make the bucket public.

## Transitional constraint
- Supabase is canonical, but the service layer still operates on one typed JSON document rather than normalized SQL rows. `operating_state.version` prevents lost updates across serverless instances. This is safe for current scale, not the final high-throughput data model.
- Production fails closed when Supabase credentials or the canonical row are absent. A JSON file is available only as a non-production fallback.
- Protected production actions also fail closed when the shared rate-limit RPC is missing, unavailable, or invalid. There is no implicit process-memory fallback in production.

## What is placeholder
- External notification delivery (Resend) is not wired; notifications are in-app records.
- Stripe checkout activates only when Stripe keys are configured; until then billing surfaces show honest "activation pending" states.

## What is intentionally not built yet
- Freight brokerage, carrier operations, dispatch-for-hire, and managed freight-money movement — outside the current coordination-software scope.
- Realtime transport (polling/refresh only).
- Route optimization.

## Package boundaries
- `packages/contracts`: contracts and shared rules
- `packages/db`: canonical persistence, local snapshots, and seed/migration scaffolding
- `packages/services`: business operations and rule enforcement
- `apps/web`: transport + presentation; reaches services only through `lib/services.ts`
