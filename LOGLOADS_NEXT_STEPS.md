# LogLoads Next Steps

## Foundation Progress
- Completed on scaffold branch `chore/scaffold-foundation-20260604`:
  - Added a committed ESLint config for `apps/web`
  - Replaced interactive `next lint` with an explicit `eslint` CLI command
  - Generated and committed `pnpm-lock.yaml`
  - Added `.github/workflows/ci.yml` for lint, typecheck, and build validation
- Merge readiness: scaffold is merge-ready once the updated branch passes PR review and required repository protections are enabled; branch protection on `main` is still missing at the GitHub repo level.

## 1. Top 10 Exact Fixes
1. Review PR #1 (`chore/scaffold-foundation-20260604`) and merge it only after lint is made non-interactive.
2. Commit a real ESLint config so `pnpm lint` runs unattended in local dev and CI.
3. Commit `pnpm-lock.yaml` with the scaffold to eliminate dependency drift.
4. Add `.github/workflows/ci.yml` for install, lint, typecheck, and build.
5. Enable branch protection on `main` requiring green CI before merge.
6. Add a real `apps/web/app/globals.css` and first-pass design tokens.
7. Create canonical domain types for `LoadPosting`, `HaulRoute`, `TruckSlot`, `AvailabilityWindow`, and `Assignment`.
8. Add env validation and narrow `.env.example` to what is actually used in the first slice.
9. Create the first mobile-first app shell with navigation, auth guard strategy, and route groups.
10. Add the first database schema/migration plan for companies, users, trucks, loads, slots, and assignments.

## 2. Suggested GitHub Issues
1. `Foundation: merge scaffold branch and commit lockfile`
   Description: Finalize PR #1, add `pnpm-lock.yaml`, and ensure `main` becomes installable.
2. `CI: add non-interactive lint/typecheck/build workflow`
   Description: Add `.github/workflows/ci.yml`, run Node from `.nvmrc`, install with pnpm, and gate PRs on green checks.
3. `Platform: define canonical logistics domain model`
   Description: Create shared TypeScript types and docs for loads, routes, truck slots, availability, assignments, and companies.
4. `Product: build mobile-first operational shell`
   Description: Add global styles, navigation, route groups, metadata, and responsive layout scaffolding.
5. `Backend: establish Supabase schema and Clerk identity mapping`
   Description: Define auth boundary, RLS strategy, tables, and migration plan for the first operational MVP.

## 3. Suggested First Branch
- After PR #1 merges: `feat/foundation/logistics-domain-and-app-shell`

## 4. Suggested First Pull Request
- Title: `feat: add canonical logistics domain model and mobile app shell`
- Scope:
  - shared domain types for loads, routes, truck slots, availability, assignments, users, companies, trucks
  - `apps/web` globals, typography, spacing tokens, shell, nav, metadata
  - non-interactive ESLint setup
  - env parsing/validation

## 5. Suggested CI Workflow

```yaml
name: CI

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm build
```

## 6. Suggested Design Token Cleanup
- Add a single source of truth for color, spacing, radii, shadows, typography, breakpoints, motion, and z-index.
- Introduce CSS variables in `apps/web/app/globals.css` first, then wrap them with component variants.
- Establish button, badge, card, input, and nav variants before building dashboards.
- Define a visual system optimized for mobile outdoor/logistics use: high contrast, large tap targets, fast status scanning.

## 7. Suggested Data Model Cleanup
- Do not let page components invent ad hoc shapes.
- Put canonical types in a shared package from day one.
- Separate `LoadPosting`, `TruckSlot`, and `Assignment`; they are related but not the same thing.
- Make `HaulRoute` its own object so distance, duration, and route notes are not duplicated everywhere.
- Model `AvailabilityWindow` separately from user profile so temporary availability changes are first-class.
- Keep company verification and role membership explicit rather than implied.

## 8. Suggested Component Consolidation Plan
- Start with primitives: `Button`, `Input`, `Textarea`, `Select`, `Badge`, `Card`, `Sheet`, `Dialog`, `Tabs`, `Toast`.
- Add operational building blocks next: `LoadCard`, `TruckSlotCard`, `AvailabilityBadge`, `AssignmentStatusBadge`, `CompanySummaryCard`, `RoutePreviewCard`.
- Add mobile navigation and dashboard shells before feature-specific pages.
- Require loading, empty, and error states for every new feature surface.

## 9. Suggested MVP Scope
- Auth with role onboarding
- Driver profile
- Truck profile
- Logging company profile
- Create load posting
- Browse available loads
- Request/claim load
- Daily truck-slot board
- Basic route preview with Mapbox
- Assignment status tracking
- Basic notification center
- Admin verification for companies/users

## 10. Suggested Production-Readiness Checklist
- `main` is always installable from a fresh clone
- lockfile committed and used in CI
- branch protection enabled
- lint/typecheck/build required on every PR
- auth roles and server-side enforcement defined
- database migrations tracked and reviewable
- env vars validated at startup
- error monitoring and analytics wired
- accessibility checks included in UI review
- preview deploys available for PRs
- audit logging for operational changes
- backup/recovery and incident response documented