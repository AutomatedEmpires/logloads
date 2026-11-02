# LogLoads — Data Model: Current, V2 Target, and Historical Records

> **Status:** Transitional; revised 2026-11-01. This file describes the current runtime store and the proposed
> normalized domain. It is **not** a migration file and grants no authority to change production.
>
> **Sources:**
> - `packages/db/src/types.ts` and `snapshot.ts` (current);
> - `architecture/normalized-v2/01_schema.sql` (proposed, uncommitted at this revision);
> - the approved product and UX specifications.

## 1. Current canonical persistence (CURRENT)

`public.operating_state(id='primary', state, schema_version, version)` is the existing Supabase JSON-document
store. Services mutate the versioned canonical state with compare-and-swap. Outside production, a local JSON
snapshot (`LOGLOADS_STATE_FILE`) may be used for development.

`public.rate_limit_windows` is a separate operational counter table.

`packages/db/src/types.ts`, `snapshot.ts` (the read-time row schemas), and `seed-data.ts` are the
authoritative description of the current collections. Do not call these collections relational V2 tables.

The `/v2` preview reads public-safe pilot job projections and appends inquiries to the additive
`marketplaceInterests` collection (`snapshot.ts`, `seed-data.ts`). That does **not** mean
`marketplace.job_postings` or `marketplace.expressions_of_interest` is active anywhere.

## 2. Proposed normalized V2 entities (TARGET — 32 tables)

| Domain | Proposed tables | Business meaning |
|---|---|---|
| Identity/admin | `trusted_identity_issuers`, `app_users`, `identity_links`, `user_contacts`, `platform_admins` | Clerk identity linkage, contacts, separate staff access |
| Organizations | `organizations`, `organization_memberships`, `notification_preferences` | Many-to-many membership and preferences |
| Haulers/fleets | `hauler_profiles`, `user_qualifications`, `equipment_types`, `equipment_units`, `availability_reports` | Free business profile, equipment, self-reported availability |
| Landings/jobs | `landings`, `landing_private_details`, `job_postings`, `job_posting_equipment`, `job_templates`, `saved_searches` | Public approximate places, private access, long-lived job advertisements |
| Inquiry | `expressions_of_interest`, `interest_messages` | Nonbinding business inquiries and replies |
| Billing policy | `subscription_plans`, `promotions`, `promotion_redemptions`, `organization_subscriptions`, `entitlement_periods` | Versioned paid landing entitlements and promotions |
| Proactive invitation | `targeted_invitations`, `invitation_deliveries` | Opt-in delivery, quota reservation, reconciliation |
| Boost | `boost_products`, `job_boosts` | Sponsored one-job, fixed-duration promotion |
| Trust | `abuse_reports`, `audit_events` | Moderation and immutable evidence |

These names come from the prototype DDL. None is a deployed database object. The SQL and RLS must execute
and be reviewed first ([`RUNNERS.md`](./RUNNERS.md) §3).

## 3. V2 core invariants

- **Jobs are advertisements.** A job belongs to an authorized landing organization and a landing. Posting it
  never creates a dispatch order.
- **Status and freshness.** Job statuses distinguish draft, active, paused, filled, expired, and closed.
  `lastModifiedAt`, `lastConfirmedAt`, and `expiresAt` are separate fields. An edit is **never** a
  confirmation, and no pilot job is labelled confirmed.
- **Pay.** Pay amount and basis are poster statements, never guaranteed earnings. A numeric pay always has a
  unit. Unspecified or negotiable pay is labelled as such, never invented.
- **Volumes are separate values.** Trucks for the whole job, trucks per working day, loads per truck per day,
  whole-job loads per day, and tons per load are distinct and nullable in the V2 contract (`4c9518e`). Unknown
  values show "Not stated".
  - The prototype's `job_postings` has `trucks_requested` and `est_daily_loads`, but no trucks-per-day or
    loads-per-truck column.
  - Pilot capacity counts truckloads, so the pilot never fills "trucks for the job".
  - See the gap list in [`product/TRANSITION_PLAN.md`](./product/TRANSITION_PLAN.md).
- **Availability** is self-reported and always shows its timestamp and scope.
- **Inquiry rules.** Uniqueness per hauler business and job, withdraw and update, landing reply or decline,
  and idempotent retries are business rules. An inquiry is neither an invitation debit nor an assignment.
- **Private details.** Private landing details are absent from public list, detail, and map responses.
  Disclosure needs explicit permission plus an audit record.
- **Targeted invitations** need opt-in, deduplication, and an atomic allowance. Failed deliveries are
  reconciled without a double charge. Inbound inquiries and replies stay unlimited.
- **Plan limits, founding discounts, and boosts** match `packages/contracts/src/membership.ts`. All paid
  enforcement happens on the server.

## 4. Migration mapping and retention

| Current pilot family | Target | Disposition |
|---|---|---|
| Profiles, organizations, memberships | `app_users`, `identity_links`, organizations, memberships | Preserve legitimate IDs. Reconcile duplicates and non-standard historical roles. |
| Drivers, truck/trailer records, equipment | Hauler profiles, equipment units | Translate ownership without implying verified capacity |
| Landings, rich details, mills/destinations | Landings, `landing_private_details`, job destination fields | Redact precise locations by design |
| Load postings, capacities, rates | V2 jobs and job equipment | Map cautiously. Pilot load events and slot counts are not V2 opportunities. |
| `marketplaceInterests` | `expressions_of_interest`, `interest_messages` | Direct mapping intended |
| Message threads | Inquiries/replies, where semantically valid | Do not relabel dispatch communications as marketplace inquiries |
| Subscription, fee, invoice, trip, and accounting records | **Historical read-only legacy store or archive** | Retain exact obligations, frozen terms, receipts, webhook reconciliation, and audit provenance. Never erase or reclassify them. |

Before any production migration, all of these must exist:

- a full export, verified ([`RECOVERY.md`](./RECOVERY.md));
- an object-level mapping and a quarantine list;
- a reversible integration flag;
- read/write parity evidence;
- access-control tests;
- an explicitly approved rollout and rollback ([`DEPLOYMENT.md`](./DEPLOYMENT.md) §5).

A successful SQL row count or a fixture-only preview is not evidence that a migration is correct.
