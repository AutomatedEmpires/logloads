import {
  ORGANIZATION_ROLES,
  assignmentSchema,
  driverProfileSchema,
  loadPostingSchema,
  messageThreadSchema,
  opportunityCapacitySchema,
  organizationMembershipSchema,
  organizationSchema,
  userSchema,
  type OrganizationRole
} from "@logloads/contracts"
import { createInMemoryDatabase, type LogLoadsDatabaseState, type LogLoadsTableName } from "@logloads/db"
import { describe, expect, it } from "vitest"

import {
  createThread as createThreadInWorkspace,
  listThreadMessages as listThreadMessagesInWorkspace,
  listThreadsForUser as listThreadsForUserInWorkspace,
  markThreadRead as markThreadReadInWorkspace,
  postMessage as postMessageInWorkspace,
  unreadThreadCounts as unreadThreadCountsInWorkspace
} from "./messaging"

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

function defaultOrganizationIdForUser(userId: string): string {
  if (userId === DRIVER_USER) {
    return ORG_CARRIER
  }

  if (
    userId === HOST_DISPATCHER_USER ||
    userId === HOST_BILLING_USER ||
    userId === HOST_LANDING_MANAGER_USER
  ) {
    return ORG_HOST
  }

  return ORG_STRANGER
}

interface TestCreateThreadInput {
  assignmentId?: string | null
  body: string
  creatorUserId: string
  loadPostingId?: string | null
  organizationId?: string
  participantUserIds: string[]
  subject: string
}

interface TestPostMessageInput {
  authorUserId: string
  body: string
  organizationId?: string
  threadId: string
}

function createThread(
  state: LogLoadsDatabaseState,
  input: TestCreateThreadInput
) {
  return createThreadInWorkspace(state, {
    ...input,
    organizationId: input.organizationId ?? defaultOrganizationIdForUser(input.creatorUserId)
  })
}

function listThreadsForUser(
  state: LogLoadsDatabaseState,
  userId: string,
  organizationId = defaultOrganizationIdForUser(userId)
) {
  return listThreadsForUserInWorkspace(state, userId, organizationId)
}

function listThreadMessages(
  state: LogLoadsDatabaseState,
  threadId: string,
  userId: string,
  organizationId = defaultOrganizationIdForUser(userId)
) {
  return listThreadMessagesInWorkspace(state, threadId, userId, organizationId)
}

function postMessage(
  state: LogLoadsDatabaseState,
  input: TestPostMessageInput
) {
  return postMessageInWorkspace(state, {
    ...input,
    organizationId: input.organizationId ?? defaultOrganizationIdForUser(input.authorUserId)
  })
}

function unreadThreadCounts(
  state: LogLoadsDatabaseState,
  userId: string,
  organizationId = defaultOrganizationIdForUser(userId)
) {
  return unreadThreadCountsInWorkspace(state, userId, organizationId)
}

function markThreadRead(
  state: LogLoadsDatabaseState,
  input: Omit<Parameters<typeof markThreadReadInWorkspace>[1], "organizationId"> & {
    organizationId?: string
  }
) {
  return markThreadReadInWorkspace(state, {
    ...input,
    organizationId: input.organizationId ?? defaultOrganizationIdForUser(input.userId)
  })
}

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
  it("refuses contextless creation even when the users share active work", () => {
    const state = operatingState()
    const before = structuredClone(state)

    expect(() =>
      createThread(state, {
        body: "This must not acquire authority from current memberships.",
        creatorUserId: DRIVER_USER,
        participantUserIds: [HOST_DISPATCHER_USER],
        subject: "No durable context"
      })
    ).toThrow(/must identify shared work/i)
    expect(state).toEqual(before)
  })

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
    ).toThrow(/shar.*work/i)

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
    ).toThrow(/shar.*work/i)

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

  it("does not treat browse permission as organization authority for a load-only thread", () => {
    const state = operatingState()
    const before = writeCounts(state)

    expect(() =>
      createThread(state, {
        body: "Saw your open posting while hauling for North Pine.",
        creatorUserId: DRIVER_USER,
        loadPostingId: BROWSABLE_LOAD,
        participantUserIds: [HOST_DISPATCHER_USER],
        subject: "Open posting"
      })
    ).toThrow(/Conversation not found/)

    expect(writeCounts(state)).toEqual(before)
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

describe("organization-level messaging lock", () => {
  it.each(["rejected", "suspended"] as const)(
    "removes a %s hauler from thread reads and writes without mutating history",
    (verificationStatus) => {
      const state = operatingState()
      const thread = createThread(state, {
        assignmentId: HOST_ASSIGNMENT,
        body: "Scale house closes at four today.",
        creatorUserId: HOST_DISPATCHER_USER,
        loadPostingId: HOST_LOAD,
        participantUserIds: [DRIVER_USER],
        subject: "Scale hours"
      })
      const carrier = state.organizations.find((organization) => organization.id === ORG_CARRIER)

      if (!carrier) {
        throw new Error("Carrier organization fixture missing")
      }

      carrier.verificationStatus = verificationStatus
      const before = structuredClone(state)

      expect(listThreadsForUser(state, DRIVER_USER)).toEqual([])
      expect(listThreadsForUser(state, HOST_DISPATCHER_USER).map((view) => view.id)).toContain(thread.id)
      expect(() => listThreadMessages(state, thread.id, DRIVER_USER)).toThrow(/Conversation not found/)
      const beforeUndeliverableReply = structuredClone(state)
      expect(() => postMessage(state, {
        authorUserId: HOST_DISPATCHER_USER,
        body: "This must not look delivered when nobody can receive it.",
        threadId: thread.id
      })).toThrow(/participants.*available/i)
      expect(state).toEqual(beforeUndeliverableReply)
      expect(() => postMessage(state, {
        authorUserId: DRIVER_USER,
        body: "I should not be able to operate here.",
        threadId: thread.id
      })).toThrow(/Conversation not found/)
      expect(() => markThreadRead(state, { threadId: thread.id, userId: DRIVER_USER })).toThrow(
        /Conversation not found/
      )
      expect(unreadThreadCounts(state, DRIVER_USER)).toEqual({})
      expect(state).toEqual(before)
    }
  )

  it("does not let a second usable workspace reopen a thread authorized through a locked one", () => {
    const state = operatingState()
    const thread = createThread(state, {
      body: "Scale house closes at four today.",
      creatorUserId: HOST_DISPATCHER_USER,
      loadPostingId: HOST_LOAD,
      participantUserIds: [DRIVER_USER],
      subject: "Scale hours"
    })
    const carrier = state.organizations.find((organization) => organization.id === ORG_CARRIER)

    if (!carrier) {
      throw new Error("Carrier organization fixture missing")
    }

    pushMembership(state, {
      organizationId: ORG_STRANGER,
      role: "viewer",
      userId: DRIVER_USER
    })
    carrier.verificationStatus = "suspended"
    const before = structuredClone(state)

    expect(listThreadsForUser(state, DRIVER_USER)).toEqual([])
    expect(() => postMessage(state, {
      authorUserId: DRIVER_USER,
      body: "Unrelated workspace must not be a bypass.",
      threadId: thread.id
    })).toThrow(/Conversation not found/)
    expect(state).toEqual(before)
  })

  it("preserves a historical contextless thread but refuses every read and write", () => {
    const state = operatingState()
    const thread = messageThreadSchema.parse({
      archivedAt: null,
      assignmentId: null,
      createdAt: NOW,
      id: "90909090-9090-4090-8090-909090909090",
      lastMessageAt: null,
      loadPostingId: null,
      participantUserIds: [HOST_DISPATCHER_USER, HOST_LANDING_MANAGER_USER],
      subject: "Shared workspace operations",
      updatedAt: NOW
    })
    state.messageThreads.push(thread)
    const before = structuredClone(state)

    expect(listThreadsForUser(state, HOST_DISPATCHER_USER)).toEqual([])
    expect(() => listThreadMessages(state, thread.id, HOST_DISPATCHER_USER)).toThrow(
      /Conversation not found/
    )
    expect(() => postMessage(state, {
      authorUserId: HOST_DISPATCHER_USER,
      body: "A current membership must not rebind historical private text.",
      threadId: thread.id
    })).toThrow(/Conversation not found/)
    expect(() => markThreadRead(state, {
      threadId: thread.id,
      userId: HOST_DISPATCHER_USER
    })).toThrow(/Conversation not found/)
    expect(unreadThreadCounts(state, HOST_DISPATCHER_USER)).toEqual({})
    expect(state).toEqual(before)
  })

  it("keeps every message operation exact to the selected workspace for a multi-workspace user", () => {
    const state = operatingState()
    pushMembership(state, {
      organizationId: ORG_STRANGER,
      role: "dispatcher",
      userId: HOST_DISPATCHER_USER
    })
    pushMembership(state, {
      organizationId: ORG_STRANGER,
      role: "driver",
      userId: STRANGER_DRIVER_USER
    })

    const hostThread = createThread(state, {
      assignmentId: HOST_ASSIGNMENT,
      body: "Host workspace thread.",
      creatorUserId: HOST_DISPATCHER_USER,
      loadPostingId: HOST_LOAD,
      organizationId: ORG_HOST,
      participantUserIds: [DRIVER_USER],
      subject: "Host work"
    })
    const beforeWrongCreate = structuredClone(state)

    expect(() => createThread(state, {
      assignmentId: STRANGER_ASSIGNMENT,
      body: "Wrong workspace must not reach this assignment.",
      creatorUserId: HOST_DISPATCHER_USER,
      loadPostingId: PRIVATE_LOAD,
      organizationId: ORG_HOST,
      participantUserIds: [STRANGER_DRIVER_USER],
      subject: "Cross-workspace probe"
    })).toThrow(/shar.*work/i)
    expect(state).toEqual(beforeWrongCreate)

    const strangerThread = createThread(state, {
      assignmentId: STRANGER_ASSIGNMENT,
      body: "Separate workspace thread.",
      creatorUserId: HOST_DISPATCHER_USER,
      loadPostingId: PRIVATE_LOAD,
      organizationId: ORG_STRANGER,
      participantUserIds: [STRANGER_DRIVER_USER],
      subject: "Stranger work"
    })
    postMessage(state, {
      authorUserId: STRANGER_DRIVER_USER,
      body: "Reply within the selected workspace.",
      organizationId: ORG_STRANGER,
      threadId: strangerThread.id
    })

    expect(listThreadsForUser(state, HOST_DISPATCHER_USER, ORG_HOST).map((thread) => thread.id)).toEqual([
      hostThread.id
    ])
    expect(listThreadsForUser(state, HOST_DISPATCHER_USER, ORG_STRANGER).map((thread) => thread.id)).toEqual([
      strangerThread.id
    ])
    expect(unreadThreadCounts(state, HOST_DISPATCHER_USER, ORG_HOST)).toEqual({})
    expect(unreadThreadCounts(state, HOST_DISPATCHER_USER, ORG_STRANGER)).toEqual({
      [strangerThread.id]: 1
    })

    const beforeWrongOperations = structuredClone(state)

    expect(() => listThreadMessages(
      state,
      strangerThread.id,
      HOST_DISPATCHER_USER,
      ORG_HOST
    )).toThrow(/Conversation not found/)
    expect(() => postMessage(state, {
      authorUserId: HOST_DISPATCHER_USER,
      body: "Wrong selected workspace.",
      organizationId: ORG_HOST,
      threadId: strangerThread.id
    })).toThrow(/Conversation not found/)
    expect(() => markThreadRead(state, {
      organizationId: ORG_HOST,
      threadId: strangerThread.id,
      userId: HOST_DISPATCHER_USER
    })).toThrow(/Conversation not found/)
    expect(state).toEqual(beforeWrongOperations)

    expect(markThreadRead(state, {
      organizationId: ORG_STRANGER,
      threadId: strangerThread.id,
      userId: HOST_DISPATCHER_USER
    })).toBe(1)
  })

  it.each([
    {
      label: "an inactive participant",
      mutate: (state: LogLoadsDatabaseState) => {
        const user = state.profiles.find((profile) => profile.id === DRIVER_USER)
        if (!user) throw new Error("Driver user fixture missing")
        user.isActive = false
      }
    },
    {
      label: "duplicate active memberships",
      mutate: (state: LogLoadsDatabaseState) => {
        const membership = state.organizationMemberships.find(
          (candidate) =>
            candidate.userId === DRIVER_USER &&
            candidate.organizationId === ORG_CARRIER
        )
        if (!membership) throw new Error("Driver membership fixture missing")
        state.organizationMemberships.push({
          ...membership,
          id: "10101010-1010-4010-8010-000000000099"
        })
      }
    },
    {
      label: "an archived thread",
      mutate: (state: LogLoadsDatabaseState, threadId: string) => {
        const thread = state.messageThreads.find((candidate) => candidate.id === threadId)
        if (!thread) throw new Error("Message thread fixture missing")
        thread.archivedAt = NOW
      }
    }
  ])("fails closed for $label on direct-ID operations", ({ mutate }) => {
    const state = operatingState()
    const thread = createThread(state, {
      assignmentId: HOST_ASSIGNMENT,
      body: "Arrival note.",
      creatorUserId: HOST_DISPATCHER_USER,
      loadPostingId: HOST_LOAD,
      participantUserIds: [DRIVER_USER],
      subject: "Arrival"
    })
    mutate(state, thread.id)
    const before = structuredClone(state)

    expect(() => listThreadMessages(state, thread.id, DRIVER_USER)).toThrow(/Conversation not found/)
    expect(() => postMessage(state, {
      authorUserId: DRIVER_USER,
      body: "Refused direct-ID write.",
      threadId: thread.id
    })).toThrow(/Conversation not found/)
    expect(() => markThreadRead(state, { threadId: thread.id, userId: DRIVER_USER })).toThrow(
      /Conversation not found/
    )
    expect(state).toEqual(before)
  })
})
