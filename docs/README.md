# LogLoads Documentation

> **Status:** Index and accuracy policy. Last verified 2026-11-02 against `work/logloads-repair` at `4c9518e`.
> This file does not record decisions.

LogLoads is a timber-hauling **load board**:

- Landing operators advertise hauling jobs.
- Haulers and fleets find them and express interest, free.
- The businesses then arrange the work directly.

LogLoads does not dispatch, track loads, broker freight, handle freight payments, or charge per load or by
percentage.

**Tasks, owners and status** live in GitHub Issues (label `agent-task`), not in these files. Project Board #10 is
deferred ([`AGENT_WORKFLOW.md`](./AGENT_WORKFLOW.md)).

## 1. Authority, in order

1. [`DECISIONS.md`](./DECISIONS.md) — dated founder decisions, append-only, newest first.
2. [`product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md`](./product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md) — the product
   and commercial model. In code, its numbers live in `packages/contracts/src/membership.ts`.
3. [`product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md`](./product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md) — screens and
   flows. The enhancements it recommends are not approved scope.
4. [`product/TRANSITION_PLAN.md`](./product/TRANSITION_PLAN.md) — the engineering sequence. It plans work; it
   authorizes nothing.
5. [`../AGENTS.md`](../AGENTS.md) and [`../CLAUDE.md`](../CLAUDE.md) — rules for agents.

Everything below is subordinate to these five. **No document activates billing, invitations, boosts, email,
migrations, or deployments.**

## 2. Status vocabulary (required in every active document)

| Label | Meaning | Evidence required |
|---|---|---|
| **APPROVED** | A founder decision | A `DECISIONS.md` entry or a Blueprint section |
| **IMPLEMENTED** | Exists in code | A path at a cited commit |
| **VERIFIED** | Specific behavior passed execution or inspection | A run URL, test name or dated observation |
| **TARGET** | Approved or proposed, not built | — |
| **HISTORICAL** | Once applied; no longer governs new work | Date |
| **UNVERIFIED** | Evidence is missing or insufficient | — |

**Evidence that is easy to over-read:**

| Evidence | What it does not prove |
|---|---|
| A passing SQL suite | Live Supabase configuration, or real Clerk token verification |
| A merged PR | Production health |
| A past deployment or provider report | Current status |
| A schema file | That it runs |

## 3. Current state at a glance

| Area | State | Evidence |
|---|---|---|
| Persistence | **IMPLEMENTED:** one JSON row, `public.operating_state` | [`ARCHITECTURE.md`](./ARCHITECTURE.md) §2 |
| Normalized schema `01`–`05` | **VERIFIED** on disposable PostgreSQL 17 + PostGIS, on branch `test/normalized-v2-postgres17-ci`. Not merged. Not connected to the app. | [`CI.md`](./CI.md) §3 |
| V2 contract alignment `06`–`10` (Gemini's 06/07 plus Claude Agent 1's stages) | **VERIFIED in CI** (head recorded in `CI.md`). It sits on draft PR #123, which is not reviewed, not merged, and not connected to the app. | [`CI.md`](./CI.md) §3 |
| Clerk → Supabase identity | **UNVERIFIED:** no real-token test exists | [`SECURITY.md`](./SECURITY.md) §4 |
| V2 load board `/v2` | **IMPLEMENTED** behind a flag. Discovery and interest work; job authoring is preview-only and nothing is saved. | [`ARCHITECTURE.md`](./ARCHITECTURE.md) §3 |
| Landing memberships ($149 / $299 / $499) | **APPROVED, not purchasable.** Prices are locked. Billing is not activated. | `docs/DECISIONS.md` 2026-11-04 |
| Retired percentage fee | **HISTORICAL:** not an offer. Parsers stay until production records are confirmed empty. Gates stay disabled. | `docs/DECISIONS.md` 2026-11-04 |
| Public `/pricing` | **IMPLEMENTED:** shows the locked prices and says nothing is for sale. | `apps/web/components/v3/PublicPages.tsx` |
| Production migration or activation | **Not authorized** | `DECISIONS.md` 2026-11-04 |

## 4. Documents

| Subject | Document |
|---|---|
| System architecture, data model, V2 boundary | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| V2 actions and legacy HTTP routes | [`API_CONTRACTS.md`](./API_CONTRACTS.md) |
| Security controls and open verification | [`SECURITY.md`](./SECURITY.md) |
| Local setup | [`ENVIRONMENT.md`](./ENVIRONMENT.md) |
| Production variables | [`ENV_CONTRACT.md`](./ENV_CONTRACT.md), companion to `ops/production-env-contract.json` |
| Provider setup from a fresh start (runbook) | [`INTEGRATIONS.md`](./INTEGRATIONS.md) |
| Deploy, migrate, roll back | [`DEPLOYMENT.md`](./DEPLOYMENT.md) |
| Backup and restore | [`RECOVERY.md`](./RECOVERY.md) |
| CI and verification evidence | [`CI.md`](./CI.md) |
| Analytics and error tracking | [`OBSERVABILITY.md`](./OBSERVABILITY.md) |
| Provider activation | [`ACTIVATION_CLERK.md`](./ACTIVATION_CLERK.md), [`ACTIVATION_RESEND.md`](./ACTIVATION_RESEND.md), [`ACTIVATION_STRIPE.md`](./ACTIVATION_STRIPE.md) |
| Marketplace pilot plan (**TARGET**, not operating) | [`PILOT_LAUNCH.md`](./PILOT_LAUNCH.md) |
| Agent coordination | [`AGENT_WORKFLOW.md`](./AGENT_WORKFLOW.md) |
| Review gates | [`REVIEW_CHECKLIST.md`](./REVIEW_CHECKLIST.md) |
| Historical evidence | [`archive/README.md`](./archive/README.md) and [`SUBSCRIPTION_BILLING_V1.md`](./SUBSCRIPTION_BILLING_V1.md) |

## 5. Keeping this accurate

- Change a document in the same PR as the code it describes, or open an issue for the documentation lane.
- Cite the evidence for an IMPLEMENTED or VERIFIED claim. Keep test counts in [`CI.md`](./CI.md) §3 only;
  other documents link there.
- Product, pricing or entitlement changes need a new Blueprint version plus a `DECISIONS.md` entry.
- Removed historical documents are recoverable from tag `archive/docs-history-20261102`
  ([`archive/README.md`](./archive/README.md)).
