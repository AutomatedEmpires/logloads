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

/**
 * A caller-visible domain precondition failed.
 *
 * The detailed message is for server logs and in-process product surfaces. HTTP
 * routes identify this type and return one constant sanitized 4xx body, so an
 * external caller cannot use record-specific wording as an existence oracle.
 */
export class DomainRefusalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DomainRefusalError"
  }
}

export function assertFound<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message)
  }

  return value
}

export function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

/**
 * Use only for an expected request-policy conflict. Internal invariants must use
 * the ordinary assertion helpers above so HTTP boundaries retain 500/error-level
 * signaling for corrupted state and programming faults.
 */
export function assertDomainFound<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new DomainRefusalError(message)
  }

  return value
}

export function assertDomainCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new DomainRefusalError(message)
  }
}
