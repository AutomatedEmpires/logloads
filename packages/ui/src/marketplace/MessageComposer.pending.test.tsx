import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { openingTag } from "../primitives/test-helpers"
import { MessageComposer } from "./MessageComposer"
import type { MessageComposerProps } from "./types"

// React's form status for the composer's own form, set per test. Only this file mocks it.
const formStatus = vi.hoisted(() => ({ pending: false }))

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  useFormStatus: () => ({ action: null, data: null, method: null, pending: formStatus.pending })
}))

const composer: MessageComposerProps = {
  action: async () => undefined,
  draft: "Tuesday at 5",
  onDraftChange: () => undefined,
  onSend: () => undefined,
  recipientName: "North Pine Logging"
}

const scriptedSend = (html: string) => openingTag(html, /class="[^"]*scripted/)

describe("MessageComposer Send while its form action runs (PR #179)", () => {
  afterEach(() => {
    formStatus.pending = false
  })

  it("shows loading and is inert from React's form status alone, with no sending prop", () => {
    formStatus.pending = true
    const send = scriptedSend(renderToStaticMarkup(<MessageComposer {...composer} />))

    expect(send).toContain('aria-busy="true"')
    expect(send).toContain('aria-disabled="true"')
    expect(send).toContain('type="button"')
  })

  it("is a ready submit button again once the action has ended", () => {
    const send = scriptedSend(renderToStaticMarkup(<MessageComposer {...composer} />))

    expect(send).not.toContain("aria-busy")
    expect(send).not.toContain("aria-disabled")
    expect(send).toContain('type="submit"')
  })
})
