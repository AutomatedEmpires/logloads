# Normalized V2 — Phase 3 review: directed policy items, billing ordering, Supabase verification

**Branch / PR:** `test/normalized-v2-contract-alignment`, draft PR #123 (base `test/normalized-v2-postgres17-ci`). Phase 1 and Phase 2 history unchanged.
**Scope:** database only (`architecture/normalized-v2/`, `tools/normalized-v2-ci/`, `.github/workflows/normalized-v2-ci.yml`). No application, contract, `supabase/` or production file was touched. Interface changes for the adapter are in `INTERFACE_CONTRACT_H1_H3.md`.

> **Superseded in part.** An independent review (`INDEPENDENT_REVIEW_FINDINGS.md`) disproved several claims below — notably that re-running 06 is idempotent, that the drill fingerprint is byte-exact, and that the moderation hold cannot be evaded. That document's §1 lists the corrections; the readiness verdict in §7 is revised.

## 1. Migration chain and files

`01 → 02 → 03 → 06 → 11 → 12` (forward-only; each file applies in one transaction — proven by `15`).

| File | Purpose |
|---|---|
| `06_v2_contract_alignment.sql` | Phase 2, plus **E6** fix (below) |
| `11_v2_phase3_policy.sql` | F1–F4 (as directed), moderation holds |
| `12_v2_billing_events.sql` | R4 provider-event ledger and ordering, F5 |
| `13_v2_phase3_tests.sql` | Phase 3 regression suite (88 PASS notices) |
| `08_v2_contract_concurrency_test.sh` | + races A6, A7, A8 |
| `10_v2_migration_path_test.sh` | + E6, F1 and R4 on migrated data |
| `14_supabase_api_tests.sh` | PostgREST + JWT tests on the Supabase local stack |
| `15_migration_drill.sh` | atomic apply, injected-failure rollback, re-run, backup/restore |

## 2. Approval status and implementation

**Recorded founder approvals** (the only ones found in the repository): **V2-DEC-01, V2-DEC-02, V2-DEC-03**, approved 2026-11-01 (`GAP_AUDIT_V2_CONTRACTS.md` §1), and the commercial rules of **Product Blueprint v1.0**. A search of `main`, the docs branches (`docs/lean-authoritative-knowledge`, `docs/reconciliation-2026-11-01`), `docs/DECISIONS.md` and the reconciliation drafts found **no founder approval record for F1–F5**. Their only source is the Phase 3 directive. They are therefore implemented **as directed and are not described here as decided policy**; each lives in 11 or 12 so it can be changed without touching 01–06.

| Item | Approval status | Implementation (as directed) | Evidence |
|---|---|---|---|
| **F1** hauler profiles private by default; public discovery needs explicit consent | **Directed — not ratified.** Blueprint v1.0 lists a "Basic public hauler directory" but sets no default visibility or consent rule; this is new policy and narrows directory reach. | `is_public` default `false`; consent (`public_listing_consent_at/by`) recorded by a trigger from an active owner/manager only, never client-writable; CHECK public ⇒ consent; withdrawal clears it; audited. Pre-V2 profiles public only by the old default are made private and audited. | 13, 10, stage-11 checks |
| **F2** legacy postings need valid pay before reconfirmation / re-activation | **Directed — not ratified.** Extends approved V2-DEC-02, which only preserves unquoted legacy records through an audited import. | `reconfirm_job_posting` / `reactivate_job_posting` refuse a legacy posting without V2-DEC-02 pay; an attested legacy posting cannot drop its pay. | 13, 09 |
| **F3** re-activation needs a fresh attestation | **Directed — not ratified.** Extends approved V2-DEC-03, which covers initial publication only. | Only `reactivate_job_posting(p_job_id, p_attest_available => true)` moves paused/filled/closed/expired → active; the guard requires an attestation written in the same transaction after the posting left active. | 13, 09, 08 A8, 14 |
| **F4** incomplete drafts; publication enforces completeness | **Supported by approved V2-DEC-02** ("Incomplete drafts may be saved only as `status = 'draft'`"). The specific relaxation of truck demand is from the directive. | Truck-demand CHECK applies to non-drafts only; no invented truck count; publication still requires demand, equipment and pay. | 13 |
| **F5** plan changes do not consume founding-discount cycles | **Consistent with Blueprint v1.0 §8.1** ("50% off … for their first six paid billing cycles"); the interpretation that a plan change is not a paid billing cycle is not separately ratified. | A cycle is consumed only by billing reason `subscription_create` / `subscription_cycle`, or, on the direct worker path, a period that does not start inside the open one. | 13, 08 A7 |
| **R4** webhook ordering | **Directed for implementation.** The rules chosen — cancellation terminal, forward-only periods, ties deferred to reconciliation, `failed` retried — are engineering choices, not ratified policy (§3). | 12 | 13, 08 A6/A7, 14 |
| **Moderation hold** | **Engineering fix — policy not ratified.** Blueprint §10.6 requires auditable, proportionate admin actions but says nothing on whether an owner may restore a moderated posting. | Moderation writes an ungranted hold; re-activation refused until a moderator releases it. | 13 |

Not decided anywhere (no change made): invitation allowance on mid-cycle plan changes (Blueprint §6.2 / §16.2 leave proration unapproved) — question F6.

**Why the moderation hold exists (engineering finding).** `admin_moderate_job_posting` (03) only set the status, so the owner could immediately restore a moderated posting. Moderation now writes an ungranted hold; re-activation is refused (`42501`) until a moderator releases it (`admin_release_job_moderation_hold`, audited).

**E7 (06 defect, fixed in 06).** 06's loop that drops the superseded baseline pay and `published_at` checks compared `pg_get_constraintdef()` text (which carries parentheses and `::text` casts) against plain patterns, so nothing was dropped. No access impact — the stricter V2 constraints also applied — but errors named the old constraint and 06 did not do what it states. Stage 6 now asserts they are gone.

**E6 (06 defect, fixed in 06).** The 0.10° re-snap fired the hauler-profile and availability guard triggers, which stamp `last_confirmed_at` / `reported_at = now()`: applying 06 made every hauler look freshly confirmed and every availability report freshly reported. The triggers are suspended for exactly those statements. Regression in 10.

## 3. R4 — billing webhook ordering

**Entry point:** `apply_billing_provider_event(...)` — `SECURITY DEFINER`, executable by `service_role` only. Returns `(result, result_reason, applied_subscription_id, ledger_event_id)`.

**Ledger:** `billing_provider_events` (RLS on, no client grants): one row per provider event id with type, provider creation time, subscription snapshot, payload SHA-256, delivery count, payload-conflict flag, outcome and reason. Every processed delivery is also audited (`billing.event_<outcome>`); billing/support admins read it through `admin_list_billing_provider_events`.

**Ordering (provider semantics, not timestamps alone):**

1. **Idempotency** — a known event id is a `duplicate` (delivery counted; a different payload is flagged and not applied). Exception: a `failed` event is retried.
2. **Identity** — an event naming another organization for a known subscription is `rejected`; an event for a second live provider subscription is `deferred_conflict` and flags the live one for reconciliation; a cancellation of a subscription the org is not using is `ignored_superseded`.
3. **Terminal state** — cancellation always applies; afterwards every event for that subscription is `ignored_terminal`. A resubscription is a new provider subscription.
4. **Billing period** — periods only move forward; an event for an earlier period is `ignored_stale`. The worker RPC `open_subscription_cycle` now also refuses to rewind a live subscription.
5. **Within one period** — the provider's event creation time orders events; older is `ignored_stale`. An exact tie between different states is **not guessed**: `deferred_tie`, subscription flagged `provider_sync_required`; a reconciliation snapshot (`p_is_reconciliation => true`) fetched from the provider resolves it.
6. Lock, deadlock, serialization and cancellation errors propagate (transaction retried); any other apply error is recorded as `failed` and retried on redelivery.

Preserved transitions (13): create, renewal, mid-cycle upgrade and downgrade, payment failure (grace window), recovery, cancel-at-period-end, cancellation, resubscription. Reordered, duplicated, delayed and concurrent delivery: 13 and 08 (A6 concurrent duplicate, A7 concurrent N+1/N+2 renewals).

**Webhook-handler requirements (application-owned; not implemented here):**

1. Verify the Stripe signature on the raw body first; refuse unsigned or invalid requests.
2. `p_payload_sha256` = lowercase hex SHA-256 of the raw payload bytes; `p_provider_event_id` = `event.id`; `p_event_type` = `event.type`; `p_provider_created_at` = `event.created`.
3. Pass the **subscription snapshot**: `data.object` for `customer.subscription.*`; for `invoice.*` the subscription it references (fetch it), plus `invoice.billing_reason` as `p_billing_reason`. Map the price to a plan code server-side; take the organization id from subscription metadata set at checkout, never from a client.
4. Status mapping: `active`, `trialing`, `past_due`, `canceled` map directly; `incomplete` → `incomplete`; `incomplete_expired` → `canceled`; `unpaid` → `past_due`; `paused` has no approved meaning — refuse and alert (founder question F7).
5. Respond **200** for `applied`, `duplicate`, `ignored_*`, `deferred_*`, `rejected` (a retry cannot change them; alert on `rejected`/`deferred_*`); respond **5xx** for `failed` or a database error so the provider retries; `22023` is a handler bug (400 + alert).
6. On `deferred_*` or `provider_sync_required`: fetch the subscription from Stripe and submit it with `p_is_reconciliation => true` and a unique event id (e.g. `recon_<uuid>`).
7. Call only `apply_billing_provider_event` from the handler (server-side, service key). `open_subscription_cycle` stays for tests and back-office tooling; revoke its `service_role` grant before go-live.
8. Provider configuration must agree with the database: the founding coupon must cover six paid billing cycles, and plan changes must not reset the billing-cycle anchor (otherwise the provider bills a new cycle the database does not count). Confirm with the billing owner.

## 4. Supabase environment verification

CI job `supabase-local-stack` starts a Supabase CLI local stack **inside the job** (CLI v2.121.0, release tarball checksum-verified; no access token, no linked or hosted project; the stack's generated local keys are masked). Two fresh stacks per run.

**Environment (recorded by `tools/normalized-v2-ci/supabase-probe.sh` every run):**

| Item | Observed |
|---|---|
| Image / server | `public.ecr.aws/supabase/postgres:17.11.0.004`, PostgreSQL 17.11 |
| Extensions | PostGIS **3.3.7** (CI service: 3.5.2) and btree_gist 1.7 created in `extensions` by the migration role; pgcrypto, pg_stat_statements, uuid-ossp, supabase_vault preinstalled |
| PostgREST | v16.4 behind the Kong gateway; `marketplace` added to exposed schemas |
| Migration role `postgres` | `rolsuper = false`, `rolbypassrls = true`, member of anon / authenticated / service_role with admin option; owns the database |
| `service_role` | **`rolbypassrls = true`** (real Supabase), no login |
| `anon` / `authenticated` | no BYPASSRLS; role-level `statement_timeout` 3 s / 8 s |
| `authenticator` | login, `noinherit`; may switch only to anon / authenticated / service_role (supautils reserved roles) |
| Default privileges | Supabase's automatic grants cover `public`, `storage`, `graphql*`, `extensions` — **not** `marketplace`, so nothing in the schema is granted except what 01–12 grant |

**Results (both stacks, every run):** stages 1, 2, 3, 6, 11, 12 apply as the non-superuser `postgres` role with every post-check passing; 04, 07 (59 PASS), 09 (51), 13 (88), 14 (43 API checks), 08 (A1–A8), 10 and 15 pass — identical to the PostgreSQL 17 + PostGIS 3.5 job. Final inventory: 37 tables, 71 functions (63 `SECURITY DEFINER`, all owned by `postgres` — not a superuser — all with pinned `search_path`, none executable by PUBLIC), 66 policies, RLS on every table.

**What 14 proves through the real request path (gateway → PostgREST → `authenticator` → role switch):**

* PostgREST rejects expired tokens (`PGRST303`) and tokens signed with another key (`PGRST301`) before the database; a validly signed token naming `postgres` or `supabase_admin` cannot assume it (`42501`).
* The database additionally requires a trusted issuer, the expected audience and a known subject: each wrong value resolves no user (`42501`) and creates no user.
* Real `service_role` (BYPASSRLS) reaches **no** marketplace table and **no** user RPC (`42501` — grants, not RLS, are the barrier); its only surface is the five worker RPCs plus `apply_billing_provider_event`.
* anon sees only public jobs at the 0.10° point and never private landing details; tenant isolation (rival reconfirm, PATCH, inquiry and private-detail reads) and escalation attempts (ledger writes, `last_confirmed_at`, legacy import, `write_audit`, worker and internal functions) all fail with real `42501`, not "function not found".
* V2-DEC-02/03, F3 and H3 hold over HTTP; the publisher recorded is the user named by the token's `sub`; a redelivered webhook is a duplicate over HTTP.

**Supabase-specific defect found and fixed — S5.** 02's `grant execute on all functions in schema extensions to public, anon, authenticated, service_role` is inert on plain PostgreSQL but, on Supabase, uses the migration role's grant option on platform-owned extension functions and re-opened functions extensions restrict (e.g. `pg_stat_statements_reset`) to API roles. 11 revokes exactly that footprint; stage 11 asserts no such grant remains and `pg_stat_statements_reset` is closed. (The statement in 02 itself is left for the consolidated migration to drop — recommended.)

**Migration sequencing and rollback / recovery (15, on both targets):** every file applies with `--single-transaction`; a failure injected after the last statement of 06 → 11 → 12 leaves catalog and data fingerprints identical; re-running 06, 11 and 12 is idempotent; a pre-migration `pg_dump` of the schema restores to the exact pre-migration fingerprint and the forward migrations then apply again. **Strategy:** forward-only migrations, each in one transaction, schema backup immediately before applying; recovery = restore the backup and re-apply; no down-migrations (none would be safe for the attestation and billing ledgers).

**Not covered by the local stack:** Clerk's real JWKS (RS256) verification through Supabase third-party auth (tokens here are HS256-signed with the stack's local secret); hosted-project connection pooling; production-sized data and plans.

## 5. Risk register

| Class | Item | Status |
|---|---|---|
| BLOCKER (adapter go-live) | **R1** Port attestation argument and strict publish schema (H1) | Open — Codex (`INTERFACE_CONTRACT_H1_H3.md`) |
| BLOCKER (adapter go-live) | **R2** Clerk → Supabase third-party auth with Clerk's real JWKS and session-token claims (`role = authenticated`, `aud`) | **Reduced:** PostgREST JWT handling, role switching and every database claim rule verified on the Supabase stack. **Open:** real Clerk tokens against an isolated Supabase branch |
| REQUIRED | **R3** Supabase environment | **Done on the local stack** (this phase). Remaining for staging: an isolated hosted branch (pooler, project settings) |
| REQUIRED | **R4** Billing webhook ordering | **Done in the database** (12, 13, 08). Open: webhook handler per §3, Stripe coupon / billing-anchor configuration (billing owner) |
| REQUIRED | **R5** No client re-rounding (H2) | Open — Codex |
| REQUIRED | **R8** F3 port methods (`setJobStatus`, `reactivateJob`) | Open — Codex |
| REQUIRED | **R9** Expose `marketplace` in the project's API settings; review the 3 s / 8 s role statement timeouts against discovery queries | Open — staging |
| REQUIRED | **R10** Revoke `service_role` EXECUTE on `open_subscription_cycle` before go-live (webhooks use the event path only) | Open — after the test suites move to the event path |
| OPTIONAL | **R6** Discovery query plans (per-row visibility function, text search) under the 3 s anon timeout | Open |
| OPTIONAL | **R7** Content-based publish dedup | Open |
| OPTIONAL | **R11** Drop 02's blanket `extensions` grant at the source when migrations are consolidated (S5 currently corrects it in 11) | Open |
| DEFERRED | GAP-11 saved searches, GAP-12 invitation packs; an audited admin tool to force a subscription period correction | — |

Fixed this phase (engineering): E6, E7, S5, owner-reversible moderation (hold mechanism; policy pending). Implemented as directed, pending ratification: F1–F3, R4 ordering rules. Supported by existing approvals: F4 (V2-DEC-02), F5 (Blueprint §8.1).

## 6. Founder questions (not decided here)

**Ratification needed** for items implemented as directed: F1 (default visibility and consent rule), F2, F3, the moderation-hold rule, and the R4 ordering rules (in particular: is cancellation always final, and should exact-tie events wait for a reconciliation fetch?). F4 and F5 need confirmation only that the readings of V2-DEC-02 and Blueprint §8.1 are the intended ones.


* **F2a** Active legacy postings without pay stay visible until they are paused or expire (F2 as worded governs restoring them). Hide them immediately instead?
* **F6** Invitation allowance on a mid-cycle plan change: when the provider keeps the billing period (normal Stripe behaviour) the cycle's used invitations carry over under the new plan's allowance; a split period starts a fresh allowance. Proration is unapproved (Blueprint §6.2, §16.2) — choose one rule.
* **F7** Stripe `paused` subscriptions have no approved meaning; the handler should refuse and alert until one is chosen.

## 7. Readiness (separate verdicts)

| Category | Verdict | Basis |
|---|---|---|
| **Adapter integration** (building the real V2 adapter against this schema) | **NOT READY** (revised after independent review — see `INDEPENDENT_REVIEW_FINDINGS.md`) | Verified High defects: re-running 06 corrupts data and reverts 11 (D-1, D-2), 06 aborts on valid baseline data (D-4), a replacement subscription can be lost (E-1), and moderation can be evaded by republishing (C-1). Fix and re-verify first; R1 and R2 still block go-live. |
| **Staging** | **NOT READY** | Requires an isolated hosted Supabase branch with a Clerk development instance (R2, R3 remainder, R9), the webhook handler (R4), and the adapter changes (R1, R5, R8). |
| **Production** | **NOT READY — NOT AUTHORIZED** | No production run, credentials or deployment were used or are authorized. Disposable-database results alone are not evidence of production readiness. |
