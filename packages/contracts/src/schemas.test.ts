import { describe, expect, it } from "vitest"

import { loadPostingSchema, truckSlotSchema } from "./schemas"

const baseTimestamp = "2026-06-05T12:00:00.000Z"

describe("schema validation", () => {
  it("accepts a valid load posting", () => {
    const result = loadPostingSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
      companyId: "22222222-2222-2222-2222-222222222222",
      dispatcherProfileId: "33333333-3333-3333-3333-333333333333",
      loaderProfileId: "44444444-4444-4444-4444-444444444444",
      pickupLandingId: "55555555-5555-5555-5555-555555555555",
      dropoffMillId: "66666666-6666-6666-6666-666666666666",
      routeId: "77777777-7777-7777-7777-777777777777",
      rateId: "88888888-8888-8888-8888-888888888888",
      title: "Morning chip haul",
      loadType: "chips",
      status: "open",
      scheduleType: "campaign",
      loadDate: null,
      campaignStartDate: "2026-06-06",
      campaignEndDate: "2026-06-12",
      recurringSchedule: null,
      dailyTruckCountNeeded: 4,
      estimatedTonsPerLoad: 28,
      equipmentRequirements: ["tridem"],
      accessRequirements: ["chains"],
      roadCondition: "wet",
      weatherNotes: "Watch for fog before sunrise",
      dispatcherContact: {
        name: "Dana Dispatch",
        phone: "555-1000",
        email: "dana@example.com"
      },
      loaderContact: {
        name: "Lee Loader",
        phone: "555-2000",
        email: "lee@example.com"
      },
      cancellationReason: null,
      archivedAt: null,
      createdAt: baseTimestamp,
      updatedAt: baseTimestamp
    })

    expect(result.success).toBe(true)
  })

  it("rejects a truck slot whose reserved count exceeds capacity", () => {
    const result = truckSlotSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
      loadPostingId: "22222222-2222-2222-2222-222222222222",
      landingId: "33333333-3333-3333-3333-333333333333",
      loaderProfileId: null,
      slotDate: "2026-06-06",
      startAt: "2026-06-06T13:00:00.000Z",
      endAt: "2026-06-06T14:00:00.000Z",
      capacity: 2,
      reservedCount: 3,
      status: "open",
      notes: null,
      createdAt: baseTimestamp,
      updatedAt: baseTimestamp
    })

    expect(result.success).toBe(false)
  })
})