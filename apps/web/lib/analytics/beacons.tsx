"use client"

import { useEffect, useRef } from "react"

import type { FlowStep, ProductFlow } from "./events"

/**
 * Drop-in client components for the browser product events (#286), so a server page wires an event with one line of
 * JSX and serializable props. Each renders nothing and does its work once after hydration; none runs on the server,
 * and none does anything when PostHog is not configured or the browser sends Do Not Track or Global Privacy Control.
 *
 * Their capture and clock code is loaded with a dynamic import, once, only when one has work to do and a PostHog key
 * is configured (#330). A page that renders a beacon carries this small module, not the event schemas, so it keeps
 * its route budget (#242). The pageview tracker loads the same code.
 */

type BeaconRuntime = typeof import("./client") & typeof import("./flow-clock")

let runtime: Promise<BeaconRuntime | null> | null = null

/** The capture and clock code; `null` without a PostHog key (`NEXT_PUBLIC_*` is inlined at build time) or if it fails to load. */
function loadRuntime(): Promise<BeaconRuntime | null> {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    return Promise.resolve(null)
  }

  runtime ??= Promise.all([import("./client"), import("./flow-clock")]).then(
    ([client, clock]) => ({ ...client, ...clock }),
    () => {
      runtime = null
      return null
    }
  )

  return runtime
}

/** Runs `work` with the runtime after hydration. The cleanup detaches what `work` attached, even when it arrives late. */
function useRuntimeEffect(work: (code: BeaconRuntime) => (() => void) | undefined, deps: readonly unknown[]): void {
  useEffect(() => {
    let cancelled = false
    let detach: (() => void) | undefined

    void loadRuntime().then((code) => {
      if (code && !cancelled) {
        detach = work(code)
      }
    })

    return () => {
      cancelled = true
      detach?.()
    }
    // `deps` lists every input `work` reads; `work` itself is recreated on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/** Sends once for each distinct `key`, so React's development double-invoke never sends twice. */
function useSendOnce(key: string, send: (code: BeaconRuntime) => void): void {
  const sent = useRef<string | null>(null)

  useEffect(() => {
    if (sent.current === key) {
      return
    }

    sent.current = key
    void loadRuntime().then((code) => {
      if (code) {
        send(code)
      }
    })
    // `key` encodes every input `send` reads; `send` itself is recreated on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

/**
 * The share page (#287, flow A): records `share_link_opened` and starts flow A's clock, counting taps from here. The
 * channel is the link's own channel value, read by `parseShareChannel`; the raw value is never sent.
 */
export function ShareLinkOpenedBeacon({ channel = null, jobId, signedIn }: { channel?: string | null; jobId: string; signedIn: boolean }) {
  useSendOnce(`${jobId}|${channel ?? ""}|${signedIn}`, (code) => {
    void code.captureClientProductEvent("share_link_opened", { channel: code.parseShareChannel(channel), job: jobId, signed_in: signedIn })
  })

  useRuntimeEffect((code) => (code.startFlowClock("A", { job: jobId }) ? code.attachFlowTapCounter("A") : undefined), [jobId])

  return null
}

/** A flow's first screen: starts its clock (a running one is kept) and counts taps while this screen is open. */
export function FlowClockStart({ flow, jobId = null }: { flow: ProductFlow; jobId?: string | null }) {
  useRuntimeEffect((code) => (code.startFlowClock(flow, { job: jobId }) ? code.attachFlowTapCounter(flow) : undefined), [flow, jobId])

  return null
}

/** A screen in the middle of a flow (sign-up's return, the interest sheet): counts taps on a running clock. */
export function FlowTapCounter({ flow }: { flow: ProductFlow }) {
  useRuntimeEffect((code) => (code.flowTimingAllowed() ? code.attachFlowTapCounter(flow) : undefined), [flow])

  return null
}

/**
 * A flow's outcome screen (the "sent", "published" or "confirmed" notice): stops the clock and sends `flow_timed`.
 * Nothing is sent when no clock was running, so arriving any other way records nothing. Pass the outcome's `jobId`
 * where the flow is about one job (A, E), so an outcome on another job never stops that job's clock.
 */
export function FlowClockStop({ flow, jobId = null, step }: { flow: ProductFlow; jobId?: string | null; step: FlowStep }) {
  useSendOnce(`${flow}|${step}|${jobId ?? ""}`, (code) => {
    void code.captureClientProductEvent("flow_timed", code.stopFlowClock(flow, step, { job: jobId }))
  })

  return null
}
