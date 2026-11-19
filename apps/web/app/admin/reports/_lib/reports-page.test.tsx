import React, { type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * #403 (review of PR 416): who reaches the phone-reveal pauses on the moderation screen. A pilot platform admin gets
 * the whole screen. Staff the pilot session does not know, but the normalized database lets read the pauses, get the
 * pause section on its own. Anyone the database refuses meets the screen's usual pilot-admin check.
 */

const mocks = vi.hoisted(() => ({
  getAdminReports: vi.fn(),
  getAdminShellAccount: vi.fn(),
  getSessionActor: vi.fn(),
  loadRevealPauses: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/session", () => ({ getSessionActor: mocks.getSessionActor }))
vi.mock("@/lib/admin-data", () => ({ getAdminReports: mocks.getAdminReports, getAdminShellAccount: mocks.getAdminShellAccount }))
vi.mock("@/lib/marketplace-v2/disclosure/load", () => ({ loadRevealPauses: mocks.loadRevealPauses }))
vi.mock("@/components/v3", () => ({
  AdminReportsPage: ({ children }: { children?: ReactNode }) => <div data-testid="admin-shell">{children}</div>
}))
vi.mock("../actions", () => ({ clearRevealPauseAction: async () => undefined }))

import Page from "../page"

const PAUSE = {
  id: "44444444-4444-4444-8444-444444444444",
  landingsInWindow: 5,
  openedAt: "2026-11-18T21:05:00.000Z",
  reportId: "55555555-5555-4555-8555-555555555555",
  reportStatus: "open" as const,
  subjectId: "11111111-1111-4111-8111-111111111111",
  subjectKind: "organization" as const,
  subjectName: "Granite Creek Hauling"
}

async function render(query: Record<string, string> = {}) {
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(query) }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("React", React)
  mocks.getAdminShellAccount.mockResolvedValue({})
  mocks.getAdminReports.mockResolvedValue({ inquiries: [], requests: [], systemFlags: [] })
})

describe("the moderation screen's reveal pauses (#403)", () => {
  it("gives a pilot platform admin the whole screen, with the pauses inside it", async () => {
    mocks.getSessionActor.mockResolvedValue({ isPlatformAdmin: true })
    mocks.loadRevealPauses.mockResolvedValue({ kind: "ready", pauses: [PAUSE] })
    const html = await render()

    expect(html).toContain('data-testid="admin-shell"')
    expect(html).toContain("Granite Creek Hauling")
    expect(mocks.getAdminReports).toHaveBeenCalled()
  })

  it("gives normalized staff the pauses on their own, without the pilot cockpit's queues", async () => {
    mocks.getSessionActor.mockResolvedValue(null)
    mocks.loadRevealPauses.mockResolvedValue({ kind: "ready", pauses: [PAUSE] })
    const html = await render({ pause: "cleared" })

    expect(html).not.toContain('data-testid="admin-shell"')
    expect(html).toContain("Moderation")
    expect(html).toContain("Granite Creek Hauling")
    expect(html).toContain("Pause cleared.")
    expect(mocks.getAdminReports).not.toHaveBeenCalled()
    expect(mocks.getAdminShellAccount).not.toHaveBeenCalled()
  })

  it("sends anyone the database refuses, or anyone on the pilot store, to the usual pilot-admin check", async () => {
    mocks.getSessionActor.mockResolvedValue({ isPlatformAdmin: false })
    mocks.getAdminShellAccount.mockRejectedValue(new Error("NEXT_REDIRECT /"))

    for (const result of [{ kind: "denied" }, { kind: "unavailable" }]) {
      mocks.loadRevealPauses.mockResolvedValueOnce(result)
      await expect(render()).rejects.toThrow("NEXT_REDIRECT")
    }
  })

  it("keeps the screen up when the V2 store cannot be read", async () => {
    mocks.getSessionActor.mockResolvedValue({ isPlatformAdmin: true })
    mocks.loadRevealPauses.mockRejectedValue(new Error("misconfigured"))

    expect(await render()).toContain("The pauses couldn")
  })
})
