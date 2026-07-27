import "server-only"

import { headers } from "next/headers"

import { clientKeyFromHeaders } from "./rate-limit-client-key"
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
  return clientKeyFromHeaders(await headers(), {
    LOGLOADS_RATE_LIMIT_HMAC_SECRET: process.env.LOGLOADS_RATE_LIMIT_HMAC_SECRET,
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV
  })
}
