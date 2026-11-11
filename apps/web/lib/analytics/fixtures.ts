import type { ProductEventName } from "./events"

/** Test fixtures for the product event suites (#286). Not imported by application code. */

export const FIXTURE_JOB = "6f1c2a7e-3b4d-4c5e-8f60-718293a4b5c6"
export const FIXTURE_ORG = `o_${"a".repeat(32)}`
export const FIXTURE_INTEREST = `i_${"b".repeat(32)}`

/** One valid property set per event, as its call site would produce it. */
export const VALID_PROPERTIES: { [N in ProductEventName]: Record<string, unknown> } = {
  availability_reconfirmed: { org: FIXTURE_ORG, signed_in: false, truck_types: 3, via: "one_tap_link" },
  flow_timed: { capped: false, elapsed_ms: 71_500, flow: "A", job: FIXTURE_JOB, step: "first_send", taps: 7 },
  interest_replied: { interest: FIXTURE_INTEREST, org: FIXTURE_ORG, outcome: "replied", side: "landing" },
  interest_submitted: {
    contact_route: "phone",
    equipment_lines: 2,
    interest: FIXTURE_INTEREST,
    job: FIXTURE_JOB,
    org: FIXTURE_ORG,
    renewed: false,
    trucks_offered: 3
  },
  job_published: {
    equipment_count: 2,
    job: FIXTURE_JOB,
    org: FIXTURE_ORG,
    pay_stated: true,
    pay_unit: "per_ton",
    product: "saw_logs",
    state: "OR",
    trucks_requested: 4
  },
  job_reconfirmed: {
    days_since_confirmed: 9,
    freshness_before: "confirmed_aging",
    job: FIXTURE_JOB,
    org: FIXTURE_ORG,
    resumed: false,
    via: "in_app"
  },
  job_stopped: {
    days_since_confirmed: null,
    freshness_before: "unconfirmed",
    job: FIXTURE_JOB,
    org: FIXTURE_ORG,
    status: "filled",
    via: "in_app"
  },
  share_link_opened: { channel: "sms", job: FIXTURE_JOB, signed_in: false }
}

/** Personal data and free text that must never reach an event, whatever field it is put in. */
export const PERSONAL_STRINGS = [
  "jo.hauler@example.com",
  "(509) 555-0142",
  "Jo Hauler",
  "Gate code 4411, call before 5am",
  "https://logloads.example/v2/work?near=47.6,-117.4"
]
