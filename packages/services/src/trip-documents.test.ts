import { organizationMembershipSchema } from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices, tripDocumentPublicIdPrefix, type LogLoadsServices } from "./index"
import { recordPassingPreTripInspection, stubTripDocumentMedia } from "./test-helpers"

const HAULER_ORG = "33333333-3333-4333-8333-333333333331"
const HOST_ORG = "33333333-3333-4333-8333-333333333332"
const OUTSIDE_ORG = "33333333-3333-4333-8333-333333333333"
const HAULER_DRIVER_ACTOR = "22222222-2222-4222-8222-222222222221"
const HAULER_COWORKER_DRIVER_ACTOR = "22222222-2222-4222-8222-222222222222"
const HOST_OWNER = "22222222-2222-4222-8222-222222222223"
const DRIVER_PROFILE = "44444444-4444-4444-8444-444444444441"
const TRUCK_PROFILE = "77777777-7777-4777-8777-777777777771"
const TRAILER_PROFILE = "88888888-8888-4888-8888-888888888881"

const LOAD_DATE = "2026-06-25"

/**
 * Books a haul on its own day. The date is a parameter because a driver may hold
 * only one availability window per span, so two fixture hauls must not share one.
 */
function bookHaul(
  services: LogLoadsServices,
  { loadDate = LOAD_DATE, title = "Trip document fixture" }: { loadDate?: string; title?: string } = {}
) {
  const load = services.createLoadPostingWithPolicy({
    accessRequirements: [],
    actorUserId: HOST_OWNER,
    campaignEndDate: null,
    campaignStartDate: null,
    companyId: HOST_ORG,
    dailyTruckCountNeeded: 1,
    dispatcherContact: { email: "dispatch@summit.example", name: "Cole Cedar", phone: "555-3001" },
    dispatcherProfileId: "55555555-5555-4555-8555-555555555553",
    driverPayCents: 52_500,
    dropoffMillId: "99999999-9999-4999-8999-999999999991",
    equipmentRequirements: ["pole-trailer"],
    estimatedTonsPerLoad: 27,
    loadDate,
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
    title,
    weatherNotes: null
  })
  const slot = services.state.truckSlots.find((candidate) => candidate.loadPostingId === load.id)

  if (!slot) throw new Error("fixture load has no slot")

  services.upsertAvailabilityWindow({
    driverProfileId: DRIVER_PROFILE,
    endAt: `${loadDate}T23:59:00.000Z`,
    notes: "Trip document fixture window.",
    preferredRouteIds: [],
    recurringSchedule: null,
    startAt: `${loadDate}T00:00:00.000Z`,
    status: "available",
    truckProfileId: TRUCK_PROFILE
  })

  const assignment = services.requestCapacityWithPolicy({
    actorUserId: HAULER_DRIVER_ACTOR,
    driverProfileId: DRIVER_PROFILE,
    loadPostingId: load.id,
    organizationId: HAULER_ORG,
    trailerProfileId: TRAILER_PROFILE,
    truckProfileId: TRUCK_PROFILE,
    truckSlotId: slot.id
  }, { at: `${loadDate}T12:00:00.000Z` })

  const { trip } = services.approveCapacityRequest({
    actorUserId: HOST_OWNER,
    assignmentId: assignment.id,
    organizationId: HOST_ORG
  })

  return { assignment, load, trip }
}

/** Gives an actor a role in an organization so a boundary can be probed from it. */
function grantMembership(
  services: LogLoadsServices,
  options: {
    userId: string
    organizationId: string
    role: "viewer" | "driver" | "landing_manager"
    index: number
  }
) {
  const suffix = options.index.toString().padStart(2, "0")

  services.state.organizationMemberships.push(organizationMembershipSchema.parse({
    createdAt: "2026-06-05T00:00:00.000Z",
    id: `2d2d2d2d-2d2d-4d2d-8d2d-2d2d2d2d2e${suffix}`,
    organizationId: options.organizationId,
    role: options.role,
    status: "active",
    updatedAt: "2026-06-05T00:00:00.000Z",
    userId: options.userId
  }))
}

describe("attaching trip documents", () => {
  it("records the asset the server read back, not what the caller described", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)
    const media = stubTripDocumentMedia(trip.id)

    const document = services.attachTripDocument({
      actorUserId: HAULER_DRIVER_ACTOR,
      filename: "scale-ticket.jpg",
      media,
      organizationId: HAULER_ORG,
      tripId: trip.id,
      type: "scale_ticket"
    })

    expect(document.media).toEqual(media)
    expect(document.storageProvider).toBe("cloudinary")
    // The key is the asset's own id — it cannot name a file that was not stored.
    expect(document.storageKey).toBe(media.publicId)
    expect(document.contentType).toBe("image/jpeg")
    // The asset was read back before the record was written; nothing is pending.
    expect(document.processingStatus).toBe("ready")
    expect(document.uploadedByUserId).toBe(HAULER_DRIVER_ACTOR)
  })

  it("refuses an asset signed for a different trip", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip: first } = bookHaul(services, { loadDate: "2026-06-25", title: "First fixture" })
    const { trip: second } = bookHaul(services, { loadDate: "2026-06-26", title: "Second fixture" })

    // Both hauls belong to this driver, so authorization passes on either. Only
    // the namespace stops one haul's ticket being filed as the other's proof.
    expect(() =>
      services.attachTripDocument({
        actorUserId: HAULER_DRIVER_ACTOR,
        filename: "scale-ticket.jpg",
        media: stubTripDocumentMedia(first.id),
        organizationId: HAULER_ORG,
        tripId: second.id,
        type: "scale_ticket"
      })
    ).toThrow(/does not belong to this trip/)

    expect(services.listTripDocuments(second.id)).toHaveLength(0)
  })

  it("prevents a driver from signing or attaching proof to a coworker's haul", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)
    const actor = {
      actorUserId: HAULER_COWORKER_DRIVER_ACTOR,
      organizationId: HAULER_ORG,
      tripId: trip.id
    }

    expect(() => services.getTripDocumentTarget(actor, "write"))
      .toThrow(/only access documents for their own hauls/)

    expect(() => services.attachTripDocument({
      ...actor,
      filename: "coworker-ticket.jpg",
      media: stubTripDocumentMedia(trip.id),
      type: "scale_ticket"
    })).toThrow(/only access documents for their own hauls/)

    expect(services.listTripDocuments(trip.id)).toHaveLength(0)
  })

  it("refuses an asset outside the trip document namespace", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)

    // A driver's own profile photo is an asset they legitimately uploaded. It is
    // still not proof that anything was delivered.
    expect(() =>
      services.attachTripDocument({
        actorUserId: HAULER_DRIVER_ACTOR,
        filename: "me.jpg",
        media: stubTripDocumentMedia(trip.id, {
          publicId: `logloads/${HAULER_ORG}/profile/${DRIVER_PROFILE}/uploads/abc`
        }),
        organizationId: HAULER_ORG,
        tripId: trip.id,
        type: "scale_ticket"
      })
    ).toThrow(/does not belong to this trip/)
  })

  it("refuses a namespace that merely starts with the trip prefix", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)

    // `<prefix>-evil/uploads/x` passes a naive startsWith on the prefix alone.
    // The separator is what makes the check a boundary rather than a substring.
    expect(() =>
      services.attachTripDocument({
        actorUserId: HAULER_DRIVER_ACTOR,
        filename: "scale-ticket.jpg",
        media: stubTripDocumentMedia(trip.id, {
          publicId: `${tripDocumentPublicIdPrefix(trip.id)}-evil/uploads/abc`
        }),
        organizationId: HAULER_ORG,
        tripId: trip.id,
        type: "scale_ticket"
      })
    ).toThrow(/does not belong to this trip/)
  })

  it("lets the posting organization file proof for a haul it posted", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)

    const document = services.attachTripDocument({
      actorUserId: HOST_OWNER,
      filename: "scale-ticket.jpg",
      media: stubTripDocumentMedia(trip.id),
      organizationId: HOST_ORG,
      tripId: trip.id,
      type: "scale_ticket"
    })

    expect(document.uploadedByUserId).toBe(HOST_OWNER)

    // Office staff on either side are `dispatcher`, the seed's own convention
    // for the posting organization's people. Deliberately not `destination`: a
    // destination is a mill, mills are not organizations here, and the posting
    // org sits at the landing end — labelling it the destination would tell a
    // reader that a mill with no login filed the ticket.
    const event = services.state.tripEvents.find(
      (candidate) => candidate.metadata.documentId === document.id
    )

    expect(event?.source).toBe("dispatcher")
  })

  it("attributes the driver's own upload to the driver", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)

    const document = services.attachTripDocument({
      actorUserId: HAULER_DRIVER_ACTOR,
      filename: "scale-ticket.jpg",
      media: stubTripDocumentMedia(trip.id),
      organizationId: HAULER_ORG,
      tripId: trip.id,
      type: "scale_ticket"
    })

    const event = services.state.tripEvents.find(
      (candidate) => candidate.metadata.documentId === document.id
    )

    expect(event?.source).toBe("driver")
  })

  it("announces a ticket only when a ticket arrived", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)
    const eventTypeFor = (type: "scale_ticket" | "photo") => {
      const document = services.attachTripDocument({
        actorUserId: HAULER_DRIVER_ACTOR,
        filename: `${type}.jpg`,
        media: stubTripDocumentMedia(trip.id, {
          publicId: `${tripDocumentPublicIdPrefix(trip.id)}/uploads/${type}-asset`
        }),
        organizationId: HAULER_ORG,
        tripId: trip.id,
        type
      })

      return services.state.tripEvents.find(
        (candidate) => candidate.metadata.documentId === document.id
      )?.type
    }

    // The timeline renders the event type verbatim, so a photo filed as
    // "ticket uploaded" would announce a scale ticket nobody produced.
    expect(eventTypeFor("scale_ticket")).toBe("ticket_uploaded")
    expect(eventTypeFor("photo")).toBe("document_uploaded")
  })

  it("files one physical ticket once, however many times the attach is replayed", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)
    const media = stubTripDocumentMedia(trip.id)
    const attach = () => services.attachTripDocument({
      actorUserId: HAULER_DRIVER_ACTOR,
      filename: "scale-ticket.jpg",
      media,
      organizationId: HAULER_ORG,
      tripId: trip.id,
      type: "scale_ticket"
    })

    const first = attach()
    // A compare-and-swap replay, or a retry of a call whose response was lost.
    const second = attach()

    expect(second.id).toBe(first.id)
    expect(services.listTripDocuments(trip.id)).toHaveLength(1)
    expect(
      services.state.tripEvents.filter((candidate) => candidate.metadata.documentId === first.id)
    ).toHaveLength(1)
  })

  it("refuses an organization that is not part of the haul", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)
    const outsider = "2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c90"

    grantMembership(services, { index: 90, organizationId: OUTSIDE_ORG, role: "driver", userId: outsider })

    expect(() =>
      services.attachTripDocument({
        actorUserId: outsider,
        filename: "scale-ticket.jpg",
        media: stubTripDocumentMedia(trip.id),
        organizationId: OUTSIDE_ORG,
        tripId: trip.id,
        type: "scale_ticket"
      })
    ).toThrow(/not a participant/)

    expect(services.listTripDocuments(trip.id)).toHaveLength(0)
  })

  it("refuses a viewer inside a participating organization", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)
    const viewer = "2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c91"

    // A viewer on this haul may read its proof — it holds view_network — but
    // holds no progress_trip, so it can never author the record the gate reads.
    // Read access is deliberately wider than write; it is not the same door.
    grantMembership(services, { index: 91, organizationId: HAULER_ORG, role: "viewer", userId: viewer })

    expect(() =>
      services.attachTripDocument({
        actorUserId: viewer,
        filename: "scale-ticket.jpg",
        media: stubTripDocumentMedia(trip.id),
        organizationId: HAULER_ORG,
        tripId: trip.id,
        type: "scale_ticket"
      })
    ).toThrow(/cannot progress trip/)
  })
})

describe("trip document targets", () => {
  it("hands the signing namespace to a participant", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)

    const target = services.getTripDocumentTarget({
      actorUserId: HAULER_DRIVER_ACTOR,
      organizationId: HAULER_ORG,
      tripId: trip.id
    }, "write")

    expect(target).toEqual({
      publicIdPrefix: tripDocumentPublicIdPrefix(trip.id),
      tripId: trip.id
    })
  })

  it("refuses to sign for a haul the actor is not on", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)
    const outsider = "2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c92"

    grantMembership(services, { index: 92, organizationId: OUTSIDE_ORG, role: "driver", userId: outsider })

    // The signature is the upload's authorization, so this is the door: refusing
    // here means an outsider never gets a writable path to probe with.
    expect(() =>
      services.getTripDocumentTarget({
        actorUserId: outsider,
        organizationId: OUTSIDE_ORG,
        tripId: trip.id
      }, "write")
    ).toThrow(/not a participant/)
  })

  it("refuses to sign for a trip that does not exist", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    expect(() =>
      services.getTripDocumentTarget({
        actorUserId: HAULER_DRIVER_ACTOR,
        organizationId: HAULER_ORG,
        tripId: "11111111-2222-4333-8444-555555555555"
      }, "write")
    ).toThrow(/was not found/)
  })

  it("opens the proof to the role that settles the delivery", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)
    const landingManager = "2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c93"

    // A landing_manager holds assign_capacity — it can confirm or dispute the
    // driver's figure — and deliberately holds no progress_trip. Gating the read
    // on the write action would ask it to settle a number it is forbidden to
    // check, which is the exact failure uploading real proof exists to end.
    grantMembership(services, {
      index: 93,
      organizationId: HOST_ORG,
      role: "landing_manager",
      userId: landingManager
    })

    expect(
      services.getTripDocumentTarget({
        actorUserId: landingManager,
        organizationId: HOST_ORG,
        tripId: trip.id
      }, "read").tripId
    ).toBe(trip.id)

    // Reading proof is not filing it.
    expect(() =>
      services.getTripDocumentTarget({
        actorUserId: landingManager,
        organizationId: HOST_ORG,
        tripId: trip.id
      }, "write")
    ).toThrow(/cannot progress trip/)
  })

  it("still refuses a read from outside the haul", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)
    const outsider = "2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c94"

    // Widening the read to view_network must not widen it past the haul itself.
    grantMembership(services, { index: 94, organizationId: OUTSIDE_ORG, role: "viewer", userId: outsider })

    expect(() =>
      services.getTripDocumentTarget({
        actorUserId: outsider,
        organizationId: OUTSIDE_ORG,
        tripId: trip.id
      }, "read")
    ).toThrow(/not a participant/)
  })
})

describe("uploaded proof and the evidence gate", () => {
  it("satisfies the gate the haul's Route Pack demanded", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const { trip } = bookHaul(services)

    services.attachTripDocument({
      actorUserId: HAULER_DRIVER_ACTOR,
      filename: "scale-ticket.jpg",
      media: stubTripDocumentMedia(trip.id),
      organizationId: HAULER_ORG,
      tripId: trip.id,
      type: "scale_ticket"
    })

    recordPassingPreTripInspection(services.state, {
      actorUserId: HAULER_DRIVER_ACTOR,
      organizationId: HAULER_ORG,
      tripId: trip.id
    })
    for (const nextStatus of [
      "en_route_to_landing",
      "checked_in",
      "loading",
      "loaded",
      "en_route_to_destination",
      "at_destination"
    ] as const) {
      services.progressTripStatus({
        actorUserId: HAULER_DRIVER_ACTOR,
        nextStatus,
        organizationId: HAULER_ORG,
        source: "driver",
        tripId: trip.id
      })
    }

    services.submitHaulCompletion({
      actorUserId: HAULER_DRIVER_ACTOR,
      deliveredQuantity: { unit: "tons", value: 26.4 },
      organizationId: HAULER_ORG,
      tripId: trip.id
    })

    // The gate opens on a document that now has bytes behind it.
    const closed = services.progressTripStatus({
      actorUserId: HAULER_DRIVER_ACTOR,
      nextStatus: "completed",
      organizationId: HAULER_ORG,
      source: "driver",
      tripId: trip.id
    })

    expect(closed.trip.status).toBe("completed")
  })

  it("keeps records written before uploads existed on the haul's history", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const legacy = services.state.tripDocuments[0]

    if (!legacy) throw new Error("fixture has no pre-existing trip document")

    // A document from before uploads were wired names a provider and a key for a
    // file nobody ever stored. It stays listed as the account of what was
    // claimed, and `media` is what tells a reader there is nothing to serve.
    // That the *view* refuses to offer it as a download is asserted where
    // `viewable` is actually computed — see apps/web/lib/network.test.ts.
    expect(legacy.media ?? null).toBeNull()
    expect(services.listTripDocuments(legacy.tripId)).toContainEqual(legacy)
  })
})
