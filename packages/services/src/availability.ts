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

export function upsertAvailabilityWindow(
  state: LogLoadsDatabaseState,
  input: unknown
): AvailabilityWindow {
  const parsed = upsertAvailabilityWindowInputSchema.parse(input)
  const existingId = parsed.id ?? createUuid()
  const timestamp = nowIso()

  if (parsed.id && !state.availabilityWindows.some((window) => window.id === parsed.id)) {
    throw new Error(`Availability window ${parsed.id} was not found`)
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
    createdAt: parsed.id
      ? state.availabilityWindows.find((window) => window.id === parsed.id)?.createdAt
      : timestamp,
    id: existingId,
    updatedAt: timestamp
  })

  if (parsed.id) {
    state.availabilityWindows = state.availabilityWindows.map((window) =>
      window.id === parsed.id ? entity : window
    )
  } else {
    state.availabilityWindows.push(entity)
  }

  return entity
}
