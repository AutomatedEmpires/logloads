import { describe, expect, it, vi } from "vitest"

import { RateLimitError, RateLimiter, RateLimitUnavailableError } from "./rate-limit-core"
import { RedisRestRateLimitStore } from "./rate-limit-redis"

function fetchMock(response: Response): typeof fetch {
  return vi.fn(async () => response) as unknown as typeof fetch
}

function commandAt(request: typeof fetch, index = 0): string[] {
  const [, init] = vi.mocked(request).mock.calls[index]!

  return JSON.parse(String(init?.body)) as string[]
}

describe("RedisRestRateLimitStore", () => {
  it("atomically evaluates a fixed-window command with a stable, non-leaking HMAC key", async () => {
    const request = vi.fn(async () => Response.json({ result: [1, 60_000] })) as unknown as typeof fetch
    const store = new RedisRestRateLimitStore({
      endpoint: "https://redis.example.test/",
      fetch: request,
      keySecret: "dedicated-hmac-secret",
      now: () => 1_000,
      prefix: "test:limits",
      token: "secret-token"
    })

    const rateLimitRequest = {
      bucket: "sign-in",
      key: "192.0.2.10:user@example.com",
      windowMs: 60_000
    }

    await expect(store.consume(rateLimitRequest)).resolves.toEqual({ count: 1, resetAt: 61_000 })
    await expect(store.consume(rateLimitRequest)).resolves.toEqual({ count: 1, resetAt: 61_000 })

    expect(request).toHaveBeenCalledTimes(2)
    const [url, init] = vi.mocked(request).mock.calls[0]!
    const command = commandAt(request)
    const repeatedCommand = commandAt(request, 1)
    const commandBody = String(init?.body)

    expect(url).toBe("https://redis.example.test")
    expect(init?.headers).toEqual({
      Authorization: "Bearer secret-token",
      "Content-Type": "application/json"
    })
    expect(command.slice(0, 3)).toEqual(["EVAL", expect.stringContaining("PEXPIRE"), "1"])
    expect(command[3]).toMatch(/^test:limits:sign-in:[a-f0-9]{64}$/)
    expect(repeatedCommand[3]).toBe(command[3])
    expect(commandBody).not.toContain("192.0.2.10")
    expect(commandBody).not.toContain("user@example.com")
    expect(commandBody).not.toContain("dedicated-hmac-secret")
    expect(commandBody).not.toContain("secret-token")
    expect(command[4]).toBe("60000")
  })

  it("separates the same identifier when the HMAC secret changes", async () => {
    const firstRequest = fetchMock(Response.json({ result: [1, 60_000] }))
    const secondRequest = fetchMock(Response.json({ result: [1, 60_000] }))
    const options = {
      endpoint: "https://redis.example.test",
      token: "secret-token"
    }

    await new RedisRestRateLimitStore({
      ...options,
      fetch: firstRequest,
      keySecret: "hmac-secret-a"
    }).consume({ bucket: "contact", key: "192.0.2.10", windowMs: 60_000 })
    await new RedisRestRateLimitStore({
      ...options,
      fetch: secondRequest,
      keySecret: "hmac-secret-b"
    }).consume({ bucket: "contact", key: "192.0.2.10", windowMs: 60_000 })

    expect(commandAt(firstRequest)[3]).not.toBe(commandAt(secondRequest)[3])
  })

  it("turns the shared count and TTL into the standard rate-limit error", async () => {
    const store = new RedisRestRateLimitStore({
      endpoint: "https://redis.example.test",
      fetch: fetchMock(Response.json({ result: [3, 4_500] })),
      keySecret: "dedicated-hmac-secret",
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
      keySecret: "dedicated-hmac-secret",
      token: "secret-token"
    })

    await expect(store.consume({ bucket: "contact", key: "client", windowMs: 60_000 })).rejects.toBeInstanceOf(
      RateLimitUnavailableError
    )
  })
})
