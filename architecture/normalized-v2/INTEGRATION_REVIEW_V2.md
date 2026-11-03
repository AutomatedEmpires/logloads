# Normalized V2 — Contract-Alignment Integration Review (Phase 2)

**Status:** Database contract verified on disposable PostgreSQL 17 + PostGIS in GitHub Actions. **Not** verified on Supabase. Not a migration; nothing applied to any hosted database.
**Branch:** `test/normalized-v2-contract-alignment` (base `ec4bb66`, the verified Phase 1 baseline).
**Owner:** integration (Claude Ultra Agent 1). Gemini's handoff files are imported unmodified in `66561d1`; every change after that is a separate commit.

## 1. Provenance

| File (Gemini handoff, 2026-11-01 23:42 PST) | SHA-256 |
|---|---|
| `06_v2_contract_alignment.sql` | `e8016aec7d83e7221cdc36ac1a260d0eae5fa4384bd073db344e11035908be54` |
| `07_v2_contract_tests.sql` | `0bebb24586823c9b9304b07de06dd8f95bc6c7e40c1574b5ca3433addc4bc20e` |
| `GAP_AUDIT_V2_CONTRACTS.md` | `dd612234fd72bc5030dd0bc81959e5d466172dd7539e8daa05fbeccc82c01b62` |

Added by integration: `08_v2_contract_concurrency_test.sh`, `09_v2_integration_audit_tests.sql`, `10_v2_migration_path_test.sh`, this file, and the CI job.

## 2. CI layout (`.github/workflows/normalized-v2-ci.yml`)

* **Job 1 — baseline (unchanged suite):** 01 → 02 → 03 → 04 → 05 on its own fresh database (×3).
* **Job 2 — contract alignment:** 01 → 02 → 03 → **06** → 04 (aligned mode) → 07 → 09 → 08 → 10 on its own fresh database (×3).
  * 04 detects the aligned schema (attestation ledger present) and creates active jobs through `publish_job_posting`; its gate-code, missing-pay and seat-conflict negatives now require the intended constraint/message in both modes.
  * 08 and 10 build their own schema; 05 is never run after 06 (it would erase it).

## 3. Defects found by executing 06 on PostgreSQL 17 (all fixed)

| # | Defect in 06 as handed off | Evidence | Fix commit |
|---|---|---|---|
| E1 | RLS recursion: `interests_hauler_insert` → `hauler_profiles` → new `hauler_profiles_read` → `expressions_of_interest` ⇒ every direct inquiry insert failed with **42P17** | run 41478591364 | `29425dd` |
| E2 | Inquiry audit actions (`marketplace_interest_*`) violate `audit_events_action_check` ⇒ submit/update/renew/viewed/replied/declined all failed with **23514** | run 41478917784 | `b7ba0e3` |
| E3 | `submit_expression_of_interest` OUT column `interest_id` ambiguous with table columns (**42702**) ⇒ every changed-terms resubmission or renewal failed | run 41480889887 | `59ae8a8` |
| E4 | Boost auto-stop set status `'expired'` (not a `job_boosts` status) and shortened `ends_at` (violates the fixed-duration CHECK) ⇒ filling/pausing a boosted job failed | run 41481702859 | `10f5f28` |
| E5 | 02's `UPDATE (last_confirmed_at)` grant never revoked; 07's own V2-DEC-03 (e2) failed | run 41480100552 | `2dd63a2` (C8) |

## 4. Defects found by code review (fixed, each with a regression)

| # | Issue | Regression |
|---|---|---|
| C1 | Backfill fabricated `last_confirmed_at/by` for pre-existing non-draft jobs | 10 |
| C2 | Ordinary user could re-activate an unquoted, unattested legacy posting (V2-DEC-02/03 bypass) | 09 |
| C3 | Reconfirming a legacy posting silently kept the old confirmation | 09 |
| C4 | Legacy import authorized by deny-list; recorded the org creator as importer and confirmer | 09 |
| C5 | Public discovery RPCs (SECURITY DEFINER, anon) exposed paused/closed/**moderated** jobs beyond RLS; `get_marketplace_job` only searched the first 200 rows | 09 (205-job case) |
| C6 | `respond_to_interest` accepted `replied` without a message (TS contract requires one) | 09 |
| C8 | Authenticated could still write `last_confirmed_at` directly (02 grant not revoked) — same as E5 | 09, 07 |
| C7 | Same draft published twice concurrently could raise a raw unique violation | 08 A5 |
| C9 | `last_confirmed_by` (a user id) readable by anon | grants |
| S1 | Concurrent identical first inquiries collided on the unique index (23505) | 08 A2 |
| S4 | Inquiries accepted on jobs of **suspended** organizations | 09 |

Test-harness corrections in Gemini's 07 (no rule weakened): internal `approximate_point` called as an API role; `job_boosts` read as `service_role`; boost status `'expired'` → `'ended'`.

## 5. Gap verdicts (GAP_AUDIT §2)

| Gap | Verdict | Notes |
|---|---|---|
| GAP-01 truck counts & estimates | **PASS** | Drafts must also state truck demand (founder question F4). |
| GAP-02 duration / schedule note / access requirements | **PASS** | `work_ends_on` derived from start + duration. |
| GAP-03 per-inquiry equipment | **PASS after E2, E3, S1** | Units capped at the profile; `trucks_offered = Σ lines` (deferred constraint trigger). |
| GAP-04 / V2-DEC-01 public coordinates | **PASS** (handoff H2) | Server rounds half **away from zero**. |
| GAP-05 private hauler profiles | **PASS after E1** | Profiles now private by default (founder question F1). |
| GAP-06 / V2-DEC-02, 03 | **PASS after C1–C4, E5** | |
| GAP-07 discovery | **PASS after C5** | Per-row visibility function; see performance note R6. |
| GAP-08 inquiry lifecycle | **PASS after E2, E3, C6, S1** | Withdrawal clears private sharing; renewal does not restore it. |
| GAP-09 boost stop | **PASS after E4** | Status `ended`; purchased window unchanged. |
| GAP-10 port RPCs | **PARTIAL** | All RPCs exist; port needs an attestation argument (H1). |

## 6. Founder decisions

* **V2-DEC-01 — PASS.** Fixed 0.10° grid, server-only; session settings have no effect (tested); bounds enforced (22023); NULL point preserved; public RPCs return only the grid point (exact private point never returned, tested with an off-grid input). Midpoints: 47.65 → 47.7, −117.45 → −117.5, ±0.05 → ±0.1. JavaScript `Math.round(x*10)/10` gives −117.4 and 47.6 for those inputs, so the frontend must **not** re-round server values (H2).
* **V2-DEC-02 — PASS.** Positive amount + basis, or negotiable + ≥3-char note with no amount; zero/negative/missing rejected with the intended message and nothing written; enforced in the RPC, the guard trigger and a table CHECK; no session bypass (comment-proof check: no function reads any setting but JWT claims and `role`); drafts may omit pay; legacy imports superadmin-only and can no longer be re-activated (C2).
* **V2-DEC-03 — PASS.** NULL/false attestation rejected; direct active INSERT rejected; failed publication leaves no job or attestation; publisher and server timestamp recorded; drafts and edits never confirm; direct writes to `last_confirmed_at` denied (42501); reconfirmation advances confirmation and leaves `last_modified_at` unchanged, including under concurrency (08 A3); identical publish replays are idempotent (08 A1). The ledger has no FK to the job (avoids the job ⇄ attestation cycle); the guard trigger enforces "non-draft V2 job ⇒ ledger row", and both rows are written in one transaction.

## 7. Security observations

* **Identity:** every user RPC derives the actor from `current_user_id()` (trusted issuer, audience, expiry, `role = authenticated`); org/landing ids are inputs that are authorized server-side. Claims are only as trustworthy as Supabase's JWT verification — **not tested here** (R2).
* **service_role:** emulated `NOBYPASSRLS` with no table grants and no EXECUTE on V2 user RPCs (tested: publish as service_role ⇒ 42501). Real Supabase `service_role` **bypasses RLS**: a server client using the service key must never read or write marketplace tables directly for a user request, and V2 user RPCs called with it resolve no user and fail closed. Worker RPCs (`open_subscription_cycle`, `resolve_invitation_delivery`, `expire_stale_invitation_reservations`, `activate_job_boost`, `sync_verified_identity`) are the only service-role surface.
* **SECURITY DEFINER:** 56 functions, all with pinned `search_path`, none executable by PUBLIC; anon may execute only `contains_sensitive_access_pattern`, `job_is_publicly_visible`, `list_marketplace_jobs`, `get_marketplace_job`, `make_public_point`, `quantize_public_coordinate`, `search_job_postings`. Owner in CI is the bootstrap superuser; on Supabase the owner must be a non-login owner role (R3).
* **Tenant isolation (tested):** rival landing cannot read/respond to another org's inquiries, reconfirm or change its jobs; drivers and hauler-only owners get no publishing capability (a self-granted seat confers none); private landing details never appear in discovery.
* **Disclosure:** discovery RPCs now return non-active jobs only to callers RLS already allows.

## 8. MarketplaceV2Port → database mapping

All calls are made with the **user's** Supabase/Clerk JWT (PostgREST `rpc`), never the service key. "Viewer org" is the session's active organization.

| Port method | SQL | Identity / permission | Output → contract | Tx / idempotency |
|---|---|---|---|---|
| `listJobs(filters)` | `list_marketplace_jobs(p_query, p_equipment, p_pay_unit, p_accepting_only, p_org_id ⇒ null, p_point, p_radius_miles, p_max_sponsored, p_limit, p_job_id ⇒ null)` | anon or authenticated; visibility = job RLS | `MarketplaceJobCardView`: `trucks_total/trucks_per_day` → `trucks`, `estimated_*`, `pay_*` (+`pay_note`), `origin_label/state/lat/lng` (grid only), `est_one_way_miles` → `haulDistance` (poster estimate), `updated_at` → `lastModifiedAt`, `last_confirmed_at`, `expires_at`, `sponsored` | read-only |
| `getJob(id)` | `get_marketplace_job(id)` | as above | `MarketplaceJobDetailView` (+`public_road_notes`, `public_access_requirements`) | read-only |
| `viewerAccess(viewer)` | `get_viewer_marketplace_access(org)` | active member of org (else 42501) | `{organization_name, capabilities}` (same vocabulary as `marketplace-permissions.ts`) | read-only |
| `haulerEquipment(viewer)` | `list_hauler_equipment_options(org)` | `interest.express` | `configuration_key, label, units_listed` | read-only |
| `authoringLandings(viewer)` | `list_authoring_landings(org)` | `job.publish` | `id, name, area_label, state_code` | read-only |
| `interestForJob(viewer, job)` | `list_marketplace_interests(org, 'hauler', job)` (first row) | hauler capability | `MarketplaceInterestView` | read-only |
| `listHaulerInterests` / `listLandingInterests` | `list_marketplace_interests(org, 'hauler' \| 'landing')` | side capability | `MarketplaceInterestView[]` incl. equipment and replies | read-only |
| `expressInterest(viewer, input)` | `submit_expression_of_interest(org, job, trucks, equipment jsonb [{configurationKey,count}], from, until, message, contact)` | `interest.express`; job publicly visible | `(interest_id, created)`; re-read via the list RPC | one tx; per (job, hauler) advisory lock; identical resubmission no-op |
| `withdrawInterest` | `withdraw_interest(id)` | hauler member | — | idempotent; clears private sharing |
| `respondToInterest` | `respond_to_interest(id, decision, share_private ⇒ null, reply_id, body)` | landing desk of the job's org | — | replay-safe by `reply_id`; `replied` needs a body |
| `postHaulerReply` | `post_hauler_interest_reply(id, reply_id, body)` | hauler member; open inquiry | — | replay-safe by `reply_id` |
| `publishJob(viewer, draft)` | `publish_job_posting(... , p_attest_available ⇒ true, p_draft_job_id)` | `job.publish`; landing of the org; entitled plan | job id | one tx; identical-content replay returns the same id; draft row locked |
| `reconfirmJob(viewer, job)` | `reconfirm_job_posting(job)` | `job.publish`; active, unexpired job | new `last_confirmed_at` | one tx; strictly increasing |

Input mapping for `publishJob`: `payAmount` (dollars) → `p_pay_amount_cents` (×100, rounded), `durationDays`, `trucksRequested`, `trucksPerDay`, `estLoadsPerTruckPerDay`, `estDailyLoads`, `estTonsPerLoad`, `destinationLabel`, `estOneWayMiles`, `publicRoadNotes`, `description`, `product`, `equipment` → `p_equipment_codes`. `schedule_note` and `public_access_requirements` exist in SQL but not in the TS draft. `save_job_posting_draft` exists; the port has no draft-save method (UI drafts live in the URL).

## 9. Handoff to Codex (frontend-owned files — not modified here)

* **H1** `MarketplaceV2Port.publishJob` needs an explicit attestation argument (e.g. `publishJob(viewer, draft, { attestAvailable: true })`), passed as `p_attest_available`; the draft schema should require pay for publishing (V2-DEC-02).
* **H2** Display coordinates exactly as returned; never re-round server values in the browser. If a client-side snap is ever needed, round half away from zero on the decimal value, not `Math.round`.
* **H3** Map `replied` responses to always include a message (matches C6).
* **H4** Optional: a port method for server-side drafts (`save_job_posting_draft`), if drafts should survive across devices.

## 10. Risks

| Class | Item |
|---|---|
| BLOCKER (adapter go-live) | **R1** Port attestation argument (H1). **R2** Clerk → Supabase third-party JWT and `sync_verified_identity` onboarding path not exercised on Supabase. |
| REQUIRED | **R3** Run 01–10 on a Supabase branch/local stack (real `service_role BYPASSRLS`, `authenticator`, PostGIS 3.3.x, non-superuser function owner). **R4** Out-of-order billing webhooks (below). **R5** Frontend rounding (H2). |
| OPTIONAL | **R6** `list_marketplace_jobs` evaluates `can_read_job_posting` and text `position()` per row — index/plan review before real volume. **R7** Content-based publish dedup prevents two deliberately identical postings at one landing. |
| DEFERRED | Paid invitation packs (GAP-12); saved searches beyond existing tables (GAP-11). |

**R4 — out-of-order webhooks (not changed; financial semantics need approval).** `open_subscription_cycle` accepts any period, so a delayed older event rewinds `current_period_*`. Proposed remedy: persist the provider event id and event time per subscription (`unique(provider_event_id)`), ignore and audit events older than the latest applied one, and refuse period rewinds unless explicitly forced by an admin. Regression cases: deliver N+1 then N (state stays N+1); duplicate event id (no-op); `past_due` older than a newer `active` (ignored); concurrent N and N+1 (final state N+1).

## 11. Founder questions (not decided here)

* **F1** Hauler profiles are private by default in 06 (baseline: public). Recruiting reach vs consent — confirm.
* **F2** May a reconfirmed legacy posting with no stated pay keep running, or must reconfirmation require pay?
* **F3** Re-activating a paused V2 job keeps its last confirmation (shown with its age) rather than requiring a fresh attestation — confirm.
* **F4** Drafts must state truck demand; should fully incomplete drafts be allowed?
* **F5** (from Phase 1) A mid-cycle plan change consumes a founding-discount cycle.

## Phase 3 update

Phase 3 policy items F1–F5 (implemented as directed; approval status in `PHASE3_REVIEW.md` §2 — only V2-DEC-01..03 are recorded founder approvals), R4 (billing ordering), the Supabase local-stack verification, E6/E7/S5 and the updated risk register are in `PHASE3_REVIEW.md`; the adapter interface contract (H1–H3, F3, F4) is in `INTERFACE_CONTRACT_H1_H3.md`. The risk table above is superseded by `PHASE3_REVIEW.md` §5.
