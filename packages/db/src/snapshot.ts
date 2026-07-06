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
  }, debounceMs)

  persistTimer.unref?.()
}
