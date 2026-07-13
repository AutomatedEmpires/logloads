export interface WindowState {
  count: number
  resetAt: number
}

export class RateLimitError extends Error {
  constructor(
    public readonly retryAfterSeconds: number,
    message = "Too many attempts. Wait a moment and try again."
  ) {
    super(message)
    this.name = "RateLimitError"
  }
}

export class SlidingWindowRateLimiter {
  constructor(private readonly buckets = new Map<string, WindowState>()) {}

  check(bucket: string, key: string, limit: number, windowMs: number, now = Date.now()): void {
    const id = `${bucket}:${key}`
    const state = this.buckets.get(id)

    if (!state || state.resetAt <= now) {
      this.buckets.set(id, { count: 1, resetAt: now + windowMs })
      this.pruneExpired(now)
      return
    }

    state.count += 1

    if (state.count > limit) {
      throw new RateLimitError(Math.max(1, Math.ceil((state.resetAt - now) / 1_000)))
    }
  }

  private pruneExpired(now: number): void {
    if (this.buckets.size <= 10_000) return

    for (const [candidate, value] of this.buckets) {
      if (value.resetAt <= now) this.buckets.delete(candidate)
    }
  }
}
