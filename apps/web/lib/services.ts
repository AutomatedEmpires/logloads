import { join } from "node:path"

import { createInMemoryDatabase, loadStateSnapshot, persistStateSnapshot, type LogLoadsDatabaseState } from "@logloads/db"
import { createLogLoadsServices } from "@logloads/services"

const SEED_ANCHOR = Date.UTC(2026, 5, 5)
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

/**
 * The committed seed is anchored to 2026-06-05. Fresh local states shift every
 * seed date forward so schedules, notices, and trips read as current operations.
 * Restored snapshots are real user state and are never shifted.
 */
function shiftSeedDates(state: LogLoadsDatabaseState): LogLoadsDatabaseState {
  const deltaDays = Math.floor((Date.now() - SEED_ANCHOR) / (24 * 60 * 60 * 1000))

  if (deltaDays <= 0) {
    return state
  }

  const deltaMs = deltaDays * 24 * 60 * 60 * 1000
  const shift = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (TIMESTAMP.test(value)) {
        return new Date(new Date(value).getTime() + deltaMs).toISOString()
      }

      if (DATE_ONLY.test(value)) {
        return new Date(new Date(`${value}T12:00:00.000Z`).getTime() + deltaMs).toISOString().slice(0, 10)
      }

      return value
    }

    if (Array.isArray(value)) {
      return value.map(shift)
    }

    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, shift(entry)]))
    }

    return value
  }

  return shift(state) as LogLoadsDatabaseState
}

const stateFilePath = process.env.LOGLOADS_STATE_FILE ?? join(process.cwd(), ".data", "logloads-state.json")
const initialState = loadStateSnapshot(stateFilePath) ?? shiftSeedDates(createInMemoryDatabase())

export const services = createLogLoadsServices(initialState)

/**
 * Durable single-node persistence: every successful mutation schedules a debounced
 * snapshot of the operating state so restarts do not lose provisioned accounts,
 * assignments, trips, or messages.
 */
export function persistState(): void {
  persistStateSnapshot(stateFilePath, services.state)
}

export function serializeError(error: unknown): { error: string } {
  if (error instanceof Error) {
    return { error: error.message }
  }

  return { error: "Unknown error" }
}
