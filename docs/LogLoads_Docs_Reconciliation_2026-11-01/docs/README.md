# LogLoads Documentation Index — What Is Current

> Updated November 1, 2026 for the approved timber-hauling **load board**, not a freight dispatch/TMS. This index classifies documentation; it is not itself the commercial decision record.

## Binding product and implementation references

| Source | Meaning |
|---|---|
| Repository `AGENTS.md` | Agent working contract and safety/ownership rules |
| `docs/DECISIONS.md` | Append-only dated product/architecture decisions; newest applicable decision governs |
| `docs/product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md` | November 1 adopted membership, invitation, boost, free-hauler and non-dispatch model |
| `docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md` | Screen-level UX/flows, marked LOCKED/MVP/NEXT/LATER |
| `docs/product/TRANSITION_PLAN.md` | Planned pilot-to-V2 sequence, subject to actual progress |
| `architecture/normalized-v2/ARCHITECTURE.md` | Gemini's **non-active** normalized database prototype; not an operational migration |

## Actively maintained operational documents

- `BACKEND_ARCHITECTURE.md` — deployed pilot versus V2 prototype and adapter boundary.
- `DATA_MODEL.md` — current JSON collections, target relational entities, and historic retention.
- `API_CONTRACTS.md` — implemented V2 server-action port versus existing pilot HTTP endpoints.
- `MVP_BACKEND_SCOPE.md` — V2 first release outcome and blocking gates.
- `DEPLOYMENT.md` — exact-SHA rollout, preview isolation, data migration and rollback.
- `ENVIRONMENT.md` — environment workflow/provider guide (already corrected; retain existing version).
- `ENV_CONTRACT.md` — human-readable production variable rules; reconcile with `ops/production-env-contract.json` and actual code.
- `ACTIVATION_CLERK.md`, `ACTIVATION_RESEND.md`, `ACTIVATION_STRIPE.md` — activation policies with explicit founder gates.
- `OBSERVABILITY.md` — historical telemetry versus proposed marketplace events.
- `AGENT_WORKFLOW.md`, `AUTOMATION_ROADMAP.md` — contributors, CI, handoffs and verification.

## Retired active instructions — original content archived, never erased

| Old path (now short redirect) | Original historical location |
|---|---|
| `HANDOFF.md` | `archive/handoffs/HANDOFF_2026-07-17.md` |
| `HANDOFF-2026-07-27.md` | `archive/handoffs/HANDOFF_2026-07-27.md` |
| `marketplace-implementation-spec.md` | `archive/2026-legacy-commercial/marketplace-implementation-spec_2026-07-24.md` |
| `marketplace-realignment-blueprint.md` | `archive/2026-legacy-commercial/marketplace-realignment-blueprint_2026-07-24.md` |
| Pre-November Stripe activation runbook | `archive/2026-legacy-commercial/ACTIVATION_STRIPE_2026-08-01.md` |

**Historical financial data and append-only decisions must not be deleted.** Archiving documentation does not authorize removing database records, migration files, code guards, or outstanding provider obligations.

## Accuracy rules

- **CURRENT** means code behavior or observed environment, preferably with dated SHA; **TARGET** means approved but not implemented; **HISTORICAL** means retained for provenance only.
- Gemini's SQL has not passed execution/Clerk/RLS/concurrency tests on a verified disposable PostgreSQL instance based on the supplied reports.
- `/v2` is a development-only preview using existing pilot state, not a live paying membership application.
- Current account-reported CARTO Basemaps allowance is **5 million requests per month**; provider billing/usage must still be checked in the actual account.
- No document by itself may enable live billing, production migration, deployment, external email campaigns or credential rotations.
