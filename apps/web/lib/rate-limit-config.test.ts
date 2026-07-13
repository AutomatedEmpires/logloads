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
      LOGLOADS_RATE_LIMIT_REST_URL: "https://redis.example.test",
      NODE_ENV: "development"
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

  it("uses the external store whenever both generic REST credentials are present", async () => {
    const request = vi.fn(async () => Response.json({ result: [1, 60_000] })) as unknown as typeof fetch
    const limiter = createRateLimiter(
      {
        LOGLOADS_RATE_LIMIT_REST_TOKEN: "secret-token",
        LOGLOADS_RATE_LIMIT_REST_URL: "https://redis.example.test",
        NODE_ENV: "production"
      },
      request
    )

    await expect(limiter.check("contact", "client", 1, 60_000)).resolves.toBeUndefined()
    expect(request).toHaveBeenCalledOnce()
  })
})
