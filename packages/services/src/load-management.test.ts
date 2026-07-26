import { loaderProfileSchema, organizationMembershipSchema } from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices, type LogLoadsServices } from "./index"

const HAULER_ORG = "33333333-3333-4333-8333-333333333331"
const HOST_ORG = "33333333-3333-4333-8333-333333333332"
const HAULER_DRIVER_ACTOR = "22222222-2222-4222-8222-222222222221"
const HOST_OWNER = "22222222-2222-4222-8222-222222222223"
const HOST_DISPATCHER = "22222222-2222-4222-8222-222222222224"
const HAULER_LANDING_MANAGER = "22222222-2222-4222-8222-222222222225"
const DRIVER_PROFILE = "44444444-4444-4444-8444-444444444441"
const TRUCK_PROFILE = "77777777-7777-4777-8777-777777777771"
const TRAILER_PROFILE = "88888888-8888-4888-8888-888888888881"

const LOAD_DATE = "2026-06-25"
const WINDOW = `${LOAD_DATE}T12:00:00.000Z`

function postingInput(status: "open" | "draft", overrides: Record<string, unknown> = {}) {
  return {
    companyId: HOST_ORG,
    dispatcherProfileId: "55555555-5555-4555-8555-555555555553",
    loaderProfileId: null,
    pickupLandingId: "66666666-6666-4666-8666-666666666662",
    driverPayCents: 52_500,
    dropoffMillId: "99999999-9999-4999-8999-999999999991",
    routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
    title: "Load management fixture",
    loadType: "saw_logs",
    status,
    scheduleType: "one_off",
    loadDate: LOAD_DATE,
    campaignStartDate: null,
    campaignEndDate: null,
    recurringSchedule: null,
    dailyTruckCountNeeded: 1,
    estimatedTonsPerLoad: 27,
    equipmentRequirements: ["pole-trailer"],
    accessRequirements: [],
    roadCondition: "good",
    weatherNotes: null,
    dispatcherContact: {
      name: "Cole Cedar",
      phone: "555-3001",
      email: "dispatch@summit.example"
    },
    loaderContact: null,
    ...overrides
  }
}

function publishAsOwner(services: LogLoadsServices, status: "open" | "draft" = "open", overrides: Record<string, unknown> = {}) {
  return services.createLoadPostingWithPolicy({
    ...postingInput(status, overrides),
    actorUserId: HOST_OWNER,
    organizationId: HOST_ORG
  })
}

function requestAsHauler(services: LogLoadsServices, loadPostingId: string, truckSlotId: string) {
  services.upsertAvailabilityWindow({
    driverProfileId: DRIVER_PROFILE,
    truckProfileId: TRUCK_PROFILE,
    status: "available",
    startAt: `${LOAD_DATE}T00:00:00.000Z`,
    endAt: `${LOAD_DATE}T23:59:00.000Z`,
    preferredRouteIds: [],
    notes: "Fixture window for load management.",
    recurringSchedule: null
  })

  return services.requestCapacityWithPolicy({
    actorUserId: HAULER_DRIVER_ACTOR,
    organizationId: HAULER_ORG,
    loadPostingId,
    truckSlotId,
    driverProfileId: DRIVER_PROFILE,
    truckProfileId: TRUCK_PROFILE,
    trailerProfileId: TRAILER_PROFILE
  }, { at: WINDOW })
}

function slotFor(services: LogLoadsServices, loadPostingId: string) {
  const slot = services.state.truckSlots.find((candidate) => candidate.loadPostingId === loadPostingId)

  if (!slot) {
    throw new Error("The fixture load has no loading slot")
  }

  return slot
}

function publicationStateCounts(services: LogLoadsServices) {
  return {
    assignments: services.state.assignments.length,
    loadPostings: services.state.loadPostings.length,
    opportunityCapacities: services.state.opportunityCapacities.length,
    truckSlots: services.state.truckSlots.length
  }
}

/** Grants `role` in HOST_ORG to a synthetic member and returns their user id. */
function memberWithRole(services: LogLoadsServices, role: string, index: number): string {
  const userId = `2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a${index.toString().padStart(2, "0")}`

  services.state.organizationMemberships.push(
    organizationMembershipSchema.parse({
      createdAt: "2026-06-05T00:00:00.000Z",
      id: `2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b${index.toString().padStart(2, "0")}`,
      organizationId: HOST_ORG,
      role,
      status: "active",
      updatedAt: "2026-06-05T00:00:00.000Z",
      userId
    })
  )

  return userId
}

describe("load publishing authority", () => {
  it("lets every operating role publish for its own organization", () => {
    // Owner and dispatcher are seeded in HOST_ORG; admin and landing_manager
    // are granted here so the whole matrix is proven against the real service.
    const roles: Array<[string, string]> = [
      ["owner", HOST_OWNER],
      ["dispatcher", HOST_DISPATCHER]
    ]
    const services = createLogLoadsServices(createInMemoryDatabase())

    roles.push(["admin", memberWithRole(services, "admin", 1)])
    roles.push(["landing_manager", memberWithRole(services, "landing_manager", 2)])

    for (const [role, actorUserId] of roles) {
      const created = services.createLoadPostingWithPolicy({
        ...postingInput("open", { title: `Published by ${role}` }),
        actorUserId,
        organizationId: HOST_ORG
      })

      expect(created.status, `${role} should publish`).toBe("open")
      expect(created.companyId).toBe(HOST_ORG)
    }
  })

  it("refuses every non-publishing role", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const denied: Array<[string, string]> = [
      ["viewer", memberWithRole(services, "viewer", 3)],
      ["billing", memberWithRole(services, "billing", 4)],
      ["destination_manager", memberWithRole(services, "destination_manager", 5)]
    ]

    for (const [role, actorUserId] of denied) {
      expect(() => services.createLoadPostingWithPolicy({
        ...postingInput("open"),
        actorUserId,
        organizationId: HOST_ORG
      }), `${role} must not publish`).toThrow(/cannot publish load/)
    }

    // A driver in the hauling organization cannot publish there either.
    expect(() => services.createLoadPostingWithPolicy({
      ...postingInput("open"),
      actorUserId: HAULER_DRIVER_ACTOR,
      organizationId: HAULER_ORG
    })).toThrow(/cannot publish load/)

    expect(services.state.loadPostings.some((load) => load.title === "Load management fixture")).toBe(false)
  })

  it("refuses a member of another organization", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    // The host's own dispatcher has publish authority — but not in an
    // organization they are not an active member of.
    expect(() => services.createLoadPostingWithPolicy({
      ...postingInput("open"),
      actorUserId: HOST_OWNER,
      organizationId: HAULER_ORG
    })).toThrow(/not an active member/)

    const outsider = services.createAccount({
      accountType: "landing_operator",
      availabilityPreset: "not_ready",
      email: "outside-host@example.com",
      equipment: null,
      fullName: "Outside Host",
      organizationName: "Outside Landing",
      path: "host",
      phone: "555-9300",
      region: "Elsewhere, OR"
    })

    // An owner of a different landing outfit cannot publish into HOST_ORG,
    // nor mutate HOST_ORG's work.
    expect(() => services.createLoadPostingWithPolicy({
      ...postingInput("open"),
      actorUserId: outsider.profile.id,
      organizationId: HOST_ORG
    })).toThrow(/not an active member/)

    const load = publishAsOwner(services)
    const outsiderOrgId = outsider.memberships[0]?.organization.id

    expect(outsiderOrgId).toBeTruthy()
    if (!outsiderOrgId) return

    expect(() => services.closeLoadPosting({
      actorUserId: outsider.profile.id,
      loadPostingId: load.id,
      organizationId: outsiderOrgId
    })).toThrow(/Only the posting organization/)

    expect(() => services.openDraftLoadPosting({
      actorUserId: outsider.profile.id,
      loadPostingId: load.id,
      organizationId: outsiderOrgId
    })).toThrow(/Only the posting organization/)

    expect(services.state.loadPostings.find((candidate) => candidate.id === load.id)?.status).toBe("open")
  })

  it("lets a dispatcher run the whole load lifecycle for its organization", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const draft = services.createLoadPostingWithPolicy({
      ...postingInput("draft"),
      actorUserId: HOST_DISPATCHER,
      organizationId: HOST_ORG
    })

    const opened = services.openDraftLoadPosting({
      actorUserId: HOST_DISPATCHER,
      loadPostingId: draft.id,
      organizationId: HOST_ORG
    })

    expect(opened.status).toBe("open")

    const closed = services.closeLoadPosting({
      actorUserId: HOST_DISPATCHER,
      loadPostingId: draft.id,
      organizationId: HOST_ORG,
      reason: "Weather closed the block."
    })

    expect(closed.status).toBe("cancelled")
  })

  it("stamps the posting with the actor's organization, ignoring a spoofed companyId", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const created = publishAsOwner(services, "open", { companyId: HAULER_ORG })

    expect(created.companyId).toBe(HOST_ORG)

    const audit = services.state.auditEvents.find((event) =>
      event.entityId === created.id && event.action === "load_published"
    )

    expect(audit?.actorUserId).toBe(HOST_OWNER)
  })

  it("publishing a draft mints capacity and slots and makes the work requestable", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const draft = publishAsOwner(services, "draft")

    expect(services.state.opportunityCapacities.some((capacity) => capacity.loadPostingId === draft.id)).toBe(false)
    expect(services.state.truckSlots.some((slot) => slot.loadPostingId === draft.id)).toBe(false)

    const opened = services.openDraftLoadPosting({
      actorUserId: HOST_OWNER,
      loadPostingId: draft.id,
      organizationId: HOST_ORG
    })

    expect(opened.status).toBe("open")
    expect(services.state.opportunityCapacities.some((capacity) => capacity.loadPostingId === draft.id)).toBe(true)
    expect(services.state.truckSlots.some((slot) => slot.loadPostingId === draft.id)).toBe(true)
    expect(
      services.listRequestableLoadsForOrganization(HAULER_ORG, WINDOW).some((load) => load.id === draft.id)
    ).toBe(true)
  })

  it("honors the reach chosen at draft-publish time and refuses double provisioning", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const draft = publishAsOwner(services, "draft")

    services.openDraftLoadPosting({
      actorUserId: HOST_OWNER,
      loadPostingId: draft.id,
      organizationId: HOST_ORG,
      visibilityMode: "private_network"
    })

    const capacity = services.state.opportunityCapacities.find((candidate) => candidate.loadPostingId === draft.id)

    expect(capacity?.visibilityMode).toBe("private_network")

    // A second publish attempt cannot mint a second ledger.
    const reopened = services.state.loadPostings.find((candidate) => candidate.id === draft.id)
    if (reopened) reopened.status = "draft"

    expect(() => services.openDraftLoadPosting({
      actorUserId: HOST_OWNER,
      loadPostingId: draft.id,
      organizationId: HOST_ORG
    })).toThrow(/already has provisioned capacity/)
  })

  it("refuses an unrecognized reach instead of widening to the open network", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    // Coercing an unknown reach would silently publish to the whole network.
    expect(() => publishAsOwner(services, "open", { visibilityMode: "partners-only" }))
      .toThrow(/Unknown visibility mode/)
    expect(() => publishAsOwner(services, "open", { allocationMode: "whoever-shows-up" }))
      .toThrow(/Unknown allocation mode/)

    const draft = publishAsOwner(services, "draft")

    expect(() => services.openDraftLoadPosting({
      actorUserId: HOST_OWNER,
      loadPostingId: draft.id,
      organizationId: HOST_ORG,
      visibilityMode: "everyone"
    })).toThrow(/Unknown visibility mode/)

    // Every rejected publish left the operating record untouched: no orphan
    // posting, no half-provisioned ledger, and the draft is still a draft.
    expect(services.state.loadPostings.filter((load) => load.title === "Load management fixture")).toHaveLength(1)
    expect(services.state.opportunityCapacities.some((capacity) => capacity.loadPostingId === draft.id)).toBe(false)
    expect(services.state.loadPostings.find((load) => load.id === draft.id)?.status).toBe("draft")
  })

  it("keeps draft publishing inside the posting organization and to drafts only", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const draft = publishAsOwner(services, "draft")

    expect(() => services.openDraftLoadPosting({
      actorUserId: HAULER_LANDING_MANAGER,
      loadPostingId: draft.id,
      organizationId: HAULER_ORG
    })).toThrow(/Only the posting organization/)

    const live = publishAsOwner(services)

    expect(() => services.openDraftLoadPosting({
      actorUserId: HOST_OWNER,
      loadPostingId: live.id,
      organizationId: HOST_ORG
    })).toThrow(/Only a draft/)
  })
})

describe("posting source ownership and lane coherence", () => {
  it("derives published operator contacts from owned profiles instead of trusting payload contact data", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const spoofed = { email: "wrong@example.com", name: "Wrong dispatcher", phone: "555-9999" }
    const loaderContact = { email: "loader@summit.example", name: "Lane Loader", phone: "555-3010" }
    const loaderProfileId = "55555555-5555-4555-8555-555555555559"

    services.state.loaderProfiles.push(loaderProfileSchema.parse({
      companyId: HOST_ORG,
      contact: loaderContact,
      createdAt: "2026-06-05T00:00:00.000Z",
      id: loaderProfileId,
      landingId: "66666666-6666-4666-8666-666666666662",
      shiftNotes: null,
      updatedAt: "2026-06-05T00:00:00.000Z",
      userId: HOST_OWNER
    }))

    const published = publishAsOwner(services, "open", {
      dispatcherContact: spoofed,
      loaderContact: spoofed,
      loaderProfileId
    })
    const draft = publishAsOwner(services, "draft", { loaderContact: spoofed, loaderProfileId })
    const stored = services.state.loadPostings.find((candidate) => candidate.id === draft.id)

    expect(published.dispatcherContact).toEqual({
      email: "dispatch@summit.example",
      name: "Cole Cedar",
      phone: "555-3001"
    })
    expect(published.loaderContact).toEqual(loaderContact)

    expect(stored).toBeDefined()
    if (!stored) return

    stored.dispatcherContact = spoofed
    stored.loaderContact = spoofed
    const opened = services.openDraftLoadPosting({
      actorUserId: HOST_OWNER,
      loadPostingId: draft.id,
      organizationId: HOST_ORG
    })

    expect(opened.dispatcherContact).toEqual(published.dispatcherContact)
    expect(opened.loaderContact).toEqual(loaderContact)
  })

  it.each([
    ["landing", { pickupLandingId: "66666666-6666-4666-8666-666666666661" }, /That landing was not found/],
    ["haul route", { routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1" }, /That haul route was not found/],
    ["rate", { rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1" }, /That rate was not found/],
    [
      "loader profile",
      { loaderProfileId: "55555555-5555-4555-8555-555555555552" },
      /That loader profile was not found/
    ],
    [
      "dispatcher profile",
      { dispatcherProfileId: "55555555-5555-4555-8555-555555555551" },
      /That dispatcher profile was not found/
    ]
  ])("refuses another organization's %s before creating any publication state", (_label, overrides, error) => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const before = publicationStateCounts(services)

    // Negative control: without the service-layer ownership guard the lower-level
    // writer accepts these structurally valid foreign ids and this assertion fails.
    expect(() => publishAsOwner(services, "open", overrides)).toThrow(error)
    expect(publicationStateCounts(services)).toEqual(before)
  })

  it("refuses a route that does not begin at the selected landing or end at the selected mill", () => {
    const wrongStart = createLogLoadsServices(createInMemoryDatabase())
    const route = wrongStart.state.haulRoutes.find(
      (candidate) => candidate.id === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"
    )

    expect(route).toBeDefined()
    if (!route) return

    route.landingId = "66666666-6666-4666-8666-666666666661"
    const beforeWrongStart = publicationStateCounts(wrongStart)

    expect(() => publishAsOwner(wrongStart)).toThrow(/does not start at Blue River Landing/)
    expect(publicationStateCounts(wrongStart)).toEqual(beforeWrongStart)

    const wrongDestination = createLogLoadsServices(createInMemoryDatabase())
    const beforeWrongDestination = publicationStateCounts(wrongDestination)

    expect(() => publishAsOwner(wrongDestination, "open", {
      routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4"
    })).toThrow(/does not run to the destination/)
    expect(publicationStateCounts(wrongDestination)).toEqual(beforeWrongDestination)
  })

  it.each([
    ["landing", { pickupLandingId: "66666666-6666-4666-8666-666666666661" }, /That landing was not found/],
    ["haul route", { routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1" }, /That haul route was not found/],
    ["rate", { rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1" }, /That rate was not found/],
    [
      "loader profile",
      { loaderProfileId: "55555555-5555-4555-8555-555555555552" },
      /That loader profile was not found/
    ],
    [
      "dispatcher profile",
      { dispatcherProfileId: "55555555-5555-4555-8555-555555555551" },
      /That dispatcher profile was not found/
    ],
    ["destination", { routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4" }, /does not run to the destination/]
  ])("applies the same %s protection when a stored draft is published", (_label, corruption, error) => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const draft = publishAsOwner(services, "draft")
    const stored = services.state.loadPostings.find((candidate) => candidate.id === draft.id)

    expect(stored).toBeDefined()
    if (!stored) return

    Object.assign(stored, corruption)
    const before = publicationStateCounts(services)

    expect(() => services.openDraftLoadPosting({
      actorUserId: HOST_OWNER,
      loadPostingId: draft.id,
      organizationId: HOST_ORG
    })).toThrow(error)

    expect(publicationStateCounts(services)).toEqual(before)
    expect(stored.status).toBe("draft")
  })

  it("rejects a malformed legacy open posting before a request mutates capacity or assignment state", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const load = publishAsOwner(services)
    const slot = slotFor(services, load.id)
    const capacity = services.state.opportunityCapacities.find((candidate) => candidate.loadPostingId === load.id)
    const before = {
      assignments: services.state.assignments.length,
      auditEvents: services.state.auditEvents.length,
      notifications: services.state.notifications.length,
      remainingTruckloads: capacity?.remainingTruckloads,
      reservedCount: slot.reservedCount,
      slotStatus: slot.status
    }

    // Simulate an already-open pre-guard posting pointing at another host's
    // private landing. The request path must not rely only on publish-time checks.
    load.pickupLandingId = "66666666-6666-4666-8666-666666666661"

    expect(services.isLoadRequestableAt(load, WINDOW)).toBe(false)
    expect(services.listVisibleLoadsForOrganization(HAULER_ORG)).not.toContainEqual(load)
    expect(() => requestAsHauler(services, load.id, slot.id)).toThrow(/That landing was not found/)
    const capacityAfter = services.state.opportunityCapacities.find(
      (candidate) => candidate.loadPostingId === load.id
    )
    const slotAfter = services.state.truckSlots.find((candidate) => candidate.id === slot.id)

    expect({
      assignments: services.state.assignments.length,
      auditEvents: services.state.auditEvents.length,
      notifications: services.state.notifications.length,
      remainingTruckloads: capacityAfter?.remainingTruckloads,
      reservedCount: slotAfter?.reservedCount,
      slotStatus: slotAfter?.status
    }).toEqual(before)
  })

  it("revalidates a pending legacy request before approval mints terms, a trip, or a Route Pack", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const load = publishAsOwner(services)
    const slot = slotFor(services, load.id)
    const assignment = requestAsHauler(services, load.id, slot.id)
    const stored = services.state.loadPostings.find((candidate) => candidate.id === load.id)
    const slotBeforeApproval = services.state.truckSlots.find((candidate) => candidate.id === slot.id)

    expect(stored).toBeDefined()
    expect(slotBeforeApproval).toBeDefined()
    if (!stored || !slotBeforeApproval) return

    const before = {
      assignmentStatus: assignment.status,
      auditEvents: services.state.auditEvents.length,
      routePacks: services.state.routePacks.length,
      slotStatus: slotBeforeApproval.status,
      trips: services.state.tripsV2.length
    }

    // A stored posting can be corrupted after request time. Approval is the
    // last boundary before foreign commercial facts become accepted terms.
    stored.rateId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"

    expect(() => services.approveCapacityRequest({
      actorUserId: HOST_OWNER,
      assignmentId: assignment.id,
      organizationId: HOST_ORG
    })).toThrow(/That rate was not found/)

    const assignmentAfter = services.state.assignments.find((candidate) => candidate.id === assignment.id)
    const slotAfter = services.state.truckSlots.find((candidate) => candidate.id === slot.id)

    expect({
      assignmentStatus: assignmentAfter?.status,
      auditEvents: services.state.auditEvents.length,
      routePacks: services.state.routePacks.length,
      slotStatus: slotAfter?.status,
      trips: services.state.tripsV2.length
    }).toEqual(before)
  })
})

describe("closing published work", () => {
  it("declines waiting requests, cancels slots, and takes the work off the network", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const load = publishAsOwner(services)
    const slot = slotFor(services, load.id)
    const assignment = requestAsHauler(services, load.id, slot.id)

    const closed = services.closeLoadPosting({
      actorUserId: HOST_OWNER,
      loadPostingId: load.id,
      organizationId: HOST_ORG,
      reason: "The block is snowed in."
    })

    expect(closed.status).toBe("cancelled")
    expect(closed.cancellationReason).toBe("The block is snowed in.")

    const declined = services.state.assignments.find((candidate) => candidate.id === assignment.id)
    const capacity = services.state.opportunityCapacities.find((candidate) => candidate.loadPostingId === load.id)
    const slotAfter = services.state.truckSlots.find((candidate) => candidate.id === slot.id)
    const notification = services.state.notifications.find((candidate) =>
      candidate.relatedEntityId === assignment.id && candidate.userId === HAULER_DRIVER_ACTOR
    )

    expect(declined?.status).toBe("declined")
    expect(capacity?.committedTruckloads).toBe(0)
    expect(slotAfter?.status).toBe("cancelled")
    expect(notification).toMatchObject({ title: "Work closed by the host", type: "assignment_declined" })
    expect(
      services.listRequestableLoadsForOrganization(HAULER_ORG, WINDOW).some((candidate) => candidate.id === load.id)
    ).toBe(false)
  })

  it("refuses to close work with a booked haul and requires posting-org authority", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const load = publishAsOwner(services)
    const slot = slotFor(services, load.id)
    const assignment = requestAsHauler(services, load.id, slot.id)

    services.approveCapacityRequest({
      actorUserId: HOST_DISPATCHER,
      assignmentId: assignment.id,
      organizationId: HOST_ORG
    })

    expect(() => services.closeLoadPosting({
      actorUserId: HOST_OWNER,
      loadPostingId: load.id,
      organizationId: HOST_ORG
    })).toThrow(/booked hauls/)

    expect(() => services.closeLoadPosting({
      actorUserId: HAULER_LANDING_MANAGER,
      loadPostingId: load.id,
      organizationId: HAULER_ORG
    })).toThrow(/Only the posting organization/)
  })
})

describe("verified-network visibility", () => {
  it("shows verified-network work only to verified organizations", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const load = publishAsOwner(services, "open", { visibilityMode: "verified_network" })

    expect(
      services.listVisibleLoadsForOrganization(HAULER_ORG).some((candidate) => candidate.id === load.id)
    ).toBe(true)

    const outsider = services.createAccount({
      accountType: "small_fleet",
      availabilityPreset: "not_ready",
      email: "unverified-fleet@example.com",
      equipment: null,
      fullName: "Unverified Fleet",
      organizationName: "Unverified Fleet LLC",
      path: "fleet",
      phone: "555-9200",
      region: "Elsewhere, OR"
    })
    const outsiderOrgId = outsider.memberships[0]?.organization.id

    expect(outsiderOrgId).toBeTruthy()
    if (!outsiderOrgId) return

    expect(
      services.listVisibleLoadsForOrganization(outsiderOrgId).some((candidate) => candidate.id === load.id)
    ).toBe(false)
    expect(
      services.listVisibleLoadsForOrganization(HOST_ORG).some((candidate) => candidate.id === load.id)
    ).toBe(true)
  })
})
