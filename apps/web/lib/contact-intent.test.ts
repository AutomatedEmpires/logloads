import { describe, expect, it } from "vitest"

import {
  contactInterestFromQuery,
  contactInterestLabel,
  parseContactInterest
} from "./contact-intent"

describe("pilot contact intent", () => {
  it("preserves role-specific pilot context from public links", () => {
    expect(contactInterestFromQuery("pilot", "host")).toBe("pilot_host")
    expect(contactInterestFromQuery("pilot", "fleet")).toBe("pilot_fleet")
    expect(contactInterestFromQuery("pilot", "driver")).toBe("pilot_driver")
    expect(contactInterestFromQuery("pilot", undefined)).toBe("pilot_end_to_end")
  })

  it("keeps unrelated contact traffic general", () => {
    expect(contactInterestFromQuery(undefined, "host")).toBe("general")
    expect(contactInterestFromQuery("support", "driver")).toBe("general")
  })

  it("fails closed for invented form values and returns customer-facing labels", () => {
    expect(parseContactInterest("pilot_host")).toBe("pilot_host")
    expect(parseContactInterest("subscription_pilot")).toBeNull()
    expect(contactInterestLabel("pilot_host")).toBe("Plan a host pilot")
  })
})
