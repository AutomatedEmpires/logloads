import "server-only"

import type { Sql, TransactionSql } from "postgres"

import { marketplaceQueryStatement, type MarketplaceQueryName, type MarketplaceQueryValue } from "./normalized-queries"
import { MarketplaceAdapterConfigurationError, MarketplaceRefusalError, MarketplaceStoreError } from "./port"

/**
 * How the server reaches the normalized `marketplace` schema (architecture/normalized-v2).
 *
 * Identity path (docs/SECURITY.md §4): the server authenticates the person through its own session (Clerk, verified by
 * the Clerk SDK) and then calls the schema's functions AS that person. Every call runs in its own transaction that:
 *
 *   1. switches to the database role `authenticated` (or `anon` for public discovery) with `set_config('role', …, true)`;
 *   2. sets `request.jwt.claims` to the session's issuer, Clerk user id and audience, with a 60-second expiry;
 *
 * exactly as PostgREST does after verifying a token. `marketplace.current_user_id()` then resolves the person through
 * `trusted_identity_issuers` and `identity_links`, and every function and row-level security policy applies to them.
 * Both settings are transaction-local, so a pooled connection never carries one person's identity into the next call.
 *
 * The connection's own login role must be unable to do anything by itself: no superuser, no BYPASSRLS, no inherited
 * privileges, no ownership of anything in the schema, no membership of `service_role` or of any superuser, BYPASSRLS
 * or CREATEROLE role, and no membership of any role beyond what `anon` and `authenticated` already reach (HF-22).
 * `checkCredential` proves this on first use and refuses to run otherwise. This is not a service-role path: the
 * service role holds no EXECUTE on any user function in this schema, and this adapter never uses it.
 *
 * Only the functions in `MARKETPLACE_FUNCTIONS` can be called, with their declared argument names and types; every
 * value is a bound parameter. Rows come back as `to_jsonb(row)`, the same JSON PostgREST returns, so the mapping in
 * `normalized-mapping.ts` does not depend on this driver.
 */

export interface MarketplacePrincipal {
  /** An enabled `marketplace.trusted_identity_issuers` row: the Clerk instance's issuer for this environment. */
  issuer: string
  /** The session's Clerk user id (`identity_links.subject`). */
  subject: string
  /** The issuer's pinned `expected_audience` (LE-09). */
  audience: string
}

/**
 * The SQL types a catalogued argument may have. Two are checked here before the server sees them:
 *
 * - `interval`: a whole number of seconds, minutes, hours or days as text (`"7 days"`, `"1 hour"`). No months or years
 *   (their length varies), no signs, no fractions and no compound values.
 * - `uuid[]`: an array of canonical UUID strings; an empty array is an empty `uuid[]`.
 * - `timestamptz`: an ISO 8601 instant with an offset or `Z`, as text, exactly as a row returned it. A keyset cursor
 *   passes a row's own timestamp back, so its microseconds must survive; a JavaScript `Date` would drop them.
 */
type ArgumentType =
  | "uuid"
  | "text"
  | "bpchar"
  | "integer"
  | "bigint"
  | "numeric"
  | "boolean"
  | "date"
  | "interval"
  | "jsonb"
  | "text[]"
  | "uuid[]"
  | "timestamptz"

interface FunctionSpec {
  args: Readonly<Record<string, ArgumentType>>
  /** Callable in an anonymous (public discovery) session. */
  anonymous: boolean
  /**
   * Granted to `anon` and to no other role: callable only in an anonymous session, never as a signed-in person. Such
   * a function writes, so it needs `asAnon(..., { readOnly: false })`.
   */
  anonymousOnly?: true
  /** `rows`: a set-returning function; `value`: one scalar; `void`: nothing. */
  returns: "rows" | "value" | "void"
}

/**
 * The closed list of database functions the adapter may call. Names, argument names and argument types match the SQL
 * exactly (architecture/normalized-v2, stages 01-35; 35 adds no callable function).
 *
 * Every function here is SECURITY DEFINER with a pinned `search_path`, is granted EXECUTE to `authenticated` (and to
 * `anon` only where `anonymous` is true) and never to `service_role`; `normalized-adapter.contract.test.ts` proves
 * those grants against the database. The one exception is the signed-out unsubscribe link, `anonymousOnly`: granted
 * to `anon` and to no one else. A SECURITY DEFINER function bypasses row-level security, so its own checks are
 * the whole access rule. Each entry added for port v3 (#269) states that rule: who may call it and which in-function
 * checks it relies on. A function is added only with that review, and `normalized-db.test.ts` lists every reviewed
 * name: an entry that is not in that list fails the test.
 *
 * Never catalogued: anything granted to `service_role` only (the email worker's `claim_email_notifications`,
 * `complete_email_notification`, `record_email_provider_event`, `enqueue_job_alerts` and `issue_unsubscribe_token`,
 * which mints the unsubscribe links, and since 35 `prune_unsubscribe_tokens` and `rotate_unsubscribe_key`, the link's
 * housekeeping; billing events; identity sync), and helpers with no EXECUTE grant (`eligible_invitation_recipients`,
 * `hmac_sha256`, `job_confirmation_current`). `job_takes_new_interest` and 35's `job_day14_visible` and
 * `job_day14_visible_by_id` serve row-level security policies and are not called from here. Since 35, `job_postings`
 * and `job_posting_equipment` hide an active job past day 14 from direct reads outside its landing desk, as the list
 * functions do; the desk's own-jobs statements (`normalized-queries.ts`) still see its stale jobs. This connection
 * cannot become `service_role` (HF-22).
 */
export const MARKETPLACE_FUNCTIONS = {
  // A business owned by the caller, who becomes its owner (03_entitlements.sql, 06 §4): a landing business (#127) or,
  // with p_enable_hauler, a hauling business (#213, which leaves p_home_state to the function's default).
  create_organization: {
    anonymous: false,
    args: { p_display_name: "text", p_enable_hauler: "boolean", p_home_state: "bpchar", p_slug: "text" },
    returns: "value"
  },
  get_marketplace_job: { anonymous: true, args: { p_job_id: "uuid" }, returns: "rows" },
  // Landing workspace (#127, #133): plan, counts and the current cycle's invitations (03_entitlements.sql).
  get_org_entitlement_state: { anonymous: false, args: { p_org_id: "uuid" }, returns: "rows" },
  get_viewer_marketplace_access: { anonymous: false, args: { p_org_id: "uuid" }, returns: "rows" },
  list_authoring_landings: { anonymous: false, args: { p_org_id: "uuid" }, returns: "rows" },
  list_hauler_equipment_options: { anonymous: false, args: { p_org_id: "uuid" }, returns: "rows" },
  // Since 33 (#280) it also pages: `p_limit` (1 to 200) with the keyset cursor `p_after_at` and `p_after_id` (the last
  // row's `updated_at` on the hauler side, `created_at` on the landing side, and its id), `p_job_ids`, one inquiry
  // (`p_interest_id`), one tab (`p_queue`: active/replied/closed for a hauler, new/responded/closed for a landing), and
  // `p_with_replies: false` to leave the messages out. Same access rule as before: `interest.reply` on the hauling
  // business or `inquiry.respond` on the landing business, and the landing scope (26-B).
  list_marketplace_interests: {
    anonymous: false,
    args: {
      p_after_at: "timestamptz",
      p_after_id: "uuid",
      p_interest_id: "uuid",
      p_job_id: "uuid",
      p_job_ids: "uuid[]",
      p_limit: "integer",
      p_org_id: "uuid",
      p_queue: "text",
      p_side: "text",
      p_with_replies: "boolean"
    },
    returns: "rows"
  },
  // Authenticated (33, #280). The list's access rule and landing scope. Returns the three tab counts of one side.
  count_marketplace_interests: { anonymous: false, args: { p_org_id: "uuid", p_side: "text" }, returns: "rows" },
  // Authenticated (33, #280). One inquiry, to a member of its hauling business who may act on inquiries or to its
  // landing desk within the landing scope; no row for anyone else or for an unknown id (never an error that tells
  // them apart). The row is the list's row.
  get_marketplace_interest: { anonymous: false, args: { p_interest_id: "uuid" }, returns: "rows" },
  // Anonymous (33, #280). Find Work as pages: the visibility rule of `list_marketplace_jobs` (`can_read_job_posting`,
  // the day-14 rule), public-safe fields only, plus `total_count` and `page_cursor`. Filters: text, one equipment
  // code, pay basis, poster, a typed place as `p_lat`/`p_lng` (snapped to the 0.10 degree grid in SQL) with
  // `p_radius_miles`, `p_product` or `p_product_excluded` (every stated product outside that list: "Other"),
  // `p_starts_by`, and `p_equipment_setups` (an array of arrays of equipment codes). `p_sort` is newest, nearest or
  // pay, the contract's order with the job id last. `p_after` is the `page_cursor` of the previous page's last row;
  // a cursor of another sort is refused (22023). `sponsored` is always false on pages.
  list_marketplace_jobs_page: {
    anonymous: true,
    args: {
      p_accepting_only: "boolean",
      p_after: "jsonb",
      p_equipment: "text",
      p_equipment_setups: "jsonb",
      p_lat: "numeric",
      p_limit: "integer",
      p_lng: "numeric",
      p_org_id: "uuid",
      p_pay_unit: "text",
      p_product: "text",
      p_product_excluded: "text[]",
      p_query: "text",
      p_radius_miles: "integer",
      p_sort: "text",
      p_starts_by: "date"
    },
    returns: "rows"
  },
  list_marketplace_jobs: {
    anonymous: true,
    args: { p_accepting_only: "boolean", p_equipment: "text", p_limit: "integer", p_org_id: "uuid", p_pay_unit: "text", p_query: "text" },
    returns: "rows"
  },
  post_hauler_interest_reply: { anonymous: false, args: { p_body: "text", p_interest_id: "uuid", p_reply_id: "uuid" }, returns: "void" },
  publish_job_posting: {
    anonymous: false,
    args: {
      p_attest_available: "boolean",
      p_description: "text",
      p_destination_label: "text",
      p_duration_days: "integer",
      p_equipment_codes: "text[]",
      p_est_daily_loads: "integer",
      p_est_loads_per_truck_per_day: "numeric",
      p_est_one_way_miles: "integer",
      p_est_tons_per_load: "numeric",
      p_landing_id: "uuid",
      p_pay_amount_cents: "bigint",
      p_pay_note: "text",
      p_pay_unit: "text",
      p_product: "text",
      p_public_road_notes: "text",
      p_title: "text",
      p_trucks_per_day: "integer",
      p_trucks_requested: "integer",
      p_work_starts_on: "date"
    },
    returns: "value"
  },
  reconfirm_job_posting: { anonymous: false, args: { p_job_id: "uuid" }, returns: "value" },
  respond_to_interest: {
    anonymous: false,
    args: { p_body: "text", p_interest_id: "uuid", p_reply_id: "uuid", p_status: "text" },
    returns: "void"
  },
  submit_expression_of_interest: {
    anonymous: false,
    args: {
      p_available_from: "date",
      p_available_until: "date",
      p_contact_preference: "text",
      p_equipment: "jsonb",
      p_hauler_org_id: "uuid",
      p_job_id: "uuid",
      p_message: "text",
      p_trucks_offered: "integer"
    },
    returns: "rows"
  },
  withdraw_interest: { anonymous: false, args: { p_interest_id: "uuid" }, returns: "void" },

  // -------------------------------------------------------------------------------------------------------------
  // Port v3 (#244), catalogued with a security review in #269. "Member" means an active member of an active
  // business (`my_org_ids` / `has_org_role`); "seat" means a Landing Operator seat. Functions that write, including
  // the audited admin reads, need `asUser(..., { readOnly: false })`.
  // -------------------------------------------------------------------------------------------------------------

  // --- jobs (#247) ---
  // Authenticated. Checks `job.publish` on the landing's business through `get_viewer_marketplace_access` (active
  // member, seat, owner/manager/staff). Landing scope: `tg_landing_scope_guard` on `job_postings` (26). Edits only a
  // job that is still a draft of that business (`p_draft_job_id`), or creates a draft. Returns the draft's id.
  save_job_posting_draft: {
    anonymous: false,
    args: {
      p_description: "text",
      p_destination_label: "text",
      p_draft_job_id: "uuid",
      p_duration_days: "integer",
      p_equipment_codes: "text[]",
      p_est_daily_loads: "integer",
      p_est_loads_per_truck_per_day: "numeric",
      p_est_one_way_miles: "integer",
      p_est_tons_per_load: "numeric",
      p_landing_id: "uuid",
      p_pay_amount_cents: "bigint",
      p_pay_note: "text",
      p_pay_unit: "text",
      p_product: "text",
      p_public_access_requirements: "text[]",
      p_public_road_notes: "text",
      p_schedule_note: "text",
      p_title: "text",
      p_trucks_per_day: "integer",
      p_trucks_requested: "integer",
      p_work_starts_on: "date"
    },
    returns: "value"
  },
  // Authenticated. Checks `job.publish` on the job's business (as above); locks the job row. Landing scope:
  // `tg_landing_scope_guard` on the `job_postings` update. Never re-activates (that is `reactivate_job_posting`) and
  // refuses a draft. Audited. Since 31, like `reconfirm_job_posting` and `reactivate_job_posting`: a job of a business
  // the caller does not belong to gets the same "Job not found" (P0002) as an id that does not exist.
  set_job_posting_status: { anonymous: false, args: { p_job_id: "uuid", p_status: "text" }, returns: "void" },
  // Authenticated. Checks `job.publish` on the job's business; needs `p_attest_available = true`; refuses a moderation
  // hold, a passed expiry and invalid pay. Landing scope: `tg_landing_scope_guard`. Returns the confirmation time. Audited.
  reactivate_job_posting: { anonymous: false, args: { p_attest_available: "boolean", p_job_id: "uuid" }, returns: "value" },

  // --- team (#249) ---
  // Authenticated (33). `has_org_role(membership's org, owner)`; another business's membership and an unknown id both
  // read "Membership not found". Ends the member's access at once, clears their landing limits, never removes the last
  // active owner (23514), changes nothing for a member already removed. Audited.
  remove_team_member: { anonymous: false, args: { p_membership_id: "uuid" }, returns: "void" },
  // Authenticated. `has_org_role(org, owner)`: owners only. Returns invited email addresses, to the owner alone.
  list_team_invitations: { anonymous: false, args: { p_org_id: "uuid" }, returns: "rows" },
  // Authenticated. `has_org_role(org, owner)`. Never invites an owner; landings must belong to the business; the seat
  // cap counts pending invitations under a lock on the business; at most 50 pending. Returns the invitation id. Audited.
  invite_team_member: {
    anonymous: false,
    args: {
      p_email: "text",
      p_landing_ids: "uuid[]",
      p_landing_workspace_seat: "boolean",
      p_org_id: "uuid",
      p_role: "text",
      p_valid_for: "interval"
    },
    returns: "value"
  },
  // Authenticated. `has_org_role(invitation's org, owner)`; another business's invitation reads as not found. At most
  // five sends; never shortens the expiry. Returns the expiry. Audited.
  resend_team_invitation: { anonymous: false, args: { p_invitation_id: "uuid", p_valid_for: "interval" }, returns: "value" },
  // Authenticated. `has_org_role(invitation's org, owner)`; cancels the invitation's pending email. Audited.
  revoke_team_invitation: { anonymous: false, args: { p_invitation_id: "uuid" }, returns: "void" },
  // Authenticated. `has_org_role(membership's org, owner)`; only a seated manager or staff member can be limited, and
  // only to that business's landings. An empty array clears the limit. Returns the number of landings. Audited.
  set_membership_landing_scope: { anonymous: false, args: { p_landing_ids: "uuid[]", p_membership_id: "uuid" }, returns: "value" },
  // Authenticated, no business needed. Only pending invitations whose address is the caller's own provider-verified
  // email (`user_contacts.email_verified_at`). Shows the inviting business's name and the invitation's landing names.
  list_my_team_invitations: { anonymous: false, args: {}, returns: "rows" },
  // Authenticated, no business needed. The invitation's address must be the caller's verified email; refuses an
  // expired or answered invitation, an inactive business and an existing member. Returns the new MEMBERSHIP id (the
  // business id is in `list_my_team_invitations`). Audited.
  accept_team_invitation: { anonymous: false, args: { p_invitation_id: "uuid" }, returns: "value" },
  // Authenticated, no business needed. The invitation's address must be the caller's verified email. Audited.
  decline_team_invitation: { anonymous: false, args: { p_invitation_id: "uuid" }, returns: "void" },

  // --- invites (#250) ---
  // Authenticated. `has_org_role(job's org, owner/manager/staff, seat)` and, since 29, `job_scope_allows` (the #269
  // finding). Returns a count only, never who is eligible. Leave `p_dedupe_window` unset so the plan's window applies.
  count_eligible_invitation_recipients: {
    anonymous: false,
    args: { p_dedupe_window: "interval", p_job_id: "uuid", p_radius_miles: "integer" },
    returns: "value"
  },
  // Authenticated. `has_org_role(job's org, owner/manager, seat)`: staff cannot send. Landing scope:
  // `tg_landing_scope_guard` on the `targeted_invitations` insert. Re-checks eligibility and opt-in, the plan, seat and
  // landing conflicts, and spends one invitation of the cycle atomically (no overage). `tg_invitation_dedupe_floor`
  // (16) keeps the plan's dedupe window whatever `p_dedupe_window` says; leave it unset. Returns the invitation id. Audited.
  reserve_targeted_invitation: {
    anonymous: false,
    args: { p_dedupe_window: "interval", p_job_id: "uuid", p_note: "text", p_recipient_org_id: "uuid" },
    returns: "value"
  },
  // Authenticated. `has_org_role(recipient org, owner/manager/staff/driver)`. Since 33 (the #269 findings, #250): only
  // a delivered invitation; one that is not delivered, another business's and an unknown id all read "Invitation not
  // found" (P0002). An answer is recorded once under the row lock: the same answer again and a later `viewed` change
  // nothing, a different answer is refused (23514). Each recorded response is audited.
  respond_to_invitation: { anonymous: false, args: { p_invitation_id: "uuid", p_response: "text" }, returns: "void" },
  // Authenticated (33, #250). `has_org_role(job's org, owner/manager/staff, seat)` and `job_scope_allows`, as the
  // count. The businesses `eligible_invitation_recipients` allows, in name order with no ranking, at most 200. Public
  // profile fields only (name, home base, active equipment by type, last availability report, verification): never a
  // person, a phone, an email, a point or a landing's private details.
  list_invitation_recipients: { anonymous: false, args: { p_job_id: "uuid", p_radius_miles: "integer" }, returns: "rows" },

  // --- alerts (#252) ---
  // Authenticated. Member of the business (any role); only the caller's own saved jobs in it. A job that is held or
  // whose poster is not active comes back as `unavailable` with every other field null.
  list_saved_jobs: { anonymous: false, args: { p_org_id: "uuid" }, returns: "rows" },

  // --- notify (#253) ---
  // Authenticated. Changes only rows where `recipient_user_id = current_user_id()` and the channel is in-app; at most
  // 200 ids; anyone else's ids change nothing. Returns how many changed.
  mark_notifications_read: { anonymous: false, args: { p_notification_ids: "uuid[]" }, returns: "value" },
  // The signed-out unsubscribe link (#252; stage 31, reviewed in #294). `anon` ONLY: not `authenticated`, not
  // `service_role`. The token is the whole access rule: the function checks its HMAC-SHA-256 signature against a key
  // that never leaves the database, its expiry, and that it was not used before, then turns off the one (person,
  // business, category, channel) preference the token names and audits it. It returns nothing and raises nothing for
  // a malformed, forged, expired or used token, so it reveals nothing about the person or the business; show the
  // same confirmation whatever happens. It writes: call it with `asAnon(..., { readOnly: false })`, from a POST.
  // Tokens are minted by the email worker (`issue_unsubscribe_token`, `service_role` only, never catalogued).
  unsubscribe_with_token: { anonymous: true, anonymousOnly: true, args: { p_token: "text" }, returns: "void" },

  // --- boosts (#254) ---
  // Authenticated. `has_org_role(job's org, owner/manager/staff, seat)`. Returns counts only (the radius, opted-in
  // public haulers, active availability reports). Since 29 it also needs `job_scope_allows` (the #269 finding).
  estimate_boost_audience: { anonymous: false, args: { p_job_id: "uuid", p_product_code: "text" }, returns: "rows" },

  // --- admin (#255): LogLoads staff only. Granted to `authenticated`; each checks `is_platform_admin(roles)` against
  // `platform_admins` (not revoked; superadmin passes any role), never an organization role, needs a stated reason and
  // writes it to the audit log. A person who is not staff gets 42501.
  // Roles: moderator or support. Since 33 an unknown business is refused ("Organization not found", P0002) and not
  // audited (the #269 finding).
  admin_set_org_verification: { anonymous: false, args: { p_org_id: "uuid", p_reason: "text", p_status: "text" }, returns: "void" },
  // Role: moderator. Pauses, closes or expires the job and places the hold in one change.
  admin_moderate_job_posting: { anonymous: false, args: { p_job_id: "uuid", p_reason: "text", p_status: "text" }, returns: "void" },
  // Role: moderator. Removes the hold only; the job stays stopped until its poster reactivates it.
  admin_release_job_moderation_hold: { anonymous: false, args: { p_job_id: "uuid", p_reason: "text" }, returns: "void" },
  // Role: billing. The business must be active, verified and in the promotion's state; the promotion's limit is
  // counted under a lock. Returns the redemption id.
  admin_grant_founding_promotion: {
    anonymous: false,
    args: { p_org_id: "uuid", p_promotion_code: "text", p_reason: "text" },
    returns: "value"
  },
  // Roles: moderator, support or billing. Recognition only; numbered under a lock, at most 1000. Returns the number.
  admin_grant_founding_hauler_badge: { anonymous: false, args: { p_org_id: "uuid", p_reason: "text" }, returns: "value" },
  // Role: support. Reason of at least 10 characters; the audit row is written before the read. Returns the WHOLE
  // `landing_private_details` row (exact point, gate instructions, site contact): map only what the view shows.
  // Since 33 an unknown landing is refused ("Landing not found", P0002) and not audited (the #269 finding).
  admin_read_landing_private: { anonymous: false, args: { p_landing_id: "uuid", p_reason: "text" }, returns: "rows" },
  // Role: support. The audit row is written before the read. Returns the inquiry's messages, both sides.
  admin_read_interest_thread: { anonymous: false, args: { p_interest_id: "uuid", p_reason: "text" }, returns: "rows" },
  // Role: moderator (33, #255). `p_status` is reviewing, actioned or dismissed; actioned and dismissed need a note of
  // 5 to 1000 characters in `p_reason`, which becomes the report's resolution note. A resolved report keeps its
  // outcome (23514); an unknown report is "Report not found" (P0002). Audited.
  admin_resolve_report: { anonymous: false, args: { p_reason: "text", p_report_id: "uuid", p_status: "text" }, returns: "void" }
} as const satisfies Record<string, FunctionSpec>

export type MarketplaceFunctionName = keyof typeof MARKETPLACE_FUNCTIONS

export type MarketplaceArgumentValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly string[]
  | readonly object[]
  /** A `jsonb` object, such as a page cursor handed back as it was received. */
  | Readonly<Record<string, unknown>>

export type MarketplaceCallArguments<F extends MarketplaceFunctionName> = {
  [K in keyof (typeof MARKETPLACE_FUNCTIONS)[F]["args"]]?: MarketplaceArgumentValue
}

/** The two organizations an inquiry belongs to, as the caller's row-level security lets them see it. */
export interface MarketplaceInquiryParties {
  jobId: string
  jobOrganizationId: string
  haulerOrganizationId: string
}

// ---------------------------------------------------------------------------------------------------------------
// Landing workspace statements (#127, #133). The schema has no function for creating or editing a landing: its
// tables, column grants, row-level security and triggers ARE the interface (02_access.sql: `landings_insert`,
// `landings_update`, `landing_private_*`, `tg_landing_guard` for the plan cap, `tg_landing_after` to pause a landing's
// jobs). These statements run as the person inside the same identity-bound transaction as the functions, every value
// bound as text and cast in SQL. The public point is rounded to the 0.10 degree grid in SQL before it is written
// (V2-DEC-01; the trigger snaps it again), so the exact location only ever reaches `landing_private_details`.
// ---------------------------------------------------------------------------------------------------------------

/** The 0.10 degree public grid point for a latitude and longitude bound as text, or NULL when there is none. */
const publicPoint = (lat: string, lng: string) =>
  `case when ${lat}::text is null or ${lng}::text is null then null else extensions.st_setsrid(extensions.st_makepoint(round(${lng}::text::numeric, 1)::double precision, round(${lat}::text::numeric, 1)::double precision), 4326)::extensions.geography end`

const exactPoint = (lat: string, lng: string) =>
  `case when ${lat}::text is null or ${lng}::text is null then null else extensions.st_setsrid(extensions.st_makepoint(${lng}::text::double precision, ${lat}::text::double precision), 4326)::extensions.geography end`

export const LANDING_STATEMENTS = {
  /** $1 org id, $2 landing id or NULL for all. The private columns come back only where RLS lets the person see them. */
  own_landings: {
    params: 2,
    text: `select to_jsonb(r) as row from (
  select l.id, l.name, l.status, l.public_area_label, l.state_code, l.county, l.updated_at,
         extensions.st_y(l.public_point::extensions.geometry) as public_lat,
         extensions.st_x(l.public_point::extensions.geometry) as public_lng,
         extensions.st_y(p.exact_point::extensions.geometry) as exact_lat,
         extensions.st_x(p.exact_point::extensions.geometry) as exact_lng,
         p.gate_instructions, p.site_contact_name, p.site_contact_phone,
         (select count(*) from marketplace.job_postings j
          where j.landing_id = l.id and j.org_id = l.org_id and j.status = 'active')::integer as active_jobs
  from marketplace.landings l
  left join marketplace.landing_private_details p on p.landing_id = l.id and p.org_id = l.org_id
  where l.org_id = $1::text::uuid and ($2::text is null or l.id = $2::text::uuid)
  order by case l.status when 'active' then 0 when 'inactive' then 1 else 2 end, l.name, l.id
) as r`
  },
  /** $1 org, $2 name, $3 status, $4 area label, $5 lat, $6 lng, $7 state code, $8 county. */
  insert_landing: {
    params: 8,
    text: `insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code, county)
values ($1::text::uuid, $2::text, $3::text, $4::text, ${publicPoint("$5", "$6")}, $7::text, $8::text)
returning jsonb_build_object('id', id) as row`
  },
  /** $1 landing, $2 org, $3 name, $4 area label, $5 lat, $6 lng, $7 state code, $8 county. Never the status. */
  update_landing: {
    params: 8,
    text: `update marketplace.landings
set name = $3::text, public_area_label = $4::text, public_point = ${publicPoint("$5", "$6")}, state_code = $7::text, county = $8::text
where id = $1::text::uuid and org_id = $2::text::uuid
returning jsonb_build_object('id', id) as row`
  },
  /** $1 landing, $2 org, $3 lat, $4 lng, $5 gate instructions, $6 contact name, $7 contact phone. Directions are kept. */
  save_landing_private: {
    params: 7,
    text: `with changed as (
  update marketplace.landing_private_details
  set exact_point = ${exactPoint("$3", "$4")}, gate_instructions = $5::text, site_contact_name = $6::text, site_contact_phone = $7::text
  where landing_id = $1::text::uuid and org_id = $2::text::uuid
  returning landing_id
), added as (
  insert into marketplace.landing_private_details (landing_id, org_id, exact_point, gate_instructions, site_contact_name, site_contact_phone)
  select $1::text::uuid, $2::text::uuid, ${exactPoint("$3", "$4")}, $5::text, $6::text, $7::text
  where not exists (select 1 from changed)
  returning landing_id
)
select jsonb_build_object('id', coalesce((select landing_id from changed), (select landing_id from added))) as row`
  },
  /** $1 landing, $2 org, $3 store status (active, inactive, archived). The triggers enforce the cap and pause jobs. */
  set_landing_status: {
    params: 3,
    text: `update marketplace.landings set status = $3::text
where id = $1::text::uuid and org_id = $2::text::uuid
returning jsonb_build_object('id', id, 'status', status) as row`
  }
} as const satisfies Record<string, { params: number; text: string }>

export type LandingStatementName = keyof typeof LANDING_STATEMENTS

/** The reasons `marketplace.abuse_reports.reason` accepts (01_schema.sql). */
export type StoredAbuseReason = "inaccurate_pay" | "nonexistent_job" | "spam" | "impersonation" | "unsafe_disclosure" | "abuse" | "other"

/** A report row the reporter may read back (HF-16 grants the reporter these columns of their own reports). */
export interface StoredListingReport {
  id: string
  createdAt: string
}

/** What a unit of work can do inside one identity-bound transaction. */
export interface MarketplaceCalls {
  /** Rows as JSON objects (`rows`), `[value]` (`value`) or `[]` (`void`). */
  call<F extends MarketplaceFunctionName>(fn: F, args: MarketplaceCallArguments<F>): Promise<unknown[]>
  inquiryParties(interestId: string): Promise<MarketplaceInquiryParties | null>
  /** One catalogued landing statement (#127, #133) with exactly its bound values; rows as JSON objects. */
  landingStatement(name: LandingStatementName, values: ReadonlyArray<string | null>): Promise<unknown[]>
  /** Rows (JSON objects) of one catalogued table statement (`MARKETPLACE_QUERIES`, normalized-queries.ts). */
  query(name: MarketplaceQueryName, values: readonly MarketplaceQueryValue[]): Promise<unknown[]>
  /**
   * UX-09 (#132): the organization's jobs that have inquiries, as `INQUIRY_JOBS` rows (JSON). Row-level security
   * applies as for any direct read: only the owning desk sees them.
   */
  inquiryJobs(organizationId: string): Promise<unknown[]>
  /**
   * #213: the person the claims resolve to (`VIEWER_PERSON`, or `null` when they resolve to no one) and that person's
   * active memberships of active businesses (`VIEWER_MEMBERSHIPS`, `get_viewer_marketplace_access` rows), as JSON.
   */
  viewerSession(): Promise<{ person: unknown; memberships: unknown[] }>

  // --- Listing reports (UX-07, #130): the schema has no function for these, so they are two fixed statements that
  // run as the person under `abuse_reports`' row-level security and column grants (02_access.sql, HF-16).
  /** The person's own open or in-review report of a job posting, if any. */
  standingListingReport(jobId: string): Promise<StoredListingReport | null>
  /** Files a report of a job posting. The reporter is always the caller (`abuse_reports_insert`, default column). */
  fileListingReport(report: { jobId: string; reason: StoredAbuseReason; details: string | null }): Promise<StoredListingReport>
}

export interface MarketplaceDb {
  /**
   * Public discovery: the `anon` role, no identity. Read-only unless `readOnly` is false, which only the signed-out
   * unsubscribe link needs (`unsubscribe_with_token`, the one function `anon` holds that writes).
   */
  asAnon<T>(work: (calls: MarketplaceCalls) => Promise<T>, options?: { readOnly?: boolean }): Promise<T>
  /** One transaction as the given person (`authenticated` role). Read-only unless `readOnly` is false. */
  asUser<T>(principal: MarketplacePrincipal, work: (calls: MarketplaceCalls) => Promise<T>, options?: { readOnly?: boolean }): Promise<T>
  close(): Promise<void>
}

const CLAIMS_TTL_SECONDS = 60
const ANON_CLAIMS = JSON.stringify({ role: "anon" })

/** One round trip: no search path (every name is schema-qualified), the API role, and the claims. */
const SESSION_SETUP =
  "select set_config('search_path', '', true), set_config('role', $1::text, true), set_config('request.jwt.claims', $2::text, true)"

const INQUIRY_PARTIES =
  "select to_jsonb(e) as row from (select id, job_id, job_org_id, hauler_org_id from marketplace.expressions_of_interest where id = $1::text::uuid) as e"

/**
 * UX-09 (#132): the organization's jobs that have inquiries, with the landing each is posted at and the equipment
 * codes it asks for. Only existing columns, read under the caller's row-level security (`job_postings_read`,
 * `landings_read`, `job_equipment_read`, `interests_read`): a person outside the organization's landing desk gets no
 * rows. Never `landing_private_details`.
 */
const INQUIRY_JOBS = `
select to_jsonb(j) as row from (
  select jp.id as job_id,
         l.id as landing_id,
         l.name as landing_name,
         coalesce((select array_agg(e.equipment_code::text order by e.equipment_code)
                   from marketplace.job_posting_equipment e where e.job_id = jp.id), array[]::text[]) as equipment_codes
  from marketplace.job_postings jp
  left join marketplace.landings l on l.id = jp.landing_id
  where jp.org_id = $1::text::uuid
    and exists (select 1 from marketplace.expressions_of_interest i where i.job_id = jp.id and i.job_org_id = jp.org_id)
  order by jp.id
) as j`

/**
 * #213: the person `current_user_id()` resolves the claims to, with their email only once a provider verified it.
 * Row-level security (`app_users_read`, `user_contacts_self_or_support`) shows a person their own rows.
 */
const VIEWER_PERSON = `
select to_jsonb(u) as row from (
  select a.id,
         a.display_name,
         (select c.email from marketplace.user_contacts c where c.user_id = a.id and c.email_verified_at is not null) as email
  from marketplace.app_users a
  where a.id = marketplace.current_user_id()
) as u`

/**
 * #213: the person's active memberships of active businesses, oldest first, each as the schema's own
 * `get_viewer_marketplace_access` row (role, seat, hauler profile and capabilities). `memberships_read` and
 * `organizations_read` show a person their own memberships and businesses; the function re-checks both. One
 * statement, so every row comes from one snapshot: a membership removed or a business suspended before it runs is
 * simply absent.
 */
const VIEWER_MEMBERSHIPS = `
with mine as materialized (
  select m.org_id, m.created_at
  from marketplace.organization_memberships m
  join marketplace.organizations o on o.id = m.org_id and o.status = 'active'
  where m.user_id = marketplace.current_user_id()
    and m.status = 'active'
)
select to_jsonb(a) as row
from mine
cross join lateral marketplace.get_viewer_marketplace_access(mine.org_id) as a
order by mine.created_at, mine.org_id`

/**
 * Listing reports (UX-07, #130). Only the reporter's own reports are read (`reporter_user_id = current_user_id()`;
 * a platform admin could otherwise see everyone's), and only the columns HF-16 grants. The insert names only the
 * columns `authenticated` may write; `reporter_user_id` takes its default, the caller.
 */
export const STANDING_LISTING_REPORT =
  "select to_jsonb(r) as row from (select id, created_at from marketplace.abuse_reports" +
  " where reporter_user_id = marketplace.current_user_id() and target_kind = 'job_posting' and target_id = $1::text::uuid" +
  " and status in ('open', 'reviewing') order by created_at desc limit 1) as r"

export const FILE_LISTING_REPORT =
  "with r as (insert into marketplace.abuse_reports (target_kind, target_id, reason, details)" +
  " values ('job_posting', $1::text::uuid, $2::text, $3::text) returning id, created_at)" +
  " select to_jsonb(r) as row from r"

function storedReport(row: unknown): StoredListingReport | null {
  const record = row as Record<string, unknown> | undefined
  return record && typeof record.id === "string" && typeof record.created_at === "string" ? { createdAt: record.created_at, id: record.id } : null
}

/** What the connection's login role may be: nothing by itself, and able to become only `anon` and `authenticated`. */
export const CREDENTIAL_CHECK = `
select to_jsonb(c) as row from (
  select r.rolsuper as superuser,
         r.rolbypassrls as bypass_rls,
         r.rolinherit as inherits,
         r.rolcreaterole as create_role,
         r.rolreplication as replication,
         coalesce((select pg_has_role(r.oid, x.oid, 'MEMBER') from pg_roles x where x.rolname = 'service_role'), false) as service_role_member,
         coalesce((select pg_has_role(r.oid, x.oid, 'SET') from pg_roles x where x.rolname = 'authenticated'), false) as can_become_authenticated,
         coalesce((select pg_has_role(r.oid, x.oid, 'SET') from pg_roles x where x.rolname = 'anon'), false) as can_become_anon,
         exists (select 1 from pg_namespace n where n.nspname = 'marketplace' and n.nspowner = r.oid) as owns_marketplace,
         -- HF-22: owning any table, view, sequence, function or type in the schema also bypasses its RLS and grants.
         (exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'marketplace' and c.relowner = r.oid)
          or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'marketplace' and p.proowner = r.oid)
          or exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                     where n.nspname = 'marketplace' and t.typowner = r.oid)) as owns_marketplace_objects,
         -- HF-22: any role the login role can reach that anon or authenticated cannot (for example
         -- pg_write_all_data, pg_execute_server_program or a table-owning role) is refused.
         coalesce((select array_agg(p.rolname::text order by p.rolname)
                   from pg_roles p
                   where p.oid <> r.oid
                     and pg_has_role(r.oid, p.oid, 'MEMBER')
                     and not exists (select 1 from pg_roles a
                                     where a.rolname in ('anon', 'authenticated') and pg_has_role(a.oid, p.oid, 'MEMBER'))),
                  array[]::text[]) as other_memberships,
         -- HF-22: membership, direct or through other roles, of any role that is a superuser, bypasses RLS or can
         -- create roles (for example postgres or supabase_admin) is refused even though NOINHERIT withholds its
         -- privileges, because the login role could SET ROLE to it.
         coalesce((select array_agg(p.rolname::text order by p.rolname)
                   from pg_roles p
                   where p.oid <> r.oid
                     and (p.rolsuper or p.rolbypassrls or p.rolcreaterole)
                     and pg_has_role(r.oid, p.oid, 'MEMBER')), array[]::text[]) as privileged_memberships
  from pg_roles r
  -- The login role itself: a role set at connection time (startup options) cannot stand in for it.
  where r.rolname = session_user
) as c`

export interface CredentialFacts {
  superuser: boolean
  bypass_rls: boolean
  inherits: boolean
  create_role: boolean
  replication: boolean
  service_role_member: boolean
  can_become_authenticated: boolean
  can_become_anon: boolean
  owns_marketplace: boolean
  /** It owns a table, view, sequence, function or type in the `marketplace` schema. */
  owns_marketplace_objects: boolean
  /** Roles with superuser, BYPASSRLS or CREATEROLE that the login role belongs to, directly or indirectly. */
  privileged_memberships: string[]
  /** Roles the login role belongs to, directly or indirectly, that neither anon nor authenticated reaches. */
  other_memberships: string[]
}

/** The reasons a login role is unsafe for this adapter; empty when it is safe. */
export function credentialProblems(facts: CredentialFacts | null | undefined): string[] {
  if (!facts) {
    return ["the login role could not be inspected"]
  }

  return [
    facts.superuser && "it is a superuser",
    facts.bypass_rls && "it bypasses row-level security",
    facts.inherits && "it inherits the privileges of roles it belongs to (use NOINHERIT)",
    facts.create_role && "it can create roles",
    facts.replication && "it is a replication role",
    facts.service_role_member && "it is a member of service_role",
    !facts.can_become_authenticated && "it cannot switch to the authenticated role",
    !facts.can_become_anon && "it cannot switch to the anon role",
    facts.owns_marketplace && "it owns the marketplace schema",
    facts.owns_marketplace_objects !== false && "it owns objects in the marketplace schema",
    (!Array.isArray(facts.privileged_memberships) || facts.privileged_memberships.length > 0) &&
      `it belongs to a privileged role (${Array.isArray(facts.privileged_memberships) ? facts.privileged_memberships.join(", ") : "unknown"})`,
    (!Array.isArray(facts.other_memberships) || facts.other_memberships.length > 0) &&
      `it belongs to roles other than anon and authenticated (${Array.isArray(facts.other_memberships) ? facts.other_memberships.join(", ") : "unknown"})`
  ].filter((problem): problem is string => typeof problem === "string")
}

function principalField(value: unknown, name: string, min: number, max: number): string {
  const text = typeof value === "string" ? value.trim() : ""

  if (text.length < min || text.length > max) {
    throw new MarketplaceAdapterConfigurationError(`The marketplace identity ${name} is missing or invalid`)
  }

  return text
}

/** `request.jwt.claims` for one person, as Supabase would set them from a verified Clerk session token. */
export function principalClaims(principal: MarketplacePrincipal, now = Date.now()): string {
  const iat = Math.floor(now / 1000)

  return JSON.stringify({
    aud: principalField(principal.audience, "audience", 1, 200),
    exp: iat + CLAIMS_TTL_SECONDS,
    iat,
    iss: principalField(principal.issuer, "issuer", 8, 300),
    role: "authenticated",
    sub: principalField(principal.subject, "subject", 1, 255)
  })
}

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** An ISO 8601 instant with up to six fractional digits and an offset or Z, as `to_jsonb` prints a timestamptz. */
const TIMESTAMPTZ_TEXT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/

/** A whole number of seconds, minutes, hours or days: the only interval text the adapter sends. */
const INTERVAL_TEXT = /^(?:0|[1-9]\d{0,5}) (?:second|minute|hour|day)s?$/

function serialize(value: MarketplaceArgumentValue, type: ArgumentType, name: string): string | null {
  if (value === null || value === undefined) {
    return null
  }

  switch (type) {
    case "uuid":
    case "text":
    case "bpchar":
    case "date":
      if (typeof value !== "string") break
      return value
    case "integer":
    case "bigint":
      if (typeof value !== "number" || !Number.isSafeInteger(value)) break
      return String(value)
    case "numeric":
      if (typeof value !== "number" || !Number.isFinite(value)) break
      return String(value)
    case "boolean":
      if (typeof value !== "boolean") break
      return value ? "true" : "false"
    case "interval":
      if (typeof value !== "string" || !INTERVAL_TEXT.test(value)) break
      return value
    case "jsonb":
      return JSON.stringify(value)
    case "text[]":
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) break
      return JSON.stringify(value)
    case "uuid[]":
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && UUID_TEXT.test(item))) break
      return JSON.stringify(value)
    case "timestamptz":
      if (typeof value !== "string" || !TIMESTAMPTZ_TEXT.test(value)) break
      return value
  }

  throw new TypeError(`Argument ${name} must be a ${type}`)
}

/**
 * The SQL for one catalogued call, with named arguments and bound values. Undefined arguments are left out so the
 * function's own default applies. Pure; exported for tests.
 */
export function marketplaceCallStatement<F extends MarketplaceFunctionName>(
  fn: F,
  args: MarketplaceCallArguments<F>
): { text: string; values: Array<string | null> } {
  if (!Object.prototype.hasOwnProperty.call(MARKETPLACE_FUNCTIONS, fn)) {
    throw new TypeError(`${String(fn)} is not a catalogued marketplace function`)
  }

  const spec: FunctionSpec = MARKETPLACE_FUNCTIONS[fn]
  const values: Array<string | null> = []
  const named = Object.entries(args as Record<string, MarketplaceArgumentValue>)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => {
      const type = Object.prototype.hasOwnProperty.call(spec.args, name) ? spec.args[name] : undefined

      if (!type) {
        throw new TypeError(`${name} is not an argument of marketplace.${String(fn)}`)
      }

      const serialized = serialize(value, type, name)

      if (serialized === null) {
        return `${name} => null::${type}`
      }

      values.push(serialized)
      // Every parameter is sent as text and converted by the server. Typing the placeholder directly ($1::jsonb,
      // $1::boolean, $1::date) would make the driver apply its own serializer to the already-serialized value.
      const placeholder = `$${values.length}::text`

      if (type === "text") {
        return `${name} => ${placeholder}`
      }

      if (type === "text[]") {
        return `${name} => array(select jsonb_array_elements_text(${placeholder}::jsonb))`
      }

      // Arrays travel as JSON text; each element is cast by the server, so the result is a real uuid[] (empty included).
      return type === "uuid[]"
        ? `${name} => array(select e.item::uuid from jsonb_array_elements_text(${placeholder}::jsonb) as e(item))`
        : `${name} => ${placeholder}::${type}`
    })

  const call = `marketplace.${String(fn)}(${named.join(", ")})`
  const text = spec.returns === "rows"
    ? `select to_jsonb(r) as row from ${call} as r`
    : spec.returns === "value"
      ? `select to_jsonb(${call}) as value`
      : `select 1 as done from ${call} as r`

  return { text, values }
}

const REFUSAL_CODES = new Set(["23514", "42501", "P0002"])
const NOT_ALLOWED = "This is not available to your account."
const CONFLICT = "This changed while you were working on it. Reload the page and try again."

const SERVER_SEVERITIES = new Set(["ERROR", "FATAL", "PANIC"])

/**
 * The SQLSTATE of an error the database server sent. postgres.js copies the server's error fields onto the error it
 * throws, so a server error has both `code` (the SQLSTATE) and `severity`. The class name is not checked: a minifier
 * renames it. A client-side failure (Node's `EPIPE`, the driver's own `CONNECT_TIMEOUT`) has no severity.
 */
function sqlState(error: unknown): string | null {
  if (!error || typeof error !== "object") return null
  const candidate = error as { code?: unknown; severity?: unknown }
  return typeof candidate.severity === "string" && SERVER_SEVERITIES.has(candidate.severity) &&
    typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)
    ? candidate.code
    : null
}

/**
 * Store errors become errors that are safe to show. Business-rule (23514), access (42501) and not-found (P0002)
 * refusals keep the database's message, which is written for people; a bare grant failure ("permission denied …")
 * becomes a plain refusal. Everything else — malformed input, conflicts, timeouts, connection failures — becomes a
 * generic error whose message names no host, role, table or value.
 */
export function translateStoreError(error: unknown): Error {
  if (
    error instanceof MarketplaceRefusalError ||
    error instanceof MarketplaceStoreError ||
    error instanceof MarketplaceAdapterConfigurationError
  ) {
    return error
  }

  const code = sqlState(error)

  if (code && REFUSAL_CODES.has(code)) {
    const text = error instanceof Error ? error.message.trim() : ""

    return new MarketplaceRefusalError(!text || /^permission denied/i.test(text) ? NOT_ALLOWED : text.slice(0, 300), code)
  }

  if (code === "23505" || code === "40001" || code === "40P01") {
    return new MarketplaceRefusalError(CONFLICT, code)
  }

  return new MarketplaceStoreError(undefined, code, error)
}

function rowsOf(result: readonly unknown[], column: "row" | "value"): unknown[] {
  return result.map((record) => (record as Record<string, unknown>)[column])
}

function callsFor(tx: TransactionSql, anonymous: boolean): MarketplaceCalls {
  return {
    async call(fn, args) {
      if (anonymous && !MARKETPLACE_FUNCTIONS[fn].anonymous) {
        throw new TypeError(`marketplace.${fn} needs a signed-in person`)
      }

      if (!anonymous && (MARKETPLACE_FUNCTIONS[fn] as FunctionSpec).anonymousOnly) {
        throw new TypeError(`marketplace.${fn} runs only in a signed-out session`)
      }

      const { text, values } = marketplaceCallStatement(fn, args)
      const result = await tx.unsafe(text, values)
      const returns = MARKETPLACE_FUNCTIONS[fn].returns

      return returns === "rows" ? rowsOf(result, "row") : returns === "value" ? rowsOf(result, "value").slice(0, 1) : []
    },

    async inquiryParties(interestId) {
      if (anonymous) {
        throw new TypeError("Inquiries need a signed-in person")
      }

      const [row] = rowsOf(await tx.unsafe(INQUIRY_PARTIES, [interestId]), "row") as Array<Record<string, unknown> | undefined>

      if (!row || typeof row.job_id !== "string" || typeof row.job_org_id !== "string" || typeof row.hauler_org_id !== "string") {
        return null
      }

      return { haulerOrganizationId: row.hauler_org_id, jobId: row.job_id, jobOrganizationId: row.job_org_id }
    },

    async landingStatement(name, values) {
      if (anonymous) {
        throw new TypeError("Landings need a signed-in person")
      }

      if (!Object.prototype.hasOwnProperty.call(LANDING_STATEMENTS, name)) {
        throw new TypeError(`${String(name)} is not a catalogued landing statement`)
      }

      const statement = LANDING_STATEMENTS[name]

      if (values.length !== statement.params || !values.every((value) => value === null || typeof value === "string")) {
        throw new TypeError(`${name} takes exactly ${statement.params} text or null values`)
      }

      return rowsOf(await tx.unsafe(statement.text, [...values]), "row")
    },

    async query(name, values) {
      if (anonymous) {
        throw new TypeError(`${name} needs a signed-in person`)
      }

      const statement = marketplaceQueryStatement(name, values)
      return rowsOf(await tx.unsafe(statement.text, statement.values), "row")
    },

    async inquiryJobs(organizationId) {
      if (anonymous) {
        throw new TypeError("Inquiries need a signed-in person")
      }

      return rowsOf(await tx.unsafe(INQUIRY_JOBS, [organizationId]), "row")
    },

    async viewerSession() {
      if (anonymous) {
        throw new TypeError("A session needs a signed-in person")
      }

      const [person] = rowsOf(await tx.unsafe(VIEWER_PERSON), "row")

      // No person, no memberships: claims that resolve to no one read nothing, so the second query is not run.
      return person ? { memberships: rowsOf(await tx.unsafe(VIEWER_MEMBERSHIPS), "row"), person } : { memberships: [], person: null }
    },

    async standingListingReport(jobId) {
      if (anonymous) {
        throw new TypeError("Reports need a signed-in person")
      }

      const [row] = rowsOf(await tx.unsafe(STANDING_LISTING_REPORT, [jobId]), "row")
      return storedReport(row)
    },

    async fileListingReport({ details, jobId, reason }) {
      if (anonymous) {
        throw new TypeError("Reports need a signed-in person")
      }

      const [row] = rowsOf(await tx.unsafe(FILE_LISTING_REPORT, [jobId, reason, details]), "row")
      const report = storedReport(row)

      if (!report) {
        throw new MarketplaceStoreError()
      }

      return report
    }
  }
}

export interface PostgresMarketplaceDbOptions {
  /** A connection string for the restricted login role. Never printed. */
  url?: string
  /** An existing postgres.js client (tests). Its connection must belong to the same kind of restricted role. */
  sql?: Sql
  /** Pool size when `url` is given. */
  max?: number
}

async function connect(url: string, max: number): Promise<Sql> {
  const { default: postgres } = await import("postgres")

  return postgres(url, {
    connect_timeout: 10,
    connection: { application_name: "logloads-web-marketplace-v2" },
    idle_timeout: 30,
    max,
    onnotice: () => undefined,
    // Transaction-mode poolers (Supabase Supavisor) do not keep prepared statements between transactions.
    prepare: false
  })
}

/** The normalized store over a direct PostgreSQL connection (postgres.js). */
export function createPostgresMarketplaceDb(options: PostgresMarketplaceDbOptions): MarketplaceDb {
  if (!options.sql && !options.url) {
    throw new MarketplaceAdapterConfigurationError("The normalized marketplace store has no connection configured")
  }

  let client: Promise<Sql> | null = null
  let checked = false

  async function ready(): Promise<Sql> {
    client ??= options.sql ? Promise.resolve(options.sql) : connect(options.url as string, options.max ?? 5)
    const sql = await client

    if (!checked) {
      const [facts] = rowsOf(await sql.unsafe(CREDENTIAL_CHECK), "row") as Array<CredentialFacts | undefined>
      const problems = credentialProblems(facts)

      if (problems.length > 0) {
        throw new MarketplaceAdapterConfigurationError(
          `The normalized marketplace connection is refused because its login role is unsafe: ${problems.join("; ")}`
        )
      }

      checked = true
    }

    return sql
  }

  async function run<T>(mode: "read only" | "read write", role: "anon" | "authenticated", claims: string, work: (calls: MarketplaceCalls) => Promise<T>): Promise<T> {
    try {
      const sql = await ready()
      const result = await sql.begin(mode, async (tx) => {
        await tx.unsafe(SESSION_SETUP, [role, claims])
        return work(callsFor(tx, role === "anon"))
      })

      return result as T
    } catch (error) {
      throw translateStoreError(error)
    }
  }

  return {
    asAnon: async (work, runOptions) => run(runOptions?.readOnly === false ? "read write" : "read only", "anon", ANON_CLAIMS, work),

    asUser: async (principal, work, runOptions) =>
      run(runOptions?.readOnly === false ? "read write" : "read only", "authenticated", principalClaims(principal), work),

    async close() {
      if (client && !options.sql) {
        const sql = await client.catch(() => null)
        client = null
        await sql?.end({ timeout: 5 })
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Identity linking (#213)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The person to create or link, from the server session only: the configured issuer, the session's Clerk user id
 * (`identity_links.subject`), a display name, and an email address that is stored only when the provider verified it.
 */
export interface MarketplaceIdentityToLink {
  issuer: string
  subject: string
  displayName: string
  email: string | null
  emailVerified: boolean
}

/**
 * Links a signed-in person to the normalized store through `marketplace.sync_verified_identity`, the schema's own
 * server-side identity bridge (03, hardened in 16 B-5). The schema grants that function to `service_role` only, and
 * the marketplace connection can never become `service_role` (HF-22), so linking runs over a separate login role
 * that can become `service_role` and nothing else, and calls only this one function.
 */
export interface MarketplaceIdentitySync {
  /** The `app_users.id` the identity now resolves to (created on first sign-in, the same one afterwards). */
  link(identity: MarketplaceIdentityToLink): Promise<string>
  close(): Promise<void>
}

/** What the identity-sync login role may be: nothing by itself, and able to become only `service_role`. */
export const IDENTITY_SYNC_CREDENTIAL_CHECK = `
select to_jsonb(c) as row from (
  select r.rolsuper as superuser,
         r.rolbypassrls as bypass_rls,
         r.rolinherit as inherits,
         r.rolcreaterole as create_role,
         r.rolreplication as replication,
         coalesce((select pg_has_role(r.oid, x.oid, 'SET') from pg_roles x where x.rolname = 'service_role'), false) as can_become_service_role,
         exists (select 1 from pg_namespace n where n.nspname = 'marketplace' and n.nspowner = r.oid) as owns_marketplace,
         (exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'marketplace' and c.relowner = r.oid)
          or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'marketplace' and p.proowner = r.oid)
          or exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                     where n.nspname = 'marketplace' and t.typowner = r.oid)) as owns_marketplace_objects,
         -- Any role reachable other than service_role and the roles service_role itself reaches: anon, authenticated,
         -- pg_write_all_data or a table owner would let this credential do more than link identities.
         coalesce((select array_agg(p.rolname::text order by p.rolname)
                   from pg_roles p
                   where p.oid <> r.oid
                     and p.rolname <> 'service_role'
                     and pg_has_role(r.oid, p.oid, 'MEMBER')
                     and not exists (select 1 from pg_roles s
                                     where s.rolname = 'service_role' and pg_has_role(s.oid, p.oid, 'MEMBER'))),
                  array[]::text[]) as other_memberships,
         -- Membership of a superuser, BYPASSRLS or CREATEROLE role other than service_role itself, which holds
         -- BYPASSRLS on Supabase but no table privilege in this schema (02's trust model).
         coalesce((select array_agg(p.rolname::text order by p.rolname)
                   from pg_roles p
                   where p.oid <> r.oid
                     and p.rolname <> 'service_role'
                     and (p.rolsuper or p.rolbypassrls or p.rolcreaterole)
                     and pg_has_role(r.oid, p.oid, 'MEMBER')), array[]::text[]) as privileged_memberships
  from pg_roles r
  where r.rolname = session_user
) as c`

export interface IdentitySyncCredentialFacts {
  superuser: boolean
  bypass_rls: boolean
  inherits: boolean
  create_role: boolean
  replication: boolean
  can_become_service_role: boolean
  owns_marketplace: boolean
  owns_marketplace_objects: boolean
  other_memberships: string[]
  privileged_memberships: string[]
}

/** The reasons a login role is unsafe for identity linking; empty when it is safe. */
export function identitySyncCredentialProblems(facts: IdentitySyncCredentialFacts | null | undefined): string[] {
  if (!facts) {
    return ["the login role could not be inspected"]
  }

  const list = (value: unknown) => (Array.isArray(value) ? value.join(", ") : "unknown")

  return [
    facts.superuser && "it is a superuser",
    facts.bypass_rls && "it bypasses row-level security",
    facts.inherits && "it inherits the privileges of roles it belongs to (use NOINHERIT)",
    facts.create_role && "it can create roles",
    facts.replication && "it is a replication role",
    !facts.can_become_service_role && "it cannot switch to the service_role role",
    facts.owns_marketplace && "it owns the marketplace schema",
    facts.owns_marketplace_objects !== false && "it owns objects in the marketplace schema",
    (!Array.isArray(facts.privileged_memberships) || facts.privileged_memberships.length > 0) &&
      `it belongs to a privileged role (${list(facts.privileged_memberships)})`,
    (!Array.isArray(facts.other_memberships) || facts.other_memberships.length > 0) &&
      `it belongs to roles other than service_role (${list(facts.other_memberships)})`
  ].filter((problem): problem is string => typeof problem === "string")
}

const WORKER_CLAIMS = JSON.stringify({ role: "service_role" })

const SYNC_VERIFIED_IDENTITY =
  "select to_jsonb(marketplace.sync_verified_identity(p_issuer => $1::text, p_subject => $2::text, p_display_name => $3::text, " +
  "p_email => $4::text, p_email_verified => $5::text::boolean)) as value"

/** Identity linking over a direct PostgreSQL connection as the identity-sync login role (postgres.js). */
export function createPostgresIdentitySync(options: PostgresMarketplaceDbOptions): MarketplaceIdentitySync {
  if (!options.sql && !options.url) {
    throw new MarketplaceAdapterConfigurationError("The normalized identity link has no connection configured")
  }

  let client: Promise<Sql> | null = null
  let checked = false

  async function ready(): Promise<Sql> {
    client ??= options.sql ? Promise.resolve(options.sql) : connect(options.url as string, options.max ?? 1)
    const sql = await client

    if (!checked) {
      const [facts] = rowsOf(await sql.unsafe(IDENTITY_SYNC_CREDENTIAL_CHECK), "row") as Array<IdentitySyncCredentialFacts | undefined>
      const problems = identitySyncCredentialProblems(facts)

      if (problems.length > 0) {
        throw new MarketplaceAdapterConfigurationError(
          `The normalized identity link connection is refused because its login role is unsafe: ${problems.join("; ")}`
        )
      }

      checked = true
    }

    return sql
  }

  return {
    async link(identity) {
      const issuer = principalField(identity.issuer, "issuer", 8, 300)
      const subject = principalField(identity.subject, "subject", 1, 255)
      const displayName = identity.displayName.trim().slice(0, 120)
      const email = identity.emailVerified && identity.email?.trim() ? identity.email.trim() : null

      try {
        const sql = await ready()
        const userId = await sql.begin("read write", async (tx) => {
          await tx.unsafe(SESSION_SETUP, ["service_role", WORKER_CLAIMS])
          const [value] = rowsOf(await tx.unsafe(SYNC_VERIFIED_IDENTITY, [issuer, subject, displayName, email, email ? "true" : "false"]), "value")
          return value
        })

        if (typeof userId !== "string" || !UUID_TEXT.test(userId)) {
          throw new MarketplaceStoreError()
        }

        return userId
      } catch (error) {
        throw translateStoreError(error)
      }
    },

    async close() {
      if (client && !options.sql) {
        const sql = await client.catch(() => null)
        client = null
        await sql?.end({ timeout: 5 })
      }
    }
  }
}
