/**
 * Store reads for admin (#255). Each runs as the signed-in person (`authenticated`) for no business, so the schema's
 * row-level security decides what it returns, and each also checks the person's staff role itself, with the same roles
 * as `MARKETPLACE_ADMIN_ACTION_ROLES`:
 *
 *   platform_admins  `platform_admins_self_or_super`: the person's own row (02); the grant is the whole table
 *   organizations    `organizations_read`: staff through its `is_platform_admin()` branch; 16 grants the columns read here
 *   abuse_reports    `abuse_reports_read`: moderator or support staff; 18 grants every column but `reviewed_by`
 *
 * The lists are bounded (100, oldest first: the port takes no page). Nothing here writes, and no value is ever in the
 * text: every value is a bound parameter.
 *
 * None of these is in `MARKETPLACE_QUERIES` (normalized-queries.ts) yet, and `admin_queue_counts` is a new SQL function
 * (posted on #255). Both catalogues are shared files this task does not edit: `ADMIN_STATEMENTS` is the exact entry,
 * `args` included, for their owner to add. Until every name a method runs is catalogued, the whole group refuses and
 * reaches no store (`./index.ts`).
 */

import type { MarketplaceQueryArgument } from "../normalized-queries"

/** SQL functions the admin methods call that are not catalogued yet; each needs a schema stage first. */
export const ADMIN_FUNCTIONS = ["admin_queue_counts"] as const

/**
 * Functions granted to `service_role` only. They are never catalogued (normalized-db.ts) and no page reaches them: the
 * lapse job (`./lapse-worker.ts`) runs on a worker's own service-role connection.
 */
export const ADMIN_SERVICE_ROLE_FUNCTIONS = ["lapse_expired_org_verifications"] as const

export const ADMIN_STATEMENT_NAMES = ["admin_reports", "admin_roles", "admin_verification_queue"] as const
export type AdminStatementName = (typeof ADMIN_STATEMENT_NAMES)[number]

interface StatementSpec {
  /** The `MarketplaceQueryArgument` of each parameter, as `MARKETPLACE_QUERIES` declares them. */
  args: readonly MarketplaceQueryArgument[]
  text: string
}

export const ADMIN_STATEMENTS: Readonly<Record<AdminStatementName, StatementSpec>> = {
  /** The person's own staff role, if any and not revoked (`is_platform_admin`'s own rule). One row at most: the key. */
  admin_roles: {
    args: [],
    text: `
select to_jsonb(a) as row from (
  select a.admin_role
  from marketplace.platform_admins a
  where a.user_id = marketplace.current_user_id()
    and a.revoked_at is null
) as a`
  },

  /**
   * Active businesses awaiting identity review (a request, a legal-name change, or a lapsed review), oldest account
   * first: moderator or support staff only. The claimed names and the registration date (§7.2); no creator or reviewer.
   */
  admin_verification_queue: {
    args: [],
    text: `
select to_jsonb(o) as row from (
  select o.id, o.display_name, o.legal_name, o.verification_status, o.verified_at, o.created_at
  from marketplace.organizations o
  where o.verification_status = 'pending'
    and o.status = 'active'
    and marketplace.is_platform_admin(array['moderator', 'support']::text[])
  order by o.created_at, o.id
  limit 100
) as o`
  },

  /**
   * Reports, oldest first: moderator or support staff only. $1 one status, or NULL for open and reviewing (the
   * `abuse_reports_open_idx` partial index); $2 one target kind or NULL. Never the reviewer's identity (B-8).
   */
  admin_reports: {
    args: ["text", "text"],
    text: `
select to_jsonb(r) as row from (
  select ar.id, ar.target_kind, ar.target_id, ar.reason, ar.details, ar.status, ar.reporter_user_id,
         ar.created_at, ar.reviewed_at, ar.resolution_note
  from marketplace.abuse_reports ar
  where marketplace.is_platform_admin(array['moderator', 'support']::text[])
    and (($1::text is null and ar.status in ('open', 'reviewing')) or ar.status = $1::text)
    and ($2::text is null or ar.target_kind = $2::text)
  order by ar.created_at, ar.id
  limit 100
) as r`
  }
}

/** The statement and its bound values. The text never contains a value. */
export function adminStatement(name: AdminStatementName, values: readonly (string | null)[]): { text: string; values: Array<string | null> } {
  const spec = ADMIN_STATEMENTS[name]

  if (values.length !== spec.args.length || values.some((value) => value !== null && typeof value !== "string")) {
    throw new TypeError(`${name} takes exactly ${spec.args.length} text or null values`)
  }

  return { text: spec.text, values: [...values] }
}
