/**
 * One shared result for a short window, per server instance.
 *
 * For unauthenticated reads that would otherwise download the whole
 * operating_state document on every request (HF-09, #187): however many
 * anonymous callers arrive, the provider sees at most one load per window per
 * instance, and callers that arrive while a load is running share it. A failed
 * load is not kept, so the next caller retries.
 */
export interface ShortLivedCache<T> {
  get(): Promise<T>
  clear(): void
}

export function shortLivedCache<T>(
  ttlMs: number,
  load: () => Promise<T>,
  now: () => number = () => Date.now()
): ShortLivedCache<T> {
  let entry: { expiresAt: number; value: T } | null = null
  let inFlight: Promise<T> | null = null

  return {
    clear() {
      entry = null
      inFlight = null
    },
    get() {
      if (entry && now() < entry.expiresAt) {
        return Promise.resolve(entry.value)
      }

      if (inFlight) {
        return inFlight
      }

      const pending: Promise<T> = load().then(
        (value) => {
          if (inFlight === pending) {
            entry = { expiresAt: now() + ttlMs, value }
            inFlight = null
          }

          return value
        },
        (error: unknown) => {
          if (inFlight === pending) {
            inFlight = null
          }

          throw error
        }
      )

      inFlight = pending

      return pending
    }
  }
}

/**
 * How stale the anonymous health probe and public board may be. Short enough
 * that a deploy or a new posting shows within one probe interval.
 */
export const PUBLIC_READ_TTL_MS = 10_000
