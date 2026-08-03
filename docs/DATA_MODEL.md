# Data Model

## Canonical entities scaffolded
- `User`
- `DriverProfile`
- `TruckProfile`
- `TrailerProfile`
- `LoggingCompany`
- `DispatcherProfile`
- `LoaderProfile`
- `Landing`
- `Mill`
- `HaulRoute`
- `LoadPosting`
- `TruckSlot`
- `AvailabilityWindow`
- `Assignment`
- `Rate`
- `Notification`
- `MessageThread`
- `MessageEvent`
- `AuditEvent`
- `Organization` / `OrganizationMembership` / `OrganizationInvitation`
- `PrivateNetworkRelationship`
- `EquipmentCombination`
- `RichLandingDetails` / `DestinationFacility`
- `RoutePack`
- `OpportunityCapacity` / `DirectOffer` / `FutureAvailability`
- `TripV2` / `TripEvent` / `TripDocument`
- `TripReview`
- `VerificationRecord`
- `Entitlement` (rendered to users only as plan features)

## Coverage
- Pickup landing and drop-off mill ids
- Lat/lng coordinates
- Route distance and runtime
- Daily truck counts and slot windows
- Rate type and pay data
- Equipment and road requirements
- Driver/truck availability
- Verification state
- Dispatcher and loader contact data
- Assignment cancellation metadata
- One-off, recurring, and campaign scheduling
- Driver home coordinates, operating radius, and preferred fuel price assumptions
- Truck fuel economy plus private media references for driver, truck, and trailer photos
- Driver credential evidence bound to the exact `truckProfileId` or
  `trailerProfileId` photographed. Historical unbound equipment evidence remains
  readable but never clears an assignment gate.
- Immutable assignment commercial-terms snapshots captured at host approval
- Stripe event identifiers on billing audit metadata for replay-safe current
  platform-fee collection, frozen legacy-fee obligations, and historical
  subscription reconciliation

## Current storage shape
- SQL migrations in `supabase/migrations/`
- Deterministic TS seed snapshot in `packages/db/src/seed-data.ts`
- SQL seed scaffold in `supabase/seed/`
- Transitional canonical row: `public.operating_state(id='primary', state, schema_version, version)`
- Whole-document mutations use `version` compare-and-swap with retry; normalized relational persistence remains the later scale target.
- Operational abuse-control state: `public.rate_limit_windows(bucket, key_hash, request_count, reset_at)`. It stores only HMAC-SHA-256 pseudonyms, is service-role only, and is updated through the atomic `consume_rate_limit` RPC. A bounded, lock-safe cleanup removes expired rows as later requests arrive.
