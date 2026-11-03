# LogLoads — Documentation Archive

> **Everything in this directory is HISTORICAL.** None of it guides current implementation, product scope,
> pricing, or operations. The current product is Blueprint v1.0 ([`../DECISIONS.md`](../DECISIONS.md),
> 2026-11-01). The current documentation map is [`../README.md`](../README.md).

## Why these documents are kept

They are evidence of:

- legal, billing, and financial obligations;
- security findings and their remediation;
- deployment and recovery rehearsals;
- Git provenance.

Archiving a document **does not authorize** deleting:

- database records, invoices, or frozen terms;
- Stripe identifiers or webhook history;
- migration files or code guardrails;
- Git branches, tags, or stashes.

Do not edit archived files. They are preserved verbatim. When something in them needs correcting, write the
correction in a current document instead.

## Rules for reading archived files

- Statements such as "current", "locked", "must implement", "sole collection gate", "SECURITY VERIFIED", or
  "the founder's current model" were true only on the document's date.
- Relative links resolve against the file's **original** location in `docs/`. Known consequence:
  `repository/REPOSITORY_CONSOLIDATION_2026-08-03.md` links to `DECISIONS.md`, which now lives at
  [`../DECISIONS.md`](../DECISIONS.md).
- Never use an archived runbook as an execution plan, in particular to enable `LOGLOADS_FEE_COLLECTION`,
  `LOGLOADS_PERCENTAGE_ENROLLMENT`, `LOGLOADS_SUBSCRIPTION_COLLECTION`, or `LOGLOADS_DISPATCH_SELF_SERVE`.

## Contents

| Archived file | Original path | Dated | What it is | Redirect at old path |
|---|---|---|---|---|
| [`2026-06-scaffold/LOGLOADS_NEXT_STEPS-2026-06.md`](./2026-06-scaffold/LOGLOADS_NEXT_STEPS-2026-06.md) | repo root → `docs/history/` | 2026-06 | Scaffold checklist | — |
| [`2026-06-scaffold/LOGLOADS_REPO_AUDIT-2026-06.md`](./2026-06-scaffold/LOGLOADS_REPO_AUDIT-2026-06.md) | repo root → `docs/history/` | 2026-06 | Pre-reconstruction repository audit | — |
| [`handoffs/HANDOFF_2026-07-17.md`](./handoffs/HANDOFF_2026-07-17.md) | `docs/HANDOFF.md` | 2026-07-17 (revised to 08-01) | Engineering handoff; obsolete `ae` lease workflow | [`../HANDOFF.md`](../HANDOFF.md) |
| [`handoffs/HANDOFF_2026-07-27.md`](./handoffs/HANDOFF_2026-07-27.md) | `docs/HANDOFF-2026-07-27.md` | 2026-07-27 | Launch-readiness handoff; PR and fee evidence | [`../HANDOFF-2026-07-27.md`](../HANDOFF-2026-07-27.md) |
| [`2026-legacy-commercial/marketplace-implementation-spec_2026-07-24.md`](./2026-legacy-commercial/marketplace-implementation-spec_2026-07-24.md) | `docs/marketplace-implementation-spec.md` | 2026-07-24 | Dispatch / per-load fee implementation specification | [`../marketplace-implementation-spec.md`](../marketplace-implementation-spec.md) |
| [`2026-legacy-commercial/marketplace-realignment-blueprint_2026-07-24.md`](./2026-legacy-commercial/marketplace-realignment-blueprint_2026-07-24.md) | `docs/marketplace-realignment-blueprint.md` | 2026-07-24 | Percentage-model research and audit | [`../marketplace-realignment-blueprint.md`](../marketplace-realignment-blueprint.md) |
| [`2026-legacy-commercial/ACTIVATION_STRIPE_2026-08-01.md`](./2026-legacy-commercial/ACTIVATION_STRIPE_2026-08-01.md) | `docs/ACTIVATION_STRIPE.md` | 2026-08-01 (revised to 08-03) | `percentage_v1` Stripe activation runbook | Replaced by the new [`../ACTIVATION_STRIPE.md`](../ACTIVATION_STRIPE.md) |
| [`2026-legacy-commercial/PILOT_LAUNCH_2026-08-10.md`](./2026-legacy-commercial/PILOT_LAUNCH_2026-08-10.md) | `docs/PILOT_LAUNCH.md` | 2026-08-10 | Pilot contract: dispatch loop, 5% completed-load fee, assignment-gated access | Replaced by the new [`../PILOT_LAUNCH.md`](../PILOT_LAUNCH.md) |
| [`security/SECURITY_RECORD_2026-08-05.md`](./security/SECURITY_RECORD_2026-08-05.md) | `docs/SECURITY.md` | Verified 2026-07-08, revised to 08-05 | Live Supabase security verification, RLS inventory, remediation evidence | Replaced by the new [`../SECURITY.md`](../SECURITY.md) |
| [`repository/REPOSITORY_CONSOLIDATION_2026-08-03.md`](./repository/REPOSITORY_CONSOLIDATION_2026-08-03.md) | `docs/REPOSITORY_CONSOLIDATION_2026-08-03.md` | 2026-08-03 | Git recovery and consolidation record | — (no references) |

**Verbatim check (2026-11-01):** every file above is byte-identical to its original, ignoring line endings.
The five files also present in the reconciliation package match the package's archived copies.

## Historical documents that stayed at their original path

- [`../SUBSCRIPTION_BILLING_V1.md`](../SUBSCRIPTION_BILLING_V1.md) — the `subscription_v1` billing contract.
  It stays in place because the root `README.md` and `product/TRANSITION_PLAN.md` link to it. It carries a
  superseded notice; the original text below the notice is unchanged.
- [`../DECISIONS.md`](../DECISIONS.md) — an append-only log. Earlier entries are historical by definition;
  the newest applicable entry governs.

## Do not act on the archived consolidation record

`REPOSITORY_CONSOLIDATION_2026-08-03.md` names branches, tags, stashes, and artifacts. It is **not** an
instruction to delete, prune, or recreate any of them. Its canonical-checkout procedure (`ae path logloads`,
WSL) is retired.

## Pre-reconciliation versions of rewritten documents

The rewritten operational documents carried no unique evidence beyond what Git preserves, so their previous
text is not duplicated here. Retrieve any of them from the commit before the reconciliation:

```bash
git show 15892b7:docs/<FILE>.md
```

This applies to `ACTIVATION_CLERK`, `ACTIVATION_RESEND`, `AGENT_WORKFLOW`, `API_CONTRACTS`,
`AUTOMATION_ROADMAP`, `BACKEND_ARCHITECTURE`, `DATA_MODEL`, `DEPLOYMENT`, `ENV_CONTRACT`, `ENVIRONMENT`,
`MVP_BACKEND_SCOPE`, `OBSERVABILITY`, `RECOVERY`, `REVIEW_CHECKLIST`, and `RUNNERS`.

The procedures that are still accurate — the founder-admin claim, migration order, smoke assertions, rollback,
and media and Stripe fail-closed rules — were carried into the current documents.
