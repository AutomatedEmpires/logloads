import { clientAnalyticsEnabled } from "./client"
import { currentBrowserRefusesTracking } from "./consent"
import { FLOW_TAP_CAP, FLOW_TIMING_CAP_MS, type FlowStep, type ProductEventProperties, type ProductFlow } from "./events"

/**
 * The browser half of flow timing (#286): how long a flow took from its first screen to its outcome, and how many
 * taps it needed, for the `flow_timed` event. Flow A, for example, starts when a shared link opens and stops when the
 * first interest is sent, across sign-up and back, in the same tab.
 *
 * The clock lives in this tab's sessionStorage and holds a start time, a tap count and, optionally, the public job
 * id: nothing else. A tap is a pointer press on a control (link, button, field, checkbox); which control it was is
 * never kept. Nothing is stored in a browser that sends Do Not Track or Global Privacy Control, or when PostHog is
 * not configured. Storage failures (private browsing, quota) are swallowed: the flow works the same without timing.
 */

const KEY_PREFIX = "logloads:v2:flow-clock"
/** A clock started more than a day ago belongs to another visit; it is dropped, not reported. */
export const FLOW_CLOCK_STALE_MS = 24 * 60 * 60_000

/** What counts as a tap target: interactive controls only, so scrolling and reading are never counted. */
export const FLOW_TAP_TARGETS =
  'a[href], button, input, select, textarea, summary, label, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"]'

export interface FlowClockStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface FlowClockState {
  startedAt: number
  taps: number
  job: string | null
}

export interface FlowClockOptions {
  storage?: FlowClockStorage | null
  now?: number
  /** Replaceable for tests: whether this browser may be measured at all. */
  allowed?: () => boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function flowClockKey(flow: ProductFlow): string {
  return `${KEY_PREFIX}:${flow}`
}

function defaultStorage(): FlowClockStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage
  } catch {
    return null
  }
}

/** Whether this browser may be timed: PostHog is configured and neither Do Not Track nor Global Privacy Control is on. */
export function flowTimingAllowed(): boolean {
  return clientAnalyticsEnabled() && !currentBrowserRefusesTracking()
}

function readState(storage: FlowClockStorage, flow: ProductFlow): FlowClockState | null {
  try {
    const raw = storage.getItem(flowClockKey(flow))
    const parsed: unknown = raw ? JSON.parse(raw) : null

    if (!parsed || typeof parsed !== "object") {
      return null
    }

    const { job, startedAt, taps } = parsed as Record<string, unknown>

    if (typeof startedAt !== "number" || !Number.isFinite(startedAt) || typeof taps !== "number" || !Number.isInteger(taps)) {
      return null
    }

    return { job: typeof job === "string" && UUID.test(job) ? job : null, startedAt, taps: Math.max(0, taps) }
  } catch {
    return null
  }
}

function writeState(storage: FlowClockStorage, flow: ProductFlow, state: FlowClockState): boolean {
  try {
    storage.setItem(flowClockKey(flow), JSON.stringify(state))
    return true
  } catch {
    // Timing is optional; the flow never depends on it.
    return false
  }
}

function clearState(storage: FlowClockStorage, flow: ProductFlow): void {
  try {
    storage.removeItem(flowClockKey(flow))
  } catch {
    // As above.
  }
}

function fresh(state: FlowClockState | null, now: number): state is FlowClockState {
  return state !== null && now - state.startedAt >= 0 && now - state.startedAt <= FLOW_CLOCK_STALE_MS
}

/**
 * Starts the flow's clock on its first screen. A clock already running for the flow is kept, so a reload or a return
 * from sign-up does not restart it. Returns whether a clock is running.
 */
export function startFlowClock(flow: ProductFlow, options: FlowClockOptions & { job?: string | null } = {}): boolean {
  const storage = options.storage === undefined ? defaultStorage() : options.storage
  const now = options.now ?? Date.now()

  if (!storage || !(options.allowed ?? flowTimingAllowed)()) {
    return false
  }

  if (fresh(readState(storage, flow), now)) {
    return true
  }

  return writeState(storage, flow, { job: options.job && UUID.test(options.job) ? options.job : null, startedAt: now, taps: 0 })
}

/** Counts one tap on a running clock; does nothing when the flow has no clock. */
export function noteFlowTap(flow: ProductFlow, options: FlowClockOptions = {}): void {
  const storage = options.storage === undefined ? defaultStorage() : options.storage
  const state = storage ? readState(storage, flow) : null

  if (storage && fresh(state, options.now ?? Date.now())) {
    writeState(storage, flow, { ...state, taps: Math.min(state.taps + 1, FLOW_TAP_CAP) })
  }
}

/**
 * Stops the flow's clock at its outcome and returns the `flow_timed` properties, or `null` when no clock was running
 * (the flow started elsewhere, or measuring is off). The clock is cleared either way, so an outcome is timed once.
 */
export function stopFlowClock(
  flow: ProductFlow,
  step: FlowStep,
  options: FlowClockOptions = {}
): ProductEventProperties<"flow_timed"> | null {
  const storage = options.storage === undefined ? defaultStorage() : options.storage
  const now = options.now ?? Date.now()

  if (!storage) {
    return null
  }

  const state = readState(storage, flow)
  clearState(storage, flow)

  if (!fresh(state, now)) {
    return null
  }

  const elapsed = Math.round(now - state.startedAt)

  return {
    capped: elapsed > FLOW_TIMING_CAP_MS,
    elapsed_ms: Math.min(elapsed, FLOW_TIMING_CAP_MS),
    flow,
    job: state.job,
    step,
    taps: Math.min(state.taps, FLOW_TAP_CAP)
  }
}

interface TapTarget {
  closest?(selector: string): unknown
}

interface TapEventSource {
  addEventListener(type: "pointerdown", listener: (event: { isPrimary?: boolean; target: unknown }) => void, options: { capture: true; passive: true }): void
  removeEventListener(type: "pointerdown", listener: (event: { isPrimary?: boolean; target: unknown }) => void, options: { capture: true }): void
}

/**
 * Counts taps on controls while the flow's clock runs: one per primary pointer press, so a label and the field it
 * activates count once. Returns the detach function, for a client component's effect cleanup.
 */
export function attachFlowTapCounter(
  flow: ProductFlow,
  options: FlowClockOptions & { source?: TapEventSource | null } = {}
): () => void {
  const source = options.source === undefined ? (typeof document === "undefined" ? null : (document as unknown as TapEventSource)) : options.source

  if (!source) {
    return () => undefined
  }

  const listener = (event: { isPrimary?: boolean; target: unknown }) => {
    const target = event.target as TapTarget | null

    if (event.isPrimary === false || typeof target?.closest !== "function" || !target.closest(FLOW_TAP_TARGETS)) {
      return
    }

    noteFlowTap(flow, { storage: options.storage })
  }

  source.addEventListener("pointerdown", listener, { capture: true, passive: true })
  return () => source.removeEventListener("pointerdown", listener, { capture: true })
}
