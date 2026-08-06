import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.stubGlobal("React", React)

const mocks = vi.hoisted(() => ({
  actor: null as unknown,
  buildResidualSettlements: vi.fn(() => []),
  homePathForMembership: vi.fn(() => "/fleet/command"),
  memberships: [] as Array<Record<string, unknown>>,
  organizations: [] as Array<Record<string, unknown>>,
  recoveryPath: null as string | null,
  selectedOrganizationId: null as string | null
}))

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => ({ value: "signed-selection" })) }))
}))
vi.mock("server-only", () => ({}))
vi.mock("@/components/v3", () => ({ AccessRestrictedPage: () => null }))
vi.mock("@/lib/session", () => ({
  getSessionActor: vi.fn(async () => mocks.actor),
  restrictedAccessRecoveryPath: vi.fn(() => mocks.recoveryPath),
  SESSION_COOKIE: "ll_session",
  verifySessionCookieValue: vi.fn(() => ({
    organizationId: mocks.selectedOrganizationId,
    userId: "user-1"
  }))
}))
vi.mock("@/lib/session-policy", () => ({
  homePathForMembership: mocks.homePathForMembership
}))
vi.mock("@/lib/residual-settlement-data", () => ({
  residualSettlementItemsForOrganization: mocks.buildResidualSettlements
}))
vi.mock("@/lib/services", () => ({
  services: {
    state: {
      organizationMemberships: mocks.memberships,
      organizations: mocks.organizations
    }
  }
}))

import Page from "@/app/access-restricted/page"

const SELECTED_ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111"
const AVAILABLE_ORGANIZATION_ID = "a2222222-2222-4222-8222-222222222222"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.buildResidualSettlements.mockReturnValue([])
  mocks.recoveryPath = null
  mocks.selectedOrganizationId = SELECTED_ORGANIZATION_ID
  mocks.memberships.splice(0, mocks.memberships.length, {
    organizationId: SELECTED_ORGANIZATION_ID,
    status: "active",
    userId: "user-1"
  })
  mocks.organizations.splice(0, mocks.organizations.length, {
    displayName: "Locked Timber",
    id: SELECTED_ORGANIZATION_ID,
    verificationStatus: "suspended"
  })
  mocks.actor = {
    memberships: [
      {
        membership: { role: "owner" },
        organization: {
          displayName: "Available Fleet",
          id: AVAILABLE_ORGANIZATION_ID,
          type: "fleet"
        }
      }
    ],
    profile: {
      email: "operator@example.com",
      fullName: "Operator",
      id: "user-1"
    }
  }
})

describe("restricted access routing", () => {
  it("identifies a selected suspended organization and offers an explicit safe workspace switch", async () => {
    const element = await Page()

    expect(element.props).toMatchObject({
      availableWorkspaces: [
        {
          href: "/fleet/command",
          id: AVAILABLE_ORGANIZATION_ID,
          name: "Available Fleet"
        }
      ],
      organizationName: "Locked Timber",
      reason: "organization_suspended",
      residualSettlements: [],
      restrictedWorkspaces: []
    })
    expect(mocks.homePathForMembership).toHaveBeenCalledWith("fleet", "owner")
    expect(mocks.buildResidualSettlements).toHaveBeenCalledWith(
      expect.objectContaining({ organizations: mocks.organizations }),
      "user-1",
      SELECTED_ORGANIZATION_ID
    )
  })

  it("keeps rejected organizations distinct from a suspended membership", async () => {
    mocks.organizations[0]!.verificationStatus = "rejected"

    expect((await Page()).props.reason).toBe("organization_rejected")

    mocks.organizations[0]!.verificationStatus = "pending"
    mocks.memberships[0]!.status = "suspended"

    expect((await Page()).props.reason).toBe("suspended")
  })

  it("does not disclose a selected organization without a membership for this account", async () => {
    mocks.memberships.splice(0, mocks.memberships.length)

    expect((await Page()).props).toMatchObject({
      organizationName: null,
      reason: "unavailable"
    })
  })

  it.each(["removed", "suspended"])(
    "does not disclose a locked organization through a %s membership",
    async (status) => {
      mocks.memberships[0]!.status = status

      expect((await Page()).props).toMatchObject({
        organizationName: null,
        reason: status
      })
      expect(mocks.buildResidualSettlements).not.toHaveBeenCalled()
    }
  )

  it("does not offer a workspace switch when the membership has no compatible cockpit", async () => {
    mocks.homePathForMembership.mockReturnValueOnce("/")

    expect((await Page()).props.availableWorkspaces).toEqual([])
  })

  it("offers an explicit selector for another exact active locked workspace", async () => {
    const secondLockedId = "33333333-3333-4333-8333-333333333333"

    mocks.memberships.push({
      organizationId: secondLockedId,
      status: "active",
      userId: "user-1"
    })
    mocks.organizations.push({
      archivedAt: null,
      displayName: "Paused Landing",
      id: secondLockedId,
      verificationStatus: "rejected"
    })

    expect((await Page()).props.restrictedWorkspaces).toEqual([
      { id: secondLockedId, name: "Paused Landing" }
    ])
  })

  it("keeps locked settlement reachable when another workspace has a recovery home", async () => {
    mocks.selectedOrganizationId = AVAILABLE_ORGANIZATION_ID
    mocks.recoveryPath = "/fleet/command"
    mocks.memberships.push({
      organizationId: AVAILABLE_ORGANIZATION_ID,
      status: "active",
      userId: "user-1"
    })
    mocks.organizations.push({
      archivedAt: null,
      displayName: "Available Fleet",
      id: AVAILABLE_ORGANIZATION_ID,
      verificationStatus: "verified"
    })

    expect((await Page()).props).toMatchObject({
      organizationName: "Locked Timber",
      reason: "organization_suspended",
      restrictedWorkspaces: [
        { id: SELECTED_ORGANIZATION_ID, name: "Locked Timber" }
      ]
    })
  })
})
