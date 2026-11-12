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

### Round 2: `23_v2_round2_hardening.sql` (follow-ups from the PR #194 review, #187)

Migration 23 redefines three functions (`tg_membership_guard`, `can_view_organization`, `can_view_app_user`), comments one (`tg_qualification_verification_reset`), and changes no stored row, no grant and no billing function. Stage 23 in CI checks that exact set by comparing every `marketplace` function's source and ACL before and after the file. Tests: `24_v2_round2_hardening_tests.sql` (one session) and `25_v2_round2_concurrency_test.sh` (two sessions).

#### Lock order between memberships and billing (R2-1)

PostgreSQL locks a row before its `BEFORE ROW` triggers run, so every membership `UPDATE` holds that membership row while `tg_membership_guard` runs.

| Path | Locks, in order |
|---|---|
| Owner exit (an active owner leaves or steps down), 18 | membership row, then the organization row (HF-15's turn) |
| Owner exit, 23 | membership row, then the advisory lock `hashtextextended('marketplace.owner_exit:' \|\| org_id, 0)` |
| Billing: `apply_subscription_cycle` (also behind `open_subscription_cycle`) and `apply_billing_provider_event` | the organization row, then the subscription row; the subscription write fires `tg_ensure_owner_landing_seat`, which updates every owner row that has no landing seat |
| A landing seat added to a membership (the seat check in `tg_membership_guard`, 16) | membership row, then the organization row |

Under 18, an owner with no landing seat (possible only while the organization has no entitling plan and no landing) who left while the organization's subscription row was written formed a cycle. The exit held its row and waited for the organization row; billing held the organization row and waited for the exit's row. PostgreSQL aborted one side with `40P01`. Under 23 an exit never waits for the organization row, and billing never takes the owner-exit lock, so the cycle cannot form. Two exits still take turns on the advisory lock, and the second reads the first one's committed change (HF-15). We chose this over making billing lock owner memberships before the organization row because it changes no billing function. `25` proves it: billing waits for the exit, both commit, and the result equals running the exit and then billing in series on a twin organization. With 18's lock restored, the same race fails with `40P01`.

Residual cases, unchanged by 23. Each ends in a retryable `40P01` with nothing lost:
* **A landing seat added to an owner row that has none**, while the subscription row is written. Examples: an owner gives another owner a seat, or an owner steps down to manager and takes a seat in the same `UPDATE`. The seat check must keep waiting for the organization row, because that is what serializes it with a plan change. Billing gives such owners a seat anyway.
* **One `UPDATE` statement that changes several memberships of one organization**, including an owner exit, racing another owner exit. The statement holds its earlier rows while it waits for its turn on a later one. The V2 contract changes one membership per statement.

To remove these as well, the billing entry points would lock the organization's seatless owner memberships before the organization row, or membership changes would go through one RPC that locks the organization first.

#### Who reads an organization and a profile (R2-2, R2-3)

| Reader | `organizations` row | `app_users` profile |
|---|---|---|
| An active member of an active organization | yes | colleagues who **accepted** their membership, including former and suspended ones (the organization's history) |
| A pending invitee | the inviting organization, while it is active | only the person who invited them |
| A person who declined, left, or was removed or suspended, or whose organization is suspended or closed | no, unless the organization is public | only the person who invited them |
| The organization, about a person whose invitation is not yet accepted | n/a | **no**: it sees only the membership row it wrote |
| Anyone signed in, and `anon` for the organization row | organizations with a public presence (an active landing, or F1 discovery consent) | no |
| Counterparts (an inquiry or a targeted invitation) and platform staff | unchanged from 18 | unchanged from 18 |

Decision (R2-3): the review offered two fixes for "an owner can invite any user id and then read that profile": require an allowed discovery path for the invitee, or limit what an invitation exposes. 23 takes the second at its narrowest: until the person accepts (`accepted_at`, set only by the person or a service path, B-1), the invitation exposes no profile field. The schema has no invite-by-email path to require: `app_users` holds no email, and `user_contacts` is readable only by the person and support. Inviting and accepting work as before. An owner can still tell whether an id exists, from the foreign-key error on an invitation for an unknown id, but learns nothing else about that person.

#### Staff re-verification of a qualification (R2-4)

HF-06's `qualification_verification_reset` has no exemption. A future staff re-verification, such as a renewed expiry date on a verified CDL, is one `SECURITY DEFINER` staff function that runs two statements. The first is the edit, which resets the row to `self_reported` and writes `qualification.verification_reset`. The second sets `verification_status = 'verified'` with `reviewed_by` and `reviewed_at`, and the trigger leaves it alone because the row is no longer verified. Clients cannot write `verification_status`, `reviewed_by` or `reviewed_at` (column grants, checked in stage 23), so only such a function can re-verify. We rejected an exemption keyed on `reviewed_at` or on a session setting: it would make the reset depend on column grants staying narrow, or on a setting a client can set, for a staff flow that does not exist yet. The rule is also the trigger function's catalog comment.

### Stage 26: `26_v2_team_seats_saved_jobs_outbox.sql` (#237)

Migration 26 adds five tables and 23 functions (three of them trigger functions), redefines ten functions, and changes no stored row and no existing grant. The ten are `tg_membership_guard` and `apply_subscription_cycle` (seats), plus eight readers that now follow landing scope: `can_read_job_posting`, `can_view_landing_private`, `can_access_interest`, `has_live_inquiry_from_hauler`, `can_view_organization`, `can_view_app_user`, `list_authoring_landings` and `list_marketplace_interests`. Stage 26 in CI checks that exact set, as stage 23 does. `10` proves on existing data that no stored row changes, and `15` drills 26 like the earlier migrations. Tests: `27_v2_team_seats_saved_jobs_outbox_tests.sql` (one session) and `28_v2_team_seats_outbox_concurrency_test.sh` (two sessions). After 26, stage 27 runs `04`, `07`, `09`, `13`, `17`, `19` and `21` again. Sources: UX functional spec v1.0 §2.3–§2.4, §4.11, §5.9, §6.6, §8.7, §8.15 and §8.19. Seat limits come from `subscription_plans.max_team_members`, seeded from `packages/contracts/src/membership.ts`.

#### Seat invitations (26-A)

* An owner invites an **email address** (`invite_team_member`) as manager, staff or driver, with or without a Landing Operator seat, and may limit the invitation to some landings. Ownership is never invited: it moves only through a separate, guarded transfer, which does not exist yet.
* A **pending, unexpired invitation with a seat holds that seat**. Both `invite_team_member` and the redefined `tg_membership_guard` count it, so neither path can pass the plan's cap. The two take turns on the organization row: the guard locks it `FOR UPDATE`, as it did before. The invitation locks it `FOR NO KEY UPDATE`, which conflicts with the guard and with other invitations but not with foreign-key checks. `28` proves both orders and two simultaneous invitations.
* Accepting needs the person's **verified** address to equal the invited one. `user_contacts.email` is written only by `sync_verified_identity`, from a verified provider claim, and has no client write path. A forwarded invitation email therefore cannot be used by someone else. The membership starts active and accepted (B-1), with `invited_by` set to the inviter, so R2-3's profile rules apply unchanged.
* Lock order. An invitation's row is locked before the organization row: accept and revoke take the invitation row first, and `invite_team_member` closes an expired invitation to the same address before it locks the organization. Billing never touches invitations. Accept and revoke take turns on the invitation row, and the second one finds the invitation closed (`28`).
* Expiry is lazy. A pending invitation past `expires_at` holds no seat and cannot be accepted. Inviting the address again records it as `expired`. The invitation's lifetime is a required parameter (1 hour to 30 days), because no product decision fixes it.
* A direct plan change (`open_subscription_cycle` through the redefined `apply_subscription_cycle`) **refuses to strand pending seat invitations**, just as it refuses to strand seated members (Item 1, explicit resolution). The owner revokes invitations first. Billing locks the organization row `FOR UPDATE` before it counts, so a downgrade and an invitation take turns; `28` proves both orders.
* Provider events pass `p_allow_over_limit` (12) and are never refused. After such a change, a pending invitation the plan has no room for cannot be accepted, and `list_team_invitations` shows `seat_available = false` until the owner revokes enough of them. It blocks nothing else. `seat_conflict` (`get_org_entitlement_state`), which gates publishing, still counts seated members only (04), and `paid_landing_seats`, which the adapter shows as team members, is unchanged. The cycle audit adds `pending_seat_invitations`.
* Fleet staff without a seat are not capped by any plan (§6.6). At most 50 pending invitations per organization and 5 sends per invitation are abuse bounds, not plan limits.

#### Staff-to-landing scope (26-B)

A manager or staff membership with a seat may be limited to some landings (`membership_landing_scopes`). Only an owner sets it, through `set_membership_landing_scope`, and each change is audited. No rows means every landing, which is today's behaviour. Owners are never limited. An invitation's landings become the member's scope when they accept, archived landings included, so archiving a landing never widens a scope. The limit holds on every path:

| Path | How |
|---|---|
| Direct writes and writes inside `SECURITY DEFINER` functions (publish, draft, status, respond, reply, targeted invitation) | `landing_scope_guard` `BEFORE` triggers on `landings`, `landing_private_details`, `job_postings`, `job_posting_equipment`, `targeted_invitations`, `expressions_of_interest` (landing side) and `interest_messages` (landing side). They key on the JWT identity, not the database role. A limited member cannot add a landing. |
| Direct reads | `RESTRICTIVE` select policies on `landings`, `job_postings`, `expressions_of_interest`, `targeted_invitations` and `job_boosts`. A public row (an active landing, a publicly visible job) stays readable to everyone who could read it before. |
| `SECURITY DEFINER` readers (they bypass row security) | `can_read_job_posting` (and through it `list_marketplace_jobs` and `get_marketplace_job`), `can_view_landing_private`, `can_access_interest`, `list_authoring_landings` and `list_marketplace_interests` check the scope. So do the helpers that turn an inquiry or a targeted invitation into visibility: `has_live_inquiry_from_hauler` (behind `hauler_profiles_read` and `can_view_user_qualifications`), and the counterpart branches of `can_view_organization` and `can_view_app_user`. A limited member reads a private hauling business, its people and their qualifications only through an inquiry or invitation on a landing in scope. |

Not limited: organization-level counts (`get_org_entitlement_state`) and job templates (organization-level). 26 also left the audience estimates `count_eligible_invitation_recipients` and `estimate_boost_audience` unlimited; 29 limits them (29-P3).

#### Saved jobs (26-C)

`saved_jobs` stores ids only: a person, the hauling business they saved for, and the job. A member saves an open job and deletes the row to remove it. `list_saved_jobs` shows each saved job as `open`, `paused`, `closed` or `unavailable`, with public listing fields only. An unavailable job (taken down by a moderator, or its business is no longer active) shows no listing fields. Job-change notifications for saved jobs (spec §10.2) are a recommendation, not an approved MVP feature, so 26 does not add them.

#### Notification outbox (26-D)

| | |
|---|---|
| Writers | Only 26's functions and triggers. A team invitation email (transactional). An inquiry message, which notifies the other side's opted-in members, never its author; a landing-side recipient needs a seat and the job's landing in scope. A saved-search job alert, queued by the matching service through `enqueue_job_alerts` (service role); each job alerts a search once per channel. |
| Consent | `notification_preferences` (business, category, channel), an active membership in an active business, and the subject still open. Checked when a notice is queued and again when a worker claims it. Targeted invitations keep `invitation_deliveries`, which reconciles the allowance. |
| In-app | `delivered` when written. The recipient reads their own notices and marks them read (`mark_notifications_read`). |
| Email | `pending` → `claimed` → `sent` → `delivered` or `bounced`. A notice can also end `failed`, `suppressed` (no consent, no verified address, or a test-recipient guard) or `cancelled` (the subject closed). `sent` means the provider accepted the request; only `record_email_provider_event('delivered')` makes it `delivered` (AGENTS.md §7.6). |
| Worker (service role) | `claim_email_notifications` takes due emails with `FOR UPDATE SKIP LOCKED` and a lease, and returns each with its address and a claim token. `complete_email_notification` needs that token, so a worker whose lease ran out cannot overwrite a later claim. A retry backs off; the fifth failed attempt is final. |
| Privacy | The payload names the job, business and sender, and never copies message text or the invitee's address. Clients cannot read the address, the provider's message id, the claim or the failure text (column grants). Audit metadata never holds an address. |

The states map onto the pilot contract's `emailDeliveryState` (`packages/contracts/src/schemas.ts`) as `pending` → `pending`, `claimed` → `claimed`, and `failed`, `bounced`, `suppressed`, `cancelled` → `failed`. That contract's `delivered` means the provider accepted the request, which is 26's `sent`. 26 keeps the provider's own confirmation separate.

#### CI wiring and what is not in 26

* **26 is in the migration chain everywhere.** The owner tool's `MIGRATION_CHAIN` (`tools/normalized-store-policy.mjs`) applies it, so the ledger is now `06,11,12,16,18,23,26`. The seed, both adapter contract tests and the owner tool's tests pin that ledger. `tools/normalized-store.test.mjs` keeps them, `run-stage.sh` and the workflows in step.
* In `normalized-v2-ci.yml`, the alignment and Supabase jobs run 26 and 27 right after 24, the last suite that pins the ledger at 23, and 28 after 25. The adapter-contract job runs 26 after 23. Each stage is its own workflow step; `run-stage.sh` never chains one stage into another. That keeps the workflow steps, which the chain test reads, the single record of what CI applies.
* The recovered `schema26` batch (#221) is not adopted. G1 must ship with contracts, adapter and UI. G2 and G4 follow #219. G3 contradicts HF-05's verified column grant and needs an adapter security review. G5 and G6 rewrite stored rows and need data-mapping, rollback and concurrency review. If adopted later, they take a stage number of 35 or above (29 to 34 are below).

### Stage 29: `29_v2_landing_scope_hardening.sql` (#264)

Migration 29 closes the two findings of the post-merge review of #241 (logloads#263, comment 6781627119). It redefines four functions and changes nothing else: no table, policy, trigger, grant or stored row. Stage 29 in CI checks that it adds and drops no function, changes exactly these four, and changes no grant. `10` proves on existing data that no row changes, and `15` drills 29 like the earlier migrations. Tests: `30_v2_landing_scope_hardening_tests.sql`; after it, stage 30 runs `04`, `07`, `09`, `13`, `17`, `19`, `21` and `27` again on the 29 schema. `27` accepts a ledger that ends in 26 or in 29 for that run.

| Finding | What could happen in 26 | 29 |
|---|---|---|
| **29-P2** (P2) | A person who is a manager or staff member limited to landing A, and also a member of a hauling business that inquired on a job at landing B, could call `respond_to_interest` on that inquiry. `respond_to_interest` checked the organization role only. `landing_scope_guard` skipped its landing check for any member of the hauling business, so the person could mark the inquiry viewed and share landing B's private details, or decline it without a reply. Sharing let the hauling business read B's private access details (`can_view_landing_private`). | `tg_landing_scope_guard` takes the hauling-business bypass only when no landing-side response column changes: not `responded_at`, not a move to `viewed`, `replied` or `declined`, and not `private_details_shared_at` or `private_details_shared_by`. A withdrawal, which only the hauling business makes, may clear the shared details. `respond_to_interest` requires `job_scope_allows(job_id)` before it reads the inquiry's state, with the guard's refusal. Without that check, its no-op paths (a repeated decline, a view of a viewed inquiry, a withdrawn inquiry) would answer an out-of-scope member with the inquiry's state. |
| **29-P3** (P3) | `count_eligible_invitation_recipients` and `estimate_boost_audience` checked the organization role only. A limited member could read both counts for a job at another landing, including a draft or paused job that 26-B's row policies hide from them. | Both also require `job_scope_allows(p_job_id)`, and refuse with `not authorized for this job`, as for any job the caller cannot act on. |

The hauling business keeps every hauler-side action on its own inquiry, including when the same person is limited on the landing side: it edits the inquiry (`submit_expression_of_interest`, or its columns directly), replies, withdraws and sends it again. `30` checks each attack in the review, each as the attacker first and then by its effect. It also checks the guard alone, through a write that stands in for any `SECURITY DEFINER` path, the in-scope and hauler-side paths, and the grants. Locally, on PGlite, the suite fails on a 26 schema at the review's first attack. It also fails when any one of the four functions is put back to its earlier definition.

* **29 is in the migration chain everywhere 26 is.** `MIGRATION_CHAIN` applies it, so the ledger is now `06,11,12,16,18,23,26,29`. The seed, both adapter contract tests and the owner tool's tests pin that ledger. In `normalized-v2-ci.yml`, the alignment and Supabase jobs run 29 and 30 right after 27. The adapter-contract job runs 29 after 26.

### Stage 31: `31_v2_reply_gate_reconfirmation_unsubscribe.sql` (#294, part A)

Migration 31 carries one P1 security fix and four rules the lead added to #294. It redefines eight functions, adds five functions and two tables that start empty, replaces three row-level security policies, and changes no stored row and no grant of an existing function. Stage 31 in CI checks that exact set (functions by source and grant, tables, policies). `10` proves on existing data that no row changes, and `15` drills 31 like the earlier migrations. Tests: `32_v2_reply_gate_reconfirmation_unsubscribe_tests.sql` (97 assertions); after it, stage 32 runs `04`, `07`, `09`, `13`, `17`, `19`, `21`, `27` and `30` again on the 31 schema. Those suites take the 31 behaviour where it differs: `04` counts 31's tables and functions, `07` expects the never-confirmed legacy job off the list, `09` and `13` expect "Job not found" for another business's job, and `30` shares private details with a reply instead of with "viewed".

The file numbers follow the directory: 30 is 29's suite, so this migration is 31 and its suite 32. The issue calls it "stage 30".

| Rule | Before 31 | 31 |
|---|---|---|
| **31-P1** (P1, security sweep of 2026-11-11): the phone and private details only after the landing replies and opts in | `respond_to_interest(..., 'viewed', true)` turned sharing on for a submitted or viewed inquiry, and `can_view_landing_private` asked only for a shared inquiry that was not withdrawn or declined. A desk member could mark a new inquiry viewed with sharing on, and every member of the hauling business, drivers included, could then read `site_contact_phone`, `site_contact_name`, `exact_point`, `directions` and `gate_instructions`. | `can_view_landing_private` lets the hauling business read only while the inquiry's status is `replied`. `respond_to_interest` refuses to turn sharing on with `viewed` before a reply, and with a decline (`23514`, "Reply to this inquiry before sharing the landing's private details"); after a reply the desk can share or revoke with `viewed`. A decline clears the sharing columns and audits `landing_private.revoked`, as a withdrawal already cleared them. A row shared before a reply under the old rule is not rewritten; it is simply no longer readable. |
| **31-R** (#308's day-14 rule, from #247) | `list_marketplace_jobs` and `search_job_postings` listed every active job, however old its confirmation, and `submit_expression_of_interest` accepted interest on it. The rule lived only in `packages/services/src/v2/jobs/lifecycle.ts`. | `job_confirmation_current(last_confirmed_at)` is the one definition: confirmed less than 14 x 24 hours ago. From exactly 14 days, and for a legacy job that was never confirmed, an active job is off both lists, `accepting_interest` is false, it is never sponsored, and new interest is refused with the neutral `Waiting for the poster to confirm` (`23514`). The job's status stays `active`: it is not expired or paused. It is still returned by id (`get_marketplace_job`), and listed to its own landing desk and to platform staff, so the poster can reconfirm it. `reconfirm_job_posting` restores it at once. An inquiry already sent is untouched: it can be edited, answered and withdrawn; sending a withdrawn inquiry again is new interest. A direct `INSERT` of an inquiry (02's column grant) is held to the same rule: the `interests_hauler_insert` policy now also asks `job_takes_new_interest(job_id)`, so it is refused by row-level security (Codex review of PR #350). |
| **31-U** (#252): a signed-out unsubscribe link | `notification_preferences` is writable by its signed-in owner only, so a link in an email could not turn a preference off. | `unsubscribe_with_token(p_token)`, executable by `anon` only, takes a signed, expiring, single-use token and turns off the one (person, business, category, channel) preference the token names. It returns nothing and raises nothing for a token that is malformed, forged, expired or already used, and for a preference that does not exist, so it reveals neither the email nor whether the account exists. `issue_unsubscribe_token` (`service_role` only: the email worker) mints the token. |
| **31-F** (#248): founding offer reads | `promotion_redemptions_read` let only owners read the business's redemption, and `promotions_read` showed a promotion only while it was active, so an owner lost an offer's terms when its promotion closed. | Every active member of the business reads its redemption, and a member of a business that redeemed a promotion reads that promotion's terms whatever its status. |
| **31-O** (P2, same sweep): the scope error oracle | `reconfirm_job_posting`, `set_job_posting_status` and `reactivate_job_posting` answered another business's job with a `42501` role refusal and an unknown id with `P0002` "Job not found", which told any signed-in caller whether a job id exists, including a draft or a paused job. | Both get the same `P0002` "Job not found". A member of the job's own business keeps the refusals that name the reason: the role refusal, and `landing_scope_guard`'s for a landing outside their scope, as `respond_to_interest` does since 29. |

**The unsubscribe token (31-U).** `base64url("v1|key id|token id|user id|business id|category|channel|expiry in epoch seconds") || "." || hex(HMAC-SHA-256(key, payload))`. The key is 32 random bytes in `notification_unsubscribe_keys`, a table with row-level security, no policy and no grant, read only by the two `SECURITY DEFINER` functions. The first token creates the key, so the migration itself stores nothing. The newest key signs and every stored key verifies: rotate by inserting a key, and delete the old one after the longest token lifetime (90 days; the default is 30). Since 35, `rotate_unsubscribe_key` does this, with a stated grace window or a revocation (35-K). `hmac_sha256` is RFC 2104 over the built-in `sha256`, so 31 needs no extension; `32` checks it against RFC 4231's test vectors. The signature is checked before any field of the payload is trusted, and the two signatures are compared as digests. A used token id is recorded in `notification_unsubscribe_uses`, so a token works once: a link that was already used cannot turn off a preference the person turned back on. The function writes, so the caller needs a read-write transaction (`asAnon(..., { readOnly: false })` in the adapter), and the page should act on a POST, not on a GET that a mail scanner may fetch.

**Decision (2026-11-11, #294): `plan.view` members may read the founding-offer redemption.** Every active member of a business holds `plan.view` (`get_org_entitlement_state` already shows any member the plan and the allowance), and the offer is part of what the plan costs, not a permission to change it. They read the columns 16 granted (`id`, `promotion_id`, `program`, `org_id`, `granted_at`, `cycles_applied`, `status`, `counted_period_ends`), never `granted_by`. A billing admin still reads every redemption. The adapter's `foundingOffer` read model (`apps/web/lib/marketplace-v2/billing`) still answers owners only; widening it is that feature's change.

`32` asserts the sweep's attack first, as the attacker and then by its effect, so on a database without 31 it stops there. It then covers: viewed plus share stays hidden; a reply without share stays hidden; a reply with share is visible; a later decline, a revocation and a withdrawal hide it again; the day-14 boundary at 13 days, a minute short of 14 days, exactly 14 days, 15 days, 20 days and never confirmed, on both lists and on new interest; reconfirming restores; tamper, wrong key, expiry, replay and cross-user attempts on the link; the founding-offer boundary for every role and for outsiders; and the three lifecycle functions answering another business's job and an unknown id alike. Locally, on PGlite, the suite fails on a 29 schema at the attack. It also fails when any one of the eight functions or three policies is put back to its earlier definition, and when the link's signature check, expiry check, single use or its (category, channel) scope is removed.

* **31 is in the migration chain everywhere 29 is.** `MIGRATION_CHAIN` applies it, so the ledger is now `06,11,12,16,18,23,26,29,31`. The seed, both adapter contract tests and the owner tool's tests pin that ledger. In `normalized-v2-ci.yml`, the alignment and Supabase jobs run 31 and 32 right after 30. The adapter-contract job runs 31 after 29. `14` expects "Job not found" for a rival's reconfirm.
* **Catalogue.** `unsubscribe_with_token` is in `MARKETPLACE_FUNCTIONS` as `anonymousOnly`: callable in an anonymous session only. `issue_unsubscribe_token` is never catalogued (the marketplace connection cannot become `service_role`).
* **Not in 31.** Direct table reads are unchanged: `job_postings` row-level security still shows an anonymous reader every publicly visible active job, including one past day 14 (the adapter reads jobs through the functions). `list_marketplace_interests` still reports `job_accepting_interest` without the day-14 rule; 33 rewrites that function. No worker prunes `notification_unsubscribe_uses` yet; rows can be deleted once `token_expires_at` has passed. 35 closes the direct-read gap (35-R) and adds the prune (35-P).

### Stage 33: `33_v2_port_v3_functions.sql` (#294, part B)

Migration 33 adds the SQL that port v3 was missing (the #269 review of PR #282, #250 and #280). It adds seven functions, redefines three, and replaces `list_marketplace_interests` by one with more arguments and the same grant. It changes no table, policy, trigger or stored row. Stage 33 in CI checks that exact set. `10` proves on existing data that no row changes, and `15` drills 33 like the earlier migrations. Tests: `34_v2_port_v3_functions_tests.sql` (72 assertions); after it, stage 34 runs `04`, `07`, `09`, `13`, `17`, `19`, `21`, `27`, `30` and `32` again on the 33 schema. The issue calls this "stage 31".

| Change | What it does | Who may call it |
|---|---|---|
| **33-I1** `list_invitation_recipients(p_job_id, p_radius_miles)` (#250) | The businesses `eligible_invitation_recipients` allows for one job, in name order, at most 200. The landing picks every recipient; there is no hidden ranking. It returns the business's name, home base, active equipment by type, last availability report and verification, and nothing else: no person, phone, email, point or private landing detail (legal review item 3). | Owner, manager or staff with a seat, and the job's landing in the caller's scope, as 29's count. |
| **33-I2** `respond_to_invitation` (redefined) | Before, it answered any invitation of the business, delivered or not, overwrote an earlier answer, and wrote no audit row. Now, under the row lock it already took: only a delivered invitation; one that is not delivered, another business's and an unknown id all read `Invitation not found` (`P0002`). An answer is recorded once: the same answer again and a later `viewed` change nothing, and a different answer is refused (`23514`). That closes the concurrent-answer race Codex found on PR #346. Each recorded response is audited (`invitation.viewed`, `.interested`, `.declined`). | A member of the recipient business. |
| **33-T** `remove_team_member(p_membership_id)` (#249) | Sets the membership to `removed` (26's guard stamps `ended_at`), clears its landing limits and audits `membership.removed`. Access ends at once, because every access helper reads active memberships. The last active owner cannot be removed; a member already removed is left as is. | An owner of that business; another business's membership and an unknown id both read `Membership not found`. |
| **33-A1** `admin_set_org_verification`, `admin_read_landing_private` (redefined) | Both wrote an audit row for an id that does not exist. They now refuse it (`Organization not found`, `Landing not found`, `P0002`) before anything is written. | Platform staff, as before. |
| **33-A2** `admin_resolve_report(p_report_id, p_status, p_reason)` (#255) | Marks a report `reviewing`, `actioned` or `dismissed`. Actioned and dismissed need a note of 5 to 1000 characters, stored as the resolution note. A resolved report keeps its outcome. Audited. `abuse_reports` has no client `UPDATE` grant, so this is the only path. | A platform moderator (a superadmin passes). |
| **33-Q1** inquiry pages (#280) | `list_marketplace_interests` takes `p_limit` (1 to 200), a keyset cursor (`p_after_at`, `p_after_id`: the last row's `updated_at` on the hauler side or `created_at` on the landing side, and its id), `p_job_ids`, `p_interest_id`, `p_queue` and `p_with_replies`. Without them it returns what it returned before, except that `job_accepting_interest` now follows 31's day-14 rule. `count_marketplace_interests(p_org_id, p_side)` returns the three tab counts. `get_marketplace_interest(p_interest_id)` returns one inquiry to either of its sides, and no row to anyone else. `interest_queue` is the one definition of a tab, the same as the contract's: for a landing, a replied inquiry is back in New when the hauler wrote last. | The list's rule: `interest.reply` on the hauling business or `inquiry.respond` on the landing business, and the landing scope (26-B) in the list, the counts and the single read. |
| **33-Q2** `list_marketplace_jobs_page` (#280) | Find Work as pages. The two CTEs are 31's `list_marketplace_jobs`, plus the filters the adapter applied in memory: equipment setups, product (or every stated product outside a list, for "Other"), start date, and distance from a typed place given as latitude and longitude and snapped to the 0.10 degree grid. The order is the contract's `compareMarketplaceJobs` for `newest`, `nearest` and `pay`, with the job id as the last key, so a keyset cursor resumes exactly. Each row carries `total_count` (the whole search) and `page_cursor`. A cursor of another sort, or a malformed one, is refused (`22023`). `list_marketplace_jobs` is unchanged. | `anon` and `authenticated`, as `list_marketplace_jobs`: the same visibility rule and public-safe fields. |

**The job cursor.** `{"s": sort, "k": [five order keys as text], "t": title, "i": job id}`. The keys are text because a JSON number would lose a timestamp's microseconds in a JavaScript client. All five keys ascend (a descending value is negated), so the next page is one row comparison. Titles compare in the `C` collation so the order does not depend on the database's locale. Sponsored placement is not applied to pages, since the contract's order has none; `sponsored` is always false there until the boosts feature defines it.

**Not in 33.** A SQL function for editing a published job: #247 shipped `editJob` as a statement that runs as the person under `job_postings`' row-level security, column grants and triggers, and a `SECURITY DEFINER` copy would be a second path to keep in step. A request key on `reserve_targeted_invitation` (optional in #250). A two-session race test for two different answers to one invitation; the rule is decided under `FOR UPDATE` (`37` adds that test).

`34` checks each function as every kind of caller, then by its effect. Locally, on PGlite, it fails on a 31 schema at its first assertion. It also fails with any one of the three redefinitions put back, and with one check of a new function broken (the recipients' landing scope, the single answer, the owner rule and the cleared limits of a removal, the moderator role and the final outcome of a report, the id tie-break of the inquiry cursor, the landing scope of the counts, and the cursor, the day-14 rule and the setups filter of the job pages).

* **33 is in the migration chain everywhere 31 is.** `MIGRATION_CHAIN` applies it, so the ledger is now `06,11,12,16,18,23,26,29,31,33`. The seed, both adapter contract tests and the owner tool's tests pin that ledger. In `normalized-v2-ci.yml`, the alignment and Supabase jobs run 33 and 34 right after 32. The adapter-contract job runs 33 after 31.
* **Catalogue.** `MARKETPLACE_FUNCTIONS` has the seven callable functions with their access notes (`interest_queue` has no grant and is not catalogued), the page arguments of `list_marketplace_interests`, and a `timestamptz` argument type that passes a row's own timestamp back as text.

### Stage 35: `35_v2_day14_direct_reads_unsubscribe_keys.sql` (#361)

Migration 35 carries the follow-ups #294 left: the day-14 rule on direct table reads, housekeeping and key rotation for the unsubscribe link, and the race tests. It adds four functions, redefines two, and adds two restrictive row-level security policies, one column (`notification_unsubscribe_keys.retired_at`) and one unique index. It changes no table list, no other policy and no grant of an existing function, and no stored row (with one stated exception below). Stage 35 in CI checks that exact set (functions by source and grant, tables, columns, indexes, policies). `10` proves on existing data that no row changes and that anon then reads exactly the jobs that take new interest; `15` drills 35 like the earlier migrations. Tests: `36_v2_day14_direct_reads_unsubscribe_keys_tests.sql` (56 assertions); after it, stage 36 runs `04`, `07`, `09`, `13`, `17`, `19`, `21`, `27`, `30`, `32` and `34` again on the 35 schema. The two-session races are `37_v2_day14_unsubscribe_concurrency_test.sh`, and `14` checks the rule over PostgREST.

| Rule | Before 35 | 35 |
|---|---|---|
| **35-R** the day-14 rule on direct reads (#361, deferred by PR #350) | 31 took an active job off `list_marketplace_jobs`, `list_marketplace_jobs_page` and `search_job_postings` from 14 x 24 hours after its last confirmation, and `job_takes_new_interest` stopped new interest. But `job_postings`' row-level security still showed it to anyone who could read a public job: anon and any signed-in person through PostgREST, and a hauling business with an inquiry or an invitation on it. `job_posting_equipment` listed its id and equipment. | A restrictive `SELECT` policy, `job_postings_day14`, applies the lists' own clause to every direct read, through `job_day14_visible(org_id, status, last_confirmed_at)`: a job that is not active is left to the other policies; an active job is visible while `job_confirmation_current` (31's one boundary) holds, and otherwise only to its own landing desk (owner, manager or staff with a seat) and platform staff. It takes the row's columns, not its id, so the owner's `INSERT ... RETURNING` still works. `job_equipment_day14` hides a hidden job's equipment the same way (`job_day14_visible_by_id`). Both helpers are `SECURITY DEFINER`, granted to `anon` and `authenticated`, because the reader runs the policy and anon cannot execute `my_org_ids`. Reconfirming restores the job at once. `get_marketplace_job` still returns the job by id, as 31 decided. |
| **35-P** pruning (#361) | No worker pruned `notification_unsubscribe_uses`. | `prune_unsubscribe_tokens()`, `service_role` only, returns `(uses_pruned, keys_pruned)`. A token is stored only once used, and its use record is what refuses a second use, so the prune deletes the records of tokens that have **expired**, and retired keys whose grace window has ended. It is safe while links are in use: `unsubscribe_with_token` now also checks the expiry on the clock after recording a use, so a use recorded after the prune removed the first one (necessarily after the expiry) is refused, even in a transaction that began before the expiry. |
| **35-K** key rotation (#361) | 31's note said to rotate by inserting a key; every stored key verified, so an old key verified for as long as it was stored. | `rotate_unsubscribe_key(p_revoke_previous)`, `service_role` only, audited (`notification.unsubscribe_key_rotated`, with the new key's id, never a secret). New tokens are signed with the new key. **Decision (2026-11-11, #361): a grace window, the token's own lifetime.** By default the previous key is retired and keeps verifying the tokens it signed while it was current, and nothing else: `unsubscribe_with_token` accepts an expiry no later than 90 days (the longest lifetime `issue_unsubscribe_token` grants) after the retirement, so a retired key verifies nothing from 90 days after it was retired, and the prune deletes it then. An unsubscribe link in an email sent before a routine rotation keeps working until it expires, as the law and the email providers expect of an unsubscribe link. For a key that may have leaked, `p_revoke_previous => true` fails closed instead: every earlier key is deleted at once and every token they signed stops working. A unique index allows one current key. A rotation takes the rotation lock exclusively and minting takes it shared, so a key is never retired while a token it signs is still being minted. |

**The one change to stored rows.** If an operator already rotated by hand under 31's note (more than one key), every key but the newest is marked retired when 35 runs, so it keeps verifying its own tokens for 90 days from then. 31 itself stores no key, so a table as 31 left it is not touched.

**What reads `job_postings` with the caller's rights.** No marketplace function: every function that reads the table is `SECURITY DEFINER`, owned by the migration role, so row-level security does not apply to it, and the one `SECURITY INVOKER` function naming the table, `tg_set_updated_at`, only compares the trigger's table name. The statements that do run as the person read only the person's own business's jobs, which the rule keeps visible to its desk: the adapter's `own_jobs`, `own_job_lock` and `own_job_edit` (#247), its inquiry-jobs read and the landings' active-job count, and the two `job_posting_equipment` write policies. `36` runs each of them on a stale job, and asserts that the set of invoker functions and policies reading the table stays exactly this.

`36` asserts the leak first: on a database without 35, anon reads a job confirmed 20 days ago and the suite stops there. It then checks every reader (anon, a signed-in person in no business, the inquiring hauler and its driver, an invited hauler, a rival, the owner, the manager, staff limited to one landing, a driver without a seat, platform staff) against every job (current, a microsecond inside the boundary, exactly at it, 20 days old, never confirmed, paused, stale at another landing): a direct read shows a job exactly when `list_marketplace_jobs` and `list_marketplace_jobs_page` list it, and, for the public, exactly when `search_job_postings` finds it and `job_takes_new_interest` takes interest. Then: equipment, reconfirming, the caller-rights statements, the rotation's grace window and its 90-day bound, revocation, the prune keeping what still matters, and, in one session, a pruned token presented again in a transaction that began before it expired. Locally, on PGlite, the suite fails on a 33 schema at the leak, and at the named assertion with each part of 35 broken: either policy dropped, the boundary made inclusive, the desk or platform staff left out, drivers let in, non-active jobs caught, the equipment default reversed, the clock check or the retired-key bound removed, a rotation that does not retire, a revocation that only retires, a prune that deletes unexpired records, deletes a key on retirement or keeps old keys, the one-current-key index dropped, and the prune granted to signed-in people.

**Races (`37`).** R1: one unsubscribe link used twice at once; the second use waits on the first one's use record, then finds the token used, and the email the person turned back on stays on (one use record, one audit row). R2: two different answers to one delivered invitation at once; the second waits on `respond_to_invitation`'s row lock and is refused (`23514`); one answer is recorded and audited. R3: a key rotation while a token is being minted; the rotation waits for the minting transaction, then retires that key, and the token still works. Each race proves the ordering from the sessions' own clocks and rejects deadlocks and timeouts, as `28` does.

* **35 is in the migration chain everywhere 33 is.** `MIGRATION_CHAIN` applies it, so the ledger is now `06,11,12,16,18,23,26,29,31,33,35`. The seed, both adapter contract tests and the owner tool's tests pin that ledger; `27`, `30`, `32` and `34` accept it when stage 36 runs them again, and `04` counts 125 functions. In `normalized-v2-ci.yml`, the alignment and Supabase jobs run 35 and 36 right after 34, and 37 after 28. The adapter-contract job runs 35 after 33.
* **Catalogue.** No new callable function: `prune_unsubscribe_tokens` and `rotate_unsubscribe_key` are `service_role` only (the email worker's housekeeping), and the two day-14 helpers serve row-level security. All four are listed as never catalogued.
* **Not in 35.** The email worker's schedule for the prune and the operator's runbook for a rotation (when to rotate, and when to revoke) are operations work; the adapter does not call these functions. `docs/CI.md` §3 is not updated here (another task owns that file).

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

### 8.4 Deploying to a database the app uses, and the synthetic seed (#200)

`tools/normalized-store.mjs` applies the migration chain (01, 02, 03, 06, 11, 12, 16, 18, 23) to one database in
CI's order, one transaction per file, skipping what the ledger or the 01–03 baseline objects show is applied. It
also registers the adapter's issuer row and creates the adapter's login role. A test keeps its chain equal to the
`run_migration` stages of `tools/normalized-v2-ci/run-stage.sh` and to the order every CI job applies them.
`seed/pilot_demo_seed.sql` loads the pilot demo businesses into an empty store with the pilot seed's ids. It writes
through the schema's triggers and functions, and checks its own result before it commits. The owner runbook is
[`docs/INTEGRATIONS.md`](../../docs/INTEGRATIONS.md) §15. CI runs both on disposable databases in
`.github/workflows/normalized-adapter-ci.yml`, the seeded-store jobs.
