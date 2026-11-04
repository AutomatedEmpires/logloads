/**
 * The closed list of table statements the normalized adapter may run, beside the schema functions in
 * `MARKETPLACE_FUNCTIONS` (normalized-db.ts). They exist where the schema has no function for a V2 screen yet: the
 * hauling business's own profile (#125). Each one runs inside the identity-bound transaction as `authenticated`,
 * so the schema's row-level security, column grants and triggers decide what the person may read and change:
 *
 *   hauler_profiles   read: members; update: owner or manager (hauler_profiles_update), consent stamped by
 *                     tg_hauler_public_consent, invitation consent by tg_hauler_profile_guard
 *   organizations     update: owner only (organizations_owner_update); tg_org_identity_guard re-opens verification
 *                     when a verified business changes its legal name (LE-08)
 *
 * Every statement also names the active business explicitly (`$1`) and checks the person's membership of it, so a
 * person who belongs to several businesses only ever reads or changes the one they are acting for. Values are bound
 * parameters sent as text and cast in SQL; names are schema-qualified (the session's search path is empty). Rows
 * come back as `to_jsonb(row)`, like the function calls.
 */

export type MarketplaceQueryArgument = "uuid" | "text" | "integer" | "boolean"

interface QuerySpec {
  args: readonly MarketplaceQueryArgument[]
  text: string
}

const MEMBER_ROLES = "array['owner', 'manager', 'staff', 'driver']::text[]"

export const MARKETPLACE_QUERIES = {
  /** The active business's hauler profile with its organization, and what the person may change. */
  hauler_profile: {
    args: ["uuid"],
    text: `
select to_jsonb(p) as row from (
  select o.id as org_id, o.display_name, o.legal_name, o.verification_status, o.verified_at,
         h.base_area_label, h.service_radius_miles, h.description, h.is_public, h.accepts_targeted_invitations, h.updated_at,
         marketplace.has_org_role(o.id, array['owner']::text[]) as can_edit_identity,
         marketplace.has_org_role(o.id, array['owner', 'manager']::text[]) as can_edit_profile
  from marketplace.organizations o
  join marketplace.hauler_profiles h on h.org_id = o.id
  where o.id = $1::text::uuid
    and marketplace.has_org_role(o.id, ${MEMBER_ROLES})
) as p`
  },

  /**
   * The profile fields an owner or manager may change. A changed home base clears the service point, so an area
   * search never uses the previous town's position (V2 has no place list to set a new one yet).
   */
  hauler_profile_update: {
    args: ["uuid", "text", "integer", "text", "boolean", "boolean"],
    text: `
with changed as (
  update marketplace.hauler_profiles
  set service_center = case when base_area_label is distinct from $2::text then null else service_center end,
      base_area_label = $2::text,
      service_radius_miles = $3::text::integer,
      description = $4::text,
      is_public = $5::text::boolean,
      accepts_targeted_invitations = $6::text::boolean
  where org_id = $1::text::uuid
    and marketplace.has_org_role(org_id, array['owner', 'manager']::text[])
  returning org_id
) select to_jsonb(changed) as row from changed`
  },

  /** The business name and legal name, owner only. */
  organization_identity_update: {
    args: ["uuid", "text", "text"],
    text: `
with changed as (
  update marketplace.organizations
  set display_name = $2::text, legal_name = $3::text
  where id = $1::text::uuid
    and marketplace.has_org_role(id, array['owner']::text[])
  returning id
) select to_jsonb(changed) as row from changed`
  }
} as const satisfies Record<string, QuerySpec>

export type MarketplaceQueryName = keyof typeof MARKETPLACE_QUERIES

export type MarketplaceQueryValue = string | number | boolean | null

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function serializeQueryValue(value: MarketplaceQueryValue, type: MarketplaceQueryArgument, position: number): string | null {
  if (value === null) {
    return null
  }

  switch (type) {
    case "uuid":
      if (typeof value === "string" && UUID.test(value)) return value
      break
    case "text":
      if (typeof value === "string") return value
      break
    case "integer":
      if (typeof value === "number" && Number.isSafeInteger(value)) return String(value)
      break
    case "boolean":
      if (typeof value === "boolean") return value ? "true" : "false"
      break
  }

  throw new TypeError(`Argument $${position} must be a ${type}`)
}

/** The SQL and bound values for one catalogued statement. Pure; exported for tests. */
export function marketplaceQueryStatement(
  name: MarketplaceQueryName,
  values: readonly MarketplaceQueryValue[]
): { text: string; values: Array<string | null> } {
  if (!Object.prototype.hasOwnProperty.call(MARKETPLACE_QUERIES, name)) {
    throw new TypeError(`${String(name)} is not a catalogued marketplace statement`)
  }

  const spec: QuerySpec = MARKETPLACE_QUERIES[name]

  if (values.length !== spec.args.length) {
    throw new TypeError(`${name} takes ${spec.args.length} argument(s)`)
  }

  return { text: spec.text, values: values.map((value, index) => serializeQueryValue(value, spec.args[index] as MarketplaceQueryArgument, index + 1)) }
}
