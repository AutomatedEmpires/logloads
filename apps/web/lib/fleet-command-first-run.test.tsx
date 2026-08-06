import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.stubGlobal("React", React)

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  getDriverCredentialVaultView: vi.fn(),
  getFleetCockpitData: vi.fn(),
  getSessionActor: vi.fn(),
  organizationRoleCan: vi.fn()
}))

vi.mock("@logloads/contracts", () => ({
  organizationRoleCan: mocks.organizationRoleCan
}))
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: mocks.cookieGet }))
}))
vi.mock("@/components/v3", () => ({ FleetCommand: () => null }))
vi.mock("@/lib/credential-data", () => ({
  getDriverCredentialVaultView: mocks.getDriverCredentialVaultView
}))
vi.mock("@/lib/fleet-data", () => ({
  getFleetCockpitData: mocks.getFleetCockpitData
}))
vi.mock("@/lib/session", () => ({ getSessionActor: mocks.getSessionActor }))

import Page from "@/app/fleet/command/page"
import { createFirstRunHandoffCookie } from "./entry-routing"

function cockpitData() {
  return {
    account: { userName: "Fleet Owner" },
    actorUserId: "actor-1",
    dispatchPlan: [],
    network: {
      activeOrganization: {
        id: "fleet-1",
        name: "North Ridge Timber",
        verificationStatus: "pending"
      },
      trucks: []
    }
  }
}

async function pageProps(
  searchParams: Record<string, string | string[] | undefined>
): Promise<Record<string, unknown>> {
  const element = await Page({ searchParams: Promise.resolve(searchParams) })

  return element.props as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getFleetCockpitData.mockResolvedValue(cockpitData())
})

describe("Fleet Command first-run routing", () => {
  it("reads a path-only Fleet continuation from the HttpOnly handoff cookie", async () => {
    mocks.cookieGet.mockReturnValue({
      value: createFirstRunHandoffCookie(
        "fleet",
        "/fleet/opportunities?region=western",
        "created",
        "actor-1"
      )
    })

    const props = await pageProps({ welcome: "1" })

    expect(props).toMatchObject({
      continuationHref: "/fleet/opportunities",
      welcome: true
    })
  })

  it("ignores a posted next value and drops missing, self, cross-role, or external cookies", async () => {
    for (const next of [
      undefined,
      "/fleet/command?welcome=1",
      "/driver/loads",
      "https://example.com/fleet/opportunities"
    ]) {
      mocks.cookieGet.mockReturnValue(
        next
          ? {
              value: createFirstRunHandoffCookie(
                "fleet",
                next,
                "created",
                "actor-1"
              )
            }
          : undefined
      )
      const props = await pageProps({ next: "/fleet/opportunities", welcome: "1" })

      expect(props.continuationHref, String(next)).toBeNull()
    }
  })

  it("reads an exact-rig credential gate only for an authorized actor in the active tenant", async () => {
    mocks.getFleetCockpitData.mockResolvedValue({
      ...cockpitData(),
      network: {
        ...cockpitData().network,
        trucks: [{ driverProfileId: "driver-1", id: "combination-1" }]
      }
    })
    mocks.getSessionActor.mockResolvedValue({
      activeMembership: { role: "fleet_manager" },
      activeOrganization: { id: "fleet-1" },
      profile: { id: "actor-1" }
    })
    mocks.organizationRoleCan.mockReturnValue(true)
    mocks.getDriverCredentialVaultView.mockReturnValue({
      equipmentReadiness: [{
        combinationId: "combination-1",
        missingLabels: ["Truck photo"],
        satisfied: false
      }]
    })

    const props = await pageProps({ welcome: "1" })

    expect(mocks.getDriverCredentialVaultView).toHaveBeenCalledWith("driver-1", {
      actorUserId: "actor-1",
      audience: "fleet",
      organizationId: "fleet-1"
    })
    expect(props.credentialReadiness).toEqual({
      missingLabels: ["Truck photo"],
      satisfied: false
    })
  })

  it("does not read credential data across tenants or without manage-drivers permission", async () => {
    mocks.getFleetCockpitData.mockResolvedValue({
      ...cockpitData(),
      network: {
        ...cockpitData().network,
        trucks: [{ driverProfileId: "driver-1", id: "combination-1" }]
      }
    })

    mocks.getSessionActor.mockResolvedValue({
      activeMembership: { role: "fleet_manager" },
      activeOrganization: { id: "other-fleet" },
      profile: { id: "actor-1" }
    })
    mocks.organizationRoleCan.mockReturnValue(true)
    expect((await pageProps({ welcome: "1" })).credentialReadiness).toBeNull()
    expect(mocks.getDriverCredentialVaultView).not.toHaveBeenCalled()

    vi.clearAllMocks()
    mocks.getFleetCockpitData.mockResolvedValue({
      ...cockpitData(),
      network: {
        ...cockpitData().network,
        trucks: [{ driverProfileId: "driver-1", id: "combination-1" }]
      }
    })
    mocks.getSessionActor.mockResolvedValue({
      activeMembership: { role: "dispatcher" },
      activeOrganization: { id: "fleet-1" },
      profile: { id: "actor-1" }
    })
    mocks.organizationRoleCan.mockReturnValue(false)

    expect((await pageProps({ welcome: "1" })).credentialReadiness).toBeNull()
    expect(mocks.getDriverCredentialVaultView).not.toHaveBeenCalled()
  })
})
