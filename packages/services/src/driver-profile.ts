import {
  auditEventSchema,
  driverProfileSchema,
  mediaReferenceSchema,
  trailerProfileSchema,
  truckProfileSchema,
  type MediaReference
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

import { assertFound, createUuid, nowIso } from "./utils"

const driverContextSchema = z.object({
  actorUserId: z.string().uuid(),
  driverProfileId: z.string().uuid(),
  organizationId: z.string().uuid()
})

const driverMediaKindSchema = z.enum(["profile", "truck", "trailer"])

const updateDriverEconomicsInputSchema = driverContextSchema.extend({
  fuelEconomyMpg: z.number().min(3).max(15),
  fuelPriceCentsPerGallon: z.number().int().min(100).max(1000)
})

const saveDriverMediaInputSchema = driverContextSchema.extend({
  kind: driverMediaKindSchema,
  photo: mediaReferenceSchema
})

export type DriverMediaKind = z.infer<typeof driverMediaKindSchema>

export interface DriverMediaTarget {
  id: string
  kind: DriverMediaKind
  photo: MediaReference | null
  publicIdPrefix: string
}

function requireOwnedDriver(
  state: LogLoadsDatabaseState,
  context: z.infer<typeof driverContextSchema>
) {
  const membership = state.organizationMemberships.find((candidate) =>
    candidate.organizationId === context.organizationId &&
    candidate.status === "active" &&
    candidate.userId === context.actorUserId
  )

  if (!membership) {
    throw new Error("You are not an active member of this organization")
  }

  const driver = assertFound(
    state.driverProfiles.find((candidate) => candidate.id === context.driverProfileId),
    "Driver profile not found"
  )

  if (driver.userId !== context.actorUserId) {
    throw new Error("You can only update your own driver profile")
  }

  return driver
}

function requireActiveEquipment(
  state: LogLoadsDatabaseState,
  context: z.infer<typeof driverContextSchema>
) {
  return assertFound(
    state.equipmentCombinations.find((candidate) =>
      candidate.assignedDriverProfileId === context.driverProfileId &&
      candidate.organizationId === context.organizationId &&
      candidate.status !== "inactive"
    ),
    "Assign your primary equipment before updating it"
  )
}

export function getDriverMediaTarget(
  state: LogLoadsDatabaseState,
  rawInput: unknown
): DriverMediaTarget {
  const input = driverContextSchema.extend({ kind: driverMediaKindSchema }).parse(rawInput)
  const driver = requireOwnedDriver(state, input)

  if (input.kind === "profile") {
    return {
      id: driver.id,
      kind: input.kind,
      photo: driver.profilePhoto ?? null,
      publicIdPrefix: `logloads/${input.organizationId}/profile/${driver.id}`
    }
  }

  const combination = requireActiveEquipment(state, input)

  if (input.kind === "truck") {
    const truck = assertFound(
      state.truckProfiles.find((candidate) => candidate.id === combination.truckProfileId),
      "The active truck could not be found"
    )

    return {
      id: truck.id,
      kind: input.kind,
      photo: truck.photo ?? null,
      publicIdPrefix: `logloads/${input.organizationId}/truck/${truck.id}`
    }
  }

  if (!combination.trailerProfileId) {
    throw new Error("Add a primary trailer before uploading its photo")
  }

  const trailer = assertFound(
    state.trailerProfiles.find((candidate) => candidate.id === combination.trailerProfileId),
    "The active trailer could not be found"
  )

  return {
    id: trailer.id,
    kind: input.kind,
    photo: trailer.photo ?? null,
    publicIdPrefix: `logloads/${input.organizationId}/trailer/${trailer.id}`
  }
}

export function updateDriverEconomics(state: LogLoadsDatabaseState, rawInput: unknown) {
  const input = updateDriverEconomicsInputSchema.parse(rawInput)
  const driver = requireOwnedDriver(state, input)
  const combination = requireActiveEquipment(state, input)
  const truck = assertFound(
    state.truckProfiles.find((candidate) => candidate.id === combination.truckProfileId),
    "The active truck could not be found"
  )
  const timestamp = nowIso()
  const updatedDriver = driverProfileSchema.parse({
    ...driver,
    preferredFuelPriceCentsPerGallon: input.fuelPriceCentsPerGallon,
    updatedAt: timestamp
  })
  const updatedTruck = truckProfileSchema.parse({
    ...truck,
    fuelEconomyMpg: input.fuelEconomyMpg,
    updatedAt: timestamp
  })

  state.driverProfiles = state.driverProfiles.map((candidate) =>
    candidate.id === updatedDriver.id ? updatedDriver : candidate
  )
  state.truckProfiles = state.truckProfiles.map((candidate) =>
    candidate.id === updatedTruck.id ? updatedTruck : candidate
  )
  state.auditEvents.push(auditEventSchema.parse({
    action: "driver_economics_updated",
    actorUserId: input.actorUserId,
    createdAt: timestamp,
    entityId: driver.id,
    entityType: "driver_profile",
    id: createUuid(),
    metadata: { fuelEconomyMpg: input.fuelEconomyMpg }
  }))

  return { driver: updatedDriver, truck: updatedTruck }
}

export function saveDriverMediaReference(state: LogLoadsDatabaseState, rawInput: unknown): MediaReference {
  const input = saveDriverMediaInputSchema.parse(rawInput)
  const target = getDriverMediaTarget(state, input)
  const expectedPrefix = `${target.publicIdPrefix}/uploads/`

  if (!input.photo.publicId.startsWith(expectedPrefix)) {
    throw new Error("The uploaded photo does not belong to this profile")
  }

  if (input.kind === "profile") {
    const driver = assertFound(
      state.driverProfiles.find((candidate) => candidate.id === target.id),
      "Driver profile not found"
    )
    const updated = driverProfileSchema.parse({ ...driver, profilePhoto: input.photo, updatedAt: input.photo.uploadedAt })
    state.driverProfiles = state.driverProfiles.map((candidate) => candidate.id === updated.id ? updated : candidate)
  } else if (input.kind === "truck") {
    const truck = assertFound(
      state.truckProfiles.find((candidate) => candidate.id === target.id),
      "The active truck could not be found"
    )
    const updated = truckProfileSchema.parse({ ...truck, photo: input.photo, updatedAt: input.photo.uploadedAt })
    state.truckProfiles = state.truckProfiles.map((candidate) => candidate.id === updated.id ? updated : candidate)
  } else {
    const trailer = assertFound(
      state.trailerProfiles.find((candidate) => candidate.id === target.id),
      "The active trailer could not be found"
    )
    const updated = trailerProfileSchema.parse({ ...trailer, photo: input.photo, updatedAt: input.photo.uploadedAt })
    state.trailerProfiles = state.trailerProfiles.map((candidate) => candidate.id === updated.id ? updated : candidate)
  }

  state.auditEvents.push(auditEventSchema.parse({
    action: "driver_media_saved",
    actorUserId: input.actorUserId,
    createdAt: input.photo.uploadedAt,
    entityId: target.id,
    entityType: `${input.kind}_photo`,
    id: createUuid(),
    metadata: { publicId: input.photo.publicId }
  }))

  return input.photo
}
