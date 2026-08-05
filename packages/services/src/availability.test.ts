import { organizationMembershipSchema, userSchema } from "@logloads/contracts"
import { describe, expect, it } from "vitest"

import { seedDatabaseState } from "@logloads/db"

import {
  listDriverAvailability,
  setDriverAvailability,
  upsertAvailabilityWindow
} from "./availability"
import { driverProfileCanRequestForOrganization } from "./driver-access"
import {
  acceptInvitationForExistingUser,
  createOrganizationInvitation
} from "./invitations"
import { requestCapacityWithPolicy } from "./operating-network"
import {
  reactivateOrganizationMember,
  removeOrganizationMember,
  suspendOrganizationMember
} from "./team"

function freshState() {
  return structuredClone(seedDatabaseState)
}

/**
 * A seeded driver holding exactly one posted window. One window keeps an edit
 * unambiguous: the one-window-per-span rule skips the row being replaced, so a
 * driver with a second overlapping window would be refused for that reason
 * instead of the one under test.
 */
function driverWithOneWindow(state: ReturnType<typeof freshState>, excludeDriverProfileId?: string) {
  const windowCounts = new Map<string, number>()

  for (const window of state.availabilityWindows) {
    windowCounts.set(window.driverProfileId, (windowCounts.get(window.driverProfileId) ?? 0) + 1)
  }

  const window = state.availabilityWindows.find(
    (entry) =>
      entry.driverProfileId !== excludeDriverProfileId && windowCounts.get(entry.driverProfileId) === 1
  )

  if (!window) {
    throw new Error("seed has no driver holding exactly one availability window")
  }

  return window
}

/** A day the seed leaves empty, so a new span cannot collide by accident. */
const UNUSED_DAY = {
  endAt: "2026-06-10T18:00:00.000Z",
  startAt: "2026-06-10T13:00:00.000Z"
}

const NORTH_PINE = "33333333-3333-4333-8333-333333333331"
const SUMMIT = "33333333-3333-4333-8333-333333333332"
const HANK = "22222222-2222-4222-8222-222222222221"
const HANK_DRIVER = "44444444-4444-4444-8444-444444444441"
const HANK_TRUCK = "77777777-7777-4777-8777-777777777771"
const HANK_TRAILER = "88888888-8888-4888-8888-888888888881"
const MANAGER = "2f2f2f2f-2f2f-4f2f-8f2f-2f2f2f2f2f11"
const T = "2026-08-05T12:00:00.000Z"

function addLifecycleManager(state: ReturnType<typeof freshState>) {
  state.profiles.push(userSchema.parse({
    clerkUserId: "clerk-availability-owner",
    companyId: NORTH_PINE,
    createdAt: T,
    email: "availability-owner@example.com",
    fullName: "Availability Owner",
    id: MANAGER,
    isActive: true,
    phone: "555-0100",
    role: "dispatcher",
    updatedAt: T,
    verificationStatus: "verified"
  }))
  state.organizationMemberships.push(organizationMembershipSchema.parse({
    createdAt: T,
    id: "2f2f2f2f-2f2f-4f2f-8f2f-2f2f2f2f2f12",
    organizationId: NORTH_PINE,
    role: "owner",
    status: "active",
    updatedAt: T,
    userId: MANAGER
  }))
}

function hankLifecycleInput() {
  return { actorUserId: MANAGER, memberUserId: HANK, organizationId: NORTH_PINE }
}

function makeHankUnavailable(state: ReturnType<typeof freshState>) {
  const driver = state.driverProfiles.find((candidate) => candidate.id === HANK_DRIVER)

  if (!driver) throw new Error("Hank driver fixture missing")
  driver.availabilityStatus = "unavailable"
  state.availabilityWindows = state.availabilityWindows.filter(
    (window) => window.driverProfileId !== HANK_DRIVER
  )

  return driver
}

describe("upsertAvailabilityWindow ownership", () => {
  it("refuses a driver replacing another driver's window by its id", () => {
    // The route forwarded the client's id untouched and the service only asked
    // whether that id existed, so any driver could overwrite a rival's posted
    // availability — and availability is what makes a driver eligible for hauls.
    const state = freshState()
    const victimWindow = driverWithOneWindow(state)
    const rivalWindow = driverWithOneWindow(state, victimWindow.driverProfileId)
    const before = structuredClone(victimWindow)

    expect(() =>
      upsertAvailabilityWindow(state, {
        ...UNUSED_DAY,
        driverProfileId: rivalWindow.driverProfileId,
        id: victimWindow.id,
        status: rivalWindow.status
      })
    ).toThrow(/another driver's availability/i)

    // A refusal that still wrote would be the same outage with a 400 attached.
    expect(state.availabilityWindows.find((window) => window.id === before.id)).toEqual(before)
    expect(listDriverAvailability(state, rivalWindow.driverProfileId).map((window) => window.id)).not.toContain(
      before.id
    )
    expect(listDriverAvailability(state, before.driverProfileId).map((window) => window.id)).toContain(before.id)
  })

  it("lets a driver replace their own window", () => {
    const state = freshState()
    const ownWindow = driverWithOneWindow(state)
    const before = state.availabilityWindows.length

    const updated = upsertAvailabilityWindow(state, {
      ...UNUSED_DAY,
      driverProfileId: ownWindow.driverProfileId,
      id: ownWindow.id,
      status: ownWindow.status
    })

    expect(updated.id).toBe(ownWindow.id)
    expect(updated.startAt).toBe(UNUSED_DAY.startAt)
    // Replacing a row keeps the row: a create disguised as an edit would leave
    // the old span in place and double-book the driver.
    expect(updated.createdAt).toBe(ownWindow.createdAt)
    expect(state.availabilityWindows.length).toBe(before)
    expect(listDriverAvailability(state, ownWindow.driverProfileId).map((window) => window.startAt)).toEqual([
      UNUSED_DAY.startAt
    ])
  })

  it("refuses an id that names no window instead of creating one under it", () => {
    const state = freshState()
    const ownWindow = driverWithOneWindow(state)
    const before = state.availabilityWindows.length

    expect(() =>
      upsertAvailabilityWindow(state, {
        ...UNUSED_DAY,
        driverProfileId: ownWindow.driverProfileId,
        id: "00000000-0000-4000-8000-000000000000",
        status: ownWindow.status
      })
    ).toThrow(/not found/i)

    expect(state.availabilityWindows.length).toBe(before)
  })

  it("refuses an overlapping window rather than dropping the one already posted", () => {
    // The one-window-per-span rule must not become a deletion tool: an
    // overlapping write is turned away, and the window already posted stays.
    const state = freshState()
    const ownWindow = driverWithOneWindow(state)
    const before = structuredClone(ownWindow)

    expect(() =>
      upsertAvailabilityWindow(state, {
        driverProfileId: ownWindow.driverProfileId,
        endAt: ownWindow.endAt,
        startAt: ownWindow.startAt,
        status: ownWindow.status
      })
    ).toThrow(/overlaps existing window/i)

    expect(state.availabilityWindows.find((window) => window.id === before.id)).toEqual(before)
  })
})

describe("setDriverAvailability", () => {
  it.each(["available", "limited", "unavailable"] as const)(
    "atomically writes an explicit %s window and the matching profile readiness",
    (status) => {
      const state = freshState()
      const driver = makeHankUnavailable(state)
      const result = setDriverAvailability(state, {
        actorUserId: HANK,
        driverProfileId: HANK_DRIVER,
        organizationId: NORTH_PINE,
        status,
        ...UNUSED_DAY
      })

      expect(result.window.status).toBe(status)
      expect(result.driverProfile.availabilityStatus).toBe(status)
      expect(result.driverProfile.updatedAt).toBe(result.window.updatedAt)
      expect(state.driverProfiles.find((candidate) => candidate.id === driver.id)?.availabilityStatus)
        .toBe(status)
      expect(state.availabilityWindows).toContainEqual(result.window)
    }
  )

  it.each(["reactivated", "reinvited"] as const)(
    "takes a %s driver from deliberately unavailable to a real capacity request",
    (lifecycle) => {
      const state = freshState()

      addLifecycleManager(state)
      makeHankUnavailable(state)
      if (lifecycle === "reactivated") {
        suspendOrganizationMember(state, hankLifecycleInput())
        reactivateOrganizationMember(state, hankLifecycleInput())
      } else {
        removeOrganizationMember(state, hankLifecycleInput())
        const invitation = createOrganizationInvitation(state, {
          actorUserId: MANAGER,
          invitedEmail: "hank@northpine.example",
          invitedRole: "driver",
          organizationId: NORTH_PINE
        })

        acceptInvitationForExistingUser(state, {
          actorUserId: HANK,
          invitationId: invitation.id
        })
      }

      const driver = state.driverProfiles.find((candidate) => candidate.id === HANK_DRIVER)
      const slot = state.truckSlots.find(
        (candidate) => candidate.id === "dddddddd-dddd-4ddd-8ddd-ddddddddddd4"
      )

      expect(driver?.availabilityStatus).toBe("unavailable")
      expect(slot).toBeDefined()
      if (!driver || !slot) return

      setDriverAvailability(state, {
        actorUserId: HANK,
        driverProfileId: HANK_DRIVER,
        endAt: slot.endAt,
        organizationId: NORTH_PINE,
        startAt: slot.startAt,
        status: "available",
        truckProfileId: HANK_TRUCK
      })

      const readyDriver = state.driverProfiles.find(
        (candidate) => candidate.id === driver.id
      )

      expect(readyDriver).toBeDefined()
      if (!readyDriver) return
      expect(driverProfileCanRequestForOrganization(state, readyDriver, NORTH_PINE)).toBe(true)
      const assignment = requestCapacityWithPolicy(state, {
        actorUserId: HANK,
        driverProfileId: HANK_DRIVER,
        loadPostingId: slot.loadPostingId,
        organizationId: NORTH_PINE,
        trailerProfileId: HANK_TRAILER,
        truckProfileId: HANK_TRUCK,
        truckSlotId: slot.id
      }, { at: "2026-06-06T14:00:00.000Z" })

      expect(assignment.driverProfileId).toBe(HANK_DRIVER)
      expect(assignment.status).toBe("requested")
    }
  )

  it.each(["suspended", "removed"] as const)(
    "does not reactivate a %s driver through an unrelated active membership",
    (status) => {
      const state = freshState()

      makeHankUnavailable(state)
      const membership = state.organizationMemberships.find(
        (candidate) => candidate.organizationId === NORTH_PINE && candidate.userId === HANK
      )

      if (!membership) throw new Error("Hank membership fixture missing")
      membership.status = status
      state.organizationMemberships.push(organizationMembershipSchema.parse({
        createdAt: T,
        id: status === "suspended"
          ? "2f2f2f2f-2f2f-4f2f-8f2f-2f2f2f2f2f13"
          : "2f2f2f2f-2f2f-4f2f-8f2f-2f2f2f2f2f14",
        organizationId: SUMMIT,
        role: "driver",
        status: "active",
        updatedAt: T,
        userId: HANK
      }))
      const before = structuredClone({
        driverProfiles: state.driverProfiles,
        windows: state.availabilityWindows
      })

      expect(() => setDriverAvailability(state, {
        actorUserId: HANK,
        driverProfileId: HANK_DRIVER,
        organizationId: NORTH_PINE,
        status: "available",
        ...UNUSED_DAY
      })).toThrow(/active driver profile/)
      expect(() => setDriverAvailability(state, {
        actorUserId: HANK,
        driverProfileId: HANK_DRIVER,
        organizationId: SUMMIT,
        status: "available",
        ...UNUSED_DAY
      })).toThrow(/active driver profile/)
      expect({
        driverProfiles: state.driverProfiles,
        windows: state.availabilityWindows
      }).toEqual(before)
    }
  )

  it("fails closed for inactive users, archived organizations, and ambiguous memberships", () => {
    const mutators: Array<(state: ReturnType<typeof freshState>) => void> = [
      (state) => {
        const user = state.profiles.find((candidate) => candidate.id === HANK)

        if (!user) throw new Error("Hank user fixture missing")
        user.isActive = false
      },
      (state) => {
        const organization = state.organizations.find((candidate) => candidate.id === NORTH_PINE)

        if (!organization) throw new Error("North Pine fixture missing")
        organization.archivedAt = T
      },
      (state) => {
        const membership = state.organizationMemberships.find(
          (candidate) => candidate.organizationId === NORTH_PINE && candidate.userId === HANK
        )

        if (!membership) throw new Error("Hank membership fixture missing")
        state.organizationMemberships.push(organizationMembershipSchema.parse({
          ...membership,
          id: "2f2f2f2f-2f2f-4f2f-8f2f-2f2f2f2f2f15"
        }))
      }
    ]

    for (const mutate of mutators) {
      const state = freshState()

      makeHankUnavailable(state)
      mutate(state)
      const before = structuredClone(state)

      expect(() => setDriverAvailability(state, {
        actorUserId: HANK,
        driverProfileId: HANK_DRIVER,
        organizationId: NORTH_PINE,
        status: "available",
        ...UNUSED_DAY
      })).toThrow(/active driver profile/)
      expect(state).toEqual(before)
    }
  })

  it("leaves readiness and every window unchanged when the requested span overlaps", () => {
    const state = freshState()
    const driver = state.driverProfiles.find((candidate) => candidate.id === HANK_DRIVER)
    const existing = state.availabilityWindows.find(
      (window) => window.driverProfileId === HANK_DRIVER
    )

    if (!driver || !existing) throw new Error("Hank overlap fixtures missing")
    driver.availabilityStatus = "unavailable"
    const before = structuredClone({ driver, windows: state.availabilityWindows })

    expect(() => setDriverAvailability(state, {
      actorUserId: HANK,
      driverProfileId: HANK_DRIVER,
      endAt: existing.endAt,
      organizationId: NORTH_PINE,
      startAt: existing.startAt,
      status: "available"
    })).toThrow(/overlaps existing window/)
    expect({
      driver: state.driverProfiles.find((candidate) => candidate.id === HANK_DRIVER),
      windows: state.availabilityWindows
    }).toEqual(before)
  })

  it("keeps generic automated window upserts from changing driver readiness", () => {
    const state = freshState()
    const driver = makeHankUnavailable(state)

    upsertAvailabilityWindow(state, {
      driverProfileId: HANK_DRIVER,
      status: "available",
      ...UNUSED_DAY
    })

    expect(state.driverProfiles.find((candidate) => candidate.id === driver.id)?.availabilityStatus)
      .toBe("unavailable")
  })
})
