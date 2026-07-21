const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"])

export interface DemoRuntimeEnvironment {
  CI?: string
  CLERK_SECRET_KEY?: string
  LOGLOADS_DEMO_MODE?: string
  LOGLOADS_ENABLE_DEV_LOGIN?: string
  NEXT_PUBLIC_APP_URL?: string
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string
  NODE_ENV?: string
  VERCEL?: string
  VERCEL_ENV?: string
  VERCEL_URL?: string
}

export type DevSessionDecision =
  | { demoMode: boolean; enabled: true; reason: "demo" | "development" | "local-production" }
  | { demoMode: false; enabled: false; reason: "ci" | "clerk" | "hosted" | "non-loopback" | "not-enabled" }

function enabledFlag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true" || value === "1"
}

export function hostnameFromHostHeader(value: string | null | undefined): string | null {
  const host = value?.trim().toLowerCase()

  if (!host || host.includes(",") || host.includes("/") || host.includes("\\")) {
    return null
  }

  if (host.startsWith("[")) {
    const closingBracket = host.indexOf("]")

    if (closingBracket < 0 || (host.length > closingBracket + 1 && host[closingBracket + 1] !== ":")) {
      return null
    }

    return host.slice(1, closingBracket)
  }

  const colon = host.lastIndexOf(":")

  if (colon > -1) {
    const port = host.slice(colon + 1)

    if (!/^\d+$/.test(port)) {
      return null
    }

    return host.slice(0, colon)
  }

  return host
}

export function isLoopbackHost(value: string | null | undefined): boolean {
  const hostname = hostnameFromHostHeader(value)

  return hostname ? LOOPBACK_HOSTS.has(hostname) : false
}

export function isLoopbackAppUrl(value: string | undefined): boolean {
  if (!value) {
    return true
  }

  try {
    const url = new URL(value)

    return (url.protocol === "http:" || url.protocol === "https:") && LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

export function decideDevSession(
  environment: DemoRuntimeEnvironment,
  requestHost: string | null | undefined
): DevSessionDecision {
  if (environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && environment.CLERK_SECRET_KEY) {
    return { demoMode: false, enabled: false, reason: "clerk" }
  }

  if (enabledFlag(environment.CI)) {
    return { demoMode: false, enabled: false, reason: "ci" }
  }

  if (enabledFlag(environment.VERCEL) || environment.VERCEL_ENV || environment.VERCEL_URL) {
    return { demoMode: false, enabled: false, reason: "hosted" }
  }

  if (!isLoopbackHost(requestHost) || !isLoopbackAppUrl(environment.NEXT_PUBLIC_APP_URL)) {
    return { demoMode: false, enabled: false, reason: "non-loopback" }
  }

  if (enabledFlag(environment.LOGLOADS_DEMO_MODE)) {
    return { demoMode: true, enabled: true, reason: "demo" }
  }

  if (environment.NODE_ENV !== "production") {
    return { demoMode: false, enabled: true, reason: "development" }
  }

  if (enabledFlag(environment.LOGLOADS_ENABLE_DEV_LOGIN)) {
    return { demoMode: false, enabled: true, reason: "local-production" }
  }

  return { demoMode: false, enabled: false, reason: "not-enabled" }
}
