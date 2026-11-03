# LogLoads Normalized V2 — Complete Schema-to-Product-Contract Gap Audit & Founder Decisions (`V2-DEC-01`..`03`)

**Date:** November 1, 2026  
**Status:** Founder Decisions `V2-DEC-01`, `V2-DEC-02`, and `V2-DEC-03` **APPROVED** and enforced in `06_v2_contract_alignment.sql` and `07_v2_contract_tests.sql`.  
**Scope:** Full comparison of the Normalized V2 SQL baseline (`01_schema.sql`, `02_access.sql`, `03_entitlements.sql`, `04_tests.sql`, `05_concurrency_test.sh`) against the live Marketplace V2 TypeScript contracts, services, frontend forms, `MarketplaceV2Port`, pilot adapter, and approved product decisions.  
**Deliverables in `architecture/normalized-v2/`:**
- [`06_v2_contract_alignment.sql`](file:///c:/Users/Cole0/AutomatedEmpires/Projects/logloads/architecture/normalized-v2/06_v2_contract_alignment.sql) — Additive, non-disruptive SQL migration/patch layer resolving every `BLOCKER` and `REQUIRED` schema, constraint, trigger, RLS, and RPC gap and enforcing `V2-DEC-01`..`03` on top of `01_schema.sql` → `02_access.sql` → `03_entitlements.sql`.
- [`07_v2_contract_tests.sql`](file:///c:/Users/Cole0/AutomatedEmpires/Projects/logloads/architecture/normalized-v2/07_v2_contract_tests.sql) — Deterministic, repeatable (`BEGIN ... ROLLBACK`, `ON_ERROR_STOP=1`) SQL verification suite exercising normal, invalid, unauthorized, and edge-case behavior across all gaps and all three founder decisions.
- [`GAP_AUDIT_V2_CONTRACTS.md`](file:///c:/Users/Cole0/AutomatedEmpires/Projects/logloads/architecture/normalized-v2/GAP_AUDIT_V2_CONTRACTS.md) (this document) — Complete gap matrix, approved founder decisions, frontend compatibility checklist, and implementation report.

> **Baseline Preservation & Verification Status:** Because Claude Agent 1 is concurrently validating `01_schema.sql`..`05_concurrency_test.sh` on PostgreSQL 17 in GitHub Actions, those five baseline files are left **untouched**. `06_v2_contract_alignment.sql` and `07_v2_contract_tests.sql` are statically verified against the baseline DDL and ready for Claude Agent 1's PostgreSQL 17 CI runner; they are not marked PostgreSQL-executed until that CI workflow completes.

---

## 1. Approved Founder Decisions (Binding Requirements — 2026-11-01)

| Decision ID | Status | Summary of Approved Requirement | Database Enforcement in `06_v2_contract_alignment.sql` |
|---|---|---|---|
| **`V2-DEC-01`** | **APPROVED** (2026-11-01) | **Public Coordinate Privacy — Fixed `0.10°` Grid:** Quantize all public landing-area coordinates server-side to the nearest `0.10°` increment (e.g. `47.654° → 47.7°`, `-117.457° → -117.5°`). Remove caller/session precision overrides (`app.public_coord_grid_degrees`). Preserve nullable public points, validate bounds (`[-90, 90]`, `[-180, 180]`), maintain V2 frontend `Math.round(coord * 50) / 50 === coord` compatibility (`0.10° = 5 × 0.02°`), and never expose or compute public distances from `landing_private_details.exact_point`. | `marketplace.quantize_public_coordinate`, `marketplace.make_public_point`, `marketplace.approximate_point` (hardcoded `round(coord::numeric, 1)::double precision`, zero `current_setting` reads), `landings_public_point_quantized_chk` on `marketplace.landings`, and quantized output/distance calculations in `list_marketplace_jobs`, `get_marketplace_job`, and `search_job_postings`. |
| **`V2-DEC-02`** | **APPROVED** (2026-11-01) | **Required Compensation Information:** Every newly published active V2 job must have either a positive stated rate (`pay_amount_cents > 0`) with a defined `MarketplacePayUnit`, or `pay_unit = 'negotiable'` with `pay_amount_cents IS NULL` and a `>= 3` non-whitespace character `pay_note`. Incomplete drafts may be saved only as `status = 'draft'`. Remove `app.allow_unquoted_active_jobs` session bypass. Preserve historical unquoted records via a separately privileged, audited migration path. | Table `CHECK` constraint `job_postings_compensation_chk`, trigger `marketplace.tg_job_guard()` (no session bypass), draft RPC `marketplace.save_job_posting_draft`, ungranted ledger table `marketplace.legacy_job_imports`, and `superadmin`-only audited RPC `marketplace.admin_import_legacy_job_posting`. |
| **`V2-DEC-03`** | **APPROVED** (2026-11-01) | **Explicit Initial Availability Attestation:** A newly published V2 job receives server-assigned `last_confirmed_at` only when its authorized publisher explicitly attests availability (`p_attest_available = true` in `publish_job_posting`). Absent (`NULL`) or `false` attestation is rejected. Drafts, previews, and ordinary edits never stamp or refresh `last_confirmed_at`. Direct SQL writes cannot bypass attestation or spoof `last_confirmed_at`. Repeated identical publish calls are idempotent. | Ungranted ledger table `marketplace.job_publication_attestations`, table `CHECK` constraint `job_postings_attestation_chk`, column-privilege revocation of `INSERT`/`UPDATE (last_confirmed_at, last_confirmed_by, published_at, is_legacy_import)` from `authenticated`/`anon`, `marketplace.publish_job_posting` (`p_attest_available is true` required + landing lock + idempotent deduplication), `marketplace.reconfirm_job_posting`, and orthogonal timestamp handling in `marketplace.tg_set_updated_at()`. |

---

## 2. Complete Schema-to-Contract Gap Matrix

| ID | Domain / Contract Surface | V2 Application Contract / Requirement | Baseline SQL State (`01_schema.sql`..`03_entitlements.sql`) | Classification | Resolution in `06_v2_contract_alignment.sql` |
|---|---|---|---|---|---|
| **GAP-01** | **Job Truck Counts & Volume Estimates** (`marketplace-v2.ts`, `marketplace-job-draft.ts`, `JobDraftForm.tsx`, `JobCard.tsx`, `mapping.ts`) | Separate fields for: (a) job-wide `trucks.total` (`trucksRequested`, nullable on migrated pilot jobs where only daily trucks are known), (b) `trucks.perDay` (`trucksPerDay`, 1..9999, `<= trucksRequested`), (c) `estimatedLoadsPerTruckPerDay` (`0.5..24.0`), (d) `estimatedDailyLoads` (`1..500`), and (e) `estimatedTonsPerLoad` (`0.1..100.0`). | `job_postings` only had `trucks_requested integer not null default 1`, `est_daily_loads`, and `est_tons_per_load`. Missing `trucks_per_day`, missing `est_loads_per_truck_per_day`, and `trucks_requested NOT NULL` forced migrated pilot listings to fabricate a job-wide truck count. | **`BLOCKER`** | Added `trucks_per_day` and `est_loads_per_truck_per_day` to `marketplace.job_postings`; dropped `NOT NULL` on `trucks_requested`; added `job_postings_truck_demand_chk` (`(trucks_requested is not null or trucks_per_day is not null) and (trucks_per_day <= trucks_requested)`). |
| **GAP-02** | **Job Schedule Duration, Schedule Note, & Access Requirements** (`marketplace-job-draft.ts`, `marketplace-v2.ts`, `mapping.ts`) | `MarketplaceJobDraft` collects `startsOn` + `durationDays` (`1..365`, requiring `startsOn`) and computes `endsOn` (`draftEndsOn`); `MarketplaceJobCardView` exposes `scheduleNote`; `MarketplaceJobDetailView` exposes `publicAccessRequirements: string[]`. | `job_postings` had `work_starts_on` and `work_ends_on`, but no `duration_days`, no `schedule_note`, and no `public_access_requirements`. | **`BLOCKER`** | Added `duration_days`, `schedule_note`, and `public_access_requirements text[]` to `marketplace.job_postings`; added `job_postings_duration_start_chk` and `job_postings_access_reqs_safe_chk`; updated `tg_job_guard()` to auto-compute `work_ends_on := work_starts_on + (duration_days - 1)`. |
| **GAP-03** | **Per-Inquiry Offered Equipment & Hauler Equipment Configurations** (`marketplace-v2.ts`, `marketplace-interest.ts`, `pilot-adapter.ts`, `work/[jobId]/page.tsx`) | Haulers select offered quantities per equipment configuration (`configurationKey`, e.g., `"log_truck\|pole_trailer"`, `label: "Log truck + Pole trailer"`, `count`) from their own profile (`listHaulerEquipmentOptions`), excluding `maintenance`/`inactive` units. Inquiries snapshot `{ configurationKey, label, count }[]` (max 20 lines) and derive `trucksOffered = sum(count)`. | `expressions_of_interest` only stored scalar `trucks_offered integer`. No table or column persisted offered equipment types/counts per inquiry. `equipment_units` lacked `paired_trailer_code`, `operational_status`, `unit_count`, and `configuration_key`. | **`BLOCKER`** | Added `paired_trailer_code`, `operational_status`, `unit_count`, and generated `configuration_key` to `marketplace.equipment_units`; created `marketplace.expression_of_interest_equipment` with deferrable constraint trigger `tg_eoi_equipment_consistency()` (`count <= 20`, `sum(unit_count) = trucks_offered`); added `list_hauler_equipment_options(uuid)` and `submit_expression_of_interest(...)`. |
| **GAP-04** (`V2-DEC-01`) | **Public Coordinate Rounding & Geographic Disclosure** (`apps/web/lib/network.ts`, `JobMap.tsx`, `mapping.test.ts`, `02_access.sql`) | Approved `V2-DEC-01`: Fixed `0.10°` quantization (`round(coord::numeric, 1)`, e.g. `47.654° → 47.7°`, `-117.457° → -117.5°`), compatible with `Math.round(coord * 50) / 50 === coord` (`0.10° = 5 × 0.02°`), nullable `public_point`, bounds validation, no session override, and zero disclosure of `landing_private_details.exact_point`. | `02_access.sql`'s `marketplace.approximate_point` used `floor(coord / 0.1) * 0.1 + 0.05`, producing `.05, .15, .25` that failed `Math.round(coord * 50) / 50 === coord` and shifted `47.654°` to `47.65°` instead of `47.7°`. Also `landings.public_point` was `NOT NULL`. | **`BLOCKER`** | Implemented `quantize_public_coordinate`, `make_public_point`, and fixed `0.10°` `approximate_point`; removed `app.public_coord_grid_degrees`; made `landings.public_point` nullable; added `landings_public_point_quantized_chk`; exposed quantized `origin_lat`/`origin_lng` in `list_marketplace_jobs`. |
| **GAP-05** | **Hauler Org Identity, Optional Public Profiles (`is_public = false`), & Pure-Hauler Owner Seat** (`marketplace-permissions.ts`, `marketplace-access.test.ts`, `marketplace-interest.test.ts`, `01_schema.sql`, `02_access.sql`) | (1) `hauler_profiles.is_public` controls opt-in visibility in the "Find Trucks" recruiter directory; haulers with `is_public = false` and/or 0 listed equipment units must still be able to express interest in jobs. (2) Once a private hauler submits an inquiry, the job's landing org must be able to view that hauler's profile. (3) Pure hauler/fleet org owners have `landingWorkspaceSeat: false`. | (1) `interests_hauler_insert` in `02_access.sql` required `and h.is_public`, blocking private haulers from inquiring. (2) `hauler_profiles_read` blocked the landing org from reading an inquiring hauler's profile when `is_public = false`. (3) `organization_memberships` and `create_organization` forced `landing_workspace_seat = true` on all `owner` rows. | **`BLOCKER`** | Removed `and h.is_public` from `interests_hauler_insert`; expanded `hauler_profiles_read` so the target landing org can read `hauler_profiles` for any non-withdrawn inquiry on its jobs; relaxed owner seat check so pure hauler owners have `landing_workspace_seat = false` until a landing or landing subscription is added (`tg_ensure_owner_landing_seat`). |
| **GAP-06** (`V2-DEC-02` & `V2-DEC-03`) | **Mandatory Active Compensation & Explicit Availability Attestation vs. Edits** (`marketplace-v2.ts`, `marketplace-job-draft.ts`, `02_access.sql`) | Approved `V2-DEC-02` & `V2-DEC-03`: Active jobs require positive pay + unit or Negotiable + 3+ char note (no session bypass) and explicit `p_attest_available = true` on publish. Drafts remain `status = 'draft'` with `NULL` confirmation. Ordinary edits update `updated_at` (`last_modified_at`) and never refresh `last_confirmed_at`; explicit `reconfirm_job_posting` advances `last_confirmed_at` and preserves `updated_at`. | `02_access.sql` allowed `app.allow_unquoted_active_jobs = 'true'` to bypass pay rules, had no attestation check on publish, and automatically stamped `new.last_confirmed_at := now()` on ordinary edits to `pay_amount_cents`, `pay_unit`, `trucks_requested`, `work_starts_on`, or `work_ends_on`. | **`BLOCKER`** | Added `job_publication_attestations`, `legacy_job_imports`, `job_postings_compensation_chk`, `job_postings_attestation_chk`, `save_job_posting_draft`, `publish_job_posting` (`p_attest_available is true`), `reconfirm_job_posting`, `admin_import_legacy_job_posting`, and updated `tg_job_guard()` and `tg_set_updated_at()`. |
| **GAP-07** | **Discovery Filtering, Text Search, & Freshness Ordering** (`marketplace-v2.ts`, `pilot-adapter.ts`, `03_entitlements.sql`) | `listJobs(filter)` filters by `acceptingOnly` (`true`/`false`), `equipment` (code OR human label), `payUnit`, and `query` (across title, poster name, product, origin label, destination label, and equipment code/label), and orders by `lastConfirmedAt IS NOT NULL DESC` (confirmed ahead of unconfirmed), then `coalesce(lastConfirmedAt, lastModifiedAt) DESC`, then `title ASC`. | `search_job_postings` in `03_entitlements.sql` hardcoded `j.status = 'active'`, omitted 13 required `MarketplaceJobCardView`/`DetailView` columns, searched only `title \|\| product \|\| description`, and ordered by `r.last_confirmed_at DESC` (`NULLS FIRST`, ranking unconfirmed jobs above confirmed jobs). | **`BLOCKER`** | Added `marketplace.list_marketplace_jobs(...)` and `marketplace.get_marketplace_job(uuid)`, and updated `marketplace.search_job_postings(...)` to enforce `NULLS LAST` on `last_confirmed_at`. |
| **GAP-08** | **Inquiry Lifecycle: Idempotent Resubmission, Renewal After Withdrawal, Declined Lock, Viewed Timestamp, & Reply Idempotency** (`marketplace-interest.ts`, `marketplace-interest.test.ts`, `02_access.sql`, `03_entitlements.sql`) | (1) Re-submitting identical inquiry terms is a no-op (`created: false`). (2) Updating terms updates in place. (3) Re-submitting after `withdrawn` renews the existing record back to `'submitted'`. (4) `status = 'declined'` locks the inquiry against hauler edits and new messages from either side. (5) Marking `'viewed'` does *not* set `respondedAt`. (6) Both landing and hauler replies carry a client `replyId` (`uuid`) for idempotent retry and enforce a 2,000-character limit and 200-message thread cap. | (1) Direct `INSERT` threw `23505` on duplicate `(job_id, hauler_org_id)`. (2) `interests_hauler_edit` blocked renewing `'withdrawn'` rows and allowed editing `'declined'` rows. (3) `can_access_interest` allowed messaging on `'declined'` inquiries. (4) `respond_to_interest` stamped `responded_at = now()` on `'viewed'` and did not accept `p_reply_id`/`p_body`. (5) `interest_messages` did not grant `INSERT (id)` to `authenticated` and allowed 4,000 chars. | **`BLOCKER`** | Added `submit_expression_of_interest`, replaced `respond_to_interest` (with `p_reply_id`, `p_body`, and `responded_at` only on `'replied'`/`'declined'`), added `post_hauler_interest_reply`, tightened `can_access_interest` and `interests_hauler_edit` to block `'declined'`, granted `INSERT (id)` on `interest_messages`, and tightened `interest_messages_body_check` to `1..2000`. |
| **GAP-09** | **Sponsored Boost Auto-Expiry When Job Leaves Active Status** (`LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md` §9.16, `01_schema.sql`, `02_access.sql`) | Pausing, filling, closing, or expiring a boosted job must immediately stop/expire its active boost so inactive jobs never consume sponsored slots. | `job_boosts` remained `status = 'active'` when `job_postings.status` changed to `'paused'`, `'filled'`, `'closed'`, or `'expired'`. | **`REQUIRED`** | Added `AFTER UPDATE OF status` trigger `job_after_status` (`marketplace.tg_job_after_status()`) on `marketplace.job_postings` and `marketplace.set_job_posting_status(uuid, text)`. |
| **GAP-10** | **Viewer Access & Inquiry Thread Read-Model RPCs** (`MarketplaceV2Port` in `apps/web/lib/marketplace-v2/port.ts`) | `MarketplaceV2Port` requires RPCs for `viewerAccess`, `authoringLandings`, `haulerEquipment`, `publishJob`, `reconfirmJob`, `listJobs`, `getJob`, `expressInterest`, `withdrawInterest`, `respondToInterest`, `replyToInterest`, and `list_marketplace_interests` (with safe display-name join on `app_users`). | Missing V2 port RPCs in `03_entitlements.sql`. | **`REQUIRED`** | Implemented all V2 port RPCs in `06_v2_contract_alignment.sql`. |
| **GAP-11** | **Saved Jobs & Saved Recruiting Searches** (`LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md` §6.3, §6.2) | Haulers can save jobs (`saved_jobs`) and Pro/Regional landing operators can save truck searches (`saved_searches`). | Tables and RLS policies already exist in `01_schema.sql` and `02_access.sql`. | **`OPTIONAL`** | Already supported in `01_schema.sql` / `02_access.sql`. |
| **GAP-12** | **Additional Paid Invitation Packs** (`LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md` §5, `AGENTS.md` §1.4) | Deferred until hauler density and commercial terms are approved. | Excluded by design. | **`DEFERRED`** | Keep deferred per `AGENTS.md` §1.4. |

---

## 3. Frontend Contract & UI Compatibility Checklist (Required Before Enabling Normalized Publishing)

To align the Next.js V2 frontend and TypeScript contracts with Founder Decisions `V2-DEC-01`, `V2-DEC-02`, and `V2-DEC-03`, Claude Code should apply the following targeted updates in its application ownership lane before switching `MarketplaceV2Port` to the normalized adapter:

- [ ] **1. Enforce Mandatory Compensation in `marketplaceJobDraftSchema` (`V2-DEC-02`):**
  - **File:** [`packages/contracts/src/marketplace-job-draft.ts`](file:///c:/Users/Cole0/AutomatedEmpires/Projects/logloads/packages/contracts/src/marketplace-job-draft.ts) (lines 54–78)
  - **Change:** Make `payUnit: marketplacePayUnitSchema` required for publishable job drafts (rather than `.optional()`). If a separate loose schema is desired for saving in-progress drafts (`save_job_posting_draft`), export `marketplaceJobSavedDraftSchema` (allowing `payUnit?: undefined` and `payAmount?: undefined`) distinct from `marketplaceJobDraftSchema` (which validates publishable jobs and rejects `payUnit === undefined`).
  - **UI File:** [`apps/web/components/v2/JobDraftForm.tsx`](file:///c:/Users/Cole0/AutomatedEmpires/Projects/logloads/apps/web/components/v2/JobDraftForm.tsx) — remove the `"Pay not stated"` / blank option from the publish flow (or label it clearly as draft-only) and require selecting either a stated rate + basis (`per_load`, `per_ton`, `per_mile`, `per_hour`, `per_day`, `per_mbf`, `per_cord`, `flat_rate`, `other`) or `negotiable` with a 3+ character `payNote`.

- [ ] **2. Add Explicit Availability Attestation to the Publish Flow (`V2-DEC-03`):**
  - **Files:**
    - [`packages/contracts/src/marketplace-job-draft.ts`](file:///c:/Users/Cole0/AutomatedEmpires/Projects/logloads/packages/contracts/src/marketplace-job-draft.ts)
    - [`apps/web/components/v2/JobDraftForm.tsx`](file:///c:/Users/Cole0/AutomatedEmpires/Projects/logloads/apps/web/components/v2/JobDraftForm.tsx) / [`apps/web/app/v2/landing/jobs/preview/page.tsx`](file:///c:/Users/Cole0/AutomatedEmpires/Projects/logloads/apps/web/app/v2/landing/jobs/preview/page.tsx)
    - [`apps/web/lib/marketplace-v2/port.ts`](file:///c:/Users/Cole0/AutomatedEmpires/Projects/logloads/apps/web/lib/marketplace-v2/port.ts) & [`apps/web/lib/marketplace-v2/actions.ts`](file:///c:/Users/Cole0/AutomatedEmpires/Projects/logloads/apps/web/lib/marketplace-v2/actions.ts)
    - [`apps/web/lib/marketplace-v2/pilot-adapter.ts`](file:///c:/Users/Cole0/AutomatedEmpires/Projects/logloads/apps/web/lib/marketplace-v2/pilot-adapter.ts)
  - **Changes:**
    1. Add an explicit, unchecked-by-default checkbox on the Publish / Preview confirmation step (e.g., *"I confirm this hauling opportunity is currently available at this landing"* → `attestAvailable: z.literal(true)`).
    2. Pass `attestAvailable: boolean` through `publishJobAction` → `MarketplaceV2Port.publishJob(viewer, draft, { attestAvailable: true })` → `marketplace.publish_job_posting(..., p_attest_available => true)`.
    3. Update `pilot-adapter.ts` (`publishedJobToListing` / `publishJob`) so that when `attestAvailable === true`, the newly published job records `lastConfirmedAt = now` (matching `marketplace.publish_job_posting`), while `previewMarketplaceJob` continues to return `lastConfirmedAt: null`.

- [ ] **3. Align Frontend Public Coordinate Helper with the `0.10°` Grid (`V2-DEC-01`):**
  - **Files:**
    - [`apps/web/lib/network.ts`](file:///c:/Users/Cole0/AutomatedEmpires/Projects/logloads/apps/web/lib/network.ts) (`roundPublicCoordinate`)
    - [`apps/web/components/v2/JobMap.tsx`](file:///c:/Users/Cole0/AutomatedEmpires/Projects/logloads/apps/web/components/v2/JobMap.tsx)
  - **Changes:**
    - Update `roundPublicCoordinate(value: number)` in `apps/web/lib/network.ts` from `Math.round(value * 50) / 50` (`0.02°`) to `Math.round(value * 10) / 10` (`0.10°`).
    - Note that because every `0.10°` increment is an exact multiple of `0.02°` (`5 × 0.02° = 0.10°`), existing assertions of the form `Math.round(coord * 50) / 50 === coord` in [`apps/web/lib/marketplace-v2/mapping.test.ts`](file:///c:/Users/Cole0/AutomatedEmpires/Projects/logloads/apps/web/lib/marketplace-v2/mapping.test.ts) continue to pass without breaking, and can additionally assert `Math.round(coord * 10) / 10 === coord`.

---

## 4. Concise Implementation Report (`06_v2_contract_alignment.sql` & `07_v2_contract_tests.sql`)

### 4.1 Added & Modified Tables and Columns
1. **`marketplace.job_postings` (altered):**
   - `trucks_requested` altered to `DROP NOT NULL`, `DROP DEFAULT`.
   - Added `trucks_per_day integer CHECK (trucks_per_day BETWEEN 1 AND 9999)`.
   - Added `duration_days integer CHECK (duration_days BETWEEN 1 AND 365)`.
   - Added `est_loads_per_truck_per_day numeric(4, 1) CHECK (est_loads_per_truck_per_day >= 0.5 AND est_loads_per_truck_per_day <= 24.0)`.
   - Added `schedule_note text CHECK (char_length(schedule_note) <= 240 AND NOT marketplace.contains_sensitive_access_pattern(schedule_note))`.
   - Added `public_access_requirements text[] NOT NULL DEFAULT '{}'`.
   - Added `last_confirmed_by uuid REFERENCES marketplace.app_users (id)`.
   - Added `is_legacy_import boolean NOT NULL DEFAULT false`.
2. **`marketplace.job_publication_attestations` (new internal ungranted ledger table for `V2-DEC-03`):**
   - `(job_id uuid PRIMARY KEY, org_id uuid, attested_by uuid, attested_at timestamptz, reconfirmed_at timestamptz, reconfirmed_by uuid, confirmation_seq bigint)`.
   - RLS enabled; all privileges revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`.
3. **`marketplace.legacy_job_imports` (new internal ungranted ledger table for `V2-DEC-02` & `V2-DEC-03`):**
   - `(job_id uuid PRIMARY KEY, org_id uuid, imported_by uuid, reason text, imported_at timestamptz)`.
   - RLS enabled; all privileges revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`.
4. **`marketplace.landings` (altered for `V2-DEC-01`):**
   - `public_point` altered to `DROP NOT NULL`.
5. **`marketplace.equipment_units` (altered for Known Gap 2):**
   - Added `paired_trailer_code text REFERENCES marketplace.equipment_types (code)`.
   - Added `operational_status text NOT NULL DEFAULT 'available' CHECK (operational_status IN ('available', 'committed', 'maintenance', 'inactive'))`.
   - Added `unit_count integer NOT NULL DEFAULT 1 CHECK (unit_count BETWEEN 1 AND 500)`.
   - Added `configuration_key text GENERATED ALWAYS AS (...) STORED`.
6. **`marketplace.expression_of_interest_equipment` (new table for Known Gap 2):**
   - `(interest_id uuid, configuration_key text, label text, unit_count integer, sort_order smallint, PRIMARY KEY (interest_id, configuration_key))`.

### 4.2 Added & Replaced Constraints and Indexes
- `job_postings_truck_demand_chk`: `(trucks_requested IS NOT NULL OR trucks_per_day IS NOT NULL) AND (trucks_per_day IS NULL OR trucks_requested IS NULL OR trucks_per_day <= trucks_requested)`.
- `job_postings_duration_start_chk`: `duration_days IS NULL OR work_starts_on IS NOT NULL`.
- `job_postings_access_reqs_safe_chk`: `cardinality(public_access_requirements) <= 20 AND NOT marketplace.contains_sensitive_access_pattern(...)`.
- `job_postings_compensation_chk` (`V2-DEC-02`): Enforces positive rate + basis or `'negotiable'` + `>= 3` char trimmed `pay_note` on all non-draft, non-legacy rows.
- `job_postings_attestation_chk` (`V2-DEC-03`): Enforces `published_at IS NULL AND last_confirmed_at IS NULL AND last_confirmed_by IS NULL` on `'draft'` rows, and `published_at IS NOT NULL AND last_confirmed_at IS NOT NULL AND last_confirmed_by IS NOT NULL` on all non-draft V2 rows (`NOT is_legacy_import`).
- `landings_public_point_quantized_chk` (`V2-DEC-01`): Enforces bounds `[-90, 90]` / `[-180, 180]` and exact `0.10°` quantization on `landings.public_point`.
- `interest_messages_body_check`: Enforces `char_length(btrim(body)) BETWEEN 1 AND 2000`.
- `expressions_of_interest_job_hauler_uq`: Canonical unique index on `(job_id, hauler_org_id)`.

### 4.3 Updated RLS Policies
- `interests_hauler_insert` on `marketplace.expressions_of_interest` (allows haulers with `is_public = false` to express interest).
- `interests_hauler_edit` on `marketplace.expressions_of_interest` (blocks edits to `'withdrawn'` and `'declined'` inquiries).
- `hauler_profiles_read` on `marketplace.hauler_profiles` (grants landing operators read access to an inquiring hauler's profile even when `is_public = false`).
- `eoi_equipment_read` and `eoi_equipment_write` on `marketplace.expression_of_interest_equipment`.

### 4.4 Added & Updated Functions and Triggers (18 functions)
1. `marketplace.quantize_public_coordinate(double precision, double precision, double precision, text)` (`V2-DEC-01`)
2. `marketplace.make_public_point(double precision, double precision)` (`V2-DEC-01`)
3. `marketplace.approximate_point(extensions.geography)` (`V2-DEC-01`)
4. `marketplace.tg_eoi_equipment_consistency()` + constraint trigger `eoi_equipment_consistency`
5. `marketplace.tg_membership_guard()`
6. `marketplace.create_organization(text, text, char(2), boolean)`
7. `marketplace.tg_ensure_owner_landing_seat()` + trigger `ensure_owner_landing_seat_on_sub`
8. `marketplace.tg_set_updated_at()` (`V2-DEC-03` orthogonal timestamp preservation)
9. `marketplace.tg_job_guard()` (`V2-DEC-02` & `V2-DEC-03` enforcement)
10. `marketplace.tg_job_after_status()` + trigger `job_after_status`
11. `marketplace.can_access_interest(uuid, text)`
12. `marketplace.get_viewer_marketplace_access(uuid)`
13. `marketplace.list_authoring_landings(uuid)`
14. `marketplace.list_hauler_equipment_options(uuid)`
15. `marketplace.save_job_posting_draft(...)` (`V2-DEC-02` & `V2-DEC-03`)
16. `marketplace.publish_job_posting(...)` (`V2-DEC-02` & `V2-DEC-03`)
17. `marketplace.reconfirm_job_posting(uuid)` (`V2-DEC-03`)
18. `marketplace.admin_import_legacy_job_posting(...)` (`V2-DEC-02` & `V2-DEC-03`)
19. `marketplace.set_job_posting_status(uuid, text)`
20. `marketplace.list_marketplace_jobs(...)`, `marketplace.get_marketplace_job(uuid)`, and `marketplace.search_job_postings(...)`
21. `marketplace.submit_expression_of_interest(...)`, `marketplace.respond_to_interest(...)`, `marketplace.post_hauler_interest_reply(...)`, and `marketplace.list_marketplace_interests(...)`

### 4.5 Test Assertions in `07_v2_contract_tests.sql` (50 assertions)
- **Workspace Identity & Optional Public Hauler Profiles (`Gap 4a–4f`):** 6 assertions.
- **Public Coordinate Privacy (`V2-DEC-01 a–e3`):** 11 assertions (`47.654° → 47.7°`, `-117.457° → -117.5°`, positive/negative/boundary values, 5 out-of-bounds `22023` rejections + zero-mutation check, `app.public_coord_grid_degrees` session override immunity, nullable `public_point`, cross-org and `anon` isolation on `landing_private_details`).
- **Required Compensation (`V2-DEC-02 a1–a9, c1–c3, d2, f1–f2`):** 15 assertions (`per_load`, `per_ton`, `per_hour`, `negotiable` with note; rejections for missing pay, amount without unit, unit without amount, zero amount, negative amount, negotiable without note, whitespace note, `<3` char note, negotiable with fixed amount, `app.allow_unquoted_active_jobs` override immunity, incomplete draft isolation, unauthorized legacy import rejection `42501`, and audited `superadmin` legacy unquoted import).
- **Explicit Availability Attestation & Confirmation (`V2-DEC-03 b1–b6, c4–c6, d1, e1–e3, f3`):** 14 assertions (rejection of `NULL` attestation, rejection of `false` attestation, rejection of direct SQL `INSERT` with `status = 'active'`, rejection of unauthorized driver and cross-org publisher, zero partial rows after failures, `set_job_posting_status` draft activation block, attested draft promotion + audit attribution, idempotent duplicate `publish_job_posting` replay, content edit advancing `updated_at` without touching `last_confirmed_at`, column-privilege denial `42501` on direct `UPDATE` of `last_confirmed_at`, monotonic `reconfirm_job_posting` advancing `last_confirmed_at` while preserving `last_modified_at`, and confirmed-first discovery ordering).
- **Per-Inquiry Equipment, Withdrawal/Renewal, Idempotent Replies, Declined Lock, & Boost Auto-Expiry (`Gap 2a–2d`, `Lifecycle 4g–4m`):** 11 assertions.
