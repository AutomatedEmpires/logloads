import { createHmac } from "node:crypto"
import { isIP } from "node:net"

export interface ClientKeyHeaders {
  get(name: string): string | null
}

export interface ClientKeyEnvironment {
  LOGLOADS_RATE_LIMIT_HMAC_SECRET?: string
  NODE_ENV?: string
  VERCEL?: string
  VERCEL_ENV?: string
}

/**
 * Namespace for callers whose address no trusted proxy vouched for. A hashed
 * fingerprint can never equal a bare IP, so an unverified caller can never land
 * in a verified caller's window and drain it.
 */
const UNVERIFIED_PREFIX = "unverified:"
const VERIFIED_PREFIX = "verified:"

/**
 * Client-controlled, but they vary per caller, which is what a window needs.
 * The platform headers are included for the case where one is present but
 * unusable: a malformed value still separates its sender from everyone else.
 */
const FINGERPRINT_HEADERS = [
  "x-vercel-forwarded-for",
  "fly-client-ip",
  "x-forwarded-for",
  "x-real-ip",
  "user-agent",
  "accept-language"
]

function trustedIp(value: string | null | undefined): string | null {
  const candidate = value?.split(",")[0]?.trim()

  return candidate && isIP(candidate) ? candidate : null
}

function pseudonymize(value: string, environment: ClientKeyEnvironment): string {
  const secret = environment.LOGLOADS_RATE_LIMIT_HMAC_SECRET?.trim()

  if (!secret) {
    throw new Error("LOGLOADS_RATE_LIMIT_HMAC_SECRET is required to protect rate-limit keys")
  }

  const deployment = environment.VERCEL_ENV ?? environment.NODE_ENV ?? "local"

  return createHmac("sha256", secret)
    .update(`${deployment}\n${value}`)
    .digest("hex")
    .slice(0, 32)
}

function fingerprint(
  headerStore: ClientKeyHeaders,
  environment: ClientKeyEnvironment
): string {
  const material = FINGERPRINT_HEADERS
    .map((header) => `${header}=${headerStore.get(header) ?? ""}`)
    .join("\n")

  return `${UNVERIFIED_PREFIX}${pseudonymize(material, environment)}`
}

/**
 * The rate-limit window key for one caller.
 *
 * Both deployment targets overwrite their own client-IP header at their edge on
 * every request, so on either platform that header is the caller's real address
 * and cannot be forged end-to-end: `x-vercel-forwarded-for` on Vercel,
 * `fly-client-ip` on the Fly target in fly.toml. The Vercel signal comes from
 * the environment and is therefore decided first — a request served by Vercel
 * can never be steered by a forged Fly header. Every other forwarded-IP header
 * is client-controlled outside both trust boundaries.
 *
 * Off both platforms nothing vouches for an address, so the key falls back to a
 * hashed fingerprint of the request's own headers. It must NOT fall back to a
 * shared constant: onboarding allows 5 requests per hour, so one key shared by
 * every caller let a single attacker lock out every user for an hour. A caller
 * off-platform can rotate its fingerprint to dodge its own window, which is the
 * accepted cost of not handing it everybody else's.
 */
export function clientKeyFromHeaders(
  headerStore: ClientKeyHeaders,
  environment: ClientKeyEnvironment
): string {
  if (environment.VERCEL === "1") {
    const ip = trustedIp(headerStore.get("x-vercel-forwarded-for"))

    return ip
      ? `${VERIFIED_PREFIX}${pseudonymize(`ip:${ip}`, environment)}`
      : fingerprint(headerStore, environment)
  }

  const ip = trustedIp(headerStore.get("fly-client-ip"))

  return ip
    ? `${VERIFIED_PREFIX}${pseudonymize(`ip:${ip}`, environment)}`
    : fingerprint(headerStore, environment)
}
