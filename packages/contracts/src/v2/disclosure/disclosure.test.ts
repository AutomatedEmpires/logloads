import { describe, expect, it } from "vitest"

import {
  PHONE_NOT_SHARED_MESSAGE,
  PHONE_REVEAL_PAUSE_THRESHOLD,
  PHONE_REVEAL_PAUSE_WINDOW_HOURS,
  clearHaulerRevealPauseInputSchema,
  clearRevealPauseInputSchema,
  formatPhoneForDisplay,
  phoneHref,
  phoneShareInputSchema,
  revealPauseTrips
} from "./index"

const ID = "11111111-1111-4111-8111-111111111111"

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
    expect(clearHaulerRevealPauseInputSchema.safeParse({ haulerOrgId: ID, reason: "  Staff reviewed the hauler  " }).success).toBe(true)
    expect(clearHaulerRevealPauseInputSchema.safeParse({ haulerOrgId: ID, reason: "no" }).success).toBe(false)
    expect(clearHaulerRevealPauseInputSchema.safeParse({ haulerOrgId: "not-a-uuid", reason: "Staff reviewed the hauler" }).success).toBe(false)
  })

  it("clears one pause by its id with the same reason bounds as the database (5 to 500)", () => {
    expect(clearRevealPauseInputSchema.parse({ pauseId: ID, reason: "  Staff reviewed the person  " }).reason).toBe("Staff reviewed the person")
    const short = clearRevealPauseInputSchema.safeParse({ pauseId: ID, reason: "ok" })
    expect(short.success).toBe(false)
    expect(short.success ? "" : short.error.issues[0]?.message).toBe("Give a reason of at least 5 characters.")
    expect(clearRevealPauseInputSchema.safeParse({ pauseId: ID, reason: "x".repeat(501) }).success).toBe(false)
    expect(clearRevealPauseInputSchema.safeParse({ pauseId: "pause", reason: "Staff reviewed the person" }).success).toBe(false)
  })

  it("shows or hides the number on one inquiry by its id only", () => {
    expect(phoneShareInputSchema.parse({ interestId: ID, phone: "+15415550188" })).toEqual({ interestId: ID })
    expect(phoneShareInputSchema.safeParse({ interestId: "" }).success).toBe(false)
  })

  it("says only that the number was not shared, never why", () => {
    expect(PHONE_NOT_SHARED_MESSAGE).toBe("Your number was not shared")
    expect(PHONE_NOT_SHARED_MESSAGE).not.toMatch(/pause|review|block|limit|abuse|report/i)
  })
})

describe("phone display", () => {
  it("reads a North American number as people write it, and leaves others as stored", () => {
    expect(formatPhoneForDisplay("+15415550188")).toBe("(541) 555-0188")
    expect(formatPhoneForDisplay(" +441632960961 ")).toBe("+441632960961")
  })

  it("links the stored number for a call", () => {
    expect(phoneHref("+15415550188")).toBe("tel:+15415550188")
  })
})
