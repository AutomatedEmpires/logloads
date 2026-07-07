import { randomUUID } from "node:crypto"

import { type LogLoadsDatabaseState, createInMemoryDatabase } from "@logloads/db"

export function createServiceState(seed?: LogLoadsDatabaseState): LogLoadsDatabaseState {
  return createInMemoryDatabase(seed)
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function createUuid(): string {
  return randomUUID()
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