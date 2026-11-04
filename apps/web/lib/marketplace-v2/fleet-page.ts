import { HAULER_AVAILABILITY_STATES, MARKETPLACE_EQUIPMENT_GROUPS, NO_TRAILER, OTHER_TRAILER, type HaulerAvailabilityState } from "@logloads/contracts"

/**
 * My trucks (#126): the page's forms, the answers their actions send back, and reading a post. Pure. Every form is a
 * plain POST to a server action, which answers with a redirect back to the page; what was posted travels back in the
 * query (truck types, counts and dates only, nothing private) so a refused or unavailable save keeps it.
 */

export const TRUCKS_PATH = "/v2/hauler/trucks"
export const TRUCKS_SETUP_PATH = `${TRUCKS_PATH}?setup=1`

export type FleetForm = "add" | "count" | "availability" | "confirm"
export type FleetOutcome = "saved" | "invalid" | "refused" | "unavailable" | "error"

export const FLEET_SAVE_UNAVAILABLE =
  "Saving trucks and availability isn't available in this preview yet. Nothing was saved; what you entered is still in the form."
export const FLEET_SAVE_FAILED = "We couldn't save that. Try again in a moment; what you entered is still in the form."

const TRUCKS = new Set<string>(MARKETPLACE_EQUIPMENT_GROUPS.truck.map((type) => type.code))
const TRAILERS = new Set<string>([NO_TRAILER, OTHER_TRAILER, ...MARKETPLACE_EQUIPMENT_GROUPS.trailer.map((type) => type.code)])
const ATTACHMENTS = new Set<string>(MARKETPLACE_EQUIPMENT_GROUPS.attachment.map((type) => type.code))
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Query = Record<string, string | string[] | undefined>

function one(query: Query, name: string): string {
  const value = query[name]
  return ((Array.isArray(value) ? value[0] : value) ?? "").slice(0, 200)
}

function all(query: Query, name: string): string[] {
  const value = query[name]
  return (Array.isArray(value) ? value : value === undefined ? [] : [value]).slice(0, 10)
}

export interface AddEquipmentValues {
  truckCode: string
  trailer: string
  otherTrailer: string
  attachments: string[]
  count: string
}

export interface AvailabilityValues {
  equipmentCode: string
  state: HaulerAvailabilityState
  fromDate: string
  count: string
}

export interface FleetAnswer {
  form: FleetForm | null
  outcome: FleetOutcome | null
  message: string | null
  /** The add form as posted, when it was not saved. */
  add: AddEquipmentValues | null
  /** The availability form as posted, when it was not saved. */
  availability: AvailabilityValues | null
  /** The listed row whose count was posted, and the count, when it was not saved. */
  count: { unitId: string; count: string } | null
}

/** Reads the page query back into the last form's answer. Only known values survive; anything else is dropped. */
export function fleetAnswerFromQuery(query: Query): FleetAnswer {
  const form = one(query, "form") as FleetForm
  const outcome = one(query, "outcome") as FleetOutcome
  const known = ["add", "count", "availability", "confirm"].includes(form) ? form : null
  const result = ["saved", "invalid", "refused", "unavailable", "error"].includes(outcome) ? outcome : null
  const kept = result !== null && result !== "saved"
  const state = one(query, "state") as HaulerAvailabilityState

  return {
    add: known === "add" && kept
      ? {
          attachments: all(query, "attachments").filter((code) => ATTACHMENTS.has(code)),
          count: one(query, "count").replace(/[^0-9]/g, "").slice(0, 3),
          otherTrailer: one(query, "otherTrailer").slice(0, 80),
          trailer: TRAILERS.has(one(query, "trailer")) ? one(query, "trailer") : NO_TRAILER,
          truckCode: TRUCKS.has(one(query, "truckCode")) ? one(query, "truckCode") : ""
        }
      : null,
    availability: known === "availability" && kept && TRUCKS.has(one(query, "equipmentCode"))
      ? {
          count: one(query, "count").replace(/[^0-9]/g, "").slice(0, 3),
          equipmentCode: one(query, "equipmentCode"),
          fromDate: /^\d{4}-\d{2}-\d{2}$/.test(one(query, "fromDate")) ? one(query, "fromDate") : "",
          state: (HAULER_AVAILABILITY_STATES as readonly string[]).includes(state) ? state : "now"
        }
      : null,
    count: known === "count" && kept && UUID.test(one(query, "unitId"))
      ? { count: one(query, "count").replace(/[^0-9]/g, "").slice(0, 3), unitId: one(query, "unitId") }
      : null,
    form: known,
    message: result ? one(query, "message").slice(0, 300) || null : null,
    outcome: result
  }
}

/** The query a fleet action redirects with: the outcome, its message and (unless saved) what was posted. */
export function fleetAnswerQuery(form: FleetForm, outcome: FleetOutcome, message: string | null, posted: Record<string, string | string[]>, setup: boolean): string {
  const params = new URLSearchParams()
  if (setup) params.set("setup", "1")
  params.set("form", form)
  params.set("outcome", outcome)
  if (message) params.set("message", message.slice(0, 300))

  if (outcome !== "saved") {
    for (const [name, value] of Object.entries(posted)) {
      for (const item of Array.isArray(value) ? value : [value]) if (item) params.append(name, item.slice(0, 80))
    }
  }

  return params.toString()
}
