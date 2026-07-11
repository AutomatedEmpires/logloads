import { describe, expect, it } from "vitest"

import { evaluateLoadCompatibility } from "./matching"
import type { AvailabilityWindow, HaulRoute, LoadPosting, TrailerProfile, TruckProfile } from "./schemas"

const timestamp = "2026-06-06T12:00:00.000Z"

const truck: TruckProfile = {
  archivedAt: null,
  axleCount: 4,
  companyId: "33333333-3333-4333-8333-333333333331",
  createdAt: timestamp,
  equipmentTags: ["radio", "chains"],
  id: "77777777-7777-4777-8777-777777777771",
  make: "Kenworth",
  maxPayloadTons: 30,
  model: "T880",
  ownerUserId: "22222222-2222-4222-8222-222222222221",
  plateNumber: "LOG101",
  roadAccessCapabilities: ["forest-road"],
  truckType: "log_truck",
  unitNumber: "NP-101",
  updatedAt: timestamp,
  vin: "VIN-NP-101"
}

const trailer: TrailerProfile = {
  capacityTons: 30,
  createdAt: timestamp,
  equipmentTags: ["stakes"],
  id: "88888888-8888-4888-8888-888888888881",
  ownerUserId: truck.ownerUserId,
  trailerType: "pole_trailer",
  truckId: truck.id,
  unitNumber: "TRL-101",
  updatedAt: timestamp
}

const route: HaulRoute = {
  companyId: "33333333-3333-4333-8333-333333333331",
  createdAt: timestamp,
  estimatedDistanceMiles: 54.2,
  estimatedRunTimeMinutes: 105,
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  landingId: "66666666-6666-4666-8666-666666666661",
  mapPolyline: null,
  millId: "99999999-9999-4999-8999-999999999991",
  roadCondition: "good",
  roadNotes: "Use the operator entrance.",
  routeName: "Oak to Cascade",
  updatedAt: timestamp,
  weatherNotes: null
}

const availability: AvailabilityWindow = {
  createdAt: timestamp,
  driverProfileId: "44444444-4444-4444-8444-444444444441",
  endAt: "2026-06-06T23:00:00.000Z",
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
  notes: null,
  preferredRouteIds: [route.id],
  recurringSchedule: null,
  startAt: "2026-06-06T12:00:00.000Z",
  status: "available",
  truckProfileId: truck.id,
  updatedAt: timestamp
}

const load: LoadPosting = {
  accessRequirements: ["radio"],
  archivedAt: null,
  campaignEndDate: null,
  campaignStartDate: null,
  cancellationReason: null,
  companyId: truck.companyId ?? "33333333-3333-4333-8333-333333333331",
  createdAt: timestamp,
  dailyTruckCountNeeded: 3,
  dispatcherContact: { email: "dispatch@example.com", name: "Dana Dispatch", phone: "555-2001" },
  dispatcherProfileId: "55555555-5555-4555-8555-555555555551",
  dropoffMillId: route.millId,
  equipmentRequirements: ["pole-trailer"],
  estimatedTonsPerLoad: 28,
  id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
  loadDate: "2026-06-06",
  loaderContact: null,
  loaderProfileId: null,
  loadType: "saw_logs",
  pickupLandingId: route.landingId,
  rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  recurringSchedule: null,
  roadCondition: "good",
  routeId: route.id,
  scheduleType: "one_off",
  status: "open",
  title: "Oak saw-log morning run",
  updatedAt: timestamp,
  weatherNotes: null
}

describe("load compatibility", () => {
  it("explains a strong match when equipment, capacity, route, and availability fit", () => {
    const result = evaluateLoadCompatibility({
      availabilityWindows: [availability],
      load,
      route,
      trailer,
      truck
    })

    expect(result.eligibility).toBe("strong_match")
    expect(result.hardFailures).toEqual([])
    expect(result.positiveSignals.join(" ")).toContain("Truck type fits")
  })

  it("rejects a chip load for a log truck without chip equipment", () => {
    const result = evaluateLoadCompatibility({
      availabilityWindows: [availability],
      load: { ...load, equipmentRequirements: ["chip-box"], loadType: "chips" },
      route,
      trailer,
      truck
    })

    expect(result.eligibility).toBe("ineligible")
    expect(result.hardFailures.join(" ")).toContain("chip truck")
  })
})

