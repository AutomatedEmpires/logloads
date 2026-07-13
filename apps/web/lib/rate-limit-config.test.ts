import { describe, expect, it, vi } from "vitest"

import { createRateLimiter } from "./rate-limit-config"
import { RateLimitUnavailableError } from "./rate-limit-core"

describe("rate-limit runtime configuration", () => {
  it("uses the memory store during local development", async () => {
    const limiter = createRateLimiter({ NODE_ENV: "development" })

    await expect(limiter.check("contact", "client", 1, 60_000)).resolves.toBeUndefined()
  })

  it("fails closed in production when the shared store is absent", async () => {
    const limiter = createRateLimiter({ NODE_ENV: "production" })

    await expect(limiter.check("contact", "client", 1, 60_000)).rejects.toBeInstanceOf(
      RateLimitUnavailableError
    )
  })

  it("fails closed on partial credentials in every environment", async () => {
    const limiter = createRateLimiter({
      NODE_ENV: "development",
      SUPABASE_URL: "https://project.supabase.co"
    })

    await expect(limiter.check("contact", "client", 1, 60_000)).rejects.toBeInstanceOf(
      RateLimitUnavailableError
    )
  })

  it("permits the production-built local E2E server only when both test flags are set", async () => {
    const limiter = createRateLimiter({
      LOGLOADS_ENABLE_DEV_LOGIN: "true",
      LOGLOADS_RATE_LIMIT_TEST_MODE: "true",
      NODE_ENV: "production"
    })

    await expect(limiter.check("contact", "client", 1, 60_000)).resolves.toBeUndefined()
  })

  it("keeps E2E rate limits process-local while canonical state uses isolated Supabase", async () => {
    const request = vi.fn(async () => {
      throw new Error("the E2E override must not call the shared provider")
    }) as unknown as typeof fetch
    const limiter = createRateLimiter(
      {
        LOGLOADS_ENABLE_DEV_LOGIN: "true",
        LOGLOADS_RATE_LIMIT_TEST_MODE: "true",
        NODE_ENV: "production",
        SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
        SUPABASE_URL: "http://127.0.0.1:54321"
      },
      request
    )

    await expect(limiter.check("contact", "client", 1, 60_000)).resolves.toBeUndefined()
    expect(request).not.toHaveBeenCalled()
  })

  it("uses Supabase whenever both canonical provider credentials are present", async () => {
    const request = vi.fn(async () =>
      Response.json([{ request_count: 1, retry_after_ms: 60_000 }])
    ) as unknown as typeof fetch
    const limiter = createRateLimiter(
      {
        NODE_ENV: "production",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        SUPABASE_URL: "https://project.supabase.co"
      },
      request
    )

    await expect(limiter.check("contact", "client", 1, 60_000)).resolves.toBeUndefined()
    expect(request).toHaveBeenCalledOnce()
  })

  it("prefers the dedicated HMAC secret and safely falls back to the service-role key", async () => {
    const request = vi.fn(async () =>
      Response.json([{ request_count: 1, retry_after_ms: 60_000 }])
    ) as unknown as typeof fetch
    const baseEnvironment = {
      NODE_ENV: "production",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      SUPABASE_URL: "https://project.supabase.co"
    } as const

    await createRateLimiter(baseEnvironment, request).check("contact", "client", 1, 60_000)
    await createRateLimiter(
      { ...baseEnvironment, LOGLOADS_RATE_LIMIT_HMAC_SECRET: "service-role-key" },
      request
    ).check("contact", "client", 1, 60_000)
    await createRateLimiter(
      { ...baseEnvironment, LOGLOADS_RATE_LIMIT_HMAC_SECRET: "dedicated-hmac-secret" },
      request
    ).check("contact", "client", 1, 60_000)

    const storageKeys = vi.mocked(request).mock.calls.map(([, init]) => {
      const body = JSON.parse(String(init?.body)) as { p_key_hash: string }

      return body.p_key_hash
    })

    expect(storageKeys[0]).toBe(storageKeys[1])
    expect(storageKeys[2]).not.toBe(storageKeys[0])
  })
})
