import { join } from "node:path"

import { createInMemoryDatabase, loadStateSnapshot, persistStateSnapshot } from "@logloads/db"
import { createLogLoadsServices } from "@logloads/services"

const stateFilePath = process.env.LOGLOADS_STATE_FILE ?? join(process.cwd(), ".data", "logloads-state.json")
const initialState = loadStateSnapshot(stateFilePath) ?? createInMemoryDatabase()

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
