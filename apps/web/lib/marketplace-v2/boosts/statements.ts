/**
 * Store reads for boosts (#254). Each one runs as the signed-in person (`authenticated`), so the schema's row-level
 * security decides what it returns, and each also names the active business (`$1`) and checks the person's role in
 * it, so a person in several businesses only ever reads the one they act for:
 *
 *   job_boosts      `job_boosts_read`: the business's owners, managers and staff with a Landing Operator seat;
 *                   `job_boosts_landing_scope` (26-B) hides boosts of jobs at landings outside a limited member's scope
 *   boost_products  `boost_products_read`: active products only, so a retired product's code comes back NULL
 *
 * Nothing here reads the payment reference, the purchaser or the frozen centre point, and nothing writes: a boost is
 * only ever recorded by `activate_job_boost` after a confirmed payment, which is granted to `service_role` alone and
 * is never catalogued (no purchase exists, Blueprint §14). Every value is a bound parameter.
 *
 * Neither `boost_list` nor the function `count_boost_audience_trucks` is in the shared catalogues yet
 * (`MARKETPLACE_QUERIES` in normalized-queries.ts, `MARKETPLACE_FUNCTIONS` in normalized-db.ts), and this task does
 * not edit them. `BOOST_STATEMENTS` is the exact entry, `args` included, for their owner to add; the function needs a
 * schema stage first. Until both are catalogued, every boosts method refuses and reaches no store (`./index.ts`).
 */

/** Functions the boosts methods call that are not catalogued yet: `count_boost_audience_trucks` needs a schema stage. */
export const BOOST_FUNCTIONS = ["count_boost_audience_trucks"] as const

export const BOOST_STATEMENT_NAMES = ["boost_list"] as const

export type BoostStatementName = (typeof BOOST_STATEMENT_NAMES)[number]

interface StatementSpec {
  /** The `MarketplaceQueryArgument` of each parameter, as `MARKETPLACE_QUERIES` declares them. */
  args: readonly "uuid"[]
  text: string
}

export const BOOST_STATEMENTS: Readonly<Record<BoostStatementName, StatementSpec>> = {
  /**
   * $1 org, $2 job or NULL for every job. The business's boosts, newest first, at most 200, with the package code of
   * an active product (NULL otherwise). `org_id` is returned so the mapping can refuse a row of any other business.
   * `job_boosts_org_idx (org_id, created_at desc)` serves the order.
   */
  boost_list: {
    args: ["uuid", "uuid"],
    text: `select to_jsonb(b) as row from (
  select jb.id, jb.job_id, jb.org_id, bp.code as package_code, jb.status, jb.duration_days, jb.price_cents,
         jb.radius_miles, jb.starts_at, jb.ends_at, jb.created_at
  from marketplace.job_boosts jb
  left join marketplace.boost_products bp on bp.id = jb.product_id
  where jb.org_id = $1::text::uuid
    and ($2::text is null or jb.job_id = $2::text::uuid)
    and marketplace.has_org_role(jb.org_id, array['owner', 'manager', 'staff']::text[], true)
  order by jb.created_at desc, jb.id desc
  limit 200
) as b`
  }
}

/** The statement and its bound values. The text never contains a value. */
export function boostStatement(name: BoostStatementName, values: readonly (string | null)[]): { text: string; values: Array<string | null> } {
  const spec = BOOST_STATEMENTS[name]

  if (values.length !== spec.args.length || values.some((value) => value !== null && typeof value !== "string")) {
    throw new TypeError(`${name} takes exactly ${spec.args.length} text or null values`)
  }

  return { text: spec.text, values: [...values] }
}
