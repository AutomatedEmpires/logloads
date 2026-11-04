import { describe, expect, it } from "vitest"

import {
  MemoryRateLimitStore,
  RateLimitError,
  RateLimiter,
  type RateLimitRequest,
  type RateLimitStore
} from "./rate-limit-core"

describe("RateLimiter with a memory store", () => {
  it("allows requests through the configured limit", async () => {
    const limiter = new RateLimiter(new MemoryRateLimitStore())

    await expect(limiter.check("contact", "client", 2, 60_000)).resolves.toBeUndefined()
    await expect(limiter.check("contact", "client", 2, 60_000)).resolves.toBeUndefined()
  })

  it("rejects excess requests with a Retry-After duration", async () => {
    const store: RateLimitStore = {
      consume: async () => ({ count: 2, resetAt: 51_000 })
    }
    const limiter = new RateLimiter(store, () => 1_000)

    await expect(limiter.check("contact", "client", 1, 60_000)).rejects.toEqual(
      expect.objectContaining<Partial<RateLimitError>>({ retryAfterSeconds: 50 })
    )
  })

  it("resets a bucket when its window expires", async () => {
    let now = 1_000
    const limiter = new RateLimiter(new MemoryRateLimitStore(new Map(), () => now), () => now)

    await limiter.check("contact", "client", 1, 1_000)
    now = 2_000

    await expect(limiter.check("contact", "client", 1, 1_000)).resolves.toBeUndefined()
  })

  it("isolates buckets and client keys", async () => {
    const limiter = new RateLimiter(new MemoryRateLimitStore())

    await limiter.check("contact", "client-a", 1, 60_000)

    await expect(limiter.check("contact", "client-b", 1, 60_000)).resolves.toBeUndefined()
    await expect(limiter.check("sign-in", "client-a", 1, 60_000)).resolves.toBeUndefined()
  })

  it("rejects invalid application configuration before touching the store", async () => {
    const store: RateLimitStore = { consume: async () => ({ count: 1, resetAt: 2_000 }) }
    const limiter = new RateLimiter(store)

    await expect(limiter.check("contact", "client", 0, 60_000)).rejects.toThrow(
      "Rate limit configuration is invalid"
    )
    await expect(limiter.check("contact", "client", 1, 60_000, { timeoutMs: 0 })).rejects.toThrow(
      "Rate limit configuration is invalid"
    )
  })

  it("hands the store a check's own time budget, and none when the check sets none", async () => {
    const requests: RateLimitRequest[] = []
    const limiter = new RateLimiter({
      consume: async (request) => {
        requests.push(request)

        return { count: 1, resetAt: 2_000 }
      }
    })

    await limiter.check("contact", "client", 1, 60_000)
    await limiter.check("trip-event-create", "user", 30, 60_000, { timeoutMs: 8_000 })

    expect(requests).toEqual([
      { bucket: "contact", key: "client", windowMs: 60_000 },
      { bucket: "trip-event-create", key: "user", timeoutMs: 8_000, windowMs: 60_000 }
    ])
  })
})
