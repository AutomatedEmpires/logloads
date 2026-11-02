# LogLoads Documentation — What Is Current

> Revised 2026-11-01 for the adopted timber-hauling **load board**: landing operators advertise hauling
> opportunities; haulers and fleets discover them and express interest free; the businesses coordinate
> directly.
>
> LogLoads does not dispatch, track completed loads, broker freight, settle freight payments, or charge per
> load or by percentage.
>
> This index is navigation only. It is not a decision record.

## 1. Where authority lives

Use these sources in this order:

1. **The latest dated founder decision** — [`DECISIONS.md`](./DECISIONS.md). Append-only, newest entry at
   the top; the newest applicable entry governs.
2. **Product and commercial specification** —
   [`product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md`](./product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md).
   - Plans: Basic $149 / Pro $299 / Regional $499 per month.
   - Active landings 1/3/unlimited; seats 2/5/10; invitations 3/10/30 per cycle, with no rollover.
   - Boosts: $99/7, $149/14, $199/28 days.
   - Founding offer: 50% off for 6 cycles, first 10 qualifying landing organizations per launched state.
   - Haulers and fleets are free forever.
3. **UX and functional specification** —
   [`product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md`](./product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md). It governs
   screens and flows. Its recommended enhancements are not automatically approved scope.
4. **Implementation sequence** — [`product/TRANSITION_PLAN.md`](./product/TRANSITION_PLAN.md). It plans the
   work but authorizes no migration, billing, or deploy.
5. **Agent operating contract** — [`../AGENTS.md`](../AGENTS.md), plus [`../CLAUDE.md`](../CLAUDE.md).
6. **Everything else below** — kept accurate, but subordinate to items 1–5.

In code, the plan numbers live in `packages/contracts/src/membership.ts` and the V2 view contracts in
`packages/contracts/src/marketplace-v2.ts`.

**Nothing in these documents activates billing, subscriptions, boosts, invitations, the founding offer, email
campaigns, a production migration, or a deployment.**

## 2. Current versus target — read this first

| Area | CURRENT (in code at `4c9518e`) | TARGET (approved, not built or not active) |
|---|---|---|
| Persistence | One versioned JSON row, `public.operating_state`, with service-role compare-and-swap | Normalized, tenant-isolated Supabase PostgreSQL/PostGIS (`architecture/normalized-v2/`, non-active and not executed) |
| Product surface | Legacy pilot cockpits (`/driver`, `/fleet`, `/host`, `/admin`, `/pilot`); `/v2` load-board preview behind `LOGLOADS_MARKETPLACE_V2` | V2 load board replaces the pilot surface by surface |
| Authorization | Service-layer checks on a server-resolved session (RLS does not apply to service-role reads) | RLS on normalized tables, with verified Clerk → Supabase third-party auth |
| Billing | Historical `percentage_v1`, `legacy_percentage`, and `subscription_v1` code, all gates **disabled** | Basic/Pro/Regional and boosts on a new Stripe catalog, after activation gates |
| Maps | MapLibre + authenticated CARTO when keyed; legacy Mapbox fallback | Same, with verified CARTO quota and restrictions |
| Public marketing copy | **`/pricing` and `/terms` still describe the 5% completed-load fee** (code; flagged for the integration lane) | Copy consistent with Blueprint v1.0 |

Labels used across these documents:

- **CURRENT** — behavior present in code, ideally cited with a SHA.
- **TARGET** — approved but not implemented.
- **HISTORICAL** — kept for provenance only.
- **UNVERIFIED** / **OWED** — evidence that does not exist yet.

## 3. Technical architecture references

| Document | Covers |
|---|---|
| [`BACKEND_ARCHITECTURE.md`](./BACKEND_ARCHITECTURE.md) | Package layers, the V2 port/adapter boundary, the normalized target |
| [`DATA_MODEL.md`](./DATA_MODEL.md) | Current collections, the 32 proposed V2 tables, migration and retention mapping |
| [`API_CONTRACTS.md`](./API_CONTRACTS.md) | V2 server actions and port methods; the legacy `/api/*` inventory |
| [`MVP_BACKEND_SCOPE.md`](./MVP_BACKEND_SCOPE.md) | What V2 has, and what must exist before real customers |
| [`SECURITY.md`](./SECURITY.md) | Historical evidence; current pilot and V2 controls; target RLS and Clerk; verification owed |
| `architecture/normalized-v2/ARCHITECTURE.md` | Gemini's prototype reference. **Uncommitted at this revision**; it will resolve once that lane's files are integrated. |

## 4. Operational runbooks

| Document | Covers |
|---|---|
| [`ENVIRONMENT.md`](./ENVIRONMENT.md) | Local Windows workflow, local Supabase, provider configuration, the V2 flag, maps |
| [`ENV_CONTRACT.md`](./ENV_CONTRACT.md) | Production variable contract, the companion to `ops/production-env-contract.json`. This is the production source; `ENVIRONMENT.md` covers setup. |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | Runtime, migration ledger, preview gates, cutover, rollback |
| [`RECOVERY.md`](./RECOVERY.md) | `operating_state` backup, verify, restore; target normalized recovery |
| [`RUNNERS.md`](./RUNNERS.md) | GitHub-hosted CI inventory and the intended normalized-v2 PostgreSQL job |
| [`OBSERVABILITY.md`](./OBSERVABILITY.md) | PostHog and Sentry as wired; proposed V2 events |
| [`ACTIVATION_CLERK.md`](./ACTIVATION_CLERK.md) | Clerk today, founder-admin claim, target Supabase trust path |
| [`ACTIVATION_RESEND.md`](./ACTIVATION_RESEND.md) | Email as wired; future invitation-delivery rules |
| [`ACTIVATION_STRIPE.md`](./ACTIVATION_STRIPE.md) | New-model billing gates. **No live billing authorized.** |
| [`PILOT_LAUNCH.md`](./PILOT_LAUNCH.md) | Marketplace pilot plan. **Not operating.** |

## 5. Contributor process

| Document | Covers |
|---|---|
| [`AGENT_WORKFLOW.md`](./AGENT_WORKFLOW.md) | Lanes, ownership, handoff |
| [`REVIEW_CHECKLIST.md`](./REVIEW_CHECKLIST.md) | PR and handoff review gates |
| [`AUTOMATION_ROADMAP.md`](./AUTOMATION_ROADMAP.md) | CI contribution path and backlog |

## 6. Historical and archived documents

The **[`archive/`](./archive/README.md)** holds every superseded plan, handoff, specification, runbook,
security record, and Git-recovery record, verbatim, with an index.

| Old path (now a short redirect) | Archived original |
|---|---|
| [`HANDOFF.md`](./HANDOFF.md) | `archive/handoffs/HANDOFF_2026-07-17.md` |
| [`HANDOFF-2026-07-27.md`](./HANDOFF-2026-07-27.md) | `archive/handoffs/HANDOFF_2026-07-27.md` |
| [`marketplace-implementation-spec.md`](./marketplace-implementation-spec.md) | `archive/2026-legacy-commercial/marketplace-implementation-spec_2026-07-24.md` |
| [`marketplace-realignment-blueprint.md`](./marketplace-realignment-blueprint.md) | `archive/2026-legacy-commercial/marketplace-realignment-blueprint_2026-07-24.md` |

Other moves:

- **Replaced in place, original archived:** `ACTIVATION_STRIPE.md`, `PILOT_LAUNCH.md`, `SECURITY.md`.
- **Moved without a redirect** (nothing referenced them): `REPOSITORY_CONSOLIDATION_2026-08-03.md` and the
  former `docs/history/` files.
- **Historical, but at its original path:** [`SUBSCRIPTION_BILLING_V1.md`](./SUBSCRIPTION_BILLING_V1.md).
  The `subscription_v1` contract is kept for existing obligations and marked superseded.

Historical financial records, decisions, and migration files must never be deleted because their
documentation was archived.

## 7. Keeping this consistent

- When code changes a documented behavior, update the matching document in the same change, or hand it to
  the documentation lane.
- Product, pricing, and entitlement changes need a new Blueprint version and a dated decision. Never edit
  numbers into these documents silently.
- Documentation-only changes are verified with `git diff --check` and local link checks
  ([`REVIEW_CHECKLIST.md`](./REVIEW_CHECKLIST.md) §8).
