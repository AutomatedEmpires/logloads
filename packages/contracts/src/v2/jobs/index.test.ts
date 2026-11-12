import { describe, expect, it } from "vitest"

import { RECENT_CONFIRMATION_DAYS } from "../../marketplace-v2"
import {
  MARKETPLACE_JOB_RECONFIRM_AFTER_DAYS,
  MARKETPLACE_JOB_RECONFIRM_REMINDER_DAYS,
  MARKETPLACE_JOB_STOP_STATUSES,
  MARKETPLACE_JOB_UNCONFIRMED_HIDDEN_DAYS,
  MARKETPLACE_JOB_UNCONFIRMED_LABEL,
  MARKETPLACE_JOB_UNCONFIRMED_REASON,
  MARKETPLACE_OWN_JOB_QUERY_MAX,
  marketplaceJobStopStatusSchema,
  marketplaceOwnJobFiltersSchema
} from "./index"

const LANDING = "33333333-cccc-4ccc-8ccc-cccccccccccc"

describe("jobs contracts (#247)", () => {
  it("lets a poster stop a job only by pausing, marking it filled or closing it", () => {
    expect(MARKETPLACE_JOB_STOP_STATUSES).toEqual(["paused", "filled", "closed"])

    for (const status of ["active", "expired", "draft", ""]) {
      expect(marketplaceJobStopStatusSchema.safeParse(status).success, status).toBe(false)
    }
  })

  it("follows the decided cadence: reminder on day 5, due on day 7 (what haulers see), off Find Work on day 14", () => {
    expect(MARKETPLACE_JOB_RECONFIRM_REMINDER_DAYS).toBe(5)
    expect(MARKETPLACE_JOB_RECONFIRM_AFTER_DAYS).toBe(RECENT_CONFIRMATION_DAYS)
    expect(MARKETPLACE_JOB_RECONFIRM_AFTER_DAYS).toBe(7)
    expect(MARKETPLACE_JOB_UNCONFIRMED_HIDDEN_DAYS).toBe(14)
  })

  it("describes a job off Find Work by its missing confirmation, never as paused, closed or expired", () => {
    const words = `${MARKETPLACE_JOB_UNCONFIRMED_LABEL} ${MARKETPLACE_JOB_UNCONFIRMED_REASON}`

    expect(words).not.toMatch(/paus|clos|expir/i)
    expect(MARKETPLACE_JOB_UNCONFIRMED_REASON).toContain(`${MARKETPLACE_JOB_UNCONFIRMED_HIDDEN_DAYS} days`)
  })

  it("parses the own-job filters, treating a blank search as none", () => {
    expect(marketplaceOwnJobFiltersSchema.parse({})).toEqual({ query: null })
    expect(marketplaceOwnJobFiltersSchema.parse({ landingId: LANDING, query: "  saw logs ", status: "paused" }))
      .toEqual({ landingId: LANDING, query: "saw logs", status: "paused" })
    expect(marketplaceOwnJobFiltersSchema.parse({ landingId: null, query: "   ", status: null })).toEqual({ landingId: null, query: null, status: null })
  })

  it("refuses unknown filters, statuses no job has, a malformed landing and an overlong search", () => {
    for (const filters of [
      { sort: "oldest" },
      { status: "draft" },
      { landingId: "north" },
      { query: "x".repeat(MARKETPLACE_OWN_JOB_QUERY_MAX + 1) },
      "paused"
    ]) {
      expect(marketplaceOwnJobFiltersSchema.safeParse(filters).success, JSON.stringify(filters)).toBe(false)
    }
  })
})
