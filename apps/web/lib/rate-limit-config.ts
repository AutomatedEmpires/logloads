import {
  MemoryRateLimitStore,
  RateLimiter,
  UnavailableRateLimitStore,
  type RateLimitStore
} from "./rate-limit-core"
import { RedisRestRateLimitStore } from "./rate-limit-redis"

export interface RateLimitEnvironment {
  LOGLOADS_ENABLE_DEV_LOGIN?: string
  LOGLOADS_RATE_LIMIT_KEY_PREFIX?: string
  LOGLOADS_RATE_LIMIT_REST_TOKEN?: string
  LOGLOADS_RATE_LIMIT_REST_URL?: string
  LOGLOADS_RATE_LIMIT_TEST_MODE?: string
  NODE_ENV?: string
}

export function createRateLimitStore(
  environment: RateLimitEnvironment,
  fetchImplementation: typeof fetch = fetch
): RateLimitStore {
  const endpoint = environment.LOGLOADS_RATE_LIMIT_REST_URL?.trim()
  const token = environment.LOGLOADS_RATE_LIMIT_REST_TOKEN?.trim()

  if (endpoint && token) {
    return new RedisRestRateLimitStore({
      endpoint,
      fetch: fetchImplementation,
      prefix: environment.LOGLOADS_RATE_LIMIT_KEY_PREFIX,
      token
    })
  }

  // Partial external configuration is always an outage, never permission to
  // silently weaken a deployment to process-local enforcement.
  if (endpoint || token) {
    return new UnavailableRateLimitStore()
  }

  if (environment.NODE_ENV !== "production") {
    return new MemoryRateLimitStore()
  }

  // The production-built Playwright server is deliberately single-process and
  // credential-free. Requiring both flags prevents this escape hatch from being
  // enabled accidentally on a real deployment.
  if (
    environment.LOGLOADS_RATE_LIMIT_TEST_MODE === "true" &&
    environment.LOGLOADS_ENABLE_DEV_LOGIN === "true"
  ) {
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
