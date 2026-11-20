import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it, vi } from "vitest"

import { clearAllHeld, HELD_PREFIX } from "./held-keys"
import { holdSend, writeHeld, type HeldStore } from "./held-send"
import { settleHeldAnswers } from "./held-sign-out"

const NOW = Date.parse("2026-11-18T18:00:00.000Z")
const ANA = { organizationId: "22222222-aaaa-4aaa-8aaa-222222222222", userId: "77777777-aaaa-4aaa-8aaa-777777777777" }
const INTEREST = "44444444-cccc-4ccc-8ccc-444444444444"
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

function phoneWithHeldAnswers() {
  const storage = memory()
  writeHeld(storage, holdSend({ body: "", decision: "declined", interestId: INTEREST, recipientName: "New River Hauling", replyId: REPLY, viewer: ANA }, NOW)!)
  storage.setItem(`${HELD_PREFIX}${INTEREST}`, "{}")
  storage.setItem("logloads:offline:reply:" + INTEREST, "{}")
  vi.stubGlobal("window", { localStorage: storage })
  return storage
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("the sign-out button's held-answer step loads its code on sign-out (#447)", () => {
  it("runs the loaded step and leaves the phone to it", async () => {
    const storage = phoneWithHeldAnswers()
    const settleHeld = vi.fn(async () => undefined)

    await settleHeldAnswers(async () => ({ settleHeld }))

    expect(settleHeld).toHaveBeenCalledTimes(1)
    expect(storage.data.size).toBe(3)
  })

  it("still clears every held answer, and nothing else, when the code cannot load", async () => {
    const storage = phoneWithHeldAnswers()

    await expect(settleHeldAnswers(() => Promise.reject(new Error("ChunkLoadError")))).resolves.toBeUndefined()

    expect([...storage.data.keys()]).toEqual(["logloads:offline:reply:" + INTEREST])
  })

  it("still clears them when the loaded step fails", async () => {
    const storage = phoneWithHeldAnswers()

    await settleHeldAnswers(async () => ({ settleHeld: () => Promise.reject(new Error("failed")) }))

    expect([...storage.data.keys()]).toEqual(["logloads:offline:reply:" + INTEREST])
  })

  it("never stops the sign-out where storage is blocked", async () => {
    vi.stubGlobal("window", {
      get localStorage(): never {
        throw new Error("blocked")
      }
    })

    await expect(settleHeldAnswers(() => Promise.reject(new Error("offline")))).resolves.toBeUndefined()
  })

  it("uses the same keys as the held answers themselves", () => {
    const storage = phoneWithHeldAnswers()

    expect([...storage.data.keys()].filter((name) => name.startsWith(HELD_PREFIX))).toHaveLength(2)
    clearAllHeld(storage)
    expect(storage.data.size).toBe(1)
  })
})

describe("what every V2 page downloads for sign-out stays small (#447)", () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const source = (path: string) => readFileSync(resolve(here, path), "utf8")
  const staticImports = (text: string) => [...text.matchAll(/^import\s[^\n]*?from\s+"([^"]+)"/gm)].map((match) => match[1])

  it("the sign-out button reaches the held-answer rules and the server action only through the on-demand module", () => {
    expect(staticImports(source("./held-keys.ts"))).toEqual([])
    expect(staticImports(source("./held-sign-out.ts"))).toEqual(["./held-keys"])
    expect(source("./held-sign-out.ts")).toContain('import("./held-settle")')

    const button = staticImports(source("../../../../../components/v2/SignOutButton.tsx"))

    expect(button).toContain("@/app/v2/landing/inquiries/_lib/held-sign-out")
    expect(button.filter((path) => /held-(send|phone|settle)|marketplace-v2\/actions/.test(path))).toEqual([])
  })
})
