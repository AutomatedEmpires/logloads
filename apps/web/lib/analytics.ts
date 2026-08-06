import "server-only"

const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com"
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY

export function isAnalyticsEnabled(): boolean {
  return Boolean(POSTHOG_KEY)
}

/**
 * Server-side capture for meaningful operating events (onboarding, capacity
 * request, approval, trip progress). The promise never rejects and is a no-op
 * when no PostHog key is configured. Completion-critical call sites may await
 * it before redirecting; ordinary operating telemetry may remain non-blocking.
 */
export async function captureServerEvent(
  event: string,
  distinctId: string,
  properties: Record<string, unknown> = {}
): Promise<void> {
  if (!POSTHOG_KEY) {
    return
  }

  try {
    await fetch(`${POSTHOG_HOST}/capture/`, {
      body: JSON.stringify({
        api_key: POSTHOG_KEY,
        distinct_id: distinctId,
        event,
        properties: { ...properties, $lib: "logloads-server" },
        timestamp: new Date().toISOString()
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(4000)
    })
  } catch {
    // Analytics cannot make an otherwise durable operating action fail.
  }
}
