import { randomUUID } from "node:crypto"

import {
  equipmentCombinationSchema,
  equipmentCombinationStatusSchema,
  trailerProfileSchema,
  trailerTypeSchema,
  truckProfileSchema,
  truckTypeSchema,
  type EquipmentCombination
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

export const addEquipmentInputSchema = z.object({
  homeRegion: z.string().min(2),
  label: z.string().min(1).max(60),
  maxPayloadTons: z.number().positive().max(60),
  organizationId: z.string().uuid(),
  ownerUserId: z.string().uuid(),
  assignedDriverProfileId: z.string().uuid().optional().nullable(),
  trailerType: trailerTypeSchema.optional().nullable(),
  truckMake: z.string().min(1).max(40).optional().nullable(),
  truckModel: z.string().min(1).max(40).optional().nullable(),
  truckType: truckTypeSchema,
  unitNumber: z.string().min(1).max(24)
})

export const updateEquipmentStatusInputSchema = z.object({
  combinationId: z.string().uuid(),
  organizationId: z.string().uuid(),
  status: equipmentCombinationStatusSchema
})

export const assignDriverToEquipmentInputSchema = z.object({
  combinationId: z.string().uuid(),
  driverProfileId: z.string().uuid().nullable(),
  organizationId: z.string().uuid()
})

export function addEquipmentCombination(state: LogLoadsDatabaseState, rawInput: unknown): EquipmentCombination {
  const input = addEquipmentInputSchema.parse(rawInput)
  const now = new Date().toISOString()
  const truckId = randomUUID()

  state.truckProfiles.push(
    truckProfileSchema.parse({
      archivedAt: null,
      axleCount: 5,
      companyId: input.organizationId,
      createdAt: now,
      equipmentTags: [],
      id: truckId,
      make: input.truckMake?.trim() || "Unspecified",
      maxPayloadTons: input.maxPayloadTons,
      model: input.truckModel?.trim() || "Unspecified",
      ownerUserId: input.ownerUserId,
      plateNumber: "PENDING",
      roadAccessCapabilities: [],
      truckType: input.truckType,
      unitNumber: input.unitNumber,
      updatedAt: now,
      vin: null
    })
  )

  let trailerId: string | null = null

  if (input.trailerType) {
    trailerId = randomUUID()
    state.trailerProfiles.push(
      trailerProfileSchema.parse({
        capacityTons: input.maxPayloadTons,
        createdAt: now,
        equipmentTags: [],
        id: trailerId,
        ownerUserId: input.ownerUserId,
        trailerType: input.trailerType,
        truckId,
        unitNumber: `${input.unitNumber}-T`,
        updatedAt: now
      })
    )
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

  state.equipmentCombinations.push(combination)

  state.auditEvents.push({
    action: "equipment_added",
    actorUserId: input.ownerUserId,
    createdAt: now,
    entityId: combination.id,
    entityType: "equipment_combination",
    id: randomUUID(),
    metadata: { label: input.label, truckType: input.truckType }
  })

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
  const combination = requireOrgCombination(state, input.combinationId, input.organizationId)

  combination.status = input.status
  combination.updatedAt = new Date().toISOString()

  return combination
}

export function assignDriverToEquipment(state: LogLoadsDatabaseState, rawInput: unknown): EquipmentCombination {
  const input = assignDriverToEquipmentInputSchema.parse(rawInput)
  const combination = requireOrgCombination(state, input.combinationId, input.organizationId)

  if (input.driverProfileId) {
    const driver = state.driverProfiles.find((candidate) => candidate.id === input.driverProfileId)

    if (!driver) {
      throw new Error("Driver profile not found")
    }
  }

  combination.assignedDriverProfileId = input.driverProfileId
  combination.updatedAt = new Date().toISOString()

  return combination
}
