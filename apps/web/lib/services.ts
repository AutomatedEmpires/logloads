import { join } from "node:path"

import {
  createInMemoryDatabase,
  loadRemoteSnapshot,
  loadStateSnapshot,
  persistStateSnapshot,
  remoteSnapshotConfig,
  type LogLoadsDatabaseState
} from "@logloads/db"
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

// Pin the services singleton to globalThis so the server-action bundle and the
// page-render bundle share one in-memory operating state. Without this, Next.js
// can instantiate this module twice and a runtime-provisioned account would be
// visible to the action that created it but not to the page that renders next.
type ServicesSingleton = ReturnType<typeof createLogLoadsServices>
const globalStore = globalThis as typeof globalThis & {
  __logloadsServices?: ServicesSingleton
  __logloadsRemoteSync?: boolean
}

const bootDiskState = globalStore.__logloadsServices ? null : loadStateSnapshot(stateFilePath)

export const services: ServicesSingleton =
  globalStore.__logloadsServices ??
  (globalStore.__logloadsServices = createLogLoadsServices(
    bootDiskState ?? shiftSeedDates(createInMemoryDatabase())
  ))

// Remote snapshot mirror: every persistState() writes disk and (when Supabase
// credentials exist) the mirror. On a fresh node with no disk snapshot, restore
// from the mirror once at boot — the local disk remains the primary and is never
// rolled back by the mirror. Single-writer deployment.
const remote = remoteSnapshotConfig()

if (remote && !bootDiskState && !globalStore.__logloadsRemoteSync) {
  globalStore.__logloadsRemoteSync = true

  void loadRemoteSnapshot(remote).then((remoteState) => {
    if (!remoteState) {
      return
    }

    const target = services.state as unknown as Record<string, unknown>

    for (const [table, rows] of Object.entries(remoteState)) {
      if (table in target) {
        target[table] = rows
      }
    }

    console.log("logloads: operating state restored from remote snapshot mirror")
  })
}

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
