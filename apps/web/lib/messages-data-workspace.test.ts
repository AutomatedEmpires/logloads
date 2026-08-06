import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  listThreadMessages: vi.fn(),
  listThreadsForUser: vi.fn(),
  homePathFor: vi.fn(),
  markThreadRead: vi.fn(),
  mutateState: vi.fn(),
  redirect: vi.fn(),
  requireCockpitActor: vi.fn(),
  state: {
    assignments: [] as Array<{
      driverProfileId: string
      id: string
      loadPostingId: string
      status: string
    }>,
    driverProfiles: [] as Array<{ companyId: string | null; id: string; userId: string }>,
    equipmentCombinations: [] as Array<{
      assignedDriverProfileId: string | null
      organizationId: string
    }>,
    loadPostings: [] as Array<{ companyId: string; id: string; title: string }>,
    organizationMemberships: [] as Array<{
      organizationId: string
      role: string
      status: string
      userId: string
    }>,
    organizations: [] as Array<{
      archivedAt: string | null
      id: string
      verificationStatus: string
    }>,
    profiles: [] as Array<{ fullName: string; id: string; isActive: boolean }>
  },
  unreadThreadCounts: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("./session", () => ({
  homePathFor: mocks.homePathFor,
  requireCockpitActor: mocks.requireCockpitActor
}))
vi.mock("./services", () => ({
  mutateState: mocks.mutateState,
  services: {
    listThreadMessages: mocks.listThreadMessages,
    listThreadsForUser: mocks.listThreadsForUser,
    markThreadRead: mocks.markThreadRead,
    state: mocks.state,
    unreadThreadCounts: mocks.unreadThreadCounts
  }
}))

import { getMessagesData } from "./messages-data"

const USER_ID = "11111111-1111-4111-8111-111111111111"
const ORGANIZATION_ID = "a2222222-2222-4222-8222-222222222222"
const THREAD_ID = "33333333-3333-4333-8333-333333333333"
const ASSIGNMENT_ID = "44444444-4444-4444-8444-444444444444"
const LOAD_ID = "55555555-5555-4555-8555-555555555555"
const DRIVER_PROFILE_ID = "66666666-6666-4666-8666-666666666666"
const DRIVER_USER_ID = "77777777-7777-4777-8777-777777777777"
const CARRIER_ID = "88888888-8888-4888-8888-888888888888"

beforeEach(() => {
  vi.clearAllMocks()
  for (const records of Object.values(mocks.state)) {
    records.splice(0)
  }
  mocks.requireCockpitActor.mockResolvedValue({
    activeOrganization: { id: ORGANIZATION_ID },
    driverProfileId: null,
    profile: { id: USER_ID }
  })
  mocks.homePathFor.mockReturnValue("/access-restricted")
  mocks.redirect.mockImplementation((destination: string) => {
    throw new Error(`REDIRECT:${destination}`)
  })
  mocks.listThreadsForUser.mockReturnValue([{
    contextLabel: "Assignment - Cedar ridge",
    id: THREAD_ID,
    participants: [],
    subject: "Arrival"
  }])
  mocks.listThreadMessages.mockReturnValue([])
  mocks.unreadThreadCounts.mockReturnValue({ [THREAD_ID]: 1 })
  mocks.mutateState.mockImplementation(async (mutation: (draft: {
    markThreadRead: typeof mocks.markThreadRead
  }) => unknown) => mutation({ markThreadRead: mocks.markThreadRead }))
})

describe("workspace-scoped message data", () => {
  it("passes the exact active organization through list, read, unread, and read-state calls", async () => {
    const result = await getMessagesData("host", THREAD_ID)

    expect(result.selectedThread?.id).toBe(THREAD_ID)
    expect(mocks.listThreadsForUser).toHaveBeenCalledWith(USER_ID, ORGANIZATION_ID)
    expect(mocks.listThreadMessages).toHaveBeenCalledWith(THREAD_ID, USER_ID, ORGANIZATION_ID)
    expect(mocks.unreadThreadCounts).toHaveBeenCalledWith(USER_ID, ORGANIZATION_ID)
    expect(mocks.markThreadRead).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      threadId: THREAD_ID,
      userId: USER_ID
    })
  })

  it("fails before reading messages when the session has no exact active organization", async () => {
    mocks.requireCockpitActor.mockResolvedValue({
      activeOrganization: null,
      driverProfileId: null,
      profile: { id: USER_ID }
    })

    await expect(getMessagesData("host", THREAD_ID)).rejects.toThrow(
      /REDIRECT:\/access-restricted/
    )
    expect(mocks.redirect).toHaveBeenCalledWith("/access-restricted")
    expect(mocks.listThreadsForUser).not.toHaveBeenCalled()
    expect(mocks.listThreadMessages).not.toHaveBeenCalled()
    expect(mocks.mutateState).not.toHaveBeenCalled()
  })

  it("does not advertise a counterparty whose organization is locked", async () => {
    mocks.state.assignments.push({
      driverProfileId: DRIVER_PROFILE_ID,
      id: ASSIGNMENT_ID,
      loadPostingId: LOAD_ID,
      status: "accepted"
    })
    mocks.state.driverProfiles.push({
      companyId: CARRIER_ID,
      id: DRIVER_PROFILE_ID,
      userId: DRIVER_USER_ID
    })
    mocks.state.loadPostings.push({
      companyId: ORGANIZATION_ID,
      id: LOAD_ID,
      title: "Cedar ridge"
    })
    mocks.state.organizationMemberships.push({
      organizationId: CARRIER_ID,
      role: "driver",
      status: "active",
      userId: DRIVER_USER_ID
    })
    mocks.state.organizations.push({
      archivedAt: null,
      id: CARRIER_ID,
      verificationStatus: "suspended"
    })
    mocks.state.profiles.push({
      fullName: "Locked Driver",
      id: DRIVER_USER_ID,
      isActive: true
    })
    mocks.listThreadsForUser.mockReturnValue([])
    mocks.unreadThreadCounts.mockReturnValue({})

    await expect(getMessagesData("host", null)).resolves.toMatchObject({
      counterparties: []
    })
  })
})
