import type { MarketplaceInterestView } from "@logloads/contracts"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { findElement, openingTag, textOf } from "../primitives/test-helpers"
import { ConversationThread } from "./ConversationThread"
import { InquiryRow } from "./InquiryRow"
import { localTimeText, utcTimeText } from "./LocalTime"
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

  it("marks a landing's reviewed inquiry Seen, still the landing's move; never on the hauler's side", () => {
    const viewed = interestView({ status: "viewed" })
    const landing = renderToStaticMarkup(<InquiryRow href="#" interest={viewed} selected={false} viewerSide="landing" />)
    const hauler = renderToStaticMarkup(<InquiryRow href="#" interest={viewed} selected={false} viewerSide="hauler" />)

    expect(openingTag(landing, /data-seen/)).toContain('data-tone="attention"')
    expect(textOf(landing)).toContain("Seen · not answered")
    expect(hauler).not.toContain("data-seen")
    expect(renderToStaticMarkup(<InquiryRow href="#" interest={interestView()} selected={false} viewerSide="landing" />)).not.toContain("data-seen")
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
      "Interest sent Nov 1, 2026 Two trucks ready from the 10th. Sam Hauler · Nov 1, 2026, 12:00 PM UTC First from the landing You · Nov 1, 2026, 2:00 PM UTC Second from the hauler Sam Hauler · Nov 1, 2026, 3:00 PM UTC"
    )
    expect(sides).toEqual(["them", "me", "them"])
    expect(renderToStaticMarkup(<ConversationThread interest={interest} viewerSide="hauler" />)).toMatch(/data-side="me"[\s\S]*data-side="them"[\s\S]*data-side="me"/)
  })

  it("gives every message a machine-readable time, shown in UTC until the browser shows the reader's own", () => {
    const html = renderToStaticMarkup(<ConversationThread interest={interest} viewerSide="landing" />)

    expect([...html.matchAll(/<time class="[^"]*" dateTime="([^"]+)">/g)].map((match) => match[1])).toEqual([
      interest.createdAt,
      "2026-11-01T14:00:00.000Z",
      "2026-11-01T15:00:00.000Z"
    ])
  })

  it("names a colleague's message and marks only the viewer's own as You", () => {
    const colleague = { ...reply("landing", "From a colleague", "2026-11-01T14:30:00.000Z"), authorName: "Dana Dispatch", authorUserId: "77777777-ffff-4fff-8fff-777777777777" }
    const html = renderToStaticMarkup(
      <ConversationThread
        interest={interestView({ replies: [reply("landing", "Mine", "2026-11-01T14:00:00.000Z"), colleague] })}
        viewerSide="landing"
        viewerUserId="66666666-eeee-4eee-8eee-666666666666"
      />
    )

    expect(textOf(html)).toContain("Mine You · Nov 1, 2026, 2:00 PM UTC")
    expect(textOf(html)).toContain("From a colleague Dana Dispatch · Nov 1, 2026, 2:30 PM UTC")
    expect([...html.matchAll(/data-side="(me|them)"/g)].map((match) => match[1])).toEqual(["them", "me", "me"])
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

describe("LocalTime", () => {
  it("renders the same labelled UTC text on the server and before the browser takes over", () => {
    expect(utcTimeText("2026-11-02T18:48:00.000Z")).toBe("Nov 2, 2026, 6:48 PM UTC")
    expect(utcTimeText("2026-01-05T00:07:00.000Z")).toBe("Jan 5, 2026, 12:07 AM UTC")
    expect(utcTimeText("2026-07-04T12:00:00.000Z")).toBe("Jul 4, 2026, 12:00 PM UTC")
    expect(utcTimeText("not a time")).toBeNull()
  })

  it("shows the reader's local time, with the year only when it is not this year", () => {
    const now = new Date("2026-11-03T12:00:00.000Z")

    expect(localTimeText("2026-11-02T18:48:00.000Z", now)).not.toMatch(/2026/)
    expect(localTimeText("2025-11-02T18:48:00.000Z", now)).toMatch(/2025/)
    expect(localTimeText("nope", now)).toBeNull()
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

    it("submits straight to the form action, with Send inert while the draft is blank or a send is in flight", () => {
      // No submit handler of its own, like the app's other server-action forms (PR #179).
      expect(MessageComposer(posting({ draft: "On my way" })).props.onSubmit).toBeUndefined()

      const scriptedSend = (html: string) => openingTag(html, /class="[^"]*scripted/)
      expect(scriptedSend(renderToStaticMarkup(<MessageComposer {...posting({ draft: "On my way" })} />))).toContain('type="submit"')
      expect(scriptedSend(renderToStaticMarkup(<MessageComposer {...posting({ draft: "  " })} />))).toContain('type="button"')
      expect(scriptedSend(renderToStaticMarkup(<MessageComposer {...posting({ draft: "On my way", sending: true })} />))).toContain('type="button"')
    })
  })

  it("names the recipient and keeps contact sharing explicit (UX-DEC-04)", () => {
    const html = renderToStaticMarkup(<MessageComposer {...props()} />)

    expect(openingTag(html, /^<textarea/)).toContain('aria-label="Reply to Example Hauling LLC"')
    expect(openingTag(html, /^<textarea/)).toContain('maxLength="2000"')
    expect(textOf(html)).toContain("A phone number or email you write is shared with Example Hauling LLC only.")
  })
})
