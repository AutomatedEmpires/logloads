import { randomBytes } from "node:crypto"

import {
  HAULER_OTHER_TRAILER_MAX_LENGTH,
  HAULER_UNITS_MAX,
  LANDING_BILLING_INACTIVE_REFUSAL,
  MARKETPLACE_JOB_UNCONFIRMED_LABEL,
  PUBLISH_ATTESTATION_REQUIRED
} from "@logloads/contracts"
import { FLEET_EDIT_REFUSED, FLEET_NOT_HAULING, FLEET_NOT_PLACED, FLEET_NOTHING_TO_WITHDRAW } from "@logloads/services"

import { LANDING_NOT_OWNED } from "./draft-params"
import { V2_FAULT_CODES, v2ErrorCopy, v2ErrorMessage, type V2ErrorCode, type V2Failure } from "./error-codes"
import { MarketplaceOperationUnavailableError, MarketplaceRefusalError } from "./port"

/**
 * Server side of the V2 error codes (#279; design audit 1, C3 and K2). `reportV2Error` decides which code a thrown
 * error gets and logs what an operator needs, under a fresh request id:
 *
 * - a refusal LogLoads has copy for (`error-codes.ts`) gets that code, and is not logged: the person can act on it;
 * - any other refusal gets a code for its kind (not allowed, not found, conflict, invalid or refused) and is logged
 *   at info level, so a refusal without its own copy shows up;
 * - everything else (a store failure, a busy store, a bug) gets `unexpected` or `busy` and is logged as an error.
 *
 * A log entry holds the request id, the operation, the code, the error's class name and SQLSTATE, the same two for its
 * cause, and for a fault the stack frames. It never holds a message, a value, a query or anything a person typed.
 * The page shows the request id as "Reference: …", so a report from a person leads to the log entry.
 *
 * Server code (node:crypto). Not "server-only", because the "use server" action modules that import it are tested
 * without that shim.
 */

export interface V2ErrorEvent {
  requestId: string
  operation: string
  code: V2ErrorCode
  name: string
  sqlstate: string | null
  cause: { name: string; sqlstate: string | null } | null
  /** Stack frames (function and file position only), for faults. */
  frames: string[]
}

export type V2ErrorLog = (level: "error" | "info", event: V2ErrorEvent) => void

const LOG_MESSAGE = "logloads: marketplace v2 request failed"

function defaultLog(level: "error" | "info", event: V2ErrorEvent): void {
  if (level === "error") {
    console.error(LOG_MESSAGE, event)
  } else {
    console.info(LOG_MESSAGE, event)
  }
}

/** 12 lowercase hex digits, the only reference format `error-codes.ts` shows. */
export function newV2RequestId(): string {
  return randomBytes(6).toString("hex")
}

/** Trimmed, without one trailing full stop: the store and the services do not agree on the stop. */
function normalized(text: string): string {
  return text.trim().replace(/\.$/, "")
}

/**
 * Refusals LogLoads has copy for, by their exact text (normalized). The copy shown is always the catalogue's, so the
 * text here only identifies the refusal; it is never displayed. The sources are the services (pilot store), the
 * normalized adapter and the store's own functions, and the contracts' validation messages.
 */
const KNOWN: ReadonlyMap<string, V2ErrorCode> = new Map<string, V2ErrorCode>(
  ([
    // Session and limits
    ["Too many attempts. Wait a moment and try again.", "rate_limited"],
    ["Sign in again to continue.", "sign_in_again"],
    ["Choose a business before continuing", "choose_business"],
    ["Choose a workspace before continuing", "choose_business"],
    ["No business is selected for your account.", "choose_business"],
    ["This is not available to your account.", "not_allowed"],
    ["This business is not available to your account.", "not_allowed"],
    ["This changed while you were working on it. Reload the page and try again.", "conflict"],
    // Interest and inquiries
    ["Job not found", "job_not_found"],
    ["This job is no longer accepting interest", "job_closed"],
    [MARKETPLACE_JOB_UNCONFIRMED_LABEL, "job_unconfirmed"],
    ["You cannot express interest in your own organization's job", "own_job"],
    ["A landing organization cannot express interest in its own job", "own_job"],
    ["Switch to a hauling business to express interest", "hauling_business_required"],
    ["Your role cannot act on inquiries for this business", "inquiry_role"],
    ["Inquiry not found", "inquiry_not_found"],
    ["not authorized for this inquiry", "inquiry_not_found"],
    ["The landing has closed this inquiry", "inquiry_declined"],
    ["The hauler withdrew this inquiry", "inquiry_withdrawn"],
    ["This inquiry is closed", "inquiry_closed"],
    ["This inquiry is already closed", "inquiry_closed"],
    ["Maximum of 200 messages reached for this inquiry", "inquiry_full"],
    ["Choose equipment from your business profile", "equipment_unknown"],
    ["Enter how many trucks you can offer", "trucks_required"],
    [`Offer at most ${HAULER_UNITS_MAX} trucks`, "trucks_max"],
    ["List each equipment configuration once", "equipment_repeated"],
    ["Trucks offered must equal the trucks listed per equipment configuration", "trucks_mismatch"],
    ["Available until must not be before available from", "availability_range"],
    ["A reply needs a message", "reply_required"],
    // Publishing and confirming jobs
    ["Your role cannot publish jobs for this organization", "cannot_publish"],
    ["Your role cannot confirm jobs for this organization", "cannot_confirm"],
    ["Fix the highlighted fields before publishing", "fix_fields"],
    [PUBLISH_ATTESTATION_REQUIRED, "publish_attestation"],
    [LANDING_NOT_OWNED, "landing_not_owned"],
    ["You can only confirm your organization's own job postings", "not_own_job"],
    ["Only a job that is accepting interest can be confirmed as still available", "not_accepting"],
    ["Only active job postings can be confirmed available", "not_accepting"],
    ["Tick the availability confirmation to record that this job is still available", "reconfirm_attestation"],
    ["an active landing subscription is required to publish", "subscription_required"],
    // Landings
    ["That landing was not found", "landing_not_found"],
    [LANDING_BILLING_INACTIVE_REFUSAL, "landing_billing_inactive"],
    ["Only an owner or manager can change this business's landings", "landing_role"],
    // My trucks
    ["Fix the highlighted fields before saving", "fleet_fix_fields"],
    [FLEET_NOT_HAULING, "fleet_not_hauling"],
    [FLEET_EDIT_REFUSED, "fleet_edit_role"],
    [FLEET_NOT_PLACED, "fleet_not_placed"],
    [FLEET_NOTHING_TO_WITHDRAW, "fleet_nothing_to_withdraw"],
    ["Choose one of your truck types", "fleet_truck_type_unknown"],
    ["Enter how many, from 1", "fleet_count_from_1"],
    ["Enter how many, from 0", "fleet_count_from_0"],
    [`Enter a number up to ${HAULER_UNITS_MAX}`, "fleet_count_max"],
    ["Choose the truck", "fleet_truck_required"],
    [`Describe the trailer in 2 to ${HAULER_OTHER_TRAILER_MAX_LENGTH} characters`, "fleet_other_trailer"],
    ["Enter how many are available, from 1", "fleet_available_count"],
    ["Choose the truck type", "fleet_truck_type_required"],
    ["Choose the date trucks are free", "fleet_available_date"],
    ["Choose whether trucks are available", "fleet_available_state"]
  ] as const).map(([text, code]) => [normalized(text), code])
)

/** Refusals whose text carries a count, a label or a plan name: matched by shape, and their copy names none of it. */
const SHAPES: ReadonlyArray<readonly [RegExp, V2ErrorCode]> = [
  [/^Your profile lists \d+ x .+; update your equipment to offer more$/, "equipment_over_listed"],
  [/^trucks_offered \(\d+\) must equal the sum of trucks listed per equipment configuration \(\d+\)$/, "trucks_mismatch"],
  [/^Your .+ plan allows \d+ active landings?, and (?:it is|all are) in use\. Pause another landing or see plans$/, "landing_cap"],
  [/^.+ is already in your list\. Change its count there$/, "fleet_already_listed"],
  [/^No .+ is listed\. Add it to your trucks before reporting it available$/, "fleet_type_not_listed"],
  [/^You have \d+ .+ listed, so at most \d+ can be available$/, "fleet_over_listed"],
  [/^Choose a start date from today to \d+ days ahead$/, "fleet_start_date"]
]

function knownCode(text: string): V2ErrorCode | null {
  const key = normalized(text)

  if (key.length === 0 || key.length > 400) {
    return null
  }

  return KNOWN.get(key) ?? SHAPES.find(([shape]) => shape.test(key))?.[1] ?? null
}

/** Rate limiting, the operating-state document and Zod set `name` themselves, so it survives minification. */
function named(error: unknown, ...names: string[]): boolean {
  return error instanceof Error && names.includes(error.name)
}

function zodIssueMessages(error: unknown): string[] | null {
  if (!named(error, "ZodError")) return null
  const issues = (error as { issues?: unknown }).issues
  return Array.isArray(issues) ? issues.flatMap((issue) => (typeof (issue as { message?: unknown })?.message === "string" ? [(issue as { message: string }).message] : [])) : []
}

function sqlstateOf(error: unknown): string | null {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : null
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : null
}

const REFUSAL_BY_SQLSTATE: Readonly<Record<string, V2ErrorCode>> = {
  "22000": "invalid",
  "22007": "invalid",
  "22023": "invalid",
  "22P02": "invalid",
  "23505": "conflict",
  "40001": "conflict",
  "40P01": "conflict",
  "42501": "not_allowed",
  P0002: "not_found"
}

type Classified = { code: V2ErrorCode; log: "none" | "info" | "error" }

function classify(error: unknown): Classified {
  if (error instanceof MarketplaceOperationUnavailableError) {
    return { code: "unavailable", log: "none" }
  }

  if (named(error, "RateLimitError")) {
    return { code: "rate_limited", log: "none" }
  }

  if (named(error, "RateLimitUnavailableError", "OperatingStateConflictError", "OperatingStateUnavailableError")) {
    return { code: "busy", log: "error" }
  }

  const issues = zodIssueMessages(error)

  if (issues) {
    const code = issues.map(knownCode).find((candidate) => candidate !== null)
    return code ? { code, log: "none" } : { code: "invalid", log: "info" }
  }

  const known = error instanceof Error ? knownCode(error.message) : null

  if (known) {
    return { code: known, log: "none" }
  }

  if (error instanceof MarketplaceRefusalError) {
    return { code: REFUSAL_BY_SQLSTATE[error.code ?? ""] ?? "refused", log: "info" }
  }

  if (named(error, "DomainRefusalError")) {
    return { code: "refused", log: "info" }
  }

  return { code: "unexpected", log: "error" }
}

function safeName(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error
  return /^[A-Za-z][A-Za-z0-9_$]{0,63}$/.test(name) ? name : "Error"
}

/**
 * Stack frames only: lines that are "at <function> (<file>:<line>:<column>)". The stack starts with "<name>: <message>",
 * and those lines are skipped by count first, so a message line shaped like a frame is never logged.
 */
function framesOf(error: unknown): string[] {
  if (!(error instanceof Error) || typeof error.stack !== "string") return []

  const header = `${error.name}: ${error.message}`.split("\n").length

  return error.stack
    .split("\n")
    .slice(header)
    .map((line) => line.trim())
    .filter((line) => line.length <= 300 && /^at .+:\d+:\d+\)?$/.test(line))
    .slice(0, 6)
}

function operationName(operation: string): string {
  return /^[a-z][a-z0-9_.-]{0,79}$/i.test(operation) ? operation : "unknown"
}

/**
 * The code for a failed V2 operation, logged under a new request id unless it is a refusal with its own copy.
 * `operation` names what was attempted, such as "interest.express"; it is logged as given when it is a plain name.
 * A Next.js redirect or not-found is not a failure: callers rethrow those first (`unstable_rethrow`).
 */
export function reportV2Error(error: unknown, operation: string, log: V2ErrorLog = defaultLog): V2Failure {
  const { code, log: level } = classify(error)

  if (level === "none") {
    return { code, requestId: null }
  }

  const requestId = newV2RequestId()
  const cause = error instanceof Error && error.cause !== undefined ? error.cause : undefined

  log(level, {
    cause: cause === undefined ? null : { name: safeName(cause), sqlstate: sqlstateOf(cause) },
    code,
    frames: level === "error" ? framesOf(error) : [],
    name: safeName(error),
    operation: operationName(operation),
    requestId,
    sqlstate: sqlstateOf(error)
  })

  return { code, requestId }
}

/**
 * Words for a failure shown inside a page or a form's state, never in a URL. A refusal with its own copy shows that
 * copy. Another store refusal shows its own text, which the store writes for the person using the page (port.ts);
 * anything else shows the code's copy with its reference.
 */
export function v2FailureMessage(error: unknown, operation: string, log: V2ErrorLog = defaultLog): string {
  const failure = reportV2Error(error, operation, log)

  if (failure.requestId === null) {
    return v2ErrorCopy(failure.code)
  }

  if (error instanceof MarketplaceRefusalError && !V2_FAULT_CODES.has(failure.code)) {
    const text = error.message.trim().slice(0, 300)
    if (text) return text
  }

  return v2ErrorMessage(failure.code, failure.requestId)
}
