# API Contracts

## Implemented routes
- `GET /api/health`
- `GET /api/loads`
- `POST /api/loads`
- `GET /api/loads/:loadId`
- `GET /api/truck-slots?date=YYYY-MM-DD`
- `POST /api/truck-slots`
- `POST /api/assignments/request`
- `GET /api/availability?driverProfileId=:id`
- `POST /api/availability`

## Contract rules
- Route handlers call `packages/services` only.
- Validation happens in shared schemas and service-layer functions.
- Error responses are JSON objects with an `error` message.

## Current limitations
- Backed by deterministic in-memory state, not a live database.
- No auth or role enforcement on routes yet.
- No pagination or filtering beyond the first MVP queries.