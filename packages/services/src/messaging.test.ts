import {
  ORGANIZATION_ROLES,
  assignmentSchema,
  driverProfileSchema,
  loadPostingSchema,
  opportunityCapacitySchema,
  organizationMembershipSchema,
  organizationSchema,
  userSchema,
  type OrganizationRole
} from "@logloads/contracts"
import { createInMemoryDatabase, type LogLoadsDatabaseState, type LogLoadsTableName } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createThread, listThreadsForUser, postMessage } from "./messaging"

const NOW = "2026-07-20T12:00:00.000Z"

const ORG_HOST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01"
const ORG_CARRIER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02"
const ORG_STRANGER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03"

const DRIVER_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01"
const HOST_DISPATCHER_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02"
const HOST_BILLING_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb03"
const HOST_LANDING_MANAGER_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb04"
const STRANGER_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb05"
const STRANGER_DRIVER_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb06"

const DRIVER_PROFILE = "cccccccc-cccc-4ccc-8ccc-cccccccccc01"
const STRANGER_DRIVER_PROFILE = "cccccccc-cccc-4ccc-8ccc-cccccccccc02"

const HOST_LOAD = "dddddddd-dddd-4ddd-8ddd-dddddddddd01"
const PRIVATE_LOAD = "dddddddd-dddd-4ddd-8ddd-dddddddddd02"
const BROWSABLE_LOAD = "dddddddd-dddd-4ddd-8ddd-dddddddddd03"

const PRIVATE_LOAD_TITLE = "Blackridge confidential mill contract"

const HOST_ASSIGNMENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01"
const STRANGER_ASSIGNMENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02"

const FILLER = {
  capacityHostLoad: "ffffffff-ffff-4fff-8fff-ffffffffff01",
  capacityPrivateLoad: "ffffffff-ffff-4fff-8fff-ffffffffff02",
  capacityBrowsableLoad: "ffffffff-ffff-4fff-8fff-ffffffffff03",
  dispatcherProfile: "ffffffff-ffff-4fff-8fff-ffffffffff04",
  landing: "ffffffff-ffff-4fff-8fff-ffffffffff05",
  mill: "ffffffff-ffff-4fff-8fff-ffffffffff06",
  rate: "ffffffff-ffff-4fff-8fff-ffffffffff07",
  route: "ffffffff-ffff-4fff-8fff-ffffffffff08",
  truckProfile: "ffffffff-ffff-4fff-8fff-ffffffffff09",
  truckSlotHost: "ffffffff-ffff-4fff-8fff-ffffffffff10",
  truckSlotStranger: "ffffffff-ffff-4fff-8fff-ffffffffff11"
} as const

/**
 * An authorization test must not inherit permission from the demo seed. Every
 * table is emptied by walking the state's own keys, so a table added later
 * starts empty here too instead of quietly supplying a relationship these tests
 * never declared.
 */
function blankState(): LogLoadsDatabaseState {
  const state = createInMemoryDatabase()

  for (const table of Object.keys(state) as LogLoadsTableName[]) {
    (state[table] as unknown[]).length = 0
  }

  return state
}

function pushUser(state: LogLoadsDatabaseState, id: string, fullName: string): void {
  state.profiles.push(
    userSchema.parse({
      clerkUserId: `clerk_${id}`,
      createdAt: NOW,
      email: `${id}@example.test`,
      fullName,
      id,
      isActive: true,
      phone: "555-0100",
      role: "driver",
      updatedAt: NOW,
      verificationStatus: "verified"
    })
  )
}

function pushOrganization(state: LogLoadsDatabaseState, id: string, slug: string): void {
  state.organizations.push(
    organizationSchema.parse({
      archivedAt: null,
      createdAt: NOW,
      displayName: slug,
      id,
      legalName: `${slug} LLC`,
      primaryRegion: "OR",
      slug,
      type: "landing_source",
      updatedAt: NOW,
      verificationStatus: "verified"
    })
  )
}

function pushMembership(
  state: LogLoadsDatabaseState,
  input: { organizationId: string; role: OrganizationRole; userId: string }
): void {
  state.organizationMemberships.push(
    organizationMembershipSchema.parse({
      createdAt: NOW,
      id: `10101010-1010-4010-8010-${String(state.organizationMemberships.length + 1).padStart(12, "0")}`,
      organizationId: input.organizationId,
      role: input.role,
      status: "active",
      updatedAt: NOW,
      userId: input.userId
    })
  )
}

function pushDriverProfile(state: LogLoadsDatabaseState, id: string, userId: string, companyId: string): void {
  state.driverProfiles.push(
    driverProfileSchema.parse({
      availabilityStatus: "available",
      companyId,
      createdAt: NOW,
      homeBase: "Sweet Home, OR",
      id,
      licenseNumber: "OR-CDL-1",
      updatedAt: NOW,
      userId,
      yearsExperience: 6
    })
  )
}

function pushLoad(
  state: LogLoadsDatabaseState,
  input: { companyId: string; id: string; title: string; visibilityMode: string; capacityId: string }
): void {
  state.loadPostings.push(
    loadPostingSchema.parse({
      companyId: input.companyId,
      createdAt: NOW,
      dailyTruckCountNeeded: 2,
      dispatcherContact: { email: null, name: "Dana Dispatch", phone: "555-0200" },
      dispatcherProfileId: FILLER.dispatcherProfile,
      driverPayCents: 52_500,
      dropoffMillId: FILLER.mill,
      id: input.id,
      loadDate: "2026-07-22",
      loadType: "saw_logs",
      pickupLandingId: FILLER.landing,
      rateId: FILLER.rate,
      roadCondition: "good",
      routeId: FILLER.route,
      scheduleType: "one_off",
      status: "open",
      title: input.title,
      updatedAt: NOW
    })
  )

  state.opportunityCapacities.push(
    opportunityCapacitySchema.parse({
      allocationMode: "request_approval",
      committedTruckloads: 0,
      completedTruckloads: 0,
      createdAt: NOW,
      id: input.capacityId,
      loadPostingId: input.id,
      remainingTruckloads: 2,
      totalTruckloads: 2,
      updatedAt: NOW,
      visibilityMode: input.visibilityMode
    })
  )
}

function pushAssignment(
  state: LogLoadsDatabaseState,
  input: { driverProfileId: string; id: string; loadPostingId: string; truckSlotId: string }
): void {
  state.assignments.push(
    assignmentSchema.parse({
      createdAt: NOW,
      driverProfileId: input.driverProfileId,
      id: input.id,
      loadPostingId: input.loadPostingId,
      requestedAt: NOW,
      status: "accepted",
      truckProfileId: FILLER.truckProfile,
      truckSlotId: input.truckSlotId,
      updatedAt: NOW
    })
  )
}

/**
 * One live haul (a carrier driver on a host's load) plus a completely separate
 * organization running its own private work. The two sides share nothing, which
 * is what makes them usable as a negative control.
 */
function operatingState(): LogLoadsDatabaseState {
  const state = blankState()

  pushOrganization(state, ORG_HOST, "north-pine")
  pushOrganization(state, ORG_CARRIER, "coastline-hauling")
  pushOrganization(state, ORG_STRANGER, "blackridge")

  pushUser(state, DRIVER_USER, "Hank Hauler")
  pushUser(state, HOST_DISPATCHER_USER, "Dana Dispatch")
  pushUser(state, HOST_BILLING_USER, "Bev Billing")
  pushUser(state, HOST_LANDING_MANAGER_USER, "Lena Landing")
  pushUser(state, STRANGER_USER, "Sam Stranger")
  pushUser(state, STRANGER_DRIVER_USER, "Dev Distant")

  pushMembership(state, { organizationId: ORG_CARRIER, role: "driver", userId: DRIVER_USER })
  pushMembership(state, { organizationId: ORG_HOST, role: "dispatcher", userId: HOST_DISPATCHER_USER })
  pushMembership(state, { organizationId: ORG_HOST, role: "billing", userId: HOST_BILLING_USER })
  pushMembership(state, { organizationId: ORG_HOST, role: "landing_manager", userId: HOST_LANDING_MANAGER_USER })
  pushMembership(state, { organizationId: ORG_STRANGER, role: "owner", userId: STRANGER_USER })

  pushDriverProfile(state, DRIVER_PROFILE, DRIVER_USER, ORG_CARRIER)
  pushDriverProfile(state, STRANGER_DRIVER_PROFILE, STRANGER_DRIVER_USER, ORG_STRANGER)

  pushLoad(state, {
    capacityId: FILLER.capacityHostLoad,
    companyId: ORG_HOST,
    id: HOST_LOAD,
    title: "Cedar ridge saw logs",
    visibilityMode: "open_network"
  })
  pushLoad(state, {
    capacityId: FILLER.capacityPrivateLoad,
    companyId: ORG_STRANGER,
    id: PRIVATE_LOAD,
    title: PRIVATE_LOAD_TITLE,
    visibilityMode: "private_network"
  })
  pushLoad(state, {
    capacityId: FILLER.capacityBrowsableLoad,
    companyId: ORG_STRANGER,
    id: BROWSABLE_LOAD,
    title: "Blackridge open pulpwood run",
    visibilityMode: "open_network"
  })

  pushAssignment(state, {
    driverProfileId: DRIVER_PROFILE,
    id: HOST_ASSIGNMENT,
    loadPostingId: HOST_LOAD,
    truckSlotId: FILLER.truckSlotHost
  })
  pushAssignment(state, {
    driverProfileId: STRANGER_DRIVER_PROFILE,
    id: STRANGER_ASSIGNMENT,
    loadPostingId: PRIVATE_LOAD,
    truckSlotId: FILLER.truckSlotStranger
  })

  return state
}

function writeCounts(state: LogLoadsDatabaseState): Record<string, number> {
  return {
    events: state.messageEvents.length,
    notifications: state.notifications.length,
    threads: state.messageThreads.length
  }
}

describe("createThread authorization", () => {
  it("refuses a thread between users who share no assignment or load", () => {
    const state = operatingState()
    const before = writeCounts(state)

    expect(() =>
      createThread(state, {
        body: "Hey, unrelated person.",
        creatorUserId: DRIVER_USER,
        participantUserIds: [STRANGER_USER],
        subject: "Cold open"
      })
    ).toThrow(/share active work/i)

    expect(writeCounts(state)).toEqual(before)
  })

  it("refuses the reverse direction too — an outsider cannot reach a driver", () => {
    const state = operatingState()

    expect(() =>
      createThread(state, {
        body: "Come haul for me instead.",
        creatorUserId: STRANGER_USER,
        participantUserIds: [DRIVER_USER],
        subject: "Poaching"
      })
    ).toThrow(/share active work/i)

    expect(state.notifications).toHaveLength(0)
  })

  it("refuses a load context the creator cannot see, and leaks no title", () => {
    const state = operatingState()
    const before = writeCounts(state)

    // The participant is legitimate; only the cited load is someone else's. The
    // thread's context label renders "Load - <title>" back to the creator, so a
    // load the creator cannot read must be refused outright.
    let message = ""

    try {
      createThread(state, {
        body: "What is this load?",
        creatorUserId: DRIVER_USER,
        loadPostingId: PRIVATE_LOAD,
        participantUserIds: [HOST_DISPATCHER_USER],
        subject: "Probe"
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toMatch(/load not found/i)
    expect(message).not.toContain(PRIVATE_LOAD_TITLE)
    expect(writeCounts(state)).toEqual(before)
    expect(listThreadsForUser(state, DRIVER_USER)).toHaveLength(0)
  })

  it("refuses an assignment the creator is not party to", () => {
    const state = operatingState()
    const before = writeCounts(state)

    expect(() =>
      createThread(state, {
        assignmentId: STRANGER_ASSIGNMENT,
        body: "About that haul of yours.",
        creatorUserId: DRIVER_USER,
        participantUserIds: [HOST_DISPATCHER_USER],
        subject: "Probe"
      })
    ).toThrow(/not shared work/i)

    expect(writeCounts(state)).toEqual(before)
  })

  it("refuses a load that does not belong to the cited assignment", () => {
    const state = operatingState()

    expect(() =>
      createThread(state, {
        assignmentId: HOST_ASSIGNMENT,
        body: "Mislabelled context.",
        creatorUserId: DRIVER_USER,
        loadPostingId: BROWSABLE_LOAD,
        participantUserIds: [HOST_DISPATCHER_USER],
        subject: "Mismatch"
      })
    ).toThrow(/does not belong to that assignment/i)

    expect(state.messageThreads).toHaveLength(0)
  })

  it("refuses a publishing-side member whose role is not an operating contact", () => {
    const state = operatingState()

    // `billing` holds no publish/landing/destination capability, so it is not an
    // inbox a hauler may open from the outside.
    expect(() =>
      createThread(state, {
        assignmentId: HOST_ASSIGNMENT,
        body: "Invoice question.",
        creatorUserId: DRIVER_USER,
        loadPostingId: HOST_LOAD,
        participantUserIds: [HOST_BILLING_USER],
        subject: "Billing"
      })
    ).toThrow(/share active work/i)

    expect(state.messageThreads).toHaveLength(0)
  })

  it("exposes exactly the publishing-side roles the messages page offers, and no others", () => {
    const reachableRoles: OrganizationRole[] = []

    for (const [index, role] of ORGANIZATION_ROLES.entries()) {
      const state = operatingState()
      const userId = `70707070-7070-4070-8070-${String(index + 1).padStart(12, "0")}`

      pushUser(state, userId, `Member ${role}`)
      pushMembership(state, { organizationId: ORG_HOST, role, userId })

      try {
        createThread(state, {
          assignmentId: HOST_ASSIGNMENT,
          body: "Role probe.",
          creatorUserId: DRIVER_USER,
          loadPostingId: HOST_LOAD,
          participantUserIds: [userId],
          subject: "Role probe"
        })
        reachableRoles.push(role)
      } catch {
        // Refused: this role is not an operating contact for an outside hauler.
      }
    }

    // Written out on purpose. This is the canary on the permission-matrix
    // derivation and on its agreement with the list the messages page offers
    // (apps/web/lib/messages-data.ts): a wider set here means strangers gained an
    // inbox the product never advertised, a narrower one means the UI offers a
    // person the server will refuse.
    expect(reachableRoles).toEqual(["owner", "admin", "dispatcher", "landing_manager", "destination_manager"])
  })

  it("refuses once the shared assignment reaches a terminal status", () => {
    const state = operatingState()
    const assignment = state.assignments.find((candidate) => candidate.id === HOST_ASSIGNMENT)

    expect(assignment).toBeDefined()
    assignment!.status = "completed"

    expect(() =>
      createThread(state, {
        assignmentId: HOST_ASSIGNMENT,
        body: "One more thing.",
        creatorUserId: DRIVER_USER,
        loadPostingId: HOST_LOAD,
        participantUserIds: [HOST_DISPATCHER_USER],
        subject: "After the fact"
      })
    ).toThrow(/share active work/i)

    expect(state.messageThreads).toHaveLength(0)
  })

  it("refuses a suspended membership on the publishing side", () => {
    const state = operatingState()
    const membership = state.organizationMemberships.find(
      (candidate) => candidate.userId === HOST_DISPATCHER_USER
    )

    expect(membership).toBeDefined()
    membership!.status = "removed"

    expect(() =>
      createThread(state, {
        assignmentId: HOST_ASSIGNMENT,
        body: "Still there?",
        creatorUserId: DRIVER_USER,
        loadPostingId: HOST_LOAD,
        participantUserIds: [HOST_DISPATCHER_USER],
        subject: "Removed member"
      })
    ).toThrow(/share active work/i)
  })

  it("refuses a thread that smuggles an unrelated user in alongside a permitted one", () => {
    const state = operatingState()

    expect(() =>
      createThread(state, {
        assignmentId: HOST_ASSIGNMENT,
        body: "Adding a guest.",
        creatorUserId: DRIVER_USER,
        loadPostingId: HOST_LOAD,
        participantUserIds: [HOST_DISPATCHER_USER, STRANGER_USER],
        subject: "Smuggled"
      })
    ).toThrow(/share active work/i)

    expect(state.messageThreads).toHaveLength(0)
  })
})

describe("createThread on the legitimate operating path", () => {
  it("lets an assigned driver open a thread with the load's dispatcher", () => {
    const state = operatingState()

    const thread = createThread(state, {
      assignmentId: HOST_ASSIGNMENT,
      body: "Running 20 minutes behind the appointment.",
      creatorUserId: DRIVER_USER,
      loadPostingId: HOST_LOAD,
      participantUserIds: [HOST_DISPATCHER_USER],
      subject: "Arrival window"
    })

    expect(thread.participantUserIds).toEqual([DRIVER_USER, HOST_DISPATCHER_USER])
    expect(state.messageEvents).toHaveLength(1)
    expect(state.notifications).toHaveLength(1)
    expect(state.notifications[0]?.userId).toBe(HOST_DISPATCHER_USER)
    expect(listThreadsForUser(state, HOST_DISPATCHER_USER)[0]?.contextLabel).toBe("Assignment - Cedar ridge saw logs")
  })

  it("lets the driver reach a landing manager on the publishing side", () => {
    const state = operatingState()

    const thread = createThread(state, {
      assignmentId: HOST_ASSIGNMENT,
      body: "Which gate is open this morning?",
      creatorUserId: DRIVER_USER,
      loadPostingId: HOST_LOAD,
      participantUserIds: [HOST_LANDING_MANAGER_USER],
      subject: "Gate access"
    })

    expect(thread.participantUserIds).toContain(HOST_LANDING_MANAGER_USER)
  })

  it("lets the publisher open a thread with the driver committed to its load", () => {
    const state = operatingState()

    const thread = createThread(state, {
      assignmentId: HOST_ASSIGNMENT,
      body: "Scale house closes at four today.",
      creatorUserId: HOST_DISPATCHER_USER,
      loadPostingId: HOST_LOAD,
      participantUserIds: [DRIVER_USER],
      subject: "Scale hours"
    })

    expect(thread.participantUserIds).toEqual([HOST_DISPATCHER_USER, DRIVER_USER])
    expect(state.notifications[0]?.userId).toBe(DRIVER_USER)
  })

  it("accepts a load context the creator's organization can already browse", () => {
    const state = operatingState()

    // BROWSABLE_LOAD belongs to another organization but is published to the open
    // network, so naming it as context discloses nothing the creator cannot look
    // up — this is the branch that defers to `isLoadVisibleToOrganization`.
    const thread = createThread(state, {
      body: "Saw your open posting while hauling for North Pine.",
      creatorUserId: DRIVER_USER,
      loadPostingId: BROWSABLE_LOAD,
      participantUserIds: [HOST_DISPATCHER_USER],
      subject: "Open posting"
    })

    expect(thread.loadPostingId).toBe(BROWSABLE_LOAD)
  })

  it("reuses the existing thread instead of opening a duplicate", () => {
    const state = operatingState()
    const input = {
      assignmentId: HOST_ASSIGNMENT,
      creatorUserId: DRIVER_USER,
      loadPostingId: HOST_LOAD,
      participantUserIds: [HOST_DISPATCHER_USER],
      subject: "Arrival window"
    }

    const first = createThread(state, { ...input, body: "First note." })
    const second = createThread(state, { ...input, body: "Second note." })

    expect(second.id).toBe(first.id)
    expect(state.messageThreads).toHaveLength(1)
    expect(state.messageEvents).toHaveLength(2)
  })
})

describe("postMessage participation", () => {
  it("refuses a non-participant and writes nothing", () => {
    const state = operatingState()
    const thread = createThread(state, {
      assignmentId: HOST_ASSIGNMENT,
      body: "Opening note.",
      creatorUserId: DRIVER_USER,
      loadPostingId: HOST_LOAD,
      participantUserIds: [HOST_DISPATCHER_USER],
      subject: "Arrival window"
    })
    const before = writeCounts(state)

    expect(() =>
      postMessage(state, { authorUserId: STRANGER_USER, body: "Butting in.", threadId: thread.id })
    ).toThrow(/participants/i)

    expect(writeCounts(state)).toEqual(before)
  })

  it("lets a participant reply and notifies only the other side", () => {
    const state = operatingState()
    const thread = createThread(state, {
      assignmentId: HOST_ASSIGNMENT,
      body: "Opening note.",
      creatorUserId: DRIVER_USER,
      loadPostingId: HOST_LOAD,
      participantUserIds: [HOST_DISPATCHER_USER],
      subject: "Arrival window"
    })

    postMessage(state, { authorUserId: HOST_DISPATCHER_USER, body: "Understood.", threadId: thread.id })

    expect(state.messageEvents).toHaveLength(2)
    expect(state.notifications.map((notification) => notification.userId)).toEqual([
      HOST_DISPATCHER_USER,
      DRIVER_USER
    ])
  })
})
