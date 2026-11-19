import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

/**
 * #424: the privacy request form in each state the frames draw (Figma 04 Settings, #336), plus the states the store
 * and the network add, rendered as the server first sends them. Every state but sent keeps what the person chose and
 * typed. The action is a stub here (its own tests are lib/marketplace-v2/privacy/actions.test.ts), and so is the icon
 * (the registry is #423's): these cases read the form's words, fields and roles.
 */

vi.mock("@/lib/marketplace-v2/privacy/actions", () => ({ submitPrivacyRequestAction: vi.fn() }))
vi.mock("@logloads/ui/icons", () => ({
  Icon: ({ name }: { name: string }) => React.createElement("svg", { "aria-hidden": true, "data-icon": name })
}))

import type { MarketplacePrivacyRequestReceipt } from "@logloads/contracts"

import { PrivacyRequestForm, type PrivacyRequestFormProps } from "@/components/v2/privacy/PrivacyRequestForm"
import type { PrivacyRequestView } from "@/components/v2/privacy/privacy-request-view"

const SUBMISSION = "0f2a4b6c-8d0e-4f1a-9b2c-3d4e5f6a7b8c"
const HOME = { href: "/v2/work", label: "Find work" }
const WORDS = "Please delete the old phone number on my account."
const UNAVAILABLE =
  "Requests in the app aren't connected yet, so nothing was sent. Instead, email support@logloads.com from the address on your account, and we'll answer within 45 days."

function receipt(overrides: Partial<MarketplacePrivacyRequestReceipt> = {}): MarketplacePrivacyRequestReceipt {
  return {
    dueAt: "2027-01-02T16:05:00.000Z",
    dueOn: "2027-01-02",
    identityVerified: true,
    kind: "deletion",
    receivedAt: "2026-11-18T16:05:00.000Z",
    refusal: null,
    requestId: "11111111-1111-4111-8111-111111111111",
    status: "in_progress",
    ...overrides
  }
}

function render(initial?: PrivacyRequestView, props: Partial<PrivacyRequestFormProps> = {}): string {
  return renderToStaticMarkup(<PrivacyRequestForm accountEmail="sam@example.com" available home={HOME} initial={initial} submissionId={SUBMISSION} {...props} />)
}

const decode = (html: string) =>
  html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
const textOf = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
const attr = (tag: string, name: string) => {
  const found = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)
  return found ? decode(found[1] ?? "") : null
}

/** The first element whose opening tag matches `opening`, with everything inside it (same-name tags balanced). */
function element(html: string, opening: RegExp): string | null {
  const start = html.search(opening)
  if (start < 0) return null

  const name = /^<([a-z0-9]+)/i.exec(html.slice(start))?.[1] ?? "div"
  const tags = new RegExp(`<(/?)${name}\\b[^>]*>`, "gi")
  tags.lastIndex = start
  let depth = 0

  for (let found = tags.exec(html); found; found = tags.exec(html)) {
    depth += found[1] ? -1 : 1
    if (depth === 0) return html.slice(start, found.index + found[0].length)
  }

  return null
}

const radios = (html: string) => [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((match) => match[0])
const checkedKind = (html: string) => {
  const radio = radios(html).find((tag) => /\schecked=""/.test(tag))
  return radio ? attr(radio, "value") : null
}
const detailsText = (html: string) => {
  const found = /<textarea[^>]*>([\s\S]*?)<\/textarea>/.exec(html)
  return found ? decode(found[1] ?? "") : null
}
const byRole = (html: string, role: string) => element(html, new RegExp(`<[a-z]+[^>]*\\srole="${role}"`))

describe("PrivacyRequestForm (#424)", () => {
  it("idle (362:5445): four choices, none chosen, the optional details, the identity line, the support address and the two actions", () => {
    const html = render()

    expect(textOf(element(html, /<legend/) ?? "")).toBe("What do you want us to do?")
    expect(radios(html).map((radio) => attr(radio, "value"))).toEqual(["access", "export", "correction", "deletion"])
    expect(radios(html).every((radio) => /\srequired=""/.test(radio))).toBe(true)
    expect(checkedKind(html)).toBeNull()
    expect(textOf(element(html, /<label[^>]*for="privacy-request-details"/) ?? "")).toBe("Details (optional)")
    expect(detailsText(html)).toBe("")
    expect(textOf(html)).toContain("You're signed in as sam@example.com, so we know this request is yours. We answer within 45 days.")
    expect(textOf(html)).toContain("You can also write to support@logloads.com .")
    expect(html).toContain('<a href="mailto:support@logloads.com">support@logloads.com</a>')
    expect(textOf(element(html, /<button[^>]*type="submit"/) ?? "")).toBe("Send request")
    expect(textOf(element(html, new RegExp(`<a[^>]*href="${HOME.href}"`)) ?? "")).toBe("Cancel")
    expect(attr(/<input[^>]*name="submissionId"[^>]*>/.exec(html)?.[0] ?? "", "value")).toBe(SUBMISSION)
    expect(byRole(html, "alert")).toBeNull()
  })

  it("posts only the kind, the details and its own id: no address, no person, and no action URL", () => {
    const html = render()
    const names = [...html.matchAll(/\sname="([^"]+)"/g)].map((match) => match[1])

    expect([...new Set(names)].sort()).toEqual(["details", "kind", "submissionId"])
    expect(html).not.toMatch(/<form[^>]*\saction=/)
  })

  it("nothing chosen (362:5995): the error summary in the frames' words, focusable, tied to the choices, and the typed details stay", () => {
    const html = render({ issues: [{ field: "kind", message: "Choose one request so we know what to do." }], status: "invalid" }, { values: { details: WORDS, kind: "" } })
    const summary = byRole(html, "alert") ?? ""
    const summaryId = attr(summary, "id")

    expect(textOf(summary)).toBe("Choose one request so we know what to do. What you typed is kept.")
    expect(attr(summary, "tabindex")).toBe("-1")
    expect(attr(summary, "data-tone")).toBe("critical")
    expect(summary).toContain('data-icon="status.warning"')
    expect(summaryId).toBeTruthy()
    for (const radio of radios(html)) {
      expect(attr(radio, "aria-describedby")?.split(" ")).toContain(summaryId)
      expect(attr(radio, "aria-invalid")).toBe("true")
    }
    expect(detailsText(html)).toBe(WORDS)
  })

  it("details the contract refuses: the summary and the field both say why, and the choice and words stay", () => {
    const message = "Say what is wrong and what it should say, in at least 10 characters."
    const html = render({ issues: [{ field: "details", message }], status: "invalid" }, { values: { details: "Wrong", kind: "correction" } })

    expect(textOf(byRole(html, "alert") ?? "")).toBe(`${message} What you typed is kept.`)
    expect(textOf(element(html, /<span[^>]*id="privacy-request-details-error"/) ?? "")).toBe(message)
    expect(attr(/<textarea[^>]*>/.exec(html)?.[0] ?? "", "aria-invalid")).toBe("true")
    expect(radios(html).some((radio) => attr(radio, "aria-invalid") === "true")).toBe(false)
    expect(checkedKind(html)).toBe("correction")
    expect(detailsText(html)).toBe("Wrong")
  })

  it("sent (362:6527): the receipt's request, sent day and due date, and the way back; no form", () => {
    const html = render({ alreadyOpen: false, receipt: receipt(), status: "sent" })
    const facts = [...html.matchAll(/<dt>([^<]*)<\/dt><dd>([^<]*)<\/dd>/g)].map((match) => [match[1], match[2]])
    const status = byRole(html, "status") ?? ""

    expect(textOf(status)).toBe("Request sent You were signed in, so we know it is yours. We answer within 45 days, by Jan 2, 2027.")
    expect(status).toContain('data-icon="status.confirmed"')
    expect(attr(status, "tabindex")).toBe("-1")
    expect(facts).toEqual([
      ["Request", "Delete my information"],
      ["Sent", "Nov 18, 2026"],
      ["Answer due", "By Jan 2, 2027"]
    ])
    expect(textOf(element(html, new RegExp(`<a[^>]*href="${HOME.href}"`)) ?? "")).toBe("Back to Find work")
    expect(html).not.toContain("<form")
    expect(textOf(html)).not.toMatch(/we emailed|open that email/i)
  })

  it("already open: the open request of the same kind with its own dates, and no claim of a new one", () => {
    const text = textOf(render({ alreadyOpen: true, receipt: receipt({ dueOn: "2026-12-17", kind: "export", receivedAt: "2026-11-02T09:00:00.000Z" }), status: "sent" }))

    expect(text).toContain("You already asked for this")
    expect(text).toContain('Your request from Nov 2, 2026, "Get a copy to download", is still open, so we didn\'t start a second one. We answer it by Dec 17, 2026.')
    expect(text).toContain("Answer due By Dec 17, 2026")
    expect(text).not.toContain("Request sent")
  })

  it("unavailable (no store yet): the form says so before anything is typed", () => {
    const note = byRole(render(undefined, { available: false }), "note") ?? ""

    expect(textOf(note)).toBe(
      "Requests in the app aren't connected yet, so this form can't send one. Email support@logloads.com from the address on your account instead, and we'll answer within 45 days."
    )
    expect(note).toContain('<a href="mailto:support@logloads.com">support@logloads.com</a>')
  })

  it("unavailable after a send: nothing was sent, the email address instead, and the choice and words stay", () => {
    const html = render({ details: WORDS, kind: "deletion", message: UNAVAILABLE, status: "unavailable" }, { available: false })
    const notice = byRole(html, "status") ?? ""

    expect(attr(notice, "data-tone")).toBe("info")
    expect(textOf(notice)).toBe(`${UNAVAILABLE} Your choice and details are still here, so you can copy them into your email.`)
    expect(notice).toContain('<a href="mailto:support@logloads.com">support@logloads.com</a>')
    expect(byRole(html, "note")).toBeNull()
    expect(checkedKind(html)).toBe("deletion")
    expect(detailsText(html)).toBe(WORDS)
    expect(textOf(html)).not.toMatch(/request sent|we received/i)
  })

  it("error: the action's words, and the choice and words stay", () => {
    const message = "You've tried this too many times in a short while. Wait a few minutes, then try again."
    const html = render({ details: WORDS, kind: "access", message, status: "error" })

    expect(textOf(byRole(html, "alert") ?? "")).toBe(`${message} Your choice and details are still here.`)
    expect(checkedKind(html)).toBe("access")
    expect(detailsText(html)).toBe(WORDS)
  })

  it("offline (362:7013): the Offline banner with Retry, and the choice and words stay", () => {
    const html = render({ queued: true, status: "offline" }, { values: { details: WORDS, kind: "deletion" } })
    const banner = byRole(html, "status") ?? ""

    expect(textOf(banner)).toBe("You're offline. Your request goes once the signal is back, and your choice and details stay here. Retry")
    expect(banner).toContain('data-icon="status.offline"')
    expect(banner).toMatch(/<button[^>]*type="button"[^>]*>/)
    expect(checkedKind(html)).toBe("deletion")
    expect(detailsText(html)).toBe(WORDS)
  })

  it("a send that got no answer: plain words, and the choice and words stay", () => {
    const html = render({ status: "unreachable" }, { values: { details: WORDS, kind: "export" } })

    expect(textOf(byRole(html, "alert") ?? "")).toBe("We couldn't reach LogLoads. Your choice and details are still here, so you can send again.")
    expect(checkedKind(html)).toBe("export")
    expect(detailsText(html)).toBe(WORDS)
  })

  it("puts the account address in no link, and shows it only in the identity line", () => {
    const html = render()

    for (const link of html.matchAll(/<a[^>]*href="([^"]*)"/g)) expect(link[1]).not.toMatch(/sam@example\.com|\?/)
    expect(textOf(html).split("sam@example.com")).toHaveLength(2)
  })
})
