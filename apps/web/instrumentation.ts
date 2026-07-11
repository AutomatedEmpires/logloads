import type { Instrumentation } from "next"

/**
 * Server error tracking via Sentry, activated only when SENTRY_DSN is set. With
 * no DSN this is inert — Sentry is never imported or initialized.
 */
export async function register() {
  if (process.env.SENTRY_DSN && process.env.NEXT_RUNTIME === "nodejs") {
    const Sentry = await import("@sentry/nextjs")

    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0.1,
      // Do not attach IPs, cookies, headers, or request bodies (which can carry
      // the session cookie or form input). Keeps PII and secrets out of events.
      sendDefaultPii: false
    })
  }
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (process.env.SENTRY_DSN) {
    const Sentry = await import("@sentry/nextjs")

    Sentry.captureRequestError(...args)
  }
}
