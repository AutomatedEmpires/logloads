/**
 * Whether a person has asked not to be tracked (#286). LogLoads has no analytics consent banner or opt-out setting,
 * so product events honour the two signals browsers send: Do Not Track and Global Privacy Control. Either one turns
 * product events off for that request or that browser. The legacy pageview tracker does not read them yet (see
 * docs/analytics/event-plan.md, "Follow-ups").
 */

export interface HeaderReader {
  get(name: string): string | null
}

const ON = new Set(["1", "yes"])

function signalOn(value: unknown): boolean {
  return value === true || (typeof value === "string" && ON.has(value.trim().toLowerCase()))
}

/** True when the request carries `DNT: 1` or `Sec-GPC: 1`. No headers (a job or a test) is not a refusal. */
export function requestRefusesTracking(headers: HeaderReader | null | undefined): boolean {
  if (!headers) {
    return false
  }

  return signalOn(headers.get("dnt")) || signalOn(headers.get("sec-gpc"))
}

/** The parts of `navigator` and `window` that carry the signals, as PostHog's own `respect_dnt` reads them. */
export interface BrowserPrivacySignals {
  navigator?: { doNotTrack?: unknown; msDoNotTrack?: unknown; globalPrivacyControl?: unknown } | null
  window?: { doNotTrack?: unknown } | null
}

/** True when the browser sends Do Not Track (any of its three spellings) or Global Privacy Control. */
export function browserRefusesTracking(signals: BrowserPrivacySignals): boolean {
  const nav = signals.navigator ?? null
  const win = signals.window ?? null

  return (
    signalOn(nav?.doNotTrack) ||
    signalOn(nav?.msDoNotTrack) ||
    signalOn(win?.doNotTrack) ||
    nav?.globalPrivacyControl === true
  )
}

/** The current browser's signals; refuses when there is no browser, so nothing runs during server rendering. */
export function currentBrowserRefusesTracking(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return true
  }

  return browserRefusesTracking({
    navigator: navigator as BrowserPrivacySignals["navigator"],
    window: window as unknown as BrowserPrivacySignals["window"]
  })
}
