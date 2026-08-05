import {
  availabilityWindowSchema,
  driverProfileSchema,
  futureAvailabilitySchema,
  organizationMembershipSchema,
  userSchema
} from "@logloads/contracts"
import { createInMemoryDatabase, type LogLoadsDatabaseState } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { getAccountContext } from "./accounts"
import {
  activeDriverProfileForOrganization,
  driverProfileCanRequestForOrganization
} from "./driver-access"
import {
  acceptInvitationForExistingUser,
  createOrganizationInvitation
} from "./invitations"
import { requestCapacityWithPolicy } from "./operating-network"
import {
  changeOrganizationMemberRole,
  reactivateOrganizationMember,
  removeOrganizationMember,
  suspendOrganizationMember
} from "./team"

const NORTH_PINE = "33333333-3333-4333-8333-333333333331"
const SUMMIT = "33333333-3333-4333-8333-333333333332"
const MANAGER = "2f2f2f2f-2f2f-4f2f-8f2f-2f2f2f2f2f01"
const MANAGER_MEMBERSHIP = "16f6f6f6-1616-4616-8616-16f6f6f6f601"
const HANK = "22222222-2222-4222-8222-222222222221"
const HANK_DRIVER = "44444444-4444-4444-8444-444444444441"
const DANA = "22222222-2222-4222-8222-222222222224"
const COLE = "22222222-2222-4222-8222-222222222223"
const T = "2026-08-05T12:00:00.000Z"

function fixture(): LogLoadsDatabaseState {
  const state = createInMemoryDatabase()

  state.profiles.push(
    userSchema.parse({
      clerkUserId: "clerk-team-owner",
      companyId: NORTH_PINE,
      createdAt: T,
      email: "owner@team-fixture.example",
      fullName: "Olive Owner",
      id: MANAGER,
      isActive: true,
      phone: "555-0100",
      role: "dispatcher",
      updatedAt: T,
      verificationStatus: "verified"
    })
  )
  state.organizationMemberships.push(
    organizationMembershipSchema.parse({
      createdAt: T,
      id: MANAGER_MEMBERSHIP,
      organizationId: NORTH_PINE,
      role: "owner",
      status: "active",
      updatedAt: T,
      userId: MANAGER
    })
  )

  return state
}

function hankLifecycleInput() {
  return { actorUserId: MANAGER, memberUserId: HANK, organizationId: NORTH_PINE }
}

function addHankAvailability(state: LogLoadsDatabaseState) {
  const combination = state.equipmentCombinations.find(
    (candidate) => candidate.assignedDriverProfileId === HANK_DRIVER && candidate.organizationId === NORTH_PINE
  )

  if (!combination) {
    throw new Error("Hank equipment fixture is missing")
  }

  const past = availabilityWindowSchema.parse({
    createdAt: T,
    driverProfileId: HANK_DRIVER,
    endAt: "2026-08-04T10:00:00.000Z",
    id: "51515151-5151-4151-8151-515151515151",
    notes: "Historical availability remains historical.",
    preferredRouteIds: [],
    recurringSchedule: null,
    startAt: "2026-08-04T08:00:00.000Z",
    status: "available",
    truckProfileId: combination.truckProfileId,
    updatedAt: T
  })
  const future = availabilityWindowSchema.parse({
    createdAt: T,
    driverProfileId: HANK_DRIVER,
    endAt: "2099-08-06T18:00:00.000Z",
    id: "51515151-5151-4151-8151-515151515152",
    notes: "Future availability must close on access revocation.",
    preferredRouteIds: [],
    recurringSchedule: null,
    startAt: "2099-08-06T08:00:00.000Z",
    status: "available",
    truckProfileId: combination.truckProfileId,
    updatedAt: T
  })
  const networkFuture = futureAvailabilitySchema.parse({
    createdAt: T,
    endsAt: "2099-08-07T18:00:00.000Z",
    equipmentCombinationId: combination.id,
    id: "52525252-5252-4252-8252-525252525252",
    notes: "Published capacity must close with the driver.",
    organizationId: NORTH_PINE,
    startsAt: "2099-08-07T08:00:00.000Z",
    status: "available",
    updatedAt: T,
    visibleToRelationshipIds: []
  })

  state.availabilityWindows.push(past, future)
  state.futureAvailability.push(networkFuture)

  return { future, networkFuture, past }
}

describe("organization-scoped driver access", () => {
  it("requires one active capable membership, one exact-org profile, and an active user", () => {
    const state = fixture()
    const driver = activeDriverProfileForOrganization(state, HANK, NORTH_PINE)

    expect(driver?.id).toBe(HANK_DRIVER)
    expect(activeDriverProfileForOrganization(state, HANK, SUMMIT)).toBeNull()

    const membership = state.organizationMemberships.find(
      (candidate) => candidate.userId === HANK && candidate.organizationId === NORTH_PINE
    )

    expect(membership).toBeDefined()
    membership!.status = "suspended"
    expect(activeDriverProfileForOrganization(state, HANK, NORTH_PINE)).toBeNull()

    membership!.status = "active"
    state.organizationMemberships.push(
      organizationMembershipSchema.parse({ ...membership!, id: "16161616-1616-4616-8616-161616161699" })
    )
    expect(activeDriverProfileForOrganization(state, HANK, NORTH_PINE)).toBeNull()
  })

  it("refuses cross-organization and unavailable drivers before capacity is mutated", () => {
    const state = fixture()
    const assignmentCount = state.assignments.length
    const hank = state.driverProfiles.find((candidate) => candidate.id === HANK_DRIVER)

    expect(hank).toBeDefined()
    if (!hank) return

    expect(driverProfileCanRequestForOrganization(state, hank, SUMMIT)).toBe(false)

    expect(() =>
      requestCapacityWithPolicy(state, {
        actorUserId: COLE,
        driverProfileId: HANK_DRIVER,
        loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
        organizationId: SUMMIT,
        trailerProfileId: "88888888-8888-4888-8888-888888888883",
        truckProfileId: "77777777-7777-4777-8777-777777777773",
        truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd6"
      }, { at: "2026-06-05T12:00:00.000Z" })
    ).toThrow(/active, available, and belong/)

    expect(state.assignments).toHaveLength(assignmentCount)

    hank.availabilityStatus = "unavailable"
    expect(() =>
      requestCapacityWithPolicy(state, {
        actorUserId: MANAGER,
        driverProfileId: HANK_DRIVER,
        loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
        organizationId: NORTH_PINE,
        trailerProfileId: "88888888-8888-4888-8888-888888888881",
        truckProfileId: "77777777-7777-4777-8777-777777777771",
        truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd6"
      }, { at: "2026-06-05T12:00:00.000Z" })
    ).toThrow(/active, available, and belong/)
    expect(state.assignments).toHaveLength(assignmentCount)
  })
})

describe("member suspension, reactivation, and removal", () => {
  it("atomically revokes driver access and future availability without rewriting work or billing history", () => {
    const state = fixture()
    const windows = addHankAvailability(state)
    const assignmentsBefore = structuredClone(state.assignments)
    const tripsBefore = structuredClone(state.tripsV2)
    const feesBefore = structuredClone(state.platformFeeEvents)
    const invoicesBefore = structuredClone(state.hostInvoices)

    const suspended = suspendOrganizationMember(state, hankLifecycleInput())

    expect(suspended.status).toBe("suspended")
    expect(getAccountContext(state, HANK)?.driverProfileId).toBeNull()
    expect(activeDriverProfileForOrganization(state, HANK, NORTH_PINE)).toBeNull()
    expect(state.driverProfiles.find((candidate) => candidate.id === HANK_DRIVER)).toMatchObject({
      availabilityStatus: "unavailable",
      id: HANK_DRIVER
    })
    expect(state.availabilityWindows.find((window) => window.id === windows.past.id)?.status).toBe("available")
    expect(state.availabilityWindows.find((window) => window.id === windows.future.id)?.status).toBe("unavailable")
    expect(state.futureAvailability.find((window) => window.id === windows.networkFuture.id)?.status).toBe("unavailable")
    expect(state.assignments).toEqual(assignmentsBefore)
    expect(state.tripsV2).toEqual(tripsBefore)
    expect(state.platformFeeEvents).toEqual(feesBefore)
    expect(state.hostInvoices).toEqual(invoicesBefore)

    const restored = reactivateOrganizationMember(state, hankLifecycleInput())

    expect(restored.status).toBe("active")
    expect(getAccountContext(state, HANK)?.driverProfileId).toBe(HANK_DRIVER)
    expect(state.driverProfiles.find((candidate) => candidate.id === HANK_DRIVER)?.availabilityStatus).toBe("unavailable")
    expect(state.availabilityWindows.find((window) => window.id === windows.future.id)?.status).toBe("unavailable")
  })

  it("protects self-management, the last active owner, permissions, and tenant scope", () => {
    const state = fixture()
    const inactiveOwnerUserId = "2f2f2f2f-2f2f-4f2f-8f2f-2f2f2f2f2f02"

    state.profiles.push(
      userSchema.parse({
        ...state.profiles.find((profile) => profile.id === MANAGER)!,
        clerkUserId: "clerk-inactive-owner",
        email: "inactive-owner@team-fixture.example",
        fullName: "Inactive Owner",
        id: inactiveOwnerUserId,
        isActive: false
      })
    )
    state.organizationMemberships.push(
      organizationMembershipSchema.parse({
        ...state.organizationMemberships.find(
          (membership) => membership.id === MANAGER_MEMBERSHIP
        )!,
        id: "16f6f6f6-1616-4616-8616-16f6f6f6f602",
        userId: inactiveOwnerUserId
      })
    )

    expect(() => suspendOrganizationMember(state, {
      actorUserId: MANAGER,
      memberUserId: MANAGER,
      organizationId: NORTH_PINE
    })).toThrow(/your own access/)
    expect(() => removeOrganizationMember(state, {
      actorUserId: MANAGER,
      memberUserId: MANAGER,
      organizationId: NORTH_PINE
    })).toThrow(/your own access/)
    expect(() => changeOrganizationMemberRole(state, {
      actorUserId: MANAGER,
      memberUserId: MANAGER,
      organizationId: NORTH_PINE,
      role: "admin"
    })).toThrow(/at least one active owner/)

    const danaMembership = state.organizationMemberships.find(
      (candidate) => candidate.userId === DANA && candidate.organizationId === NORTH_PINE
    )

    expect(danaMembership).toBeDefined()
    danaMembership!.role = "admin"
    expect(() => suspendOrganizationMember(state, {
      actorUserId: DANA,
      memberUserId: MANAGER,
      organizationId: NORTH_PINE
    })).toThrow(/at least one active owner/)

    danaMembership!.role = "dispatcher"
    expect(() => suspendOrganizationMember(state, {
      actorUserId: DANA,
      memberUserId: HANK,
      organizationId: NORTH_PINE
    })).toThrow(/cannot manage members/)
    expect(() => suspendOrganizationMember(state, {
      actorUserId: COLE,
      memberUserId: HANK,
      organizationId: NORTH_PINE
    })).toThrow(/not an active member/)
    expect(() => suspendOrganizationMember(state, {
      actorUserId: MANAGER,
      memberUserId: COLE,
      organizationId: NORTH_PINE
    })).toThrow(/not a member/)
  })

  it("removes and re-invites a driver without changing membership or profile identity", () => {
    const state = fixture()
    const membershipBefore = state.organizationMemberships.find(
      (candidate) => candidate.userId === HANK && candidate.organizationId === NORTH_PINE
    )
    const profileBefore = state.driverProfiles.find((candidate) => candidate.id === HANK_DRIVER)
    const workBefore = {
      assignments: structuredClone(state.assignments),
      fees: structuredClone(state.platformFeeEvents),
      invoices: structuredClone(state.hostInvoices),
      trips: structuredClone(state.tripsV2)
    }

    expect(membershipBefore).toBeDefined()
    expect(profileBefore).toBeDefined()
    removeOrganizationMember(state, hankLifecycleInput())

    const invitation = createOrganizationInvitation(state, {
      actorUserId: MANAGER,
      invitedEmail: "hank@northpine.example",
      invitedRole: "driver",
      organizationId: NORTH_PINE
    })
    const accepted = acceptInvitationForExistingUser(state, {
      actorUserId: HANK,
      invitationId: invitation.id
    })

    expect(accepted.membership.id).toBe(membershipBefore!.id)
    expect(accepted.membership.status).toBe("active")
    expect(state.organizationMemberships.filter(
      (candidate) => candidate.userId === HANK && candidate.organizationId === NORTH_PINE
    )).toHaveLength(1)
    expect(state.driverProfiles.filter(
      (candidate) => candidate.userId === HANK && candidate.companyId === NORTH_PINE
    )).toEqual([expect.objectContaining({ availabilityStatus: "unavailable", id: profileBefore!.id })])
    expect(state.assignments).toEqual(workBefore.assignments)
    expect(state.tripsV2).toEqual(workBefore.trips)
    expect(state.platformFeeEvents).toEqual(workBefore.fees)
    expect(state.hostInvoices).toEqual(workBefore.invoices)
  })
})

describe("member role changes", () => {
  it("parses the canonical role and provisions exactly one unavailable organization driver profile", () => {
    const state = fixture()

    expect(state.driverProfiles.some(
      (candidate) => candidate.userId === DANA && candidate.companyId === NORTH_PINE
    )).toBe(false)

    expect(() => changeOrganizationMemberRole(state, {
      actorUserId: MANAGER,
      memberUserId: DANA,
      organizationId: NORTH_PINE,
      role: "driver "
    })).toThrow()

    const updated = changeOrganizationMemberRole(state, {
      actorUserId: MANAGER,
      memberUserId: DANA,
      organizationId: NORTH_PINE,
      role: "driver"
    })
    const profiles = state.driverProfiles.filter(
      (candidate) => candidate.userId === DANA && candidate.companyId === NORTH_PINE
    )

    expect(updated.role).toBe("driver")
    expect(profiles).toHaveLength(1)
    expect(profiles[0]?.availabilityStatus).toBe("unavailable")
    expect(activeDriverProfileForOrganization(state, DANA, NORTH_PINE)?.id).toBe(profiles[0]?.id)
  })

  it("fails atomically when duplicate organization driver profiles make identity ambiguous", () => {
    const state = fixture()
    const summitDriver = state.driverProfiles.find(
      (candidate) => candidate.userId === COLE && candidate.companyId === SUMMIT
    )

    expect(summitDriver).toBeDefined()
    if (!summitDriver) return

    state.driverProfiles.push(driverProfileSchema.parse({
      ...summitDriver,
      companyId: NORTH_PINE,
      id: "53535353-5353-4353-8353-535353535353",
      userId: DANA
    }))
    state.driverProfiles.push(driverProfileSchema.parse({
      ...summitDriver,
      companyId: NORTH_PINE,
      id: "53535353-5353-4353-8353-535353535354",
      userId: DANA
    }))
    const before = structuredClone(state)

    expect(() => changeOrganizationMemberRole(state, {
      actorUserId: MANAGER,
      memberUserId: DANA,
      organizationId: NORTH_PINE,
      role: "driver"
    })).toThrow(/ambiguous/)
    expect(state).toEqual(before)
  })
})
