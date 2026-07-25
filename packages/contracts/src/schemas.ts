import { z } from "zod"

import {
  assignmentStatusSchema,
  availabilityStatusSchema,
  loadStatusSchema,
  loadTypeSchema,
  notificationTypeSchema,
  rateTypeSchema,
  roadConditionSchema,
  scheduleTypeSchema,
  trailerTypeSchema,
  truckSlotStatusSchema,
  truckTypeSchema,
  userRoleSchema,
  verificationStatusSchema
} from "./enums"
import { isValidTimeRange } from "./helpers/date-time"

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime()
const optionalTimestampSchema = timestampSchema.optional().nullable()

export const coordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
})

export const mediaReferenceSchema = z.object({
  provider: z.literal("cloudinary"),
  publicId: z.string().min(1),
  version: z.number().int().positive(),
  format: z.enum(["jpg", "jpeg", "png", "webp"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive().max(10_000_000),
  uploadedAt: timestampSchema
})

export const contactSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(7),
  email: z.string().email().optional().nullable()
})

export const moneySchema = z.object({
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3).default("USD")
})

export const recurringScheduleSchema = z.object({
  frequency: z.enum(["daily", "weekly"]),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
  untilDate: z.string().date().optional().nullable()
})

export const locationWindowSchema = z
  .object({
    startAt: timestampSchema,
    endAt: timestampSchema
  })
  .refine(isValidTimeRange, "Time windows must end after they start")

export const userSchema = z.object({
  id: uuidSchema,
  clerkUserId: z.string().min(1),
  role: userRoleSchema,
  fullName: z.string().min(1),
  phone: z.string().min(7),
  email: z.string().email().optional().nullable(),
  companyId: uuidSchema.optional().nullable(),
  verificationStatus: verificationStatusSchema,
  isActive: z.boolean().default(true),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const loggingCompanySchema = z.object({
  id: uuidSchema,
  slug: z.string().min(2),
  legalName: z.string().min(1),
  displayName: z.string().min(1),
  verificationStatus: verificationStatusSchema,
  primaryRegion: z.string().min(1),
  contact: contactSchema,
  notes: z.string().optional().nullable(),
  archivedAt: optionalTimestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const driverProfileSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  companyId: uuidSchema.optional().nullable(),
  availabilityStatus: availabilityStatusSchema,
  licenseNumber: z.string().min(1),
  yearsExperience: z.number().int().min(0),
  homeBase: z.string().min(1),
  homeBaseCoordinates: coordinatesSchema.optional().nullable(),
  preferredFuelPriceCentsPerGallon: z.number().int().min(100).max(1000).optional().nullable(),
  operatingRadiusMiles: z.number().positive().optional().nullable(),
  profilePhoto: mediaReferenceSchema.optional().nullable(),
  /**
   * The driver's choice to show their rig's photo on their profile to the
   * people they work with. Presentation only — the photo itself lives on the
   * truck profile, and readers re-resolve it through the current active
   * equipment at request time.
   */
  featureTruckPhoto: z.boolean().default(false),
  equipmentPreferences: z.array(z.string()).default([]),
  notes: z.string().optional().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const dispatcherProfileSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  companyId: uuidSchema,
  dispatchRegion: z.string().min(1),
  contact: contactSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const loaderProfileSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  companyId: uuidSchema,
  landingId: uuidSchema.optional().nullable(),
  contact: contactSchema,
  shiftNotes: z.string().optional().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const truckProfileSchema = z.object({
  id: uuidSchema,
  ownerUserId: uuidSchema,
  companyId: uuidSchema.optional().nullable(),
  truckType: truckTypeSchema,
  unitNumber: z.string().min(1),
  make: z.string().min(1),
  model: z.string().min(1),
  plateNumber: z.string().min(1),
  vin: z.string().min(6).optional().nullable(),
  axleCount: z.number().int().positive(),
  maxPayloadTons: z.number().positive(),
  fuelEconomyMpg: z.number().min(3).max(15).optional().nullable(),
  photo: mediaReferenceSchema.optional().nullable(),
  equipmentTags: z.array(z.string()).default([]),
  roadAccessCapabilities: z.array(z.string()).default([]),
  archivedAt: optionalTimestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const trailerProfileSchema = z.object({
  id: uuidSchema,
  ownerUserId: uuidSchema,
  truckId: uuidSchema.optional().nullable(),
  trailerType: trailerTypeSchema,
  unitNumber: z.string().min(1),
  capacityTons: z.number().positive(),
  photo: mediaReferenceSchema.optional().nullable(),
  equipmentTags: z.array(z.string()).default([]),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

const siteBaseSchema = z.object({
  id: uuidSchema,
  companyId: uuidSchema.optional().nullable(),
  name: z.string().min(1),
  addressLine1: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(2),
  postalCode: z.string().min(3),
  coordinates: coordinatesSchema,
  contact: contactSchema,
  slotWindowMinutes: z.number().int().positive().optional().nullable(),
  accessNotes: z.string().optional().nullable(),
  roadCondition: roadConditionSchema.optional().nullable(),
  weatherNotes: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const landingSchema = siteBaseSchema.extend({
  loaderProfileId: uuidSchema.optional().nullable()
})

export const millSchema = siteBaseSchema.extend({
  millCode: z.string().min(1)
})

export const haulRouteSchema = z.object({
  id: uuidSchema,
  companyId: uuidSchema,
  landingId: uuidSchema,
  millId: uuidSchema,
  routeName: z.string().min(1),
  estimatedDistanceMiles: z.number().positive(),
  estimatedRunTimeMinutes: z.number().int().positive(),
  roadCondition: roadConditionSchema,
  mapPolyline: z.string().optional().nullable(),
  roadNotes: z.string().optional().nullable(),
  weatherNotes: z.string().optional().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const rateSchema = z.object({
  id: uuidSchema,
  companyId: uuidSchema,
  rateType: rateTypeSchema,
  baseRate: moneySchema,
  fuelSurchargeCents: z.number().int().min(0).default(0),
  notes: z.string().optional().nullable(),
  effectiveDate: z.string().date(),
  expiresAt: optionalTimestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const loadPostingSchema = z.object({
  id: uuidSchema,
  companyId: uuidSchema,
  dispatcherProfileId: uuidSchema,
  loaderProfileId: uuidSchema.optional().nullable(),
  pickupLandingId: uuidSchema,
  dropoffMillId: uuidSchema,
  routeId: uuidSchema,
  rateId: uuidSchema,
  title: z.string().min(1),
  loadType: loadTypeSchema,
  status: loadStatusSchema,
  scheduleType: scheduleTypeSchema,
  loadDate: z.string().date().optional().nullable(),
  campaignStartDate: z.string().date().optional().nullable(),
  campaignEndDate: z.string().date().optional().nullable(),
  recurringSchedule: recurringScheduleSchema.optional().nullable(),
  dailyTruckCountNeeded: z.number().int().positive(),
  /**
   * What the host states this load pays the driver, in whole cents.
   *
   * This is the authoritative figure a driver reads — not a derivation of the
   * company rate card (`rateId`), which is a price list rather than a promise
   * about one load. The platform fee is charged to the host ON TOP of this
   * number and is never deducted from it.
   *
   * Optional only for the migration: loads posted before this field existed
   * keep falling back to their rate-derived label, because backfilling an
   * estimate into a field that means "the host said so" would manufacture a
   * commitment nobody made. Newly posted loads carry a real number.
   */
  driverPayCents: z.number().int().positive().optional().nullable(),
  estimatedTonsPerLoad: z.number().positive().optional().nullable(),
  equipmentRequirements: z.array(z.string()).default([]),
  accessRequirements: z.array(z.string()).default([]),
  roadCondition: roadConditionSchema,
  weatherNotes: z.string().optional().nullable(),
  dispatcherContact: contactSchema,
  loaderContact: contactSchema.optional().nullable(),
  cancellationReason: z.string().optional().nullable(),
  archivedAt: optionalTimestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const truckSlotSchema = z.object({
  id: uuidSchema,
  loadPostingId: uuidSchema,
  landingId: uuidSchema,
  loaderProfileId: uuidSchema.optional().nullable(),
  slotDate: z.string().date(),
  startAt: timestampSchema,
  endAt: timestampSchema,
  capacity: z.number().int().positive(),
  reservedCount: z.number().int().min(0),
  status: truckSlotStatusSchema,
  notes: z.string().optional().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})
  .refine((value) => value.reservedCount <= value.capacity, {
    message: "Reserved count cannot exceed slot capacity",
    path: ["reservedCount"]
  })
  .refine((value) => isValidTimeRange({ startAt: value.startAt, endAt: value.endAt }), {
    message: "Truck slot must end after it starts",
    path: ["endAt"]
  })

export const availabilityWindowSchema = z
  .object({
    id: uuidSchema,
    driverProfileId: uuidSchema,
    truckProfileId: uuidSchema.optional().nullable(),
    status: availabilityStatusSchema,
    startAt: timestampSchema,
    endAt: timestampSchema,
    preferredRouteIds: z.array(uuidSchema).default([]),
    notes: z.string().optional().nullable(),
    recurringSchedule: recurringScheduleSchema.optional().nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema
  })
  .refine(isValidTimeRange, {
    message: "Availability windows must end after they start",
    path: ["endAt"]
  })

export const assignmentSchema = z.object({
  id: uuidSchema,
  loadPostingId: uuidSchema,
  /**
   * The invitation that authorized this assignment, when capacity was claimed
   * through a direct offer. This is a typed relationship rather than a value
   * hidden in termsSnapshot so retries, limits, and audits can be enforced.
   */
  directOfferId: uuidSchema.optional().nullable().default(null),
  truckSlotId: uuidSchema,
  driverProfileId: uuidSchema,
  truckProfileId: uuidSchema,
  trailerProfileId: uuidSchema.optional().nullable(),
  status: assignmentStatusSchema,
  requestedAt: timestampSchema,
  assignedAt: optionalTimestampSchema,
  completedAt: optionalTimestampSchema,
  cancelledAt: optionalTimestampSchema,
  cancellationReason: z.string().optional().nullable(),
  dispatcherNotes: z.string().optional().nullable(),
  termsSnapshot: z.record(z.unknown()).default({}),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const notificationSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  type: notificationTypeSchema,
  title: z.string().min(1),
  body: z.string().min(1),
  relatedEntityType: z.string().optional().nullable(),
  relatedEntityId: uuidSchema.optional().nullable(),
  readAt: optionalTimestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const messageThreadSchema = z.object({
  id: uuidSchema,
  loadPostingId: uuidSchema.optional().nullable(),
  assignmentId: uuidSchema.optional().nullable(),
  participantUserIds: z.array(uuidSchema).min(2),
  subject: z.string().optional().nullable(),
  lastMessageAt: optionalTimestampSchema,
  archivedAt: optionalTimestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const messageEventSchema = z.object({
  id: uuidSchema,
  threadId: uuidSchema,
  authorUserId: uuidSchema,
  body: z.string().min(1),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const auditEventSchema = z.object({
  id: uuidSchema,
  actorUserId: uuidSchema.optional().nullable(),
  entityType: z.string().min(1),
  entityId: uuidSchema,
  action: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
  createdAt: timestampSchema
})

export type User = z.infer<typeof userSchema>
export type DriverProfile = z.infer<typeof driverProfileSchema>
export type MediaReference = z.infer<typeof mediaReferenceSchema>
export type TruckProfile = z.infer<typeof truckProfileSchema>
export type TrailerProfile = z.infer<typeof trailerProfileSchema>
export type LoggingCompany = z.infer<typeof loggingCompanySchema>
export type DispatcherProfile = z.infer<typeof dispatcherProfileSchema>
export type LoaderProfile = z.infer<typeof loaderProfileSchema>
export type Landing = z.infer<typeof landingSchema>
export type Mill = z.infer<typeof millSchema>
export type HaulRoute = z.infer<typeof haulRouteSchema>
export type LoadPosting = z.infer<typeof loadPostingSchema>
export type TruckSlot = z.infer<typeof truckSlotSchema>
export type AvailabilityWindow = z.infer<typeof availabilityWindowSchema>
export type Assignment = z.infer<typeof assignmentSchema>
export type Rate = z.infer<typeof rateSchema>
export type Notification = z.infer<typeof notificationSchema>
export type MessageThread = z.infer<typeof messageThreadSchema>
export type MessageEvent = z.infer<typeof messageEventSchema>
export type AuditEvent = z.infer<typeof auditEventSchema>
