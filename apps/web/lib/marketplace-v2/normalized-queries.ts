/**
 * The closed list of table statements the normalized adapter may run, beside the schema functions in
 * `MARKETPLACE_FUNCTIONS` (normalized-db.ts). They exist where the schema has no function for a V2 screen yet: the
 * hauling business's own profile (#125), and its trucks and self-reported availability (#126). Each one runs inside
 * the identity-bound transaction as `authenticated`, so the schema's row-level security, column grants and triggers
 * decide what the person may read and change:
 *
 *   hauler_profiles   read: members; update: owner or manager (hauler_profiles_update), consent stamped by
 *                     tg_hauler_public_consent, invitation consent by tg_hauler_profile_guard
 *   organizations     update: owner only (organizations_owner_update); tg_org_identity_guard re-opens verification
 *                     when a verified business changes its legal name (LE-08)
 *   equipment_units   read: members; insert/update: owner, manager or staff (equipment_units_insert/_update)
 *   availability_reports  read: members; insert/update: owner, manager or staff here (availability_insert/_update);
 *                     tg_availability_guard snaps the area and stamps reported_at on every write
 *   promotion_redemptions  read: owners (promotion_redemptions_read), only the M2 column grant (16); the founding
 *                     offer (#248, #306)
 *   promotions        read: open promotions only (promotions_read), so a closed one's terms come back NULL
 *
 * Every statement also names the active business explicitly (`$1`) and checks the person's membership of it, so a
 * person who belongs to several businesses only ever reads or changes the one they are acting for. Values are bound
 * parameters sent as text and cast in SQL; names are schema-qualified (the session's search path is empty). Rows
 * come back as `to_jsonb(row)`, like the function calls.
 */

export type MarketplaceQueryArgument = "uuid" | "text" | "integer" | "numeric" | "boolean" | "date"

interface QuerySpec {
  args: readonly MarketplaceQueryArgument[]
  text: string
}

const MEMBER_ROLES = "array['owner', 'manager', 'staff', 'driver']::text[]"
/** Who may change a business's equipment and availability (equipment_units / availability_reports updates). */
const DESK_ROLES = "array['owner', 'manager', 'staff']::text[]"

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
   * The profile fields an owner or manager may change. The service point is the home base's place-list point
   * ($7 latitude, $8 longitude; the guard trigger snaps it to the public grid), or none without a home base.
   */
  hauler_profile_update: {
    args: ["uuid", "text", "integer", "text", "boolean", "boolean", "numeric", "numeric"],
    text: `
with changed as (
  update marketplace.hauler_profiles
  set service_center = case
        when $7::text is null or $8::text is null then null
        else extensions.st_setsrid(extensions.st_makepoint($8::text::float8, $7::text::float8), 4326)::extensions.geography
      end,
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
  },

  // ---- My trucks (#126) -------------------------------------------------------------------------------------

  /** Whether the person may change the business's trucks, and whether it has a service area to report from. */
  hauler_fleet_access: {
    args: ["uuid"],
    text: `
select to_jsonb(a) as row from (
  select h.org_id,
         marketplace.has_org_role(h.org_id, ${DESK_ROLES}) as can_edit,
         h.service_center is not null and h.service_radius_miles is not null as placed
  from marketplace.hauler_profiles h
  where h.org_id = $1::text::uuid
    and marketplace.has_org_role(h.org_id, ${MEMBER_ROLES})
) as a`
  },

  /** The business's listed trucks and extras (equipment_units), in the reference list's order. */
  hauler_equipment_units: {
    args: ["uuid"],
    text: `
select to_jsonb(u) as row from (
  select eu.id, eu.equipment_code, eu.paired_trailer_code, eu.capacity_note, eu.unit_label, eu.unit_count, et.category
  from marketplace.equipment_units eu
  join marketplace.equipment_types et on et.code = eu.equipment_code
  where eu.org_id = $1::text::uuid
    and eu.is_active
    and et.category in ('truck', 'attachment')
    and marketplace.has_org_role(eu.org_id, ${MEMBER_ROLES})
  order by et.sort_order, eu.created_at, eu.unit_label
) as u`
  },

  /**
   * The latest self-report per truck type: the open report if there is one (V2 keeps at most one), otherwise the
   * latest withdrawal, which is "not available" as of `withdrawn_at`.
   */
  hauler_availability_latest: {
    args: ["uuid"],
    text: `
select to_jsonb(r) as row from (
  select distinct on (ar.equipment_code)
         ar.equipment_code, ar.available_count, ar.available_from, ar.available_until, ar.reported_at, ar.withdrawn_at
  from marketplace.availability_reports ar
  where ar.org_id = $1::text::uuid
    and marketplace.has_org_role(ar.org_id, ${MEMBER_ROLES})
  order by ar.equipment_code, (ar.withdrawn_at is null) desc, coalesce(ar.withdrawn_at, ar.reported_at) desc, ar.reported_at desc
) as r`
  },

  /**
   * Adds a configuration or extra; a removed row with the same label comes back with the new count (the label is
   * unique per business). Owner, manager or staff.
   */
  equipment_unit_upsert: {
    args: ["uuid", "text", "text", "text", "integer", "text"],
    text: `
with added as (
  insert into marketplace.equipment_units (org_id, equipment_code, paired_trailer_code, unit_label, unit_count, capacity_note)
  select $1::text::uuid, $2::text, $3::text, $4::text, $5::text::integer, $6::text
  where marketplace.has_org_role($1::text::uuid, ${DESK_ROLES})
  on conflict (org_id, unit_label) do update
    set equipment_code = excluded.equipment_code,
        paired_trailer_code = excluded.paired_trailer_code,
        unit_count = excluded.unit_count,
        capacity_note = excluded.capacity_note,
        is_active = true
  returning id
) select to_jsonb(added) as row from added`
  },

  /** A listed row's count; 0 takes it off the list (is_active = false; the row and its history stay). */
  equipment_unit_set_count: {
    args: ["uuid", "uuid", "integer"],
    text: `
with changed as (
  update marketplace.equipment_units
  set unit_count = case when $3::text::integer > 0 then $3::text::integer else unit_count end,
      is_active = $3::text::integer > 0
  where id = $2::text::uuid
    and org_id = $1::text::uuid
    and is_active
    and marketplace.has_org_role(org_id, ${DESK_ROLES})
  returning id, equipment_code
) select to_jsonb(changed) as row from changed`
  },

  /** Withdraws the open report of a truck type ("not available", or before a new report). */
  availability_withdraw: {
    args: ["uuid", "text"],
    text: `
with changed as (
  update marketplace.availability_reports
  set withdrawn_at = now()
  where org_id = $1::text::uuid
    and equipment_code = $2::text
    and withdrawn_at is null
    and marketplace.has_org_role(org_id, ${DESK_ROLES})
  returning id
) select to_jsonb(changed) as row from changed`
  },

  /** "Not available" said again: the latest withdrawal of that type, with no open report, is re-dated to now. */
  availability_restate_withdrawn: {
    args: ["uuid", "text"],
    text: `
with latest as (
  select ar.id
  from marketplace.availability_reports ar
  where ar.org_id = $1::text::uuid
    and ar.equipment_code = $2::text
    and ar.withdrawn_at is not null
    and not exists (select 1 from marketplace.availability_reports o
                    where o.org_id = ar.org_id and o.equipment_code = ar.equipment_code and o.withdrawn_at is null)
  order by ar.withdrawn_at desc
  limit 1
), changed as (
  update marketplace.availability_reports
  set withdrawn_at = now()
  where id in (select id from latest)
    and marketplace.has_org_role(org_id, ${DESK_ROLES})
  returning id
) select to_jsonb(changed) as row from changed`
  },

  /**
   * A new self-report: N trucks of a type, from a date, for the business's service area (its home base's point and
   * travel distance). Nothing is reported without a service area; the area is never guessed.
   */
  availability_insert: {
    args: ["uuid", "text", "integer", "date", "date"],
    text: `
with added as (
  insert into marketplace.availability_reports
    (org_id, equipment_code, available_count, area_center, area_label, radius_miles, available_from, available_until)
  select h.org_id, $2::text, $3::text::integer, h.service_center, h.base_area_label, h.service_radius_miles, $4::text::date, $5::text::date
  from marketplace.hauler_profiles h
  where h.org_id = $1::text::uuid
    and h.service_center is not null
    and h.service_radius_miles is not null
    and marketplace.has_org_role(h.org_id, ${DESK_ROLES})
  returning id
) select to_jsonb(added) as row from added`
  },

  /** "Confirm all as shown" for an open report: the same count, from today (or its later start) for a week. */
  availability_renew: {
    args: ["uuid", "text"],
    text: `
with changed as (
  update marketplace.availability_reports
  set available_from = greatest(available_from, current_date),
      available_until = greatest(available_from, current_date) + 7
  where org_id = $1::text::uuid
    and equipment_code = $2::text
    and withdrawn_at is null
    and marketplace.has_org_role(org_id, ${DESK_ROLES})
  returning id
) select to_jsonb(changed) as row from changed`
  },

  /** A list lowered below an open report brings the report down to the units still listed. */
  availability_clamp: {
    args: ["uuid", "text", "integer"],
    text: `
with changed as (
  update marketplace.availability_reports
  set available_count = $3::text::integer
  where org_id = $1::text::uuid
    and equipment_code = $2::text
    and withdrawn_at is null
    and available_count > $3::text::integer
    and marketplace.has_org_role(org_id, ${DESK_ROLES})
  returning id
) select to_jsonb(changed) as row from changed`
  },

  // ---- Billing (#248, #306) ---------------------------------------------------------------------------------

  /**
   * The business's founding-operator redemption (one per business, `UNIQUE (program, org_id)`) with its promotion's
   * terms. Owners only: the explicit role check keeps a billing admin, whom `promotion_redemptions_read` lets read
   * every business's redemption, to the business they own. A promotion row-level security hides leaves its terms NULL.
   */
  founding_offer: {
    args: ["uuid"],
    text: `
select to_jsonb(f) as row from (
  select pr.status, pr.granted_at, pr.cycles_applied, p.state_code, p.percent_off, p.billing_cycles
  from marketplace.promotion_redemptions pr
  left join marketplace.promotions p on p.id = pr.promotion_id and p.program = pr.program
  where pr.org_id = $1::text::uuid
    and pr.program = 'founding_landing'
    and marketplace.has_org_role(pr.org_id, array['owner']::text[])
) as f`
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
    case "numeric":
      if (typeof value === "number" && Number.isFinite(value)) return String(value)
      break
    case "boolean":
      if (typeof value === "boolean") return value ? "true" : "false"
      break
    case "date":
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
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
