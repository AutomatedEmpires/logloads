/**
 * Table statements for invites (#250). They run as the signed-in person (`authenticated`), so the schema's row-level
 * security decides what each returns, and each one also names the active business (`$1`) and checks the person's role
 * in it, so a person in several businesses only ever reads the one they act for:
 *
 *   targeted_invitations  `invitations_read`: the sender's owners, managers and staff with a seat, and every member of
 *                         the recipient; `invitations_landing_scope` (26-B) hides a sender's invitations for jobs at
 *                         landings outside a limited member's scope
 *   organizations         `organizations_read` / `can_view_organization`: each side of a targeted invitation sees the
 *                         other's name and verification (16 grants only public columns)
 *   app_users             `app_users_read`: the sender's own colleagues' display names (no address column exists)
 *
 * `get_marketplace_job` is the public job function (catalogued in `MARKETPLACE_FUNCTIONS`). Nothing here selects a
 * phone, an email address or private landing details. Every value is a bound parameter.
 *
 * These are not in `MARKETPLACE_QUERIES` (normalized-queries.ts) yet. That file is shared and this task does not edit
 * it: `INVITE_STATEMENTS` is the exact entry, `args` included, for its owner to add. Until a name is catalogued, the
 * methods that run it refuse and reach no store (`./index.ts`).
 */

export const INVITE_STATEMENT_NAMES = ["invite_answer_lock", "invite_received", "invite_received_one", "invite_sent"] as const

export type InviteStatementName = (typeof INVITE_STATEMENT_NAMES)[number]

interface StatementSpec {
  /** The `MarketplaceQueryArgument` of each parameter, as `MARKETPLACE_QUERIES` declares them. */
  args: readonly "uuid"[]
  text: string
}

export const INVITE_STATEMENTS: Readonly<Record<InviteStatementName, StatementSpec>> = {
  /**
   * $1 sender org, $2 job or NULL for every job. The business's invitations, newest first, at most 200. Senders read
   * them with a Landing Operator seat (`invitations_read`). `sent_by_viewer` lets a retried send find its own
   * reservation; it is not part of the view.
   */
  invite_sent: {
    args: ["uuid", "uuid"],
    text: `select to_jsonb(s) as row from (
  select ti.id, ti.job_id, ti.recipient_org_id, ro.display_name as recipient_name,
         ti.status, ti.recipient_response, ti.note, ti.sent_by, su.display_name as sent_by_name,
         ti.sent_by = marketplace.current_user_id() as sent_by_viewer,
         ti.created_at, ti.delivered_at, ti.responded_at
  from marketplace.targeted_invitations ti
  left join marketplace.organizations ro on ro.id = ti.recipient_org_id
  left join marketplace.app_users su on su.id = ti.sent_by
  where ti.sender_org_id = $1::text::uuid
    and ($2::text::uuid is null or ti.job_id = $2::text::uuid)
    and marketplace.has_org_role(ti.sender_org_id, array['owner', 'manager', 'staff']::text[], true)
  order by ti.created_at desc, ti.id desc
  limit 200
) as s`
  },

  /**
   * $1 recipient org. Invitations delivered to the business, newest first, at most 50, each with its job as the
   * public sees it (`get_marketplace_job`; `can_read_job_posting` keeps a stopped job readable to its recipients). A
   * reserved, failed or suppressed invitation never reaches the inbox, and a job the store no longer shows drops out.
   */
  invite_received: {
    args: ["uuid"],
    text: `select to_jsonb(r) as row from (
  select ti.id, ti.note, ti.recipient_response, ti.delivered_at, ti.sender_org_id,
         so.display_name as sender_name,
         coalesce(so.verification_status = 'verified', false) as sender_verified,
         so.verified_at as sender_verified_at,
         to_jsonb(j) as job
  from marketplace.targeted_invitations ti
  join lateral marketplace.get_marketplace_job(ti.job_id) j on true
  left join marketplace.organizations so on so.id = ti.sender_org_id
  where ti.recipient_org_id = $1::text::uuid
    and ti.status = 'delivered'
    and marketplace.has_org_role(ti.recipient_org_id, array['owner', 'manager', 'staff', 'driver']::text[])
  order by ti.delivered_at desc, ti.id desc
  limit 50
) as r`
  },

  /**
   * $1 invitation. Serializes answers to one invitation until the transaction ends. The person cannot lock the row
   * (`authenticated` holds no UPDATE on `targeted_invitations`), so a transaction advisory lock on the invitation id
   * stands in. It runs as its own statement before `invite_received_one`: under READ COMMITTED that read then takes a
   * snapshot after any earlier answer committed, so two concurrent answers cannot both see the invitation unanswered.
   */
  invite_answer_lock: {
    args: ["uuid"],
    text: `select jsonb_build_object('locked', true) as row
from (select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 20261250))) as l`
  },

  /**
   * $1 recipient org, $2 invitation. One delivered invitation addressed to the business, and its current answer.
   * `respond_to_invitation` does not check delivery itself (#269 finding), so the adapter answers only what this
   * returns.
   */
  invite_received_one: {
    args: ["uuid", "uuid"],
    text: `select to_jsonb(r) as row from (
  select ti.id, ti.recipient_response
  from marketplace.targeted_invitations ti
  where ti.id = $2::text::uuid
    and ti.recipient_org_id = $1::text::uuid
    and ti.status = 'delivered'
    and marketplace.has_org_role(ti.recipient_org_id, array['owner', 'manager', 'staff', 'driver']::text[])
) as r`
  }
}

/** The statement and its bound values. The text never contains a value. */
export function inviteStatement(name: InviteStatementName, values: readonly (string | null)[]): { text: string; values: Array<string | null> } {
  const spec = INVITE_STATEMENTS[name]

  if (values.length !== spec.args.length || values.some((value) => value !== null && typeof value !== "string")) {
    throw new TypeError(`${name} takes exactly ${spec.args.length} text or null values`)
  }

  return { text: spec.text, values: [...values] }
}
