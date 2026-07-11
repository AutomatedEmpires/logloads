import { describe, expect, it } from "vitest"

import {
  opportunityCapacitySchema,
  routePackSchema,
  transitionTripStatus,
  tripSchemaV2
} from "./production-network"

const timestamp = "2026-06-05T12:00:00.000Z"

describe("production operating network contracts", () => {
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
})
