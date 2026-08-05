# API Contracts

## Implemented routes
- `GET /api/health`
- `GET /api/auth/session` — same-origin public session-status probe; returns
  only JSON `{ "authenticated": boolean }` and always sends
  `Cache-Control: no-store` so account state cannot be cached or disclosed
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
- `GET /api/billing/payment-method` — organization-scoped, read-only card status;
  remains readable to an actor with `manage_billing` even when card setup is
  unavailable
- `POST /api/billing/payment-method` — requires `manage_billing` and creates a
  SetupIntent only when canonical state proves either (a) the exact current
  `percentage_v1` agreement plus exact organization rollout authorization or
  (b) a preserved provider-bound, `legacy_percentage`, or unsettled billing
  obligation. Duplicate or cross-wired billing records fail closed. An
  ineligible request is refused before any Stripe customer lookup/creation or
  SetupIntent creation. Card setup never enrolls an organization, enables fee
  collection, or moves driver or carrier compensation.
- `POST /api/billing/subscription-checkout` — **historical route, disabled for
  new activity.** It remains only as frozen `subscription_v1` implementation
  evidence for accepted historical obligations. Both historical activation
  gates remain disabled, so the route must not reach Stripe or create a new
  subscription for any organization, including Dispatch Pro.
- `POST /api/billing/subscription-portal` — **historical route.** It may expose
  payment-method and invoice history for an already provider-bound obligation;
  it may not enroll, switch, renew, or extend a subscription. Self-service plan
  changes and cancellation remain disabled.
- `POST /api/billing/webhook` — raw-body, Stripe-signed current platform-fee,
  preserved legacy-fee, and historical subscription reconciliation. Provider
  facts never create an unapproved commercial agreement, and freight
  compensation remains out of scope.
- `GET /api/billing/cron` — bearer-authenticated current and legacy platform-fee
  reconciliation, historical subscription-obligation reconciliation,
  adjustment settlement, and billing-notification delivery. It must not create
  a new subscription schedule, enrollment, tier allowance, or usage obligation.
- `POST /api/billing/internal-smoke` — platform-admin-only, separately gated,
  user-and-organization-allowlisted one-dollar charge/refund proof; internal
  fixtures never grant ordinary access or enter commercial metrics
- `POST /api/admin/billing/actions` — platform-admin-only configuration,
  current fee-collection authorization, audited reversal and adjustment, and
  reconciliation controls. Subscription scheduling and enrollment controls are
  retained only for historical-obligation reconciliation and may not activate
  new work.
- `GET /api/admin/billing/export` — platform-admin-only canonical
  `percentage_v1`, preserved `legacy_percentage`, historical subscription,
  usage, invoice, adjustment, and provider-reconciliation breakdown

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
- `LOGLOADS_FEE_COLLECTION=enabled` is the sole current commercial collection
  gate. It remains fail-closed behind the exact expected Stripe account,
  accepted `percentage_v1` or frozen legacy terms, deterministic invoices,
  signed webhook reconciliation, and canonical activation authorization.
  `LOGLOADS_SUBSCRIPTION_COLLECTION` and
  `LOGLOADS_DISPATCH_SELF_SERVE` are historical safety gates that must remain
  disabled and cannot authorize new enrollment.
- One completed physical movement can create at most one deterministic
  commercial obligation: a current `percentage_v1` platform-fee event, a
  frozen `legacy_percentage` event, or a historical `subscription_v1` usage
  event. Private capacity, posting, cancellation before execution, duplicate
  completion, and any already-obligated movement cannot enter another ledger.
- Historical usage and invoices are append-only. Corrections use audited
  reversal/adjustment records and provider credit notes or supplemental
  invoices rather than rewriting settled facts.

## Current limitations
- Backed by the transitional versioned `operating_state` document in Supabase. Normalizing service operations onto relational tables remains a later scale milestone.
- No pagination.
- Cockpit UIs primarily use server actions (`apps/web/lib/cockpit-actions.ts`) that call the same service layer; the HTTP routes are the external/API-consumer contract.
