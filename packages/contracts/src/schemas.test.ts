import { describe, expect, it } from "vitest"

import {
  assignmentSchema,
  driverProfileSchema,
  loadPostingSchema,
  truckProfileSchema,
  truckSlotSchema
} from "./schemas"

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

  it("keeps driver fuel-price assumptions within persisted bounds", () => {
    const profile = {
      id: "11111111-1111-1111-1111-111111111111",
      userId: "22222222-2222-2222-2222-222222222222",
      companyId: null,
      availabilityStatus: "available",
      licenseNumber: "OR-12345",
      yearsExperience: 8,
      homeBase: "Eugene, OR",
      homeBaseCoordinates: null,
      operatingRadiusMiles: 150,
      profilePhoto: null,
      equipmentPreferences: [],
      notes: null,
      createdAt: baseTimestamp,
      updatedAt: baseTimestamp
    }

    expect(driverProfileSchema.safeParse({ ...profile, preferredFuelPriceCentsPerGallon: 100 }).success).toBe(true)
    expect(driverProfileSchema.safeParse({ ...profile, preferredFuelPriceCentsPerGallon: 1000 }).success).toBe(true)
    expect(driverProfileSchema.safeParse({ ...profile, preferredFuelPriceCentsPerGallon: 99 }).success).toBe(false)
    expect(driverProfileSchema.safeParse({ ...profile, preferredFuelPriceCentsPerGallon: 1001 }).success).toBe(false)
  })

  it("keeps truck fuel economy within persisted bounds", () => {
    const truck = {
      id: "11111111-1111-1111-1111-111111111111",
      ownerUserId: "22222222-2222-2222-2222-222222222222",
      companyId: null,
      truckType: "log_truck",
      unitNumber: "17",
      make: "Kenworth",
      model: "W900",
      plateNumber: "OR-TRUCK",
      vin: null,
      axleCount: 5,
      maxPayloadTons: 28,
      photo: null,
      equipmentTags: [],
      roadAccessCapabilities: [],
      archivedAt: null,
      createdAt: baseTimestamp,
      updatedAt: baseTimestamp
    }

    expect(truckProfileSchema.safeParse({ ...truck, fuelEconomyMpg: 3 }).success).toBe(true)
    expect(truckProfileSchema.safeParse({ ...truck, fuelEconomyMpg: 15 }).success).toBe(true)
    expect(truckProfileSchema.safeParse({ ...truck, fuelEconomyMpg: 2.9 }).success).toBe(false)
    expect(truckProfileSchema.safeParse({ ...truck, fuelEconomyMpg: 15.1 }).success).toBe(false)
  })

  it("stores driver-payment receipt sides only as an ordered, distinct-person pair", () => {
    const assignment = {
      assignedAt: baseTimestamp,
      cancelledAt: null,
      cancellationReason: null,
      completedAt: null,
      createdAt: baseTimestamp,
      directOfferId: null,
      dispatcherNotes: null,
      driverPaymentReceivedAt: null,
      driverPaymentReceivedByUserId: null,
      driverPaymentSentAt: baseTimestamp,
      driverPaymentSentByUserId: "22222222-2222-4222-8222-222222222222",
      driverProfileId: "33333333-3333-4333-8333-333333333333",
      id: "11111111-1111-4111-8111-111111111111",
      loadPostingId: "44444444-4444-4444-8444-444444444444",
      requestedAt: baseTimestamp,
      status: "accepted",
      termsSnapshot: {},
      trailerProfileId: null,
      truckProfileId: "55555555-5555-4555-8555-555555555555",
      truckSlotId: "66666666-6666-4666-8666-666666666666",
      updatedAt: baseTimestamp
    }
    const receiver = "77777777-7777-4777-8777-777777777777"

    expect(assignmentSchema.safeParse(assignment).success).toBe(true)
    expect(assignmentSchema.safeParse({
      ...assignment,
      driverPaymentReceivedAt: "2026-06-05T11:59:00.000Z",
      driverPaymentReceivedByUserId: receiver
    }).success).toBe(false)
    expect(assignmentSchema.safeParse({
      ...assignment,
      driverPaymentReceivedAt: "2026-06-05T12:01:00.000Z",
      driverPaymentReceivedByUserId: null
    }).success).toBe(false)
    expect(assignmentSchema.safeParse({
      ...assignment,
      driverPaymentReceivedAt: "2026-06-05T12:01:00.000Z",
      driverPaymentReceivedByUserId: assignment.driverPaymentSentByUserId
    }).success).toBe(false)
    expect(assignmentSchema.safeParse({
      ...assignment,
      driverPaymentReceivedAt: "2026-06-05T12:01:00.000Z",
      driverPaymentReceivedByUserId: receiver
    }).success).toBe(true)
  })
})
