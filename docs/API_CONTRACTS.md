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
- Errors: `401` unauthenticated, `403` membership/permission, `422` invalid fields, `400` business-rule rejection. Bodies are JSON `{ error }`.
- Successful mutations schedule a durable state snapshot (`persistState`).

## Current limitations
- Backed by the in-memory operating state with single-node JSON snapshot durability; Supabase runtime integration is the next infrastructure milestone.
- No pagination.
- Cockpit UIs primarily use server actions (`apps/web/lib/cockpit-actions.ts`) that call the same service layer; the HTTP routes are the external/API-consumer contract.
