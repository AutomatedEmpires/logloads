import { describe, expect, it } from "vitest"

import { BOOST_PACKAGES, boostPackageCodeSchema } from "../../membership"
import {
  MARKETPLACE_BOOST_PHASES,
  MARKETPLACE_BOOST_STATUSES,
  MARKETPLACE_SPONSORED_LABEL,
  MARKETPLACE_SPONSORED_SLOTS,
  marketplaceBoostJobIdSchema,
  marketplaceBoostPackageCodeSchema
} from "./index"

const JOB = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

describe("boost vocabulary", () => {
  it("keeps the store's statuses and names the phases a boost passes through, only one of them sponsored", () => {
    expect(MARKETPLACE_BOOST_STATUSES).toEqual(["pending_payment", "active", "ended", "canceled"])
    expect(MARKETPLACE_BOOST_PHASES).toEqual(["awaiting_payment", "scheduled", "running", "ended", "canceled"])
  })

  it("labels a sponsored placement with one word and caps placements at the store's own default", () => {
    expect(MARKETPLACE_SPONSORED_LABEL).toBe("Sponsored")
    expect(MARKETPLACE_SPONSORED_SLOTS).toBe(2)
  })
})

describe("boost input schemas", () => {
  it("reads a job id as a canonical lower-case UUID and refuses anything else in the person's words", () => {
    expect(marketplaceBoostJobIdSchema.parse(` ${JOB.toUpperCase()} `)).toBe(JOB)

    const refused = marketplaceBoostJobIdSchema.safeParse("job-1")

    expect(refused.success).toBe(false)
    expect(refused.error?.issues[0]?.message).toBe("Choose one of your business's jobs.")
  })

  it("accepts exactly the codes in BOOST_PACKAGES and refuses any other", () => {
    expect(marketplaceBoostPackageCodeSchema.options).toEqual(boostPackageCodeSchema.options)

    for (const code of Object.keys(BOOST_PACKAGES)) {
      expect(marketplaceBoostPackageCodeSchema.parse(code)).toBe(code)
    }

    for (const code of ["premium", "QUICK", "", null, 7]) {
      const refused = marketplaceBoostPackageCodeSchema.safeParse(code)

      expect(refused.success, String(code)).toBe(false)
      expect(refused.error?.issues[0]?.message).toBe("Choose a boost package.")
    }
  })
})
