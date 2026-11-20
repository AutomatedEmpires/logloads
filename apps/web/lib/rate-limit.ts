import "server-only"

import { headers } from "next/headers"

import { clientKeyFromHeaders } from "./rate-limit-client-key"
import { createRateLimiter } from "./rate-limit-config"
import type { RateLimitCheckOptions, RateLimiter } from "./rate-limit-core"
import type { WriteLimit } from "./write-limits"

export { RateLimitError, RateLimitUnavailableError } from "./rate-limit-core"

const globalStore = globalThis as typeof globalThis & { __logloadsRateLimiter?: RateLimiter }

function limiter(): RateLimiter {
  return globalStore.__logloadsRateLimiter ?? (globalStore.__logloadsRateLimiter = createRateLimiter(process.env))
}

export async function checkRateLimit(
  bucket: string,
  key: string,
  limit: number,
  windowMs: number,
  options?: RateLimitCheckOptions
): Promise<void> {
  await limiter().check(bucket, key, limit, windowMs, options)
}

/** Spend one of `userId`'s per-user write limits, with the write's own time budget. */
export async function checkWriteLimit(writeLimit: WriteLimit, userId: string): Promise<void> {
  await checkRateLimit(writeLimit.bucket, userId, writeLimit.limit, writeLimit.windowMs, {
    timeoutMs: writeLimit.timeoutMs
  })
}

export async function requestClientKey(): Promise<string> {
  return clientKeyFromHeaders(await headers(), {
    LOGLOADS_RATE_LIMIT_HMAC_SECRET: process.env.LOGLOADS_RATE_LIMIT_HMAC_SECRET,
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV
  })
}
