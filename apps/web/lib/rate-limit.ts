import "server-only"

import { headers } from "next/headers"

import { SlidingWindowRateLimiter } from "./rate-limit-core"

export { RateLimitError } from "./rate-limit-core"

/**
 * Best-effort, per-runtime sliding-window rate limiter. It protects one Node
 * process but is not a distributed production abuse-control boundary; public
 * multi-instance traffic also needs provider-edge or shared-store limits.
 */
const globalStore = globalThis as typeof globalThis & { __logloadsRateLimiter?: SlidingWindowRateLimiter }
const limiter = globalStore.__logloadsRateLimiter ?? (globalStore.__logloadsRateLimiter = new SlidingWindowRateLimiter())

export function checkRateLimit(bucket: string, key: string, limit: number, windowMs: number): void {
  limiter.check(bucket, key, limit, windowMs)
}

export async function requestClientKey(): Promise<string> {
  const headerStore = await headers()
  // Vercel overwrites this platform header at the edge. Prefer it so an
  // upstream proxy cannot supply a spoofed first entry in x-forwarded-for.
  const forwarded = headerStore.get("x-vercel-forwarded-for") ?? headerStore.get("x-forwarded-for")

  return forwarded?.split(",")[0]?.trim() || headerStore.get("x-real-ip") || "local"
}
