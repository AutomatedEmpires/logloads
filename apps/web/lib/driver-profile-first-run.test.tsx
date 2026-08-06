import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.stubGlobal("React", React)

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  getCockpitContext: vi.fn()
}))

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: mocks.cookieGet }))
}))
vi.mock("@/components/v3", () => ({ DriverProfile: () => null }))
vi.mock("@/lib/credential-data", () => ({
  getDriverCredentialVaultView: vi.fn()
}))
vi.mock("@/lib/driver-data", () => ({
  getDriverAvailability: vi.fn(() => [])
}))
vi.mock("@/lib/media-config", () => ({
  isDedicatedMediaConfigured: vi.fn(() => true)
}))
vi.mock("@/lib/v3", () => ({
  getCockpitContext: mocks.getCockpitContext,
  shellAccountFor: vi.fn(() => ({ userName: "Driver" }))
}))
vi.mock("@/lib/verification-data", () => ({
  listSubjectVerifications: vi.fn(() => [])
}))

import Page from "@/app/driver/profile/page"
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
      driverProfileId: null,
      profile: { id: "actor-1" }
    },
    network: {}
  })
})

describe("Driver Profile first-run routing", () => {
  it("uses only the first duplicate welcome value before reading the handoff cookie", async () => {
    mocks.cookieGet.mockReturnValue({
      value: createFirstRunHandoffCookie(
        "driver",
        "/driver/loads?from=public",
        "created",
        "actor-1"
      )
    })

    expect(await pageProps({ welcome: ["1", "0"] })).toMatchObject({
      continuationHref: "/driver/loads",
      welcome: true
    })
    expect(mocks.cookieGet).toHaveBeenCalledWith("ll_first_run_driver")

    mocks.cookieGet.mockClear()

    expect(await pageProps({ welcome: ["0", "1"] })).toMatchObject({
      continuationHref: null,
      welcome: false
    })
    expect(mocks.cookieGet).not.toHaveBeenCalled()
  })
})
