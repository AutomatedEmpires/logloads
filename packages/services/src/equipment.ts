import { randomUUID } from "node:crypto"

import {
  auditEventSchema,
  equipmentCombinationSchema,
  equipmentCombinationStatusSchema,
  organizationRoleCan,
  trailerProfileSchema,
  trailerTypeSchema,
  truckProfileSchema,
  truckTypeSchema,
  type AssignmentStatus,
  type DriverProfile,
  type EquipmentCombination,
  type OrganizationAction,
  type OrganizationMembership,
  type TripStatusV2
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

const ACTIVE_ASSIGNMENT_STATUSES: ReadonlySet<AssignmentStatus> = new Set([
  "requested",
  "offered",
  "accepted",
  "checked_in",
  "loading",
  "hauled"
])

const ACTIVE_TRIP_STATUSES: ReadonlySet<TripStatusV2> = new Set([
  "assigned",
  "en_route_to_landing",
  "checked_in",
  "loading",
  "loaded",
  "en_route_to_destination",
  "at_destination",
  "unloading"
])

export const addEquipmentInputSchema = z.object({
  actorUserId: z.string().uuid(),
  homeRegion: z.string().min(2),
  label: z.string().min(1).max(60),
  maxPayloadTons: z.number().positive().max(60),
  organizationId: z.string().uuid(),
  assignedDriverProfileId: z.string().uuid().optional().nullable(),
  trailerType: trailerTypeSchema.optional().nullable(),
  truckMake: z.string().min(1).max(40).optional().nullable(),
  truckModel: z.string().min(1).max(40).optional().nullable(),
  truckType: truckTypeSchema,
  unitNumber: z.string().min(1).max(24)
})

export const updateEquipmentStatusInputSchema = z.object({
  actorUserId: z.string().uuid(),
  combinationId: z.string().uuid(),
  organizationId: z.string().uuid(),
  status: equipmentCombinationStatusSchema
})

export const assignDriverToEquipmentInputSchema = z.object({
  actorUserId: z.string().uuid(),
  combinationId: z.string().uuid(),
  driverProfileId: z.string().uuid().nullable(),
  organizationId: z.string().uuid()
})

function requireActiveMembership(
  state: LogLoadsDatabaseState,
  actorUserId: string,
  organizationId: string
): OrganizationMembership {
  const actor = state.profiles.find((candidate) => candidate.id === actorUserId && candidate.isActive)
  const membership = state.organizationMemberships.find((candidate) =>
    candidate.organizationId === organizationId &&
    candidate.status === "active" &&
    candidate.userId === actorUserId
  )

  if (!actor || !membership) {
    throw new Error("You are not an active member of this organization")
  }

  return membership
}

function requireOrganizationAction(
  membership: OrganizationMembership,
  action: OrganizationAction
): void {
  if (!organizationRoleCan(membership.role, action)) {
    throw new Error(`${membership.role} cannot ${action.replaceAll("_", " ")}`)
  }
}

function requireActiveOrganizationDriver(
  state: LogLoadsDatabaseState,
  driverProfileId: string,
  organizationId: string
): DriverProfile {
  const driver = state.driverProfiles.find((candidate) =>
    candidate.id === driverProfileId && candidate.companyId === organizationId
  )
  const user = driver
    ? state.profiles.find((candidate) => candidate.id === driver.userId && candidate.isActive)
    : undefined
  const membership = driver
    ? state.organizationMemberships.find((candidate) =>
      candidate.organizationId === organizationId &&
      candidate.status === "active" &&
      candidate.userId === driver.userId
    )
    : undefined

  if (!driver || !user || !membership || !organizationRoleCan(membership.role, "progress_trip")) {
    throw new Error("Driver profile not found for this organization")
  }

  return driver
}

function requireDriverSelfService(
  driver: DriverProfile | null,
  actorUserId: string,
  message: string
): void {
  if (!driver || driver.userId !== actorUserId) {
    throw new Error(message)
  }
}

function assignmentUsesCombination(
  assignment: LogLoadsDatabaseState["assignments"][number],
  combination: EquipmentCombination
): boolean {
  return assignment.truckProfileId === combination.truckProfileId &&
    (assignment.trailerProfileId ?? null) === (combination.trailerProfileId ?? null)
}

function hasActiveEquipmentUse(
  state: LogLoadsDatabaseState,
  combination: EquipmentCombination
): boolean {
  const activeTrip = state.tripsV2.some((trip) =>
    trip.equipmentCombinationId === combination.id && ACTIVE_TRIP_STATUSES.has(trip.status)
  )

  if (activeTrip) {
    return true
  }

  return state.assignments.some((assignment) =>
    ACTIVE_ASSIGNMENT_STATUSES.has(assignment.status) && assignmentUsesCombination(assignment, combination)
  )
}

export function addEquipmentCombination(state: LogLoadsDatabaseState, rawInput: unknown): EquipmentCombination {
  const input = addEquipmentInputSchema.parse(rawInput)
  const membership = requireActiveMembership(state, input.actorUserId, input.organizationId)
  const assignedDriver = input.assignedDriverProfileId
    ? requireActiveOrganizationDriver(state, input.assignedDriverProfileId, input.organizationId)
    : null

  if (membership.role === "driver") {
    requireDriverSelfService(
      assignedDriver,
      input.actorUserId,
      "Drivers can only add equipment assigned to their own active profile"
    )
  } else {
    requireOrganizationAction(membership, "manage_trucks")
    if (assignedDriver) {
      requireOrganizationAction(membership, "manage_drivers")
    }
  }

  const now = new Date().toISOString()
  const truckId = randomUUID()
  const truck = truckProfileSchema.parse({
    archivedAt: null,
    axleCount: 5,
    companyId: input.organizationId,
    createdAt: now,
    equipmentTags: [],
    id: truckId,
    make: input.truckMake?.trim() || "Unspecified",
    maxPayloadTons: input.maxPayloadTons,
    model: input.truckModel?.trim() || "Unspecified",
    ownerUserId: input.actorUserId,
    plateNumber: "PENDING",
    roadAccessCapabilities: [],
    truckType: input.truckType,
    unitNumber: input.unitNumber,
    updatedAt: now,
    vin: null
  })

  let trailerId: string | null = null
  let trailer: LogLoadsDatabaseState["trailerProfiles"][number] | null = null

  if (input.trailerType) {
    trailerId = randomUUID()
    trailer = trailerProfileSchema.parse({
      capacityTons: input.maxPayloadTons,
      createdAt: now,
      equipmentTags: [],
      id: trailerId,
      ownerUserId: input.actorUserId,
      trailerType: input.trailerType,
      truckId,
      unitNumber: `${input.unitNumber}-T`,
      updatedAt: now
    })
  }

  const combination = equipmentCombinationSchema.parse({
    assignedDriverProfileId: input.assignedDriverProfileId ?? null,
    capabilityTags: [],
    createdAt: now,
    homeRegion: input.homeRegion,
    id: randomUUID(),
    label: input.label,
    lastVerifiedAt: null,
    maxPayloadTons: input.maxPayloadTons,
    organizationId: input.organizationId,
    productLengthMaxFeet: null,
    productLengthMinFeet: null,
    status: "available",
    trailerProfileId: trailerId,
    trailerTypes: input.trailerType ? [input.trailerType] : [],
    truckProfileId: truckId,
    truckTypes: [input.truckType],
    updatedAt: now
  })

  const auditEvent = auditEventSchema.parse({
    action: "equipment_added",
    actorUserId: input.actorUserId,
    createdAt: now,
    entityId: combination.id,
    entityType: "equipment_combination",
    id: randomUUID(),
    metadata: { label: input.label, truckType: input.truckType }
  })

  state.truckProfiles.push(truck)
  if (trailer) {
    state.trailerProfiles.push(trailer)
  }
  state.equipmentCombinations.push(combination)
  state.auditEvents.push(auditEvent)

  return combination
}

function requireOrgCombination(
  state: LogLoadsDatabaseState,
  combinationId: string,
  organizationId: string
): EquipmentCombination {
  const combination = state.equipmentCombinations.find((candidate) => candidate.id === combinationId)

  if (!combination || combination.organizationId !== organizationId) {
    throw new Error("Equipment not found for this organization")
  }

  return combination
}

export function updateEquipmentStatus(state: LogLoadsDatabaseState, rawInput: unknown): EquipmentCombination {
  const input = updateEquipmentStatusInputSchema.parse(rawInput)
  const membership = requireActiveMembership(state, input.actorUserId, input.organizationId)
  const combination = requireOrgCombination(state, input.combinationId, input.organizationId)

  if (membership.role === "driver") {
    const assignedDriver = combination.assignedDriverProfileId
      ? requireActiveOrganizationDriver(state, combination.assignedDriverProfileId, input.organizationId)
      : null
    requireDriverSelfService(
      assignedDriver,
      input.actorUserId,
      "Drivers can only update equipment assigned to their own active profile"
    )
  } else {
    requireOrganizationAction(membership, "manage_trucks")
  }

  if (
    (input.status === "inactive" || input.status === "maintenance") &&
    hasActiveEquipmentUse(state, combination)
  ) {
    throw new Error("Equipment cannot enter maintenance or inactive status while it has an active assignment or trip")
  }

  const now = new Date().toISOString()
  const updated = equipmentCombinationSchema.parse({ ...combination, status: input.status, updatedAt: now })
  const auditEvent = auditEventSchema.parse({
    action: "equipment_status_updated",
    actorUserId: input.actorUserId,
    createdAt: now,
    entityId: combination.id,
    entityType: "equipment_combination",
    id: randomUUID(),
    metadata: { previousStatus: combination.status, status: input.status }
  })

  state.equipmentCombinations = state.equipmentCombinations.map((candidate) =>
    candidate.id === updated.id ? updated : candidate
  )
  state.auditEvents.push(auditEvent)

  return updated
}

export function assignDriverToEquipment(state: LogLoadsDatabaseState, rawInput: unknown): EquipmentCombination {
  const input = assignDriverToEquipmentInputSchema.parse(rawInput)
  const membership = requireActiveMembership(state, input.actorUserId, input.organizationId)
  const combination = requireOrgCombination(state, input.combinationId, input.organizationId)

  requireOrganizationAction(membership, "manage_trucks")
  requireOrganizationAction(membership, "manage_drivers")

  if (input.driverProfileId) {
    requireActiveOrganizationDriver(state, input.driverProfileId, input.organizationId)
  }

  if (
    combination.assignedDriverProfileId !== input.driverProfileId &&
    hasActiveEquipmentUse(state, combination)
  ) {
    throw new Error("Equipment cannot be reassigned or unassigned while it has an active assignment or trip")
  }

  const now = new Date().toISOString()
  const updated = equipmentCombinationSchema.parse({
    ...combination,
    assignedDriverProfileId: input.driverProfileId,
    updatedAt: now
  })
  const auditEvent = auditEventSchema.parse({
    action: input.driverProfileId ? "equipment_driver_assigned" : "equipment_driver_unassigned",
    actorUserId: input.actorUserId,
    createdAt: now,
    entityId: combination.id,
    entityType: "equipment_combination",
    id: randomUUID(),
    metadata: {
      driverProfileId: input.driverProfileId,
      previousDriverProfileId: combination.assignedDriverProfileId ?? null
    }
  })

  state.equipmentCombinations = state.equipmentCombinations.map((candidate) =>
    candidate.id === updated.id ? updated : candidate
  )
  state.auditEvents.push(auditEvent)

  return updated
}
