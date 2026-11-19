import { afterEach, describe, expect, it, vi } from "vitest"

import { presetReason, settleHeldOnSignOut } from "./held-phone"
import { HELD_TTL_MS, holdSend, writeHeld, type HeldStore } from "./held-send"

const NOW = Date.parse("2026-11-18T18:00:00.000Z")
const ANA = { organizationId: "22222222-aaaa-4aaa-8aaa-222222222222", userId: "77777777-aaaa-4aaa-8aaa-777777777777" }
const BEN = { organizationId: ANA.organizationId, userId: "88888888-bbbb-4bbb-8bbb-888888888888" }
const FIRST = "44444444-cccc-4ccc-8ccc-444444444444"
const SECOND = "66666666-eeee-4eee-8eee-666666666666"
const REPLY = "55555555-dddd-4ddd-8ddd-555555555555"

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

const held = (viewer: typeof ANA, interestId: string, at = NOW) =>
  holdSend({ body: "", decision: "declined", interestId, recipientName: "New River Hauling", replyId: REPLY, viewer }, at)!

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("sign-out settles the phone's held answers, then clears them (#411)", () => {
  it("sends each held answer still due with who held it, skips a week-old one, and leaves nothing behind", async () => {
    const storage = memory()
    vi.stubGlobal("window", { localStorage: storage })
    writeHeld(storage, held(ANA, FIRST))
    writeHeld(storage, held(BEN, SECOND))
    writeHeld(storage, held(ANA, SECOND, NOW - HELD_TTL_MS - 1))
    storage.setItem("logloads:offline:reply:" + FIRST, "{}")
    const send = vi.fn<(data: FormData) => Promise<{ ok: boolean }>>(async () => ({ ok: true }))

    await settleHeldOnSignOut(send, NOW)

    // The server decides whose each one is: Ben's is refused there, never sent as Ana.
    const sent = send.mock.calls.map(([data]) => Object.fromEntries(data.entries()))
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ decision: "declined", heldBy: ANA.userId, heldFor: ANA.organizationId, interestId: FIRST }),
        expect.objectContaining({ heldBy: BEN.userId, interestId: SECOND })
      ])
    )
    expect(sent).toHaveLength(2)
    expect([...storage.data.keys()]).toEqual(["logloads:offline:reply:" + FIRST])
  })

  it("clears them even when a send fails, and never stops the sign-out", async () => {
    const storage = memory()
    vi.stubGlobal("window", { localStorage: storage })
    writeHeld(storage, held(ANA, FIRST))

    await expect(settleHeldOnSignOut(async () => Promise.reject(new Error("offline")), NOW)).resolves.toBeUndefined()
    expect(storage.data.size).toBe(0)
  })

  it("does nothing where the browser blocks storage", async () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("blocked")
      }
    })
    const send = vi.fn()

    await expect(settleHeldOnSignOut(send, NOW)).resolves.toBeUndefined()
    expect(send).not.toHaveBeenCalled()
  })
})

describe("a ready decline reason", () => {
  it("is one of the reasons offered, not words the landing typed", () => {
    const reasons = ["We have enough trucks", "Wrong truck or trailer"]

    expect(presetReason("We have enough trucks", reasons)).toBe(true)
    expect(presetReason("We filled the job yesterday", reasons)).toBe(false)
    expect(presetReason("", reasons)).toBe(false)
  })
})
