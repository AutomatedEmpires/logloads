import { describe, expect, it, vi } from "vitest"

import { RateLimitError, RateLimiter, RateLimitUnavailableError } from "./rate-limit-core"
import { SupabaseRateLimitStore } from "./rate-limit-supabase"

function fetchMock(response: Response): typeof fetch {
  return vi.fn(async () => response) as unknown as typeof fetch
}

function bodyAt(request: typeof fetch, index = 0): Record<string, unknown> {
  const [, init] = vi.mocked(request).mock.calls[index]!

  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

function sharedRpc(now: () => number): typeof fetch {
  const windows = new Map<string, { count: number; resetAt: number }>()

  return vi.fn(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as {
      p_bucket: string
      p_key_hash: string
      p_window_ms: number
    }
    const storageKey = `${body.p_bucket}:${body.p_key_hash}`
    const existing = windows.get(storageKey)
    const state =
      !existing || existing.resetAt <= now()
        ? { count: 1, resetAt: now() + body.p_window_ms }
        : { count: existing.count + 1, resetAt: existing.resetAt }

    windows.set(storageKey, state)

    return Response.json([
      { request_count: state.count, retry_after_ms: Math.max(1, state.resetAt - now()) }
    ])
  }) as unknown as typeof fetch
}

function store(fetchImplementation: typeof fetch, now = () => 1_000): SupabaseRateLimitStore {
  return new SupabaseRateLimitStore({
    endpoint: "https://project.supabase.co/",
    fetch: fetchImplementation,
    keySecret: "dedicated-hmac-secret",
    now,
    prefix: "test:limits",
    serviceRoleKey: "service-role-key"
  })
}

describe("SupabaseRateLimitStore", () => {
  it("shares one fixed window across independent serverless store instances", async () => {
    const now = () => 1_000
    const rpc = sharedRpc(now)
    const firstInstance = new RateLimiter(store(rpc, now), now)
    const secondInstance = new RateLimiter(store(rpc, now), now)

    await expect(firstInstance.check("contact", "client", 1, 60_000)).resolves.toBeUndefined()
    await expect(secondInstance.check("contact", "client", 1, 60_000)).rejects.toEqual(
      expect.objectContaining<Partial<RateLimitError>>({ retryAfterSeconds: 60 })
    )
  })

  it("calls the atomic RPC with a stable HMAC digest and no raw identifier", async () => {
    const request = vi.fn(async () =>
      Response.json([{ request_count: 1, retry_after_ms: 60_000 }])
    ) as unknown as typeof fetch
    const rateLimitStore = store(request)
    const rateLimitRequest = {
      bucket: "sign-in",
      key: "192.0.2.10:user@example.com",
      windowMs: 60_000
    }

    await rateLimitStore.consume(rateLimitRequest)
    await rateLimitStore.consume(rateLimitRequest)

    const [url, init] = vi.mocked(request).mock.calls[0]!
    const firstBody = bodyAt(request)
    const repeatedBody = bodyAt(request, 1)
    const requestBody = String(init?.body)

    expect(url).toBe("https://project.supabase.co/rest/v1/rpc/consume_rate_limit")
    expect(init?.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer service-role-key",
      "Content-Type": "application/json",
      apikey: "service-role-key"
    })
    expect(firstBody).toEqual({
      p_bucket: "test:limits:sign-in",
      p_key_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_window_ms: 60_000
    })
    expect(repeatedBody.p_key_hash).toBe(firstBody.p_key_hash)
    expect(requestBody).not.toContain("192.0.2.10")
    expect(requestBody).not.toContain("user@example.com")
    expect(requestBody).not.toContain("dedicated-hmac-secret")
    expect(requestBody).not.toContain("service-role-key")
  })

  it("turns the database TTL into the standard Retry-After duration", async () => {
    const rateLimitStore = store(
      fetchMock(Response.json([{ request_count: 3, retry_after_ms: 4_500 }])),
      () => 1_000
    )
    const limiter = new RateLimiter(rateLimitStore, () => 1_000)

    await expect(limiter.check("contact", "client", 2, 60_000)).rejects.toEqual(
      expect.objectContaining<Partial<RateLimitError>>({ retryAfterSeconds: 5 })
    )
  })

  it.each([
    new Response(null, { status: 503 }),
    Response.json({ message: "permission denied" }, { status: 401 }),
    Response.json([{ request_count: "not-a-count", retry_after_ms: 60_000 }]),
    Response.json([])
  ])("fails closed on an unavailable or invalid Supabase response", async (response) => {
    const rateLimitStore = store(fetchMock(response))

    await expect(
      rateLimitStore.consume({ bucket: "contact", key: "client", windowMs: 60_000 })
    ).rejects.toBeInstanceOf(RateLimitUnavailableError)
  })
})
