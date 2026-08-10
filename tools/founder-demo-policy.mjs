import { basename, dirname, resolve } from "node:path"
import { tmpdir } from "node:os"

export const DEMO_HOST = "127.0.0.1"
export const DEMO_PORT = 3002
export const DEMO_URL = `http://${DEMO_HOST}:${DEMO_PORT}`
export const DEMO_DIRECTORY_PREFIX = "logloads-founder-demo-"
export const DEMO_SHUTDOWN_GRACE_MS = 5_000

export const PROVIDER_ENVIRONMENT_VARIABLES = [
  "ANTHROPIC_API_KEY",
  "ASSISTANT_MODEL",
  "CLERK_SECRET_KEY",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "CLOUDINARY_CLOUD_NAME",
  "DATABASE_URL",
  "DOPPLER_CONFIG",
  "DOPPLER_ENVIRONMENT",
  "DOPPLER_PROJECT",
  "DOPPLER_TOKEN",
  "LOGLOADS_CONTACT_EMAIL",
  "LOGLOADS_EMAIL_FROM",
  "LOGLOADS_EMAIL_REPLY_TO",
  "MAPBOX_ACCESS_TOKEN",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_MAPBOX_TOKEN",
  "NEXT_PUBLIC_POSTHOG_HOST",
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_SENTRY_DSN",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "OPENAI_API_KEY",
  "POSTHOG_API_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM",
  "RESEND_REPLY_TO",
  "SENTRY_AUTH_TOKEN",
  "SENTRY_DSN",
  "STRIPE_PRICE_DISPATCH",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "SUPABASE_ANON_KEY",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL"
]

function enabledFlag(value) {
  if (typeof value !== "string") return false

  const normalized = value.trim().toLowerCase()

  return normalized !== "" && normalized !== "0" && normalized !== "false" && normalized !== "no"
}

export function isLoopbackUrl(value) {
  try {
    const url = new URL(value)

    // URL.hostname strips the brackets from an IPv6 literal: new
    // URL("http://[::1]:3002").hostname is "::1", never "[::1]".
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1")
  } catch {
    return false
  }
}

export function validateDemoLaunchEnvironment(environment) {
  if (enabledFlag(environment.CI)) {
    throw new Error("The founder demo refuses to run in CI.")
  }

  if (enabledFlag(environment.VERCEL) || environment.VERCEL_ENV || environment.VERCEL_URL || environment.NOW_BUILDER) {
    throw new Error("The founder demo refuses to run in Vercel or another hosted build runtime.")
  }

  if (environment.NEXT_PUBLIC_APP_URL && !isLoopbackUrl(environment.NEXT_PUBLIC_APP_URL)) {
    throw new Error("The founder demo refuses a non-loopback NEXT_PUBLIC_APP_URL.")
  }
}

export function buildDemoEnvironment(parentEnvironment, stateFile, sessionSecret) {
  const environment = {
    ...parentEnvironment,
    CI: "",
    LOGLOADS_ALLOW_STATE_BOOTSTRAP: "",
    LOGLOADS_DEMO_MODE: "true",
    LOGLOADS_ENABLE_DEV_LOGIN: "true",
    LOGLOADS_RATE_LIMIT_HMAC_SECRET: sessionSecret,
    LOGLOADS_RATE_LIMIT_TEST_MODE: "true",
    LOGLOADS_SESSION_SECRET: sessionSecret,
    LOGLOADS_STATE_FILE: stateFile,
    NEXT_PUBLIC_APP_URL: DEMO_URL,
    NODE_ENV: "development",
    VERCEL: "",
    VERCEL_ENV: "",
    VERCEL_URL: ""
  }

  for (const key of PROVIDER_ENVIRONMENT_VARIABLES) {
    environment[key] = ""
  }

  return environment
}

export function assertDisposableDemoDirectory(directory) {
  const resolvedDirectory = resolve(directory)
  const resolvedTempDirectory = resolve(tmpdir())

  if (dirname(resolvedDirectory) !== resolvedTempDirectory || !basename(resolvedDirectory).startsWith(DEMO_DIRECTORY_PREFIX)) {
    throw new Error("Refusing to clean a path outside the founder demo temporary directory.")
  }

  return resolvedDirectory
}

export function createDemoShutdownController({
  childKill,
  cleanup,
  clearTimer = clearTimeout,
  exit,
  graceMs = DEMO_SHUTDOWN_GRACE_MS,
  onStopped = () => {},
  onStopping = () => {},
  setTimer = setTimeout
}) {
  let escalationTimer = null
  let finished = false
  let stopping = false

  function kill(signal) {
    try {
      childKill(signal)
    } catch {
      // A concurrent child exit is expected during signal escalation. The
      // idempotent finalizer below still owns cleanup and parent termination.
    }
  }

  function finalize(code) {
    if (finished) return

    finished = true

    if (escalationTimer !== null) {
      clearTimer(escalationTimer)
      escalationTimer = null
    }

    try {
      cleanup()
      if (stopping) onStopped()
    } finally {
      exit(code)
    }
  }

  function forceStop() {
    kill("SIGKILL")
    finalize(stopping ? 0 : 1)
  }

  return {
    childError() {
      finalize(1)
    },
    childExit(code) {
      finalize(stopping ? 0 : code ?? 1)
    },
    signal(signal) {
      if (finished) return

      if (stopping) {
        forceStop()
        return
      }

      stopping = true
      onStopping(signal)
      kill(signal === "SIGHUP" ? "SIGTERM" : signal)
      escalationTimer = setTimer(forceStop, graceMs)
    }
  }
}
