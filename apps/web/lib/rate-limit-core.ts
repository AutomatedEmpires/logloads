export interface RateLimitWindow {
  count: number
  resetAt: number
}

export interface RateLimitRequest {
  bucket: string
  key: string
  windowMs: number
  /**
   * How long a shared store may take to answer before the check fails closed.
   * Omitted, the store's own default applies. Process-local stores answer at
   * once and ignore it.
   */
  timeoutMs?: number
}

export interface RateLimitCheckOptions {
  timeoutMs?: number
}

/** Provider-neutral contract for one atomic fixed-window increment. */
export interface RateLimitStore {
  consume(request: RateLimitRequest): Promise<RateLimitWindow>
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

export class RateLimitUnavailableError extends Error {
  constructor(
    public readonly retryAfterSeconds = 5,
    message = "Request safety checks are temporarily unavailable. Try again shortly."
  ) {
    super(message)
    this.name = "RateLimitUnavailableError"
  }
}

export class RateLimiter {
  constructor(
    private readonly store: RateLimitStore,
    private readonly now = () => Date.now()
  ) {}

  async check(
    bucket: string,
    key: string,
    limit: number,
    windowMs: number,
    { timeoutMs }: RateLimitCheckOptions = {}
  ): Promise<void> {
    if (
      !bucket ||
      !key ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      !Number.isInteger(windowMs) ||
      windowMs < 1 ||
      (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1))
    ) {
      throw new Error("Rate limit configuration is invalid")
    }

    const state = await this.store.consume(
      timeoutMs === undefined ? { bucket, key, windowMs } : { bucket, key, timeoutMs, windowMs }
    )

    if (state.count > limit) {
      throw new RateLimitError(Math.max(1, Math.ceil((state.resetAt - this.now()) / 1_000)))
    }
  }
}

/** Single-runtime fallback for local development and automated tests only. */
export class MemoryRateLimitStore implements RateLimitStore {
  constructor(
    private readonly windows = new Map<string, RateLimitWindow>(),
    private readonly now = () => Date.now()
  ) {}

  async consume({ bucket, key, windowMs }: RateLimitRequest): Promise<RateLimitWindow> {
    const currentTime = this.now()
    const id = `${bucket}:${key}`
    const state = this.windows.get(id)

    if (!state || state.resetAt <= currentTime) {
      const next = { count: 1, resetAt: currentTime + windowMs }

      this.windows.set(id, next)
      this.pruneExpired(currentTime)
      return next
    }

    state.count += 1
    return state
  }

  private pruneExpired(now: number): void {
    if (this.windows.size <= 10_000) return

    for (const [candidate, value] of this.windows) {
      if (value.resetAt <= now) this.windows.delete(candidate)
    }
  }
}

/** Explicit no-op used only by the doubly flagged local Playwright server. */
export class TestRateLimitStore implements RateLimitStore {
  async consume({ windowMs }: RateLimitRequest): Promise<RateLimitWindow> {
    return { count: 1, resetAt: Date.now() + windowMs }
  }
}

/** Fail-closed store used when a production runtime is not safely configured. */
export class UnavailableRateLimitStore implements RateLimitStore {
  async consume(): Promise<never> {
    throw new RateLimitUnavailableError()
  }
}
