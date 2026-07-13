import { createHmac } from "node:crypto"

import {
  RateLimitUnavailableError,
  type RateLimitRequest,
  type RateLimitStore,
  type RateLimitWindow
} from "./rate-limit-core"

const FIXED_WINDOW_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
local ttl
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
else
  ttl = redis.call("PTTL", KEYS[1])
  if ttl < 1 then
    redis.call("PEXPIRE", KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1])
  end
end
return {count, ttl}
`.trim()

export interface RedisRestRateLimitStoreOptions {
  endpoint: string
  keySecret: string
  prefix?: string
  timeoutMs?: number
  token: string
  fetch?: typeof fetch
  now?: () => number
}

interface RedisRestResponse {
  error?: unknown
  result?: unknown
}

/**
 * Atomic shared-store adapter for the Redis REST command protocol implemented by
 * Upstash and compatible gateways. Application callers depend only on RateLimitStore.
 */
export class RedisRestRateLimitStore implements RateLimitStore {
  private readonly endpoint: string
  private readonly fetchImplementation: typeof fetch
  private readonly keySecret: string
  private readonly now: () => number
  private readonly prefix: string
  private readonly timeoutMs: number
  private readonly token: string

  constructor(options: RedisRestRateLimitStoreOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, "")
    this.fetchImplementation = options.fetch ?? fetch
    this.keySecret = options.keySecret
    this.now = options.now ?? (() => Date.now())
    this.prefix = options.prefix?.trim() || "logloads:rate-limit"
    this.timeoutMs = options.timeoutMs ?? 1_500
    this.token = options.token
  }

  async consume({ bucket, key, windowMs }: RateLimitRequest): Promise<RateLimitWindow> {
    const storageKey = this.storageKey(bucket, key)

    try {
      const response = await this.fetchImplementation(this.endpoint, {
        body: JSON.stringify(["EVAL", FIXED_WINDOW_SCRIPT, "1", storageKey, String(windowMs)]),
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json"
        },
        method: "POST",
        signal: AbortSignal.timeout(this.timeoutMs)
      })

      if (!response.ok) {
        throw new Error(`shared store returned HTTP ${response.status}`)
      }

      const payload = (await response.json()) as RedisRestResponse

      if (payload.error) {
        throw new Error("shared store rejected the rate-limit command")
      }

      if (!Array.isArray(payload.result) || payload.result.length < 2) {
        throw new Error("shared store returned an invalid rate-limit result")
      }

      const count = Number(payload.result[0])
      const ttlMs = Number(payload.result[1])

      if (!Number.isSafeInteger(count) || count < 1 || !Number.isFinite(ttlMs) || ttlMs < 1) {
        throw new Error("shared store returned an invalid rate-limit window")
      }

      return { count, resetAt: this.now() + ttlMs }
    } catch (error) {
      if (error instanceof RateLimitUnavailableError) throw error

      throw new RateLimitUnavailableError()
    }
  }

  private storageKey(bucket: string, key: string): string {
    const safeBucket = bucket.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)
    const digest = createHmac("sha256", this.keySecret).update(key).digest("hex")

    return `${this.prefix}:${safeBucket}:${digest}`
  }
}
