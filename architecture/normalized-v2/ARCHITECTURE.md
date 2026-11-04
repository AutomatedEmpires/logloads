# LogLoads Normalized v2 — Database & Account Architecture Reference

> **Status:** Non-active prototype (`architecture/normalized-v2/`). Not an approved production migration.  
> **Runtime Verification Status (Item 10):** Static DDL/RLS/contract verification is complete; **live PostgreSQL execution, RLS runtime enforcement, and multi-session concurrency behavior remain UNVERIFIED** because no disposable PostgreSQL 15+ instance (`postgres.exe`, `psql.exe`, `supabase.exe`, or `docker.exe`) is installed on this Windows 11 workstation.  
> **Governing authorities:** [`docs/product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md`](../../docs/product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md), [`docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md`](../../docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md), [`docs/product/TRANSITION_PLAN.md`](../../docs/product/TRANSITION_PLAN.md), [`packages/contracts/src/membership.ts`](../../packages/contracts/src/membership.ts), and [`packages/contracts/src/marketplace-v2.ts`](../../packages/contracts/src/marketplace-v2.ts).

---

## 1. Reconciled Object Inventory & File Layout

All prototype objects live in the dedicated `marketplace` PostgreSQL schema (with PostGIS and `btree_gist` in `extensions`) so they cannot collide with pilot-era `public` tables or `public.operating_state`:

| File | Object definitions | Responsibility |
|---|---|---|
| [`01_schema.sql`](./01_schema.sql) | **32 `CREATE TABLE`**, **0 `CREATE VIEW`**, **38 explicit `CREATE [UNIQUE] INDEX`**, **2 `CREATE FUNCTION`** (`contains_sensitive_access_pattern`, `current_user_id`), **2 `CREATE SCHEMA`**, **2 `CREATE EXTENSION`** | Normalized relational tables, `landing_workspace_seat` separation, composite tenant foreign keys, PostGIS geography columns, GiST exclusion constraints, public-text coordinate/gate-code checks, pay transparency constraints, and indexes. |
| [`02_access.sql`](./02_access.sql) | **22 `CREATE FUNCTION`** (13 helpers + 9 trigger functions), **27 triggers** (18 `set_updated_at` in `DO` loop + 9 explicit `CREATE TRIGGER`), **64 `CREATE POLICY`**, RLS enabled on all 32 tables | Non-recursive RLS helpers, paid-landing vs. free-fleet seat checks, seat/landing downgrade conflict guards, row-level security policies across all 32 tables, and column-scoped privilege grants. |
| [`03_entitlements.sql`](./03_entitlements.sql) | **20 `CREATE FUNCTION`**, catalog `INSERT` seeds (`equipment_types`, `subscription_plans`, `boost_products`), explicit `REVOKE`/`GRANT EXECUTE` | Concurrency-safe invitation reservation, failed-delivery refund & stuck-reservation reaper, non-destructive billing-cycle transitions (`open_subscription_cycle`), explicit conflict inspection (`get_org_entitlement_state`), founding-cohort & hauler-badge caps, audited admin RPCs, and sponsored search. |
| [`04_tests.sql`](./04_tests.sql) | Repeatable `BEGIN ... ROLLBACK` SQL integration test suite (`pg_temp` helpers + 8 multi-assertion test blocks) | Exercises schema inventory, strict Clerk JWT claim checks, composite FKs, multi-org users, free fleet vs. paid landing seats, explicit downgrade conflict & recovery, RLS tenant isolation, public/private location split, invitation quotas/recovery, cycle rollover, promotions, and boosts. |
| [`05_concurrency_test.ps1`](./05_concurrency_test.ps1) | Genuine multi-session parallel `psql` concurrency test harness (synchronized via `pg_sleep_until(barrier_ts)`) | Spawns parallel `psql` worker processes across 4 genuine two-connection races: final invitation credit, simultaneous multi-channel failure callbacks, stale reservation reaper vs. late webhook, and concurrent billing-cycle creation. |

**Total `marketplace` schema objects:** **32 tables**, **0 views**, **44 functions** (`2 + 22 + 20`), **27 triggers**, **64 RLS policies**, and **38 explicit indexes** (plus inline PK/UNIQUE/EXCLUDE constraints).

### Clarification: `landings_public` and `job_postings_public` Are RLS Policies, Not Views (Item 7)

The `marketplace` schema contains **0 SQL views (`CREATE VIEW`)**. All `*_public` identifiers in [`02_access.sql`](./02_access.sql) are **PostgreSQL Row-Level Security (`CREATE POLICY ... FOR SELECT TO anon`) policies** attached directly to the base tables and paired with column-scoped `GRANT SELECT (...) TO anon` privileges:

| Policy name (`02_access.sql`) | Object kind | Target base table | Anonymous (`anon`) column grant scope |
|---|---|---|---|
| `organizations_public` | RLS `FOR SELECT TO anon` policy | `marketplace.organizations` | `id, display_name, slug, home_state, verification_status, status` (only where `status = 'active'`) |
| `landings_public` | RLS `FOR SELECT TO anon` policy | `marketplace.landings` | `id, org_id, name, status, public_area_label, public_point, state_code, county` (only where `status = 'active'` and org is `active`; `landing_private_details` has zero `anon` grant/policy) |
| `job_postings_public` | RLS `FOR SELECT TO anon` policy | `marketplace.job_postings` | Public listing columns only (`created_by`, `created_at`, `updated_at`, `search_document` excluded; only where `job_is_publicly_visible(id)`) |
| `job_equipment_public` | RLS `FOR SELECT TO anon` policy | `marketplace.job_posting_equipment` | `job_id, equipment_code` for publicly visible active jobs |
| `plans_public` / `boost_products_public` | RLS `FOR SELECT TO anon` policies | `marketplace.subscription_plans`, `marketplace.boost_products` | Active catalog rows (`status = 'active'`) |

---

## 2. Exact Alignment with `packages/contracts/` & Product Specifications

| Rule / Contract (`membership.ts` & `marketplace-v2.ts`) | Prototype representation (`01_schema.sql` – `03_entitlements.sql`) |
|---|---|
| `landingPlanCodeSchema`: `'basic'`, `'pro'`, `'regional'` | Seeded in `marketplace.subscription_plans.code` as `'basic'`, `'pro'`, `'regional'` (`version = 1`, `status = 'active'`). |
| Monthly prices: `$149` / `$299` / `$499` | `monthly_price_cents`: `14900`, `29900`, `49900` (`currency = 'USD'`). |
| Active landings: `1` / `3` / `null` (unlimited) | `max_active_landings`: `1`, `3`, `null`; enforced atomically in `marketplace.tg_landing_guard()` and checked in `open_subscription_cycle`. |
| Paid Landing Operator seats: `2` / `5` / `10` (owner included) | `max_team_members`: `2`, `5`, `10`; enforced strictly on memberships with `landing_workspace_seat = true` (`status IN ('invited', 'active')`) in `tg_membership_guard()` and `open_subscription_cycle`. |
| Free Hauler & Fleet access (free forever, unlimited fleet seats) | `HAULER_MEMBERSHIP` (`monthlyPriceCents: 0`): fleet-only drivers (`role = 'driver', landing_workspace_seat = false`) and fleet-only staff (`role IN ('manager', 'staff'), landing_workspace_seat = false`) never consume paid landing seats, even on dual-mode companies that also operate landings. |
| Targeted invitations: `3` / `10` / `30` per cycle; no rollover | `monthly_invitations`: `3`, `10`, `30`; each cycle inserts a fresh `entitlement_periods` row with `invitations_committed = 0`. |
| `LANDING_PLAN_FEATURES` (`7` feature keys) | Exact match: `'advanced_hauler_search'`, `'availability_alerts'`, `'posting_templates'`, `'multi_landing_inbox'`, `'regional_capacity_overview'`, `'advanced_team_workflows'`, `'priority_support'`. |
| `boostPackageCodeSchema`: `'quick'`, `'extended'`, `'campaign'` | Seeded in `marketplace.boost_products.code` as `'quick'` (7d / `$99`), `'extended'` (14d / `$149`), `'campaign'` (28d / `$199`), `radius_miles = 100`. |
| `FOUNDING_OPERATOR_OFFER` (50% off, 6 cycles, 10/state) & `FOUNDING_HAULER_BADGE_LIMIT` (`1000`) | Enforced by `promotions` + `promotion_redemptions` (`UNIQUE (program, org_id)`, per-state `max_redemptions = 10`, `billing_cycles = 6`) and `hauler_profiles.founding_hauler_number` (`CHECK (between 1 and 1000)` via `admin_grant_founding_hauler_badge`). |
| `marketplace-v2.ts` job & inquiry fields | `job_postings` includes `est_daily_loads`, `est_tons_per_load`, `public_road_notes`; `expressions_of_interest` includes `contact_preference` (`'in_app'`, `'phone'`, `'email'`), `responded_at`, and `withdrawn_at`. |

---

## 3. Targeted Corrections Implemented (Items 1–9)

### 3.1 Non-Destructive Subscription Downgrades & Explicit Seat/Landing Resolution (Item 1)

- **No automatic member suspension:** `marketplace.open_subscription_cycle()` in [`03_entitlements.sql`](./03_entitlements.sql) never suspends or removes organization members (`UPDATE marketplace.organization_memberships SET status = 'suspended'` is completely removed).
- **Interactive plan change (`p_allow_over_limit = false`, default):** If an organization's active/invited paid landing seats (`landing_workspace_seat = true`) exceed the target plan's `max_team_members` (`2` / `5` / `10`) or active landings exceed `max_active_landings` (`1` / `3`), `open_subscription_cycle` raises an explicit `check_violation` (`23514`) with a recovery hint requiring the owner to remove or convert excess seats (`landing_workspace_seat = false` or `status = 'removed'`) and deactivate excess landings first.
- **External billing webhook sync (`p_allow_over_limit = true`):** If a subscription downgrade takes effect via an external Stripe renewal event before the owner trims seats or landings, `open_subscription_cycle` records the new cycle **while preserving existing member logins (`status = 'active'`) and existing landing rows**. The conflict is recorded in `audit_events` and surfaced via `marketplace.get_org_entitlement_state(p_org_id)` (`seat_conflict = true`, `landing_conflict = true`).
- **Operational guard during conflict:** While `seat_conflict` or `landing_conflict` is true, existing members retain read/management access to resolve the conflict, but `tg_landing_guard()`, `tg_job_guard()`, and `reserve_targeted_invitation()` block activating landings, publishing jobs, or sending targeted invitations with an explicit `23514` hint until the owner resolves the excess paid landing seats/landings or upgrades the plan.

### 3.2 Free Fleet-Only Drivers & Staff vs. Paid Landing Workspace Seats (Item 2)

- **`organization_memberships.landing_workspace_seat` (`01_schema.sql`):**
  - `role = 'owner'` always requires `landing_workspace_seat = true` (`CHECK (role <> 'owner' OR landing_workspace_seat)`).
  - `role = 'driver'` always enforces `landing_workspace_seat = false` (`CHECK (role <> 'driver' OR NOT landing_workspace_seat)`).
  - `role IN ('manager', 'staff')` can be assigned `landing_workspace_seat = true` (paid Landing Operator workspace seat) or `landing_workspace_seat = false` (free Hauler/Fleet-only employee).
- **Zero-loophole enforcement (`02_access.sql` & `03_entitlements.sql`):**
  - `marketplace.my_org_ids(p_roles, p_require_landing_seat)` and `marketplace.has_org_role(p_org, p_roles, p_require_landing_seat)` gate every **Landing Operator** table policy and RPC (`landings` write/draft read, `landing_private_details`, `job_postings` write/draft read, `job_posting_equipment` write, `job_templates`, `saved_searches` for `kind = 'trucks'`, `current_user_has_landing_access()` for hauler directory browsing, landing-side `expressions_of_interest` and `interest_messages`, `targeted_invitations` sender access/reservation, `job_boosts`, `entitlement_periods`) with `p_require_landing_seat = true`.
  - A member with `landing_workspace_seat = false` has full access to the **free Hauler/Fleet workspace** (`hauler_profiles`, `equipment_units`, `availability_reports`, hauler-side `expressions_of_interest`, `targeted_invitations` recipient response) and **zero access** to the Landing Operator workspace.
  - Only `owner` can grant or revoke `landing_workspace_seat = true`, and `tg_membership_guard()` locks the organization row (`FOR UPDATE`) to enforce `count(*) FILTER (WHERE status IN ('invited', 'active') AND landing_workspace_seat) < v_plan.max_team_members`.

### 3.3 Hardened Clerk Third-Party Authentication Boundary (Item 3)

LogLoads uses Supabase's native Clerk third-party authentication integration (`[auth.third_party.clerk]`), which separates cryptographic token verification from SQL claim inspection:

1. **Layer 1 — Cryptographic signature verification (Supabase Auth / PostgREST gateway):**
   - Verifies the RS256 JWT signature against Clerk's published JWKS endpoint before opening or reusing a PostgREST transaction.
   - Rejects forged, tampered, or expired tokens at the HTTP boundary and sets `request.jwt.claims` on the PostgreSQL session.
   - *Note:* SQL-level tests (`04_tests.sql`, `05_concurrency_test.ps1`) use `set_config('request.jwt.claims', ...)` + `SET LOCAL ROLE` to test Layer 2 and RLS policies; they do **not** test Layer 1 JWKS signature verification, which requires an active Supabase PostgREST gateway configured with Clerk's JWKS URL.
2. **Layer 2 — Strict SQL claim inspection (`marketplace.current_user_id()` in `01_schema.sql`):**
   - Never treats missing required JWT claims as valid (no `coalesce(..., true)` fallbacks).
   - Requires non-empty `iss` (`char_length(btrim(coalesce(c.claims ->> 'iss', ''))) > 0`) matching an `enabled = true` row in `marketplace.trusted_identity_issuers`.
   - Requires non-empty `sub` (`char_length(btrim(coalesce(c.claims ->> 'sub', ''))) > 0`).
   - Requires explicit `c.claims ->> 'role' = 'authenticated'` (tokens missing `role` or carrying `anon` resolve `NULL`).
   - Requires a **present, numeric, future `exp` claim** (`c.claims ->> 'exp' IS NOT NULL AND (c.claims ->> 'exp') ~ '^[0-9]+(\.[0-9]+)?$' AND to_timestamp((c.claims ->> 'exp')::double precision) > now()`).
   - If `nbf` is present, requires valid numeric `nbf <= now()`.
   - If `trusted_identity_issuers.expected_audience` is pinned, requires `aud` string or array membership match.
   - Resolves `(issuer, sub)` via `marketplace.identity_links` to `marketplace.app_users WHERE status = 'active'`.

### 3.4 Genuine Multi-Session Concurrency Verification (Item 4)

Single-session transactional tests cannot prove lock serialization across concurrent connections. [`05_concurrency_test.ps1`](./05_concurrency_test.ps1) spawns parallel `psql` worker processes synchronized via `pg_sleep_until(barrier_ts)` against a disposable local PostgreSQL instance (`127.0.0.1` / `localhost` enforced by script guard) across four races:

1. **Race 1 — Final Invitation Credit (`reserve_targeted_invitation`):** Two concurrent `authenticated` sessions simultaneously attempt to consume the 3rd of 3 Basic invitation credits (`invitations_committed = 2`). Conditional row locking on `marketplace.entitlement_periods` (`WHERE invitations_committed < invitation_allowance`) serializes the updates; exactly 1 session commits and 1 fails with SQLSTATE `23514`.
2. **Race 2 — Simultaneous Multi-Channel Failure Callbacks (`resolve_invitation_delivery`):** Two concurrent `service_role` workers simultaneously fail the `in_app` and `email` delivery rows for the same invitation. Strict parent-first lock ordering (`targeted_invitations FOR UPDATE` before `invitation_deliveries FOR UPDATE`) prevents deadlocks, and `WHERE id = v_inv.id AND status = 'reserved'` guarantees `invitations_committed` is refunded **at most once**.
3. **Race 3 — Stale Reservation Reaper vs. Late Delivery Callback (`expire_stale_invitation_reservations` vs. `resolve_invitation_delivery`):** One worker runs the timeout reaper while a second worker simultaneously reports a delivery failure for the same stale reservation. Row locking on `targeted_invitations` ensures only one worker transitions the row out of `'reserved'` and refunds the credit once.
4. **Race 4 — Concurrent Billing-Cycle Webhooks (`open_subscription_cycle`):** Two concurrent `service_role` webhook workers simultaneously open the same `(subscription_id, period_start)` cycle for an organization holding an active Founding Operator promotion. `organizations FOR UPDATE` + `v_is_new_period` + `ON CONFLICT (subscription_id, period_start) DO UPDATE` create exactly 1 `entitlement_periods` row and increment `promotion_redemptions.cycles_applied` once.

### 3.5 Coarse Public Coordinates vs. Private Access, Spatial Search Accuracy & 100-Mile Boost Radius (Item 5)

- **Public vs. private location storage:**
  - `marketplace.approximate_point(geography)` (`02_access.sql`) snaps every public point (`landings.public_point`, `hauler_profiles.service_center`, `availability_reports.area_center`, and `job_boosts.center_point`) to the center of a `0.1° x 0.1°` lat/lon cell (`floor(coord / 0.1) * 0.1 + 0.05`).
  - Exact gate/spur coordinates (`landing_private_details.exact_point`), directions, gate combinations, and site phone numbers live exclusively in `marketplace.landing_private_details`, which has zero `anon` grant, no casual admin `SELECT` policy, and is readable only by the landing's own authorized staff (`landing_workspace_seat = true`) or a hauler organization whose active inquiry was explicitly granted access (`private_details_shared_at IS NOT NULL`).
- **Quantization error & 100-mile boundary compensation:**
  - At US timber latitudes (and worst-case at the equator), snapping a coordinate to a `0.1°` cell center shifts each point by at most `±0.05°` in lat/lon (**~4.2 miles** at 45°N, **~4.9 miles / ~7,900 meters** worst-case).
  - To prevent coarse public points from **falsely implying sub-mile gate precision** or **silently dropping legitimate haulers/jobs near the 100-mile boundary**:
    1. `search_job_postings` snaps the caller's search origin (`marketplace.approximate_point(p_point)`) and rounds `distance_miles` to **whole miles** (`round(..., 0)`), preventing sub-cell triangulation.
    2. `search_job_postings`, `eligible_invitation_recipients`, and `estimate_boost_audience` add an **8,000-meter (~5.0-mile) grid-quantization tolerance buffer** (`radius_miles * 1609.344 + 8000.0`) to `ST_DWithin` comparisons so a job or hauler within 100 real miles is never silently excluded by `0.1°` cell snapping.
- **Public text redaction without blocking business contact info:**
  - `marketplace.contains_sensitive_access_pattern(text)` (`01_schema.sql`) blocks 4+ decimal lat/lon coordinate pairs (`44.40123, -122.70456`) and gate/padlock code disclosures (`gate code 4829`, `padlock combo #1234`) in public landing/job text fields while allowing legitimate office phone numbers and business email addresses.

### 3.6 Pay Transparency vs. Nullable Advertised Pay (Item 9)

There is an explicit specification tension between:
- **`LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md §5.2` & `AGENTS.md §6.1`:** *"Show pay amount and pay basis (for example, per load, per mile, per hour, or negotiable)..."*
- **`LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md §5.1.3` & `packages/contracts/src/marketplace-v2.ts`:** `payRateCents: number | null` (*"Recommended, not required. If omitted, card shows 'Pay not stated' in muted text"*).

To avoid silently weakening marketplace pay transparency before a founder decision:
1. **Table constraint (`01_schema.sql`):** `marketplace.job_postings` allows three states:
   - A unit rate (`pay_unit NOT IN ('negotiable')` with `pay_amount_cents > 0`),
   - Explicit negotiable pay (`pay_unit = 'negotiable'` with `pay_amount_cents IS NULL` and a non-empty `pay_note` of at least 3 characters), or
   - Unquoted (`pay_unit IS NULL AND pay_amount_cents IS NULL`) for `status = 'draft'` postings.
2. **Publish guard (`tg_job_guard` in `02_access.sql`):** Transitioning a job to `status = 'active'` with `pay_unit IS NULL` is **blocked by default (`SQLSTATE 23514`)** unless the provisional database setting `app.allow_unquoted_active_jobs = 'true'` is explicitly enabled after founder sign-off.

---

## 4. `SECURITY DEFINER` Function & Privilege Audit

Every `SECURITY DEFINER` function in `01_schema.sql`, `02_access.sql`, and `03_entitlements.sql` pins `set search_path = pg_catalog, extensions, pg_temp` and has `EXECUTE` revoked from `PUBLIC`:

| Function(s) | Granted to | Authorization check inside function |
|---|---|---|
| `contains_sensitive_access_pattern` (`IMMUTABLE`), `approximate_point` (`IMMUTABLE`), `subscription_is_entitling` (`STABLE`), `tg_set_updated_at`, `tg_audit_append_only` | `anon`/`authenticated` (`contains_sensitive_access_pattern` only) | Pure `SECURITY INVOKER` functions with pinned `search_path`. |
| `current_user_id`, `my_org_ids(text[], boolean)`, `has_org_role(uuid, text[], boolean)`, `is_platform_admin(text[])`, `org_has_feature(uuid, text)`, `current_user_has_landing_access()` | `authenticated` | Bound strictly to `current_user_id()`; Landing Operator helpers require `landing_workspace_seat = true`. |
| `job_is_publicly_visible`, `can_read_job_posting`, `can_access_interest`, `can_view_landing_private` | `anon` (`job_is_publicly_visible` only), `authenticated` | Non-recursive boolean RLS helpers breaking the `job_postings <-> expressions_of_interest <-> interest_messages` cycle. |
| `org_entitled_plan`, `write_audit`, `eligible_invitation_recipients`, `tg_landing_guard`, `tg_landing_after`, `tg_job_guard`, `tg_membership_guard`, `tg_hauler_profile_guard`, `tg_availability_guard`, `tg_interest_message_after` | None (internal / trigger only) | Not callable by `anon`, `authenticated`, or `service_role` via RPC. |
| `search_job_postings` | `anon`, `authenticated` | Returns only active, non-expired jobs at active landings of active orgs with snapped whole-mile distances; never touches `landing_private_details`. |
| `create_organization`, `respond_to_interest`, `withdraw_interest`, `respond_to_invitation`, `count_eligible_invitation_recipients`, `reserve_targeted_invitation`, `get_org_entitlement_state`, `estimate_boost_audience` | `authenticated` | Verify `current_user_id()` and required role; all Landing Operator actions require `landing_workspace_seat = true`. |
| `admin_grant_founding_promotion`, `admin_grant_founding_hauler_badge`, `admin_set_org_verification`, `admin_moderate_job_posting`, `admin_read_landing_private` | `authenticated` | Require `marketplace.is_platform_admin(...)` with specific staff role (`billing`, `moderator`, `support`), non-empty audit reason, and write an `audit_events` row in the same transaction. |
| `sync_verified_identity`, `open_subscription_cycle`, `activate_job_boost`, `resolve_invitation_delivery`, `expire_stale_invitation_reservations` | `service_role` | Narrow server-worker entry points; `service_role` has zero direct table privileges in `marketplace`. |

### Deployment note: `18_v2_review_106_hardening.sql` changes a database-wide default (HF-18, #187)

Migration 18 runs `ALTER DEFAULT PRIVILEGES FOR ROLE current_user REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`, without `IN SCHEMA`. It applies to the whole database for the role that applies 18, which on Supabase is `postgres`. Check the following before you apply 18 to a database that holds anything besides `marketplace`:

* Every function that role creates afterwards, in any schema, gets no `EXECUTE` for `PUBLIC`. This includes later pilot migrations and Dashboard SQL run as `postgres`.
* On Supabase, the per-schema defaults for `postgres` in `public` and `storage` still add their grants to the API roles. Any other schema needs an explicit `GRANT EXECUTE`, and so does any other role, for example `supabase_auth_admin` for an Auth hook. Without one, a helper called from an RLS policy fails with "permission denied for function".
* Extensions that Supabase installs belong to `supabase_admin`, and trigger functions need no `EXECUTE` when they fire, so neither is affected.
* Dropping the `marketplace` schema does not undo it. To revert it, run `ALTER DEFAULT PRIVILEGES FOR ROLE <role> GRANT EXECUTE ON FUNCTIONS TO PUBLIC`.

---

## 5. All 32 Normalized Tables and Key Indexes

| Domain | Tables (count) | Key constraints & indexes |
|---|---|---|
| **Identity & admin** (5) | `trusted_identity_issuers`, `app_users`, `identity_links`, `user_contacts`, `platform_admins` | `PRIMARY KEY (issuer, subject)` and `UNIQUE (user_id, issuer)` on `identity_links`; partial unique index `user_contacts_email_uq`. |
| **Organizations & seats** (3) | `organizations`, `organization_memberships`, `notification_preferences` | `landing_workspace_seat` check constraints (`owner -> true`, `driver -> false`); partial unique `organization_memberships_live_uq (org_id, user_id) WHERE status <> 'removed'`. |
| **Hauler & fleet** (5) | `hauler_profiles`, `user_qualifications`, `equipment_types`, `equipment_units`, `availability_reports` | `UNIQUE (founding_hauler_number)` (`1..1000`); GiST on `hauler_profiles.service_center` and `availability_reports.area_center`; B-tree on `(equipment_code, available_until)`. |
| **Landings & postings** (6) | `landings`, `landing_private_details`, `job_postings`, `job_posting_equipment`, `job_templates`, `saved_searches` | Composite `UNIQUE (id, org_id)` on `landings` and `job_postings` backing composite FKs `(landing_id, org_id)` and `(job_id, org_id)`; GiST on `landings.public_point`; GIN on `job_postings.search_document`. |
| **Inquiries** (2) | `expressions_of_interest`, `interest_messages` | Partial unique `(job_id, hauler_org_id) WHERE status <> 'withdrawn'`; `CHECK (hauler_org_id <> job_org_id)`; composite FK `(job_id, job_org_id)`. |
| **Plans, promos & quotas** (5) | `subscription_plans`, `promotions`, `promotion_redemptions`, `organization_subscriptions`, `entitlement_periods` | Partial unique active plan per `code`; `UNIQUE (program, org_id)` on `promotion_redemptions`; GiST exclusion on `entitlement_periods (org_id WITH =, tstzrange(period_start, period_end, '[)') WITH &&)`. |
| **Targeted invitations** (2) | `targeted_invitations`, `invitation_deliveries` | `targeted_invitations_reserved_uq (job_id, recipient_org_id) WHERE status = 'reserved'`; `targeted_invitations_period_dedupe_uq (entitlement_period_id, job_id, recipient_org_id) WHERE status IN ('reserved', 'delivered')`. |
| **Promotional boosts** (2) | `boost_products`, `job_boosts` | GiST exclusion on `job_boosts (job_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (status = 'active')`; GiST on `center_point`. |
| **Trust & audit** (2) | `abuse_reports`, `audit_events` | Append-only triggers block `UPDATE`, `DELETE`, and `TRUNCATE` on `audit_events`; indexed by `(org_id, occurred_at DESC)` and `(entity_table, entity_id)`. |

---

## 6. Historical `public.operating_state` Preservation & Quarantine Architecture (Item 6)

Per `AGENTS.md §0, §1.7, §2.2, §2.4` and [`docs/product/TRANSITION_PLAN.md`](../../docs/product/TRANSITION_PLAN.md), historical pilot dispatch, trip, scale-ticket, invoice, and financial records in `public.operating_state` are **never dropped, truncated, or overwritten** by the normalized V2 architecture:

1. **Strict Schema Isolation (`marketplace` vs. `public`):**
   - All 32 V2 tables, 44 functions, and 27 triggers reside in the `marketplace` schema. Neither `01_schema.sql`, `02_access.sql`, nor `03_entitlements.sql` touches `public.operating_state` or any legacy `public.*` table.
2. **Preservation of Excluded Pilot Dispatch & Financial Collections:**
   - The excluded pilot collections inside `public.operating_state` (`truckSlots`, `assignments`, `directOffers`, `haulRoutes`, `routePacks`, `tripsV2`, `tripEvents`, `tripDocuments`, `tripInspections`, `tripReviews`, `platformFeeEvents`, `hostBillingProfiles`, `hostInvoices`, `networkUsageEvents`, `billingAdjustments`, `networkOverageInvoices`, `privateNetworkRelationships`, `subscriptionBaseInvoices`, `billingPeriodSummaries`) remain intact in `public.operating_state` for accounting, tax, audit, and dispute resolution.
   - Before any future cutover is authorized, a timestamped, immutable snapshot of `public.operating_state` (`version`, `updated_at`, `state` JSONB, SHA-256 digest) must be archived and verified.
   - Legacy service-role authorization checks in `packages/services` and `apps/web` must remain active for any admin/support read path that inspects historical `public.operating_state` records until formal retention obligations expire and the founder explicitly authorizes retirement.
3. **Quarantine & Deterministic ID Mapping for Retained Entities:**
   - When migrating retained entities (`profiles`, `organizations`, `organizationMemberships`, `landings`, `loadPostings`, `truckProfiles`, `availabilityWindows`, `messageThreads`) from `public.operating_state` into `marketplace.*`:
     - **Preserve stable UUIDs** wherever valid (`organizations.id`, `app_users.id`, `landings.id`, `job_postings.id`) and map Clerk external IDs into `marketplace.identity_links (issuer, subject, user_id)`.
     - **Quarantine malformed records:** Any historical record failing V2 domain invariants (e.g., a landing missing coordinates, a membership referencing a non-existent user, or a posting containing unparseable pay/access data) must never be silently rewritten or deleted; the migration adapter must leave `public.operating_state` untouched and emit a structured quarantine report (`entity_collection`, `legacy_id`, `org_id`, `failure_code`, `raw_payload`) for human/admin review.

| Existing `LogLoadsDatabaseState` collection (`packages/db/src/types.ts`) | Target in `marketplace` (`normalized-v2`) | Migration / preservation rule |
|---|---|---|
| `profiles` | `app_users`, `identity_links`, `user_contacts`, `platform_admins` | Preserve UUIDs; split Clerk `clerkUserId` into `identity_links`, email/phone into `user_contacts`, and verified admin allowlist into `platform_admins`. |
| `organizations`, `companies`, `verificationRecords` | `organizations` | Consolidate into `organizations`; scope `verification_status` strictly to business identity. |
| `organizationMemberships`, `organizationInvitations` | `organization_memberships` | Preserve memberships; set `landing_workspace_seat = false` for `driver` and fleet-only staff, `true` for landing operators. |
| `driverProfiles`, `dispatcherProfiles`, `loaderProfiles` | `hauler_profiles` (org-level), `organization_memberships` | Unify driver and fleet into one company-level `hauler_profiles` row per hauling org. |
| `driverCredentials`, `credentialReviews` | `user_qualifications` | Default `verification_status = 'self_reported'` unless explicitly checked by staff. |
| `truckProfiles`, `trailerProfiles`, `equipmentCombinations` | `equipment_types`, `equipment_units` | Normalize into typed `equipment_units` under `org_id`. |
| `availabilityWindows`, `futureAvailability` | `availability_reports` | Self-reported count, equipment type, coarse `0.1°` area center, date window, and `reported_at` timestamp. |
| `landings`, `richLandingDetails` | `landings` + `landing_private_details` | Split public coarse coordinates from private exact coordinates, gate codes, and contacts. |
| `loadPostings`, `opportunityCapacities`, `mills`, `destinationFacilities`, `rates` | `job_postings`, `job_posting_equipment`, `job_templates` | Destination and pay terms live directly on `job_postings`; unquoted active postings quarantined or downgraded to `draft` pending founder pay-transparency rule. |
| `messageThreads`, `messageEvents` | `expressions_of_interest`, `interest_messages` | Hauler-initiated inquiry thread per `(job_id, hauler_org_id)` with lightweight reply status. |
| `notifications`, `operationalNotices` | `notification_preferences`, `targeted_invitations`, `invitation_deliveries`, `saved_searches` | Separate opt-in preferences, proactive invitations, and saved-search alerts. |
| `entitlements`, `billingPlanDefinitions`, `organizationBillingAccounts`, `organizationSubscriptions` | `subscription_plans`, `organization_subscriptions`, `entitlement_periods`, `promotions`, `promotion_redemptions` | New landing tiers (`basic`/`pro`/`regional`); historical invoices (`subscriptionBaseInvoices`, `billingPeriodSummaries`) remain preserved in `public.operating_state`. |
| `supportRequests`, `auditEvents` | `abuse_reports`, `audit_events` | Append-only audit events and structured moderation/abuse reports. |
| `truckSlots`, `assignments`, `directOffers`, `haulRoutes`, `routePacks`, `tripsV2`, `tripEvents`, `tripDocuments`, `tripInspections`, `tripReviews`, `platformFeeEvents`, `hostBillingProfiles`, `hostInvoices`, `networkUsageEvents`, `billingAdjustments`, `networkOverageInvoices`, `privateNetworkRelationships` | **Retained read-only in `public.operating_state` (never migrated to `marketplace`)** | Preserved intact in `public.operating_state` for historical financial/legal/audit obligations; excluded from V2 load-board workflow per Blueprint §1.3 & §12.5. |

---

## 7. Provisional Configuration Values Pending Founder Sign-Off (Items 8 & 9)

The following operational parameters are **provisional defaults** stored in table columns or function parameters—not immutable founder-approved commercial rules—and can be changed via `UPDATE marketplace.subscription_plans` or session/function parameters without DDL changes:

| Provisional parameter | Current default | Where stored / configured | Status |
|---|---|---|---|
| **Invitation deduplication window** | `30` days (`NULL` = job lifetime) | `marketplace.subscription_plans.invitation_dedupe_days` + `p_dedupe_window` parameter on `eligible_invitation_recipients`, `count_eligible_invitation_recipients`, `reserve_targeted_invitation` | Provisional operational default (Blueprint §16.2); pending founder sign-off. |
| **Invitation reservation timeout** | `15` minutes | `marketplace.subscription_plans.invitation_reservation_timeout_minutes` + `p_max_age` parameter on `expire_stale_invitation_reservations` | Provisional operational default; pending founder sign-off. |
| **`past_due` billing grace window** | `7` days (`0..60` days) | `marketplace.subscription_plans.past_due_grace_days` + `p_grace_days` parameter on `open_subscription_cycle` | Provisional operational default (Blueprint §16.2); pending founder sign-off. |
| **Unquoted active job postings (`"Pay not stated"`)** | `'false'` (blocked on `status = 'active'`; allowed on `status = 'draft'`) | `current_setting('app.allow_unquoted_active_jobs', true)` in `tg_job_guard()` (`02_access.sql`) | Open specification conflict between Blueprint §5.2 (`AGENTS.md §6.1`) and UX Spec §5.1.3 (`marketplace-v2.ts`); blocked on publish until explicit founder decision. |
| **Trusted Clerk issuers & audience** | Test fixture only in `04_tests.sql` | `marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)` | Must be seeded with environment-specific Clerk issuer URL before enabling PostgREST Clerk JWT pass-through. |

---

## 8. GitHub Actions CI & Disposable Database Execution Instructions

> **Verification Status:** Prepared for automated execution on temporary Ubuntu GitHub Actions runners against a disposable PostgreSQL 17 instance with `postgis` and `btree_gist`. **Do not treat this prototype as production-ready until the CI workflow executes and passes both `04_tests.sql` and `05_concurrency_test.sh`.**

### 8.1 CI Runner Prerequisites (for Claude's `.github/workflows/` setup)

1. **PostgreSQL 17 with PostGIS 3 and `btree_gist`:**
   - **Option A — Service container (recommended):** `postgis/postgis:17-3.5` (or `postgis/postgis:17-3.4`) mapped to `127.0.0.1:5432` with `POSTGRES_USER=postgres`, `POSTGRES_PASSWORD=postgres`, `POSTGRES_DB=logloads_test`, plus `postgresql-client` installed on the Ubuntu runner (`sudo apt-get update && sudo apt-get install -y postgresql-client`).
     - *Note on `postgis/postgis` images:* Official PostGIS Docker images pre-install `postgis` in the `public` schema, and PostGIS does not support `ALTER EXTENSION postgis SET SCHEMA extensions`. `01_schema.sql` automatically detects when `postgis` is pre-installed outside `extensions` and drops/recreates it inside `extensions` on the disposable test database.
   - **Option B — Native Ubuntu runner packages:** `postgresql-17`, `postgresql-17-postgis-3`, and `postgresql-client-17` listening on `127.0.0.1:5432`.
2. **Supabase role compatibility (`anon`, `authenticated`, `service_role`):**
   - No external Supabase CLI or container stack is required. Both `01_schema.sql` and `02_access.sql` idempotently create `anon`, `authenticated`, and `service_role` (`NOLOGIN NOINHERIT NOBYPASSRLS`) and grant them to `current_user` (`postgres`) so `SET LOCAL ROLE anon | authenticated | service_role` works identically in vanilla PostgreSQL 17 and Supabase.
3. **Environment variable:**
   - `LOGLOADS_DISPOSABLE_DB_URL="postgresql://postgres:postgres@127.0.0.1:5432/logloads_test"`
   - Both `05_concurrency_test.sh` and `05_concurrency_test.ps1` refuse to run and exit `1` if `LOGLOADS_DISPOSABLE_DB_URL` is unset or points to anything other than `127.0.0.1` or `localhost`.

### 8.2 Exact Commands for GitHub Actions (`ubuntu-latest`)

```bash
export LOGLOADS_DISPOSABLE_DB_URL="postgresql://postgres:postgres@127.0.0.1:5432/logloads_test"

# 1. Apply DDL, RLS policies, grants, and entitlement RPCs from an empty database:
psql "$LOGLOADS_DISPOSABLE_DB_URL" -X -v ON_ERROR_STOP=1 -f architecture/normalized-v2/01_schema.sql
psql "$LOGLOADS_DISPOSABLE_DB_URL" -X -v ON_ERROR_STOP=1 -f architecture/normalized-v2/02_access.sql
psql "$LOGLOADS_DISPOSABLE_DB_URL" -X -v ON_ERROR_STOP=1 -f architecture/normalized-v2/03_entitlements.sql

# 2. Run deterministic integration, RLS, seat-separation, downgrade, spatial, and entitlement suite:
psql "$LOGLOADS_DISPOSABLE_DB_URL" -X -v ON_ERROR_STOP=1 -f architecture/normalized-v2/04_tests.sql

# 3. Run genuine two-session parallel concurrency suite (Races 1..4):
bash architecture/normalized-v2/05_concurrency_test.sh
```

### 8.3 Local PowerShell Execution (when a local disposable PostgreSQL 15+/17 instance is available)

```powershell
$env:LOGLOADS_DISPOSABLE_DB_URL = "postgresql://postgres:postgres@127.0.0.1:5432/logloads_test"

psql $env:LOGLOADS_DISPOSABLE_DB_URL -X -v ON_ERROR_STOP=1 -f architecture/normalized-v2/01_schema.sql
psql $env:LOGLOADS_DISPOSABLE_DB_URL -X -v ON_ERROR_STOP=1 -f architecture/normalized-v2/02_access.sql
psql $env:LOGLOADS_DISPOSABLE_DB_URL -X -v ON_ERROR_STOP=1 -f architecture/normalized-v2/03_entitlements.sql
psql $env:LOGLOADS_DISPOSABLE_DB_URL -X -v ON_ERROR_STOP=1 -f architecture/normalized-v2/04_tests.sql
pwsh -File architecture/normalized-v2/05_concurrency_test.ps1
```
