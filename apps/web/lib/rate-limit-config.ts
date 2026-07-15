import {
  MemoryRateLimitStore,
  RateLimiter,
  TestRateLimitStore,
  UnavailableRateLimitStore,
  type RateLimitStore
} from "./rate-limit-core"
import { SupabaseRateLimitStore } from "./rate-limit-supabase"

export interface RateLimitEnvironment {
  LOGLOADS_ENABLE_DEV_LOGIN?: string
  LOGLOADS_RATE_LIMIT_HMAC_SECRET?: string
  LOGLOADS_RATE_LIMIT_KEY_PREFIX?: string
  LOGLOADS_RATE_LIMIT_TEST_MODE?: string
  NODE_ENV?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  SUPABASE_URL?: string
  VERCEL?: string
  VERCEL_ENV?: string
}

function isLoopbackEndpoint(endpoint: string | undefined): boolean {
  if (!endpoint) return false

  try {
    return ["127.0.0.1", "localhost", "::1"].includes(new URL(endpoint).hostname)
  } catch {
    return false
  }
}

export function createRateLimitStore(
  environment: RateLimitEnvironment,
  fetchImplementation: typeof fetch = fetch
): RateLimitStore {
  const endpoint = environment.SUPABASE_URL?.trim()
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const keySecret = environment.LOGLOADS_RATE_LIMIT_HMAC_SECRET?.trim()

  // The production-built Playwright server is deliberately single-process.
  // Its canonical application state still lives in the isolated local
  // Supabase stack, but rate-limit counters must not leak across stateful
  // journeys or their retries. Requiring both flags keeps this test-only
  // bypass unavailable to real Preview and Production deployments. The
  // provider check makes the guarantee executable rather than documentary.
  if (
    environment.NODE_ENV === "production" &&
    environment.LOGLOADS_RATE_LIMIT_TEST_MODE === "true" &&
    environment.LOGLOADS_ENABLE_DEV_LOGIN === "true" &&
    environment.VERCEL !== "1" &&
    !environment.VERCEL_ENV &&
    Boolean(serviceRoleKey) &&
    isLoopbackEndpoint(endpoint)
  ) {
    return new TestRateLimitStore()
  }

  if (endpoint && serviceRoleKey) {
    return new SupabaseRateLimitStore({
      endpoint,
      fetch: fetchImplementation,
      keySecret: keySecret || serviceRoleKey,
      prefix: environment.LOGLOADS_RATE_LIMIT_KEY_PREFIX,
      serviceRoleKey
    })
  }

  // Partial external configuration is always an outage, never permission to
  // silently weaken a deployment to process-local enforcement.
  if (endpoint || serviceRoleKey) {
    return new UnavailableRateLimitStore()
  }

  if (environment.NODE_ENV !== "production") {
    return new MemoryRateLimitStore()
  }

  return new UnavailableRateLimitStore()
}

export function createRateLimiter(
  environment: RateLimitEnvironment,
  fetchImplementation: typeof fetch = fetch
): RateLimiter {
  return new RateLimiter(createRateLimitStore(environment, fetchImplementation))
}
