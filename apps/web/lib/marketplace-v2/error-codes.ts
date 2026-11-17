import { HAULER_AVAILABILITY_LEAD_DAYS, HAULER_OTHER_TRAILER_MAX_LENGTH, HAULER_UNITS_MAX } from "@logloads/contracts"

/**
 * Marketplace V2 error codes (#279; design audit 1, C2 and C3). A V2 action that fails redirects with
 * `?error=<code>`, never with words, and a page shows only the fixed copy below for that code. A link therefore cannot
 * put its own text in a LogLoads alert, which would be a phishing vector ("call this number"). Nothing a person typed
 * or the store said travels in the URL, the browser history or a referrer either. An unknown or malformed value shows
 * the generic copy. `?ref=` carries the request id the failure was logged under (`error-log.ts`); a page shows it only
 * when it has the logged format.
 *
 * Pure and client-safe: the V2 error boundary (`app/v2/error.tsx`) imports it too. `error-log.ts` decides which code
 * a thrown error gets.
 */

export const V2_ERROR_PARAM = "error"
export const V2_REFERENCE_PARAM = "ref"

const COPY = {
  // --- Faults, and refusals without copy of their own. These are logged, with the reference shown. ---
  unexpected: "Something went wrong on our side. Try again in a moment.",
  busy: "LogLoads is busy right now. Try again in a moment.",
  refused: "LogLoads couldn't do that. Reload the page to see the latest, then try again.",
  invalid: "Some of the details weren't accepted. Check them and try again.",
  not_allowed: "This isn't available to your account. If you work for more than one business, check which one is selected.",
  not_found: "We couldn't find that. It may have been closed or removed.",
  conflict: "This changed while you were working on it. Reload the page and try again.",

  // --- Session, limits and the preview ---
  rate_limited: "You've tried this too many times in a short while. Wait a few minutes, then try again.",
  unavailable: "This isn't available in this preview yet. Nothing was changed.",
  sign_in_again: "Sign in again to continue.",
  choose_business: "Choose which business you're working for, then try again.",

  // --- Interest and inquiries ---
  job_not_found: "This job isn't listed anymore. It may have been closed or removed.",
  job_closed: "This job is no longer accepting interest. Nothing was sent.",
  job_unconfirmed: "This job is waiting for the poster to confirm it is still available, so it takes no new interest yet. Nothing was sent.",
  own_job: "This is your own business's job, so you can't send interest on it.",
  hauling_business_required: "Switch to a hauling business to express interest.",
  inquiry_role: "Your role cannot act on inquiries for this business.",
  inquiry_not_found: "Inquiry not found. It may have been removed, or it may belong to another business.",
  inquiry_declined: "The landing has closed this inquiry. Nothing more can be sent on it.",
  inquiry_withdrawn: "The hauler withdrew this inquiry, so it can't be answered.",
  inquiry_closed: "This inquiry is closed. Nothing more can be sent on it.",
  inquiry_full: "This conversation has reached its limit of 200 messages.",
  equipment_unknown: "Choose equipment from your business profile.",
  equipment_over_listed: "You offered more trucks than your business profile lists. Offer fewer, or add them in My trucks first.",
  trucks_required: "Enter how many trucks you can offer.",
  trucks_max: `Offer at most ${HAULER_UNITS_MAX} trucks.`,
  equipment_repeated: "List each equipment configuration once.",
  trucks_mismatch: "The truck total must equal the trucks listed for each equipment configuration.",
  availability_range: "Available until must not be before available from.",
  reply_required: "A reply needs a message.",

  // --- Publishing and confirming jobs ---
  cannot_publish: "Your role cannot publish jobs for this organization.",
  cannot_confirm: "Your role cannot confirm jobs for this organization.",
  fix_fields: "Fix the highlighted fields before publishing.",
  publish_attestation: "Tick all three confirmations before publishing.",
  landing_not_owned: "Choose one of your organization's landings.",
  not_own_job: "You can only confirm your organization's own job postings.",
  not_accepting: "Only a job that is accepting interest can be confirmed as still available.",
  reconfirm_attestation: "Tick the availability confirmation to record that this job is still available.",
  subscription_required: "Publishing needs an active landing plan.",

  // --- Landings ---
  landing_not_found: "That landing was not found.",
  landing_billing_inactive: "Billing isn't active yet, so no landing can recruit. Save it paused; it starts counting only once it recruits.",
  landing_cap: "Your plan's active landings are all in use.",
  landing_role: "Only an owner or manager can change this business's landings.",

  // --- My trucks ---
  fleet_fix_fields: "Fix the highlighted fields before saving.",
  fleet_not_hauling: "This business has no hauling profile.",
  fleet_edit_role: "Only an owner, manager or staff member of this business can change its trucks.",
  fleet_not_placed: "Availability is reported for the area around your home base. Add your home base and how far you travel on your business profile first.",
  fleet_nothing_to_withdraw: "Nothing was saved: no availability has been reported for this truck type yet, so there is nothing to mark not available.",
  fleet_already_listed: "That truck is already in your list. Change its count there.",
  fleet_truck_type_unknown: "Choose one of your truck types.",
  fleet_type_not_listed: "That truck type isn't in your list. Add it to your trucks before reporting it available.",
  fleet_over_listed: "You can't report more trucks available than you list. Lower the count, or add trucks first.",
  fleet_start_date: `Choose a start date from today to ${HAULER_AVAILABILITY_LEAD_DAYS} days ahead.`,
  fleet_count_from_1: "Enter how many, from 1.",
  fleet_count_from_0: "Enter how many, from 0.",
  fleet_count_max: `Enter a number up to ${HAULER_UNITS_MAX}.`,
  fleet_truck_required: "Choose the truck.",
  fleet_other_trailer: `Describe the trailer in 2 to ${HAULER_OTHER_TRAILER_MAX_LENGTH} characters.`,
  fleet_available_count: "Enter how many are available, from 1.",
  fleet_truck_type_required: "Choose the truck type.",
  fleet_available_date: "Choose the date trucks are free.",
  fleet_available_state: "Choose whether trucks are available."
} as const satisfies Record<string, string>

export type V2ErrorCode = keyof typeof COPY

/** Every code, in catalogue order. */
export const V2_ERROR_CODES = Object.freeze(Object.keys(COPY)) as readonly V2ErrorCode[]

/** The code an unknown value shows. */
export const V2_GENERIC_ERROR = "unexpected" satisfies V2ErrorCode

/** The codes for a failure on LogLoads' side rather than a refusal: pages may word their own context around them. */
export const V2_FAULT_CODES: ReadonlySet<V2ErrorCode> = new Set<V2ErrorCode>(["unexpected", "busy"])

/** `error-log.ts` makes request ids of 12 lowercase hex digits; nothing else is ever shown as a reference. */
const REFERENCE = /^[0-9a-f]{12}$/

export function isV2ErrorCode(value: unknown): value is V2ErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(COPY, value)
}

export function isV2Reference(value: unknown): value is string {
  return typeof value === "string" && REFERENCE.test(value)
}

/** The fixed copy for a code: the generic copy for anything that is not one. */
export function v2ErrorCopy(code: unknown): string {
  return COPY[isV2ErrorCode(code) ? code : V2_GENERIC_ERROR]
}

/** A page's own sentence for a failure, then the reference when it has the logged format. */
export function withV2Reference(text: string, reference?: unknown): string {
  return isV2Reference(reference) ? `${text} Reference: ${reference}.` : text
}

/** A Next.js error digest: the id the server logged an uncaught error under (and Sentry recorded). */
const DIGEST = /^[A-Za-z0-9_-]{1,64}$/

/**
 * What the V2 error boundary says (`app/v2/error.tsx`): the generic copy, and the error's digest as its reference.
 * Never the error's own message, which on the server can name a store or a value.
 */
export function v2ErrorBoundaryMessage(digest: unknown): string {
  const copy = v2ErrorCopy(V2_GENERIC_ERROR)
  return typeof digest === "string" && DIGEST.test(digest) ? `${copy} Reference: ${digest}.` : copy
}

/** What a page says for a failure: the code's copy, then the reference when it has the logged format. */
export function v2ErrorMessage(code: unknown, reference?: unknown): string {
  return withV2Reference(v2ErrorCopy(code), reference)
}

/** A failure as `error-log.ts` reports it: its code, and the request id when it was logged. */
export interface V2Failure {
  code: V2ErrorCode
  requestId: string | null
}

/** The query a failed action redirects with: `error` and, when the failure was logged, `ref`. Never any words. */
export function v2ErrorQuery(failure: V2Failure): Record<string, string> {
  return isV2Reference(failure.requestId)
    ? { [V2_ERROR_PARAM]: failure.code, [V2_REFERENCE_PARAM]: failure.requestId }
    : { [V2_ERROR_PARAM]: failure.code }
}

export interface V2ErrorNotice {
  /** The code to act on: the generic code when the URL named an unknown one. */
  code: V2ErrorCode
  /** Fixed copy, with the reference when there is one. Never text from the URL. */
  message: string
}

type Query = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

/** A page's error notice from its query: `null` without `?error=`, otherwise fixed copy only. */
export function v2ErrorNotice(query: Query): V2ErrorNotice | null {
  const asked = first(query[V2_ERROR_PARAM])

  if (!asked) {
    return null
  }

  const code = isV2ErrorCode(asked) ? asked : V2_GENERIC_ERROR
  return { code, message: v2ErrorMessage(code, first(query[V2_REFERENCE_PARAM])) }
}
