"use client"

import { useEffect, useRef } from "react"

import { captureClientProductEvent, parseShareChannel } from "./client"
import type { FlowStep, ProductFlow } from "./events"
import { attachFlowTapCounter, flowTimingAllowed, startFlowClock, stopFlowClock } from "./flow-clock"

/**
 * Drop-in client components for the browser product events (#286), so a server page wires an event with one line of
 * JSX and serializable props. Each renders nothing and does its work once after hydration; none runs on the server,
 * and none does anything when PostHog is not configured or the browser sends Do Not Track or Global Privacy Control.
 */

/** Sends once for each distinct `key`, so React's development double-invoke never sends twice. */
function useSendOnce(key: string, send: () => void): void {
  const sent = useRef<string | null>(null)

  useEffect(() => {
    if (sent.current === key) {
      return
    }

    sent.current = key
    send()
    // `key` encodes every input `send` reads; `send` itself is recreated on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

/**
 * The share page (#287, flow A): records `share_link_opened` and starts flow A's clock, counting taps from here. The
 * channel is the link's own channel value, read by `parseShareChannel`; the raw value is never sent.
 */
export function ShareLinkOpenedBeacon({ channel = null, jobId, signedIn }: { channel?: string | null; jobId: string; signedIn: boolean }) {
  useSendOnce(`${jobId}|${channel ?? ""}|${signedIn}`, () => {
    void captureClientProductEvent("share_link_opened", { channel: parseShareChannel(channel), job: jobId, signed_in: signedIn })
  })

  useEffect(() => (startFlowClock("A", { job: jobId }) ? attachFlowTapCounter("A") : undefined), [jobId])

  return null
}

/** A flow's first screen: starts its clock (a running one is kept) and counts taps while this screen is open. */
export function FlowClockStart({ flow, jobId = null }: { flow: ProductFlow; jobId?: string | null }) {
  useEffect(() => (startFlowClock(flow, { job: jobId }) ? attachFlowTapCounter(flow) : undefined), [flow, jobId])

  return null
}

/** A screen in the middle of a flow (sign-up's return, the interest sheet): counts taps on a running clock. */
export function FlowTapCounter({ flow }: { flow: ProductFlow }) {
  useEffect(() => (flowTimingAllowed() ? attachFlowTapCounter(flow) : undefined), [flow])

  return null
}

/**
 * A flow's outcome screen (the "sent", "published" or "confirmed" notice): stops the clock and sends `flow_timed`.
 * Nothing is sent when no clock was running, so arriving any other way records nothing. Pass the outcome's `jobId`
 * where the flow is about one job (A, E), so an outcome on another job never stops that job's clock.
 */
export function FlowClockStop({ flow, jobId = null, step }: { flow: ProductFlow; jobId?: string | null; step: FlowStep }) {
  useSendOnce(`${flow}|${step}|${jobId ?? ""}`, () => {
    void captureClientProductEvent("flow_timed", stopFlowClock(flow, step, { job: jobId }))
  })

  return null
}
