import { describe, expect, it } from "vitest"

import type { DraftStore } from "@/lib/offline/drafts"

import {
  clearHeld,
  HELD_TTL_MS,
  heldDelivered,
  heldFailed,
  heldFields,
  HOLD_MS,
  holdSend,
  msLeft,
  readHeld,
  withReason,
  writeHeld
} from "./held-send"

const INTEREST = "44444444-cccc-4ccc-8ccc-444444444444"
const OTHER = "66666666-eeee-4eee-8eee-666666666666"
const REPLY = "55555555-dddd-4ddd-8ddd-555555555555"
const NOW = Date.parse("2026-11-18T18:00:00.000Z")

function memory(): DraftStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (name) => data.get(name) ?? null,
    removeItem: (name) => void data.delete(name),
    setItem: (name, value) => void data.set(name, value)
  }
}

const reply = (body = "Yes, we can use you.") => holdSend({ body, decision: "replied", interestId: INTEREST, replyId: REPLY }, NOW)

describe("flow C one-minute hold (#328)", () => {
  it("holds a ready reply for one minute, then it is due", () => {
    const held = reply()

    expect(held).toMatchObject({ body: "Yes, we can use you.", decision: "replied", dueAt: NOW + HOLD_MS, heldAt: NOW, v: 1 })
    expect(msLeft(held!, NOW)).toBe(60_000)
    expect(msLeft(held!, NOW + 59_000)).toBe(1_000)
    expect(msLeft(held!, NOW + 61_000)).toBe(0)
  })

  it("refuses what the server could never record: a blank reply, a bad id, an over-long body", () => {
    expect(reply("   ")).toBeNull()
    expect(holdSend({ body: "Yes", decision: "replied", interestId: "nope", replyId: REPLY }, NOW)).toBeNull()
    expect(holdSend({ body: "Yes", decision: "replied", interestId: INTEREST, replyId: "nope" }, NOW)).toBeNull()
    expect(reply("x".repeat(2001))).toBeNull()
    // A decline may go without a reason.
    expect(holdSend({ body: "", decision: "declined", interestId: INTEREST, replyId: REPLY }, NOW)).toMatchObject({ body: "", decision: "declined" })
  })

  it("keeps the held answer on the phone until the server says it arrived, for that inquiry only", () => {
    const storage = memory()
    const held = reply()!

    writeHeld(storage, held)
    expect(readHeld(storage, INTEREST, NOW + 5_000)).toEqual(held)
    expect(readHeld(storage, INTEREST.toUpperCase(), NOW + 5_000)).toEqual(held)
    expect(readHeld(storage, OTHER, NOW)).toBeNull()

    expect(heldDelivered(held, new URLSearchParams({ inquiry: INTEREST, updated: "replied" }))).toBe(true)
    expect(heldDelivered(held, new URLSearchParams({ inquiry: INTEREST, updated: "declined" }))).toBe(false)
    expect(heldDelivered(held, new URLSearchParams({ inquiry: OTHER, updated: "replied" }))).toBe(false)
    expect(heldFailed(held, new URLSearchParams({ error: "service_unavailable", inquiry: INTEREST }))).toBe(true)
    expect(heldFailed(held, new URLSearchParams({ error: "service_unavailable", inquiry: OTHER }))).toBe(false)

    clearHeld(storage, INTEREST)
    expect(readHeld(storage, INTEREST, NOW)).toBeNull()
  })

  it("drops a damaged, foreign or week-old record instead of sending it", () => {
    const storage = memory()
    const held = reply()!
    const name = "logloads:flow-c:held:" + INTEREST

    storage.setItem(name, "{not json")
    expect(readHeld(storage, INTEREST, NOW)).toBeNull()
    expect(storage.data.has(name)).toBe(false)

    storage.setItem(name, JSON.stringify({ ...held, interestId: OTHER }))
    expect(readHeld(storage, INTEREST, NOW)).toBeNull()

    writeHeld(storage, held)
    expect(readHeld(storage, INTEREST, NOW + HELD_TTL_MS + 1)).toBeNull()
    expect(storage.data.has(name)).toBe(false)
  })

  it("posts the same reply id on every attempt, and only the fields the action reads", () => {
    const held = reply()!

    expect(heldFields(held)).toEqual({ body: "Yes, we can use you.", decision: "replied", interestId: INTEREST, replyId: REPLY })
    expect(Object.keys(heldFields(held))).not.toContain("organizationId")
  })

  it("adds a reason to a held decline, never to a reply", () => {
    const decline = holdSend({ body: "", decision: "declined", interestId: INTEREST, replyId: REPLY }, NOW)!

    expect(withReason(decline, " We have enough trucks ").body).toBe("We have enough trucks")
    expect(withReason(reply()!, "We have enough trucks").body).toBe("Yes, we can use you.")
  })
})
