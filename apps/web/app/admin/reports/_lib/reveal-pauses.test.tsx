import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("../actions", () => ({ clearRevealPauseAction: async () => undefined }))

import { RevealPauses } from "./RevealPauses"
import { REVEAL_PAUSE_NOTICES, revealPauseNotice, revealPauseNoticeFor } from "./reveal-pause-notice"

/**
 * #403: the phone-reveal pauses on the moderation screen. A moderator sees each open pause with its subject, its
 * report's status and the landing count, and clears it with a reason; nothing shows a phone, a landing or a job. The
 * notice after a clear comes from a fixed list, never from the URL's text.
 */

const PAUSE = {
  id: "44444444-4444-4444-8444-444444444444",
  landingsInWindow: 5,
  openedAt: "2026-11-18T21:05:00.000Z",
  reportId: "55555555-5555-4555-8555-555555555555",
  reportStatus: "actioned" as const,
  subjectId: "11111111-1111-4111-8111-111111111111",
  subjectKind: "organization" as const,
  subjectName: "Granite Creek Hauling"
}

beforeEach(() => {
  // The app compiles JSX with the classic runtime under Vitest, as in v2-pages.test.tsx.
  vi.stubGlobal("React", React)
})

describe("phone-reveal pauses on the moderation screen", () => {
  it("lists each open pause with a clear form that needs a reason", () => {
    const html = renderToStaticMarkup(<RevealPauses notice={undefined} result={{ kind: "ready", pauses: [PAUSE, { ...PAUSE, id: "66666666-6666-4666-8666-666666666666", reportStatus: "open", subjectKind: "person", subjectName: "Sam Carter" }] }} />)

    expect(html).toContain('id="reveal-pauses"')
    expect(html).toContain("2 open")
    expect(html).toContain("Granite Creek Hauling")
    expect(html).toContain("Hauling business")
    expect(html).toContain("Report actioned · still paused")
    expect(html).toContain("Sam Carter")
    expect(html).toContain("Person")
    expect(html).toContain("5 distinct landings in the last 24 hours")
    expect(html).toContain(`<input type="hidden" name="pauseId" value="${PAUSE.id}"/>`)
    expect(html).toMatch(/<textarea[^>]*maxLength="500"[^>]*minLength="5"[^>]*name="reason"[^>]*required/)
    expect(html.match(/Clear pause/g)).toHaveLength(2)
    expect(html).not.toMatch(/\(\d{3}\) \d{3}-\d{4}|\+1\d{10}|tel:/)
  })

  it("explains an empty list, the pilot store, a refused person and a failed read", () => {
    expect(renderToStaticMarkup(<RevealPauses notice={undefined} result={{ kind: "ready", pauses: [] }} />)).toContain("No open pauses.")
    expect(renderToStaticMarkup(<RevealPauses notice={undefined} result={{ kind: "unavailable" }} />)).toContain("normalized marketplace store")
    expect(renderToStaticMarkup(<RevealPauses notice={undefined} result={{ kind: "denied" }} />)).toContain("Only LogLoads moderators and support staff")
    const failed = renderToStaticMarkup(<RevealPauses notice={undefined} result={{ kind: "failed", requestId: "v2_abc" }} />)
    expect(failed).toContain("Reference: v2_abc.")
    expect(failed).not.toContain("Clear pause")
  })

  it("shows only a known notice, and maps each clear outcome to one", () => {
    expect(renderToStaticMarkup(<RevealPauses notice="cleared" result={{ kind: "ready", pauses: [] }} />)).toContain(REVEAL_PAUSE_NOTICES.cleared.text)
    expect(revealPauseNotice("<script>")).toBeNull()
    expect(revealPauseNotice(["denied", "cleared"])).toEqual(REVEAL_PAUSE_NOTICES.denied)
    expect(revealPauseNotice("toString")).toBeNull()

    expect(revealPauseNoticeFor({ kind: "cleared" })).toBe("cleared")
    expect(revealPauseNoticeFor({ kind: "failed", requestId: null })).toBe("failed")
    expect(revealPauseNoticeFor({ code: "P0002", kind: "refused", message: "Reveal pause not found" })).toBe("not_found")
    expect(revealPauseNoticeFor({ code: "22023", kind: "refused", message: "a reason of 5 to 500 characters is required" })).toBe("reason")
    expect(revealPauseNoticeFor({ code: "42501", kind: "refused", message: "platform moderator required" })).toBe("denied")
  })
})
