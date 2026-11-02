# LogLoads — Data Model: Current, V2 Target and Historical Records

> **Status:** Transitional. This file describes current runtime and proposed normalized domain; it is **not** a migration file or authorization to change production. Source: `architecture/normalized-v2/ARCHITECTURE.md` and approved product/UX specifications.

## Current canonical persistence

`public.operating_state(id='primary', state, schema_version, version)` is the existing Supabase JSON-document store. Services mutate the versioned canonical state with compare-and-swap; a non-production local JSON snapshot may be used for development. `public.rate_limit_windows` is a separate operational counter table. `packages/db/src/types.ts` and `seed-data.ts` remain the authoritative description of current pilot collection structures. Do not call these collections native relational V2 tables.

The first `/v2` preview reuses public-safe pilot job projections and appends inquiries to a `marketplaceInterests` collection; it does not imply that `marketplace.job_postings` or `marketplace.expressions_of_interest` has been activated.

## Proposed normalized V2 entities (32 tables in Gemini's report)

| Domain | Proposed tables | Business meaning |
|---|---|---|
| Identity/admin | `trusted_identity_issuers`, `app_users`, `identity_links`, `user_contacts`, `platform_admins` | Clerk identity linkage, contacts, separate staff access |
| Organizations | `organizations`, `organization_memberships`, `notification_preferences` | Many-to-many membership and preferences |
| Haulers/fleets | `hauler_profiles`, `user_qualifications`, `equipment_types`, `equipment_units`, `availability_reports` | Free business profile, equipment, self-reported availability |
| Landing/jobs | `landings`, `landing_private_details`, `job_postings`, `job_posting_equipment`, `job_templates`, `saved_searches` | Public approximate places, private access, long-lived job advertisements |
| Inquiry | `expressions_of_interest`, `interest_messages` | Nonbinding business inquiries and permitted replies |
| Billing policy | `subscription_plans`, `promotions`, `promotion_redemptions`, `organization_subscriptions`, `entitlement_periods` | Versioned paid landing entitlements and promotions |
| Proactive invitation | `targeted_invitations`, `invitation_deliveries` | Opt-in delivery, quota reservation and reconciliation |
| Boost | `boost_products`, `job_boosts` | Sponsored one-job, fixed-duration promotion |
| Trust | `abuse_reports`, `audit_events` | Moderation and immutable evidence |

Counts and names are the **proposed prototype**, not verified deployed database objects. Relational SQL and RLS must be executed and reviewed before launch. The target supports one login with memberships in landing and hauling organizations; paid landing-seat rules should not cap free fleet-only users in a dual-capability company.

## V2 core invariants

- A job belongs to an authorized landing organization and a landing; posting is an **advertisement**, not a dispatch order.
- Job statuses distinguish draft/active/paused/filled/expired/closed where supported; publishing and reconfirmation require truthfully sourced timestamps. `updatedAt` is **not** automatically a confirmation timestamp.
- Pay amount and basis are poster statements, never guaranteed earnings. Numeric pay requires its unit; unspecified/negotiable is labeled rather than invented.
- Trucks requested in total, trucks per day, and expected loads/day are distinct values. Self-reported availability must show its reported timestamp and scope.
- Hauler inquiry uniqueness, ability to update/withdraw, landing reply/decline, and idempotent retries are business rules. An inquiry is neither an invitation debit nor an assignment.
- Private landing coordinates, gate codes and restricted contacts are not present in public list/detail/map responses; explicit permission and audit are required before disclosure.
- Targeted invitations require opt-in, deduplication and atomic monthly allowance. Failed deliveries reconcile without duplicate charge. Ordinary inbound inquiry and reply are unlimited.
- Base subscription limits, founding reductions and boosts match `packages/contracts/src/membership.ts`; all paid enforcement is server-side.

## Migration mapping / retention

| Current pilot family | Target | Disposition |
|---|---|---|
| Profiles, company/org records and memberships | `app_users`, identity links, orgs and memberships | Preserve legitimate user/org IDs; reconcile duplicates and nonstandard historical roles |
| Drivers, truck/trailer records, equipment | Hauler profiles and equipment units | Translate business ownership without suggesting verification of capacity |
| Landings, rich details, mills/destinations | Landings, protected details, job destination fields | Redact precise locations by design |
| Load postings, capacity and rates | V2 jobs and job equipment | Map cautiously: pilot load events/slot counts are not identical to V2 opportunities |
| Messages/threads | Inquiries/replies where semantically valid | Do not re-label dispatch communications as consenting marketplace inquiries |
| Subscription and fee/trip/accounting events | **Historical read-only archive/legacy store** | Retain exact financial obligations, frozen terms, receipt/webhook reconciliation and audit provenance; do not erase or reclassify them |

Before any production migration: full export and verification, object-level mapping and quarantine list, reversible integration flag, read/write parity evidence, access-control tests, and an explicitly approved rollout/rollback procedure. Never treat a successful SQL count or fixture-only preview as evidence of full migration correctness.
