import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { DetailPanel } from "./DetailPanel"
import { createFocusReturn, type FocusTarget } from "./focus-return"

/**
 * The package's tests run in Node without a DOM, so the focus behaviour is tested through the tracker the
 * panel delegates to (createFocusReturn). The browser wiring (focusin listener, Escape, unmount) is left to
 * the Playwright focus-return check in spec §9 (DS-05).
 */
function node(connected = true): FocusTarget & { focus: ReturnType<typeof vi.fn> } {
  return { focus: vi.fn(), isConnected: connected }
}

describe("DetailPanel markup", () => {
  it("is a named, programmatically focusable aside with its own Close control", () => {
    const html = renderToStaticMarkup(
      <DetailPanel id="job-detail" label="Job details" onClose={() => undefined}>
        <h2>Spruce sawlogs</h2>
      </DetailPanel>
    )

    expect(html).toMatch(/^<aside [^>]*id="job-detail"[^>]*aria-label="Job details"[^>]*tabindex="-1">/)
    expect(html).toMatch(/<button [^>]*type="button">Close<span [^>]*> Job details<\/span><\/button>/)
    expect(html).toContain("<h2>Spruce sawlogs</h2>")
  })
})

describe("DetailPanel focus return", () => {
  const inside = node()
  const body = node()
  const tracker = () => createFocusReturn((candidate) => candidate === inside, (candidate) => candidate === body)

  it("returns focus to the control the panel was opened from", () => {
    const opener = node()
    const focus = tracker()

    focus.note(opener)
    focus.note(inside) // the Close button is inside the panel: it must not replace the opener

    expect(focus.restore()).toBe(true)
    expect(opener.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true })
    expect(inside.focus).not.toHaveBeenCalled()
  })

  it("follows the latest outside control, e.g. the next selected row", () => {
    const firstRow = node()
    const secondRow = node()
    const focus = tracker()

    focus.note(firstRow)
    focus.note(secondRow)
    focus.restore()

    expect(secondRow.focus).toHaveBeenCalledOnce()
    expect(firstRow.focus).not.toHaveBeenCalled()
  })

  it("ignores <body> and values that cannot take focus", () => {
    const opener = node()
    const focus = tracker()

    focus.note(opener)
    focus.note(body)
    focus.note(null)
    focus.note({ tagName: "DIV" })

    expect(focus.opener).toBe(opener)
  })

  it("does nothing when there is no opener or it has left the document", () => {
    const removed = node(false)
    const focus = tracker()

    expect(focus.restore()).toBe(false)
    focus.note(removed)
    expect(focus.restore()).toBe(false)
    expect(removed.focus).not.toHaveBeenCalled()
  })
})
