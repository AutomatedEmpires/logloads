# LogLoads — Handoff

**As of 2026-10-11.** The one page to read after `AGENTS.md`. Earlier handoffs and
audits are in [archive/](./archive/) for evidence only.

## What LogLoads is, in one paragraph

A mobile-first coordination network for timber hauling: **Plan → Publish → Match →
Commit → Coordinate → Haul → Confirm → Repeat**, across four cockpits:
- **Driver**: Map → Loads → Schedule → Profile.
- **Fleet**: free workspace.
- **Host**: landing operators who publish work and pay the fee.
- **Admin.**

Hosts publish loads with flat stated driver pay. Drivers request slots and hosts
approve them. Approval issues a Route Pack: exact access detail, redacted until
assignment. The driver hauls, records the delivery with proof, and the host confirms.
LogLoads bills the host a separate 5% fee after physical completion. It never touches
driver pay, and fee collection and enrollment are dark until separately authorized.

## Where truth lives

| Question | Source |
|---|---|
| Rules every agent must follow | `AGENTS.md` (+ `CLAUDE.md` short form) |
| Why something is the way it is | [DECISIONS.md](./DECISIONS.md), newest first |
| How to work and validate | [WORKFLOW.md](./WORKFLOW.md) |
| Every external service | [PROVIDERS.md](./PROVIDERS.md) |
| Env variables | [ENV_CONTRACT.md](./ENV_CONTRACT.md), `ops/production-env-contract.json`, `.env.example` |
| Doc index | [README.md](./README.md) |

## Current state

- **Production:** Vercel, deployed from `main` to `logloads.com`, with Supabase
  `operating_state` canonical. Pre-customer: zero confirmed real users or customers.
- **Commercial gates:** `LOGLOADS_FEE_COLLECTION` and `LOGLOADS_PERCENTAGE_ENROLLMENT`
  are both `disabled`. Turning either on is a live-money or legal action, not
  ordinary engineering.
- **Quality bar:** about 2,000 unit tests (contracts, db, services, web) plus tool
  tests, e2e journeys, guardrails, and a clean `pnpm deadcode`.
- **Recently landed** (2026-10-09/11):
  - patched critical Next.js and image-pipeline advisories;
  - a recorded delivery can no longer be cancelled away (`haulCancellationBlock`);
  - honest request/decline notifications;
  - the Fly.io/Docker rollback host removed;
  - the rate limiter no longer trusts `fly-client-ip`;
  - dead code removed and knip enforced;
  - docs consolidated;
  - the driver profile opens with a showcase: truck-photo hero, identity card,
    photos, and an eight-tile track record built only from LogLoads records.

## Open work, ranked

0. **P0: production is down. The Supabase project was deleted on 2026-10-11.**
   `/api/health` returns 503 (`engine.ok: false`). The rebuild is partly done.
   - New project `cmbinynkzkhuvjywwmff` has every migration and the media
     bucket, and passes verification.
   - Its canonical row is the empty launch document (no sample data on launch).
   - Vercel Production's non-secret Supabase variables point at it.

   Still owed, all by the founder:
   - the service-role key;
   - the platform-admin reclaim;
   - a redeploy;
   - backups.

   Preview runs separately on `logloads-preview` with the sample operation
   ([DEPLOYMENT.md → Preview deployments](./DEPLOYMENT.md#preview-deployments)).

   See [RECOVERY.md → Rebuild record](./RECOVERY.md#rebuild-record-2026-10-11).
   Do no other production work until health is 200.
1. **`maplibre-gl` critical advisory.** Upgrade 4.x → 6.x. This needs `react-map-gl`
   7 → 8 (`@vis.gl/react-maplibre`) in `apps/web/components/v3/RealMap.tsx`, with
   visual verification on phone and desktop. Dependabot #93.
2. **Provider licensing.** Open-Meteo's free API and CARTO basemaps are
   non-commercial. Confirm production sets `NEXT_PUBLIC_MAPBOX_TOKEN`, and pick a
   commercial weather plan or provider before real traffic
   ([PROVIDERS.md](./PROVIDERS.md#licensing-risks-to-resolve-before-real-commercial-traffic)).
3. **Founder decision: dispute resolution.** Hosts can dispute a delivery without a
   counter-figure and leave it `disputed` forever, so no fee accrues and the driver's
   history never settles. The archived spec
   (`archive/marketplace-implementation-spec.md` §(b)/(c)) proposes three things:
   - a required counter-figure on disputes;
   - disclosed 72h auto-confirm;
   - a 336h dispute timeout.

   Auto-confirm turns host silence into a charge, so don't build it without a
   dated decision.
4. **Built, not surfaced: host view of driver credentials.** `HostCredentialSummary`
   (`components/v3/CredentialVault.tsx`) and `getHostDriverCredentialSummary`
   (`lib/credential-data.ts`) are finished and tested but no host page renders them.
   The natural home is the host's request-approval decision, as a host-facing
   version of the driver profile showcase. Both are tagged `@public` so the
   dead-code check keeps them.
5. **Driver profile facts the showcase can't show yet.** Truck model year,
   trailer make and length, insurance coverage amount, and CDL class or
   endorsements aren't stored. Model year is the cheapest win: add an optional
   `modelYear` to `truckProfileSchema`, accept it in `addEquipmentInputSchema`,
   and add an equipment-edit path so existing trucks can set it. The
   `/driver/profile` showcase (`components/v3/DriverProfileShowcase.tsx`, view in
   `lib/driver-profile-showcase.ts`) will pick it up in the truck row.
6. **Seed-only allocation modes.** `open_claim` and `dispatcher_assignment` exist only
   in schema and seed. Publishing always writes `request_approval`, and nothing lets
   a dispatcher assign directly. Remove them, or build the path when a criterion
   needs it.
7. **`vitest` 3 → 4.** Dev-only major upgrade (Dependabot #94).
8. **Operational proof still owed** (`AGENTS.md` §11): an authenticated production
   request → approval → trip → message loop, and forced cold-start recovery.

Dependabot #95, #96 and #97 (next, sharp, image-size) are superseded by the
dependency patch on this line of work and close once it merges.

## Branch housekeeping (as of 2026-10-11)

**Safe to delete.** Each branch head equals its merged PR's head, or sits inside
`main`, so the PR keeps every commit:

```bash
git push origin --delete claude/scheduling-conflict-guard claude/series-fixture-and-slot-windows \
  codex/authority-boundary-closure codex/commercial-truth-fleet-free codex/organization-suspension-enforcement \
  codex/pilot-activation-hardening codex/pilot-control-plane-hardening codex/pilot-launch-showroom \
  codex/pilot-product-completion codex/subscription-pricing-v1 codex/subscription-pricing-v1-production \
  codex/truthful-first-run-activation codex/merge-subscription-v1
```

**Never merged. An owner decides; don't delete blindly (`AGENTS.md` §9):**

| Branch | Status |
|---|---|
| `agent/cloudinary-dedicated-tenancy` | PR #49 closed. Cloudinary is retired |
| `agent/founder-review-composite` | PR #51 closed |
| `claude/posting-source-ownership` | No PR. Superseded by #45 (merged) |
| `codex/dependency-hardening` | PR #80 closed |
| `codex/driver-fleet-operational-ux`, `codex/host-admin-operational-ux`, `codex/visionary-surface-redesign` | PRs #90, #91, #89 closed; the surfaces shipped in #92 |
| `fable/operator-readiness` | Has commits after its merged PR #53 |
| `fable/slot-authorization` | PR #63 closed. Superseded by #64 (merged) |
| `fable/wave-a1-admin-and-team`, `fable/wave-a2-mills` | PRs #76, #77 closed |
| `fable/wave-c-five-percent` | No PR |

## Map of the code

```text
packages/contracts   Zod schemas, enums, permissions (role/action matrix), state machines, billing model
packages/db          operating_state repository (CAS), seed data, snapshot upgrade, migration contract tests
packages/services    every business transition + authorization; root index is the public API
packages/ui          primitives + semantic Phosphor icon registry
apps/web             Next.js 15 App Router: app/{driver,fleet,host,admin,…}, components/v3, lib/*
supabase/            migrations (forward-only, additive) + seed
tools/               runbook CLIs, guardrails, demo, e2e wrapper (see tools/README.md)
ops/                 machine-readable production env contract
```

## Traps that cost real time

**Persistence**
- Everything lives in one JSONB row, `public.operating_state` (`id='primary'`).
  `mutateState()` replays a mutation on version conflict, so mutations must be
  deterministic.
- `upgradeStateSnapshot` casts; it doesn't Zod-parse. Schema defaults never reach
  stored documents. For a new field on an existing collection, backfill on read
  (`{ ...row, field: row.field ?? default }`). A new required collection trips
  `REQUIRED_TABLES` and fails production closed.
- The relational tables are a dormant mirror. The app writes with the service role,
  so RLS is inert today, but it must be correct before that path is activated.

**Domain**
- `loadPostings.companyId` is the **host** (poster), not the destination. Mills
  aren't organizations.
- `role !== "driver"` doesn't mean "staff": it also admits `viewer` and `billing`.
  Gate on the action, and check which role performs the *downstream* action in
  `ORGANIZATION_ROLE_ACTIONS`.
- Separation of duties compares **actors**, not organizations. One seed dispatcher
  belongs to two organizations.
- Anything assignment-scoped needs a fallback for pre-feature (legacy) records.
  Fresh-seed tests never exercise the legacy shapes production holds.

**Discipline**
- Derive UI option lists from the domain enum (`schema.options`); never hand-copy them.
- `undefined` means "unchanged" and `null` means "clear". Never conflate them in
  partial updates.
- Audit events record only real transitions.
- Put tests where the invariant lives, with a negative control.
- Green CI has never proven a feature honest; independent review has. Before
  building, find the sentence the product tells a user and check whether the code
  enforces it.

**Cloud sandbox notes**
- The web build fetches Google Fonts. Behind the agent proxy, run
  `NODE_EXTRA_CA_CERTS=<proxy CA> pnpm --filter @logloads/web build`, because turbo
  strips that variable.
- `pnpm db:check` and `pnpm test:e2e` need the Supabase CLI and Docker. If they are
  absent, say so in the PR; CI runs both.
