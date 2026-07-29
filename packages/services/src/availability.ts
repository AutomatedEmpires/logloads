import {
  rangesOverlap,
  upsertAvailabilityWindowInputSchema,
  availabilityWindowSchema,
  type AvailabilityWindow
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { createUuid, nowIso } from "./utils"

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
    throw new Error(`Availability window ${parsed.id} was not found`)
  }

  if (existing && existing.driverProfileId !== parsed.driverProfileId) {
    throw new Error("You cannot replace another driver's availability window")
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
    throw new Error(`Availability window overlaps existing window ${overlapping.id}`)
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
