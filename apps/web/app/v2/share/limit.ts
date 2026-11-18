import "server-only"

import { cache } from "react"

import { RateLimitError, RateLimitUnavailableError, checkRateLimit, requestClientKey } from "@/lib/rate-limit"

/**
 * The request limit on the share page and its preview card (#404). Both are public and signed-out, and each request
 * costs store reads; the card also renders a PNG. One caller gets 60 of each a minute, in separate windows, through
 * the shared limiter (`lib/rate-limit.ts`): the caller's address is a keyed hash, never the address itself.
 *
 * A caller over the limit, and every caller while the limiter cannot count, gets no read. That is the limiter's own
 * rule everywhere else it is used. Any other failure is not caught here.
 */

const WINDOW_MS = 60_000

export const SHARE_RATE_LIMITS = {
  card: { bucket: "v2-share-card", limit: 60 },
  page: { bucket: "v2-share-page", limit: 60 }
} as const

export type ShareLimit =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number; status: 429 | 503 }

/** Counts this request once. The page and its metadata share the answer. */
export const shareRateLimit = cache(async (surface: keyof typeof SHARE_RATE_LIMITS): Promise<ShareLimit> => {
  const { bucket, limit } = SHARE_RATE_LIMITS[surface]

  try {
    await checkRateLimit(bucket, await requestClientKey(), limit, WINDOW_MS)
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, retryAfterSeconds: error.retryAfterSeconds, status: 429 }
    if (error instanceof RateLimitUnavailableError) return { ok: false, retryAfterSeconds: error.retryAfterSeconds, status: 503 }

    throw error
  }

  return { ok: true }
})
