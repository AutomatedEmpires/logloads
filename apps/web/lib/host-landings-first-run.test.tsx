import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.stubGlobal("React", React)

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  getCockpitContext: vi.fn(),
  organizationRoleCan: vi.fn(() => true)
}))

vi.mock("@logloads/contracts", () => ({
  organizationRoleCan: mocks.organizationRoleCan
}))
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: mocks.cookieGet }))
}))
vi.mock("@/components/v3", () => ({ HostLandings: () => null }))
vi.mock("@/lib/host-data", () => ({
  getHostLandingRecords: vi.fn(() => []),
  getHostPublishingOptions: vi.fn(() => ({})),
  getHostWorkspaceSetup: vi.fn(() => ({}))
}))
vi.mock("@/lib/v3", () => ({
  getCockpitContext: mocks.getCockpitContext,
  shellAccountFor: vi.fn(() => ({ userName: "Host" }))
}))

import Page from "@/app/host/landings/page"
import { createFirstRunHandoffCookie } from "./entry-routing"

async function pageProps(
  searchParams: Record<string, string | string[] | undefined>
): Promise<Record<string, unknown>> {
  const element = await Page({ searchParams: Promise.resolve(searchParams) })

  return element.props as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCockpitContext.mockResolvedValue({
    actor: {
      activeMembership: { role: "owner" },
      profile: { id: "actor-1" }
    },
    network: {
      activeOrganization: { id: "host-1", name: "Summit Ridge Timber" }
    }
  })
  mocks.organizationRoleCan.mockReturnValue(true)
})

describe("Host Landings first-run routing", () => {
  it("uses only the first duplicate welcome value before reading the handoff cookie", async () => {
    mocks.cookieGet.mockReturnValue({
      value: createFirstRunHandoffCookie(
        "host",
        "/host/command?from=public",
        "invited",
        "actor-1"
      )
    })

    expect(await pageProps({ welcome: ["1", "0"] })).toMatchObject({
      continuation: "/host/command",
      welcome: true,
      welcomeSource: "invited"
    })
    expect(mocks.cookieGet).toHaveBeenCalledWith("ll_first_run_host")

    mocks.cookieGet.mockClear()

    expect(await pageProps({ welcome: ["0", "1"] })).toMatchObject({
      continuation: undefined,
      welcome: false,
      welcomeSource: undefined
    })
    expect(mocks.cookieGet).not.toHaveBeenCalled()
  })
})
