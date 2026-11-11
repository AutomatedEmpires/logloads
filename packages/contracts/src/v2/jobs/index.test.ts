import { describe, expect, it } from "vitest"

import { RECENT_CONFIRMATION_DAYS } from "../../marketplace-v2"
import {
  MARKETPLACE_JOB_RECONFIRM_AFTER_DAYS,
  MARKETPLACE_JOB_STOP_STATUSES,
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

  it("reconfirms at the one interval the contracts define, the one haulers see", () => {
    expect(MARKETPLACE_JOB_RECONFIRM_AFTER_DAYS).toBe(RECENT_CONFIRMATION_DAYS)
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
