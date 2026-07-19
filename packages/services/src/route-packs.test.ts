import { organizationMembershipSchema } from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices, type LogLoadsServices } from "./index"
import { stubTripDocumentMedia } from "./test-helpers"

const HAULER_ORG = "33333333-3333-4333-8333-333333333331"
const HOST_ORG = "33333333-3333-4333-8333-333333333332"
const HAULER_DRIVER_ACTOR = "22222222-2222-4222-8222-222222222221"
const HOST_OWNER = "22222222-2222-4222-8222-222222222223"
const HOST_DISPATCHER = "22222222-2222-4222-8222-222222222224"
const DRIVER_PROFILE = "44444444-4444-4444-8444-444444444441"
const TRUCK_PROFILE = "77777777-7777-4777-8777-777777777771"
const TRAILER_PROFILE = "88888888-8888-4888-8888-888888888881"

const LOAD_DATE = "2026-06-25"
const WINDOW = `${LOAD_DATE}T12:00:00.000Z`

/**
 * A load published through the real service — never seed data — so these prove
 * the runtime path a host and driver actually take.
 */
function publishRuntimeLoad(services: LogLoadsServices, overrides: Record<string, unknown> = {}) {
  const load = services.createLoadPostingWithPolicy({
    accessRequirements: [],
    actorUserId: HOST_OWNER,
    campaignEndDate: null,
    campaignStartDate: null,
    companyId: HOST_ORG,
    dailyTruckCountNeeded: 1,
    dispatcherContact: { email: "dispatch@summit.example", name: "Cole Cedar", phone: "555-3001" },
    dispatcherProfileId: "55555555-5555-4555-8555-555555555553",
    dropoffMillId: "99999999-9999-4999-8999-999999999991",
    equipmentRequirements: ["pole-trailer"],
    estimatedTonsPerLoad: 27,
    loadDate: LOAD_DATE,
    loadType: "saw_logs",
    loaderContact: null,
    loaderProfileId: null,
    organizationId: HOST_ORG,
    pickupLandingId: "66666666-6666-4666-8666-666666666662",
    rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
    recurringSchedule: null,
    roadCondition: "good",
    routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    scheduleType: "one_off",
    status: "open",
    title: "Route pack runtime load",
    weatherNotes: null,
    ...overrides
  })
  const slot = services.state.truckSlots.find((candidate) => candidate.loadPostingId === load.id)

  if (!slot) {
    throw new Error("The runtime load fixture did not create a loading slot")
  }

  services.upsertAvailabilityWindow({
    driverProfileId: DRIVER_PROFILE,
    endAt: `${LOAD_DATE}T23:59:00.000Z`,
    notes: "Route pack fixture window.",
    preferredRouteIds: [],
    recurringSchedule: null,
    startAt: `${LOAD_DATE}T00:00:00.000Z`,
    status: "available",
    truckProfileId: TRUCK_PROFILE
  })

  return { load, slot }
}

function requestRuntimeLoad(services: LogLoadsServices, loadPostingId: string, truckSlotId: string) {
  return services.requestCapacityWithPolicy({
    actorUserId: HAULER_DRIVER_ACTOR,
    driverProfileId: DRIVER_PROFILE,
    loadPostingId,
    organizationId: HAULER_ORG,
    trailerProfileId: TRAILER_PROFILE,
    truckProfileId: TRUCK_PROFILE,
    truckSlotId
  }, { at: WINDOW })
}

function bookRuntimeHaul(services: LogLoadsServices) {
  const { load, slot } = publishRuntimeLoad(services)
  const assignment = requestRuntimeLoad(services, load.id, slot.id)
  const approved = services.approveCapacityRequest({
    actorUserId: HOST_OWNER,
    assignmentId: assignment.id,
    organizationId: HOST_ORG
  })

  return { assignment, load, slot, trip: approved.trip }
}

function driverPack(services: LogLoadsServices, assignmentId: string) {
  return services.getRoutePackForAssignment({
    actorUserId: HAULER_DRIVER_ACTOR,
    assignmentId,
    organizationId: HAULER_ORG
  })
}

describe("route pack generation", () => {
  it("mints an assignment-specific pack when the host approves a runtime load", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { assignment, load, trip } = bookRuntimeHaul(services)

    const packs = services.state.routePacks.filter((pack) => pack.assignmentId === assignment.id)

    expect(packs).toHaveLength(1)
    expect(packs[0]?.version).toBe(1)
    expect(packs[0]?.loadPostingId).toBe(load.id)
    expect(packs[0]?.visibility).toBe("assigned_only")
    // Nothing serves these offline yet; the pack must not claim otherwise.
    expect(packs[0]?.cacheableOffline).toBe(false)
    expect(trip.routePackId).toBe(packs[0]?.id)
  })

  it("snapshots the operational facts that governed the accepted haul", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { assignment, slot } = bookRuntimeHaul(services)
    const { routePack } = driverPack(services, assignment.id)
    const snapshot = routePack.snapshot

    expect(snapshot).toBeTruthy()
    expect(snapshot?.driverName).toBe("Hank Hauler")
    expect(snapshot?.hostOrganizationName).toBeTruthy()
    expect(snapshot?.contactName).toBe("Cole Cedar")
    expect(snapshot?.haulWindowStartAt).toBe(slot.startAt)
    expect(snapshot?.haulWindowEndAt).toBe(slot.endAt)
    expect(snapshot?.materialType).toBe("saw_logs")
    expect(snapshot?.estimatedTonsPerLoad).toBe(27)
    expect(snapshot?.equipmentRequirements).toContain("pole-trailer")
    expect(snapshot?.routeDistanceMiles).toBeGreaterThan(0)
    expect(snapshot?.originName).toBeTruthy()
    expect(snapshot?.destinationName).toBeTruthy()

    // The landing's exact entrance and gate rules ride in the pack, which only
    // the assigned driver can open.
    expect(snapshot?.originEntranceLat).toBeTypeOf("number")
    expect(routePack.localInstructions.some((entry) => entry.title === "Gate access")).toBe(true)
    expect(routePack.localInstructions.some((entry) => entry.title === "Scale and ticket")).toBe(true)
    expect(routePack.localInstructions.some((entry) => entry.title === "Safety and PPE")).toBe(true)

    // Completion evidence rides in the snapshot and renders in its own section;
    // duplicating it as an instruction makes a driver read it twice.
    expect(snapshot?.completionEvidence.length).toBeGreaterThan(0)
    expect(routePack.localInstructions.some((entry) => entry.title === "Completion evidence")).toBe(false)
  })

  it("fails closed for a legacy posting whose dispatcher belongs to another organization", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { load, slot } = publishRuntimeLoad(services)
    const foreignDispatcher = services.state.dispatcherProfiles.find(
      (profile) => profile.companyId === HAULER_ORG
    )

    expect(foreignDispatcher).toBeDefined()
    if (!foreignDispatcher) return

    // Simulate a stored pre-guard posting. New publications cannot create this
    // state, but readers and notification paths must remain safe until old data
    // is repaired.
    load.dispatcherProfileId = foreignDispatcher.id
    load.dispatcherContact = foreignDispatcher.contact

    const assignment = requestRuntimeLoad(services, load.id, slot.id)

    expect(services.state.notifications.some(
      (notification) =>
        notification.relatedEntityId === assignment.id &&
        notification.userId === foreignDispatcher.userId
    )).toBe(false)

    services.approveCapacityRequest({
      actorUserId: HOST_OWNER,
      assignmentId: assignment.id,
      organizationId: HOST_ORG
    })

    const snapshot = driverPack(services, assignment.id).routePack.snapshot

    expect(snapshot?.contactEmail).toBeNull()
    expect(snapshot?.contactName).toBeNull()
    expect(snapshot?.contactPhone).toBeNull()
  })

  it("treats a completion-evidence change as material even though it is not an instruction", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { assignment } = bookRuntimeHaul(services)

    services.state.destinationFacilities = services.state.destinationFacilities.map((facility) =>
      facility.millId === "99999999-9999-4999-8999-999999999991"
        ? { ...facility, completionEvidence: ["signed bill of lading only"] }
        : facility
    )

    const refreshed = services.refreshRoutePackForAssignment({
      actorUserId: HOST_OWNER,
      assignmentId: assignment.id,
      organizationId: HOST_ORG
    })

    expect(refreshed.changed).toBe(true)
    expect(refreshed.routePack.snapshot?.completionEvidence).toEqual(["signed bill of lading only"])
  })

  it("keeps the driver's snapshot when the load changes underneath it", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { assignment } = bookRuntimeHaul(services)
    const before = driverPack(services, assignment.id).routePack

    // A host edits the landing after the haul was accepted.
    services.state.richLandingDetails = services.state.richLandingDetails.map((details) =>
      details.landingId === "66666666-6666-4666-8666-666666666662"
        ? { ...details, gateInstructions: "TOTALLY DIFFERENT GATE" }
        : details
    )

    const after = driverPack(services, assignment.id).routePack

    // Same version, same instructions: the pack is a snapshot, not a live read.
    expect(after.version).toBe(before.version)
    expect(after.localInstructions).toEqual(before.localInstructions)
    expect(after.localInstructions.some((entry) => entry.detail === "TOTALLY DIFFERENT GATE")).toBe(false)
  })

  it("is idempotent: a replayed approval reuses the pack instead of minting a second", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { assignment } = bookRuntimeHaul(services)
    const first = driverPack(services, assignment.id).routePack

    // A compare-and-swap conflict replays the whole mutation against a freshly
    // loaded document, where the assignment is still "requested" — the guard
    // that matters is the pack lookup, not the status check that precedes it.
    services.state.assignments = services.state.assignments.map((current) =>
      current.id === assignment.id ? { ...current, assignedAt: null, status: "requested" as const } : current
    )

    const replayed = services.approveCapacityRequest({
      actorUserId: HOST_OWNER,
      assignmentId: assignment.id,
      organizationId: HOST_ORG
    })
    const packs = services.state.routePacks.filter((pack) => pack.assignmentId === assignment.id)

    expect(packs).toHaveLength(1)
    expect(packs[0]?.id).toBe(first.id)
    expect(replayed.trip.routePackId).toBe(first.id)
  })

  it("generates without landing or destination records rather than failing the approval", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    // A load whose landing has no rich detail and whose mill has no facility
    // record: the haul is still bookable and the pack still generates.
    services.state.richLandingDetails = []
    services.state.destinationFacilities = []

    const { assignment } = bookRuntimeHaul(services)
    const { routePack } = driverPack(services, assignment.id)

    expect(routePack.snapshot?.originName).toBeTruthy()
    expect(routePack.calculatedRouteSummary.length).toBeGreaterThan(0)
    // No invented certainty: absent sources contribute no instructions.
    expect(routePack.localInstructions.some((entry) => entry.title === "Gate access")).toBe(false)
    expect(routePack.snapshot?.destinationReceivingHours).toBeNull()
  })
})

describe("route pack access", () => {
  it("opens for the assigned driver and the host, and refuses everyone else", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { assignment } = bookRuntimeHaul(services)

    expect(driverPack(services, assignment.id).routePack.assignmentId).toBe(assignment.id)

    expect(services.getRoutePackForAssignment({
      actorUserId: HOST_DISPATCHER,
      assignmentId: assignment.id,
      organizationId: HOST_ORG
    }).routePack.assignmentId).toBe(assignment.id)

    // Another driver in the hauling organization has no operational need.
    const otherDriver = services.state.organizationMemberships.find((membership) =>
      membership.organizationId === HAULER_ORG &&
      membership.role === "driver" &&
      membership.status === "active" &&
      membership.userId !== HAULER_DRIVER_ACTOR
    )

    expect(otherDriver).toBeDefined()
    if (!otherDriver) return

    expect(() => services.getRoutePackForAssignment({
      actorUserId: otherDriver.userId,
      assignmentId: assignment.id,
      organizationId: HAULER_ORG
    })).toThrow(/Only the assigned driver/)
  })

  it("refuses members with no operational need on either side of the haul", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { assignment } = bookRuntimeHaul(services)

    // A pack carries the entrance pin and gate codes. Being in a participating
    // organization is not a reason to see them — viewer and billing hold no
    // view_private_location, on the hauling side or the host's.
    const denied: Array<[string, string, string]> = [
      ["hauler viewer", "viewer", HAULER_ORG],
      ["hauler billing", "billing", HAULER_ORG],
      ["host viewer", "viewer", HOST_ORG],
      ["host billing", "billing", HOST_ORG]
    ]

    denied.forEach(([label, role, organizationId], index) => {
      const userId = `2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c${index.toString().padStart(2, "0")}`

      services.state.organizationMemberships.push(
        organizationMembershipSchema.parse({
          createdAt: "2026-06-05T00:00:00.000Z",
          id: `2d2d2d2d-2d2d-4d2d-8d2d-2d2d2d2d2d${index.toString().padStart(2, "0")}`,
          organizationId,
          role,
          status: "active",
          updatedAt: "2026-06-05T00:00:00.000Z",
          userId
        })
      )

      expect(() => services.getRoutePackForAssignment({
        actorUserId: userId,
        assignmentId: assignment.id,
        organizationId
      }), `${label} must not open the pack`).toThrow()
    })

    // A host dispatcher, who does coordinate the haul, still may.
    expect(services.getRoutePackForAssignment({
      actorUserId: HOST_DISPATCHER,
      assignmentId: assignment.id,
      organizationId: HOST_ORG
    }).routePack.assignmentId).toBe(assignment.id)
  })

  it("refuses an organization that is not part of the haul", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { assignment } = bookRuntimeHaul(services)
    const outsider = services.createAccount({
      accountType: "small_fleet",
      availabilityPreset: "not_ready",
      email: "outside-pack@example.com",
      equipment: null,
      fullName: "Outside Fleet",
      organizationName: "Outside Fleet LLC",
      path: "fleet",
      phone: "555-9400",
      region: "Elsewhere, OR"
    })
    const outsiderOrgId = outsider.memberships[0]?.organization.id

    expect(outsiderOrgId).toBeTruthy()
    if (!outsiderOrgId) return

    expect(() => services.getRoutePackForAssignment({
      actorUserId: outsider.profile.id,
      assignmentId: assignment.id,
      organizationId: outsiderOrgId
    })).toThrow(/not a participant/)
  })

  it("stays locked until the host accepts", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { load, slot } = publishRuntimeLoad(services)
    const assignment = requestRuntimeLoad(services, load.id, slot.id)

    // Pending request: no pack exists and the promise is not yet made.
    expect(services.state.routePacks.some((pack) => pack.assignmentId === assignment.id)).toBe(false)
    expect(() => driverPack(services, assignment.id)).toThrow(/unlocks after the host accepts/)
  })

  it("remains available after the haul is delivered", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { assignment, trip } = bookRuntimeHaul(services)

    // The destination requires a scale ticket; a haul no longer closes without
    // the proof its Route Pack demanded.
    services.attachTripDocument({
      actorUserId: HAULER_DRIVER_ACTOR,
      filename: "scale-ticket.jpg",
      media: stubTripDocumentMedia(trip.id),
      organizationId: HAULER_ORG,
      tripId: trip.id,
      type: "scale_ticket"
    })

    for (const nextStatus of [
      "en_route_to_landing",
      "checked_in",
      "loading",
      "loaded",
      "en_route_to_destination",
      "at_destination",
      "unloading",
      "completed"
    ] as const) {
      services.progressTripStatus({
        actorUserId: HAULER_DRIVER_ACTOR,
        nextStatus,
        organizationId: HAULER_ORG,
        source: "driver",
        tripId: trip.id
      })
    }

    expect(driverPack(services, assignment.id).routePack.assignmentId).toBe(assignment.id)
  })

  it("survives a cancelled haul as history for both sides", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { assignment } = bookRuntimeHaul(services)

    services.cancelAssignmentWithPolicy({
      actorUserId: HOST_OWNER,
      assignmentId: assignment.id,
      organizationId: HOST_ORG,
      reason: "The landing closed."
    })

    // The pack is retained; the host can still inspect what was issued.
    expect(services.state.routePacks.some((pack) => pack.assignmentId === assignment.id)).toBe(true)
    expect(services.getRoutePackForAssignment({
      actorUserId: HOST_OWNER,
      assignmentId: assignment.id,
      organizationId: HOST_ORG
    }).routePack.assignmentId).toBe(assignment.id)
  })
})

describe("route pack material updates", () => {
  it("versions a material change, preserves the old snapshot, and alerts the driver", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { assignment } = bookRuntimeHaul(services)
    const original = driverPack(services, assignment.id).routePack

    services.state.richLandingDetails = services.state.richLandingDetails.map((details) =>
      details.landingId === "66666666-6666-4666-8666-666666666662"
        ? { ...details, gateInstructions: "Gate moved to the north spur after the washout." }
        : details
    )

    const refreshed = services.refreshRoutePackForAssignment({
      actorUserId: HOST_OWNER,
      assignmentId: assignment.id,
      organizationId: HOST_ORG
    })

    expect(refreshed.changed).toBe(true)
    expect(refreshed.routePack.version).toBe(2)

    // The driver now sees v2...
    const current = driverPack(services, assignment.id).routePack
    expect(current.version).toBe(2)
    expect(current.localInstructions.some((entry) => entry.detail.includes("north spur"))).toBe(true)

    // ...and v1 is retained as the record of what governed the haul before.
    const versions = services.listRoutePackVersionsForAssignment({
      actorUserId: HOST_OWNER,
      assignmentId: assignment.id,
      organizationId: HOST_ORG
    })

    expect(versions.map((pack) => pack.version)).toEqual([1, 2])
    expect(versions[0]?.id).toBe(original.id)
    expect(versions[0]?.supersededAt).toBeTruthy()
    expect(versions[0]?.localInstructions).toEqual(original.localInstructions)

    const alert = services.state.notifications.find((notification) =>
      notification.relatedEntityId === assignment.id && notification.title === "Route Pack updated"
    )

    expect(alert?.userId).toBe(HAULER_DRIVER_ACTOR)
  })

  it("does not version or alert when nothing material changed", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { assignment } = bookRuntimeHaul(services)

    const refreshed = services.refreshRoutePackForAssignment({
      actorUserId: HOST_OWNER,
      assignmentId: assignment.id,
      organizationId: HOST_ORG
    })

    expect(refreshed.changed).toBe(false)
    expect(refreshed.routePack.version).toBe(1)
    expect(services.state.routePacks.filter((pack) => pack.assignmentId === assignment.id)).toHaveLength(1)
    expect(services.state.notifications.some((notification) =>
      notification.title === "Route Pack updated"
    )).toBe(false)
  })

  it("issues a first snapshot for a haul booked before packs were per-assignment", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    // ffffffff-...fff1 is a seeded accepted assignment: exactly the state every
    // in-flight haul is in at deploy — no assignment pack, only the host's
    // load-level source.
    const legacyAssignmentId = "ffffffff-ffff-4fff-8fff-fffffffffff1"
    const legacy = services.state.assignments.find((candidate) => candidate.id === legacyAssignmentId)

    expect(legacy).toBeDefined()
    if (!legacy) return

    const load = services.state.loadPostings.find((candidate) => candidate.id === legacy.loadPostingId)
    const hostOrgId = load?.companyId

    expect(hostOrgId).toBeTruthy()
    if (!hostOrgId) return

    expect(services.state.routePacks.some((pack) => pack.assignmentId === legacyAssignmentId)).toBe(false)

    // The host's Re-issue control must repair this, not throw.
    const hostMember = services.state.organizationMemberships.find((membership) =>
      membership.organizationId === hostOrgId &&
      membership.status === "active" &&
      ["owner", "admin", "dispatcher", "landing_manager"].includes(membership.role)
    )

    expect(hostMember).toBeDefined()
    if (!hostMember) return

    const refreshed = services.refreshRoutePackForAssignment({
      actorUserId: hostMember.userId,
      assignmentId: legacyAssignmentId,
      organizationId: hostOrgId
    })

    expect(refreshed.routePack.version).toBe(1)
    expect(refreshed.routePack.assignmentId).toBe(legacyAssignmentId)
    // Pinning what the driver already read is not a change: no false alarm.
    expect(refreshed.changed).toBe(false)
    expect(services.state.notifications.some((notification) =>
      notification.title === "Route Pack updated" && notification.relatedEntityId === legacyAssignmentId
    )).toBe(false)
    expect(services.state.auditEvents.some((event) =>
      event.action === "route_pack_issued" && event.entityId === refreshed.routePack.id
    )).toBe(true)
  })

  it("serves the host's load-level source to a driver whose haul predates snapshots", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const legacyAssignmentId = "ffffffff-ffff-4fff-8fff-fffffffffff1"
    const legacy = services.state.assignments.find((candidate) => candidate.id === legacyAssignmentId)

    expect(legacy).toBeDefined()
    if (!legacy) return

    const driver = services.state.driverProfiles.find((candidate) => candidate.id === legacy.driverProfileId)
    const membership = services.state.organizationMemberships.find((candidate) =>
      candidate.userId === driver?.userId && candidate.status === "active"
    )

    expect(driver).toBeDefined()
    expect(membership).toBeDefined()
    if (!driver || !membership) return

    // No assignment snapshot exists, so the host's source pack is served rather
    // than claiming the host published no briefing.
    const { routePack } = services.getRoutePackForAssignment({
      actorUserId: driver.userId,
      assignmentId: legacyAssignmentId,
      organizationId: membership.organizationId
    })

    expect(routePack.assignmentId).toBeNull()
    expect(routePack.localInstructions.length).toBeGreaterThan(0)
  })

  it("only lets the posting organization update the pack", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { assignment } = bookRuntimeHaul(services)

    // The hauler cannot rewrite the instructions they were issued.
    expect(() => services.refreshRoutePackForAssignment({
      actorUserId: HAULER_DRIVER_ACTOR,
      assignmentId: assignment.id,
      organizationId: HAULER_ORG
    })).toThrow(/cannot publish load/)
  })
})
