import { createInMemoryDatabase } from "@logloads/db"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSessionActor: vi.fn(),
  mutateState: vi.fn(),
  revalidatePath: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("./analytics", () => ({ captureServerEvent: vi.fn() }))
vi.mock("./services", () => ({
  mutateState: mocks.mutateState,
  serializeError: (error: unknown) => ({
    error: error instanceof Error ? error.message : "Unknown error"
  }),
  services: {}
}))
vi.mock("./session", () => ({ getSessionActor: mocks.getSessionActor }))

import {
  changeOrganizationMemberRoleAction,
  reactivateOrganizationMemberAction,
  removeOrganizationMemberAction,
  suspendOrganizationMemberAction
} from "./cockpit-actions"
import { buildTeamRosterView } from "./plans"

const ACTOR_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
const CLIENT_ACTOR_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"
const ORGANIZATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"
const CLIENT_ORGANIZATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2"
const MEMBER_USER_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1"

type Draft = {
  changeOrganizationMemberRole: ReturnType<typeof vi.fn>
  reactivateOrganizationMember: ReturnType<typeof vi.fn>
  removeOrganizationMember: ReturnType<typeof vi.fn>
  suspendOrganizationMember: ReturnType<typeof vi.fn>
}

let draft: Draft

beforeEach(() => {
  vi.clearAllMocks()
  draft = {
    changeOrganizationMemberRole: vi.fn(),
    reactivateOrganizationMember: vi.fn(),
    removeOrganizationMember: vi.fn(),
    suspendOrganizationMember: vi.fn()
  }
  mocks.getSessionActor.mockResolvedValue({
    activeOrganization: {
      archivedAt: null,
      id: ORGANIZATION_ID,
      verificationStatus: "verified"
    },
    isPlatformAdmin: false,
    profile: { id: ACTOR_USER_ID },
    workspaceSelectionInvalid: false
  })
  mocks.mutateState.mockImplementation(async (mutation: (current: Draft) => unknown) => mutation(draft))
})

describe("team lifecycle server actions", () => {
  it("derives the actor and workspace on the server for every mutation", async () => {
    await changeOrganizationMemberRoleAction({
      actorUserId: CLIENT_ACTOR_USER_ID,
      memberUserId: MEMBER_USER_ID,
      organizationId: CLIENT_ORGANIZATION_ID,
      role: "driver"
    } as Parameters<typeof changeOrganizationMemberRoleAction>[0])
    await suspendOrganizationMemberAction({
      actorUserId: CLIENT_ACTOR_USER_ID,
      memberUserId: MEMBER_USER_ID,
      organizationId: CLIENT_ORGANIZATION_ID
    } as Parameters<typeof suspendOrganizationMemberAction>[0])
    await reactivateOrganizationMemberAction({
      actorUserId: CLIENT_ACTOR_USER_ID,
      memberUserId: MEMBER_USER_ID,
      organizationId: CLIENT_ORGANIZATION_ID
    } as Parameters<typeof reactivateOrganizationMemberAction>[0])
    await removeOrganizationMemberAction({
      actorUserId: CLIENT_ACTOR_USER_ID,
      memberUserId: MEMBER_USER_ID,
      organizationId: CLIENT_ORGANIZATION_ID
    } as Parameters<typeof removeOrganizationMemberAction>[0])

    expect(draft.changeOrganizationMemberRole).toHaveBeenCalledWith({
      actorUserId: ACTOR_USER_ID,
      memberUserId: MEMBER_USER_ID,
      organizationId: ORGANIZATION_ID,
      role: "driver"
    })
    expect(draft.suspendOrganizationMember).toHaveBeenCalledWith({
      actorUserId: ACTOR_USER_ID,
      memberUserId: MEMBER_USER_ID,
      organizationId: ORGANIZATION_ID
    })
    expect(draft.reactivateOrganizationMember).toHaveBeenCalledWith({
      actorUserId: ACTOR_USER_ID,
      memberUserId: MEMBER_USER_ID,
      organizationId: ORGANIZATION_ID
    })
    expect(draft.removeOrganizationMember).toHaveBeenCalledWith({
      actorUserId: ACTOR_USER_ID,
      memberUserId: MEMBER_USER_ID,
      organizationId: ORGANIZATION_ID
    })
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(8)
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/fleet", "layout")
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/host", "layout")
  })

  it("refuses an unauthenticated direct action call before mutation", async () => {
    mocks.getSessionActor.mockResolvedValue(null)

    const result = await suspendOrganizationMemberAction({ memberUserId: MEMBER_USER_ID })

    expect(result).toEqual({ error: "Sign in to continue", ok: false })
    expect(mocks.mutateState).not.toHaveBeenCalled()
  })

  it("returns a service refusal without revalidating a stale roster", async () => {
    draft.removeOrganizationMember.mockImplementation(() => {
      throw new Error("An organization must keep at least one active owner")
    })

    const result = await removeOrganizationMemberAction({ memberUserId: MEMBER_USER_ID })

    expect(result).toEqual({
      error: "An organization must keep at least one active owner",
      ok: false
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})

describe("team roster projection", () => {
  it("keeps raw identity and state while counting only exact-workspace active or upcoming assignments", () => {
    const state = createInMemoryDatabase()
    const membership = state.organizationMemberships.find(
      (candidate) =>
        candidate.status !== "removed" &&
        state.driverProfiles.some(
          (profile) =>
            profile.companyId === candidate.organizationId && profile.userId === candidate.userId
        )
    )
    const driver = state.driverProfiles.find(
      (candidate) =>
        candidate.companyId === membership?.organizationId && candidate.userId === membership?.userId
    )
    const assignment = state.assignments.find((candidate) => candidate.driverProfileId === driver?.id)
    const foreignOrganization = state.organizations.find(
      (candidate) => candidate.id !== membership?.organizationId
    )

    expect(membership && driver && assignment && foreignOrganization).toBeTruthy()
    if (!membership || !driver || !assignment || !foreignOrganization) return

    const initialCount = state.assignments.filter(
      (candidate) =>
        candidate.driverProfileId === driver.id &&
        !["cancelled", "completed", "declined"].includes(candidate.status)
    ).length

    state.assignments.push(
      {
        ...assignment,
        driverProfileId: driver.id,
        id: "93939393-9393-4939-8939-939393939391",
        status: "offered"
      },
      {
        ...assignment,
        driverProfileId: driver.id,
        id: "93939393-9393-4939-8939-939393939392",
        status: "completed"
      }
    )
    state.driverProfiles.push({
      ...driver,
      companyId: foreignOrganization.id,
      id: "94949494-9494-4949-8949-949494949491"
    })
    state.assignments.push({
      ...assignment,
      driverProfileId: "94949494-9494-4949-8949-949494949491",
      id: "93939393-9393-4939-8939-939393939393",
      status: "accepted"
    })

    const member = buildTeamRosterView(
      state,
      membership.organizationId,
      membership.userId
    ).find((candidate) => candidate.id === membership.id)

    expect(member).toMatchObject({
      activeOrUpcomingAssignmentCount: initialCount + 1,
      isSelf: true,
      role: membership.role,
      status: membership.status,
      userId: membership.userId
    })
  })

  it("fails closed on an ambiguous workspace driver identity and omits removed memberships", () => {
    const state = createInMemoryDatabase()
    const membership = state.organizationMemberships.find(
      (candidate) =>
        candidate.status !== "removed" &&
        state.driverProfiles.some(
          (profile) =>
            profile.companyId === candidate.organizationId && profile.userId === candidate.userId
        )
    )
    const driver = state.driverProfiles.find(
      (candidate) =>
        candidate.companyId === membership?.organizationId && candidate.userId === membership?.userId
    )

    expect(membership && driver).toBeTruthy()
    if (!membership || !driver) return

    membership.status = "removed"
    expect(buildTeamRosterView(state, membership.organizationId, membership.userId)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: membership.id })])
    )

    membership.status = "active"
    state.driverProfiles.push({
      ...driver,
      id: "94949494-9494-4949-8949-949494949492"
    })

    expect(() => buildTeamRosterView(state, membership.organizationId, membership.userId)).toThrow(
      /driver profile identity is ambiguous/
    )
  })
})
