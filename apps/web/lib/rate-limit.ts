import "server-only"

import { headers } from "next/headers"

import { createRateLimiter } from "./rate-limit-config"
import type { RateLimiter } from "./rate-limit-core"

export { RateLimitError, RateLimitUnavailableError } from "./rate-limit-core"

const globalStore = globalThis as typeof globalThis & { __logloadsRateLimiter?: RateLimiter }

function limiter(): RateLimiter {
  return globalStore.__logloadsRateLimiter ?? (globalStore.__logloadsRateLimiter = createRateLimiter(process.env))
}

export async function checkRateLimit(
  bucket: string,
  key: string,
  limit: number,
  windowMs: number
): Promise<void> {
  await limiter().check(bucket, key, limit, windowMs)
}

export async function requestClientKey(): Promise<string> {
  const headerStore = await headers()
  // Vercel overwrites this platform header at the edge. Prefer it so an
  // upstream proxy cannot supply a spoofed first entry in x-forwarded-for.
  const forwarded = headerStore.get("x-vercel-forwarded-for") ?? headerStore.get("x-forwarded-for")

  return forwarded?.split(",")[0]?.trim() || headerStore.get("x-real-ip") || "local"
}
