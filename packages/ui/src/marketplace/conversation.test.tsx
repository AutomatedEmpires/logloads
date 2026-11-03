import type { MarketplaceInterestView } from "@logloads/contracts"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { findElement, openingTag, textOf } from "../primitives/test-helpers"
import { ConversationThread } from "./ConversationThread"
import { InquiryRow } from "./InquiryRow"
import { MessageComposer } from "./MessageComposer"
import { interestView } from "./test-fixtures"
import type { MessageComposerProps } from "./types"

const ATTACK = `<img src=x onerror="alert(1)"><script>alert("x")</script>`

function reply(authorSide: "hauler" | "landing", body: string, createdAt: string): MarketplaceInterestView["replies"][number] {
  return {
    authorName: authorSide === "landing" ? "Lee at the landing" : "Sam Hauler",
    authorSide,
    authorUserId: "66666666-eeee-4eee-8eee-666666666666",
    body,
    createdAt,
    id: `reply-${createdAt}`
  }
}

describe("InquiryRow", () => {
  it("is an <li> whose other-party name is the single link", () => {
    const html = renderToStaticMarkup(<InquiryRow href="/v2/landing/inquiries?i=1" interest={interestView()} selected={false} viewerSide="landing" />)

    expect(html).toMatch(/^<li /)
    expect(html.match(/<a\b/g)).toHaveLength(1)
    expect(html).not.toMatch(/<button/)
    expect(openingTag(html, /^<a/)).toContain('href="/v2/landing/inquiries?i=1"')
    expect(html).toMatch(/<a[^>]*>Example Hauling LLC<\/a>/)
    expect(openingTag(html, /^<a/)).not.toContain("aria-current")
  })

  it("marks the selected row with aria-current on its link", () => {
    const html = renderToStaticMarkup(<InquiryRow href="#c" interest={interestView()} selected viewerSide="landing" />)

    expect(openingTag(html, /^<a/)).toContain('aria-current="true"')
    expect(openingTag(html, /^<li/)).toContain("data-selected")
  })

  it("names the other party and words the status for the viewer's side (UX-DEC-01)", () => {
    const landing = textOf(renderToStaticMarkup(<InquiryRow href="#" interest={interestView()} selected={false} viewerSide="landing" />))
    const hauler = textOf(renderToStaticMarkup(<InquiryRow href="#" interest={interestView()} selected={false} viewerSide="hauler" />))

    expect(landing).toBe("Example Hauling LLC Nov 1, 2026 Saw logs to the river mill 2 trucks offered · 2 × Log truck + Pole trailer New · from Nov 10, 2026")
    expect(hauler).toMatch(/^Example Timber Co .* Sent · waiting for the landing · from Nov 10, 2026$/)
    expect(`${landing} ${hauler}`).not.toMatch(/\b(booked|hired|assigned)\b/i)
  })

  it("selects on a plain click when onSelect is given", () => {
    const onSelect = vi.fn()
    const link = findElement(InquiryRow({ href: "#c", interest: interestView(), onSelect, selected: false, viewerSide: "landing" }), (props) => props.href === "#c")
    const preventDefault = vi.fn()

    ;(link?.props.onClick as (event: object) => void)({ altKey: false, button: 0, ctrlKey: false, defaultPrevented: false, metaKey: false, preventDefault, shiftKey: false })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(onSelect.mock.calls).toEqual([[interestView().id]])
  })
})

describe("ConversationThread", () => {
  const interest = interestView({
    replies: [
      reply("hauler", "Second from the hauler", "2026-11-01T15:00:00.000Z"),
      reply("landing", "First from the landing", "2026-11-01T14:00:00.000Z")
    ],
    status: "replied"
  })

  it("opens with the inquiry note, then replies oldest first, aligned by the viewer's side", () => {
    const html = renderToStaticMarkup(<ConversationThread interest={interest} viewerSide="landing" />)
    const sides = [...html.matchAll(/data-side="(me|them)"/g)].map((match) => match[1])

    expect(openingTag(html, /role="log"/)).toContain('aria-label="Messages with Example Hauling LLC"')
    expect(textOf(html)).toBe(
      "Interest sent Nov 1, 2026 Two trucks ready from the 10th. Sam Hauler · Nov 1, 2026 First from the landing You · Nov 1, 2026 Second from the hauler Sam Hauler · Nov 1, 2026"
    )
    expect(sides).toEqual(["them", "me", "them"])
    expect(renderToStaticMarkup(<ConversationThread interest={interest} viewerSide="hauler" />)).toMatch(/data-side="me"[\s\S]*data-side="them"[\s\S]*data-side="me"/)
  })

  it("renders every message as escaped text", () => {
    const html = renderToStaticMarkup(
      <ConversationThread interest={interestView({ message: ATTACK, replies: [reply("landing", ATTACK, "2026-11-01T14:00:00.000Z")] })} viewerSide="hauler" />
    )

    expect(html).not.toContain("<img")
    expect(html).not.toContain("<script")
    expect(html.match(/&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/g)).toHaveLength(2)
  })

  it("says when the inquiry was closed", () => {
    expect(textOf(renderToStaticMarkup(<ConversationThread interest={interestView({ status: "declined" })} viewerSide="hauler" />))).toMatch(
      /The landing declined this inquiry\.$/
    )
    expect(textOf(renderToStaticMarkup(<ConversationThread interest={interestView({ message: null })} viewerSide="hauler" />))).toBe(
      "Interest sent Nov 1, 2026 No messages yet."
    )
  })
})

describe("MessageComposer", () => {
  const props = (overrides: Partial<MessageComposerProps> = {}): MessageComposerProps => ({
    draft: "",
    onDraftChange: vi.fn(),
    onSend: vi.fn(),
    quickReplies: ["Can you start on Nov 10?", "We'll be in touch"],
    recipientName: "Example Hauling LLC",
    ...overrides
  })
  const submit = (composerProps: MessageComposerProps) => {
    const preventDefault = vi.fn()
    ;(MessageComposer(composerProps).props.onSubmit as (event: object) => void)({ preventDefault })
    return preventDefault
  }

  it("fills the draft from a quick reply and never sends it", () => {
    const composer = props()
    const quick = findElement(MessageComposer(composer), (candidate) => candidate.children === "We'll be in touch")

    ;(quick?.props.onClick as () => void)()
    expect(composer.onDraftChange).toHaveBeenCalledWith("We'll be in touch")
    expect(composer.onSend).not.toHaveBeenCalled()
    expect(renderToStaticMarkup(<MessageComposer {...composer} />)).toMatch(/<button class="[^"]*" type="button">Can you start on Nov 10\?<\/button>/)
  })

  it("passes typed text to the page without sending", () => {
    const composer = props()
    const textarea = findElement(MessageComposer(composer), (candidate) => candidate["aria-label"] === "Reply to Example Hauling LLC")

    ;(textarea?.props.onChange as (event: object) => void)({ currentTarget: { value: "Gate opens at 4:45" } })
    expect(composer.onDraftChange).toHaveBeenCalledWith("Gate opens at 4:45")
    expect(composer.onSend).not.toHaveBeenCalled()
  })

  it("cannot send a blank message or send twice while sending", () => {
    const blank = props({ draft: "   " })
    expect(submit(blank)).toHaveBeenCalledOnce()
    expect(blank.onSend).not.toHaveBeenCalled()
    expect(openingTag(renderToStaticMarkup(<MessageComposer {...blank} />), /aria-disabled/)).toContain('type="button"')

    const sending = props({ draft: "On my way", sending: true })
    submit(sending)
    expect(sending.onSend).not.toHaveBeenCalled()

    const ready = props({ draft: "On my way" })
    submit(ready)
    expect(ready.onSend).toHaveBeenCalledOnce()
    expect(openingTag(renderToStaticMarkup(<MessageComposer {...ready} />), /type="submit"/)).not.toContain("aria-disabled")
  })

  it("renders the draft as escaped text", () => {
    const html = renderToStaticMarkup(<MessageComposer {...props({ draft: ATTACK })} />)

    expect(html).not.toContain("<script")
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;script&gt;")
  })

  describe("posting to a form action (progressive enhancement)", () => {
    const action = async () => undefined
    const posting = (overrides: Partial<MessageComposerProps> = {}) =>
      props({ action, hiddenFields: <input name="interestId" type="hidden" value="i-1" />, ...overrides })

    it("names and requires the textarea and carries the page's hidden fields", () => {
      const html = renderToStaticMarkup(<MessageComposer {...posting()} />)

      expect(openingTag(html, /^<textarea/)).toContain('name="body"')
      expect(openingTag(html, /^<textarea/)).toContain('required=""')
      expect(openingTag(html, /name="interestId"/)).toContain('type="hidden"')
      expect(openingTag(renderToStaticMarkup(<MessageComposer {...posting({ name: "message" })} />), /^<textarea/)).toContain('name="message"')
    })

    it("offers a plain submit button for clients without scripts, beside the scripted Send", () => {
      const html = renderToStaticMarkup(<MessageComposer {...posting()} />)

      expect(html).toMatch(/<noscript><button[^>]*type="submit"[^>]*>(?:(?!<\/button>).)*Send/)
      // The scripted Send is still unavailable while the draft is blank.
      expect(openingTag(html, /aria-disabled="true"/)).toContain('type="button"')
      expect(renderToStaticMarkup(<MessageComposer {...props()} />)).not.toContain("<noscript>")
    })

    it("lets a ready draft through to the form action, and stops a blank or in-flight one", () => {
      const ready = posting({ draft: "On my way" })
      expect(submit(ready)).not.toHaveBeenCalled()
      expect(ready.onSend).toHaveBeenCalledOnce()

      const blank = posting({ draft: "  " })
      expect(submit(blank)).toHaveBeenCalledOnce()
      expect(blank.onSend).not.toHaveBeenCalled()

      const sending = posting({ draft: "On my way", sending: true })
      expect(submit(sending)).toHaveBeenCalledOnce()
      expect(sending.onSend).not.toHaveBeenCalled()
    })
  })

  it("names the recipient and keeps contact sharing explicit (UX-DEC-04)", () => {
    const html = renderToStaticMarkup(<MessageComposer {...props()} />)

    expect(openingTag(html, /^<textarea/)).toContain('aria-label="Reply to Example Hauling LLC"')
    expect(openingTag(html, /^<textarea/)).toContain('maxLength="2000"')
    expect(textOf(html)).toContain("A phone number or email you write is shared with Example Hauling LLC only.")
  })
})
