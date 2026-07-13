# API Contracts

## Implemented routes
- `GET /api/health`
- `GET /api/loads` — public, redacted network load views
- `POST /api/loads` — authenticated; `companyId` forced to the actor's organization
- `GET /api/loads/:loadId` — viewer-aware (public redaction vs actor view)
- `GET /api/network` — authenticated actor network view
- `GET /api/truck-slots?date=YYYY-MM-DD` — authenticated
- `POST /api/truck-slots` — authenticated
- `POST /api/assignments/request` — authenticated
- `POST /api/assignments/:assignmentId/approve` — authenticated
- `GET /api/availability` — authenticated; scoped to the actor's driver profile
- `POST /api/availability` — authenticated; `driverProfileId` forced to the actor's own
- `POST /api/direct-offers` — authenticated
- `POST /api/future-availability` — authenticated
- `POST /api/notices` — authenticated
- `GET /api/route-packs/:assignmentId` — authenticated; assignment-gated
- `POST /api/trips/:tripId/events` — authenticated
- `POST /api/trips/:tripId/documents` — authenticated

## Contract rules
- Route handlers call `packages/services` only.
- Actor identity always resolves from the session (`apps/web/lib/api-actor.ts`); client payloads can select only among the actor's own organization memberships. Client-supplied actor IDs are rejected by design and banned by guardrails.
- Validation happens in shared schemas and service-layer functions.
- Errors: `401` unauthenticated, `403` membership/permission, `422` invalid fields, `400` business-rule rejection, `429` shared rate limit exceeded, and `503` production safety check unavailable. Bodies are JSON `{ error }`; rate-limit `429`/`503` responses include integer-seconds `Retry-After`.
- Successful mutations resolve only after `mutateState` commits a conditional Supabase update. A stale version reloads and replays the deterministic service operation; it never overwrites the newer row.

## Current limitations
- Backed by the transitional versioned `operating_state` document in Supabase. Normalizing service operations onto relational tables remains a later scale milestone.
- No pagination.
- Cockpit UIs primarily use server actions (`apps/web/lib/cockpit-actions.ts`) that call the same service layer; the HTTP routes are the external/API-consumer contract.
