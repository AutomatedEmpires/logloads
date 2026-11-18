import { describe, expect, it } from "vitest"

import { numberCanBeShared, phoneShareNotice, phoneShareState } from "./phone-share"

const INTEREST = "22222222-2222-4222-8222-222222222222"
const disclosure = (overrides: Record<string, unknown> = {}) => ({
  interestId: INTEREST,
  phone: "+15415550188",
  shared: false,
  sharedAt: null,
  status: "replied",
  ...overrides
})

describe("flow C, C4 and C5: the landing's number on one inquiry (#403)", () => {
  it("offers the number after a reply (C4) and shows it once shared (C5)", () => {
    expect(phoneShareState(disclosure(), { notNow: false })).toEqual({ kind: "offer", number: "(541) 555-0188" })
    expect(phoneShareState(disclosure({ shared: true, sharedAt: "2026-11-18T22:00:00.000Z" }), { notNow: false }))
      .toEqual({ kind: "showing", number: "(541) 555-0188" })
  })

  it("offers nothing before a reply, without a number, on the pilot store, or after Not now", () => {
    expect(phoneShareState(disclosure({ status: "submitted" }), { notNow: false })).toEqual({ kind: "none" })
    expect(phoneShareState(disclosure({ status: "declined" }), { notNow: false })).toEqual({ kind: "none" })
    expect(phoneShareState(disclosure({ phone: null }), { notNow: false })).toEqual({ kind: "none" })
    expect(phoneShareState(null, { notNow: false })).toEqual({ kind: "none" })
    expect(phoneShareState(disclosure(), { notNow: true })).toEqual({ kind: "none" })
    // Not now never hides a number that is showing: Hide my number stays in reach.
    expect(phoneShareState(disclosure({ shared: true }), { notNow: true }).kind).toBe("showing")
  })

  it("lets ready reply 1 say \"Call me.\" only when the landing has a number to show on an open inquiry", () => {
    expect(numberCanBeShared(disclosure({ status: "submitted" }))).toBe(true)
    expect(numberCanBeShared(disclosure())).toBe(true)
    expect(numberCanBeShared(disclosure({ phone: null }))).toBe(false)
    expect(numberCanBeShared(disclosure({ status: "withdrawn" }))).toBe(false)
    expect(numberCanBeShared(null)).toBe(false)
  })

  it("says only that the number was not shared, never why", () => {
    expect(phoneShareNotice("phone_not_shared", "Granite Creek Hauling")).toBe("Your number was not shared.")
    expect(phoneShareNotice("phone_hidden", "Granite Creek Hauling")).toBe("Your number is hidden from Granite Creek Hauling.")
    expect(phoneShareNotice("phone_shared", "Granite Creek Hauling")).toBeNull()
    expect(phoneShareNotice("replied", "Granite Creek Hauling")).toBeNull()
    expect(phoneShareNotice("phone_not_shared", "x")).not.toMatch(/pause|review|limit|report/i)
  })
})
