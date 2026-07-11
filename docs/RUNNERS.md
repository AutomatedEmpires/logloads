# Runners

## Current decision
- Use GitHub-hosted Ubuntu runners for now.

## Why
- The repo build and test footprint is still small.
- No private network access is needed for the current backend scaffold.
- GitHub-hosted Ubuntu runners provide Docker for the mandatory isolated Supabase migration and browser path.
- CI installs the pinned Supabase CLI, resets the PostgreSQL 17 ledger, builds the production app, and runs Playwright against the local canonical API.

## When self-hosted runners become useful
- Long-running builds or large test matrices.
- Private network or VPN-only resources.
- Private provider-network integration that cannot run against isolated local services.
- Heavy browser/mobile matrix testing.

## If self-hosted is requested later
- Document the runner host.
- Scope the runner to this repo or org intentionally.
- Store registration tokens outside git.
- Keep a manual recovery/remove procedure with the host owner.
