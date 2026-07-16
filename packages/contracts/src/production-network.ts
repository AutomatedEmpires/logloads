import { z } from "zod"

import {
  assignmentStatusSchema,
  loadStatusSchema,
  reviewTagSchema,
  roadConditionSchema,
  trailerTypeSchema,
  truckTypeSchema,
  verificationStatusSchema
} from "./enums"
import { organizationRoleSchema } from "./operating-network"

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime()
const optionalTimestampSchema = timestampSchema.optional().nullable()

export const organizationCapabilitySchema = z.enum([
  "hauling",
  "fleet_dispatch",
  "landing_operations",
  "receiving",
  "billing",
  "platform_operations"
])

export const networkRelationshipStatusSchema = z.enum([
  "invited",
  "active",
  "paused",
  "blocked"
])

export const invitationStatusSchema = z.enum([
  "created",
  "sent",
  "accepted",
  "expired",
  "revoked"
])

export const opportunityVisibilityModeSchema = z.enum([
  "private_network",
  "direct_offer",
  "verified_network",
  "open_network"
])

export const allocationModeSchema = z.enum([
  "open_claim",
  "request_approval",
  "direct_offer",
  "dispatcher_assignment"
])

export const equipmentCombinationStatusSchema = z.enum([
  "available",
  "committed",
  "maintenance",
  "inactive"
])

export const verificationRecordSchema = z.object({
  id: uuidSchema,
  subjectType: z.enum(["person", "organization", "truck", "equipment", "landing", "destination"]),
  subjectId: uuidSchema,
  verificationType: z.enum([
    "identity",
    "organization",
    "contact",
    "carrier_identifier",
    "equipment",
    "insurance_document",
    "facility_control",
    "landing_authorization"
  ]),
  status: verificationStatusSchema,
  source: z.enum(["self_reported", "platform_review", "landing_confirmed", "official_record_reviewed"]),
  evidenceSummary: z.string().min(1),
  reviewerUserId: uuidSchema.optional().nullable(),
  verifiedAt: optionalTimestampSchema,
  expiresAt: optionalTimestampSchema,
  lastCheckedAt: optionalTimestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const organizationInvitationSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  invitedEmail: z.string().email(),
  invitedRole: organizationRoleSchema,
  status: invitationStatusSchema,
  invitedByUserId: uuidSchema,
  acceptedByUserId: uuidSchema.optional().nullable(),
  expiresAt: timestampSchema,
  acceptedAt: optionalTimestampSchema,
  revokedAt: optionalTimestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const privateNetworkRelationshipSchema = z.object({
  id: uuidSchema,
  ownerOrganizationId: uuidSchema,
  partnerOrganizationId: uuidSchema,
  status: networkRelationshipStatusSchema,
  visibilityScope: z.enum(["private_loads", "availability", "route_history", "all_operational"]),
  preferred: z.boolean().default(false),
  notes: z.string().optional().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const equipmentCombinationSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  truckProfileId: uuidSchema,
  trailerProfileId: uuidSchema.optional().nullable(),
  assignedDriverProfileId: uuidSchema.optional().nullable(),
  label: z.string().min(1),
  truckTypes: z.array(truckTypeSchema).default([]),
  trailerTypes: z.array(trailerTypeSchema).default([]),
  capabilityTags: z.array(z.string().min(1)).default([]),
  productLengthMinFeet: z.number().positive().optional().nullable(),
  productLengthMaxFeet: z.number().positive().optional().nullable(),
  maxPayloadTons: z.number().positive(),
  status: equipmentCombinationStatusSchema,
  homeRegion: z.string().min(1),
  lastVerifiedAt: optionalTimestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const richLandingDetailsSchema = z.object({
  id: uuidSchema,
  landingId: uuidSchema,
  controlledByOrganizationId: uuidSchema,
  publicApproximateArea: z.string().min(1),
  entranceLat: z.number().min(-90).max(90),
  entranceLng: z.number().min(-180).max(180),
  exactLocationVisibility: z.enum(["assigned_only", "private_network", "organization", "public"]),
  privateRoadNotes: z.string().optional().nullable(),
  gateInstructions: z.string().optional().nullable(),
  loadingEquipment: z.array(z.string()).default([]),
  turnaroundConstraints: z.array(z.string()).default([]),
  stagingInstructions: z.string().optional().nullable(),
  communicationInstructions: z.string().optional().nullable(),
  /** PPE and safety rules a driver must follow on this landing. */
  safetyRequirements: z.array(z.string()).default([]),
  lastVerifiedAt: timestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const destinationFacilitySchema = z.object({
  id: uuidSchema,
  millId: uuidSchema,
  facilityType: z.enum(["mill", "yard", "reload", "other"]),
  managedByOrganizationId: uuidSchema.optional().nullable(),
  recordStatus: z.enum(["platform_managed", "community_suggested", "claimed", "verified"]),
  truckEntranceLat: z.number().min(-90).max(90),
  truckEntranceLng: z.number().min(-180).max(180),
  receivingHours: z.string().min(1),
  productRestrictions: z.array(z.string()).default([]),
  checkInProcess: z.string().min(1),
  scaleProcess: z.string().min(1),
  unloadingInstructions: z.string().min(1),
  /** Proof a driver must come away with (scale ticket, signed record). */
  completionEvidence: z.array(z.string()).default([]),
  currentStatus: z.enum(["open", "delayed", "closed", "limited"]),
  currentNotice: z.string().optional().nullable(),
  lastVerifiedAt: timestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const opportunityCapacitySchema = z.object({
  id: uuidSchema,
  loadPostingId: uuidSchema,
  visibilityMode: opportunityVisibilityModeSchema,
  allocationMode: allocationModeSchema,
  totalTruckloads: z.number().int().positive(),
  committedTruckloads: z.number().int().min(0),
  completedTruckloads: z.number().int().min(0),
  remainingTruckloads: z.number().int().min(0),
  acceptedTermsSnapshot: z.record(z.unknown()).default({}),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})
  .refine((value) => value.committedTruckloads <= value.totalTruckloads, {
    message: "Committed truckloads cannot exceed total truckloads",
    path: ["committedTruckloads"]
  })
  .refine((value) => value.completedTruckloads <= value.committedTruckloads, {
    message: "Completed truckloads cannot exceed committed truckloads",
    path: ["completedTruckloads"]
  })

export const routePackInstructionSchema = z.object({
  source: z.enum(["calculated_route", "operator_provided", "driver_reported", "facility_verified"]),
  severity: z.enum(["critical", "standard", "optional"]),
  title: z.string().min(1),
  detail: z.string().min(1),
  verifiedAt: optionalTimestampSchema
})

/**
 * The operational facts that governed an accepted haul, resolved from the load,
 * route, landing, destination, and assignment at approval time. Held on the
 * pack itself rather than read back through references, so a later edit to the
 * load never rewrites the instructions a driver already committed to.
 *
 * Every field a source may genuinely lack is nullable: an absent gate pin or
 * receiving window reads as unknown rather than as a confident wrong answer.
 */
export const routePackSnapshotSchema = z.object({
  capturedAt: timestampSchema,
  driverName: z.string().min(1),
  driverPhone: z.string().optional().nullable(),
  equipmentLabel: z.string().optional().nullable(),
  equipmentUnitNumber: z.string().optional().nullable(),
  hostOrganizationName: z.string().min(1),
  hostVerificationStatus: verificationStatusSchema.optional().nullable(),
  contactName: z.string().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  contactEmail: z.string().optional().nullable(),
  haulWindowStartAt: optionalTimestampSchema,
  haulWindowEndAt: optionalTimestampSchema,
  originName: z.string().min(1),
  originArea: z.string().optional().nullable(),
  originEntranceLat: z.number().min(-90).max(90).optional().nullable(),
  originEntranceLng: z.number().min(-180).max(180).optional().nullable(),
  destinationName: z.string().min(1),
  destinationReceivingHours: z.string().optional().nullable(),
  routeDistanceMiles: z.number().nonnegative().optional().nullable(),
  routeRunTimeMinutes: z.number().nonnegative().optional().nullable(),
  materialType: z.string().optional().nullable(),
  estimatedTonsPerLoad: z.number().positive().optional().nullable(),
  rateSummary: z.string().optional().nullable(),
  equipmentRequirements: z.array(z.string()).default([]),
  completionEvidence: z.array(z.string()).default([])
})

export const routePackSchema = z.object({
  id: uuidSchema,
  loadPostingId: uuidSchema,
  /**
   * null = the load-level source a host maintains. Set = an assignment-specific
   * snapshot minted when the host approved that haul. Only the latter is shown
   * to a driver as their route pack.
   */
  assignmentId: uuidSchema.optional().nullable().default(null),
  version: z.number().int().positive().default(1),
  /** Set when a newer version replaced this one; the row itself is retained. */
  supersededAt: optionalTimestampSchema,
  landingId: uuidSchema,
  destinationId: uuidSchema,
  haulRouteId: uuidSchema,
  visibility: z.enum(["assigned_only", "private_network", "organization"]),
  cacheableOffline: z.boolean().default(true),
  calculatedRouteSummary: z.string().min(1),
  localInstructions: z.array(routePackInstructionSchema).default([]),
  currentRoadCondition: roadConditionSchema,
  snapshot: routePackSnapshotSchema.optional().nullable().default(null),
  lastVerifiedAt: timestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const tripStatusV2Schema = z.enum([
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

export const tripEventTypeV2Schema = z.enum([
  "assignment_created",
  "driver_status",
  "queue_joined",
  "landing_check_in",
  "loading_started",
  "loaded",
  "departed_landing",
  "destination_arrival",
  "unloading_started",
  "ticket_uploaded",
  // The driver stating what came off the truck. Distinct from ticket_uploaded:
  // a delivery can be recorded without any document, and a document can be
  // uploaded without a delivered figure. Trip timelines render the type, so
  // conflating them would tell a reader a ticket arrived when none did.
  "delivery_recorded",
  "condition_changed",
  "completed",
  "cancelled"
])

export const locationVisibilitySchema = z.enum([
  "driver_private",
  "organization",
  "active_trip_participants",
  "never_public"
])

/** What actually came off the truck, in the unit the scale reported it. */
export const deliveredQuantitySchema = z.object({
  value: z.number().nonnegative(),
  unit: z.enum(["tons", "mbf", "cords", "units", "truckloads"]),
  /** The ticket this figure was read from, when the destination issued one. */
  ticketNumber: z.string().trim().max(60).optional().nullable()
})

export const haulExceptionSchema = z.object({
  type: z.enum([
    "short_load",
    "rejected_at_scale",
    "access_blocked",
    "equipment_failure",
    "weather_hold",
    "wait_time",
    "other"
  ]),
  note: z.string().trim().min(1).max(500),
  reportedAt: timestampSchema
})

/**
 * A haul is delivered when the driver says what came off the truck and the host
 * agrees. `submitted` is the driver's account; `confirmed` is the host
 * accepting it; `disputed` is the host contesting it with a reason. A trip may
 * be status "completed" while its completion is still `submitted` — physical
 * delivery and agreement about it are different facts.
 */
export const haulCompletionStatusSchema = z.enum(["pending", "submitted", "confirmed", "disputed"])

export const tripSchemaV2 = z.object({
  id: uuidSchema,
  assignmentId: uuidSchema,
  loadPostingId: uuidSchema,
  routePackId: uuidSchema.optional().nullable(),
  driverProfileId: uuidSchema,
  equipmentCombinationId: uuidSchema.optional().nullable(),
  status: tripStatusV2Schema,
  locationVisibility: locationVisibilitySchema,
  locationSharingStartedAt: optionalTimestampSchema,
  locationSharingEndsAt: optionalTimestampSchema,
  lastSyncedAt: optionalTimestampSchema,
  completionStatus: haulCompletionStatusSchema.default("pending"),
  deliveredQuantity: deliveredQuantitySchema.optional().nullable().default(null),
  haulException: haulExceptionSchema.optional().nullable().default(null),
  completionSubmittedAt: optionalTimestampSchema,
  completionSubmittedByUserId: uuidSchema.optional().nullable(),
  completionConfirmedAt: optionalTimestampSchema,
  completionConfirmedByUserId: uuidSchema.optional().nullable(),
  completionDisputeReason: z.string().trim().max(500).optional().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  completedAt: optionalTimestampSchema
})

export const tripEventSchema = z.object({
  id: uuidSchema,
  tripId: uuidSchema,
  type: tripEventTypeV2Schema,
  actorUserId: uuidSchema.optional().nullable(),
  source: z.enum(["driver", "dispatcher", "landing", "destination", "system"]),
  occurredAt: timestampSchema,
  note: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: timestampSchema
})

/**
 * A two-sided post-haul review. Written only for a completed trip, once per
 * (trip, direction). The subject (who is being rated) is derived server-side from
 * the trip's assignment/load, never supplied by the client.
 */
export const tripReviewSchema = z.object({
  id: uuidSchema,
  tripId: uuidSchema,
  assignmentId: uuidSchema,
  loadPostingId: uuidSchema,
  direction: z.enum(["host_rates_hauler", "hauler_rates_host"]),
  raterOrganizationId: uuidSchema,
  raterUserId: uuidSchema,
  subjectOrganizationId: uuidSchema,
  subjectDriverProfileId: uuidSchema.optional().nullable(),
  stars: z.number().int().min(1).max(5),
  tags: z.array(reviewTagSchema).default([]),
  note: z.string().trim().max(1000).optional().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const tripDocumentSchema = z.object({
  id: uuidSchema,
  tripId: uuidSchema,
  type: z.enum(["scale_ticket", "load_slip", "delivery_record", "photo", "other"]),
  storageProvider: z.enum(["cloudinary", "external"]),
  storageKey: z.string().min(1),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  uploadedByUserId: uuidSchema,
  uploadedAt: timestampSchema,
  processingStatus: z.enum(["uploaded", "processing", "ready", "failed"]),
  auditMetadata: z.record(z.unknown()).default({})
})

export const entitlementSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  product: z.enum(["driver_core", "fleet_operations", "landing_operations", "enterprise"]),
  status: z.enum(["trialing", "active", "past_due", "cancelled", "comped"]),
  features: z.array(z.string()).default([]),
  activeTruckLimit: z.number().int().positive().optional().nullable(),
  activeLandingLimit: z.number().int().positive().optional().nullable(),
  stripeCustomerId: z.string().optional().nullable(),
  stripeSubscriptionId: z.string().optional().nullable(),
  currentPeriodEndsAt: optionalTimestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const directOfferSchema = z.object({
  id: uuidSchema,
  loadPostingId: uuidSchema,
  offeredByOrganizationId: uuidSchema,
  offeredToOrganizationId: uuidSchema,
  status: z.enum(["draft", "sent", "accepted", "declined", "expired", "revoked"]),
  offeredTruckloads: z.number().int().positive(),
  termsSnapshot: z.record(z.unknown()).default({}),
  expiresAt: timestampSchema,
  respondedAt: optionalTimestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const futureAvailabilitySchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  equipmentCombinationId: uuidSchema,
  startsAt: timestampSchema,
  endsAt: timestampSchema,
  status: z.enum(["available", "tentative", "held", "unavailable"]),
  visibleToRelationshipIds: z.array(uuidSchema).default([]),
  notes: z.string().optional().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export type OrganizationCapability = z.infer<typeof organizationCapabilitySchema>
export type NetworkRelationshipStatus = z.infer<typeof networkRelationshipStatusSchema>
export type InvitationStatus = z.infer<typeof invitationStatusSchema>
export type OpportunityVisibilityMode = z.infer<typeof opportunityVisibilityModeSchema>
export type AllocationMode = z.infer<typeof allocationModeSchema>
export type EquipmentCombinationStatus = z.infer<typeof equipmentCombinationStatusSchema>
export type VerificationRecord = z.infer<typeof verificationRecordSchema>
export type OrganizationInvitation = z.infer<typeof organizationInvitationSchema>
export type PrivateNetworkRelationship = z.infer<typeof privateNetworkRelationshipSchema>
export type EquipmentCombination = z.infer<typeof equipmentCombinationSchema>
export type RichLandingDetails = z.infer<typeof richLandingDetailsSchema>
export type DestinationFacility = z.infer<typeof destinationFacilitySchema>
export type OpportunityCapacity = z.infer<typeof opportunityCapacitySchema>
export type RoutePackInstruction = z.infer<typeof routePackInstructionSchema>
export type RoutePackSnapshot = z.infer<typeof routePackSnapshotSchema>
export type RoutePack = z.infer<typeof routePackSchema>
export type DeliveredQuantity = z.infer<typeof deliveredQuantitySchema>
export type HaulException = z.infer<typeof haulExceptionSchema>
export type HaulCompletionStatus = z.infer<typeof haulCompletionStatusSchema>
export type TripStatusV2 = z.infer<typeof tripStatusV2Schema>
export type TripEventTypeV2 = z.infer<typeof tripEventTypeV2Schema>
export type LocationVisibility = z.infer<typeof locationVisibilitySchema>
export type TripV2 = z.infer<typeof tripSchemaV2>
export type TripEvent = z.infer<typeof tripEventSchema>
export type TripReview = z.infer<typeof tripReviewSchema>
export type TripDocument = z.infer<typeof tripDocumentSchema>
export type Entitlement = z.infer<typeof entitlementSchema>
export type DirectOffer = z.infer<typeof directOfferSchema>
export type FutureAvailability = z.infer<typeof futureAvailabilitySchema>

const opportunityTransitions: Record<z.infer<typeof loadStatusSchema>, z.infer<typeof loadStatusSchema>[]> = {
  archived: [],
  cancelled: ["archived"],
  completed: ["archived"],
  draft: ["scheduled", "open", "cancelled"],
  filled: ["in_transit", "completed", "cancelled"],
  in_transit: ["completed", "cancelled"],
  open: ["scheduled", "filled", "cancelled"],
  scheduled: ["open", "filled", "cancelled"]
}

const assignmentV2Transitions: Record<z.infer<typeof assignmentStatusSchema>, z.infer<typeof assignmentStatusSchema>[]> = {
  accepted: ["checked_in", "loading", "cancelled"],
  cancelled: [],
  checked_in: ["loading", "cancelled"],
  completed: [],
  declined: [],
  hauled: ["completed", "cancelled"],
  loading: ["hauled", "cancelled"],
  offered: ["accepted", "declined", "cancelled"],
  requested: ["offered", "accepted", "declined", "cancelled"]
}

const tripTransitions: Record<TripStatusV2, TripStatusV2[]> = {
  assigned: ["en_route_to_landing", "cancelled"],
  at_destination: ["unloading", "completed", "cancelled"],
  cancelled: [],
  checked_in: ["loading", "cancelled"],
  completed: [],
  en_route_to_destination: ["at_destination", "cancelled"],
  en_route_to_landing: ["checked_in", "cancelled"],
  loaded: ["en_route_to_destination", "cancelled"],
  loading: ["loaded", "cancelled"],
  unloading: ["completed", "cancelled"]
}

export function canTransitionOpportunityStatus(
  current: z.infer<typeof loadStatusSchema>,
  next: z.infer<typeof loadStatusSchema>
): boolean {
  return opportunityTransitions[current].includes(next)
}

export function canTransitionAssignmentStatusV2(
  current: z.infer<typeof assignmentStatusSchema>,
  next: z.infer<typeof assignmentStatusSchema>
): boolean {
  return assignmentV2Transitions[current].includes(next)
}

export function canTransitionTripStatus(current: TripStatusV2, next: TripStatusV2): boolean {
  return tripTransitions[current].includes(next)
}

export function transitionTripStatus(current: TripStatusV2, next: TripStatusV2): TripStatusV2 {
  if (!canTransitionTripStatus(current, next)) {
    throw new Error(`Invalid trip transition from ${current} to ${next}`)
  }

  return next
}

