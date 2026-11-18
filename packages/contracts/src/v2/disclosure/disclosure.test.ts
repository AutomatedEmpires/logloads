import { describe, expect, it } from "vitest"

import {
  PHONE_REVEAL_PAUSE_THRESHOLD,
  PHONE_REVEAL_PAUSE_WINDOW_HOURS,
  clearHaulerRevealPauseInputSchema,
  revealPauseTrips
} from "./index"

describe("phone reveal pause", () => {
  it("names the threshold and the window once", () => {
    expect(PHONE_REVEAL_PAUSE_THRESHOLD).toBe(5)
    expect(PHONE_REVEAL_PAUSE_WINDOW_HOURS).toBe(24)
  })

  it("trips when the distinct landings in the window reach the threshold", () => {
    expect(revealPauseTrips(4)).toBe(false)
    expect(revealPauseTrips(5)).toBe(true)
    expect(revealPauseTrips(6)).toBe(true)
    expect(revealPauseTrips(5.5)).toBe(false)
  })

  it("requires the hauler organization and a reason a person can read", () => {
    expect(clearHaulerRevealPauseInputSchema.safeParse({
      haulerOrgId: "11111111-1111-4111-8111-111111111111",
      reason: "  Staff reviewed the hauler  "
    }).success).toBe(true)
    expect(clearHaulerRevealPauseInputSchema.safeParse({
      haulerOrgId: "11111111-1111-4111-8111-111111111111",
      reason: "no"
    }).success).toBe(false)
    expect(clearHaulerRevealPauseInputSchema.safeParse({
      haulerOrgId: "not-a-uuid",
      reason: "Staff reviewed the hauler"
    }).success).toBe(false)
  })
})
