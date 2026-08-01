# API Contracts

## Implemented routes
- `GET /api/health`
- `GET /api/loads` — public, redacted network load views
- `POST /api/loads` — authenticated; requires the `publish_load` role action; `companyId` forced to the actor's organization
- `GET /api/loads/:loadId` — viewer-aware (public redaction vs actor view)
- `GET /api/network` — authenticated actor network view
- `GET /api/truck-slots?date=YYYY-MM-DD` — authenticated
- `POST /api/truck-slots` — authenticated
- `POST /api/assignments/request` — authenticated
- `POST /api/assignments/:assignmentId/approve` — authenticated
- `POST /api/assignments/:assignmentId/decline` — authenticated; source organization only; optional `reason`
- `POST /api/assignments/:assignmentId/cancel` — authenticated; assignment participants under the cancellation policy; optional `reason` (max 140 chars)
- `GET /api/availability` — authenticated; scoped to the actor's driver profile
- `POST /api/availability` — authenticated; `driverProfileId` forced to the actor's own
- `POST /api/direct-offers` — authenticated
- `POST /api/future-availability` — authenticated
- `POST /api/notices` — authenticated
- `GET /api/route-packs/:assignmentId` — authenticated; assignment-gated
- `POST /api/trips/:tripId/events` — authenticated
- `POST /api/trips/:tripId/documents` — authenticated
- `POST /api/media/signature` — authenticated; returns a short-lived,
  single-object Supabase Storage upload token for an immutable,
  organization-scoped target in the private media bucket
- `GET /api/media/asset` — authenticated; proxies the viewer-authorized private image with an upstream timeout
- `GET /api/weather?loadId=...` — rate-limited; returns cached destination weather for a visible load
- `GET|POST /api/billing/payment-method` — organization-scoped card status and
  SetupIntent creation for the preserved legacy host lane; requires
  `manage_billing` and never moves driver or carrier compensation
- `POST /api/billing/subscription-checkout` — opens Checkout only for a
  canonical agreement, its frozen plan, and an organization type eligible for
  that plan. Network agreements accept only their administrator-authorized
  subscription UUID. Public Dispatch Pro accepts only
  `{ "acceptDispatchProTerms": true }`; the server derives the organization,
  acceptor, immutable terms version, and $499 Price. The browser cannot submit
  an organization, terms version, plan, trial, or Price.
- `POST /api/billing/subscription-portal` — opens the restricted payment-method
  and invoice-history portal for the actor's own provider-bound subscription;
  self-service plan changes and cancellation are disabled
- `POST /api/billing/webhook` — raw-body, Stripe-signed legacy and
  subscription lifecycle reconciliation; provider facts never create an
  unapproved commercial agreement and freight compensation remains out of scope
- `GET /api/billing/cron` — bearer-authenticated legacy reconciliation,
  subscription-period closing, overage collection, provider schedules,
  adjustment settlement, and billing-notification delivery
- `POST /api/billing/internal-smoke` — platform-admin-only, separately gated,
  user-and-organization-allowlisted one-dollar charge/refund proof; internal
  fixtures never grant ordinary access or enter commercial metrics
- `POST /api/admin/billing/actions` — platform-admin-only configuration,
  activation authorization, scheduled changes/non-renewal, audited usage
  reversal and adjustment, and reconciliation controls
- `GET /api/admin/billing/export` — platform-admin-only canonical
  subscription, usage, base-invoice, overage-invoice, adjustment, and preserved
  legacy breakdown

## Contract rules
- Route handlers call `packages/services` only.
- Actor identity always resolves from the session (`apps/web/lib/api-actor.ts`); client payloads can select only among the actor's own organization memberships. Client-supplied actor IDs are rejected by design and banned by guardrails.
- Validation happens in shared schemas and service-layer functions.
- Errors: `401` unauthenticated, `403` membership/permission, `422` invalid fields, `409` sanitized business-rule conflict, `429` shared rate limit exceeded, and `503` production safety check unavailable. Bodies are JSON `{ error }`; rate-limit `429`/`503` responses include integer-seconds `Retry-After`. Domain-conflict bodies never include record identifiers or the service's internal refusal detail.
- Successful mutations resolve only after `mutateState` commits a conditional Supabase update. A stale version reloads and replays the deterministic service operation; it never overwrites the newer row.
- Driver economics and media writes are service-owned, verify active organization membership and driver ownership, and resolve the active equipment combination server-side.
- Supabase Storage is the only active media provider. Upload tokens authorize
  one generated object path with upsert disabled. The server reads the stored
  object back before attachment; only verified JPG/PNG/WebP images of
  10,000,000 bytes or less under the current target prefix can be committed.
- Assignment approval performs all fallible commercial-terms and trip validation before consuming the assignment or confirming the slot.
- New paid enrollment is fail-closed behind
  `LOGLOADS_SUBSCRIPTION_COLLECTION=enabled`, an exact expected Stripe account
  assertion, pre-created accepted Prices, and canonical activation
  authorization. Dispatch Pro authorization is the active organization billing
  manager's explicit terms acceptance; Network authorization remains an
  administrator control. The Network Pilot additionally requires exactly one
  active organization-owned landing and a finite provider schedule.
- One completed physical Network movement can create one deterministic usage
  event; private capacity, posting, cancellation before execution, duplicate
  completion, and preserved legacy obligations cannot enter that ledger.
- Historical usage and invoices are append-only. Corrections use audited
  reversal/adjustment records and provider credit notes or supplemental
  invoices rather than rewriting settled facts.

## Current limitations
- Backed by the transitional versioned `operating_state` document in Supabase. Normalizing service operations onto relational tables remains a later scale milestone.
- No pagination.
- Cockpit UIs primarily use server actions (`apps/web/lib/cockpit-actions.ts`) that call the same service layer; the HTTP routes are the external/API-consumer contract.
