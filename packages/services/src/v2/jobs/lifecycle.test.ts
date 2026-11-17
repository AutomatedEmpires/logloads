import {
  attestAvailability,
  MARKETPLACE_AVAILABILITY_ATTESTATION,
  MARKETPLACE_JOB_RECONFIRM_AFTER_DAYS,
  MARKETPLACE_JOB_RECONFIRM_REMINDER_DAYS,
  MARKETPLACE_JOB_STOP_STATUSES,
  MARKETPLACE_JOB_UNCONFIRMED_HIDDEN_DAYS,
  MARKETPLACE_JOB_UNCONFIRMED_LABEL,
  MARKETPLACE_JOB_UNCONFIRMED_REASON,
  postingFreshness,
  type MarketplaceJobStatus,
  type MarketplaceJobStopStatus
} from "@logloads/contracts"
import { describe, expect, it } from "vitest"

import { DomainRefusalError } from "../../utils"
import {
  effectiveJobStatus,
  freshJobAttestation,
  JOB_ALREADY_LISTED_REFUSAL,
  JOB_ATTESTATION_MAX_AGE_MS,
  JOB_ATTESTATION_MAX_SKEW_MS,
  JOB_EXPIRED_REFUSAL,
  JOB_FILLED_REFUSAL,
  JOB_HELD_REFUSAL,
  JOB_PAUSE_REFUSAL,
  JOB_RECONFIRM_REFUSAL,
  JOB_STOP_STATUS_REFUSAL,
  jobReconfirmation,
  jobTakesNewInterest,
  ownJobActions,
  planJobEdit,
  planJobReconfirm,
  planJobResume,
  planJobStatusChange,
  unconfirmedJobNotice,
  type JobLifecycleState
} from "./lifecycle"

const NOW = new Date("2026-11-10T12:00:00.000Z")
const DAY = 86_400_000
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const ahead = (ms: number) => new Date(NOW.getTime() + ms).toISOString()

function job(status: MarketplaceJobStatus, overrides: Partial<JobLifecycleState> = {}): JobLifecycleState {
  return { expiresAt: null, lastConfirmedAt: ago(DAY), moderationHold: false, status, ...overrides }
}

function refusal(plan: () => unknown): string | null {
  try {
    plan()
    return null
  } catch (error) {
    expect(error).toBeInstanceOf(DomainRefusalError)
    return (error as Error).message
  }
}

describe("effectiveJobStatus", () => {
  it("reads a listed, paused or filled job past its expiry as expired, and keeps a closed one closed", () => {
    for (const status of ["active", "paused", "filled", "expired"] as const) {
      expect(effectiveJobStatus(job(status, { expiresAt: ago(1) }), NOW), status).toBe("expired")
    }

    expect(effectiveJobStatus(job("closed", { expiresAt: ago(1) }), NOW)).toBe("closed")
  })

  it("expires at the instant itself, never before it", () => {
    expect(effectiveJobStatus(job("active", { expiresAt: NOW.toISOString() }), NOW)).toBe("expired")
    expect(effectiveJobStatus(job("active", { expiresAt: ahead(1) }), NOW)).toBe("active")
    expect(effectiveJobStatus(job("active", { expiresAt: null }), NOW)).toBe("active")
  })

  it("treats an unreadable expiry as passed rather than keeping the listing up", () => {
    expect(effectiveJobStatus(job("active", { expiresAt: "not a date" }), NOW)).toBe("expired")
  })
})

describe("planJobStatusChange: pause, mark filled, close", () => {
  // The whole table: every status the store reports × every stop status.
  const table: Array<[MarketplaceJobStatus, MarketplaceJobStopStatus, "change" | "unchanged" | string]> = [
    ["active", "paused", "change"],
    ["active", "filled", "change"],
    ["active", "closed", "change"],
    ["paused", "paused", "unchanged"],
    ["paused", "filled", "change"],
    ["paused", "closed", "change"],
    ["filled", "paused", JOB_PAUSE_REFUSAL],
    ["filled", "filled", "unchanged"],
    ["filled", "closed", "change"],
    ["closed", "paused", JOB_PAUSE_REFUSAL],
    ["closed", "filled", JOB_FILLED_REFUSAL],
    ["closed", "closed", "unchanged"],
    ["expired", "paused", JOB_EXPIRED_REFUSAL],
    ["expired", "filled", JOB_EXPIRED_REFUSAL],
    ["expired", "closed", "change"]
  ]

  it.each(table)("%s → %s: %s", (from, to, outcome) => {
    const plan = () => planJobStatusChange(job(from), to, NOW)

    if (outcome === "change" || outcome === "unchanged") {
      expect(plan()).toEqual({ changed: outcome === "change", from, to })
    } else {
      expect(refusal(plan)).toBe(outcome)
    }
  })

  it("covers every stop status", () => {
    expect(new Set(table.map(([, to]) => to))).toEqual(new Set(MARKETPLACE_JOB_STOP_STATUSES))
  })

  it("acts on the effective status: a job past its expiry can only be closed", () => {
    const lapsed = job("active", { expiresAt: ago(DAY) })

    expect(refusal(() => planJobStatusChange(lapsed, "paused", NOW))).toBe(JOB_EXPIRED_REFUSAL)
    expect(planJobStatusChange(lapsed, "closed", NOW)).toEqual({ changed: true, from: "expired", to: "closed" })
  })

  it("lets a poster stop a job that LogLoads staff hold (stopping never puts anything on the marketplace)", () => {
    expect(planJobStatusChange(job("paused", { moderationHold: true }), "closed", NOW).changed).toBe(true)
  })

  it("refuses a status that is not a stop status (expired is the store's, active is resume)", () => {
    for (const status of ["active", "expired", "draft", ""]) {
      expect(refusal(() => planJobStatusChange(job("active"), status as MarketplaceJobStopStatus, NOW))).toBe(JOB_STOP_STATUS_REFUSAL)
    }
  })
})

describe("planJobResume: back on the marketplace", () => {
  it.each(["paused", "filled", "closed"] as const)("puts a %s job back", (status) => {
    expect(planJobResume(job(status), NOW)).toEqual({ from: status })
  })

  it("refuses a job already on the marketplace, pointing to reconfirm", () => {
    expect(refusal(() => planJobResume(job("active"), NOW))).toBe(JOB_ALREADY_LISTED_REFUSAL)
  })

  it("refuses once the expiry has passed, whatever the job was set to", () => {
    expect(refusal(() => planJobResume(job("expired"), NOW))).toBe(JOB_EXPIRED_REFUSAL)
    expect(refusal(() => planJobResume(job("paused", { expiresAt: ago(1) }), NOW))).toBe(JOB_EXPIRED_REFUSAL)
    expect(planJobResume(job("paused", { expiresAt: ahead(DAY) }), NOW)).toEqual({ from: "paused" })
  })

  it("refuses while LogLoads staff hold the job, and leaves an unreadable hold to the store", () => {
    expect(refusal(() => planJobResume(job("closed", { moderationHold: true }), NOW))).toBe(JOB_HELD_REFUSAL)
    expect(planJobResume(job("closed", { moderationHold: null }), NOW)).toEqual({ from: "closed" })
  })
})

describe("planJobReconfirm and planJobEdit", () => {
  it("confirms only a job on the marketplace, due or not", () => {
    expect(refusal(() => planJobReconfirm(job("active", { lastConfirmedAt: ago(60_000) }), NOW))).toBeNull()
    expect(refusal(() => planJobReconfirm(job("active", { lastConfirmedAt: null }), NOW))).toBeNull()

    for (const status of ["paused", "filled", "closed"] as const) {
      expect(refusal(() => planJobReconfirm(job(status), NOW)), status).toBe(JOB_RECONFIRM_REFUSAL)
    }

    expect(refusal(() => planJobReconfirm(job("expired"), NOW))).toBe(JOB_EXPIRED_REFUSAL)
    expect(refusal(() => planJobReconfirm(job("active", { expiresAt: ago(1) }), NOW))).toBe(JOB_EXPIRED_REFUSAL)
  })

  it("edits a job in any status but expired", () => {
    for (const status of ["active", "paused", "filled", "closed"] as const) {
      expect(refusal(() => planJobEdit(job(status), NOW)), status).toBeNull()
    }

    expect(refusal(() => planJobEdit(job("expired"), NOW))).toBe(JOB_EXPIRED_REFUSAL)
  })
})

describe("jobReconfirmation: reminded on day 5, due on day 7, off Find Work on day 14 (#308)", () => {
  const remind = MARKETPLACE_JOB_RECONFIRM_REMINDER_DAYS * DAY
  const interval = MARKETPLACE_JOB_RECONFIRM_AFTER_DAYS * DAY
  const hide = MARKETPLACE_JOB_UNCONFIRMED_HIDDEN_DAYS * DAY

  it("uses the decided cadence", () => {
    expect([MARKETPLACE_JOB_RECONFIRM_REMINDER_DAYS, MARKETPLACE_JOB_RECONFIRM_AFTER_DAYS, MARKETPLACE_JOB_UNCONFIRMED_HIDDEN_DAYS]).toEqual([5, 7, 14])
  })

  it("is the interval haulers see: due exactly when the listing stops reading as recently confirmed", () => {
    for (const age of [0, DAY, interval - 1, interval, interval + 1, 30 * DAY]) {
      const listed = job("active", { lastConfirmedAt: ago(age) })
      const band = postingFreshness({ expiresAt: null, lastConfirmedAt: listed.lastConfirmedAt, lastModifiedAt: ago(age) }, NOW.toISOString()).band

      expect(jobReconfirmation(listed, NOW).due, `${age} ms`).toBe(band === "confirmed_aging")
    }
  })

  it.each([
    ["just confirmed", 0, { due: false, hidden: false, remind: false }],
    ["a moment before day 5", remind - 1, { due: false, hidden: false, remind: false }],
    ["day 5", remind, { due: false, hidden: false, remind: true }],
    ["day 7", interval, { due: true, hidden: false, remind: true }],
    ["a moment before day 14", hide - 1, { due: true, hidden: false, remind: true }],
    ["day 14", hide, { due: true, hidden: true, remind: true }],
    ["day 60", 60 * DAY, { due: true, hidden: true, remind: true }]
  ])("starts each stage at its instant: %s", (_label, age, stages) => {
    expect(jobReconfirmation(job("active", { lastConfirmedAt: ago(age) }), NOW)).toMatchObject(stages)
  })

  it("states when each stage starts and how long ago the job was confirmed", () => {
    expect(jobReconfirmation(job("active", { lastConfirmedAt: ago(2 * DAY) }), NOW)).toEqual({
      daysSinceConfirmation: 2,
      due: false,
      dueAt: ahead(interval - 2 * DAY),
      hidden: false,
      hiddenAt: ahead(hide - 2 * DAY),
      remind: false,
      remindAt: ahead(remind - 2 * DAY)
    })
  })

  it("assumes no confirmation: a never-confirmed job on the marketplace is at every stage", () => {
    expect(jobReconfirmation(job("active", { lastConfirmedAt: null }), NOW)).toEqual({
      daysSinceConfirmation: null,
      due: true,
      dueAt: null,
      hidden: true,
      hiddenAt: null,
      remind: true,
      remindAt: null
    })
  })

  it("never applies to a job off the marketplace or past its expiry", () => {
    for (const state of [job("paused", { lastConfirmedAt: ago(60 * DAY) }), job("closed"), job("filled"), job("expired"), job("active", { expiresAt: ago(1) })]) {
      expect(jobReconfirmation(state, NOW), state.status).toMatchObject({ due: false, dueAt: null, hidden: false, hiddenAt: null, remind: false, remindAt: null })
    }
  })
})

describe("jobTakesNewInterest and unconfirmedJobNotice: the day-14 rule", () => {
  const stale = job("active", { lastConfirmedAt: ago(MARKETPLACE_JOB_UNCONFIRMED_HIDDEN_DAYS * DAY) })

  it("takes new interest only on the marketplace and confirmed within 14 days", () => {
    expect(jobTakesNewInterest(job("active", { lastConfirmedAt: ago(13 * DAY) }), NOW)).toBe(true)
    expect(jobTakesNewInterest(stale, NOW)).toBe(false)
    expect(jobTakesNewInterest(job("active", { lastConfirmedAt: null }), NOW)).toBe(false)

    for (const status of ["paused", "filled", "closed", "expired"] as const) {
      expect(jobTakesNewInterest(job(status), NOW), status).toBe(false)
    }
  })

  it("leaves the job active, not expired or paused, so every action on a listed job still applies", () => {
    expect(effectiveJobStatus(stale, NOW)).toBe("active")
    expect(ownJobActions(stale, NOW)).toEqual(ownJobActions(job("active"), NOW))
    expect(refusal(() => planJobReconfirm(stale, NOW))).toBeNull()
    expect(refusal(() => planJobResume(stale, NOW))).toBe(JOB_ALREADY_LISTED_REFUSAL)
  })

  it("comes straight back once the poster reconfirms", () => {
    expect(jobTakesNewInterest({ ...stale, lastConfirmedAt: NOW.toISOString() }, NOW)).toBe(true)
  })

  it("names the missing confirmation, never a pause, a close or an expiry", () => {
    const notice = unconfirmedJobNotice(stale, NOW)

    expect(notice).toEqual({ label: MARKETPLACE_JOB_UNCONFIRMED_LABEL, reason: MARKETPLACE_JOB_UNCONFIRMED_REASON })
    expect(`${notice?.label} ${notice?.reason}`).not.toMatch(/paus|clos|expir/i)
    expect(`${notice?.label} ${notice?.reason}`).toMatch(/confirm/i)
  })

  it("gives no notice for a confirmed job, or for a stopped one whose status already says why", () => {
    expect(unconfirmedJobNotice(job("active"), NOW)).toBeNull()
    expect(unconfirmedJobNotice(job("paused", { lastConfirmedAt: ago(60 * DAY) }), NOW)).toBeNull()
    expect(unconfirmedJobNotice(job("active", { expiresAt: ago(1), lastConfirmedAt: ago(60 * DAY) }), NOW)).toBeNull()
  })
})

describe("ownJobActions", () => {
  it("offers exactly what the rules allow in each status", () => {
    expect(ownJobActions(job("active"), NOW)).toEqual(["edit", "reconfirm", "pause", "mark_filled", "close", "duplicate"])
    expect(ownJobActions(job("paused"), NOW)).toEqual(["edit", "mark_filled", "close", "resume", "duplicate"])
    expect(ownJobActions(job("filled"), NOW)).toEqual(["edit", "close", "resume", "duplicate"])
    expect(ownJobActions(job("closed"), NOW)).toEqual(["edit", "resume", "duplicate"])
    expect(ownJobActions(job("expired"), NOW)).toEqual(["close", "duplicate"])
  })

  it("hides resume while staff hold the job, but not when the hold cannot be read", () => {
    expect(ownJobActions(job("paused", { moderationHold: true }), NOW)).not.toContain("resume")
    expect(ownJobActions(job("paused", { moderationHold: null }), NOW)).toContain("resume")
  })
})

describe("freshJobAttestation", () => {
  const confirmed = attestAvailability(MARKETPLACE_AVAILABILITY_ATTESTATION.value, "reconfirm", NOW)

  it("accepts the explicit confirmation made in this request", () => {
    expect(freshJobAttestation(confirmed, "reconfirm", NOW)).toBe(true)
    expect(freshJobAttestation(confirmed, "reconfirm", new Date(NOW.getTime() + JOB_ATTESTATION_MAX_AGE_MS))).toBe(true)
  })

  it("refuses a missing, stale, future, unreadable or other-action attestation", () => {
    expect(freshJobAttestation(null, "reconfirm", NOW)).toBe(false)
    expect(freshJobAttestation(attestAvailability("yes", "reconfirm", NOW), "reconfirm", NOW)).toBe(false)
    expect(freshJobAttestation(confirmed, "publish", NOW)).toBe(false)
    expect(freshJobAttestation(confirmed, "reconfirm", new Date(NOW.getTime() + JOB_ATTESTATION_MAX_AGE_MS + 1))).toBe(false)
    expect(freshJobAttestation({ action: "reconfirm", confirmedAt: ahead(JOB_ATTESTATION_MAX_SKEW_MS + 1) }, "reconfirm", NOW)).toBe(false)
    expect(freshJobAttestation({ action: "reconfirm", confirmedAt: "yesterday" }, "reconfirm", NOW)).toBe(false)
  })
})
