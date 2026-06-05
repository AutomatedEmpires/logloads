# Backend Architecture

## What is real now
- `packages/core`: canonical enums, schemas, helper functions, and state machines.
- `packages/db`: Supabase client scaffold, deterministic seed data, and SQL migration/seed files.
- `packages/services`: typed load, slot, availability, assignment, route, and notification services.
- `apps/web/app/api/*`: thin route handlers delegating to the service layer.

## What is placeholder
- Supabase runtime integration is scaffolded but not wired to a live project.
- In-memory seeded state currently backs the service layer for local API behavior.
- No auth, RLS enforcement, or external notification delivery is wired yet.

## What is intentionally not built yet
- Full product UI
- Map rendering UX
- Clerk auth flow
- Realtime messaging transport
- Route optimization

## Package boundaries
- `packages/core`: contracts and shared rules
- `packages/db`: persistence and seed/migration scaffolding
- `packages/services`: business operations and rule enforcement
- `apps/web`: transport layer only