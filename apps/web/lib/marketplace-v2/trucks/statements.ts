/**
 * Table statements for trucks (#251). They run as the signed-in person (`authenticated`), so the schema's row-level
 * security decides what each returns, and each one also names the active business (`$1`) and checks the person's role
 * in it, so a person in several businesses only ever reads the one they act for:
 *
 *   hauler_profiles       `hauler_profiles_read`: a listed business (`is_public`, which needs recorded consent,
 *                         `hauler_profiles_public_consent_chk`) to a paid landing seat (`current_user_has_landing_access`)
 *   organizations         `organizations_read` / `org_has_public_presence`: a listed business's name and identity review
 *                         (16 grants only public columns)
 *   equipment_units       `equipment_units_read`: a listed business's active equipment, to a paid landing seat
 *   availability_reports  `availability_read`: open reports that have not ended, of a listed business, to a paid seat
 *   saved_searches        `saved_searches_own`: the person's own searches; insert without `owner_user_id`, update only
 *                         `name`, `criteria` and `alerts_enabled` (02 grants)
 *
 * The directory statement repeats the rules row-level security does not know: the business must be listed, active and
 * not the landing's own, and the LANDING must hold a Landing Operator seat at a business whose identity LogLoads
 * reviewed (legal review §9.3 item 4). It applies every filter and the named sort before its page limit, so no
 * business is cut before it could be found; the rules then decide again on the page. Points are rounded to the
 * public 0.1° grid in SQL (V2-DEC-01). Nothing here
 * selects a phone, an email address, a description, an equipment note or an exact point, and the order never reads
 * the identity review (§7.3 item 5). Every value is a bound parameter.
 *
 * These are not in `MARKETPLACE_QUERIES` (normalized-queries.ts) yet. That file is shared and this task does not edit
 * it: `TRUCK_STATEMENTS` is the exact entry, `args` included, for its owner to add. Until every name a method runs is
 * catalogued, the whole group refuses and reaches no store (`./index.ts`).
 */

import { TRUCK_DIRECTORY_PAGE_SIZE } from "@logloads/contracts"

import type { MarketplaceQueryArgument, MarketplaceQueryValue } from "../normalized-queries"

export const TRUCK_STATEMENT_NAMES = [
  "truck_delete_search",
  "truck_directory",
  "truck_insert_search",
  "truck_list_searches",
  "truck_update_search",
  "truck_viewer_identity"
] as const

export type TruckStatementName = (typeof TRUCK_STATEMENT_NAMES)[number]

interface StatementSpec {
  /** The `MarketplaceQueryArgument` of each parameter, as `MARKETPLACE_QUERIES` declares them. */
  args: readonly MarketplaceQueryArgument[]
  text: string
}

const MEMBER_ROLES = "array['owner', 'manager', 'staff', 'driver']::text[]"
const DESK_ROLES = "array['owner', 'manager', 'staff']::text[]"

export const TRUCK_STATEMENTS: Readonly<Record<TruckStatementName, StatementSpec>> = {
  /** $1 org. The active business's identity review, for any member. */
  truck_viewer_identity: {
    args: ["uuid"],
    text: `
select to_jsonb(v) as row from (
  select o.id as org_id, o.verification_status, o.verified_at
  from marketplace.organizations o
  where o.id = $1::text::uuid
    and o.status = 'active'
    and marketplace.has_org_role(o.id, ${MEMBER_ROLES})
) as v`
  },

  /**
   * One directory page, filtered and ordered here so the page is the right one whatever the directory's size:
   * $1 the landing business, $2 one equipment code (a truck, a trailer or an extra) or NULL, $3 text in the business
   * name or home base or NULL, $4 available only, $5 identity reviewed only, $6/$7 the typed place (snapped to the
   * 0.1° grid again here) or NULL, $8 miles around it or NULL, $9 the named sort key, $10 at most this many (1–25).
   *
   * Listed, active hauling businesses other than the landing's own, each with its active equipment and its open
   * reports that have not ended. Only for a Landing Operator seat (owner, manager or staff) at a business whose
   * identity was reviewed. "Current" is the rules' freshness band: reported in the last 7 days and not ended. A
   * distance is to the business's public point, with the 8,000 m the job search adds for the grid. The order is the
   * key's (`compareTruckCards`): distance, then freshness band and latest report, then name and id. Never the review.
   */
  truck_directory: {
    args: ["uuid", "text", "text", "boolean", "boolean", "numeric", "numeric", "integer", "text", "integer"],
    text: `
with origin as (
  select case when $6::text is null or $7::text is null then null
              else extensions.st_setsrid(extensions.st_makepoint(round($7::text::numeric, 1)::double precision,
                                                                 round($6::text::numeric, 1)::double precision), 4326)::extensions.geography
         end as point
), listed as (
  select h.org_id, o.display_name, o.verification_status, o.verified_at, h.is_public, h.base_area_label,
         h.service_radius_miles, h.operating_states, h.accepts_targeted_invitations, h.service_center,
         (select max(r.reported_at) from marketplace.availability_reports r
          where r.org_id = h.org_id and r.withdrawn_at is null and r.available_until >= current_date) as latest_open,
         exists (select 1 from marketplace.availability_reports r
                 where r.org_id = h.org_id and r.withdrawn_at is null and r.available_until >= current_date
                   and r.reported_at > now() - interval '7 days') as has_current,
         round((extensions.st_distance(h.service_center, origin.point) / 1609.344)::numeric) as miles
  from marketplace.hauler_profiles h
  join marketplace.organizations o on o.id = h.org_id and o.status = 'active'
  cross join origin
  where h.is_public
    and h.org_id <> $1::text::uuid
    and marketplace.has_org_role($1::text::uuid, ${DESK_ROLES}, true)
    and exists (select 1 from marketplace.organizations v
                where v.id = $1::text::uuid and v.status = 'active' and v.verification_status = 'verified')
    and ($2::text is null
         or exists (select 1 from marketplace.equipment_units f
                    where f.org_id = h.org_id and f.is_active
                      and (f.equipment_code = $2::text or f.paired_trailer_code = $2::text)))
    and ($3::text is null
         or position(lower($3::text) in lower(o.display_name)) > 0
         or position(lower($3::text) in lower(coalesce(h.base_area_label, ''))) > 0)
    and (not coalesce($4::text::boolean, false)
         or exists (select 1 from marketplace.availability_reports c
                    where c.org_id = h.org_id and c.withdrawn_at is null and c.available_until >= current_date
                      and c.reported_at > now() - interval '7 days'
                      and ($2::text is null
                           or c.equipment_code = $2::text
                           or not exists (select 1 from marketplace.equipment_types t
                                          where t.code = $2::text and t.category = 'truck'))))
    and (not coalesce($5::text::boolean, false) or o.verification_status = 'verified')
    and ($8::text is null or origin.point is null
         or (h.service_center is not null
             and extensions.st_dwithin(h.service_center, origin.point, $8::text::integer * 1609.344 + 8000)))
)
select to_jsonb(d) as row from (
  select l.org_id, l.display_name, l.verification_status, l.verified_at, l.is_public, l.base_area_label,
         l.service_radius_miles, l.operating_states, l.accepts_targeted_invitations,
         round(extensions.st_y(l.service_center::extensions.geometry)::numeric, 1) as service_lat,
         round(extensions.st_x(l.service_center::extensions.geometry)::numeric, 1) as service_lng,
         coalesce((
           select jsonb_agg(jsonb_build_object('equipment_code', eu.equipment_code, 'paired_trailer_code', eu.paired_trailer_code,
                                               'unit_count', eu.unit_count)
                            order by et.sort_order, eu.created_at, eu.id)
           from marketplace.equipment_units eu
           join marketplace.equipment_types et on et.code = eu.equipment_code
           where eu.org_id = l.org_id and eu.is_active and et.category in ('truck', 'attachment')
         ), '[]'::jsonb) as equipment,
         coalesce((
           select jsonb_agg(jsonb_build_object('id', ar.id, 'equipment_code', ar.equipment_code,
                                               'available_count', ar.available_count, 'available_from', ar.available_from,
                                               'available_until', ar.available_until, 'reported_at', ar.reported_at)
                            order by ar.reported_at desc, ar.id)
           from marketplace.availability_reports ar
           where ar.org_id = l.org_id and ar.withdrawn_at is null and ar.available_until >= current_date
         ), '[]'::jsonb) as availability
  from listed l
  order by case when $9::text = 'distance' then l.miles end asc nulls last,
           case when $9::text <> 'name' then case when l.has_current then 0 when l.latest_open is not null then 1 else 2 end end,
           case when $9::text <> 'name' then l.latest_open end desc nulls last,
           lower(l.display_name), l.org_id
  limit least(greatest($10::text::integer, 1), ${TRUCK_DIRECTORY_PAGE_SIZE})
) as d`
  },

  /** $1 org. The person's own truck searches, newest edit first. */
  truck_list_searches: {
    args: ["uuid"],
    text: `
select to_jsonb(s) as row from (
  select id, kind, name, criteria, alerts_enabled, last_alerted_at, updated_at
  from marketplace.saved_searches
  where org_id = $1::text::uuid
    and owner_user_id = marketplace.current_user_id()
    and kind = 'trucks'
    and marketplace.has_org_role($1::text::uuid, ${MEMBER_ROLES})
  order by updated_at desc, id
) as s`
  },

  /**
   * A new truck search: $2 name, $3 criteria as JSON, $4 alerts on. Kind is always trucks; the owner is the column
   * default. Only with a seat at a business whose plan has availability alerts (`org_has_feature`).
   */
  truck_insert_search: {
    args: ["uuid", "text", "text", "boolean"],
    text: `
with added as (
  insert into marketplace.saved_searches (org_id, kind, name, criteria, alerts_enabled)
  select $1::text::uuid, 'trucks', $2::text, $3::text::jsonb, $4::text::boolean
  where marketplace.org_has_feature($1::text::uuid, 'availability_alerts')
  returning id
) select to_jsonb(added) as row from added`
  },

  /**
   * Edits one of the person's own truck searches ($2 search): $3 name, $4 criteria as JSON, $5 alerts on. Only the
   * granted columns change, and only while the plan has availability alerts. No row: not one of theirs, or no plan.
   */
  truck_update_search: {
    args: ["uuid", "uuid", "text", "text", "boolean"],
    text: `
with changed as (
  update marketplace.saved_searches
  set name = $3::text, criteria = $4::text::jsonb, alerts_enabled = $5::text::boolean
  where id = $2::text::uuid
    and org_id = $1::text::uuid
    and owner_user_id = marketplace.current_user_id()
    and kind = 'trucks'
    and marketplace.org_has_feature($1::text::uuid, 'availability_alerts')
  returning id
) select to_jsonb(changed) as row from changed`
  },

  /** Deletes one of the person's own truck searches ($2 search), whatever the plan. Already gone changes nothing. */
  truck_delete_search: {
    args: ["uuid", "uuid"],
    text: `
with removed as (
  delete from marketplace.saved_searches
  where id = $2::text::uuid
    and org_id = $1::text::uuid
    and owner_user_id = marketplace.current_user_id()
    and kind = 'trucks'
    and marketplace.has_org_role($1::text::uuid, ${MEMBER_ROLES})
  returning id
)
select jsonb_build_object('changed', exists (select 1 from removed)) as row
where marketplace.has_org_role($1::text::uuid, ${MEMBER_ROLES})`
  }
}

/**
 * The function this group needs that stage 01–29 does not have (#251's catalogue request): it counts one directory
 * page and its cards against the seat's daily limits, atomically, and answers how many cards may be shown.
 */
export const TRUCK_FUNCTION_NAMES = ["record_truck_directory_page"] as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function bind(value: MarketplaceQueryValue, type: MarketplaceQueryArgument, name: string, position: number): string | null {
  if (value === null) return null

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
    default:
      break
  }

  throw new TypeError(`${name}: argument $${position} must be a ${type}`)
}

/** The statement and its bound values, checked as `marketplaceQueryStatement` checks a catalogued one. */
export function truckStatement(name: TruckStatementName, values: readonly MarketplaceQueryValue[]): { text: string; values: Array<string | null> } {
  const spec = TRUCK_STATEMENTS[name]

  if (!spec || values.length !== spec.args.length) {
    throw new TypeError(`${name} takes exactly ${spec?.args.length ?? 0} values`)
  }

  return { text: spec.text, values: values.map((value, index) => bind(value, spec.args[index] as MarketplaceQueryArgument, name, index + 1)) }
}
