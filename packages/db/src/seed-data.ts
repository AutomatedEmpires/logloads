import {
  assignmentSchema,
  auditEventSchema,
  availabilityWindowSchema,
  dispatcherProfileSchema,
  driverProfileSchema,
  haulRouteSchema,
  landingSchema,
  loaderProfileSchema,
  loggingCompanySchema,
  loadPostingSchema,
  messageEventSchema,
  messageThreadSchema,
  millSchema,
  notificationSchema,
  rateSchema,
  trailerProfileSchema,
  truckProfileSchema,
  truckSlotSchema,
  userSchema,
  type Assignment,
  type AuditEvent,
  type AvailabilityWindow,
  type DispatcherProfile,
  type DriverProfile,
  type HaulRoute,
  type Landing,
  type LoaderProfile,
  type LoggingCompany,
  type LoadPosting,
  type MessageEvent,
  type MessageThread,
  type Mill,
  type Notification,
  type Rate,
  type TrailerProfile,
  type TruckProfile,
  type TruckSlot,
  type User
} from "@logloads/core"

import type { LogLoadsDatabaseState } from "./types"

const parseMany = <T>(schema: { parse: (value: unknown) => T }, values: unknown[]): T[] =>
  values.map((value) => schema.parse(value))

const timestamps = {
  created: "2026-06-04T16:00:00.000Z",
  updated: "2026-06-04T16:00:00.000Z",
  requested: "2026-06-05T12:00:00.000Z",
  assigned: "2026-06-05T13:00:00.000Z",
  completed: "2026-06-05T19:30:00.000Z",
  cancelled: "2026-06-05T14:45:00.000Z"
}

export const seedProfiles: User[] = parseMany(userSchema, [
  {
    id: "11111111-1111-4111-8111-111111111111",
    clerkUserId: "clerk-admin-1",
    role: "admin",
    fullName: "LogLoads Admin",
    phone: "555-0001",
    email: "admin@logloads.example",
    companyId: null,
    verificationStatus: "verified",
    isActive: true,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "22222222-2222-4222-8222-222222222221",
    clerkUserId: "clerk-driver-1",
    role: "driver",
    fullName: "Hank Hauler",
    phone: "555-1001",
    email: "hank@northpine.example",
    companyId: "33333333-3333-4333-8333-333333333331",
    verificationStatus: "verified",
    isActive: true,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    clerkUserId: "clerk-driver-2",
    role: "driver",
    fullName: "Maya Mills",
    phone: "555-1002",
    email: "maya@northpine.example",
    companyId: "33333333-3333-4333-8333-333333333331",
    verificationStatus: "verified",
    isActive: true,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "22222222-2222-4222-8222-222222222223",
    clerkUserId: "clerk-driver-3",
    role: "owner_operator",
    fullName: "Cole Cedar",
    phone: "555-1003",
    email: "cole@summit.example",
    companyId: "33333333-3333-4333-8333-333333333332",
    verificationStatus: "verified",
    isActive: true,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "22222222-2222-4222-8222-222222222224",
    clerkUserId: "clerk-dispatch-1",
    role: "dispatcher",
    fullName: "Dana Dispatch",
    phone: "555-2001",
    email: "dispatch@northpine.example",
    companyId: "33333333-3333-4333-8333-333333333331",
    verificationStatus: "verified",
    isActive: true,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "22222222-2222-4222-8222-222222222225",
    clerkUserId: "clerk-loader-1",
    role: "loader",
    fullName: "Lee Loader",
    phone: "555-2002",
    email: "loader@northpine.example",
    companyId: "33333333-3333-4333-8333-333333333331",
    verificationStatus: "verified",
    isActive: true,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedCompanies: LoggingCompany[] = parseMany(loggingCompanySchema, [
  {
    id: "33333333-3333-4333-8333-333333333331",
    slug: "north-pine-logging",
    legalName: "North Pine Logging LLC",
    displayName: "North Pine Logging",
    verificationStatus: "verified",
    primaryRegion: "Cascade Foothills",
    contact: {
      name: "Dana Dispatch",
      phone: "555-2001",
      email: "dispatch@northpine.example"
    },
    notes: "Primary production crew covering weekday chip and saw-log runs.",
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "33333333-3333-4333-8333-333333333332",
    slug: "summit-ridge-timber",
    legalName: "Summit Ridge Timber Inc.",
    displayName: "Summit Ridge Timber",
    verificationStatus: "verified",
    primaryRegion: "Blue River Corridor",
    contact: {
      name: "Cole Cedar",
      phone: "555-1003",
      email: "cole@summit.example"
    },
    notes: "Owner-operator heavy outfit handling mixed terrain landings.",
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedDriverProfiles: DriverProfile[] = parseMany(driverProfileSchema, [
  {
    id: "44444444-4444-4444-8444-444444444441",
    userId: "22222222-2222-4222-8222-222222222221",
    companyId: "33333333-3333-4333-8333-333333333331",
    availabilityStatus: "available",
    licenseNumber: "CDL-A-9001",
    yearsExperience: 11,
    homeBase: "Cascade Foothills",
    equipmentPreferences: ["tridem", "self-loader"],
    notes: "Prefers sunrise dispatch and chip loads.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "44444444-4444-4444-8444-444444444442",
    userId: "22222222-2222-4222-8222-222222222222",
    companyId: "33333333-3333-4333-8333-333333333331",
    availabilityStatus: "limited",
    licenseNumber: "CDL-A-9002",
    yearsExperience: 7,
    homeBase: "Oak Landing",
    equipmentPreferences: ["pole-trailer"],
    notes: "Unavailable after 16:00 on Fridays.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "44444444-4444-4444-8444-444444444443",
    userId: "22222222-2222-4222-8222-222222222223",
    companyId: "33333333-3333-4333-8333-333333333332",
    availabilityStatus: "available",
    licenseNumber: "CDL-A-9003",
    yearsExperience: 14,
    homeBase: "Blue River",
    equipmentPreferences: ["bunk-trailer", "chains"],
    notes: "Comfortable with snowy high-grade routes.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedDispatcherProfiles: DispatcherProfile[] = parseMany(dispatcherProfileSchema, [
  {
    id: "55555555-5555-4555-8555-555555555551",
    userId: "22222222-2222-4222-8222-222222222224",
    companyId: "33333333-3333-4333-8333-333333333331",
    dispatchRegion: "Cascade Foothills",
    contact: {
      name: "Dana Dispatch",
      phone: "555-2001",
      email: "dispatch@northpine.example"
    },
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedLoaderProfiles: LoaderProfile[] = parseMany(loaderProfileSchema, [
  {
    id: "55555555-5555-4555-8555-555555555552",
    userId: "22222222-2222-4222-8222-222222222225",
    companyId: "33333333-3333-4333-8333-333333333331",
    landingId: "66666666-6666-4666-8666-666666666661",
    contact: {
      name: "Lee Loader",
      phone: "555-2002",
      email: "loader@northpine.example"
    },
    shiftNotes: "Loader starts 05:30 weekdays.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedTruckProfiles: TruckProfile[] = parseMany(truckProfileSchema, [
  {
    id: "77777777-7777-4777-8777-777777777771",
    ownerUserId: "22222222-2222-4222-8222-222222222221",
    companyId: "33333333-3333-4333-8333-333333333331",
    truckType: "log_truck",
    unitNumber: "NP-101",
    make: "Kenworth",
    model: "T880",
    plateNumber: "LOG101",
    vin: "VIN-NP-101",
    axleCount: 4,
    maxPayloadTons: 28,
    equipmentTags: ["chains", "radio"],
    roadAccessCapabilities: ["steep-grade", "gravel"],
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "77777777-7777-4777-8777-777777777772",
    ownerUserId: "22222222-2222-4222-8222-222222222222",
    companyId: "33333333-3333-4333-8333-333333333331",
    truckType: "chip_truck",
    unitNumber: "NP-202",
    make: "Peterbilt",
    model: "567",
    plateNumber: "CHP202",
    vin: "VIN-NP-202",
    axleCount: 5,
    maxPayloadTons: 31,
    equipmentTags: ["chip-box"],
    roadAccessCapabilities: ["paved", "mill-yard"],
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "77777777-7777-4777-8777-777777777773",
    ownerUserId: "22222222-2222-4222-8222-222222222223",
    companyId: "33333333-3333-4333-8333-333333333332",
    truckType: "log_truck",
    unitNumber: "SR-330",
    make: "Western Star",
    model: "49X",
    plateNumber: "LOG330",
    vin: "VIN-SR-330",
    axleCount: 4,
    maxPayloadTons: 29,
    equipmentTags: ["chains", "snow-kit"],
    roadAccessCapabilities: ["forest-road", "snow"],
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedTrailerProfiles: TrailerProfile[] = parseMany(trailerProfileSchema, [
  {
    id: "88888888-8888-4888-8888-888888888881",
    ownerUserId: "22222222-2222-4222-8222-222222222221",
    truckId: "77777777-7777-4777-8777-777777777771",
    trailerType: "pole_trailer",
    unitNumber: "TRL-101",
    capacityTons: 28,
    equipmentTags: ["stakes"],
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "88888888-8888-4888-8888-888888888882",
    ownerUserId: "22222222-2222-4222-8222-222222222222",
    truckId: "77777777-7777-4777-8777-777777777772",
    trailerType: "chip_van",
    unitNumber: "TRL-202",
    capacityTons: 32,
    equipmentTags: ["chip-box"],
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "88888888-8888-4888-8888-888888888883",
    ownerUserId: "22222222-2222-4222-8222-222222222223",
    truckId: "77777777-7777-4777-8777-777777777773",
    trailerType: "bunk_trailer",
    unitNumber: "TRL-330",
    capacityTons: 29,
    equipmentTags: ["chains"],
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedLandings: Landing[] = parseMany(landingSchema, [
  {
    id: "66666666-6666-4666-8666-666666666661",
    companyId: "33333333-3333-4333-8333-333333333331",
    name: "Oak Landing",
    addressLine1: "100 Timber Rd",
    city: "Oakridge",
    state: "OR",
    postalCode: "97463",
    coordinates: { lat: 43.7471, lng: -122.4617 },
    contact: {
      name: "Lee Loader",
      phone: "555-2002",
      email: "loader@northpine.example"
    },
    slotWindowMinutes: 30,
    accessNotes: "Single-lane bridge before entry.",
    roadCondition: "good",
    weatherNotes: null,
    isActive: true,
    loaderProfileId: "55555555-5555-4555-8555-555555555552",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "66666666-6666-4666-8666-666666666662",
    companyId: "33333333-3333-4333-8333-333333333332",
    name: "Blue River Landing",
    addressLine1: "44 Spur Rd",
    city: "Blue River",
    state: "OR",
    postalCode: "97413",
    coordinates: { lat: 44.1926, lng: -122.0898 },
    contact: {
      name: "Cole Cedar",
      phone: "555-1003",
      email: "cole@summit.example"
    },
    slotWindowMinutes: 20,
    accessNotes: "Chains required during winter advisories.",
    roadCondition: "wet",
    weatherNotes: "Monitor afternoon storms.",
    isActive: true,
    loaderProfileId: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedMills: Mill[] = parseMany(millSchema, [
  {
    id: "99999999-9999-4999-8999-999999999991",
    companyId: null,
    name: "Cascade Mill",
    addressLine1: "12 Mill Ave",
    city: "Springfield",
    state: "OR",
    postalCode: "97477",
    coordinates: { lat: 44.0462, lng: -123.022 },
    contact: {
      name: "Scale House",
      phone: "555-3001",
      email: "scale@cascade.example"
    },
    slotWindowMinutes: 15,
    accessNotes: "Check in at gate 2.",
    roadCondition: "good",
    weatherNotes: null,
    isActive: true,
    millCode: "CAS-MILL",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "99999999-9999-4999-8999-999999999992",
    companyId: null,
    name: "River Pulp",
    addressLine1: "88 River Loop",
    city: "Eugene",
    state: "OR",
    postalCode: "97402",
    coordinates: { lat: 44.0521, lng: -123.1492 },
    contact: {
      name: "Unload Desk",
      phone: "555-3002",
      email: "unload@riverpulp.example"
    },
    slotWindowMinutes: 20,
    accessNotes: "Chip deliveries use west entrance.",
    roadCondition: "good",
    weatherNotes: null,
    isActive: true,
    millCode: "RIV-PULP",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedHaulRoutes: HaulRoute[] = parseMany(haulRouteSchema, [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    companyId: "33333333-3333-4333-8333-333333333331",
    landingId: "66666666-6666-4666-8666-666666666661",
    millId: "99999999-9999-4999-8999-999999999991",
    routeName: "Oak Landing to Cascade Mill",
    estimatedDistanceMiles: 54.2,
    estimatedRunTimeMinutes: 105,
    roadCondition: "good",
    mapPolyline: null,
    roadNotes: "Use Highway 58 after leaving the timber road.",
    weatherNotes: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    companyId: "33333333-3333-4333-8333-333333333331",
    landingId: "66666666-6666-4666-8666-666666666661",
    millId: "99999999-9999-4999-8999-999999999992",
    routeName: "Oak Landing to River Pulp",
    estimatedDistanceMiles: 48.5,
    estimatedRunTimeMinutes: 95,
    roadCondition: "wet",
    mapPolyline: null,
    roadNotes: "Expect heavier traffic through Eugene.",
    weatherNotes: "Morning fog is common.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    companyId: "33333333-3333-4333-8333-333333333332",
    landingId: "66666666-6666-4666-8666-666666666662",
    millId: "99999999-9999-4999-8999-999999999991",
    routeName: "Blue River to Cascade Mill",
    estimatedDistanceMiles: 67.8,
    estimatedRunTimeMinutes: 120,
    roadCondition: "wet",
    mapPolyline: null,
    roadNotes: "Grade increases sharply after mile 18.",
    weatherNotes: "Chains may be needed overnight.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
    companyId: "33333333-3333-4333-8333-333333333332",
    landingId: "66666666-6666-4666-8666-666666666662",
    millId: "99999999-9999-4999-8999-999999999992",
    routeName: "Blue River to River Pulp",
    estimatedDistanceMiles: 61.3,
    estimatedRunTimeMinutes: 112,
    roadCondition: "restricted",
    mapPolyline: null,
    roadNotes: "Temporary one-lane control at county bridge.",
    weatherNotes: "Watch for thunderstorm debris.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedRates: Rate[] = parseMany(rateSchema, [
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    companyId: "33333333-3333-4333-8333-333333333331",
    rateType: "per_load",
    baseRate: { amountCents: 185000, currency: "USD" },
    fuelSurchargeCents: 12000,
    notes: "Oak Landing saw-log baseline.",
    effectiveDate: "2026-06-01",
    expiresAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
    companyId: "33333333-3333-4333-8333-333333333331",
    rateType: "per_ton",
    baseRate: { amountCents: 6200, currency: "USD" },
    fuelSurchargeCents: 900,
    notes: "Chip load rate to River Pulp.",
    effectiveDate: "2026-06-01",
    expiresAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
    companyId: "33333333-3333-4333-8333-333333333332",
    rateType: "flat_rate",
    baseRate: { amountCents: 210000, currency: "USD" },
    fuelSurchargeCents: 15000,
    notes: "High-elevation haul incentive.",
    effectiveDate: "2026-06-01",
    expiresAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedLoadPostings: LoadPosting[] = parseMany(loadPostingSchema, [
  {
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    companyId: "33333333-3333-4333-8333-333333333331",
    dispatcherProfileId: "55555555-5555-4555-8555-555555555551",
    loaderProfileId: "55555555-5555-4555-8555-555555555552",
    pickupLandingId: "66666666-6666-4666-8666-666666666661",
    dropoffMillId: "99999999-9999-4999-8999-999999999991",
    routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    title: "Oak saw-log morning run",
    loadType: "saw_logs",
    status: "open",
    scheduleType: "one_off",
    loadDate: "2026-06-06",
    campaignStartDate: null,
    campaignEndDate: null,
    recurringSchedule: null,
    dailyTruckCountNeeded: 3,
    estimatedTonsPerLoad: 28,
    equipmentRequirements: ["pole-trailer"],
    accessRequirements: ["radio"],
    roadCondition: "good",
    weatherNotes: null,
    dispatcherContact: {
      name: "Dana Dispatch",
      phone: "555-2001",
      email: "dispatch@northpine.example"
    },
    loaderContact: {
      name: "Lee Loader",
      phone: "555-2002",
      email: "loader@northpine.example"
    },
    cancellationReason: null,
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
    companyId: "33333333-3333-4333-8333-333333333331",
    dispatcherProfileId: "55555555-5555-4555-8555-555555555551",
    loaderProfileId: "55555555-5555-4555-8555-555555555552",
    pickupLandingId: "66666666-6666-4666-8666-666666666661",
    dropoffMillId: "99999999-9999-4999-8999-999999999992",
    routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
    title: "Oak chip shuttle",
    loadType: "chips",
    status: "scheduled",
    scheduleType: "recurring",
    loadDate: null,
    campaignStartDate: "2026-06-06",
    campaignEndDate: "2026-06-20",
    recurringSchedule: {
      frequency: "weekly",
      daysOfWeek: [1, 3, 5],
      untilDate: "2026-06-20"
    },
    dailyTruckCountNeeded: 2,
    estimatedTonsPerLoad: 30,
    equipmentRequirements: ["chip-box"],
    accessRequirements: ["west-gate"],
    roadCondition: "wet",
    weatherNotes: "Fog through 09:00.",
    dispatcherContact: {
      name: "Dana Dispatch",
      phone: "555-2001",
      email: "dispatch@northpine.example"
    },
    loaderContact: {
      name: "Lee Loader",
      phone: "555-2002",
      email: "loader@northpine.example"
    },
    cancellationReason: null,
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    companyId: "33333333-3333-4333-8333-333333333332",
    dispatcherProfileId: "55555555-5555-4555-8555-555555555551",
    loaderProfileId: null,
    pickupLandingId: "66666666-6666-4666-8666-666666666662",
    dropoffMillId: "99999999-9999-4999-8999-999999999991",
    routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
    title: "Blue River high-grade campaign",
    loadType: "saw_logs",
    status: "open",
    scheduleType: "campaign",
    loadDate: null,
    campaignStartDate: "2026-06-06",
    campaignEndDate: "2026-06-14",
    recurringSchedule: null,
    dailyTruckCountNeeded: 4,
    estimatedTonsPerLoad: 29,
    equipmentRequirements: ["chains"],
    accessRequirements: ["snow-kit"],
    roadCondition: "restricted",
    weatherNotes: "Evening snow possible above 3000 ft.",
    dispatcherContact: {
      name: "Dana Dispatch",
      phone: "555-2001",
      email: "dispatch@northpine.example"
    },
    loaderContact: null,
    cancellationReason: null,
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc4",
    companyId: "33333333-3333-4333-8333-333333333332",
    dispatcherProfileId: "55555555-5555-4555-8555-555555555551",
    loaderProfileId: null,
    pickupLandingId: "66666666-6666-4666-8666-666666666662",
    dropoffMillId: "99999999-9999-4999-8999-999999999992",
    routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
    rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
    title: "Blue River pulp contingency",
    loadType: "pulpwood",
    status: "filled",
    scheduleType: "one_off",
    loadDate: "2026-06-07",
    campaignStartDate: null,
    campaignEndDate: null,
    recurringSchedule: null,
    dailyTruckCountNeeded: 1,
    estimatedTonsPerLoad: 27,
    equipmentRequirements: ["bunk-trailer"],
    accessRequirements: ["bridge-control"],
    roadCondition: "restricted",
    weatherNotes: null,
    dispatcherContact: {
      name: "Dana Dispatch",
      phone: "555-2001",
      email: "dispatch@northpine.example"
    },
    loaderContact: null,
    cancellationReason: null,
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc5",
    companyId: "33333333-3333-4333-8333-333333333331",
    dispatcherProfileId: "55555555-5555-4555-8555-555555555551",
    loaderProfileId: "55555555-5555-4555-8555-555555555552",
    pickupLandingId: "66666666-6666-4666-8666-666666666661",
    dropoffMillId: "99999999-9999-4999-8999-999999999991",
    routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    title: "Oak recovery load",
    loadType: "mixed",
    status: "cancelled",
    scheduleType: "one_off",
    loadDate: "2026-06-08",
    campaignStartDate: null,
    campaignEndDate: null,
    recurringSchedule: null,
    dailyTruckCountNeeded: 1,
    estimatedTonsPerLoad: 24,
    equipmentRequirements: ["pole-trailer"],
    accessRequirements: ["radio"],
    roadCondition: "muddy",
    weatherNotes: "Landing too soft after rain.",
    dispatcherContact: {
      name: "Dana Dispatch",
      phone: "555-2001",
      email: "dispatch@northpine.example"
    },
    loaderContact: {
      name: "Lee Loader",
      phone: "555-2002",
      email: "loader@northpine.example"
    },
    cancellationReason: "Landing access closed after storm.",
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc6",
    companyId: "33333333-3333-4333-8333-333333333332",
    dispatcherProfileId: "55555555-5555-4555-8555-555555555551",
    loaderProfileId: null,
    pickupLandingId: "66666666-6666-4666-8666-666666666662",
    dropoffMillId: "99999999-9999-4999-8999-999999999991",
    routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
    title: "Blue River standby swing shift",
    loadType: "biomass",
    status: "draft",
    scheduleType: "one_off",
    loadDate: "2026-06-09",
    campaignStartDate: null,
    campaignEndDate: null,
    recurringSchedule: null,
    dailyTruckCountNeeded: 2,
    estimatedTonsPerLoad: 22,
    equipmentRequirements: ["chains"],
    accessRequirements: ["snow-kit"],
    roadCondition: "wet",
    weatherNotes: null,
    dispatcherContact: {
      name: "Dana Dispatch",
      phone: "555-2001",
      email: "dispatch@northpine.example"
    },
    loaderContact: null,
    cancellationReason: null,
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedTruckSlots: TruckSlot[] = parseMany(truckSlotSchema, [
  {
    id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    landingId: "66666666-6666-4666-8666-666666666661",
    loaderProfileId: "55555555-5555-4555-8555-555555555552",
    slotDate: "2026-06-06",
    startAt: "2026-06-06T13:00:00.000Z",
    endAt: "2026-06-06T13:30:00.000Z",
    capacity: 2,
    reservedCount: 1,
    status: "reserved",
    notes: "First wave loadout.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    landingId: "66666666-6666-4666-8666-666666666661",
    loaderProfileId: "55555555-5555-4555-8555-555555555552",
    slotDate: "2026-06-06",
    startAt: "2026-06-06T14:00:00.000Z",
    endAt: "2026-06-06T14:30:00.000Z",
    capacity: 2,
    reservedCount: 0,
    status: "open",
    notes: "Second wave loadout.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd3",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
    landingId: "66666666-6666-4666-8666-666666666661",
    loaderProfileId: "55555555-5555-4555-8555-555555555552",
    slotDate: "2026-06-07",
    startAt: "2026-06-07T13:00:00.000Z",
    endAt: "2026-06-07T13:20:00.000Z",
    capacity: 1,
    reservedCount: 1,
    status: "filled",
    notes: "Chip shuttle slot.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd4",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    landingId: "66666666-6666-4666-8666-666666666662",
    loaderProfileId: null,
    slotDate: "2026-06-06",
    startAt: "2026-06-06T15:00:00.000Z",
    endAt: "2026-06-06T15:20:00.000Z",
    capacity: 2,
    reservedCount: 1,
    status: "requested",
    notes: "Awaiting confirmation from high-grade crew.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd5",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc4",
    landingId: "66666666-6666-4666-8666-666666666662",
    loaderProfileId: null,
    slotDate: "2026-06-07",
    startAt: "2026-06-07T16:00:00.000Z",
    endAt: "2026-06-07T16:20:00.000Z",
    capacity: 1,
    reservedCount: 1,
    status: "completed",
    notes: "Completed contingency run.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedAvailabilityWindows: AvailabilityWindow[] = parseMany(availabilityWindowSchema, [
  {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
    driverProfileId: "44444444-4444-4444-8444-444444444441",
    truckProfileId: "77777777-7777-4777-8777-777777777771",
    status: "available",
    startAt: "2026-06-06T12:30:00.000Z",
    endAt: "2026-06-06T22:00:00.000Z",
    preferredRouteIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"],
    notes: "Open for full day saw-log work.",
    recurringSchedule: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
    driverProfileId: "44444444-4444-4444-8444-444444444442",
    truckProfileId: "77777777-7777-4777-8777-777777777772",
    status: "limited",
    startAt: "2026-06-06T12:30:00.000Z",
    endAt: "2026-06-06T20:00:00.000Z",
    preferredRouteIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"],
    notes: "Needs to clear by 20:00.",
    recurringSchedule: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3",
    driverProfileId: "44444444-4444-4444-8444-444444444443",
    truckProfileId: "77777777-7777-4777-8777-777777777773",
    status: "available",
    startAt: "2026-06-06T14:00:00.000Z",
    endAt: "2026-06-06T23:00:00.000Z",
    preferredRouteIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4"],
    notes: "Mountain haul capable.",
    recurringSchedule: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedAssignments: Assignment[] = parseMany(assignmentSchema, [
  {
    id: "ffffffff-ffff-4fff-8fff-fffffffffff1",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
    driverProfileId: "44444444-4444-4444-8444-444444444441",
    truckProfileId: "77777777-7777-4777-8777-777777777771",
    trailerProfileId: "88888888-8888-4888-8888-888888888881",
    status: "accepted",
    requestedAt: timestamps.requested,
    assignedAt: timestamps.assigned,
    completedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    dispatcherNotes: "Be on channel 4 entering the landing.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "ffffffff-ffff-4fff-8fff-fffffffffff2",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
    truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd3",
    driverProfileId: "44444444-4444-4444-8444-444444444442",
    truckProfileId: "77777777-7777-4777-8777-777777777772",
    trailerProfileId: "88888888-8888-4888-8888-888888888882",
    status: "completed",
    requestedAt: timestamps.requested,
    assignedAt: timestamps.assigned,
    completedAt: timestamps.completed,
    cancelledAt: null,
    cancellationReason: null,
    dispatcherNotes: "Completed before noon window closed.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "ffffffff-ffff-4fff-8fff-fffffffffff3",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd4",
    driverProfileId: "44444444-4444-4444-8444-444444444443",
    truckProfileId: "77777777-7777-4777-8777-777777777773",
    trailerProfileId: "88888888-8888-4888-8888-888888888883",
    status: "requested",
    requestedAt: timestamps.requested,
    assignedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    dispatcherNotes: "Pending confirmation on route restrictions.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "ffffffff-ffff-4fff-8fff-fffffffffff4",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc5",
    truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
    driverProfileId: "44444444-4444-4444-8444-444444444441",
    truckProfileId: "77777777-7777-4777-8777-777777777771",
    trailerProfileId: "88888888-8888-4888-8888-888888888881",
    status: "cancelled",
    requestedAt: timestamps.requested,
    assignedAt: timestamps.assigned,
    completedAt: null,
    cancelledAt: timestamps.cancelled,
    cancellationReason: "Landing closure due to washout.",
    dispatcherNotes: "Reassign when weather clears.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedNotifications: Notification[] = parseMany(notificationSchema, [
  {
    id: "12121212-1212-4212-8212-121212121211",
    userId: "22222222-2222-4222-8222-222222222221",
    type: "assignment_confirmed",
    title: "Assignment confirmed",
    body: "Oak saw-log morning run is confirmed for 06/06.",
    relatedEntityType: "assignment",
    relatedEntityId: "ffffffff-ffff-4fff-8fff-fffffffffff1",
    readAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "12121212-1212-4212-8212-121212121212",
    userId: "22222222-2222-4222-8222-222222222223",
    type: "assignment_requested",
    title: "Assignment request pending",
    body: "Blue River high-grade campaign request is awaiting dispatcher review.",
    relatedEntityType: "assignment",
    relatedEntityId: "ffffffff-ffff-4fff-8fff-fffffffffff3",
    readAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedMessageThreads: MessageThread[] = parseMany(messageThreadSchema, [
  {
    id: "13131313-1313-4313-8313-131313131311",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    assignmentId: "ffffffff-ffff-4fff-8fff-fffffffffff1",
    participantUserIds: [
      "22222222-2222-4222-8222-222222222221",
      "22222222-2222-4222-8222-222222222224",
      "22222222-2222-4222-8222-222222222225"
    ],
    subject: "Oak saw-log morning coordination",
    lastMessageAt: timestamps.assigned,
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedMessageEvents: MessageEvent[] = parseMany(messageEventSchema, [
  {
    id: "14141414-1414-4414-8414-141414141411",
    threadId: "13131313-1313-4313-8313-131313131311",
    authorUserId: "22222222-2222-4222-8222-222222222224",
    body: "Loader is ready at 06:00, use channel 4 for arrival.",
    createdAt: timestamps.assigned,
    updatedAt: timestamps.assigned
  },
  {
    id: "14141414-1414-4414-8414-141414141412",
    threadId: "13131313-1313-4313-8313-131313131311",
    authorUserId: "22222222-2222-4222-8222-222222222221",
    body: "Copy that, leaving yard at 05:15.",
    createdAt: timestamps.assigned,
    updatedAt: timestamps.assigned
  }
])

export const seedAuditEvents: AuditEvent[] = parseMany(auditEventSchema, [
  {
    id: "15151515-1515-4515-8515-151515151511",
    actorUserId: "22222222-2222-4222-8222-222222222224",
    entityType: "load_posting",
    entityId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    action: "created",
    metadata: {
      dailyTruckCountNeeded: 3,
      routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
    },
    createdAt: timestamps.created
  },
  {
    id: "15151515-1515-4515-8515-151515151512",
    actorUserId: "22222222-2222-4222-8222-222222222224",
    entityType: "assignment",
    entityId: "ffffffff-ffff-4fff-8fff-fffffffffff4",
    action: "cancelled",
    metadata: {
      reason: "Landing closure due to washout."
    },
    createdAt: timestamps.cancelled
  }
])

export const seedDatabaseState: LogLoadsDatabaseState = {
  profiles: seedProfiles,
  companies: seedCompanies,
  driverProfiles: seedDriverProfiles,
  dispatcherProfiles: seedDispatcherProfiles,
  loaderProfiles: seedLoaderProfiles,
  truckProfiles: seedTruckProfiles,
  trailerProfiles: seedTrailerProfiles,
  landings: seedLandings,
  mills: seedMills,
  haulRoutes: seedHaulRoutes,
  rates: seedRates,
  loadPostings: seedLoadPostings,
  truckSlots: seedTruckSlots,
  availabilityWindows: seedAvailabilityWindows,
  assignments: seedAssignments,
  notifications: seedNotifications,
  messageThreads: seedMessageThreads,
  messageEvents: seedMessageEvents,
  auditEvents: seedAuditEvents
}