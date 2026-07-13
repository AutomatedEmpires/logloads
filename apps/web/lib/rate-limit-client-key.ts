import { isIP } from "node:net"

export interface ClientKeyHeaders {
  get(name: string): string | null
}

export interface ClientKeyEnvironment {
  VERCEL?: string
}

/**
 * Vercel overwrites x-vercel-forwarded-for at its edge. Other forwarded-IP
 * headers are client-controlled outside that trust boundary and are ignored.
 */
export function clientKeyFromHeaders(
  headerStore: ClientKeyHeaders,
  environment: ClientKeyEnvironment
): string {
  if (environment.VERCEL !== "1") {
    return "local"
  }

  const candidate = headerStore.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()

  return candidate && isIP(candidate) ? candidate : "unknown"
}
