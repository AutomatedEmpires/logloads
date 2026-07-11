import "server-only"

import { headers } from "next/headers"

/**
 * Best-effort, per-runtime sliding-window rate limiter. It protects one Node
 * process but is not a distributed production abuse-control boundary; public
 * multi-instance traffic also needs provider-edge or shared-store limits.
 */
interface WindowState {
  count: number
  resetAt: number
}

const globalStore = globalThis as typeof globalThis & { __logloadsRateLimits?: Map<string, WindowState> }
const buckets = globalStore.__logloadsRateLimits ?? (globalStore.__logloadsRateLimits = new Map())

export class RateLimitError extends Error {
  constructor(message = "Too many attempts. Wait a moment and try again.") {
    super(message)
    this.name = "RateLimitError"
  }
}

export function checkRateLimit(bucket: string, key: string, limit: number, windowMs: number): void {
  const now = Date.now()
  const id = `${bucket}:${key}`
  const state = buckets.get(id)

  if (!state || state.resetAt <= now) {
    buckets.set(id, { count: 1, resetAt: now + windowMs })

    if (buckets.size > 10_000) {
      for (const [candidate, value] of buckets) {
        if (value.resetAt <= now) {
          buckets.delete(candidate)
        }
      }
    }

    return
  }

  state.count += 1

  if (state.count > limit) {
    throw new RateLimitError()
  }
}

export async function requestClientKey(): Promise<string> {
  const headerStore = await headers()
  const forwarded = headerStore.get("x-forwarded-for")

  return forwarded?.split(",")[0]?.trim() || headerStore.get("x-real-ip") || "local"
}
