import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.stubGlobal("React", React)
vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  getCockpitContext: vi.fn(),
  organizationRoleCan: vi.fn()
}))

vi.mock("@logloads/contracts", () => ({
  organizationRoleCan: mocks.organizationRoleCan
}))
vi.mock("@/components/v3", () => ({
  BillingPage: () => null,
  HostCarriers: () => null,
  HostCommand: () => null,
  HostLiveBoard: () => null
}))
vi.mock("@/lib/host-billing-data", () => ({
  getHostBillingView: vi.fn(() => ({}))
}))
vi.mock("@/lib/host-data", () => ({
  getHostPublishingOptions: vi.fn(() => ({
    accessVocabulary: [],
    billingActivationState: "unenrolled",
    billingModel: null,
    billingProfileStatus: "none",
    currentPercentageAgreementActive: false,
    dispatcher: null,
    equipmentVocabulary: [],
    landings: [],
    loadTypes: [],
    rates: [],
    routes: [],
    subscriptionPlanCode: null
  })),
  getHostWorkspaceSetup: vi.fn(() => ({
    activeLandingCount: 0,
    destinations: [],
    landingLimit: null,
    mills: [],
    rates: []
  }))
}))
vi.mock("@/lib/v3", () => ({
  getCockpitContext: mocks.getCockpitContext,
  shellAccountFor: vi.fn(() => ({ userName: "Host" }))
}))
vi.mock("@/lib/plans", () => ({
  getBillingView: vi.fn(() => ({}))
}))
vi.mock("@/lib/subscription-billing-data", () => ({
  getHostSubscriptionBillingView: vi.fn(() => null)
}))

import BillingPage from "@/app/host/billing/page"
import CarriersPage from "@/app/host/carriers/page"
import CommandPage from "@/app/host/command/page"
import LiveBoardPage from "@/app/host/live-board/page"

function context(role: string) {
  return {
    actor: { activeMembership: { role }, profile: { id: "actor-1" } },
    network: { activeOrganization: { id: "host-1" } }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.organizationRoleCan.mockImplementation((role, action) => {
    if (role === "billing") return action === "manage_billing"

    return ["assign_capacity", "publish_load", "send_operational_notice"].includes(action)
  })
})

describe("host action permissions", () => {
  it("gives billing users payment controls without capacity, route-pack, offer, or notice mutations", async () => {
    mocks.getCockpitContext.mockResolvedValue(context("billing"))

    const live = await LiveBoardPage()
    const carriers = await CarriersPage()
    const command = await CommandPage()
    const billing = await BillingPage()

    expect(live.props).toMatchObject({
      canAssignCapacity: false,
      canManageBilling: true,
      canPublish: false
    })
    expect(carriers.props).toMatchObject({
      canAssignCapacity: false,
      canSendNotices: false
    })
    expect(command.props).toMatchObject({
      canAssignCapacity: false,
      canManageLandings: false,
      canPublish: false
    })
    expect(billing.props.canManageBilling).toBe(true)
  })

  it("gives dispatchers operating controls without host billing mutation", async () => {
    mocks.getCockpitContext.mockResolvedValue(context("dispatcher"))

    const live = await LiveBoardPage()
    const carriers = await CarriersPage()
    const command = await CommandPage()
    const billing = await BillingPage()

    expect(live.props).toMatchObject({
      canAssignCapacity: true,
      canManageBilling: false,
      canPublish: true
    })
    expect(carriers.props).toMatchObject({
      canAssignCapacity: true,
      canSendNotices: true
    })
    expect(command.props).toMatchObject({
      canAssignCapacity: true,
      canManageLandings: false,
      canPublish: true
    })
    expect(billing.props.canManageBilling).toBe(false)
  })
})
