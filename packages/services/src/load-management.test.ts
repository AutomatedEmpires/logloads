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
    dispatcherProfileId: "55555555-5555-4555-8555-555555555551",
    loaderProfileId: null,
    pickupLandingId: "66666666-6666-4666-8666-666666666661",
    dropoffMillId: "99999999-9999-4999-8999-999999999991",
    routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
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
      name: "Dana Dispatch",
      phone: "555-2001",
      email: "dispatch@northpine.example"
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

describe("load publishing authority", () => {
  it("requires publish authority to post work", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    expect(() => services.createLoadPostingWithPolicy({
      ...postingInput("open"),
      actorUserId: HAULER_DRIVER_ACTOR,
      organizationId: HAULER_ORG
    })).toThrow(/cannot publish load/)

    expect(() => services.createLoadPostingWithPolicy({
      ...postingInput("open"),
      actorUserId: HOST_DISPATCHER,
      organizationId: HOST_ORG
    })).toThrow(/cannot publish load/)

    const created = publishAsOwner(services)

    expect(created.status).toBe("open")
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
