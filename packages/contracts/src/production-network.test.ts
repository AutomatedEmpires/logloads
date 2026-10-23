import { describe, expect, it } from "vitest"

import {
  equipmentCombinationSchema,
  haulCancellationBlock,
  opportunityCapacitySchema,
  routePackSchema,
  selectDriverEquipmentCombination,
  transitionTripStatus,
  tripDocumentSchema,
  tripSchemaV2
} from "./production-network"

const timestamp = "2026-06-05T12:00:00.000Z"

describe("production operating network contracts", () => {
  it("selects one operational rig consistently and keeps inactive history opt-in", () => {
    const driverProfileId = "11111111-1111-4111-8111-111111111118"
    const organizationId = "22222222-2222-4222-8222-222222222228"
    const base = equipmentCombinationSchema.parse({
      assignedDriverProfileId: driverProfileId,
      capabilityTags: [],
      createdAt: timestamp,
      homeRegion: "Test Valley",
      id: "33333333-3333-4333-8333-333333333338",
      label: "Maintenance unit",
      lastVerifiedAt: null,
      maxPayloadTons: 30,
      organizationId,
      status: "maintenance",
      trailerProfileId: null,
      trailerTypes: [],
      truckProfileId: "44444444-4444-4444-8444-444444444448",
      truckTypes: ["log_truck"],
      updatedAt: timestamp
    })
    const available = equipmentCombinationSchema.parse({
      ...base,
      id: "33333333-3333-4333-8333-333333333339",
      label: "Available unit",
      status: "available",
      truckProfileId: "44444444-4444-4444-8444-444444444449"
    })
    const inactive = equipmentCombinationSchema.parse({
      ...base,
      id: "33333333-3333-4333-8333-333333333340",
      label: "Historical unit",
      status: "inactive",
      truckProfileId: "44444444-4444-4444-8444-444444444450"
    })

    expect(
      selectDriverEquipmentCombination([base, inactive, available], {
        driverProfileId,
        organizationId
      })?.id
    ).toBe(available.id)
    expect(
      selectDriverEquipmentCombination([inactive], { driverProfileId, organizationId })
    ).toBeNull()
    expect(
      selectDriverEquipmentCombination([inactive], {
        driverProfileId,
        includeInactive: true,
        organizationId
      })?.id
    ).toBe(inactive.id)
  })

  it("validates opportunity capacity ledgers", () => {
    const result = opportunityCapacitySchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      loadPostingId: "22222222-2222-4222-8222-222222222222",
      visibilityMode: "private_network",
      totalTruckloads: 4,
      committedTruckloads: 2,
      completedTruckloads: 1,
      remainingTruckloads: 2,
      acceptedTermsSnapshot: { rateId: "rate-1" },
      createdAt: timestamp,
      updatedAt: timestamp
    })

    expect(result.success).toBe(true)
  })

  it("rejects completed capacity above committed capacity", () => {
    const result = opportunityCapacitySchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      loadPostingId: "22222222-2222-4222-8222-222222222222",
      visibilityMode: "open_network",
      totalTruckloads: 2,
      committedTruckloads: 1,
      completedTruckloads: 2,
      remainingTruckloads: 0,
      acceptedTermsSnapshot: {},
      createdAt: timestamp,
      updatedAt: timestamp
    })

    expect(result.success).toBe(false)
  })

  it("validates assignment-scoped route packs", () => {
    const pack = {
      id: "33333333-3333-4333-8333-333333333333",
      loadPostingId: "22222222-2222-4222-8222-222222222222",
      assignmentId: "77777777-7777-4777-8777-777777777777",
      version: 1,
      landingId: "44444444-4444-4444-8444-444444444444",
      destinationId: "55555555-5555-4555-8555-555555555555",
      haulRouteId: "66666666-6666-4666-8666-666666666666",
      cacheableOffline: false,
      calculatedRouteSummary: "Use operator entrance pin, not public map pin.",
      localInstructions: [
        {
          source: "operator_provided",
          severity: "critical",
          title: "Bridge entry",
          detail: "Call before crossing the one-lane bridge.",
          verifiedAt: timestamp
        }
      ],
      currentRoadCondition: "restricted",
      snapshot: {
        capturedAt: timestamp,
        destinationName: "Cascade Mill",
        driverName: "Hank Hauler",
        hostOrganizationName: "Summit Ridge Timber",
        originName: "Blue River Landing"
      },
      lastVerifiedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    }

    expect(routePackSchema.safeParse(pack).success).toBe(true)
    expect(routePackSchema.safeParse({ ...pack, assignmentId: null }).success).toBe(false)
    expect(routePackSchema.safeParse({ ...pack, snapshot: null }).success).toBe(false)
  })

  it("enforces trip lifecycle ordering", () => {
    expect(transitionTripStatus("assigned", "en_route_to_landing")).toBe("en_route_to_landing")
    expect(() => transitionTripStatus("assigned", "completed")).toThrow(/Invalid trip transition/)
  })

  it("stores a trip document only with the asset read back from storage", () => {
    const baseDocument = {
      auditMetadata: {},
      contentType: "image/jpeg",
      filename: "scale-ticket.jpg",
      id: "12121212-1212-4212-8212-121212121212",
      processingStatus: "ready",
      storageKey: "logloads/trip-documents/trip-1/uploads/photo-1",
      tripId: "77777777-7777-4777-8777-777777777777",
      type: "scale_ticket",
      uploadedAt: timestamp,
      uploadedByUserId: "22222222-2222-4222-8222-222222222222"
    } as const
    const media = {
      bytes: 248_137,
      format: "jpg",
      height: 1_600,
      publicId: baseDocument.storageKey,
      uploadedAt: timestamp,
      version: 1_700_000_000,
      width: 1_200
    } as const

    expect(tripDocumentSchema.parse({ ...baseDocument, media }).media).toEqual(media)
    expect(tripDocumentSchema.safeParse({ ...baseDocument, media: null }).success).toBe(false)
  })

  it("validates a trip record", () => {
    const result = tripSchemaV2.safeParse({
      id: "77777777-7777-4777-8777-777777777777",
      assignmentId: "88888888-8888-4888-8888-888888888888",
      loadPostingId: "99999999-9999-4999-8999-999999999999",
      routePackId: "33333333-3333-4333-8333-333333333333",
      driverProfileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      equipmentCombinationId: null,
      status: "assigned",
      locationSharingStartedAt: null,
      locationSharingEndsAt: null,
      lastSyncedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null
    })

    expect(result.success).toBe(true)
  })
})

describe("haulCancellationBlock", () => {
  it("allows cancelling a booking until the truck reaches the destination", () => {
    for (const status of ["assigned", "en_route_to_landing", "checked_in", "loading", "loaded", "en_route_to_destination"] as const) {
      expect(haulCancellationBlock({ completionStatus: "pending", status })).toBeNull()
    }
  })

  it("refuses once the truck is at the destination, even before anything is recorded", () => {
    for (const status of ["at_destination", "unloading", "completed"] as const) {
      expect(haulCancellationBlock({ completionStatus: "pending", status })).toBe("at_destination")
    }
  })

  it("refuses once a delivery is recorded or disputed, and names a confirmed one", () => {
    expect(haulCancellationBlock({ completionStatus: "submitted", status: "unloading" })).toBe("delivery_recorded")
    expect(haulCancellationBlock({ completionStatus: "disputed", status: "completed" })).toBe("delivery_recorded")
    expect(haulCancellationBlock({ completionStatus: "confirmed", status: "completed" })).toBe("confirmed")
  })
})
