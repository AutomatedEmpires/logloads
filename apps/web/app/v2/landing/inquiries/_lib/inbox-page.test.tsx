import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Flow C (#328) on the landing inbox, rendered on the server as a first visit (or a visit without JavaScript)
 * receives it, with the port, the session and the actions stubbed (as lib/marketplace-v2/v2-pages.test.tsx does).
 */

const mocks = vi.hoisted(() => ({
  getJob: vi.fn(),
  landingInquiryJobs: vi.fn(),
  listLandingInterests: vi.fn(),
  loadInquiryPhone: vi.fn(),
  resolveV2Actor: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`)
  }
}))
vi.mock("@/lib/marketplace-v2/flag", () => ({ marketplaceV2Enabled: () => true }))
vi.mock("@/lib/session", () => ({ getSessionActor: vi.fn() }))
vi.mock("@/lib/marketplace-v2/viewer", () => ({
  resolveV2Actor: mocks.resolveV2Actor,
  withBusinessSwitchNote: (refusal: string) => refusal
}))
vi.mock("@/lib/marketplace-v2/actions", () => ({ respondToInterestAction: async () => undefined, sendHeldAnswerAction: async () => ({ ok: true }) }))
vi.mock("@/lib/marketplace-v2/disclosure/load", () => ({ loadInquiryPhone: mocks.loadInquiryPhone }))
vi.mock("@/app/v2/landing/inquiries/actions", () => ({ hidePhoneAction: async () => undefined, sharePhoneAction: async () => undefined }))
vi.mock("@/lib/marketplace-v2/pilot-adapter", () => ({
  pilotMarketplaceV2: {
    getJob: mocks.getJob,
    landingInquiryJobs: mocks.landingInquiryJobs,
    listLandingInterests: mocks.listLandingInterests
  }
}))

import type { MarketplaceInterestView } from "@logloads/contracts"

import LandingInboxPage from "@/app/v2/landing/inquiries/page"

const LANDING_ORG = "22222222-aaaa-4aaa-8aaa-222222222222"
const HAULER_ORG = "33333333-bbbb-4bbb-8bbb-333333333333"
const USER_ID = "55555555-dddd-4ddd-8ddd-555555555555"
const JOB_ID = "11111111-1111-4111-8111-111111111111"
const FIRST = "44444444-cccc-4ccc-8ccc-444444444444"
const SECOND = "66666666-eeee-4eee-8eee-666666666666"
const STRANGER = "99999999-9999-4999-8999-999999999999"

function interest(overrides: Partial<MarketplaceInterestView> = {}): MarketplaceInterestView {
  return {
    availableFrom: "2099-11-16",
    availableUntil: null,
    contactPreference: "in_app",
    createdAt: "2026-11-01T12:00:00.000Z",
    equipment: [{ configurationKey: "log_truck|pole_trailer", count: 1, label: "Log truck + Pole trailer" }],
    haulerOrganization: { id: HAULER_ORG, name: "Granite Creek Hauling", type: "hauler" },
    id: FIRST,
    job: { acceptingInterest: true, id: JOB_ID, slug: JOB_ID, status: "active", title: "Oak saw logs to Cascade Mill" },
    landingOrganization: { id: LANDING_ORG, name: "Oak Landing" },
    message: "Can run 3 loads a day. Have my own binders.",
    replies: [],
    status: "submitted",
    submittedBy: { name: "Sam Carter", userId: USER_ID },
    trucksOffered: 1,
    updatedAt: "2026-11-01T12:00:00.000Z",
    ...overrides
  }
}

function actor(memberships: unknown[] = []) {
  return { activeOrganization: { id: LANDING_ORG }, memberships, profile: { id: USER_ID }, workspaceSelectionInvalid: false }
}

async function render(query: Record<string, string> = {}) {
  return renderToStaticMarkup(await LandingInboxPage({ searchParams: Promise.resolve(query) }))
}

const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
const forms = (html: string) => [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map((match) => match[0])
const hiddenValue = (form: string, name: string) =>
  (form.match(/<input[^>]*>/g) ?? []).find((tag) => tag.includes(`name="${name}"`) && tag.includes('type="hidden"'))?.match(/value="([^"]*)"/)?.[1] ?? null

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("React", React)
  mocks.resolveV2Actor.mockResolvedValue({ actor: actor(), ok: true })
  mocks.listLandingInterests.mockResolvedValue([interest()])
  mocks.landingInquiryJobs.mockResolvedValue([])
  mocks.getJob.mockResolvedValue({ id: JOB_ID, pay: { amountCents: 47_500, note: null, unit: "per_load" } })
  // The pilot store: no reveal, so no number is offered and ready reply 1 stops at the yes.
  mocks.loadInquiryPhone.mockResolvedValue({ kind: "unavailable" })
})

const disclosure = (overrides: Record<string, unknown> = {}) => ({
  kind: "ready",
  disclosure: { interestId: FIRST, phone: "+15415550188", shared: false, sharedAt: null, status: "replied", ...overrides }
})

describe("flow C on the landing inbox (#328)", () => {
  it("offers two ready replies that post decision=replied, each with its own server reply id", async () => {
    const html = await render({ inquiry: FIRST })
    const ready = forms(html).filter((form) => hiddenValue(form, "decision") === "replied" && !form.includes("textarea"))

    expect(textOf(html)).toContain("Reply in one tap")
    expect(ready.map((form) => hiddenValue(form, "body"))).toEqual(["Yes, we can use you.", "Yes. Be here Mon, Nov 16."])
    for (const form of ready) expect(hiddenValue(form, "interestId")).toBe(FIRST)
    const ids = ready.map((form) => hiddenValue(form, "replyId"))
    expect(ids.every((id) => /^[0-9a-f-]{36}$/.test(id ?? ""))).toBe(true)
    expect(new Set(ids).size).toBe(2)
    // A one-tap answer never declines: the decline is confirmed first, and no form posts it from the page.
    expect(forms(html).some((form) => hiddenValue(form, "decision") === "declined")).toBe(false)
    // The typed reply is still there, beside Decline.
    expect(html).toContain('aria-label="Reply to Granite Creek Hauling"')
    expect(html).toMatch(/<a[^>]*aria-haspopup="dialog"[^>]*>/)
  })

  it("shows the job card with the stated pay, and what they can bring", async () => {
    const text = textOf(await render({ inquiry: FIRST }))

    expect(text).toContain("$475.00 per load Oak saw logs to Cascade Mill")
    expect(text).toContain("They can bring Offers 1 truck Self-reported by the hauler; not verified")
    expect(mocks.getJob).toHaveBeenCalledWith(JOB_ID, { organizationId: LANDING_ORG, userId: USER_ID })
  })

  it("keeps the job card's title when the pay cannot be read", async () => {
    mocks.getJob.mockRejectedValueOnce(new Error("unavailable"))
    const text = textOf(await render({ inquiry: FIRST }))

    expect(text).toContain("Oak saw logs to Cascade Mill")
    expect(text).not.toContain("per load")
  })

  it("says the reply went once the server recorded it, for that inquiry only", async () => {
    expect(textOf(await render({ inquiry: FIRST, updated: "replied" }))).toContain("Reply sent to Granite Creek Hauling.")
    expect(textOf(await render({ updated: "replied" }))).not.toContain("Reply sent to")
  })

  it("shows permission denied for another business's inquiry, and names nothing of it (C-denied)", async () => {
    for (const query of [{ inquiry: STRANGER }, { inquiry: "not-an-id" }]) {
      const html = await render(query)
      const text = textOf(html)

      expect(text).toContain("You can’t open this inquiry")
      expect(text).toContain("Only that business’s owner, managers and staff can read it and reply.")
      expect(html).not.toContain('id="conversation"')
      expect(html).not.toContain("Reply to Granite Creek Hauling")
      expect(html).toContain('href="/v2/landing"')
      expect(html).not.toContain('href="/v2/switch"')
    }

    // Someone with another business is offered the switch.
    mocks.resolveV2Actor.mockResolvedValue({ actor: actor([{}, {}]), ok: true })
    expect(await render({ inquiry: STRANGER })).toContain('href="/v2/switch"')
  })

  it("opens the inquiry the link names, not the first row or permission denied, whatever the case of its id", async () => {
    // Two new inquiries: the link names the second, in capitals. Opening the first instead would put its one-tap
    // replies under the wrong hauler (review of PR 401, finding 5).
    mocks.listLandingInterests.mockResolvedValue([
      interest(),
      interest({ haulerOrganization: { id: HAULER_ORG, name: "Cedar Flat Trucking", type: "hauler" }, id: SECOND })
    ])
    const html = await render({ inquiry: SECOND.toUpperCase(), updated: "replied" })
    const text = textOf(html)
    const ready = forms(html).filter((form) => hiddenValue(form, "decision") === "replied" && !form.includes("textarea"))

    expect(text).not.toContain("You can’t open this inquiry")
    expect(html).toContain('aria-label="Reply to Cedar Flat Trucking"')
    expect(html).not.toContain('aria-label="Reply to Granite Creek Hauling"')
    for (const form of ready) expect(hiddenValue(form, "interestId")).toBe(SECOND)
    // The server's confirmation is for the named inquiry, whatever the case of its id.
    expect(text).toContain("Reply sent to Cedar Flat Trucking.")
  })
})

describe("flow C held answers on the landing inbox (#411)", () => {
  it("puts the inbox's waiting-to-send list above the inquiries, with a status line that is always there", async () => {
    const html = await render({ inquiry: FIRST })
    const inbox = html.match(/<div[^>]*data-held-inbox=""[^>]*>[\s\S]*?<\/div>/)?.[0] ?? ""

    expect(inbox).not.toBe("")
    expect(inbox).toMatch(/<p[^>]*role="status"[^>]*><\/p>/)
    expect(html.indexOf("data-held-inbox")).toBeLessThan(html.indexOf('aria-label="New inquiries"'))
  })

  it("never says an answer was sent before the server recorded it", async () => {
    // The first render has nothing held: the bar offers the replies, and no card claims a send.
    const text = textOf(await render({ inquiry: FIRST }))

    expect(text).toContain("Reply in one tap")
    expect(text).not.toContain("Reply sent")
    expect(text).not.toContain("Declined")
  })

  it("has no held-answer list for someone the inbox refuses", async () => {
    mocks.listLandingInterests.mockRejectedValue(new Error("Your role cannot act on inquiries for this business"))

    expect(await render()).not.toContain("data-held-inbox")
  })
})

describe("flow C, C4 and C5: Show my number on the landing inbox (#403)", () => {
  it("offers the number after a reply, posting only the inquiry id (C4)", async () => {
    mocks.listLandingInterests.mockResolvedValue([interest({ status: "replied" })])
    mocks.loadInquiryPhone.mockResolvedValue(disclosure())
    const html = await render({ inquiry: FIRST })
    const text = textOf(html)

    expect(mocks.loadInquiryPhone).toHaveBeenCalledWith(LANDING_ORG, FIRST)
    expect(text).toContain("Let them see your phone number?")
    expect(text).toContain("(541) 555-0188")
    expect(text).toContain("Only Granite Creek Hauling sees it. It is never public.")
    const show = forms(html).find((form) => form.includes("Show my number"))
    expect(show).toBeDefined()
    expect(hiddenValue(show!, "interestId")).toBe(FIRST)
    expect(show).not.toContain("5415550188")
    expect(html).toContain(`href="/v2/landing/inquiries?inquiry=${FIRST}&amp;phone=later`)
  })

  it("says the number is showing, with Hide my number (C5)", async () => {
    mocks.listLandingInterests.mockResolvedValue([interest({ status: "replied" })])
    mocks.loadInquiryPhone.mockResolvedValue(disclosure({ shared: true, sharedAt: "2026-11-18T22:00:00.000Z" }))
    const html = await render({ inquiry: FIRST, updated: "phone_shared" })
    const text = textOf(html)

    expect(text).toContain("Your number is showing")
    expect(text).toContain("Granite Creek Hauling can call or text (541) 555-0188")
    expect(forms(html).some((form) => form.includes("Hide my number") && hiddenValue(form, "interestId") === FIRST)).toBe(true)
    expect(text).toContain("Back to inquiries")
    expect(text).not.toContain("Let them see your phone number?")
  })

  it("says only that the number was not shared, and leaves out the offer after Not now", async () => {
    mocks.listLandingInterests.mockResolvedValue([interest({ status: "replied" })])
    mocks.loadInquiryPhone.mockResolvedValue(disclosure())

    const notShared = await render({ inquiry: FIRST, updated: "phone_not_shared" })
    expect(notShared).toMatch(/<p[^>]*role="status"[^>]*>Your number was not shared\.<\/p>/)
    expect(textOf(notShared)).not.toMatch(/paused|under review|on hold|reveal/i)

    expect(textOf(await render({ inquiry: FIRST, phone: "later" }))).not.toContain("Let them see your phone number?")
  })

  it("offers no number before a reply, and restores the frame's \"Call me.\" once it can be shown", async () => {
    mocks.loadInquiryPhone.mockResolvedValue(disclosure({ status: "submitted" }))
    const html = await render({ inquiry: FIRST })
    const ready = forms(html).filter((form) => hiddenValue(form, "decision") === "replied" && !form.includes("textarea"))

    expect(textOf(html)).not.toContain("Let them see your phone number?")
    expect(ready.map((form) => hiddenValue(form, "body"))).toEqual(["Yes, we can use you. Call me.", "Yes. Be here Mon, Nov 16."])
  })

  it("offers no number on the pilot store, and ready reply 1 stops at the yes", async () => {
    mocks.listLandingInterests.mockResolvedValue([interest({ status: "replied" })])
    const html = await render({ inquiry: FIRST })

    expect(textOf(html)).not.toContain("Let them see your phone number?")
    expect(textOf(html)).not.toContain("Your number is showing")
  })
})
