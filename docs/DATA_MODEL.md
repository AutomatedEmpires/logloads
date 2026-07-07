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

## Current storage shape
- SQL migrations in `supabase/migrations/`
- Deterministic TS seed snapshot in `packages/db/src/seed-data.ts`
- SQL seed scaffold in `supabase/seed/`