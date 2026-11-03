# LogLoads — Historical Evidence

> **Status:** HISTORICAL; index revised 2026-11-02. Nothing here guides current work. The current state is in
> [`../README.md`](../README.md).

## 1. Retained in the tree — evidence pending a retention decision

| File | Why it is kept |
|---|---|
| [`security/SECURITY_RECORD_2026-08-05.md`](./security/SECURITY_RECORD_2026-08-05.md) | Live Supabase verification (2026-07-08), the closed anon-RW exposure, the RLS inventory, accepted advisor exceptions. Security evidence. |
| [`2026-legacy-commercial/ACTIVATION_STRIPE_2026-08-01.md`](./2026-legacy-commercial/ACTIVATION_STRIPE_2026-08-01.md) | Activation controls for `percentage_v1` collection: account and mode assertions, enrollment gates. Needed to interpret any historical provider activity. **Never an execution plan.** |
| [`../SUBSCRIPTION_BILLING_V1.md`](../SUBSCRIPTION_BILLING_V1.md) | The `subscription_v1` contract: obligations, frozen terms, reconciliation rules. Kept at its original path because the root `README.md` links to it. |

The files are verbatim; do not edit them. Write corrections in the current documents.

**Founder decision needed:** the retention period for these three files. Once it is set, they may move behind
the tag in §2 like the rest.

## 2. Removed from the tree — recoverable from tag `archive/docs-history-20261102`

The annotated tag `archive/docs-history-20261102` is pushed to GitHub and points at commit `f40d85e` (PR #100).
On 2026-11-02, recovery from a fresh clone of the remote was verified byte-for-byte for every file below. **Do
not delete or move the tag.**

```bash
git fetch origin tag archive/docs-history-20261102 --no-tags
git show archive/docs-history-20261102:<path> > recovered.md
```

| Path at the tag | What it was |
|---|---|
| `docs/archive/2026-legacy-commercial/marketplace-implementation-spec_2026-07-24.md` | Dispatch and per-load fee implementation specification (316 KB) |
| `docs/archive/2026-legacy-commercial/marketplace-realignment-blueprint_2026-07-24.md` | Percentage-model research (170 KB) |
| `docs/archive/2026-legacy-commercial/PILOT_LAUNCH_2026-08-10.md` | Pilot contract: dispatch loop, 5% completed-load fee |
| `docs/archive/handoffs/HANDOFF_2026-07-17.md`, `HANDOFF_2026-07-27.md` | Engineering handoffs, including the retired `ae` lease workflow |
| `docs/archive/repository/REPOSITORY_CONSOLIDATION_2026-08-03.md` | Git recovery record. **Not** an instruction to prune branches, tags or stashes. |
| `docs/archive/2026-06-scaffold/LOGLOADS_NEXT_STEPS-2026-06.md`, `LOGLOADS_REPO_AUDIT-2026-06.md` | June 2026 scaffold notes |
| `docs/BACKEND_ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/MVP_BACKEND_SCOPE.md` | Consolidated into `ARCHITECTURE.md` |
| `docs/RUNNERS.md`, `docs/AUTOMATION_ROADMAP.md` | Consolidated into `CI.md` |
| `docs/HANDOFF.md`, `docs/HANDOFF-2026-07-27.md`, `docs/marketplace-*.md` | Redirect stubs |

Earlier versions of every document are also in normal Git history. For example, use
`git show 15892b7:docs/<file>` for the text from before the 2026-11-01 reconciliation.

## 3. What removal does not authorize

Removing a document from the tree never authorizes deleting:

- database records, invoices, frozen terms, Stripe identifiers or webhook history;
- migrations or billing code;
- Git branches, tags or stashes.

The financial obligations themselves live in canonical state and in code (`packages/contracts/src/billing-model.ts`,
`packages/services/src/platform-fees.ts`, `subscription-billing.ts`), not in these documents.
