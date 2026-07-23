import { existsSync, readFileSync } from "node:fs"
import { mkdir, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { seedDatabaseState } from "./seed-data"
import type { LogLoadsDatabaseState } from "./types"

const REQUIRED_TABLES = Object.keys(seedDatabaseState) as Array<keyof LogLoadsDatabaseState>
const SNAPSHOT_ROW_ID = "primary"
const REMOTE_READ_ATTEMPTS = 2

export const OPERATING_STATE_SCHEMA_VERSION = 2

export interface RemoteSnapshotConfig {
  url: string
  key: string
}

export interface RemoteOperatingStateSnapshot {
  schemaVersion: number
  state: LogLoadsDatabaseState
  version: number
}

export interface RemoteMutationResult<T> {
  attempts: number
  snapshot: RemoteOperatingStateSnapshot
  value: T
}

export class OperatingStateUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OperatingStateUnavailableError"
  }
}

export class OperatingStateConflictError extends Error {
  constructor(attempts: number) {
    super(`Operating state changed concurrently after ${attempts} attempts`)
    this.name = "OperatingStateConflictError"
  }
}

/**
 * Upgrade an older snapshot without discarding data. Schema v2 introduced the
 * tripReviews collection; supportRequests and tripInspections arrived later as
 * additive, schema-v2-compatible collections with the same backfill, so old
 * and new deployments can overlap during rollout and rollback. Every other
 * collection remains required so a corrupt or unrelated JSON document can
 * never become runtime state.
 */
export function upgradeStateSnapshot(
  value: Partial<LogLoadsDatabaseState>
): LogLoadsDatabaseState | null {
  const candidate: Partial<LogLoadsDatabaseState> = { ...value }

  // This must happen before REQUIRED_TABLES validation. The SQL migration applies
  // the same additive backfill, while this runtime guard keeps code-first deploys
  // and local snapshots safe without advancing the persisted schema version.
  if (candidate.supportRequests === undefined) {
    candidate.supportRequests = []
  }

  if (candidate.tripReviews === undefined) {
    candidate.tripReviews = []
  }

  if (candidate.tripInspections === undefined) {
    candidate.tripInspections = []
  }

  // Driver profiles predate the featured-rig flag; absent means not featured.
  if (Array.isArray(candidate.driverProfiles)) {
    candidate.driverProfiles = candidate.driverProfiles.map((profile) => ({
      ...profile,
      featureTruckPhoto: profile.featureTruckPhoto ?? false
    }))
  }

  if (Array.isArray(candidate.assignments)) {
    candidate.assignments = candidate.assignments.map((assignment) => ({
      ...assignment,
      termsSnapshot: assignment.termsSnapshot ?? {}
    }))
  }

  // Route packs predate assignment-specific snapshots. A stored pack carries no
  // assignmentId, so it is a load-level source the host maintains — normalize it
  // here rather than leaving undefined fields for every reader to guess at.
  // Defaults come first so a pack that already has these keeps its own values.
  if (Array.isArray(candidate.routePacks)) {
    candidate.routePacks = candidate.routePacks.map((pack) => ({
      ...pack,
      assignmentId: pack.assignmentId ?? null,
      snapshot: pack.snapshot ?? null,
      supersededAt: pack.supersededAt ?? null,
      version: pack.version ?? 1
    }))
  }

  // Trips predate completion tracking. A stored trip has no completionStatus,
  // and "pending" is the honest reading: nobody has said what came off the
  // truck. A trip already marked completed is left pending too — the delivery
  // happened, the accounting of it never did, and inventing agreement here
  // would fabricate a host confirmation that no one gave.
  if (Array.isArray(candidate.tripsV2)) {
    candidate.tripsV2 = candidate.tripsV2.map((trip) => ({
      ...trip,
      completionConfirmedAt: trip.completionConfirmedAt ?? null,
      completionConfirmedByUserId: trip.completionConfirmedByUserId ?? null,
      completionDisputeReason: trip.completionDisputeReason ?? null,
      completionStatus: trip.completionStatus ?? "pending",
      completionSubmittedAt: trip.completionSubmittedAt ?? null,
      completionSubmittedByUserId: trip.completionSubmittedByUserId ?? null,
      deliveredQuantity: trip.deliveredQuantity ?? null,
      haulException: trip.haulException ?? null
    }))
  }

  // Landing safety rules and destination completion evidence are newer than the
  // documents that hold them. The contract types them as arrays, so a stored row
  // without them would hand every reader an undefined the types deny.
  if (Array.isArray(candidate.richLandingDetails)) {
    candidate.richLandingDetails = candidate.richLandingDetails.map((details) => ({
      ...details,
      safetyRequirements: details.safetyRequirements ?? []
    }))
  }

  if (Array.isArray(candidate.destinationFacilities)) {
    candidate.destinationFacilities = candidate.destinationFacilities.map((facility) => ({
      ...facility,
      completionEvidence: facility.completionEvidence ?? []
    }))
  }

  if (!REQUIRED_TABLES.every((table) => Array.isArray(candidate[table]))) {
    return null
  }

  return candidate as LogLoadsDatabaseState
}

export function loadStateSnapshot(filePath: string): LogLoadsDatabaseState | null {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    return upgradeStateSnapshot(
      JSON.parse(readFileSync(filePath, "utf8")) as Partial<LogLoadsDatabaseState>
    )
  } catch {
    return null
  }
}

/** Persist a local-development snapshot atomically. Production uses Supabase. */
export async function persistStateSnapshot(
  filePath: string,
  state: LogLoadsDatabaseState
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const temporaryPath = join(dirname(filePath), `.${process.pid}-${Date.now()}.snapshot.tmp`)

  await writeFile(temporaryPath, JSON.stringify(state), "utf8")
  await rename(temporaryPath, filePath)
}

/** Server-only canonical store config. The service-role key is never exposed. */
export function remoteSnapshotConfig(): RemoteSnapshotConfig | null {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    return null
  }

  return { key, url: url.replace(/\/$/, "") }
}

function requestHeaders(config: RemoteSnapshotConfig): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${config.key}`,
    apikey: config.key
  }
}

async function responseRows(response: Response): Promise<unknown[]> {
  try {
    const value = (await response.json()) as unknown

    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function parseRemoteRow(value: unknown): RemoteOperatingStateSnapshot | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const row = value as {
    schema_version?: unknown
    state?: Partial<LogLoadsDatabaseState>
    version?: unknown
  }
  const state = row.state ? upgradeStateSnapshot(row.state) : null
  const schemaVersion = row.schema_version === undefined ? 1 : Number(row.schema_version)
  const version = row.version === undefined ? 0 : Number(row.version)

  if (
    !state ||
    !Number.isSafeInteger(schemaVersion) ||
    schemaVersion < 1 ||
    schemaVersion > OPERATING_STATE_SCHEMA_VERSION ||
    !Number.isSafeInteger(version) ||
    version < 0
  ) {
    return null
  }

  return { schemaVersion, state, version }
}

export async function loadRemoteOperatingState(
  config: RemoteSnapshotConfig,
  timeoutMs = 8000
): Promise<RemoteOperatingStateSnapshot | null> {
  for (let attempt = 1; attempt <= REMOTE_READ_ATTEMPTS; attempt += 1) {
    let response: Response

    try {
      response = await fetch(
        `${config.url}/rest/v1/operating_state?id=eq.${SNAPSHOT_ROW_ID}&select=state,version,schema_version`,
        {
          headers: requestHeaders(config),
          signal: AbortSignal.timeout(timeoutMs)
        }
      )
    } catch (error) {
      if (attempt < REMOTE_READ_ATTEMPTS) {
        continue
      }

      throw new OperatingStateUnavailableError(
        `Canonical operating state could not be reached: ${error instanceof Error ? error.message : "network error"}`
      )
    }

    if (!response.ok) {
      const transient = response.status === 408 || response.status === 429 || response.status >= 500

      if (transient && attempt < REMOTE_READ_ATTEMPTS) {
        await response.body?.cancel().catch(() => undefined)
        continue
      }

      throw new OperatingStateUnavailableError(
        `Canonical operating state read failed with status ${response.status}`
      )
    }

    const rows = await responseRows(response)

    if (rows.length === 0) {
      return null
    }

    const snapshot = parseRemoteRow(rows[0])

    if (!snapshot) {
      throw new OperatingStateUnavailableError("Canonical operating state is invalid")
    }

    return snapshot
  }

  throw new OperatingStateUnavailableError("Canonical operating state could not be reached")
}

/**
 * Bootstrap an empty canonical table. Conflict-ignore makes concurrent cold
 * starts safe: exactly one insert wins and every caller then loads that row.
 */
export async function initializeRemoteOperatingState(
  config: RemoteSnapshotConfig,
  state: LogLoadsDatabaseState,
  timeoutMs = 8000
): Promise<RemoteOperatingStateSnapshot> {
  const existing = await loadRemoteOperatingState(config, timeoutMs)

  if (existing) {
    return existing
  }

  let response: Response

  try {
    response = await fetch(`${config.url}/rest/v1/operating_state`, {
      body: JSON.stringify({
        id: SNAPSHOT_ROW_ID,
        schema_version: OPERATING_STATE_SCHEMA_VERSION,
        state,
        version: 0
      }),
      headers: {
        ...requestHeaders(config),
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=representation"
      },
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (error) {
    throw new OperatingStateUnavailableError(
      `Canonical operating state bootstrap could not be reached: ${error instanceof Error ? error.message : "network error"}`
    )
  }

  if (!response.ok) {
    throw new OperatingStateUnavailableError(
      `Canonical operating state bootstrap failed with status ${response.status}`
    )
  }

  const inserted = parseRemoteRow((await responseRows(response))[0])

  if (inserted) {
    return inserted
  }

  const raced = await loadRemoteOperatingState(config, timeoutMs)

  if (!raced) {
    throw new OperatingStateUnavailableError("Canonical operating state bootstrap returned no row")
  }

  return raced
}

/**
 * Compare-and-swap a complete state document. A zero-row response is a normal
 * stale-version conflict, never permission to overwrite the newer document.
 */
export async function updateRemoteOperatingState(
  config: RemoteSnapshotConfig,
  state: LogLoadsDatabaseState,
  expectedVersion: number,
  timeoutMs = 8000
): Promise<RemoteOperatingStateSnapshot | null> {
  let response: Response

  try {
    response = await fetch(
      `${config.url}/rest/v1/operating_state?id=eq.${SNAPSHOT_ROW_ID}&version=eq.${expectedVersion}`,
      {
        body: JSON.stringify({
          schema_version: OPERATING_STATE_SCHEMA_VERSION,
          state,
          updated_at: new Date().toISOString(),
          version: expectedVersion + 1
        }),
        headers: {
          ...requestHeaders(config),
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        method: "PATCH",
        signal: AbortSignal.timeout(timeoutMs)
      }
    )
  } catch (error) {
    throw new OperatingStateUnavailableError(
      `Canonical operating state update could not be reached: ${error instanceof Error ? error.message : "network error"}`
    )
  }

  if (!response.ok) {
    throw new OperatingStateUnavailableError(
      `Canonical operating state update failed with status ${response.status}`
    )
  }

  const rows = await responseRows(response)

  if (rows.length === 0) {
    return null
  }

  const snapshot = parseRemoteRow(rows[0])

  if (!snapshot) {
    throw new OperatingStateUnavailableError("Canonical operating state update returned invalid data")
  }

  return snapshot
}

/**
 * Run a deterministic state-only mutation with optimistic retry. The callback
 * can run more than once and therefore must not perform email, analytics, or
 * other external side effects.
 */
export async function mutateRemoteOperatingState<T>(
  config: RemoteSnapshotConfig,
  initialSnapshot: RemoteOperatingStateSnapshot,
  mutate: (state: LogLoadsDatabaseState, attempt: number) => T,
  options: { maxAttempts?: number; timeoutMs?: number } = {}
): Promise<RemoteMutationResult<T>> {
  const maxAttempts = options.maxAttempts ?? 4
  const timeoutMs = options.timeoutMs ?? 8000
  let current = initialSnapshot

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const draft = structuredClone(current.state)
    const value = mutate(draft, attempt)
    const committed = await updateRemoteOperatingState(config, draft, current.version, timeoutMs)

    if (committed) {
      return { attempts: attempt, snapshot: committed, value }
    }

    const latest = await loadRemoteOperatingState(config, timeoutMs)

    if (!latest) {
      throw new OperatingStateUnavailableError("Canonical operating state disappeared during retry")
    }

    current = latest
  }

  throw new OperatingStateConflictError(maxAttempts)
}

/** Backward-compatible state-only read for tooling that does not need metadata. */
export async function loadRemoteSnapshot(
  config: RemoteSnapshotConfig,
  timeoutMs = 8000
): Promise<LogLoadsDatabaseState | null> {
  return (await loadRemoteOperatingState(config, timeoutMs))?.state ?? null
}
