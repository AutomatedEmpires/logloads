import { describe, expect, it } from "vitest"

import {
  equipmentCombinationSchema,
  opportunityCapacitySchema,
  routePackSchema,
  selectDriverEquipmentCombination,
  transitionTripStatus,
  TRIP_RECORD_LIMITS,
  tripDocumentSchema,
  tripEventSchema,
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
      allocationMode: "request_approval",
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
      allocationMode: "open_claim",
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
    const result = routePackSchema.safeParse({
      id: "33333333-3333-4333-8333-333333333333",
      loadPostingId: "22222222-2222-4222-8222-222222222222",
      landingId: "44444444-4444-4444-8444-444444444444",
      destinationId: "55555555-5555-4555-8555-555555555555",
      haulRouteId: "66666666-6666-4666-8666-666666666666",
      visibility: "assigned_only",
      cacheableOffline: true,
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
      lastVerifiedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    })

    expect(result.success).toBe(true)
  })

  it("enforces trip lifecycle ordering", () => {
    expect(transitionTripStatus("assigned", "en_route_to_landing")).toBe("en_route_to_landing")
    expect(() => transitionTripStatus("assigned", "completed")).toThrow(/Invalid trip transition/)
  })

  it("stores new Supabase trip documents and still parses legacy provider metadata", () => {
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
      provider: "supabase",
      publicId: baseDocument.storageKey,
      uploadedAt: timestamp,
      version: 1_700_000_000,
      width: 1_200
    } as const

    expect(
      tripDocumentSchema.parse({
        ...baseDocument,
        media,
        storageProvider: "supabase"
      }).storageProvider
    ).toBe("supabase")
    expect(
      tripDocumentSchema.parse({
        ...baseDocument,
        media: null,
        storageProvider: "cloudinary"
      }).storageProvider
    ).toBe("cloudinary")
    expect(
      tripDocumentSchema.parse({
        ...baseDocument,
        media: null,
        storageProvider: "external"
      }).storageProvider
    ).toBe("external")
  })

  it("validates purpose-limited trip location state", () => {
    const result = tripSchemaV2.safeParse({
      id: "77777777-7777-4777-8777-777777777777",
      assignmentId: "88888888-8888-4888-8888-888888888888",
      loadPostingId: "99999999-9999-4999-8999-999999999999",
      routePackId: null,
      driverProfileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      equipmentCombinationId: null,
      status: "assigned",
      locationVisibility: "active_trip_participants",
      locationSharingStartedAt: null,
      locationSharingEndsAt: null,
      lastSyncedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null
    })

    expect(result.success).toBe(true)
  })

  it("caps the text a trip event and a trip document store", () => {
    const event = {
      actorUserId: "22222222-2222-4222-8222-222222222222",
      createdAt: timestamp,
      id: "13131313-1313-4313-8313-131313131313",
      metadata: { assignmentId: "88888888-8888-4888-8888-888888888888" },
      note: "Checked in at the landing.",
      occurredAt: timestamp,
      source: "driver",
      tripId: "77777777-7777-4777-8777-777777777777",
      type: "landing_check_in"
    } as const

    expect(tripEventSchema.safeParse(event).success).toBe(true)
    expect(tripEventSchema.safeParse({ ...event, note: "n".repeat(TRIP_RECORD_LIMITS.eventNote) }).success).toBe(true)
    expect(tripEventSchema.safeParse({ ...event, note: "n".repeat(TRIP_RECORD_LIMITS.eventNote + 1) }).success).toBe(false)

    // The metadata bound is on its stored JSON, so a long value and many small keys fail alike.
    expect(tripEventSchema.safeParse({ ...event, metadata: { blob: "m".repeat(TRIP_RECORD_LIMITS.eventMetadataJson) } }).success).toBe(false)
    expect(
      tripEventSchema.safeParse({
        ...event,
        metadata: Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`k${index}`, index]))
      }).success
    ).toBe(false)
    expect(tripEventSchema.parse({ ...event, metadata: undefined }).metadata).toEqual({})

    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(tripEventSchema.safeParse({ ...event, metadata: cyclic }).success).toBe(false)

    const document = {
      auditMetadata: {},
      contentType: "image/jpeg",
      id: "12121212-1212-4212-8212-121212121212",
      processingStatus: "ready",
      storageKey: "logloads/trip-documents/trip-1/uploads/photo-1",
      storageProvider: "supabase",
      tripId: "77777777-7777-4777-8777-777777777777",
      type: "scale_ticket",
      uploadedAt: timestamp,
      uploadedByUserId: "22222222-2222-4222-8222-222222222222"
    } as const

    expect(tripDocumentSchema.safeParse({ ...document, filename: `${"f".repeat(TRIP_RECORD_LIMITS.documentFilename - 4)}.jpg` }).success).toBe(true)
    expect(tripDocumentSchema.safeParse({ ...document, filename: `${"f".repeat(TRIP_RECORD_LIMITS.documentFilename)}.jpg` }).success).toBe(false)
  })
})
