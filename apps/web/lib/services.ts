import "server-only"

import { join } from "node:path"

import {
  createInMemoryDatabase,
  initializeRemoteOperatingState,
  loadRemoteOperatingState,
  loadStateSnapshot,
  mutateRemoteOperatingState,
  OperatingStateUnavailableError,
  persistStateSnapshot,
  remoteSnapshotConfig,
  type LogLoadsDatabaseState,
  type RemoteOperatingStateSnapshot
} from "@logloads/db"
import { createLogLoadsServices } from "@logloads/services"

const SEED_ANCHOR = Date.UTC(2026, 5, 5)
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

/** Shift committed demo dates only for a fresh local/bootstrap state. */
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
        return new Date(new Date(`${value}T12:00:00.000Z`).getTime() + deltaMs)
          .toISOString()
          .slice(0, 10)
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

const stateFilePath =
  process.env.LOGLOADS_STATE_FILE ?? join(process.cwd(), ".data", "logloads-state.json")

type ServicesSingleton = ReturnType<typeof createLogLoadsServices>
type MutationTail = Promise<void>

const globalStore = globalThis as typeof globalThis & {
  __logloadsMutationTail?: MutationTail
  __logloadsRefresh?: Promise<void>
  __logloadsServices?: ServicesSingleton
  __logloadsStateVersion?: number
}

const localBootState = loadStateSnapshot(stateFilePath)
const initialState = localBootState ?? shiftSeedDates(createInMemoryDatabase())

export const services: ServicesSingleton =
  globalStore.__logloadsServices ??
  (globalStore.__logloadsServices = createLogLoadsServices(initialState))

globalStore.__logloadsStateVersion ??= -1
globalStore.__logloadsMutationTail ??= Promise.resolve()

function replaceStateContents(
  targetState: LogLoadsDatabaseState,
  sourceState: LogLoadsDatabaseState
): void {
  const target = targetState as unknown as Record<string, unknown>

  for (const [table, rows] of Object.entries(sourceState)) {
    target[table] = rows
  }
}

function replaceRuntimeState(state: LogLoadsDatabaseState, version: number): void {
  if (version < (globalStore.__logloadsStateVersion ?? -1)) {
    return
  }

  replaceStateContents(services.state, state)

  globalStore.__logloadsStateVersion = version
}

function localFallbackAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PHASE === "phase-production-build"
  )
}

function bootstrapAllowed(): boolean {
  return localFallbackAllowed() || process.env.LOGLOADS_ALLOW_STATE_BOOTSTRAP === "true"
}

async function canonicalSnapshot(): Promise<RemoteOperatingStateSnapshot | null> {
  const remote = remoteSnapshotConfig()

  if (!remote) {
    if (!localFallbackAllowed()) {
      throw new OperatingStateUnavailableError(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required by the production runtime"
      )
    }

    return null
  }

  const snapshot = await loadRemoteOperatingState(remote)

  if (snapshot) {
    return snapshot
  }

  if (!bootstrapAllowed()) {
    throw new OperatingStateUnavailableError(
      "Canonical operating_state row is missing; set LOGLOADS_ALLOW_STATE_BOOTSTRAP=true for one controlled bootstrap"
    )
  }

  return initializeRemoteOperatingState(remote, structuredClone(services.state))
}

/**
 * Refresh from Supabase before a request reads state. Concurrent cold-start
 * readers share one awaited request; a late stale read cannot replace a newer
 * locally committed version.
 */
export async function refreshState(): Promise<void> {
  if (globalStore.__logloadsRefresh) {
    return globalStore.__logloadsRefresh
  }

  const refresh = (async () => {
    // Next can evaluate server actions and page renders in separate workers.
    // Supabase keeps production workers converged; the provider-free founder
    // demo uses one disposable file instead, so every local read must reload
    // that file rather than trusting a worker's older in-memory singleton.
    if (!remoteSnapshotConfig()) {
      if (!localFallbackAllowed()) {
        throw new OperatingStateUnavailableError(
          "Local operating-state persistence is disabled in production"
        )
      }

      const localSnapshot = loadStateSnapshot(stateFilePath)

      if (localSnapshot) {
        replaceStateContents(services.state, localSnapshot)
      }

      return
    }

    const snapshot = await canonicalSnapshot()

    if (snapshot) {
      replaceRuntimeState(snapshot.state, snapshot.version)
    }
  })()

  globalStore.__logloadsRefresh = refresh

  try {
    await refresh
  } finally {
    if (globalStore.__logloadsRefresh === refresh) {
      globalStore.__logloadsRefresh = undefined
    }
  }
}

/** Read only after the canonical refresh has completed. */
export async function readState<T>(read: (current: ServicesSingleton) => T): Promise<T> {
  await refreshState()

  return read(services)
}

function enqueueMutation<T>(work: () => Promise<T>): Promise<T> {
  const prior = globalStore.__logloadsMutationTail ?? Promise.resolve()
  const result = prior.then(work, work)

  globalStore.__logloadsMutationTail = result.then(
    () => undefined,
    () => undefined
  )

  return result
}

/**
 * Commit a deterministic service-layer mutation. Supabase is loaded first and
 * updated with a version predicate; on conflict the mutation is replayed against
 * the latest document. External side effects belong after this promise resolves.
 */
export function mutateState<T>(mutate: (draft: ServicesSingleton) => T): Promise<T> {
  return enqueueMutation(async () => {
    const remote = remoteSnapshotConfig()

    if (!remote) {
      if (!localFallbackAllowed()) {
        throw new OperatingStateUnavailableError(
          "Local operating-state persistence is disabled in production"
        )
      }

      const draft = createLogLoadsServices(structuredClone(services.state))
      const value = mutate(draft)

      await persistStateSnapshot(stateFilePath, draft.state)
      replaceRuntimeState(draft.state, (globalStore.__logloadsStateVersion ?? -1) + 1)

      return value
    }

    const initial = await canonicalSnapshot()

    if (!initial) {
      throw new OperatingStateUnavailableError("Canonical operating state was not loaded")
    }

    const result = await mutateRemoteOperatingState(remote, initial, (state) => {
      const draft = createLogLoadsServices(state)
      const value = mutate(draft)

      // createLogLoadsServices intentionally clones its seed for isolation. Copy
      // the mutated clone back into the repository-owned CAS document before the
      // conditional PATCH; otherwise the service call succeeds in memory while
      // the pre-mutation state is persisted.
      replaceStateContents(state, draft.state)

      return value
    })

    replaceRuntimeState(result.snapshot.state, result.snapshot.version)

    return result.value
  })
}

export function serializeError(error: unknown): { error: string } {
  if (error instanceof Error) {
    return { error: error.message }
  }

  return { error: "Unknown error" }
}
