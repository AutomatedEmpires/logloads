import {
  auditEventSchema,
  driverProfileSchema,
  mediaReferenceSchema,
  organizationRoleCan,
  trailerProfileSchema,
  truckProfileSchema,
  type MediaReference
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

import {
  assertDomainFound,
  assertFound,
  createUuid,
  DomainRefusalError,
  nowIso
} from "./utils"

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
    throw new DomainRefusalError("You are not an active member of this organization")
  }

  const driver = assertFound(
    state.driverProfiles.find((candidate) => candidate.id === context.driverProfileId),
    "Driver profile not found"
  )

  if (driver.userId !== context.actorUserId) {
    throw new DomainRefusalError("You can only update your own driver profile")
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
    throw new DomainRefusalError("Add a primary trailer before uploading its photo")
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

const setFeaturedTruckPhotoInputSchema = driverContextSchema.extend({
  featured: z.boolean()
})

/**
 * The one resolution rule for a driver's featured rig, shared by the write
 * (may they feature?) and the read (what do viewers see?): the active
 * combination in the driver profile's OWN organization. Two rules here would
 * let a dual-outfit driver turn the flag on against one organization's rig
 * while viewers resolve the other's.
 */
function resolveOwnTruckPhoto(
  state: LogLoadsDatabaseState,
  driver: { id: string; companyId?: string | null }
): MediaReference | null {
  const combination = state.equipmentCombinations.find((candidate) =>
    candidate.assignedDriverProfileId === driver.id &&
    candidate.organizationId === driver.companyId &&
    candidate.status !== "inactive"
  )
  const truck = combination
    ? state.truckProfiles.find((candidate) => candidate.id === combination.truckProfileId)
    : undefined

  return truck?.photo ?? null
}

/**
 * The driver's choice to show off their rig. It must never claim a photo that
 * is not there: featuring requires the photo the READ would serve — resolved
 * by the same rule — to actually exist. Un-featuring is always allowed.
 */
export function setFeaturedTruckPhoto(state: LogLoadsDatabaseState, rawInput: unknown) {
  const input = setFeaturedTruckPhotoInputSchema.parse(rawInput)
  const driver = requireOwnedDriver(state, input)

  if (input.featured && !resolveOwnTruckPhoto(state, driver)) {
    throw new DomainRefusalError("Upload a truck photo before featuring it")
  }

  const timestamp = nowIso()
  const updated = driverProfileSchema.parse({ ...driver, featureTruckPhoto: input.featured, updatedAt: timestamp })

  state.driverProfiles = state.driverProfiles.map((candidate) =>
    candidate.id === updated.id ? updated : candidate
  )
  state.auditEvents.push(auditEventSchema.parse({
    action: input.featured ? "truck_photo_featured" : "truck_photo_unfeatured",
    actorUserId: input.actorUserId,
    createdAt: timestamp,
    entityId: driver.id,
    entityType: "driver_profile",
    id: createUuid(),
    metadata: {}
  }))

  return updated
}

const featuredTruckPhotoViewerSchema = z.object({
  driverProfileId: z.string().uuid(),
  viewerOrganizationId: z.string().uuid(),
  viewerUserId: z.string().uuid()
})

function parseFeaturedTruckPhotoViewer(rawInput: unknown): z.infer<typeof featuredTruckPhotoViewerSchema> {
  const parsed = featuredTruckPhotoViewerSchema.safeParse(rawInput)

  if (!parsed.success) {
    throw new DomainRefusalError("The featured truck photo request is invalid")
  }

  return parsed.data
}

/**
 * The one read that shows a driver's rig to someone else. Authorization lives
 * here, not in the route: the viewer holds view_network through an active
 * membership, and the driver is visible to that organization — their own
 * outfit's roster, or an organization whose posted load this driver has an
 * assignment on. Un-featuring turns the tap off at the next request, and the
 * photo is re-resolved through the CURRENT active equipment so a reassigned
 * truck never shows under the wrong driver.
 */
export function getFeaturedTruckPhotoReference(state: LogLoadsDatabaseState, rawInput: unknown): MediaReference {
  const input = parseFeaturedTruckPhotoViewer(rawInput)
  const membership = state.organizationMemberships.find((candidate) =>
    candidate.organizationId === input.viewerOrganizationId &&
    candidate.status === "active" &&
    candidate.userId === input.viewerUserId
  )

  if (!membership || !organizationRoleCan(membership.role, "view_network")) {
    throw new DomainRefusalError("You are not authorized to view this photo")
  }

  const driver = assertDomainFound(
    state.driverProfiles.find((candidate) => candidate.id === input.driverProfileId),
    "Driver profile not found"
  )

  if (!driver.featureTruckPhoto) {
    throw new DomainRefusalError("This driver has not featured a truck photo")
  }

  const sameOrganization = driver.companyId === input.viewerOrganizationId
  const hostOfDriverWork = state.assignments.some((assignment) => {
    if (assignment.driverProfileId !== driver.id) {
      return false
    }

    const load = state.loadPostings.find((candidate) => candidate.id === assignment.loadPostingId)

    return load?.companyId === input.viewerOrganizationId
  })

  if (!sameOrganization && !hostOfDriverWork) {
    throw new DomainRefusalError("This driver is not visible to your organization")
  }

  const photo = resolveOwnTruckPhoto(state, driver)

  if (!photo) {
    throw new DomainRefusalError("This driver has no truck photo to show")
  }

  return photo
}

export function saveDriverMediaReference(state: LogLoadsDatabaseState, rawInput: unknown): MediaReference {
  const input = saveDriverMediaInputSchema.parse(rawInput)
  const target = getDriverMediaTarget(state, input)
  const expectedPrefix = `${target.publicIdPrefix}/uploads/`

  if (!input.photo.publicId.startsWith(expectedPrefix)) {
    throw new DomainRefusalError("The uploaded photo does not belong to this profile")
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
