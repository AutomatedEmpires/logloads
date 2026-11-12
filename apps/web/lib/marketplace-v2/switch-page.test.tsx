import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * `/v2/switch` on the normalized store (#213), rendered on the server as a first visit receives it. Only the edges
 * are stubbed: the request's session identity (`@/lib/session`) and the normalized store's answer
 * (`normalizedSessionStore`). The page, `resolveV2Actor`, the V2 session (`v2-session.ts`) and the switcher choices
 * are the real ones, with the real adapter selection (`LOGLOADS_MARKETPLACE_V2_ADAPTER=normalized`).
 */

const mocks = vi.hoisted(() => ({
  getClerkUserId: vi.fn(),
  getSessionActor: vi.fn(),
  getSessionIdentity: vi.fn(),
  hasSessionIdentity: vi.fn(),
  resolve: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`)
  }
}))
vi.mock("@/lib/session", () => ({
  getClerkUserId: mocks.getClerkUserId,
  getSessionActor: mocks.getSessionActor,
  getSessionIdentity: mocks.getSessionIdentity,
  hasSessionIdentity: mocks.hasSessionIdentity
}))
vi.mock("@/lib/marketplace-v2/adapter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./adapter")>()),
  normalizedSessionStore: () => ({ canLink: true, resolve: mocks.resolve })
}))
vi.mock("@/lib/marketplace-v2/switch-actions", () => ({ switchV2BusinessAction: async () => undefined }))

import SwitchBusinessPage from "@/app/v2/switch/page"

const CLERK_ID = "user_test_switch_subject"
const PERSON_ID = "abababab-abab-4bab-8bab-abababababab"
const LANDING_ORG = "22222222-aaaa-4aaa-8aaa-222222222222"
const HAULER_ORG = "33333333-bbbb-4bbb-8bbb-333333333333"
const NEW_ORG = "44444444-cccc-4ccc-8ccc-444444444444"

const landing = {
  capabilities: ["job.publish", "landing.manage", "inquiry.respond"],
  haulerProfile: false,
  organizationId: LANDING_ORG,
  organizationName: "Normalized Landing Co",
  role: "owner"
}
const hauler = {
  capabilities: ["interest.express", "interest.withdraw", "interest.reply"],
  haulerProfile: true,
  organizationId: HAULER_ORG,
  organizationName: "Normalized Hauling LLC",
  role: "driver"
}

function signedIn(requestedOrganizationId: string | null) {
  mocks.getSessionIdentity.mockResolvedValue({
    clerkUserId: CLERK_ID,
    cookieUserId: null,
    hints: async () => ({ fullName: "Nora Normal", verifiedEmail: null }),
    requestedOrganizationId,
    // The selection is this person's own: the V2 switch signs it with their person id (#246).
    selectionUserId: requestedOrganizationId ? PERSON_ID : null,
    source: "clerk"
  })
  mocks.hasSessionIdentity.mockResolvedValue(true)
}

function store(memberships: unknown[]) {
  mocks.resolve.mockResolvedValue({ memberships, person: { displayName: "Nora Normal", email: null, id: PERSON_ID } })
}

async function render(query: Record<string, string> = {}) {
  return renderToStaticMarkup(await SwitchBusinessPage({ searchParams: Promise.resolve(query) }))
}

const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()

/** The `<form>…</form>` that contains `marker`. */
function formAround(html: string, marker: string): string {
  return [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map((match) => match[0]).find((form) => form.includes(marker)) ?? ""
}

function postsOrganization(form: string, organizationId: string): boolean {
  return (form.match(/<input[^>]*>/g) ?? []).some((tag) =>
    tag.includes('name="organizationId"') && tag.includes('type="hidden"') && tag.includes(`value="${organizationId}"`))
}

beforeEach(() => {
  vi.clearAllMocks()
  // The pages compile with the classic JSX runtime here (tsconfig "jsx": "preserve"), as in v2-pages.test.tsx.
  vi.stubGlobal("React", React)
  vi.stubEnv("LOGLOADS_MARKETPLACE_V2_ADAPTER", "normalized")
  vi.stubEnv("VERCEL_ENV", "preview")
  mocks.getClerkUserId.mockResolvedValue(CLERK_ID)
  mocks.getSessionActor.mockRejectedValue(new Error("the pilot session must not be read on the normalized store"))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("/v2/switch on the normalized store (#213)", () => {
  it("lists the person's memberships from the normalized store, marks the active one and offers the others", async () => {
    signedIn(HAULER_ORG)
    store([landing, hauler])

    const html = await render()
    const text = textOf(html)

    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ subject: CLERK_ID }))
    expect(mocks.getSessionActor).not.toHaveBeenCalled()
    expect(html).toContain('data-ds-page="switch-business"')
    expect(text).toContain("Normalized Landing Co Landing business · Owner")
    expect(text).toContain("Normalized Hauling LLC Hauling business · Driver")
    expect(text).toContain("Acting as this business")
    expect(postsOrganization(formAround(html, "Act as Normalized Landing Co"), LANDING_ORG)).toBe(true)
    // The active business has no switch form of its own.
    expect(formAround(html, "Act as Normalized Hauling LLC")).toBe("")
  })

  it("offers a business created a moment ago, which becomes the active one when it is the only one", async () => {
    signedIn(null)
    store([{ ...landing, organizationId: NEW_ORG, organizationName: "Brand New Logging" }])

    const text = textOf(await render())

    expect(text).toContain("Brand New Logging Landing business · Owner")
    expect(text).toContain("Acting as this business")
  })

  it("marks nothing active after the selected membership was removed, and offers only the remaining ones", async () => {
    signedIn(LANDING_ORG)
    store([hauler])

    const html = await render({ unavailable: "1" })
    const text = textOf(html)

    expect(text).not.toContain("Normalized Landing Co")
    expect(text).not.toContain("Acting as this business")
    expect(text).toContain("That business is not available to your account right now.")
    expect(postsOrganization(formAround(html, "Act as Normalized Hauling LLC"), HAULER_ORG)).toBe(true)
  })

  it("says plainly when the person has no business in the normalized store yet", async () => {
    signedIn(null)
    store([])

    const text = textOf(await render())

    expect(text).toContain("No business to act for yet")
    expect(text).not.toContain("Act as")
  })

  it("explains a sign-in the normalized store has not linked, instead of a sign-in loop", async () => {
    signedIn(null)
    mocks.resolve.mockResolvedValue(null)

    const text = textOf(await render())

    expect(text).toContain("Your sign-in is not linked to a LogLoads business yet.")
    expect(text).toContain("Browse public jobs")
  })
})
