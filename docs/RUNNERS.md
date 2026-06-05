# Runners

## Current decision
- Use GitHub-hosted Ubuntu runners for now.

## Why
- The repo build and test footprint is still small.
- No private network access is needed for the current backend scaffold.
- The local Supabase path is not yet mandatory in CI.

## When self-hosted runners become useful
- Long-running builds or large test matrices.
- Private network or VPN-only resources.
- Full local Supabase integration in CI.
- Heavy browser/mobile matrix testing.

## If self-hosted is requested later
- Document the runner host.
- Scope the runner to this repo or org intentionally.
- Store registration tokens outside git.
- Keep a manual recovery/remove procedure with the host owner.