import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { seedDatabaseState } from "./seed-data"
import type { LogLoadsDatabaseState } from "./types"

const REQUIRED_TABLES = Object.keys(seedDatabaseState) as Array<keyof LogLoadsDatabaseState>

export function loadStateSnapshot(filePath: string): LogLoadsDatabaseState | null {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<LogLoadsDatabaseState>
    const complete = REQUIRED_TABLES.every((table) => Array.isArray(parsed[table]))

    if (!complete) {
      return null
    }

    return parsed as LogLoadsDatabaseState
  } catch {
    return null
  }
}

export interface RemoteSnapshotConfig {
  url: string
  key: string
}

/**
 * Reads the remote snapshot mirror config from the environment. The mirror is a
 * server-only durability sink and REQUIRES the service-role key: the
 * operating_state table denies anon/authenticated at the database (RLS enabled,
 * no policy), so the anon key cannot and must not be used here. Without the
 * service-role key the mirror is disabled and the local disk snapshot remains
 * the primary durability mechanism.
 */
export function remoteSnapshotConfig(): RemoteSnapshotConfig | null {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    return null
  }

  return { key, url }
}

const SNAPSHOT_ROW_ID = "primary"

export async function loadRemoteSnapshot(config: RemoteSnapshotConfig, timeoutMs = 2500): Promise<LogLoadsDatabaseState | null> {
  try {
    const response = await fetch(
      `${config.url}/rest/v1/operating_state?id=eq.${SNAPSHOT_ROW_ID}&select=state`,
      {
        headers: { Accept: "application/json", apikey: config.key, Authorization: `Bearer ${config.key}` },
        signal: AbortSignal.timeout(timeoutMs)
      }
    )

    if (!response.ok) {
      return null
    }

    const rows = (await response.json()) as Array<{ state?: Partial<LogLoadsDatabaseState> }>
    const state = rows[0]?.state

    if (!state || !REQUIRED_TABLES.every((table) => Array.isArray(state[table]))) {
      return null
    }

    return state as LogLoadsDatabaseState
  } catch {
    return null
  }
}

async function persistRemoteSnapshot(config: RemoteSnapshotConfig, state: LogLoadsDatabaseState): Promise<void> {
  try {
    const response = await fetch(`${config.url}/rest/v1/operating_state`, {
      body: JSON.stringify({ id: SNAPSHOT_ROW_ID, state, updated_at: new Date().toISOString() }),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
        apikey: config.key
      },
      method: "POST",
      signal: AbortSignal.timeout(8000)
    })

    if (!response.ok) {
      console.error(`logloads: remote snapshot mirror rejected write (${response.status})`)
    }
  } catch (error) {
    console.error("logloads: remote snapshot mirror unreachable", error)
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

export function persistStateSnapshot(filePath: string, state: LogLoadsDatabaseState, options: { debounceMs?: number } = {}): void {
  const debounceMs = options.debounceMs ?? 400

  if (persistTimer) {
    clearTimeout(persistTimer)
  }

  persistTimer = setTimeout(() => {
    persistTimer = null

    try {
      mkdirSync(dirname(filePath), { recursive: true })
      const temporaryPath = join(dirname(filePath), `.${Date.now()}.snapshot.tmp`)

      writeFileSync(temporaryPath, JSON.stringify(state), "utf8")
      renameSync(temporaryPath, filePath)
    } catch (error) {
      console.error("logloads: failed to persist state snapshot", error)
    }

    const remote = remoteSnapshotConfig()

    if (remote) {
      void persistRemoteSnapshot(remote, state)
    }
  }, debounceMs)

  persistTimer.unref?.()
}
