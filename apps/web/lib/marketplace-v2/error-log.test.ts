import {
  expressInterestInputSchema,
  haulerAvailabilityInputSchema,
  haulerEquipmentAddInputSchema,
  landingAtCapRefusal,
  LANDING_BILLING_INACTIVE_REFUSAL,
  MARKETPLACE_JOB_UNCONFIRMED_LABEL,
  PUBLISH_ATTESTATION_REQUIRED
} from "@logloads/contracts"
import { DomainRefusalError, FLEET_EDIT_REFUSED } from "@logloads/services"
import { afterEach, describe, expect, it, vi } from "vitest"

import { RateLimitError, RateLimitUnavailableError } from "../rate-limit-core"
import { LANDING_NOT_OWNED } from "./draft-params"
import { V2_ERROR_CODES, v2ErrorCopy } from "./error-codes"
import { newV2RequestId, reportV2Error, v2FailureMessage, type V2ErrorEvent } from "./error-log"
import { MarketplaceFeatureUnavailableError, MarketplaceOperationUnavailableError, MarketplaceRefusalError, MarketplaceStoreError } from "./port"

/**
 * #279 (design audit 1, C3 and K2): which code a thrown V2 error gets, what is logged for it, and that a log entry
 * never holds a message, a value or anything a person typed.
 */

const PERSONAL = "maya@northpine.example"
const VALUE = "Gate 4417"
const REQUEST_ID = /^[0-9a-f]{12}$/

function capture() {
  const entries: Array<{ level: "error" | "info"; event: V2ErrorEvent }> = []
  return { entries, log: (level: "error" | "info", event: V2ErrorEvent) => void entries.push({ level, event }) }
}

function zodError(schema: { safeParse: (value: unknown) => { success: boolean; error?: unknown } }, value: unknown): unknown {
  const result = schema.safeParse(value)
  expect(result.success).toBe(false)
  return result.error
}

/** A driver-shaped database error: postgres.js copies the server's fields, including a message that names values. */
function databaseError(code: string): Error {
  return Object.assign(new Error(`duplicate key value violates unique constraint "people_email_key": Key (email)=(${PERSONAL}) already exists`), {
    code,
    name: "PostgresError",
    severity: "ERROR"
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("refusals with their own copy are named, not logged", () => {
  it.each([
    ["the preview cannot save it", new MarketplaceOperationUnavailableError("Publishing a V2 job"), "unavailable"],
    ["a port v3 group is not built yet", new MarketplaceFeatureUnavailableError("team", "Inviting a team member"), "unavailable"],
    ["the rate limit", new RateLimitError(60), "rate_limited"],
    ["the rate limit's words on a plain error", new Error("Too many attempts. Wait a moment and try again."), "rate_limited"],
    ["the pilot's closed job (a plain service error)", new Error("This job is no longer accepting interest"), "job_closed"],
    ["the store's closed job", new MarketplaceRefusalError("This job is no longer accepting interest", "23514"), "job_closed"],
    ["the day-14 job (#374)", new MarketplaceRefusalError(MARKETPLACE_JOB_UNCONFIRMED_LABEL, "23514"), "job_unconfirmed"],
    ["the day-14 job as a plain service error, with a full stop", new Error(`${MARKETPLACE_JOB_UNCONFIRMED_LABEL}.`), "job_unconfirmed"],
    ["the store's stop at the end", new MarketplaceRefusalError("The landing has closed this inquiry.", "23514"), "inquiry_declined"],
    ["another business's inquiry", new MarketplaceRefusalError("Inquiry not found", "42501"), "inquiry_not_found"],
    ["the publish attestations", new MarketplaceRefusalError(PUBLISH_ATTESTATION_REQUIRED, "23514"), "publish_attestation"],
    ["another organization's landing", new MarketplaceRefusalError(LANDING_NOT_OWNED, "42501"), "landing_not_owned"],
    ["inactive billing", new MarketplaceRefusalError(LANDING_BILLING_INACTIVE_REFUSAL, "23514"), "landing_billing_inactive"],
    ["the plan's landing cap, by shape", new MarketplaceRefusalError(landingAtCapRefusal("basic"), "23514"), "landing_cap"],
    ["an offer above the profile, by shape", new Error("Your profile lists 2 x Log truck + Pole trailer; update your equipment to offer more"), "equipment_over_listed"],
    ["availability above the list, by shape", new MarketplaceRefusalError("You have 2 Log trucks listed, so at most 2 can be available.", "23514"), "fleet_over_listed"],
    ["a fleet role refusal", new DomainRefusalError(FLEET_EDIT_REFUSED), "fleet_edit_role"],
    ["the store's grant refusal", new MarketplaceRefusalError("This is not available to your account.", "42501"), "not_allowed"],
    ["a write that raced another", new MarketplaceRefusalError("This changed while you were working on it. Reload the page and try again.", "40001"), "conflict"]
  ])("%s", (_label, error, code) => {
    const { entries, log } = capture()

    expect(reportV2Error(error, "test.operation", log)).toEqual({ code, requestId: null })
    expect(entries).toEqual([])
  })

  it("names a form's first known validation issue (the contracts' messages, as the services raise them)", () => {
    const inverted = zodError(expressInterestInputSchema, { availableFrom: "2026-12-10", availableUntil: "2026-12-01", loadPostingId: "11111111-1111-4111-8111-111111111111", trucksOffered: "2" })
    const noTrucks = zodError(expressInterestInputSchema, { loadPostingId: "11111111-1111-4111-8111-111111111111" })
    const noDate = zodError(haulerAvailabilityInputSchema, { count: "2", equipmentCode: "log_truck", fromDate: null, state: "from" })
    const noCount = zodError(haulerEquipmentAddInputSchema, { count: "0", truckCode: "log_truck" })

    expect(reportV2Error(inverted, "test", () => undefined).code).toBe("availability_range")
    expect(reportV2Error(noTrucks, "test", () => undefined).code).toBe("trucks_required")
    expect(reportV2Error(noDate, "test", () => undefined).code).toBe("fleet_available_date")
    expect(reportV2Error(noCount, "test", () => undefined).code).toBe("fleet_count_from_1")
  })
})

describe("refusals without their own copy are named by kind and logged at info level", () => {
  it.each([
    ["42501", "not_allowed"],
    ["P0002", "not_found"],
    ["23505", "conflict"],
    ["22023", "invalid"],
    ["23514", "refused"],
    [null, "refused"]
  ])("a store refusal with SQLSTATE %s", (sqlstate, code) => {
    const { entries, log } = capture()
    const failure = reportV2Error(new MarketplaceRefusalError(`Nothing in the catalogue says ${VALUE}`, sqlstate), "inquiry.respond", log)

    expect(failure.code).toBe(code)
    expect(failure.requestId).toMatch(REQUEST_ID)
    expect(entries).toEqual([{ event: expect.objectContaining({ code, frames: [], name: "MarketplaceRefusalError", operation: "inquiry.respond", requestId: failure.requestId, sqlstate }), level: "info" }])
    expect(JSON.stringify(entries)).not.toContain(VALUE)
  })

  it("a service refusal and an unknown validation issue", () => {
    const { entries, log } = capture()

    expect(reportV2Error(new DomainRefusalError(`Unlisted rule about ${VALUE}`), "fleet.add", log).code).toBe("refused")
    expect(reportV2Error(zodError(expressInterestInputSchema, { loadPostingId: "not-a-uuid", trucksOffered: "2" }), "interest.express", log).code).toBe("invalid")
    expect(entries.map((entry) => [entry.level, entry.event.code])).toEqual([["info", "refused"], ["info", "invalid"]])
    expect(JSON.stringify(entries)).not.toContain(VALUE)
    expect(JSON.stringify(entries)).not.toContain("not-a-uuid")
  })
})

describe("faults are logged as errors under a request id, with no message, value or personal data (K2)", () => {
  it("a store error keeps its SQLSTATE and its cause's class and SQLSTATE, and nothing they say", () => {
    const { entries, log } = capture()
    const failure = reportV2Error(new MarketplaceStoreError(undefined, "23505", databaseError("23505")), "interest.express", log)

    expect(failure).toEqual({ code: "unexpected", requestId: expect.stringMatching(REQUEST_ID) })
    expect(entries).toHaveLength(1)
    const [{ event, level }] = entries as [{ event: V2ErrorEvent; level: string }]
    expect(level).toBe("error")
    expect(event).toMatchObject({
      cause: { name: "PostgresError", sqlstate: "23505" },
      code: "unexpected",
      name: "MarketplaceStoreError",
      operation: "interest.express",
      requestId: failure.requestId,
      sqlstate: "23505"
    })
    expect(event.frames.length).toBeGreaterThan(0)
    for (const frame of event.frames) expect(frame).toMatch(/^at .+:\d+:\d+\)?$/)
    const logged = JSON.stringify(entries)
    expect(logged).not.toContain(PERSONAL)
    expect(logged).not.toContain("duplicate key")
    expect(logged).not.toContain("could not complete")
  })

  it("never takes message lines for stack frames, even ones shaped like a frame", () => {
    const { entries, log } = capture()
    reportV2Error(new TypeError(`Bad row for ${PERSONAL}\n    at forged (${PERSONAL}:1:1)`), "job.publish", log)

    expect(entries[0]?.event).toMatchObject({ cause: null, code: "unexpected", name: "TypeError", sqlstate: null })
    expect(JSON.stringify(entries)).not.toContain(PERSONAL)
  })

  it("a busy store or rate limiter is `busy`", () => {
    const { entries, log } = capture()
    const conflict = Object.assign(new Error(`state version 41 for ${PERSONAL}`), { name: "OperatingStateConflictError" })

    expect(reportV2Error(conflict, "interest.express", log).code).toBe("busy")
    expect(reportV2Error(new RateLimitUnavailableError(30), "interest.express", log).code).toBe("busy")
    expect(entries.map((entry) => entry.level)).toEqual(["error", "error"])
    expect(JSON.stringify(entries)).not.toContain(PERSONAL)
  })

  it("something that is not an Error, and an operation that is not a plain name", () => {
    const { entries, log } = capture()
    reportV2Error(`thrown text with ${PERSONAL}`, `op ${PERSONAL}`, log)

    expect(entries[0]?.event).toMatchObject({ cause: null, frames: [], name: "string", operation: "unknown" })
    expect(JSON.stringify(entries)).not.toContain(PERSONAL)
  })

  it("logs through console.error by default, under the id the caller shows", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const failure = reportV2Error(new Error("boom"), "listing.report")

    expect(error).toHaveBeenCalledExactlyOnceWith("logloads: marketplace v2 request failed", expect.objectContaining({ operation: "listing.report", requestId: failure.requestId }))
  })

  it("makes a new request id each time", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newV2RequestId()))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id).toMatch(REQUEST_ID)
  })
})

describe("words for a page or a form's state (C3)", () => {
  it("passes a store refusal's own words through, and only those", () => {
    const log = () => undefined

    expect(v2FailureMessage(new MarketplaceRefusalError("Listing not found", "P0002"), "listing.report", log)).toBe("Listing not found")
    expect(v2FailureMessage(new Error("This job is no longer accepting interest"), "test", log)).toBe(v2ErrorCopy("job_closed"))
    expect(v2FailureMessage(new DomainRefusalError(`Unlisted rule about ${VALUE}`), "test", log)).toMatch(/^LogLoads couldn't do that\. .* Reference: [0-9a-f]{12}\.$/)
  })

  it("never shows a fault's message: fixed copy and the reference instead", () => {
    const { entries, log } = capture()
    const text = v2FailureMessage(new MarketplaceStoreError(undefined, "57014", databaseError("57014")), "landing.save", log)

    expect(text).toBe(`${v2ErrorCopy("unexpected")} Reference: ${entries[0]?.event.requestId}.`)
    expect(text).not.toContain(PERSONAL)
    expect(v2FailureMessage(new Error(`secret ${PERSONAL}`), "landing.save", log)).not.toContain(PERSONAL)
  })

  it("every code the logger can give has copy", () => {
    const codes = new Set(V2_ERROR_CODES)
    const log = () => undefined
    const samples = [new Error("x"), new MarketplaceRefusalError("x", "42501"), new MarketplaceRefusalError("x", "P0002"), new RateLimitError(1), new MarketplaceOperationUnavailableError("x")]

    for (const sample of samples) expect(codes.has(reportV2Error(sample, "test", log).code)).toBe(true)
  })
})
