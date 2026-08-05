import {
  availabilityWindowSchema,
  driverProfileSchema,
  rangesOverlap,
  upsertAvailabilityWindowInputSchema,
  type AvailabilityWindow,
  type DriverProfile
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

import { activeDriverProfileForOrganization } from "./driver-access"
import { createUuid, DomainRefusalError, nowIso } from "./utils"

const setDriverAvailabilityInputSchema = upsertAvailabilityWindowInputSchema.extend({
  actorUserId: z.string().uuid(),
  organizationId: z.string().uuid()
})

export type SetDriverAvailabilityInput = z.input<typeof setDriverAvailabilityInputSchema>

export interface SetDriverAvailabilityResult {
  driverProfile: DriverProfile
  window: AvailabilityWindow
}

export function listDriverAvailability(
  state: LogLoadsDatabaseState,
  driverProfileId?: string
): AvailabilityWindow[] {
  return driverProfileId
    ? state.availabilityWindows.filter((window) => window.driverProfileId === driverProfileId)
    : state.availabilityWindows
}

/**
 * An id names a row; it does not prove the caller owns it. Availability is what
 * makes a driver eligible for a haul, so replacing a window that belongs to
 * someone else takes a rival driver off the work they had posted for. The write
 * therefore has to agree with the driver the caller is acting as, which every
 * caller derives from the session rather than from the request body.
 */
export function upsertAvailabilityWindow(
  state: LogLoadsDatabaseState,
  input: unknown
): AvailabilityWindow {
  const parsed = upsertAvailabilityWindowInputSchema.parse(input)
  const existingId = parsed.id ?? createUuid()
  const timestamp = nowIso()
  const existing = parsed.id
    ? state.availabilityWindows.find((window) => window.id === parsed.id)
    : undefined

  if (parsed.id && !existing) {
    throw new DomainRefusalError(`Availability window ${parsed.id} was not found`)
  }

  if (existing && existing.driverProfileId !== parsed.driverProfileId) {
    throw new DomainRefusalError("You cannot replace another driver's availability window")
  }

  const overlapping = state.availabilityWindows.find((window) => {
    if (window.driverProfileId !== parsed.driverProfileId) {
      return false
    }

    if (window.id === parsed.id) {
      return false
    }

    return rangesOverlap(window, parsed)
  })

  if (overlapping) {
    throw new DomainRefusalError(`Availability window overlaps existing window ${overlapping.id}`)
  }

  const entity = availabilityWindowSchema.parse({
    ...parsed,
    createdAt: existing?.createdAt ?? timestamp,
    id: existingId,
    updatedAt: timestamp
  })

  if (existing) {
    state.availabilityWindows = state.availabilityWindows.map((window) =>
      window.id === existing.id ? entity : window
    )
  } else {
    state.availabilityWindows.push(entity)
  }

  return entity
}

/**
 * Deliberately publishes one driver's readiness from their authenticated,
 * organization-bound identity. Invitation and reactivation keep a driver
 * unavailable; only this explicit transition may reopen their eligibility.
 *
 * Generic window upserts remain profile-neutral because automated offer flows
 * use them. Letting those writes reactivate a driver would bypass the person's
 * deliberate readiness choice.
 */
export function setDriverAvailability(
  state: LogLoadsDatabaseState,
  rawInput: SetDriverAvailabilityInput
): SetDriverAvailabilityResult {
  const input = setDriverAvailabilityInputSchema.parse(rawInput)
  const draft = structuredClone(state)
  const activeDriver = activeDriverProfileForOrganization(
    draft,
    input.actorUserId,
    input.organizationId
  )

  if (activeDriver?.id !== input.driverProfileId) {
    throw new DomainRefusalError(
      "You can only set readiness for your active driver profile in this organization"
    )
  }

  const window = upsertAvailabilityWindow(draft, {
    driverProfileId: input.driverProfileId,
    endAt: input.endAt,
    id: input.id,
    notes: input.notes,
    preferredRouteIds: input.preferredRouteIds,
    recurringSchedule: input.recurringSchedule,
    startAt: input.startAt,
    status: input.status,
    truckProfileId: input.truckProfileId
  })
  const driverProfile = driverProfileSchema.parse({
    ...activeDriver,
    availabilityStatus: input.status,
    updatedAt: window.updatedAt
  })

  draft.driverProfiles = draft.driverProfiles.map((candidate) =>
    candidate.id === driverProfile.id ? driverProfile : candidate
  )
  Object.assign(state, draft)

  return { driverProfile, window }
}
