import { createHmac } from "node:crypto"

import {
  RateLimitUnavailableError,
  type RateLimitRequest,
  type RateLimitStore,
  type RateLimitWindow
} from "./rate-limit-core"

export interface SupabaseRateLimitStoreOptions {
  endpoint: string
  keySecret: string
  prefix?: string
  serviceRoleKey: string
  timeoutMs?: number
  fetch?: typeof fetch
  now?: () => number
}

/**
 * How long a check waits for the shared store when the caller sets no budget
 * of its own. Short, so a slow store refuses quickly. The per-user write limits
 * wait longer (`write-limits.ts`).
 */
export const DEFAULT_RATE_LIMIT_TIMEOUT_MS = 1_500

interface SupabaseRateLimitRow {
  request_count?: unknown
  retry_after_ms?: unknown
}

/**
 * Shared fixed-window adapter backed by the service-role-only Supabase RPC.
 * Raw client identifiers are HMAC-pseudonymized before leaving this process.
 */
export class SupabaseRateLimitStore implements RateLimitStore {
  private readonly endpoint: string
  private readonly fetchImplementation: typeof fetch
  private readonly keySecret: string
  private readonly now: () => number
  private readonly prefix: string
  private readonly serviceRoleKey: string
  private readonly timeoutMs: number

  constructor(options: SupabaseRateLimitStoreOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, "")
    this.fetchImplementation = options.fetch ?? fetch
    this.keySecret = options.keySecret
    this.now = options.now ?? (() => Date.now())
    this.prefix = (options.prefix?.trim() || "logloads:rate-limit").slice(0, 79)
    this.serviceRoleKey = options.serviceRoleKey
    this.timeoutMs = options.timeoutMs ?? DEFAULT_RATE_LIMIT_TIMEOUT_MS
  }

  async consume({ bucket, key, timeoutMs, windowMs }: RateLimitRequest): Promise<RateLimitWindow> {
    const safeBucket = bucket.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)
    const keyHash = createHmac("sha256", this.keySecret).update(key).digest("hex")

    try {
      const response = await this.fetchImplementation(
        `${this.endpoint}/rest/v1/rpc/consume_rate_limit`,
        {
          body: JSON.stringify({
            p_bucket: `${this.prefix}:${safeBucket}`,
            p_key_hash: keyHash,
            p_window_ms: windowMs
          }),
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${this.serviceRoleKey}`,
            "Content-Type": "application/json",
            apikey: this.serviceRoleKey
          },
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs ?? this.timeoutMs)
        }
      )

      if (!response.ok) {
        throw new Error(`shared store returned HTTP ${response.status}`)
      }

      const payload = (await response.json()) as unknown
      const row = Array.isArray(payload) ? (payload[0] as SupabaseRateLimitRow | undefined) : undefined
      const count = Number(row?.request_count)
      const retryAfterMs = Number(row?.retry_after_ms)

      if (
        !Number.isSafeInteger(count) ||
        count < 1 ||
        !Number.isSafeInteger(retryAfterMs) ||
        retryAfterMs < 1
      ) {
        throw new Error("shared store returned an invalid rate-limit window")
      }

      return { count, resetAt: this.now() + retryAfterMs }
    } catch {
      throw new RateLimitUnavailableError()
    }
  }
}
