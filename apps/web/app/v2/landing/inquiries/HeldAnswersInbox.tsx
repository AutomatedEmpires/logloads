"use client"

import { Icon } from "@logloads/ui/icons"
import { Button } from "@logloads/ui/primitives"
import { useCallback, useEffect, useId, useRef, useState } from "react"

import type { HeldAnswerResult } from "@/lib/marketplace-v2/actions"
import { v2ErrorMessage } from "@/lib/marketplace-v2/error-codes"

import { heldPhone, keepHeld } from "./_lib/held-phone"
import { clearHeld, heldDelivered, heldFields, HOLD_MS, listHeld, openHeld, readHeld, writeHeld, type HeldSend, type HeldViewer } from "./_lib/held-send"
import css from "./HeldReplies.module.css"

type ItemPhase = "holding" | "sending" | "offline" | "error" | "stale"

interface Item {
  /** The failed send's fixed copy (`error-codes.ts`), never words from the server. */
  failure?: string
  held: HeldSend
  phase: ItemPhase
}

const PATH = "/v2/landing/inquiries"

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false
}

const nameOf = (held: HeldSend) => held.recipientName || "the hauler"
const sameItem = (a: HeldSend, b: HeldSend) => a.interestId.toLowerCase() === b.interestId.toLowerCase()

/** "1 reply waiting to send", "2 declines waiting to send", or "3 answers waiting to send" when both. */
function headline(items: readonly Item[]): string {
  const replies = items.filter((item) => item.held.decision === "replied").length
  const count = items.length
  const noun = replies === count ? (count === 1 ? "reply" : "replies") : replies === 0 ? (count === 1 ? "decline" : "declines") : "answers"
  return `${count} ${noun} waiting to send`
}

function stateText(item: Item): string {
  switch (item.phase) {
    case "holding":
      return item.held.reopened ? "It has not gone yet. It goes in 1 minute unless you stop it." : "It goes in 1 minute unless you stop it."
    case "sending":
      return "Sending…"
    case "offline":
      return "Waiting for a signal. We send it once when you are back in range."
    case "error":
      return `Not sent. ${item.failure ?? v2ErrorMessage("unexpected")}`
    case "stale":
      return "Not sent. It waited more than a week, so it only goes if you send it."
  }
}

/**
 * The inbox's held answers (flow C, #411; review of PR 401, finding 2). A ready reply or a decline is held on the phone
 * for a minute so Undo works (LandingReplyBar). When the landing closed that inquiry, lost the signal or closed the tab
 * before it went, it used to wait for that same inquiry to be opened again, and the inbox said nothing. Here the inbox
 * lists every answer this person holds for this business, except the open inquiry's (its reply bar has it), says
 * "1 reply waiting to send", and sends each one through `sendHeldAnswerAction` once its minute is up, without leaving
 * the page. One whose minute ran out unseen gets a fresh minute of Undo first, and a week-old one goes only on Send now.
 * What happened is announced in the status line: sent, waiting for a signal, or not sent with the reason's fixed copy.
 */
export function HeldAnswersInbox({
  action,
  holdMs = HOLD_MS,
  openInterestId,
  viewer
}: {
  action: (formData: FormData) => Promise<HeldAnswerResult>
  holdMs?: number
  /** The inquiry whose reply bar is on the page: it holds and sends its own answer. */
  openInterestId: string | null
  viewer: HeldViewer
}) {
  const [items, setItems] = useState<Item[]>([])
  const [said, setSaid] = useState<{ text: string; tone: "positive" | "neutral" | "critical" } | null>(null)
  const current = useRef<Item[]>([])
  const inFlight = useRef(new Set<string>())
  const titleId = useId()
  const { organizationId, userId } = viewer
  const open = openInterestId?.toLowerCase() ?? null

  const commit = useCallback((next: Item[]) => {
    current.current = next
    setItems(next)
  }, [])

  const update = useCallback(
    (held: HeldSend, change: Partial<Item> | null) => {
      commit(change === null ? current.current.filter((item) => !sameItem(item.held, held)) : current.current.map((item) => (sameItem(item.held, held) ? { ...item, ...change } : item)))
    },
    [commit]
  )

  // What this person holds for this business, from the phone. An answer already sending or failed keeps its state.
  const scan = useCallback(() => {
    const storage = heldPhone()
    if (!storage) return

    const now = Date.now()
    const owner = { organizationId, userId }
    let found: HeldSend[] = []
    try {
      found = listHeld(storage, owner, now)
    } catch {
      return
    }

    // The server's redirect says this answer arrived (`?inquiry=…&updated=declined`). A decline closes its inquiry, so
    // no reply bar opens to settle it: the inbox clears it here instead of sending it again.
    const params = new URLSearchParams(window.location.search)
    const arrived = found.filter((held) => heldDelivered(held, params))
    for (const held of arrived) keepHeld((store) => clearHeld(store, owner, held.interestId))

    commit(
      found
        .filter((held) => held.interestId.toLowerCase() !== open && !arrived.includes(held))
        .map((held) => {
          const known = current.current.find((item) => sameItem(item.held, held) && item.held.replyId === held.replyId)
          if (known && known.phase !== "holding") return { ...known, held }

          const opened = openHeld(held, now, holdMs)
          if (opened.changed) keepHeld((store) => writeHeld(store, opened.held))
          return { held: opened.held, phase: opened.phase }
        })
    )
  }, [commit, holdMs, open, organizationId, userId])

  const send = useCallback(
    async (held: HeldSend) => {
      const id = held.interestId.toLowerCase()
      const storage = heldPhone()
      if (inFlight.current.has(id) || !storage) return

      // Still the same answer on the phone? Undone, sent or replaced elsewhere (another tab, the reply bar): stop.
      const latest = readHeld(storage, { organizationId, userId }, held.interestId, Date.now())
      if (!latest || latest.replyId !== held.replyId) {
        scan()
        return
      }

      if (isOffline()) {
        update(held, { phase: "offline" })
        setSaid({ text: `Your ${held.decision === "replied" ? "reply" : "decline"} to ${nameOf(held)} is saved. We send it once when you are back in range.`, tone: "neutral" })
        return
      }

      inFlight.current.add(id)
      update(held, { failure: undefined, phase: "sending" })
      const data = new FormData()
      for (const [name, value] of Object.entries(heldFields(latest))) data.set(name, value)

      let result: HeldAnswerResult
      try {
        result = await action(data)
      } catch {
        result = { code: "unexpected", ok: false, requestId: null }
        if (isOffline()) {
          inFlight.current.delete(id)
          update(held, { phase: "offline" })
          return
        }
      }
      inFlight.current.delete(id)

      if (result.ok) {
        keepHeld((store) => clearHeld(store, { organizationId, userId }, held.interestId))
        update(held, null)
        setSaid({ text: held.decision === "replied" ? `Reply sent to ${nameOf(held)}.` : `Declined. ${nameOf(held)} can see it.`, tone: "positive" })
        return
      }

      const failure = v2ErrorMessage(result.code, result.requestId)
      update(held, { failure, phase: "error" })
      setSaid({ text: `Your ${held.decision === "replied" ? "reply" : "decline"} to ${nameOf(held)} did not send. ${failure}`, tone: "critical" })
    },
    [action, organizationId, scan, update, userId]
  )

  function stop(held: HeldSend) {
    keepHeld((store) => clearHeld(store, { organizationId, userId }, held.interestId))
    update(held, null)
    setSaid({ text: `Not sent. Your ${held.decision === "replied" ? "reply" : "decline"} to ${nameOf(held)} was removed.`, tone: "neutral" })
  }

  // On opening, when the open inquiry changes, and when another tab changes what is held.
  useEffect(() => {
    scan()
    const onStorage = () => scan()
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [scan])

  // Each held answer goes when its minute is up. A page that is hidden sends a fresh one at once, as the reply bar does;
  // one reopened after its minute ran out unseen keeps its whole minute, so it is never sent without a chance to stop it.
  useEffect(() => {
    const holding = items.filter((item) => item.phase === "holding")
    if (holding.length === 0) return

    const timers = holding.map((item) => window.setTimeout(() => void send(item.held), Math.max(0, item.held.dueAt - Date.now())))
    const flush = () => {
      if (document.visibilityState === "hidden") for (const item of holding) if (!item.held.reopened) void send(item.held)
    }

    document.addEventListener("visibilitychange", flush)
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
      document.removeEventListener("visibilitychange", flush)
    }
  }, [items, send])

  // Back in range: the saved answers go once.
  useEffect(() => {
    if (!items.some((item) => item.phase === "offline")) return

    const retry = () => {
      for (const item of current.current) if (item.phase === "offline") void send(item.held)
    }
    window.addEventListener("online", retry)
    return () => window.removeEventListener("online", retry)
  }, [items, send])

  return (
    <div className={css.inbox} data-flow-c="" data-held-inbox="">
      {/* Always in the page, so each change is announced. */}
      <p className={css.announce} data-tone={said?.tone} role="status">
        {said ? (
          <>
            {said.tone === "positive" ? <Icon aria-hidden name="status.assigned" size={20} /> : null}
            <span>{said.text}</span>
          </>
        ) : null}
      </p>
      {items.length > 0 ? (
        <section aria-labelledby={titleId} className={css.card}>
          <h2 className={css.title} id={titleId}>{headline(items)}</h2>
          <ul className={css.list}>
            {items.map((item) => (
              <HeldItem item={item} key={item.held.interestId} onSend={() => void send(item.held)} onStop={() => stop(item.held)} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function HeldItem({ item, onSend, onStop }: { item: Item; onSend: () => void; onStop: () => void }) {
  const whatId = useId()
  const { held } = item
  const reply = held.decision === "replied"

  return (
    <li className={css.item} data-phase={item.phase}>
      <p className={css.what} id={whatId}>
        {reply ? "Your reply to " : "Your decline to "}
        {nameOf(held)}
      </p>
      {reply ? (
        <blockquote className={css.quote}>
          <p>{held.body}</p>
        </blockquote>
      ) : held.body ? (
        <p className={css.reasonLine}>Reason: {held.body}</p>
      ) : null}
      <p className={css.state}>{stateText(item)}</p>
      <div className={css.actions}>
        {item.phase === "sending" ? null : (
          <>
            <Button aria-describedby={whatId} label="Send now" onClick={onSend} variant="secondary" />
            <Button aria-describedby={whatId} label="Don’t send" onClick={onStop} variant="ghost" />
          </>
        )}
        <Button aria-describedby={whatId} href={`${PATH}?${new URLSearchParams({ inquiry: held.interestId }).toString()}#conversation`} label="Open inquiry" variant="ghost" />
      </div>
    </li>
  )
}
