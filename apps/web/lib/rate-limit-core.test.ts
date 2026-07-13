import { describe, expect, it } from "vitest"

import { RateLimitError, SlidingWindowRateLimiter } from "./rate-limit-core"

describe("SlidingWindowRateLimiter", () => {
  it("allows requests through the configured limit", () => {
    const limiter = new SlidingWindowRateLimiter()

    expect(() => limiter.check("contact", "client", 2, 60_000, 1_000)).not.toThrow()
    expect(() => limiter.check("contact", "client", 2, 60_000, 2_000)).not.toThrow()
  })

  it("rejects excess requests with a Retry-After duration", () => {
    const limiter = new SlidingWindowRateLimiter()

    limiter.check("contact", "client", 1, 60_000, 1_000)

    expect(() => limiter.check("contact", "client", 1, 60_000, 11_001)).toThrow(
      expect.objectContaining<Partial<RateLimitError>>({ retryAfterSeconds: 50 })
    )
  })

  it("resets a bucket when its window expires", () => {
    const limiter = new SlidingWindowRateLimiter()

    limiter.check("contact", "client", 1, 1_000, 1_000)

    expect(() => limiter.check("contact", "client", 1, 1_000, 2_000)).not.toThrow()
  })

  it("isolates buckets and client keys", () => {
    const limiter = new SlidingWindowRateLimiter()

    limiter.check("contact", "client-a", 1, 60_000, 1_000)

    expect(() => limiter.check("contact", "client-b", 1, 60_000, 2_000)).not.toThrow()
    expect(() => limiter.check("sign-in", "client-a", 1, 60_000, 2_000)).not.toThrow()
  })
})
