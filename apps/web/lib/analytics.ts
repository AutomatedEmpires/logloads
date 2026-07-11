import "server-only"

const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com"
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY

export function isAnalyticsEnabled(): boolean {
  return Boolean(POSTHOG_KEY)
}

/**
 * Server-side capture for meaningful operating events (onboarding, capacity
 * request, approval, trip progress). Fire-and-forget: never blocks or throws
 * into the request path, and is a no-op when no PostHog key is configured.
 */
export function captureServerEvent(
  event: string,
  distinctId: string,
  properties: Record<string, unknown> = {}
): void {
  if (!POSTHOG_KEY) {
    return
  }

  void fetch(`${POSTHOG_HOST}/capture/`, {
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
  }).catch(() => {})
}
