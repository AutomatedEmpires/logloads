# Independent review findings — triage (PR #123, head bec27c4)

Three independent, read-only reviewers worked from `INDEPENDENT_REVIEW_PACKET.md` without the authors' documents: **A/B** permissions and tenant isolation, **C/E** moderation and billing ordering, **D** migration recovery. Agent 1 (sole SQL editor) triaged the results below. "Verified" means Agent 1 confirmed the finding against the code; "reported" findings will be confirmed by a failing regression test before any fix.

## 1. Corrections to earlier claims

The review disproved or narrowed these statements in `PHASE3_REVIEW.md` and the Phase 3 report:

| Earlier claim | Correction |
|---|---|
| "Re-running 06, 11 and 12 is idempotent" (drill 15) | **False for 06.** Re-running 06 marks live V2 jobs as legacy (D-1) and silently reverts 11's policies, including the moderation hold (D-2). The drill missed it: the data fingerprint omitted `is_legacy_import`, it had no V2-published job, and it accepted a changed catalog on re-run (D-3). |
| "Fingerprints byte-for-byte identical" | Overstated: the fingerprint omits column ACLs, owners, index definitions and most tables' content, and its paren-stripping can equate different CHECK expressions (D-8). |
| "No migration fabricates anything" | `updated_at` (shown as last-modified) is bumped on rows touched by 06's backfill and re-snap (D-6). Confirmations, consent, attestations and actors are not fabricated. |
| "06 migrates existing data safely" (10) | 06 can **abort** on valid baseline data — including the unquoted active jobs it is meant to migrate (D-4). 10 seeded only a priced job; its "no confirmer invented" check is a tautology (D-9). |
| "Moderation hold: the owner cannot undo a takedown" | The owner can republish the identical content as a new job (C-1); drafts cannot be moderated (C-2). |
| "A pre-migration schema dump is the recovery point" | Insufficient on its own (D-7): roles, extensions, settings and post-dump ledgers are not covered, and restore was only drilled into the same database. |

## 2. Defects (Agent 1 fixes, each with a regression test)

| ID | Sev | Status | Summary |
|---|---|---|---|
| D-1 | High | Verified | 06 backfill re-runs and marks V2-published jobs legacy. |
| D-2 | High | Verified (by construction) | Re-running 06 alone reverts 11/12 redefinitions (moderation hold, F3). Needs a migration-version guard refusing repeat/out-of-order application. |
| D-3 | High | Verified | Drill 15 cannot detect D-1/D-2 (catalog drift accepted; data hash too narrow; no V2 job). |
| D-4 | High | Verified (a, d) | 06 aborts on valid baseline data: (a) withdrawn + re-submitted inquiries vs the new full unique index; (b) messages > 2000 chars; (c) drafts with `last_confirmed_at`; (d) the legacy-flag backfill runs under the baseline guard, which rejects active unquoted jobs. Needs a pre-flight and a backfill that bypasses the old guard. |
| E-1 | High | Verified | A replacement subscription whose first event arrives while the old one is live is deferred permanently; after the old one cancels nothing replays it (and later events can hit the entitlement exclusion constraint and fail forever). |
| D-5 | High (conditional) | Reported | 01 drops PostGIS with CASCADE if it exists outside `extensions` — destructive on any non-CI database. Must refuse instead. |
| E-2 | Medium | Reported | F5 counts a cycle on `active` + new period, not on payment: unpaid renewals can consume a cycle; a past_due-first period is never counted. |
| E-3 | Medium | Reported | A live subscription without a provider ref is overwritten by the first event of any new provider subscription (including cancel/incomplete). |
| E-4 | Medium | Reported | A `failed` event id is retried with a different payload and applied. |
| E-5 | Medium | Reported | Different-payload duplicates are not audited; valid Stripe statuses outside the CHECK (`incomplete_expired`, `unpaid`, `paused`) raise and leave no ledger row. |
| D-6 | Medium | Reported | `updated_at` bumped by 06 backfill / re-snap. |
| D-7 | Medium | Reported | Recovery set incomplete; no fresh-database restore drill; no post-restore reconciliation step. |
| D-8 | Medium | Reported | Fingerprint coverage gaps (see §1). |
| D-9 | Medium | Reported | 10: tautological check, on-grid seed, too little realistic data, non-atomic application. |
| D-10 | Medium | Reported | 10 and 15 run with weaker target checks than `guard.sh` when run standalone (confirm-variable bypass). |
| B-1 | Medium | Verified | An owner can force-activate an invited person via `invited → suspended → active`. |
| B-5 | Medium | Reported | `sync_verified_identity` stores unverified emails (pre-claim lock-out) and keeps `email_verified_at` across an email change. |
| B-4 | Medium | Reported | A verified org can change its legal/display name and slug and keep `verified` (defect or policy — see §3). |
| B-2 | Medium | Reported | Any landing-seat user can read every user's qualifications (defect against the F1 consent model; scope is partly policy). |
| E-6, E-8, E-9, C-2, A-2, A-3, B-6, B-7, B-9, D-11, D-13 | Low | Reported | Reconciliation snapshot ordering; grace from DB time; split-period invitation comment; drafts not moderatable; explicit revokes on new ledgers; blanket extensions grant; user-id columns readable by authenticated; declined inquiry keeps private-detail sharing; message cap bypass by direct insert; default-privilege hardening; transaction-control lint. |

## 3. Policy questions (founder decides; no change until then)

* **C-1 / C-3** Scope of a moderation hold: one job, matching content, or the organization's publishing? Should owners see the reason? (A fix for the evasion depends on this.)
* **E-7 / D-12** Revoke `open_subscription_cycle` from `service_role` (webhooks only through the event path)?
* **B-3** Which platform-admin roles may read inquiries, messages and memberships, and must those reads be audited?
* **B-8** May organization owners see the moderator's identity and reason in audit rows?
* **B-4** Does changing a verified organization's name or slug reset verification?
* **A-1** Must every enabled identity issuer pin an audience?
* **I-1** May callers shorten the invitation dedupe window?
* **F1 migration** Withdrawing every pre-V2 public profile (including any that had genuinely opted in) — confirm.

## 4. What the reviewers checked and found sound

SECURITY DEFINER functions pin `search_path` and re-derive authority; only JWT claims and the `role` GUC are read; identity resolution requires a trusted issuer, audience (when set), expiry and active user; no cross-organization read/write path beyond the findings above; client-unwritable confirmation/consent/publication/legacy/seat columns; discovery RPCs match RLS; moderation blocks reactivation by status change, direct UPDATE, landing and subscription transitions; billing advisory/org lock ordering is deadlock-free; identical redelivery is idempotent; the ledger and subscription core are unreachable by clients; every file applies inside one transaction.

## 5. Effect on readiness

The four verified High defects (D-1/D-2 re-run safety, D-4 aborting on valid data, E-1 lost subscription replacement) and C-1 change the Phase 3 verdict: **adapter integration is not ready until they are fixed and re-verified.** Staging and production verdicts are unchanged (not ready; production not authorized).
