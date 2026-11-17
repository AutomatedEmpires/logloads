import { describe, expect, it } from "vitest"

import {
  clearInterestDraftForSlug,
  clearReplyDraft,
  DRAFT_TTL_MS,
  interestSendSucceeded,
  readInterestDraft,
  readReplyDraft,
  replySendSucceeded,
  writeInterestDraft,
  writeReplyDraft,
  type DraftStore,
  type InterestFields
} from "./drafts"

const JOB = "11111111-1111-4111-8111-111111111111"
const INTEREST = "55555555-5555-4555-8555-555555555555"
const REPLY = "33333333-3333-4333-8333-333333333333"
const REPLY_AGAIN = "44444444-4444-4444-8444-444444444444"

function memory(): DraftStore {
  const data = new Map<string, string>()
  return {
    getItem: (key) => data.get(key) ?? null,
    removeItem: (key) => {
      data.delete(key)
    },
    setItem: (key, value) => {
      data.set(key, value)
    }
  }
}

function fields(overrides: Partial<InterestFields> = {}): InterestFields {
  return {
    availableFrom: "2026-11-18",
    availableUntil: "2026-11-20",
    contactPreference: "phone",
    equipmentCounts: { "pole-trailer": "2" },
    loadPostingId: JOB,
    message: "Two trucks, both with self-loaders.",
    trucksOffered: "",
    ...overrides
  }
}

describe("interest drafts", () => {
  it("keeps one idempotency key while the same attempt is edited and retried", () => {
    const store = memory()
    const first = writeInterestDraft(store, fields(), "pine-ridge")
    const retry = writeInterestDraft(store, fields({ message: "Two trucks. Tuesday works." }), "pine-ridge")

    expect(first?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i)
    expect(retry?.idempotencyKey).toBe(first?.idempotencyKey)
    expect(readInterestDraft(store, JOB)?.fields).toMatchObject({
      availableFrom: "2026-11-18",
      contactPreference: "phone",
      equipmentCounts: { "pole-trailer": "2" },
      message: "Two trucks. Tuesday works."
    })
  })

  it("mints a new key after the send is acknowledged", () => {
    const store = memory()
    const first = writeInterestDraft(store, fields(), "pine-ridge")
    clearInterestDraftForSlug(store, "pine-ridge")
    const next = writeInterestDraft(store, fields(), "pine-ridge")

    expect(readInterestDraft(store, JOB)).toStrictEqual(next)
    expect(next?.idempotencyKey).not.toBe(first?.idempotencyKey)
    expect(interestSendSucceeded(new URLSearchParams("sent=1"))).toBe(true)
    expect(interestSendSucceeded(new URLSearchParams("error=busy"))).toBe(false)
  })

  it("drops a gate code or a coordinate and keeps an ordinary message", () => {
    const store = memory()
    expect(writeInterestDraft(store, fields({ message: "gate code 4412" }), "pine")?.fields.message).toBe("")
    expect(writeInterestDraft(store, fields({ message: "Meet at 45.5231, -122.6765" }), "pine")?.fields.message).toBe("")
    expect(writeInterestDraft(store, fields({ message: "Call me at 541-555-0199" }), "pine")?.fields.message).toBe("Call me at 541-555-0199")
  })

  it("forgets a draft that is older than a week or not valid JSON", () => {
    const store = memory()
    writeInterestDraft(store, fields(), "pine", "2020-01-01T00:00:00.000Z")
    expect(readInterestDraft(store, JOB, Date.parse("2020-01-01T00:00:00.000Z") + DRAFT_TTL_MS + 1)).toBeNull()

    writeInterestDraft(store, fields(), "pine")
    store.setItem(`logloads:offline:interest:${JOB}`, "{")
    expect(readInterestDraft(store, JOB)).toBeNull()
    expect(writeInterestDraft(store, fields({ loadPostingId: "not-a-job" }), "pine")).toBeNull()
  })
})

describe("reply drafts", () => {
  it("keeps the first reply id so a retry sends once", () => {
    const store = memory()
    const first = writeReplyDraft(store, INTEREST, "On our way Tuesday.", REPLY)
    const retry = writeReplyDraft(store, INTEREST, "On our way Tuesday, two trucks.", REPLY_AGAIN)

    expect(retry?.replyId).toBe(REPLY)
    expect(retry?.body).toBe("On our way Tuesday, two trucks.")
    expect(first?.replyId).toBe(REPLY)

    clearReplyDraft(store, INTEREST)
    expect(writeReplyDraft(store, INTEREST, "A later message.", REPLY_AGAIN)?.replyId).toBe(REPLY_AGAIN)
  })

  it("treats a hauler reply and a landing reply as delivered, and drops a gate code", () => {
    expect(replySendSucceeded(new URLSearchParams("updated=reply"))).toBe(true)
    expect(replySendSucceeded(new URLSearchParams("updated=replied"))).toBe(true)
    expect(replySendSucceeded(new URLSearchParams("updated=withdrawn"))).toBe(false)
    expect(replySendSucceeded(new URLSearchParams("error=busy"))).toBe(false)

    const store = memory()
    expect(writeReplyDraft(store, INTEREST, "The gate code is 4412", REPLY)?.body).toBe("")
    expect(readReplyDraft(store, INTEREST)?.replyId).toBe(REPLY)
  })
})
