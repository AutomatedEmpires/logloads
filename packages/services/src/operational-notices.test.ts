import { randomUUID } from "node:crypto"

import { millSchema, operationalNoticeSchema, type OperationalNotice } from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices, type LogLoadsServices } from "./index"
import { DomainRefusalError } from "./utils"

// Seed fixtures. North Pine (fleet) owns landing ...661; Summit Ridge (landing
// source) owns landing ...662 and load ...cc3; New River is unrelated to both.
const NORTH_PINE = "33333333-3333-4333-8333-333333333331"
const SUMMIT = "33333333-3333-4333-8333-333333333332"
const NEW_RIVER = "33333333-3333-4333-8333-333333333334"
const NORTH_PINE_DRIVER = "22222222-2222-4222-8222-222222222221"
const SHARED_DISPATCHER = "22222222-2222-4222-8222-222222222224" // dispatcher in both North Pine and Summit
const SUMMIT_OWNER = "22222222-2222-4222-8222-222222222223"
const NORTH_PINE_LANDING = "66666666-6666-4666-8666-666666666661"
const SUMMIT_LANDING = "66666666-6666-4666-8666-666666666662"
const SUMMIT_LOAD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3"
const SHARED_MILL = "99999999-9999-4999-8999-999999999991"
const NORTH_PINE_DRIVER_PROFILE = "44444444-4444-4444-8444-444444444441"
const NORTH_PINE_TRUCK = "77777777-7777-4777-8777-777777777771"
const NORTH_PINE_TRAILER = "88888888-8888-4888-8888-888888888881"
const CROSS_ORG_ASSIGNMENT_ON_SUMMIT_LOAD = "ffffffff-ffff-4fff-8fff-ffffffffaaa1"

const LOAD_DATE = "2026-06-25"
const HOUR = 60 * 60_000

const notice = {
  body: "Grader working the spur until noon; hold at the gate.",
  severity: "watch" as const,
  title: "Spur road grading"
}

function summitPrivateMill(services: LogLoadsServices): string {
  const template = services.state.mills.find((mill) => mill.id === SHARED_MILL)!
  const mill = millSchema.parse({ ...template, companyId: SUMMIT, id: randomUUID(), name: "Summit private yard" })

  services.state.mills.push(mill)

  return mill.id
}

/** A haul on Summit's load, at Summit's landing, by a North Pine driver: host and hauler differ. */
function bookCrossOrganizationHaul(services: LogLoadsServices) {
  const load = services.createLoadPostingWithPolicy({
    accessRequirements: [],
    actorUserId: SUMMIT_OWNER,
    campaignEndDate: null,
    campaignStartDate: null,
    companyId: SUMMIT,
    dailyTruckCountNeeded: 1,
    dispatcherContact: { email: "dispatch@summit.example", name: "Cole Cedar", phone: "555-3001" },
    dispatcherProfileId: "55555555-5555-4555-8555-555555555553",
    driverPayCents: 52_500,
    dropoffMillId: SHARED_MILL,
    equipmentRequirements: ["pole-trailer"],
    estimatedTonsPerLoad: 27,
    loadDate: LOAD_DATE,
    loadType: "saw_logs",
    loaderContact: null,
    loaderProfileId: null,
    organizationId: SUMMIT,
    pickupLandingId: SUMMIT_LANDING,
    rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
    recurringSchedule: null,
    roadCondition: "good",
    routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    scheduleType: "one_off",
    status: "open",
    title: "Route Pack notice fixture load",
    weatherNotes: null
  })
  const slot = services.state.truckSlots.find((candidate) => candidate.loadPostingId === load.id)

  if (!slot) {
    throw new Error("The fixture load did not create a loading slot")
  }

  services.upsertAvailabilityWindow({
    driverProfileId: NORTH_PINE_DRIVER_PROFILE,
    endAt: `${LOAD_DATE}T23:59:00.000Z`,
    notes: "Route Pack notice fixture window.",
    preferredRouteIds: [],
    recurringSchedule: null,
    startAt: `${LOAD_DATE}T00:00:00.000Z`,
    status: "available",
    truckProfileId: NORTH_PINE_TRUCK
  })

  const assignment = services.requestCapacityWithPolicy({
    actorUserId: NORTH_PINE_DRIVER,
    driverProfileId: NORTH_PINE_DRIVER_PROFILE,
    loadPostingId: load.id,
    organizationId: NORTH_PINE,
    trailerProfileId: NORTH_PINE_TRAILER,
    truckProfileId: NORTH_PINE_TRUCK,
    truckSlotId: slot.id
  }, { at: `${LOAD_DATE}T12:00:00.000Z` })

  services.approveCapacityRequest({
    actorUserId: SUMMIT_OWNER,
    assignmentId: assignment.id,
    organizationId: SUMMIT
  })

  return { assignment, load }
}

/** Writes a notice straight into state, the way a record from before the publish checks would sit there. */
function storedNotice(services: LogLoadsServices, fields: Partial<OperationalNotice> & { organizationId: string }) {
  const now = Date.now()
  const stored = operationalNoticeSchema.parse({
    ...notice,
    createdAt: new Date(now - HOUR).toISOString(),
    effectiveAt: new Date(now - HOUR).toISOString(),
    expiresAt: null,
    id: randomUUID(),
    relatedDestinationId: null,
    relatedLandingId: null,
    relatedLoadId: null,
    ...fields
  })

  services.state.operationalNotices.push(stored)

  return stored
}

describe("publishing an operational notice", () => {
  it("refuses a landing that belongs to another organization, with or without a related load", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const before = services.state.operationalNotices.length

    for (const input of [
      { relatedLandingId: NORTH_PINE_LANDING },
      { relatedLandingId: NORTH_PINE_LANDING, relatedLoadId: SUMMIT_LOAD }
    ]) {
      expect(() => services.createOperationalNotice({
        ...notice,
        ...input,
        actorUserId: SUMMIT_OWNER,
        organizationId: SUMMIT
      })).toThrow(DomainRefusalError)
    }

    expect(services.state.operationalNotices).toHaveLength(before)
  })

  it("gives a landing or destination that does not exist the same refusal as a foreign one", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const missing = randomUUID()

    expect(() => services.createOperationalNotice({
      ...notice,
      actorUserId: SUMMIT_OWNER,
      organizationId: SUMMIT,
      relatedLandingId: missing
    })).toThrow(`Organization ${SUMMIT} cannot publish an operational notice for landing ${missing}`)
    expect(() => services.createOperationalNotice({
      ...notice,
      actorUserId: SUMMIT_OWNER,
      organizationId: SUMMIT,
      relatedDestinationId: missing
    })).toThrow(`Organization ${SUMMIT} cannot publish an operational notice for destination ${missing}`)
  })

  it("refuses another organization's private destination, and accepts it for its owner", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const privateMill = summitPrivateMill(services)

    expect(() => services.createOperationalNotice({
      ...notice,
      actorUserId: SHARED_DISPATCHER,
      organizationId: NORTH_PINE,
      relatedDestinationId: privateMill
    })).toThrow(DomainRefusalError)

    expect(services.createOperationalNotice({
      ...notice,
      actorUserId: SUMMIT_OWNER,
      organizationId: SUMMIT,
      relatedDestinationId: privateMill
    }).relatedDestinationId).toBe(privateMill)
  })

  it("accepts the caller's own landing and a shared mill", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    const created = services.createOperationalNotice({
      ...notice,
      actorUserId: SUMMIT_OWNER,
      organizationId: SUMMIT,
      relatedDestinationId: SHARED_MILL,
      relatedLandingId: SUMMIT_LANDING
    })

    expect(created.relatedLandingId).toBe(SUMMIT_LANDING)
    expect(created.relatedDestinationId).toBe(SHARED_MILL)
  })

  it("lets a hauler on the related load name that load's landing, but not the same landing without the load", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    // A North Pine driver is hauling Summit's load right now.
    services.state.assignments = services.state.assignments.map((assignment) =>
      assignment.id === CROSS_ORG_ASSIGNMENT_ON_SUMMIT_LOAD ? { ...assignment, status: "accepted" as const } : assignment
    )

    expect(services.createOperationalNotice({
      ...notice,
      actorUserId: SHARED_DISPATCHER,
      organizationId: NORTH_PINE,
      relatedDestinationId: SHARED_MILL,
      relatedLandingId: SUMMIT_LANDING,
      relatedLoadId: SUMMIT_LOAD
    }).relatedLandingId).toBe(SUMMIT_LANDING)

    expect(() => services.createOperationalNotice({
      ...notice,
      actorUserId: SHARED_DISPATCHER,
      organizationId: NORTH_PINE,
      relatedLandingId: SUMMIT_LANDING
    })).toThrow(DomainRefusalError)
  })
})

describe("operational notices in a Route Pack", () => {
  it("shows only in-effect notices on this load or published by the host, to the driver and to the host", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { assignment, load } = bookCrossOrganizationHaul(services)
    const now = Date.now()

    // Placed in state directly: none of these could be published any more.
    const foreignLanding = storedNotice(services, { organizationId: NEW_RIVER, relatedLandingId: SUMMIT_LANDING })
    const foreignDestination = storedNotice(services, { organizationId: NEW_RIVER, relatedDestinationId: SHARED_MILL })
    const foreignOnOtherLoad = storedNotice(services, {
      organizationId: NORTH_PINE,
      relatedLandingId: SUMMIT_LANDING,
      relatedLoadId: SUMMIT_LOAD
    })
    const notYetEffective = storedNotice(services, {
      effectiveAt: new Date(now + 24 * HOUR).toISOString(),
      organizationId: SUMMIT,
      relatedLandingId: SUMMIT_LANDING
    })
    const expired = storedNotice(services, {
      effectiveAt: new Date(now - 48 * HOUR).toISOString(),
      expiresAt: new Date(now - HOUR).toISOString(),
      organizationId: SUMMIT,
      relatedLandingId: SUMMIT_LANDING
    })
    const expiredOnThisLoad = storedNotice(services, {
      effectiveAt: new Date(now - 48 * HOUR).toISOString(),
      expiresAt: new Date(now - HOUR).toISOString(),
      organizationId: SUMMIT,
      relatedLoadId: load.id
    })

    // What the host and this haul legitimately publish.
    const hostLanding = storedNotice(services, { organizationId: SUMMIT, relatedLandingId: SUMMIT_LANDING })
    const hostDestination = storedNotice(services, { organizationId: SUMMIT, relatedDestinationId: SHARED_MILL })
    const onThisLoad = services.createOperationalNotice({
      ...notice,
      actorUserId: SUMMIT_OWNER,
      organizationId: SUMMIT,
      relatedLoadId: load.id
    })

    const expected = [hostLanding.id, hostDestination.id, onThisLoad.id].sort()
    const excluded = [
      foreignLanding.id,
      foreignDestination.id,
      foreignOnOtherLoad.id,
      notYetEffective.id,
      expired.id,
      expiredOnThisLoad.id
    ]

    for (const reader of [
      { actorUserId: NORTH_PINE_DRIVER, organizationId: NORTH_PINE },
      { actorUserId: SUMMIT_OWNER, organizationId: SUMMIT }
    ]) {
      const ids = services
        .getRoutePackForAssignment({ ...reader, assignmentId: assignment.id })
        .notices.map((candidate) => candidate.id)

      expect(ids.sort()).toEqual(expected)
      for (const id of excluded) {
        expect(ids).not.toContain(id)
      }
    }
  })
})
