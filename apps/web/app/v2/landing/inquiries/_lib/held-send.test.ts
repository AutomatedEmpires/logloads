import { describe, expect, it } from "vitest"

import {
  clearAllHeld,
  clearHeld,
  HELD_TTL_MS,
  heldDelivered,
  heldFailed,
  heldFields,
  HOLD_MS,
  holdSend,
  listHeld,
  msLeft,
  openHeld,
  readHeld,
  withReason,
  writeHeld,
  type HeldStore
} from "./held-send"

const INTEREST = "44444444-cccc-4ccc-8ccc-444444444444"
const OTHER = "66666666-eeee-4eee-8eee-666666666666"
const REPLY = "55555555-dddd-4ddd-8ddd-555555555555"
const NOW = Date.parse("2026-11-18T18:00:00.000Z")
/** Ana and Ben share an office computer and work for the same landing business (review of PR 401, finding 3). */
const ANA = { organizationId: "22222222-aaaa-4aaa-8aaa-222222222222", userId: "77777777-aaaa-4aaa-8aaa-777777777777" }
const BEN = { organizationId: ANA.organizationId, userId: "88888888-bbbb-4bbb-8bbb-888888888888" }
/** Ana again, working for her other business. */
const ANA_ELSEWHERE = { organizationId: "33333333-bbbb-4bbb-8bbb-333333333333", userId: ANA.userId }

function memory(): HeldStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (name) => data.get(name) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
    removeItem: (name) => void data.delete(name),
    setItem: (name, value) => void data.set(name, value)
  }
}

const reply = (body = "Yes, we can use you.", viewer = ANA, interestId = INTEREST) =>
  holdSend({ body, decision: "replied", interestId, recipientName: "New River Hauling", replyId: REPLY, viewer }, NOW)
const decline = (viewer = ANA) =>
  holdSend({ body: "", decision: "declined", interestId: INTEREST, recipientName: "New River Hauling", replyId: REPLY, viewer }, NOW)!

describe("flow C one-minute hold (#328)", () => {
  it("holds a ready reply for one minute, then it is due", () => {
    const held = reply()

    expect(held).toMatchObject({ body: "Yes, we can use you.", decision: "replied", dueAt: NOW + HOLD_MS, heldAt: NOW, reopened: false, v: 2 })
    expect(msLeft(held!, NOW)).toBe(60_000)
    expect(msLeft(held!, NOW + 59_000)).toBe(1_000)
    expect(msLeft(held!, NOW + 61_000)).toBe(0)
  })

  it("refuses what the server could never record: a blank reply, a bad id, an over-long body, no viewer", () => {
    expect(reply("   ")).toBeNull()
    expect(holdSend({ body: "Yes", decision: "replied", interestId: "nope", recipientName: "", replyId: REPLY, viewer: ANA }, NOW)).toBeNull()
    expect(holdSend({ body: "Yes", decision: "replied", interestId: INTEREST, recipientName: "", replyId: "nope", viewer: ANA }, NOW)).toBeNull()
    expect(reply("x".repeat(2001))).toBeNull()
    expect(reply("Yes", { organizationId: ANA.organizationId, userId: "" })).toBeNull()
    expect(reply("Yes", { organizationId: "", userId: ANA.userId })).toBeNull()
    // A decline may go without a reason.
    expect(decline()).toMatchObject({ body: "", decision: "declined" })
  })

  it("keeps the held answer on the phone until the server says it arrived, for that inquiry only", () => {
    const storage = memory()
    const held = reply()!

    writeHeld(storage, held)
    expect(readHeld(storage, ANA, INTEREST, NOW + 5_000)).toEqual(held)
    expect(readHeld(storage, ANA, INTEREST.toUpperCase(), NOW + 5_000)).toEqual(held)
    expect(readHeld(storage, ANA, OTHER, NOW)).toBeNull()

    expect(heldDelivered(held, new URLSearchParams({ inquiry: INTEREST, updated: "replied" }))).toBe(true)
    expect(heldDelivered(held, new URLSearchParams({ inquiry: INTEREST.toUpperCase(), updated: "replied" }))).toBe(true)
    expect(heldDelivered(held, new URLSearchParams({ inquiry: INTEREST, updated: "declined" }))).toBe(false)
    expect(heldDelivered(held, new URLSearchParams({ inquiry: OTHER, updated: "replied" }))).toBe(false)
    expect(heldFailed(held, new URLSearchParams({ error: "service_unavailable", inquiry: INTEREST }))).toBe(true)
    expect(heldFailed(held, new URLSearchParams({ error: "service_unavailable", inquiry: OTHER }))).toBe(false)

    clearHeld(storage, ANA, INTEREST)
    expect(readHeld(storage, ANA, INTEREST, NOW)).toBeNull()
  })

  it("drops a damaged or mismatched record instead of sending it", () => {
    const storage = memory()
    const held = reply()!

    writeHeld(storage, held)
    const [name] = [...storage.data.keys()]

    storage.setItem(name!, "{not json")
    expect(readHeld(storage, ANA, INTEREST, NOW)).toBeNull()
    expect(storage.data.has(name!)).toBe(false)

    // A record whose own fields name another inquiry or another person than its key is not sent either.
    storage.setItem(name!, JSON.stringify({ ...held, interestId: OTHER }))
    expect(readHeld(storage, ANA, INTEREST, NOW)).toBeNull()
    storage.setItem(name!, JSON.stringify({ ...held, heldBy: BEN.userId }))
    expect(readHeld(storage, ANA, INTEREST, NOW)).toBeNull()
  })

  it("posts the same reply id on every attempt, with who held it, and nothing the session decides", () => {
    const held = reply()!

    expect(heldFields(held)).toEqual({
      body: "Yes, we can use you.",
      decision: "replied",
      heldBy: ANA.userId,
      heldFor: ANA.organizationId,
      interestId: INTEREST,
      replyId: REPLY
    })
    expect(Object.keys(heldFields(held))).not.toContain("organizationId")
    expect(Object.keys(heldFields(held))).not.toContain("userId")
  })

  it("adds a reason to a held decline, never to a reply", () => {
    expect(withReason(decline(), " We have enough trucks ").body).toBe("We have enough trucks")
    expect(withReason(reply()!, "We have enough trucks").body).toBe("Yes, we can use you.")
  })
})

describe("a held answer belongs to the person and the business that held it (#411)", () => {
  it("never reads Ana's held decline for Ben on the same computer, or for Ana in her other business", () => {
    const storage = memory()

    writeHeld(storage, decline(ANA))

    expect(readHeld(storage, BEN, INTEREST, NOW)).toBeNull()
    expect(readHeld(storage, ANA_ELSEWHERE, INTEREST, NOW)).toBeNull()
    expect(listHeld(storage, BEN, NOW)).toEqual([])
    expect(listHeld(storage, ANA_ELSEWHERE, NOW)).toEqual([])
    // Ana's record is untouched by Ben's visit: it is hers, and she still sees it.
    expect(readHeld(storage, ANA, INTEREST, NOW)).toMatchObject({ decision: "declined", heldBy: ANA.userId })
  })

  it("keeps each person's answer to the same inquiry apart", () => {
    const storage = memory()

    writeHeld(storage, reply("Ana's words", ANA)!)
    writeHeld(storage, reply("Ben's words", BEN)!)

    expect(readHeld(storage, ANA, INTEREST, NOW)?.body).toBe("Ana's words")
    expect(readHeld(storage, BEN, INTEREST, NOW)?.body).toBe("Ben's words")
    clearHeld(storage, BEN, INTEREST)
    expect(readHeld(storage, ANA, INTEREST, NOW)?.body).toBe("Ana's words")
  })

  it("lists every answer this person holds for this business, oldest first, for the inbox to send", () => {
    const storage = memory()

    writeHeld(storage, { ...reply("Second", ANA, OTHER)!, heldAt: NOW + 1_000 })
    writeHeld(storage, reply("First", ANA)!)
    writeHeld(storage, reply("Ben's", BEN)!)

    expect(listHeld(storage, ANA, NOW + 2_000).map((held) => held.body)).toEqual(["First", "Second"])
  })

  it("ignores a record from before answers were tied to a person: it could be anyone's", () => {
    const storage = memory()
    const legacy = { body: "Yes", decision: "replied", dueAt: NOW, heldAt: NOW, interestId: INTEREST, replyId: REPLY, v: 1 }

    storage.setItem(`logloads:flow-c:held:${INTEREST}`, JSON.stringify(legacy))

    expect(readHeld(storage, ANA, INTEREST, NOW)).toBeNull()
    expect(listHeld(storage, ANA, NOW)).toEqual([])
  })

  it("clears every held answer on the phone at sign-out, and nothing else", () => {
    const storage = memory()

    writeHeld(storage, reply("Ana's", ANA)!)
    writeHeld(storage, reply("Ben's", BEN)!)
    storage.setItem(`logloads:flow-c:held:${INTEREST}`, "{}")
    storage.setItem("logloads:offline:reply:" + INTEREST, "{}")

    clearAllHeld(storage)

    expect([...storage.data.keys()]).toEqual(["logloads:offline:reply:" + INTEREST])
  })
})

describe("a held answer is never sent unseen, and never dropped unsaid (#411)", () => {
  it("resumes the rest of the minute when the page comes back within it", () => {
    const opened = openHeld(reply()!, NOW + 20_000)

    expect(opened.phase).toBe("holding")
    expect(msLeft(opened.held, NOW + 20_000)).toBe(40_000)
    expect(opened.held.reopened).toBe(false)
    expect(opened.changed).toBe(false)
  })

  it("gives a fresh minute of Undo, saying it has not gone yet, when the minute ran out while no page held it", () => {
    // Held offline on Monday, opened on Thursday: it does not go the moment the thread opens.
    const thursday = NOW + 3 * 24 * 60 * 60 * 1000
    const opened = openHeld(decline(), thursday)

    expect(opened.phase).toBe("holding")
    expect(opened.changed).toBe(true)
    expect(opened.held.reopened).toBe(true)
    expect(msLeft(opened.held, thursday)).toBe(HOLD_MS)
    expect(opened.held.heldAt).toBe(NOW)
  })

  it("keeps a week-old answer, unsent, until the person sends it or lets it go", () => {
    const storage = memory()
    const held = decline()
    const later = NOW + HELD_TTL_MS + 1

    writeHeld(storage, held)

    expect(readHeld(storage, ANA, INTEREST, later)).toEqual(held)
    expect(listHeld(storage, ANA, later)).toEqual([held])
    expect(openHeld(held, later)).toEqual({ changed: false, held, phase: "stale" })
    expect(storage.data.size).toBe(1)
  })
})
