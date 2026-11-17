import { HAULER_AVAILABILITY_STATES, MARKETPLACE_EQUIPMENT_GROUPS, NO_TRAILER, OTHER_TRAILER, type HaulerAvailabilityState } from "@logloads/contracts"

import { v2ErrorMessage, v2ErrorQuery, V2_ERROR_PARAM, V2_REFERENCE_PARAM, withV2Reference, type V2Failure } from "./error-codes"

/**
 * My trucks (#126): the page's forms, the answers their actions send back, and reading a post. Pure. Every form is a
 * plain POST to a server action, which answers with a redirect back to the page; what was posted travels back in the
 * query (truck types, counts and dates only, nothing private) so a refused or unavailable save keeps it.
 *
 * The answer names what happened with codes, never with words (#279): `notice` for a save and `error` (with `ref`)
 * for a failure. The page shows only the fixed copy for them, so a link cannot put its own text on the page.
 */

export const TRUCKS_PATH = "/v2/hauler/trucks"
export const TRUCKS_SETUP_PATH = `${TRUCKS_PATH}?setup=1`

export type FleetForm = "add" | "count" | "availability" | "confirm"
export type FleetOutcome = "saved" | "invalid" | "refused" | "unavailable" | "error"

export const FLEET_SAVE_UNAVAILABLE =
  "Saving trucks and availability isn't available in this preview yet. Nothing was saved; what you entered is still in the form."
export const FLEET_SAVE_FAILED = "We couldn't save that. Try again in a moment; what you entered is still in the form."

/** What a saved form says. "confirmed" also carries how many truck types were confirmed. */
const SAVED_NOTICES = {
  added: "Added to your trucks.",
  removed: "Removed from your trucks.",
  count_updated: "Count updated. Availability never shows more than you list.",
  not_available: "Saved as not available, dated today.",
  availability_saved: "Availability saved, dated today.",
  nothing_to_confirm: "Nothing to confirm: set each truck type's availability first."
} as const

export type FleetSavedNotice = keyof typeof SAVED_NOTICES

/** What an action answers with: what was saved, or why nothing was. */
export type FleetNotice =
  | { saved: FleetSavedNotice }
  | { saved: "confirmed"; confirmed: number }
  | { failure: V2Failure }
  | null

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
  /** Fixed copy for the answer's codes, never text from the query. */
  message: string | null
  /** The add form as posted, when it was not saved. */
  add: AddEquipmentValues | null
  /** The availability form as posted, when it was not saved. */
  availability: AvailabilityValues | null
  /** The listed row whose count was posted, and the count, when it was not saved. */
  count: { unitId: string; count: string } | null
}

function savedMessage(query: Query): string | null {
  const notice = one(query, "notice")

  if (notice === "confirmed") {
    const confirmed = /^[1-9]\d{0,2}$/.test(one(query, "confirmed")) ? Number(one(query, "confirmed")) : null
    return confirmed === null ? null : `Confirmed ${confirmed} truck type${confirmed === 1 ? "" : "s"} as shown, dated today.`
  }

  return Object.prototype.hasOwnProperty.call(SAVED_NOTICES, notice) ? SAVED_NOTICES[notice as FleetSavedNotice] : null
}

/** The words for an answer, from its codes only. An unknown code reads as the generic failure. */
function answerMessage(outcome: FleetOutcome, query: Query): string | null {
  const reference = one(query, V2_REFERENCE_PARAM)

  switch (outcome) {
    case "saved":
      return savedMessage(query)
    case "unavailable":
      return FLEET_SAVE_UNAVAILABLE
    case "error":
      return withV2Reference(FLEET_SAVE_FAILED, reference)
    default:
      return v2ErrorMessage(one(query, V2_ERROR_PARAM), reference)
  }
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
    message: result ? answerMessage(result, query) : null,
    outcome: result
  }
}

/** The query a fleet action redirects with: the outcome, its notice or error codes and (unless saved) what was posted. */
export function fleetAnswerQuery(form: FleetForm, outcome: FleetOutcome, notice: FleetNotice, posted: Record<string, string | string[]>, setup: boolean): string {
  const params = new URLSearchParams()
  if (setup) params.set("setup", "1")
  params.set("form", form)
  params.set("outcome", outcome)

  if (notice && "failure" in notice) {
    for (const [name, value] of Object.entries(v2ErrorQuery(notice.failure))) params.set(name, value)
  } else if (notice) {
    params.set("notice", notice.saved)
    if (notice.saved === "confirmed") params.set("confirmed", String(notice.confirmed))
  }

  if (outcome !== "saved") {
    for (const [name, value] of Object.entries(posted)) {
      for (const item of Array.isArray(value) ? value : [value]) if (item) params.append(name, item.slice(0, 80))
    }
  }

  return params.toString()
}
