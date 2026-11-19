import { describe, expect, it } from "vitest"

import { READY_REPLY_ASK_DAY, READY_REPLY_YES, READY_REPLY_YES_CALL, readyReplyDay, readyReplyTexts } from "./ready-replies"

const CONTACT = /@|https?:\/\/|www\.|\+?\d[\d\s().-]{7,}\d/i

describe("flow C ready replies (#328)", () => {
  it("offers a yes, then the hauler's own first day when it has not passed", () => {
    expect(readyReplyDay("2026-11-16")).toBe("Mon, Nov 16")
    expect(readyReplyTexts({ availableFrom: "2026-11-16" }, "2026-11-12")).toEqual([READY_REPLY_YES, "Yes. Be here Mon, Nov 16."])
    expect(readyReplyTexts({ availableFrom: "2026-11-12" }, "2026-11-12")).toEqual([READY_REPLY_YES, "Yes. Be here Thu, Nov 12."])
  })

  it("asks for the first day when the hauler gave none, or it has passed", () => {
    expect(readyReplyTexts({ availableFrom: null }, "2026-11-12")).toEqual([READY_REPLY_YES, READY_REPLY_ASK_DAY])
    expect(readyReplyTexts({ availableFrom: "2026-11-01" }, "2026-11-12")).toEqual([READY_REPLY_YES, READY_REPLY_ASK_DAY])
    expect(readyReplyTexts({ availableFrom: "soon" }, "2026-11-12")).toEqual([READY_REPLY_YES, READY_REPLY_ASK_DAY])
  })

  it("says the frame's \"Call me.\" only where the landing can then show its number (#403)", () => {
    expect(READY_REPLY_YES_CALL).toBe("Yes, we can use you. Call me.")
    expect(readyReplyTexts({ availableFrom: null }, "2026-11-12", { numberCanBeShared: true })).toEqual([READY_REPLY_YES_CALL, READY_REPLY_ASK_DAY])
    expect(readyReplyTexts({ availableFrom: null }, "2026-11-12", { numberCanBeShared: false })[0]).toBe(READY_REPLY_YES)
    expect(readyReplyTexts({ availableFrom: null }, "2026-11-12")[0]).toBe(READY_REPLY_YES)
  })

  it("never carries a phone number, an email or a link, and fits one button line", () => {
    for (const text of [...readyReplyTexts({ availableFrom: "2026-12-31" }, "2026-11-12"), READY_REPLY_ASK_DAY, READY_REPLY_YES_CALL]) {
      expect(text).not.toMatch(CONTACT)
      expect(text.length).toBeLessThanOrEqual(32)
    }
  })
})
