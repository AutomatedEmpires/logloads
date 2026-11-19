import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * #424: `/v2/privacy-request` as the server renders it. It is noindex; a visitor is asked to sign in or email; a
 * signed-in person gets the form with a fresh form id, their own way back, and (while #415 has not built the store)
 * the notice that nothing can be sent in the app yet. The URL and the links carry nothing about the person.
 */

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  enabled: vi.fn(() => true),
  shell: vi.fn(),
  store: vi.fn<() => unknown>(() => null)
}))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  }
}))
vi.mock("@/lib/marketplace-v2/flag", () => ({ marketplaceV2Enabled: mocks.enabled }))
vi.mock("@/lib/marketplace-v2/v2-session", () => ({ getV2SessionActor: mocks.actor }))
vi.mock("@/lib/marketplace-v2/business-switcher", () => ({ resolveV2Shell: mocks.shell }))
vi.mock("@/lib/marketplace-v2/privacy", () => ({ privacyRequestStore: mocks.store }))
vi.mock("@/lib/marketplace-v2/privacy/actions", () => ({ submitPrivacyRequestAction: vi.fn() }))
vi.mock("@logloads/ui/icons", () => ({
  Icon: ({ name }: { name: string }) => React.createElement("svg", { "aria-hidden": true, "data-icon": name })
}))

import PrivacyRequestPage, { metadata } from "@/app/v2/privacy-request/page"

const PERSON = { activeOrganization: null, profile: { email: "sam@example.com", fullName: "Sam Carter", id: "55555555-dddd-4ddd-8ddd-555555555555" }, workspaceSelectionInvalid: false }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
const textOf = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
const submissionId = (html: string) => /<input[^>]*name="submissionId"[^>]*value="([^"]+)"/.exec(html)?.[1] ?? null
const cancelHref = (html: string) => /<a[^>]*href="([^"]+)"[^>]*>(?:<[^>]+>)*Cancel/.exec(html)?.[1] ?? null

async function render(): Promise<string> {
  return renderToStaticMarkup(await PrivacyRequestPage())
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.enabled.mockReturnValue(true)
  mocks.actor.mockResolvedValue(PERSON)
  mocks.shell.mockResolvedValue({ account: { kind: "signed-in", person: { email: "sam@example.com", name: "Sam Carter" } }, business: undefined, capabilities: ["interest.express"] })
  mocks.store.mockReturnValue(null)
})

describe("/v2/privacy-request (#424)", () => {
  it("is kept out of search engines", () => {
    expect(metadata.robots).toEqual({ follow: false, index: false })
    expect(metadata.title).toBe("Privacy request")
  })

  it("is not there while V2 is off", async () => {
    mocks.enabled.mockReturnValue(false)

    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND")
    expect(mocks.actor).not.toHaveBeenCalled()
  })

  it("draws the frames' header: the Settings / Account trail as words (V2 has neither screen yet), the title and the line under it", async () => {
    const html = await render()
    const trail = /<nav aria-label="Breadcrumb">([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? ""

    expect(textOf(trail)).toBe("Settings Account Privacy request")
    expect(trail).not.toContain("<a")
    expect(trail).toContain('aria-current="page"')
    expect(textOf(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "")).toBe("Privacy request")
    expect(textOf(html)).toContain("Ask to see, copy, correct or delete the personal information LogLoads holds about you.")
  })

  it("asks a visitor to sign in and back, or to email; there is no form", async () => {
    mocks.actor.mockResolvedValue(null)
    const html = await render()

    expect(textOf(html)).toContain("Sign in to make a privacy request")
    expect(textOf(html)).toContain("You can also email support@logloads.com from the address on your account, and we'll answer within 45 days.")
    expect(html).toContain('href="/sign-in?next=%2Fv2%2Fprivacy-request"')
    expect(html).not.toContain("<form")
  })

  it("gives a signed-in person the form, with their address in the identity line only", async () => {
    const html = await render()

    expect(html).toContain("<form")
    expect(textOf(html)).toContain("You're signed in as sam@example.com, so we know this request is yours.")
    for (const link of html.matchAll(/href="([^"]*)"/g)) expect(link[1]).not.toMatch(/sam@example\.com|\?/)
  })

  it("gives each visit its own form id, so a retried send makes one request and a new visit a new one", async () => {
    const first = submissionId(await render())
    const second = submissionId(await render())

    expect(first).toMatch(UUID)
    expect(second).toMatch(UUID)
    expect(second).not.toBe(first)
  })

  it("says nothing can be sent in the app while no store keeps requests, and nothing of the sort once one does", async () => {
    expect(textOf(await render())).toContain("Requests in the app aren't connected yet, so this form can't send one.")

    mocks.store.mockReturnValue({})
    expect(textOf(await render())).not.toContain("aren't connected yet")
  })

  it("leads Cancel to the person's own first destination: Find work for a hauler, Overview for a landing", async () => {
    expect(cancelHref(await render())).toBe("/v2/work")

    mocks.shell.mockResolvedValue({ account: { kind: "signed-in", person: null }, business: undefined, capabilities: ["job.publish", "inquiry.respond"] })
    expect(cancelHref(await render())).toBe("/v2/landing")

    mocks.shell.mockResolvedValue({ account: { kind: "signed-in", person: null }, business: undefined, capabilities: null })
    expect(cancelHref(await render())).toBe("/v2/work")
  })
})
