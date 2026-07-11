import { z } from "zod"

import {
  availabilityStatusSchema,
  loadStatusSchema,
  loadTypeSchema,
  rateTypeSchema,
  roadConditionSchema,
  trailerTypeSchema,
  truckTypeSchema,
  verificationStatusSchema
} from "./enums"

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime()
const optionalTimestampSchema = timestampSchema.optional().nullable()

export const organizationTypeSchema = z.enum([
  "carrier",
  "fleet",
  "landing_source",
  "destination",
  "platform"
])

export const organizationRoleSchema = z.enum([
  "owner",
  "admin",
  "dispatcher",
  "driver",
  "fleet_manager",
  "landing_manager",
  "destination_manager",
  "billing",
  "viewer"
])

export const visibilitySchema = z.enum(["public", "network", "invite_only", "private"])

export const freshnessSchema = z.object({
  verifiedAt: optionalTimestampSchema,
  source: z.enum(["operator", "driver_report", "destination", "platform", "system"]),
  confidence: z.enum(["verified", "recent", "stale", "unknown"])
})

export const organizationSchema = z.object({
  id: uuidSchema,
  slug: z.string().min(2),
  type: organizationTypeSchema,
  legalName: z.string().min(1),
  displayName: z.string().min(1),
  primaryRegion: z.string().min(1),
  verificationStatus: verificationStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  archivedAt: optionalTimestampSchema
})

export const organizationMembershipSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  userId: uuidSchema,
  role: organizationRoleSchema,
  status: z.enum(["invited", "active", "suspended", "removed"]),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const operationalPointSchema = z.object({
  label: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  precision: z.enum(["map_estimate", "operational_pin", "entrance_pin"]),
  directions: z.string().optional().nullable(),
  freshness: freshnessSchema
})

export const materialDescriptionSchema = z.object({
  loadType: loadTypeSchema,
  species: z.array(z.string().min(1)).default([]),
  productSort: z.string().optional().nullable(),
  lengthFeet: z.number().positive().optional().nullable(),
  grade: z.string().optional().nullable(),
  expectedTruckloads: z.number().int().positive(),
  expectedWeightTons: z.number().positive().optional().nullable(),
  measurementUnit: z.enum(["truckload", "ton", "mbf", "cord", "unit"]).default("truckload"),
  handlingNotes: z.string().optional().nullable()
})

export const availabilityPlanSchema = z.object({
  status: availabilityStatusSchema,
  availableNow: z.boolean(),
  startsOn: z.string().date().optional().nullable(),
  endsOn: z.string().date().optional().nullable(),
  operatingDays: z.array(z.number().int().min(0).max(6)).default([]),
  loadingHours: z.string().min(1),
  slotsRemaining: z.number().int().min(0),
  priority: z.enum(["standard", "hot", "critical"]).default("standard"),
  appointmentRequired: z.boolean()
})

export const equipmentRequirementSchema = z.object({
  truckTypes: z.array(truckTypeSchema).default([]),
  trailerTypes: z.array(trailerTypeSchema).default([]),
  minPayloadTons: z.number().positive().optional().nullable(),
  requiredTags: z.array(z.string().min(1)).default([]),
  siteConstraints: z.array(z.string().min(1)).default([]),
  permitsOrDocuments: z.array(z.string().min(1)).default([])
})

export const compensationTermsSchema = z.object({
  basis: rateTypeSchema,
  baseRateCents: z.number().int().nonnegative(),
  currency: z.string().length(3).default("USD"),
  fuelSurchargeCents: z.number().int().min(0).default(0),
  minimumGuaranteeCents: z.number().int().min(0).optional().nullable(),
  detentionTerms: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
})

export const operationalInstructionSchema = z.object({
  severity: z.enum(["critical", "standard", "optional"]),
  title: z.string().min(1),
  detail: z.string().min(1),
  freshness: freshnessSchema.optional().nullable()
})

export const loadOpportunitySchema = z.object({
  id: uuidSchema,
  publicReference: z.string().min(3),
  sourceOrganizationId: uuidSchema,
  landingId: uuidSchema,
  destinationId: uuidSchema,
  status: loadStatusSchema,
  visibility: visibilitySchema,
  material: materialDescriptionSchema,
  availability: availabilityPlanSchema,
  equipment: equipmentRequirementSchema,
  compensation: compensationTermsSchema,
  instructions: z.array(operationalInstructionSchema).default([]),
  currentRoadCondition: roadConditionSchema,
  createdByUserId: uuidSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  archivedAt: optionalTimestampSchema
})

export const tripStatusSchema = z.enum([
  "assigned",
  "en_route_to_landing",
  "checked_in",
  "loading",
  "loaded",
  "en_route_to_destination",
  "at_destination",
  "unloading",
  "completed",
  "cancelled"
])

export const tripEventTypeSchema = z.enum([
  "assignment_created",
  "driver_status",
  "landing_check_in",
  "loaded",
  "destination_arrival",
  "ticket_uploaded",
  "condition_changed",
  "completed",
  "cancelled"
])

export const operationalNoticeSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  relatedLoadId: uuidSchema.optional().nullable(),
  relatedLandingId: uuidSchema.optional().nullable(),
  relatedDestinationId: uuidSchema.optional().nullable(),
  severity: z.enum(["info", "watch", "critical"]),
  title: z.string().min(1),
  body: z.string().min(1),
  effectiveAt: timestampSchema,
  expiresAt: optionalTimestampSchema,
  createdAt: timestampSchema
})

export const tripSchema = z.object({
  id: uuidSchema,
  assignmentId: uuidSchema,
  loadOpportunityId: uuidSchema,
  driverProfileId: uuidSchema,
  truckProfileId: uuidSchema,
  status: tripStatusSchema,
  locationSharing: z.object({
    enabled: z.boolean(),
    visibleToOrganizationIds: z.array(uuidSchema).default([]),
    startsAt: optionalTimestampSchema,
    endsAt: optionalTimestampSchema,
    retentionDays: z.number().int().min(0).max(30)
  }),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  completedAt: optionalTimestampSchema
})

export type Organization = z.infer<typeof organizationSchema>
export type OrganizationMembership = z.infer<typeof organizationMembershipSchema>
export type OperationalPoint = z.infer<typeof operationalPointSchema>
export type MaterialDescription = z.infer<typeof materialDescriptionSchema>
export type AvailabilityPlan = z.infer<typeof availabilityPlanSchema>
export type EquipmentRequirement = z.infer<typeof equipmentRequirementSchema>
export type CompensationTerms = z.infer<typeof compensationTermsSchema>
export type OperationalInstruction = z.infer<typeof operationalInstructionSchema>
export type LoadOpportunity = z.infer<typeof loadOpportunitySchema>
export type OperationalNotice = z.infer<typeof operationalNoticeSchema>
export type Trip = z.infer<typeof tripSchema>
export type TripStatus = z.infer<typeof tripStatusSchema>
export type TripEventType = z.infer<typeof tripEventTypeSchema>

