import { type LogLoadsDatabaseState, createInMemoryDatabase } from "@logloads/db"

let sequence = 6000

export function createServiceState(seed?: LogLoadsDatabaseState): LogLoadsDatabaseState {
  return createInMemoryDatabase(seed)
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function createUuid(): string {
  sequence += 1
  const suffix = sequence.toString(16).padStart(12, "0")
  return `00000000-0000-4000-8000-${suffix}`
}

export function assertFound<T>(value: T | undefined, message: string): T {
  if (!value) {
    throw new Error(message)
  }

  return value
}

export function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}