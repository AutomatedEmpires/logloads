# Independent review packet — normalized V2 (PR #123)

**For:** an independent reviewer (Security Auditor or any reviewer not involved in writing this SQL).
**Rules of engagement**

* **Read-only.** Agent 1 is the sole editor of the SQL, test harnesses and CI for this schema. Do not change files; report findings to Agent 1, who fixes them in separate commits with a regression test each.
* **Disposable databases only.** Never point anything here at production, staging or a hosted Supabase project; do not use any real credential.
* **Start from the code, not from the authors' documents.** `PHASE3_REVIEW.md` and `INTEGRATION_REVIEW_V2.md` describe what the authors believe; treat every claim there as unverified. Read them, if at all, after forming your own view.
* PR #123 stays a draft; it targets `test/normalized-v2-postgres17-ci`, never `main`.

## What is under review

Migration chain, applied in order: `01_schema.sql → 02_access.sql → 03_entitlements.sql → 06_v2_contract_alignment.sql → 11_v2_phase3_policy.sql → 12_v2_billing_events.sql` (all in `architecture/normalized-v2/`). Test suites: `04`, `07`, `09`, `13` (SQL, `BEGIN … ROLLBACK`), `05`/`08` (concurrency), `10` (migration on existing data), `14` (PostgREST/JWT on a Supabase local stack), `15` (migration drill). CI: `.github/workflows/normalized-v2-ci.yml`, `tools/normalized-v2-ci/`.

Policy context you need: only **V2-DEC-01/02/03** (2026-11-01) and Product Blueprint v1.0 are recorded founder approvals. F1–F5, the R4 ordering rules and the moderation hold were implemented **as directed and are not ratified**. Review them for correctness and safety as implemented; flag separately anything that looks like a policy choice the founder should make.

## Areas and questions

Answer each with evidence (file:line, or a reproducing SQL statement). "No issue found" is a valid answer if you state what you checked.

### A. Permissions

1. For each role — `anon`, `authenticated`, `service_role` (note: on Supabase it has BYPASSRLS), `authenticator`, PUBLIC — what can it read, write and execute in `marketplace` after the full chain? Is anything reachable that should not be?
2. Every `SECURITY DEFINER` function: is `search_path` pinned; can a caller influence which objects it resolves; does it re-check the caller's authority, or trust an argument (org id, user id, job id)?
3. Can any function's behaviour be changed by a session setting a client controls (`set_config`, request headers, GUCs)? Which settings are read anywhere?
4. Column-level grants on `job_postings`, `hauler_profiles`, `organization_memberships`: can a client write a column that a trigger or RPC is supposed to own (confirmation, consent, publication, legacy flags, seats, roles)?
5. Grants outside `marketplace` made by these files (e.g. on schema `extensions`): what do they open on a Supabase project where extension functions are owned by the platform?

### B. Tenant isolation

1. Can a member of organization X read or change anything of organization Y — jobs, landings, private landing details, inquiries, messages, equipment, subscriptions, audit events — through tables, RLS policies, or RPCs?
2. Can a user add themselves to an organization, raise their own role, or grant themselves a landing seat, and does any capability (`job.publish`, `interest.express`) follow from that?
3. Identity: `current_user_id()` and `trusted_identity_issuers`. Can a token from an untrusted issuer, the wrong audience, an expired token, or a `role` claim other than `authenticated` resolve to a user? Can `sync_verified_identity` be abused to link an identity to someone else's account?
4. Do discovery RPCs (`list_marketplace_jobs`, `get_marketplace_job`, `search_job_postings`) ever return rows or columns that RLS would hide from the same caller (paused, closed, moderated jobs; exact coordinates; private details)?

### C. Moderation

1. After `admin_moderate_job_posting`, is there any path — RPC, direct UPDATE, landing deactivation/reactivation, subscription change, legacy import, draft re-publish — by which the owning organization can put the posting back on the marketplace or republish identical content to evade the hold?
2. Who can create and release holds; are both audited; can a hold be orphaned or bypassed by deleting/recreating the job?
3. Are moderation actions proportionate and reversible by a moderator, as Blueprint §10.6 requires?

### D. Migration recovery

1. Is every file safe to apply in one transaction (no transaction control, no non-transactional DDL)? What happens if application fails half-way?
2. Re-running a file that has already been applied: idempotent, refused atomically, or partially applied?
3. Does any migration fabricate data — confirmations, consent, attestations, timestamps, actors — for rows that existed before it ran (look at 06's backfill and re-snap, 11's hauler-profile change, 12's new columns)?
4. Is a `pg_dump` of the schema taken before 06 a sufficient recovery point? What is *not* captured (roles, extensions, database-level settings, the attestation and billing ledgers' meaning after restore)?
5. Is there any statement whose effect differs between plain PostgreSQL 17 and Supabase (role attributes, ownership, default privileges, supautils reserved roles)?

### E. Billing ordering (R4, F5)

1. `apply_billing_provider_event`: for duplicated, delayed, reordered and concurrent deliveries, can the subscription end in a state the provider would not report? Construct an interleaving if you can.
2. Is the ordering decision sound — subscription identity, cancellation as terminal, forward-only periods, event time within a period, exact ties? Which assumptions about the provider (Stripe) does it depend on, and are any false?
3. Idempotency: can the same event id be applied twice (including after a `failed` outcome), or a different payload under an existing id be applied?
4. Can a non-`service_role` caller reach the ledger or the subscription core (`apply_subscription_cycle`) by any path?
5. F5: can a founding-discount cycle be consumed by anything other than a new paid billing cycle, or fail to be consumed by one? Can entitlement periods overlap or rewind?
6. Is every received event auditable (ledger row, outcome, reason, audit event), including rejected and failed ones?

## How to reproduce

* CI: push-free — run `gh run list --workflow normalized-v2-ci.yml --branch test/normalized-v2-contract-alignment` and read job logs; jobs: baseline (×3), alignment (×3), Supabase local stack (×2).
* Locally (optional): a throwaway PostgreSQL 17 + PostGIS container you create yourself; apply the chain with `psql -X -v ON_ERROR_STOP=1 -f` and run suites the same way. The harness scripts refuse unstamped databases; for a local container set `LOGLOADS_LOCAL_DISPOSABLE_CONFIRM=drop-marketplace-schema` **only** on a database you created for this purpose.

## Finding format

| Field | Content |
|---|---|
| ID / area | e.g. `B-3` |
| Severity | Critical / High / Medium / Low / Informational |
| Location | file:line (and object name) |
| Description | what is wrong |
| Reproduction | SQL or steps, with the observed vs expected result |
| Policy or defect | "defect" if the code contradicts its stated rule or an approved decision; "policy" if it is a choice the founder should make |
| Suggested fix | optional; Agent 1 implements |
