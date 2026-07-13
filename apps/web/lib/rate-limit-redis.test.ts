import { describe, expect, it, vi } from "vitest"

import { RateLimitError, RateLimiter, RateLimitUnavailableError } from "./rate-limit-core"
import { RedisRestRateLimitStore } from "./rate-limit-redis"

function fetchMock(response: Response): typeof fetch {
  return vi.fn(async () => response) as unknown as typeof fetch
}

describe("RedisRestRateLimitStore", () => {
  it("atomically evaluates a fixed-window command without exposing the client key", async () => {
    const request = fetchMock(Response.json({ result: [1, 60_000] }))
    const store = new RedisRestRateLimitStore({
      endpoint: "https://redis.example.test/",
      fetch: request,
      now: () => 1_000,
      prefix: "test:limits",
      token: "secret-token"
    })

    await expect(
      store.consume({ bucket: "sign-in", key: "192.0.2.10:user@example.com", windowMs: 60_000 })
    ).resolves.toEqual({ count: 1, resetAt: 61_000 })

    expect(request).toHaveBeenCalledOnce()
    const [url, init] = vi.mocked(request).mock.calls[0]!
    const command = JSON.parse(String(init?.body)) as string[]

    expect(url).toBe("https://redis.example.test")
    expect(init?.headers).toEqual({
      Authorization: "Bearer secret-token",
      "Content-Type": "application/json"
    })
    expect(command.slice(0, 3)).toEqual(["EVAL", expect.stringContaining("PEXPIRE"), "1"])
    expect(command[3]).toMatch(/^test:limits:sign-in:[a-f0-9]{64}$/)
    expect(command[3]).not.toContain("user@example.com")
    expect(command[4]).toBe("60000")
  })

  it("turns the shared count and TTL into the standard rate-limit error", async () => {
    const store = new RedisRestRateLimitStore({
      endpoint: "https://redis.example.test",
      fetch: fetchMock(Response.json({ result: [3, 4_500] })),
      now: () => 1_000,
      token: "secret-token"
    })
    const limiter = new RateLimiter(store, () => 1_000)

    await expect(limiter.check("contact", "client", 2, 60_000)).rejects.toEqual(
      expect.objectContaining<Partial<RateLimitError>>({ retryAfterSeconds: 5 })
    )
  })

  it.each([
    new Response(null, { status: 503 }),
    Response.json({ error: "ERR command disabled" }),
    Response.json({ result: ["not-a-count", 60_000] })
  ])("fails closed on an unavailable or invalid shared-store response", async (response) => {
    const store = new RedisRestRateLimitStore({
      endpoint: "https://redis.example.test",
      fetch: fetchMock(response),
      token: "secret-token"
    })

    await expect(store.consume({ bucket: "contact", key: "client", windowMs: 60_000 })).rejects.toBeInstanceOf(
      RateLimitUnavailableError
    )
  })
})
